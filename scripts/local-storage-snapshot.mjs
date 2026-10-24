#!/usr/bin/env node
/**
 * Local Supabase Storage snapshot — backup / verify / restore THROUGH THE STORAGE API.
 *
 * WHY NOT COPY THE STORAGE VOLUME. The local Storage service keeps each object's
 * metadata (content type, cache control, …) in the file's EXTENDED ATTRIBUTES. A
 * plain `cp -a` between Docker volumes (as done in the Migration 07 session) drops
 * them: the rows in `storage.objects` survive, the bytes survive, and every GET then
 * fails with 500 `ENODATA` ("The extended attribute does not exist"). Going through
 * the Storage API makes Storage itself write the metadata, so nothing is lost.
 *
 *   node scripts/local-storage-snapshot.mjs backup  <dir>      read-only
 *   node scripts/local-storage-snapshot.mjs verify  <dir>      read-only
 *   node scripts/local-storage-snapshot.mjs restore <dir>      upserts objects
 *
 * Environment (all optional, LOCAL ONLY — a non-local URL is refused):
 *   SUPABASE_URL          default http://127.0.0.1:54421   (the isolated aladdin-marketplace stack)
 *   DB_CONTAINER          default supabase_db_aladdin-marketplace
 *   SUPABASE_JWT_SECRET   default the published local-dev secret (used to mint a service token)
 *   RESTORE_BUCKET_MAP    "from:to,from2:to2" — restore into different buckets (used to test the
 *                         procedure against a disposable bucket without touching real objects)
 *
 * The manifest records, per object: bucket, name, size, content type, cache control and
 * SHA-256, so `verify` proves bytes AND metadata. Object ROWS come back with the database
 * snapshot (see docs/guides/local-supabase-qa-backup-restore.md); `restore` re-creates
 * the FILES with valid metadata and fails loudly if the rows or checksums disagree.
 */
import { createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const API = process.env.SUPABASE_URL ?? "http://127.0.0.1:54421";
if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(API)) {
  console.error(`Refusing to run against a non-local URL: ${API}`);
  process.exit(2);
}
const DB = process.env.DB_CONTAINER ?? "supabase_db_aladdin-marketplace";
const SECRET = process.env.SUPABASE_JWT_SECRET ?? "super-secret-jwt-token-with-at-least-32-characters-long";
const MAP = Object.fromEntries((process.env.RESTORE_BUCKET_MAP ?? "").split(",").filter(Boolean).map((p) => p.split(":")));

const b64 = (s) => Buffer.from(s).toString("base64url");
function serviceToken() {
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64(JSON.stringify({ role: "service_role", iss: "supabase-demo", iat: now, exp: now + 3600 }));
  return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
}
const TOKEN = serviceToken();
const H = { apikey: TOKEN, authorization: `Bearer ${TOKEN}` };
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const psql = (q) =>
  execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-tAX", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();
const objectUrl = (bucket, name) => `${API}/storage/v1/object/${bucket}/${name.split("/").map(encodeURIComponent).join("/")}`;
const [mode, dir] = process.argv.slice(2);
if (!["backup", "verify", "restore"].includes(mode) || !dir) {
  console.error("usage: local-storage-snapshot.mjs <backup|verify|restore> <dir>");
  process.exit(2);
}
const manifestPath = join(dir, "manifest.json");
let problems = 0;
const bad = (m) => { problems += 1; console.log(`FAIL ${m}`); };

async function fetchObject(bucket, name) {
  const r = await fetch(objectUrl(bucket, name), { headers: H });
  return { status: r.status, type: r.headers.get("content-type"), buf: Buffer.from(await r.arrayBuffer()) };
}

if (mode === "backup") {
  const rows = psql(
    "select bucket_id, name, coalesce(metadata->>'size','')," +
      " coalesce(metadata->>'mimetype',''), coalesce(metadata->>'cacheControl','') from storage.objects order by bucket_id, name",
  ).split("\n").filter(Boolean).map((l) => l.split("\t"));
  const objects = [];
  for (const [bucket, name, size, mimetype, cacheControl] of rows) {
    const o = await fetchObject(bucket, name);
    if (o.status !== 200) { bad(`${bucket}/${name}: GET ${o.status} (broken object — metadata or bytes missing)`); continue; }
    if (size && o.buf.length !== Number(size)) { bad(`${bucket}/${name}: served ${o.buf.length} bytes, row says ${size}`); continue; }
    const file = join("objects", bucket, ...name.split("/"));
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), o.buf);
    objects.push({ bucket, name, size: o.buf.length, mimetype, cacheControl, sha256: sha256(o.buf), file });
    console.log(`ok   backed up ${bucket}/${name} (${o.buf.length} bytes)`);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify({ createdAt: new Date().toISOString(), api: API, objects }, null, 2));
  console.log(`\n${objects.length} object(s) written to ${dir}`);
} else {
  if (!existsSync(manifestPath)) { console.error(`no manifest at ${manifestPath}`); process.exit(2); }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const o of manifest.objects) {
    const bytes = readFileSync(join(dir, o.file));
    if (sha256(bytes) !== o.sha256) { bad(`${o.bucket}/${o.name}: the backup file itself is corrupt`); continue; }
    const target = mode === "restore" ? (MAP[o.bucket] ?? o.bucket) : o.bucket;
    if (mode === "restore") {
      const r = await fetch(objectUrl(target, o.name), {
        method: "POST",
        headers: { ...H, "content-type": o.mimetype || "application/octet-stream", "x-upsert": "true", ...(o.cacheControl ? { "cache-control": o.cacheControl } : {}) },
        body: bytes,
      });
      if (r.status !== 200) { bad(`${target}/${o.name}: restore upload answered ${r.status} ${(await r.text()).slice(0, 120)}`); continue; }
    }
    const live = await fetchObject(target, o.name);
    const ok = live.status === 200 && sha256(live.buf) === o.sha256 && live.buf.length === o.size
      && (!o.mimetype || (live.type ?? "").startsWith(o.mimetype));
    if (ok) console.log(`ok   ${mode === "restore" ? "restored and verified" : "verified"} ${target}/${o.name}`);
    else bad(`${target}/${o.name}: GET ${live.status}, ${live.buf.length} bytes, type ${live.type} (expected ${o.size} bytes, ${o.mimetype}, sha256 ${o.sha256.slice(0, 12)}…)`);
    if (mode === "verify") {
      const n = psql(`select count(*) from storage.objects where bucket_id='${o.bucket}' and name='${o.name.replace(/'/g, "''")}'`);
      if (n !== "1") bad(`${o.bucket}/${o.name}: no storage.objects row (restore the database snapshot first)`);
    }
  }
  const unlisted = psql("select bucket_id||'/'||name from storage.objects order by 1").split("\n").filter(Boolean)
    .filter((k) => mode === "restore" ? false : !manifest.objects.some((o) => `${o.bucket}/${o.name}` === k));
  if (mode === "verify" && unlisted.length) console.log(`note: ${unlisted.length} object(s) exist now that are not in the backup: ${unlisted.join(", ")}`);
  console.log(`\n${mode}: ${manifest.objects.length - problems} ok, ${problems} problem(s)`);
}
process.exit(problems ? 1 : 0);
