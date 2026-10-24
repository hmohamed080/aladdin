import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { readMaintenanceEnv } from "../frontend/src/lib/env/media-maintenance.mjs";
import { readBoundedBody, verifyMediaBytes } from "../frontend/src/server/storage/content-validation.mjs";
import { verifyImageWithSharp } from "../frontend/src/server/storage/image-processing/sharp-verify.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const NAMESPACES = ["avatar", "certificate", "portfolio", "product", "organization"];
const BUCKETS = { avatar: "avatars", portfolio: "professional-portfolio", certificate: "professional-certificates",
  product: "product-images", organization: "organization-images" };
const STAGING_PROJECT = "kkpkgjrweysgvhvkhzun";
/** Supabase response bytes per copied object besides the object itself (inventory row, metadata
 * lookup, signed URL, switch RPC, headers). Deliberately generous so the egress estimate errs high. */
export const OVERHEAD_BYTES_PER_OBJECT = 4096;
const MAX_SAFETY_FRACTION = 0.9;

/** Errors whose message is written by this tool and is safe to print (no keys, URLs or secrets). */
export class OperatorError extends Error {}
/** Supabase answered HTTP 402: the project is over quota and every further call fails. Abort the run. */
export class QuotaExceeded extends OperatorError {
  constructor() { super("Supabase returned HTTP 402 (quota exceeded). Run aborted; nothing further was downloaded."); }
}
/** A step that cannot be journaled must not run unrecorded: abort, the next run re-verifies. */
export class JournalWriteFailed extends OperatorError {
  constructor() { super("Journal write failed; run aborted. Rerun the same command to resume."); }
}

// ---------- arguments ----------

const COMMANDS = ["plan", "migrate", "rollback", "rehash", "cleanup"];
const VALUE_OPTIONS = ["--project", "--namespace", "--batch-size", "--max-batches", "--max-bytes",
  "--remaining-egress-bytes", "--egress-safety-fraction", "--journal", "--key", "--limit"];
const FLAG_OPTIONS = ["--execute", "--from-ledger", "--retry-rolled-back", "--json", "--help"];

/** Decimal byte sizes: 20000000, 20MB, 1.5GB, 512kB. */
export function parseBytes(text, name) {
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(String(text ?? "").trim());
  const scale = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9 }[(match?.[2] ?? "b").toLowerCase()];
  const bytes = match ? Math.floor(Number(match[1]) * scale) : NaN;
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new OperatorError(`${name} must be a positive byte size such as 20000000 or 20MB`);
  return bytes;
}

function parseInteger(text, name, min, max) {
  const value = Number(text);
  if (!Number.isInteger(value) || value < min || value > max) throw new OperatorError(`${name} must be an integer ${min}..${max}`);
  return value;
}

export function parseArgs(argv) {
  if (argv.length === 0 || argv.includes("--help")) return { command: "help" };
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command)) throw new OperatorError(`First argument must be one of: ${COMMANDS.join(", ")}`);
  const raw = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (FLAG_OPTIONS.includes(arg)) { raw[arg] = true; continue; }
    if (!VALUE_OPTIONS.includes(arg)) throw new OperatorError(`Unknown option ${arg}`);
    const value = rest[++i];
    if (value === undefined || value.startsWith("--")) throw new OperatorError(`${arg} needs a value`);
    raw[arg] = arg === "--namespace" && raw[arg] ? `${raw[arg]},${value}` : value;
  }
  if (!raw["--project"]) throw new OperatorError("Explicit --project is required");
  const namespaces = raw["--namespace"] ? [...new Set(raw["--namespace"].split(",").map((ns) => ns.trim()).filter(Boolean))] : null;
  for (const ns of namespaces ?? []) if (!NAMESPACES.includes(ns)) throw new OperatorError(`Unknown namespace ${ns}; use ${NAMESPACES.join(", ")}`);
  const fraction = raw["--egress-safety-fraction"] === undefined ? 0.5 : Number(raw["--egress-safety-fraction"]);
  if (!(fraction > 0 && fraction <= MAX_SAFETY_FRACTION)) throw new OperatorError(`--egress-safety-fraction must be in (0, ${MAX_SAFETY_FRACTION}]`);
  const key = raw["--key"] ?? null;
  if (key && !NAMESPACES.some((ns) => key.startsWith(`${ns}/`) && key.length > ns.length + 1)) throw new OperatorError("--key must look like <namespace>/<object key>");
  const options = {
    command, project: raw["--project"], execute: Boolean(raw["--execute"]), json: Boolean(raw["--json"]),
    fromLedger: Boolean(raw["--from-ledger"]), retryRolledBack: Boolean(raw["--retry-rolled-back"]),
    namespaces, key, journal: raw["--journal"] ?? null,
    batchSize: raw["--batch-size"] === undefined ? 25 : parseInteger(raw["--batch-size"], "--batch-size", 1, 100),
    maxBatches: raw["--max-batches"] === undefined ? null : parseInteger(raw["--max-batches"], "--max-batches", 1, 10_000),
    maxBytes: raw["--max-bytes"] === undefined ? null : parseBytes(raw["--max-bytes"], "--max-bytes"),
    remainingEgressBytes: raw["--remaining-egress-bytes"] === undefined ? null : parseBytes(raw["--remaining-egress-bytes"], "--remaining-egress-bytes"),
    egressSafetyFraction: fraction,
    limit: raw["--limit"] === undefined ? 25 : parseInteger(raw["--limit"], "--limit", 1, 100),
  };
  if (command === "migrate" && options.execute) {
    if (!namespaces) throw new OperatorError("migrate --execute requires an explicit --namespace list (cheap namespaces first)");
    if (!options.maxBytes) throw new OperatorError("migrate --execute requires a hard --max-bytes budget");
  }
  if ((options.execute && ["migrate", "rollback"].includes(command)) || command === "rehash") {
    if (!options.journal) throw new OperatorError(`${command} requires --journal <path> (append-only JSON-lines run journal)`);
  }
  if (command === "rollback" && !options.fromLedger && !options.journal) throw new OperatorError("rollback needs --journal, or --from-ledger with --namespace");
  if (command === "rollback" && options.fromLedger && !namespaces) throw new OperatorError("rollback --from-ledger requires --namespace");
  return options;
}

/** Refuses before any download when the planned egress is not clearly inside the remaining quota. */
export function assertEgressGuard({ plannedBytes, objects, remainingEgressBytes, egressSafetyFraction, required }) {
  const estimate = plannedBytes + objects * OVERHEAD_BYTES_PER_OBJECT;
  if (remainingEgressBytes == null) {
    if (required) throw new OperatorError("--remaining-egress-bytes is required: read the remaining Supabase egress for this billing cycle on the Usage page and pass it explicitly");
    return { estimate, allowance: null };
  }
  const allowance = Math.floor(remainingEgressBytes * egressSafetyFraction);
  if (estimate > allowance) {
    throw new OperatorError(`Planned Supabase egress ${formatBytes(estimate)} exceeds ${Math.round(egressSafetyFraction * 100)}% of the remaining ${formatBytes(remainingEgressBytes)} (${formatBytes(allowance)}). Lower --max-bytes or wait for the cycle reset.`);
  }
  return { estimate, allowance };
}

export function formatBytes(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(3)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(2)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} kB`;
  return `${bytes} B`;
}

// ---------- journal ----------

/** Parses a JSON-lines journal. A torn line (crash mid-write) is skipped: every step is re-verified on resume. */
export function parseJournal(text) {
  const entries = []; let torn = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { torn++; }
  }
  return { entries, torn };
}

const readJournalState = (path) => (path && fs.existsSync(path) ? foldJournal(parseJournal(fs.readFileSync(path, "utf8")).entries) : new Map());

/** Append-only local journal. Each line is fsynced before the next step runs. One writer at a time. */
export function openJournal(path) {
  const lockPath = `${path}.lock`;
  try { fs.writeFileSync(lockPath, String(process.pid), { flag: "wx", mode: 0o600 }); }
  catch { throw new OperatorError(`Journal is locked by another run (${lockPath}). Remove the lock only if no other run is active.`); }
  const text = fs.existsSync(path) ? fs.readFileSync(path, "utf8") : "";
  const { entries, torn } = parseJournal(text);
  const fd = fs.openSync(path, "a", 0o600);
  if (text && !text.endsWith("\n")) fs.writeSync(fd, "\n");
  return {
    entries, torn,
    append(entry) {
      const record = { v: 1, at: new Date().toISOString(), ...entry };
      fs.writeSync(fd, `${JSON.stringify(record)}\n`);
      fs.fsyncSync(fd);
      entries.push(record);
    },
    close() { fs.closeSync(fd); fs.rmSync(lockPath, { force: true }); },
  };
}

/** Per-object state from journal events; the latest event wins. */
export function foldJournal(entries) {
  const objects = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.ns !== "string" || typeof entry.key !== "string") continue;
    const id = `${entry.ns}/${entry.key}`;
    const state = objects.get(id) ?? { ns: entry.ns, key: entry.key };
    if (entry.step === "source") Object.assign(state, { size: entry.size, sha256: entry.sha256, etag: entry.etag ?? null });
    else if (entry.step === "put") state.put = entry.result;
    else if (entry.step === "readback") state.verified = entry.ok === true && entry.sha256 === state.sha256;
    else if (entry.step === "switch" && entry.ok) Object.assign(state, { switched: true, rolledBack: false, switchedSha256: entry.sha256, switchedSize: entry.size });
    else if (entry.step === "rollback" && entry.ok) Object.assign(state, { switched: false, rolledBack: true });
    else if (entry.step === "rehash") state.rehashOk = entry.ok === true;
    objects.set(id, state);
  }
  return objects;
}

// ---------- inventory and planning (metadata only; no object bytes) ----------

/** Streams media_migration_inventory per namespace, starting at the namespace prefix so other namespaces are never read. */
export async function* inventoryRows(io, namespaces) {
  for (const ns of namespaces) {
    let after = `${ns}/`;
    while (after !== null) {
      const page = await io.inventory({ limit: 100, after });
      for (const row of page) {
        if (row.namespace !== ns || !row.cursor_key.startsWith(`${ns}/`)) { after = null; break; }
        yield row;
      }
      if (after !== null) after = page.length < 100 ? null : page.at(-1).cursor_key;
    }
  }
}

function classify(row, journalState, retryRolledBack) {
  if (row.provider === "r2") return "onR2";
  if (!row.source_exists) return "missingSource";
  const state = journalState.get(`${row.namespace}/${row.object_key}`);
  if (state?.switched) return "journalComplete";
  if (state?.rolledBack && !retryRolledBack) return "rolledBack";
  return "candidate";
}

/** A verified R2 copy from an earlier run can be switched without downloading the source again. */
function resumable(state, meta) {
  return Boolean(state?.sha256 && state.size === meta.size && (!state.etag || !meta.etag || state.etag === meta.etag));
}

async function sourceMetadata(io, row) {
  const meta = await io.sourceMetadata(row);
  return meta && Number.isSafeInteger(meta.size) && meta.size > 0 ? meta : null;
}

const emptyCounts = () => ({ onR2: 0, missingSource: 0, journalComplete: 0, rolledBack: 0, unknownSize: 0, oversize: 0 });

/** Whole-inventory plan: counts, bytes, batches and the Supabase egress a full copy would consume. */
export async function buildPlan(io, journalState, { namespaces, batchSize, maxBytes, retryRolledBack = false }) {
  const perNamespace = Object.fromEntries(namespaces.map((ns) => [ns, { ready: 0, ...emptyCounts(), toCopy: 0, resumable: 0, bytesToCopy: 0, batches: 0 }]));
  const sizes = [];
  for await (const row of inventoryRows(io, namespaces)) {
    const ns = perNamespace[row.namespace];
    ns.ready++;
    const kind = classify(row, journalState, retryRolledBack);
    if (kind !== "candidate") { ns[kind]++; continue; }
    const meta = await sourceMetadata(io, row);
    if (!meta) { ns.unknownSize++; continue; }
    if (meta.size > row.max_bytes) { ns.oversize++; continue; }
    ns.toCopy++;
    if (resumable(journalState.get(`${row.namespace}/${row.object_key}`), meta)) { ns.resumable++; continue; }
    ns.bytesToCopy += meta.size;
    sizes.push(meta.size);
  }
  const total = { toCopy: 0, bytesToCopy: 0, batches: 0 };
  for (const ns of Object.values(perNamespace)) {
    ns.batches = Math.ceil(ns.toCopy / batchSize);
    total.toCopy += ns.toCopy; total.bytesToCopy += ns.bytesToCopy; total.batches += ns.batches;
  }
  total.estimatedEgressBytes = total.bytesToCopy + total.toCopy * OVERHEAD_BYTES_PER_OBJECT;
  let runs = null, tooLarge = 0;
  if (maxBytes) {
    runs = 0; let current = Infinity;
    for (const size of sizes) {
      if (size > maxBytes) { tooLarge++; continue; }
      if (current + size > maxBytes) { runs++; current = 0; }
      current += size;
    }
  }
  return { perNamespace, total, runsAtMaxBytes: runs, objectsLargerThanMaxBytes: tooLarge };
}

/** Picks this run's objects from metadata sizes, stopping before the hard byte budget would be exceeded. */
export async function selectRun(io, journalState, { namespaces, maxBytes, batchSize, maxBatches, retryRolledBack = false }) {
  const maxObjects = maxBatches ? maxBatches * batchSize : Infinity;
  const counts = emptyCounts();
  const selected = []; let plannedBytes = 0; let metadataLookups = 0; let stop = null;
  for await (const row of inventoryRows(io, namespaces)) {
    const kind = classify(row, journalState, retryRolledBack);
    if (kind !== "candidate") { counts[kind]++; continue; }
    if (selected.length >= maxObjects) { stop = "maxBatches"; break; }
    const meta = await sourceMetadata(io, row); metadataLookups++;
    if (!meta) { counts.unknownSize++; continue; }
    if (meta.size > row.max_bytes) { counts.oversize++; continue; }
    const resume = resumable(journalState.get(`${row.namespace}/${row.object_key}`), meta);
    const cost = resume ? 0 : meta.size;
    if (plannedBytes + cost > maxBytes) { stop = "budget"; break; }
    plannedBytes += cost;
    selected.push({ row, size: meta.size, etag: meta.etag ?? null, resumable: resume });
  }
  return { selected, plannedBytes, metadataLookups, counts, stop };
}

// ---------- migration ----------

const statusOf = (error) => error?.status ?? error?.$metadata?.httpStatusCode ?? null;
const isQuota = (error) => error instanceof QuotaExceeded || statusOf(error) === 402;
const reasonOf = (error) => (statusOf(error) ? `http_${statusOf(error)}` : "error"); // never provider text or URLs

/** Copies, verifies and switches the selected rows. Never overwrites R2, never deletes Supabase. */
export async function migrateRows(selected, io, journal, { maxBytes, batchSize, egressAllowance = null }) {
  const verify = io.verify ?? ((bytes, contentType, max) => verifyMediaBytes(bytes, contentType, max, verifyImageWithSharp));
  const state = foldJournal(journal.entries);
  const result = { batches: 0, switched: 0, copied: 0, resumedWithoutDownload: 0, mismatches: 0, conflicts: 0,
    failed: 0, downloadedBytes: 0, budgetStop: false };
  let spent = 0;
  for (let start = 0; start < selected.length && !result.budgetStop; start += batchSize) {
    result.batches++;
    for (const item of selected.slice(start, start + batchSize)) {
      const { row, size, etag } = item;
      const record = (step, fields) => {
        try { journal.append({ op: "migrate", ns: row.namespace, key: row.object_key, step, ...fields }); }
        catch { throw new JournalWriteFailed(); }
      };
      let stage = "readback";
      const switchTo = async (verified) => {
        stage = "switch";
        await io.switchReference(row, verified);
        record("switch", { ok: true, sha256: verified.sha256, size: verified.size });
        result.switched++;
      };
      try {
        if (item.resumable) {
          const prior = state.get(`${row.namespace}/${row.object_key}`);
          const existing = await io.destinationBytes(row, row.max_bytes);
          if (existing) {
            const verified = await verify(existing, row.content_type, row.max_bytes);
            const ok = verified.sha256 === prior.sha256 && verified.size === prior.size;
            record("readback", { ok, sha256: verified.sha256, size: verified.size, resumed: true });
            if (!ok) { record("put", { result: "conflict" }); result.conflicts++; continue; }
            await switchTo(verified); result.resumedWithoutDownload++; continue;
          }
          // The earlier copy never landed in R2; fall through to a full, budgeted copy.
        }
        if (spent + size > maxBytes || (egressAllowance != null && spent + size > egressAllowance)) { result.budgetStop = true; break; }
        spent += size;
        stage = "source";
        const bytes = await io.sourceBytes(row, size);
        result.downloadedBytes += bytes.byteLength;
        const verified = await verify(bytes, row.content_type, row.max_bytes);
        if (verified.size !== size) { record("failed", { stage, reason: "size_changed" }); result.mismatches++; continue; }
        record("source", { size: verified.size, sha256: verified.sha256, etag, contentType: verified.contentType });
        stage = "put";
        let readback;
        if (await io.putDestination(row, bytes) === "exists") {
          readback = await io.destinationBytes(row, row.max_bytes);
          if (!readback || readback.byteLength !== verified.size || sha256(readback) !== verified.sha256) {
            record("put", { result: "conflict" }); result.conflicts++; continue; // never overwrite a different object
          }
          record("put", { result: "exists_same" });
        } else {
          record("put", { result: "created" }); result.copied++;
          stage = "readback";
          readback = await io.destinationBytes(row, row.max_bytes);
        }
        const backSha = readback ? sha256(readback) : null;
        const ok = Boolean(readback) && readback.byteLength === verified.size && backSha === verified.sha256;
        record("readback", { ok, sha256: backSha, size: readback?.byteLength ?? null });
        if (!ok) { result.mismatches++; continue; } // the reference stays on Supabase
        await switchTo(verified);
      } catch (error) {
        if (error instanceof JournalWriteFailed) throw error;
        if (isQuota(error)) { record("failed", { stage, reason: "quota_402" }); throw new QuotaExceeded(); }
        record("failed", { stage, reason: reasonOf(error) });
        result.failed++;
      }
    }
  }
  return result;
}

// ---------- rollback and rehash ----------

export function journalTargets(journalState, { namespaces, key, which }) {
  return [...journalState.values()].filter((s) => (which === "rollback" ? s.switched : s.switchedSha256)
    && (!namespaces || namespaces.includes(s.ns)) && (!key || `${s.ns}/${s.key}` === key))
    .map((s) => ({ ns: s.ns, key: s.key, sha256: s.switchedSha256, size: s.switchedSize }));
}

/** Points references back at the retained Supabase source. Deletes nothing anywhere. */
export async function rollbackTargets(targets, io, journal, { execute }) {
  const result = { targets: targets.length, rolledBack: 0, refused: 0, failed: 0, dryRun: !execute };
  if (!execute) return result;
  for (const target of targets) {
    const base = { op: "rollback", ns: target.ns, key: target.key, step: "rollback" };
    try {
      // The source must still be there, unchanged, or rollback would break reads.
      const meta = await sourceMetadata(io, { namespace: target.ns, object_key: target.key });
      if (!meta || meta.size !== target.size) { journal.append({ ...base, ok: false, reason: "source_missing_or_changed" }); result.refused++; continue; }
      await io.rollbackReference(target);
      journal.append({ ...base, ok: true, sha256: target.sha256 });
      result.rolledBack++;
    } catch (error) {
      if (isQuota(error)) throw new QuotaExceeded();
      journal.append({ ...base, ok: false, reason: reasonOf(error) });
      result.failed++;
    }
  }
  return result;
}

/** Re-reads R2 copies (no Supabase egress) and confirms them against the journal. */
export async function rehashTargets(targets, io, journal) {
  const result = { targets: targets.length, ok: 0, mismatches: 0, missing: 0 };
  for (const target of targets) {
    let bytes;
    try { bytes = await io.destinationBytes({ namespace: target.ns, object_key: target.key }, target.size); }
    catch { bytes = undefined; } // unreadable or larger than recorded: a mismatch, never a pass
    const hash = bytes ? sha256(bytes) : null;
    const ok = Boolean(bytes) && bytes.byteLength === target.size && hash === target.sha256;
    journal.append({ op: "rehash", ns: target.ns, key: target.key, step: "rehash", ok, sha256: hash });
    if (ok) result.ok++; else if (bytes === null) result.missing++; else result.mismatches++;
  }
  return result;
}

// ---------- real clients ----------

function supabaseIo(supabase) {
  const quota = (status) => { if (status === 402) throw new QuotaExceeded(); };
  return {
    inventory: async ({ limit, after }) => {
      const { data, error, status } = await supabase.rpc("media_migration_inventory", { p_limit: limit, p_after: after });
      quota(status);
      if (error) throw new OperatorError("Inventory query failed; confirm the provider migration is installed in the selected environment");
      return data;
    },
    // Object metadata only (storage info endpoint): the budget is computed before any object byte is read.
    sourceMetadata: async (row) => {
      const { data, error } = await supabase.storage.from(BUCKETS[row.namespace]).info(row.object_key);
      quota(error?.status);
      if (error) return null;
      return { size: Number(data.size ?? data.metadata?.size), etag: data.etag ?? null };
    },
    sourceBytes: async (row, size) => {
      const { data, error } = await supabase.storage.from(BUCKETS[row.namespace]).createSignedUrl(row.object_key, 60);
      quota(error?.status);
      if (error || !data?.signedUrl) throw new Error("Source missing");
      const response = await fetch(data.signedUrl, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
      quota(response.status);
      return readBoundedBody(response, size); // bounded by the metadata size the budget was charged for
    },
    switchReference: async (row, verified) => {
      const { error, status } = await supabase.rpc("media_migration_switch", { p_namespace: row.namespace, p_key: row.object_key,
        p_owner: row.owner_user_id, p_size: verified.size, p_content_type: verified.contentType, p_sha256: verified.sha256 });
      quota(status);
      if (error) throw new Error("Reference switch refused");
    },
    rollbackReference: async (target) => {
      const { error, status } = await supabase.rpc("media_migration_rollback", { p_namespace: target.ns, p_key: target.key, p_sha256: target.sha256 });
      quota(status);
      if (error) throw new Error("Rollback refused");
    },
    ledgerTargets: async (namespaces) => {
      const targets = [];
      for (const ns of namespaces) {
        for (let from = 0; ; from += 1000) {
          const { data, error, status } = await supabase.from("media_migration_ledger").select("namespace,object_key,sha256,size_bytes")
            .eq("namespace", ns).is("rolled_back_at", null).order("object_key").range(from, from + 999);
          quota(status);
          if (error) throw new OperatorError("Ledger query failed");
          targets.push(...data.map((r) => ({ ns: r.namespace, key: r.object_key, sha256: r.sha256, size: Number(r.size_bytes) })));
          if (data.length < 1000) break;
        }
      }
      return targets;
    },
  };
}

function r2Io(env) {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_PRIVATE_BUCKET) throw new OperatorError("R2 settings are required for this command");
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
  const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
  const s3 = new S3Client({ region: "auto", forcePathStyle: true, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED", endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    maxAttempts: 3, requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 } });
  const key = (row) => `${row.namespace}/${row.object_key}`;
  return {
    s3, DeleteObjectCommand, bucket: env.R2_PRIVATE_BUCKET, key,
    putDestination: async (row, bytes) => {
      try {
        await s3.send(new PutObjectCommand({ Bucket: env.R2_PRIVATE_BUCKET, Key: key(row), Body: bytes,
          ContentType: row.content_type, CacheControl: "private, no-store", IfNoneMatch: "*" }));
        return "created";
      } catch (error) {
        if (error?.$metadata?.httpStatusCode === 412) return "exists"; // compared by hash, never overwritten
        throw error;
      }
    },
    destinationBytes: async (row, maxBytes) => {
      const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: env.R2_PRIVATE_BUCKET, Key: key(row) }), { expiresIn: 60 });
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
      if (response.status === 404) { await response.body?.cancel(); return null; }
      return readBoundedBody(response, maxBytes);
    },
  };
}

// ---------- CLI ----------

const HELP = `Supabase -> R2 media migration. Dry-run unless --execute. Never deletes Supabase sources.

  plan     --project <ref|local> [--namespace a,b] [--batch-size 25] [--max-bytes 20MB]
           [--remaining-egress-bytes 290MB] [--egress-safety-fraction 0.5] [--journal f] [--json]
           Counts, bytes per namespace, batches and estimated Supabase egress. Metadata only.
  migrate  --project <ref|local> --namespace a,b --max-bytes <N> --journal f
           --remaining-egress-bytes <N> [--egress-safety-fraction 0.5] [--batch-size 25] [--max-batches N]
           [--retry-rolled-back] [--execute]
           Copies inside the hard byte budget, verifies sha256 + size, then switches. Rerun to resume.
  rollback --project <ref|local> --journal f [--namespace a,b | --key ns/key] [--from-ledger] [--execute]
           media_migration_rollback per entry. Supabase sources and R2 copies are both kept.
  rehash   --project <ref|local> --journal f [--namespace a,b | --key ns/key]
           Re-reads R2 copies and confirms sha256 + size against the journal. Read-only.
  cleanup  --project <ref|local> [--limit 25] [--execute]
           Deletes ONLY retired R2 objects. Legacy Supabase objects are never removed.

Production execution is blocked. Source deletion is out of scope (separate approval, >= 30 days retention).`;

function printPlan(project, options, plan, inventory) {
  const pad = (v, n) => String(v).padStart(n);
  const rows = Object.entries(plan.perNamespace);
  const lines = [`Media migration plan - project ${project} (metadata only; no object bytes downloaded)`, "",
    `namespace     ready  on_r2  missing  to_copy  resumable  bytes_to_copy  batches(${options.batchSize})`];
  for (const [ns, n] of rows) lines.push(`${ns.padEnd(12)}${pad(n.ready, 7)}${pad(n.onR2, 7)}${pad(n.missingSource, 9)}${pad(n.toCopy, 9)}${pad(n.resumable, 11)}${pad(formatBytes(n.bytesToCopy), 15)}${pad(n.batches, 12)}`);
  lines.push(`${"total".padEnd(12)}${pad("", 23)}${pad(plan.total.toCopy, 9)}${pad("", 11)}${pad(formatBytes(plan.total.bytesToCopy), 15)}${pad(plan.total.batches, 12)}`, "");
  for (const [ns, n] of rows) {
    if (n.unknownSize || n.oversize || n.journalComplete || n.rolledBack) {
      lines.push(`! ${ns}: ${n.unknownSize} without readable metadata, ${n.oversize} over the namespace limit, ${n.journalComplete} switched in the journal but supabase in the database, ${n.rolledBack} rolled back`);
    }
  }
  lines.push(`Estimated Supabase egress: ${formatBytes(plan.total.estimatedEgressBytes)} (objects + ${formatBytes(OVERHEAD_BYTES_PER_OBJECT)} request overhead each)`);
  if (options.maxBytes) lines.push(`Runs needed at --max-bytes ${formatBytes(options.maxBytes)}: ${plan.runsAtMaxBytes}${plan.objectsLargerThanMaxBytes ? ` (+${plan.objectsLargerThanMaxBytes} objects larger than the budget)` : ""}`);
  if (options.remainingEgressBytes) {
    const allowance = Math.floor(options.remainingEgressBytes * options.egressSafetyFraction);
    lines.push(`Remaining egress ${formatBytes(options.remainingEgressBytes)} x ${options.egressSafetyFraction} = allowance ${formatBytes(allowance)}: full copy ${plan.total.estimatedEgressBytes <= allowance ? "FITS" : "DOES NOT FIT - copy fewer namespaces or wait for the cycle reset / Pro"}`);
  }
  lines.push("", `Source inventory: ${JSON.stringify(inventory)}`);
  console.log(lines.join("\n"));
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.command === "help") { console.log(HELP); return; }
  const env = readMaintenanceEnv();
  const url = new URL(env.SUPABASE_URL);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  const project = local ? "local" : url.hostname.split(".")[0];
  if (options.project !== project) throw new OperatorError("Requested project does not match configured environment");
  if (options.execute && !local && project !== STAGING_PROJECT) throw new OperatorError("Production execution requires separate verified approval");
  const { createClient } = require("@supabase/supabase-js");
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const db = supabaseIo(supabase);
  const namespaces = options.namespaces ?? NAMESPACES;
  const { batchSize, maxBatches, retryRolledBack } = options;

  if (options.command === "cleanup") return cleanup(supabase, env, project, options);

  if (options.command === "plan") {
    const plan = await buildPlan(db, readJournalState(options.journal), { namespaces, batchSize, maxBytes: options.maxBytes, retryRolledBack });
    const { data: inventory, error, status } = await supabase.rpc("media_source_inventory_summary");
    if (status === 402) throw new QuotaExceeded();
    if (error) throw new OperatorError("Source inventory failed");
    if (options.json) console.log(JSON.stringify({ project, namespaces, ...plan, sourceInventory: inventory }));
    else printPlan(project, options, plan, inventory);
    return;
  }

  if (options.command === "migrate") {
    const journal = options.execute ? openJournal(options.journal) : null;
    try {
      const journalState = journal ? foldJournal(journal.entries) : readJournalState(options.journal);
      const maxBytes = options.maxBytes ?? Infinity;
      const selection = await selectRun(db, journalState, { namespaces, maxBytes, batchSize, maxBatches, retryRolledBack });
      const guard = assertEgressGuard({ plannedBytes: selection.plannedBytes, objects: selection.selected.length,
        remainingEgressBytes: options.remainingEgressBytes, egressSafetyFraction: options.egressSafetyFraction, required: options.execute && !local });
      const summary = { project, namespaces, dryRun: !options.execute, selected: selection.selected.length,
        resumable: selection.selected.filter((s) => s.resumable).length, plannedBytes: selection.plannedBytes,
        estimatedEgressBytes: guard.estimate, allowance: guard.allowance, stop: selection.stop, skipped: selection.counts,
        journalTornLines: journal?.torn ?? 0 };
      if (!options.execute) { console.log(JSON.stringify(summary)); return; }
      const result = await migrateRows(selection.selected, { ...db, ...r2Io(env) }, journal, { maxBytes, batchSize, egressAllowance: guard.allowance });
      const more = result.budgetStop || selection.stop;
      console.log(JSON.stringify({ ...summary, ...result, next: more ? "Budget or batch limit reached; rerun the same command to continue." : "Selected namespaces complete for this inventory." }));
      if (result.failed || result.mismatches || result.conflicts) process.exitCode = 1;
    } finally { journal?.close(); }
    return;
  }

  const journal = options.journal ? openJournal(options.journal) : null;
  try {
    const journalState = foldJournal(journal?.entries ?? []);
    if (options.command === "rollback") {
      const targets = options.fromLedger
        ? (await db.ledgerTargets(namespaces)).filter((t) => !options.key || `${t.ns}/${t.key}` === options.key)
        : journalTargets(journalState, { namespaces: options.namespaces, key: options.key, which: "rollback" });
      const result = await rollbackTargets(targets, db, journal, { execute: options.execute });
      console.log(JSON.stringify({ project, ...result, supabaseSourcesDeleted: 0, r2ObjectsDeleted: 0 }));
      if (result.refused || result.failed) process.exitCode = 1;
      return;
    }
    const targets = journalTargets(journalState, { namespaces: options.namespaces, key: options.key, which: "rehash" });
    const result = await rehashTargets(targets, r2Io(env), journal);
    console.log(JSON.stringify({ project, ...result }));
    if (result.mismatches || result.missing) process.exitCode = 1;
  } finally { journal?.close(); }
}

async function cleanup(supabase, env, project, options) {
  const { data: rows, error } = await supabase.rpc("media_cleanup_candidates", { p_limit: options.limit });
  if (error) throw new OperatorError("Cleanup query failed; confirm the provider migration is installed in the selected environment");
  if (!options.execute) {
    console.log(JSON.stringify({ dryRun: true, project, candidates: rows.length,
      providers: rows.reduce((counts, row) => ({ ...counts, [row.provider]: (counts[row.provider] ?? 0) + 1 }), {}) }));
    return;
  }
  const r2 = r2Io(env);
  let retired = 0;
  for (const row of rows) {
    if (row.provider !== "r2") continue; // Legacy source objects are never removed by this tool.
    const { error: retireError } = await supabase.rpc("media_cleanup_retire", { p_namespace: row.namespace, p_key: row.object_key, p_owner: row.owner_user_id });
    if (retireError) continue;
    for (const objectKey of [r2.key(row), `pending/${r2.key(row)}`]) await r2.s3.send(new r2.DeleteObjectCommand({ Bucket: r2.bucket, Key: objectKey }));
    const { error: completeError } = await supabase.rpc("media_cleanup_complete", { p_namespace: row.namespace, p_key: row.object_key, p_owner: row.owner_user_id });
    if (completeError) throw new OperatorError("Cleanup completion failed; retry safely");
    retired++;
  }
  console.log(JSON.stringify({ project, retired, preservedLegacy: rows.filter((row) => row.provider === "supabase").length }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof OperatorError ? error.message
      : "Media maintenance failed; verify selected environment, settings, and permissions. No source deletion was attempted.");
    process.exitCode = 1;
  });
}
