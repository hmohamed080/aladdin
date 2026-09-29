# PD-011 — Organization Suspension: Module-by-Module Effects

| | |
|---|---|
| **Status** | DOCUMENTATION ONLY — no backend implementation. This is the prerequisite artifact PD-011 requires before BL-002 (organization suspension) begins. |
| **Version** | 1.0.0 |
| **Owner** | Product / Foundation |
| **Created** | 2026-09-20 (Phase 0B — Admin Product Blueprint Enrichment) |
| **Depends On** | [`PRODUCT_DECISIONS_REGISTER.md`](PRODUCT_DECISIONS_REGISTER.md) — PD-011 |
| **Related** | [`ADMIN_IMPLEMENTATION_BACKLOG.md`](ADMIN_IMPLEMENTATION_BACKLOG.md) — BL-002 |

PD-011 approved the **principle** that organization suspension restricts organization-*level* capability without collapsing into member-suspension, and required this module-by-module effect list be produced **before** BL-002's backend work begins. Nothing in this document authorizes implementation — it is the design surface BL-002 must be built against, per PD-011's own gate. Every row below follows the same default unless stated otherwise: **members keep their own identity and history; the organization's records are preserved; only the organization's ability to transact NEW activity is restricted.**

Two states are distinguished throughout:
- **Existing / in-flight** — data or a transaction that existed before the suspension moment.
- **New** — an action a member or a counterparty would try to take *after* the organization is suspended.

---

## 1. Marketplace / Products (catalog)

- **Existing products** remain in the database, unpublished from public search/browse for the suspension's duration (the same "hidden, not deleted" pattern the catalog module already uses for `D(soft)` per `docs/technical/07_permissions_matrix.md`).
- **New product creation/edit/publish**: blocked server-side (RLS/RPC) for the suspended organization's members.
- **A consumer who already has a product page open/bookmarked**: sees it as unavailable, not a 404 — the record is not deleted.

## 2. Jobs / Opportunities

- **Existing open job postings**: unpublished from the public jobs board (same "hidden, not new" rule as products) — already-submitted applications are preserved and readable by both sides.
- **New job postings**: blocked.
- **An applicant with an in-flight application to a job now suspended**: can still read their own application and its history; cannot expect a new response *from the org* while it is suspended (the org itself cannot act), but nothing is silently withdrawn or deleted.

## 3. RFQs & Quotations

- **If the suspended org is the RFQ requester**: existing RFQs and the quotes already submitted to them remain fully readable by the requester and every responder who already quoted (per the existing "no responder ever reads another responder's quote" guarantee — suspension does not relax or break that). The requester cannot open a *new* RFQ while suspended.
- **If the suspended org is a responder**: quotes it already submitted stay visible to the requester (a requester should not lose visibility into a decision they already have in hand); the org cannot submit *new* quotes.
- **Decision (`quote.decide`)**: an in-flight decision by a *counterparty* on a quote from a suspended responder is not blocked by the responder's suspension — the counterparty's own capability is unaffected by the other side's status.

## 4. Orders

- **Existing orders (any status: confirmed/in_progress/completed)**: fully preserved and readable by both parties; a suspended org does not vanish from an order it is already part of.
- **New orders**: cannot be created *by* the suspended organization; whether a *counterparty* may still place a new order *with* a suspended organization is a product question, not an engineering default — the safe default is **no**, since the org cannot act on it (fulfil/respond), and this must be confirmed at BL-002 design time, not assumed.
- **In-progress fulfilment**: an order already `in_progress` is not auto-cancelled by suspension — cancellation, if warranted, is a separate, explicit admin or counterparty action, never an automatic side effect of the suspend RPC.

## 5. Projects

- **Existing projects** (org is a member/participant): remain readable; a suspended org's members keep read access to a project's existing activity/history per PD-011's "history preserved" rule.
- **New project creation** or accepting a new project invitation: blocked for the suspended organization.

## 6. CRM (Sales: customers, leads, activities, follow-ups)

- **Existing customer/lead/activity records** (branch-scoped per ADR-0008): preserved, still readable by the org's own Sales members (they are looking at their own tenant's data, which PD-011 explicitly preserves).
- **New customer creation, lead capture, or follow-up send**: blocked — these are org-capability actions (`sales.write`/`sales.followup.send`), not personal ones.
- **Assignment/reassignment** (`sales.assign`/`sales.manage`): blocked along with every other org-capability write, since it changes organization-owned state.

## 7. Members & Memberships

- **Every existing member keeps their own personal user account, status, and login** — a suspended organization never suspends its members as users (that is PD-010's separate, independent capability). This is PD-011's central guarantee, restated here as its own row so it is never conflated with the module effects above.
- **New member invitations**: blocked (an org-level capability write).
- **Existing members leaving voluntarily**: not blocked by the org's suspension — leaving is the member's own action on their own membership.

## 8. Branches

- **Existing branches**: preserved, unaffected in the database; branch-scoped Sales/RFQ/order data under them is governed by the rules above (existing preserved, new blocked).
- **New branch creation**: blocked.

## 9. Messaging / Conversations

- **Existing conversation threads and their message history**: fully preserved and readable by every existing participant, on both sides — suspension never deletes or hides message history, per PD-011's "history preserved" rule and the platform-wide no-hard-delete stance (PD-010).
- **New messages from a suspended org's member, sent in the capacity of that organization** (e.g. via an org-owned conversation, not the member's personal account): blocked, since sending as the organization is an org-capability action.
- **A counterparty messaging a suspended org**: the message is not blocked outbound, but the suspended org cannot respond in-organization capacity until restored — this must be surfaced honestly in the UI (e.g. "this organization is currently suspended"), never silently swallowed.

## 10. Payments / Subscriptions

- No billing exists in the MVP (`docs/technical/07_permissions_matrix.md` §"Subscriptions": *"no billing in MVP"*), so there is no payment-processing effect to define yet. **Subscription state** (`subscription.read`/`manage`) itself: an org's own subscription record is preserved; whether a suspended org's subscription auto-pauses or continues unchanged is a product decision explicitly **out of scope for PD-011** and must not be assumed either way by BL-002 — it is called out here only so the gap is visible, not silently decided by omission.

## 11. Reviews & Reference Data touches

- **Existing reviews about or by the organization**: preserved, per the platform-wide no-hard-delete stance — never removed as a side effect of suspension.
- **New reviews**: whether a consumer can still leave a new review about a currently-suspended organization is a product question (arguably yes — the org's past performance is still a legitimate thing to review); BL-002 must confirm this explicitly rather than default it.

## 12. Existing in-flight operations — cross-cutting rule

Restated once, since it governs every module above: **suspension is never a mid-transaction abort.** No RFQ, quote, order, project, or conversation that is already in progress at the moment of suspension is automatically cancelled, force-closed, or hidden from its existing participants as a *direct effect of the suspend RPC*. Any such closure, if ever warranted for a specific case, is a separate, explicit, and audited action — never bundled into `organization.suspended`.

---

## What this document does NOT decide

- The exact RLS/RPC mechanics enforcing each "blocked" row above (BL-002's own design work).
- Whether a suspended organization disappears from public directory/search results entirely, or merely loses its "new activity" capability while remaining discoverable with a suspended badge — **recommended default: hidden from search/browse, same as an unverified org, but still resolvable by direct link for anyone who already has a relationship with it** (consistent with the "hidden, not deleted" pattern used throughout this document) — subject to Product confirmation at BL-002 design time.
- The subscription-state and new-review-on-suspended-org gaps flagged in §10/§11, both explicitly deferred to BL-002 design rather than decided here.

This document satisfies PD-011's documentation prerequisite. BL-002 (organization suspension backend) remains unscheduled — Phase 1 backend implementation has not started.
