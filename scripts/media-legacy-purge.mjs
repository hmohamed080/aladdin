// Retires the LEGACY Supabase Storage media of the five migrated namespaces once R2 holds the verified copies.
// DRY-RUN unless --execute AND --confirm "DELETE LEGACY MEDIA <project>". Permanent: deleted files cannot be recovered.
// Counts only are printed (never object names, owners or keys). Runs with the owner's own service-role key from the
// owner's own environment; nothing in this repository holds or logs it.
//
//   node scripts/media-legacy-purge.mjs --project <ref>                       dry-run: what would be deleted / kept
//   node scripts/media-legacy-purge.mjs --project <ref> --execute --confirm "DELETE LEGACY MEDIA <ref>"
//
// An object is deleted only when it is a RETAINED SOURCE (a ready item whose provider is r2 with a verified copy:
// verified_at, sha256 and size recorded) or an ORPHAN (no ready item references it). It is NEVER deleted when a ready
// item is still served from Supabase (the only copy) or its R2 row is unverified; any such object aborts --execute.
// Buckets outside the five below (purchase-request-images, business-verification-documents) are never touched.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));

export class PurgeError extends Error {}

export const PURGE_BUCKETS = {
  avatars: "avatar", "professional-portfolio": "portfolio", "professional-certificates": "certificate",
  "product-images": "product", "organization-images": "organization",
};
const PAGE = 100;

/** Pure: decide what happens to each storage object. Returns counts plus the names to delete per bucket. */
export function classify(objects, inventory, r2Verified) {
  const items = new Map(inventory.map((r) => [`${r.namespace}/${r.object_key}`, r]));
  const out = { retainedSource: 0, orphan: 0, onlyCopy: 0, r2Unverified: 0, foreignBucket: 0, deletable: {} };
  for (const { bucket, name } of objects) {
    const ns = PURGE_BUCKETS[bucket];
    if (!ns) { out.foreignBucket++; continue; }
    const item = items.get(`${ns}/${name}`);
    let verdict;
    if (!item) verdict = "orphan";
    else if (item.provider !== "r2") verdict = "onlyCopy";
    else if (!r2Verified.has(`${ns}/${name}`)) verdict = "r2Unverified";
    else verdict = "retainedSource";
    out[verdict]++;
    if (verdict === "orphan" || verdict === "retainedSource") (out.deletable[bucket] ??= []).push(name);
  }
  return out;
}

export function assertConfirmed({ project, execute, confirm }) {
  if (!execute) return;
  if (confirm !== `DELETE LEGACY MEDIA ${project}`) throw new PurgeError(`--execute needs --confirm "DELETE LEGACY MEDIA ${project}" (permanent deletion)`);
}

/** Runs the purge against an io object. Never deletes when anything is protected. */
export async function runPurge(io, { project, execute }) {
  const objects = [];
  for (const bucket of Object.keys(PURGE_BUCKETS)) for (const name of await io.listBucket(bucket)) objects.push({ bucket, name });
  const result = classify(objects, await io.inventory(), await io.r2Verified());
  const summary = { project, execute: Boolean(execute), objects: objects.length, retainedSource: result.retainedSource, orphan: result.orphan,
    onlyCopy: result.onlyCopy, r2Unverified: result.r2Unverified, protected: result.onlyCopy + result.r2Unverified,
    toDelete: result.retainedSource + result.orphan, deleted: 0, remainingAfter: null };
  if (!execute) return summary;
  if (summary.protected > 0) throw new PurgeError(`Refusing to delete: ${result.onlyCopy} object(s) are the only copy of a ready item and ${result.r2Unverified} have an unverified R2 row. Nothing was deleted.`);
  for (const [bucket, names] of Object.entries(result.deletable)) {
    for (let i = 0; i < names.length; i += PAGE) {
      const batch = names.slice(i, i + PAGE);
      await io.remove(bucket, batch);
      summary.deleted += batch.length;
    }
  }
  let remaining = 0;
  for (const bucket of Object.keys(PURGE_BUCKETS)) remaining += (await io.listBucket(bucket)).length;
  summary.remainingAfter = remaining;
  return summary;
}

export function supabaseIo(supabase) {
  const list = async (bucket, prefix = "") => {
    const names = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw new PurgeError("Listing a bucket failed; nothing was deleted.");
      for (const entry of data) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id === null) names.push(...await list(bucket, path)); else names.push(path);
      }
      if (data.length < 1000) break;
    }
    return names;
  };
  return {
    listBucket: (bucket) => list(bucket),
    inventory: async () => {
      const rows = []; let after = "";
      for (;;) {
        const { data, error } = await supabase.rpc("media_migration_inventory", { p_limit: PAGE, p_after: after });
        if (error) throw new PurgeError("Inventory query failed; nothing was deleted.");
        rows.push(...data);
        if (data.length < PAGE) break;
        after = data.at(-1).cursor_key;
      }
      return rows;
    },
    r2Verified: async () => {
      const ok = new Set();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from("media_storage_locations").select("namespace,object_key,verified_at,sha256,size_bytes")
          .eq("provider", "r2").order("namespace").order("object_key").range(from, from + 999);
        if (error) throw new PurgeError("Reading the R2 verification records failed; nothing was deleted.");
        for (const r of data) if (r.verified_at && r.sha256 && r.size_bytes != null) ok.add(`${r.namespace}/${r.object_key}`);
        if (data.length < 1000) break;
      }
      return ok;
    },
    remove: async (bucket, names) => {
      const { error } = await supabase.storage.from(bucket).remove(names);
      if (error) throw new PurgeError("A delete batch failed; stopped. Re-run the dry-run to see what is left.");
    },
  };
}

export async function main(argv = process.argv.slice(2)) {
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const project = opt("--project"); const execute = argv.includes("--execute"); const confirm = opt("--confirm");
  if (!project) throw new PurgeError("--project <ref> is required");
  assertConfirmed({ project, execute, confirm });
  const { readMaintenanceEnv } = await import("../frontend/src/lib/env/media-maintenance.mjs");
  const env = readMaintenanceEnv();
  const ref = new URL(env.SUPABASE_URL).hostname.split(".")[0];
  if (ref !== project) throw new PurgeError("Requested project does not match the configured environment");
  if (execute && env.MEDIA_MIGRATION_APPROVED_PROJECT !== project) throw new PurgeError("Execution needs MEDIA_MIGRATION_APPROVED_PROJECT set to this project");
  const { createClient } = require("@supabase/supabase-js");
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  console.log(JSON.stringify(await runPurge(supabaseIo(supabase), { project, execute })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof PurgeError ? error.message : "Legacy media purge failed; nothing was deleted unless a summary was printed.");
    process.exitCode = 1;
  });
}
