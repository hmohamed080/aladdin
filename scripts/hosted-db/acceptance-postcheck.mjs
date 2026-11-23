#!/usr/bin/env node
/**
 * Pure post-push validation for an Acceptance push. No network. Plan-driven (see acceptance-gate.mjs PLANS).
 *   node acceptance-postcheck.mjs <plan> <pre-structure.json> <pre-counts.json> <post-structure.json> <post-counts.json>
 * Inputs are `supabase db query -o json` outputs of acceptance-structure.sql and table-counts.sql.
 * Hard failures: wrong pre-state, wrong latest/applied after, media/storage object counts changed.
 * Informational (printed, never fatal): other row-count differences (legitimate concurrent test activity). The set of changed
 * catalog objects is checked separately by catalog-diff.mjs --expect-changed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { plan } from "./acceptance-gate.mjs";

export function pick(text, key) {
  const start = text.search(/[\[{]/);
  if (start < 0) throw new Error("no JSON in db query output");
  const doc = JSON.parse(text.slice(start));
  const rows = Array.isArray(doc) ? doc : doc?.rows;
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error("expected exactly one row");
  let v = rows[0]?.[key];
  if (typeof v === "string") v = JSON.parse(v);
  if (!v || typeof v !== "object") throw new Error(`column ${key} missing`);
  return v;
}

export function postcheck({ plan: name, preS, preC, postS, postC }) {
  const P = plan(name), fail = [], info = [];
  if (preS.latest_migration !== P.latest || Number(preS.applied_migrations) !== P.applied) fail.push(`pre-push state is ${preS.applied_migrations}/${preS.latest_migration}, expected ${P.applied}/${P.latest}`);
  if (postS.latest_migration !== P.pending.at(-1)) fail.push(`latest migration is ${postS.latest_migration}, expected ${P.pending.at(-1)}`);
  if (Number(postS.applied_migrations) !== P.applied + P.pending.length) fail.push(`${postS.applied_migrations} migrations applied, expected ${P.applied + P.pending.length}`);
  if (Number(postS.storage_objects) !== Number(preS.storage_objects)) fail.push(`storage.objects changed ${preS.storage_objects} -> ${postS.storage_objects}`);
  if (Number(postS.media_locations) !== Number(preS.media_locations)) fail.push(`media_storage_locations changed ${preS.media_locations} -> ${postS.media_locations}`);
  for (const t of Object.keys(preC)) if (Number(postC[t]) !== Number(preC[t])) info.push(`${t}: ${preC[t]} -> ${postC[t]}`);
  for (const t of Object.keys(postC)) if (!(t in preC)) info.push(`${t}: new table (${postC[t]} rows)`);
  return { fail, info };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const [name, ...files] = process.argv.slice(2);
    const [a, b, c, d] = files.map((f) => readFileSync(f, "utf8"));
    const { fail, info } = postcheck({ plan: name, preS: pick(a, "facts"), preC: pick(b, "counts"), postS: pick(c, "facts"), postC: pick(d, "counts") });
    if (info.length) console.log("row-count differences to review (not failures):\n" + info.map((x) => `  - ${x}`).join("\n"));
    if (fail.length) { console.error("Acceptance post-push validation: FAILED\n" + fail.map((x) => `  - ${x}`).join("\n")); process.exit(1); }
    console.log("Acceptance post-push validation: ok (history, media/storage counts)");
  } catch (e) { console.error(`UNUSABLE INPUT: ${e.message}`); process.exit(2); }
}
