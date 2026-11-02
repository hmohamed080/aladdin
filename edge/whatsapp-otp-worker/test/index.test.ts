import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { buildMetaPayload, handleRequest, parseSend, readBounded, recipientAllowed, templateLanguage, verifySignature, type Env } from "../src/index.ts";
import { DEFAULT_SETTINGS, DELIVERY, FAKE_TOKEN, PHONE, SECRET, baseEnv, goodBody, memoryReplayDb, mockMeta, sign, signedSend } from "./support.ts";

const OTHER = "7c2e5d2d-1e4b-4d6f-8b88-3a7e4a1b0c22";

describe("signature, clock window and secret handling", () => {
  test("a correctly signed delivery is accepted and sent exactly once", async () => {
    const meta = mockMeta();
    const res = await handleRequest(await signedSend(), baseEnv(), meta.fetcher);
    assert.equal(res.status, 200);
    assert.equal(meta.calls.length, 1);
  });
  test("forged, wrong-secret, tampered-body and expired/future signatures are refused before anything else happens", async () => {
    const meta = mockMeta(); const reads = { n: 0 };
    const env = baseEnv({ tokenReads: reads });
    assert.equal((await handleRequest(await signedSend(goodBody(), { secretBytes: new Uint8Array(32).fill(7) }), env, meta.fetcher)).status, 401);
    assert.equal((await handleRequest(await signedSend(goodBody(), { offsetSeconds: -400 }), env, meta.fetcher)).status, 401);
    assert.equal((await handleRequest(await signedSend(goodBody(), { offsetSeconds: 400 }), env, meta.fetcher)).status, 401);
    const tampered = await signedSend();
    const body = JSON.stringify(goodBody({ code: "999999" }));
    assert.equal((await handleRequest(new Request(tampered.url, { method: "POST", headers: tampered.headers, body }), env, meta.fetcher)).status, 401);
    assert.equal((await handleRequest(new Request("https://worker.test/v1/otp/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(goodBody()) }), env, meta.fetcher)).status, 401);
    assert.equal(meta.calls.length, 0);
    assert.equal(reads.n, 0, "the Meta token is never even read before the gates pass");
  });
  test("verifySignature accepts a v1 list and rejects malformed secrets / ids", async () => {
    const raw = JSON.stringify(goodBody()); const stamp = String(Math.floor(Date.now() / 1000)); const id = `otp_${DELIVERY}`;
    const good = await sign(id, stamp, raw);
    const h = (over: Record<string, string> = {}) => new Headers({ "webhook-id": id, "webhook-timestamp": stamp, "webhook-signature": `v0,xx ${good}`, ...over });
    assert.equal(await verifySignature(raw, h(), SECRET), true);
    assert.equal(await verifySignature(raw, h(), "whsec_" + btoa("short")), false);
    assert.equal(await verifySignature(raw, h(), "not-a-secret"), false);
    assert.equal(await verifySignature(raw, h({ "webhook-id": "a.b" }), SECRET), false);
  });
  test("missing / throwing / empty signing secret fails closed with 503", async () => {
    for (const secret of [undefined, { get: async () => { throw new Error("store down"); } }, { get: async () => "" }]) {
      const meta = mockMeta();
      const res = await handleRequest(await signedSend(), { ...baseEnv(), OTP_SIGNING_SECRET: secret as unknown as Env["OTP_SIGNING_SECRET"] }, meta.fetcher);
      assert.equal(res.status, 503); assert.equal(meta.calls.length, 0);
    }
  });
});

describe("routes and request shape", () => {
  test("the Supabase Send-SMS-hook route of #114 is gone; only POST /v1/otp/send and /v1/preflight exist", async () => {
    const env = baseEnv(); const meta = mockMeta();
    for (const path of ["/hooks/supabase/send-sms", "/", "/v1/otp", "/v1/otp/send/"]) assert.equal((await handleRequest(await signedSend(goodBody(), { path }), env, meta.fetcher)).status, 404, path);
    assert.equal((await handleRequest(new Request("https://worker.test/v1/otp/send"), env, meta.fetcher)).status, 404, "GET");
    assert.equal(meta.calls.length, 0);
  });
  test("content type, size", async () => {
    const env = baseEnv(); const meta = mockMeta();
    assert.equal((await handleRequest(await signedSend(goodBody(), { contentType: "text/plain" }), env, meta.fetcher)).status, 415);
    assert.equal((await handleRequest(await signedSend(JSON.stringify({ ...goodBody(), pad: "x".repeat(5000) })), env, meta.fetcher)).status, 413);
    assert.equal(meta.calls.length, 0);
  });
  test("strict body schema: every malformed field is a 422 and sends nothing", async () => {
    const meta = mockMeta(); const env = baseEnv();
    const bad: Array<Partial<ReturnType<typeof goodBody>>> = [
      { to: "+2010123" }, { to: "01012345678" }, { to: "+14155550100" }, { code: "12345" }, { code: "1234567" }, { code: "12345a" },
      { purpose: "marketing" }, { locale: "fr" }, { ttl_seconds: 5 }, { ttl_seconds: 100000 }, { ttl_seconds: 300.5 }, { delivery_id: "nope" },
    ];
    for (const over of bad) assert.equal((await handleRequest(await signedSend(goodBody(over)), env, meta.fetcher)).status, 422, JSON.stringify(over));
    assert.equal((await handleRequest(await signedSend("[]"), env, meta.fetcher)).status, 422);
    assert.equal((await handleRequest(await signedSend("not json"), env, meta.fetcher)).status, 422);
    assert.equal(meta.calls.length, 0);
    assert.ok(parseSend(JSON.stringify(goodBody())));
  });
  test("the signed request id must BE this delivery's identity: a valid signature for one challenge cannot be replayed as another", async () => {
    const meta = mockMeta(); const env = baseEnv();
    assert.equal((await handleRequest(await signedSend(goodBody(), { id: `otp_${OTHER}` }), env, meta.fetcher)).status, 400);
    assert.equal((await handleRequest(await signedSend(goodBody(), { id: "msg_random" }), env, meta.fetcher)).status, 400);
    assert.equal(meta.calls.length, 0);
  });
});

describe("switches and recipient policy", () => {
  test("delivery disabled (default state) sends nothing and does not even read the token", async () => {
    for (const flag of ["false", "", "TRUE", "1", undefined]) {
      const meta = mockMeta(); const reads = { n: 0 };
      const res = await handleRequest(await signedSend(), baseEnv({ WHATSAPP_DELIVERY_ENABLED: flag as string, tokenReads: reads }), meta.fetcher);
      assert.equal(res.status, 503); assert.equal(meta.calls.length, 0); assert.equal(reads.n, 0);
    }
  });
  test("allowlist is mandatory: a number not on it, an empty list and an unset list all refuse; invalid entries never match", async () => {
    for (const list of ["+201099999999", "", undefined, "01012345678,+2010123"]) {
      const meta = mockMeta();
      const res = await handleRequest(await signedSend(), baseEnv({ OTP_ALLOWED_RECIPIENTS: list }), meta.fetcher);
      assert.equal(res.status, 403, String(list)); assert.equal(meta.calls.length, 0);
    }
    assert.equal(recipientAllowed(PHONE, baseEnv({ OTP_ALLOWED_RECIPIENTS: `+201099999999, ${PHONE}` })), true);
  });
  test("'open' recipient mode works ONLY when the Worker is explicitly production; elsewhere it is still the allowlist", async () => {
    for (const environment of ["acceptance", "local", undefined]) {
      const meta = mockMeta();
      const res = await handleRequest(await signedSend(), baseEnv({ OTP_RECIPIENT_MODE: "open", OTP_ENVIRONMENT: environment, OTP_ALLOWED_RECIPIENTS: "" }), meta.fetcher);
      assert.equal(res.status, 403, String(environment)); assert.equal(meta.calls.length, 0);
    }
    const meta = mockMeta();
    assert.equal((await handleRequest(await signedSend(), baseEnv({ OTP_RECIPIENT_MODE: "open", OTP_ENVIRONMENT: "production", OTP_ALLOWED_RECIPIENTS: "" }), meta.fetcher)).status, 200);
    assert.equal(meta.calls.length, 1);
  });
});

describe("idempotency bound to the challenge (delivery_id)", () => {
  test("the same signed delivery sends once; a replay answers 200 'duplicate' with NO second Meta call", async () => {
    const meta = mockMeta(); const env = baseEnv();
    assert.equal((await handleRequest(await signedSend(), env, meta.fetcher)).status, 200);
    const again = await handleRequest(await signedSend(), env, meta.fetcher);
    assert.equal(again.status, 200); assert.deepEqual(await again.json(), { status: "duplicate" });
    assert.equal(meta.calls.length, 1);
  });
  test("concurrent identical deliveries produce exactly one Meta call", async () => {
    const meta = mockMeta(); const env = baseEnv();
    const results = await Promise.all(Array.from({ length: 6 }, async () => handleRequest(await signedSend(), env, meta.fetcher)));
    assert.equal(meta.calls.length, 1);
    assert.ok(results.every((r) => [200, 409, 503].includes(r.status)));
    assert.ok(results.some((r) => r.status === 200));
  });
  test("two different challenges for the same number are two deliveries (the resend path); each is sent once", async () => {
    const meta = mockMeta(); const env = baseEnv();
    assert.equal((await handleRequest(await signedSend(goodBody({ delivery_id: DELIVERY })), env, meta.fetcher)).status, 200);
    assert.equal((await handleRequest(await signedSend(goodBody({ delivery_id: OTHER, code: "654321" })), env, meta.fetcher)).status, 200);
    assert.equal(meta.calls.length, 2);
  });
  test("a failed Meta call is recorded and NEVER retried for that challenge: the replay is 409 and Meta is not called again", async () => {
    const meta = mockMeta(false); const env = baseEnv();
    assert.equal((await handleRequest(await signedSend(), env, meta.fetcher)).status, 502);
    assert.equal((await handleRequest(await signedSend(), env, meta.fetcher)).status, 409);
    assert.equal(meta.calls.length, 1);
    assert.equal([...(env.IDEMPOTENCY_DB as ReturnType<typeof memoryReplayDb>).rows.values()][0], "failed");
  });
  test("a network exception to Meta is treated the same (ambiguous failure, no retry)", async () => {
    let calls = 0; const env = baseEnv();
    const boom = (async () => { calls += 1; throw new Error("socket"); }) as unknown as typeof fetch;
    assert.equal((await handleRequest(await signedSend(), env, boom)).status, 502);
    assert.equal((await handleRequest(await signedSend(), env, boom)).status, 409);
    assert.equal(calls, 1);
  });
  test("journal unavailable / throwing / mis-reporting fails closed BEFORE Meta; the journal holds a hash, never the id, number or code", async () => {
    const meta = mockMeta();
    assert.equal((await handleRequest(await signedSend(), baseEnv({ IDEMPOTENCY_DB: undefined }), meta.fetcher)).status, 503);
    const throwing = { prepare() { throw new Error("d1 down"); } } as unknown as Env["IDEMPOTENCY_DB"];
    assert.equal((await handleRequest(await signedSend(), baseEnv({ IDEMPOTENCY_DB: throwing }), meta.fetcher)).status, 503);
    assert.equal(meta.calls.length, 0);
    const db = memoryReplayDb(); await handleRequest(await signedSend(), baseEnv({ IDEMPOTENCY_DB: db }), mockMeta().fetcher);
    for (const key of db.rows.keys()) { assert.match(key, /^[0-9a-f]{64}$/); assert.ok(!key.includes(DELIVERY) && !key.includes("123456") && !key.includes("1012345678")); }
  });
});

describe("global rolling-24h send budget (settings row in D1)", () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const withSettings = (over: Partial<typeof DEFAULT_SETTINGS> = {}) => memoryReplayDb({ settings: { ...DEFAULT_SETTINGS, ...over } });
  test("the (limit+1)th delivery inside 24 h is refused BEFORE Meta and before the token is read; earlier ones are sent", async () => {
    const meta = mockMeta(); const reads = { n: 0 };
    const env = baseEnv({ IDEMPOTENCY_DB: withSettings({ daily_limit: 2 }), tokenReads: reads });
    assert.equal((await handleRequest(await signedSend(goodBody({ delivery_id: id(1) })), env, meta.fetcher)).status, 200);
    assert.equal((await handleRequest(await signedSend(goodBody({ delivery_id: id(2) })), env, meta.fetcher)).status, 200);
    const refused = await handleRequest(await signedSend(goodBody({ delivery_id: id(3) })), env, meta.fetcher);
    assert.equal(refused.status, 503);
    assert.deepEqual(await refused.json(), { error: "budget_exhausted" });
    assert.equal(meta.calls.length, 2);
    assert.equal(reads.n, 2, "the refused delivery never read the Meta token");
  });
  test("the effective limit is the Daily Send Limit; the ceiling only bounds what an administrator may set, it never raises the limit", async () => {
    const meta = mockMeta();
    const env = baseEnv({ IDEMPOTENCY_DB: withSettings({ daily_limit: 1, hard_ceiling: 5000 }) });
    assert.equal((await handleRequest(await signedSend(goodBody({ delivery_id: id(1) })), env, meta.fetcher)).status, 200);
    assert.equal((await handleRequest(await signedSend(goodBody({ delivery_id: id(2) })), env, meta.fetcher)).status, 503);
  });
  test("a replay of an already-accepted delivery stays a harmless duplicate even when the budget is exhausted; claims older than 24 h do not count", async () => {
    const meta = mockMeta(); const db = withSettings({ daily_limit: 1 }); const env = baseEnv({ IDEMPOTENCY_DB: db });
    assert.equal((await handleRequest(await signedSend(goodBody({ delivery_id: id(1) })), env, meta.fetcher)).status, 200);
    assert.equal((await handleRequest(await signedSend(goodBody({ delivery_id: id(1) })), env, meta.fetcher)).status, 200, "duplicate, not budget_exhausted");
    assert.equal(meta.calls.length, 1);
    const old = withSettings({ daily_limit: 1 }); old.seed("a".repeat(64), Math.floor(Date.now() / 1000) - 86_401);
    assert.equal((await handleRequest(await signedSend(goodBody({ delivery_id: id(2) })), baseEnv({ IDEMPOTENCY_DB: old }), meta.fetcher)).status, 200, "a 24h+1s-old claim is outside the window");
    const recent = withSettings({ daily_limit: 1 }); recent.seed("b".repeat(64), Math.floor(Date.now() / 1000) - 3_600);
    assert.equal((await handleRequest(await signedSend(goodBody({ delivery_id: id(3) })), baseEnv({ IDEMPOTENCY_DB: recent }), meta.fetcher)).status, 503);
  });
  test("a missing settings row fails closed in every environment: nothing is sent and the token is never read", async () => {
    for (const environment of ["acceptance", "production"]) {
      const meta = mockMeta(); const reads = { n: 0 };
      const res = await handleRequest(await signedSend(), baseEnv({ IDEMPOTENCY_DB: memoryReplayDb({ settings: null }), OTP_ENVIRONMENT: environment, tokenReads: reads }), meta.fetcher);
      assert.equal(res.status, 503, environment);
      assert.deepEqual(await res.json(), { error: "budget_unconfigured" });
      assert.equal(meta.calls.length, 0); assert.equal(reads.n, 0);
    }
  });
  test("an invalid settings row (limit above the ceiling, thresholds out of order, non-integers, out-of-range) is treated as unconfigured", async () => {
    const bad: Array<Partial<typeof DEFAULT_SETTINGS>> = [
      { daily_limit: 10, hard_ceiling: 5 }, { warn_percent: 90, critical_percent: 70 }, { warn_percent: 0 }, { critical_percent: 101 },
      { daily_limit: 0 }, { daily_limit: 2.5 }, { hard_ceiling: 1_000_001 }, { version: 0 },
    ];
    for (const over of bad) {
      const meta = mockMeta();
      const res = await handleRequest(await signedSend(), baseEnv({ IDEMPOTENCY_DB: withSettings(over) }), meta.fetcher);
      assert.equal(res.status, 503, JSON.stringify(over));
      assert.deepEqual(await res.json(), { error: "budget_unconfigured" });
      assert.equal(meta.calls.length, 0);
    }
  });
  test("the delivery kill switch is independent of the budget: with delivery OFF the answer is delivery_disabled whatever the settings are", async () => {
    const meta = mockMeta();
    for (const db of [memoryReplayDb({ settings: null }), withSettings({ daily_limit: 1 })]) {
      const res = await handleRequest(await signedSend(), baseEnv({ WHATSAPP_DELIVERY_ENABLED: "false", IDEMPOTENCY_DB: db }), meta.fetcher);
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { error: "delivery_disabled" });
    }
    assert.equal((await handleRequest(await signedSend(goodBody({ to: "+201099999999" })), baseEnv({ IDEMPOTENCY_DB: memoryReplayDb({ settings: null }) }), meta.fetcher)).status, 403);
    assert.equal(meta.calls.length, 0);
  });
});

describe("the Meta request", () => {
  test("exact Authentication-template payload: name aladdin_otp, Arabic, code in the body AND the copy-code button, number without '+', token only in the header", async () => {
    const meta = mockMeta();
    await handleRequest(await signedSend(), baseEnv(), meta.fetcher);
    const [call] = meta.calls;
    assert.equal(call!.url, "https://graph.facebook.com/v25.0/1415528588305492/messages");
    assert.equal(call!.headers.authorization, `Bearer ${FAKE_TOKEN}`);
    assert.deepEqual(call!.body, {
      messaging_product: "whatsapp", to: "201012345678", type: "template",
      template: { name: "aladdin_otp", language: { code: "ar" }, components: [
        { type: "body", parameters: [{ type: "text", text: "123456" }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "123456" }] },
      ] },
    });
    assert.ok(!JSON.stringify(call!.body).includes(FAKE_TOKEN));
    assert.deepEqual(buildMetaPayload(PHONE, "123456", "aladdin_otp", "ar"), call!.body);
  });
  test("language: an approved locale is used; an unapproved one falls back to Arabic; no Arabic approval means no send", async () => {
    assert.equal(templateLanguage("en", baseEnv({ WHATSAPP_OTP_LANGUAGES: "ar,en" })), "en");
    assert.equal(templateLanguage("en", baseEnv({ WHATSAPP_OTP_LANGUAGES: "ar" })), "ar");
    assert.equal(templateLanguage("en", baseEnv({ WHATSAPP_OTP_LANGUAGES: "en" })), "en");
    assert.equal(templateLanguage("ar", baseEnv({ WHATSAPP_OTP_LANGUAGES: "en" })), null);
    const meta = mockMeta();
    await handleRequest(await signedSend(goodBody({ locale: "en" })), baseEnv(), meta.fetcher);
    assert.equal(meta.calls[0]!.body.template.language.code, "ar");
    const none = mockMeta(); const env = baseEnv({ WHATSAPP_OTP_LANGUAGES: "en" });
    assert.equal((await handleRequest(await signedSend(goodBody({ locale: "ar", delivery_id: OTHER })), env, none.fetcher)).status, 502);
    assert.equal(none.calls.length, 0);
  });
  test("a malformed sender id, template name or Graph version sends nothing", async () => {
    for (const over of [{ WHATSAPP_PHONE_NUMBER_ID: "abc" }, { WHATSAPP_OTP_TEMPLATE: "Bad Name" }, { WHATSAPP_GRAPH_API_VERSION: "25" }]) {
      const meta = mockMeta();
      assert.equal((await handleRequest(await signedSend(), baseEnv(over), meta.fetcher)).status, 502); assert.equal(meta.calls.length, 0);
    }
  });
  test("the Graph URL can be redirected ONLY on a local rig to loopback http; never in acceptance or production", async () => {
    const local = mockMeta();
    await handleRequest(await signedSend(), baseEnv({ OTP_ENVIRONMENT: "local", WHATSAPP_GRAPH_BASE_URL: "http://127.0.0.1:19999" }), local.fetcher);
    assert.equal(local.calls[0]!.url, "http://127.0.0.1:19999/v25.0/1415528588305492/messages");
    for (const environment of ["acceptance", "production"]) {
      const m = mockMeta();
      await handleRequest(await signedSend(goodBody({ delivery_id: environment === "acceptance" ? DELIVERY : OTHER })), baseEnv({ OTP_ENVIRONMENT: environment, OTP_RECIPIENT_MODE: "open", WHATSAPP_GRAPH_BASE_URL: "http://127.0.0.1:19999" }), m.fetcher);
      assert.ok(m.calls[0]!.url.startsWith("https://graph.facebook.com/"), environment);
    }
    const remote = mockMeta();
    await handleRequest(await signedSend(goodBody({ delivery_id: "9d8f6c52-4a41-4e0d-b0a5-1c2f6a3b7e10" })), baseEnv({ OTP_ENVIRONMENT: "local", WHATSAPP_GRAPH_BASE_URL: "https://evil.example" }), remote.fetcher);
    assert.ok(remote.calls[0]!.url.startsWith("https://graph.facebook.com/"));
  });
});

describe("preflight (signed, side-effect free) and leak checks", () => {
  test("reports presence and switches, never a value; refuses an unsigned or wrongly signed call", async () => {
    const env = baseEnv({ WHATSAPP_DELIVERY_ENABLED: "false" }); const meta = mockMeta();
    const ok = await handleRequest(await signedSend('{"check":"preflight"}', { id: "preflight_1", path: "/v1/preflight" }), env, meta.fetcher);
    assert.equal(ok.status, 200);
    const text = await ok.text(); const out = JSON.parse(text);
    assert.deepEqual({ ...out, sender_id_suffix: undefined }, { signing_secret_bound: true, admin_secret_bound: false, notify_configured: false, meta_token_bound: true, d1_reachable: true, delivery_enabled: false, environment: "acceptance", recipient_mode: "allowlist", allowlist_entries: 1, settings_initialized: true, daily_send_limit: 100, hard_ceiling: 5000, warn_percent: 70, critical_percent: 90, template: "aladdin_otp", languages: "ar", graph_version: "v25.0", sender_id_suffix: undefined });
    assert.equal(out.sender_id_suffix, "5492");
    for (const secret of [FAKE_TOKEN, SECRET, PHONE, "1012345678", "1415528588305492"]) assert.ok(!text.includes(secret), "preflight must not contain " + secret.slice(0, 6));
    assert.equal(meta.calls.length, 0);
    assert.equal((await handleRequest(await signedSend('{"check":"preflight"}', { id: "preflight_1", path: "/v1/preflight", secretBytes: new Uint8Array(32).fill(1) }), env, meta.fetcher)).status, 401);
    const missing = await handleRequest(await signedSend('{"check":"preflight"}', { id: "p", path: "/v1/preflight" }), baseEnv({ WHATSAPP_ACCESS_TOKEN: { get: async () => "" }, IDEMPOTENCY_DB: undefined }), meta.fetcher);
    const m = await missing.json() as { meta_token_bound: boolean; d1_reachable: boolean };
    assert.deepEqual([m.meta_token_bound, m.d1_reachable], [false, false]);
  });
  test("no response, and nothing written to the console, ever contains a code, a full number, the token or the signing secret", async () => {
    const logged: string[] = []; const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
    for (const k of Object.keys(orig) as Array<keyof typeof orig>) console[k] = ((...a: unknown[]) => { logged.push(a.join(" ")); }) as never;
    try {
      const bodies: string[] = [];
      const cases: Array<[Request, Env, typeof fetch]> = [
        [await signedSend(), baseEnv(), mockMeta().fetcher],
        [await signedSend(), baseEnv(), mockMeta(false).fetcher],
        [await signedSend(goodBody({ delivery_id: OTHER })), baseEnv({ OTP_ALLOWED_RECIPIENTS: "" }), mockMeta().fetcher],
        [await signedSend(goodBody(), { secretBytes: new Uint8Array(32).fill(3) }), baseEnv(), mockMeta().fetcher],
      ];
      for (const [req, env, f] of cases) { const r = await handleRequest(req, env, f); bodies.push(await r.text()); }
      for (const text of [...bodies, ...logged]) for (const s of ["123456", PHONE, "1012345678", FAKE_TOKEN, SECRET]) assert.ok(!text.includes(s), `leaked ${s.slice(0, 5)}`);
    } finally { Object.assign(console, orig); }
    // The ONLY console output allowed is the sanitized failure line from the Meta-rejected case above.
    assert.equal(logged.length, 1);
    assert.deepEqual(JSON.parse(logged[0]!), { event: "whatsapp_otp_delivery_failed", category: "http", status: 502 });
  });
});

describe("delivery failure diagnostics (sanitized, whitelist only)", () => {
  const RAW_SECRETS = ["123456", PHONE, "1012345678", "201012345678", FAKE_TOKEN, SECRET, "Bearer", "aladdin_otp", "authorization"];
  const ALLOWED_KEYS = ["event", "category", "status", "meta_code", "meta_subcode", "fbtrace_id"];
  const metaError = (status: number, body: unknown) => (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;

  async function run(env: Env, fetcher: typeof fetch) {
    const logged: string[] = []; const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
    for (const k of Object.keys(orig) as Array<keyof typeof orig>) console[k] = ((...a: unknown[]) => { logged.push(a.join(" ")); }) as never;
    try {
      const res = await handleRequest(await signedSend(), env, fetcher);
      return { res, body: await res.text(), logged };
    } finally { Object.assign(console, orig); }
  }
  /** Every captured line is one JSON object from the whitelist and contains no raw secret. */
  function assertSanitized(logged: string[]) {
    for (const line of logged) {
      for (const s of RAW_SECRETS) assert.ok(!line.toLowerCase().includes(s.toLowerCase()), `leaked ${s.slice(0, 6)}`);
      const o = JSON.parse(line) as Record<string, unknown>;
      for (const k of Object.keys(o)) assert.ok(ALLOWED_KEYS.includes(k), `unexpected key ${k}`);
      assert.equal(o.event, "whatsapp_otp_delivery_failed");
    }
  }
  const line = (r: { logged: string[] }) => { assert.equal(r.logged.length, 1); return JSON.parse(r.logged[0]!) as Record<string, unknown>; };
  const DENIED = JSON.stringify({ error: "delivery_unavailable" });

  test("a Meta rejection logs exactly status, numeric code, numeric subcode, a valid fbtrace_id and the category; the API answer is unchanged", async () => {
    const r = await run(baseEnv(), metaError(400, { error: { message: "Template aladdin_otp for 201012345678 code 123456 not found", type: "GraphMethodException", code: 100, error_subcode: 33, fbtrace_id: "AbCdEf123_-xYz", error_data: { details: "secret" } } }));
    assert.equal(r.res.status, 502);
    assert.equal(r.body, DENIED);
    assert.deepEqual(line(r), { event: "whatsapp_otp_delivery_failed", category: "http", status: 400, meta_code: 100, meta_subcode: 33, fbtrace_id: "AbCdEf123_-xYz" });
    assertSanitized(r.logged);
  });

  test("hostile / out-of-range fields are dropped, never echoed: string, float, negative, huge numbers; bad or injected fbtrace_id", async () => {
    const hostile = [
      { error: { code: "100", error_subcode: "33", fbtrace_id: 12345678 } },
      { error: { code: 1.5, error_subcode: -1, fbtrace_id: "short" } },
      { error: { code: 1e12, error_subcode: Number.MAX_SAFE_INTEGER, fbtrace_id: "x".repeat(41) } },
      { error: { code: 100, fbtrace_id: "AbCdEf12\"\\n<script>alert(1)</script>" } },
      { error: { code: 100, fbtrace_id: "AbCdEf12 34 56 78" } },
      { error: { code: null, error_subcode: {}, fbtrace_id: [] } },
    ];
    for (const body of hostile) {
      const r = await run(baseEnv(), metaError(403, body));
      assert.equal(r.res.status, 502);
      const o = line(r);
      assert.equal(o.category, "http"); assert.equal(o.status, 403);
      assert.equal(o.fbtrace_id, undefined); assert.equal(o.meta_subcode, undefined);
      assert.ok(o.meta_code === undefined || o.meta_code === 100);
      assertSanitized(r.logged);
    }
  });

  test("malformed, empty, non-JSON, array, scalar, truncated and oversized error bodies still log the HTTP status and nothing else", async () => {
    const bodies: string[] = ["", "not json at all 123456", "[]", "null", "42", "\"str\"", "{\"error\":\"just text\"}", "{\"error\":null}", "{\"error\":{\"code\":1", JSON.stringify({ error: { code: 100, pad: "x".repeat(200_000) } })];
    for (const body of bodies) {
      const r = await run(baseEnv(), metaError(500, body));
      assert.equal(r.res.status, 502);
      const o = line(r);
      assert.equal(o.category, "http"); assert.equal(o.status, 500);
      assert.equal(o.fbtrace_id, undefined);
      assertSanitized(r.logged);
    }
  });

  const enc = new TextEncoder();
  /** A response whose body is a controllable stream; `state` records how much was pulled and whether it was cancelled. */
  function streamed(status: number, chunks: Array<Uint8Array | Error>, opts: { endless?: Uint8Array; cancelThrows?: boolean } = {}) {
    const state = { pulled: 0, cancelled: false };
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        state.pulled += 1;
        if (opts.endless) { c.enqueue(opts.endless); return; }
        const next = chunks[i++];
        if (next === undefined) { c.close(); return; }
        if (next instanceof Error) { c.error(next); return; }
        c.enqueue(next);
      },
      cancel() { state.cancelled = true; if (opts.cancelThrows) throw new Error("cancel failed with Bearer " + FAKE_TOKEN); },
    }, { highWaterMark: 0 });
    return { res: new Response(body, { status }), state };
  }

  test("an oversized error body is NOT consumed: reading stops at the byte limit, the stream is cancelled, and the status is still logged", async () => {
    const kb = new Uint8Array(1024).fill(120); // 'x'
    const { res, state } = streamed(500, [], { endless: kb });
    const r = await run(baseEnv(), (async () => res) as unknown as typeof fetch);
    assert.deepEqual(line(r), { event: "whatsapp_otp_delivery_failed", category: "http", status: 500 });
    assert.equal(state.cancelled, true);
    assert.ok(state.pulled <= 9, `pulled ${state.pulled} KB from an endless body`); // 8 KB limit => at most 8 full chunks (+1 for the stream's own look-ahead)
    assertSanitized(r.logged);
  });

  test("a valid error split across many small chunks is parsed; a failing cancel or a stream error never changes the outcome", async () => {
    const json = JSON.stringify({ error: { message: "m", code: 190, error_subcode: 463, fbtrace_id: "Trace_ABCDEFGH" } });
    const bytes = enc.encode(json);
    const parts = Array.from({ length: Math.ceil(bytes.length / 7) }, (_, k) => bytes.subarray(k * 7, k * 7 + 7));
    const ok = streamed(401, parts, { cancelThrows: true });
    const a = await run(baseEnv(), (async () => ok.res) as unknown as typeof fetch);
    assert.deepEqual(line(a), { event: "whatsapp_otp_delivery_failed", category: "http", status: 401, meta_code: 190, meta_subcode: 463, fbtrace_id: "Trace_ABCDEFGH" });
    const broken = streamed(429, [enc.encode('{"error":{"code":4,'), new Error("stream reset with Bearer " + FAKE_TOKEN)]);
    const b = await run(baseEnv(), (async () => broken.res) as unknown as typeof fetch);
    assert.equal(b.res.status, 502);
    assert.deepEqual(line(b), { event: "whatsapp_otp_delivery_failed", category: "http", status: 429 });
    assertSanitized([...a.logged, ...b.logged]);
  });

  test("readBounded: exact limit, over the limit, multi-byte split at the cut, empty and absent bodies, never more than max bytes", async () => {
    assert.equal(await readBounded(new Response("abcdef"), 6), "abcdef");
    assert.equal(await readBounded(new Response("abcdefgh"), 6), "abcdef");
    assert.equal(await readBounded(new Response(""), 6), "");
    assert.equal(await readBounded(new Response(null), 6), "");
    assert.equal(await readBounded(new Response(new Uint8Array([97, 98, 99, 100]), { status: 400 }), 0), "");
    const cut = await readBounded(new Response(enc.encode("abéé")), 3); // 3rd byte is half of a 2-byte char
    assert.equal(cut?.startsWith("ab"), true); assert.ok((cut ?? "").length <= 3);
    const { res, state } = streamed(200, [], { endless: new Uint8Array(4096).fill(65) });
    const got = await readBounded(res, 8192);
    assert.equal(got?.length, 8192); assert.equal(state.cancelled, true); assert.ok(state.pulled <= 3);
    const failing = streamed(200, [new Error("boom")]);
    assert.equal(await readBounded(failing.res, 100), null);
  });

  test("token lookup failure and empty token are distinct categories, never reach Meta, and a throwing store's message is not logged", async () => {
    let calls = 0; const meta = (async () => { calls += 1; return new Response("{}"); }) as unknown as typeof fetch;
    const throwing = await run(baseEnv({ WHATSAPP_ACCESS_TOKEN: { get: async () => { throw new Error("store down " + FAKE_TOKEN + " " + SECRET); } } }), meta);
    assert.equal(throwing.res.status, 502); assert.equal(throwing.body, DENIED);
    assert.deepEqual(line(throwing), { event: "whatsapp_otp_delivery_failed", category: "token_lookup" });
    const empty = await run(baseEnv({ WHATSAPP_ACCESS_TOKEN: { get: async () => "" } }), meta);
    assert.deepEqual(line(empty), { event: "whatsapp_otp_delivery_failed", category: "token_empty" });
    const unbound = await run(baseEnv({ WHATSAPP_ACCESS_TOKEN: undefined as never }), meta);
    assert.deepEqual(line(unbound), { event: "whatsapp_otp_delivery_failed", category: "token_lookup" });
    assert.equal(calls, 0);
    for (const x of [throwing, empty, unbound]) assertSanitized(x.logged);
  });

  test("timeouts and network failures are distinguished by error name only; the error message is never read or logged", async () => {
    const thrower = (e: unknown) => (async () => { throw e; }) as unknown as typeof fetch;
    const leaky = "https://graph.facebook.com/v25.0/1415528588305492/messages Bearer " + FAKE_TOKEN + " to 201012345678";
    const cases: Array<[unknown, string]> = [
      [new DOMException(leaky, "TimeoutError"), "timeout"],
      [new DOMException(leaky, "AbortError"), "timeout"],
      [new TypeError("fetch failed " + leaky), "network"],
      [new Error(leaky), "network"],
      ["a thrown string " + leaky, "network"],
      [undefined, "network"],
    ];
    for (const [err, category] of cases) {
      const r = await run(baseEnv(), thrower(err));
      assert.equal(r.res.status, 502);
      assert.deepEqual(line(r), { event: "whatsapp_otp_delivery_failed", category });
      assertSanitized(r.logged);
    }
  });

  test("a 2xx without a message id, with a non-string id, or with a non-JSON body is invalid_response (still 502)", async () => {
    const ok = (body: string) => (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
    for (const body of ["", "<html>ok</html>", "{}", "{\"messages\":[]}", "{\"messages\":[{}]}", "{\"messages\":[{\"id\":7}]}", "null", "[]"]) {
      const r = await run(baseEnv(), ok(body));
      assert.equal(r.res.status, 502);
      assert.deepEqual(line(r), { event: "whatsapp_otp_delivery_failed", category: "invalid_response", status: 200 });
      assertSanitized(r.logged);
    }
  });

  test("invalid local configuration is category 'config' and never calls Meta", async () => {
    let calls = 0; const meta = (async () => { calls += 1; return new Response("{}"); }) as unknown as typeof fetch;
    for (const over of [{ WHATSAPP_PHONE_NUMBER_ID: "abc" }, { WHATSAPP_OTP_TEMPLATE: "Bad Name" }, { WHATSAPP_GRAPH_API_VERSION: "latest" }, { WHATSAPP_OTP_LANGUAGES: "en" }]) {
      const r = await run(baseEnv(over), meta);
      assert.equal(r.res.status, 502);
      assert.deepEqual(line(r), { event: "whatsapp_otp_delivery_failed", category: "config" });
    }
    assert.equal(calls, 0);
  });

  test("success logs nothing; a Meta failure stays recorded as 'failed' and is never retried (409), with one diagnostic line only", async () => {
    const ok = await run(baseEnv(), mockMeta().fetcher);
    assert.equal(ok.res.status, 200); assert.deepEqual(ok.logged, []);
    const env = baseEnv(); let calls = 0;
    const f = (async () => { calls += 1; return new Response(JSON.stringify({ error: { code: 131000, fbtrace_id: "Trace_12345678" } }), { status: 400 }); }) as unknown as typeof fetch;
    const first = await run(env, f); const second = await run(env, f);
    assert.equal(first.res.status, 502); assert.equal(second.res.status, 409);
    assert.equal(first.logged.length, 1); assert.deepEqual(second.logged, []);
    assert.equal(calls, 1);
    assert.equal([...(env.IDEMPOTENCY_DB as ReturnType<typeof memoryReplayDb>).rows.values()][0], "failed");
  });
});
