#!/usr/bin/env node
// Verifies the Acceptance seven-flow E2E evidence file. Pure and offline: it reads a JSON file the operator filled in while
// running the E2E and checks that every required isolation result was recorded AND came out as expected.
// A key prefix (u/ or o/) is never ownership proof; this file is: user B and anonymous callers were actually denied.
//
//   node scripts/r2-e2e-evidence.mjs <evidence.json>
//
// File: [{ "flow": "avatar", "actor": "A|B|anon", "op": "read|replace|delete|upload|read-published|read-unpublished|read-current|read-replaced|read-after-delete",
//          "expected": "allow|deny", "observed": "allow|deny", "status": 200 }, ...]   (no ids, keys or tokens in this file)
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const FLOWS = ["avatar", "portfolio", "certificate", "product", "organization", "request", "verification"];

/** [actor, op, expected] cells required for every flow. */
const COMMON = [["A", "read", "allow"], ["B", "read", "deny"], ["B", "replace", "deny"], ["B", "delete", "deny"], ["A", "read-after-delete", "deny"]];
const EXTRA = {
  avatar: [["anon", "read-current", "allow"], ["anon", "read-replaced", "deny"]],
  portfolio: [["anon", "read-published", "allow"], ["anon", "read-unpublished", "deny"]],
  certificate: [["anon", "read", "deny"]],
  product: [["anon", "read", "deny"]],
  organization: [["anon", "read", "deny"]],
  request: [["anon", "read", "deny"]],
  verification: [["anon", "read", "deny"]],
};

export function requiredCells(flow) { return [...COMMON, ...(EXTRA[flow] ?? [])]; }

export function verifyEvidence(entries) {
  const problems = [];
  if (!Array.isArray(entries)) return { ok: false, problems: ["evidence must be an array"], checked: 0 };
  const text = JSON.stringify(entries);
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|eyJ[A-Za-z0-9_-]{10,}|\b(u|o)\/[0-9a-f]{8}/i.test(text)) problems.push("evidence must not contain ids, keys or tokens");
  let checked = 0;
  for (const flow of FLOWS) {
    for (const [actor, op, expected] of requiredCells(flow)) {
      const hits = entries.filter((e) => e.flow === flow && e.actor === actor && e.op === op);
      if (hits.length === 0) { problems.push(`${flow}: missing ${actor} ${op}`); continue; }
      checked++;
      for (const h of hits) {
        if (h.expected !== expected) problems.push(`${flow}: ${actor} ${op} expected ${h.expected}, requirement is ${expected}`);
        if (h.observed !== h.expected) problems.push(`${flow}: ${actor} ${op} observed ${h.observed}, expected ${h.expected}`);
      }
    }
  }
  return { ok: problems.length === 0, problems, checked };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = verifyEvidence(JSON.parse(fs.readFileSync(process.argv[2], "utf8")));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch { console.error("Usage: r2-e2e-evidence.mjs <evidence.json>"); process.exitCode = 1; }
}
