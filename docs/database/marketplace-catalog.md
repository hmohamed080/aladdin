# Marketplace catalog — database specification (foundation increment)

**Status:** DRAFT — superseded in part by the Dynamic Product Schema design (`../marketplace/MARKETPLACE.md` §3, rev. 5) · 2026-10-11.

> **No migration is active.** The SQL written earlier lives in `../marketplace/draft-sql/` (migration + pgTAP) and was moved out of `supabase/migrations/` on purpose: the table design must be approved first. It predates the Dynamic Product Schema Builder and its fixed product columns will change (field values move to schema-driven value tables). Treat it as a reference for the taxonomy/seller/RPC patterns only. **Never executed anywhere.**

## Purpose

The data foundation for the public Marketplace catalog defined in
[`../marketplace/MARKETPLACE.md`](../marketplace/MARKETPLACE.md) under
[ADR-0011](../decisions/ADR-0011-public-b2c-marketplace.md): the two discovery
splits, who may sell, and the products, variants, images and stock they own.

## Current decision

| Split | Tables | Notes |
|---|---|---|
| **1 — Shop by product** | `marketplace_categories` (3) → `marketplace_product_types` (6) → `marketplace_products` → `marketplace_variants` | database-driven, never an enum; labels in i18n catalogs by `key` |
| **2 — Shop by finishing type** | `marketplace_finishing_groups` (5) → `marketplace_finishing_tasks` (14, `trade_id` → existing `public.trades`) → `marketplace_finishing_task_product_types` (role `primary/complementary/optional`) → product types | reaches products **through** their type — no product duplication |

Supporting: `marketplace_units` + `marketplace_product_type_units` (candidate set, D-08),
`marketplace_seller_eligible_org_types` (V1: `showroom_dealer`), `marketplace_seller_accounts`
(no row = closed), `marketplace_product_images`, `marketplace_inventory`,
`marketplace_settings` (`browse_enabled`, `checkout_enabled`, both false).

Access: reference tables are readable by `anon`/`authenticated` (active rows). Everything
seller-owned has RLS enabled with **no policy and no grant** for client roles; the only
anonymous path is the `SECURITY DEFINER` RPCs `marketplace_public_products`,
`marketplace_public_product_detail`, `marketplace_public_type_counts`,
`marketplace_public_finishing_tasks` (published + seller approved + browse enabled +
an active variant; availability is a bucket, never exact stock). First seller activation:
`marketplace_ops_activate_seller` — `service_role`/owner only (D-21).

## Rationale

- Separate tables and a `marketplace_` prefix keep it structurally independent of the B2B
  `public.products`/`public.orders` (no FK either way).
- Composite `(organization_id, id)` keys prove same-seller by construction (pattern of `public.products`).
- RPC-only anonymous reads avoid exposing base tables and avoid security-definer views.

## Scope

Catalog and discovery only.

## What is deferred

Attribute dictionary and dynamic filters · price history · offers/flash sales · cart and merge ·
checkout, orders, payments, settlement · tax model · reservation ledger · seller capability keys and
showroom UI (Stage 6, D-23) · audit-log action for seller activation (needs the
`ck_audit_action_known` extension, tracked as a TODO on the ops function).

## Consequences

- Browse is invisible until an Admin/operator enrolls a seller **and** sets `browse_enabled`.
- Publishing a product requires: approved seller, active product type, ≥ 1 active variant,
  an Arabic name (D-09 pending), and every variant unit allowed for the type.
- No existing table, enum, policy, capability list or account behavior is modified.

## Validation

Written without a running local database (Docker daemon was not available when authored).
**Run before merging:** `pnpm supabase db reset` then `pnpm supabase test db`
(expects `86_marketplace_catalog_test.sql` — 47 assertions — and the whole existing suite to pass).

## Related files

`../marketplace/MARKETPLACE.md` · `naming-conventions.md` · `../security/rls-strategy.md` ·
`supabase/migrations/20261011090001_marketplace_catalog_foundation.sql`
