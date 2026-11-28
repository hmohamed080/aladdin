#!/usr/bin/env node
/**
 * Read-only post-migration function-permission verification for a HOSTED project.
 *
 * migration-permission-gate.mjs only talks to local RC2 Docker containers and cannot be pointed at a hosted database.
 * This script is the hosted counterpart and is pure: it never connects anywhere. The shell wrapper
 * (verify-permissions-readonly.sh) runs the SELECT-only inventory scripts/function-permissions.sql through
 * `supabase db query --linked -o json` and hands the saved output to this script, which compares it with the reviewed
 * contract supabase/permissions/<version>.json using the same compare() the CI gate uses.
 *
 *   node verify-permissions-readonly.mjs <db-query-output.json> [contract version, default = latest]
 * Exit 0 = exact match, 1 = mismatch (every difference printed), 2 = unusable input.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compare, contract, latestContractVersion } from "../migration-permission-gate.mjs";

/** `db query -o json` returns an array of rows or { rows: [...] }; the jsonb column may be a value or a JSON string. */
export function extractPermissions(text) {
  const start = text.search(/[\[{]/);
  if (start < 0) throw new Error("no JSON in the db query output");
  let doc;
  try { doc = JSON.parse(text.slice(start)); } catch (e) { throw new Error(`db query output is not valid JSON: ${e.message}`); }
  const rows = Array.isArray(doc) ? doc : doc?.rows;
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error("expected exactly one result row");
  let perms = rows[0]?.permissions;
  if (typeof perms === "string") perms = JSON.parse(perms);
  if (!Array.isArray(perms) || perms.length === 0) throw new Error("permissions column is missing or empty");
  return perms;
}

export function verify(text, version = latestContractVersion()) {
  const actual = extractPermissions(text);
  const expected = contract(version);
  return { version, actual: actual.length, expected: expected.length, errors: compare(actual, expected) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const [file, version] = process.argv.slice(2);
    if (!file) { console.error("usage: verify-permissions-readonly.mjs <db-query-output.json> [version]"); process.exit(2); }
    const r = verify(readFileSync(file, "utf8"), version);
    if (r.errors.length) {
      console.error(`FAIL: ${r.errors.length} difference(s) against contract ${r.version}\n` + r.errors.map((e) => `  - ${e}`).join("\n"));
      process.exit(1);
    }
    console.log(`PASS ${r.actual} functions match contract ${r.version} (${r.expected} reviewed)`);
  } catch (e) { console.error(`UNUSABLE INPUT: ${e.message}`); process.exit(2); }
}
