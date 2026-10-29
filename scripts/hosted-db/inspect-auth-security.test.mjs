// node --test scripts/hosted-db/inspect-auth-security.test.mjs  -- no network, no hosted access: everything runs against a mocked fetch.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALLOWED_AUTH_KEYS, DISPUTED_FUNCTIONS, QUERIES, assertReadOnlySql, interpretAuth, main, makeGuardedFetch, redactAuthConfig, workerSecretPresence,
} from "./inspect-auth-security.mjs";

const REF = "abcdefghijklmnopqrst";
const TOKEN = "sbp_TESTTOKEN_do_not_print_0123456789";
const CF_TOKEN = "cf_TESTTOKEN_do_not_print_0123456789";
const ACCOUNT = "a".repeat(32);

describe("read-only SQL gate", () => {
  it("accepts every built-in query", () => { for (const q of Object.values(QUERIES)) assert.doesNotThrow(() => assertReadOnlySql(q)); });
  it("rejects writes, DDL, grants, multiple statements, comments and non-selects", () => {
    for (const bad of ["update public.profiles set phone_verified_at = now()", "select 1; select 2", "select 1 -- x", "select 1 /* x */", "delete from auth.users",
      "with x as (select 1) insert into t select * from x", "grant execute on function f() to anon", "select pg_sleep(1); drop table t", "create table t(a int)", "do $$ begin end $$", "set role postgres", "SELECT 1 FROM t FOR UPDATE; update t set a=1"])
      assert.throws(() => assertReadOnlySql(bad), undefined, bad);
  });
});

describe("network guard", () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response("[]", { status: 200 }); };
  const gf = makeGuardedFetch(fetchImpl, { supabase: TOKEN, cloudflare: CF_TOKEN });
  it("allows exactly the three read-only call shapes", async () => {
    assert.equal((await gf("GET", `https://api.supabase.com/v1/projects/${REF}/config/auth`)).status, 200);
    assert.equal((await gf("POST", `https://api.supabase.com/v1/projects/${REF}/database/query/read-only`, { query: "select 1" })).status, 200);
    assert.equal((await gf("GET", `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/aladdin-web/secrets`)).status, 200);
  });
  it("refuses every other method and URL before any request leaves the process", async () => {
    const before = calls.length;
    for (const [m, u, b] of [
      ["PATCH", `https://api.supabase.com/v1/projects/${REF}/config/auth`, {}],
      ["PUT", `https://api.supabase.com/v1/projects/${REF}/config/auth`, {}],
      ["DELETE", `https://api.supabase.com/v1/projects/${REF}`, undefined],
      ["POST", `https://api.supabase.com/v1/projects/${REF}/database/query`, { query: "select 1" }],
      ["POST", `https://api.supabase.com/v1/projects/${REF}/database/query/read-only`, { query: "update t set a = 1" }],
      ["GET", `https://api.supabase.com/v1/projects/${REF}/api-keys`, undefined],
      ["GET", `https://api.supabase.com/v1/projects/${REF}/secrets`, undefined],
      ["PUT", `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/x/secrets`, {}],
      ["GET", "https://example.com/", undefined],
    ]) await assert.rejects(() => gf(m, u, b), /REFUSED|inspection SQL/, `${m} ${u}`);
    assert.equal(calls.length, before);
  });
  it("sends tokens only as bearer headers, never in a URL or body", () => {
    for (const c of calls) { assert.ok(!c.url.includes(TOKEN) && !c.url.includes(CF_TOKEN)); assert.ok(!String(c.init.body ?? "").includes(TOKEN)); }
  });
});

describe("redaction", () => {
  it("copies only allow-listed, non-secret keys", () => {
    const raw = { mailer_autoconfirm: false, disable_signup: false, security_captcha_enabled: true, security_captcha_provider: "turnstile", security_captcha_secret: "SECRET-1",
      smtp_pass: "SECRET-2", smtp_user: "u", jwt_secret: "SECRET-3", external_google_secret: "SECRET-4", hook_send_sms_secrets: "SECRET-5", site_url: "https://x", sms_twilio_auth_token: "SECRET-6", sms_provider: "twilio" };
    const out = redactAuthConfig(raw);
    assert.deepEqual(Object.keys(out).sort(), ["disable_signup", "mailer_autoconfirm", "security_captcha_enabled", "security_captcha_provider", "sms_provider"]);
    assert.ok(!JSON.stringify(out).includes("SECRET"));
  });
  it("no allow-listed key looks like a secret", () => {
    const secretish = /(secret|token|password|jwt|credential|private|signing)/i;
    for (const k of ALLOWED_AUTH_KEYS) assert.ok(!secretish.test(k), k);
  });
  it("worker secrets are reported as presence booleans only", () => {
    const p = workerSecretPresence([{ name: "WHATSAPP_ACCESS_TOKEN", type: "secret_text" }, { name: "OTHER" }]);
    assert.equal(p.WHATSAPP_ACCESS_TOKEN, true);
    assert.equal(p.WHATSAPP_PHONE_NUMBER_ID, false);
    assert.ok(!JSON.stringify(p).includes("secret_text"));
  });
  it("interprets the questions that were asked", () => {
    const i = interpretAuth({ mailer_autoconfirm: false, disable_signup: false, security_captcha_enabled: false, external_phone_enabled: false, hook_send_sms_enabled: false, mfa_phone_enroll_enabled: false });
    assert.deepEqual([i.email_confirmation_required, i.public_signup_open, i.captcha_protection_on, i.phone_provider_enabled, i.send_sms_hook_enabled, i.phone_mfa_enabled], [true, true, false, false, false, false]);
    assert.equal(interpretAuth({}).email_confirmation_required, "unknown");
  });
});

describe("main", () => {
  it("with no token it calls nothing and says exactly what is needed (exit 3)", async () => {
    let called = 0; const lines = [];
    const code = await main(["--env", "both"], {}, async () => { called += 1; return new Response("{}"); }, (l) => lines.push(l));
    assert.equal(code, 3);
    assert.equal(called, 0);
    assert.match(lines.join("\n"), /SUPABASE_ACCESS_TOKEN/);
    assert.match(lines.join("\n"), /SUPABASE_REF_ACCEPTANCE/);
  });
  it("end to end against a mock: prints a report, never a token or a secret", async () => {
    const lines = [];
    const fetchImpl = async (url) => {
      if (url.endsWith("/config/auth")) return new Response(JSON.stringify({ mailer_autoconfirm: false, disable_signup: false, security_captcha_enabled: true, security_captcha_provider: "turnstile", security_captcha_secret: "LEAK-ME", external_phone_enabled: false }), { status: 200 });
      if (url.endsWith("/secrets")) return new Response(JSON.stringify({ result: [{ name: "WHATSAPP_ACCESS_TOKEN" }] }), { status: 200 });
      return new Response(JSON.stringify([{ fn: "public.x()", service_role_exec: true, anon_exec: false, authenticated_exec: true }]), { status: 200 });
    };
    const code = await main(["--env", "acceptance"], { SUPABASE_ACCESS_TOKEN: TOKEN, SUPABASE_REF_ACCEPTANCE: REF, CLOUDFLARE_API_TOKEN: CF_TOKEN, CF_ACCOUNT_ID: ACCOUNT, CF_WORKER_ACCEPTANCE: "aladdin-web" }, fetchImpl, (l) => lines.push(l));
    const out = lines.join("\n");
    assert.equal(code, 0);
    for (const secret of [TOKEN, CF_TOKEN, "LEAK-ME", REF]) assert.ok(!out.includes(secret), `leaked ${secret.slice(0, 6)}`);
    const report = JSON.parse(out).reports[0];
    assert.equal(report.auth_interpretation.email_confirmation_required, true);
    assert.equal(report.whatsapp_delivery_secrets.WHATSAPP_ACCESS_TOKEN, true);
    assert.equal(report.disputed_functions_summary.with_service_role_execute, 1);
    assert.equal(report.project_ref_suffix, REF.slice(-4));
  });
  it("lists the 13 disputed functions exactly", () => { assert.equal(DISPUTED_FUNCTIONS.length, 13); assert.equal(new Set(DISPUTED_FUNCTIONS).size, 13); });
});
