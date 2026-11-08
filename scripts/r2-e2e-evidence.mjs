#!/usr/bin/env node
// Verifies the Acceptance seven-flow E2E evidence file. Pure and offline: it reads a JSON file the operator filled in while
// running the E2E and checks that every required isolation result was recorded AND came out as expected.
// A key prefix (u/ or o/) is never ownership proof; this file is: user B and anonymous callers were actually denied.
//
//   node scripts/r2-e2e-evidence.mjs <evidence.json>
//
// File: [{ "flow": "avatar", "actor": "A|B|anon", "op": "read|replace|delete|read-published|read-unpublished|read-current|read-replaced|read-after-delete",
//          "expected": "allow|deny", "observed": "allow|deny", "status": 200 }, ...]   (no ids, keys or tokens in this file)
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const FLOWS = ["avatar", "portfolio", "certificate", "product", "organization", "request", "verification"];

/**
 * [actor, op, expected] cells required for every flow.
 * Public reads are legitimate for exactly two objects: a CURRENT avatar and a PUBLISHED portfolio item. They must stay
 * readable (allow) for B and anonymous callers; the denial cells for those two flows use the withdrawn state instead
 * (replaced avatar, unpublished portfolio). Everything else is private: B and anonymous are denied.
 */
const OWNER = [["A", "read", "allow"], ["B", "replace", "deny"], ["B", "delete", "deny"], ["A", "read-after-delete", "deny"]];
const PRIVATE_READS = [["B", "read", "deny"], ["anon", "read", "deny"]];
const MATRIX = {
  avatar: [["B", "read-current", "allow"], ["B", "read-replaced", "deny"], ["anon", "read-current", "allow"], ["anon", "read-replaced", "deny"]],
  portfolio: [["B", "read-published", "allow"], ["B", "read-unpublished", "deny"], ["anon", "read-published", "allow"], ["anon", "read-unpublished", "deny"]],
  certificate: PRIVATE_READS, product: PRIVATE_READS, organization: PRIVATE_READS, request: PRIVATE_READS, verification: PRIVATE_READS,
};

export function requiredCells(flow) { return [...OWNER, ...(MATRIX[flow] ?? [])]; }

const ACTORS = ["A", "B", "anon"];
const DENY_STATUS = (n) => Number.isInteger(n) && n >= 400 && n < 500;
const ALLOW_STATUS = (n) => Number.isInteger(n) && n >= 200 && n < 300;

export function verifyEvidence(entries) {
  const problems = [];
  if (!Array.isArray(entries)) return { ok: false, problems: ["evidence must be an array"], checked: 0 };
  const text = JSON.stringify(entries);
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|eyJ[A-Za-z0-9_-]{10,}|\b(u|o)\/[0-9a-f]{8}/i.test(text)) problems.push("evidence must not contain ids, keys or tokens");
  const required = new Map();
  for (const flow of FLOWS) for (const [actor, op, expected] of requiredCells(flow)) required.set(`${flow}|${actor}|${op}`, expected);

  // Reject anything outside the matrix or malformed: an unexpected entry is evidence of a different test than the approved one.
  entries.forEach((e, i) => {
    const id = `entry ${i + 1}`;
    if (!e || typeof e !== "object") { problems.push(`${id}: not an object`); return; }
    if (!required.has(`${e.flow}|${e.actor}|${e.op}`)) problems.push(`${id}: ${e.flow}/${e.actor}/${e.op} is not part of the approved matrix`);
    if (!ACTORS.includes(e.actor)) problems.push(`${id}: unknown actor`);
    if (!["allow", "deny"].includes(e.observed) || !["allow", "deny"].includes(e.expected)) problems.push(`${id}: expected and observed must be allow or deny`);
    else if (e.observed === "allow" ? !ALLOW_STATUS(e.status) : !DENY_STATUS(e.status)) problems.push(`${id}: status ${e.status} contradicts observed ${e.observed}`);
  });

  let checked = 0;
  for (const [key, expected] of required) {
    const [flow, actor, op] = key.split("|");
    const hits = entries.filter((e) => e && e.flow === flow && e.actor === actor && e.op === op);
    if (hits.length === 0) { problems.push(`${flow}: missing ${actor} ${op}`); continue; }
    checked++;
    if (new Set(hits.map((h) => h.observed)).size > 1) problems.push(`${flow}: ${actor} ${op} has contradictory observations`);
    for (const h of hits) {
      if (h.expected !== expected) problems.push(`${flow}: ${actor} ${op} recorded expected ${h.expected}, requirement is ${expected}`);
      if (h.observed !== expected) problems.push(`${flow}: ${actor} ${op} observed ${h.observed}, expected ${expected}`);
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
