import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { accessHeaders, isAccessRedirect } from "../src/notify-transport.ts";
import { probeNotifyPath } from "../src/admin.ts";
import { deliverOutbox, evaluateAlerts } from "../src/maintenance.ts";
import { verifySignature } from "../src/signing.ts";
import { NOTIFY_SECRET, NOTIFY_URL, configure, envFor, seedJournal, withD1 } from "./d1.ts";

// Fixture values are synthetic and obviously not credentials.
const CLIENT_ID = "0123456789abcdef0123456789abcdef.access";
const CLIENT_SECRET = "f".repeat(64);
const ACCESS = {
  OTP_NOTIFY_ACCESS_CLIENT_ID: { get: async () => CLIENT_ID },
  OTP_NOTIFY_ACCESS_CLIENT_SECRET: { get: async () => CLIENT_SECRET },
};
const now = () => Math.floor(Date.now() / 1000);
const ACCESS_LOGIN = "https://team-name.cloudflareaccess.com/cdn-cgi/access/login/app.test?kid=x";

type Seen = { url: string; headers: Headers; body: string; redirect?: string };
const recorder = (answer: (req: Request) => Response | Promise<Response>) => {
  const seen: Seen[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    seen.push({ url, headers: new Headers(init.headers), body: String(init.body), redirect: init.redirect });
    return answer(new Request(url, init));
  }) as unknown as typeof fetch;
  return { seen, fetcher };
};
const probeEnv = (over: Record<string, unknown> = {}) =>
  ({ OTP_NOTIFY_URL: NOTIFY_URL, OTP_NOTIFY_SIGNING_SECRET: { get: async () => NOTIFY_SECRET }, ...over }) as any;

describe("Access service token: how the credentials are read", () => {
  test("neither binding means no Access headers (an app that is not behind Access, e.g. Production)", async () => {
    assert.deepEqual(await accessHeaders({}), { ok: true, headers: {} });
  });
  test("both well-formed bindings produce exactly the two CF-Access-Client headers", async () => {
    assert.deepEqual(await accessHeaders(ACCESS), { ok: true, headers: { "cf-access-client-id": CLIENT_ID, "cf-access-client-secret": CLIENT_SECRET } });
  });
  test("a half-configured, empty, throwing or malformed pair fails closed and echoes no value", async () => {
    const bad: Array<Record<string, unknown>> = [
      { OTP_NOTIFY_ACCESS_CLIENT_ID: ACCESS.OTP_NOTIFY_ACCESS_CLIENT_ID },
      { OTP_NOTIFY_ACCESS_CLIENT_SECRET: ACCESS.OTP_NOTIFY_ACCESS_CLIENT_SECRET },
      { ...ACCESS, OTP_NOTIFY_ACCESS_CLIENT_ID: { get: async () => "" } },
      { ...ACCESS, OTP_NOTIFY_ACCESS_CLIENT_SECRET: { get: async () => "" } },
      { ...ACCESS, OTP_NOTIFY_ACCESS_CLIENT_SECRET: { get: async () => { throw new Error("store down " + CLIENT_SECRET); } } },
      { ...ACCESS, OTP_NOTIFY_ACCESS_CLIENT_ID: { get: async () => "short" } },
      { ...ACCESS, OTP_NOTIFY_ACCESS_CLIENT_SECRET: { get: async () => CLIENT_SECRET + "\r\nx-injected: 1" } },
      { ...ACCESS, OTP_NOTIFY_ACCESS_CLIENT_ID: { get: async () => "has space in it 0123456789" } },
    ];
    for (const env of bad) {
      const r = await accessHeaders(env as any);
      assert.deepEqual(r, { ok: false, reason: "credentials_invalid" });
      assert.ok(!JSON.stringify(r).includes(CLIENT_SECRET));
    }
  });
  test("only a redirect to a cloudflareaccess.com host counts as an Access login redirect", () => {
    assert.equal(isAccessRedirect(new Response(null, { status: 302, headers: { location: ACCESS_LOGIN } })), true);
    assert.equal(isAccessRedirect(new Response(null, { status: 302, headers: { location: "https://evilcloudflareaccess.com/x" } })), false);
    assert.equal(isAccessRedirect(new Response(null, { status: 302, headers: { location: "https://elsewhere.test/" } })), false);
    assert.equal(isAccessRedirect(new Response(null, { status: 302 })), false);
    assert.equal(isAccessRedirect(new Response(null, { status: 400, headers: { location: ACCESS_LOGIN } })), false);
  });
});

describe("connection probe through the Access-aware transport", () => {
  test("valid credentials: the probe carries the Access headers AND a valid notify signature, never follows redirects, and a 400 means reachable", async () => {
    const { seen, fetcher } = recorder(() => new Response(null, { status: 400 }));
    const r = await probeNotifyPath(probeEnv(ACCESS), now(), fetcher);
    assert.deepEqual(r, { result: "reachable", status: 400 });
    assert.equal(seen.length, 1);
    const c = seen[0]!;
    assert.equal(c.url, NOTIFY_URL);
    assert.equal(c.redirect, "manual");
    assert.equal(c.headers.get("cf-access-client-id"), CLIENT_ID);
    assert.equal(c.headers.get("cf-access-client-secret"), CLIENT_SECRET);
    assert.equal(await verifySignature(c.body, c.headers, NOTIFY_SECRET), true, "the HMAC is still sent and still valid");
    assert.equal(c.body, '{"probe":true}', "the no-alert contract: a fixed, deliberately invalid body");
    assert.ok(!JSON.stringify(r).includes(CLIENT_SECRET) && !JSON.stringify(r).includes(CLIENT_ID));
  });

  test("no Access bindings: no Access headers are sent (unchanged behaviour for an app without Access)", async () => {
    const { seen, fetcher } = recorder(() => new Response(null, { status: 400 }));
    assert.deepEqual(await probeNotifyPath(probeEnv(), now(), fetcher), { result: "reachable", status: 400 });
    assert.equal(seen[0]!.headers.get("cf-access-client-id"), null);
    assert.equal(seen[0]!.headers.get("cf-access-client-secret"), null);
  });

  test("missing or invalid credentials: not_configured and NOTHING is sent", async () => {
    for (const over of [
      { OTP_NOTIFY_ACCESS_CLIENT_ID: ACCESS.OTP_NOTIFY_ACCESS_CLIENT_ID },
      { ...ACCESS, OTP_NOTIFY_ACCESS_CLIENT_SECRET: { get: async () => "" } },
      { ...ACCESS, OTP_NOTIFY_ACCESS_CLIENT_ID: { get: async () => "bad id with spaces 0123456789" } },
    ]) {
      const { seen, fetcher } = recorder(() => new Response(null, { status: 400 }));
      assert.deepEqual(await probeNotifyPath(probeEnv(over), now(), fetcher), { result: "not_configured" });
      assert.equal(seen.length, 0);
    }
  });

  test("an Access login redirect (not followed) is reported as blocked_by_cloudflare; any other redirect stays unexpected", async () => {
    const a = recorder(() => new Response(null, { status: 302, headers: { location: ACCESS_LOGIN } }));
    assert.deepEqual(await probeNotifyPath(probeEnv(ACCESS), now(), a.fetcher), { result: "blocked_by_cloudflare", status: 302 });
    const b = recorder(() => new Response(null, { status: 302, headers: { location: "https://elsewhere.test/" } }));
    assert.deepEqual(await probeNotifyPath(probeEnv(ACCESS), now(), b.fetcher), { result: "unexpected", status: 302 });
  });

  test("the app's own answers keep their meaning: bad signature 401, refusal 403, unconfigured 503; a 200 is never 'reachable'", async () => {
    const answer = (status: number) => recorder(() => new Response(null, { status })).fetcher;
    assert.deepEqual((await probeNotifyPath(probeEnv(ACCESS), now(), answer(401))).result, "secret_mismatch");
    assert.deepEqual((await probeNotifyPath(probeEnv(ACCESS), now(), answer(403))).result, "refused");
    assert.deepEqual((await probeNotifyPath(probeEnv(ACCESS), now(), answer(503))).result, "app_unconfigured");
    assert.deepEqual((await probeNotifyPath(probeEnv(ACCESS), now(), answer(200))).result, "unexpected");
  });

  test("a signature the app would reject is still caught: the wrong notify secret does not verify", async () => {
    const { seen, fetcher } = recorder(() => new Response(null, { status: 401 }));
    await probeNotifyPath(probeEnv(ACCESS), now(), fetcher);
    assert.equal(await verifySignature(seen[0]!.body, seen[0]!.headers, "whsec_" + btoa(String.fromCharCode(...new Uint8Array(32).fill(1)))), false);
  });
});

describe("real alert delivery uses the SAME authenticated transport", () => {
  const raise = async (d1: any, db: any) => { await configure(d1, 100); await seedJournal(d1, 75, "accepted", now() - 10); await evaluateAlerts(db, now()); };
  const rows = async (db: any) => (await db.prepare("SELECT delivered_at, attempts, last_status FROM otp_notification_outbox").bind().all()).results as Array<Record<string, any>>;

  test("delivery and the probe send the same Access headers, redirect mode and signature scheme", async () => {
    await withD1(async (d1, db) => {
      await raise(d1, db);
      const probe = recorder(() => new Response(null, { status: 400 }));
      await probeNotifyPath(envFor(d1, ACCESS as any), now(), probe.fetcher);
      const delivery = recorder(() => new Response("{}", { status: 200 }));
      assert.deepEqual(await deliverOutbox(envFor(d1, ACCESS as any), db, delivery.fetcher, now()), { delivered: 1, failed: 0 });
      const [p, d] = [probe.seen[0]!, delivery.seen[0]!];
      for (const h of ["cf-access-client-id", "cf-access-client-secret"]) assert.equal(d.headers.get(h), p.headers.get(h), h);
      assert.equal(d.redirect, "manual");
      assert.equal(await verifySignature(d.body, d.headers, NOTIFY_SECRET), true, "the HMAC is still required and valid on real alerts");
    });
  });

  test("an Access login redirect is a FAILED attempt (retried), never a delivered alert", async () => {
    await withD1(async (d1, db) => {
      await raise(d1, db);
      const { fetcher } = recorder(() => new Response("<html>login</html>", { status: 302, headers: { location: ACCESS_LOGIN } }));
      assert.deepEqual(await deliverOutbox(envFor(d1, ACCESS as any), db, fetcher, now()), { delivered: 0, failed: 1 });
      const r = (await rows(db))[0]!;
      assert.equal(r.delivered_at, null); assert.equal(r.attempts, 1); assert.equal(r.last_status, 302);
    });
  });

  test("invalid or half-configured credentials skip delivery: nothing is sent, no retry attempt is consumed, the event waits", async () => {
    await withD1(async (d1, db) => {
      await raise(d1, db);
      const { seen, fetcher } = recorder(() => new Response("{}", { status: 200 }));
      const r = await deliverOutbox(envFor(d1, { OTP_NOTIFY_ACCESS_CLIENT_ID: ACCESS.OTP_NOTIFY_ACCESS_CLIENT_ID } as any), db, fetcher, now());
      assert.deepEqual(r, { delivered: 0, failed: 0, skipped: "notify_access_credentials_invalid" });
      assert.equal(seen.length, 0);
      const row = (await rows(db))[0]!;
      assert.equal(row.delivered_at, null); assert.equal(row.attempts, 0);
      assert.deepEqual(await deliverOutbox(envFor(d1, ACCESS as any), db, fetcher, now()), { delivered: 1, failed: 0 }, "delivered once the credentials are fixed");
    });
  });

  test("the probe contract creates no alert and sends no message: it never touches the outbox, the journal or Meta", async () => {
    await withD1(async (d1, db) => {
      await configure(d1, 100);
      const { fetcher, seen } = recorder(() => new Response(null, { status: 400 }));
      await probeNotifyPath(envFor(d1, ACCESS as any), now(), fetcher);
      assert.equal(seen.length, 1);
      assert.equal(new URL(seen[0]!.url).hostname, "app.test", "only the pinned alert URL is ever called");
      assert.equal((await d1.prepare("SELECT COUNT(*) AS n FROM otp_notification_outbox").first<{ n: number }>())?.n, 0);
      assert.equal((await d1.prepare("SELECT COUNT(*) AS n FROM whatsapp_hook_events").first<{ n: number }>())?.n, 0);
    });
  });
});

describe("Acceptance-only probe diagnostics (who answered, never what was said)", () => {
  const acc = (over: Record<string, unknown> = {}) => probeEnv({ ...ACCESS, OTP_ENVIRONMENT: "acceptance", ...over });
  const run = async (res: () => Response, env = acc()) => {
    const lines: string[] = [];
    const out = await probeNotifyPath(env, now(), recorder(res).fetcher, (l) => lines.push(l));
    return { out, lines };
  };
  test("Cloudflare error 1042 is identified from the error page and reported as cloudflare_routing", async () => {
    const { out, lines } = await run(() => new Response("error code: 1042", { status: 404, headers: { "cf-ray": "9a1b2c3d4e5f6a7b-CDG" } }));
    assert.deepEqual(out, { result: "unexpected", status: 404 });
    assert.deepEqual(JSON.parse(lines[0]!), { event: "notify_probe_diag", status: 404, origin: "cloudflare_routing", cf_error_code: "1042", cf_ray: "9a1b2c3d4e5f6a7b-CDG" });
  });
  test("an Access HTML denial is edge_or_access_denial; the app's empty no-store answer is app", async () => {
    const a = await run(() => new Response("<html>Forbidden</html>", { status: 403 }));
    assert.equal(JSON.parse(a.lines[0]!).origin, "edge_or_access_denial");
    const b = await run(() => new Response(null, { status: 400, headers: { "cache-control": "no-store" } }));
    assert.deepEqual(JSON.parse(b.lines[0]!), { event: "notify_probe_diag", status: 400, origin: "app" });
  });
  test("an Access login redirect logs only the target HOST, never the URL or its token", async () => {
    const { lines } = await run(() => new Response(null, { status: 302, headers: { location: ACCESS_LOGIN + "&meta=SECRETTOKEN" } }));
    assert.deepEqual(JSON.parse(lines[0]!), { event: "notify_probe_diag", status: 302, origin: "access_login_redirect", location_host: "team-name.cloudflareaccess.com" });
    assert.ok(!lines[0]!.includes("SECRETTOKEN"));
  });
  test("a thrown fetch logs only the error class; nothing is logged outside Acceptance", async () => {
    const lines: string[] = [];
    const boom = (async () => { throw new TypeError("boom " + CLIENT_SECRET); }) as unknown as typeof fetch;
    assert.deepEqual(await probeNotifyPath(acc(), now(), boom, (l) => lines.push(l)), { result: "unreachable" });
    assert.deepEqual(JSON.parse(lines[0]!), { event: "notify_probe_diag", origin: "fetch_threw", error_name: "TypeError" });
    const other = await run(() => new Response(null, { status: 400 }), probeEnv({ ...ACCESS, OTP_ENVIRONMENT: "production" }));
    assert.deepEqual(other.lines, []);
  });
  test("no log line ever contains the Access credentials, the signature or the request body", async () => {
    const { lines } = await run(() => new Response("error code: 1042", { status: 404 }));
    for (const l of lines) for (const bad of [CLIENT_ID, CLIENT_SECRET, NOTIFY_SECRET, "webhook-signature", "{\"probe\":true}"]) assert.ok(!l.includes(bad), bad);
  });
});
