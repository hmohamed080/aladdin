#!/usr/bin/env node
/**
 * Scratch proof for the Production catch-up plan. Touches ONLY the local disposable container supabase_db_aladdin_r2_rc2_fresh and ALWAYS ends with ROLLBACK;
 * it never connects to a hosted database.
 *   node scripts/hosted-db/prod-catchup-scratch-proof.mjs
 * In one transaction it (1) applies the migrations Production already has but the scratch container lacks (20261110090001..20261112090001), (2) fingerprints the
 * catalog (catalog-fingerprint.sql), (3) applies the plan's pending migrations with timing (ON_ERROR_STOP), (4) fingerprints again, (5) runs the three forward-fixes in undo order
 * (their own BEGIN/COMMIT removed for this test), (6) fingerprints a third time, (7) ROLLBACKs. Then catalog-diff.mjs checks: pre -> post is exactly the plan's `changed`
 * list, and pre -> after-forward-fix has no difference at all.
 */
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PLANS, FORWARD_FIX, PC_LATER } from "./acceptance-gate.mjs";

const C = "supabase_db_aladdin_r2_rc2_fresh";
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const P = PLANS["prod-catchup"];
const dir = join(repo, "supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const v = (f) => f.slice(0, 14);
const fp = readFileSync(join(here, "catalog-fingerprint.sql"), "utf8");
const strip = (t) => t.replace(/^\s*(begin|commit)\s*;\s*$/gim, "");
const run = (args, opt = {}) => { const r = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, MSYS_NO_PATHCONV: "1" }, ...opt }); if (r.status !== 0) throw new Error(`docker ${args.slice(0, 3).join(" ")} failed: ${r.stderr || r.stdout}`); return r.stdout; };

const present = run(["exec", C, "psql", "-U", "postgres", "-Atc", "select string_agg(version, ',') from supabase_migrations.schema_migrations"]).trim().split(",");
const missingPre = files.map(v).filter((x) => x <= P.latest && !present.includes(x) && x >= "20261110090001");
let s = "\\set ON_ERROR_STOP on\n\\timing on\nbegin;\n";
for (const f of files.filter((f) => missingPre.includes(v(f)))) s += `\\echo >>> pre ${f}\n${readFileSync(join(dir, f), "utf8")}\n`;
s += `\\t on\n\\a\n\\o /tmp/pc_pre.json\n${fp}\n\\o\n\\t off\n`;
for (const f of files.filter((f) => P.pending.includes(v(f)))) {
  s += `\\echo >>> ${f}\n${readFileSync(join(dir, f), "utf8")}\n`;
  // state after the first 27, before the later migrations (PC_LATER)
  if (v(f) === "20261122090002" && PC_LATER.length) s += `\\t on\n\\o /tmp/pc_base.json\n${fp}\n\\o\n\\t off\n`;
}
s += `\\t on\n\\o /tmp/pc_post.json\n${fp}\n\\o\n\\t off\n`;
P.fixes.forEach((fx, i) => {
  s += `\\echo >>> forward-fix ${FORWARD_FIX[fx].file}\n${strip(readFileSync(join(here, FORWARD_FIX[fx].file), "utf8"))}\n`;
  // after undoing only the later migrations (the first fix) the catalog must equal the state after the first 27
  if (i === 0 && PC_LATER.length) s += `\\t on\n\\o /tmp/pc_stage1.json\n${fp}\n\\o\n\\t off\n`;
});
s += `\\t on\n\\o /tmp/pc_after.json\n${fp}\n\\o\nrollback;\n`;
const tmp = mkdtempSync(join(tmpdir(), "pc-proof-"));
writeFileSync(join(tmp, "proof.sql"), s);
run(["cp", join(tmp, "proof.sql"), `${C}:/tmp/pc_proof.sql`]);
const t0 = Date.now();
const out = run(["exec", C, "psql", "-U", "postgres", "-X", "-f", "/tmp/pc_proof.sql"]);
const secs = ((Date.now() - t0) / 1000).toFixed(1);
const sum = [...out.matchAll(/^Time: ([\d.]+) ms/gm)].reduce((a, m) => a + Number(m[1]), 0);
console.log(`replayed ${missingPre.length} pre + ${P.pending.length} pending + ${P.fixes.length} forward-fixes in one transaction, ROLLED BACK; wall ${secs}s, statement time ${(sum / 1000).toFixed(2)}s, no error`);
for (const n of ["pre", "post", "after", ...(PC_LATER.length ? ["base", "stage1"] : [])]) run(["cp", `${C}:/tmp/pc_${n}.json`, join(tmp, `${n}.json`)]);
const cd = (...a) => spawnSync("node", [join(here, "catalog-diff.mjs"), ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const a = cd(join(tmp, "pre.json"), join(tmp, "post.json"), "--expect-changed", P.changed.join(";"));
console.log("pre -> post:", a.status === 0 ? a.stdout.trim().split("\n").at(-1) : `FAILED\n${a.stderr}`);
const b = cd(join(tmp, "pre.json"), join(tmp, "after.json"));
const bl = b.stdout.trim();
console.log("pre -> after all the forward-fixes:", bl);
let stage = true;
if (PC_LATER.length) {
  const c = cd(join(tmp, "base.json"), join(tmp, "stage1.json")).stdout.trim();
  console.log(`after the 27 -> after undoing only ${PC_LATER.join(", ")} (${FORWARD_FIX[P.fixes[0]].file}):`, c);
  stage = c === "no catalog differences";
}
const left = run(["exec", C, "psql", "-U", "postgres", "-Atc", "select count(*) from supabase_migrations.schema_migrations"]).trim();
console.log(`container still has ${left} migrations (rolled back)`);
process.exit(a.status === 0 && bl === "no catalog differences" && stage ? 0 : 1);
