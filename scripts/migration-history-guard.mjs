#!/usr/bin/env node
/**
 * Migration-history guard.
 *
 * The OFFICIAL Supabase CLI is the only authority on migration history. This script does not read the database
 * itself and keeps no second model of it: it parses the output of
 *
 *     supabase migration list --linked --output-format json
 *
 * (and, optionally, `supabase db push --linked --dry-run`) and turns it into a clear pass/fail for CI.
 *
 * Every row of `migration list` is { local, remote, time }. A row is one of:
 *
 *   matched      local === remote                          fine
 *   local-only   local set, remote empty
 *                  newer than the newest remote version    PENDING: a normal, valid migration to apply
 *                  older than the newest remote version    FAIL: OUT-OF-ORDER history
 *   remote-only  remote set, local empty                   FAIL: HISTORY DRIFT (the database has something the
 *                                                          repository does not)
 *
 * Usage:
 *   node scripts/migration-history-guard.mjs <migration-list.json | -> [--expect plan|up-to-date] [--dry-run <dry-run.json>]
 *
 *   --expect plan         (default) pending migrations are allowed; they are listed.
 *   --expect up-to-date   anything pending is a failure ("Database schema behind application").
 *   --dry-run <file>      also cross-check `db push --dry-run` output against the list; a disagreement is a failure.
 *
 * Exit codes: 0 compatible · 1 guard failure · 2 unusable input (malformed CLI output / bad usage).
 *
 * Nothing here repairs anything. The remedy for drift or out-of-order history is a human decision (see
 * docs/operations/staging-deployment-runbook.md); this script must never be used to make the histories "look equal".
 */
import { readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = /^\d{14}$/;

export class MalformedInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "MalformedInputError";
  }
}

/**
 * The CLI prints progress to stderr and one JSON document to stdout, but a caller may have merged the streams
 * (`2>&1`). Take everything from the first `{` to the last `}` so surrounding log lines cannot break parsing, then
 * parse strictly.
 */
export function parseCliJson(text) {
  if (typeof text !== "string") throw new MalformedInputError("CLI output is not text");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new MalformedInputError("no JSON object found in the CLI output");
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    throw new MalformedInputError(`CLI output is not valid JSON: ${error.message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MalformedInputError("CLI output is not a JSON object");
  }
  return parsed;
}

/** Validate `migration list` output into clean rows, or throw. */
export function parseMigrationList(text) {
  const doc = parseCliJson(text);
  if (!Array.isArray(doc.migrations)) throw new MalformedInputError('missing "migrations" array in `migration list` output');
  const seen = new Set();
  return doc.migrations.map((row, index) => {
    const where = `migrations[${index}]`;
    if (row === null || typeof row !== "object") throw new MalformedInputError(`${where} is not an object`);
    const local = row.local ?? "";
    const remote = row.remote ?? "";
    if (typeof local !== "string" || typeof remote !== "string") throw new MalformedInputError(`${where}: local/remote must be strings`);
    if (local === "" && remote === "") throw new MalformedInputError(`${where}: neither a local nor a remote version`);
    for (const v of [local, remote]) {
      if (v !== "" && !VERSION.test(v)) throw new MalformedInputError(`${where}: "${v}" is not a 14-digit migration version`);
    }
    if (local !== "" && remote !== "" && local !== remote) {
      throw new MalformedInputError(`${where}: local ${local} and remote ${remote} share a row but differ`);
    }
    const version = local || remote;
    if (seen.has(version)) throw new MalformedInputError(`${where}: duplicate version ${version}`);
    seen.add(version);
    return { local, remote };
  });
}

/** Classify validated rows. Pure; no I/O. */
export function classify(rows) {
  const remoteVersions = rows.filter((r) => r.remote !== "").map((r) => r.remote);
  const latestRemote = remoteVersions.length ? remoteVersions.reduce((a, b) => (a > b ? a : b)) : null;
  const localVersions = rows.filter((r) => r.local !== "").map((r) => r.local);
  const latestLocal = localVersions.length ? localVersions.reduce((a, b) => (a > b ? a : b)) : null;

  const localOnly = rows.filter((r) => r.local !== "" && r.remote === "").map((r) => r.local).sort();
  const pending = localOnly.filter((v) => latestRemote === null || v > latestRemote);
  const outOfOrder = localOnly.filter((v) => latestRemote !== null && v < latestRemote);
  const remoteOnly = rows.filter((r) => r.remote !== "" && r.local === "").map((r) => r.remote).sort();
  const matched = rows.filter((r) => r.local !== "" && r.local === r.remote).length;

  return {
    matched,
    pending,
    outOfOrder,
    remoteOnly,
    latestLocal,
    latestRemote,
    drift: remoteOnly.length > 0,
    hasOutOfOrder: outOfOrder.length > 0,
    upToDate: pending.length === 0 && outOfOrder.length === 0 && remoteOnly.length === 0,
  };
}

/** `db push --dry-run` JSON: { upToDate, migrations: ["<version>_<name>.sql", ...] }. */
export function parseDryRun(text) {
  const doc = parseCliJson(text);
  if (typeof doc.upToDate !== "boolean") throw new MalformedInputError('missing boolean "upToDate" in dry-run output');
  if (!Array.isArray(doc.migrations)) throw new MalformedInputError('missing "migrations" array in dry-run output');
  const versions = doc.migrations.map((name, index) => {
    const match = typeof name === "string" ? /^(\d{14})_/.exec(name) : null;
    if (!match) throw new MalformedInputError(`dry-run migrations[${index}] is not "<version>_<name>.sql"`);
    return match[1];
  });
  return { upToDate: doc.upToDate, versions: versions.sort() };
}

/** The dry run and the list come from the same CLI; they must tell the same story. */
export function crossCheckDryRun(result, dryRun) {
  const problems = [];
  const same = result.pending.length === dryRun.versions.length && result.pending.every((v, i) => v === dryRun.versions[i]);
  if (!same) {
    problems.push(
      `\`migration list\` says pending = [${result.pending.join(", ") || "none"}] but \`db push --dry-run\` would apply [${dryRun.versions.join(", ") || "none"}]`,
    );
  }
  if (dryRun.upToDate !== (dryRun.versions.length === 0)) {
    problems.push("dry-run output is internally inconsistent (upToDate does not match its migration list)");
  }
  return problems;
}

/** Human-readable verdict. Returns { exitCode, lines }. */
export function evaluate(result, { expect = "plan", dryRunProblems = [] } = {}) {
  const lines = [];
  let failed = false;

  if (result.drift) {
    failed = true;
    lines.push(
      "Database migration history drift detected.",
      "Remote-only migration(s): applied to the database but absent from this repository:",
      ...result.remoteOnly.map((v) => `  ${v}`),
      "The repository must represent the real database history before anything is deployed. Do not use",
      "`supabase migration repair` or `--include-all` to make this pass; reconcile the history through a reviewed PR.",
      "",
    );
  }

  if (result.hasOutOfOrder) {
    failed = true;
    lines.push(
      "Out-of-order local migration detected.",
      ...result.outOfOrder.map((v) => `  ${v} is missing remotely but later migrations are already applied (latest remote: ${result.latestRemote}).`),
      "Applying it would run behind schema that already exists. Renumber it (if not yet applied anywhere) or get an",
      "explicit human decision; automatic deployment never uses `--include-all`.",
      "",
    );
  }

  if (result.pending.length > 0) {
    if (expect === "up-to-date") {
      failed = true;
      lines.push("Database schema behind application.", "Pending migrations:", ...result.pending.map((v) => `  ${v}`), "");
    } else {
      lines.push("Pending migrations (valid, will be applied in this order):", ...result.pending.map((v) => `  ${v}`), "");
    }
  }

  if (dryRunProblems.length > 0) {
    failed = true;
    lines.push("The Supabase CLI disagrees with itself:", ...dryRunProblems.map((p) => `  ${p}`), "");
  }

  if (!failed) {
    const tail = result.pending.length ? ` (${result.pending.length} pending)` : "";
    lines.push(
      `Migration history is compatible: ${result.matched} applied, latest remote ${result.latestRemote ?? "none"}, latest local ${result.latestLocal ?? "none"}${tail}.`,
    );
  }
  return { exitCode: failed ? 1 : 0, lines };
}

function annotate(level, title, message) {
  const body = message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  return `::${level} title=${title}::${body}`;
}

function parseArgs(argv) {
  const args = { input: null, expect: "plan", dryRun: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--expect") args.expect = argv[++i];
    else if (arg === "--dry-run") args.dryRun = argv[++i];
    else if (!args.input) args.input = arg;
    else throw new MalformedInputError(`unexpected argument: ${arg}`);
  }
  if (!args.input) throw new MalformedInputError("usage: migration-history-guard.mjs <migration-list.json | -> [--expect plan|up-to-date] [--dry-run <file>]");
  if (!["plan", "up-to-date"].includes(args.expect)) throw new MalformedInputError(`--expect must be "plan" or "up-to-date", got "${args.expect}"`);
  return args;
}

function readInput(path) {
  return readFileSync(path === "-" ? 0 : path, "utf8");
}

export function main(argv) {
  let out;
  try {
    const args = parseArgs(argv);
    const result = classify(parseMigrationList(readInput(args.input)));
    const dryRunProblems = args.dryRun ? crossCheckDryRun(result, parseDryRun(readInput(args.dryRun))) : [];
    out = evaluate(result, { expect: args.expect, dryRunProblems });
  } catch (error) {
    if (!(error instanceof MalformedInputError)) throw error;
    out = { exitCode: 2, lines: ["Unusable Supabase CLI output; refusing to continue (fail closed).", `  ${error.message}`] };
  }
  const text = out.lines.join("\n");
  console.log(text);
  if (process.env.GITHUB_ACTIONS === "true") {
    if (out.exitCode !== 0) console.log(annotate("error", "Migration history guard", text));
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Migration history guard\n\n\`\`\`\n${text}\n\`\`\`\n`);
    }
  }
  return out.exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
