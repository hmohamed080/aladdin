#!/usr/bin/env node
/**
 * Scratch proof for the Production catch-up plan. It touches ONLY a throwaway database (pc_proof) that it creates inside the local disposable container
 * supabase_db_aladdin_r2_rc2_fresh from a pg_dump of that container's own `postgres` database, and drops at the end. The `postgres` database of the container is never
 * changed. It never connects to a hosted database.
 *   node scripts/hosted-db/prod-catchup-scratch-proof.mjs
 * In pc_proof it (1) applies the migrations Production already has but the container lacks (20261110090001..20261112090001), (2) fingerprints the catalog
 * (catalog-fingerprint.sql), (3) applies the plan's pending migrations with timing (ON_ERROR_STOP), committing after an `alter type ... add value` migration because Postgres
 * cannot use a new enum value in the transaction that adds it, (4) fingerprints again, (5) runs the forward-fixes in undo order (their own BEGIN/COMMIT removed),
 * (6) fingerprints a third time. catalog-diff.mjs then checks: pre -> post is exactly the plan's `changed` list; pre -> after the forward-fixes has no difference except
 * the enum values (an enum value can never be dropped in Postgres; the only recovery is the backup, and an unused extra value is harmless); and the state after the first
 * (The later migrations also re-create functions that exist only inside the plan, so there is no meaningful intermediate state to restore: the later forward-fix is part of the full undo.)
 */
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PLANS, FORWARD_FIX, PC_LATER } from "./acceptance-gate.mjs";
import { verify } from "./verify-permissions-readonly.mjs";

const C = "supabase_db_aladdin_r2_rc2_fresh", DB = "pc_proof";
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const P = PLANS["prod-catchup"];
const dir = join(repo, "supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const v = (f) => f.slice(0, 14);
const fp = readFileSync(join(here, "catalog-fingerprint.sql"), "utf8");
const strip = (t) => t.replace(/^\s*(begin|commit)\s*;\s*$/gim, "");
const run = (args, opt = {}) => { const r = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, MSYS_NO_PATHCONV: "1" }, ...opt }); if (r.status !== 0) throw new Error(`docker ${args.slice(0, 3).join(" ")} failed: ${r.stderr || r.stdout}`); return r.stdout; };
const sql = (db, q) => run(["exec", C, "psql", "-U", "supabase_admin", "-d", db, "-Atc", q]).trim();

const present = sql("postgres", "select string_agg(version, ',') from supabase_migrations.schema_migrations").split(",");
const before = sql("postgres", "select count(*) from supabase_migrations.schema_migrations");
sql("postgres", `drop database if exists ${DB}`);
sql("postgres", `create database ${DB} owner postgres`);
run(["exec", C, "sh", "-c", `pg_dump -U supabase_admin -d postgres | psql -U supabase_admin -d ${DB} -q -v ON_ERROR_STOP=1 > /dev/null`]);

const missingPre = files.map(v).filter((x) => x <= P.latest && !present.includes(x) && x >= "20261110090001");
const snap = (n) => `\\t on\n\\a\n\\o /tmp/pc_${n}.json\n${fp}\n\\o\n\\t off\n`;
let s = "\\set ON_ERROR_STOP on\n\\timing on\nbegin;\n";
for (const f of files.filter((f) => missingPre.includes(v(f)))) s += `\\echo >>> pre ${f}\n${readFileSync(join(dir, f), "utf8")}\n`;
const permSql = readFileSync(join(repo, "scripts/function-permissions.sql"), "utf8").replace("set local search_path=pg_catalog;", "").trim().replace(/;$/, "");
s += snap("pre");
s += `set search_path=pg_catalog;\n\\t on\n\\a\n\\o /tmp/pc_permpre.json\n${permSql};\n\\o\n\\t off\nreset search_path;\n`;
for (const f of files.filter((f) => P.pending.includes(v(f)))) {
  const text = readFileSync(join(dir, f), "utf8");
  s += `\\echo >>> ${f}\n${text}\n`;
  if (/^\s*alter\s+type\s+.*\badd\s+value\b/im.test(text)) s += "commit;\nbegin;\n"; // the new enum value must be committed before a later migration uses it
  if (v(f) === "20261122090002" && PC_LATER.length) s += snap("base"); // state after the first 27, before the later migrations
}
s += snap("post");
// function permission inventory after the last migration (same SQL as the hosted read-only check), compared below with the post contract
s += `set search_path=pg_catalog;\n\\t on\n\\a\n\\o /tmp/pc_perm.json\n${permSql};\n\\o\n\\t off\nreset search_path;\n`;
(process.env.PC_SKIP_FIXES ? [] : P.fixes).forEach((fx, i) => { // PC_SKIP_FIXES=1 only for measuring the diff of new migrations
  s += `\\echo >>> forward-fix ${FORWARD_FIX[fx].file}\n${strip(readFileSync(join(here, FORWARD_FIX[fx].file), "utf8"))}\n`;

});
s += `${snap("after")}rollback;\n`;
const tmp = mkdtempSync(join(tmpdir(), "pc-proof-"));
writeFileSync(join(tmp, "proof.sql"), s);
run(["cp", join(tmp, "proof.sql"), `${C}:/tmp/pc_proof.sql`]);
const t0 = Date.now();
let out;
try { out = run(["exec", C, "psql", "-U", "postgres", "-d", DB, "-X", "-f", "/tmp/pc_proof.sql"]); }
finally { sql("postgres", `drop database if exists ${DB}`); }
const secs = ((Date.now() - t0) / 1000).toFixed(1);
const sum = [...out.matchAll(/^Time: ([\d.]+) ms/gm)].reduce((a, m) => a + Number(m[1]), 0);
console.log(`replayed ${missingPre.length} pre + ${P.pending.length} pending + ${P.fixes.length} forward-fixes in a throwaway database; wall ${secs}s, statement time ${(sum / 1000).toFixed(2)}s, no error`);
for (const n of ["pre", "post", ...(PC_LATER.length ? ["base"] : []), "after", "perm", "permpre"]) run(["cp", `${C}:/tmp/pc_${n}.json`, join(tmp, `${n}.json`)]);
const cd = (...a) => spawnSync("node", [join(here, "catalog-diff.mjs"), ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const a = cd(join(tmp, "pre.json"), join(tmp, "post.json"), "--expect-changed", P.changed.join(";"));
console.log("pre -> post:", a.status === 0 ? a.stdout.trim().split("\n").at(-1) : `FAILED\n${a.stderr}`);
if (PC_LATER.length) { writeFileSync(join(tmp, "later.txt"), cd(join(tmp, "base.json"), join(tmp, "post.json")).stdout); console.log("catalog diff of the later migrations:", join(tmp, "later.txt")); }
// enum values cannot be removed: the only tolerated residue is a changed enum type
const residue = (cd(join(tmp, "pre.json"), join(tmp, "after.json")).stdout.trim().split("\n")).filter((l) => l && l !== "no catalog differences");
const bad = residue.filter((l) => !/^changed +types: public\.[a-z_]+$/.test(l));
console.log("pre -> after all the forward-fixes:", residue.length ? residue.join("; ") : "no catalog differences", bad.length ? "FAILED" : "(ok)");
const left = sql("postgres", "select count(*) from supabase_migrations.schema_migrations");
console.log(`container postgres database untouched: ${before} -> ${left} migrations; ${DB} dropped`);
// the permission contract of the LAST pending version must match a clean replay of the plan exactly
const permRaw = JSON.parse(readFileSync(join(tmp, "perm.json"), "utf8").replace(/^[^[{]*/, ""));
const pv = verify(JSON.stringify([{ permissions: permRaw }]), P.postContract);
// The scratch container has local role grants that differ from Production for old functions (service_role), so compare against the SAME inventory taken before the plan
// and against the previous contract: only differences the plan introduces count, and every function the plan adds or replaces must match the post contract exactly.
const pre = verify(JSON.stringify([{ permissions: JSON.parse(readFileSync(join(tmp, "permpre.json"), "utf8").replace(/^[^[{]*/, "")) }]), P.preContract);
const baseline = new Set(pre.errors);
const introduced = pv.errors.filter((e) => !baseline.has(e));
console.log(`permissions after the plan vs contract ${pv.version}: ${introduced.length ? "FAILED" : "PASS"} (${pv.actual} functions, ${pv.expected} reviewed; ${pv.errors.length - introduced.length} scratch-container grant difference(s) already present before the plan: ${pre.errors.length})`, ...introduced.slice(0, 10));
pv.errors = introduced;
process.exit(a.status === 0 && !bad.length && !pv.errors.length && before === left ? 0 : 1);
