// READ-ONLY check that every R2 media record of a project still has its object in the R2 private bucket with the
// recorded size (and, with --deep, the recorded sha256). Use it when no migration journal exists (media-storage.mjs
// `rehash` needs one). It never writes, deletes or overwrites anything and prints COUNTS only (no keys, owners or names).
//
//   node scripts/media-r2-verify.mjs --project <ref> [--namespace avatar,portfolio] [--deep] [--list-problems]
// --list-problems also prints, for each record that is not ok, its verdict, namespace and the two opaque id keys
// (UUID-shaped; no file names or owners) so the Supabase source of exactly those records can be checked.
//
// Needs, in the owner's own environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (reads media_storage_locations),
// R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (read access is enough), R2_PRIVATE_BUCKET.
// Rows already retired (cleaned_at set) are skipped. Exit code 1 when any record is missing or differs.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
export class VerifyError extends Error {}

/** Pure: compare one record with what R2 reports. */
export function judge(row, head, bytes) {
  if (!head) return "missing";
  if (row.size_bytes != null && head.size !== Number(row.size_bytes)) return "sizeMismatch";
  if (bytes) {
    if (row.sha256 && createHash("sha256").update(bytes).digest("hex") !== row.sha256) return "hashMismatch";
  }
  return "ok";
}

/** Runs the verification with injected io: rows(), head(key) -> {size}|null, body(key) -> Uint8Array|null. */
export async function verify(io, { deep = false, concurrency = 8, listProblems = false } = {}) {
  const rows = await io.rows();
  const result = { checked: 0, ok: 0, missing: 0, sizeMismatch: 0, hashMismatch: 0, noKey: 0, deep };
  const problems = [];
  const queue = rows.filter((r) => { if (!r.storage_key) { result.noKey++; return false; } return true; });
  let next = 0;
  async function worker() {
    for (;;) {
      const row = queue[next++];
      if (!row) return;
      const head = await io.head(row.storage_key);
      const bytes = deep && head ? await io.body(row.storage_key) : null;
      const verdict = judge(row, head, bytes);
      result.checked++; result[verdict]++;
      if (listProblems && verdict !== "ok") problems.push({ verdict, namespace: row.namespace, object_key: row.object_key, storage_key: row.storage_key });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(queue.length, 1)) }, worker));
  if (listProblems) result.problems = problems;
  return result;
}

export async function main(argv = process.argv.slice(2)) {
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const project = opt("--project"); const deep = argv.includes("--deep"); const listProblems = argv.includes("--list-problems");
  const namespaces = opt("--namespace")?.split(",");
  if (!project) throw new VerifyError("--project <ref> is required");
  const { readMaintenanceEnv } = await import("../frontend/src/lib/env/media-maintenance.mjs");
  const env = readMaintenanceEnv();
  if (new URL(env.SUPABASE_URL).hostname.split(".")[0] !== project) throw new VerifyError("Requested project does not match the configured environment");
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_PRIVATE_BUCKET) throw new VerifyError("R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_PRIVATE_BUCKET are required");
  const { createClient } = require("@supabase/supabase-js");
  const { S3Client, HeadObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const s3 = new S3Client({ region: "auto", forcePathStyle: true, endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY }, maxAttempts: 3 });
  const io = {
    rows: async () => {
      const all = [];
      for (let from = 0; ; from += 1000) {
        let q = supabase.from("media_storage_locations").select("namespace,object_key,storage_key,size_bytes,sha256")
          .eq("provider", "r2").is("cleaned_at", null).order("namespace").order("object_key").range(from, from + 999);
        if (namespaces) q = q.in("namespace", namespaces);
        const { data, error } = await q;
        if (error) throw new VerifyError("Reading the media records failed.");
        all.push(...data);
        if (data.length < 1000) break;
      }
      return all;
    },
    head: async (key) => {
      try { const r = await s3.send(new HeadObjectCommand({ Bucket: env.R2_PRIVATE_BUCKET, Key: key })); return { size: Number(r.ContentLength) }; }
      catch (error) { if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") return null; throw new VerifyError("R2 could not be read (credentials or bucket); nothing was changed."); }
    },
    body: async (key) => {
      const r = await s3.send(new GetObjectCommand({ Bucket: env.R2_PRIVATE_BUCKET, Key: key }));
      return new Uint8Array(await r.Body.transformToByteArray());
    },
  };
  const result = await verify(io, { deep, listProblems });
  console.log(JSON.stringify({ project, ...result }));
  if (result.missing || result.sizeMismatch || result.hashMismatch) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof VerifyError ? error.message : "R2 verification failed; nothing was changed.");
    process.exitCode = 1;
  });
}
