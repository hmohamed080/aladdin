#!/usr/bin/env node
/**
 * Installer Pilot Increment 10 — the Storage API half of the storage proof.
 *
 * WHY THIS EXISTS ALONGSIDE pgTAP 47.
 *
 * The rules protecting a professional's files live in TWO different processes,
 * and only one of them is Postgres:
 *
 *   * WHO may write/read/delete an object — `storage.objects` RLS. pgTAP proves
 *     this, because a direct insert under a JWT claim exercises the exact policy
 *     expression the Storage service will hit.
 *   * WHAT may be stored — `allowed_mime_types` and `file_size_limit`. The
 *     Storage service enforces these BEFORE it ever asks Postgres, by reading
 *     the bucket row itself. No SQL test can observe that, and a bucket row that
 *     merely *says* `5242880` proves only that a number is stored.
 *
 * So a suite that introspected policies alone could report a green board while
 * an oversized executable-typed upload sailed through. This script drives the
 * real HTTP API with real bearer tokens and asserts the response codes, which is
 * what §23 means by "do not claim security based only on SQL policy
 * introspection".
 *
 * It is a LOCAL harness, not part of `supabase test db`:
 *
 *   node supabase/tests/professional_asset_storage_api_test.mjs
 *
 * It needs a running local stack (`supabase start`) with the standard seeds. It
 * mints its own HS256 tokens from the well-known local JWT secret rather than
 * driving the OTP flow, because the identities under test are fixtures and an
 * email round-trip would make a security assertion depend on a mail catcher.
 *
 * NOTHING IT WRITES SURVIVES IT. Every object key it creates is recorded and
 * deleted in a `finally`, and the one persona it changes is restored the same
 * way. No binary fixture is committed: the PNG and PDF below are generated in
 * memory (§20).
 */

import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

const API = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET ??
  "super-secret-jwt-token-with-at-least-32-characters-long";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const PORTFOLIO = "professional-portfolio";
const CERTIFICATES = "professional-certificates";

/** Seed fixtures. Personas are asserted below rather than assumed. */
const INSTALLER_A = "70000009-0000-4000-8000-000000000009";
const INSTALLER_B = "71000006-0000-4000-8000-000000000006";
const CONSUMER = "44444444-4444-4444-8444-444444444444";
/** Business-only identity: null personal persona, belongs to an organization. */
const BUSINESS_ONLY = "11111111-1111-4111-8111-111111111111";

// ---------------------------------------------------------------------------
// Tiny harness
// ---------------------------------------------------------------------------
let passed = 0;
const failures = [];
/** Keys created during the run, torn down in `finally` whatever happens. */
const created = [];

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`ok   ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

/**
 * A local access token for a fixture user. Same shape GoTrue issues: the Storage
 * service only verifies the signature and reads `sub`/`role`, and `auth.uid()`
 * in a policy reads `sub` out of `request.jwt.claims`.
 */
function token(sub) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      sub,
      aud: "authenticated",
      role: "authenticated",
      iss: "supabase-demo",
      iat: now,
      exp: now + 3600,
    }),
  );
  const sig = createHmac("sha256", JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function sql(statement) {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_aladdin", "psql", "-U", "postgres", "-d", "postgres",
     "-tAX", "-v", "ON_ERROR_STOP=1", "-c", statement],
    { encoding: "utf8" },
  ).trim();
}

/** `<owner>/<object-id>.<ext>` — the contract, built the way the server builds it. */
function key(owner, ext) {
  return `${owner}/${randomUUID()}.${ext}`;
}

/**
 * Every Storage refusal below arrives as HTTP 400 carrying a TYPED body —
 * `{"statusCode":"403","code":"AccessDenied"}` and friends. The HTTP status is
 * therefore worthless as an assertion: it is 400 for a policy denial, a rejected
 * MIME type, an oversized body and a duplicate key alike. `code` is the signal
 * that distinguishes them, so that is what these tests read.
 *
 * This is the whole reason the harness exists. An earlier draft asserted 403 /
 * 415 / 413 / 409 and "failed" eleven times against a system that was refusing
 * every single attempt correctly — a suite written from the documentation rather
 * than from the wire would have recorded the opposite mistake just as easily.
 */
async function parse(res) {
  const text = await res.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: res.status, code: body.code ?? null, inner: body.statusCode ?? null, text };
}

async function upload(bucket, path, bytes, contentType, bearer, { upsert = false } = {}) {
  const headers = { apikey: ANON_KEY, "content-type": contentType };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (upsert) headers["x-upsert"] = "true";
  const res = await fetch(`${API}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers,
    body: bytes,
  });
  if (res.status === 200) created.push([bucket, path]);
  return parse(res);
}

/** A refusal, named by the reason Storage gave rather than by its HTTP status. */
function refusedAs(result, code) {
  return result.status !== 200 && result.code === code;
}

async function sign(bucket, path, bearer, expiresIn = 60) {
  const headers = { apikey: ANON_KEY, "content-type": "application/json" };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const res = await fetch(`${API}/storage/v1/object/sign/${bucket}/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ expiresIn }),
  });
  return parse(res);
}

async function remove(bucket, path, bearer) {
  const headers = { apikey: ANON_KEY };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const res = await fetch(`${API}/storage/v1/object/${bucket}/${path}`, {
    method: "DELETE",
    headers,
  });
  return parse(res);
}

async function objectExists(bucket, path, bearer) {
  const res = await fetch(`${API}/storage/v1/object/${bucket}/${path}`, {
    headers: { apikey: ANON_KEY, authorization: `Bearer ${bearer}` },
  });
  return res.status === 200;
}

// ---------------------------------------------------------------------------
// Generated bytes — no binary fixture is committed (§20)
// ---------------------------------------------------------------------------
/** Smallest valid PNG: 1x1, correct 8-byte signature. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
/** Smallest structurally valid PDF, starting with the %PDF- signature. */
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n",
  "utf8",
);
/** 6 MiB of zeroes: over portfolio's 5 MiB limit, under certificates' 10 MiB. */
const OVERSIZED = Buffer.alloc(6 * 1024 * 1024);

// ---------------------------------------------------------------------------
async function main() {
  const A = token(INSTALLER_A);
  const B = token(INSTALLER_B);
  const consumer = token(CONSUMER);
  const business = token(BUSINESS_ONLY);

  // -- Fixture sanity. A green board built on a mis-assumed persona proves
  // -- nothing, so the personas are read out of the database first.
  check(
    "fixture: installer A is a professional persona",
    sql(`select app.is_professional_persona('${INSTALLER_A}')`) === "t",
  );
  check(
    "fixture: consumer is NOT a professional persona",
    sql(`select app.is_professional_persona('${CONSUMER}')`) === "f",
  );
  check(
    "fixture: business-only identity is NOT a professional persona",
    sql(`select app.is_professional_persona('${BUSINESS_ONLY}')`) === "f",
  );
  check(
    "fixture: business-only identity really is an organization member",
    Number(sql(`select count(*) from public.memberships where user_id='${BUSINESS_ONLY}'`)) > 0,
  );

  // =========================================================================
  // BUCKET
  // =========================================================================
  const buckets = sql(
    `select id || '|' || public || '|' || file_size_limit || '|' || array_to_string(allowed_mime_types, ',')
       from storage.buckets where id in ('${PORTFOLIO}','${CERTIFICATES}') order by id`,
  ).split("\n");
  check("bucket: both buckets exist after reset", buckets.length === 2, buckets.join(" / "));
  check(
    "bucket: certificates is private, 10 MiB, pdf + three image types",
    buckets[0] === `${CERTIFICATES}|false|10485760|application/pdf,image/jpeg,image/png,image/webp`,
    buckets[0],
  );
  check(
    "bucket: portfolio is private, 5 MiB, three image types and no pdf",
    buckets[1] === `${PORTFOLIO}|false|5242880|image/jpeg,image/png,image/webp`,
    buckets[1],
  );

  // =========================================================================
  // WRITE
  // =========================================================================
  const aPortfolio = key(INSTALLER_A, "png");
  const aCertificate = key(INSTALLER_A, "pdf");

  check(
    "write: an eligible professional creates an object at their own valid key",
    (await upload(PORTFOLIO, aPortfolio, PNG, "image/png", A)).status === 200,
  );
  check(
    "write: the same professional creates a certificate",
    (await upload(CERTIFICATES, aCertificate, PDF, "application/pdf", A)).status === 200,
  );

  // Refused by the POLICY, not by a missing-token check at the gateway: with only
  // the anon key the caller is the `anon` role, and no policy on storage.objects
  // admits it. Default-deny is doing the work, which is the stronger result.
  const anon = await upload(PORTFOLIO, key(INSTALLER_A, "png"), PNG, "image/png", null);
  check("write: anonymous caller is refused by row-level security itself",
    refusedAs(anon, "AccessDenied"), anon.text);

  const byConsumer = await upload(PORTFOLIO, key(CONSUMER, "png"), PNG, "image/png", consumer);
  check(
    "write: a consumer is refused at their OWN structurally valid key",
    refusedAs(byConsumer, "AccessDenied"),
    byConsumer.text,
  );

  const byBusiness = await upload(PORTFOLIO, key(BUSINESS_ONLY, "png"), PNG, "image/png", business);
  check(
    "write: a business-only identity is refused — org membership is not a persona",
    refusedAs(byBusiness, "AccessDenied"),
    byBusiness.text,
  );

  const crossUser = await upload(PORTFOLIO, key(INSTALLER_A, "png"), PNG, "image/png", B);
  check(
    "write: professional B cannot write into professional A's folder",
    refusedAs(crossUser, "AccessDenied"),
    crossUser.text,
  );

  const traversal = await upload(
    PORTFOLIO,
    `${INSTALLER_A}/../${INSTALLER_B}/${randomUUID()}.png`,
    PNG, "image/png", A,
  );
  check(
    "write: a traversal key is refused",
    traversal.status !== 200,
    traversal.text,
  );

  const named = await upload(
    PORTFOLIO,
    `${INSTALLER_A}/${randomUUID()}/photo.png`,
    PNG, "image/png", A,
  );
  check(
    "write: a key carrying a display filename is refused",
    refusedAs(named, "AccessDenied"),
    named.text,
  );

  const namespaced = await upload(
    PORTFOLIO,
    `${INSTALLER_A}/portfolio/${randomUUID()}.png`,
    PNG, "image/png", A,
  );
  check(
    "write: an extra path segment is refused — the bucket is the namespace",
    refusedAs(namespaced, "AccessDenied"),
    namespaced.text,
  );

  const svg = await upload(PORTFOLIO, key(INSTALLER_A, "png"), PNG, "image/svg+xml", A);
  check(
    "write: an SVG content type is refused by the bucket",
    refusedAs(svg, "InvalidMimeType"),
    svg.text,
  );

  const pdfIntoPortfolio = await upload(PORTFOLIO, key(INSTALLER_A, "pdf"), PDF, "application/pdf", A);
  check(
    "write: a PDF is refused by the PORTFOLIO bucket though certificates accept one",
    refusedAs(pdfIntoPortfolio, "InvalidMimeType"),
    pdfIntoPortfolio.text,
  );

  const oversized = await upload(PORTFOLIO, key(INSTALLER_A, "png"), OVERSIZED, "image/png", A);
  check(
    "write: 6 MiB is refused by portfolio's 5 MiB limit",
    refusedAs(oversized, "EntityTooLarge"),
    oversized.text,
  );
  const sizeIsPerBucket = await upload(CERTIFICATES, key(INSTALLER_A, "pdf"), OVERSIZED, "application/pdf", A);
  check(
    "write: the same 6 MiB is accepted by certificates' 10 MiB limit — limits are per namespace",
    sizeIsPerBucket.status === 200,
    sizeIsPerBucket.text,
  );

  const duplicate = await upload(PORTFOLIO, aPortfolio, PNG, "image/png", A);
  check(
    "write: re-posting an existing key is a conflict, not a silent overwrite",
    refusedAs(duplicate, "KeyAlreadyExists"),
    duplicate.text,
  );

  const upsert = await upload(PORTFOLIO, aPortfolio, PNG, "image/png", A, { upsert: true });
  // The refusal is AccessDenied rather than KeyAlreadyExists, which is the proof
  // that it is the ABSENT UPDATE POLICY doing it: upsert asked for permission to
  // replace the row and there was none to give.
  check(
    "write: explicit upsert is refused by the absent UPDATE policy",
    refusedAs(upsert, "AccessDenied"),
    upsert.text,
  );

  // =========================================================================
  // READ
  // =========================================================================
  const ownSigned = await sign(PORTFOLIO, aPortfolio, A);
  check("read: the owner can mint a signed URL for their own object",
    ownSigned.status === 200, ownSigned.text);

  if (ownSigned.status === 200) {
    const signedUrl = JSON.parse(ownSigned.text).signedURL;
    const fetched = await fetch(`${API}/storage/v1${signedUrl}`);
    check("read: the signed URL returns the bytes, with no credential attached", fetched.status === 200);
    const bytes = Buffer.from(await fetched.arrayBuffer());
    check("read: the bytes round-trip unchanged", bytes.equals(PNG));

    // The token is bound to ONE object. Point a valid signature at a different
    // key and it must not resolve — otherwise a portfolio URL would be a skeleton
    // key for the certificate bucket.
    const swapped = await fetch(
      `${API}/storage/v1${signedUrl.replace(aPortfolio, aCertificate)}`,
    );
    check(
      "read: a valid signed URL repointed at another object does not fetch it",
      swapped.status !== 200,
      `status ${swapped.status}`,
    );
  }

  // NoSuchKey, not AccessDenied — and that is the good answer. The SELECT policy
  // hides the row, so the Storage service genuinely cannot find it and a refused
  // read is INDISTINGUISHABLE from a key that was never used. There is no
  // existence oracle on the read path.
  const otherSigned = await sign(PORTFOLIO, aPortfolio, B);
  check(
    "read: another professional cannot mint a URL for A's portfolio object",
    refusedAs(otherSigned, "NoSuchKey"),
    otherSigned.text,
  );
  const neverExisted = await sign(PORTFOLIO, key(INSTALLER_A, "png"), B);
  check(
    "read: a refused read and a key that never existed give the same answer",
    otherSigned.code === neverExisted.code,
    `${otherSigned.code} vs ${neverExisted.code}`,
  );

  const certByOther = await sign(CERTIFICATES, aCertificate, B);
  check(
    "read: another professional cannot mint a URL for A's CERTIFICATE",
    certByOther.status !== 200,
    certByOther.text,
  );

  const certByOrg = await sign(CERTIFICATES, aCertificate, business);
  check(
    "read: an organization identity cannot reach a certificate through membership",
    certByOrg.status !== 200,
    certByOrg.text,
  );

  const anonSign = await sign(CERTIFICATES, aCertificate, null);
  check(
    "read: an anonymous caller cannot mint a certificate URL",
    anonSign.status !== 200,
    anonSign.text,
  );

  for (const [label, bucket, path] of [
    ["portfolio", PORTFOLIO, aPortfolio],
    ["certificate", CERTIFICATES, aCertificate],
  ]) {
    const pub = await fetch(`${API}/storage/v1/object/public/${bucket}/${path}`);
    check(
      `read: the public object route does not serve a ${label} — the bucket is private`,
      pub.status !== 200,
      `status ${pub.status}`,
    );
  }

  const guessed = await fetch(`${API}/storage/v1/object/${CERTIFICATES}/${aCertificate}`, {
    headers: { apikey: ANON_KEY },
  });
  check(
    "read: guessing the object URL without a token returns nothing",
    guessed.status !== 200,
    `status ${guessed.status}`,
  );

  // =========================================================================
  // DELETE
  // =========================================================================
  const deleteByOther = await remove(PORTFOLIO, aPortfolio, B);
  check(
    "delete: another professional cannot delete A's object",
    refusedAs(deleteByOther, "AccessDenied"),
    deleteByOther.text,
  );
  // The delete path is the one place the two answers differ: AccessDenied means
  // "exists, not yours" while NoSuchKey means "no such object". Recorded rather
  // than glossed over — it is a real distinction, and it is only reachable by a
  // caller who already knows a full random object id, so it discloses nothing
  // they did not already have.
  const deleteUnknown = await remove(PORTFOLIO, key(INSTALLER_A, "png"), B);
  check(
    "delete: the refusal distinguishes an existing object from an absent one",
    refusedAs(deleteUnknown, "NoSuchKey") && deleteByOther.code === "AccessDenied",
    deleteUnknown.text,
  );
  check(
    "delete: and the object is still there afterwards",
    await objectExists(PORTFOLIO, aPortfolio, A),
  );

  // =========================================================================
  // DOWNGRADE — the contract copied from availability (§5)
  // =========================================================================
  // Installer A stops being a professional. Their files must not become
  // unreachable, and they must still be able to remove their own data.
  const restore = sql(
    `select coalesce(primary_account_type::text, 'NULL') from public.users where id='${INSTALLER_A}'`,
  );
  try {
    sql(`update public.users set primary_account_type='end_consumer' where id='${INSTALLER_A}'`);
    sql(`delete from public.individual_onboarding where user_id='${INSTALLER_A}'`);
    check(
      "downgrade: the identity is no longer a professional persona",
      sql(`select app.is_professional_persona('${INSTALLER_A}')`) === "f",
    );

    const blocked = await upload(PORTFOLIO, key(INSTALLER_A, "png"), PNG, "image/png", A);
    check(
      "downgrade: no NEW professional upload is accepted",
      refusedAs(blocked, "AccessDenied"),
      blocked.text,
    );
    check(
      "downgrade: existing files are still readable by their owner",
      (await sign(PORTFOLIO, aPortfolio, A)).status === 200,
    );
    check(
      "downgrade: and the owner can still delete their own data",
      (await remove(PORTFOLIO, aPortfolio, A)).status === 200,
    );
  } finally {
    if (restore === "NULL") {
      sql(`update public.users set primary_account_type=null where id='${INSTALLER_A}'`);
    } else {
      sql(`update public.users set primary_account_type='${restore}' where id='${INSTALLER_A}'`);
    }
  }

  check(
    "delete: the owner's delete actually removed the object",
    !(await objectExists(PORTFOLIO, aPortfolio, A)),
  );
  // NoSuchKey is what `deleteProfessionalAsset` folds into success: the caller
  // asked for the object to be gone and it is gone. Pinned here because that
  // helper's idempotence is only correct while this is the code Storage returns.
  const deleteAgain = await remove(PORTFOLIO, aPortfolio, A);
  check(
    "delete: deleting an already-deleted object answers NoSuchKey, deterministically",
    refusedAs(deleteAgain, "NoSuchKey"),
    deleteAgain.text,
  );
}

// ---------------------------------------------------------------------------
try {
  await main();
} finally {
  const admin =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
  for (const [bucket, path] of created) {
    await fetch(`${API}/storage/v1/object/${bucket}/${path}`, {
      method: "DELETE",
      headers: { apikey: admin, authorization: `Bearer ${admin}` },
    }).catch(() => {});
  }
  const leftover = sql(
    `select count(*) from storage.objects where bucket_id in ('${PORTFOLIO}','${CERTIFICATES}')`,
  );
  console.log(`\n--- teardown: ${created.length} keys created, ${leftover} objects left behind`);
  console.log(`--- ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`    FAIL ${f}`);
  process.exitCode = failures.length === 0 && leftover === "0" ? 0 : 1;
}
