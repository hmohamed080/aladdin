#!/usr/bin/env node
/**
 * Decision logic for the Production P-2 push (production-p2-push.sh). Pure functions, no network, no Production access:
 * the shell wrapper feeds them files it produced. Any problem is returned as a message; the wrapper refuses to push
 * unless the list is empty.
 *
 *   node p2-gate.mjs snapshot <snapshot folder> [--now <iso>]
 *   node p2-gate.mjs pending  <migration-list.json> <dry-run.json> <migrations dir>
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PRODUCTION_REF = "kkpkgjrweysgvhvkhzun";
export const EXPECT_APPLIED = 195;
export const EXPECT_LATEST = "20261107090002";
export const MAX_SNAPSHOT_AGE_MINUTES = 60;
/** The only migrations P-2 may apply, in apply order. */
export const EXPECT_PENDING = [
  "20261028090001", "20261028090003", "20261029090001", "20261029090002",
  "20261030090001", "20261030090002", "20261103090001", "20261107090003",
];

export function parseKv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([a-z_0-9]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * `files` is { meta, sums, encSha, verified, encrypted } read from the snapshot folder (strings, or the raw bytes of
 * the encrypted archive); `readBackup(name)` returns a backup file's bytes. Returns an array of problems.
 */
export function checkSnapshot({ meta, sums, readBackup, encSha, verified, encryptedBytes, now }) {
  const p = [];
  const m = parseKv(meta ?? "");
  if (m.project !== PRODUCTION_REF) p.push(`snapshot project is "${m.project ?? "missing"}", expected Production (${PRODUCTION_REF})`);
  if (String(m.history_count) !== String(EXPECT_APPLIED)) p.push(`snapshot history_count is ${m.history_count ?? "missing"}, expected ${EXPECT_APPLIED}`);
  if (m.history_latest !== EXPECT_LATEST) p.push(`snapshot history_latest is ${m.history_latest ?? "missing"}, expected ${EXPECT_LATEST}`);
  if (m.row_counts_validated !== "copy-vs-select") p.push("snapshot row counts were not validated against the dump (COPY vs SELECT)");
  const taken = Date.parse(m.taken_utc ?? "");
  if (Number.isNaN(taken)) p.push("snapshot taken_utc is missing or malformed");
  else {
    const age = (now - taken) / 60000;
    if (age < 0) p.push("snapshot taken_utc is in the future");
    else if (age > MAX_SNAPSHOT_AGE_MINUTES) p.push(`snapshot is ${Math.round(age)} minutes old, the limit is ${MAX_SNAPSHOT_AGE_MINUTES}: take a new one`);
  }
  // the backup files still match the checksums taken with them
  const listed = new Map();
  for (const line of (sums ?? "").split(/\r?\n/).filter(Boolean)) {
    const mm = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (mm) listed.set(mm[2], mm[1]);
  }
  for (const f of ["roles.sql", "schema.sql", "data.sql", "security-tail.out.sql"]) {
    if (!listed.has(f)) { p.push(`SHA256SUMS does not list ${f}`); continue; }
    let bytes;
    try { bytes = readBackup(f); } catch { p.push(`backup/${f} is missing`); continue; }
    if (!bytes.length) p.push(`backup/${f} is empty`);
    else if (sha256(bytes) !== listed.get(f)) p.push(`backup/${f} no longer matches its checksum`);
  }
  // the encrypted copy exists, is unchanged since its recovery check, and belongs to THIS snapshot
  const v = parseKv(verified ?? "");
  if (!encryptedBytes) p.push("the encrypted backup (<folder>.tar.gpg) is missing: run encrypt-backup.sh");
  else {
    const h = sha256(encryptedBytes);
    if (!/^[0-9a-f]{64}\b/.test(encSha ?? "") || encSha.slice(0, 64) !== h) p.push("the encrypted backup does not match its .sha256 file");
    if (!verified) p.push("no .verified file: the encrypted backup's decrypt-and-compare recovery check has not passed");
    else {
      if (v.encrypted_sha256 !== h) p.push("the encrypted backup changed after its recovery check passed");
      if (v.snapshot_taken_utc !== m.taken_utc || v.snapshot_project !== m.project) p.push("the recovery check belongs to a different snapshot");
      if (!(Date.parse(v.verified_utc ?? "") >= taken)) p.push("the recovery check is missing or older than the snapshot");
    }
  }
  return p;
}

/** `list` is `supabase migration list --output-format json`, `dry` is `db push --dry-run --include-all` JSON. */
export function checkPending({ list, dry, localVersions }) {
  const p = [];
  const rows = list?.migrations ?? [];
  const remote = rows.filter((r) => r.remote).map((r) => String(r.remote)).sort();
  const remoteOnly = rows.filter((r) => r.remote && !r.local);
  const pending = rows.filter((r) => r.local && !r.remote).map((r) => String(r.local)).sort();
  if (remote.length !== EXPECT_APPLIED) p.push(`Production has ${remote.length} applied migrations, expected ${EXPECT_APPLIED}`);
  if (remote[remote.length - 1] !== EXPECT_LATEST) p.push(`Production's latest applied is ${remote[remote.length - 1]}, expected ${EXPECT_LATEST}`);
  if (remoteOnly.length) p.push(`Production has migrations this checkout lacks: ${remoteOnly.map((r) => r.remote).join(", ")}`);
  if (!sameList(pending, EXPECT_PENDING)) p.push(`pending migrations are [${pending.join(", ")}], expected exactly [${EXPECT_PENDING.join(", ")}]`);
  const would = (dry?.migrations ?? []).map((f) => String(f).slice(0, 14));
  if (dry?.dryRun !== true) p.push("the dry run output does not say dryRun:true");
  if (!sameList(would, EXPECT_PENDING)) p.push(`the dry run would push [${would.join(", ")}], expected exactly [${EXPECT_PENDING.join(", ")}]`);
  for (const v of EXPECT_PENDING) if (!localVersions.includes(v)) p.push(`migration file ${v} is not in this checkout`);
  return p;
}

function cli(argv) {
  const [cmd, ...rest] = argv;
  let problems;
  if (cmd === "snapshot") {
    const dir = resolve(rest[0] ?? "");
    const nowIdx = rest.indexOf("--now");
    const now = nowIdx >= 0 ? Date.parse(rest[nowIdx + 1]) : Date.now();
    const read = (f) => (existsSync(f) ? readFileSync(f, "utf8") : null);
    const enc = `${dir}.tar.gpg`;
    problems = checkSnapshot({
      meta: read(join(dir, "snapshot-meta.txt")),
      sums: read(join(dir, "backup", "SHA256SUMS")),
      readBackup: (f) => readFileSync(join(dir, "backup", f)),
      encSha: read(`${enc}.sha256`),
      verified: read(`${enc}.verified`),
      encryptedBytes: existsSync(enc) ? readFileSync(enc) : null,
      now,
    });
  } else if (cmd === "pending") {
    const j = (f) => JSON.parse(readFileSync(f, "utf8").replace(/^[^{]*/, ""));
    problems = checkPending({
      list: j(rest[0]), dry: j(rest[1]),
      localVersions: readdirSync(rest[2]).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, 14)),
    });
  } else {
    console.error("usage: p2-gate.mjs snapshot <folder> [--now <iso>] | pending <list.json> <dry.json> <migrations dir>");
    return 2;
  }
  if (problems.length) { console.error("P-2 gate: REFUSED\n" + problems.map((x) => `  - ${x}`).join("\n")); return 1; }
  console.log(`P-2 gate (${cmd}): ok`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exit(cli(process.argv.slice(2)));
