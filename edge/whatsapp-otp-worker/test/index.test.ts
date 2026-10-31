import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { buildMetaPayload, handleRequest, parseSend, recipientAllowed, templateLanguage, verifySignature, type Env } from "../src/index.ts";
import { DELIVERY, FAKE_TOKEN, PHONE, SECRET, baseEnv, goodBody, memoryReplayDb, mockMeta, sign, signedSend } from "./support.ts";

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
    assert.deepEqual({ ...out, sender_id_suffix: undefined }, { signing_secret_bound: true, meta_token_bound: true, d1_reachable: true, delivery_enabled: false, environment: "acceptance", recipient_mode: "allowlist", allowlist_entries: 1, template: "aladdin_otp", languages: "ar", graph_version: "v25.0", sender_id_suffix: undefined });
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
    assert.deepEqual(logged, []);
  });
});
