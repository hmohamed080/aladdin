#!/usr/bin/env node
// OWNER-RUN, ONE-TIME helper: put the existing WhatsApp OTP admin GRANT KEY (the value stored as OTP_ADMIN_GRANT_SECRET) into the ACCEPTANCE
// database table app.whatsapp_otp_grant_key. It is a DATA write (one row). It runs no DDL and creates no migration.
//
//   node provision-grant-key.mjs            DRY RUN (default): every check, no write
//   node provision-grant-key.mjs --write    the real write, after a typed confirmation
//
// WHAT IT NEVER DOES
//   * It never takes the key, the database URI or the password from an argument, a file, an environment variable or a pipe: both are typed or
//     pasted at HIDDEN prompts of an interactive terminal (paste from your password manager).
//   * It never puts the key into SQL text: the key is sent as a bound bytea PARAMETER ($1) of a constant statement.
//   * It never prints, logs, stores or reads back the key or the URI. It prints only a 12-hex-digit SHA-256 fingerprint of the key bytes.
//   * It never writes a file. It never runs DDL. It never overwrites a key: if a row exists it stops.
//   * It never connects to Production: the URI must name the ACCEPTANCE project, the Production reference is refused anywhere in it, and TLS is
//     verified against the pinned Supabase root CA (certificate and host name), so there is no unverified connection.
//
// Exit codes: 0 done (or dry run passed) · 1 refused / failed safely · 2 usage.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ACCEPTANCE_REF = "nxossqhdfltcqdwvbewi";
export const PRODUCTION_REF = "kkpkgjrweysgvhvkhzun";
/** The migration whose objects must exist (it created the table). Later migrations are fine. */
export const REQUIRED_MIGRATION = "20261103090001";
/** Acceptance runs this PostgreSQL major.minor (Production is on a different one). Update when Acceptance is upgraded. */
export const ACCEPTANCE_PG_PREFIX = "17.11";
/** SHA-256 of the pinned Supabase Root 2021 CA (public certificate, compare with the dashboard: Database > Settings > SSL). */
export const PINNED_CA_SHA256 = "807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa";
export const CONFIRMATION_PHRASE = "PROVISION ACCEPTANCE";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POOLER_HOST = /^aws-\d+-[a-z]+-[a-z]+-\d+\.pooler\.supabase\.com$/;

// ---------------------------------------------------------------------------------------------------------------------------------
// Pure validation (unit-tested)
// ---------------------------------------------------------------------------------------------------------------------------------

/** "whsec_" + canonical base64 of >= 32 bytes. Same rule as the Worker (keyBytes) and the table CHECK. Returns { bytes } or { error }. */
export function validateGrantKey(input) {
  const value = String(input ?? "").trim();
  if (value.length === 0) return { error: "empty" };
  if (value.length > 200) return { error: "too_long" };
  if (!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(value)) return { error: "format" };
  const encoded = value.slice(6);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) return { error: "not_canonical_base64" };
  if (bytes.length < 32) return { error: "too_short" };
  if (new Set(bytes).size < 16) return { error: "low_entropy" };
  return { bytes };
}

export const fingerprint = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * The ONLY accepted targets are the Acceptance session/transaction pooler (user postgres.<ref>) or the Acceptance direct host. Anything that
 * mentions the Production reference, in any part and in any encoding, is refused. Returns { config } or { error }. Never echoes the input.
 */
export function parseTarget(uri) {
  const raw = String(uri ?? "").trim();
  if (!raw) return { error: "empty" };
  const lowered = raw.toLowerCase();
  let decoded = lowered;
  try { decoded = decodeURIComponent(lowered); } catch { return { error: "malformed" }; }
  if (lowered.includes(PRODUCTION_REF) || decoded.includes(PRODUCTION_REF)) return { error: "production_refused" };
  let u;
  try { u = new URL(raw); } catch { return { error: "malformed" }; }
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") return { error: "not_postgres" };
  const user = decodeURIComponent(u.username);
  const host = u.hostname.toLowerCase();
  const password = decodeURIComponent(u.password);
  if (!password) return { error: "no_password" };
  const pooler = POOLER_HOST.test(host) && user === `postgres.${ACCEPTANCE_REF}` && (u.port === "" || u.port === "5432" || u.port === "6543");
  const direct = host === `db.${ACCEPTANCE_REF}.supabase.co` && user === "postgres" && (u.port === "" || u.port === "5432");
  if (!pooler && !direct) return { error: "not_acceptance" };
  const database = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
  if (database !== "postgres") return { error: "not_acceptance" };
  // Any other project reference-looking token in the user or host is suspicious; the checks above already require exact Acceptance values.
  return { config: { host, port: Number(u.port || 5432), user, password, database, kind: pooler ? "pooler" : "direct" } };
}

export function verifyPinnedCa(pem) {
  const der = pem.toString("utf8").replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g, "");
  return createHash("sha256").update(Buffer.from(der, "base64")).digest("hex") === PINNED_CA_SHA256;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Constant SQL. The key only ever travels as the bound parameter of Q_INSERT.
// ---------------------------------------------------------------------------------------------------------------------------------
const Q_IDENTITY = `select current_setting('server_version') as server_version, current_database() as db`;
const Q_HISTORY = `select count(*)::int as n, coalesce(max(version), '') as latest from supabase_migrations.schema_migrations`;
const Q_TABLE = `select (to_regclass('app.whatsapp_otp_grant_key') is not null) as present, coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('app.whatsapp_otp_grant_key')), false) as rls`;
const Q_COUNT = `select count(*)::int as n from app.whatsapp_otp_grant_key`;
const Q_SIGNATURE = `select
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'app') and c.relkind in ('r', 'v', 'm', 'p', 'S', 'f')) as relations,
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app')) as functions,
  (select count(*)::int from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname in ('public', 'app')) as constraints,
  (select count(*)::int from pg_policies where schemaname in ('public', 'app')) as policies,
  (select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname in ('public', 'app')) as triggers`;
const Q_LOCK = `lock table app.whatsapp_otp_grant_key in access exclusive mode`;
const Q_INSERT = `insert into app.whatsapp_otp_grant_key (id, key) values (1, $1) on conflict (id) do nothing returning id`;
const Q_VERIFY = `select encode(sha256(key), 'hex') as fp, octet_length(key)::int as len from app.whatsapp_otp_grant_key where id = 1`;

// ---------------------------------------------------------------------------------------------------------------------------------
// Terminal helpers
// ---------------------------------------------------------------------------------------------------------------------------------
export function readHidden(prompt, { stdin = process.stdin, stdout = process.stdout } = {}) {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") return reject(new Error("an interactive terminal is required (hidden prompt)"));
    stdout.write(prompt);
    const chars = [];
    const done = () => { stdin.off("data", onData); stdin.setRawMode(false); stdin.pause(); };
    const onData = (data) => {
      for (const ch of String(data)) {
        if (ch === "\u0003") { done(); stdout.write("\n"); return reject(new Error("cancelled")); }
        if (ch === "\r" || ch === "\n") { done(); stdout.write("\n"); return resolve(chars.join("")); }
        if (ch === "\u007f" || ch === "\b") { chars.pop(); continue; }
        if (ch >= " ") chars.push(ch);
      }
    };
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

export function readLine(prompt, { stdin = process.stdin, stdout = process.stdout } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: stdin, output: stdout, terminal: false });
    stdout.write(prompt);
    rl.once("line", (line) => { rl.close(); resolve(line); });
    rl.once("close", () => resolve(""));
  });
}

/** Output channel that refuses to print any registered secret, whatever a caller passes. */
export function makeOut(write, secrets) {
  return (text) => {
    let s = String(text);
    for (const secret of secrets) if (secret && s.includes(secret)) s = s.split(secret).join("[hidden]");
    write(s + "\n");
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The run (every collaborator injected so each refusal is testable without a network)
// ---------------------------------------------------------------------------------------------------------------------------------
class Refuse extends Error {}
const refuse = (m) => { throw new Refuse(m); };

export async function run(deps) {
  const secrets = [];
  const out = makeOut(deps.write ?? ((s) => process.stdout.write(s)), secrets);
  const args = deps.argv ?? [];
  const known = new Set(["--write", "--help"]);
  const unknown = args.filter((a) => !known.has(a));
  if (unknown.length > 0 || args.includes("--help")) {
    out("usage: node provision-grant-key.mjs [--write]\n  (no argument) dry run: all checks, no write\n  --write       provision the Acceptance grant key after a typed confirmation\nThe key and the database URI are entered at hidden prompts only; they are never accepted as arguments.");
    return unknown.length > 0 ? 2 : 0;
  }
  const write = args.includes("--write");
  let bytes = null;
  let sql = null;
  try {
    out(`Acceptance grant-key provisioning (${write ? "WRITE mode" : "dry run, no write"}). Target: Acceptance project only.`);
    if (!verifyPinnedCa(deps.ca)) refuse("the pinned Supabase CA file does not match its expected fingerprint");

    // 1. The target, typed at a hidden prompt, validated before any network use
    const uri = await deps.hidden("Acceptance database URI (Supabase Dashboard > Connect > Session pooler, password filled in) [hidden]: ");
    secrets.push(uri);
    const target = parseTarget(uri);
    if (target.error) refuse(target.error === "production_refused" ? "REFUSED: that connection string mentions the Production project" : `REFUSED: not a valid Acceptance connection string (${target.error})`);
    secrets.push(target.config.password);

    // 2. The key, typed at a hidden prompt
    const keyText = await deps.hidden("Acceptance OTP_ADMIN_GRANT_SECRET value from your password manager [hidden]: ");
    secrets.push(keyText, String(keyText).trim());
    const checked = validateGrantKey(keyText);
    if (checked.error) refuse(`REFUSED: the key is not valid (${checked.error}); nothing was sent`);
    bytes = checked.bytes;
    const localFp = fingerprint(bytes);
    secrets.push(bytes.toString("base64"), bytes.toString("hex"), localFp);
    const shown = localFp.slice(0, 12);
    out(`Key accepted locally: ${bytes.length} bytes, fingerprint ${shown} (compare with your own record; this is a hash, not the key).`);

    // 3. Connect (TLS verified against the pinned CA and the host name)
    try {
      sql = await deps.connect(target.config, deps.ca);
    } catch (e) {
      refuse(`could not connect (${String(e && e.code ? e.code : "error").slice(0, 40)})`);
    }

    // 4. Independent target verification and state, all read-only in ONE transaction
    const before = await sql.begin("read only", async (tx) => {
      const [ident] = await tx.unsafe(Q_IDENTITY);
      if (!String(ident?.server_version ?? "").startsWith(deps.pgPrefix ?? ACCEPTANCE_PG_PREFIX)) refuse("REFUSED: the server version does not match Acceptance");
      const [hist] = await tx.unsafe(Q_HISTORY);
      if (!hist || String(hist.latest) < REQUIRED_MIGRATION) refuse(`REFUSED: migration ${REQUIRED_MIGRATION} is not applied on this database`);
      const [tbl] = await tx.unsafe(Q_TABLE);
      if (!tbl?.present) refuse("REFUSED: app.whatsapp_otp_grant_key does not exist on this database");
      if (!tbl.rls) refuse("REFUSED: row-level security is not enabled on the grant-key table");
      const [cnt] = await tx.unsafe(Q_COUNT);
      if (cnt.n !== 0) refuse("REFUSED: a grant key already exists. This helper never overwrites a key (rotation is a separate, reviewed step).");
      const [sig] = await tx.unsafe(Q_SIGNATURE);
      return { hist, sig };
    });
    out(`Target verified: Acceptance (pooler user, pinned TLS, PostgreSQL ${deps.pgPrefix ?? ACCEPTANCE_PG_PREFIX}), migration history ${before.hist.n} rows, latest ${before.hist.latest}, grant-key table present with RLS and 0 rows.`);

    if (!write) {
      out("DRY RUN complete: nothing was written. Run again with --write to provision.");
      return 0;
    }

    // 5. Typed confirmation
    const typed = String((await deps.line(`Type ${CONFIRMATION_PHRASE} to write one row (anything else cancels): `)) ?? "").trim();
    if (typed !== CONFIRMATION_PHRASE) refuse("cancelled: the confirmation phrase did not match; nothing was written");

    // 6. The write: ONE transaction, a constant statement, the key as a bound bytea parameter, verified before COMMIT
    await sql.begin(async (tx) => {
      await tx.unsafe(Q_LOCK);
      const [again] = await tx.unsafe(Q_COUNT);
      if (again.n !== 0) refuse("REFUSED: a grant key appeared meanwhile; nothing was written");
      const inserted = await tx.unsafe(Q_INSERT, [bytes]);
      if (inserted.length !== 1) refuse("REFUSED: the row was not inserted; nothing was written");
      const [row] = await tx.unsafe(Q_VERIFY);
      if (!row || row.fp !== localFp || row.len !== bytes.length) refuse("ABORTED: the stored key does not match (fingerprint mismatch); rolled back, nothing was written");
    });

    // 7. After commit: fresh independent read of count, fingerprint and schema/history signature
    const after = await sql.begin("read only", async (tx) => {
      const [cnt] = await tx.unsafe(Q_COUNT);
      const [row] = await tx.unsafe(Q_VERIFY);
      const [hist] = await tx.unsafe(Q_HISTORY);
      const [sig] = await tx.unsafe(Q_SIGNATURE);
      return { cnt, row, hist, sig };
    });
    const sameSchema = JSON.stringify(after.sig) === JSON.stringify(before.sig);
    const sameHistory = after.hist.n === before.hist.n && after.hist.latest === before.hist.latest;
    const match = after.row?.fp === localFp;
    out(`Provisioned. Rows: ${after.cnt.n} (expected 1). Fingerprint match: ${match ? "yes" : "NO"} (${shown}). Schema signature unchanged: ${sameSchema ? "yes" : "NO"}. Migration history unchanged: ${sameHistory ? "yes" : "NO"} (${after.hist.n} rows, latest ${after.hist.latest}).`);
    if (after.cnt.n !== 1 || !match || !sameSchema || !sameHistory) {
      out("WARNING: a post-write check failed. Do not continue; report this output (it contains no secret).");
      return 1;
    }
    out("Done. The key was not read back. Next: close this terminal; the grant key is now configured for Acceptance.");
    return 0;
  } catch (e) {
    out(e instanceof Refuse ? e.message : `failed safely (${String(e && e.code ? e.code : e && e.name ? e.name : "error").slice(0, 40)}); no key was printed`);
    return 1;
  } finally {
    if (bytes) bytes.fill(0);
    try { await sql?.end({ timeout: 2 }); } catch { /* nothing to clean up */ }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Real wiring
// ---------------------------------------------------------------------------------------------------------------------------------
/**
 * The Postgres driver is the repo's own pinned `postgres@3.4.9` (root pnpm-lock.yaml, used by edge/media-worker). Install it the normal way
 * (`pnpm install --frozen-lockfile` at the repo root); this helper adds no dependency, lockfile or package of its own, and refuses any other version.
 */
export const DRIVER_VERSION = "3.4.9";
export function loadDriver() {
  const require = createRequire(import.meta.url);
  const roots = [path.join(HERE, "../../../edge/media-worker"), HERE];
  let entry;
  try { entry = require.resolve("postgres", { paths: roots }); } catch { throw Object.assign(new Error("driver missing"), { code: "DRIVER_MISSING" }); }
  // walk up from the entry file to the package that is named "postgres"
  let dir = path.dirname(entry);
  let version = null;
  for (let i = 0; i < 6 && version === null; i++, dir = path.dirname(dir)) {
    const manifest = path.join(dir, "package.json");
    if (!fs.existsSync(manifest)) continue;
    const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
    if (pkg.name === "postgres") version = pkg.version;
  }
  if (version !== DRIVER_VERSION) throw Object.assign(new Error("driver version"), { code: "DRIVER_VERSION" });
  return require(entry);
}

async function realConnect(config, ca) {
  const postgres = loadDriver();
  const sql = postgres({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: { ca, rejectUnauthorized: true, servername: config.host },
    max: 1,
    prepare: false,
    connect_timeout: 15,
    idle_timeout: 10,
    onnotice: () => {},
  });
  await sql`select 1`; // surfaces a connection / authentication problem here (its message is never printed)
  return sql;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ca = fs.readFileSync(path.join(HERE, "supabase-root-2021-ca.crt"));
  run({
    argv: process.argv.slice(2),
    ca,
    hidden: (p) => readHidden(p),
    line: (p) => readLine(p),
    connect: realConnect,
  }).then((code) => { process.exitCode = code; }, () => { process.exitCode = 1; });
}
