# Marketplace product database

**Status:** in progress — Migrations 01–05 authored, applied to the isolated local Supabase stack and validated by the full pgTAP suite (see "Validation record").
**Branch / worktree:** `feat/public-marketplace-20261011` · `D:\projects\aladdin-wt-public-marketplace-20261011` (from `origin/main` @ `6c088d9`). Nothing is merged, pushed or deployed.

## Purpose

The database foundation of the public, direct-price **B2C Marketplace** (ADR-0011). It is a separate E-Commerce domain: every object is named `marketplace_*`, references no B2B object, and does not touch `public.products`, RFQs, quotations, B2B orders, Showroom account schemas, memberships or the Kashier integration.

## Domains and migrations

| # | Migration | Domain | State |
|---|---|---|---|
| 01 | `20261012090001_marketplace_taxonomy_and_attributes.sql` | Taxonomy + dynamic attribute definitions | applied + tested locally (isolated Supabase) |
| 02 | `20261013090001_marketplace_product_core.sql` | Products & sellers · Attribute values · Images | applied + tested locally (isolated Supabase) |
| 03 | `20261013090002_marketplace_inventory.sql` | Inventory | applied + tested locally (isolated Supabase) |
| 04 | `20261013090003_marketplace_seller_enablement_and_catalog.sql` | Seller enablement · Publication · Safe public catalog | applied + tested locally (isolated Supabase) |
| 05 | `20261013090004_marketplace_bulk_import_foundation.sql` | Bulk import foundation (jobs, staging rows/assets, findings, trusted worker functions) | applied + tested locally (isolated Supabase) |

Product types are **rows, not an enum**. Adding paints, doors, flooring, curtains or posters is an `INSERT` plus field mappings — no structural change.

## Migration 01 — tables

| Table | Role |
|---|---|
| `marketplace_categories` | navigation grouping (3 seeded) |
| `marketplace_product_types` | what a listing is (6 seeded: wallpaper, wood_alternative, marble_alternative, sheeboard, cornice, corner_trim) |
| `marketplace_attribute_definitions` | a field defined once: `data_type` text · number · boolean · option · multi_option · measurement; `unit_kind` length / weight / volume |
| `marketplace_product_type_attributes` | which fields a type has: `level` product / variant, `is_required`, `is_filterable`, `is_variant_axis`, per-type label override |
| `marketplace_attribute_options` | allowed values of an option field (materials, patterns, 19 colours with swatch) |

### Rules enforced in the database

- Keys: `lower_snake_case`, 2–64 chars; Arabic and English names required.
- `data_type`, `unit_kind` and `key` of a field are **immutable** (a trigger) — changing them would reinterpret stored values.
- Only `option` / `multi_option` fields own options; an option never changes field.
- A variant axis exists only at variant level and never on free text.
- A measurement names its unit kind; canonical units: **length = mm, weight = g, volume = ml**. A label such as "290 x 20 cm" is never stored.
- Disabling is `is_active = false`. Value tables (Migration 02) reference definitions and options `ON DELETE RESTRICT`, so a field holding data cannot be deleted, only switched off.
- "Up to three variant axes" is a V1 **seller-UI** limit, deliberately not a database constraint.

### Security

- RLS **enabled** on all five tables.
- `anon` and `authenticated` read **active** rows only; platform staff (`app.is_admin_staff()`) read retired rows too.
- **No** insert / update / delete grant or policy for `anon`, `authenticated` or `service_role`. Rows change by migration today; the future Schema Builder writes through audited, permission-checked RPCs.
- No `SECURITY DEFINER` function is introduced.

## Migration 02 — product core

| Table | Role |
|---|---|
| `marketplace_products` | a listing owned by a seller org (V1: showroom), slug, bilingual name/description, brand, status draft / published / unpublished / archived |
| `marketplace_product_variants` | sellable SKU: seller-scoped SKU, selling unit, `numeric(12,2)` price EXCL. VAT, active/inactive, trigger-owned `option_signature` |
| `marketplace_product_attribute_values` | typed relational product-level values (text / number / boolean / option / multi_option / measurement) |
| `marketplace_variant_attribute_values` | same, at variant level (colour, thickness, roll width, weight) |
| `marketplace_product_images` | image metadata: provider, bucket, stable object key, order, primary flag, alt text, status — no bytes, no URLs |

**Integrity (database-level):** seller + product type immutable; seller must be a live showroom; slug globally unique; SKU unique per seller; a variant cannot name a seller different from its product (composite FK); a field must be mapped to the product type at the right level and be active; an option must belong to its field (guard + composite FK); typed-shape CHECK; no duplicate single-valued value; a duplicate variant combination is rejected by a partial UNIQUE index on `(product_id, option_signature)` (verified with two real concurrent sessions); one active primary product image; an image's variant must belong to the same product; object keys reject URLs, query strings, traversal and absolute paths; a mapping in use cannot be deleted or re-levelled (disable it instead).

**Fail closed:** `status = published` is unreachable. `app.marketplace_publication_blockers()` always reports `seller_enablement_not_available` and `inventory_not_available`; a BEFORE trigger refuses the transition for every role. It also reports missing required fields (read from the live mapping), missing variants, ambiguous variant combinations and a missing verified primary image.

**Access:** RLS on all five tables; SELECT only, to `authenticated` (members of the seller organization, platform staff) and `service_role`; **no anon grant**, no write grant or policy for anyone.

**Deferred (documented in the migration header):** seller enablement table + audited RPC; inventory (Migration 03); media verification flow; public catalogue projection.

## Migration 03 — inventory

| Table / object | Role |
|---|---|
| `marketplace_stock_locations` | where stock is held (showroom / warehouse); owned by an organization, optionally mirrors one of its branches (pickup) |
| `marketplace_inventory_levels` | `on_hand`, `reserved`, and **`available = on_hand - reserved`** (stored generated column) per (variant, location) |
| `marketplace_stock_movements` | append-only ledger: type, deltas, resulting balances, reason, source, business reference, actor, idempotency key |
| `public.marketplace_stock_apply(...)` | the ONLY write path; SECURITY DEFINER, empty search_path, `service_role` only |

**Operations:** `initial` and `replenish` (+on-hand), `correction` (signed on-hand), `reserve` (+reserved, needs available), `release` (−reserved), `deduct` (−on-hand and −reserved: consumes a reservation). No checkout or order logic exists yet; the order flow will call these.

**Guarantees:** `0 <= reserved <= on_hand` is a CHECK (no oversell, no negative stock); every change takes `FOR UPDATE` on the (variant, location) row and re-checks the rules under that lock; one idempotency key per seller — a replay returns the original result and changes nothing, a key reused for a different operation is an error; a lost race on a first use rolls back and replays; the ledger is append-only and its foreign keys are RESTRICT; levels can change only inside the function (a trigger refuses any other write), so a level always equals the sum of its ledger.

**Existing entities:** inventory references only `organizations` and `branches`, both `ON DELETE RESTRICT` (they can only block a hard delete, never cascade into B2B). Nothing existing references marketplace tables.

**Access:** RLS; members of the owning organization and platform staff read; nobody else; no write grant or policy for any role; no anon grant.

**Publication:** still closed. The constant `inventory_not_available` became a real rule (`no_available_stock`); `seller_enablement_not_available` remains a constant until Migration 04.

**Hardening:** EXECUTE on every `app.marketplace_*` function (trigger functions and helpers) is revoked from public, anon, authenticated and service_role (trigger functions are authorised at CREATE TRIGGER, so this cannot break them).

## Migration 04 — seller enablement, publication, safe public catalog

**Seller accounts.** `marketplace_seller_accounts` (PK = `organization_id` → `organizations`, RESTRICT). Being a Showroom is *eligibility*, never authorization: a row must exist and be `approved`. Status `pending | approved | suspended | revoked` (revoked is terminal in V1). Eligibility is **recomputed live** (`app.marketplace_seller_is_eligible`: org exists, not soft-deleted, `status = active`, `org_type = showroom_dealer`) at approval, at reinstatement, at every publication check, at every reservation and on every public read — the type/status recorded at approval is never trusted. No organization id is hard-coded; the migration approves nobody.

**Admin authorization.** Two new RBAC permissions, `marketplace_sellers.manage` (Super Admin + Administrator) and `marketplace_sellers.read` (+ Moderator; Support has neither). Transitions are `public.admin_marketplace_seller_approve / suspend / revoke / reinstate` (SECURITY DEFINER, empty search_path, authenticated only, each checks `app.has_admin_permission` itself, reason of 3–500 chars mandatory). Reads: `admin_marketplace_sellers()`, `admin_marketplace_seller_history(org)`. The table itself has no write grant and a guard trigger refuses any write outside the transition function (even the owner).

**Audit.** `marketplace_seller_account_events` (append-only: actor, from/to status, reason, org type/status at that moment) and `marketplace_product_status_events` (publish / unpublish / archive). Both reject UPDATE/DELETE. The platform `audit_log` action vocabulary is deliberately **not** extended (it is an existing B2B constraint).

**Publication.** `app.marketplace_publication_blockers` now evaluates, fail closed: `seller_organization_not_eligible`, `seller_not_approved`, `product_type_inactive`, `missing_product_attribute:*`, `no_active_variant`, `missing_variant_attribute:*`, `variant_without_option_combination`, `invalid_variant_price`, `no_available_stock`, `no_verified_primary_image`, `media_verification_not_available`. Trusted RPCs `public.marketplace_product_publish / marketplace_product_unpublish(p_archive)` authorise through `app.can_publish_catalog(seller org)` (existing `catalog.publish` or `org.manage`), lock the row, require an empty blocker list, and write an event. States: draft → published ⇄ unpublished, → archived (terminal). A stock-out after publication does **not** archive: the product stays listed with `in_stock=false` / `purchasable=false`. Suspending, revoking or deactivating the seller hides its products on the next read without rewriting product state, and reinstating restores them.

**Public read.** Two SECURITY DEFINER *functions* (not definer views — Advisor rule 0010 / test 29), granted to `anon` + `authenticated`, fixed projection, page size capped at 60: `marketplace_public_catalog(type, query, limit, offset)` and `marketplace_public_product(slug)`. Returned: slug, bilingual name/description, brand, type/category keys, tax-exclusive prices, `in_stock`/`purchasable` booleans, attributes, image **ids**. Never returned: bucket, object key, stock counts, seller identity, admin metadata. Base tables stay unreadable to `anon`.

**Media boundary.** `marketplace_platform_settings.media_verification_ready` (single row, default **false**, no client write). While false: publication is refused (`media_verification_not_available`) and public responses carry no image reference. A DB `status = verified` alone is not trusted; flipping the flag is a deliberate platform act once an upload/verification/delivery pipeline exists (Cloudflare R2 is out of scope).

**Reservations.** A `reserve` movement now requires an enabled seller (trigger); release/deduct remain possible so orders can be wound down. **Known limit:** aggregate `reserved` cannot attribute units to an order; checkout needs per-order reservation rows (with expiry) so one order can only release/deduct its own. Not built.

**Seller access.** Members of the seller organization may read only `organization_id, status, requested_at, status_changed_at` of their own account (column grant); reason and admin identities are admin-RPC only.

**Deferred seller write interfaces (required before Bulk Import / seller UI):** trusted RPCs for product create/update, variant create/update/deactivate, attribute-value upsert, image registration and verification, and inventory adjustment by a seller member. Today these tables are written only by the owner/service path; no client has INSERT/UPDATE/DELETE.

**Touched existing objects:** two rows inserted into `admin_permissions` and their `admin_role_permissions` mappings (data only). Test `85_` asserted the catalogue size (25) and was updated to 27.

## Migration 05 — bulk import foundation

Full design, idempotency model, image matching and worker contract: [`marketplace-bulk-import.md`](marketplace-bulk-import.md). Summary:

* Five import tables (`marketplace_import_jobs`, `_job_events`, `_rows`, `_assets`, `_errors`), organisation-scoped through composite FKs; staging only — imported products land in the **canonical** product tables as **draft**, images as **pending**.
* Identity: product = (seller, `external_ref`), variant = (seller, `sku`); jobs idempotent per (organization, key).
* Worker surface is `service_role`-only SECURITY DEFINER functions; the seller can only create / cancel / report their own jobs. No client write grants; a guard trigger refuses writes outside the functions.
* Chunked (≤2000 rows per call), each row in its own sub-transaction, leased and resumable; dry-run mode validates and reports without writing products.
* Nothing in the import path can publish or verify media; publication stays behind the Migration 04 blockers.

## Migration 06 — trusted seller product writes

`20261014090001_marketplace_seller_product_writes.sql`. The write layer the seller UI uses — no client gains a table write grant.

| RPC (authenticated) | Purpose |
|---|---|
| `marketplace_seller_product_save(jsonb)` | create (always **draft**) or update a product with its variants and dynamic attributes in one atomic call; variants missing from the form are deactivated, never deleted; a published product edited into a blocked state is unpublished |
| `marketplace_seller_product_get(uuid)` / `_readiness(uuid)` | the seller's own product for editing / its publication blockers (members only) |
| `marketplace_seller_default_location(uuid)` | ensures the organization's main stock location |
| `marketplace_seller_stock_adjust(...)` | +/- stock through `marketplace_stock_apply` (ledger, row lock, idempotency key, optional expected on-hand; reserved units cannot be removed) |
| `marketplace_seller_image_request_upload / _confirm_upload / _images_update / _image_remove` | images: server-issued org/product key + pending row; the storage INSERT policy requires that row; confirm succeeds only if the object exists in storage (records real size/type); uploads stay `status = pending` (never auto-verified) |

Every write re-checks: authenticated caller, active member with `catalog.write` / `catalog.publish` / `org.manage`, enabled (approved, eligible) seller, ownership. Refusals are `mp:<code>[:detail]`. New private bucket `marketplace-product-images` (5 MB, jpeg/png/webp) with three storage policies; `marketplace_product_images.upload_state` added. Test `47_` updated for the three reviewed policies and ONE named exception to "no function reads storage.objects" (the upload confirmation). Tests: `95_` (76) + `marketplace_seller_stock_concurrency_test.sh`.

## Migration 07 — safe image removal lifecycle

`20261014090002_marketplace_image_removal_lifecycle.sql`. Fixes a defect found by the Migration 06 audit: `marketplace_seller_image_remove` deleted the image row at once, but Supabase Storage reads an object *as the caller* before deleting it, and that read (`marketplace_images_select_member`) needs the very row that had just been deleted — so the bytes were refused and stayed in the private bucket forever (and the app ignored the failure).

**Two-phase removal; the authorising row outlives the bytes.**

| Phase | Who / what | Effect |
|---|---|---|
| 1 `marketplace_seller_image_remove(image)` | catalogue manager of an enabled seller | row kept but withdrawn: `upload_state = deleting`, `status = rejected`, not primary (hidden from every read at once); next confirmed product image is promoted to primary; a *published* product left unpublishable is unpublished with an audit event. Idempotent. Returns the object key. |
| 2 Storage API `DELETE` | the caller's own session | allowed only for a row `awaiting_upload` or `deleting`, only to a catalogue manager of that row's organization. A confirmed image can never be deleted here. |
| 3 `marketplace_seller_image_remove_finalize(image)` | same caller | forgets the row **only if the object is truly absent** from `storage.objects` (`mp:object_still_present` otherwise); refuses a live image (`mp:image_not_marked_for_removal`). |

`marketplace_seller_images_pending_removal(product)` lists unfinished removals so a failed delete is shown and retried, never forgotten. The server action (`removeImageAction` → `image-removal.ts`) runs the three steps and reports success only after step 3; every step is idempotent and a retry resumes where it stopped.

**Storage policy changes (none widened).** Still 14 policies. `marketplace_storage_can_delete_image` no longer derives the organization from the object *path* (a `text → uuid` cast that raised on a malformed key); it consults only the server-issued row, so a malformed, unknown or row-less key simply matches nothing. `marketplace_storage_can_upload_image` now also requires the key to be less than one hour old.

**Abuse limits (`request_upload`).** ≤ 10 un-uploaded keys per product, ≤ 200 new keys per organization per hour (`P0001`, not the retried `40001`); expired un-uploaded keys are swept into the removal lifecycle. A removed image can never be re-confirmed or re-arranged (`mp:image_removed`).

**Magic bytes.** The database cannot read file bytes, and Storage checks only the Content-Type *header*. `confirmImageUploadAction` therefore reads the first bytes of the stored object (signed URL + Range) and withdraws a file whose signature is not the declared PNG / JPEG / WebP. A caller who invokes the confirm RPC directly skips this check — which is why uploads stay `pending` and the content review that must precede `media_verification_ready` has to decode and re-validate every image itself.

**Deleted images and signed URLs — what is and is not guaranteed.** Seller-facing signed URLs now live 300 s (was 600 s) and objects are uploaded with `cache-control: 300`. Once the bytes are deleted, a signed URL issued earlier stops serving them *on the local stack* (verified). This is **not** a revocation guarantee: the hosted platform serves objects through a CDN, a browser or intermediary may hold a copy for its cache lifetime, and a downloaded copy is out of anyone's reach. Public delivery of any product image remains off (`media_verification_ready = false`) so no public URL exists to revoke.

**Orphans.** After this migration every object in the bucket has an image row. Detection query (run as the platform):

```sql
select o.name from storage.objects o
where o.bucket_id = 'marketplace-product-images'
  and not exists (select 1 from public.marketplace_product_images i
                  where i.storage_bucket = o.bucket_id and i.object_key = o.name);
```

A row-less object is **not** deletable by any seller (the select policy needs a row); cleanup is a trusted maintenance task with the platform credential, not a client right. Deleting a *product* (platform-only) cascades its image rows and would leave bytes behind — that path must delete objects first.

Tests: `96_marketplace_image_removal_lifecycle_test.sql` (73), `marketplace_image_removal_api_test.mjs` (59, real Storage HTTP; asserts the object is gone from the API, `storage.objects` **and** a service-role GET), `image-removal.test.ts`, `image-signature.test.ts`; `47_` now names two `storage.objects` readers (confirm: bytes exist; finalize: bytes gone).
## Migration 08 — product-type expansion (fifteen approved types)

`20261014090003_marketplace_product_types_expansion.sql`. Migration 01 seeded six types; the approved catalogue is fifteen. This migration adds the other nine **as data only** (categories, types, field definitions, options, type → field mappings) — no table, column, constraint, policy, grant, function or trigger changes, so Migration 01's security model (public read of ACTIVE rows, no client write grant) applies unchanged. The seller form, readiness blockers and import read a type's fields from these rows, so no code change is needed.

| Category | Types (Arabic · key) |
|---|---|
| Wall Coverings & Decorative Panels | ورق حائط `wallpaper` · بديل خشب `wood_alternative` · بديل رخام `marble_alternative` · شيبورد `sheeboard` · **بانوهات `wall_panel`** · **بوسترات `poster`** |
| Cornices & Mouldings | كرانيش `cornice` · **وزرة `skirting`** |
| Finishing Accessories | زوايا `corner_trim` |
| **Doors** | **أبواب داخلية `interior_door`** · **أبواب مصفحة `armored_door`** |
| **Flooring** | **أرضيات فينيل `vinyl_flooring`** · **أرضيات SPC `spc_flooring`** |
| **Curtains & Blinds** | **ستائر `curtain`** |
| **Paints & Coatings** | **دهانات `paint`** |

Each new type has a required product-level field, a required variant-level field and one to three variant axes (the V1 limit): panels = colour + thickness; skirting = colour + bar length + height; doors = colour + width + handing (height required, not an axis); flooring = colour + thickness; curtains = colour + width + height; posters = width + height; paints = colour + pack size (`pack_volume`: 0.5 L … 18 L, an option field, so sellers pick a size instead of typing millilitres). Measurements stay canonical (length → mm); new fields: `height`, `wear_layer`, `coverage_per_liter` (number, m²/L), booleans (`includes_frame`, `fire_rated`, `sound_insulated`, `waterproof`, `underlay_attached`, `framed`). The colour catalogue gains yellow, orange, red, purple, turquoise (24 colours). Selling units stay within the existing set.

The Arabic name for skirting is stored as **وزرة** (the standard word; the brief wrote "وزر") — a one-row `update` away if the platform prefers otherwise. Tests: `97_marketplace_product_type_expansion_test.sql` (38: catalogue, schema sanity, unchanged security, and a complete draft saved through the seller RPC for every new type); `90_` counts updated (7 categories, 15 types, 24 colours).
## Isolation

1. **Git:** dedicated worktree and branch; the `main` working tree and the landing-page worktree are untouched.
2. **Database:** Git worktrees do not isolate databases. Local Supabase uses fixed default ports (`54321`/`54322`) and `project_id = "aladdin"`, so a second worktree starting the stack would collide with another. Use a dedicated local project identity and ports for this worktree **without committing machine-specific values**, and never run `supabase db push` / remote resets.
3. **Schema:** `marketplace_*` namespace; no object of the B2B domain is altered.

## Validation record

| Check | Result |
|---|---|
| Isolated local stack (`project_id = aladdin-marketplace`, ports 544xx; machine-local, not committed) | ✅ |
| `supabase db reset` — all **110** migrations (01–06 included) + seeds | ✅ |
| `supabase test db` — whole suite, **93 files / 4275 tests** | ✅ **PASS** |
| `90_` taxonomy (63) · `91_` product core (99) · `92_` inventory (101) · `93_` seller enablement (119) · `94_` bulk import (126) | ✅ |
| Existing B2B / RLS suites (01–89) | ✅ no regression (only edits: `85_` now pins the 25 original permissions + role mappings by content hash and verifies the two Marketplace permissions) |
| `marketplace_stock_concurrency_test.sh` — real parallel sessions (oversell, same-key, 10-way stampede) | ✅ PASS |

An earlier scratch run (PostgreSQL 17.5, stubbed baseline) caught one real defect — a `CHECK` that a NULL `unit_kind` silently satisfied — which was fixed before the local-stack run.

Not covered here: hosted Staging/Production (never touched), Storage policies (no bucket in this migration), and a concurrency test (no write path exists yet).
