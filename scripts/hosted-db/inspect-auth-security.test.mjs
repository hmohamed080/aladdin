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

// ---- R2 additions: migration history, permission diff, legacy table, Worker switches ------------------------------------------------------
import { PERMISSION_INVENTORY_SQL, contractVersionFor, migrationDiff, normalizeSignature, permissionDiff, repoMigrationVersions, workerSettingsSummary } from "./inspect-auth-security.mjs";

describe("R2: migration history difference", () => {
  const repo = ["20261028090001", "20261029090001", "20261030090001", "20261031090001"];
  it("reports which repo migrations are applied, missing, or unknown to the repo, and the R2 markers", () => {
    const d = migrationDiff([{ version: "20261028090001" }, { version: "20261029090001" }, { version: "20261015000000" }], repo);
    assert.deepEqual(d.applied_not_in_repo, ["20261015000000"]);
    assert.deepEqual(d.repo_not_applied, ["20261030090001", "20261031090001"]);
    assert.equal(d.r2_markers["20261028090001"], true);
    assert.equal(d.r2_markers["20261031090001"], false);
    assert.equal(d.latest_applied, "20261029090001");
  });
  it("sees this checkout's migrations, including the R2 drop migration", () => assert.ok(repoMigrationVersions().includes("20261031090001")));
});

describe("R2: permission inventory against the reviewed contract", () => {
  it("is a single read-only SELECT with no SET line", () => { assert.doesNotThrow(() => assertReadOnlySql(PERMISSION_INVENTORY_SQL)); assert.ok(!/set local/i.test(PERMISSION_INVENTORY_SQL)); });
  it("qualifies unqualified signatures with public and leaves app.* alone", () => {
    assert.equal(normalizeSignature("fn(uuid)"), "public.fn(uuid)");
    assert.equal(normalizeSignature("app.fn(uuid)"), "app.fn(uuid)");
  });
  it("picks the newest contract at or below the hosted version", () => assert.equal(contractVersionFor("20261029090009", ["20261026090001", "20261029090002", "20261030090001"]), "20261029090002"));
  const fn = (signature, anon) => ({ signature, kind: "f", owner: "postgres", definer: true, config: ["search_path="], grants: [{ role: "service_role", grantable: false }], effective: { anon, authenticated: false, service_role: true } });
  const contract = { version: "20261030090002", functions: [fn("public.a()", false), fn("public.b()", false)] };
  it("flags an extra function, a missing one and a widened EXECUTE right, and stays empty when identical", () => {
    assert.equal(permissionDiff([fn("a()", false), fn("b()", false)], contract).differences, 0);
    const d = permissionDiff([fn("a()", true), fn("c()", false)], contract);
    const issues = d.listed.map((x) => `${x.fn}:${x.issue}`);
    assert.ok(issues.includes("public.a():effective differs"));
    assert.ok(issues.includes("public.c():not in the reviewed contract"));
    assert.ok(issues.includes("public.b():in the reviewed contract but missing on the hosted database"));
  });
});

describe("R2: Worker settings", () => {
  it("reports binding names, shows ONLY allow-listed non-secret switch values, and flags legacy app WhatsApp bindings", () => {
    const s = workerSettingsSummary({ bindings: [
      { type: "secret_text", name: "PHONE_OTP_HMAC_KEYS" },
      { type: "plain_text", name: "PHONE_OTP_DELIVERY", text: "off" },
      { type: "plain_text", name: "PHONE_SIGNUP_VERIFICATION_ENABLED", text: "false" },
      { type: "plain_text", name: "SOME_OTHER_VALUE", text: "must-not-appear-in-report" },
      { type: "plain_text", name: "WHATSAPP_OTP_TEMPLATE", text: "aladdin_login_code" },
    ] });
    assert.deepEqual(s.switches, { PHONE_OTP_DELIVERY: "off", PHONE_SIGNUP_VERIFICATION_ENABLED: "false" });
    assert.deepEqual(s.legacy_app_whatsapp_bindings_present, ["WHATSAPP_OTP_TEMPLATE"]);
    assert.ok(!JSON.stringify(s).includes("must-not-appear-in-report"));
    assert.ok(!JSON.stringify(s).includes("aladdin_login_code"));
  });
  it("the guard allows GET .../settings and still refuses any write to it", async () => {
    const gf = makeGuardedFetch(async () => new Response("{}", { status: 200 }), { supabase: TOKEN, cloudflare: CF_TOKEN });
    assert.equal((await gf("GET", `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/aladdin-web/settings`)).status, 200);
    await assert.rejects(() => gf("PATCH", `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/aladdin-web/settings`, {}), /REFUSED/);
    await assert.rejects(() => gf("PUT", `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/aladdin-web/secrets`, {}), /REFUSED/);
  });
});
