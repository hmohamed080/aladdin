// Real-HTTP regression test for the PostgREST pre-request hook (migration 20260930100005).
//
// WHY THIS EXISTS. pgTAP can only call the hook as a chosen role. In Production the hook
// (app.api_pre_request, migration 20260930100002) passed every SQL-level and warm-connection check
// but made service-role requests fail INTERMITTENTLY with "permission denied for schema app":
// PostgREST prepares the hook statement under whichever role first uses a pooled connection, and
// service_role has no USAGE on schema app. A request mix that warms connections as anon/authenticated
// first never shows it. So this test (1) drives a real PostgREST as anon, authenticated, admin and
// service_role through the exact app flows (installer phone pre-check, pending registration,
// installer sign-up chain, a suspended account), and (2) hammers cold connections during DDL and
// config reloads and requires ZERO non-200 responses. Against the old hook the cold-connection phase
// fails on ~5% of service-role requests.
//
//   supabase start && supabase db reset
//   node supabase/tests/pgrst_pre_request_hook_api_test.mjs                  # FIXED hook: every check must pass
//   HOOK_MODE=old node supabase/tests/pgrst_pre_request_hook_api_test.mjs    # CONTROL: points the hook back at
//        app.api_pre_request and REQUIRES the cold-connection phase to reproduce the Production failure
//        (exit 0 = the test can catch the bug; exit 1 = the control did not reproduce it, the test is not meaningful)
//   CYCLES=3 node ...                                                        # repeat the cold phase (stress run)
//
// MANUAL / ISOLATED-STACK CONTRACT TEST. It is not run by CI, and it COMMITS data (throw-away auth users, an
// audit trail) and reloads PostgREST config, so run it only against a stack you can rebuild. It refuses to run
// unless every setting is named EXPLICITLY, so it can never fall back to a shared stack or to a hosted project:
//   SB_URL            must be a loopback address (127.0.0.1 / localhost / [::1]) — never a hosted project
//   SB_ANON, SB_SERVICE, SB_JWT_SECRET   that stack's keys (`supabase status --workdir <isolated stack> -o env`)
//   SB_DB_CONTAINER   that stack's database container; the default shared `supabase_db_aladdin` is refused
// Tokens are minted locally (HS256); nothing is sent anywhere but the loopback URL. It creates a few throw-away
// auth users (they remain until the next `supabase db reset`: deleting a user that has audit rows is itself
// refused, see BL-035) and restores every setting it touches.
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";

const URL_ = process.env.SB_URL, ANON = process.env.SB_ANON, SERVICE = process.env.SB_SERVICE, SECRET = process.env.SB_JWT_SECRET;
const DB = process.env.SB_DB_CONTAINER;
if (!URL_ || !ANON || !SERVICE || !SECRET || !DB) {
  console.error("Refusing to run: set SB_URL, SB_ANON, SB_SERVICE, SB_JWT_SECRET and SB_DB_CONTAINER explicitly for an ISOLATED local stack.");
  process.exit(2);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/.test(URL_)) {
  console.error(`Refusing to run: SB_URL must be a loopback address, got ${URL_}. This test must never target a hosted project.`);
  process.exit(2);
}
if (DB === "supabase_db_aladdin") {
  console.error("Refusing to run against the shared local stack (supabase_db_aladdin). Use an isolated stack's database container.");
  process.exit(2);
}

const psql = (sql) => execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }).trim();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (sub) => { const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ aud: "authenticated", role: "authenticated", sub, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }); return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`; };
const rand = (lo, hi) => Math.floor(lo + Math.random() * (hi - lo));

let pass = 0, fail = 0;
const rec = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`); };
async function hit(method, path, { key = ANON, token, body, headers = {} } = {}) {
  const r = await fetch(`${URL_}${path}`, { method, headers: { apikey: key, Authorization: `Bearer ${token ?? key}`, "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}
const msg = (j) => (typeof j === "string" ? j : (j?.message ?? j?.msg ?? JSON.stringify(j))).slice(0, 90);

const ACTIVE = "11111111-1111-4111-8111-111111111111";
const VICTIM = "71000008-0000-4000-8000-000000000008";
const ADMIN = psql("select a.user_id from public.admin_role_assignments a join public.admin_roles r on r.id = a.role_id where a.is_active and r.key in ('administrator','super_admin') limit 1");
const readHook = () => psql("select substring(rolconfig::text from 'pgrst.db_pre_request=([^,}]+)') from pg_roles where rolname = 'authenticator'");
const sleep = (ms) => new Promise((q) => setTimeout(q, ms));
const OLD = process.env.HOOK_MODE === "old";
const CYCLES = Math.max(1, Number(process.env.CYCLES ?? 1));
const ORIGINAL_HOOK = readHook();
if (OLD) { psql("alter role authenticator set pgrst.db_pre_request = 'app.api_pre_request'; notify pgrst, 'reload config'"); await sleep(2500); }
const HOOK = readHook();
console.log(`# mode: ${OLD ? "OLD-HOOK CONTROL" : "FIXED hook"} | hook configured: ${HOOK || "<none>"} | cycles: ${CYCLES} | db container: ${DB}
`);
rec(OLD ? "control: hook is the original app.api_pre_request" : "hook is the dedicated entry point (not app.api_pre_request)", HOOK === (OLD ? "app.api_pre_request" : "pgrst_hooks.pre_request"), HOOK);

if (!OLD) { // the warm functional checks only make sense against the fixed hook; the control run needs the cold phase only
// ---------- 1. every request role through a real PostgREST
let r = await hit("GET", "/rest/v1/profile_public_directory?select=id&limit=1");
rec("anon: public directory read", r.status === 200, `HTTP ${r.status}`);
r = await hit("POST", "/rest/v1/rpc/admin_my_access", { body: {} });
rec("anon: admin RPC refused with a 4xx, never a 5xx", r.status >= 400 && r.status < 500, `HTTP ${r.status}`);
const tA = mint(ACTIVE);
r = await hit("GET", "/rest/v1/profiles?select=user_id&limit=1", { token: tA });
rec("authenticated: profile read under RLS", r.status === 200, `HTTP ${r.status}`);
r = await hit("POST", "/rest/v1/rpc/my_account_status", { token: tA, body: {} });
rec("authenticated: my_account_status", r.status === 200 && r.json?.suspended === false, `HTTP ${r.status}`);
const tAdm = mint(ADMIN);
r = await hit("POST", "/rest/v1/rpc/admin_my_access", { token: tAdm, body: {} });
rec("admin: admin_my_access", r.status === 200 && r.json?.is_staff === true, `HTTP ${r.status}`);
r = await hit("POST", "/rest/v1/rpc/admin_users_list", { token: tAdm, body: {} });
rec("admin: Users read RPC", r.status === 200 && typeof r.json?.total === "number", `HTTP ${r.status}`);
r = await hit("POST", "/rest/v1/rpc/admin_organizations_list", { token: tAdm, body: {} });
rec("admin: Organizations read RPC", r.status === 200 && typeof r.json?.total === "number", `HTTP ${r.status}`);
r = await hit("POST", "/rest/v1/rpc/admin_rbac_roles", { token: tAdm, body: {} });
rec("admin: RBAC read", r.status === 200 && Array.isArray(r.json), `HTTP ${r.status}`);
r = await hit("GET", "/rest/v1/profiles?select=user_id&phone_e164=eq.%2B200000000000&limit=1", { key: SERVICE });
rec("service_role: installer phone pre-check query", r.status === 200, `HTTP ${r.status} ${r.status === 200 ? "" : msg(r.json)}`);

const PENDING = psql("select id from public.users where status = 'pending_verification' order by id limit 1");
if (PENDING) {
  const tP = mint(PENDING);
  r = await hit("GET", "/rest/v1/profiles?select=user_id&limit=1", { token: tP });
  rec("authenticated pending user: normal read passes the hook", r.status === 200, `HTTP ${r.status}`);
  r = await hit("POST", "/rest/v1/rpc/my_account_status", { token: tP, body: {} });
  rec("authenticated pending user: my_account_status", r.status === 200 && r.json?.suspended === false, `HTTP ${r.status}`);
} else rec("authenticated pending user fixture exists", false, "no pending_verification user in the seed");

// ---------- 2. installer sign-up chain + pending registration (mirrors installer-phone-auth.ts / admin-server.ts)
const phone = `+2010${rand(10000000, 99999999)}`, alias = `${phone.slice(1)}@craftsman-login.aladdin.invalid`, pw = "Hook-Api-Test-Pw-9z!";
r = await hit("GET", `/rest/v1/profiles?select=user_id&phone_e164=eq.${encodeURIComponent(phone)}&limit=1`, { key: SERVICE });
rec("installer chain 1: pre-check (service_role)", r.status === 200 && r.json?.length === 0, `HTTP ${r.status}`);
r = await hit("POST", "/auth/v1/admin/users", { key: SERVICE, body: { email: alias, password: pw, email_confirm: true, user_metadata: { full_name: "Hook Api Test", locale: "ar" } } });
const newId = r.json?.id;
rec("installer chain 2: create Auth user (GoTrue admin API)", !!newId, `HTTP ${r.status}`);
if (newId) {
  r = await hit("POST", "/auth/v1/token?grant_type=password", { body: { email: alias, password: pw } });
  const tNew = r.json?.access_token;
  rec("installer chain 3: sign in with the phone alias", !!tNew, `HTTP ${r.status}`);
  if (tNew) {
    const step = async (name, rpc, body) => { const x = await hit("POST", `/rest/v1/rpc/${rpc}`, { token: tNew, body }); rec(`installer chain: ${name}`, x.status < 300, `HTTP ${x.status} ${x.status < 300 ? "" : msg(x.json)}`); return x; };
    await step("record_consent", "record_consent", { p_types: ["terms", "privacy", "pilot"], p_locale: "ar" });
    await step("onboarding_select_account_type(installer_technician)", "onboarding_select_account_type", { p_track: "professional", p_account_type: "installer_technician" });
    await step("profile_set_phone", "profile_set_phone", { p_country_iso2: "EG", p_national: phone.slice(3), p_e164: phone });
    await step("profile_set_username", "profile_set_username", { p_username: `hookapi${rand(10000, 99999)}` });
    const s = await step("my_registration_state", "my_registration_state", {});
    rec("installer chain: resolves to an app-access state", ["access_ready", "active_personal"].includes(s.json), JSON.stringify(s.json));
    const save = await hit("POST", "/rest/v1/rpc/pending_registration_save", { key: SERVICE, body: { p_user_id: newId, p_username: `hookpend${rand(10000, 99999)}`, p_audience_kind: "persona_type", p_audience_value: "engineer" } });
    rec("pending registration: staged (service_role)", save.status < 300, `HTTP ${save.status} ${save.status < 300 ? "" : msg(save.json)}`);
    const cons = await hit("POST", "/rest/v1/rpc/pending_registration_consume", { token: tNew, body: {} });
    rec("pending registration: consumed (authenticated)", cons.status === 200 && cons.json?.length === 1, `HTTP ${cons.status}`);
  }
}

// ---------- 3. suspended account (the hook's purpose) and the others unaffected
psql(`update public.users set status = 'suspended' where id = '${VICTIM}'`);
try {
  const tV = mint(VICTIM);
  r = await hit("GET", "/rest/v1/profiles?select=user_id&limit=1", { token: tV });
  rec("suspended: a normal request is refused ('account suspended')", r.status >= 400 && r.status < 500 && /account suspended/i.test(JSON.stringify(r.json)), `HTTP ${r.status}`);
  r = await hit("POST", "/rest/v1/rpc/my_account_status", { token: tV, body: {} });
  rec("suspended: my_account_status still answers", r.status === 200 && r.json?.suspended === true, `HTTP ${r.status}`);
  r = await hit("GET", "/rest/v1/profiles?select=user_id&phone_e164=eq.%2B200000000000&limit=1", { key: SERVICE });
  rec("suspended present: service_role unaffected", r.status === 200, `HTTP ${r.status}`);
} finally { psql(`update public.users set status = 'active' where id = '${VICTIM}'`); }
}

// ---------- 4. COLD-CONNECTION phase: the regression the warm checks above cannot see
async function coldPhase() {
  const results = []; let stop = false; const t0 = Date.now();
  const worker = async (name, key, path) => { while (!stop) { try { const x = await fetch(`${URL_}/rest/v1/${path}`, { headers: { apikey: key === tCold ? ANON : key, Authorization: `Bearer ${key}` } }); results.push({ name, status: x.status, body: x.status >= 400 ? (await x.text()).slice(0, 100) : "" }); } catch (e) { results.push({ name, status: "NETERR", body: String(e.message) }); } await new Promise((q) => setTimeout(q, 15)); } };
  const tCold = mint(ACTIVE);
  const ws = [worker("service_role", SERVICE, "profiles?select=user_id&limit=1"), worker("service_role", SERVICE, "profiles?select=user_id&limit=1"), worker("anon", ANON, "profile_public_directory?select=id&limit=1"), worker("authenticated", tCold, "profiles?select=user_id&limit=1")];
  await sleep(1200);
  psql("create table if not exists public.zz_hook_api_probe(a int); notify pgrst, 'reload schema'"); await sleep(2200);
  psql("alter table public.zz_hook_api_probe add column if not exists b int"); await sleep(2200);
  psql("alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config'"); await sleep(2200);
  psql(`alter role authenticator set pgrst.db_pre_request = '${HOOK.replace(/'/g, "''")}'; notify pgrst, 'reload config'`); await sleep(2200);
  psql("drop table if exists public.zz_hook_api_probe; notify pgrst, 'reload schema'"); await sleep(2200);
  stop = true; await Promise.all(ws);
  return results;
}
let total = 0, failed = [];
try {
  for (let c = 1; c <= CYCLES; c++) {
    const cold = await coldPhase();
    const bad = cold.filter((x) => x.status !== 200);
    total += cold.length; failed.push(...bad);
    const svcBad = bad.filter((x) => x.name === "service_role").length;
    console.log(`# cold cycle ${c}/${CYCLES}: ${cold.length} requests, ${bad.length} non-200 (${svcBad} service_role)${bad[0] ? `, first: ${bad[0].name} ${bad[0].status} ${bad[0].body}` : ""}`);
  }
} finally {
  psql(`alter role authenticator set pgrst.db_pre_request = '${ORIGINAL_HOOK.replace(/'/g, "''")}'; notify pgrst, 'reload config'`);
}
if (OLD) {
  const permission = failed.filter((x) => /permission denied for schema app/i.test(x.body));
  rec(`CONTROL: the old hook reproduces the Production failure (${failed.length}/${total} non-200, ${permission.length} 'permission denied for schema app')`, permission.length > 0, failed[0] ? `${failed[0].name} ${failed[0].status} ${failed[0].body}` : "no failure reproduced - the regression test is NOT meaningful");
  rec("CONTROL: every failure is service_role (anon/authenticated unaffected)", failed.every((x) => x.name === "service_role"));
} else {
  rec(`cold connections during DDL + config reloads: ${total} requests, 0 non-200 required`, failed.length === 0, failed.length ? `${failed.length} failed, first: ${failed[0].name} ${failed[0].status} ${failed[0].body}` : "");
}
rec("hook setting restored to what it was before the test", readHook() === ORIGINAL_HOOK, `${readHook()}`);

console.log(`
${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
