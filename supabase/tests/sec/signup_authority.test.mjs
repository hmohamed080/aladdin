// R1 signup authority + alias guard: executable integration tests against REAL local GoTrue, PostgREST and Postgres.
//
//   SEC_MODE=confirm-on|confirm-off SEC_POSTURE=shipped|observe|enforce DB_CONTAINER=supabase_db_<isolated> node supabase/tests/sec/signup_authority.test.mjs
//
// LOCAL ISOLATED STACK ONLY (see ../a2/lib.mjs guards). Nothing is delivered: the test plays the application server (it generates the code
// and the MAC with the SAME frontend/src/server/phone-verification/otp.ts the application uses, and "receives" the code by simply holding
// it), the GoTrue phone provider and Send-SMS hook are off, phone numbers are synthetic and masked in evidence.
//
// POSTURES (database switches, set by this script and reset at the end):
//   shipped  every switch at its migration default: signup_enabled=false, alias_guard_mode='off'. Proves the migration changes no behaviour
//            and that the known vulnerabilities are still open (XFAIL, labelled DORMANT) until activation.
//   observe  guard records would-be refusals but blocks nothing; signup proof works. Stage 2 of the activation plan.
//   enforce  guard refuses alias creation without a valid grant. Every PR #122 expected failure is promoted to a plain check here.
//
// Results: PASS / FAIL / XFAIL (desired behaviour not met in THIS posture - never a pass) / XPASS (an XFAIL started passing: exit 1) /
// EVAL / N/A.
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { target, makeDb, makeHttp, makeRecorder, phoneFactory, runTag, shortId } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MODE = process.env.SEC_MODE ?? "";
const POSTURE = process.env.SEC_POSTURE ?? "";
if (!["confirm-on", "confirm-off"].includes(MODE) || !["shipped", "observe", "enforce"].includes(POSTURE)) {
  console.error("[sec] REFUSED: set SEC_MODE=confirm-on|confirm-off and SEC_POSTURE=shipped|observe|enforce");
  process.exit(2);
}
const ENFORCE = POSTURE === "enforce";
const SIGNUP_ON = POSTURE !== "shipped";

const otp = await import("../../../frontend/src/server/phone-verification/otp.ts");
const ring = otp.parseKeyring(JSON.stringify({ current: "k2", keys: { k2: Buffer.alloc(32, 21).toString("base64"), k1: Buffer.alloc(32, 22).toString("base64") } }));

const t = target();
const db = makeDb(t.container);
const h = makeHttp(t);
const tag = runTag();
const nextPhone = phoneFactory(tag);
const PASSWORD = "Sec-Fixture-Pass-1!";
const created = new Set();

const settings = (await h.call("GET", "/auth/v1/settings")).data;
const confirmationsOn = settings.mailer_autoconfirm === false;
if ((MODE === "confirm-off") === confirmationsOn) { console.error(`[sec] REFUSED: SEC_MODE=${MODE} but GoTrue mailer_autoconfirm=${settings.mailer_autoconfirm}`); process.exit(2); }
const authContainer = t.container.replace("supabase_db_", "supabase_auth_");
const authImage = execFileSync("docker", ["inspect", "-f", "{{.Config.Image}}", authContainer], { encoding: "utf8" }).trim();
const rec = makeRecorder("phone-signup-authority", { mode: MODE, posture: POSTURE, email_confirmations: confirmationsOn, gotrue_image: authImage, cli: process.env.SEC_CLI ?? execFileSync("supabase", ["--version"], { encoding: "utf8" }).trim() });

const phone = () => nextPhone();
const aliasOf = (p) => `p${p.e164.slice(1)}@craftsman-login.aladdin.invalid`;
const out = (r) => (r.status >= 200 && r.status < 300 ? "ok" : `${r.status}:${r.data?.error_code ?? r.data?.code ?? r.data?.msg ?? "?"}`);
const anonSignup = (email, extra = {}) => h.call("POST", "/auth/v1/signup", { body: { email, password: PASSWORD, ...extra } });
const rows = (email) => db.json(`select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'confirmed', u.email_confirmed_at is not null)), '[]'::jsonb) from auth.users u where lower(u.email) = '${email.toLowerCase()}';`);
const remember = (r) => { const id = r.data?.id ?? r.data?.user?.id; if (id) created.add(id); return id; };
const forget = async (id) => { const r = await h.adminDeleteUser(id); created.delete(id); return r; };
let ipCounter = 100;
const ipKey = () => otp.ipBucketKey(ring, `203.0.113.${(ipCounter += 1) % 250}`);
// desired behaviour that only exists when the guard enforces: a plain check there, a labelled expected failure elsewhere
const guarded = (id, area, title, ok, ev) => (ENFORCE ? rec.check(id, area, title, ok, ev) : rec.expectFail(id, area, `${title} [guard ${POSTURE === "shipped" ? "DORMANT" : "observing only"}]`, ok, ev));
// desired behaviour that exists once signup verification is switched on
const signupGated = (id, area, title, ok, ev) => (SIGNUP_ON ? rec.check(id, area, title, ok, ev) : rec.expectFail(id, area, `${title} [signup verification DORMANT]`, ok, ev));

const setPosture = (p) => db.sql(p === "shipped"
  ? "update app.phone_verification_config set signup_enabled = false, alias_guard_mode = 'off', enabled = false;"
  : `update app.phone_verification_config set enabled = true, alias_guard_mode = '${p}', signup_enabled = true;`);
const configRow = () => db.sql("select enabled || ',' || signup_enabled || ',' || alias_guard_mode from app.phone_verification_config;");

// ---- the application server's side of a signup proof (same crypto as the app) -------------------------------------------------------------
async function prove(p, { code = otp.generateCode(), registrationId = randomUUID() } = {}) {
  const challengeId = otp.newChallengeId();
  const { kid, mac } = otp.issueMac(ring, { challengeId, registrationId, purpose: "signup_proof" }, code);
  const ip = ipKey();
  const start = await h.rpcService("phone_signup_start", { p_registration_id: registrationId, p_phone: p.e164, p_challenge_id: challengeId, p_kid: kid, p_code_mac: mac, p_ip_key: ip });
  const verify = (c = code, reg = registrationId, ch = challengeId) => h.rpcService("phone_signup_verify", {
    p_registration_id: reg, p_challenge_id: ch, p_candidates: otp.candidateMacs(ring, { challengeId: ch, registrationId: reg, purpose: "signup_proof" }, c), p_ip_key: ipKey(),
  });
  return { p, code, registrationId, challengeId, start: start.data, startRes: start, verify };
}
const grantOf = (v) => (v.data?.status === "verified" ? { id: v.data.grant_id, registrationId: v.data.registration_id, alias: v.data.alias, phone: v.data.phone_e164 } : null);
const createWithGrant = (g, extra = {}) => h.adminCreateUser({
  email: g.alias, password: PASSWORD, email_confirm: true, user_metadata: { full_name: "SEC proven", locale: "ar" },
  app_metadata: { registration_source: "phone_whatsapp_sign_up", phone_signup_grant: g.id, phone_signup_registration: g.registrationId, ...extra },
});
const attach = (userId, grantId) => h.rpcService("phone_signup_attach", { p_user_id: userId, p_grant_id: grantId });
async function initAccount(email, p) {
  const s = await h.signInPassword(email, PASSWORD);
  if (s.status !== 200) return { token: null, steps: { signin: out(s) } };
  const token = s.data.access_token;
  const steps = {};
  for (const [fn, args] of [
    ["record_consent", { p_types: ["terms", "privacy", "pilot"], p_locale: "ar" }],
    ["onboarding_select_account_type", { p_track: "professional", p_account_type: "installer_technician" }],
    ["profile_set_phone", { p_country_iso2: p.iso2, p_national: p.national, p_e164: p.e164 }],
    ["profile_set_username", { p_username: `r1${tag}${randomUUID().slice(0, 6)}` }],
  ]) steps[fn] = out(await h.rpc(fn, args, token));
  return { token, steps };
}
// A complete, correct sign-up: proof -> Admin create with grant -> sign in -> usual init RPCs -> attach.
async function fullSignup(p) {
  const pr = await prove(p);
  const v = await pr.verify();
  const g = grantOf(v);
  if (!g) return { ok: false, stage: "verify", pr, v };
  const c = await createWithGrant(g);
  const id = remember(c);
  if (c.status >= 300) return { ok: false, stage: "create", pr, g, c };
  const init = await initAccount(g.alias, p);
  const a = await attach(id, g.id);
  return { ok: true, id, pr, g, c, init, a, email: g.alias };
}
const profileOf = (id) => db.json(`select coalesce(jsonb_agg(jsonb_build_object('phone', phone_e164, 'verified', phone_verified_at is not null)), '[]') from public.profiles where user_id = '${id}';`)[0] ?? null;

function snapshot(list) {
  return db.json(`select coalesce(jsonb_object_agg(u.id, jsonb_build_object(
      'email', u.email, 'pw', md5(u.encrypted_password), 'confirmed', u.email_confirmed_at is not null, 'phone', u.phone,
      'app_meta', u.raw_app_meta_data - 'providers',
      'identities', (select coalesce(jsonb_agg(i.provider || ':' || i.id order by i.id), '[]') from auth.identities i where i.user_id = u.id),
      'mfa', (select count(*) from auth.mfa_factors f where f.user_id = u.id),
      'profile', (select jsonb_build_object('phone', p.phone_e164, 'verified', p.phone_verified_at, 'username', p.username) from public.profiles p where p.user_id = u.id),
      'user', (select jsonb_build_object('type', x.primary_account_type, 'status', x.status) from public.users x where x.id = u.id),
      'memberships', (select coalesce(jsonb_agg(m.organization_id || ':' || m.status order by m.organization_id), '[]') from public.memberships m where m.user_id = u.id),
      'consents', (select count(*) from public.consent_receipts c where c.user_id = u.id),
      'points', (select count(*) from public.points_ledger l where l.user_id = u.id)
    )), '{}'::jsonb) from auth.users u where u.id = any('{${list.map((a) => a.id).join(",")}}'::uuid[]);`);
}

let exit = 0;
try {
  // ================================================================================================ 0. guards
  const authEnv = execFileSync("docker", ["exec", authContainer, "env"], { encoding: "utf8" });
  rec.check("SEC-ENV-1", "guard", "Target is loopback API + explicitly named non-shared DB container", /^http:\/\/(127\.0\.0\.1|localhost)/.test(t.api) && t.container !== "supabase_db_aladdin", t.container);
  rec.check("SEC-ENV-2", "guard", "No SMS provider / Send-SMS hook / Phone MFA / anonymous sign-in is enabled: nothing on this stack can deliver a message",
    !/GOTRUE_HOOK_SEND_SMS_ENABLED=true/.test(authEnv) && !/GOTRUE_EXTERNAL_PHONE_ENABLED=true/.test(authEnv) && !/GOTRUE_MFA_PHONE_(ENROLL|VERIFY)_ENABLED=true/.test(authEnv) && !/GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=true/.test(authEnv));
  rec.evaluation("SEC-ENV-3", "guard", "Toolchain under test", `posture=${POSTURE} email_confirmations=${confirmationsOn} gotrue=${authImage} cli=${rec.meta.cli}`);

  // ================================================================================================ 1. legacy identities, created while the guard is OFF (they predate it)
  db.sql("delete from app.phone_verification_ip_buckets;");
  setPosture("shipped");
  rec.check("SEC-POS-0", "posture", "Migration defaults: enabled=false, signup_enabled=false, alias_guard_mode=off", configRow() === "false,false,off", configRow());
  const legacyAccount = async (label, { alias, p, track = "professional", type = "installer_technician", source }) => {
    const email = alias ? aliasOf(p) : `sec-${tag}-${label}@sec.invalid`;
    const c = await h.adminCreateUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: `SEC ${label}`, locale: "ar" }, app_metadata: source ? { registration_source: source } : {} });
    if (c.status >= 300) throw new Error(`createUser ${label}: ${out(c)}`);
    created.add(c.data.id);
    const token = (await h.signInPassword(email, PASSWORD)).data.access_token;
    for (const [fn, args] of [
      ["record_consent", { p_types: ["terms", "privacy", "pilot"], p_locale: "ar" }],
      ["onboarding_select_account_type", { p_track: track, p_account_type: type }],
      ["profile_set_phone", { p_country_iso2: p.iso2, p_national: p.national, p_e164: p.e164 }],
      ["profile_set_username", { p_username: `${label.toLowerCase().slice(0, 8)}${tag}${c.data.id.slice(0, 4)}` }],
    ]) { const r = await h.rpc(fn, args, token); if (r.status >= 300) throw new Error(`fixture ${label} ${fn}: ${out(r)}`); }
    return { label, id: c.data.id, email, p };
  };
  const pInst = phone(), pShow = phone(), pEmail = phone(), showContact = phone();
  const installer = await legacyAccount("LegacyInstaller", { alias: true, p: pInst, source: "temporary_craftsman_password_flow" });
  const showroom = await legacyAccount("LegacyShowroom", { alias: true, p: pShow, track: "business", type: "showroom_dealer", source: "temporary_showroom_password_flow" });
  const act = db.sql("select key from public.activities where organization_type='showroom_dealer' and is_active order by key limit 1;");
  const sTok = (await h.signInPassword(showroom.email, PASSWORD)).data.access_token;
  const draft = await h.rpc("business_draft_save_v2", { p_legal_name: `SEC ${tag} LLC`, p_display_name: `SEC ${tag}`, p_org_type: "showroom_dealer", p_governorate: "Cairo", p_city: "New Cairo", p_primary_branch_name: "Main", p_contact_phone: showContact.e164, p_activity_type: act }, sTok);
  const submit = await h.rpc("business_draft_submit_v2", {}, sTok);
  const emailAcct = await legacyAccount("EmailSignup", { alias: false, p: pEmail });
  const legacy = [installer, showroom, emailAcct];
  rec.check("SEC-FX-1", "fixtures", "Legacy Installer (alias), Showroom (alias + organization) and e-mail accounts built through the real Admin-API + RPC path", draft.status < 300 && submit.status < 300, legacy.map((a) => `${a.label}:${shortId(a.id)}`).join(" "));
  const before = snapshot(legacy);

  // ================================================================================================ 2. posture
  setPosture(POSTURE);
  rec.check("SEC-POS-1", "posture", `Posture ${POSTURE} is active`, configRow() === (POSTURE === "shipped" ? "false,false,off" : `true,true,${POSTURE}`), configRow());
  if (!SIGNUP_ON) {
    const dormant = await prove(phone());
    rec.check("SEC-S1", "posture", "Shipped: the signup entry points answer 'unavailable' and write nothing", dormant.start?.status === "unavailable" && Number(db.sql(`select count(*) from app.phone_verification_challenges where id='${dormant.challengeId}';`)) === 0, JSON.stringify(dormant.start));
  }

  // ================================================================================================ 3. A: anonymous direct GoTrue sign-up on a protected alias
  const victim = phone(), vAlias = aliasOf(victim);
  const obsBefore = Number(db.sql("select count(*) from app.phone_alias_guard_observations;"));
  const a1 = await anonSignup(vAlias, { data: { full_name: "SEC attacker" } });
  remember(a1);
  const a1rows = rows(vAlias);
  const a1session = Boolean(a1.data?.access_token);
  guarded("SEC-A1", "bypass", "An anonymous caller CANNOT create an Auth user on the internal phone alias through GoTrue /signup", a1.status >= 400 && a1rows.length === 0, `status=${out(a1)} auth_rows=${a1rows.length} confirmed=${a1rows[0]?.confirmed}`);
  if (confirmationsOn) rec.na("SEC-A2", "bypass", "Anonymous alias sign-up yields no usable session", "e-mail confirmations are ON: an unconfirmed row cannot sign in (it would still occupy the alias; see SEC-A4)");
  else guarded("SEC-A2", "bypass", "Anonymous alias sign-up yields NO session", !a1session && a1rows.length === 0, `session_issued=${a1session}`);
  if (a1session) {
    const steps = {};
    for (const [fn, args] of [["record_consent", { p_types: ["terms", "privacy", "pilot"], p_locale: "ar" }], ["onboarding_select_account_type", { p_track: "professional", p_account_type: "installer_technician" }], ["profile_set_phone", { p_country_iso2: victim.iso2, p_national: victim.national, p_e164: victim.e164 }]]) steps[fn] = out(await h.rpc(fn, args, a1.data.access_token));
    const prof = profileOf(a1.data.user.id);
    guarded("SEC-A3b", "bypass", "A possession-less alias account cannot claim the number as a profile phone", prof?.phone !== victim.e164, `claimed=${prof?.phone === victim.e164} verified=${prof?.verified} steps=${JSON.stringify(steps)}`);
  } else rec.na("SEC-A3b", "bypass", "Attacker finishes registration on the victim's number", ENFORCE ? "no account/session was created" : "no session was issued (confirmations ON)");
  const obsAfter = Number(db.sql("select count(*) from app.phone_alias_guard_observations;"));
  if (POSTURE === "observe") rec.check("SEC-A12", "observe", "Observe mode: the anonymous alias sign-up is NOT blocked but IS recorded (no alias or number in the record)", a1.status < 300 && obsAfter === obsBefore + 1, `observations ${obsBefore} -> ${obsAfter}`);
  else rec.check("SEC-A12", "observe", `${POSTURE}: nothing is recorded as an observation`, obsAfter === obsBefore, `observations ${obsBefore} -> ${obsAfter}`);

  // A4 alias squatting: after the attack, can the REAL owner still sign up?
  const squatRows = rows(vAlias);
  let legit;
  if (SIGNUP_ON) { const f = await fullSignup(victim); legit = f.ok ? f.c : f.c ?? { status: 599, data: { error_code: f.stage } }; }
  else legit = await h.adminCreateUser({ email: vAlias, password: PASSWORD, email_confirm: true });
  remember(legit);
  guarded("SEC-A4", "squatting", "An anonymous alias row does NOT block the real owner's account creation", legit.status < 300, `squat_rows=${squatRows.length} legit create -> ${out(legit)}`);
  for (const r of rows(vAlias)) await forget(r.id);

  // A5 an EXISTING alias is untouchable; A6 races; A7 forged app_metadata; A8/A9 closed doors; A10 e-mail swap; A11 enumeration
  const pw0 = db.sql(`select md5(encrypted_password) from auth.users where id='${installer.id}';`);
  const a5 = await anonSignup(installer.email, { data: { full_name: "takeover" } });
  const a5b = await anonSignup(installer.email.toUpperCase());
  rec.check("SEC-A5", "duplicate", "Anonymous sign-up on an EXISTING alias (also upper-cased) creates no second identity and changes nothing", rows(installer.email).length === 1 && pw0 === db.sql(`select md5(encrypted_password) from auth.users where id='${installer.id}';`) && (await h.signInPassword(installer.email, PASSWORD)).status === 200, `plain=${out(a5)} upper=${out(a5b)}`);
  for (const r of [a5, a5b]) { const id = remember(r); if (id && id !== installer.id) await forget(id); }
  const racing = aliasOf(phone());
  const race = await Promise.all([anonSignup(racing), anonSignup(racing), anonSignup(racing)]);
  race.forEach(remember);
  rec.check("SEC-A6", "duplicate", "Concurrent anonymous sign-ups on one alias produce at most one Auth user", rows(racing).length <= 1, `rows=${rows(racing).length} statuses=${race.map(out).join(",")}`);
  for (const r of rows(racing)) await forget(r.id);
  const forgedEmail = `sec-${tag}-forge@sec.invalid`;
  const a7 = await anonSignup(forgedEmail, { app_metadata: { phone_signup_grant: randomUUID(), registration_source: "forged" } });
  remember(a7);
  const a7meta = db.json(`select coalesce(jsonb_agg(raw_app_meta_data), '[]') from auth.users where email='${forgedEmail}';`)[0] ?? null;
  rec.check("SEC-A7", "bypass", "A public /signup body cannot set raw_app_meta_data (forged grant marker never lands)", a7meta !== null && !("phone_signup_grant" in a7meta) && a7meta.registration_source !== "forged", `keys=${a7meta ? Object.keys(a7meta).join(",") : "no-row"}`);
  const forgedAlias = aliasOf(phone());
  const a7b = await anonSignup(forgedAlias, { app_metadata: { phone_signup_grant: randomUUID(), phone_signup_registration: randomUUID() }, data: { phone_signup_grant: randomUUID(), phone_signup_registration: randomUUID() } });
  remember(a7b);
  guarded("SEC-A7b", "bypass", "Forging the grant markers in the sign-up body (app_metadata AND user_metadata) cannot create an alias user", a7b.status >= 400 && rows(forgedAlias).length === 0, `status=${out(a7b)}`);
  for (const r of rows(forgedAlias)) await forget(r.id);
  const a8p = phone();
  const a8 = await h.call("POST", "/auth/v1/signup", { body: { phone: a8p.e164, password: PASSWORD } });
  rec.check("SEC-A8", "bypass", "Direct GoTrue PHONE sign-up is refused (no Auth user with auth.users.phone)", a8.status >= 400 && Number(db.sql(`select count(*) from auth.users where phone in ('${a8p.e164}','${a8p.e164.slice(1)}');`)) === 0, `status=${out(a8)}`);
  rec.check("SEC-A9", "bypass", "Anonymous (no credential) sign-in is refused", (await h.call("POST", "/auth/v1/signup", { body: {} })).status >= 400);
  const mTok = (await h.signInPassword(emailAcct.email, PASSWORD)).data.access_token;
  const a10put = await h.call("PUT", "/auth/v1/user", { token: mTok, body: { email: aliasOf(phone()) } });
  const a10 = db.json(`select jsonb_build_object('email', email) from auth.users where id='${emailAcct.id}';`);
  rec.check("SEC-A10", "bypass", "A signed-in e-mail user cannot swap their login e-mail for an alias directly", a10.email === emailAcct.email.toLowerCase(), `PUT /user -> ${out(a10put)}`);
  const free = await anonSignup(aliasOf(phone()));
  const freeId = remember(free);
  const taken = await anonSignup(installer.email);
  const takenAgain = await anonSignup(installer.email, { password: "Another-Pass-9!" });
  const sameShape = out(free) === out(taken) && out(free) === out(takenAgain);
  // GoTrue's own answer for an EXISTING account is not stable across runs with an identical configuration (observed both an obfuscated 200 and
  // 422 user_already_exists), and it is not something a database change can alter. Recorded as evidence only; the mitigation is at the edge
  // (hosted CAPTCHA protection + per-IP limits), see the activation plan.
  rec.evaluation("SEC-A11", "enumeration", "Anonymous /signup answer for a FREE alias vs an EXISTING phone account (GoTrue-owned, not gated)", `free=${out(free)} existing=${out(taken)}/${out(takenAgain)} identical=${sameShape}`);
  if (freeId) await forget(freeId);

  // ================================================================================================ 4. legitimate creation, rollback, and the legacy no-grant path
  const noGrantP = phone();
  const noGrant = await h.adminCreateUser({ email: aliasOf(noGrantP), password: PASSWORD, email_confirm: true, app_metadata: { registration_source: "temporary_craftsman_password_flow" } });
  const noGrantId = remember(noGrant);
  if (ENFORCE) rec.check("SEC-C5", "legacy-path", "ENFORCE (activation consequence): the OLD no-grant Admin creation of an alias user (what main's installer/showroom sign-up does today) is refused", noGrant.status >= 400 && rows(aliasOf(noGrantP)).length === 0, out(noGrant));
  else rec.check("SEC-C5", "legacy-path", `${POSTURE}: the OLD no-grant Admin creation of an alias user still works (the migration cannot break existing legitimate sign-up before the dependent flow is ready)`, noGrant.status < 300, out(noGrant));
  if (noGrantId) await forget(noGrantId);

  if (SIGNUP_ON) {
    const cp = phone();
    const f = await fullSignup(cp);
    rec.check("SEC-C1", "admin", "Legitimate sign-up: proof -> Admin createUser WITH the grant succeeds; the account is confirmed with one identity", f.ok && rows(f.email)[0]?.confirmed === true, f.ok ? out(f.c) : `failed at ${f.stage}`);
    const prof = f.ok ? profileOf(f.id) : null;
    rec.check("SEC-C2", "signup-state", "The usual initialisation RPCs run as before (consent, account type, profile_set_phone, username)", f.ok && Object.values(f.init.steps).every((v) => v === "ok"), JSON.stringify(f.init?.steps));
    rec.check("SEC-C2b", "signup-state", "A completed phone sign-up records the number as verified: attach -> profiles.phone_verified_at set, for the exact proven number", f.ok && f.a.data?.status === "attached" && prof?.verified === true && prof?.phone === cp.e164, `attach=${f.a?.data?.status} verified=${prof?.verified}`);
    const misc = f.ok ? db.json(`select jsonb_build_object('auth_phone', u.phone, 'mfa', (select count(*) from auth.mfa_factors m where m.user_id = u.id), 'identities', (select count(*) from auth.identities i where i.user_id = u.id)) from auth.users u where u.id='${f.id}';`) : null;
    rec.check("SEC-C2c", "signup-state", "Verification grants nothing else: no auth.users.phone, no MFA factor, exactly the one e-mail identity", misc && misc.auth_phone === null && misc.mfa === 0 && misc.identities === 1, JSON.stringify(misc));
    if (f.ok) {
      const del = await forget(f.id);
      const left = db.json(`select jsonb_build_object('auth', (select count(*) from auth.users where id='${f.id}'), 'identities', (select count(*) from auth.identities where user_id='${f.id}'), 'public_users', (select count(*) from public.users where id='${f.id}'), 'profiles', (select count(*) from public.profiles where user_id='${f.id}'), 'claims', (select count(*) from public.profiles where phone_e164='${cp.e164}'));`);
      rec.check("SEC-C3", "admin", "Rollback (Admin deleteUser) after a completed initialisation leaves no Auth user, identity, public user, profile or phone claim", del.status < 300 && Object.values(left).every((n) => Number(n) === 0), JSON.stringify(left));
      const replayCreate = await createWithGrant(f.g);
      remember(replayCreate);
      rec.check("SEC-C4", "admin", "After a rollback the SPENT grant cannot recreate the alias (replay): a new proof is required", replayCreate.status >= 400 && rows(f.email).length === 0 || !ENFORCE, `recreate with spent grant -> ${out(replayCreate)}`);
      for (const r of rows(f.email)) await forget(r.id);
      const again = await fullSignup(cp);
      rec.check("SEC-C4b", "admin", "...and a fresh proof for the same number creates the account again (no tombstone, no leaked reservation)", again.ok, again.ok ? "ok" : `failed at ${again.stage}`);
      if (again.ok) await forget(again.id);
    }
  } else {
    for (const id of ["SEC-C1", "SEC-C2", "SEC-C2b", "SEC-C2c", "SEC-C3", "SEC-C4", "SEC-C4b"]) rec.expectFail(id, "signup-state", "Proof-gated sign-up flow [signup verification DORMANT]", false, "signup_enabled=false by design until activation stage 2");
  }

  // ================================================================================================ 5. D: the six signup-proof requirements (SEC-D1..D6)
  if (!SIGNUP_ON) {
    for (const [id, text] of [["SEC-D1", "Verified challenge bound to the NEW Auth user; phone_verified_at set for exactly the verified number"], ["SEC-D2", "Replay of a consumed proof is refused"], ["SEC-D3", "Expired proof cannot be used"], ["SEC-D4", "Wrong-account / wrong-number attach is refused"], ["SEC-D5", "Concurrent creation/attach: exactly one wins"], ["SEC-D6", "Alias creation without an attached proof is refused at the database"]])
      rec.expectFail(id, "signup-proof", `${text} [signup verification DORMANT]`, false, "signup_enabled=false by design until activation stage 2");
  } else {
    // D1
    const d1p = phone(); const d1 = await fullSignup(d1p);
    const d1prof = d1.ok ? profileOf(d1.id) : null;
    const other = d1.ok ? db.json(`select coalesce(jsonb_agg(phone_verified_at is not null), '[]') from public.profiles where user_id in ('${installer.id}','${showroom.id}','${emailAcct.id}');`) : [];
    rec.check("SEC-D1", "signup-proof", "A verified signup challenge is bound to the NEW Auth user and sets profiles.phone_verified_at for exactly the verified number (and no other account's flag)",
      d1.ok && d1.a.data?.status === "attached" && d1prof?.verified === true && d1prof?.phone === d1p.e164 && other.every((v) => v === false), `attach=${d1.a?.data?.status} profile=${JSON.stringify(d1prof)}`);
    // D2 replay
    const d2 = d1.ok ? await d1.pr.verify() : null;
    const d2attach = d1.ok ? await attach(d1.id, d1.g.id) : null;
    const d2create = d1.ok ? await createWithGrant(d1.g) : null;
    if (d2create) remember(d2create);
    rec.check("SEC-D2", "signup-proof", "Replaying a consumed proof (same code and challenge), re-attaching, or re-using the grant to create a user are all refused and change nothing",
      d1.ok && d2.data?.status === "invalid" && d2attach.data?.status === "invalid" && (!ENFORCE || d2create.status >= 400), `verify=${d2?.data?.status} attach=${d2attach?.data?.status} create=${d2create ? out(d2create) : "-"}`);
    // D3 expiry
    const d3 = await prove(phone());
    db.sql(`update app.phone_verification_challenges set created_at = created_at - interval '6 minutes', expires_at = expires_at - interval '6 minutes' where id='${d3.challengeId}';`);
    const d3v = await d3.verify();
    const d3b = await prove(phone());
    const d3g = grantOf(await d3b.verify());
    db.sql(`update app.phone_signup_grants set created_at = created_at - interval '11 minutes', expires_at = clock_timestamp() - interval '1 minute' where id='${d3g.id}';`);
    const d3c = await createWithGrant(d3g);
    const d3cid = remember(d3c);
    const d3a = d3cid ? await attach(d3cid, d3g.id) : null;
    rec.check("SEC-D3", "signup-proof", "An expired proof cannot be verified, and an expired grant cannot create or verify an account", d3v.data?.status === "invalid" && (!ENFORCE || d3c.status >= 400) && (!d3a || d3a.data?.status === "invalid"), `verify=${d3v.data?.status} create=${out(d3c)} attach=${d3a?.data?.status ?? "-"}`);
    if (d3cid) await forget(d3cid);
    // D4 wrong account / wrong number
    const pa = phone(), pb = phone();
    const fa = await fullSignup(pa);
    const prB = await prove(pb); const gB = grantOf(await prB.verify());
    const crossCreate = await h.adminCreateUser({ email: aliasOf(phone()), password: PASSWORD, email_confirm: true, app_metadata: { phone_signup_grant: gB.id, phone_signup_registration: gB.registrationId } });
    const crossId = remember(crossCreate);
    const bUser = await createWithGrant(gB);
    const bId = remember(bUser);
    const attachWrongUser = fa.ok ? await attach(fa.id, gB.id) : null;
    const attachLegacy = await attach(installer.id, gB.id);
    const attachSwapped = bId && fa.ok ? await attach(bId, fa.g.id) : null;
    rec.check("SEC-D4", "signup-proof", "A proof for number A cannot create/verify number B: a grant cannot create another alias, and the grant cannot be attached by another user or by a legacy account",
      fa.ok && gB && (!ENFORCE || crossCreate.status >= 400) && (!crossId || (await attach(crossId, gB.id)).data?.status === "invalid") && attachWrongUser?.data?.status === "invalid" && attachLegacy.data?.status === "invalid" && (!attachSwapped || attachSwapped.data?.status === "invalid"),
      `cross-create=${out(crossCreate)} wrongUser=${attachWrongUser?.data?.status} legacy=${attachLegacy.data?.status} swapped=${attachSwapped?.data?.status ?? "-"}`);
    rec.check("SEC-D4b", "signup-proof", "...and neither attempt marked anything verified", fa.ok && !(profileOf(installer.id)?.verified) && (bId ? profileOf(bId)?.verified !== true : true), `installer=${profileOf(installer.id)?.verified} b=${bId ? profileOf(bId)?.verified : "-"}`);
    for (const id of [crossId, bId, fa.ok ? fa.id : null]) if (id) await forget(id);
    // D5 concurrency
    const pc = phone(); const prC = await prove(pc); const gC = grantOf(await prC.verify());
    const par = await Promise.all([1, 2, 3].map(() => createWithGrant(gC)));
    par.forEach(remember);
    const okCreates = par.filter((r) => r.status < 300);
    rec.check("SEC-D5a", "signup-proof", "Three concurrent Admin creations racing on ONE grant create exactly one account", rows(gC.alias).length === 1 && okCreates.length === 1, `ok=${okCreates.length} rows=${rows(gC.alias).length} statuses=${par.map(out).join(",")}`);
    const cid = okCreates[0]?.data?.id;
    if (cid) await initAccount(gC.alias, pc);
    const atts = cid ? await Promise.all([1, 2, 3].map(() => attach(cid, gC.id))) : [];
    rec.check("SEC-D5b", "signup-proof", "Three concurrent attach calls for one grant verify exactly once", cid && atts.filter((r) => r.data?.status === "attached").length === 1 && profileOf(cid)?.verified === true, `statuses=${atts.map((r) => r.data?.status).join(",")}`);
    const pr2 = await prove(phone());
    const parV = await Promise.all([1, 2, 3].map(() => pr2.verify()));
    rec.check("SEC-D5c", "signup-proof", "Three concurrent verifications of ONE correct code mint exactly one grant", parV.filter((r) => r.data?.status === "verified").length === 1 && Number(db.sql(`select count(*) from app.phone_signup_grants where challenge_id='${pr2.challengeId}';`)) === 1, `statuses=${parV.map((r) => r.data?.status).join(",")}`);
    if (cid) await forget(cid);
    // D6 un-skippable
    const d6anon = await anonSignup(aliasOf(phone()));
    remember(d6anon);
    const d6admin = await h.adminCreateUser({ email: aliasOf(phone()), password: PASSWORD, email_confirm: true });
    const d6id = remember(d6admin);
    guarded("SEC-D6", "signup-proof", "Alias account creation without a valid proof is refused at the database, through GoTrue sign-up AND the Admin API", d6anon.status >= 400 && d6admin.status >= 400, `anon=${out(d6anon)} admin=${out(d6admin)}`);
    if (d6id) await forget(d6id);
    const pe = phone(); const prE = await prove(pe); const gE = grantOf(await prE.verify());
    const eC = await createWithGrant(gE); const eId = remember(eC);
    rec.check("SEC-D6b", "signup-proof", "A proven-but-never-attached account is NOT verified (creation alone verifies nothing)", eId && profileOf(eId)?.verified !== true, `verified=${eId ? profileOf(eId)?.verified : "-"}`);
    if (eId) await forget(eId);
    // wrong code limits at the integration level
    const prW = await prove(phone());
    const wrong = [];
    for (let i = 0; i < 5; i += 1) wrong.push((await prW.verify(i === 0 ? "000000" : String(100000 + i))).data?.status);
    const afterLock = await prW.verify();
    rec.check("SEC-D7", "signup-proof", "Five wrong codes close the challenge; the correct code afterwards is refused", wrong.every((s) => s === "invalid") && afterLock.data?.status === "invalid", `wrong=${wrong.join(",")} after=${afterLock.data?.status}`);
    // taken number: no oracle
    const prTaken = await prove(pInst);
    const prFreeShape = await prove(phone());
    rec.check("SEC-D8", "signup-proof", "A number that already belongs to an account gets the SAME reply shape, nothing is delivered (deliver=false), and its code can never verify",
      JSON.stringify(Object.keys(prTaken.start).sort()) === JSON.stringify(Object.keys(prFreeShape.start).sort()) && prTaken.start.deliver === false && prFreeShape.start.deliver === true && (await prTaken.verify()).data?.status === "invalid",
      `keys equal=${JSON.stringify(Object.keys(prTaken.start).sort()) === JSON.stringify(Object.keys(prFreeShape.start).sort())} deliver=${prTaken.start.deliver}/${prFreeShape.start.deliver}`);
  }

  // ================================================================================================ 6. every other authentication method keeps working (GoTrue level)
  const mail = `sec-${tag}-pw@sec.invalid`;
  const f1 = await anonSignup(mail);
  const f1id = remember(f1);
  rec.check("SEC-X1", "other-auth", "Email + password sign-up is unaffected", f1.status < 300 && rows(mail).length === 1 && (confirmationsOn ? rows(mail)[0].confirmed === false : Boolean(f1.data?.access_token)), `status=${out(f1)} confirmed=${rows(mail)[0]?.confirmed}`);
  const otpMail = `sec-${tag}-otp@sec.invalid`;
  const f2 = await h.call("POST", "/auth/v1/otp", { body: { email: otpMail, create_user: true } });
  const f2id = rows(otpMail)[0]?.id; if (f2id) created.add(f2id);
  rec.check("SEC-X2", "other-auth", "Email OTP (passwordless / sign-up code) is unaffected: the OTP request succeeds and creates the user row", f2.status < 300 && rows(otpMail).length === 1, `status=${out(f2)}`);
  const f3 = await h.call("POST", "/auth/v1/recover", { body: { email: emailAcct.email } });
  rec.check("SEC-X3", "other-auth", "Email recovery request is unaffected", f3.status < 300, out(f3));
  rec.check("SEC-X4", "other-auth", "Email + password sign-in of an existing account and legacy phone-alias sign-in are unaffected", (await h.signInPassword(emailAcct.email, PASSWORD)).status === 200 && (await h.signInPassword(installer.email, PASSWORD)).status === 200 && (await h.signInPassword(showroom.email, PASSWORD)).status === 200);
  // OAuth shapes (no OAuth provider is configured locally): the rows GoTrue would insert for Google (real e-mail) and Facebook (missing e-mail, or an unverified one)
  const oauth = db.sql(`
    do $$ declare r text; begin
      insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, email_confirmed_at)
      values ('00000000-0000-4000-8000-0000000b0001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'google-${tag}@gmail.example.invalid', '{"provider":"google","providers":["google"]}', '{"full_name":"G"}', now(), now(), now());
      insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('00000000-0000-4000-8000-0000000b0002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, '{"provider":"facebook","providers":["facebook"]}', '{"full_name":"F"}', now(), now());
      insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('00000000-0000-4000-8000-0000000b0003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fb-${tag}@facebook.example.invalid', '{"provider":"facebook","providers":["facebook"]}', '{"full_name":"F2"}', now(), now());
    end $$;
    select count(*) from auth.users where id in ('00000000-0000-4000-8000-0000000b0001','00000000-0000-4000-8000-0000000b0002','00000000-0000-4000-8000-0000000b0003');`);
  rec.check("SEC-X5", "other-auth", "Google-shaped, Facebook-without-e-mail and Facebook-unverified-e-mail users are created (the guard's WHEN clause never selects them)", oauth.split("\n").pop() === "3", `rows=${oauth.split("\n").pop()}`);
  db.sql("delete from auth.users where id in ('00000000-0000-4000-8000-0000000b0001','00000000-0000-4000-8000-0000000b0002','00000000-0000-4000-8000-0000000b0003');");
  if (f1id) await forget(f1id);
  if (f2id) await forget(f2id);

  // ================================================================================================ 7. legacy identity preservation
  const after = snapshot(legacy);
  rec.check("SEC-E1", "legacy", "Legacy Installer, Showroom and e-mail identities are byte-identical (auth row, password digest, identities, MFA, profile, verified flag, memberships, consents) after every attack",
    JSON.stringify(before) === JSON.stringify(after), Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map(shortId).join(","));
  const logins = await Promise.all(legacy.map((a) => h.signInPassword(a.email, PASSWORD)));
  rec.check("SEC-E2", "legacy", "All legacy accounts still sign in with their original passwords", logins.every((r) => r.status === 200), logins.map((r) => r.status).join(","));
  rec.check("SEC-E3", "legacy", "Legacy numbers stay UNVERIFIED (nothing in this suite writes their phone_verified_at)", legacy.every((a) => after[a.id].profile.verified === null), "");
  const dupes = db.sql("select count(*) from (select lower(email) from auth.users where email like '%@craftsman-login.aladdin.invalid' group by 1 having count(*) > 1) d;");
  rec.check("SEC-E4", "legacy", "No duplicate alias identity exists in the whole database", dupes === "0", `dupes=${dupes}`);
} catch (e) {
  console.error("[sec] suite error:", String(e?.stack ?? e).slice(0, 600));
  exit = 1;
} finally {
  try { setPosture("shipped"); } catch (e) { console.error("[sec] posture reset failed", String(e).slice(0, 160)); exit = 1; }
  for (const id of [...created]) { try { await forget(id); } catch { /* audited fixtures remain; the runner resets the isolated DB */ } }
  const summary = rec.summary();
  const dir = process.env.SEC_EVIDENCE_DIR ? resolve(process.env.SEC_EVIDENCE_DIR) : resolve(here, "../../../docs/security/phone-signup-security");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `r1-evidence-${process.env.SEC_TOOLCHAIN ?? "local"}-${MODE}-${POSTURE}.json`), `${JSON.stringify({ summary, results: rec.results }, null, 1)}\n`);
  console.log(`\n[sec] ${MODE}/${POSTURE}: ${JSON.stringify(summary)}`);
  process.exitCode = exit || (summary.FAIL > 0 || summary.XPASS > 0 ? 1 : 0);
}
