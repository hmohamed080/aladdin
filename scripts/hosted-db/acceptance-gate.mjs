#!/usr/bin/env node
/**
 * Pure decision logic for the Acceptance preflight (acceptance-preflight.sh). No network. Same shape as p2-gate.mjs.
 *   node acceptance-gate.mjs <migration-list.json> <dry-run.json> <migrations dir>
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ACCEPTANCE_REF = "nxossqhdfltcqdwvbewi";
export const EXPECT_APPLIED = 203;
export const EXPECT_LATEST = "20261107090002";
export const EXPECT_PENDING = ["20261107090003", "20261107090004", "20261107090005", "20261107090006"];
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export function checkAcceptance({ list, dry, localVersions }) {
  const p = [];
  const rows = list?.migrations ?? [];
  const remote = rows.filter((r) => r.remote).map((r) => String(r.remote)).sort();
  const pending = rows.filter((r) => r.local && !r.remote).map((r) => String(r.local)).sort();
  if (remote.length !== EXPECT_APPLIED) p.push(`Acceptance has ${remote.length} applied migrations, expected ${EXPECT_APPLIED}`);
  if (remote.at(-1) !== EXPECT_LATEST) p.push(`latest applied is ${remote.at(-1)}, expected ${EXPECT_LATEST}`);
  const remoteOnly = rows.filter((r) => r.remote && !r.local);
  if (remoteOnly.length) p.push(`remote-only (history drift): ${remoteOnly.map((r) => r.remote).join(", ")}`);
  if (!same(pending, EXPECT_PENDING)) p.push(`pending is [${pending.join(", ")}], expected exactly [${EXPECT_PENDING.join(", ")}]`);
  // plain push must be possible: every pending version is newer than the latest applied (no --include-all needed)
  const older = pending.filter((v) => remote.length && v < remote.at(-1));
  if (older.length) p.push(`out-of-order pending (would need --include-all, not allowed here): ${older.join(", ")}`);
  const would = (dry?.migrations ?? []).map((f) => String(f).slice(0, 14));
  if (dry?.dryRun !== true) p.push("the dry run output does not say dryRun:true");
  if (!same(would, EXPECT_PENDING)) p.push(`dry run would push [${would.join(", ")}], expected exactly [${EXPECT_PENDING.join(", ")}]`);
  for (const v of EXPECT_PENDING) if (!localVersions.includes(v)) p.push(`migration file ${v} is not in this checkout`);
  return p;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [l, d, dir] = process.argv.slice(2);
  const j = (f) => JSON.parse(readFileSync(f, "utf8").replace(/^[^{]*/, ""));
  const problems = checkAcceptance({ list: j(l), dry: j(d), localVersions: readdirSync(dir).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, 14)) });
  if (problems.length) { console.error("Acceptance gate: REFUSED\n" + problems.map((x) => `  - ${x}`).join("\n")); process.exit(1); }
  console.log("Acceptance gate: ok (203 applied, exactly 090003-090006 pending, plain push, no drift)");
}
