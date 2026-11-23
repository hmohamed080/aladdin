#!/usr/bin/env node
// READ-ONLY baseline check for a Worker D1 database before `wrangler d1 migrations apply`. It runs ONE SELECT on sqlite_master through
// `wrangler d1 execute --remote` and prints what exists and what to do next. It never writes and never applies anything.
//
//   node scripts/d1-baseline-check.mjs <database-name>
//
// Why it exists: the Production D1 was created by hand (0001's table and index exist) and has NO d1_migrations tracking table. Because
// every migration here is idempotent (IF NOT EXISTS), `wrangler d1 migrations apply <db> --remote` is a safe baseline: it creates the
// tracking table, records 0001 as a no-op and applies the rest. The check classifies the database so nobody has to guess.
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readdirSync, readFileSync } from "node:fs";

const MIGRATIONS = new URL("../migrations/", import.meta.url);
const QUERY = "select type, name, sql from sqlite_master where name not like 'sqlite_%' and name not like '_cf_%' order by type, name";

/** Pure classification: which objects exist and what the next step is. */
export function classify(objects, expected) {
  const names = new Set(objects.map((o) => o.name));
  const tracked = names.has("d1_migrations");
  const missingTables = expected.tables.filter((t) => !names.has(t));
  const presentTables = expected.tables.filter((t) => names.has(t));
  let state;
  if (presentTables.length === 0 && !tracked) state = "empty";
  else if (tracked) state = missingTables.length === 0 ? "current" : "tracked_behind";
  else if (names.has("whatsapp_hook_events") && missingTables.length) state = "untracked_partial";
  else state = "untracked_complete";
  const next = {
    empty: "run: wrangler d1 migrations apply <db> --remote (applies every migration in order)",
    untracked_partial: "created by hand: every migration is idempotent, so run: wrangler d1 migrations apply <db> --remote (it records 0001 as a no-op, then applies the rest)",
    untracked_complete: "objects exist but there is no tracking table: run wrangler d1 migrations apply <db> --remote so the tracking table matches; nothing will change",
    tracked_behind: "run: wrangler d1 migrations apply <db> --remote",
    current: "nothing to apply",
  }[state];
  return { state, tracked, presentTables, missingTables, next };
}

/** The tables the repository's migrations create, read from the files (so this never drifts from them). */
export function expectedFromMigrations(dir = MIGRATIONS) {
  const tables = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    for (const m of readFileSync(new URL(f, dir), "utf8").matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/gi)) tables.push(m[1]);
  }
  return { tables: [...new Set(tables)] };
}


/** SQLite stores a CREATE statement without IF NOT EXISTS; compare modulo that, comments and whitespace. */
export function normalizeSql(sql) {
  return String(sql)
    .replace(/--[^\n]*/g, " ")
    .replace(/\bIF NOT EXISTS\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .replace(/;\s*$/, "")
    .trim()
    .toLowerCase();
}

/** Every CREATE TABLE / CREATE INDEX statement of one migration file, keyed by object name. */
export function createStatements(file, dir = MIGRATIONS) {
  const text = readFileSync(new URL(file, dir), "utf8").replace(/--[^\n]*/g, " ");
  const out = new Map();
  for (const stmt of text.split(";")) {
    const m = /^\s*CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+(?:IF NOT EXISTS\s+)?([a-z_0-9]+)/i.exec(stmt);
    if (m) out.set(m[1], normalizeSql(stmt));
  }
  return out;
}

/** Exact-SQL comparison of live objects against the named migration files: matching, missing, different and unexpected objects. */
export function verifySchema(objects, files, dir = MIGRATIONS) {
  const live = new Map(objects.filter((o) => o.sql).map((o) => [o.name, normalizeSql(o.sql)]));
  const expected = new Map();
  for (const f of files) for (const [k, v] of createStatements(f, dir)) expected.set(k, v);
  const matching = [];
  const missing = [];
  const different = [];
  for (const [name, sql] of expected) {
    if (!live.has(name)) missing.push(name);
    else if (live.get(name) === sql) matching.push(name);
    else different.push(name);
  }
  const unexpected = [...live.keys()].filter((n) => !expected.has(n) && n !== "d1_migrations");
  return { matching, missing, different, unexpected };
}

export function runCheck(database, runner = spawnSync) {
  if (!/^[a-z0-9-]{3,63}$/.test(database ?? "")) throw new Error("usage: d1-baseline-check.mjs <database-name>");
  const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
  const r = runner(process.execPath, [wrangler, "d1", "execute", database, "--remote", "--json", "--command", QUERY], { encoding: "utf8", maxBuffer: 8 << 20 });
  if (r.status !== 0) throw new Error("wrangler failed: " + String(r.stderr || r.stdout).slice(0, 300));
  const start = r.stdout.indexOf("[");
  const rows = JSON.parse(r.stdout.slice(start))[0]?.results ?? [];
  return { database, ...classify(rows, expectedFromMigrations()), schema: verifySchema(rows, readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = runCheck(process.argv[2]);
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(String(e.message ?? e).slice(0, 300));
    process.exit(1);
  }
}
