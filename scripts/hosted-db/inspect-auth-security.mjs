#!/usr/bin/env node
// READ-ONLY inspection of the hosted Auth/phone security posture (Acceptance and/or Production). It changes nothing and prints no secret.
//
//   SUPABASE_ACCESS_TOKEN=<personal access token with READ access to the project> \
//   SUPABASE_REF_ACCEPTANCE=<ref> SUPABASE_REF_PRODUCTION=<ref> \
//   [CLOUDFLARE_API_TOKEN=<token with Workers Scripts:Read> CF_ACCOUNT_ID=<id> CF_WORKER_ACCEPTANCE=<name> CF_WORKER_PRODUCTION=<name>] \
//   node scripts/hosted-db/inspect-auth-security.mjs --env acceptance|production|both
//       [--only migrations]            narrowest access: one SELECT of the applied migration versions, diffed against this checkout
//       [--expected <file.json>]       exact redirect allow-list comparison against an owner-confirmed list (see docs/security/hosted/)
//
// WHAT IT REPORTS (booleans / enums / counts only):
//   * e-mail confirmation required, sign-up availability, CAPTCHA protection, phone provider, Send-SMS hook, Phone MFA, anonymous sign-ins
//   * whether WhatsApp delivery secrets EXIST on the Worker (names only, never values)
//   * effective EXECUTE rights of service_role / anon / authenticated on the 13 disputed functions
//   * whether the phone authority / alias guard migrations are applied, their switches, and a COUNT of alias-domain Auth users that never
//     confirmed (possible squats) - no address, no number
//   * R2: the exact migration-history difference against this checkout (which repo migrations are applied / missing, which applied ones the
//     repo does not have - e.g. is 20261028090001 applied before the R2 drop migration 20261031090001), the FULL function-permission
//     inventory compared with the reviewed contract for the hosted version (permission_diff), the legacy registration challenge table
//     (name + approximate row count only), and the NON-SECRET phone switches on the Worker (PHONE_* values; secrets by name only)
//
// SAFETY, enforced in code and covered by inspect-auth-security.test.mjs:
//   * the only network calls are: GET Supabase /config/auth, POST Supabase /database/query/read-only (SELECT/WITH only, single statement),
//     GET Cloudflare .../secrets. Everything else is refused before it leaves the process.
//   * only allow-listed auth keys are copied into the report; any key that looks like a secret is dropped even if someone adds it.
//   * tokens are read from the environment, never printed, never written to disk.
//   * with no token the script prints exactly what authorisation is needed and exits 3 without calling anything.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const DISPUTED_FUNCTIONS = [
  "account_entry_allowed", "account_password_confirm", "admin_phone_cooldown_override", "admin_phone_cooldown_status", "admin_users_directory",
  "branch_location_set", "my_secondary_phone", "organization_legal_name_set", "secondary_phone_cancel", "secondary_phone_change",
  "secondary_phone_make_primary", "secondary_phone_renew", "secondary_phone_reserve",
];

export const ALLOWED_AUTH_KEYS = [
  "mailer_autoconfirm", "disable_signup", "external_email_enabled", "external_phone_enabled", "phone_autoconfirm", "sms_provider",
  "hook_send_sms_enabled", "hook_before_user_created_enabled", "hook_mfa_verification_attempt_enabled",
  "security_captcha_enabled", "security_captcha_provider", "security_manual_linking_enabled",
  "mfa_phone_enroll_enabled", "mfa_phone_verify_enabled", "mfa_totp_enroll_enabled", "mfa_totp_verify_enabled", "mfa_max_enrolled_factors",
  "mailer_secure_email_change_enabled", "external_anonymous_users_enabled", "external_google_enabled", "external_facebook_enabled",
  "rate_limit_email_sent", "rate_limit_sms_sent", "rate_limit_otp", "rate_limit_anonymous_users",
  // R2: leaked-password protection and the redirect allow-list (URLs and booleans, not secrets)
  "password_hibp_enabled", "password_min_length", "password_required_characters", "site_url", "uri_allow_list",
];
// Password POLICY settings (a boolean and two numbers/strings of character classes) contain the word "password" but are not credentials.
export const PASSWORD_POLICY_KEYS = ["password_hibp_enabled", "password_min_length", "password_required_characters"];
const SECRETISH = /(secret|token|password|passwd|pass$|_key$|key_|jwt|credential|private|signing|sid$|auth_token|smtp_user|smtp_pass)/i;

export const WORKER_SECRET_NAMES = ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "SUPABASE_SEND_SMS_HOOK_SECRET", "AUTH_PASSWORD_PREVIEW_GRANT_SECRET", "PHONE_OTP_HMAC_KEYS"];

const FORBIDDEN_SQL = /\b(insert|update|delete|alter|create|drop|grant|revoke|truncate|copy|call|do|execute|vacuum|reindex|comment|lock|set|reset|listen|notify|merge|refresh|reassign|security|import|load)\b/i;
export function assertReadOnlySql(sql) {
  const s = String(sql).trim().replace(/;\s*$/, "");
  if (!/^(select|with)\b/i.test(s)) throw new Error("inspection SQL must start with SELECT or WITH");
  if (s.includes(";")) throw new Error("inspection SQL must be a single statement");
  if (/--|\/\*/.test(s)) throw new Error("inspection SQL must not contain comments");
  if (FORBIDDEN_SQL.test(s.replace(/'[^']*'/g, "''"))) throw new Error("inspection SQL contains a forbidden keyword");
  return s;
}

// The repo's own function-permission inventory (scripts/function-permissions.sql) as ONE read-only SELECT: the `set local search_path` line
// is dropped because the read-only endpoint refuses SET; signatures are normalised in normalizeSignature() instead.
export const PERMISSION_INVENTORY_SQL = fs.readFileSync(path.join(REPO, "scripts/function-permissions.sql"), "utf8").replace(/^\s*set local[^;]*;\s*/i, "").trim().replace(/;\s*$/, "");

const fnList = DISPUTED_FUNCTIONS.map((f) => `'${f}'`).join(",");
export const QUERIES = {
  disputed_function_rights: `select p.oid::regprocedure::text as fn, has_function_privilege('service_role', p.oid, 'execute') as service_role_exec, has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (${fnList}) order by 1`,
  alias_census: `select count(*) as alias_users, count(*) filter (where email_confirmed_at is null) as unconfirmed_alias_users, count(*) filter (where email_confirmed_at is null and not exists (select 1 from public.profiles p where p.user_id = u.id)) as unconfirmed_without_profile from auth.users u where lower(u.email) like 'p%@craftsman-login.aladdin.invalid'`,
  migrations: `select version from supabase_migrations.schema_migrations order by 1`,
  legacy_challenge_table: `select c.relname as table_name, s.n_live_tup as approx_rows from pg_class c join pg_namespace n on n.oid = c.relnamespace left join pg_stat_user_tables s on s.relid = c.oid where n.nspname = 'public' and c.relname = 'phone_verification_challenges'`,
  permission_inventory: PERMISSION_INVENTORY_SQL,
  authority_objects: `select to_regclass('app.phone_verification_config') is not null as phone_authority_applied, to_regclass('app.phone_signup_grants') is not null as signup_authority_applied, exists (select 1 from pg_trigger t where t.tgname = 'phone_alias_guard' and not t.tgisinternal) as alias_guard_installed`,
  default_function_privileges: `select pg_get_userbyid(d.defaclrole) as creator, d.defaclacl::text as acl from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace where n.nspname = 'public' and d.defaclobjtype = 'f' order by 1`,
  phone_flags: `select count(*) filter (where phone_e164 is not null) as profiles_with_phone, count(*) filter (where phone_verified_at is not null) as profiles_verified from public.profiles`,
  authority_switches: `select enabled, signup_enabled, alias_guard_mode from app.phone_verification_config`,
};

// ---- network guard -------------------------------------------------------------------------------------------------------------------
const ALLOWED_CALLS = [
  { method: "GET", pattern: /^https:\/\/api\.supabase\.com\/v1\/projects\/[a-z0-9]{10,40}\/config\/auth$/ },
  { method: "POST", pattern: /^https:\/\/api\.supabase\.com\/v1\/projects\/[a-z0-9]{10,40}\/database\/query\/read-only$/, readOnlySql: true },
  { method: "GET", pattern: /^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/[a-f0-9]{32}\/workers\/scripts\/[A-Za-z0-9_-]{1,64}\/secrets$/ },
  { method: "GET", pattern: /^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/[a-f0-9]{32}\/workers\/scripts\/[A-Za-z0-9_-]{1,64}\/settings$/ },
];
export function makeGuardedFetch(fetchImpl, tokens) {
  return async function guardedFetch(method, url, body) {
    const rule = ALLOWED_CALLS.find((r) => r.method === method && r.pattern.test(url));
    if (!rule) throw new Error(`REFUSED: ${method} ${url.replace(/[a-z0-9]{20,}/gi, "<id>")} is not an allowed read-only call`);
    if (rule.readOnlySql) assertReadOnlySql(body?.query);
    const token = url.includes("cloudflare.com") ? tokens.cloudflare : tokens.supabase;
    if (!token) throw new Error("REFUSED: missing token for this call");
    const res = await fetchImpl(url, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { status: res.status, data };
  };
}

// ---- report building (pure) ----------------------------------------------------------------------------------------------------------
export function redactAuthConfig(raw) {
  const out = {};
  for (const key of ALLOWED_AUTH_KEYS) {
    if ((SECRETISH.test(key) && !PASSWORD_POLICY_KEYS.includes(key)) || !(key in (raw ?? {}))) continue;
    const v = raw[key];
    out[key] = typeof v === "string" ? v.slice(0, key === "uri_allow_list" ? 4000 : 40) : typeof v === "number" || typeof v === "boolean" || v === null ? v : "[object]";
  }
  return out;
}
export function interpretAuth(cfg, expected) {
  const yes = (v) => v === true;
  return {
    email_confirmation_required: cfg.mailer_autoconfirm === false ? true : cfg.mailer_autoconfirm === true ? false : "unknown",
    public_signup_open: cfg.disable_signup === false ? true : cfg.disable_signup === true ? false : "unknown",
    captcha_protection_on: yes(cfg.security_captcha_enabled),
    captcha_provider: cfg.security_captcha_provider ?? null,
    phone_provider_enabled: yes(cfg.external_phone_enabled),
    phone_autoconfirm: yes(cfg.phone_autoconfirm),
    sms_provider: cfg.sms_provider ?? null,
    send_sms_hook_enabled: yes(cfg.hook_send_sms_enabled),
    before_user_created_hook_enabled: yes(cfg.hook_before_user_created_enabled),
    phone_mfa_enabled: yes(cfg.mfa_phone_enroll_enabled) || yes(cfg.mfa_phone_verify_enabled),
    anonymous_sign_ins: yes(cfg.external_anonymous_users_enabled),
    leaked_password_protection_on: cfg.password_hibp_enabled === true ? true : cfg.password_hibp_enabled === false ? false : "unknown",
    password_min_length: cfg.password_min_length ?? null,
    redirect_allowlist: { ...redirectAllowlistFindings(cfg.site_url, cfg.uri_allow_list), ...(expected ? { exact_comparison: exactAllowlistDiff(cfg.site_url, cfg.uri_allow_list, expected) } : {}) },
  };
}

/**
 * EXACT comparison of the hosted redirect allow-list with an owner-confirmed expected list (a file in the repository). Entries are compared as
 * literal strings (trimmed, case-sensitive: GoTrue matches the pattern text), so a near-miss such as a trailing slash or `http` vs `https` is
 * reported as one unexpected plus one missing entry. `unexpected` = on the project but not expected (candidates for removal); `missing` =
 * expected but absent (would break a flow if removed by mistake). Pure: nothing is read from or written to the project here.
 */
export function exactAllowlistDiff(siteUrl, allowList, expected) {
  const hosted = String(allowList ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  const want = (expected?.uri_allow_list ?? []).map((e) => String(e).trim());
  const hostedSet = new Set(hosted), wantSet = new Set(want);
  const unexpected = [...new Set(hosted.filter((e) => !wantSet.has(e)))];
  const missing = want.filter((e) => !hostedSet.has(e));
  const siteUrlMatches = expected?.site_url === undefined ? null : String(siteUrl ?? "") === String(expected.site_url);
  return {
    expected_confirmed_by_owner: expected?.confirmed === true,
    site_url_matches: siteUrlMatches,
    unexpected, missing,
    exact: unexpected.length === 0 && missing.length === 0 && siteUrlMatches !== false,
  };
}

/**
 * Classifies the redirect allow-list (comma separated URLs). Reports entries only; nothing here is a secret. "stale" = a host that this
 * project no longer serves (Vercel was retired, ADR-0024); "local" = loopback/dev; "insecure" = plain http that is not loopback;
 * "broad" = a wildcard that matches any host or a whole shared platform domain.
 */
export function redirectAllowlistFindings(siteUrl, allowList) {
  const entries = String(allowList ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  const host = (e) => { try { return new URL(e.replace(/\*+/g, "x")).hostname; } catch { return ""; } };
  const isLocal = (e) => /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(host(e)) || /(^|\/\/)(localhost|127\.0\.0\.1)/.test(e);
  const out = { site_url: siteUrl ?? null, entries: entries.length, stale_vercel: [], local: [], insecure: [], broad: [], duplicates: [], workers_dev: [] };
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.toLowerCase())) out.duplicates.push(e); else seen.add(e.toLowerCase());
    if (/vercel\.(app|com)/i.test(e)) out.stale_vercel.push(e);
    if (isLocal(e)) out.local.push(e);
    else if (/^http:\/\//i.test(e)) out.insecure.push(e);
    if (/^\*+$/.test(e) || /^https?:\/\/\*+(\/.*)?$/i.test(e) || /^https?:\/\/\*\.(vercel\.app|workers\.dev|pages\.dev)/i.test(e)) out.broad.push(e);
    if (/workers\.dev/i.test(e)) out.workers_dev.push(e);
  }
  return out;
}
export function workerSecretPresence(secretsResult) {
  const names = new Set((Array.isArray(secretsResult) ? secretsResult : []).map((s) => String(s?.name ?? "")));
  return Object.fromEntries(WORKER_SECRET_NAMES.map((n) => [n, names.has(n)]));
}

// ---- offline comparisons against this checkout (pure; tested) ----------------------------------------------------------------------------
export function repoMigrationVersions(dir = path.join(REPO, "supabase/migrations")) {
  return fs.readdirSync(dir).filter((f) => /^\d{14}_.+\.sql$/.test(f)).map((f) => f.slice(0, 14)).sort();
}
export const R2_MARKER_MIGRATIONS = ["20261028090001", "20261030090001", "20261030090002", "20261031090001"];
export function migrationDiff(appliedRows, repoVersions) {
  const applied = (appliedRows ?? []).map((r) => String(r.version)).sort();
  const a = new Set(applied), r = new Set(repoVersions);
  return {
    applied_count: applied.length,
    repo_count: repoVersions.length,
    latest_applied: applied.at(-1) ?? null,
    applied_not_in_repo: applied.filter((v) => !r.has(v)),
    repo_not_applied: repoVersions.filter((v) => !a.has(v)),
    // A repo migration that is MISSING on the project but OLDER than its newest applied one is out of order: `supabase db push` refuses it
    // (it would need --include-all). Report it; never repair around it. Empty = a plain forward push is possible.
    out_of_order_missing: repoVersions.filter((v) => !a.has(v) && applied.length > 0 && v < applied[applied.length - 1]),
    plain_push_possible: !repoVersions.some((v) => !a.has(v) && applied.length > 0 && v < applied[applied.length - 1]) && !applied.some((v) => !r.has(v)),
    r2_markers: Object.fromEntries(R2_MARKER_MIGRATIONS.map((v) => [v, a.has(v)])),
  };
}
/** pg prints a function unqualified when its schema is on the search_path; the reviewed contract is always schema-qualified. */
export function normalizeSignature(sig) {
  const head = String(sig).split("(")[0];
  return head.includes(".") ? String(sig) : `public.${sig}`;
}
export function contractVersionFor(latestApplied, versions) {
  return versions.filter((v) => v <= String(latestApplied ?? "")).at(-1) ?? null;
}
export function loadReviewedContract(latestApplied, dir = path.join(REPO, "supabase/permissions")) {
  const versions = fs.readdirSync(dir).filter((f) => /^\d{14}\.json$/.test(f)).map((f) => f.slice(0, 14)).sort();
  const version = contractVersionFor(latestApplied, versions);
  if (!version) return null;
  const value = JSON.parse(fs.readFileSync(path.join(dir, `${version}.json`), "utf8"));
  return { version, functions: value.functions };
}
const stable = (v) => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
/** Compares the hosted inventory with the reviewed contract: signature-level, definer/config and EXECUTE-right differences, capped. */
export function permissionDiff(hostedPermissions, contract, cap = 60) {
  const live = new Map((hostedPermissions ?? []).map((f) => [normalizeSignature(f.signature), f]));
  const want = new Map(contract.functions.map((f) => [f.signature, f]));
  const problems = [];
  for (const [sig, f] of live) {
    const e = want.get(sig);
    if (!e) { problems.push({ fn: sig, issue: "not in the reviewed contract" }); continue; }
    for (const k of ["definer", "config", "grants", "effective"]) if (stable(f[k]) !== stable(e[k])) problems.push({ fn: sig, issue: `${k} differs`, hosted: f[k], reviewed: e[k] });
  }
  for (const sig of want.keys()) if (!live.has(sig)) problems.push({ fn: sig, issue: "in the reviewed contract but missing on the hosted database" });
  return { contract_version: contract.version, hosted_functions: live.size, contract_functions: want.size, differences: problems.length, listed: problems.slice(0, cap), truncated: problems.length > cap };
}
export const WORKER_PLAIN_VARS = ["PHONE_VERIFICATION_ENABLED", "PHONE_SIGNUP_VERIFICATION_ENABLED", "PHONE_OTP_DELIVERY", "NEXT_PUBLIC_APP_ENV", "WHATSAPP_DELIVERY_ENABLED"];
/** Binding NAMES by type, plus the VALUE only of allow-listed non-secret switches (never any other value). */
export function workerSettingsSummary(settingsResult) {
  const bindings = Array.isArray(settingsResult?.bindings) ? settingsResult.bindings : [];
  const names = (t) => bindings.filter((b) => b?.type === t).map((b) => String(b.name));
  const switches = {};
  for (const b of bindings) if (b?.type === "plain_text" && WORKER_PLAIN_VARS.includes(b.name)) switches[b.name] = String(b.text).slice(0, 40);
  const legacy = ["WHATSAPP_OTP_TEMPLATE", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"].filter((n) => bindings.some((b) => b?.name === n));
  return { secret_names: names("secret_text"), plain_var_names: names("plain_text"), switches, legacy_app_whatsapp_bindings_present: legacy };
}
const rowsOf = (r) => (r.status >= 200 && r.status < 300 && Array.isArray(r.data) ? r.data : null);
export async function inspectProject({ label, ref, guardedFetch, cf, repo, expected, only }) {
  if (only === "migrations") {
    // Narrowest access: ONE read-only SELECT of the applied migration versions. No Auth config, no function inventory, no Worker call.
    const r = await guardedFetch("POST", `https://api.supabase.com/v1/projects/${ref}/database/query/read-only`, { query: QUERIES.migrations });
    const rows = rowsOf(r);
    return { environment: label, project_ref_suffix: ref.slice(-4), scope: "migrations-only", migration_diff: rows ? migrationDiff(rows, repo?.migrations ?? repoMigrationVersions()) : null, errors: rows ? [] : [`migrations: HTTP ${r.status}`] };
  }
  const report = { environment: label, project_ref_suffix: ref.slice(-4), auth: null, auth_interpretation: null, database: {}, whatsapp_delivery_secrets: null, errors: [] };
  const cfg = await guardedFetch("GET", `https://api.supabase.com/v1/projects/${ref}/config/auth`);
  if (cfg.status === 200 && cfg.data) {
    report.auth = redactAuthConfig(cfg.data);
    report.auth_interpretation = interpretAuth(report.auth, expected);
  } else report.errors.push(`auth config: HTTP ${cfg.status}`);
  for (const [name, sql] of Object.entries(QUERIES)) {
    const r = await guardedFetch("POST", `https://api.supabase.com/v1/projects/${ref}/database/query/read-only`, { query: sql });
    const rows = rowsOf(r);
    if (rows) report.database[name] = rows;
    else report.database[name] = null, report.errors.push(`${name}: HTTP ${r.status}`);
  }
  const migrationRows = report.database.migrations;
  if (migrationRows) {
    report.migration_diff = migrationDiff(migrationRows, repo?.migrations ?? repoMigrationVersions());
    delete report.database.migrations; // the full version list is in migration_diff; keep the report small
  }
  const inventoryRows = report.database.permission_inventory;
  if (inventoryRows?.[0]?.permissions) {
    const contract = repo?.contract ?? loadReviewedContract(report.migration_diff?.latest_applied);
    report.permission_diff = contract ? permissionDiff(inventoryRows[0].permissions, contract) : { error: "no reviewed contract at or below the hosted migration version" };
    delete report.database.permission_inventory;
  }
  const disputed = report.database.disputed_function_rights;
  if (disputed) report.disputed_functions_summary = { found: disputed.length, expected: DISPUTED_FUNCTIONS.length, with_service_role_execute: disputed.filter((f) => f.service_role_exec).length, with_anon_execute: disputed.filter((f) => f.anon_exec).length };
  if (cf) {
    const s = await guardedFetch("GET", `https://api.cloudflare.com/client/v4/accounts/${cf.account}/workers/scripts/${cf.script}/secrets`);
    if (s.status === 200) report.whatsapp_delivery_secrets = workerSecretPresence(s.data?.result);
    else report.errors.push(`worker secrets: HTTP ${s.status}`);
    const st = await guardedFetch("GET", `https://api.cloudflare.com/client/v4/accounts/${cf.account}/workers/scripts/${cf.script}/settings`);
    if (st.status === 200) report.worker_settings = workerSettingsSummary(st.data?.result);
    else report.errors.push(`worker settings: HTTP ${st.status}`);
  } else report.errors.push("worker secrets: not requested (no CLOUDFLARE_API_TOKEN / CF_ACCOUNT_ID / worker name)");
  return report;
}

export function requirements(env) {
  const need = [];
  if (!env.SUPABASE_ACCESS_TOKEN) need.push("SUPABASE_ACCESS_TOKEN - a Supabase personal access token with READ access to the project(s) (Management API: config/auth + read-only database query)");
  return need;
}

export async function main(argv, env, fetchImpl = fetch, log = console.log) {
  const which = argv.includes("--env") ? argv[argv.indexOf("--env") + 1] : "both";
  if (!["acceptance", "production", "both"].includes(which)) { log("usage: --env acceptance|production|both"); return 2; }
  const wanted = which === "both" ? ["acceptance", "production"] : [which];
  const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : undefined;
  if (only !== undefined && only !== "migrations") { log("usage: --only migrations"); return 2; }
  let expectedFile = null;
  if (argv.includes("--expected")) {
    try { expectedFile = JSON.parse(fs.readFileSync(argv[argv.indexOf("--expected") + 1], "utf8")); } catch { log("--expected: the file could not be read as JSON"); return 2; }
  }
  const missing = requirements(env);
  const refs = Object.fromEntries(wanted.map((w) => [w, env[`SUPABASE_REF_${w.toUpperCase()}`]]));
  for (const w of wanted) if (!refs[w]) missing.push(`SUPABASE_REF_${w.toUpperCase()} - the ${w} project reference (not stored in the repository)`);
  if (missing.length) {
    log("NOT RUN - authorisation / connector access is required. Nothing was called.\n  - " + missing.join("\n  - ") +
      "\n  Optional (WhatsApp secret presence): CLOUDFLARE_API_TOKEN (Workers Scripts:Read), CF_ACCOUNT_ID, CF_WORKER_ACCEPTANCE, CF_WORKER_PRODUCTION.\n  This script only issues GET /config/auth, POST /database/query/read-only (SELECT only) and GET .../secrets (names only).");
    return 3;
  }
  const guardedFetch = makeGuardedFetch(fetchImpl, { supabase: env.SUPABASE_ACCESS_TOKEN, cloudflare: env.CLOUDFLARE_API_TOKEN });
  const reports = [];
  for (const w of wanted) {
    const script = env[`CF_WORKER_${w.toUpperCase()}`];
    const cf = env.CLOUDFLARE_API_TOKEN && env.CF_ACCOUNT_ID && script ? { account: env.CF_ACCOUNT_ID, script } : null;
    reports.push(await inspectProject({ label: w, ref: refs[w], guardedFetch, cf: only ? null : cf, expected: expectedFile?.[w], only }));
  }
  log(JSON.stringify({ generated_at: new Date().toISOString(), read_only: true, reports }, null, 2));
  return reports.some((r) => r.errors.some((e) => /^(auth config|disputed_function_rights|migrations)/.test(e))) ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).then((code) => { process.exitCode = code; }, (e) => { console.error(String(e?.message ?? e).slice(0, 300)); process.exitCode = 1; });
}
