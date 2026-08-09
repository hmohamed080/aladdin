# Sprint 9 — Catalog → RFQ → Quotation

One complete B2B commercial workflow on top of the existing identity / tenancy /
capability / audit spine. **Quotation acceptance ends in READY FOR ORDER; it does
NOT create an order or project — those are Sprint 10.**

## The journey

```
Supplier            Professional (requester)        Supplier              Requester
─────────           ────────────────────────        ─────────             ──────────
create product  →   browse / search catalog     →
publish             open product → Request quote →
                    create RFQ (draft)
                    add line(s) from supplier
                    submit RFQ              ───────► receive submitted RFQ
                                                     create quotation (seeds lines)
                                                     price lines → submit  ─────────► review quotation
                                                                                      accept  → ACCEPTED / READY FOR ORDER
                                                                                      (or reject → supplier may revise)
```

## Data model (migration `20260810090001_catalog_rfq_quotation.sql`)

| Table | Purpose |
|-------|---------|
| `products` | Tenant-owned catalog item. `status` draft/published, optimistic `version`. |
| `rfqs` | Request from one requester org to exactly **one** supplier org. `draft → submitted → quoted → closed/cancelled`. |
| `rfq_items` | RFQ line; snapshots product name/unit; references a **published** supplier product. |
| `quotations` | Supplier's priced response. `draft → submitted → accepted/rejected`. One live (non-rejected) quotation per RFQ. |
| `quotation_items` | Priced line mirroring an rfq_item; `line_total` generated; parent `subtotal`/`total` recomputed by the RPCs. |

Enums: `product_status`, `product_category`, `product_unit`, `rfq_status`,
`quotation_status`. Subtotal = total (no discount/tax engine — deferred, no design
evidence). Product image is a nullable reference only (no media-upload
infrastructure yet).

### Security (reuses ADR-0008 pattern — no permission-engine change)

- Base tables are **SELECT-only**; every mutation is a `security definer` RPC that
  derives the actor from `auth.uid()`, checks capability + org scope, guards the
  optimistic `version`, and emits an audit event in the same transaction.
- Capabilities reused from the fixed catalog: `catalog.write` / `catalog.publish`
  (products), `rfq.create` (requester), `rfq.respond` / `quote.submit` (supplier),
  `quote.decide` (requester decision). `org.manage` implies all of them.
- **RLS visibility:** published products are cross-tenant discoverable via the
  curated `catalog_published_products` view; own-org products (all statuses) are
  member-only. The supplier sees an RFQ **only once submitted** (never a draft);
  the requester sees a quotation **only once submitted** (never a supplier draft).
  Counterparty org names are surfaced through a `security definer` scalar so a
  requester reads a supplier's display name without a cross-tenant read of the
  private `organizations` table.
- Direct-DML and service-role write paths are revoked; RPCs are `authenticated`
  only (a service-role key is not a business-authorization path).

## Frontend

- Routes: `/b2b/catalog`, `/b2b/catalog/[productId]`, `/b2b/products`(+`new`,
  `[id]`, `[id]/edit`), `/b2b/rfqs`(+`new`, `[rfqId]`), `/b2b/quotations`(+
  `[quotationId]`). Added to the workspace nav.
- Data flow mirrors Sales: page → caller-scoped query (RLS) → server action →
  `server-only` RPC wrapper → RPC. Errors map to translation **keys**
  (`mapCommerceError`), never raw DB text.
- Built on the Sprint 7/8 visual system (cards, tables, badges, state panels).
  Fully bilingual (AR RTL / EN LTR) with TS-enforced key parity.

## Validation

- **pgTAP** `23_catalog_rfq_quotation_test.sql` (42 assertions): full journey
  (publish → RFQ → quote → accept → READY FOR ORDER / RFQ closed), draft
  visibility isolation (supplier can't see draft RFQ; requester can't see draft
  quotation), cross-tenant denial (non-member sees nothing; requester can't create
  a product/quotation in the supplier org; supplier can't decide its own
  quotation), unpriced-submit and re-decide guards, audit emission, direct-DML
  boundary, and the "no orders table yet" Sprint-10 boundary.
- **Frontend** `commerce.test.ts`: `mapCommerceError` coverage + a guard that every
  mapped key and every category/unit label exists in **both** catalogs; money /
  quantity formatters.

## Out of scope (Sprint 10+)

Orders, projects, payments/checkout, subscriptions, stock/warehouse, shipping,
advanced pricing (discount/tax), campaigns, commissions, wallets,
recommendations/AI, reviews, consumer marketplace.
