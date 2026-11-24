#!/usr/bin/env node
/**
 * Scratch proof for the Acceptance plan `marketplace-v2`. Touches ONLY a THROWAWAY database (mv2_scratch) that it creates inside a local Supabase container
 * (default supabase_db_aladdin_r2_rc2_fresh, SCRATCH_CONTAINER) from a pg_dump of that container's own database, and drops again at the end. The container's own
 * database is never written. It never connects to a hosted database and needs no secret. Each migration file runs in its own transaction, like `supabase db push`
 * (needed: the enum value of 20261123160001 must be committed before 20261123160002 uses it, so one rolled-back transaction is impossible).
 *   node scripts/hosted-db/marketplace-v2-scratch-proof.mjs [--out <dir>] [--no-fix]
 * (1) replays the migrations Acceptance already has (up to 20261122090002) that the container lacks, (2) fingerprints the catalog
 * (catalog-fingerprint.sql) and the table row counts, (3) applies the plan's 7 pending migrations with ON_ERROR_STOP, (4) fingerprints again,
 * (5) runs the pinned forward-fix (its own BEGIN/COMMIT removed for this test), (6) fingerprints a third time, (7) drops the scratch database.
 * Checks: pre -> post is exactly PLANS["marketplace-v2"].changed; pre -> after-forward-fix differs ONLY by the enum value that PostgreSQL cannot remove.
 * With --out the three fingerprints and the post-state seed counts are kept for review.
 */
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PLANS, FORWARD_FIX } from "./acceptance-gate.mjs";

const C = process.env.SCRATCH_CONTAINER || "supabase_db_aladdin_r2_rc2_fresh";
const DB = "mv2_scratch";
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const P = PLANS["marketplace-v2"];
const argv = process.argv.slice(2);
const outDir = argv.includes("--out") ? resolve(argv[argv.indexOf("--out") + 1]) : null;
const noFix = argv.includes("--no-fix");
const dir = join(repo, "supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const v = (f) => f.slice(0, 14);
const fp = readFileSync(join(here, "catalog-fingerprint.sql"), "utf8");
const strip = (t) => t.replace(/^\s*(begin|commit)\s*;\s*$/gim, ""); // the forward-fix carries its own begin/commit
const tx = (t) => `begin;
${strip(t)}
commit;
`;
const run = (args) => { const r = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, MSYS_NO_PATHCONV: "1" } }); if (r.status !== 0) throw new Error(`docker ${args.slice(0, 3).join(" ")} failed: ${r.stderr || r.stdout}`); return r.stdout; };

/** Row counts of every public/app table plus the seed facts the smoke test checks. One jsonb row. */
const counts = `select jsonb_build_object(
  'tables', (select jsonb_object_agg(n.nspname || '.' || c.relname, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint)
             from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'app') and c.relkind = 'r'),
  'seed', jsonb_build_object(
    'templates', (select count(*) from public.notification_templates),
    'presets', case when to_regclass('public.marketplace_seller_message_presets') is null then null
                    else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.marketplace_seller_message_presets', false, true, '')))[1]::text::bigint end,
    'marketplace_open', (select to_jsonb(m) -> 'marketplace_open' from public.marketplace_platform_settings m where singleton),
    'media_verification_ready', (select to_jsonb(m) -> 'media_verification_ready' from public.marketplace_platform_settings m where singleton))
) as counts;`;

const sh = (...a) => run(["exec", C, ...a]);
const psqlDb = (db, ...a) => sh("psql", "-U", "supabase_admin", "-d", db, ...a);
// fresh throwaway database from a dump of the container's own database (supabase_admin: owners and ACLs restore exactly)
psqlDb("postgres", "-Atc", `drop database if exists ${DB}`);
psqlDb("postgres", "-Atc", `create database ${DB} template template0`);
sh("sh", "-c", `pg_dump -U supabase_admin -Fc postgres > /tmp/mv2.dump && pg_restore -U supabase_admin -d ${DB} /tmp/mv2.dump 2>&1 | grep -E '^pg_restore: error' | head -5; true`);
const present = psqlDb(DB, "-Atc", "select string_agg(version, ',') from supabase_migrations.schema_migrations").trim().split(",");
const missingPre = files.map(v).filter((x) => x <= P.latest && !present.includes(x) && x >= (process.env.SCRATCH_FROM || "20261110090001"));
const alreadyHasPending = P.pending.filter((x) => present.includes(x));
if (alreadyHasPending.length) throw new Error(`container ${C} already has ${alreadyHasPending.join(", ")}; pick a container at or below ${P.latest} (SCRATCH_CONTAINER)`);
const meta = (name) => `\\t on\n\\a\n\\o /tmp/mv2_${name}.json\n${fp}\n\\o\n\\o /tmp/mv2_${name}_counts.json\n${counts}\n\\o\n\\t off\n`;
let s = "\\set ON_ERROR_STOP on\n\\timing on\n";
for (const f of files.filter((f) => missingPre.includes(v(f)))) s += `\\echo >>> pre ${f}\n${tx(readFileSync(join(dir, f), "utf8"))}\n`;
s += meta("pre");
for (const f of files.filter((f) => P.pending.includes(v(f)))) s += `\\echo >>> ${f}\n${tx(readFileSync(join(dir, f), "utf8"))}\n`;
s += meta("post");
if (!noFix) {
  const F = FORWARD_FIX["marketplace-v2"];
  s += `\\echo >>> forward-fix ${F.file}\n${tx(readFileSync(join(here, F.file), "utf8"))}\n`;
}
s += meta("after");
const tmp = mkdtempSync(join(tmpdir(), "mv2-proof-"));
writeFileSync(join(tmp, "proof.sql"), s);
run(["cp", join(tmp, "proof.sql"), `${C}:/tmp/mv2_proof.sql`]);
const t0 = Date.now();
const out = psqlDb(DB, "-X", "-v", "ON_ERROR_STOP=1", "-f", "/tmp/mv2_proof.sql");
const secs = ((Date.now() - t0) / 1000).toFixed(1);
const sum = [...out.matchAll(/^Time: ([\d.]+) ms/gm)].reduce((a, m) => a + Number(m[1]), 0);
console.log(`replayed ${missingPre.length} pre + ${P.pending.length} pending${noFix ? "" : " + the forward-fix"}, one transaction per file, in the throwaway database ${DB}; wall ${secs}s, statement time ${(sum / 1000).toFixed(2)}s, no error`);
for (const n of ["pre", "post", "after", "pre_counts", "post_counts", "after_counts"]) run(["cp", `${C}:/tmp/mv2_${n}.json`, join(tmp, `${n}.json`)]);
if (!argv.includes("--keep")) psqlDb("postgres", "-Atc", `drop database ${DB}`);
const cd = (...a) => spawnSync("node", [join(here, "catalog-diff.mjs"), ...a], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const a = cd(join(tmp, "pre.json"), join(tmp, "post.json"), "--expect-changed", P.changed.join(";"));
console.log("pre -> post:", a.status === 0 ? a.stdout.trim().split("\n").at(-1) : `FAILED\n${a.stderr}\n${a.stdout}`);
const preCounts = JSON.parse(readFileSync(join(tmp, "pre_counts.json"), "utf8")), postCounts = JSON.parse(readFileSync(join(tmp, "post_counts.json"), "utf8"));
const rowChanges = Object.keys(preCounts.tables).filter((t) => preCounts.tables[t] !== postCounts.tables[t]).map((t) => `${t}: ${preCounts.tables[t]} -> ${postCounts.tables[t]}`);
console.log(`existing tables whose row count changed (only seed rows may appear): ${rowChanges.join("; ") || "none"}`);
console.log(`post-state seed facts: ${JSON.stringify(postCounts.seed)}`);
let ok = a.status === 0;
if (!noFix) {
  const b = cd(join(tmp, "pre.json"), join(tmp, "after.json"));
  const lines = b.stdout.trim().split("\n").filter(Boolean);
  const residual = lines.filter((l) => !/^changed\s+types: public\.media_video_scope$/.test(l));
  console.log(`pre -> after the forward-fix: ${lines.length ? lines.join(" | ") : "no catalog differences"}`);
  if (residual.length) { ok = false; console.log(`UNEXPECTED residual differences: ${residual.join(" | ")}`); }
  else console.log("forward-fix proof: ok (only the PostgreSQL enum value 'marketplace' remains; it cannot be removed and is inert)");
}
if (outDir) { mkdirSync(outDir, { recursive: true }); for (const n of ["pre", "post", "after", "pre_counts", "post_counts", "after_counts"]) writeFileSync(join(outDir, `${n}.json`), readFileSync(join(tmp, `${n}.json`))); }
console.log(`throwaway database ${DB} ${argv.includes("--keep") ? "kept (drop it yourself)" : "dropped"}; the container's own database was never written`);
process.exit(ok ? 0 : 1);
