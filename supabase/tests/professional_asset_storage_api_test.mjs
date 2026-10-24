#!/usr/bin/env node
/**
 * The Storage API half of the professional-asset proof (Increments 10 + 11).
 *
 * WHY THIS EXISTS ALONGSIDE pgTAP 47 AND 48.
 *
 * The rules protecting a professional's files live in three places and only one
 * of them is reachable from SQL:
 *
 *   * WHO may write/read/delete — `storage.objects` RLS. pgTAP proves this,
 *     including the absences ("there is no UPDATE policy", "exactly one policy
 *     admits anon") that no amount of HTTP probing could establish.
 *   * WHAT may be stored — `allowed_mime_types` and `file_size_limit`, enforced
 *     by the Storage service from the bucket row BEFORE Postgres is consulted.
 *     No SQL test can observe that; a bucket row that merely *says* `5242880`
 *     proves only that a number is stored.
 *   * WHETHER THE TWO AGREE — the Increment 11 question. Portfolio ownership now
 *     lives in `public.portfolio_items` and Storage consults it through
 *     `security definer` helpers, so "published" has to mean the same thing to a
 *     projection and to a signed URL. Sections F and G are that check, run over
 *     real HTTP as a real anonymous visitor.
 *
 * WHAT CHANGED WITH R2 (ADR-0017). Two Storage doors that this file used to walk
 * through are now shut by design, and the checks follow the authority to where it
 * moved rather than disappearing:
 *
 *   * Finalizing pending -> ready needs a backend verification receipt
 *     (`media_storage_attest`, service role only; enforced by the trigger
 *     `app.require_verified_media`). The harness plays the app server here: it
 *     reads the bytes back with server-only authority, hashes them and attests,
 *     exactly as `verifyPendingMedia` does — and proves a caller cannot.
 *   * Every caller SELECT-shaped Storage operation on the revocable buckets
 *     (signing, downloads, and DELETE, which Storage runs with RETURNING) is
 *     refused by the restrictive policy `revocable_media_backend_reads`. The read
 *     and delete authority is `media_storage_resolve`, called with the CALLER's
 *     identity; only after it admits the caller does the app server touch Storage
 *     with the service role (`deliverMedia`, `removeMedia`). So "X can read" is now
 *     "the resolver admits X AND the backend delivers the exact bytes", and
 *     "X cannot read" is "X's direct sign is refused AND the resolver admits nothing".
 *
 * Run against a running local stack with the standard seeds:
 *
 *   node supabase/tests/professional_asset_storage_api_test.mjs
 *
 * It mints its own HS256 tokens for seeded fixtures rather than driving the OTP
 * flow, because these identities are fixtures and a security assertion should not
 * depend on a mail catcher. NOTHING IT WRITES SURVIVES IT: every object and every
 * metadata row (provider reservations included) is torn down in a `finally`, the one persona it changes is
 * restored there too, and it FAILS if anything is left behind. No binary fixture
 * is committed — the PNG and PDF are generated in memory.
 */

import { createHash, createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

const API = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET ??
  "super-secret-jwt-token-with-at-least-32-characters-long";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
/** The app server's authority. Used ONLY where the app server itself uses it. */
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const PORTFOLIO = "professional-portfolio";
const CERTIFICATES = "professional-certificates";

const INSTALLER_A = "70000009-0000-4000-8000-000000000009";
const INSTALLER_B = "71000006-0000-4000-8000-000000000006";
const CONSUMER = "44444444-4444-4444-8444-444444444444";
/** Business-only identity: null personal persona, holds a membership. */
const BUSINESS_ONLY = "11111111-1111-4111-8111-111111111111";

// ---------------------------------------------------------------------------
let passed = 0;
const failures = [];
/** Everything created during the run, torn down in `finally`. */
const objects = [];
const items = [];
const locations = [];

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`ok   ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const b64url = (input) => Buffer.from(input).toString("base64url");

function token(sub) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      sub, aud: "authenticated", role: "authenticated",
      iss: "supabase-demo", iat: now, exp: now + 3600,
    }),
  );
  const sig = createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function sql(statement) {
  return execFileSync(
    "docker",
    ["exec", "-i", process.env.DB_CONTAINER ?? "supabase_db_aladdin", "psql", "-U", "postgres", "-d", "postgres",
     "-tAX", "-v", "ON_ERROR_STOP=1", "-c", statement],
    { encoding: "utf8" },
  ).trim();
}

/**
 * Every Storage refusal arrives as HTTP 400 carrying a typed body —
 * `{"statusCode":"403","error":"Unauthorized","message":"..."}` (storage-api
 * v1.66). The HTTP status is therefore worthless as an assertion: it is 400 for
 * a policy denial, a rejected MIME type, an oversized body and a duplicate key
 * alike. The body's `statusCode` + `error` pair is the signal.
 *
 * Not a detail. An earlier draft asserted 403 / 415 / 413 / 409 and "failed"
 * eleven times against a system that was refusing every attempt correctly — a
 * suite written from the documentation rather than from the wire. The same thing
 * happened again when Storage replaced the old `code` field (`AccessDenied`,
 * `NoSuchKey`, ...) with this pair: nineteen refusals went on being correct while
 * the checks read a field that no longer exists. REFUSAL keeps the old names at
 * the call sites and pins each to what the wire says today.
 */
const REFUSAL = {
  AccessDenied: ["403", "Unauthorized"],
  NoSuchKey: ["404", "not_found"],
  InvalidMimeType: ["415", "invalid_mime_type"],
  EntityTooLarge: ["413", "Payload too large"],
  KeyAlreadyExists: ["409", "Duplicate"],
};

async function parse(res) {
  const text = await res.text();
  let body = {};
  // `?? {}` matters: a resolver that correctly finds nothing answers with the
  // literal JSON `null`, and that is a SUCCESS worth distinguishing from a
  // parse failure. Reading `.code` off it directly is how this first crashed.
  try { body = JSON.parse(text) ?? {}; } catch { body = { raw: text }; }
  return { status: res.status, statusCode: body.statusCode ?? null, error: body.error ?? null, text };
}

function refusedAs(result, kind) {
  const [statusCode, error] = REFUSAL[kind];
  return result.status !== 200 && result.statusCode === statusCode && result.error === error;
}

async function upload(bucket, path, bytes, contentType, bearer, { upsert = false } = {}) {
  const headers = { apikey: ANON_KEY, "content-type": contentType };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (upsert) headers["x-upsert"] = "true";
  const res = await fetch(`${API}/storage/v1/object/${bucket}/${path}`, {
    method: "POST", headers, body: bytes,
  });
  if (res.status === 200) objects.push([bucket, path]);
  return parse(res);
}

async function sign(bucket, path, bearer, expiresIn = 60) {
  const headers = { apikey: ANON_KEY, "content-type": "application/json" };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const res = await fetch(`${API}/storage/v1/object/sign/${bucket}/${path}`, {
    method: "POST", headers, body: JSON.stringify({ expiresIn }),
  });
  return parse(res);
}

async function remove(bucket, path, bearer) {
  const headers = { apikey: ANON_KEY };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const res = await fetch(`${API}/storage/v1/object/${bucket}/${path}`, { method: "DELETE", headers });
  return parse(res);
}

async function rpc(fn, body, bearer, apikey = ANON_KEY) {
  const headers = { apikey, "content-type": "application/json" };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const res = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
  return parse(res);
}

// --- the R2 contract: caller-scoped authority, server-only Storage ---------

/** The caller-scoped read/delete authority. A JSON descriptor, or null. */
async function resolve(namespace, key, operation, bearer) {
  const r = await rpc("media_storage_resolve",
    { p_namespace: namespace, p_key: key, p_operation: operation }, bearer);
  return r.status === 200 ? JSON.parse(r.text) : { refused: r.text };
}

/** What `authorizeMediaUpload` does for the Supabase provider: the CALLER reserves. */
async function reserve(namespace, key, bearer) {
  const r = await rpc("media_storage_reserve",
    { p_namespace: namespace, p_key: key, p_provider: "supabase" }, bearer);
  if (r.status === 204) locations.push([namespace, key]);
  return r;
}

const attestation = (namespace, key, owner, bytes, contentType) => ({
  p_namespace: namespace, p_key: key, p_owner: owner, p_provider: "supabase",
  p_size: bytes.length, p_content_type: contentType,
  p_sha256: createHash("sha256").update(bytes).digest("hex"),
});

/**
 * What `verifyPendingMedia` does: read the stored bytes with server-only
 * authority, then record a receipt for exactly what was read. The receipt
 * hashes the bytes Storage returned, not the bytes the harness meant to send.
 */
async function backendAttest(namespace, bucket, key, owner, contentType) {
  const bytes = await backendRead(bucket, key);
  if (!bytes) return { status: 0, text: "backend could not read the object" };
  return rpc("media_storage_attest", attestation(namespace, key, owner, bytes, contentType),
    SERVICE_KEY, SERVICE_KEY);
}

/** What `deliverMedia` does once the resolver has admitted the caller. */
async function backendRead(bucket, key) {
  const signed = await sign(bucket, key, SERVICE_KEY);
  if (signed.status !== 200) return null;
  const got = await fetch(`${API}/storage/v1${JSON.parse(signed.text).signedURL}`);
  return got.status === 200 ? Buffer.from(await got.arrayBuffer()) : null;
}

/** What `removeMedia` does: caller-scoped `delete` authority, then server-only removal. */
async function backendRemove(namespace, bucket, key, bearer) {
  const media = await resolve(namespace, key, "delete", bearer);
  if (!media || media.refused) return { status: 0, text: `resolver refused delete: ${JSON.stringify(media)}` };
  const headers = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` };
  return parse(await fetch(`${API}/storage/v1/object/${bucket}/${key}`, { method: "DELETE", headers }));
}

/**
 * "This caller cannot read this object", under the R2 contract: its own direct
 * signature is refused (NoSuchKey, indistinguishable from a key that never
 * existed) AND the read authority admits nothing, so the app server would never
 * fetch it for them.
 */
async function unreachable(namespace, bucket, key, bearer) {
  const direct = await sign(bucket, key, bearer);
  const media = await resolve(namespace, key, "read", bearer);
  return { ok: refusedAs(direct, "NoSuchKey") && media === null,
           detail: `sign: ${direct.text}; resolve: ${JSON.stringify(media)}` };
}

/**
 * A pending portfolio row plus the opaque key it authorizes. This IS the
 * Increment 11 write model: bytes are unreachable until the product has created
 * the row that names them, so the harness cannot invent a key any more than a
 * browser can.
 */
async function newPortfolioItem(bearer, contentType = "image/png") {
  const r = await rpc("portfolio_item_create",
    { p_title: "harness", p_description: null, p_content_type: contentType }, bearer);
  if (r.status !== 200) return null;
  const row = JSON.parse(r.text)[0];
  items.push(["portfolio_items", row.item_id]);
  return row;
}

async function newCertificate(bearer) {
  const r = await rpc("certificate_create",
    { p_title: "harness cert", p_issuer: null, p_issued_on: null,
      p_expires_on: null, p_content_type: "application/pdf", p_original_filename: null }, bearer);
  if (r.status !== 200) return null;
  const row = JSON.parse(r.text)[0];
  items.push(["professional_certificates", row.item_id]);
  return row;
}

// --- generated bytes; no binary fixture is committed -----------------------
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "utf8");
/** 6 MiB: over portfolio's 5 MiB limit, under certificates' 10 MiB. */
const OVERSIZED = Buffer.alloc(6 * 1024 * 1024);

// ---------------------------------------------------------------------------
async function main() {
  const A = token(INSTALLER_A);
  const B = token(INSTALLER_B);
  const consumer = token(CONSUMER);
  const business = token(BUSINESS_ONLY);

  // === A. Fixtures ========================================================
  check("fixture: installer A is a professional persona",
    sql(`select app.is_professional_persona('${INSTALLER_A}')`) === "t");
  check("fixture: the consumer is not",
    sql(`select app.is_professional_persona('${CONSUMER}')`) === "f");
  check("fixture: the business-only identity is not, though it holds a membership",
    sql(`select app.is_professional_persona('${BUSINESS_ONLY}')`) === "f"
    && Number(sql(`select count(*) from public.memberships where user_id='${BUSINESS_ONLY}'`)) > 0);
  check("fixture: installer A's profile is listed, which every public section depends on",
    sql(`select public_profile_status from public.profiles where user_id='${INSTALLER_A}'`) === "listed");

  // === B. Buckets =========================================================
  const buckets = sql(
    `select id || '|' || public || '|' || file_size_limit || '|' || array_to_string(allowed_mime_types, ',')
       from storage.buckets where id in ('${PORTFOLIO}','${CERTIFICATES}') order by id`,
  ).split("\n");
  check("bucket: both exist after reset", buckets.length === 2, buckets.join(" / "));
  check("bucket: certificates is private, 10 MiB, pdf + three image types",
    buckets[0] === `${CERTIFICATES}|false|10485760|application/pdf,image/jpeg,image/png,image/webp`,
    buckets[0]);
  check("bucket: portfolio is private, 5 MiB, three image types and no pdf",
    buckets[1] === `${PORTFOLIO}|false|5242880|image/jpeg,image/png,image/webp`, buckets[1]);
  check("bucket: BOTH stay private even though one is publicly readable — publication is a metadata fact, never a bucket setting (S1)",
    buckets.every((b) => b.includes("|false|")));

  // === C. Portfolio writes, now gated on metadata =========================
  const item = await newPortfolioItem(A);
  check("write: a professional creates a portfolio item and receives an opaque key", item !== null);
  check("write: the key carries NO owner id and no separator — the whole reason it changed",
    item !== null && !item.object_key.includes("/") && !item.object_key.includes(INSTALLER_A),
    item?.object_key);
  check("write: the owner reserves its Supabase location first, as the app server does before any upload",
    (await reserve("portfolio", item.object_key, A)).status === 204);
  check("write: the authorized bytes are accepted",
    (await upload(PORTFOLIO, item.object_key, PNG, "image/png", A)).status === 200);

  // A well-formed key with no row behind it. Under Increment 10 the shape alone
  // was sufficient; now the product must have authorized this exact object.
  const unauthorized = await upload(PORTFOLIO, `${randomUUID()}.png`, PNG, "image/png", A);
  check("write: an invented key is refused even from the same professional — no pending row authorizes it",
    refusedAs(unauthorized, "AccessDenied"), unauthorized.text);
  const oldShape = await upload(PORTFOLIO, `${INSTALLER_A}/${randomUUID()}.png`, PNG, "image/png", A);
  check("write: the Increment 10 owner-prefixed shape is refused too, so the old contract cannot creep back",
    refusedAs(oldShape, "AccessDenied"), oldShape.text);

  const otherItem = await newPortfolioItem(B);
  const crossUser = await upload(PORTFOLIO, otherItem.object_key, PNG, "image/png", A);
  check("write: A cannot upload into the object B's row authorizes",
    refusedAs(crossUser, "AccessDenied"), crossUser.text);

  const consumerItem = await rpc("portfolio_item_create",
    { p_title: "x", p_description: null, p_content_type: "image/png" }, consumer);
  check("write: a consumer cannot even create the row, so there is no key to upload to",
    consumerItem.status !== 200, consumerItem.text);
  const businessItem = await rpc("portfolio_item_create",
    { p_title: "x", p_description: null, p_content_type: "image/png" }, business);
  check("write: nor a business-only identity — organization membership is not a persona",
    businessItem.status !== 200, businessItem.text);
  const anonItem = await rpc("portfolio_item_create",
    { p_title: "x", p_description: null, p_content_type: "image/png" }, null);
  check("write: nor an anonymous caller", anonItem.status !== 200, anonItem.text);

  // Bucket-level rules, exercised through a genuinely authorized row so RLS is
  // not what refuses them. This is the layer only HTTP can reach.
  const spare = await newPortfolioItem(A);
  const svg = await upload(PORTFOLIO, spare.object_key, PNG, "image/svg+xml", A);
  check("write: an SVG content type is refused by the BUCKET, on a key RLS would have allowed",
    refusedAs(svg, "InvalidMimeType"), svg.text);
  const pdfIn = await upload(PORTFOLIO, spare.object_key, PDF, "application/pdf", A);
  check("write: a PDF is refused by the portfolio bucket though certificates take one (S4)",
    refusedAs(pdfIn, "InvalidMimeType"), pdfIn.text);
  const oversized = await upload(PORTFOLIO, spare.object_key, OVERSIZED, "image/png", A);
  check("write: 6 MiB is refused by portfolio's 5 MiB limit",
    refusedAs(oversized, "EntityTooLarge"), oversized.text);

  const duplicate = await upload(PORTFOLIO, item.object_key, PNG, "image/png", A);
  check("write: re-posting an existing key is a conflict, not a silent overwrite",
    refusedAs(duplicate, "KeyAlreadyExists"), duplicate.text);
  const upsert = await upload(PORTFOLIO, item.object_key, PNG, "image/png", A, { upsert: true });
  check("write: explicit upsert is refused by the still-absent UPDATE policy",
    refusedAs(upsert, "AccessDenied"), upsert.text);

  // === D. Certificates keep Increment 10's contract, unchanged ============
  const cert = await newCertificate(A);
  check("certificate: a professional creates one and receives an OWNER-PREFIXED path — this contract did not change",
    cert !== null && cert.object_path.startsWith(`${INSTALLER_A}/`), cert?.object_path);
  check("certificate: its bytes are accepted",
    (await upload(CERTIFICATES, cert.object_path, PDF, "application/pdf", A)).status === 200);
  const bigCert = await newCertificate(A);
  const certSize = await upload(CERTIFICATES, bigCert.object_path, OVERSIZED, "application/pdf", A);
  check("certificate: 6 MiB is accepted here — limits are per namespace, which is why there are two buckets",
    certSize.status === 200, certSize.text);

  // === E. Owner reads ===================================================
  // R2: no browser receives a durable provider read URL (ADR-0017), the owner
  // included. The owner's right to read moved to the resolver plus the backend.
  const ownSigned = await sign(PORTFOLIO, item.object_key, A);
  check("read: the owner can no longer sign their own object directly — direct provider URLs are gone for everyone",
    refusedAs(ownSigned, "NoSuchKey"), ownSigned.text);
  const ownRead = await resolve("portfolio", item.object_key, "read", A);
  check("read: the read authority admits the owner, naming them as owner",
    ownRead?.owner === INSTALLER_A && ownRead?.provider === "supabase", JSON.stringify(ownRead));
  const ownBytes = await backendRead(PORTFOLIO, item.object_key);
  check("read: and the bytes the backend delivers round-trip unchanged",
    ownBytes !== null && ownBytes.equals(PNG));
  const other = await unreachable("portfolio", PORTFOLIO, item.object_key, B);
  check("read: another professional cannot sign it, and gets NoSuchKey — a refusal is indistinguishable from a key that never existed",
    other.ok, other.detail);
  const otherCert = await unreachable("certificate", CERTIFICATES, cert.object_path, B);
  check("read: nor reach A's CERTIFICATE", otherCert.ok, otherCert.detail);
  const orgCert = await unreachable("certificate", CERTIFICATES, cert.object_path, business);
  check("read: nor can an organization identity reach it through membership", orgCert.ok, orgCert.detail);

  // === F. The public door: private stays private ==========================
  const anonPrivate = await unreachable("portfolio", PORTFOLIO, item.object_key, null);
  check("public: an anonymous caller cannot sign a PRIVATE portfolio object", anonPrivate.ok, anonPrivate.detail);
  const anonCert = await unreachable("certificate", CERTIFICATES, cert.object_path, null);
  check("public: nor a certificate, ever", anonCert.ok, anonCert.detail);

  for (const [label, bucket, path] of [
    ["portfolio", PORTFOLIO, item.object_key],
    ["certificate", CERTIFICATES, cert.object_path],
  ]) {
    const pub = await fetch(`${API}/storage/v1/object/public/${bucket}/${path}`);
    check(`public: the public object route serves no ${label} — both buckets are private`,
      pub.status !== 200, `status ${pub.status}`);
  }

  // R2: pending -> ready is gated on a backend receipt for the stored bytes.
  const unverified = await rpc("portfolio_item_finalize", { p_item_id: item.item_id }, A);
  check("verify: finalize WITHOUT a backend receipt is refused — bytes nobody has inspected never become ready",
    unverified.status !== 204, unverified.text);
  const selfAttest = await rpc("media_storage_attest",
    attestation("portfolio", item.object_key, INSTALLER_A, PNG, "image/png"), A);
  check("verify: and the owner cannot write that receipt for themselves — attestation is backend-only",
    selfAttest.status !== 204, selfAttest.text);
  const attested = await backendAttest("portfolio", PORTFOLIO, item.object_key, INSTALLER_A, "image/png");
  check("verify: the backend attests the bytes it read back, as verifyPendingMedia does",
    attested.status === 204, attested.text);

  check("public: finalize succeeds",
    (await rpc("portfolio_item_finalize", { p_item_id: item.item_id }, A)).status === 204);
  const readyPrivate = await unreachable("portfolio", PORTFOLIO, item.object_key, null);
  check("public: a READY but private object is still unreachable — bytes existing is not a decision to show them",
    readyPrivate.ok, readyPrivate.detail);

  // === G. The public door: published means published ======================
  check("public: publish succeeds",
    (await rpc("portfolio_item_set_visibility",
      { p_item_id: item.item_id, p_public: true }, A)).status === 204);

  const resolved = await rpc("public_portfolio_media_key", { p_item_id: item.item_id }, null);
  check("public: an ANONYMOUS caller resolves the published item to its opaque key",
    resolved.status === 200 && JSON.parse(resolved.text) === item.object_key, resolved.text);
  check("public: and that key discloses no owner — the property the whole redesign bought",
    !String(JSON.parse(resolved.text || '""')).includes(INSTALLER_A));

  // Published still means no bearer URL: the app route serves the bytes.
  const anonPublished = await sign(PORTFOLIO, item.object_key, null);
  check("public: the anonymous caller still cannot sign it — publication grants a delivery, never a provider URL",
    refusedAs(anonPublished, "NoSuchKey"), anonPublished.text);
  const anonRead = await resolve("portfolio", item.object_key, "read", null);
  check("public: the read authority admits the anonymous caller, and names no owner to them",
    anonRead !== null && !anonRead.refused && anonRead.state === "ready" && anonRead.owner === null,
    JSON.stringify(anonRead));
  const anonBytes = anonRead?.state === "ready" ? await backendRead(PORTFOLIO, item.object_key) : null;
  check("public: and receives the real bytes, with no credential and no session",
    anonBytes !== null && anonBytes.equals(PNG));

  const certViaPortfolio = await rpc("public_portfolio_media_key", { p_item_id: cert.item_id }, null);
  check("public: A CERTIFICATE ID RESOLVES TO NOTHING through the portfolio media path — it is not in that table at all",
    certViaPortfolio.status === 200 && JSON.parse(certViaPortfolio.text) === null, certViaPortfolio.text);

  // B's item takes the whole real path to ready: reserve, upload, attest, finalize.
  const bReady = (await reserve("portfolio", otherItem.object_key, B)).status === 204
    && (await upload(PORTFOLIO, otherItem.object_key, PNG, "image/png", B)).status === 200
    && (await backendAttest("portfolio", PORTFOLIO, otherItem.object_key, INSTALLER_B, "image/png")).status === 204
    && (await rpc("portfolio_item_finalize", { p_item_id: otherItem.item_id }, B)).status === 204;
  const bPrivate = await unreachable("portfolio", PORTFOLIO, otherItem.object_key, null);
  check("public: B's unpublished item stays unreachable to anon even after finalize",
    bReady && bPrivate.ok, `ready: ${bReady}; ${bPrivate.detail}`);

  // Delisting withdraws the photo without touching what the owner chose.
  sql(`update public.profiles set public_profile_status='hidden' where user_id='${INSTALLER_A}'`);
  const delisted = await unreachable("portfolio", PORTFOLIO, item.object_key, null);
  check("public: DELISTING the profile withdraws the object immediately", delisted.ok, delisted.detail);
  check("public: while the owner's saved visibility is untouched",
    sql(`select visibility from public.portfolio_items where id='${item.item_id}'`) === "public");
  sql(`update public.profiles set public_profile_status='listed' where user_id='${INSTALLER_A}'`);
  const relisted = await resolve("portfolio", item.object_key, "read", null);
  check("public: relisting restores exactly what they had chosen",
    relisted?.state === "ready", JSON.stringify(relisted));

  // === H. Deletion converges ==============================================
  // R2: Storage runs DELETE with RETURNING, so the restrictive SELECT policy
  // refuses every caller's direct delete; removal is resolver-gated, server-only.
  const crossDelete = await remove(PORTFOLIO, item.object_key, B);
  const crossAuthority = await resolve("portfolio", item.object_key, "delete", B);
  check("delete: another professional cannot delete it — directly, nor through the delete authority",
    refusedAs(crossDelete, "AccessDenied") && crossAuthority === null,
    `${crossDelete.text}; resolve: ${JSON.stringify(crossAuthority)}`);
  const liveDelete = await resolve("portfolio", item.object_key, "delete", A);
  check("delete: nor may the owner remove bytes that are still live — product revocation always comes first",
    liveDelete === null, JSON.stringify(liveDelete));
  check("delete: the owner withdraws it, which stops visibility in Postgres first",
    (await rpc("portfolio_item_delete", { p_item_id: item.item_id }, A)).status === 204);
  const shut = await unreachable("portfolio", PORTFOLIO, item.object_key, null);
  check("delete: and the public door shuts in the same instant, before Storage is asked anything",
    shut.ok, shut.detail);
  const ownerDirect = await remove(PORTFOLIO, item.object_key, A);
  check("delete: the owner's own direct Storage delete is refused too — removal is server-only now",
    refusedAs(ownerDirect, "AccessDenied"), ownerDirect.text);
  const ownerRemoved = await backendRemove("portfolio", PORTFOLIO, item.object_key, A);
  check("delete: but the owner can still have the object removed, because the delete authority admits the owner of a deleted row",
    ownerRemoved.status === 200, ownerRemoved.text);
  check("delete: purge then removes the row",
    (await rpc("portfolio_item_purge", { p_item_id: item.item_id }, A)).status === 204);
  check("delete: and purge is silent on a second run — the last step of a convergent sequence must repeat safely",
    (await rpc("portfolio_item_purge", { p_item_id: item.item_id }, A)).status === 204);
  check("delete: nothing of that item survives in either system",
    sql(`select count(*) from public.portfolio_items where id='${item.item_id}'`) === "0"
    && sql(`select count(*) from storage.objects where bucket_id='${PORTFOLIO}' and name='${item.object_key}'`) === "0");
  check("delete: removing an already-removed object answers NoSuchKey, which the helper folds into success",
    refusedAs(await remove(PORTFOLIO, item.object_key, A), "NoSuchKey"));

  // === I. Downgrade =======================================================
  const restore = sql(
    `select coalesce(primary_account_type::text,'NULL') from public.users where id='${INSTALLER_A}'`);
  try {
    sql(`update public.users set primary_account_type='end_consumer' where id='${INSTALLER_A}'`);
    sql(`delete from public.individual_onboarding where user_id='${INSTALLER_A}'`);
    check("downgrade: the identity is no longer a professional persona",
      sql(`select app.is_professional_persona('${INSTALLER_A}')`) === "f");
    check("downgrade: no NEW portfolio work may be created",
      (await rpc("portfolio_item_create",
        { p_title: "x", p_description: null, p_content_type: "image/png" }, A)).status !== 200);
    check("downgrade: and no new certificate",
      (await rpc("certificate_create", { p_title: "x", p_issuer: null, p_issued_on: null,
        p_expires_on: null, p_content_type: "application/pdf", p_original_filename: null }, A)).status !== 200);
    const heldCert = await resolve("certificate", cert.object_path, "read", A);
    const heldBytes = heldCert?.owner === INSTALLER_A ? await backendRead(CERTIFICATES, cert.object_path) : null;
    check("downgrade: but the certificate they already hold is still readable by them",
      heldBytes !== null && heldBytes.equals(PDF), JSON.stringify(heldCert));
    const withdrawn = await rpc("certificate_delete", { p_item_id: cert.item_id }, A);
    const certRemoved = await backendRemove("certificate", CERTIFICATES, cert.object_path, A);
    check("downgrade: and still deletable — personal data is never held hostage to a persona value",
      withdrawn.status === 204 && certRemoved.status === 200, `${withdrawn.text}; ${certRemoved.text}`);
  } finally {
    sql(restore === "NULL"
      ? `update public.users set primary_account_type=null where id='${INSTALLER_A}'`
      : `update public.users set primary_account_type='${restore}' where id='${INSTALLER_A}'`);
  }
}

// ---------------------------------------------------------------------------
try {
  await main();
} finally {
  const admin = SERVICE_KEY;
  for (const [bucket, path] of objects) {
    await fetch(`${API}/storage/v1/object/${bucket}/${path}`, {
      method: "DELETE", headers: { apikey: admin, authorization: `Bearer ${admin}` },
    }).catch(() => {});
  }
  for (const [table, id] of items) sql(`delete from public.${table} where id='${id}'`);
  for (const [namespace, key] of locations) {
    sql(`delete from public.media_storage_locations where namespace='${namespace}' and object_key='${key}'`);
  }

  const leftObjects = sql(
    `select count(*) from storage.objects where bucket_id in ('${PORTFOLIO}','${CERTIFICATES}')`);
  const leftRows = sql(
    `select (select count(*) from public.portfolio_items) + (select count(*) from public.professional_certificates)
          + (select count(*) from public.media_storage_locations where namespace in ('portfolio','certificate'))`);
  console.log(`\n--- teardown: ${objects.length} objects and ${items.length + locations.length} rows created; ` +
    `${leftObjects} objects and ${leftRows} rows left behind`);
  console.log(`--- ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`    FAIL ${f}`);
  process.exitCode =
    failures.length === 0 && leftObjects === "0" && leftRows === "0" ? 0 : 1;
}
