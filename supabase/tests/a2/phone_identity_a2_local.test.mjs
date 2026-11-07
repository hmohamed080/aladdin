// Phase A2 - real local Supabase / Postgres / GoTrue phone-identity verification tests.
//
//   DB_CONTAINER=supabase_db_<isolated-a2-stack> node supabase/tests/a2/phone_identity_a2_local.test.mjs
//
// Scope: LOCAL ISOLATED STACK ONLY (see lib.mjs guards). No WhatsApp / Meta / SMS / email is sent: the GoTrue phone
// provider is configured with FAKE credentials and a fixed fake test_otp map, the Send SMS Hook is off, and the
// verification-authority prototype only produces evidence rows in a scratch schema. Existing identity records are
// never written to simulate a verified phone (nothing here sets profiles.phone_verified_at).
//
// Result vocabulary: PASS / FAIL for behaviour that exists today; GAP for a required scenario that is NOT implemented
// (recorded, never reported as passing); EVAL for an observation about a CANDIDATE design.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { target, makeDb, makeHttp, makeRecorder, phoneFactory, runTag, shortId, mask } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const t = target();
const db = makeDb(t.container);
const h = makeHttp(t);
const rec = makeRecorder("phone-identity-a2-local");
const tag = runTag();
const nextPhone = phoneFactory(tag);
const PASSWORD = "A2-Fixture-Pass-1!";
const created = []; // auth user ids created by this run (cleanup)
const orgs = []; // organization ids created by this run (cleanup)
const usedPhones = new Set();
const labelOf = {}; // user id -> fixture label (evidence only)
const aliasDigits = new Set(); // numbers embedded in phone-login aliases (they appear in GoTrue events by construction)

const out = (r) => (r.status >= 200 && r.status < 300 ? "ok" : (r.data?.code ?? r.data?.error_code ?? String(r.status)));
const phone = () => { const p = nextPhone(); usedPhones.add(p.e164.slice(1)); return p; };

// ------------------------------------------------------------------------------------------------ fixtures
async function bootstrap(acct, { track, type, withPhone, usernamePrefix }) {
  const s = await h.signInPassword(acct.email, PASSWORD);
  if (s.status !== 200) throw new Error(`fixture sign-in failed (${s.status})`);
  acct.token = s.data.access_token;
  const steps = [
    ["record_consent", { p_types: ["terms", "privacy", "pilot"], p_locale: "ar" }],
    ["onboarding_select_account_type", { p_track: track, p_account_type: type }],
  ];
  if (withPhone) steps.push(["profile_set_phone", { p_country_iso2: withPhone.iso2, p_national: withPhone.national, p_e164: withPhone.e164 }]);
  steps.push(["profile_set_username", { p_username: `${usernamePrefix}${tag}${acct.id.slice(0, 4)}` }]);
  for (const [fn, args] of steps) {
    const r = await h.rpc(fn, args, acct.token);
    if (r.status >= 300) throw new Error(`fixture step ${fn} failed (${out(r)})`);
  }
}

async function account(label, { alias = false, track = "professional", type = "installer_technician", withPhone = null, source } = {}) {
  const email = alias ? `p${withPhone.e164.slice(1)}@craftsman-login.aladdin.invalid` : `a2-${tag}-${label}@a2.invalid`;
  const c = await h.adminCreateUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { full_name: `A2 ${label}`, locale: "ar" },
    app_metadata: source ? { registration_source: source } : {},
  });
  if (c.status >= 300) throw new Error(`createUser ${label}: ${out(c)}`);
  const acct = { label, id: c.data.id, email, phone: withPhone, alias };
  labelOf[acct.id] = label;
  if (alias) aliasDigits.add(withPhone.e164.slice(1));
  created.push(acct.id);
  await bootstrap(acct, { track, type, withPhone, usernamePrefix: label.toLowerCase().replace(/[^a-z]/g, "").slice(0, 8) || "a2" });
  return acct;
}

async function showroomOrg(acct, contact) {
  const act = db.sql("select key from public.activities where organization_type='showroom_dealer' and is_active order by key limit 1;");
  const s = await h.rpc("business_draft_save_v2", {
    p_legal_name: `A2 ${acct.label} LLC`, p_display_name: `A2 ${acct.label} ${tag}`, p_org_type: "showroom_dealer",
    p_governorate: "Cairo", p_city: "New Cairo", p_primary_branch_name: "Main", p_contact_phone: contact, p_activity_type: act,
  }, acct.token);
  if (s.status >= 300) throw new Error(`business_draft_save_v2: ${out(s)}`);
  const sub = await h.rpc("business_draft_submit_v2", {}, acct.token);
  if (sub.status >= 300) throw new Error(`business_draft_submit_v2: ${out(sub)}`);
  const org = db.sql(`select organization_id from public.memberships where user_id='${acct.id}' limit 1;`);
  orgs.push(org);
  return org;
}

const ids = (...a) => `{${a.map((x) => x.id).join(",")}}`;

function snapshot(list) {
  return db.json(`
    select coalesce(jsonb_object_agg(u.id, jsonb_build_object(
      'auth', jsonb_build_object('email', u.email, 'phone', u.phone, 'phone_confirmed', u.phone_confirmed_at is not null,
        'email_confirmed', u.email_confirmed_at is not null, 'role', u.role, 'aud', u.aud, 'anon', u.is_anonymous,
        'banned_until', u.banned_until, 'pw_digest', md5(u.encrypted_password),
        'source', u.raw_app_meta_data->>'registration_source', 'providers', u.raw_app_meta_data->'providers',
        'created_at', u.created_at),
      'identities', (select coalesce(jsonb_agg(jsonb_build_object('provider', i.provider, 'id', i.id) order by i.provider, i.id), '[]') from auth.identities i where i.user_id = u.id),
      'mfa_factors', (select count(*) from auth.mfa_factors f where f.user_id = u.id),
      'public_user', (select jsonb_build_object('type', x.primary_account_type, 'status', x.status, 'verified', x.is_verified) from public.users x where x.id = u.id),
      'profile', (select jsonb_build_object('id', p.id, 'username', p.username, 'phone_e164', p.phone_e164, 'country', p.phone_country_iso2,
                    'national', p.phone_national, 'verified_at', p.phone_verified_at, 'display_name', p.display_name) from public.profiles p where p.user_id = u.id),
      'memberships', (select coalesce(jsonb_agg(jsonb_build_object('org', m.organization_id, 'status', m.status, 'org_type', o.org_type,
                    'org_contact_phone', o.contact_phone,
                    'caps', (select coalesce(jsonb_agg(c.capability_key order by c.capability_key), '[]') from public.membership_capabilities c where c.membership_id = m.id))
                    order by m.organization_id), '[]')
                  from public.memberships m join public.organizations o on o.id = m.organization_id where m.user_id = u.id),
      'platform_roles', (select coalesce(jsonb_agg(g.role order by g.role), '[]') from public.platform_role_grants g where g.user_id = u.id),
      'admin_role_assignments', (select count(*) from public.admin_role_assignments a where a.user_id = u.id and a.is_active)
    )), '{}'::jsonb)
    from auth.users u where u.id = any('${list}'::uuid[]);`);
}

async function withState(snap, accts) {
  for (const a of accts) {
    const login = await h.signInPassword(a.email, PASSWORD);
    const r = login.status === 200 ? await h.rpc("my_registration_state", {}, login.data.access_token) : null;
    snap[a.id].registration_state = r ? r.data : `signin_${login.status}`;
    snap[a.id].signin_user = login.status === 200 ? login.data.user.id : null;
  }
  return snap;
}

const strip = (s) => JSON.parse(JSON.stringify(s, (k, v) => (k === "created_at" ? undefined : v)));
const same = (a, b) => JSON.stringify(strip(a)) === JSON.stringify(strip(b));
function diffKeys(a, b) {
  const d = [];
  for (const id of Object.keys(a)) for (const k of Object.keys(a[id])) if (JSON.stringify(strip(a[id][k])) !== JSON.stringify(strip(b[id]?.[k]))) d.push(`${shortId(id)}.${k}`);
  return d;
}

const globalCounts = () => db.json(`select jsonb_build_object('auth_users', (select count(*) from auth.users), 'identities', (select count(*) from auth.identities),
  'mfa_factors', (select count(*) from auth.mfa_factors), 'auth_users_with_phone', (select count(*) from auth.users where phone is not null),
  'profiles', (select count(*) from public.profiles), 'public_users', (select count(*) from public.users));`);

// service_role access to the prototype, as a separate database session per call
const asService = (sql) => `begin; set local role service_role; ${sql}; commit;`;
const svc = (sql) => db.sql(asService(sql));
const svcAsync = (sql) => db.sqlAsync(asService(sql));
const startChallenge = (user, purpose, ph) => {
  const row = svc(`select ch_id, ch_code from a2_proto.start('${user}', '${purpose}', '${ph}')`).split("|");
  return { id: row[0], code: row[1] };
};
const verify = (user, ch, code) => svc(`select a2_proto.verify('${user}', '${ch}', '${code}')`);
const tryStart = (user, purpose, ph) => { try { startChallenge(user, purpose, ph); return "started"; } catch (e) { return (e.stderr?.toString() ?? e.message).replace(/\s+/g, " ").slice(0, 90); } };
const unthrottle = (user) => db.sql(`update a2_proto.challenge set created_at = created_at - interval '2 hours' where user_id='${user}';`);

// ======================================================================================== 0. environment guards
async function envGuards() {
  const settings = (await h.call("GET", "/auth/v1/settings")).data;
  const authEnv = execFileSync("docker", ["exec", t.container.replace("supabase_db_", "supabase_auth_"), "env"], { encoding: "utf8" });
  const hookOn = /GOTRUE_HOOK_SEND_SMS_ENABLED=true/.test(authEnv);
  rec.check("A2-ENV-1", "guard", "Send SMS Hook is OFF on the isolated stack (no transport can run)", !hookOn);
  const phoneMfa = /GOTRUE_MFA_PHONE_ENROLL_ENABLED=true|GOTRUE_MFA_PHONE_VERIFY_ENABLED=true/.test(authEnv);
  rec.check("A2-ENV-2", "guard", "Supabase Advanced Phone MFA is OFF", !phoneMfa && !settings.mfa_phone_enroll_enabled);
  rec.check("A2-ENV-3", "guard", "GoTrue phone provider uses FAKE credentials + fixed test_otp map (OTP confirmations ON, no autoconfirm)",
    settings.phone_autoconfirm === false && /GOTRUE_SMS_TEST_OTP=/.test(authEnv) && /GOTRUE_SMS_TWILIO_ACCOUNT_SID=AC0{32}/.test(authEnv));
  rec.check("A2-ENV-4", "guard", "Target is loopback API + explicitly named non-shared DB container", /^http:\/\/(127\.0\.0\.1|localhost)/.test(t.api) && t.container !== "supabase_db_aladdin", t.container);
}

// ======================================================================================== main
const results = { fixtures: {}, snapshots: {} };
let proto = false;
try {
  await envGuards();

  // ------------------------------------------------------------------------------------ 1. fixtures
  const pInst = phone(), pShow = phone(), pEmail = phone(), orgOnlyPhone = phone(), showOrgPhone = phone();
  const installer = await account("LegacyInstaller", { alias: true, withPhone: pInst, source: "temporary_craftsman_password_flow" });
  const showroom = await account("LegacyShowroom", { alias: true, track: "business", type: "showroom_dealer", withPhone: pShow, source: "temporary_showroom_password_flow" });
  const showroomOrgId = await showroomOrg(showroom, showOrgPhone.e164);
  const emailAcct = await account("EmailSignup", { withPhone: pEmail });
  const orgOnly = await account("OrgContactOnly", { track: "business", type: "showroom_dealer" });
  const orgOnlyOrgId = await showroomOrg(orgOnly, orgOnlyPhone.e164);
  const legacy = [installer, showroom, emailAcct, orgOnly];

  rec.check("A2-FX-1", "fixtures", "Four fixture classes built through the real signup path (Admin createUser -> password sign-in -> record_consent / account type / profile_set_phone / username / business draft)",
    legacy.every((a) => a.id) && showroomOrgId && orgOnlyOrgId, legacy.map((a) => `${a.label}:${shortId(a.id)}`).join(" "));

  // Actors that are NOT part of the invariance set.
  const actors = {};
  for (const l of ["Other", "Third"]) actors[l] = await account(l, { withPhone: phone() });
  const baselineGlobal = globalCounts();

  // ------------------------------------------------------------------------------------ 2. snapshot BEFORE
  const before = await withState(snapshot(ids(...legacy)), legacy);
  results.snapshots.before = before;
  rec.check("A2-SNAP-1", "invariance", "Baseline snapshot captured (auth user, identities, MFA, public user, profile, memberships+capabilities, platform/admin roles, login alias, registration state)",
    Object.keys(before).length === 4, `users=${Object.keys(before).length}`);

  // ------------------------------------------------------------------------------------ 3. legacy state + access
  rec.check("A2-LEG-1", "legacy", "Legacy Installer: primary phone stored, phone_verified_at NULL (unverified, not converted), alias login works",
    before[installer.id].profile.phone_e164 === pInst.e164 && before[installer.id].profile.verified_at === null && before[installer.id].signin_user === installer.id
    && /^p\d+@craftsman-login\.aladdin\.invalid$/.test(before[installer.id].auth.email));
  rec.check("A2-LEG-2", "legacy", "Legacy Showroom: unverified primary, org membership + owner capabilities intact, alias login works",
    before[showroom.id].profile.verified_at === null && before[showroom.id].memberships.length === 1 && before[showroom.id].memberships[0].caps.length > 0
    && before[showroom.id].signin_user === showroom.id);
  rec.check("A2-LEG-3", "legacy", "Email-signup account with a profile phone: unverified, auth.users.phone NULL, email sign-in works",
    before[emailAcct.id].profile.verified_at === null && before[emailAcct.id].auth.phone === null && before[emailAcct.id].signin_user === emailAcct.id);
  rec.check("A2-LEG-4", "legacy", "Organization-only contact number: owner has NO profile phone; number lives on organizations.contact_phone only",
    before[orgOnly.id].profile.phone_e164 === null && before[orgOnly.id].memberships[0]?.org_contact_phone === orgOnlyPhone.e164);
  rec.check("A2-LEG-5", "legacy", "All legacy fixtures pass the registration gate today without phone proof (state grants app access)",
    legacy.every((a) => ["access_ready", "active_personal"].includes(before[a.id].registration_state)), legacy.map((a) => before[a.id].registration_state).join(","));
  const prof = await h.call("GET", `/rest/v1/profiles?select=phone_e164,phone_verified_at&user_id=eq.${installer.id}`, { token: installer.token });
  rec.check("A2-LEG-6", "legacy", "loadMyIdentity read contract: caller reads own phone_verified_at as null => UI 'unverified'", prof.status === 200 && prof.data[0]?.phone_verified_at === null);
  rec.check("A2-LEG-7", "legacy", "Org contact number is not any account's phone: no profile / auth.users row carries it",
    db.sql(`select count(*) from public.profiles where phone_e164 in ('${orgOnlyPhone.e164}','${showOrgPhone.e164}');`) === "0"
    && db.sql(`select count(*) from auth.users where phone in ('${orgOnlyPhone.e164.slice(1)}','${showOrgPhone.e164.slice(1)}');`) === "0");

  // ------------------------------------------------------------------------------------ 4. client cannot forge verification
  const forge = await h.call("PATCH", `/rest/v1/profiles?user_id=eq.${actors.Other.id}`, { token: actors.Other.token, body: { phone_verified_at: new Date().toISOString() }, headers: { prefer: "return=representation" } });
  rec.check("A2-FORGE-1", "authority", "Direct PostgREST PATCH of phone_verified_at as the account owner is refused and the column stays NULL",
    forge.status >= 400 && db.sql(`select phone_verified_at is null from public.profiles where user_id='${actors.Other.id}';`) === "t", `http=${forge.status} code=${forge.data?.code}`);
  const meta = await h.call("PUT", "/auth/v1/user", { token: actors.Other.token, body: { data: { phone_verified: true, phone_verified_at: new Date().toISOString() } } });
  rec.check("A2-FORGE-2", "authority", "Forged user_metadata flags (GoTrue PUT /user data) do not change profiles.phone_verified_at",
    db.sql(`select phone_verified_at is null from public.profiles where user_id='${actors.Other.id}';`) === "t", `put=${meta.status}`);
  const rpcForge = await h.rpc("profile_set_phone", { p_country_iso2: "EG", p_national: actors.Other.phone.national, p_e164: actors.Other.phone.e164 }, actors.Other.token);
  rec.check("A2-FORGE-3", "authority", "Re-submitting the same number via profile_set_phone does not verify it",
    db.sql(`select phone_verified_at is null from public.profiles where user_id='${actors.Other.id}';`) === "t", `rpc=${out(rpcForge)}`);
  const privs = db.json(`select jsonb_build_object('auth', has_column_privilege('authenticated','public.profiles','phone_verified_at','UPDATE'),
    'anon', has_column_privilege('anon','public.profiles','phone_verified_at','UPDATE'), 'service', has_column_privilege('service_role','public.profiles','phone_verified_at','UPDATE'));`);
  rec.check("A2-FORGE-4", "authority", "authenticated / anon hold no UPDATE on phone_verified_at", privs.auth === false && privs.anon === false, `service_role_update=${privs.service}`);
  const writers = db.sql(`select string_agg(n.nspname || '.' || p.proname, ',' order by 1) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','app') and p.prosrc ~* 'phone_verified_at\\s*(=|:=)' and p.proname not in ('profiles_reset_phone_verification');`);
  rec.gap("A2-GAP-1", "authority", "Server-side writer that sets profiles.phone_verified_at after proof of possession",
    `NOT IMPLEMENTED. Only journal-restore functions assign the column (${writers || "none"}); no definer function records a successful challenge.`);

  // ------------------------------------------------------------------------------------ 5. reservations (real HTTP)
  const R = {};
  for (const l of ["R1", "R2", "R3", "R4", "R5", "R6", "Lock"]) R[l] = await account(l, { withPhone: phone() });
  const receipt = async (a, op, target_, pw = PASSWORD) => (await h.rpc("account_password_confirm", { p_password: pw, p_operation: op, p_target: target_ }, a.token)).data;
  const reserve = async (a, ph) => { const rc = await receipt(a, "secondary_phone.reserve", ph); return h.rpc("secondary_phone_reserve", { p_phone: ph, p_receipt: rc.receipt ?? null }, a.token); };
  const age = (uid, interval) => db.sql(`update public.secondary_phone_reservations set created_at = created_at - interval '${interval}', expires_at = expires_at - interval '${interval}', ended_at = ended_at - interval '${interval}' where user_id='${uid}';`);
  const active = (uid) => db.json(`select coalesce(jsonb_agg(jsonb_build_object('status', status, 'days', round(extract(epoch from (expires_at - created_at))/86400, 2), 'renewals', renewal_count)), '[]') from public.secondary_phone_reservations where user_id='${uid}' and status='active';`);

  const s1 = phone();
  const r1 = await reserve(R.R1, s1.e164);
  const row = active(R.R1.id)[0];
  rec.check("A2-RES-1", "reservation", "Reserve a secondary with a fresh password receipt: active, 7 days, unverified, no auth/profile change",
    out(r1) === "ok" && row?.status === "active" && row.days === 7 && db.sql(`select count(*) from auth.users where phone='${s1.e164.slice(1)}';`) === "0", `reserve=${out(r1)} days=${row?.days}`);

  const noRcpt = await h.rpc("secondary_phone_reserve", { p_phone: phone().e164, p_receipt: null }, R.R2.token);
  const wrongPw = await receipt(R.R2, "secondary_phone.reserve", phone().e164, "not-the-password");
  rec.check("A2-RES-2", "reservation", "Password reauthentication required: no receipt refused; wrong password yields no receipt",
    out(noRcpt) !== "ok" && wrongPw.ok === false && !wrongPw.receipt, `noReceipt=${out(noRcpt)} wrong=${wrongPw.reason}`);
  const targetA = phone().e164, targetB = phone().e164;
  const rcA = await receipt(R.R2, "secondary_phone.reserve", targetA);
  const mismatch = await h.rpc("secondary_phone_reserve", { p_phone: targetB, p_receipt: rcA.receipt }, R.R2.token);
  const okOnce = await h.rpc("secondary_phone_reserve", { p_phone: targetA, p_receipt: rcA.receipt }, R.R2.token);
  const replayRc = await h.rpc("secondary_phone_change", { p_phone: targetB, p_receipt: rcA.receipt }, R.R2.token);
  rec.check("A2-RES-3", "reservation", "Receipt is bound to number+operation and single-use (wrong target refused, spent receipt cannot be replayed)",
    out(mismatch) !== "ok" && out(okOnce) === "ok" && out(replayRc) !== "ok", `mismatch=${out(mismatch)} replay=${out(replayRc)}`);

  // lockout (dedicated account)
  const fails = [];
  for (let i = 0; i < 5; i += 1) fails.push((await receipt(R.Lock, "secondary_phone.reserve", phone().e164, "wrong-wrong-wrong")).reason);
  const lockedGood = await receipt(R.Lock, "secondary_phone.reserve", phone().e164, PASSWORD);
  rec.check("A2-RES-4", "reservation", "5 wrong passwords lock confirmation; the CORRECT password is then also refused (locked)", lockedGood.ok === false && lockedGood.reason === "locked", `${fails.join(">")} then ${lockedGood.reason}`);

  // uniqueness
  const dupSec = await reserve(R.R3, s1.e164);
  const dupPrimary = await h.rpc("profile_set_phone", { p_country_iso2: "EG", p_national: s1.national, p_e164: s1.e164 }, R.R3.token);
  const resOfPrimary = await reserve(R.R3, R.R1.phone.e164);
  rec.check("A2-RES-5", "reservation", "Uniqueness across accounts and kinds: other account cannot reserve an actively reserved number, cannot take it as primary, cannot reserve another account's primary",
    out(dupSec) !== "ok" && out(dupPrimary) !== "ok" && out(resOfPrimary) !== "ok", `secondary=${out(dupSec)} primary=${out(dupPrimary)} vsPrimary=${out(resOfPrimary)}`);
  const ownPrimary = await reserve(R.R3, R.R3.phone.e164);
  rec.check("A2-RES-6", "reservation", "A number cannot be both primary and secondary of the same account", out(ownPrimary) !== "ok", out(ownPrimary));
  const legacyVsOrg = await reserve(R.R3, pInst.e164);
  rec.check("A2-RES-7", "reservation", "Legacy Installer's primary number cannot be reserved by anyone else", out(legacyVsOrg) !== "ok", out(legacyVsOrg));

  // renewal
  const ren1 = await h.rpc("secondary_phone_renew", {}, R.R1.token);
  const afterRen = active(R.R1.id)[0];
  const ren2 = await h.rpc("secondary_phone_renew", {}, R.R1.token);
  rec.check("A2-RES-8", "reservation", "Exactly one renewal (+7 => 14 days max); a second renewal is refused",
    out(ren1) === "ok" && afterRen.days === 14 && afterRen.renewals === 1 && out(ren2) !== "ok", `renew1=${out(ren1)} days=${afterRen.days} renew2=${out(ren2)}`);

  // expiry + cooldown (clock moved on the reservation row only; identity rows untouched)
  age(R.R2.id, "8 days");
  const expiredRenew = await h.rpc("secondary_phone_renew", {}, R.R2.token);
  const cdTry = await reserve(R.R3, targetA);
  const mine = await h.rpc("my_secondary_phone", {}, R.R2.token);
  const cdState = mine.data === null ? "none_active" : "still_visible";
  rec.check("A2-RES-9", "reservation", "Expired reservation (7 days, unrenewed): cannot be renewed, is invisible to its owner as active, and the number enters the 30-day cooldown for any other secondary reservation",
    out(expiredRenew) !== "ok" && cdState === "none_active" && out(cdTry) !== "ok", `renew=${out(expiredRenew)} owner_view=${cdState} otherReserve=${out(cdTry)}`);
  rec.evaluation("A2-OBS-1", "reservation", "Low-severity observation: a FAILED renew/reserve rolls back the lazy finalize write, so an expired row can stay status='active' (past expires_at) until a non-failing touch; behaviour is still correct because expiry is derived from expires_at",
    `stored_status_after_failed_ops=${db.sql(`select status from public.secondary_phone_reservations where user_id='${R.R2.id}' order by created_at desc limit 1;`)}`);
  const primaryDuringCooldown = await h.rpc("profile_set_phone", { p_country_iso2: "EG", p_national: targetA.slice(3), p_e164: targetA }, R.R5.token);
  rec.check("A2-RES-10", "reservation", "Cooldown blocks SECONDARY reservation only; primary claim of the number is not blocked (existing rule preserved)", out(primaryDuringCooldown) === "ok", out(primaryDuringCooldown));
  const targetC = phone().e164;
  await reserve(R.R6, targetC);
  age(R.R6.id, "8 days");
  const duringCd = await reserve(R.R3, targetC); // also finalizes R6's stale row
  age(R.R6.id, "31 days");
  const afterCd = await reserve(R.R3, targetC);
  rec.check("A2-RES-11", "reservation", "Cooldown lifts after 30 days: refused at day 8, reservable again once 30 days have passed since expiry", out(duringCd) !== "ok" && out(afterCd) === "ok", `day8=${out(duringCd)} day39=${out(afterCd)}`);

  // cancel => cooldown
  const cancelNum = phone().e164;
  await reserve(R.R4, cancelNum);
  const cancel = await h.rpc("secondary_phone_cancel", {}, R.R4.token);
  const afterCancel = await reserve(R.R5, cancelNum);
  rec.check("A2-RES-12", "reservation", "Cancellation starts the same 30-day cooldown for other accounts", out(cancel) === "ok" && out(afterCancel) !== "ok", `cancel=${out(cancel)} otherReserve=${out(afterCancel)}`);

  // concurrency: real parallel HTTP sessions
  const racers = [];
  for (let i = 0; i < 8; i += 1) racers.push(await account(`Race${i}`, { withPhone: phone() }));
  const contested = phone().e164;
  const rc = await Promise.all(racers.map((a) => receipt(a, "secondary_phone.reserve", contested)));
  const wins = await Promise.all(racers.map((a, i) => h.rpc("secondary_phone_reserve", { p_phone: contested, p_receipt: rc[i].receipt }, a.token)));
  const nWin = wins.filter((r) => out(r) === "ok").length;
  rec.check("A2-CON-1", "concurrency", "8 accounts claim one number as secondary at the same time: exactly one wins, the rest get the generic refusal",
    nWin === 1 && db.sql(`select count(*) from public.secondary_phone_reservations where phone_e164='${contested}' and status='active';`) === "1", `winners=${nWin} errors=${[...new Set(wins.map(out))].join(",")}`);

  db.sql(`delete from public.secondary_phone_reservations where user_id = any('{${racers.map((a) => a.id).join(",")}}'::uuid[]);`);
  const mixed = phone();
  const half = racers.slice(0, 4), half2 = racers.slice(4);
  const rc2 = await Promise.all(half2.map((a) => receipt(a, "secondary_phone.reserve", mixed.e164)));
  const mix = await Promise.all([
    ...half.map((a) => h.rpc("profile_set_phone", { p_country_iso2: "EG", p_national: mixed.national, p_e164: mixed.e164 }, a.token)),
    ...half2.map((a, i) => h.rpc("secondary_phone_reserve", { p_phone: mixed.e164, p_receipt: rc2[i].receipt }, a.token)),
  ]);
  const holders = Number(db.sql(`select (select count(*) from public.profiles where phone_e164='${mixed.e164}') + (select count(*) from public.secondary_phone_reservations where phone_e164='${mixed.e164}' and status='active');`));
  rec.check("A2-CON-2", "concurrency", "Primary-claim vs secondary-reservation race on one number (4 vs 4): exactly one claim of any kind survives", holders === 1 && mix.filter((r) => out(r) === "ok").length === 1,
    `claims=${holders} ok=${mix.filter((r) => out(r) === "ok").length}`);

  const solo = racers[0];
  const many = [phone().e164, phone().e164, phone().e164, phone().e164];
  db.sql(`delete from public.secondary_phone_reservations where user_id = any('{${racers.map((a) => a.id).join(",")}}'::uuid[]);`);
  const rcs = await Promise.all(many.map((p) => receipt(solo, "secondary_phone.reserve", p)));
  const serial = await Promise.all(many.map((p, i) => h.rpc("secondary_phone_reserve", { p_phone: p, p_receipt: rcs[i].receipt }, solo.token)));
  rec.check("A2-CON-3", "concurrency", "One account reserving 4 numbers simultaneously ends with exactly one active reservation", db.sql(`select count(*) from public.secondary_phone_reservations where user_id='${solo.id}' and status='active';`) === "1" && serial.filter((r) => out(r) === "ok").length === 1);

  // ------------------------------------------------------------------------------------ 6. candidate authority prototype
  db.sql(readFileSync(resolve(here, "proposal/phone_verification_authority.proto.sql.txt"), "utf8"));
  proto = true;
  const V = {};
  for (const l of ["V1", "V2", "V3", "V4", "V5"]) V[l] = await account(l, { withPhone: phone() });
  const stranger = actors.Other;

  rec.check("A2-AUTH-0", "authority", "Prototype functions are executable by service_role only (not anon / authenticated / PUBLIC)",
    db.sql(`select bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE')) and not bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'))
            from pg_proc p where p.pronamespace = 'a2_proto'::regnamespace and p.proname in ('start','verify');`) === "t");

  // wrong account / wrong number at START
  rec.check("A2-AUTH-1", "authority", "START refuses a number that is not the caller's current claim (another account's primary, an unreserved number)",
    /42501|not the caller/.test(tryStart(stranger.id, "primary_proof", V.V1.phone.e164)) && /42501|not the caller/.test(tryStart(V.V1.id, "primary_proof", phone().e164)));

  // happy path on a fixture that is not in the invariance set
  const c1 = startChallenge(V.V1.id, "primary_proof", V.V1.phone.e164);
  const wrongAcct = verify(stranger.id, c1.id, c1.code);
  const attemptsAfterStranger = db.sql(`select attempts from a2_proto.challenge where id='${c1.id}';`);
  rec.check("A2-AUTH-2", "authority", "Wrong ACCOUNT presenting the correct code and challenge id: generic 'invalid', no state change, owner's attempt counter not burned",
    wrongAcct === "invalid" && attemptsAfterStranger === "0");
  const wrongCode = verify(V.V1.id, c1.id, c1.code === "000000" ? "000001" : "000000");
  rec.check("A2-AUTH-3", "authority", "Wrong code: 'invalid', attempts counted", wrongCode === "invalid" && db.sql(`select attempts from a2_proto.challenge where id='${c1.id}';`) === "1");
  const good = verify(V.V1.id, c1.id, c1.code);
  const replay = verify(V.V1.id, c1.id, c1.code);
  rec.check("A2-AUTH-4", "authority", "Correct code verifies exactly once; replay of the same code is 'invalid' and records no second evidence row",
    good === "verified" && replay === "invalid" && db.sql(`select count(*) from a2_proto.verified_claim where challenge_id='${c1.id}';`) === "1");
  rec.check("A2-AUTH-5", "authority", "Verified evidence grants nothing: no auth.users.phone, no phone identity, no MFA factor, profiles.phone_verified_at untouched, alias intact",
    db.sql(`select (select phone is null from auth.users where id='${V.V1.id}') and (select count(*)=0 from auth.mfa_factors where user_id='${V.V1.id}')
            and (select count(*)=1 from auth.identities where user_id='${V.V1.id}') and (select phone_verified_at is null from public.profiles where user_id='${V.V1.id}');`) === "t");

  // expiry
  unthrottle(V.V2.id);
  const c2 = startChallenge(V.V2.id, "primary_proof", V.V2.phone.e164);
  db.sql(`update a2_proto.challenge set expires_at = now() - interval '1 second' where id='${c2.id}';`);
  rec.check("A2-AUTH-6", "authority", "Expired challenge with the correct code is refused", verify(V.V2.id, c2.id, c2.code) === "invalid" && db.sql(`select invalidated_why from a2_proto.challenge where id='${c2.id}';`) === "expired");

  // attempt exhaustion
  unthrottle(V.V2.id);
  const c3 = startChallenge(V.V2.id, "primary_proof", V.V2.phone.e164);
  const bad = c3.code === "111111" ? "222222" : "111111";
  for (let i = 0; i < 5; i += 1) verify(V.V2.id, c3.id, bad);
  rec.check("A2-AUTH-7", "authority", "5 wrong codes exhaust the challenge; the correct code afterwards is refused", verify(V.V2.id, c3.id, c3.code) === "invalid" && db.sql(`select invalidated_why from a2_proto.challenge where id='${c3.id}';`) === "too_many_attempts");

  // resend limiting + supersede
  unthrottle(V.V3.id);
  const c4 = startChallenge(V.V3.id, "primary_proof", V.V3.phone.e164);
  const tooSoon = tryStart(V.V3.id, "primary_proof", V.V3.phone.e164);
  rec.check("A2-AUTH-8", "authority", "Resend inside 60 s is rate-limited server-side", /54000|rate limited/.test(tooSoon), tooSoon);
  unthrottle(V.V3.id);
  const c5 = startChallenge(V.V3.id, "primary_proof", V.V3.phone.e164);
  rec.check("A2-AUTH-9", "authority", "A new challenge supersedes the previous one (old code dies, one open challenge per account+purpose)",
    verify(V.V3.id, c4.id, c4.code) === "invalid" && db.sql(`select count(*) from a2_proto.challenge where user_id='${V.V3.id}' and purpose='primary_proof' and consumed_at is null and invalidated_at is null;`) === "1" && c5.id !== c4.id);

  // wrong NUMBER at verify: primary edited while a challenge is in flight (real profile_set_phone)
  unthrottle(V.V4.id);
  const c6 = startChallenge(V.V4.id, "primary_proof", V.V4.phone.e164);
  const newPhone = phone();
  const edit2 = await h.rpc("profile_set_phone", { p_country_iso2: "EG", p_national: newPhone.national, p_e164: newPhone.e164 }, V.V4.token);
  rec.check("A2-AUTH-10", "authority", "Phone edited while a challenge is in flight: correct code for the OLD number is refused, challenge marked claim_changed, new number unverified",
    out(edit2) === "ok" && verify(V.V4.id, c6.id, c6.code) === "invalid" && db.sql(`select invalidated_why from a2_proto.challenge where id='${c6.id}';`) === "claim_changed"
    && db.sql(`select count(*) from a2_proto.verified_claim where user_id='${V.V4.id}';`) === "0");

  // secondary proof lifecycle (real reservation rows)
  const sec = phone();
  await reserve(V.V5, sec.e164);
  unthrottle(V.V5.id);
  const cs = startChallenge(V.V5.id, "secondary_proof", sec.e164);
  const cap = db.sql(`select expires_at <= (select expires_at from public.secondary_phone_reservations where user_id='${V.V5.id}' and status='active') from a2_proto.challenge where id='${cs.id}';`);
  const resBefore = db.sql(`select expires_at from public.secondary_phone_reservations where user_id='${V.V5.id}' and status='active';`);
  const sv = verify(V.V5.id, cs.id, cs.code);
  const resAfter = db.sql(`select expires_at from public.secondary_phone_reservations where user_id='${V.V5.id}' and status='active';`);
  rec.check("A2-AUTH-11", "authority", "Secondary proof on an ACTIVE reservation verifies without extending the reservation (7+7 window unchanged) and is capped by it",
    sv === "verified" && cap === "t" && resBefore === resAfter, `verified=${sv}`);
  rec.check("A2-AUTH-12", "authority", "Secondary proof grants no login/recovery/primary/MFA: auth.users.phone NULL, reservation still 'active' (not converted), profile phone unchanged",
    db.sql(`select (select phone is null from auth.users where id='${V.V5.id}') and (select status='active' from public.secondary_phone_reservations where user_id='${V.V5.id}' and phone_e164='${sec.e164}' order by created_at desc limit 1) and (select phone_e164 <> '${sec.e164}' from public.profiles where user_id='${V.V5.id}');`) === "t");
  // expired / cancelled / changed => cannot verify or start
  unthrottle(V.V5.id);
  const cs2 = startChallenge(V.V5.id, "secondary_proof", sec.e164);
  await h.rpc("secondary_phone_cancel", {}, V.V5.token);
  rec.check("A2-AUTH-13", "authority", "Cancelled reservation: in-flight proof refused (claim_changed); cancelled number cannot be re-proven; reservation is not resurrected",
    verify(V.V5.id, cs2.id, cs2.code) === "invalid" && /42501|no active reservation/.test(tryStart(V.V5.id, "secondary_proof", sec.e164))
    && db.sql(`select count(*) from public.secondary_phone_reservations where user_id='${V.V5.id}' and status='active';`) === "0");
  const sec2 = phone();
  // re-reserve is blocked by the user's own cooldown rules only for OTHER users; own different number is fine
  await reserve(V.V5, sec2.e164);
  unthrottle(V.V5.id);
  const cs3 = startChallenge(V.V5.id, "secondary_proof", sec2.e164);
  age(V.V5.id, "8 days");
  rec.check("A2-AUTH-14", "authority", "Reservation expired by the clock: correct code refused and START refuses; expired reservation not marked verified",
    verify(V.V5.id, cs3.id, cs3.code) === "invalid" && /42501|no active reservation/.test(tryStart(V.V5.id, "secondary_proof", sec2.e164))
    && db.sql(`select count(*) from a2_proto.verified_claim where challenge_id='${cs3.id}';`) === "0");

  // concurrency on the authority
  const V6 = await account("V6", { withPhone: phone() });
  const cc = startChallenge(V6.id, "primary_proof", V6.phone.e164);
  const verdicts = await Promise.all(Array.from({ length: 8 }, () => svcAsync(`select a2_proto.verify('${V6.id}', '${cc.id}', '${cc.code}')`)));
  rec.check("A2-CON-4", "concurrency", "8 simultaneous verifications of one correct code: exactly one 'verified', seven 'invalid', one evidence row",
    verdicts.filter((v) => v === "verified").length === 1 && verdicts.filter((v) => v === "invalid").length === 7 && db.sql(`select count(*) from a2_proto.verified_claim where challenge_id='${cc.id}';`) === "1");
  const V7 = await account("V7", { withPhone: phone() });
  const starts = await Promise.allSettled(Array.from({ length: 6 }, () => svcAsync(`select ch_id from a2_proto.start('${V7.id}', 'primary_proof', '${V7.phone.e164}')`)));
  rec.check("A2-CON-5", "concurrency", "6 simultaneous START calls for one account+number: one challenge issued, no parallel open challenges",
    starts.filter((s) => s.status === "fulfilled").length === 1 && db.sql(`select count(*) from a2_proto.challenge where user_id='${V7.id}' and consumed_at is null and invalidated_at is null;`) === "1");
  const V8 = await account("V8", { withPhone: phone() });
  const cw = startChallenge(V8.id, "primary_proof", V8.phone.e164);
  const np8 = phone();
  const race = await Promise.allSettled([
    svcAsync(`select a2_proto.verify('${V8.id}', '${cw.id}', '${cw.code}')`),
    h.rpc("profile_set_phone", { p_country_iso2: "EG", p_national: np8.national, p_e164: np8.e164 }, V8.token),
  ]);
  const claimNow = db.sql(`select phone_e164 from public.profiles where user_id='${V8.id}';`);
  const ev = db.sql(`select phone_e164 from a2_proto.verified_claim where user_id='${V8.id}';`);
  const verdict8 = race[0].status === "fulfilled" ? race[0].value : "error";
  rec.check("A2-CON-6", "concurrency", "Edit racing verification is atomic: evidence exists iff the verdict was 'verified', and is always for the number the challenge was bound to",
    (verdict8 === "verified") === (ev !== "") && (ev === "" || ev === V8.phone.e164), `verdict=${verdict8} claimChanged=${claimNow !== V8.phone.e164}`);

  // prototype on LEGACY fixtures: evidence path must leave identity untouched
  for (const a of [installer, showroom, emailAcct]) {
    const cl = startChallenge(a.id, "primary_proof", a.phone.e164);
    const vr = verify(a.id, cl.id, cl.code);
    rec.check(`A2-AUTH-L${legacy.indexOf(a) + 1}`, "authority", `Prototype evidence path on legacy ${a.label}: verifies the exact current number, identity untouched (see invariance)`, vr === "verified");
  }

  // ------------------------------------------------------------------------------------ 7. GoTrue native candidate (sacrificial probes)
  const T = (n) => `+20100999000${n}`;
  const probe1 = await account("ProbeAlias1", { alias: true, withPhone: { iso2: "EG", national: "1009990001", e164: T(1) }, source: "temporary_craftsman_password_flow" });
  const probe2 = await account("ProbeAlias2", { alias: true, withPhone: phone(), source: "temporary_craftsman_password_flow" });
  const probe3 = await account("ProbeReserver", { withPhone: phone() });
  const probe4 = await account("ProbeNative", { withPhone: phone() });
  const usersBefore = Number(db.sql("select count(*) from auth.users;"));

  // N1: signInWithOtp({phone}) for a number that is a legacy alias account's PROFILE phone
  const o1 = await h.call("POST", "/auth/v1/otp", { body: { phone: T(1) } });
  const v1 = await h.call("POST", "/auth/v1/verify", { body: { type: "sms", phone: T(1), token: "000111" } });
  const newId = v1.data?.user?.id;
  rec.evaluation("A2-NAT-1", "candidate:gotrue-native", "signInWithOtp({phone}) for a legacy account's profile number creates a PARALLEL Auth user",
    `otp=${o1.status} verify=${v1.status} newUserDiffersFromLegacy=${Boolean(newId) && newId !== probe1.id} usersDelta=${Number(db.sql("select count(*) from auth.users;")) - usersBefore} legacyAuthPhone=${db.sql(`select coalesce(phone,'null') from auth.users where id='${probe1.id}';`) === "null" ? "null" : "set"}`);
  if (newId) created.push(newId);

  // N2: updateUser({phone}) + phone_change verification on an alias account
  const sBefore = snapshot(ids(probe2));
  const pu = await h.call("PUT", "/auth/v1/user", { token: probe2.token, body: { phone: T(2) } });
  const pv = await h.call("POST", "/auth/v1/verify", { body: { type: "phone_change", phone: T(2), token: "000222" }, token: probe2.token });
  const sAfter = snapshot(ids(probe2));
  const k = sAfter[probe2.id];
  rec.evaluation("A2-NAT-2", "candidate:gotrue-native", "phone_change verification on an alias account preserves user.id and the email alias",
    `put=${pu.status} verify=${pv.status} responseUserIsSame=${pv.data?.user?.id === probe2.id} authPhoneSet=${k.auth.phone !== null} aliasUnchanged=${k.auth.email === sBefore[probe2.id].auth.email}`);
  rec.evaluation("A2-NAT-3", "candidate:gotrue-native", "…but it does NOT touch profiles.phone_verified_at (no link between GoTrue proof and the app's source of truth)",
    `profile.verified_at=${k.profile.verified_at === null ? "null" : "set"} profilePhoneUnchanged=${k.profile.phone_e164 === sBefore[probe2.id].profile.phone_e164}`);
  const o2 = await h.call("POST", "/auth/v1/otp", { body: { phone: T(2) } });
  const v2 = await h.call("POST", "/auth/v1/verify", { body: { type: "sms", phone: T(2), token: "000222" } });
  rec.evaluation("A2-NAT-4", "candidate:gotrue-native", "…and the verified number silently becomes a LOGIN credential for the same user (possession proof => login permission)",
    `otp=${o2.status} verify=${v2.status} sessionUserIsProbe=${v2.data?.user?.id === probe2.id}`);

  // N3: GoTrue ignores our reservation / cooldown rules
  const resNum = T(3);
  const pr = await reserve(probe3, resNum);
  const pu4 = await h.call("PUT", "/auth/v1/user", { token: probe4.token, body: { phone: resNum } });
  const pv4 = await h.call("POST", "/auth/v1/verify", { body: { type: "phone_change", phone: resNum, token: "000333" }, token: probe4.token });
  rec.evaluation("A2-NAT-5", "candidate:gotrue-native", "GoTrue phone uniqueness is independent of secondary reservations: a second account can verify a number another account has ACTIVELY reserved",
    `reserve=${out(pr)} otherPut=${pu4.status} otherVerify=${pv4.status} authPhoneNowHeld=${db.sql(`select count(*) from auth.users where phone='${resNum.slice(1)}';`)}`);

  const probeIds = [probe1.id, probe2.id, probe3.id, probe4.id, ...(newId ? [newId] : [])];
  rec.evaluation("A2-CAND-1", "candidate:db-authority", "DB-native challenge authority (prototype): binds account+number+purpose+claim, generic failures, single-use, no auth.users writes — see A2-AUTH-* / A2-CON-4..6", "prototype only; not applied");
  rec.evaluation("A2-CAND-2", "candidate:worker-d1", "Cloudflare Worker D1 as proof authority: NOT evaluated locally by design (Phase A doc s3.4: transport store must not be the proof authority)", "design decision, no test");

  // ------------------------------------------------------------------------------------ 8. identity invariance (legacy set)
  const afterSnap = await withState(snapshot(ids(...legacy)), legacy);
  results.snapshots.after = afterSnap;
  const drift = diffKeys(before, afterSnap);
  rec.check("A2-INV-1", "invariance", "Legacy fixtures: Auth user ids, login aliases, password digests, roles, memberships, capabilities, profile phones/usernames, MFA and registration state are byte-identical after every flow above",
    drift.length === 0 && same(before, afterSnap), drift.length ? `drift: ${drift.join(",")}` : "no drift");
  rec.check("A2-INV-2", "invariance", "No phone-verification flow added or changed an Auth user for the legacy set: users with auth.users.phone are only the GoTrue-native probes",
    db.sql(`select count(*) from auth.users where phone is not null and id <> all('{${probeIds.join(",")}}'::uuid[]);`) === "0");
  const postFlow = globalCounts();
  const expectedUsers = baselineGlobal.auth_users + (Object.keys(R).length + racers.length + Object.keys(V).length + 3 /*V6-V8*/ + 4 /*probes*/ + (newId ? 1 : 0));
  rec.check("A2-INV-3", "invariance", "Auth user count grew only by the accounts this run deliberately created (no hidden duplicates from reservation / authority flows)",
    postFlow.auth_users === expectedUsers, `before=${baselineGlobal.auth_users} after=${postFlow.auth_users} expected=${expectedUsers}`);
  rec.check("A2-INV-4", "invariance", "Every legacy user still has exactly one email identity and zero MFA factors", legacy.every((a) => afterSnap[a.id].identities.length === 1 && afterSnap[a.id].mfa_factors === 0));
  const stillSignIn = await Promise.all(legacy.map((a) => h.signInPassword(a.email, PASSWORD)));
  rec.check("A2-INV-5", "invariance", "Legacy accounts still sign in with the SAME password and receive the SAME user id", stillSignIn.every((r, i) => r.status === 200 && r.data.user.id === legacy[i].id));

  // ------------------------------------------------------------------------------------ 9. gaps: required scenarios not implemented today
  const fresh = await account("FreshSignup", { alias: true, withPhone: phone(), source: "temporary_craftsman_password_flow" });
  const freshState = (await h.rpc("my_registration_state", {}, fresh.token)).data;
  rec.gap("A2-GAP-2", "signup", "New phone sign-up must NOT reach app access before WhatsApp possession proof", `NOT IMPLEMENTED. A brand-new alias signup with no proof reports registration state '${freshState}' (= hasAppAccess true).`);
  rec.gap("A2-GAP-3", "signup", "Unverified pending identity cannot use protected features (server + DB enforcement, not only a form step)", "NOT IMPLEMENTED. No verified-phone predicate exists in my_registration_state or any RLS helper.");
  rec.gap("A2-GAP-4", "signup", "Mistyped signup number: edit invalidates the stale challenge and leaves no orphan/duplicate account", "NOT IMPLEMENTED in product (prototype A2-AUTH-10 shows the primitive; no signup wiring).");
  rec.gap("A2-GAP-5", "signup", "Expired/abandoned pending signup is cleaned up without orphan Auth users", "NOT IMPLEMENTED. No pending-verification lifecycle or expiry sweep exists.");
  rec.gap("A2-GAP-6", "secondary", "Durable VERIFIED secondary contact (active reservation -> verified contact-only claim) without extending or resurrecting the reservation",
    `NOT IMPLEMENTED. secondary_phone_reservations has no verified_* columns; status enum is ${db.sql("select string_agg(e.enumlabel, '/' order by e.enumsortorder) from pg_enum e where e.enumtypid='public.secondary_phone_status'::regtype;")} only.`);
  rec.gap("A2-GAP-7", "primary-change", "Verify-before-switch for primary phone replacement (old login not abandoned on an unreachable new number)", "NOT IMPLEMENTED. profile_set_phone / installer_phone_change_* switch immediately and only reset phone_verified_at.");
  rec.gap("A2-GAP-8", "authority", "Challenge store, resend/attempt limits and anti-replay in the application database",
    `NOT IMPLEMENTED. Existing relations matching otp/challenge/verification: ${db.sql(`select coalesce(string_agg(table_schema || '.' || table_name, ','), 'none') from information_schema.tables where table_schema in ('public','app') and table_name ~* '(otp|challenge|phone_verif)';`)}.`);
  rec.gap("A2-GAP-9", "abuse", "Turnstile / direct-API rate-limit bypass tests for a verification endpoint", "NOT TESTABLE: no verification endpoint exists yet (Phase B).");
  rec.gap("A2-GAP-10", "mfa", "TOTP enrollment + AAL2 step-up separate from contact proof", "Out of A2 scope (Phase D). Local evidence only: no MFA factor was created by any flow here.");

  // log hygiene: our synthetic numbers / OTP fixtures in service logs
  // docker writes container stderr separately from stdout: keep BOTH or the scan is vacuous.
  const logs = ["auth", "rest", "kong"].map((svc_) => { const r = spawnSync("docker", ["logs", `supabase_${svc_}_${t.container.replace("supabase_db_", "")}`], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }); return `${r.stdout ?? ""}
${r.stderr ?? ""}`; });
  const allLogs = logs.join("\n");
  rec.check("A2-LOG-0", "hygiene", "Log scan is not blind: it captured non-empty output from all three services", logs.every((l) => l.trim().length > 100), logs.map((l) => l.length).join("/"));
  const nums = [...usedPhones].filter((n) => !n.startsWith("20100999000"));
  const nonAlias = nums.filter((n) => !aliasDigits.has(n));
  const leaks = nonAlias.filter((n) => allLogs.includes(n)).length;
  const aliasInLogs = [...aliasDigits].filter((n) => allLogs.includes(n)).length;
  const otpLeak = ["000111", "000222", "000333"].filter((c) => allLogs.includes(c)).length;
  const nativeNums = ["201009990001", "201009990002", "201009990003"].filter((n) => allLogs.includes(n)).length;
  rec.check("A2-LOG-1", "hygiene", "Numbers that are NOT phone-login aliases (secondary reservations, org contacts, email-account phones, authority prototype) never appear in GoTrue, PostgREST or gateway logs", leaks === 0, `found=${leaks}/${nonAlias.length}`);
  rec.evaluation("A2-LOG-3", "hygiene", "SECURITY FINDING (pre-existing, by construction): a phone-login account's E.164 digits are embedded in its internal alias, and GoTrue prints the account email in user_signedup / login audit events, so those numbers are present in GoTrue logs", `aliasNumbersInGoTrueLogs=${aliasInLogs}/${aliasDigits.size}`);
  rec.evaluation("A2-LOG-2", "hygiene", "GoTrue-native probes: number / fake OTP presence in service logs", `nativeNumbersInLogs=${nativeNums}/3 fakeOtpsInLogs=${otpLeak}/3`);

  // zero paid sends
  rec.check("A2-SEND-1", "guard", "Zero sends: no Worker/Meta env in the local stack, hook disabled, fake provider credentials only",
    !/WHATSAPP|META_|GRAPH_API/i.test(execFileSync("docker", ["exec", t.container.replace("supabase_db_", "supabase_auth_"), "env"], { encoding: "utf8" })));
} catch (e) {
  rec.record("A2-HARNESS", "harness", "suite aborted", "FAIL", e.stack ?? String(e));
} finally {
  // ----------------------------------------------------------------------------------------- cleanup
  if (process.env.KEEP !== "1") {
    try { if (proto) db.sql("drop schema a2_proto cascade;"); } catch {}
    // Accounts that created an organization (or other audited rows) cannot be deleted: public.audit_log is append-only by design.
    // That is a product guard, so isolation comes from run_a2.sh resetting the ISOLATED local stack before each run; here we only
    // best-effort remove what can go and say how many fixtures were retained.
    let retained = 0;
    for (const id of created) { const r = await h.adminDeleteUser(id); if (r.status >= 300 && r.status !== 404) retained += 1; }
    if (retained) console.log(`[a2] ${retained} audited fixture account(s) retained (audit_log is append-only); run_a2.sh resets the isolated stack`);
  }
  const summary = rec.summary();
  console.log(JSON.stringify(summary));
  const dir = resolve(here, "../../../docs/security/phone-identity-a2");
  mkdirSync(dir, { recursive: true });
  const redactSnap = (s) => s && Object.fromEntries(Object.entries(s).map(([id, v], i) => [labelOf[id] ?? `fixture-${i + 1}`, {
    user_id: shortId(id), registration_state: v.registration_state, signin_user_matches: v.signin_user === id,
    auth: { alias_login: Boolean(v.auth.email?.endsWith("@craftsman-login.aladdin.invalid")), email_confirmed: v.auth.email_confirmed, auth_phone_set: v.auth.phone !== null, role: v.auth.role, source: v.auth.source },
    identities: v.identities.length, mfa_factors: v.mfa_factors, public_user: v.public_user,
    profile: { has_phone: v.profile.phone_e164 !== null, phone_verified: v.profile.verified_at !== null, username_set: v.profile.username !== null },
    memberships: v.memberships.map((m) => ({ org_type: m.org_type, status: m.status, capabilities: m.caps.length, org_contact_phone_set: m.org_contact_phone !== null })),
    platform_roles: v.platform_roles, admin_role_assignments: v.admin_role_assignments,
  }]));
  writeFileSync(resolve(dir, process.env.A2_EVIDENCE ?? "evidence.json"), `${JSON.stringify({
    suite: summary.suite, run: new Date().toISOString().slice(0, 10), summary,
    redaction: "phones masked to last 2 digits; aliases masked; user ids shortened; no tokens, passwords, hashes or raw OTPs recorded",
    results: rec.results, invariance: { before: redactSnap(results.snapshots.before), after: redactSnap(results.snapshots.after) },
  }, null, 2)}\n`);
  process.exitCode = summary.FAIL > 0 ? 1 : 0;
}
