// Object-level approval manifest for the clean-media reset. Pure logic plus a thin database reader; deletes nothing.
//
// The owner approves THIS document: for every Storage object, metadata row and legacy location it records the exact bucket,
// object key, storage identity (id, size, eTag, updated_at), the ownership/reference classification and the compliance
// retention decision. The approval hash is the SHA-256 of the complete canonical entries (sorted, fixed field order), so
// a replaced object with the same name, a changed row state or a new upload changes the hash even when the counts do not.
// The file contains keys, so it is private: it is written once (exclusive create, read-only) and only counts and hashes
// are ever printed.
import { createHash } from "node:crypto";
import fs from "node:fs";
import { BUCKETS, ResetOperatorError } from "./media-reset.mjs";

export const MANIFEST_VERSION = 1;
const PAGE = 200;
const NAMESPACE_OF = {
  avatars: "avatar", "professional-portfolio": "portfolio", "professional-certificates": "certificate", "product-images": "product",
  "organization-images": "organization", "purchase-request-images": "request", "business-verification-documents": "verification",
};
const DECISIONS = new Set(["delete", "retain"]);
const OBJECT_REASONS = { delete: ["orphan-object", "legacy-row"], retain: ["unreferenced-verification-object", "submitted-verification-evidence", "r2-located"] };
const ROW_REASONS = { delete: ["row-without-object"], retain: ["submitted-verification-evidence"] };

const sha = (text) => createHash("sha256").update(text).digest("hex");
const byteCompare = (a, b) => (Buffer.compare(Buffer.from(a), Buffer.from(b)));

/** Canonical form of one entry: fixed field order, so equal facts always serialize to equal text. */
export function canonicalEntry(entry) {
  switch (entry.t) {
    case "object":
      return { t: "object", bucket: entry.bucket, name: entry.name, id: entry.id, size: entry.size ?? null, etag: entry.etag ?? null,
        updatedAt: entry.updatedAt ?? null, namespace: entry.namespace, rowId: entry.rowId ?? null, rowState: entry.rowState ?? null,
        referenced: Boolean(entry.referenced), submitted: Boolean(entry.submitted), r2: Boolean(entry.r2), decision: entry.decision, reason: entry.reason };
    case "row":
      return { t: "row", namespace: entry.namespace, bucket: entry.bucket, name: entry.name, rowId: entry.rowId, rowState: entry.rowState ?? null,
        referenced: Boolean(entry.referenced), submitted: Boolean(entry.submitted), decision: entry.decision, reason: entry.reason };
    case "location":
      return { t: "location", namespace: entry.namespace, name: entry.name, decision: entry.decision, reason: entry.reason };
    default:
      throw new ResetOperatorError("Manifest entry of unknown type");
  }
}
const typeRank = { object: 0, row: 1, location: 2 };
/** Deterministic order: type, bucket/namespace, then key in byte order. */
export function sortEntries(entries) {
  return [...entries].sort((a, b) => (typeRank[a.t] - typeRank[b.t]) || byteCompare(a.bucket ?? a.namespace, b.bucket ?? b.namespace) || byteCompare(a.name, b.name));
}
export const entryKey = (e) => `${e.t}\u0000${e.bucket ?? e.namespace}\u0000${e.name}`;
export const entriesSha256 = (entries) => sha(JSON.stringify({ version: MANIFEST_VERSION, entries: sortEntries(entries.map(canonicalEntry)) }));

/** Counts only: safe to print. */
export function summarize(manifest) {
  const byBucket = {}, retained = {};
  let rows = 0, locations = 0, deleteRows = 0, deleteLocations = 0;
  for (const e of manifest.entries) {
    if (e.t === "object") {
      byBucket[e.bucket] ??= { total: 0, delete: 0, retain: 0 };
      byBucket[e.bucket].total++; byBucket[e.bucket][e.decision]++;
      if (e.decision === "retain") retained[e.reason] = (retained[e.reason] ?? 0) + 1;
    } else if (e.t === "row") { rows++; if (e.decision === "delete") deleteRows++; else retained[e.reason] = (retained[e.reason] ?? 0) + 1; }
    else { locations++; if (e.decision === "delete") deleteLocations++; }
  }
  return { project: manifest.project, version: manifest.version, entries: manifest.entries.length, sha256: entriesSha256(manifest.entries), objects: byBucket,
    rowsWithoutObject: rows, rowsToRetire: deleteRows, staleLocations: locations, locationsToDrop: deleteLocations, retainedByReason: retained };
}

/** Structural and compliance invariants. Throws on anything that could let a protected entry be selected. */
export function validateManifest(manifest) {
  if (!manifest || manifest.version !== MANIFEST_VERSION || typeof manifest.project !== "string" || !manifest.project || !Array.isArray(manifest.entries)) {
    throw new ResetOperatorError("The manifest is malformed");
  }
  const seen = new Set();
  for (const raw of manifest.entries) {
    const e = canonicalEntry(raw);
    if (JSON.stringify(e) !== JSON.stringify(raw)) throw new ResetOperatorError("The manifest has a non-canonical entry");
    if (!DECISIONS.has(e.decision)) throw new ResetOperatorError("The manifest has an unknown decision");
    const key = entryKey(e);
    if (seen.has(key)) throw new ResetOperatorError("The manifest has a duplicate entry");
    seen.add(key);
    if (e.t === "object") {
      if (!BUCKETS.includes(e.bucket) || NAMESPACE_OF[e.bucket] !== e.namespace || !e.id || !e.name) throw new ResetOperatorError("The manifest has an invalid object entry");
      if (!OBJECT_REASONS[e.decision].includes(e.reason)) throw new ResetOperatorError("The manifest has an inconsistent object decision");
      // Compliance: a verification object is deleted only when it belongs to a draft row. No row, or a submitted row, is always retained.
      if (e.bucket === "business-verification-documents" && e.decision === "delete" && (!e.rowId || e.submitted || e.reason !== "legacy-row")) throw new ResetOperatorError("The manifest would delete protected verification evidence");
      if ((e.submitted || e.reason === "submitted-verification-evidence") && !(e.submitted && e.decision === "retain" && e.reason === "submitted-verification-evidence")) throw new ResetOperatorError("The manifest would delete protected verification evidence");
      if ((e.r2 || e.reason === "r2-located") && !(e.r2 && e.decision === "retain" && (e.reason === "r2-located" || e.submitted || e.reason === "unreferenced-verification-object"))) throw new ResetOperatorError("The manifest would delete an R2-located object");
    } else if (e.t === "row") {
      if (!BUCKETS.includes(e.bucket) || NAMESPACE_OF[e.bucket] !== e.namespace || !e.rowId) throw new ResetOperatorError("The manifest has an invalid row entry");
      if (!ROW_REASONS[e.decision].includes(e.reason)) throw new ResetOperatorError("The manifest has an inconsistent row decision");
      if ((e.submitted || e.reason === "submitted-verification-evidence") && !(e.submitted && e.decision === "retain" && e.reason === "submitted-verification-evidence")) throw new ResetOperatorError("The manifest would delete protected verification evidence");
      if (e.submitted && e.namespace !== "verification") throw new ResetOperatorError("The manifest has an invalid row entry");
    } else {
      if (!Object.values(NAMESPACE_OF).includes(e.namespace) || e.decision !== "delete" || e.reason !== "stale-supabase-location") throw new ResetOperatorError("The manifest has an invalid location entry");
    }
  }
  const canonical = sortEntries(manifest.entries);
  if (JSON.stringify(canonical) !== JSON.stringify(manifest.entries)) throw new ResetOperatorError("The manifest entries are not in canonical order");
  return manifest;
}

/** Read a manifest from disk. The hash is RECOMPUTED from the entries, never trusted from the header. */
export function loadManifest(path) {
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path, "utf8")); } catch { throw new ResetOperatorError("The manifest file cannot be read or is not valid JSON"); }
  validateManifest(manifest);
  const sha256 = entriesSha256(manifest.entries);
  if (manifest.sha256 !== sha256) throw new ResetOperatorError("The manifest hash does not match its entries (the file was altered)");
  return manifest;
}

/** Write once: exclusive create, then read-only. An existing file is never overwritten. */
export function writeManifest(path, manifest) {
  validateManifest(manifest);
  const body = { ...manifest, sha256: entriesSha256(manifest.entries) };
  fs.writeFileSync(path, `${JSON.stringify(body)}\n`, { flag: "wx", mode: 0o400 });
  fs.chmodSync(path, 0o400);
  return body;
}

/**
 * Compare an approved manifest with a live one. `started` is the set of entry keys the journal says were already begun by
 * this run (as namespace + key identities); those are exempt on both sides because the database re-validated them under lock when they were retired.
 * Anything else that differs (a new upload, a replaced object, a changed state, a missing entry) makes the approval stale.
 */
export const identityOf = (e) => `${e.namespace}\u0000${e.name}`;
export function diffManifests(approved, live, started = new Set()) {
  // A begun entry may legitimately change shape (its object disappears, its row becomes a tombstone): exempt by namespace + key.
  const index = (entries) => new Map(entries.filter((e) => !started.has(identityOf(e))).map((e) => [entryKey(e), JSON.stringify(canonicalEntry(e))]));
  const a = index(approved), b = index(live);
  let added = 0, removed = 0, changed = 0;
  for (const [key, value] of b) { if (!a.has(key)) added++; else if (a.get(key) !== value) changed++; }
  for (const key of a.keys()) if (!b.has(key)) removed++;
  return { stale: added + removed + changed > 0, added, removed, changed };
}

// ---------------------------------------------------------------------------------------------------------------
// Live reader. io = { rpc(name, args) -> rows[] }. Fails closed on truncation, duplicates, disorder and concurrent change.
// ---------------------------------------------------------------------------------------------------------------
async function pageAll(io, name, argsFor, advance, limit = PAGE) {
  const rows = [];
  let cursor = null;
  for (let guard = 0; guard < 100000; guard++) {
    const page = await io.rpc(name, { ...argsFor(cursor), p_limit: limit });
    if (!Array.isArray(page)) throw new ResetOperatorError("Manifest query returned an unexpected shape");
    if (page.length === 0) return rows;
    if (page.length > limit) throw new ResetOperatorError("Manifest query ignored its page size");
    const next = advance(page[page.length - 1]);
    if (cursor !== null && byteCompare(next, cursor) <= 0) throw new ResetOperatorError("Manifest pagination did not advance");
    rows.push(...page);
    cursor = next;
  }
  throw new ResetOperatorError("Manifest pagination did not finish");
}
const sameCounts = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export async function collectManifest(io, project) {
  const countsBefore = await io.rpc("media_reset_manifest_counts", {});
  const entries = [];
  const perBucket = {};
  for (const bucket of BUCKETS) {
    const rows = await pageAll(io, "media_reset_manifest_objects", (after) => ({ p_bucket: bucket, p_after: after }), (r) => r.name);
    perBucket[bucket] = rows.length;
    for (const r of rows) {
      if (r.bucket !== bucket) throw new ResetOperatorError("Manifest returned an object of another bucket");
      entries.push(canonicalEntry({ t: "object", bucket, name: r.name, id: r.object_id, size: r.size_bytes == null ? null : Number(r.size_bytes), etag: r.etag,
        updatedAt: r.updated_at, namespace: r.namespace, rowId: r.row_id, rowState: r.row_state, referenced: r.referenced, submitted: r.submitted, r2: r.r2, decision: r.decision, reason: r.reason }));
    }
  }
  const cursorOf = (r) => `${r.namespace}\u0000${r.object_key}`;
  const rowArgs = (after) => (after ? { p_after_namespace: after.split("\u0000")[0], p_after_key: after.split("\u0000")[1] } : { p_after_namespace: null, p_after_key: null });
  const rows = await pageAll(io, "media_reset_manifest_rows", rowArgs, cursorOf);
  for (const r of rows) entries.push(canonicalEntry({ t: "row", namespace: r.namespace, bucket: r.bucket, name: r.object_key, rowId: r.row_id, rowState: r.row_state,
    referenced: r.referenced, submitted: r.submitted, decision: r.decision, reason: r.reason }));
  const locs = await pageAll(io, "media_reset_manifest_locations", rowArgs, cursorOf);
  for (const l of locs) entries.push(canonicalEntry({ t: "location", namespace: l.namespace, name: l.object_key, decision: l.decision, reason: l.reason }));

  // Truncated or racing reads fail closed: totals must match the database's own counts, before and after collection.
  const countsAfter = await io.rpc("media_reset_manifest_counts", {});
  if (!sameCounts(countsBefore, countsAfter)) throw new ResetOperatorError("The inventory changed while it was being read; take the manifest again");
  for (const bucket of BUCKETS) {
    if (Number(countsAfter?.objects?.[bucket]) !== perBucket[bucket]) throw new ResetOperatorError("The manifest is incomplete for a bucket (truncated or changed read)");
  }
  if (Number(countsAfter.rows) !== rows.length) throw new ResetOperatorError("The manifest is incomplete for rows (truncated or changed read)");
  if (Number(countsAfter.locations) !== locs.length) throw new ResetOperatorError("The manifest is incomplete for locations (truncated or changed read)");
  const submitted = entries.filter((e) => e.reason === "submitted-verification-evidence").length;
  if (Number(countsAfter.submitted_verification_rows) !== submitted) {
    throw new ResetOperatorError("Retained verification evidence is not fully covered by the manifest (every submitted document must be listed as retained)");
  }
  const manifest = { version: MANIFEST_VERSION, project, createdAt: new Date().toISOString(), entries: sortEntries(entries) };
  validateManifest(manifest);
  return { ...manifest, sha256: entriesSha256(manifest.entries) };
}
