# ADR-0011 — Public B2C Marketplace (independent direct-price e-commerce domain)

**Status:** Proposed · 2026-10-11 · direction **approved by the owner on 2026-10-11** (decision D-00); flips to **Accepted** when the Stage 1 architecture in [`../marketplace/MARKETPLACE.md`](../marketplace/MARKETPLACE.md) is approved. **Partially supersedes** the commerce anti-pattern statements in [`../product/PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md) **for the Marketplace domain only.** Refines [ADR-0001](ADR-0001-approved-architecture.md) and [ADR-0007](ADR-0007-identity-and-tenancy-model.md) (additive).

## Purpose

Record the product decision that Aladdin gains a **separate, direct-price, B2C-style e-commerce domain** (the *Marketplace*), without changing the consultation-first B2B/RFQ commerce spine.

## Context

`PRODUCT_DIRECTION_GUIDE.md`, root `AGENTS.md` and `CLAUDE.md` state that Aladdin is **not** an add-to-cart/checkout marketplace and that "no online payment is collected and there is no checkout" in the Private Pilot. The owner has approved a new feature — a public Marketplace for physical finishing products sold at published prices by showrooms — that intentionally departs from that statement **for a new, isolated domain.**

## Current decision

1. A new **Marketplace** domain is approved: public browse, direct EGP prices, guest cart (browser-side) with authentication required to open the cart, checkout, **online payment and Cash on Delivery**, orders and tracking.
2. It is **independent of RFQ/quotation/order**: its own `marketplace_*` tables, enums, capabilities, RPCs and routes. No foreign key to or from `products`, `rfqs`, `quotations`, `orders`, `order_items`, `projects`.
3. **Unchanged:** the organization↔organization commerce spine (RFQ · quotation · order · project) stays consultation-first; **price-war / reverse-auction bidding remains prohibited**; installer services are not sold in the Marketplace cart.
4. **Sellers** are admin-enabled Showroom organizations only in V1 (selling permission separate from organization identity, extensible to other organization types). Rollout is closed by default behind a feature flag.
5. **Showroom account, dashboard, pages, permissions and onboarding are not changed** until the last functional stage (Stage 6).
6. Delivery and **COD** cash collection are the **showroom's** responsibility in V1; Aladdin records and tracks only.
7. **Online payments** go through **Kashier** and are **received by Aladdin**, which later reconciles and **settles eligible balances to showrooms** (seller ledger, commissions, refunds, reconciliation, audit trail). COD and online settlement are never mixed. Aladdin's **merchant-of-record status is not assumed**; the contractual, tax and regulatory dependencies are recorded as open decisions.
8. **Kashier integration is owned by another engineer.** The Marketplace builds **no second integration** and does not modify that work; it depends on a **stable payment contract** (create payment, verified idempotent payment events, status lookup, refund, settlement report) to be agreed before implementation. Showroom account development is likewise owned by other engineers and is not modified before the last functional stage.
9. **Product structure is data-driven.** Categories, product types, fields, options (materials, colors, patterns, textures, finishes), filters and variant axes are managed by Aladdin Admin through a Dynamic Product Schema Builder; add-product forms are generated from the schema; showrooms cannot change it; schema changes are versioned and never delete stored values. Measurements are numeric (canonical unit) and are not the unit of sale. Admin UI is independent of the showroom account and is built later.
10. **Prices are displayed exclusive of VAT/applicable taxes.** Taxes are separate line items in cart and checkout, delivery fees are separate, the final payable total is shown before confirmation, components are stored separately with **tax-rate and tax-amount snapshots** per order item, **no universal VAT rate is hardcoded**, refunds and partial cancellations adjust tax, and invoice/receipt issuance and tax remittance responsibility must be documented before production launch. All totals are computed server-side.

## Rationale

The market need (discovery and direct purchase of finishing materials) is distinct from the consultation/RFQ workflow. Isolating it as its own bounded domain preserves the existing product direction and lets the feature ship, be gated, and be rolled back independently.

## Scope

Public catalog, cart, checkout, payments (consumed via the integration contract), seller settlement records, orders and seller management for the six approved initial product types. Not: services marketplace, RFQ changes, new installer taxonomy, buyer wallet, a Marketplace-side gateway integration.

## What is deferred

Commission model, settlement schedule/hold/payout policy, merchant-of-record and tax-responsibility determination, refund policy values, reconciliation process, delivery-zone pricing, bundles, ratings, additional product types and seller types, shipping-carrier integrations, organization-on-behalf purchasing.

## Consequences

- `PRODUCT_DIRECTION_GUIDE.md` needs a **change-history entry** carving out the Marketplace (pending; not yet edited).
- `mvp-scope.md`'s "no checkout / free pilot" boundary must state it applies to the B2B pilot, not the Marketplace (pending).
- `ARCHITECTURE_GUIDE.md` gains a Marketplace module entry and `DECISION_LOG.md` a row for this ADR when Accepted (pending).
- Implementation is gated by the seven-stage plan; **no migrations before the Stage 1 architecture is approved.**

## Related files

[`../marketplace/MARKETPLACE.md`](../marketplace/MARKETPLACE.md) · [`../product/PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md) · [`../product/mvp-scope.md`](../product/mvp-scope.md) · [`ADR-0007-identity-and-tenancy-model.md`](ADR-0007-identity-and-tenancy-model.md)
