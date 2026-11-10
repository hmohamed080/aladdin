#!/usr/bin/env node
// Verifies the Acceptance E2E evidence file. Pure and offline: it reads a JSON file the operator filled in while
// running the E2E and checks that every required isolation result was recorded AND came out as expected.
// A key prefix (u/ or o/) is never ownership proof; this file is: the other user and anonymous callers were actually denied.
//
//   node scripts/r2-e2e-evidence.mjs <evidence.json>
//
// File: [{ "flow": "avatar", "actor": "owner|other|anon", "who": "A|B|P1|P2" (optional label), "op": "read|...", "path": "api-media|p-cover|p-media",
//          "expected": "allow|deny", "observed": "allow|deny", "status": 200,
//          "sessionActive": true,            // other: the session was proven usable before the denial counts
//          "dbUnchanged": true, "r2Unchanged": true,   // actions: the targeted rows and the bucket object were untouched
//          "servedOldBytes": false }, ...]   // old-bytes reads: the replaced object's bytes are not served
// No ids, keys or tokens in this file.
import fs from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Delivery paths are part of the evidence because they are the point of the matrix:
 *   api-media  owner-private delivery (`/api/media/<namespace>`), session required
 *   p-cover    public cover of a LISTED profile (`/p/cover/<profileId>`), anonymous allowed while listed
 *   p-media    published portfolio item (`/p/media/<itemId>`), anonymous allowed while published
 * The avatar itself is owner-private and is never expected to be publicly readable; the public image is the cover.
 * A stable public URL may serve replacement media, so replacement is proven by `read-old-bytes` (the old bytes are not served).
 */
export const FLOWS = ["avatar", "cover", "portfolio", "certificate", "product", "organization", "request", "verification"];
/** The seven approved media flows; `cover` is an extra row of the avatar flow and does not count as an eighth flow. */
export const SEVEN_FLOWS = ["avatar", "portfolio", "certificate", "product", "organization", "request", "verification"];

const PRIVATE = (flow) => [
  ["owner", "read", "allow", "api-media"], ["owner", "read-after-delete", "deny", "api-media"],
  ["other", "read", "deny", "api-media"], ["anon", "read", "deny", "api-media"],
  ["other", "replace-action", "deny", "api-media"], ["other", "delete-action", "deny", "api-media"],
  ...(flow === "avatar" ? [["other", "read-old-bytes", "deny", "api-media"], ["anon", "read-old-bytes", "deny", "api-media"]] : []),
];
const WITHDRAWN = (path, ops) => ops.flatMap((op) => [["other", op, "deny", path], ["anon", op, "deny", path]]);
const MATRIX = {
  avatar: PRIVATE("avatar"),
  cover: [["other", "read", "allow", "p-cover"], ["anon", "read", "allow", "p-cover"], ...WITHDRAWN("p-cover", ["read-after-unlist", "read-old-bytes", "read-after-delete"])],
  portfolio: [
    ["owner", "read", "allow", "api-media"], ["other", "read", "deny", "api-media"], ["anon", "read", "deny", "api-media"],
    ["other", "read-published", "allow", "p-media"], ["anon", "read-published", "allow", "p-media"],
    ...WITHDRAWN("p-media", ["read-after-unpublish", "read-old-bytes", "read-after-delete"]),
    ["other", "replace-action", "deny", "api-media"], ["other", "delete-action", "deny", "api-media"],
  ],
  certificate: PRIVATE("certificate"), product: PRIVATE("product"), organization: PRIVATE("organization"),
  request: PRIVATE("request"), verification: PRIVATE("verification"),
};

/** [actor, op, expected, path] cells required for a flow. */
export function requiredCells(flow) { return MATRIX[flow] ?? []; }

const ACTORS = ["owner", "other", "anon"];
const PATHS = ["api-media", "p-cover", "p-media"];
const DENY_STATUS = (n) => Number.isInteger(n) && n >= 400 && n < 500;
const ALLOW_STATUS = (n) => Number.isInteger(n) && n >= 200 && n < 300;
const isAction = (op) => op.endsWith("-action");

export function verifyEvidence(entries) {
  const problems = [];
  if (!Array.isArray(entries)) return { ok: false, problems: ["evidence must be an array"], checked: 0 };
  const text = JSON.stringify(entries);
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|eyJ[A-Za-z0-9_-]{10,}|\b(u|o)\/[0-9a-f]{8}/i.test(text)) problems.push("evidence must not contain ids, keys or tokens");
  const required = new Map();
  for (const flow of FLOWS) for (const [actor, op, expected, path] of requiredCells(flow)) required.set(`${flow}|${actor}|${op}`, { expected, path });

  // Reject anything outside the matrix or malformed: an unexpected entry is evidence of a different test than the approved one.
  entries.forEach((e, i) => {
    const id = `entry ${i + 1}`;
    if (!e || typeof e !== "object") { problems.push(`${id}: not an object`); return; }
    if (!required.has(`${e.flow}|${e.actor}|${e.op}`)) problems.push(`${id}: ${e.flow}/${e.actor}/${e.op} is not part of the approved matrix`);
    if (!ACTORS.includes(e.actor)) problems.push(`${id}: unknown actor`);
    if (!PATHS.includes(e.path)) problems.push(`${id}: unknown delivery path`);
    if (!["allow", "deny"].includes(e.observed) || !["allow", "deny"].includes(e.expected)) { problems.push(`${id}: expected and observed must be allow or deny`); return; }
    // Application actions return their own documented result (not an HTTP 4xx contract); they are proven by unchanged state instead.
    const stateOnly = typeof e.op === "string" && (isAction(e.op) || e.op === "read-old-bytes");
    if (!stateOnly) {
      if (e.observed === "allow" ? !ALLOW_STATUS(e.status) : !DENY_STATUS(e.status)) problems.push(`${id}: status ${e.status} contradicts observed ${e.observed}`);
    }
    if (e.actor === "other" && e.observed === "deny" && e.sessionActive !== true) problems.push(`${id}: ${e.flow} ${e.op} denial is not evidence unless the other user's session was proven active`);
    if (typeof e.op === "string" && isAction(e.op) && e.observed === "deny" && (e.dbUnchanged !== true || e.r2Unchanged !== true)) problems.push(`${id}: ${e.flow} ${e.op} must record unchanged database rows and unchanged R2 object`);
    if (e.op === "read-old-bytes" && e.servedOldBytes !== false) problems.push(`${id}: ${e.flow} read-old-bytes must record that the old bytes were not served`);
  });

  let checked = 0;
  for (const [key, { expected, path }] of required) {
    const [flow, actor, op] = key.split("|");
    const hits = entries.filter((e) => e && e.flow === flow && e.actor === actor && e.op === op);
    if (hits.length === 0) { problems.push(`${flow}: missing ${actor} ${op}`); continue; }
    checked++;
    if (new Set(hits.map((h) => h.observed)).size > 1) problems.push(`${flow}: ${actor} ${op} has contradictory observations`);
    for (const h of hits) {
      if (h.path !== path) problems.push(`${flow}: ${actor} ${op} recorded path ${h.path}, requirement is ${path}`);
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
