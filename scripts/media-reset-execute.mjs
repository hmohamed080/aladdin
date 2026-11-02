#!/usr/bin/env node
// Clean-media reset, EXECUTION of the Storage part. DISABLED BY DEFAULT and refused unless every gate below holds.
//
// Scope (owner decision 2026-11-01): legacy application files in the Supabase Storage buckets are removed, never migrated; R2 is the
// only media store; accounts, organizations and every other row stay. Submitted business-verification documents are compliance
// evidence: they are RETAINED and this tool cannot select them (see `retained` in planStorageDeletion and the check in every batch).
// This tool removes Storage OBJECTS only. Rows and references that pointed at them (profiles.avatar_media_id ...) are reconciled by
// the existing reviewed purge pipeline (media_historical_purge_*), which is a separate, separately approved step.
//
//   node scripts/media-reset-execute.mjs plan    --project <ref|local>                      (read-only: counts and a plan hash)
//   MEDIA_RESET_EXECUTE_ENABLED=true node scripts/media-reset-execute.mjs execute --project <ref|local> \
//        --approved-sha256 <inventory hash approved by the owner> --confirm "delete legacy media in <project>" \
//        --before before.json --journal reset-journal.jsonl [--limit 500]
//
// Gates for `execute` (all required, none inferable): the enable variable; an approved inventory hash that equals a FRESH inventory
// taken now (so a file uploaded after the approval changes the hash and stops the run); the typed confirmation; a before-snapshot
// taken beforehand; a journal path. Output and journal carry counts and hashes only, never an object name, owner or id.
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { BUCKETS, buildInventory, ResetOperatorError } from "./media-reset.mjs";

export const ENABLE_ENV = "MEDIA_RESET_EXECUTE_ENABLED";
export const confirmationPhrase = (project) => `delete legacy media in ${project}`;
const VERIFICATION_BUCKET = "business-verification-documents";
const sha = (text) => createHash("sha256").update(text).digest("hex");

/** Every gate, in one place. Throws a ResetOperatorError naming the first one that does not hold. */
export function assertExecutable({ enabled, project, approvedSha, currentSha, confirm, before, journalPath }) {
  if (enabled !== "true") throw new ResetOperatorError(`Media reset execution is disabled (set ${ENABLE_ENV}=true for an approved run)`);
  if (!project) throw new ResetOperatorError("--project is required");
  if (!/^[0-9a-f]{64}$/.test(approvedSha ?? "")) throw new ResetOperatorError("--approved-sha256 must be the inventory hash the owner approved");
  if (approvedSha !== currentSha) throw new ResetOperatorError("The inventory changed since it was approved (files were added or removed); take and approve a fresh inventory");
  if (confirm !== confirmationPhrase(project)) throw new ResetOperatorError(`Type the confirmation exactly: "${confirmationPhrase(project)}"`);
  if (!before || typeof before !== "object" || !before.buckets) throw new ResetOperatorError("--before must be a storage snapshot taken before the run");
  if (!journalPath) throw new ResetOperatorError("--journal is required: every batch is recorded for audit and resume");
}

/**
 * io = { listObjects(bucket) -> string[], submittedVerificationKeys() -> string[] }
 * The plan: every object name per bucket EXCEPT submitted verification evidence. Names stay in memory; only counts leave.
 */
export async function planStorageDeletion(io) {
  const retained = new Set(await io.submittedVerificationKeys());
  const buckets = {};
  let retainedPresent = 0;
  for (const bucket of BUCKETS) {
    const names = await io.listObjects(bucket);
    buckets[bucket] = bucket === VERIFICATION_BUCKET ? names.filter((name) => !retained.has(name)) : names;
    if (bucket === VERIFICATION_BUCKET) retainedPresent = names.length - buckets[bucket].length;
  }
  const counts = Object.fromEntries(Object.entries(buckets).map(([bucket, names]) => [bucket, names.length]));
  return { buckets, retained, summary: { toDelete: counts, retainedVerificationEvidence: retainedPresent, planSha256: sha(JSON.stringify(counts)) } };
}

export function readJournal(path) {
  if (!path || !fs.existsSync(path)) return [];
  return fs.readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
}
const append = (path, entry) => fs.appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);

/**
 * Remove the planned objects in batches. Resumable (a batch already journaled as verified is skipped), idempotent (removing an absent
 * object is a no-op), and fail-stop: the first batch that is not CONFIRMED gone stops the run with a non-zero result.
 * io = { removeObjects(bucket, names), remaining(bucket, names) -> number still present }
 */
export async function executeStorageDeletion(io, plan, { journalPath, batchSize = 100, limit = Infinity }) {
  const done = new Set(readJournal(journalPath).filter((e) => e.event === "batch" && e.ok).map((e) => e.batchSha256));
  append(journalPath, { event: "start", toDelete: plan.summary.toDelete, retainedVerificationEvidence: plan.summary.retainedVerificationEvidence });
  let removed = 0, skipped = 0, failed = 0, stopped = false;
  outer: for (const bucket of BUCKETS) {
    const names = plan.buckets[bucket];
    for (let i = 0; i < names.length; i += batchSize) {
      const batch = names.slice(i, i + batchSize);
      const batchSha256 = sha(`${bucket}\n${batch.join("\n")}`);
      if (done.has(batchSha256)) { skipped += batch.length; continue; }
      if (removed + batch.length > limit) { stopped = true; break outer; }
      // Defense in depth: no batch may contain submitted evidence, whatever produced it.
      if (batch.some((name) => plan.retained.has(name))) { failed++; append(journalPath, { event: "batch", bucket, count: batch.length, batchSha256, ok: false, reason: "retained evidence in batch" }); break outer; }
      try {
        await io.removeObjects(bucket, batch);
        const left = await io.remaining(bucket, batch);
        const ok = left === 0;
        append(journalPath, { event: "batch", bucket, count: batch.length, batchSha256, ok, remaining: left });
        if (!ok) { failed++; break outer; }
        removed += batch.length;
      } catch {
        failed++; append(journalPath, { event: "batch", bucket, count: batch.length, batchSha256, ok: false, reason: "error" }); break outer;
      }
    }
  }
  append(journalPath, { event: "finish", removed, skipped, failed, stopped });
  return { removed, skipped, failed, stopped };
}

function supabaseStorageIo(supabase) {
  const list = async (bucket, prefix = "") => {
    const names = [];
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 100, offset });
      if (error) throw new ResetOperatorError("Storage listing failed; verify the environment and permissions");
      for (const entry of data) {
        if (entry.id) names.push(`${prefix}${entry.name}`);
        else names.push(...(await list(bucket, `${prefix}${entry.name}/`)));
      }
      if (data.length < 100) return names;
    }
  };
  return {
    listObjects: (bucket) => list(bucket),
    async submittedVerificationKeys() {
      const { data, error } = await supabase.from("business_verification_documents").select("object_key").not("submission_id", "is", null);
      if (error) throw new ResetOperatorError("Could not read the retained evidence list; nothing was deleted");
      return data.map((row) => row.object_key);
    },
    async removeObjects(bucket, names) {
      const { error } = await supabase.storage.from(bucket).remove(names);
      if (error) throw new Error("remove failed");
    },
    async remaining(bucket, names) {
      const present = new Set(await list(bucket));
      return names.filter((name) => present.has(name)).length;
    },
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const [command, ...rest] = argv;
  if (command !== "plan" && command !== "execute") throw new ResetOperatorError("Usage: media-reset-execute.mjs plan|execute --project <ref|local> ...  (execute is disabled unless approved)");
  const flag = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
  const project = flag("--project");
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ResetOperatorError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const host = new URL(url).hostname;
  const configured = ["localhost", "127.0.0.1"].includes(host) ? "local" : host.split(".")[0];
  if (project !== configured) throw new ResetOperatorError("Requested project does not match the configured environment");
  const require = createRequire(new URL("../frontend/package.json", import.meta.url));
  const supabase = require("@supabase/supabase-js").createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const io = supabaseStorageIo(supabase);

  if (command === "execute") {
    // Gates first, on a cheap read: nothing is listed or removed until they all hold.
    const { createReadOnlyInventoryIo } = await import("./media-reset.mjs");
    const inventory = await buildInventory(createReadOnlyInventoryIo(supabase));
    const before = flag("--before") ? JSON.parse(fs.readFileSync(flag("--before"), "utf8")) : null;
    assertExecutable({ enabled: env[ENABLE_ENV], project: configured, approvedSha: flag("--approved-sha256"), currentSha: inventory.sha256, confirm: flag("--confirm"), before, journalPath: flag("--journal") });
  }
  const plan = await planStorageDeletion(io);
  if (command === "plan") { console.log(JSON.stringify({ project: configured, readOnly: true, ...plan.summary })); return; }
  const limit = flag("--limit") ? Number(flag("--limit")) : Infinity;
  if (!(limit > 0)) throw new ResetOperatorError("--limit must be a positive number");
  const result = await executeStorageDeletion(io, plan, { journalPath: flag("--journal"), limit });
  console.log(JSON.stringify({ project: configured, ...result, retainedVerificationEvidence: plan.summary.retainedVerificationEvidence }));
  if (result.failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof ResetOperatorError ? error.message : "Media reset failed; verify the environment. See the journal for what was removed.");
    process.exitCode = 1;
  });
}
