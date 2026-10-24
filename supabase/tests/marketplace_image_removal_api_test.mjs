#!/usr/bin/env node
/**
 * The Storage HTTP half of the Marketplace image-removal proof (Migration 07).
 *
 * WHY THIS EXISTS ALONGSIDE 96_marketplace_image_removal_lifecycle_test.sql.
 * The defect Migration 07 fixes was invisible to SQL: `marketplace_seller_image_remove`
 * deleted the image row, and only the Storage SERVICE — which reads an object before
 * deleting it, as the caller — then refused the owner ("Access denied"), leaving
 * orphan bytes. pgTAP can show the policies' predicates; only real HTTP shows the
 * object is really gone. Every "deleted" assertion here is checked three ways: the
 * Storage API answer, `storage.objects`, and a service-role GET of the object.
 *
 *   node supabase/tests/marketplace_image_removal_api_test.mjs
 *
 * Needs the ISOLATED local stack (project aladdin-marketplace) with the standard
 * seeds. Override with SUPABASE_URL (default http://127.0.0.1:54421) and
 * DB_CONTAINER (default supabase_db_aladdin-marketplace). It mints its own local
 * HS256 tokens (the published local-dev secret) for seeded fixtures. It refuses to
 * run against anything that is not a localhost URL.
 *
 * NOTHING IT CREATES SURVIVES IT: the seller-account rows it adds, its products,
 * image rows and every object are torn down in `finally`, and it FAILS if the
 * marketplace tables / the bucket do not return to their starting counts.
 */
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";

const API = process.env.SUPABASE_URL ?? "http://127.0.0.1:54421";
if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(API)) {
  console.error(`Refusing to run against a non-local URL: ${API}`);
  process.exit(2);
}
const DB = process.env.DB_CONTAINER ?? "supabase_db_aladdin-marketplace";
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? "super-secret-jwt-token-with-at-least-32-characters-long";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const BUCKET = "marketplace-product-images";
const ORG_A = "9c000000-cccc-4ccc-8ccc-000000000001";
const ORG_B = "91000005-1111-4111-8111-000000000005";
const OWNER_A = "70000001-0000-4000-8000-000000000001";
const SALES_A = "70000002-0000-4000-8000-000000000002";
const OWNER_B = "71000005-0000-4000-8000-000000000005";
const OUTSIDER = "70000009-0000-4000-8000-000000000009";

const b64 = (s) => Buffer.from(s).toString("base64url");
function token(sub, role = "authenticated") {
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64(JSON.stringify({ ...(sub ? { sub } : {}), aud: "authenticated", role, iss: "supabase-demo", iat: now, exp: now + 3600 }));
  return `${h}.${p}.${createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
}
const sql = (s) =>
  execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-tAX", "-v", "ON_ERROR_STOP=1", "-c", s], { encoding: "utf8" }).trim();

// A valid 1x1 PNG, JPEG-labelled-PNG etc. are generated in memory; no binary fixture is committed.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

let pass = 0;
const fails = [];
const check = (label, ok, detail = "") => {
  if (ok) { pass += 1; console.log(`ok   ${label}`); }
  else { fails.push(label); console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
};

async function rpc(fn, args, bearer) {
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: ANON_KEY, authorization: `Bearer ${bearer ?? ANON_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = t; }
  return { status: r.status, body, message: typeof body === "object" && body ? (body.message ?? "") : String(body) };
}
async function st(method, path, bearer, { body, ct, extra } = {}) {
  const headers = { apikey: ANON_KEY, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(ct ? { "content-type": ct } : {}), ...(extra ?? {}) };
  const r = await fetch(`${API}/storage/v1/${path}`, { method, headers, body });
  const t = await r.text();
  let j = {}; try { j = JSON.parse(t) ?? {}; } catch { j = { raw: t }; }
  return { status: r.status, code: j.code ?? j.error ?? null, json: j, text: t.slice(0, 200) };
}
const objectCount = (key) => Number(sql(`select count(*) from storage.objects where bucket_id='${BUCKET}' and name='${key}'`));
const rowState = (id) => sql(`select coalesce((select upload_state||'/'||status||'/'||is_primary from public.marketplace_product_images where id='${id}'),'(no row)')`);
const tA = token(OWNER_A), tSales = token(SALES_A), tB = token(OWNER_B), tOut = token(OUTSIDER), tService = token(null, "service_role");

/** Request a key, upload valid bytes as A, confirm (server-side confirm RPC). */
async function newImage(productId, variantId) {
  const req = await rpc("marketplace_seller_image_request_upload", { p_product_id: productId, p_content_type: "image/png", p_variant_id: variantId ?? null }, tA);
  const { image_id, object_key } = req.body;
  const up = await st("POST", `object/${BUCKET}/${object_key}`, tA, { body: PNG, ct: "image/png" });
  const cf = await rpc("marketplace_seller_image_confirm_upload", { p_image_id: image_id }, tA);
  return { id: image_id, key: object_key, uploaded: up.status === 200, confirmed: cf.status === 200 && cf.body.upload_state === "confirmed", primary: cf.body.is_primary };
}
/** Real object bytes as the platform sees them (no RLS). */
const serviceGet = (key) => st("GET", `object/${BUCKET}/${key}`, tService);

const baseline = () => `${sql("select count(*) from public.marketplace_products")}/${sql("select count(*) from public.marketplace_product_images")}/${sql(`select count(*) from storage.objects where bucket_id='${BUCKET}'`)}/${sql("select count(*) from public.marketplace_seller_accounts")}`;
const start = baseline();
let productId;
// Only seller accounts THIS run adds are removed again (a pre-existing one is never touched).
const preexisting = new Set(sql(`select organization_id from public.marketplace_seller_accounts where organization_id in ('${ORG_A}','${ORG_B}')`).split("\n").filter(Boolean));

try {
  sql(`do $$ begin perform set_config('app.marketplace_seller_write','on',true);
        insert into public.marketplace_seller_accounts(organization_id,status,approved_at) values ('${ORG_A}','approved',now()),('${ORG_B}','approved',now()) on conflict do nothing; end $$`);
  sql(`update auth.users set email_confirmed_at=coalesce(email_confirmed_at,now()) where id in ('${OWNER_A}','${SALES_A}','${OWNER_B}','${OUTSIDER}')`);

  const saved = await rpc("marketplace_seller_product_save", { p_payload: { organization_id: ORG_A, product_type_key: "wallpaper", name_ar: "س", name_en: "Removal API probe",
    variants: [{ sku: "RMV-API-1", selling_unit: "roll", price_egp: 10, attributes: { color: "beige" } }] } }, tA);
  productId = saved.body.id;
  const variantId = saved.body.variants?.[0]?.id;
  check("setup: A creates a product with one variant", !!productId && !!variantId, JSON.stringify(saved.body));

  // ------------------------------------------------------------------ valid owner deletion (the original defect)
  const i1 = await newImage(productId, null);
  const i2 = await newImage(productId, null);
  const iv = await newImage(productId, variantId);
  check("setup: three images uploaded and confirmed (2 product-level, 1 variant)", i1.confirmed && i2.confirmed && iv.confirmed);
  check("setup: the first confirmed product image is primary", i1.primary === true && rowState(i1.id).endsWith("/true"));
  const s1 = await st("POST", `object/sign/${BUCKET}/${i1.key}`, tA, { body: JSON.stringify({ expiresIn: 300 }), ct: "application/json" });
  const signedUrl = s1.json.signedURL ? `${API}/storage/v1${s1.json.signedURL}` : null;
  const before = signedUrl ? await fetch(signedUrl) : { status: 0 };
  check("a signed URL issued to the owner serves the image before deletion", before.status === 200);

  // phase 1
  const m1 = await rpc("marketplace_seller_image_remove", { p_image_id: i1.id }, tA);
  check("phase 1: A marks its PRIMARY image for removal and gets the key", m1.status === 200 && m1.body === i1.key, JSON.stringify(m1.body));
  check("phase 1: the row is KEPT, withdrawn (deleting/rejected/not primary)", rowState(i1.id) === "deleting/rejected/false", rowState(i1.id));
  check("phase 1: the primary was promoted to the next confirmed image", rowState(i2.id) === "confirmed/pending/true", rowState(i2.id));
  check("phase 1: the bytes are still in storage (nothing deleted yet)", objectCount(i1.key) === 1);
  const again = await rpc("marketplace_seller_image_remove", { p_image_id: i1.id }, tA);
  check("phase 1 is idempotent (a repeat returns the same key)", again.status === 200 && again.body === i1.key);

  // ------------------------------------------------------------------ everyone else is refused, every phase
  const rmB = await rpc("marketplace_seller_image_remove", { p_image_id: i2.id }, tB);
  check("cross-org: B cannot mark A's image", rmB.status >= 400 && /not_permitted/.test(rmB.message), rmB.message);
  const fnB = await rpc("marketplace_seller_image_remove_finalize", { p_image_id: i1.id }, tB);
  check("cross-org: B cannot finalize A's removal", fnB.status >= 400 && /not_permitted/.test(fnB.message), fnB.message);
  const rmAnon = await rpc("marketplace_seller_image_remove", { p_image_id: i2.id }, null);
  check("anon cannot mark", rmAnon.status >= 400);
  const rmSales = await rpc("marketplace_seller_image_remove", { p_image_id: i2.id }, tSales);
  check("a member without catalogue authority cannot mark", rmSales.status >= 400 && /not_permitted/.test(rmSales.message), rmSales.message);

  for (const [who, bearer] of [["B owner", tB], ["outsider", tOut], ["sales-only member", tSales], ["anon", null]]) {
    const r = await st("DELETE", `object/${BUCKET}/${i1.key}`, bearer);
    check(`Storage DELETE of A's marked object by ${who} does nothing`, objectCount(i1.key) === 1, JSON.stringify(r));
  }
  const live = await st("DELETE", `object/${BUCKET}/${i2.key}`, tA);
  check("even A cannot Storage-DELETE a LIVE (confirmed) image directly", objectCount(i2.key) === 1, JSON.stringify(live));

  // ------------------------------------------------------------------ partial failure + retry
  const fin0 = await rpc("marketplace_seller_image_remove_finalize", { p_image_id: i1.id }, tA);
  check("partial failure: finalize REFUSES while the bytes are still stored", fin0.status >= 400 && /object_still_present/.test(fin0.message), fin0.message);
  check("partial failure: the row survives so the removal can be retried", rowState(i1.id) === "deleting/rejected/false");
  const pend = await rpc("marketplace_seller_images_pending_removal", { p_product_id: productId }, tA);
  check("partial failure: the unfinished removal is listed for retry", Array.isArray(pend.body) && pend.body.some((x) => x.image_id === i1.id), JSON.stringify(pend.body));
  const liveFin = await rpc("marketplace_seller_image_remove_finalize", { p_image_id: i2.id }, tA);
  check("finalize cannot drop a LIVE image", liveFin.status >= 400 && /image_not_marked_for_removal/.test(liveFin.message), liveFin.message);
  const cf = await rpc("marketplace_seller_image_confirm_upload", { p_image_id: i1.id }, tA);
  check("a withdrawn image cannot be re-confirmed", cf.status >= 400 && /image_removed/.test(cf.message), cf.message);
  const up = await rpc("marketplace_seller_images_update", { p_product_id: productId, p_images: [{ id: i1.id, sort_order: 0, is_primary: true }] }, tA);
  check("a withdrawn image cannot be re-arranged or made primary", up.status >= 400 && /image_removed/.test(up.message), up.message);

  // ------------------------------------------------------------------ the real delete (phase 2) — the original bug
  const del = await st("DELETE", `object/${BUCKET}/${i1.key}`, tA);
  check("phase 2: A's own Storage DELETE of the marked object now SUCCEEDS (was 'Access denied')", del.status === 200, JSON.stringify(del));
  check("phase 2: the object is absent from storage.objects", objectCount(i1.key) === 0);
  const svc = await serviceGet(i1.key);
  check("phase 2: the object is absent for the platform too (service-role GET is 404)", svc.status !== 200, JSON.stringify(svc));
  const after = signedUrl ? await fetch(signedUrl) : { status: 0 };
  check("a signed URL issued BEFORE deletion no longer serves the bytes (local stack, no CDN in front)", after.status !== 200, `status ${after.status}`);
  const fin1 = await rpc("marketplace_seller_image_remove_finalize", { p_image_id: i1.id }, tA);
  check("phase 3: finalize succeeds once the bytes are gone", fin1.status === 200 && fin1.body.removed === true, JSON.stringify(fin1.body));
  check("phase 3: only now is the row forgotten", rowState(i1.id) === "(no row)");

  // ------------------------------------------------------------------ repeated deletion
  const fin2 = await rpc("marketplace_seller_image_remove_finalize", { p_image_id: i1.id }, tA);
  check("repeated finalize is a clean not_found (the app treats it as already done)", fin2.status >= 400 && /not_found/.test(fin2.message), fin2.message);
  const rm2 = await rpc("marketplace_seller_image_remove", { p_image_id: i1.id }, tA);
  check("repeated removal is a clean not_found", rm2.status >= 400 && /not_found/.test(rm2.message), rm2.message);
  const del2 = await st("DELETE", `object/${BUCKET}/${i1.key}`, tA);
  check("repeated Storage DELETE of an already-removed object does not error or resurrect it", del2.status < 500 && objectCount(i1.key) === 0, JSON.stringify(del2));

  // ------------------------------------------------------------------ variant image
  const mv = await rpc("marketplace_seller_image_remove", { p_image_id: iv.id }, tA);
  check("variant image: marked through the same lifecycle", mv.status === 200 && mv.body === iv.key);
  check("variant image: the product primary is untouched", rowState(i2.id) === "confirmed/pending/true");
  await st("DELETE", `object/${BUCKET}/${iv.key}`, tA);
  const fv = await rpc("marketplace_seller_image_remove_finalize", { p_image_id: iv.id }, tA);
  check("variant image: bytes gone and row forgotten", fv.status === 200 && objectCount(iv.key) === 0 && rowState(iv.id) === "(no row)");

  // ------------------------------------------------------------------ never-uploaded key
  const req = await rpc("marketplace_seller_image_request_upload", { p_product_id: productId, p_content_type: "image/png" }, tA);
  await rpc("marketplace_seller_image_remove", { p_image_id: req.body.image_id }, tA);
  const fNever = await rpc("marketplace_seller_image_remove_finalize", { p_image_id: req.body.image_id }, tA);
  check("a key that was issued but never uploaded to can be cancelled cleanly", fNever.status === 200);

  // ------------------------------------------------------------------ invalid object paths: refused, no 5xx, no change
  const before2 = baseline();
  for (const [label, path] of [
    ["36 dashes (UUID-shaped, not a UUID)", "------------------------------------/a.png"],
    ["non-hex UUID-shaped prefix", "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz/a.png"],
    ["traversal", `${ORG_A}/../${ORG_B}/x.png`],
    ["empty segments", `${ORG_A}//x.png`],
    ["unknown key under A's own prefix", `${ORG_A}/${productId}/never-issued.png`],
  ]) {
    const d = await st("DELETE", `object/${BUCKET}/${path}`, tA);
    check(`invalid path (${label}): DELETE refused or no-op, never a server error`, d.status < 500, JSON.stringify(d));
    const u = await st("POST", `object/${BUCKET}/${path}`, tA, { body: PNG, ct: "image/png" });
    check(`invalid path (${label}): upload refused`, u.status !== 200 && objectCount(path) === 0, JSON.stringify(u));
  }
  check("invalid paths changed nothing", baseline() === before2);

  // ------------------------------------------------------------------ orphan detection
  const orphanSql = `select count(*) from storage.objects o where o.bucket_id='${BUCKET}' and not exists (select 1 from public.marketplace_product_images i where i.storage_bucket=o.bucket_id and i.object_key=o.name)`;
  check("orphan detection: the whole lifecycle left NO orphan object", Number(sql(orphanSql)) === 0);
  const legacy = `${ORG_A}/${productId}/legacy-orphan.png`;
  const mk = await st("POST", `object/${BUCKET}/${legacy}`, tService, { body: PNG, ct: "image/png" });
  check("orphan detection: a row-less object (made by the platform) is detected", mk.status === 200 && Number(sql(orphanSql)) === 1, JSON.stringify(mk));
  const dOrph = await st("DELETE", `object/${BUCKET}/${legacy}`, tA);
  check("a seller can NOT delete a row-less object (cleanup is a trusted task, not a client right)", objectCount(legacy) === 1, JSON.stringify(dOrph));
  const sOrph = await st("POST", `object/sign/${BUCKET}/${legacy}`, tA, { body: JSON.stringify({ expiresIn: 60 }), ct: "application/json" });
  check("...nor sign it", sOrph.status !== 200, JSON.stringify(sOrph));
  await st("DELETE", `object/${BUCKET}/${legacy}`, tService);
  check("orphan cleanup by the platform credential works, and detection is clear again", objectCount(legacy) === 0 && Number(sql(orphanSql)) === 0);

  // ------------------------------------------------------------------ abuse limits
  let refused = null;
  for (let n = 0; n < 12; n += 1) {
    const r = await rpc("marketplace_seller_image_request_upload", { p_product_id: productId, p_content_type: "image/png" }, tA);
    if (r.status >= 400) { refused = { n, message: r.message }; break; }
  }
  check("abuse: un-uploaded keys are capped per product", refused && /too_many_pending_uploads/.test(refused.message), JSON.stringify(refused));

  // ------------------------------------------------------------------ bucket-level refusals (Storage service, before Postgres)
  const k = await rpc("marketplace_seller_image_request_upload", { p_product_id: productId, p_content_type: "image/png" }, tA).catch(() => null);
  const pendingKey = sql(`select object_key from public.marketplace_product_images where product_id='${productId}' and upload_state='awaiting_upload' order by created_at limit 1`);
  const gif = await st("POST", `object/${BUCKET}/${pendingKey}`, tA, { body: Buffer.from("GIF89a"), ct: "image/gif" });
  check("bucket: a disallowed Content-Type is refused", gif.status !== 200 && objectCount(pendingKey) === 0, JSON.stringify(gif));
  const big = await st("POST", `object/${BUCKET}/${pendingKey}`, tA, { body: Buffer.alloc(5 * 1024 * 1024 + 16, 1), ct: "image/png" });
  check("bucket: an oversized body is refused", big.status !== 200 && objectCount(pendingKey) === 0, JSON.stringify(big));

  // ------------------------------------------------------------------ publication stays closed
  const pb = await rpc("marketplace_product_publish", { p_product_id: productId }, tA);
  check("publication is still blocked (media verification off)", pb.status >= 400, JSON.stringify(pb.body).slice(0, 120));
  check("media_verification_ready is still false", sql("select media_verification_ready from public.marketplace_platform_settings where singleton") === "f");
} finally {
  try {
    if (productId) {
      const keys = sql(`select object_key from public.marketplace_product_images where product_id='${productId}'`).split("\n").filter(Boolean);
      const objs = sql(`select name from storage.objects where bucket_id='${BUCKET}' and name like '${ORG_A}/${productId}/%'`).split("\n").filter(Boolean);
      for (const o of new Set([...keys, ...objs])) await st("DELETE", `object/${BUCKET}/${o}`, tService);
      sql(`do $$ begin perform set_config('app.marketplace_seller_write','on',true);
            delete from public.marketplace_product_images where product_id='${productId}';
            delete from public.marketplace_product_status_events where product_id='${productId}';
            delete from public.marketplace_stock_movements where seller_organization_id='${ORG_A}' and variant_id in (select id from public.marketplace_product_variants where product_id='${productId}');
            delete from public.marketplace_product_variants where product_id='${productId}';
            delete from public.marketplace_products where id='${productId}'; end $$`);
    }
    const added = [ORG_A, ORG_B].filter((o) => !preexisting.has(o));
    if (added.length) {
      sql(`do $$ begin perform set_config('app.marketplace_seller_write','on',true);
            delete from public.marketplace_seller_accounts where organization_id in (${added.map((o) => `'${o}'`).join(',')}); end $$`);
    }
  } catch (e) { console.log("CLEANUP ERROR", String(e).slice(0, 300)); }
  const end = baseline();
  // seller accounts that existed before the run (e.g. the QA fixture) are not these two showrooms, so the counts must match
  check(`teardown: products/images/objects/seller-accounts back to the starting counts (${start} -> ${end})`, start === end);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { console.log(fails.join("\n")); process.exitCode = 1; }
}
