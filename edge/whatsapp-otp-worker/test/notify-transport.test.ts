import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isAccessRedirect, notifyTransportAvailable, postSignedNotify } from "../src/notify-transport.ts";
import { probeNotifyPath } from "../src/admin.ts";
import { deliverOutbox, evaluateAlerts } from "../src/maintenance.ts";
import { verifySignature } from "../src/signing.ts";
import { NOTIFY_SECRET, NOTIFY_URL, configure, envFor, seedJournal, withD1 } from "./d1.ts";

const now = () => Math.floor(Date.now() / 1000);
const ACCESS_LOGIN = "https://team-name.cloudflareaccess.com/cdn-cgi/access/login/app.test?kid=x";
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

type Seen = { url: string; headers: Headers; body: string; redirect?: string; viaBinding: boolean };
/** An explicit test double of the APP_NOTIFY Service Binding. It records the receiver so a detached `fetch` (which breaks a real binding) is caught. */
const binding = (answer: (req: Request) => Response | Promise<Response> = () => new Response(null, { status: 400 })) => {
  const seen: Seen[] = [];
  const b = {
    async fetch(this: unknown, url: string, init: RequestInit) {
      seen.push({ url, headers: new Headers(init.headers), body: String(init.body), redirect: init.redirect, viaBinding: this === b });
      return answer(new Request(url, init));
    },
  };
  return { seen, b };
};
/** A public fetcher that must NEVER be called: any call fails the test. */
const forbiddenFetch = (() => { throw new Error("global fetch must never be used for the alert callback"); }) as unknown as typeof fetch;
const probeEnv = (over: Record<string, unknown> = {}) =>
  ({ OTP_NOTIFY_URL: NOTIFY_URL, OTP_NOTIFY_SIGNING_SECRET: { get: async () => NOTIFY_SECRET }, OTP_ENVIRONMENT: "acceptance", ...over }) as any;

describe("private transport: availability and fail-closed behaviour", () => {
  test("only the Service Binding (or an explicit local rig) is a usable transport", () => {
    assert.equal(notifyTransportAvailable({ APP_NOTIFY: binding().b }), true);
    assert.equal(notifyTransportAvailable({ OTP_ENVIRONMENT: "local" }), true);
    for (const env of [{}, { OTP_ENVIRONMENT: "acceptance" }, { OTP_ENVIRONMENT: "production" }, { APP_NOTIFY: {} as any }, { APP_NOTIFY: undefined }]) {
      assert.equal(notifyTransportAvailable(env as any), false, JSON.stringify(Object.keys(env)));
    }
  });
  test("no binding in Acceptance or Production: NOTHING is sent and the public URL is never fetched", async () => {
    for (const environment of ["acceptance", "production", undefined]) {
      const sent = await postSignedNotify({ OTP_ENVIRONMENT: environment }, NOTIFY_URL, NOTIFY_SECRET, "ntf_x", now(), "{}", forbiddenFetch);
      assert.deepEqual(sent, { sent: false, reason: "transport_unavailable" }, String(environment));
    }
  });
  test("a local rig may use an explicit loopback fetcher, and only then", async () => {
    const calls: string[] = [];
    const local = (async (u: string) => { calls.push(u); return new Response(null, { status: 400 }); }) as unknown as typeof fetch;
    const sent = await postSignedNotify({ OTP_ENVIRONMENT: "local" }, "http://127.0.0.1:8788/api/internal/whatsapp-otp/notify", NOTIFY_SECRET, "ntf_x", now(), "{}", local);
    assert.equal(sent.sent, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(await postSignedNotify({ OTP_ENVIRONMENT: "local" }, NOTIFY_URL, NOTIFY_SECRET, "ntf_x", now(), "{}"), { sent: false, reason: "transport_unavailable" }, "local without a fetcher still sends nothing");
  });
  test("the binding wins over any supplied fetcher, and is invoked as a method (receiver preserved)", async () => {
    const { seen, b } = binding();
    const sent = await postSignedNotify({ APP_NOTIFY: b, OTP_ENVIRONMENT: "local" }, NOTIFY_URL, NOTIFY_SECRET, "ntf_x", now(), "{}", forbiddenFetch);
    assert.equal(sent.sent, true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.viaBinding, true);
  });
  test("an unusable signing secret sends nothing", async () => {
    const { seen, b } = binding();
    assert.deepEqual(await postSignedNotify({ APP_NOTIFY: b }, NOTIFY_URL, "", "ntf_x", now(), "{}"), { sent: false, reason: "unusable_secret" });
    assert.equal(seen.length, 0);
  });
  test("isAccessRedirect only recognises Cloudflare Access hosts", () => {
    assert.equal(isAccessRedirect(new Response(null, { status: 302, headers: { location: ACCESS_LOGIN } })), true);
    assert.equal(isAccessRedirect(new Response(null, { status: 302, headers: { location: "https://evilcloudflareaccess.com/x" } })), false);
    assert.equal(isAccessRedirect(new Response(null, { status: 400, headers: { location: ACCESS_LOGIN } })), false);
    assert.equal(isAccessRedirect(new Response(null, { status: 302 })), false);
  });
});

describe("connection probe through the private binding", () => {
  test("success: signed, no Access credential, no redirect following, fixed no-alert body, and a 400 means reachable", async () => {
    const { seen, b } = binding();
    const r = await probeNotifyPath(probeEnv({ APP_NOTIFY: b }), now(), forbiddenFetch);
    assert.deepEqual(r, { result: "reachable", status: 400 });
    assert.equal(seen.length, 1);
    const c = seen[0]!;
    assert.equal(c.viaBinding, true);
    assert.equal(c.url, NOTIFY_URL);
    assert.equal(c.redirect, "manual");
    assert.equal(c.headers.get("cf-access-client-id"), null, "no Access credential travels over the internal binding");
    assert.equal(c.headers.get("cf-access-client-secret"), null);
    assert.equal(await verifySignature(c.body, c.headers, NOTIFY_SECRET), true, "the HMAC is still sent and valid");
    assert.equal(c.body, '{"probe":true}');
  });
  test("failure: no binding means not_configured, nothing sent, no public fetch (Acceptance and Production)", async () => {
    for (const environment of ["acceptance", "production"]) {
      assert.deepEqual(await probeNotifyPath(probeEnv({ OTP_ENVIRONMENT: environment }), now(), forbiddenFetch), { result: "not_configured" }, environment);
    }
  });
  test("failure: a binding that throws (unavailable service) is unreachable, never a fallback", async () => {
    const down = { async fetch() { throw new TypeError("service unavailable"); } };
    assert.deepEqual(await probeNotifyPath(probeEnv({ APP_NOTIFY: down }), now(), forbiddenFetch), { result: "unreachable" });
  });
  test("the app's own answers keep their meaning: 401 signature, 403 refusal, 503 unconfigured; 200 is never reachable; 404 is unexpected", async () => {
    const answer = (status: number) => probeEnv({ APP_NOTIFY: binding(() => new Response(null, { status })).b });
    assert.equal((await probeNotifyPath(answer(401), now(), forbiddenFetch)).result, "secret_mismatch");
    assert.equal((await probeNotifyPath(answer(403), now(), forbiddenFetch)).result, "refused");
    assert.equal((await probeNotifyPath(answer(503), now(), forbiddenFetch)).result, "app_unconfigured");
    assert.equal((await probeNotifyPath(answer(200), now(), forbiddenFetch)).result, "unexpected");
    assert.equal((await probeNotifyPath(answer(404), now(), forbiddenFetch)).result, "unexpected");
  });
  test("signature rejection: a signature made with any other secret does not verify", async () => {
    const { seen, b } = binding(() => new Response(null, { status: 401 }));
    await probeNotifyPath(probeEnv({ APP_NOTIFY: b }), now(), forbiddenFetch);
    assert.equal(await verifySignature(seen[0]!.body, seen[0]!.headers, "whsec_" + btoa(String.fromCharCode(...new Uint8Array(32).fill(1)))), false);
  });
  test("invalid probe: the fixed body is deliberately not a valid alert, so a healthy app refuses it with 400 and records nothing", async () => {
    const { seen, b } = binding();
    await probeNotifyPath(probeEnv({ APP_NOTIFY: b }), now(), forbiddenFetch);
    const parsed = JSON.parse(seen[0]!.body);
    assert.deepEqual(Object.keys(parsed), ["probe"]);
    for (const required of ["event_key", "kind", "source_env", "occurred_at", "stats"]) assert.ok(!(required in parsed), required);
  });
});

describe("real alert delivery uses the SAME private transport", () => {
  const raise = async (d1: any, db: any) => { await configure(d1, 100); await seedJournal(d1, 75, "accepted", now() - 10); await evaluateAlerts(db, now()); };
  const rows = async (db: any) => (await db.prepare("SELECT delivered_at, attempts, last_status FROM otp_notification_outbox").bind().all()).results as Array<Record<string, any>>;

  test("delivery and the probe use the binding, the same redirect mode and signature scheme, and no Access headers; global fetch is never used", async () => {
    await withD1(async (d1, db) => {
      await raise(d1, db);
      const probe = binding();
      await probeNotifyPath(envFor(d1, { APP_NOTIFY: probe.b } as any), now(), forbiddenFetch);
      const delivery = binding(() => new Response("{}", { status: 200 }));
      assert.deepEqual(await deliverOutbox(envFor(d1, { APP_NOTIFY: delivery.b } as any), db, forbiddenFetch, now()), { delivered: 1, failed: 0 });
      const [p, d] = [probe.seen[0]!, delivery.seen[0]!];
      assert.equal(p.viaBinding && d.viaBinding, true);
      assert.equal(d.redirect, p.redirect);
      assert.equal(d.headers.get("cf-access-client-id"), null);
      assert.equal(new URL(d.url).pathname, new URL(p.url).pathname, "the same endpoint");
      assert.equal(await verifySignature(d.body, d.headers, NOTIFY_SECRET), true, "the HMAC is required and valid on real alerts");
      assert.equal(JSON.parse(d.body).source_env, "acceptance", "the source environment is stamped by this Worker's own environment");
    });
  });

  test("a redirect is a FAILED attempt (retried), never a delivered alert", async () => {
    await withD1(async (d1, db) => {
      await raise(d1, db);
      const { b } = binding(() => new Response("<html>login</html>", { status: 302, headers: { location: ACCESS_LOGIN } }));
      assert.deepEqual(await deliverOutbox(envFor(d1, { APP_NOTIFY: b } as any), db, forbiddenFetch, now()), { delivered: 0, failed: 1 });
      const r = (await rows(db))[0]!;
      assert.equal(r.delivered_at, null); assert.equal(r.attempts, 1); assert.equal(r.last_status, 302);
    });
  });

  test("binding failure: a throwing binding is a failed attempt with backoff; no binding skips delivery without consuming an attempt", async () => {
    await withD1(async (d1, db) => {
      await raise(d1, db);
      const t = now();
      const down = { async fetch() { throw new TypeError("service unavailable"); } };
      assert.deepEqual(await deliverOutbox(envFor(d1, { APP_NOTIFY: down } as any), db, forbiddenFetch, t), { delivered: 0, failed: 1 });
      assert.equal((await rows(db))[0]!.attempts, 1);
      await d1.prepare("UPDATE otp_notification_outbox SET attempts = 0, next_attempt_at = 0").run();
      assert.deepEqual(await deliverOutbox(envFor(d1, {}), db, forbiddenFetch, t + 10), { delivered: 0, failed: 0, skipped: "notify_transport_unavailable" });
      assert.equal((await rows(db))[0]!.attempts, 0, "waits in the outbox for the binding to be fixed");
      const ok = binding(() => new Response("{}", { status: 200 }));
      assert.deepEqual(await deliverOutbox(envFor(d1, { APP_NOTIFY: ok.b } as any), db, forbiddenFetch, t + 20), { delivered: 1, failed: 0 }, "delivered once the binding exists");
    });
  });

  test("the probe creates no alert and sends no message: it never touches the outbox, the journal or Meta", async () => {
    await withD1(async (d1) => {
      await configure(d1, 100);
      const { seen, b } = binding();
      await probeNotifyPath(envFor(d1, { APP_NOTIFY: b } as any), now(), forbiddenFetch);
      assert.equal(seen.length, 1);
      assert.equal((await d1.prepare("SELECT COUNT(*) AS n FROM otp_notification_outbox").first<{ n: number }>())?.n, 0);
      assert.equal((await d1.prepare("SELECT COUNT(*) AS n FROM whatsapp_hook_events").first<{ n: number }>())?.n, 0);
    });
  });
});

describe("environment isolation", () => {
  test("a Production Worker stamps source_env=production on its alerts, so the Acceptance app (which expects acceptance) refuses them", async () => {
    await withD1(async (d1, db) => {
      await configure(d1, 100); await seedJournal(d1, 75, "accepted", now() - 10); await evaluateAlerts(db, now());
      const { seen, b } = binding(() => new Response("{}", { status: 200 }));
      await deliverOutbox(envFor(d1, { APP_NOTIFY: b, OTP_ENVIRONMENT: "production" } as any), db, forbiddenFetch, now());
      assert.equal(JSON.parse(seen[0]!.body).source_env, "production");
    });
  });
  test("the Acceptance config binds ONLY the Acceptance frontend, never a production service", () => {
    const cfg = JSON.parse(read("../wrangler.jsonc"));
    assert.deepEqual(cfg.services, [{ binding: "APP_NOTIFY", service: "aladdin-frontend-preview" }]);
    assert.ok(!JSON.stringify(cfg.services).includes("production"));
  });
});

describe("bidirectional bindings: no recursion, no loops (regression)", () => {
  const frontendCfg = JSON.parse(read("../../../frontend/wrangler.jsonc").replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));
  const otpCfg = JSON.parse(read("../wrangler.jsonc"));

  test("the two directions are distinct, mirror images, and neither Worker binds itself", () => {
    const toOtp = frontendCfg.env.preview.services.filter((s: any) => s.service === otpCfg.name);
    assert.equal(toOtp.length, 1);
    assert.equal(toOtp[0].binding, "OTP_WORKER");
    const toApp = otpCfg.services.filter((s: any) => s.service === frontendCfg.env.preview.name);
    assert.equal(toApp.length, 1);
    assert.notEqual(toApp[0].binding, toOtp[0].binding);
    assert.ok(otpCfg.services.every((s: any) => s.service !== otpCfg.name), "the OTP Worker never binds itself");
  });

  test("the app's notify handler never calls back into the OTP Worker (the chain ends at Supabase)", () => {
    for (const rel of ["../../../frontend/src/app/api/internal/whatsapp-otp/notify/route.ts", "../../../frontend/src/server/whatsapp-otp/notify.ts"]) {
      const src = read(rel);
      assert.ok(!/OTP_WORKER|worker-admin|worker-client|getCloudflareContext|service binding/i.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), `${rel} must not reach the OTP Worker`);
    }
  });

  test("the OTP Worker never reads the frontend's binding and never calls the app anywhere but the pinned alert URL", () => {
    for (const f of ["../src/index.ts", "../src/admin.ts", "../src/maintenance.ts", "../src/notify-transport.ts"]) {
      assert.ok(!/OTP_WORKER/.test(read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), `${f} must not use the frontend→OTP binding`);
    }
    const callers = ["../src/admin.ts", "../src/maintenance.ts"].map((f) => read(f)).join("\n");
    assert.ok(!/OTP_NOTIFY_URL\s*[,)]\s*\{?\s*method|fetch\(\s*env\.OTP_NOTIFY_URL/.test(callers), "no direct fetch of the notify URL outside the shared transport");
  });

  test("the app's middleware matcher does not exclude the internal notify route, and the route authenticates by signature, not by session", () => {
    const mw = read("../../../frontend/src/middleware.ts");
    assert.ok(!/api\/internal/.test(mw.slice(mw.indexOf("export const config"))), "no special-casing of the internal route in the matcher");
    const gate = read("../../../frontend/src/server/auth/request-gate.ts");
    const authRequired = gate.slice(gate.indexOf("export function isAuthRequiredPath"), gate.indexOf("export function isProductSurfacePath"));
    assert.ok(!authRequired.includes('"/api'), "the middleware does not redirect /api/* to sign-in, so a session-less binding call reaches the route");
    const handler = read("../../../frontend/src/server/whatsapp-otp/notify.ts");
    assert.match(handler, /verifyBody|verifySignature|webhook-signature/i, "the handler verifies the HMAC itself");
  });

  test("the probe makes exactly ONE downstream call (the chain frontend -> OTP Worker -> frontend is two hops, far below the 16-hop loop limit)", async () => {
    const { seen, b } = binding();
    await probeNotifyPath(probeEnv({ APP_NOTIFY: b }), now(), forbiddenFetch);
    assert.equal(seen.length, 1);
  });
});

describe("Acceptance-only probe diagnostics (who answered, never what was said)", () => {
  const run = async (res: () => Response, env: Record<string, unknown> = {}) => {
    const lines: string[] = [];
    const out = await probeNotifyPath(probeEnv({ APP_NOTIFY: binding(res).b, ...env }), now(), forbiddenFetch, (l) => lines.push(l));
    return { out, lines };
  };
  test("Cloudflare error 1042 stays identifiable from the error page (the root cause of the A7 failure)", async () => {
    const { out, lines } = await run(() => new Response("error code: 1042", { status: 404, headers: { "cf-ray": "9a1b2c3d4e5f6a7b-CDG" } }));
    assert.deepEqual(out, { result: "unexpected", status: 404 });
    assert.deepEqual(JSON.parse(lines[0]!), { event: "notify_probe_diag", status: 404, origin: "cloudflare_routing", cf_error_code: "1042", cf_ray: "9a1b2c3d4e5f6a7b-CDG" });
  });
  test("a healthy 400 logs NOTHING (no verbose diagnostics in steady state)", async () => {
    const { lines } = await run(() => new Response(null, { status: 400, headers: { "cache-control": "no-store" } }));
    assert.deepEqual(lines, []);
  });
  test("an Access HTML denial is edge_or_access_denial; an Access redirect logs only the HOST, never the URL or token", async () => {
    const a = await run(() => new Response("<html>Forbidden</html>", { status: 403 }));
    assert.equal(JSON.parse(a.lines[0]!).origin, "edge_or_access_denial");
    const r = await run(() => new Response(null, { status: 302, headers: { location: ACCESS_LOGIN + "&meta=SECRETTOKEN" } }));
    assert.deepEqual(JSON.parse(r.lines[0]!), { event: "notify_probe_diag", status: 302, origin: "access_login_redirect", location_host: "team-name.cloudflareaccess.com" });
    assert.ok(!r.lines[0]!.includes("SECRETTOKEN"));
  });
  test("a thrown binding logs only the error class; nothing is logged outside Acceptance", async () => {
    const lines: string[] = [];
    const boom = { async fetch() { throw new TypeError("boom whsec_secret"); } };
    assert.deepEqual(await probeNotifyPath(probeEnv({ APP_NOTIFY: boom }), now(), forbiddenFetch, (l) => lines.push(l)), { result: "unreachable" });
    assert.deepEqual(JSON.parse(lines[0]!), { event: "notify_probe_diag", origin: "fetch_threw", error_name: "TypeError" });
    const other = await run(() => new Response("error code: 1042", { status: 404 }), { OTP_ENVIRONMENT: "production" });
    assert.deepEqual(other.lines, []);
  });
  test("no log line ever contains the signing secret, the signature or the request body", async () => {
    const { lines } = await run(() => new Response("error code: 1042", { status: 404 }));
    for (const l of lines) for (const bad of [NOTIFY_SECRET, "webhook-signature", '{"probe":true}']) assert.ok(!l.includes(bad), bad);
  });
});
