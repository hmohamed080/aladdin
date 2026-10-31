// R2 interim mitigation probe: the proposed before_user_created hook (supabase/proposals/before_user_created_alias_gate.sql), measured on a
// real local GoTrue. LOCAL ISOLATED STACK ONLY (same guards as the A2/R1 suites: loopback API, explicitly named non-shared DB container).
//
//   DB_CONTAINER=supabase_db_<project> A2_API_URL=... A2_ANON_KEY=... A2_SERVICE_KEY=... SEC_TOOLCHAIN=ci110|local SEC_MODE=confirm-on|confirm-off \
//     node supabase/tests/r2/hook_probe.test.mjs
//
// The stack must have been started with the hook enabled (stack.sh up <mode> hook). Nothing is sent: no SMS provider, no Send-SMS hook; e-mail
// goes to the stack's local Inbucket only. Exit code is non-zero on any FAIL.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { target, makeDb, makeHttp, makeRecorder, runTag } from "../sec/lib.mjs";

const t = target();
const db = makeDb(t.container);
const h = makeHttp(t);
const confirmationsOn = (process.env.SEC_MODE ?? "confirm-on") === "confirm-on";
const project = t.container.replace(/^supabase_db_/, "");
const authContainer = `supabase_auth_${project}`;
const proposal = readFileSync(new URL("../../proposals/before_user_created_alias_gate.sql", import.meta.url), "utf8");
const goTrueImage = execFileSync("docker", ["inspect", "-f", "{{.Config.Image}}", authContainer], { encoding: "utf8" }).trim().split(":").pop();
const rec = makeRecorder("r2-hook-probe", { toolchain: process.env.SEC_TOOLCHAIN ?? "unknown", mode: process.env.SEC_MODE ?? "confirm-on", gotrue: goTrueImage });

const tag = runTag();
const digits = String(parseInt(tag, 16) % 100000).padStart(5, "0");
let seq = 0;
const alias = () => `p2010${digits}${String((seq += 1)).padStart(2, "0")}@craftsman-login.aladdin.invalid`;
const normal = () => `r2hk-${tag}-${(seq += 1)}@example.test`;
const PASSWORD = "Pr0be-passw0rd-2026";
const rowCount = (email) => Number(db.sql(`select count(*) from auth.users where lower(email) = lower('${email}');`));
const install = () => db.sql(proposal);
const brief = (r) => `status=${r.status} ${r.data?.error_code ?? r.data?.code ?? r.data?.error ?? ""} ${String(r.data?.msg ?? r.data?.message ?? "").slice(0, 70)}`.trim();
const created = [];
const cleanup = async () => { for (const id of created) await h.adminDeleteUser(id).catch(() => undefined); };

let exit = 0;
try {
  // ---------------------------------------------------------------------------------------------------- 0. guards
  const env = execFileSync("docker", ["exec", authContainer, "env"], { encoding: "utf8" });
  rec.check("HK-ENV-1", "guard", "Isolated loopback stack, non-shared DB container", /^http:\/\/(127\.0\.0\.1|localhost)/.test(t.api) && t.container !== "supabase_db_aladdin", t.container);
  rec.check("HK-ENV-2", "guard", "The before-user-created hook is ENABLED on this GoTrue and points at the proposed function", /GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED=true/.test(env) && /pg-functions:\/\/postgres\/public\/hook_before_user_created/.test(env));
  rec.check("HK-ENV-3", "guard", "No SMS provider, Send-SMS hook or anonymous sign-in is enabled (nothing here can deliver a message)", !/GOTRUE_HOOK_SEND_SMS_ENABLED=true/.test(env) && !/GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=true/.test(env));
  rec.evaluation("HK-ENV-4", "guard", "GoTrue image / confirmations", `${goTrueImage}; e-mail confirmations ${confirmationsOn ? "ON" : "OFF"}`);
  install();

  // ---------------------------------------------------------------------------------------------------- A. public paths are refused
  const a1 = alias();
  const r1 = await h.call("POST", "/auth/v1/signup", { body: { email: a1, password: PASSWORD } });
  rec.check("HK-A1", "block", "Anonymous public sign-up on an alias is refused and creates no Auth user", r1.status >= 400 && r1.status < 500 && rowCount(a1) === 0, brief(r1));
  rec.check("HK-A1b", "block", "...with HTTP 403 and the generic message (no internal detail)", r1.status === 403 && /not available/i.test(JSON.stringify(r1.data)) && !/hook|function|postgres/i.test(JSON.stringify(r1.data)), brief(r1));

  const a2 = alias().toUpperCase();
  const r2 = await h.call("POST", "/auth/v1/signup", { body: { email: a2, password: PASSWORD } });
  rec.check("HK-A2", "block", "Case variant of an alias (upper case) is refused", r2.status >= 400 && rowCount(a2) === 0, brief(r2));

  const a3 = alias();
  const r3 = await h.call("POST", "/auth/v1/otp", { body: { email: a3, create_user: true } });
  rec.check("HK-A3", "block", "E-mail OTP with create_user on an alias is refused and creates no user", r3.status >= 400 && rowCount(a3) === 0, brief(r3));

  const a4 = alias();
  const r4 = await h.call("POST", "/auth/v1/magiclink", { body: { email: a4 } });
  rec.check("HK-A4", "block", "Magic-link request on an alias is refused and creates no user", r4.status >= 400 && rowCount(a4) === 0, brief(r4));

  const a5 = alias();
  const r5 = await h.call("POST", "/auth/v1/signup", { body: { email: a5, password: PASSWORD, data: { registration_source: "temporary_craftsman_password_flow" }, app_metadata: { registration_source: "temporary_craftsman_password_flow" } } });
  rec.check("HK-A5", "block", "A public caller cannot pass the allow-list by sending registration_source in data / app_metadata", r5.status >= 400 && rowCount(a5) === 0, brief(r5));

  // ---------------------------------------------------------------------------------------------------- B. trusted creation is untouched
  const b1 = alias();
  const c1 = await h.adminCreateUser({ email: b1, password: PASSWORD, email_confirm: true, app_metadata: { registration_source: "temporary_craftsman_password_flow" } });
  if (c1.data?.id) created.push(c1.data.id);
  rec.check("HK-B1", "preserve", "Admin API creation of a legacy Installer alias account still works (confirmed, usable)", c1.status === 200 && rowCount(b1) === 1, brief(c1));
  const s1 = await h.signInPassword(b1, PASSWORD);
  rec.check("HK-B2", "preserve", "...and that account signs in with its password", s1.status === 200 && Boolean(s1.data?.access_token), brief(s1));

  const b3 = alias();
  const c3 = await h.adminCreateUser({ email: b3, password: PASSWORD, email_confirm: true, app_metadata: { registration_source: "temporary_showroom_password_flow" } });
  if (c3.data?.id) created.push(c3.data.id);
  rec.check("HK-B3", "preserve", "Admin API creation of a legacy Showroom alias account still works", c3.status === 200 && rowCount(b3) === 1, brief(c3));

  const b4 = alias();
  const c4 = await h.adminCreateUser({ email: b4, password: PASSWORD, email_confirm: true, app_metadata: { registration_source: "phone_whatsapp_sign_up" } });
  if (c4.data?.id) created.push(c4.data.id);
  rec.check("HK-B4", "preserve", "Admin API creation by the R2 phone sign-up source still works", c4.status === 200 && rowCount(b4) === 1, brief(c4));

  const b5 = alias();
  const c5 = await h.adminCreateUser({ email: b5, password: PASSWORD, email_confirm: true });
  if (c5.data?.id) created.push(c5.data.id);
  rec.evaluation("HK-B5", "preserve", "Admin API creation of an alias with NO registration_source (does this GoTrue call the hook for Admin creation at all?)", c5.status === 200 ? `created: the hook is NOT consulted for Admin creation (${brief(c5)})` : `REFUSED: this GoTrue consults the hook for Admin creation, so the allow-list is load-bearing (${brief(c5)})`);

  const del = c1.data?.id ? await h.adminDeleteUser(c1.data.id) : { status: 0 };
  rec.check("HK-B6", "preserve", "Admin deletion of an alias account (compensating rollback) still works", del.status === 200 && rowCount(b1) === 0, `status=${del.status}`);

  // ---------------------------------------------------------------------------------------------------- C. other sign-up methods
  const n1 = normal();
  const e1 = await h.call("POST", "/auth/v1/signup", { body: { email: n1, password: PASSWORD } });
  rec.check("HK-C1", "other-auth", "Email + password sign-up is unaffected", e1.status === 200 && rowCount(n1) === 1 && (confirmationsOn ? !e1.data?.access_token : Boolean(e1.data?.access_token)), brief(e1));
  const n2 = normal();
  const e2 = await h.call("POST", "/auth/v1/otp", { body: { email: n2, create_user: true } });
  rec.check("HK-C2", "other-auth", "Email OTP sign-up is unaffected", e2.status === 200 && rowCount(n2) === 1, brief(e2));
  const e3 = await h.call("POST", "/auth/v1/recover", { body: { email: n1 } });
  rec.check("HK-C3", "other-auth", "Password recovery for an existing account is unaffected", e3.status === 200, brief(e3));
  // OAuth providers are not configured locally, so the hook is exercised with the payloads GoTrue sends for them (the function sees only the user object).
  const ev = (user) => JSON.stringify({ metadata: { name: "before-user-created" }, user }).replace(/'/g, "''");
  const direct = (user) => db.sql(`select public.hook_before_user_created('${ev(user)}'::jsonb);`);
  const shapes = {
    google: { email: `g-${tag}@gmail.example.invalid`, app_metadata: { provider: "google", providers: ["google"] } },
    facebookNoEmail: { email: "", app_metadata: { provider: "facebook", providers: ["facebook"] } },
    facebookNullEmail: { app_metadata: { provider: "facebook", providers: ["facebook"] } },
    facebookUnverified: { email: `fb-${tag}@facebook.example.invalid`, app_metadata: { provider: "facebook", providers: ["facebook"] } },
    lookalike: { email: "p201012345678@craftsman-login.aladdin.invalid.example.com", app_metadata: { provider: "email" } },
  };
  for (const [k, u] of Object.entries(shapes)) rec.check(`HK-C4-${k}`, "other-auth", `Hook allows the ${k} user object (returns {})`, direct(u) === "{}", direct(u));
  rec.check("HK-C5", "other-auth", "Hook tolerates an empty / null event without raising (returns {})", db.sql("select public.hook_before_user_created('{}'::jsonb)::text;") === "{}" && db.sql("select public.hook_before_user_created(null)::text;") === "{}", "");
  rec.check("HK-C6", "block", "Hook refuses an alias for a public-shaped event and allows the trusted source (direct call)", /"http_code": 403/.test(direct({ email: "p20100000000@craftsman-login.aladdin.invalid", app_metadata: { provider: "email" } })) && direct({ email: "p20100000000@craftsman-login.aladdin.invalid", app_metadata: { registration_source: "temporary_craftsman_password_flow" } }) === "{}", "");
  const privs = db.sql(`select has_function_privilege('anon','public.hook_before_user_created(jsonb)','execute'), has_function_privilege('authenticated','public.hook_before_user_created(jsonb)','execute'), has_function_privilege('service_role','public.hook_before_user_created(jsonb)','execute'), has_function_privilege('supabase_auth_admin','public.hook_before_user_created(jsonb)','execute');`);
  rec.check("HK-C7", "perm", "EXECUTE is held by supabase_auth_admin only (not anon, authenticated, service_role)", privs === "f|f|f|t", privs);

  // ---------------------------------------------------------------------------------------------------- D. residual: e-mail CHANGE to an alias (not a creation, no hook)
  const u = normal();
  const su = await h.call("POST", "/auth/v1/signup", { body: { email: u, password: PASSWORD } });
  const si = su.data?.access_token ? su : await h.signInPassword(u, PASSWORD);
  if (si.data?.access_token) {
    const target = alias();
    const ch = await h.call("PUT", "/auth/v1/user", { token: si.data.access_token, body: { email: target } });
    const now = db.sql(`select coalesce(email,'') || '|' || coalesce(email_change,'') from auth.users where lower(email) = lower('${u}') or lower(email_change) = lower('${target}') limit 1;`);
    const taken = rowCount(target) === 1;
    rec.evaluation("HK-D1", "residual", "An authenticated user changes their e-mail TO an alias (not a creation: the hook is not consulted; R1's INSERT guard does not see it either)", `${brief(ch)}; alias now an account e-mail=${taken}; pending-change=${now.includes("|") && !taken}`);
  } else rec.evaluation("HK-D1", "residual", "E-mail change to an alias", "no session to test with in this mode (confirmations ON requires a mailbox)");

  // ---------------------------------------------------------------------------------------------------- E. hook FAILURE behaviour (blast radius) and rollback
  const grant = "grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;";
  const variants = {
    "function raises": `create or replace function public.hook_before_user_created(event jsonb) returns jsonb language plpgsql as $$ begin raise exception 'simulated hook failure'; end $$; ${grant}`,
    "function missing": "drop function public.hook_before_user_created(jsonb);",
    "no EXECUTE for supabase_auth_admin": "revoke execute on function public.hook_before_user_created(jsonb) from supabase_auth_admin;",
    "slower than the hook timeout": `create or replace function public.hook_before_user_created(event jsonb) returns jsonb language plpgsql as $$ begin perform pg_sleep(8); return '{}'::jsonb; end $$; ${grant}`,
    "malformed answer": `create or replace function public.hook_before_user_created(event jsonb) returns jsonb language plpgsql as $$ begin return jsonb_build_object('error', 'not-an-object'); end $$; ${grant}`,
  };
  let idx = 0;
  for (const [label, sql] of Object.entries(variants)) {
    idx += 1;
    install(); // every variant starts from the proposed function, whatever the previous variant did to it
    db.sql(sql);
    const pub = normal();
    const t0 = Date.now();
    const rp = await h.call("POST", "/auth/v1/signup", { body: { email: pub, password: PASSWORD } });
    const ms = Date.now() - t0;
    const adm = alias();
    const ra = await h.adminCreateUser({ email: adm, password: PASSWORD, email_confirm: true, app_metadata: { registration_source: "temporary_craftsman_password_flow" } });
    if (ra.data?.id) created.push(ra.data.id);
    const existing = await h.signInPassword(b3, PASSWORD);
    rec.evaluation(`HK-E${idx}`, "failure", `Hook failure mode "${label}"`, `public e-mail sign-up: ${brief(rp)} (${ms} ms, created=${rowCount(pub) === 1}); Admin alias creation: status=${ra.status}; existing alias sign-in: status=${existing.status}`);
    rec.check(`HK-E${idx}a`, "failure", `"${label}": Admin creation and existing sign-in keep working (a hook outage cannot stop trusted creation or login)`, ra.status === 200 && existing.status === 200, `admin=${ra.status} signin=${existing.status}`);
  }
  install();
  const back = normal();
  const rb = await h.call("POST", "/auth/v1/signup", { body: { email: back, password: PASSWORD } });
  const stillBlocked = await h.call("POST", "/auth/v1/signup", { body: { email: alias(), password: PASSWORD } });
  rec.check("HK-F1", "rollback", "After re-installing the function the hook recovers: public e-mail sign-up works again and an alias is refused again", rb.status === 200 && stillBlocked.status === 403, `${brief(rb)} / ${brief(stillBlocked)}`);
} catch (error) {
  rec.check("HK-ERR", "harness", "The probe ran to completion", false, String(error?.message ?? error).slice(0, 300));
} finally {
  try { install(); } catch { /* leave the stack as found */ }
  await cleanup();
  const s = rec.summary();
  console.log(`[sec] ${JSON.stringify(s)}`);
  if (s.FAIL > 0) exit = 1;
}
process.exit(exit);
