# 14 — Future Extensions

| | |
|---|---|
| **Status** | Specification · Phase 0.7 (pre-implementation) |
| **Version** | 1.0.0 |
| **Owner** | Architecture / Foundation |
| **Last Updated** | 2026-08-01 |
| **Depends On** | ../product/PRODUCT_DIRECTION_GUIDE.md, ../product/mvp-scope.md |
| **Related** | 01_system_overview.md |

What is **in the MVP** vs **deferred**, with rationale. This separates scope so implementation tasks never accidentally build a post-MVP feature. Sources: [`PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md) (Deferred Scope, non-goals), [`mvp-scope.md`](../product/mvp-scope.md), the ADRs.

## 1. In MVP (build these)

Passwordless auth · onboarding/profiles · roles & derived navigation (one primary account type; no switcher) · portfolio · product catalog · smart search · AI assistant (consultation/intent/match-explanation/follow-up drafting, human-reviewed) · notifications · subscription (state only, no billing) · advertisement (moderated) · admin · **the core value journey** (AI consult → intent → discovery → search → matching → profile → product → RFQ → quote → project), built **Sales-first (05C → 05A → 05B → 05D → 05E)**.

Cross-cutting: bilingual AR-RTL/EN-LTR, Light+Dark, responsive PWA, Egyptian localities + EGP, RLS tenant isolation, human-in-the-loop AI.

## 2. Deferred — designed at IA/DS level, built later

| Feature | Why deferred | Blueprint hooks already in place |
|---|---|---|
| **Payments / escrow / milestones / disputes** | Explicit non-goal for MVP; needs a payment ADR + compliance | `projects` has no financial fields; `subscriptions` has no billing; adapter seam reserved |
| **Installation & service marketplace** | Full-platform scope beyond the pilot value chain | catalog/matching/rfq generalize to services later |
| **Industrial / RFQ at scale** | MVP RFQ is consultation-scale, not high-volume auction | `rfq_recipients` fan-out + indexing can extend |
| **Deeper supplier/technician matching** | Needs liquidity + data the MVP generates first | `matches` + pgvector already model ranked/explained matches |
| **Project execution workflow (milestones)** | Beyond MVP tracking/follow-up | `projects`/`project_activities` extend with milestone tables |
| **Learning & training (Trainer/Trainee)** | Account types exist; feature surface deferred | account-type enum includes trainer/trainee |
| **Business opportunities / supply-chain workflow** | Full-platform | pipeline/opportunity model generalizes |
| **Advanced analytics / BI** | Dashboards built last (05E); deep BI later | `analytics_snapshots` derived model |
| **Work-context (workspace) switcher** | Approved direction, not built; the model already permits many memberships per identity | workspaces are **derived** (User+Profile / Organization+active Membership) — no `workspaces` table is to be added |
| **"Add / create a business" for an existing user** | Approved direction, not built | creates `Organization` + owner `Membership` for the **existing** user — no second sign-up, no duplicate profile |
| **Account lifecycle: deactivate / delete** | Approved future rule only — **do not implement now** | deactivate reversible; delete request → grace period → final deletion releases the login identity per privacy policy while **business/audit history remains**; a later account on the same released email/phone gets a **new** user id and inherits nothing; historical actions show a **muted, non-clickable** historical name. Leaving an organization ≠ deleting an account (PRODUCT_DIRECTION_GUIDE *Account Lifecycle*) |

## 3. Deferred — technical / platform

| Item | Why deferred | Notes |
|---|---|---|
| **Mobile / web push (Firebase or Web Push)** | No native app; MVP uses Realtime+email+WhatsApp | add `PushProvider` adapter + device-token table |
| **Google Maps / Places** | Internal localities + PostGIS suffice for MVP | swap-in behind a `GeoProvider` if richer geo needed |
| **Cloudinary / external media CDN** | Supabase Storage is the store | only via ADR if transform needs outgrow Supabase |
| **Additional LLM/AI providers** | Only OpenAI approved | `LlmProvider` adapter ready |
| **Enterprise: org groups / holding structures, delegated cross-org admin, SSO/SAML** | Beyond pilot tenancy | `memberships` set-based RLS ([06](06_rls_strategy.md)) leaves room |
| **Org-customizable pipeline stages** | MVP uses a fixed stage set | `opportunity_stage` enum → reference table later |
| **CI/CD pipeline** | Deferred (ADR-0004); commands documented | run validation manually until wired |
| **Service extraction (any domain → own service)** | Only on measured need (ADR-0001) | clean module boundaries preserved |
| **Super Admin platform role** | MVP platform roles = support/moderator/administrator | `platform_role` enum extends |
| **`super_admin` / platform config UI** | Later governance need | — |

## 4. Never (out of scope by product direction)

- Add-to-cart / checkout / storefront commerce.
- Price-war reverse-auction / blind price bidding.
- A generic, configurable horizontal CRM.
- Merging roles / a Profile Switcher / "Use As" mode / persona (account-identity) switching UI. *(Selecting the active **work context** between the personal surface and organizations where the user has an active membership is **not** this, and is allowed — see §2.)*
- A second user/auth identity for the same person (per role, per contact channel, or per business), or a generic `workspaces` table.
- Passwords / forgot / reset flows (product is passwordless).
- Excluded infrastructure: Kubernetes, Kafka, RabbitMQ, Redis, Elasticsearch/OpenSearch, event sourcing, CQRS frameworks, service mesh, API gateway, second database, Vite/React SPA/React Router, Alembic (ADR-0001/0002).

## 5. Extension principle

Every deferred feature must (a) fit the existing tenancy + RLS model, (b) reuse the adapter seams, and (c) arrive with its own ADR/spec + migration + RLS tests. Nothing here is pre-built; the blueprint only ensures the MVP schema/patterns **don't block** these later.
