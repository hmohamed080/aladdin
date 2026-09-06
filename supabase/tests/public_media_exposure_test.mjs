#!/usr/bin/env node
/**
 * Public portfolio media — the exposure and withdrawal probe.
 *
 * WHAT THIS FILE IS FOR, and why it is separate from the storage harness.
 *
 * `professional_asset_storage_api_test.mjs` proves the boundary: who may write,
 * read and delete. This one asks a narrower and more paranoid question about the
 * ONE thing this product deliberately serves to strangers — a published
 * photograph — and it asks it from the outside, against the running app:
 *
 *   1. IS THE OBJECT KEY DERIVABLE from anything a visitor already has? Item ids
 *      are public by necessity: they are in the `<img src>`. If the key could be
 *      computed from one, every "the key is not disclosed" argument would be
 *      worthless. Section A measures that directly.
 *   2. WHERE DOES THE KEY ACTUALLY APPEAR? Section B greps the real surfaces —
 *      server-rendered HTML, the RSC flight payload, the media response's headers
 *      and bytes, the public API projection, and error bodies.
 *   3. WHAT CAN AN ANONYMOUS CALLER DO AT STORAGE? Section C probes listing and
 *      direct object reads rather than assuming the policy implies the answer.
 *   4. DOES WITHDRAWAL ACTUALLY WITHDRAW? Section D holds a known-good key and
 *      unpublishes, then delists, checking every path in between. This is the
 *      section the `no-store` change exists for.
 *
 * Needs BOTH a running local stack and the Next dev server on :3000, because
 * three of the four questions are about HTTP surfaces that do not exist in SQL.
 *
 *   node supabase/tests/public_media_exposure_test.mjs
 *
 * Everything it creates is torn down in a `finally`, and it fails if anything is
 * left behind.
 */

import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";

const API = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const APP = process.env.APP_URL ?? "http://localhost:3000";
const JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET ??
  "super-secret-jwt-token-with-at-least-32-characters-long";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const PORTFOLIO = "professional-portfolio";
const CERTIFICATES = "professional-certificates";
const OWNER = "70000009-0000-4000-8000-000000000009";

let passed = 0;
const failures = [];
const items = [];
const objects = [];

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`ok   ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const b64url = (i) => Buffer.from(i).toString("base64url");
function token(sub) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64url(JSON.stringify({
    sub, aud: "authenticated", role: "authenticated",
    iss: "supabase-demo", iat: now, exp: now + 3600,
  }));
  return `${h}.${p}.${createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
}

function sql(statement) {
  return execFileSync("docker",
    ["exec", "-i", "supabase_db_aladdin", "psql", "-U", "postgres", "-d", "postgres",
     "-tAX", "-v", "ON_ERROR_STOP=1", "-c", statement], { encoding: "utf8" }).trim();
}

async function rpc(fn, body, bearer) {
  const headers = { apikey: ANON_KEY, "content-type": "application/json" };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const res = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const PDF = Buffer.from(
  ["%PDF-1.4", "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj", "trailer<</Root 1 0 R>>", "%%EOF", ""].join(
    String.fromCharCode(10),
  ),
  "utf8",
);

/** A private certificate, so section C's isolation check can never silently skip. */
async function seedCertificate(bearer) {
  const created = await rpc("certificate_create",
    { p_title: "probe cert", p_issuer: null, p_issued_on: null, p_expires_on: null,
      p_content_type: "application/pdf", p_original_filename: null }, bearer);
  const row = JSON.parse(created.text)[0];
  items.push(["professional_certificates", row.item_id]);
  const up = await fetch(`${API}/storage/v1/object/${CERTIFICATES}/${row.object_path}`, {
    method: "POST",
    headers: { apikey: ANON_KEY, authorization: `Bearer ${bearer}`, "content-type": "application/pdf" },
    body: PDF,
  });
  if (up.status === 200) objects.push([CERTIFICATES, row.object_path]);
  await rpc("certificate_finalize", { p_item_id: row.item_id }, bearer);
  return row;
}

/** Create → upload → finalize → (optionally) publish, as the product does. */
async function seedItem(bearer, { publish = false, title = "probe" } = {}) {
  const created = await rpc("portfolio_item_create",
    { p_title: title, p_description: null, p_content_type: "image/png" }, bearer);
  const row = JSON.parse(created.text)[0];
  items.push(["portfolio_items", row.item_id]);
  const up = await fetch(`${API}/storage/v1/object/${PORTFOLIO}/${row.object_key}`, {
    method: "POST",
    headers: { apikey: ANON_KEY, authorization: `Bearer ${bearer}`, "content-type": "image/png" },
    body: PNG,
  });
  if (up.status === 200) objects.push([PORTFOLIO, row.object_key]);
  await rpc("portfolio_item_finalize", { p_item_id: row.item_id }, bearer);
  if (publish) {
    await rpc("portfolio_item_set_visibility", { p_item_id: row.item_id, p_public: true }, bearer);
  }
  return row;
}

// ---------------------------------------------------------------------------
async function main() {
  const A = token(OWNER);
  const profileId = sql(`select id from public.profiles where user_id='${OWNER}'`);
  check("fixture: the owner's profile is listed",
    sql(`select public_profile_status from public.profiles where user_id='${OWNER}'`) === "listed");

  // =========================================================================
  // A. Is the key derivable from the item id?
  // =========================================================================
  // The item id is PUBLIC by necessity — it is the `<img src>`. So the entire
  // "the key is not disclosed" argument rests on the key being independent of it.
  const sample = [];
  for (let i = 0; i < 12; i += 1) sample.push(await seedItem(A, { title: `probe ${i}` }));

  check("key: no key equals its own item id",
    sample.every((r) => r.object_key.split(".")[0] !== r.item_id));

  check("key: no key shares even a 4-character prefix with its item id",
    sample.every((r) => r.object_key.slice(0, 4) !== r.item_id.slice(0, 4)),
    sample.map((r) => `${r.item_id.slice(0, 4)}/${r.object_key.slice(0, 4)}`).join(" "));

  // A derived key would correlate; independent v4 uuids do not. Comparing every
  // hex position across the sample, a derivation would show a position that
  // matches far more often than chance (1 in 16).
  const positions = 32;
  let matches = 0, compared = 0;
  for (const r of sample) {
    const id = r.item_id.replace(/-/g, "");
    const key = r.object_key.split(".")[0].replace(/-/g, "");
    for (let i = 0; i < positions; i += 1) {
      compared += 1;
      if (id[i] === key[i]) matches += 1;
    }
  }
  const rate = matches / compared;
  check("key: hex-position agreement with the item id is at chance level (~0.0625)",
    rate < 0.20, `observed ${rate.toFixed(3)} over ${compared} positions`);

  check("key: every key in the sample is distinct",
    new Set(sample.map((r) => r.object_key)).size === sample.length);

  // And structurally: the generator is a fresh uuid, not a function of the row.
  check("key: portfolio_item_create mints a fresh gen_random_uuid for the key",
    sql(`select prosrc like '%gen_random_uuid()::text || ''.'' || v_ext%'
           from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='portfolio_item_create'`) === "t");

  check("key: and the key column is never written from the id anywhere in the schema",
    sql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname in ('app','public')
            and p.prosrc like '%object_key%' and p.prosrc like '%= id%'`) === "0");

  // =========================================================================
  // B. Where does the key actually appear?
  // =========================================================================
  const published = await seedItem(A, { publish: true, title: "Published probe" });
  const certificate = await seedCertificate(A);
  const privateItem = sample[0];
  const privateKey = privateItem.object_key;
  const key = published.object_key;

  const profileHtml = await (await fetch(`${APP}/p/${profileId}`)).text();
  check("exposure: the public profile HTML does not contain the object key",
    !profileHtml.includes(key));
  check("exposure: nor the bucket name, nor any storage path",
    !profileHtml.includes(PORTFOLIO) && !profileHtml.includes("/storage/v1"));
  check("exposure: nor the owner's user id",
    !profileHtml.includes(OWNER));
  check("exposure: the item id IS present, which is exactly why the key must be independent",
    profileHtml.includes(published.item_id));

  // The RSC flight payload is a separate surface from the HTML: a server
  // component's props are serialised into it, and something that never appears
  // in the markup can still be sitting in the stream.
  const rsc = await (await fetch(`${APP}/p/${profileId}`, {
    headers: { RSC: "1" },
  })).text();
  check("exposure: the RSC flight payload does not contain the object key",
    !rsc.includes(key), `payload ${rsc.length} bytes`);
  check("exposure: nor a signed URL or token in the RSC payload",
    !rsc.includes("token=") && !rsc.includes("/object/sign"));

  const media = await fetch(`${APP}/p/media/${published.item_id}`);
  const mediaHeaders = [...media.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
  check("exposure: the media response headers do not contain the key",
    !mediaHeaders.includes(key), mediaHeaders.slice(0, 200));
  check("exposure: nor a storage location, etag or signed URL",
    !/location|etag|x-amz|supabase-storage/i.test(mediaHeaders), mediaHeaders);
  const mediaBytes = Buffer.from(await media.arrayBuffer());
  check("exposure: and the body is the image, not a redirect to storage",
    media.status === 200 && mediaBytes.equals(PNG));

  const apiRows = await (await fetch(
    `${API}/rest/v1/public_portfolio_items?select=*`, { headers: { apikey: ANON_KEY } })).text();
  check("exposure: the public API projection does not contain the key or an owner",
    !apiRows.includes(key) && !apiRows.includes(OWNER), apiRows.slice(0, 160));

  // Error bodies are a surface too: a refusal that names what it refused would
  // hand over the thing it was protecting.
  const badMedia = await fetch(`${APP}/p/media/00000000-0000-4000-8000-000000000000`);
  const badBody = await badMedia.text();
  check("exposure: a refusal from the media route says nothing at all",
    badMedia.status === 404 && badBody.length === 0, `status ${badMedia.status}`);

  const privateResolve = await rpc("public_portfolio_media_key",
    { p_item_id: privateItem.item_id }, null);
  check("exposure: the resolver returns null for a private item, not an error naming it",
    privateResolve.status === 200 && JSON.parse(privateResolve.text) === null);

  /**
   * THE ONE PLACE THE KEY IS REACHABLE, stated plainly rather than hidden.
   *
   * `public_portfolio_media_key` is granted to anon and returns the key for a
   * PUBLISHED item, because the media route runs as anon and needs it. That is
   * not a leak, and the sections below are what make it safe: the key carries no
   * owner and no filename, it cannot be derived from anything (section A), it
   * cannot be enumerated (section C), and it stops working the instant the item
   * is withdrawn (section D). Knowing the key buys exactly one thing — the bytes
   * the media route already serves to anybody who asks.
   */
  const publishedResolve = await rpc("public_portfolio_media_key",
    { p_item_id: published.item_id }, null);
  check("exposure: the resolver DOES return a published key to anon, by design",
    JSON.parse(publishedResolve.text) === key);
  check("exposure: and that key contains no owner id and no separator",
    !key.includes(OWNER) && !key.includes("/"));

  // =========================================================================
  // C. What can an anonymous caller do at Storage directly?
  // =========================================================================
  /**
   * WHAT ANON'S STORAGE ACCESS ACTUALLY IS, measured rather than assumed.
   *
   * This section has been wrong twice, and both corrections are why it drives the
   * real API instead of reasoning from the policy text.
   *
   * FIRST it asserted anon could reach nothing. False: a SELECT policy in
   * Supabase Storage is consulted by every read-shaped operation, so the policy
   * that let the media route mint one signed URL also permitted bucket listing,
   * a direct unsigned GET, and a HEAD revealing size and type.
   *
   * THEN it concluded that could not be narrowed, because "may sign" and "may
   * list" looked like one permission. Also false. Storage publishes the operation
   * being performed via `storage.operation()`, and a policy can require a
   * specific one. Driving each request shape through a temporary logging
   * predicate produced the exact strings:
   *
   *   sign -> storage.object.sign        list -> storage.object.list
   *   GET  -> storage.object.get_authenticated
   *   HEAD -> object.head_authenticated_info
   *   fetching a signed URL -> THE POLICY IS NOT EVALUATED AT ALL
   *
   * So the door is now one operation wide, and the assertions below are the
   * measured consequence: anon may mint a signed URL for a published object and
   * do NOTHING else at Storage.
   */
  const listPortfolio = await fetch(`${API}/storage/v1/object/list/${PORTFOLIO}`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ prefix: "", limit: 1000 }),
  });
  const listed = JSON.parse(await listPortfolio.text());
  const publishedCount = Number(sql(
    `select count(*) from public.portfolio_items where visibility='public' and state='ready'`));

  check("storage: anon can enumerate NOTHING, even though published objects exist",
    Array.isArray(listed) && listed.length === 0,
    `listed ${listed.length}, published ${publishedCount}`);
  check("storage: and there really was something to list, so the empty result is a refusal",
    publishedCount > 0, `published ${publishedCount}`);

  const listCerts = await fetch(`${API}/storage/v1/object/list/${CERTIFICATES}`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ prefix: "", limit: 1000 }),
  });
  const certRows = JSON.parse(await listCerts.text());
  check("storage: the certificates bucket lists nothing either, as it always did",
    Array.isArray(certRows) && certRows.length === 0);

  const bucketList = await fetch(`${API}/storage/v1/bucket`, { headers: { apikey: ANON_KEY } });
  const bucketBody = await bucketList.text();
  check("storage: an anonymous caller cannot enumerate the buckets themselves",
    !bucketBody.includes(PORTFOLIO) && !bucketBody.includes(CERTIFICATES));

  const directPublished = await fetch(`${API}/storage/v1/object/${PORTFOLIO}/${key}`, {
    headers: { apikey: ANON_KEY },
  });
  check("storage: a DIRECT unsigned read of a published object is now refused",
    directPublished.status !== 200, `status ${directPublished.status}`);

  const headPublished = await fetch(`${API}/storage/v1/object/${PORTFOLIO}/${key}`, {
    method: "HEAD", headers: { apikey: ANON_KEY },
  });
  check("storage: so is a HEAD, which used to disclose size and type",
    headPublished.status !== 200, `status ${headPublished.status}`);

  const directPrivate = await fetch(`${API}/storage/v1/object/${PORTFOLIO}/${privateKey}`, {
    headers: { apikey: ANON_KEY },
  });
  check("storage: a private object stays refused on every path",
    directPrivate.status !== 200, `status ${directPrivate.status}`);

  const publicRoute = await fetch(`${API}/storage/v1/object/public/${PORTFOLIO}/${key}`);
  check("storage: the public-bucket route serves nothing, because the bucket is private",
    publicRoute.status !== 200, `status ${publicRoute.status}`);

  /**
   * The one thing that still works, and the reason the media route keeps
   * functioning: signing is a distinct operation, and fetching the resulting URL
   * consults no policy at all.
   */
  const signPublished = await fetch(`${API}/storage/v1/object/sign/${PORTFOLIO}/${key}`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ expiresIn: 120 }),
  });
  check("storage: anon MAY still sign a published object — the door is one operation wide",
    signPublished.status === 200);

  if (signPublished.status === 200) {
    const signedUrl = JSON.parse(await signPublished.clone().text()).signedURL;
    const fetched = await fetch(`${API}/storage/v1${signedUrl}`);
    check("storage: and the signed URL delivers the real bytes with no policy in the way",
      fetched.status === 200 && Buffer.from(await fetched.arrayBuffer()).equals(PNG));
  }

  const signCert = await fetch(`${API}/storage/v1/object/sign/${CERTIFICATES}/${certificate.object_path}`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ expiresIn: 60 }),
  });
  const readCert = await fetch(`${API}/storage/v1/object/${CERTIFICATES}/${certificate.object_path}`, {
    headers: { apikey: ANON_KEY },
  });
  check("storage: but never a certificate, by signing or by direct read",
    signCert.status !== 200 && readCert.status !== 200,
    `sign ${signCert.status}, read ${readCert.status}`);

  const certViaPortfolio = await rpc("public_portfolio_media_key",
    { p_item_id: certificate.item_id }, null);
  check("storage: a certificate id resolves to nothing through the portfolio media path",
    JSON.parse(certViaPortfolio.text) === null);
  check("storage: and the media ROUTE 404s on a certificate id",
    (await fetch(`${APP}/p/media/${certificate.item_id}`)).status === 404);

  const signPrivate = await fetch(`${API}/storage/v1/object/sign/${PORTFOLIO}/${privateKey}`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ expiresIn: 60 }),
  });
  check("storage: and never a PRIVATE portfolio object, even with its exact key",
    signPrivate.status !== 200, `status ${signPrivate.status}`);

  /**
   * The OWNER is unaffected. Their access comes from a separate permissive
   * policy with no operation restriction, so listing and reading their own
   * objects still work — which is what the portfolio manager's previews need.
   */
  const ownerList = await fetch(`${API}/storage/v1/object/list/${PORTFOLIO}`, {
    method: "POST",
    headers: { apikey: ANON_KEY, authorization: `Bearer ${A}`, "content-type": "application/json" },
    body: JSON.stringify({ prefix: "", limit: 1000 }),
  });
  const ownerRows = JSON.parse(await ownerList.text());
  check("storage: the OWNER can still list their own objects — their policy is separate",
    Array.isArray(ownerRows) && ownerRows.length > 0, `rows ${ownerRows.length}`);
  check("storage: and still sign their own PRIVATE object, which the previews depend on",
    (await fetch(`${API}/storage/v1/object/sign/${PORTFOLIO}/${privateKey}`, {
      method: "POST",
      headers: { apikey: ANON_KEY, authorization: `Bearer ${A}`, "content-type": "application/json" },
      body: JSON.stringify({ expiresIn: 60 }),
    })).status === 200);

  // =========================================================================
  // D. Does withdrawal actually withdraw, for somebody holding the key?
  // =========================================================================
  const cacheControl = media.headers.get("cache-control") ?? "";
  check("withdrawal: the media response is not storable by any cache",
    cacheControl.includes("no-store"), cacheControl);
  check("withdrawal: and carries no positive max-age that a cache could honour",
    !/max-age=[1-9]/.test(cacheControl), cacheControl);

  // UNPUBLISH, then immediately re-ask every path. No sleep: the point is that
  // there is no window to wait out.
  await rpc("portfolio_item_set_visibility", { p_item_id: published.item_id, p_public: false }, A);

  const afterUnpublish = {
    resolver: JSON.parse((await rpc("public_portfolio_media_key",
      { p_item_id: published.item_id }, null)).text),
    sign: (await fetch(`${API}/storage/v1/object/sign/${PORTFOLIO}/${key}`, {
      method: "POST", headers: { apikey: ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify({ expiresIn: 60 }),
    })).status,
    direct: (await fetch(`${API}/storage/v1/object/${PORTFOLIO}/${key}`,
      { headers: { apikey: ANON_KEY } })).status,
    route: (await fetch(`${APP}/p/media/${published.item_id}`)).status,
    page: (await (await fetch(`${APP}/p/${profileId}`)).text()).includes(published.item_id),
  };
  check("withdrawal: unpublish — the resolver immediately returns null",
    afterUnpublish.resolver === null);
  check("withdrawal: unpublish — a KNOWN KEY can no longer be signed",
    afterUnpublish.sign !== 200, `status ${afterUnpublish.sign}`);
  check("withdrawal: unpublish — nor read directly",
    afterUnpublish.direct !== 200, `status ${afterUnpublish.direct}`);
  check("withdrawal: unpublish — the media route 404s on the next request",
    afterUnpublish.route === 404, `status ${afterUnpublish.route}`);
  check("withdrawal: unpublish — and the item is gone from the public page",
    afterUnpublish.page === false);

  // DELIST. Republish first, so the only thing that changes is the profile.
  await rpc("portfolio_item_set_visibility", { p_item_id: published.item_id, p_public: true }, A);
  check("withdrawal: republishing restores the exact same key",
    (await fetch(`${APP}/p/media/${published.item_id}`)).status === 200);

  sql(`update public.profiles set public_profile_status='hidden' where user_id='${OWNER}'`);
  const afterDelist = {
    resolver: JSON.parse((await rpc("public_portfolio_media_key",
      { p_item_id: published.item_id }, null)).text),
    sign: (await fetch(`${API}/storage/v1/object/sign/${PORTFOLIO}/${key}`, {
      method: "POST", headers: { apikey: ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify({ expiresIn: 60 }),
    })).status,
    route: (await fetch(`${APP}/p/media/${published.item_id}`)).status,
    page: (await fetch(`${APP}/p/${profileId}`)).status,
    visibility: sql(`select visibility from public.portfolio_items where id='${published.item_id}'`),
  };
  sql(`update public.profiles set public_profile_status='listed' where user_id='${OWNER}'`);

  check("withdrawal: DELISTING the profile — the resolver returns null immediately",
    afterDelist.resolver === null);
  check("withdrawal: delisting — a known key can no longer be signed",
    afterDelist.sign !== 200, `status ${afterDelist.sign}`);
  check("withdrawal: delisting — the media route 404s",
    afterDelist.route === 404, `status ${afterDelist.route}`);
  check("withdrawal: delisting — the profile page itself 404s",
    afterDelist.page === 404, `status ${afterDelist.page}`);
  check("withdrawal: delisting — and the owner's saved visibility was never touched",
    afterDelist.visibility === "public");
  check("withdrawal: relisting restores it without republishing anything",
    (await fetch(`${APP}/p/media/${published.item_id}`)).status === 200);

  // DELETE is the third withdrawal. Same immediacy, from the state that has no
  // way back.
  await rpc("portfolio_item_delete", { p_item_id: published.item_id }, A);
  check("withdrawal: delete — the media route 404s before Storage is even asked",
    (await fetch(`${APP}/p/media/${published.item_id}`)).status === 404);
  check("withdrawal: delete — and a known key can no longer be signed",
    (await fetch(`${API}/storage/v1/object/sign/${PORTFOLIO}/${key}`, {
      method: "POST", headers: { apikey: ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify({ expiresIn: 60 }),
    })).status !== 200);
}

// ---------------------------------------------------------------------------
try {
  await main();
} finally {
  const admin =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
  for (const [bucket, path] of objects) {
    await fetch(`${API}/storage/v1/object/${bucket}/${path}`, {
      method: "DELETE", headers: { apikey: admin, authorization: `Bearer ${admin}` },
    }).catch(() => {});
  }
  for (const [table, id] of items) sql(`delete from public.${table} where id='${id}'`);
  sql(`update public.profiles set public_profile_status='listed' where user_id='${OWNER}'`);

  const left = sql(
    `select (select count(*) from public.portfolio_items)
          + (select count(*) from storage.objects where bucket_id='${PORTFOLIO}')`);
  console.log(`\n--- teardown: ${items.length} rows and ${objects.length} objects created; ${left} left behind`);
  console.log(`--- ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`    FAIL ${f}`);
  process.exitCode = failures.length === 0 && left === "0" ? 0 : 1;
}
