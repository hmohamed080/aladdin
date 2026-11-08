#!/usr/bin/env node
/**
 * Pure post-push validation for the Acceptance push of 20261107090003..090006. No network.
 *   node acceptance-postcheck.mjs <pre-structure.json> <pre-counts.json> <post-structure.json> <post-counts.json>
 * Inputs are `supabase db query -o json` outputs of acceptance-structure.sql and table-counts.sql.
 * Hard failures: structural facts wrong, media/storage counts changed, new tables not in their initial state.
 * Informational (printed, never fatal): other row-count differences, which can come from legitimate concurrent test activity
 * or from the migrations' own permission/vocabulary rows.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const NEW_TABLES = ["app.backup_environment", "app.backup_settings", "app.backup_runs", "app.backup_run_events", "app.whatsapp_otp_delivery_requests"];

export function postcheck({ preS, preC, postS, postC }) {
  const fail = [], info = [];
  if (preS.storage_key_column !== false || preS.backup_tables !== 0 || preS.delivery_requests_table !== false) fail.push("pre-push state is not the expected one (storage_key/backup tables/delivery table already present)");
  if (postS.storage_key_column !== true) fail.push("storage_key column was not added to public.media_storage_locations");
  if (postS.backup_tables !== 4) fail.push(`${postS.backup_tables} of 4 backup tables exist`);
  if (postS.delivery_requests_table !== true) fail.push("app.whatsapp_otp_delivery_requests does not exist");
  if (postS.latest_migration !== "20261107090006") fail.push(`latest migration is ${postS.latest_migration}`);
  if (Number(postS.storage_objects) !== Number(preS.storage_objects)) fail.push(`storage.objects changed ${preS.storage_objects} -> ${postS.storage_objects}`);
  if (Number(postS.media_locations) !== Number(preS.media_locations)) fail.push(`media_storage_locations changed ${preS.media_locations} -> ${postS.media_locations}`);
  const expectRows = { "app.backup_settings": 1, "app.backup_environment": 0, "app.backup_runs": 0, "app.backup_run_events": 0, "app.whatsapp_otp_delivery_requests": 0 };
  for (const [t, n] of Object.entries(expectRows)) if (Number(postC[t]) !== n) fail.push(`${t} has ${postC[t]} rows, expected ${n}`);
  for (const t of Object.keys(preC)) if (Number(postC[t]) !== Number(preC[t])) info.push(`${t}: ${preC[t]} -> ${postC[t]}`);
  for (const t of Object.keys(postC)) if (!(t in preC) && !NEW_TABLES.includes(t)) info.push(`${t}: new table (${postC[t]} rows)`);
  return { fail, info };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const [a, b, c, d] = process.argv.slice(2).map((f) => readFileSync(f, "utf8"));
    const { fail, info } = postcheck({ preS: pick(a, "facts"), preC: pick(b, "counts"), postS: pick(c, "facts"), postC: pick(d, "counts") });
    if (info.length) console.log("row-count differences to review (not failures):\n" + info.map((x) => `  - ${x}`).join("\n"));
    if (fail.length) { console.error("Acceptance post-push validation: FAILED\n" + fail.map((x) => `  - ${x}`).join("\n")); process.exit(1); }
    console.log("Acceptance post-push validation: ok (structure, media/storage counts and new-table initial state)");
  } catch (e) { console.error(`UNUSABLE INPUT: ${e.message}`); process.exit(2); }
}
