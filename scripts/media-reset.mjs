#!/usr/bin/env node
// Clean-media reset: READ-ONLY inventory and classification. This tool deletes nothing.
//
// Owner decision 2026-11-01: R2 is the only application media store; legacy Supabase Storage media is not migrated;
// accounts and unrelated business data stay. Deleting hosted media needs a separate approval of THIS inventory (with
// its hash) and the reviewed execution path. Static website assets (frontend/public) are not media and are never in
// scope; compliance evidence is reported as RETAINED and is never offered for deletion.
//
//   node scripts/media-reset.mjs inventory --project <ref|local> [--json]
//   node scripts/media-reset.mjs snapshot  --project <ref|local> > before.json   (per-bucket object counts)
//   node scripts/media-reset.mjs compare --before before.json --after after.json  (fails if any bucket grew)
//
// Output: counts only (never keys, names, owners or ids) and a `retained` section naming what must not be removed. The
// count hash here is a quick drift indicator ONLY: it is not an approval. The owner approves the object-level manifest
// (scripts/media-reset-execute.mjs manifest), whose hash covers every bucket, key, storage identity and retention decision.
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/** The seven application Storage buckets. Anything else in Storage is not application media and is not counted. */
export const BUCKETS = ["avatars", "professional-portfolio", "professional-certificates", "product-images",
  "organization-images", "purchase-request-images", "business-verification-documents"];

/** namespace -> table and the column that says whether a row is still attached to something that must be kept. */
export const NAMESPACE_TABLES = {
  avatar: { table: "avatar_uploads", bucket: "avatars" },
  portfolio: { table: "portfolio_items", bucket: "professional-portfolio" },
  certificate: { table: "professional_certificates", bucket: "professional-certificates" },
  product: { table: "product_images", bucket: "product-images" },
  organization: { table: "organization_images", bucket: "organization-images" },
  request: { table: "purchase_request_images", bucket: "purchase-request-images" },
  verification: { table: "business_verification_documents", bucket: "business-verification-documents" },
};
const STATES = ["pending", "ready", "deleted"];
/** Database references that point at media and would be cleared with it (accounts themselves are never touched). */
export const REFERENCES = [
  ["profiles", "avatar_media_id"], ["profiles", "cover_media_id"], ["organizations", "logo_media_id"], ["portfolio_projects", "cover_id"],
];

export class ResetOperatorError extends Error {}

/** Per-bucket object counts: the before/after evidence that no application file bytes entered Supabase Storage. */
export async function storageSnapshot(io) {
  const buckets = {};
  for (const bucket of BUCKETS) buckets[bucket] = await io.storageObjects(bucket);
  return { takenAt: new Date().toISOString(), buckets };
}

/** Passes only if no application bucket grew. Shrinking is fine (cleanup); a bucket missing from either side fails. */
export function compareSnapshots(before, after) {
  const grown = [];
  for (const bucket of BUCKETS) {
    const a = before?.buckets?.[bucket], b = after?.buckets?.[bucket];
    if (!Number.isInteger(a) || !Number.isInteger(b)) throw new ResetOperatorError(`Snapshot is missing bucket ${bucket}`);
    if (b > a) grown.push({ bucket, before: a, after: b });
  }
  return { ok: grown.length === 0, grown };
}

/**
 * io = { count(table, filters?) -> number, storageObjects(bucket) -> number, locations(provider, cleaned) -> number }
 * Injected so the logic is tested without a database.
 */
export async function buildInventory(io) {
  const namespaces = {};
  for (const [ns, { table, bucket }] of Object.entries(NAMESPACE_TABLES)) {
    const states = {};
    for (const state of STATES) states[state] = await io.count(table, { state });
    const locations = { r2: await io.locations(ns, "r2"), supabase: await io.locations(ns, "supabase") };
    states.total = states.pending + states.ready + states.deleted + (await io.count(table, { otherStates: STATES }));
    namespaces[ns] = { rows: states, locations, storageObjects: await io.storageObjects(bucket) };
  }
  const references = {};
  for (const [table, column] of REFERENCES) references[`${table}.${column}`] = await io.count(table, { notNull: column });
  const retained = {
    // Submitted verification evidence is compliance retention: never selected, whatever the state of the reset.
    submittedVerificationDocuments: await io.count(NAMESPACE_TABLES.verification.table, { submitted: true }),
    demoProductImageRefs: await io.count("products", { notNull: "image_ref" }),
    accountsAndProfiles: await io.count("profiles", {}),
    staticWebsiteAssets: "frontend/public (not media, not in scope)",
  };
  const body = { namespaces, references, retained };
  return { ...body, sha256: createHash("sha256").update(JSON.stringify(body)).digest("hex") };
}

/** The reset scope, derived from the inventory: what a separately approved execution would remove. */
export function resetScope(inventory) {
  const scope = [];
  for (const [ns, data] of Object.entries(inventory.namespaces)) {
    if (ns === "verification") {
      scope.push({ namespace: ns, action: "retain-submitted-evidence-only", removableDrafts: data.rows.pending + data.rows.deleted,
        retained: inventory.retained.submittedVerificationDocuments });
      continue;
    }
    scope.push({ namespace: ns, action: "remove-all", storageObjects: data.storageObjects, rows: data.rows.total });
  }
  return scope;
}

export function createReadOnlyInventoryIo(supabase) {
  const apply = (query, filters) => {
    if (filters.state) query = query.eq("state", filters.state);
    if (filters.otherStates) query = query.not("state", "in", `(${filters.otherStates.join(",")})`);
    if (filters.notNull) query = query.not(filters.notNull, "is", null);
    if (filters.submitted) query = query.not("submission_id", "is", null);
    return query;
  };
  const countOf = async (query) => {
    const { count, error } = await query;
    if (error) throw new ResetOperatorError("Inventory query failed; verify the environment and permissions");
    return count ?? 0;
  };
  const walk = async (bucket, prefix = "") => {
    let total = 0;
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 100, offset });
      if (error) throw new ResetOperatorError("Storage listing failed; verify the environment and permissions");
      for (const entry of data) total += entry.id ? 1 : await walk(bucket, `${prefix}${entry.name}/`);
      if (data.length < 100) return total;
    }
  };
  return {
    count: (table, filters = {}) => countOf(apply(supabase.from(table).select("*", { count: "exact", head: true }), filters)),
    locations: (namespace, provider) => countOf(supabase.from("media_storage_locations").select("*", { count: "exact", head: true }).eq("namespace", namespace).eq("provider", provider)),
    storageObjects: (bucket) => walk(bucket),
  };
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (command === "compare") {
    const read = (flag) => JSON.parse(fs.readFileSync(rest[rest.indexOf(flag) + 1], "utf8"));
    const result = compareSnapshots(read("--before"), read("--after"));
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command !== "inventory" && command !== "snapshot") throw new ResetOperatorError("Usage: media-reset.mjs inventory|snapshot --project <ref|local> [--json] | compare --before f --after f. This tool never deletes.");
  const project = rest[rest.indexOf("--project") + 1];
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ResetOperatorError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const host = new URL(url).hostname;
  const configured = ["localhost", "127.0.0.1"].includes(host) ? "local" : host.split(".")[0];
  if (project !== configured) throw new ResetOperatorError("Requested project does not match the configured environment");
  const require = createRequire(new URL("../frontend/package.json", import.meta.url));
  const supabase = require("@supabase/supabase-js").createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  if (command === "snapshot") { console.log(JSON.stringify({ project: configured, readOnly: true, ...(await storageSnapshot(createReadOnlyInventoryIo(supabase))) })); return; }
  const inventory = await buildInventory(createReadOnlyInventoryIo(supabase));
  console.log(JSON.stringify({ project: configured, readOnly: true, ...inventory, scope: resetScope(inventory) }, null, rest.includes("--json") ? 0 : 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof ResetOperatorError ? error.message : "Inventory failed; no change was made.");
    process.exitCode = 1;
  });
}
