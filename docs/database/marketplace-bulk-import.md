# Marketplace bulk import — database foundation (Migration 05)

**Status:** database foundation implemented and tested locally (`supabase/migrations/20261013090004_marketplace_bulk_import_foundation.sql`, tests `94_marketplace_bulk_import_test.sql`). **No file parser, worker or upload exists yet.** Nothing here can publish a product.

## What it is

An organisation-scoped, chunked, resumable pipeline that turns a spreadsheet into **draft** products in the *canonical* Marketplace tables. There is no second catalogue: imported rows become `marketplace_products`, `marketplace_product_variants`, attribute-value rows and `marketplace_product_images` (status `pending`), identified by the unique keys those tables already carry:

| Thing | Identity (already unique in the canonical tables) |
|---|---|
| Product | `(seller_organization_id, external_ref)` |
| Variant | `(seller_organization_id, sku)` |
| Image | `(storage_provider, storage_bucket, object_key)` |

## Tables

| Table | Purpose |
|---|---|
| `marketplace_import_jobs` | one import: org, uploader, source file name + checksum, `mode` (`dry_run`/`apply`), status, chunk size, counters, worker lease, timestamps. Unique `(organization_id, idempotency_key)`. Never deleted. |
| `marketplace_import_job_events` | append-only status history (who / which worker / why). |
| `marketplace_import_rows` | staged spreadsheet rows. **One row = one variant**; product columns repeat on the product's rows. Keeps `raw` cells + normalised typed columns + `row_hash`, validation `status`, applied `product_id`/`variant_id`, `action`. |
| `marketplace_import_assets` | image files as **storage object references** (provider/bucket/key, size, checksum, mime). Parsed SKU key + sequence, match result, resulting `image_id`. |
| `marketplace_import_errors` | row / asset findings (`error`/`warning`, code, field, message). Capped at 20 per row and 10,000 per job (overflow is counted, not stored). |

Relationships: rows/assets/errors → job by **composite FK `(job_id, organization_id)`**, so a staged row can never carry a different organization than its job. `product_id`/`variant_id` use composite FKs to `(id, seller_organization_id)`, so an import row can never point at another seller's product. All FKs to `organizations` are `RESTRICT`.

## State machine

```
created ─▶ staging ─▶ staged ─▶ validating ─▶ validated ─▶ applying ─▶ completed
   │          │          │           │            │            │      └▶ completed_with_errors ─▶ applying (retry)
   └──────────┴──────────┴───────────┴────────────┴────────────┴──▶ cancelled        (validating/applying may also ─▶ failed)
                                                   dry_run: validated ─▶ completed | completed_with_errors
```
The transition table is enforced by a trigger; the only writers are the trusted functions.

## Idempotency model

1. **Job creation** — `(organization_id, idempotency_key)` unique. Same key + same source ⇒ the same job id; same key + different source ⇒ error.
2. **Staging** — `(job_id, row_number)` unique and every row carries a SHA-256 `row_hash`. Re-sending an identical row is a no-op; a different row under an existing number is refused. Assets are unique by `(job_id, file_name)` and by object key.
3. **Sealing** is idempotent (returns the current state).
4. **Validation** is repeatable: a row's previous findings are replaced; only `pending` rows are taken.
5. **Apply** — find-or-create by the canonical unique keys, and write only what differs. Results per row: `create`, `update` (something actually changed), `unchanged`. Re-importing the same file creates nothing. An already-registered image object is reused, never duplicated.
6. **Retries** — a failed row can be re-queued (`marketplace_import_retry_failed`, budget 3 attempts).

## Safe create / update rules

* New products are **always `draft`**; images are always **`pending`**. The importer never sets `published`, `is_verified`, stock or approval state.
* Updates never touch: seller, product type, status, `published_at`, SKU, `external_ref`, slug.
* An existing product's type, or an existing variant's `selling_unit`, cannot be changed by import (reported as an error).
* A SKU that already belongs to a *different* product of the seller is refused.
* Product-level fields and attributes come from the **first row** (lowest row number) of each product; later rows may differ only in variant data (conflicting names are a warning, a conflicting type is an error).
* Missing *required* attributes are **warnings**: a draft may be incomplete; the Migration 04 publication blockers still list them.

## Row / variant / image matching

* **Variant**: one spreadsheet row per SKU. Rows sharing `external_ref` are variants of one product.
* **Image file names**: `<SKU>_<NN>.<jpg|jpeg|png|webp>`. The *last* `_<1–3 digits>` before the extension is the sequence; without one the image is sequence 1. A SKU may contain underscores (`A_B_02.jpg` → SKU `A_B`, #2).
* **Matching order**: 1) SKU (case-insensitive) → the variant's own images; 2) otherwise `external_ref` (case-insensitive) → product-level images, attached to the product's first row; 3) otherwise `unmatched` (a warning — never guessed).
* **Order**: ascending sequence (ties by file name). `SKU_01.jpg`, `SKU_02.jpg`, `SKU_03.jpg` become that variant's images with `sort_order` 0, 1, 2. For product-level images the first one becomes the product's primary image when none exists.
* Two files for the same SKU + sequence (`SKU_01.jpg` and `SKU_01.png`): the lowest file name wins, the other is rejected with a warning.
* **Variant images do not satisfy the publication rule** (it requires a verified *product-level* primary image). A catalogue that only ships `SKU_NN.jpg` therefore needs either a product-reference image (`<external_ref>_01.jpg`) or a deliberate "promote first variant image" step in the importer / seller UI. This is documented, not guessed.

## Trusted write plan (the future Import Worker)

* The worker is a **server-side** process holding the service key; no key ever reaches the browser. The frontend's only calls are `marketplace_import_job_create`, `marketplace_import_job_cancel`, `marketplace_import_job_report` (membership + catalogue-publish authority + enabled seller are re-checked in SQL) and RLS-limited reads of its own job, rows, findings.
* Worker functions (`service_role` only, `SECURITY DEFINER`, empty `search_path`): `create`, `stage_rows` (≤1000/call), `stage_assets` (≤1000/call), `seal`, `claim` / `release`, `validate_next`, `apply_next`, `complete_dry_run`, `retry_failed`, `cancel`, `purge_staging`.
* No client has INSERT/UPDATE/DELETE on any import table, and a guard trigger refuses writes outside those functions even from the table owner. Existing Marketplace RLS is untouched.
* Each `apply_next` call handles one chunk (`chunk_size` ≤ 2000); **each row is applied in its own sub-transaction**, so a failing row rolls back only itself. Nothing runs a whole import in one transaction.
* A **lease** (`locked_by`, `lease_expires_at`) allows one active worker per job; a crashed worker's lease expires and another worker resumes from the persisted row statuses.

### Worker call sequence

```
create(org, actor, format, file, checksum, mode, chunk, idempotency_key)  -> job
stage_rows(job, [...≤1000])            repeat until all rows are staged
stage_assets(job, [...≤1000])          repeat (after the files are in storage)
seal(job)                              -> matches assets to rows
claim(job, worker, lease)              extend by calling claim again
validate_next(job, worker)             repeat until remaining = 0
dry_run : complete_dry_run(job)        report = marketplace_import_job_report(job)
apply   : apply_next(job, worker)      repeat until remaining = 0
          retry_failed(job) -> apply_next ...   (optional)
release(job, worker) ; purge_staging(job)  (terminal jobs, retention)
```

## Limits

Rows per job 50,000 · assets per job 200,000 · batch 1,000 · chunk ≤ 2,000 · findings 20/row, 10,000/job · 3 active jobs per organization · seller must be an *enabled* (approved) Marketplace seller.

## Measured on the local stack

Single-transaction probe on the isolated local database, 15,000 rows → 7,500 products, 15,000 variants, 15,000 images (rolled back afterwards; real runs are chunked across transactions, which only helps):

| Step | Time | Per item |
|---|---|---|
| Stage 15,000 rows (15 calls × 1,000) | 5.5 s | 0.37 ms |
| Stage 15,000 asset references | 17.7 s | 1.2 ms |
| Seal + match 15,000 assets to rows | 0.8 s | — |
| Validate 15,000 rows | 7.4 s | 0.5 ms |
| Apply 15,000 rows (products, variants, about 52,000 attribute values, images) | 253 s | ≈17 ms |

Apply dominates because every row runs the canonical guards and the option-signature trigger in its own sub-transaction — the price of reusing the real tables and their rules instead of bypassing them. About 4–5 minutes for 15,000 rows is acceptable for a background job; a 50,000-row job is roughly 15 minutes. Two expression indexes (`lower(sku)`, `lower(external_ref)`) and index-driven matching took sealing from 73 s to 0.8 s, and an index on findings by row took validation from 72 s to 7.4 s — both found by this probe.

## Remaining dependencies for the real importer

1. Excel/CSV **parser** and header-mapping/normalisation (UTF-8 BOM, Arabic digits, trimming) producing the row JSON above.
2. **Upload + storage**: where the original sheet and images are stored, virus/size/type checks, and the image **verification / delivery pipeline** (Cloudflare R2 or Supabase Storage) that finally allows `media_verification_ready`.
3. **Worker runtime** (queue, retries, lease renewal, concurrency, back-off) and its secret management.
4. **Seller UI** and Admin visibility for job progress / error reports; downloadable error file.
5. Seller-side trusted RPCs for editing imported drafts, and for the product-level primary image decision (see above).
6. Initial **stock** import (separate, uses `marketplace_stock_apply`); product type / attribute template downloads per type.
7. Retention policy for staging rows (`purge_staging` exists; scheduling does not).
