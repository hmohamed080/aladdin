#!/usr/bin/env node
// Protected migration of SUBMITTED business-verification evidence to PRIVATE R2. PREPARED, NOT EXECUTED; DISABLED BY DEFAULT.
//
// Submitted verification documents are compliance evidence. The ordinary reset and cleanup never select them. This tool is the only
// path that moves them, and it only ever ADDS a verified copy: it never deletes, overwrites or edits anything (the Supabase object and
// the immutable submitted row stay; removing the Supabase copy is a separate compliance decision with its own approval).
//
//   node scripts/bv-evidence-migrate.mjs plan   --project <ref|local>                      (read-only: counts + plan sha256)
//   node scripts/bv-evidence-migrate.mjs verify --project <ref|local>                      (read-only: database coverage + R2 re-hash)
//   BV_EVIDENCE_MIGRATE_ENABLED=true node scripts/bv-evidence-migrate.mjs execute --project <ref|local> \
//        --approved-sha256 <plan hash> --confirm "copy verification evidence to R2 in <project>" --journal bv-journal.jsonl
//
// Per document: download from Supabase (bounded by the recorded size) -> size and file-signature check -> sha256 -> PUT to the private
// R2 bucket at the ids-only key the DATABASE computed, never overwriting (If-None-Match) -> read the R2 copy back and compare sha256 ->
// bv_evidence_adopt (database re-checks submitted/ready/size/checksum under lock and switches the location) -> journaled.
// Fail-stop on the first mismatch. Output and journal carry counts and hashes only, never a key, organization or file name.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { ResetOperatorError } from "./media-reset.mjs";
import { journalWriter, readJournal } from "./media-reset-execute.mjs";

export const ENABLE_ENV = "BV_EVIDENCE_MIGRATE_ENABLED";
export const confirmationPhrase = (project) => `copy verification evidence to R2 in ${project}`;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const BUCKET = "business-verification-documents";
const MAX_BYTES = 10 * 1024 * 1024;

/** The bytes must be the kind of file the record claims (the upload path checked this once; evidence is re-checked before it is copied). */
export function signatureMatches(contentType, bytes) {
  const b = Buffer.from(bytes);
  if (contentType === "application/pdf") return b.subarray(0, 5).toString("latin1") === "%PDF-";
  if (contentType === "image/png") return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (contentType === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (contentType === "image/webp") return b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP";
  return false;
}

/** Read every submitted document through the database inventory; a short or inconsistent read fails closed. */
export async function readInventory(io) {
  const rows = [];
  let after = null;
  for (let guard = 0; guard < 100000; guard++) {
    const page = await io.rpc("bv_evidence_adoption_inventory", { p_after: after, p_limit: 100 });
    if (!Array.isArray(page)) throw new ResetOperatorError("Inventory query returned an unexpected shape");
    if (page.length === 0) break;
    const last = page[page.length - 1].object_key;
    if (after !== null && Buffer.compare(Buffer.from(last), Buffer.from(after)) <= 0) throw new ResetOperatorError("Inventory pagination did not advance");
    rows.push(...page); after = last;
  }
  const coverage = await io.rpc("bv_evidence_adoption_verify", {});
  if (Number(coverage?.submitted) !== rows.length) throw new ResetOperatorError("The inventory does not cover every submitted document (truncated or changed read)");
  return rows;
}

/** Hash of the canonical plan: what will be copied (key, size, type, target). The sha256 of the bytes is only known after the copy. */
export function planSha256(rows) {
  const items = rows.map((r) => [r.object_key, r.organization_id, r.content_type, Number(r.size_bytes), r.storage_key]);
  return sha(JSON.stringify(items));
}
export function summarizePlan(rows) {
  return { documents: rows.length, alreadyOnR2: rows.filter((r) => r.adopted).length, toCopy: rows.filter((r) => !r.adopted).length,
    missingSupabaseObject: rows.filter((r) => !r.supabase_object_present && !r.adopted).length, totalBytes: rows.reduce((n, r) => n + Number(r.size_bytes), 0), planSha256: planSha256(rows) };
}

export function assertExecutable({ enabled, project, approvedSha, currentSha, confirm, journalPath }) {
  if (enabled !== "true") throw new ResetOperatorError(`Verification-evidence migration is disabled (set ${ENABLE_ENV}=true for an approved run)`);
  if (!project) throw new ResetOperatorError("--project is required");
  if (!/^[0-9a-f]{64}$/.test(approvedSha ?? "")) throw new ResetOperatorError("--approved-sha256 must be the plan hash the owner approved");
  if (approvedSha !== currentSha) throw new ResetOperatorError("The set of submitted documents changed since it was approved; take and approve a fresh plan");
  if (confirm !== confirmationPhrase(project)) throw new ResetOperatorError(`Type the confirmation exactly: "${confirmationPhrase(project)}"`);
  if (!journalPath) throw new ResetOperatorError("--journal is required");
}

/**
 * io = { rpc(name,args), download(key, size) -> bytes|null, r2Put(storageKey, bytes, contentType) -> "created"|"exists", r2Get(storageKey, maxBytes) -> bytes|null }
 * Never deletes or overwrites. Idempotent: an already-adopted document is skipped; an existing R2 object is accepted only if its hash matches.
 */
export async function migrateEvidence(io, rows, { journalPath, project, planSha }) {
  const existing = readJournal(journalPath, { project, manifestSha256: planSha });
  const write = journalWriter(journalPath, existing);
  write(existing.length === 0 ? { event: "start", project, manifestSha256: planSha, documents: rows.length } : { event: "resume" });
  const doneKeys = new Set(existing.filter((e) => e.event === "copied").map((e) => e.itemSha256));
  let copied = 0, skipped = 0, failed = 0;
  const fail = (row, reason) => { failed++; write({ event: "fail", itemSha256: sha(row.object_key), reason }); return { ok: false, copied, skipped, failed }; };
  for (const row of rows) {
    const item = sha(row.object_key);
    if (row.adopted || doneKeys.has(item)) { skipped++; continue; }
    if (Number(row.size_bytes) > MAX_BYTES || Number(row.size_bytes) <= 0) return fail(row, "recorded size out of range");
    try {
      const bytes = await io.download(row.object_key, Number(row.size_bytes));
      if (!bytes) return fail(row, "Supabase copy missing");
      if (bytes.length !== Number(row.size_bytes)) return fail(row, "size differs from the evidence record");
      if (!signatureMatches(row.content_type, bytes)) return fail(row, "file signature differs from the recorded type");
      const digest = sha(bytes);
      const put = await io.r2Put(row.storage_key, bytes, row.content_type);
      const back = await io.r2Get(row.storage_key, bytes.length + 1);
      if (!back || sha(back) !== digest) return fail(row, put === "exists" ? "existing R2 object differs" : "R2 read-back differs");
      await io.rpc("bv_evidence_adopt", { p_key: row.object_key, p_size: bytes.length, p_sha256: digest });
      copied++;
      write({ event: "copied", itemSha256: item, bytes: bytes.length });
    } catch (error) {
      return fail(row, `error (${error?.code ?? "unknown"})`);
    }
  }
  const coverage = await io.rpc("bv_evidence_adoption_verify", {});
  const ok = Boolean(coverage?.ok) && failed === 0;
  write({ event: "finish", ok, copied, skipped, failed });
  return { ok, copied, skipped, failed, coverage };
}

/** Read-only proof: every adopted document's R2 object still hashes to the checksum the database recorded. */
export async function verifyOnR2(io, rows) {
  let checked = 0, mismatched = 0, missing = 0;
  for (const row of rows.filter((r) => r.adopted)) {
    const back = await io.r2Get(row.storage_key, Number(row.size_bytes) + 1);
    if (!back) { missing++; continue; }
    checked++;
    if (sha(back) !== row.location_sha256) mismatched++;
  }
  return { checked, mismatched, missing, ok: mismatched === 0 && missing === 0 };
}

function connect(env, project) {
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ResetOperatorError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const host = new URL(url).hostname;
  const configured = ["localhost", "127.0.0.1"].includes(host) ? "local" : host.split(".")[0];
  if (project !== configured) throw new ResetOperatorError("Requested project does not match the configured environment");
  const require = createRequire(new URL("../frontend/package.json", import.meta.url));
  const supabase = require("@supabase/supabase-js").createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const io = {
    async rpc(name, args) { const { data, error } = await supabase.rpc(name, args); if (error) { const e = new Error("rpc failed"); e.code = error.code; throw e; } return data; },
    async download(objectKey, size) {
      const { data, error } = await supabase.storage.from(BUCKET).download(objectKey);
      if (error || !data) return null;
      if (data.size > size) return Buffer.alloc(size + 1); // larger than recorded: reported as a size mismatch, never read in full
      return Buffer.from(await data.arrayBuffer());
    },
  };
  return { configured, io, supabase, require };
}

function r2(env, require) {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_PRIVATE_BUCKET) throw new ResetOperatorError("R2 settings are required for this command");
  const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
  const s3 = new S3Client({ region: "auto", forcePathStyle: true, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    maxAttempts: 3, requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 } });
  return {
    async r2Put(storageKey, bytes, contentType) {
      try { await s3.send(new PutObjectCommand({ Bucket: env.R2_PRIVATE_BUCKET, Key: storageKey, Body: bytes, ContentType: contentType, CacheControl: "private, no-store", IfNoneMatch: "*" })); return "created"; }
      catch (error) { if (error?.$metadata?.httpStatusCode === 412) return "exists"; throw error; }
    },
    async r2Get(storageKey, maxBytes) {
      try {
        const out = await s3.send(new GetObjectCommand({ Bucket: env.R2_PRIVATE_BUCKET, Key: storageKey }));
        const chunks = []; let n = 0;
        for await (const chunk of out.Body) { n += chunk.length; if (n > maxBytes) return Buffer.alloc(maxBytes + 1); chunks.push(chunk); }
        return Buffer.concat(chunks);
      } catch (error) { if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NoSuchKey") return null; throw error; }
    },
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const [command, ...rest] = argv;
  if (!["plan", "verify", "execute"].includes(command)) throw new ResetOperatorError("Usage: bv-evidence-migrate.mjs plan|verify|execute --project <ref|local> ... (execute is disabled unless approved)");
  const flag = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
  if (command === "execute" && env[ENABLE_ENV] !== "true") assertExecutable({ enabled: env[ENABLE_ENV] });
  const { configured, io, require } = connect(env, flag("--project"));
  const rows = await readInventory(io);
  const summary = summarizePlan(rows);
  if (command === "plan") { console.log(JSON.stringify({ project: configured, readOnly: true, ...summary })); return; }
  const full = { ...io, ...r2(env, require) };
  if (command === "verify") {
    const coverage = await io.rpc("bv_evidence_adoption_verify", {});
    const proof = await verifyOnR2(full, rows);
    console.log(JSON.stringify({ project: configured, readOnly: true, coverage, r2: proof }));
    if (!coverage?.ok || !proof.ok) process.exitCode = 1;
    return;
  }
  assertExecutable({ enabled: env[ENABLE_ENV], project: configured, approvedSha: flag("--approved-sha256"), currentSha: summary.planSha256, confirm: flag("--confirm"), journalPath: flag("--journal") });
  const result = await migrateEvidence(full, rows, { journalPath: flag("--journal"), project: configured, planSha: summary.planSha256 });
  console.log(JSON.stringify({ project: configured, ok: result.ok, copied: result.copied, skipped: result.skipped, failed: result.failed, coverage: result.coverage }));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof ResetOperatorError ? error.message : "Evidence migration failed; verify the environment. See the journal for what was copied.");
    process.exitCode = 1;
  });
}
