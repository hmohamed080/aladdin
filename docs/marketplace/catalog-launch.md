# Marketplace catalog launch (Decore Store) — Migration 09 + UI

Status: **local only** (branch `feat/public-marketplace-20261011`, isolated Supabase stack `aladdin-marketplace`). Nothing pushed, deployed, or applied to staging/production.

## What exists

| Surface | Route | Who | Gate |
|---|---|---|---|
| Seller management | `/admin/marketplace` | platform admin | `marketplace_sellers.read/manage` re-checked by every RPC |
| Media moderation | `/admin/marketplace/media` | platform admin | `marketplace_media.moderate` |
| Bulk import | `/b2c/seller/imports` | approved seller (catalogue manager) | `marketplace_seller_import_step` re-checks writer on every call |
| Seller products (server-paged) | `/b2c/seller/products` | approved seller | `marketplace_seller_products_page` |
| Public catalog / product | `/marketplace`, `/marketplace/products/[slug]` | anyone (release flag `NEXT_PUBLIC_MARKETPLACE_PREVIEW`) | public RPCs return only published products of enabled sellers |
| Public image bytes | `/marketplace/media/[imageId]` | anyone | `marketplace_public_image_ref` (service role only) |

## Bulk import

Browser-side: the spreadsheet (XLSX via a dependency-free ZIP/XML reader, or CSV) is parsed and mapped with `frontend/src/lib/marketplace-import/plan.ts`:

- each target field comes from a column, a fixed value, or a pattern (`ورق حائط {2} {0}`);
- Arabic-Indic digits and `٬` separators are normalised; price ≤ 0 or non-numeric rows are refused before upload;
- seller codes become SKUs: every character outside `[A-Za-z0-9._/-]` becomes `-` (`106:Jaguar:161-003` → `106-Jaguar-161-003`); two codes that collapse to the same SKU are refused, never merged;
- optional grouping: codes differing only by a final `-N` become one product (`external_ref` = the base) with several variants;
- attributes: `attr:<key>` columns and fixed `key=value` lines (validated by the database per product type);
- images (files or ZIP) match by name only: `<code|SKU>[_NN].jpg` → that variant, `<product ref>[_NN].jpg` → the product; everything else is listed as unmatched.

Server-side every step goes through the Migration 05 import engine via `marketplace_seller_import_step` (seller session, worker `seller:<uid>`): idempotent job (`marketplace_import_job_create` with a key derived from file checksum + mapping + image set), images uploaded to `imports/{org}/{job}/{NNNNN}.{ext}` (policy `marketplace_import_assets_insert`), `stage_rows` ≤ 1000/call, `stage_assets`, `seal` (deterministic matching), `validate` / `apply` in chunks of 500, `retry_failed`, cancel, error report. Imported products are **always drafts**; opening stock goes through the stock ledger once (`import:{job}:{row}`).

## Moderation

Every image is downloaded by the server under the moderator's own session and checked by `validateImageBytes` (sharp): magic-byte signature, decoder agrees on the format, full decode, 1–12000 px per side, SHA-256. The verdict is stored with `admin_marketplace_media_record_validation`, which refuses a VALID verdict whose byte size differs from the stored object. Approve re-validates first and the database requires a successful validation within 15 minutes. Reject needs a reason; a rejected primary hands its slot to the next image and a published product that loses its last valid image is unpublished. All actions are append-only events.

## Public media delivery and revocation

`/marketplace/media/[imageId]` asks `marketplace_public_image_ref` on **every request**: media flag on, image verified + byte-validated, product published, seller enabled, type/category active, variant active. Responses (200 and 404 alike) are `no-store, private`; the browser never receives a bucket, key, signed URL or credential.

Measured locally (synthetic acceptance): unpublish → 404, seller suspended → 404 (catalog empty), image rejected after approval → 404 + product unpublished, image deleted by seller → 404 + product unpublished, media flag off → 404 and no image ids in the catalog; republish / reinstate → 200 again. Anonymous direct Storage download and the service-only ref RPC are both denied.

**Cache limits (documented, not solved):** revocation is immediate only because nothing caches. If a CDN or image optimiser is put in front later, it must honour `no-store` or be purged on unpublish/suspend/reject/delete/flag-off. A visitor who already downloaded an image keeps their copy — revocation stops future delivery, it cannot recall bytes. The public route costs one service-role lookup + one storage read per image view; at scale a short signed-URL or edge-cache design with explicit purge will be needed.

## Acceptance results (local)

Synthetic sample (generated images, then the DB + Storage were restored so no fake product remains):
9 rows → 6 products (1 row refused for price 0); 7 images matched, 1 unmatched; 8 pending images moderated (7 valid approved, 1 truncated PNG rejected); publish-ready with the media flag off → 0 published (`media_verification_not_available`); flag on → 5 published (ACC5 blocked `no_available_stock`, ACC7 blocked `no_verified_primary_image`); all revocation checks above passed; no key/URL/token in the product HTML.

Real file `قائمة المنتجات (1).xlsx` (1,231 data rows), imported as Decore Store drafts:

| Measure | Count |
|---|---|
| Spreadsheet data rows | 1,231 |
| Refused before upload (price 0) | 31 |
| Variant rows imported | 1,200 |
| Distinct products (grouping by `-N`) | 786 (609 single-variant) |
| Rows failed on apply | 0 |
| Images uploaded / approved / rejected | 0 / 0 / 0 (the file has no images) |
| Published | **0** |
| Server warnings | 929 `required_attribute_missing`, 71 `product_field_conflict` (name differs from the product's first row; first row wins) |
| Re-import of the same file | no duplicates (same 795 products incl. 9 earlier QA products) |
| Dry run / import time | 2.9 s / 7.4 s; seller list page ≈ 20 ms |

Why nothing is published (publish-ready over 795 drafts): every product lacks a verified photo; the wallpaper type requires `material_wallpaper`, `color`, `roll_width`, `roll_length`, none of which are in the file; multi-variant products also need distinct option values (`variant_without_option_combination`, 177); the media flag is off. Product names were generated from the album + code (`ورق حائط {album} {code}`) because the file has no names.

## Still open

- Real product photos and the missing attributes (material, colour, roll width/length) from Decore Store; then moderation, then the media flag, then publish-ready.
- Better names/descriptions for the 786 products (currently generated from album + code).
- Measurement values on the product page are shown in raw stored units (mm) without a unit label.
- Sidebar entry for `/b2c/seller/imports` (reachable from the products page button today).
- Checkout, payment, orders: out of scope for this sprint.
- Staging/production: migrations 06–09 and this UI are not applied anywhere but the local stack.
