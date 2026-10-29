// R1 concurrency + deadlock stress for the signup authority and the alias guard. LOCAL ISOLATED STACK ONLY.
//
//   DB_CONTAINER=supabase_db_<isolated> node supabase/tests/sec/signup_concurrency_stress.test.mjs
//
// Many REAL sessions at once (GoTrue Admin API for the guard, PostgREST for the authority, one psql session each only for counting):
//   S1  24 complete sign-ups in parallel (start -> verify -> guarded create -> init RPCs -> attach)
//   S2  6 groups x 5 racers on ONE grant: creation, then attach - exactly one winner per group
//   S3  6 groups x 6 racers on ONE correct code: exactly one grant per group
//   S4  8 parallel starts for ONE number from 8 registrations: the per-number cap holds (<= 5 challenges)
//   S5  parallel wrong-code guessing against one challenge never exceeds the attempt limit and never verifies
// Invariants checked afterwards: pg_stat_database.deadlocks did not move, every created user consumed exactly one grant, every attached
// user is verified for exactly its own number, no duplicate alias, no grant consumed by two users.
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { target, makeDb, makeHttp, makeRecorder, phoneFactory, runTag } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const otp = await import("../../../frontend/src/server/phone-verification/otp.ts");
const ring = otp.parseKeyring(JSON.stringify({ current: "k2", keys: { k2: Buffer.alloc(32, 31).toString("base64") } }));
const t = target();
const db = makeDb(t.container);
const h = makeHttp(t);
const rec = makeRecorder("phone-signup-concurrency", { toolchain: process.env.SEC_TOOLCHAIN ?? "local" });
const tag = runTag();
const nextPhone = phoneFactory(tag);
const PASSWORD = "Sec-Fixture-Pass-1!";
const created = new Set();
let ipN = 0;
const ipKey = () => otp.ipBucketKey(ring, `192.0.2.${(ipN += 1) % 250}`);

async function prove(p) {
  const registrationId = randomUUID(), challengeId = otp.newChallengeId(), code = otp.generateCode();
  const { kid, mac } = otp.issueMac(ring, { challengeId, registrationId, purpose: "signup_proof" }, code);
  const start = await h.rpcService("phone_signup_start", { p_registration_id: registrationId, p_phone: p.e164, p_challenge_id: challengeId, p_kid: kid, p_code_mac: mac, p_ip_key: ipKey() });
  const verify = (c = code) => h.rpcService("phone_signup_verify", { p_registration_id: registrationId, p_challenge_id: challengeId, p_candidates: otp.candidateMacs(ring, { challengeId, registrationId, purpose: "signup_proof" }, c), p_ip_key: ipKey() });
  return { registrationId, challengeId, code, start, verify };
}
const grantOf = (v) => (v.data?.status === "verified" ? { id: v.data.grant_id, registrationId: v.data.registration_id, alias: v.data.alias } : null);
const create = (g) => h.adminCreateUser({ email: g.alias, password: PASSWORD, email_confirm: true, app_metadata: { registration_source: "phone_whatsapp_sign_up", phone_signup_grant: g.id, phone_signup_registration: g.registrationId } });
async function init(email, p) {
  const s = await h.signInPassword(email, PASSWORD);
  if (s.status !== 200) return false;
  for (const [fn, args] of [["record_consent", { p_types: ["terms", "privacy", "pilot"], p_locale: "ar" }], ["onboarding_select_account_type", { p_track: "professional", p_account_type: "installer_technician" }], ["profile_set_phone", { p_country_iso2: p.iso2, p_national: p.national, p_e164: p.e164 }], ["profile_set_username", { p_username: `st${tag}${randomUUID().slice(0, 7)}` }]]) {
    if ((await h.rpc(fn, args, s.data.access_token)).status >= 300) return false;
  }
  return true;
}
const deadlocks = () => Number(db.sql("select deadlocks from pg_stat_database where datname = current_database();"));

let exit = 0;
try {
  db.sql("delete from app.phone_verification_ip_buckets; update app.phone_verification_config set enabled = true, alias_guard_mode = 'enforce', signup_enabled = true, user_hourly_starts = 20, ip_hourly_starts = 200;");
  const dl0 = deadlocks();

  // S1
  const people = Array.from({ length: 24 }, () => nextPhone());
  const flows = await Promise.all(people.map(async (p) => {
    const pr = await prove(p);
    const g = grantOf(await pr.verify());
    if (!g) return { ok: false, why: "verify" };
    const c = await create(g);
    if (c.status >= 300) return { ok: false, why: `create ${c.status}` };
    created.add(c.data.id);
    if (!(await init(g.alias, p))) return { ok: false, why: "init" };
    const a = await h.rpcService("phone_signup_attach", { p_user_id: c.data.id, p_grant_id: g.id });
    return { ok: a.data?.status === "attached", id: c.data.id, p, why: a.data?.status };
  }));
  rec.check("STRESS-S1", "concurrency", "24 complete sign-ups in parallel all succeed and are verified for their own number",
    flows.every((f) => f.ok) && Number(db.sql(`select count(*) from public.profiles where user_id = any('{${flows.map((f) => f.id).join(",")}}'::uuid[]) and phone_verified_at is not null;`)) === 24, flows.filter((f) => !f.ok).map((f) => f.why).join(","));
  const mismatched = db.sql(`select count(*) from public.profiles p join auth.users u on u.id = p.user_id where u.id = any('{${flows.map((f) => f.id).join(",")}}'::uuid[]) and lower(u.email) <> 'p' || substr(p.phone_e164, 2) || '@craftsman-login.aladdin.invalid';`);
  rec.check("STRESS-S1b", "concurrency", "...and every verified number equals its own account's alias (no cross-binding)", mismatched === "0", `mismatched=${mismatched}`);

  // S2 racing creation then attach on one grant
  const s2 = [];
  for (let i = 0; i < 6; i += 1) {
    const p = nextPhone();
    const pr = await prove(p);
    const g = grantOf(await pr.verify());
    const racers = await Promise.all(Array.from({ length: 5 }, () => create(g)));
    racers.forEach((r) => r.data?.id && r.status < 300 && created.add(r.data.id));
    const winner = racers.find((r) => r.status < 300);
    if (winner) await init(g.alias, p);
    const att = winner ? await Promise.all(Array.from({ length: 5 }, () => h.rpcService("phone_signup_attach", { p_user_id: winner.data.id, p_grant_id: g.id }))) : [];
    s2.push({ creates: racers.filter((r) => r.status < 300).length, attached: att.filter((r) => r.data?.status === "attached").length, rows: Number(db.sql(`select count(*) from auth.users where lower(email) = '${g.alias}';`)) });
  }
  rec.check("STRESS-S2", "concurrency", "6 groups x 5 racers: exactly one creation and exactly one attach per grant", s2.every((r) => r.creates === 1 && r.attached === 1 && r.rows === 1), JSON.stringify(s2));

  // S3 one correct code, many verifiers
  const s3 = [];
  for (let i = 0; i < 6; i += 1) {
    const pr = await prove(nextPhone());
    const res = await Promise.all(Array.from({ length: 6 }, () => pr.verify()));
    s3.push({ verified: res.filter((r) => r.data?.status === "verified").length, grants: Number(db.sql(`select count(*) from app.phone_signup_grants where challenge_id = '${pr.challengeId}';`)) });
  }
  rec.check("STRESS-S3", "concurrency", "6 groups x 6 verifiers of one correct code: exactly one grant each", s3.every((r) => r.verified === 1 && r.grants === 1), JSON.stringify(s3));

  // S4 per-number cap across registrations
  const shared = nextPhone();
  const s4 = await Promise.all(Array.from({ length: 8 }, () => prove(shared)));
  const rows = Number(db.sql(`select count(*) from app.phone_verification_challenges where purpose = 'signup_proof' and phone_e164 = '${shared.e164}';`));
  rec.check("STRESS-S4", "concurrency", "8 parallel starts for one number from 8 registrations: the hourly per-number cap (5) holds exactly", rows === 5 && s4.filter((s) => s.start.data?.status === "rate_limited").length === 3, `challenges=${rows} limited=${s4.filter((s) => s.start.data?.status === "rate_limited").length}`);

  // S5 parallel guessing
  const pr5 = await prove(nextPhone());
  const wrong = await Promise.all(Array.from({ length: 12 }, (_, i) => pr5.verify(String(100000 + i))));
  const att5 = Number(db.sql(`select attempts from app.phone_verification_challenges where id = '${pr5.challengeId}';`));
  const later = await pr5.verify();
  rec.check("STRESS-S5", "concurrency", "12 parallel wrong guesses: nobody verifies, attempts never exceed the limit (5), and the correct code is refused afterwards",
    wrong.every((r) => r.data?.status === "invalid") && att5 <= 5 && later.data?.status === "invalid", `attempts=${att5} later=${later.data?.status}`);

  // invariants
  rec.check("STRESS-I1", "invariant", "No deadlock was detected by Postgres during the whole run", deadlocks() === dl0, `deadlocks ${dl0} -> ${deadlocks()}`);
  const twice = db.sql("select count(*) from (select consumed_user_id from app.phone_signup_grants where consumed_user_id is not null group by 1 having count(*) > 1) d;");
  const dupAlias = db.sql("select count(*) from (select lower(email) from auth.users where email like '%@craftsman-login.aladdin.invalid' group by 1 having count(*) > 1) d;");
  rec.check("STRESS-I2", "invariant", "No user consumed two grants and no alias exists twice", twice === "0" && dupAlias === "0", `twice=${twice} dupAlias=${dupAlias}`);
  const orphan = db.sql(`select count(*) from app.phone_signup_grants g where g.consumed_user_id is not null and not exists (select 1 from auth.users u where u.id = g.consumed_user_id) and g.created_at > now() - interval '1 hour' and g.attached_at is not null;`);
  rec.check("STRESS-I3", "invariant", "No attached grant points at a missing user", orphan === "0", `orphans=${orphan}`);
} catch (e) {
  console.error("[stress] suite error:", String(e?.stack ?? e).slice(0, 500));
  exit = 1;
} finally {
  try { db.sql("update app.phone_verification_config set signup_enabled = false, alias_guard_mode = 'off', enabled = false, user_hourly_starts = 6, ip_hourly_starts = 20;"); } catch { exit = 1; }
  for (const id of created) await h.adminDeleteUser(id).catch(() => undefined);
  const summary = rec.summary();
  const dir = resolve(here, "../../../docs/security/phone-signup-security");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `r1-stress-${process.env.SEC_TOOLCHAIN ?? "local"}.json`), `${JSON.stringify({ summary, results: rec.results }, null, 1)}\n`);
  console.log(`\n[stress] ${JSON.stringify(summary)}`);
  process.exitCode = exit || (summary.FAIL > 0 ? 1 : 0);
}
