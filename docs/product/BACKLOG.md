# Product Backlog (MoSCoW)

| | |
|---|---|
| **Status** | Living document (prioritized backlog) |
| **Version** | 1.0.0 |
| **Owner** | Product |
| **Last Updated** | 2026-08-01 |
| **Depends On** | [`mvp-scope.md`](mvp-scope.md), [`PRODUCT_DIRECTION_GUIDE.md`](PRODUCT_DIRECTION_GUIDE.md) |
| **Related** | [`../roadmap/ROADMAP.md`](../roadmap/ROADMAP.md), [`../technical/README.md`](../technical/README.md), [`../technical/TECHNICAL_DEBT.md`](../technical/TECHNICAL_DEBT.md) |

Prioritized backlog for the Private Pilot MVP. **Source of truth for scope is [`mvp-scope.md`](mvp-scope.md)**; this file prioritizes and tracks it. `Status` is repository-wide state — everything is **Not started** (pre-implementation). `Owner` is `TBD` until team assignment; `area:` labels ([`../development/github-workflow.md`](../development/github-workflow.md)) indicate the owning module. Roadmap phases: [`ROADMAP.md`](../roadmap/ROADMAP.md).

## Must Have (MVP-critical)

| Feature | Priority | Phase | Dependencies | Status | Owner | Notes |
|---|---|---|---|---|---|---|
| Passwordless auth (WhatsApp/Email OTP) | P0 | 1 | — | Not started | TBD (auth) | No passwords/reset; reCAPTCHA on create ([`08_api_contracts`](../technical/08_api_contracts.md)) |
| Canonical identity + account types | P0 | 1 | auth | Not started | TBD (accounts) | one primary type; no switcher |
| Organizations / branches / memberships / capabilities | P0 | 1 | identity | Not started | TBD (organizations) | tenant model |
| RLS + organization-isolation tests | P0 | 1 | tenancy | Not started | TBD (supabase) | blocking per table ([`06_rls_strategy`](../technical/06_rls_strategy.md)) |
| Verification (identity/org) | P0 | 1–2 | orgs; OCR | Not started | TBD (verification) | trust gate; OCR async |
| Product catalog (products/brands/categories/media) | P0 | 2 | orgs; storage | Not started | TBD (catalog) | publish gate = verified + media |
| Inventory & availability | P1 | 2 | catalog | Not started | TBD (inventory) | availability signal, Realtime |
| Smart search (FTS + trgm) | P0 | 2 | catalog | Not started | TBD (catalog) | server-side paginated |
| B2B Sales workflow (05C — the wedge) | P0 | 2 | identity; catalog | Not started | TBD (sales) | Opportunity→Need→Match→Share→Follow-up→Task |
| B2C value journey (05A) | P0 | 2 | catalog; AI consult | Not started | TBD (accounts/ai) | discovery → matching → RFQ |
| RFQ | P0 | 3 | needs; catalog | Not started | TBD (rfq) | anti-auction; consultation-first |
| Quotations (quote/compare/decision) | P0 | 3 | RFQ | Not started | TBD (quotations) | no cross-responder visibility |
| Projects (tracking/follow-up) | P1 | 3 | quotes | Not started | TBD (projects) | no milestones/escrow (deferred) |
| AI Assistant (consult/intent/match/follow-up) | P0 | 2–4 | data; OpenAI | Not started | TBD (ai) | human-in-the-loop; tenant-filtered |
| Notifications (in-app/email/WhatsApp) | P1 | 2–5 | events | Not started | TBD (notifications) | Realtime + preferences |
| Admin (verification review, moderation) | P1 | 1–5 | platform roles | Not started | TBD (admin) | audited cross-tenant actions |

## Should Have

| Feature | Priority | Phase | Dependencies | Status | Owner | Notes |
|---|---|---|---|---|---|---|
| Conversations & messaging | P1 | 2–3 | participants | Not started | TBD (conversations) | attached to consult/RFQ/project |
| Subscription (state + entitlements) | P2 | 5 | orgs | Not started | TBD (subscriptions) | **no billing MVP**; tiers ⚑ OPEN |
| Advertisements (moderated placements) | P2 | 5 | catalog; moderation | Not started | TBD (advertisements) | consultation-first framing |
| Supplier/showroom product ops (05D) | P2 | 5 | catalog | Not started | TBD (catalog) | requests/quotes/campaigns |
| Analytics / cockpits (05E) | P2 | 5 | inner workflows | Not started | TBD (analytics) | dashboards last; derived |
| Professional portfolio | P2 | 2 | profiles; storage | Not started | TBD (accounts) | engineers/designers |

## Could Have

| Feature | Priority | Phase | Dependencies | Status | Owner | Notes |
|---|---|---|---|---|---|---|
| Data export (Excel/PDF) | P3 | 3–5 | features | Not started | TBD | private `exports/`; short TTL |
| Advanced search facets/filters | P3 | 2+ | search | Not started | TBD | beyond MVP baseline |
| Richer notification channels/digest | P3 | 5 | notifications | Not started | TBD | opt-in marketing |
| AI evaluations surface | P3 | 4 | ai | Not started | TBD | quality tracking |

## Won't Have (current MVP)

Explicitly out of the pilot — see [`14_future_extensions.md`](../technical/14_future_extensions.md) and [`TECHNICAL_DEBT.md`](../technical/TECHNICAL_DEBT.md). "Never" items are product non-goals, not merely deferred.

| Item | Reason | Category |
|---|---|---|
| Payments / escrow / milestones / disputes | deferred; needs payment ADR + compliance | Deferred |
| Installation & service marketplace | full-platform scope | Deferred |
| Industrial RFQ at scale | pilot is consultation-scale | Deferred |
| Learning & training (Trainer/Trainee features) | account types exist; surface deferred | Deferred |
| Mobile / web push (Firebase) | no native app; Realtime+email+WhatsApp | Deferred |
| Google Maps / Places · Cloudinary | internal localities+PostGIS · Supabase Storage | Deferred (unapproved) |
| Enterprise (org groups, SSO/SAML) | beyond pilot tenancy | Deferred |
| Add-to-cart / checkout / storefront | **never** (consultation-first) | Never |
| Price-war reverse-auction / blind bidding | **never** | Never |
| Generic horizontal CRM | **never** | Never |
| Profile switcher / "Use As" / role toggle | **never** (derived nav) | Never |
| Passwords / forgot / reset | **never** (passwordless) | Never |

## Maintenance

Reprioritize with product-owner sign-off; a `Won't Have` → `Could/Should` move updates [`mvp-scope.md`](mvp-scope.md) + `ROADMAP.md` in the same change. `⚑ OPEN` decisions block their dependent items until resolved (label `needs-product-decision`).
