#!/usr/bin/env node
// Clean-media reset: the guarded EXECUTION path. DISABLED BY DEFAULT; `execute` is refused unless every gate holds.
//
// Owner decision 2026-11-01: legacy application media in Supabase Storage is removed, never migrated; R2 is the only media store;
// accounts, organizations, products, portfolio projects and all non-media data stay. Submitted business-verification documents are
// compliance evidence: they are RETAINED, are not selectable by this tool, and are refused again by the database under row locks.
//
//   node scripts/media-reset-execute.mjs manifest --project <ref|local> --out manifest.json     (read-only; writes once, 0400)
//   node scripts/media-reset-execute.mjs summary  --manifest manifest.json                      (counts + sha256; no keys)
//   node scripts/media-reset-execute.mjs verify   --project <ref|local>                         (read-only post-condition)
//   MEDIA_RESET_EXECUTE_ENABLED=true node scripts/media-reset-execute.mjs execute --project <ref|local> --manifest manifest.json \
//        --approved-sha256 <hash the owner approved> --confirm "delete legacy media in <project>" \
//        --before before.json --journal reset-journal.jsonl
//
// Approval is of the OBJECT-LEVEL manifest (media-reset-manifest.mjs): bucket, key, storage identity, ownership/reference class and
// retention decision of every entry, hashed whole. Gates for `execute` (all required): the enable variable; the manifest file whose
// recomputed hash equals the approved hash; a LIVE manifest that still matches it (no new upload, replaced object or status change;
// otherwise the approval is stale and nothing runs); the typed confirmation; a before-snapshot of the same project whose bucket counts
// equal the manifest; a hash-chained journal belonging to this project and manifest. Every batch is then revalidated by the database
// under row locks (identity and protection) before anything is retired, and Storage objects are removed only after that.
// Success is reported only if media_reset_verify says no broken pointer, legacy row, object or location remains.
// Output and journal carry counts and hashes only, never an object name, owner or id.
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { BUCKETS, ResetOperatorError } from "./media-reset.mjs";
import { collectManifest, diffManifests, entriesSha256, identityOf, loadManifest, summarize, writeManifest } from "./media-reset-manifest.mjs";

export const ENABLE_ENV = "MEDIA_RESET_EXECUTE_ENABLED";
export const confirmationPhrase = (project) => `delete legacy media in ${project}`;
const sha = (text) => createHash("sha256").update(text).digest("hex");
const BATCH = 100;

/** Every gate, in one place. Throws a ResetOperatorError naming the first one that does not hold. */
export function assertExecutable({ enabled, project, approvedSha, manifest, diff, confirm, before, journalPath }) {
  if (enabled !== "true") throw new ResetOperatorError(`Media reset execution is disabled (set ${ENABLE_ENV}=true for an approved run)`);
  if (!project) throw new ResetOperatorError("--project is required");
  if (!manifest || manifest.project !== project) throw new ResetOperatorError("The manifest belongs to a different project");
  if (!/^[0-9a-f]{64}$/.test(approvedSha ?? "")) throw new ResetOperatorError("--approved-sha256 must be the manifest hash the owner approved");
  if (approvedSha !== entriesSha256(manifest.entries)) throw new ResetOperatorError("The manifest does not match the approved hash");
  if (!diff) throw new ResetOperatorError("A comparison with the live inventory is required to prove the approval is current");
  if (diff.stale) throw new ResetOperatorError("The inventory changed since it was approved (an upload, replacement or status change); take and approve a fresh manifest");
  if (confirm !== confirmationPhrase(project)) throw new ResetOperatorError(`Type the confirmation exactly: "${confirmationPhrase(project)}"`);
  assertBeforeSnapshot(before, manifest);
  if (!journalPath) throw new ResetOperatorError("--journal is required: every batch is recorded for audit and resume");
}

/** The before-snapshot must belong to this project and agree with the approved manifest's object counts. */
export function assertBeforeSnapshot(before, manifest) {
  if (!before || typeof before !== "object" || !before.buckets) throw new ResetOperatorError("--before must be a storage snapshot taken before the run");
  if (before.project !== manifest.project) throw new ResetOperatorError("The before-snapshot belongs to a different project");
  for (const bucket of BUCKETS) {
    const inManifest = manifest.entries.filter((e) => e.t === "object" && e.bucket === bucket).length;
    if (before.buckets[bucket] !== inManifest) throw new ResetOperatorError(`The before-snapshot disagrees with the approved manifest for ${bucket}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Journal: append-only, hash-chained, bound to one project and one manifest. Any tampering or damage is refused, never skipped.
// ---------------------------------------------------------------------------------------------------------------
const GENESIS = "0".repeat(64);
const lineHash = (prev, body) => sha(`${prev}\n${JSON.stringify(body)}`);

export function readJournal(path, { project, manifestSha256 } = {}) {
  if (!path || !fs.existsSync(path)) return [];
  const lines = fs.readFileSync(path, "utf8").split("\n").filter(Boolean);
  let prev = GENESIS;
  const entries = lines.map((line, index) => {
    let parsed;
    try { parsed = JSON.parse(line); } catch { throw new ResetOperatorError("The journal is damaged (a line is not valid JSON)"); }
    const { hash, prev: linkedTo, seq, ...rest } = parsed;
    if (seq !== index || linkedTo !== prev || hash !== lineHash(prev, { seq, ...rest })) throw new ResetOperatorError("The journal failed its integrity check (altered, truncated or reordered)");
    prev = hash;
    return parsed;
  });
  if (entries.length) {
    const head = entries[0];
    if (head.event !== "start") throw new ResetOperatorError("The journal has no start record");
    if (project !== undefined && head.project !== project) throw new ResetOperatorError("The journal belongs to a different project");
    if (manifestSha256 !== undefined && head.manifestSha256 !== manifestSha256) throw new ResetOperatorError("The journal belongs to a different manifest");
  }
  return entries;
}

export function journalWriter(path, existing) {
  let prev = existing.length ? existing[existing.length - 1].hash : GENESIS;
  let seq = existing.length;
  return (entry) => {
    const body = { seq, at: new Date().toISOString(), ...entry };
    const { seq: _s, ...rest } = body;
    const hash = lineHash(prev, { seq, ...rest });
    fs.appendFileSync(path, `${JSON.stringify({ ...body, prev, hash })}\n`);
    prev = hash; seq += 1;
  };
}

/** Plan the batches from the approved manifest: objects then rows per namespace, then stale locations. Keys stay in memory. */
export function planBatches(manifest, batchSize = BATCH) {
  const batches = [];
  const group = (kind, namespace, items) => {
    for (let i = 0; i < items.length; i += batchSize) {
      const slice = items.slice(i, i + batchSize);
      batches.push({ kind, namespace, items: slice, sha256: sha(`${kind}\n${namespace}\n${slice.map((s) => s.key).join("\n")}`) });
    }
  };
  for (const namespace of ["avatar", "portfolio", "certificate", "product", "organization", "request", "verification"]) {
    group("object", namespace, manifest.entries.filter((e) => e.t === "object" && e.namespace === namespace && e.decision === "delete").map((e) => ({ key: e.name, bucket: e.bucket, object_id: e.id, etag: e.etag, entry: e })));
    group("row", namespace, manifest.entries.filter((e) => e.t === "row" && e.namespace === namespace && e.decision === "delete").map((e) => ({ key: e.name, bucket: e.bucket, entry: e })));
  }
  group("location", "all", manifest.entries.filter((e) => e.t === "location" && e.decision === "delete").map((e) => ({ key: e.name, namespace: e.namespace, entry: e })));
  return batches;
}

/**
 * io = { rpc(name, args), removeObjects(bucket, names) }
 * Resumable (a batch journaled as done is skipped; a begun batch is redone, every step being idempotent), fail-stop, and every
 * batch is revalidated by the database (identity and protection under row locks) before any state changes.
 */
export async function executeReset(io, manifest, { journalPath, batchSize = BATCH, limit = Infinity }) {
  const existing = readJournal(journalPath, { project: manifest.project, manifestSha256: entriesSha256(manifest.entries) });
  const write = journalWriter(journalPath, existing);
  write(existing.length === 0
    ? { event: "start", project: manifest.project, manifestSha256: entriesSha256(manifest.entries), entries: manifest.entries.length }
    : { event: "resume" });
  const done = new Set(existing.filter((e) => e.event === "done").map((e) => e.batchSha256));
  let retired = 0, removed = 0, skipped = 0, dropped = 0, failed = 0, stopped = false;

  const fail = (batch, reason) => { failed++; write({ event: "fail", kind: batch.kind, namespace: batch.namespace, batchSha256: batch.sha256, count: batch.items.length, reason }); };
  for (const batch of planBatches(manifest, batchSize)) {
    if (done.has(batch.sha256)) { skipped += batch.items.length; continue; }
    if (retired + dropped + batch.items.length > limit) { stopped = true; break; }
    write({ event: "begin", kind: batch.kind, namespace: batch.namespace, batchSha256: batch.sha256, count: batch.items.length });
    try {
      if (batch.kind === "location") {
        const n = await io.rpc("media_reset_drop_locations", { p_items: batch.items.map((i) => ({ namespace: i.namespace, key: i.key })) });
        dropped += Number(n) || 0;
      } else {
        // 1. The database revalidates identity and protection under row locks, clears every pointer and tombstones. All or nothing.
        const items = batch.items.map((i) => ({ kind: batch.kind, key: i.key, object_id: i.object_id ?? null, etag: i.etag ?? null }));
        await io.rpc("media_reset_retire", { p_namespace: batch.namespace, p_items: items });
        retired += batch.items.length;
        if (batch.kind === "object") {
          // 2. Only now are the Storage objects removed (a removal of an absent object is a no-op), then each is confirmed gone.
          await io.removeObjects(batch.items[0].bucket, batch.items.map((i) => i.key));
          for (const item of batch.items) {
            if (!(await io.rpc("media_reset_storage_removed", { p_namespace: batch.namespace, p_key: item.key }))) { fail(batch, "object still present after removal"); return finish(false); }
          }
          removed += batch.items.length;
        }
      }
      write({ event: "done", kind: batch.kind, namespace: batch.namespace, batchSha256: batch.sha256, count: batch.items.length });
    } catch (error) {
      fail(batch, `refused or failed (${error?.code ?? "error"})`);
      return finish(false);
    }
  }

  function finish(ok) {
    write({ event: "finish", ok, retired, removed, skipped, dropped, failed, stopped });
    return { ok, retired, removed, skipped, dropped, failed, stopped, verified: null };
  }
  if (failed || stopped) return finish(!failed);

  // 3. Delete the tombstones and the legacy locations of everything confirmed gone, then prove the post-condition.
  for (let guard = 0; guard < 10000; guard++) {
    const n = Number(await io.rpc("media_reset_finalize", { p_limit: 200 }));
    if (!n) break;
  }
  const verified = await io.rpc("media_reset_verify", {});
  const result = finish(Boolean(verified?.ok));
  result.verified = verified;
  write({ event: "verify", ok: Boolean(verified?.ok) });
  if (!verified?.ok) result.ok = false;
  return result;
}

/** Identities (namespace + key) that a journal says were already begun, so a resumed run exempts them from the staleness diff. */
export function startedKeys(manifest, journalEntries, batchSize = BATCH) {
  const begun = new Set(journalEntries.filter((e) => e.event === "begin").map((e) => e.batchSha256));
  const keys = new Set();
  for (const batch of planBatches(manifest, batchSize)) if (begun.has(batch.sha256)) for (const item of batch.items) keys.add(identityOf(item.entry));
  return keys;
}

function rpcIo(supabase) {
  return {
    async rpc(name, args) {
      const { data, error } = await supabase.rpc(name, args);
      if (error) { const e = new Error("rpc failed"); e.code = error.code; throw e; }
      return data;
    },
    async removeObjects(bucket, names) {
      const { error } = await supabase.storage.from(bucket).remove(names);
      if (error) throw new Error("remove failed");
    },
  };
}

function connect(env, project) {
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ResetOperatorError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const host = new URL(url).hostname;
  const configured = ["localhost", "127.0.0.1"].includes(host) ? "local" : host.split(".")[0];
  if (project !== configured) throw new ResetOperatorError("Requested project does not match the configured environment");
  const require = createRequire(new URL("../frontend/package.json", import.meta.url));
  const supabase = require("@supabase/supabase-js").createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return { configured, io: rpcIo(supabase) };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const [command, ...rest] = argv;
  if (!["manifest", "summary", "verify", "execute"].includes(command)) throw new ResetOperatorError("Usage: media-reset-execute.mjs manifest|summary|verify|execute ...  (execute is disabled unless approved)");
  const flag = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
  if (command === "summary") {
    if (!flag("--manifest")) throw new ResetOperatorError("--manifest is required");
    console.log(JSON.stringify({ readOnly: true, ...summarize(loadManifest(flag("--manifest"))) }));
    return;
  }
  if (command === "execute" && env[ENABLE_ENV] !== "true") assertExecutable({ enabled: env[ENABLE_ENV] }); // refused before anything is read
  const project = flag("--project");
  const { configured, io } = connect(env, project);
  if (command === "manifest") {
    if (!flag("--out")) throw new ResetOperatorError("--out is required");
    const body = writeManifest(flag("--out"), await collectManifest(io, configured));
    console.log(JSON.stringify({ readOnly: true, written: true, ...summarize(body) }));
    return;
  }
  if (command === "verify") {
    const verified = await io.rpc("media_reset_verify", {});
    console.log(JSON.stringify({ project: configured, readOnly: true, ...verified }));
    if (!verified?.ok) process.exitCode = 1;
    return;
  }
  // execute: every gate is checked on a fresh live manifest BEFORE anything is changed.
  if (!flag("--manifest")) throw new ResetOperatorError("--manifest is required");
  const manifest = loadManifest(flag("--manifest"));
  const journalPath = flag("--journal");
  const journal = readJournal(journalPath, { project: configured, manifestSha256: entriesSha256(manifest.entries) });
  const live = await collectManifest(io, configured);
  const diff = diffManifests(manifest.entries, live.entries, startedKeys(manifest, journal));
  const before = flag("--before") ? JSON.parse(fs.readFileSync(flag("--before"), "utf8")) : null;
  assertExecutable({ enabled: env[ENABLE_ENV], project: configured, approvedSha: flag("--approved-sha256"), manifest, diff, confirm: flag("--confirm"), before, journalPath });
  const limit = flag("--limit") ? Number(flag("--limit")) : Infinity;
  if (!(limit > 0)) throw new ResetOperatorError("--limit must be a positive number");
  const result = await executeReset(io, manifest, { journalPath, limit });
  console.log(JSON.stringify({ project: configured, ok: result.ok, retired: result.retired, removed: result.removed, skipped: result.skipped, dropped: result.dropped,
    failed: result.failed, stopped: result.stopped, verified: result.verified }));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof ResetOperatorError ? error.message : "Media reset failed; verify the environment. See the journal for what was removed.");
    process.exitCode = 1;
  });
}
