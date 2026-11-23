// Local-only sweep of every registration path through the REAL PostgREST with REAL GoTrue tokens (ADR-0031).
//
// Proves two things for the registration gate (20261122090002_registration_gate_central.sql):
//   1. every step the app takes while a registration is unfinished passes the gate (never 403 `registration_incomplete`),
//      including resuming an old registration and a registration that failed half-way;
//   2. while the registration is unfinished, state-changing calls outside those steps ARE refused.
//
// Not part of CI (needs the local stack). Run:  node supabase/tests/registration_gate_paths.local.mjs
// Env (defaults match the local stack of this repo):  API_URL, PUBLISHABLE_KEY (auto-read from the kong container), DB_CONTAINER.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const DB = process.env.DB_CONTAINER ?? "supabase_db_aladdin_marketview";
const KONG = process.env.KONG_CONTAINER ?? DB.replace("supabase_db_", "supabase_kong_");
const API = process.env.API_URL ?? "http://127.0.0.1:48321";
const sh = (cmd, args, input) => execFileSync(cmd, args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
const sql = (q) => sh("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-tA"], q).trim();
const KEY =
  process.env.PUBLISHABLE_KEY ?? (sh("docker", ["exec", KONG, "sh", "-c", "cat /home/kong/kong.yml"]).match(/sb_publishable_[A-Za-z0-9_-]+/) ?? [])[0];
if (!KEY) throw new Error("no publishable key found");
const PW = "Gate-Probe-12345";
const CONSENT = ["terms", "privacy", "pilot"];

const created = [];
async function makeUser(tag, { confirmed = true } = {}) {
  const id = randomUUID();
  const email = `gate-${tag}-${id.slice(0, 8)}@probe.test`;
  sql(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
       values ('${id}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','${email}', crypt('${PW}', gen_salt('bf')), ${confirmed ? "now()" : "null"},
       '{"provider":"email","providers":["email"]}', '{"full_name":"Gate ${tag}"}', now(), now(), '', '', '', '')`);
  created.push(id);
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ email, password: PW }),
  });
  const body = await r.json();
  if (!body.access_token) throw new Error(`no token for ${tag}: ${JSON.stringify(body).slice(0, 120)}`);
  return { id, token: body.access_token };
}
async function call(u, method, path, body, extra = {}) {
  const r = await fetch(`${API}/rest/v1${path}`, {
    method, headers: { apikey: KEY, authorization: `Bearer ${u.token}`, "content-type": "application/json", ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: r.status, json, gate: json?.hint === "registration_incomplete" };
}
const rpc = (u, fn, args = {}) => call(u, "POST", `/rpc/${fn}`, args);
const state = (u) => sql(`select app.admin_user_registration_state('${u.id}')`);
// The legacy shape: a row from before onboarding existed, with no onboarding row and no consent.
const makeLegacy = (u) => sql(`delete from public.consent_receipts where user_id='${u.id}'; delete from public.onboarding_progress where user_id='${u.id}'; update public.users set status='pending_verification' where id='${u.id}'`);

let failures = 0;
const check = (ok, label, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`); if (!ok) failures++; };
// A step "passes the gate" when it is not refused by the registration gate; the function itself may still answer with its own error.
const passes = (r, label) => check(!r.gate, `gate lets through: ${label}`, `(HTTP ${r.status}${r.json?.message ? " " + String(r.json.message).slice(0, 60) : ""})`);
const refused = (r, label) => check(r.gate && r.status === 403, `gate refuses: ${label}`, `(HTTP ${r.status})`);

async function negativeControls(u, tag) {
  refused(await call(u, "POST", "/organizations", { name: "x", org_type: "showroom_dealer", created_by: u.id }), `${tag}: direct organization INSERT`);
  refused(await rpc(u, "avatar_request_upload", { p_content_type: "image/jpeg" }), `${tag}: avatar_request_upload`);
  refused(await call(u, "PATCH", `/profiles?user_id=eq.${u.id}`, { headline: "x" }), `${tag}: direct profile UPDATE`);
  refused(await call(u, "POST", "/rpc/graphql", { query: "{ __typename }" }, { "content-profile": "graphql_public" }), `${tag}: graphql_public RPC (pg_graphql)`);
}
async function readsStillWork(u, tag) {
  const r = await call(u, "GET", `/profiles?select=user_id&user_id=eq.${u.id}`);
  check(r.status === 200, `${tag}: reading its own profile still works`, `(HTTP ${r.status})`);
  const s = await rpc(u, "my_registration_state");
  check(s.status === 200, `${tag}: my_registration_state still works`, `(${JSON.stringify(s.json)})`);
}
const ready = (u, tag) => check(["access_ready", "active_personal"].includes(state(u)), `${tag}: ends registered`, `(state ${state(u)})`);

try {
  console.log("== S1 email sign-up, professional (verify -> consent -> name -> pending -> type)");
  { const u = await makeUser("s1"); check(state(u) === "consent_pending", "S1 starts consent_pending", state(u));
    await negativeControls(u, "S1"); await readsStillWork(u, "S1");
    passes(await rpc(u, "record_consent", { p_types: CONSENT, p_locale: "en" }), "record_consent");
    passes(await rpc(u, "profile_set_display_name", { p_display_name: "Gate One" }), "profile_set_display_name");
    passes(await rpc(u, "pending_registration_consume"), "pending_registration_consume");
    check(state(u) === "account_type_pending", "S1 now account_type_pending", state(u));
    await negativeControls(u, "S1 (type pending)");
    passes(await rpc(u, "onboarding_select_account_type", { p_track: "professional", p_account_type: "installer_technician" }), "onboarding_select_account_type");
    ready(u, "S1"); }

  console.log("== S2 OAuth / business track (consent -> type -> name)");
  { const u = await makeUser("s2");
    passes(await rpc(u, "record_consent", { p_types: CONSENT, p_locale: "ar" }), "record_consent");
    passes(await rpc(u, "onboarding_select_account_type", { p_track: "business", p_account_type: "showroom_dealer" }), "onboarding_select_account_type (business)");
    passes(await rpc(u, "profile_set_display_name", { p_display_name: "Gate Two" }), "profile_set_display_name");
    ready(u, "S2"); }

  console.log("== S3 phone sign-up (consent -> type -> phone -> name)");
  { const u = await makeUser("s3");
    passes(await rpc(u, "record_consent", { p_types: CONSENT, p_locale: "en" }), "record_consent");
    passes(await rpc(u, "onboarding_select_account_type", { p_track: "professional", p_account_type: "sales" }), "onboarding_select_account_type (sales)");
    passes(await rpc(u, "profile_set_phone", { p_country_iso2: "EG", p_national: "1068123456", p_e164: "+201068123456" }), "profile_set_phone");
    passes(await rpc(u, "profile_set_display_name", { p_display_name: "Gate Three" }), "profile_set_display_name");
    ready(u, "S3"); }

  console.log("== S4 resuming an OLD registration (legacy row: no onboarding row, no consent)");
  { const u = await makeUser("s4"); makeLegacy(u);
    check(state(u) === "consent_pending", "S4 legacy account reads consent_pending", state(u));
    await negativeControls(u, "S4");
    passes(await rpc(u, "record_consent", { p_types: CONSENT, p_locale: "en" }), "record_consent");
    passes(await rpc(u, "onboarding_select_account_type", { p_track: "professional", p_account_type: "installer_technician" }), "onboarding_select_account_type");
    ready(u, "S4"); }

  console.log("== S5 registration that failed half-way (consent saved, account type missing)");
  { const u = await makeUser("s5");
    passes(await rpc(u, "record_consent", { p_types: CONSENT, p_locale: "en" }), "record_consent");
    check(state(u) === "account_type_pending", "S5 stopped at account_type_pending", state(u));
    await negativeControls(u, "S5");
    passes(await rpc(u, "onboarding_select_account_type", { p_track: "business", p_account_type: "supplier" }), "onboarding_select_account_type (resume)");
    ready(u, "S5"); }

  console.log("== S6 account type saved but consent missing (type step ran, consent write failed)");
  { const u = await makeUser("s6");
    sql(`insert into public.onboarding_progress (user_id, account_type_completed_at) values ('${u.id}', now()) on conflict (user_id) do update set account_type_completed_at = now()`);
    check(state(u) === "consent_pending", "S6 reads consent_pending", state(u));
    passes(await rpc(u, "record_consent", { p_types: CONSENT, p_locale: "en" }), "record_consent");
    ready(u, "S6"); }

  console.log("== S7 stale consent version (documents changed after the person consented)");
  { const u = await makeUser("s7");
    sql(`insert into public.consent_receipts (user_id, consent_type, version, locale) select '${u.id}', t, 'v0-old', 'en' from unnest(array['terms','privacy','pilot']::public.consent_type[]) t;
         insert into public.onboarding_progress (user_id, account_type_completed_at) values ('${u.id}', now()) on conflict (user_id) do update set account_type_completed_at = now()`);
    check(state(u) === "consent_pending", "S7 stale consent reads consent_pending", state(u));
    passes(await rpc(u, "record_consent", { p_types: CONSENT, p_locale: "en" }), "record_consent (re-consent)");
    ready(u, "S7"); }

  console.log("== S8 invitation acceptance (staff and member) while registration is unfinished");
  { const u = await makeUser("s8");
    passes(await rpc(u, "record_consent", { p_types: CONSENT, p_locale: "en" }), "record_consent");
    passes(await rpc(u, "profile_set_display_name", { p_display_name: "Gate Eight" }), "profile_set_display_name");
    passes(await rpc(u, "staff_invitation_accept", { p_token: "x".repeat(32) }), "staff_invitation_accept (bogus token reaches the function)");
    passes(await rpc(u, "invitation_accept", { p_token: "x".repeat(32) }), "invitation_accept (bogus token reaches the function)"); }

  console.log("== S9 other account steps reachable while unfinished");
  { const u = await makeUser("s9");
    for (const [fn, args] of [
      ["account_password_confirm", { p_password: PW, p_operation: "change_password", p_target: "x" }],
      ["onboarding_save_contact", { p_phone: "+201068123457" }],
      ["onboarding_save_profile", { p_display_name: "Gate Nine", p_locale: "en" }],
      ["profile_set_username", { p_username: "gate_nine_user" }],
      ["my_account_status", {}],
    ]) passes(await rpc(u, fn, args), fn); }

  console.log("== S10 every choice on the account-type step reaches the function (coming-soon types are refused by the function, not the gate)");
  for (const [track, type] of [["professional", "installer_technician"], ["professional", "sales"], ["professional", "engineer"], ["professional", "contractor"],
    ["business", "showroom_dealer"], ["business", "supplier"], ["business", "manufacturer"], ["business", "importer"], ["professional", "end_consumer"]]) {
    const u = await makeUser("s10");
    passes(await rpc(u, "record_consent", { p_types: CONSENT, p_locale: "en" }), `consent before ${type}`);
    passes(await rpc(u, "onboarding_select_account_type", { p_track: track, p_account_type: type }), `onboarding_select_account_type ${track}/${type}`);
  }

  console.log("== S11 unconfirmed email cannot get a session at all; at the database an unconfirmed account is refused (pgTAP 143 covers it)");
  { let ok = false; try { await makeUser("s11", { confirmed: false }); } catch { ok = true; } check(ok, "S11 GoTrue gives no token before the email is confirmed"); }

  console.log("== S12 a finished registration is unaffected");
  { const u = await makeUser("s12");
    await rpc(u, "record_consent", { p_types: CONSENT, p_locale: "en" });
    await rpc(u, "onboarding_select_account_type", { p_track: "professional", p_account_type: "installer_technician" });
    const a = await rpc(u, "avatar_request_upload", { p_content_type: "image/jpeg" });
    check(a.status === 200, "S12 avatar_request_upload works after registration", `(HTTP ${a.status})`);
    const o = await call(u, "POST", "/organizations", { name: "Gate S12 Org", org_type: "showroom_dealer", created_by: u.id }, { prefer: "return=minimal" });
    check(o.status === 201, "S12 direct organization INSERT works after registration (unchanged behaviour)", `(HTTP ${o.status})`); }
} finally {
  if (created.length) {
    const ids = created.map((i) => `'${i}'`).join(",");
    try { sql(`delete from public.organizations where created_by in (${ids}); delete from auth.users where id in (${ids})`); } catch (e) { console.log("cleanup warning:", String(e).slice(0, 200)); }
  }
}
console.log(failures === 0 ? "\nALL REGISTRATION PATHS OK" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
