// DESIGN-EVIDENCE PROBE (kept from PR #122). Runs against a stack whose alias guard is OFF (the migration default). It records WHY the
// R1 guard is a deferred constraint trigger (scratch BEFORE INSERT / deferred / hook candidates). The behaviour of the real guard and the
// signup authority is tested by signup_authority.test.mjs.
//
// Phone-signup security regression suite (TESTS FIRST; no registration implementation is changed by this branch).
//
//   SEC_MODE=confirm-on|confirm-off|hook DB_CONTAINER=supabase_db_<isolated> node supabase/tests/sec/phone_signup_security.test.mjs
//
// LOCAL ISOLATED STACK ONLY (see ../a2/lib.mjs guards). No WhatsApp / Meta / SMS / e-mail is sent: the GoTrue phone provider
// is off, e-mail goes to the local Inbucket, phone numbers are synthetic and masked in evidence, no OTP is ever generated.
// Existing identity records are never edited to simulate verification.
//
// Result vocabulary (see lib.mjs): PASS · FAIL · XFAIL (desired behaviour NOT met today: confirmed vulnerability or
// unimplemented requirement) · XPASS (an XFAIL started passing: promote it) · EVAL · N/A.
//
// The three SEC_MODEs are three local GoTrue configurations (supabase/tests/sec/run_sec.sh switches the uncommitted local
// config and restarts the isolated stack):
//   confirm-on   [auth.email] enable_confirmations = true   (the repository default)
//   confirm-off  [auth.email] enable_confirmations = false  (what a hosted project may be running; see the review)
//   hook         confirm-on + the Auth `before_user_created` hook pointed at a probe function (design evaluation only)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { target, makeDb, makeHttp, makeRecorder, phoneFactory, runTag, shortId, mask } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MODE = process.env.SEC_MODE ?? "";
if (!["confirm-on", "confirm-off", "hook"].includes(MODE)) { console.error("[sec] REFUSED: set SEC_MODE=confirm-on|confirm-off|hook"); process.exit(2); }

const t = target();
const db = makeDb(t.container);
const h = makeHttp(t);
const tag = runTag();
const nextPhone = phoneFactory(tag);
const PASSWORD = "Sec-Fixture-Pass-1!";
const created = new Set(); // auth user ids to delete at the end (best effort; audit-bearing fixtures stay, the DB is reset per run)

const settings = (await h.call("GET", "/auth/v1/settings")).data;
const confirmationsOn = settings.mailer_autoconfirm === false;
if ((MODE === "confirm-off") === confirmationsOn) {
  console.error(`[sec] REFUSED: SEC_MODE=${MODE} but the running GoTrue has mailer_autoconfirm=${settings.mailer_autoconfirm}. Run through run_sec.sh.`);
  process.exit(2);
}
const authContainer = t.container.replace("supabase_db_", "supabase_auth_");
const authImage = execFileSync("docker", ["inspect", "-f", "{{.Config.Image}}", authContainer], { encoding: "utf8" }).trim();
const rec = makeRecorder("phone-signup-security", { mode: MODE, email_confirmations: confirmationsOn, gotrue_image: authImage, cli: execFileSync("supabase", ["--version"], { encoding: "utf8" }).trim() });

const phone = () => nextPhone();
const aliasOf = (p) => `p${p.e164.slice(1)}@craftsman-login.aladdin.invalid`;
const out = (r) => (r.status >= 200 && r.status < 300 ? "ok" : `${r.status}:${r.data?.error_code ?? r.data?.code ?? r.data?.msg ?? "?"}`);
const anonSignup = (email, extra = {}) => h.call("POST", "/auth/v1/signup", { body: { email, password: PASSWORD, ...extra } });
const rows = (email) => db.json(`select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'confirmed', u.email_confirmed_at is not null,
  'identities', (select count(*) from auth.identities i where i.user_id = u.id))), '[]'::jsonb) from auth.users u where lower(u.email) = '${email.toLowerCase()}';`);
const remember = (r) => { const id = r.data?.id ?? r.data?.user?.id; if (id) created.add(id); return id; };
const forget = async (id) => { const r = await h.adminDeleteUser(id); created.delete(id); return r; };

async function bootstrap(token, p, label) {
  const steps = [
    ["record_consent", { p_types: ["terms", "privacy", "pilot"], p_locale: "ar" }],
    ["onboarding_select_account_type", { p_track: "professional", p_account_type: "installer_technician" }],
    ["profile_set_phone", { p_country_iso2: p.iso2, p_national: p.national, p_e164: p.e164 }],
    ["profile_set_username", { p_username: `${label}${tag}${String(Math.floor(Math.random() * 9000) + 1000)}`.slice(0, 24) }],
  ];
  const res = {};
  for (const [fn, args] of steps) res[fn] = out(await h.rpc(fn, args, token));
  return res;
}

// A fixture exactly the way the existing phone sign-up (#113 `createPhoneSignUpUser`) and A2 build one: Admin createUser with
// email_confirm, password sign-in, then the same RPCs a signed-in user runs.
async function legacyAccount(label, { alias, p, track = "professional", type = "installer_technician", source }) {
  const email = alias ? aliasOf(p) : `sec-${tag}-${label}@sec.invalid`;
  const c = await h.adminCreateUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: `SEC ${label}`, locale: "ar" }, app_metadata: source ? { registration_source: source } : {} });
  if (c.status >= 300) throw new Error(`createUser ${label}: ${out(c)}`);
  created.add(c.data.id);
  const s = await h.signInPassword(email, PASSWORD);
  const token = s.data.access_token;
  for (const [fn, args] of [
    ["record_consent", { p_types: ["terms", "privacy", "pilot"], p_locale: "ar" }],
    ["onboarding_select_account_type", { p_track: track, p_account_type: type }],
    ["profile_set_phone", { p_country_iso2: p.iso2, p_national: p.national, p_e164: p.e164 }],
    ["profile_set_username", { p_username: `${label.toLowerCase().slice(0, 8)}${tag}${c.data.id.slice(0, 4)}` }],
  ]) { const r = await h.rpc(fn, args, token); if (r.status >= 300) throw new Error(`fixture ${label} ${fn}: ${out(r)}`); }
  return { label, id: c.data.id, email, p };
}

function snapshot(list) {
  return db.json(`select coalesce(jsonb_object_agg(u.id, jsonb_build_object(
      'email', u.email, 'pw', md5(u.encrypted_password), 'confirmed', u.email_confirmed_at is not null, 'phone', u.phone,
      'app_meta', u.raw_app_meta_data - 'providers',
      'identities', (select coalesce(jsonb_agg(i.provider || ':' || i.id order by i.id), '[]') from auth.identities i where i.user_id = u.id),
      'profile', (select jsonb_build_object('phone', p.phone_e164, 'verified', p.phone_verified_at, 'username', p.username) from public.profiles p where p.user_id = u.id),
      'memberships', (select coalesce(jsonb_agg(m.organization_id order by m.organization_id), '[]') from public.memberships m where m.user_id = u.id)
    )), '{}'::jsonb) from auth.users u where u.id = any('{${list.map((a) => a.id).join(",")}}'::uuid[]);`);
}

const results = { fixtures: {} };
try {
  // ================================================================================================ 0. environment guards
  const authEnv = execFileSync("docker", ["exec", authContainer, "env"], { encoding: "utf8" });
  rec.check("SEC-ENV-1", "guard", "Target is loopback API + explicitly named non-shared DB container", /^http:\/\/(127\.0\.0\.1|localhost)/.test(t.api) && t.container !== "supabase_db_aladdin", t.container);
  rec.check("SEC-ENV-2", "guard", "No SMS provider / Send SMS Hook / Phone MFA is enabled: nothing on this stack can deliver a message",
    !/GOTRUE_HOOK_SEND_SMS_ENABLED=true/.test(authEnv) && !/GOTRUE_EXTERNAL_PHONE_ENABLED=true/.test(authEnv) && !/GOTRUE_MFA_PHONE_(ENROLL|VERIFY)_ENABLED=true/.test(authEnv));
  rec.check("SEC-ENV-3", "guard", "Anonymous sign-ins are disabled and phone sign-up is disabled in GoTrue", settings.disable_signup === false && !settings.external?.phone && !/GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=true/.test(authEnv));
  rec.evaluation("SEC-ENV-4", "guard", "GoTrue mode under test", `email_confirmations=${confirmationsOn} mailer_autoconfirm=${settings.mailer_autoconfirm} image=${authImage}`);

  db.sql(`
    create schema if not exists sec_probe;
    create table if not exists sec_probe.seen (id bigserial primary key, src text, email text, app_meta jsonb, user_meta jsonb, confirmed boolean,
      cur text, sess text, jwt text, hdr text, appname text, extra jsonb);
    grant usage on schema sec_probe to supabase_auth_admin;
    grant insert, select on sec_probe.seen to supabase_auth_admin;
    grant usage on all sequences in schema sec_probe to supabase_auth_admin;
    create table if not exists sec_probe.cfg (reject boolean not null default false);
    insert into sec_probe.cfg select false where not exists (select 1 from sec_probe.cfg);
    update sec_probe.cfg set reject = false;
    grant select on sec_probe.cfg to supabase_auth_admin;
    create or replace function public.sec_probe_hook(event jsonb) returns jsonb language plpgsql as $f$
    declare r boolean;
    begin
      insert into sec_probe.seen (src, email, app_meta, user_meta, extra) values ('hook', event->'user'->>'email', event->'user'->'app_metadata', event->'user'->'user_metadata', event->'metadata');
      select reject into r from sec_probe.cfg limit 1;
      if r and lower(event->'user'->>'email') ~ '^p[1-9][0-9]{6,14}@craftsman-login\\.aladdin\\.invalid$' then
        return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'phone alias sign-up is not allowed'));
      end if;
      return '{}'::jsonb;
    end $f$;
    grant execute on function public.sec_probe_hook(jsonb) to supabase_auth_admin;`);

  // ================================================================================================ 1. legacy identities (E-block baseline)
  const pInst = phone(), pShow = phone(), pEmail = phone(), showContact = phone();
  const installer = await legacyAccount("LegacyInstaller", { alias: true, p: pInst, source: "temporary_craftsman_password_flow" });
  const showroom = await legacyAccount("LegacyShowroom", { alias: true, p: pShow, track: "business", type: "showroom_dealer", source: "temporary_showroom_password_flow" });
  const act = db.sql("select key from public.activities where organization_type='showroom_dealer' and is_active order by key limit 1;");
  const sTok = (await h.signInPassword(showroom.email, PASSWORD)).data.access_token;
  const draft = await h.rpc("business_draft_save_v2", { p_legal_name: `SEC ${tag} LLC`, p_display_name: `SEC ${tag}`, p_org_type: "showroom_dealer", p_governorate: "Cairo", p_city: "New Cairo", p_primary_branch_name: "Main", p_contact_phone: showContact.e164, p_activity_type: act }, sTok);
  const submit = await h.rpc("business_draft_submit_v2", {}, sTok);
  const emailAcct = await legacyAccount("EmailSignup", { alias: false, p: pEmail });
  const legacy = [installer, showroom, emailAcct];
  rec.check("SEC-FX-1", "fixtures", "Legacy Installer (alias), Showroom (alias + organization) and e-mail accounts built through the real Admin-API + RPC path", draft.status < 300 && submit.status < 300 && legacy.every((a) => a.id), legacy.map((a) => `${a.label}:${shortId(a.id)}`).join(" "));
  const before = snapshot(legacy);
  const probeP = phone();

  // ================================================================================================ 2. A: anonymous direct GoTrue sign-up with the internal alias
  const victim = phone();
  const vAlias = aliasOf(victim);
  const a1 = await anonSignup(vAlias, { data: { full_name: "SEC attacker" } });
  remember(a1);
  const a1rows = rows(vAlias);
  const a1session = Boolean(a1.data?.access_token);
  rec.expectFail("SEC-A1", "bypass", "An anonymous caller CANNOT create an Auth user on the internal phone alias through GoTrue /signup (possession of the number has not been proven)",
    a1.status >= 400 && a1rows.length === 0, `status=${out(a1)} auth_rows=${a1rows.length} confirmed=${a1rows[0]?.confirmed} identities=${a1rows[0]?.identities}`);
  if (confirmationsOn) rec.na("SEC-A2", "bypass", "Anonymous alias sign-up yields no usable session", "e-mail confirmations are ON: the alias row exists but is unconfirmed and cannot sign in (it still occupies the alias; see SEC-A4)");
  else rec.expectFail("SEC-A2", "bypass", "Anonymous alias sign-up yields NO session (no login without possession proof)", !a1session && a1rows.length === 0, `session_issued=${a1session} confirmed=${a1rows[0]?.confirmed}`);

  // A3: what an attacker does with the session when confirmations are OFF (consequence evidence, not a separate desire).
  if (!confirmationsOn && a1session) {
    const steps = await bootstrap(a1.data.access_token, victim, "atk");
    const prof = db.json(`select coalesce(jsonb_agg(jsonb_build_object('phone', phone_e164, 'verified', phone_verified_at is not null)), '[]') from public.profiles where user_id = '${a1.data.user.id}';`);
    const state = (await h.rpc("my_registration_state", {}, a1.data.access_token)).data;
    rec.evaluation("SEC-A3", "bypass", "CONSEQUENCE with confirmations OFF: the attacker finishes registration on the victim's number without any code",
      `steps=${JSON.stringify(steps)} profile=${JSON.stringify(prof)} registration_state=${JSON.stringify(state)}`);
    rec.expectFail("SEC-A3b", "bypass", "A possession-less alias account cannot claim the number as a profile phone", prof[0]?.phone !== victim.e164, `claimed=${prof[0]?.phone === victim.e164} verified=${prof[0]?.verified}`);
  } else rec.na("SEC-A3", "bypass", "Attacker completes registration on the victim's number", confirmationsOn ? "needs a session; confirmations are ON" : "no session was issued");

  // A4: alias squatting vs the legitimate server-side creation (what #113 does after a proven code).
  const legit = await h.adminCreateUser({ email: vAlias, password: PASSWORD, email_confirm: true, user_metadata: { full_name: "SEC legit" } });
  const legitId = remember(legit);
  rec.expectFail("SEC-A4", "squatting", "A pre-existing anonymous alias row does NOT block the real owner's server-side account creation", legit.status < 300, `admin createUser after the anonymous sign-up -> ${out(legit)}`);
  // clean the squat so later blocks start clean
  for (const r of rows(vAlias)) await forget(r.id);
  if (legitId) await forget(legitId);

  // A5: the reverse order must never let a public caller touch an EXISTING alias account.
  const pw0 = db.sql(`select md5(encrypted_password) from auth.users where id='${installer.id}';`);
  const a5 = await anonSignup(installer.email, { data: { full_name: "takeover" } });
  const a5b = await anonSignup(installer.email.toUpperCase(), {});
  const pw1 = db.sql(`select md5(encrypted_password) from auth.users where id='${installer.id}';`);
  rec.check("SEC-A5", "duplicate", "Anonymous sign-up on an EXISTING alias (also upper-cased) creates no second identity and changes nothing on the original",
    rows(installer.email).length === 1 && pw0 === pw1 && (await h.signInPassword(installer.email, PASSWORD)).status === 200, `plain=${out(a5)} upper=${out(a5b)}`);
  for (const r of [a5, a5b]) { const id = remember(r); if (id && id !== installer.id) await forget(id); }

  // A6: two concurrent anonymous sign-ups on one fresh alias -> exactly one row (uniqueness holds), duplicates impossible.
  const racing = aliasOf(phone());
  const race = await Promise.all([anonSignup(racing), anonSignup(racing), anonSignup(racing)]);
  race.forEach(remember);
  rec.check("SEC-A6", "duplicate", "Concurrent anonymous sign-ups on the same alias produce at most one Auth user", rows(racing).length <= 1, `rows=${rows(racing).length} statuses=${race.map(out).join(",")}`);
  for (const r of rows(racing)) await forget(r.id);

  // A7: a public caller cannot plant app_metadata (the only field an Admin-API caller can set that a public caller cannot).
  const forgedEmail = `sec-${tag}-forge@sec.invalid`;
  const a7 = await anonSignup(forgedEmail, { app_metadata: { phone_signup_grant: "forged", registration_source: "forged" }, data: { app_metadata: { forged: true } } });
  remember(a7);
  const a7meta = db.json(`select coalesce(jsonb_agg(raw_app_meta_data), '[]') from auth.users where email='${forgedEmail}';`)[0] ?? null;
  rec.check("SEC-A7", "bypass", "A public /signup body cannot set raw_app_meta_data (forged keys never reach auth.users.raw_app_meta_data)",
    a7meta !== null && !("phone_signup_grant" in a7meta) && a7meta.registration_source !== "forged", `app_meta_keys=${a7meta ? Object.keys(a7meta).join(",") : "no-row"}`);

  // A8/A9: direct phone sign-up and anonymous sign-in must stay closed.
  const a8 = await h.call("POST", "/auth/v1/signup", { body: { phone: probeP.e164, password: PASSWORD } });
  rec.check("SEC-A8", "bypass", "Direct GoTrue PHONE sign-up is refused (no Auth user with auth.users.phone)", a8.status >= 400 && Number(db.sql(`select count(*) from auth.users where phone='${probeP.e164.slice(1)}' or phone='${probeP.e164}';`)) === 0, `status=${out(a8)}`);
  const a9 = await h.call("POST", "/auth/v1/signup", { body: {} });
  rec.check("SEC-A9", "bypass", "Anonymous (no credential) sign-in is refused", a9.status >= 400, `status=${out(a9)}`);

  // A10: an e-mail account cannot become an alias account by changing its e-mail (existing UPDATE guard; deeper cover: pgTAP 107).
  const mTok = (await h.signInPassword(emailAcct.email, PASSWORD)).data.access_token;
  const a10put = await h.call("PUT", "/auth/v1/user", { token: mTok, body: { email: aliasOf(phone()) } });
  const a10 = db.json(`select jsonb_build_object('email', email, 'pending', email_change) from auth.users where id='${emailAcct.id}';`);
  rec.check("SEC-A10", "bypass", "A signed-in e-mail user cannot swap their login e-mail for an alias directly (email column unchanged; the change can only stay PENDING until confirmed, where the existing UPDATE guard, pgTAP 107, decides)",
    a10.email === emailAcct.email.toLowerCase(), `PUT /user -> ${out(a10put)} pending_change_recorded=${Boolean(a10.pending)}`);

  // A11: phone-number existence oracle through the internal alias (anonymous caller, GoTrue /signup).
  const free = await anonSignup(aliasOf(phone()));
  remember(free);
  const taken = await anonSignup(installer.email);
  const takenAgain = await anonSignup(installer.email, { password: "Another-Pass-9!" });
  const sameShape = out(free) === out(taken) && out(free) === out(takenAgain);
  const oracleText = "Anonymous /signup answers identically for a FREE alias and for the alias of an EXISTING phone account (no phone-number existence oracle)";
  // GoTrue obfuscates an existing confirmed user only while e-mail confirmations are ON; with them OFF it answers 422 user_already_exists.
  // (One 422 was also seen once in an early confirm-on run and not reproduced in 8 later requests; if it recurs this guard FAILS loudly.)
  if (confirmationsOn) rec.check("SEC-A11", "enumeration", `${oracleText} [confirmations ON: GoTrue obfuscates]`, sameShape, `free=${out(free)} existing=${out(taken)}/${out(takenAgain)}`);
  else rec.expectFail("SEC-A11", "enumeration", `${oracleText} [confirmations OFF: GoTrue answers 422]`, sameShape, `free=${out(free)} existing=${out(taken)}/${out(takenAgain)}`);
  const freeId = remember(free);
  if (freeId) await forget(freeId);

  // ================================================================================================ 3. C: legitimate Admin API creation and rollback
  const cp = phone(), cAlias = aliasOf(cp);
  const c1 = await h.adminCreateUser({ email: cAlias, password: PASSWORD, email_confirm: true, user_metadata: { full_name: "SEC admin", locale: "en" }, app_metadata: { registration_source: "phone_signup_whatsapp" } });
  const cid = remember(c1);
  rec.check("SEC-C1", "admin", "Legitimate Admin-API creation of an alias account (what the sign-up does after a proven code) works and is confirmed with one identity",
    c1.status < 300 && rows(cAlias)[0]?.confirmed === true && rows(cAlias)[0]?.identities === 1, out(c1));
  const cs = await h.signInPassword(cAlias, PASSWORD);
  const cInit = cs.status === 200 ? await bootstrap(cs.data.access_token, cp, "adm") : { signin: out(cs) };
  const prof = db.json(`select coalesce(jsonb_agg(jsonb_build_object('phone', phone_e164, 'verified_at', phone_verified_at)), '[]') from public.profiles where user_id='${cid}';`)[0];
  rec.evaluation("SEC-C2", "admin", "BASELINE (#113 sequence): after createUser -> sign-in -> consent -> account type -> profile_set_phone, the canonical verified flag is", `profile=${JSON.stringify(prof)} steps=${JSON.stringify(cInit)}`);
  rec.expectFail("SEC-C2b", "signup-state", "A completed phone sign-up records the number as verified (profiles.phone_verified_at set, exact number) -- needs a proof-bound writer, see SEC-D", Boolean(prof?.verified_at) && prof?.phone === cp.e164, `phone_verified_at=${prof?.verified_at ?? "NULL"}`);
  const del = await forget(cid);
  const left = db.json(`select jsonb_build_object('auth', (select count(*) from auth.users where id='${cid}'), 'identities', (select count(*) from auth.identities where user_id='${cid}'),
    'public_users', (select count(*) from public.users where id='${cid}'), 'profiles', (select count(*) from public.profiles where user_id='${cid}'),
    'phone_claims', (select count(*) from public.profiles where phone_e164='${cp.e164}'));`);
  rec.check("SEC-C3", "admin", "Rollback (Admin deleteUser) after a completed initialisation leaves no Auth user, identity, public user, profile or phone claim", del.status < 300 && Object.values(left).every((n) => Number(n) === 0), JSON.stringify(left));
  const again = await h.adminCreateUser({ email: cAlias, password: PASSWORD, email_confirm: true });
  const againId = remember(again);
  rec.check("SEC-C4", "admin", "After a rollback the same alias can be created again (no tombstone, no leaked reservation)", again.status < 300, out(again));
  if (againId) await forget(againId);

  // ================================================================================================ 4. B: can a database trigger tell Admin creation from public sign-up? (REAL GoTrue)
  db.sql(`
    create or replace function sec_probe.cap() returns trigger language plpgsql as $f$
    begin
      insert into sec_probe.seen (src, email, app_meta, user_meta, confirmed, cur, sess, jwt, hdr, appname, extra)
      values ('trigger', NEW.email, NEW.raw_app_meta_data, NEW.raw_user_meta_data, NEW.email_confirmed_at is not null, current_user, session_user,
              current_setting('request.jwt.claims', true), current_setting('request.headers', true), current_setting('application_name', true),
              jsonb_build_object('txid', txid_current()::text));
      return NEW;
    end $f$;
    create or replace function sec_probe.cap_upd() returns trigger language plpgsql as $f$
    begin
      insert into sec_probe.seen (src, email, app_meta, extra) values ('update', NEW.email, NEW.raw_app_meta_data, jsonb_build_object('txid', txid_current()::text));
      return NEW;
    end $f$;
    drop trigger if exists sec_probe_cap on auth.users;
    drop trigger if exists sec_probe_cap_upd on auth.users;
    create trigger sec_probe_cap before insert on auth.users for each row execute function sec_probe.cap();
    create trigger sec_probe_cap_upd after update on auth.users for each row execute function sec_probe.cap_upd();
    -- (the before_user_created probe function is created at the top of the run: in hook mode GoTrue calls it for every sign-up)`);
  const bp = [phone(), phone(), phone()].map(aliasOf);
  const b1 = await anonSignup(bp[0], { app_metadata: { sec_marker: "forged-by-public" }, data: { sec_marker: "user-meta-by-public" } });
  const b2 = await h.adminCreateUser({ email: bp[1], password: PASSWORD, email_confirm: true, app_metadata: { sec_marker: "set-by-admin" }, user_metadata: { sec_marker: "user-meta-by-admin" } });
  const b3 = await h.adminCreateUser({ email: bp[2], password: PASSWORD, email_confirm: false });
  [b1, b2, b3].forEach(remember);
  const seen = (email, src = "trigger") => db.json(`select coalesce(jsonb_agg(to_jsonb(s)), '[]') from sec_probe.seen s where s.email='${email}' and s.src='${src}';`)[0] ?? null;
  const [s1, s2, s3] = bp.map((e) => seen(e));
  const brief = (s) => (s ? `cur=${s.cur} sess=${s.sess} jwt=${s.jwt ?? "NULL"} hdr=${s.hdr ? "set" : "NULL"} app=${JSON.stringify(s.app_meta)} user=${JSON.stringify(s.user_meta)} confirmed_at_insert=${s.confirmed}` : "trigger did not fire");
  rec.evaluation("SEC-B1", "design", "BEFORE INSERT trigger sees PUBLIC /signup as", brief(s1));
  rec.evaluation("SEC-B2", "design", "BEFORE INSERT trigger sees ADMIN createUser (with app_metadata) as", brief(s2));
  rec.evaluation("SEC-B3", "design", "BEFORE INSERT trigger sees ADMIN createUser (no metadata, unconfirmed) as", brief(s3));
  rec.evaluation("SEC-B4", "design", "Session-level signals that could separate the two callers (role / JWT claims / request headers / application_name)",
    `public{${s1?.cur}/${s1?.sess}/jwt=${s1?.jwt ?? "NULL"}/app=${s1?.appname}} admin{${s2?.cur}/${s2?.sess}/jwt=${s2?.jwt ?? "NULL"}/app=${s2?.appname}} identical=${s1 && s2 && s1.cur === s2.cur && s1.sess === s2.sess && s1.jwt === s2.jwt && s1.hdr === s2.hdr && s1.appname === s2.appname}`);
  rec.check("SEC-B5", "design", "A public caller cannot forge raw_app_meta_data: a body app_metadata never reaches the trigger's NEW row, while user_metadata (data) is attacker-controlled",
    s1 && s1.app_meta?.sec_marker === undefined && s1.user_meta?.sec_marker === "user-meta-by-public", brief(s1));
  rec.check("SEC-B6", "design", "FACT: an Admin-API caller's app_metadata is NOT in NEW at BEFORE INSERT (GoTrue applies it by a later UPDATE), so a BEFORE INSERT guard cannot read a trusted marker; user_metadata IS present but is attacker-controlled",
    s2 && s2.app_meta?.sec_marker === undefined && s2.user_meta?.sec_marker === "user-meta-by-admin", brief(s2));
  const fin = bp.map((e) => db.json(`select coalesce(jsonb_agg(raw_app_meta_data), '[]') from auth.users where email='${e}';`)[0] ?? null);
  rec.check("SEC-B6b", "design", "FACT: the Admin-set app_metadata IS on the committed row (a check that runs after GoTrue has finished can read it); the public caller's never is",
    fin[1]?.sec_marker === "set-by-admin" && fin[0]?.sec_marker === undefined, `public=${JSON.stringify(fin[0])} admin=${JSON.stringify(fin[1])}`);
  const tx = db.json(`select coalesce(jsonb_agg(jsonb_build_object('email', email, 'ins', ins, 'upd', upd, 'same_txn', ins = any(upd))), '[]') from (
      select s.email, s.extra->>'txid' as ins, (select array_agg(u.extra->>'txid') from sec_probe.seen u where u.src = 'update' and u.email = s.email) as upd
        from sec_probe.seen s where s.src = 'trigger') q;`);
  const txOf = (e) => tx.find((r) => r.email === e);
  rec.evaluation("SEC-B6c", "design", "Are the Admin-API INSERT and its later app_metadata UPDATE ONE database transaction? (decides whether a DEFERRED constraint trigger can see the final row)",
    `admin(with metadata) same_txn=${txOf(bp[1])?.same_txn} public same_txn=${txOf(bp[0])?.same_txn}`);
  rec.evaluation("SEC-B7", "design", "email_confirmed_at at INSERT time is NOT a usable discriminator (depends on the GoTrue mode and on the caller's own flags)",
    `public=${s1?.confirmed} admin(email_confirm=true)=${s2?.confirmed} admin(email_confirm=false)=${s3?.confirmed} mode=${MODE}`);
  const hookRows = bp.map((e) => seen(e, "hook"));
  if (MODE === "hook") {
    rec.evaluation("SEC-B8", "design", "Auth before_user_created hook: fires for PUBLIC signup / ADMIN createUser; carries app_metadata?",
      `public=${hookRows[0] ? `fired app=${JSON.stringify(hookRows[0].app_meta)}` : "NOT fired"} admin=${hookRows[1] ? `fired app=${JSON.stringify(hookRows[1].app_meta)}` : "NOT fired"} admin2=${hookRows[2] ? "fired" : "NOT fired"}`);
  } else rec.na("SEC-B8", "design", "Auth before_user_created hook behaviour", "only evaluated in SEC_MODE=hook");
  for (const e of bp) for (const r of rows(e)) await forget(r.id);
  db.sql("drop trigger if exists sec_probe_cap on auth.users; drop trigger if exists sec_probe_cap_upd on auth.users;");

  // ---- candidate guards. Both read a single-use grant id from raw_app_meta_data.phone_signup_grant for an alias e-mail.
  //   V1 BEFORE INSERT   : reads NEW (the INSERT-time row)                              -> expected NOT viable (SEC-B6)
  //   V2 DEFERRED trigger: constraint trigger re-reads the committed row at COMMIT time -> viable only if the admin write is one txn
  db.sql(`
    create table if not exists sec_probe.grants (id uuid primary key default gen_random_uuid(), alias text not null, used boolean not null default false);
    grant select, update on sec_probe.grants to supabase_auth_admin;
    create or replace function sec_probe.consume(p_email text, p_meta jsonb) returns void language plpgsql as $f$
    declare g uuid;
    begin
      if lower(p_email) ~ '^p[1-9][0-9]{6,14}@craftsman-login\\.aladdin\\.invalid$' then
        begin g := nullif(p_meta->>'phone_signup_grant', '')::uuid; exception when others then g := null; end;
        update sec_probe.grants set used = true where id = g and alias = lower(p_email) and not used;
        if not found then raise exception 'phone alias requires a verified-phone grant' using errcode = '42501'; end if;
      end if;
    end $f$;
    create or replace function sec_probe.guard_v1() returns trigger language plpgsql as $f$
    begin perform sec_probe.consume(NEW.email, NEW.raw_app_meta_data); return NEW; end $f$;
    create or replace function sec_probe.guard_v2() returns trigger language plpgsql as $f$
    declare r record;
    begin
      select email, raw_app_meta_data into r from auth.users where id = NEW.id;
      if found then perform sec_probe.consume(r.email, r.raw_app_meta_data); end if;
      return null;
    end $f$;`);
  const grant = (alias) => db.sql(`insert into sec_probe.grants (alias) values ('${alias}') returning id;`).split("\n")[0];
  const dropGuards = "drop trigger if exists sec_probe_guard on auth.users; drop trigger if exists sec_probe_deferred on auth.users;";
  const installGuard = (v) => db.sql(`${dropGuards} ${v === "v1"
    ? "create trigger sec_probe_guard before insert on auth.users for each row execute function sec_probe.guard_v1();"
    : "create constraint trigger sec_probe_deferred after insert on auth.users deferrable initially deferred for each row execute function sec_probe.guard_v2();"}`);

  installGuard("v1");
  const v1A = aliasOf(phone());
  const v1 = await h.adminCreateUser({ email: v1A, password: PASSWORD, email_confirm: true, app_metadata: { phone_signup_grant: grant(v1A) } });
  remember(v1);
  rec.check("SEC-G0", "candidate-guard", "V1 (BEFORE INSERT) is NOT viable: Admin createUser carrying a VALID grant is refused, because the marker is not yet on the row", v1.status >= 400 && rows(v1A).length === 0, `status=${out(v1)}`);

  installGuard("v2");
  const gA = aliasOf(phone()), gB = aliasOf(phone());
  const g1 = await anonSignup(gA);
  remember(g1);
  rec.check("SEC-G1", "candidate-guard", "V2 (deferred): anonymous alias sign-up is refused and leaves no row", g1.status >= 400 && rows(gA).length === 0, `status=${out(g1)} body=${JSON.stringify(g1.data).slice(0, 120)}`);
  const forged = grant(gA);
  const g2 = await anonSignup(gA, { app_metadata: { phone_signup_grant: forged }, data: { phone_signup_grant: forged } });
  remember(g2);
  rec.check("SEC-G2", "candidate-guard", "V2: anonymous sign-up that forges the grant marker (body app_metadata or user_metadata, with a REAL grant id) is refused", g2.status >= 400 && rows(gA).length === 0, `status=${out(g2)}`);
  const g3 = await h.adminCreateUser({ email: gA, password: PASSWORD, email_confirm: true });
  remember(g3);
  rec.check("SEC-G3", "candidate-guard", "V2: Admin createUser WITHOUT a grant is refused too (every server-side alias creation must carry a proven grant)", g3.status >= 400 && rows(gA).length === 0, `status=${out(g3)}`);
  const grantA = grant(gA);
  const g4 = await h.adminCreateUser({ email: gA, password: PASSWORD, email_confirm: true, app_metadata: { phone_signup_grant: grantA } });
  const g4id = remember(g4);
  rec.check("SEC-G4", "candidate-guard", "V2: Admin createUser WITH the alias's own single-use grant succeeds and consumes the grant", g4.status < 300 && db.sql(`select used from sec_probe.grants where id='${grantA}';`) === "t", out(g4));
  const g5 = await h.adminCreateUser({ email: gB, password: PASSWORD, email_confirm: true, app_metadata: { phone_signup_grant: grantA } });
  remember(g5);
  rec.check("SEC-G5", "candidate-guard", "V2: a consumed grant cannot be replayed, and a grant for alias A cannot create alias B", g5.status >= 400 && rows(gB).length === 0, `status=${out(g5)}`);
  const g4s = g4id ? await h.signInPassword(gA, PASSWORD) : { status: 0 };
  const rb = g4id ? await forget(g4id) : { status: 0 };
  const g6 = await h.adminCreateUser({ email: gA, password: PASSWORD, email_confirm: true, app_metadata: { phone_signup_grant: grantA } });
  remember(g6);
  rec.check("SEC-G6", "candidate-guard", "V2: the guarded account signs in, rollback (deleteUser) works, and the used grant cannot recreate the alias", g4s.status === 200 && rb.status < 300 && g6.status >= 400 && rows(gA).length === 0, `signin=${g4s.status} delete=${rb.status} recreate=${out(g6)}`);
  const g7 = await anonSignup(`sec-${tag}-plain@sec.invalid`);
  remember(g7);
  rec.check("SEC-G7", "candidate-guard", "V2: ordinary e-mail sign-up is unaffected", g7.status < 300, out(g7));
  const g8 = await anonSignup(installer.email);
  remember(g8);
  rec.check("SEC-G8", "candidate-guard", "V2: legacy alias accounts keep signing in and an anonymous probe on their alias changes nothing", (await h.signInPassword(installer.email, PASSWORD)).status === 200 && rows(installer.email).length === 1, `probe=${out(g8)}`);
  const missing = await anonSignup(aliasOf(phone()));
  rec.evaluation("SEC-G9", "candidate-guard", "ENUMERATION shape of V2: public sign-up on a FREE alias vs an EXISTING alias (the existing-alias answer is GoTrue's own, SEC-A11)",
    `free -> ${out(missing)} ${JSON.stringify(missing.data).slice(0, 90)} | existing -> ${out(g8)}`);
  const gConc = aliasOf(phone());
  const gcGrant = grant(gConc);
  const conc = await Promise.all([1, 2, 3].map(() => h.adminCreateUser({ email: gConc, password: PASSWORD, email_confirm: true, app_metadata: { phone_signup_grant: gcGrant } })));
  conc.forEach(remember);
  rec.check("SEC-G10", "candidate-guard", "V2: three concurrent Admin creations racing on ONE grant create exactly one account", rows(gConc).length === 1 && conc.filter((r) => r.status < 300).length === 1, `ok=${conc.filter((r) => r.status < 300).length} rows=${rows(gConc).length} statuses=${conc.map(out).join(",")}`);
  for (const r of rows(gConc)) await forget(r.id);
  db.sql(dropGuards);

  // ---- candidate 3 (SEC_MODE=hook only): the Auth before_user_created hook REJECTS alias e-mails. It fires for public sign-up only.
  if (MODE === "hook") {
    db.sql("update sec_probe.cfg set reject = true;");
    const hA = aliasOf(phone());
    const h1 = await anonSignup(hA);
    remember(h1);
    rec.check("SEC-H1", "candidate-hook", "HOOK: a rejecting before_user_created hook refuses anonymous alias sign-up (no row, no email, no session)", h1.status >= 400 && rows(hA).length === 0 && !h1.data?.access_token, `status=${out(h1)} body=${JSON.stringify(h1.data).slice(0, 140)}`);
    const h2 = await h.adminCreateUser({ email: hA, password: PASSWORD, email_confirm: true });
    const h2id = remember(h2);
    rec.check("SEC-H2", "candidate-hook", "HOOK: Admin createUser of the same alias still works WITHOUT any grant (the hook does not fire for the Admin API) -- so the hook alone cannot bind creation to a proven code", h2.status < 300 && rows(hA).length === 1, out(h2));
    const h3 = await anonSignup(`sec-${tag}-hookplain@sec.invalid`);
    remember(h3);
    rec.check("SEC-H3", "candidate-hook", "HOOK: ordinary e-mail sign-up is unaffected", h3.status < 300, out(h3));
    rec.evaluation("SEC-H4", "candidate-hook", "HOOK: needs an Auth CONFIGURATION change (not a migration) and a hook that fails closed on error; it would have to be enabled per hosted project by the owner", "local config: [auth.hook.before_user_created]");
    if (h2id) await forget(h2id);
    db.sql("update sec_probe.cfg set reject = false;");
  } else rec.na("SEC-H1", "candidate-hook", "Rejecting before_user_created hook", "only evaluated in SEC_MODE=hook");

  rec.na("SEC-D*", "signup-proof", "Signup proof binding", "implemented in R1: see signup_authority.test.mjs (this file is the PR #122 design-evidence probe and is run against a stack whose guard is OFF)");

  // ================================================================================================ 6. E: legacy identity preservation after everything above
  const after = snapshot(legacy);
  rec.check("SEC-E1", "legacy", "Legacy Installer, Showroom and e-mail identities are byte-identical (auth row, password digest, identities, profile, verified flag, memberships) after every attack and probe above",
    JSON.stringify(before) === JSON.stringify(after), Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map(shortId).join(","));
  const logins = await Promise.all(legacy.map((a) => h.signInPassword(a.email, PASSWORD)));
  rec.check("SEC-E2", "legacy", "All legacy accounts still sign in with their original passwords", logins.every((r) => r.status === 200), logins.map((r) => r.status).join(","));
  rec.check("SEC-E3", "legacy", "Legacy numbers stay UNVERIFIED (nothing in this suite writes phone_verified_at)", legacy.every((a) => after[a.id].profile.verified === null), "");
} finally {
  try { db.sql("drop trigger if exists sec_probe_cap on auth.users; drop trigger if exists sec_probe_cap_upd on auth.users; drop trigger if exists sec_probe_guard on auth.users; drop trigger if exists sec_probe_deferred on auth.users; drop function if exists public.sec_probe_hook(jsonb); drop schema if exists sec_probe cascade;"); } catch (e) { console.error("[sec] probe cleanup failed", String(e).slice(0, 200)); }
  for (const id of [...created]) { try { await forget(id); } catch { /* audited fixtures remain; the runner resets the isolated DB */ } }
  const summary = rec.summary();
  const dir = resolve(here, "../../../docs/security/phone-signup-security/design-probe");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `evidence-${MODE}.json`), `${JSON.stringify({ summary, results: rec.results }, null, 1)}\n`);
  console.log(`\n[sec] ${MODE}: ${JSON.stringify(summary)}`);
  process.exitCode = summary.FAIL > 0 || summary.XPASS > 0 ? 1 : 0;
}
