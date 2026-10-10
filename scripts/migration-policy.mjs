#!/usr/bin/env node
/**
 * Migration policy: a REVIEW GUARD for pull requests that touch `supabase/migrations`.
 *
 * It is deliberately NOT a SQL parser and gives no proof of safety. It looks for shapes that are dangerous when the
 * database is migrated BEFORE the new application is promoted (see docs/operations/staging-deployment-runbook.md):
 * for a short time the OLD application is still serving against the NEW schema. It cannot see dynamic SQL built in a
 * string and it can flag harmless statements (for example a `drop table` of a temporary table inside a function);
 * a human review is still the control. What it guarantees is that a destructive-looking change is never merged
 * silently.
 *
 *   Release N    add compatible schema (new column/function/signature); old app and new app both work.
 *                Promote the new app.
 *   Release N+1  remove the old schema/signature, once nothing that is still promoted depends on it.
 *
 * Rules, for every migration file ADDED by the PR:
 *   - destructive-looking statements (drop table/column/function/view/type/schema, renames, column type changes,
 *     truncate, and drop-and-recreate of a function signature) FAIL unless the file carries a reviewed marker:
 *         -- migration-policy: destructive-reviewed - <why this is safe, and which earlier release made it safe>
 *   - a version that is not newer than the newest migration already on the base branch FAILS unless the file carries
 *         -- migration-policy: out-of-order-reviewed - <why, e.g. reconciling history that is already applied>
 * and for every migration file MODIFIED, DELETED or RENAMED: always FAIL. An applied migration is immutable history.
 *
 * Usage:
 *   node scripts/migration-policy.mjs --changes <git-diff-name-status.txt> --base-files <git-ls-tree-names.txt> [--root <repo>]
 *
 * Exit codes: 0 ok (warnings allowed) · 1 policy failure · 2 usage error.
 */
import { readFileSync, appendFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Replace comments and string literals with spaces, keeping newlines so line numbers stay right. */
export function stripSql(sql) {
  const blank = (s) => s.replace(/[^\n]/g, " ");
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/--[^\n]*/g, blank)
    .replace(/'(?:[^']|'')*'/g, blank);
}

const RULES = [
  { id: "drop-table", re: /\bdrop\s+table\b/i, why: "removes a table the old application may still read or write" },
  { id: "drop-column", re: /\bdrop\s+column\b/i, why: "removes a column the old application may still select or insert" },
  { id: "drop-function", re: /\bdrop\s+(function|procedure|routine)\b/i, why: "removes an RPC signature the old application may still call" },
  { id: "drop-view", re: /\bdrop\s+(materialized\s+)?view\b/i, why: "removes a view the old application may still query" },
  { id: "drop-type-schema", re: /\bdrop\s+(type|domain|schema)\b/i, why: "removes a type or schema other objects and callers may depend on" },
  {
    id: "rename",
    re: /\balter\s+(table|view|materialized\s+view|sequence|index|function|type|schema)\b[^;]*?\brename\b/i,
    why: "renames an object, column or enum value the old application still refers to by its old name",
  },
  {
    id: "alter-column-type",
    re: /\balter\s+table\b[^;]*?\balter\s+column\b[^;]*?\b(set\s+data\s+)?type\b/i,
    why: "changes a column's type, which can break the old application's reads, writes or casts",
  },
  { id: "truncate", re: /\btruncate\b/i, why: "deletes every row of a table" },
];

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

/** Find destructive-looking statements. Returns [{ rule, line, text, why }]. */
export function findRisks(sql) {
  const clean = stripSql(sql);
  const risks = [];
  for (const rule of RULES) {
    const re = new RegExp(rule.re.source, "gi");
    for (let m = re.exec(clean); m; m = re.exec(clean)) {
      risks.push({ rule: rule.id, line: lineOf(clean, m.index), text: m[0].replace(/\s+/g, " ").trim(), why: rule.why });
    }
  }

  // Drop-and-recreate of the same function name: the signature the old application calls disappears and a new
  // one appears. This is the pattern used by 20261007090004 (job_create / job_update).
  const dropRe = /\bdrop\s+(?:function|procedure)\s+(?:if\s+exists\s+)?([a-z_][\w."]*)\s*\(/gi;
  for (let m = dropRe.exec(clean); m; m = dropRe.exec(clean)) {
    const name = m[1].replace(/"/g, "").toLowerCase();
    const bare = name.split(".").pop();
    const createRe = new RegExp(`\\bcreate\\s+(?:or\\s+replace\\s+)?function\\s+(?:[a-z_][\\w"]*\\.)?"?${bare}"?\\s*\\(`, "i");
    if (createRe.test(clean.slice(m.index))) {
      risks.push({
        rule: "drop-recreate-signature",
        line: lineOf(clean, m.index),
        text: `drop function ${name}(...) then create function ${bare}(...)`,
        why: "replaces an RPC signature in one step: between this migration and promoting the new app, the old app calls a signature that no longer exists. Add the new signature alongside the old one (release N) and drop the old one later (release N+1)",
      });
    }
  }
  return risks.sort((a, b) => a.line - b.line);
}

const MARKER = (kind) => new RegExp(`^[ \\t]*--[ \\t]*migration-policy:[ \\t]*${kind}-reviewed\\b[ \\t]*[:\\-\\u2013\\u2014]?[ \\t]*(.*)$`, "im");

/** A reviewed marker needs a real reason, not just the keyword. */
export function readMarker(sql, kind) {
  const m = MARKER(kind).exec(sql);
  if (!m) return null;
  const reason = m[1].trim();
  return reason.length >= 15 ? reason : { invalid: true };
}

export function versionOf(path) {
  const m = /^(\d{14})_[^/\\]+\.sql$/.exec(basename(path));
  return m ? m[1] : null;
}

/**
 * Evaluate a PR. `changes` is [{ status, path }] (git `--name-status --no-renames`), `readFile(path)` returns the
 * added file's text, `baseFiles` is every migration path on the base branch.
 * Returns { failures: string[], warnings: string[] }.
 */
export function evaluatePr({ changes, readFile, baseFiles }) {
  const failures = [];
  const warnings = [];
  const baseVersions = baseFiles.map(versionOf).filter(Boolean);
  const latestBase = baseVersions.length ? baseVersions.reduce((a, b) => (a > b ? a : b)) : null;
  const seen = new Map();

  for (const { status, path } of changes) {
    const name = basename(path);
    if (!path.startsWith("supabase/migrations/") || !name.endsWith(".sql")) continue;

    if (status !== "A") {
      failures.push(
        `${path}: status ${status}. Applied migrations are immutable history: never edit, delete or rename one. Add a new migration instead.`,
      );
      continue;
    }

    const version = versionOf(path);
    if (!version) {
      failures.push(`${path}: the file name must be <14-digit-version>_<name>.sql.`);
      continue;
    }
    if (seen.has(version) || baseVersions.includes(version)) {
      failures.push(`${path}: version ${version} is already used by ${seen.get(version) ?? "a migration on the base branch"}.`);
    }
    seen.set(version, path);

    const sql = readFile(path);

    if (latestBase !== null && version < latestBase) {
      const marker = readMarker(sql, "out-of-order");
      if (marker && !marker.invalid) {
        warnings.push(`${path}: older than the newest migration on the base branch (${latestBase}); accepted via reviewed marker: ${marker}`);
      } else {
        failures.push(
          `${path}: version ${version} is older than the newest migration already on the base branch (${latestBase}). ` +
            `A database that has applied ${latestBase} would see this as out-of-order history. Renumber it after ${latestBase}, ` +
            `or - only if it reconciles history that is already applied - add: -- migration-policy: out-of-order-reviewed - <reason, at least 15 characters>`,
        );
      }
    }

    const risks = findRisks(sql);
    if (risks.length > 0) {
      const marker = readMarker(sql, "destructive");
      const detail = risks.map((r) => `    line ${r.line}: [${r.rule}] ${r.text} - ${r.why}`).join("\n");
      if (marker && !marker.invalid) {
        warnings.push(`${path}: destructive-looking statements accepted via reviewed marker: ${marker}\n${detail}`);
      } else {
        failures.push(
          `${path}: destructive-looking statements. The database is migrated BEFORE the new application is promoted, so the OLD application ` +
            `briefly runs against the NEW schema. Use expand/contract: release N adds compatible schema (old and new app both work); ` +
            `release N+1 removes the old schema once nothing promoted depends on it. If this is that N+1 step, add: ` +
            `-- migration-policy: destructive-reviewed - <why it is safe and which earlier release made it safe, at least 15 characters>\n${detail}`,
        );
      }
    }
  }
  return { failures, warnings };
}

export function parseChanges(text) {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      const [status, ...rest] = l.split("\t");
      return { status: status.trim().charAt(0), path: rest.join("\t").trim() };
    });
}

export function main(argv) {
  const args = { changes: null, baseFiles: null, root: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--changes") args.changes = argv[++i];
    else if (argv[i] === "--base-files") args.baseFiles = argv[++i];
    else if (argv[i] === "--root") args.root = argv[++i];
    else {
      console.error(`unexpected argument: ${argv[i]}`);
      return 2;
    }
  }
  if (!args.changes || !args.baseFiles) {
    console.error("usage: migration-policy.mjs --changes <name-status file> --base-files <file list> [--root <repo>]");
    return 2;
  }
  const root = resolve(args.root);
  const { failures, warnings } = evaluatePr({
    changes: parseChanges(readFileSync(args.changes, "utf8")),
    baseFiles: readFileSync(args.baseFiles, "utf8").split(/\r?\n/).filter(Boolean),
    readFile: (p) => readFileSync(join(root, p), "utf8"),
  });

  const lines = [];
  if (warnings.length) lines.push("Reviewed exceptions:", ...warnings.map((w) => `  - ${w}`), "");
  if (failures.length) {
    lines.push("Migration policy: this change needs attention.", ...failures.map((f) => `  - ${f}`), "");
    lines.push("This check is a review aid, not a proof: it cannot see dynamic SQL and it can flag harmless statements.");
  } else {
    lines.push("Migration policy: no problems found in the migrations changed by this PR.");
    lines.push("(A review aid, not a proof of backward compatibility.)");
  }
  const text = lines.join("\n");
  console.log(text);
  if (process.env.GITHUB_ACTIONS === "true") {
    for (const f of failures) {
      console.log(`::error title=Migration policy::${f.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`);
    }
    for (const w of warnings) {
      console.log(`::warning title=Migration policy (reviewed exception)::${w.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Migration policy\n\n\`\`\`\n${text}\n\`\`\`\n`);
  }
  return failures.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
