# Marketplace checkout, orders and showroom payment methods

Status: built 2026-11-14 on `feat/marketplace` (PR 190), local stack verified. Migration
`20261112100014_marketplace_orders.sql`, pgTAP `131_marketplace_orders_test.sql`.

## What the owner decided

| Topic | Decision |
|---|---|
| Payment | Each showroom chooses its own methods on `/showroom/marketplace/payments`: **cash on delivery**, **InstaPay deposit** (buyer transfers, uploads the receipt, the showroom accepts it before confirming; the showroom sets the deposit %, 100 = paid in full), **online card gateway** shown as "Soon". |
| Buyer | Signs in at checkout. The cart itself stays guest (browser). |
| Reservation | Stock is reserved when the order is placed and stays reserved, **with no time limit**, until the showroom confirms (deducted) or the order is cancelled (released). |

## Flow

1. Cart (`/marketplace/cart`) → "Place order" opens once every showroom can serve the chosen way of receiving.
2. Checkout (`/marketplace/checkout`): signed-out visitors see a sign-in panel. Signed-in buyers enter
   name, phone, note and address, then per showroom choose delivery/pickup and a payment method that
   showroom offers. `marketplace_checkout_place` re-prices everything, creates **one order per
   showroom** (`MP-000001`…), reserves stock, and is idempotent per attempt key.
3. Buyer: `/marketplace/orders`, `/marketplace/orders/[id]` — cancel while pending; InstaPay details and
   receipt upload (central media system, namespace `marketplace`, key `proofs/<order>/<id>.<ext>`,
   stored at `u/<buyer>/certificates/<id>/original.<ext>`).
4. Showroom: `/showroom/marketplace/orders`, `/showroom/marketplace/orders/[id]` — status tabs, receipt
   review (reject needs a reason), and the steps confirm → prepare → ship / ready → delivered →
   payment received, plus failed delivery → returned and cancel (reason required).

## Differences from `MARKETPLACE.md` §7–§10 (not built yet)

- No tax lines or tax snapshots (DL-16): totals are products + delivery, like the cart.
- No buyer account-type eligibility check (§9) and no DB `checkout_enabled` flag (§10); the release
  flag `NEXT_PUBLIC_MARKETPLACE_PREVIEW` still gates the pages.
- After sign-in, the existing post-auth rule sends people to their own landing surface, not back to
  `/marketplace/checkout`; the cart is kept, the buyer returns to it manually.
- No online payment; no confirmation-by-order-number route (the success panel links to each order).
