#!/usr/bin/env node
// R2 <-> database reconciliation. READ-ONLY: it lists and counts, never writes, copies or deletes.
//
// Compares the private media bucket with public.media_storage_locations (provider = 'r2'):
//   missing        a verified, not-cleaned row whose original is absent from R2          -> BLOCKER
//   sizeMismatch   original exists but its size differs from the receipt                 -> BLOCKER
//   orphan         an original in R2 that no row (live or retired) refers to             -> review
//   retiredLeft    an original still in R2 whose row is cleaned (cleanup did not finish) -> run `media-storage cleanup`
//   orphanVariant  a variant (v/...) whose original has no row                           -> review
//   stalePending   pending/ upload older than the lifecycle window (default 48 h)        -> lifecycle not applied?
//   pendingFresh / video / other   informational
//
//   node scripts/r2-reconcile.mjs --project <ref|local> [--max-age-hours 48] [--since <ISO>] [--json] [--allow-orphans]
//
// --since <ISO time>: E2E window check. Every row created since then must be R2 + ids-only, and all 7 namespaces must appear.
//
// Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
// R2_PRIVATE_BUCKET (read access is enough). Output is counts and short key fingerprints only: never keys, owners or
// ids. Exit 1 when a blocker exists (or any orphan unless --allow-orphans), so it can gate a cutover step.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export class ReconcileOperatorError extends Error {}

const VARIANTS = ["thumb", "card", "full"];
const fingerprint = (key) => createHash("sha256").update(key).digest("hex").slice(0, 10);

/** The physical key of a row's original: the database-minted ids-only key, else the legacy namespace/object_key. */
export const physicalKey = (row) => row.storage_key ?? `${row.namespace}/${row.object_key}`;

/** Variant keys that belong to an original: ids-only `<folder>/v/<name>.webp`, legacy `v/<physical>/<name>.webp`. */
export function variantKeys(original) {
  return VARIANTS.map((name) => (/^[uo]\//.test(original)
    ? original.replace(/\/original\.[a-z0-9]+$/, `/v/${name}.webp`)
    : `v/${original}/${name}.webp`));
}

/**
 * Pure classification. `rows`: media_storage_locations rows with provider 'r2'. `objects`: [{ key, size, lastModified }].
 * Returns counts, per-namespace counts of live rows, and capped samples of fingerprints.
 */
export function reconcile(rows, objects, { now = Date.now(), maxAgeHours = 48, sampleLimit = 10 } = {}) {
  const byKey = new Map(rows.map((row) => [physicalKey(row), row]));
  const variantOwner = new Map();
  for (const key of byKey.keys()) for (const v of variantKeys(key)) variantOwner.set(v, key);

  const counts = { rows: rows.length, live: 0, objects: objects.length, ok: 0, missing: 0, sizeMismatch: 0, unverified: 0, orphan: 0,
    retiredLeft: 0, orphanVariant: 0, variantsOk: 0, pendingFresh: 0, stalePending: 0, video: 0, other: 0 };
  const samples = { missing: [], sizeMismatch: [], orphan: [], retiredLeft: [], orphanVariant: [], stalePending: [] };
  const note = (kind, key) => { counts[kind]++; if (samples[kind].length < sampleLimit) samples[kind].push(fingerprint(key)); };
  const perNamespace = {};
  const seen = new Set();

  for (const object of objects) {
    const key = object.key;
    const age = now - new Date(object.lastModified).getTime();
    if (key.startsWith("pending/")) {
      if (age > maxAgeHours * 3_600_000) note("stalePending", key); else counts.pendingFresh++;
      continue;
    }
    if (key.startsWith("video/")) { counts.video++; continue; }
    if (key.startsWith("site/")) { counts.other++; continue; } // site media belongs to the site bucket; reported, not judged
    const row = byKey.get(key);
    if (row) {
      seen.add(key);
      if (row.cleaned_at) { note("retiredLeft", key); continue; }
      if (!row.verified_at) { counts.unverified++; continue; } // reserved but not yet verified: not a defect
      if (row.size_bytes != null && Number(row.size_bytes) !== Number(object.size)) { note("sizeMismatch", key); continue; }
      counts.ok++;
      continue;
    }
    if (variantOwner.has(key)) { counts.variantsOk++; continue; }
    if (/(^|\/)v\//.test(key)) { note("orphanVariant", key); continue; }
    if (/^(avatar|portfolio|certificate|product|organization|request|verification)\//.test(key) || /^[uo]\/[0-9a-f-]{36}\//.test(key)) { note("orphan", key); continue; }
    counts.other++;
  }

  for (const row of rows) {
    if (row.cleaned_at || !row.verified_at) continue;
    counts.live++;
    perNamespace[row.namespace] = (perNamespace[row.namespace] ?? 0) + 1;
    if (!seen.has(physicalKey(row))) note("missing", physicalKey(row));
  }
  const blockers = counts.missing + counts.sizeMismatch;
  return { counts, perNamespace, samples, blockers, ok: blockers === 0 };
}

const NAMESPACES = ["avatar", "portfolio", "certificate", "product", "organization", "request", "verification"];
const IDS_ONLY_KEY = /^(u|o)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-z0-9/-]+\/original\.[a-z0-9]+$/;

/**
 * E2E window check: everything created since `since` must be R2-only and ids-only. `rows` are ALL media_storage_locations rows
 * (any provider). Blockers: a new Supabase-provider row, a new R2 row without a storage_key, or a key outside the ids-only shape.
 * `uncovered` lists namespaces with no new row, so "all 7 flows ran" is checkable. Counts only.
 */
export function windowReport(rows, since) {
  const t = new Date(since).getTime();
  if (!Number.isFinite(t)) throw new ReconcileOperatorError("--since must be an ISO timestamp");
  const fresh = rows.filter((r) => new Date(r.created_at).getTime() >= t);
  const perNamespace = Object.fromEntries(NAMESPACES.map((ns) => [ns, { r2: 0, supabase: 0 }]));
  let supabaseCreated = 0, missingStorageKey = 0, badKeyShape = 0, ownerMismatch = 0;
  for (const r of fresh) {
    const bucket = perNamespace[r.namespace] ?? (perNamespace[r.namespace] = { r2: 0, supabase: 0 });
    if (r.provider === "supabase") { bucket.supabase++; supabaseCreated++; continue; }
    bucket.r2++;
    if (!r.storage_key) missingStorageKey++;
    else if (!IDS_ONLY_KEY.test(r.storage_key)) badKeyShape++;
    else {
      // The id inside the key must be the record's own owner (u/) or organization (o/). Consistency of key and record only:
      // authorization is proven separately by the cross-user denial evidence (r2-e2e-evidence.mjs), never by the key.
      const [scope, id] = r.storage_key.split("/");
      const expected = scope === "u" ? r.owner_user_id : r.organization_id;
      if (expected && expected !== id) ownerMismatch++;
      else if (!expected) ownerMismatch++;
    }
  }
  const uncovered = NAMESPACES.filter((ns) => perNamespace[ns].r2 === 0);
  return { since, newRows: fresh.length, perNamespace, supabaseCreated, missingStorageKey, badKeyShape, ownerMismatch, uncovered,
    ok: supabaseCreated + missingStorageKey + badKeyShape + ownerMismatch === 0, allFlowsCovered: uncovered.length === 0 };
}

const BASELINE_KINDS = ["missing", "sizeMismatch", "orphan", "orphanVariant", "retiredLeft", "stalePending"];

/**
 * Separates defects that were already known (an earlier run's fingerprints) from new ones. Nothing is hidden: counts stay as
 * reported and the known ones are listed as a number, so a baseline never makes a defect disappear. Needs complete
 * fingerprint lists (`--full-fingerprints`) on both sides; a truncated list cannot be compared and is refused.
 */
export function diffBaseline(result, baseline) {
  const out = { known: 0, newDefects: 0, resolved: 0, perKind: {} };
  for (const kind of BASELINE_KINDS) {
    const now = result.samples[kind] ?? [];
    if (now.length < (result.counts[kind] ?? 0)) throw new ReconcileOperatorError(`${kind} fingerprints are truncated; rerun with --full-fingerprints`);
    const before = baseline[kind] ?? [];
    if (!Array.isArray(before) || before.some((f) => !/^[0-9a-f]{10}$/.test(f))) throw new ReconcileOperatorError(`baseline ${kind} must be a list of 10-hex fingerprints`);
    const known = new Set(before), current = new Set(now);
    const added = now.filter((f) => !known.has(f)).length;
    const resolved = before.filter((f) => !current.has(f)).length;
    out.perKind[kind] = { known: now.length - added, newDefects: added, resolved };
    out.known += now.length - added; out.newDefects += added; out.resolved += resolved;
  }
  return out;
}

export function parseArgs(argv) {
  const out = { project: null, maxAgeHours: 48, json: false, allowOrphans: false, since: null, baseline: null, fullFingerprints: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") out.json = true;
    else if (arg === "--allow-orphans") out.allowOrphans = true;
    else if (arg === "--full-fingerprints") out.fullFingerprints = true;
    else if (arg === "--project" || arg === "--max-age-hours" || arg === "--since" || arg === "--baseline") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new ReconcileOperatorError(`${arg} needs a value`);
      if (arg === "--project") out.project = value;
      else if (arg === "--baseline") out.baseline = value;
      else if (arg === "--since") {
        if (!Number.isFinite(new Date(value).getTime())) throw new ReconcileOperatorError("--since must be an ISO timestamp");
        out.since = value;
      } else {
        out.maxAgeHours = Number(value);
        if (!Number.isFinite(out.maxAgeHours) || out.maxAgeHours < 1 || out.maxAgeHours > 720) throw new ReconcileOperatorError("--max-age-hours must be 1..720");
      }
    } else throw new ReconcileOperatorError(`Unknown option ${arg}`);
  }
  if (!out.project) throw new ReconcileOperatorError("Explicit --project is required");
  if (out.baseline) out.fullFingerprints = true;
  return out;
}

async function fetchRows(supabase) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("media_storage_locations")
      .select("namespace,object_key,provider,created_at,owner_user_id,organization_id,storage_key,size_bytes,verified_at,cleaned_at")
      .order("namespace").order("object_key").range(from, from + 999);
    if (error) throw new ReconcileOperatorError("Row query failed; confirm the storage_key migration (20261107090004) is applied in this environment");
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function listBucket(env) {
  const require = createRequire(new URL("../frontend/package.json", import.meta.url));
  const { S3Client, ListObjectsV2Command } = require("@aws-sdk/client-s3");
  const s3 = new S3Client({ region: "auto", forcePathStyle: true, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY }, maxAttempts: 3 });
  const objects = [];
  let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: env.R2_PRIVATE_BUCKET, ContinuationToken: token, MaxKeys: 1000 }));
    for (const o of page.Contents ?? []) objects.push({ key: o.Key, size: o.Size, lastModified: o.LastModified });
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const { readMaintenanceEnv } = await import("../frontend/src/lib/env/media-maintenance.mjs");
  const env = readMaintenanceEnv();
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_PRIVATE_BUCKET) throw new ReconcileOperatorError("R2 settings are required");
  if (/backup/i.test(env.R2_PRIVATE_BUCKET)) throw new ReconcileOperatorError("R2_PRIVATE_BUCKET names a backup bucket; refusing");
  const host = new URL(env.SUPABASE_URL).hostname;
  const project = ["localhost", "127.0.0.1"].includes(host) ? "local" : host.split(".")[0];
  if (options.project !== project) throw new ReconcileOperatorError("Requested project does not match the configured environment");
  const require = createRequire(new URL("../frontend/package.json", import.meta.url));
  const supabase = require("@supabase/supabase-js").createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const [rows, objects] = await Promise.all([fetchRows(supabase), listBucket(env)]);
  const result = reconcile(rows.filter((r) => r.provider === "r2"), objects,
    { maxAgeHours: options.maxAgeHours, sampleLimit: options.fullFingerprints ? Infinity : 10 });
  const window = options.since ? windowReport(rows, options.since) : undefined;
  const baseline = options.baseline ? diffBaseline(result, JSON.parse((await import("node:fs")).readFileSync(options.baseline, "utf8")).samples ?? {}) : undefined;
  console.log(JSON.stringify({ project, readOnly: true, bucket: env.R2_PRIVATE_BUCKET, ...result, ...(baseline ? { baseline } : {}), ...(window ? { window } : {}) }, null, options.json ? 0 : 2));
  const orphans = result.counts.orphan + result.counts.orphanVariant;
  // With a baseline the run fails only on defects the baseline did not already list; without one, every defect fails as before.
  const defectsFail = baseline ? baseline.newDefects > 0 : (!result.ok || (!options.allowOrphans && orphans > 0));
  if (defectsFail || (window && !(window.ok && window.allFlowsCovered))) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof ReconcileOperatorError ? error.message : "Reconciliation failed; verify the environment, credentials and permissions. Nothing was changed.");
    process.exitCode = 1;
  });
}
