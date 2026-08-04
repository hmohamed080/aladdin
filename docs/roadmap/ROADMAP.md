# Aladdin — Project Roadmap

| | |
|---|---|
| **Status** | Living document (canonical delivery roadmap) |
| **Version** | 1.0.0 |
| **Owner** | Product / Engineering |
| **Last Updated** | 2026-08-01 |
| **Depends On** | [`../product/mvp-scope.md`](../product/mvp-scope.md), [`../product/PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md) |
| **Related** | [`../product/BACKLOG.md`](../product/BACKLOG.md), [`../technical/TECHNICAL_DEBT.md`](../technical/TECHNICAL_DEBT.md), [`../development/github-workflow.md`](../development/github-workflow.md) (milestones) |

The phase plan for Aladdin. **Source of truth for scope/order is [`mvp-scope.md`](../product/mvp-scope.md)** and [`PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md); this roadmap sequences delivery and maps to the design-roadmap modules (**05C → 05A → 05B → 05D → 05E**, Sales-first). It does **not** re-decide scope.

> **Reconciliation note:** "Marketplace" below means Aladdin's **consultation-first discovery + catalog + Sales operating workflow** — **not** commerce/checkout/price-war (explicitly a product non-goal). Ordering stays **Sales-first**.

**Estimates** are relative sizing pending sprint planning + product-owner sign-off on the [`⚑ OPEN`](../technical/README.md) items; they are not committed dates.

## Completed phases

### Phase 0 — Foundation ✅
- **Objective:** stand up the repository, approved stack scaffold, and agent-instruction hierarchy.
- **Deliverables:** Next.js + Supabase + FastAPI + workers scaffold; `.gitignore`/`.gitattributes`; root + scoped `AGENTS.md`; ADR-0001…0004; initial docs.
- **Dependencies:** none.
- **Success criteria:** services build; typecheck/lint/test green; no product features.
- **Completion:** ✅ 2026-07-29/30.

### Phase 0.5 — Architecture ✅
- **Objective:** fix the active architecture + canonical project memory.
- **Deliverables:** `ARCHITECTURE_GUIDE.md`, `RUNTIME_STATE.md`, `AGENT_WORK_LOG.md`, ADR-0005 (data access), memory reconciliation.
- **Dependencies:** Phase 0.
- **Success criteria:** one current-state architecture reference; memory consistent; backend validated.
- **Completion:** ✅ 2026-07-30.

### Phase 0.7 — Technical Specification ✅
- **Objective:** the complete MVP engineering blueprint.
- **Deliverables:** [`docs/technical/`](../technical/README.md) — 15 docs (system/domain/DB/ERD/storage/RLS/permissions/API/jobs/events/state-machines/validation/integrations/future).
- **Dependencies:** Phase 0.5.
- **Success criteria:** a senior engineer could build the MVP from it; links 0-broken; open items flagged.
- **Completion:** ✅ 2026-08-01.

### Phase 0.8 — Engineering Standards ✅
- **Objective:** how every feature is built.
- **Deliverables:** [`docs/engineering/`](../engineering/README.md) — structure/coding/API/errors/validation/testing/feature-workflow/migrations/PR/CI/perf-security/AI-rules.
- **Dependencies:** Phase 0.7.
- **Success criteria:** all 25 standard topics covered; no duplication.
- **Completion:** ✅ 2026-08-01.

### Phase 0.9 — Governance ✅ (this phase)
- **Objective:** production-grade repository governance and planning artifacts.
- **Deliverables:** ADR-0006 (repository governance), this **ROADMAP**, [`BACKLOG.md`](../product/BACKLOG.md), [`TECHNICAL_DEBT.md`](../technical/TECHNICAL_DEBT.md), [`DOCUMENTATION_STATUS.md`](../DOCUMENTATION_STATUS.md), [`DECISION_LOG.md`](../decisions/DECISION_LOG.md); development/git-github/release docs + `.github` templates (Phase-0.8/0.9 boundary).
- **Dependencies:** Phase 0.8.
- **Success criteria:** governance documented + cross-referenced; index updated; no orphan docs; no conflicts with ADRs/Product Direction/MVP Scope.
- **Completion:** ✅ 2026-08-01.

---

## Implementation phases (ahead)

### Phase 1 — Identity & Multi-tenancy
- **Objective:** the canonical passwordless identity and the tenant model everything else depends on.
- **Deliverables:** `users/profiles/contacts`; orgs/branches/memberships/capabilities; passwordless OTP (WhatsApp/Email) auth; RLS helper functions + JWT claims; **organization-isolation tests**; account-type + platform-role model.
- **Dependencies:** Phase 0.9; product sign-off on auth/verification `⚑ OPEN` items.
- **Success criteria:** two orgs fully isolated (all four verbs) with passing tests; passwordless sign-in works Local; capability-derived access; 0 cross-tenant leakage.
- **Estimate:** ~2–3 sprints. **Branch:** `feature/identity-multitenancy`.

### Phase 2 — Core Marketplace (Sales-first discovery + catalog)
- **In progress (Sprint 3, 2026-08-03):** the **B2B Sales domain foundation** — tenant-owned `customers`/`leads`/`sales_activities`/`follow_up_tasks` with scope RLS, 13 constrained workflow RPCs, audit, and dashboard read-models ([ADR-0008](../decisions/ADR-0008-b2b-sales-domain-model.md)); **337 pgTAP** green (merged, PR #5).
- **Merged (Sprint 4 + 4.1 + 4.2):** the **first product UI (05C vertical slice)** — passwordless Email-OTP auth + guarded B2B workspace (cockpit, customers, leads list/pipeline, follow-ups) on real RLS/RPCs; Arabic-first RTL + English + light/dark, responsive; public-directory Advisor hardening ([`frontend/sprint-4-b2b-sales-ui.md`](../frontend/sprint-4-b2b-sales-ui.md)).
- **In progress (Sprint 5, 2026-08-04):** **05C depth** on `feature/sales-ui-depth` — real customer/lead/follow-up **edit** flows (trusted RPCs), richer customer detail, accessible confirmation dialogs, and a local **Playwright** E2E foundation ([`frontend/sprint-5-sales-ui-depth.md`](../frontend/sprint-5-sales-ui-depth.md)). Next: broaden 05C (post-create reassignment RPCs, Realtime), then RFQ/quote/project journeys. RFQ/quotes/products/projects stay later in the phase.
- **Objective:** the core value-chain surfaces — **05C B2B Sales workflow first (the wedge)**, then **05A B2C value journey** — on catalog + discovery.
- **Deliverables:** catalog (products/brands/categories/media) + inventory/availability; smart search (FTS/`pg_trgm`); verification gating; Sales pipeline (Opportunity → Need → Match → Smart Share → Follow-up → Task) with Realtime; B2C discovery + AI consult entry.
- **Dependencies:** Phase 1; matching needs identity + catalog liquidity.
- **Success criteria:** a Sales user runs a real pipeline; a need becomes a trusted match; discovery/search work bilingually + both themes; RLS holds.
- **Estimate:** ~4–6 sprints. **Branch:** `feature/sales-workflow` then `feature/b2c-discovery`.

### Phase 3 — Projects & Quotations (05B)
- **Objective:** RFQ → quote comparison → decision → project follow-up.
- **Deliverables:** RFQ/RfqItem; Quote/QuoteItem/QuoteDecision (anti-auction visibility); quote comparison; Project/ProjectActivity tracking; PDF quote generation (Arabic-shaping).
- **Dependencies:** Phase 2 (needs/opportunities + catalog).
- **Success criteria:** comparable quotes without leaving the system; no responder sees another's pricing; accepted quote → project; state machines enforced.
- **Estimate:** ~3–4 sprints. **Branch:** `feature/rfq-quotations`.

### Phase 4 — AI Assistant
- **Objective:** mature the FastAPI AI service — consultation, intent extraction, match explanation, follow-up drafting, RAG — human-in-the-loop.
- **Deliverables:** `/v1/ai/*` + `/v1/retrieval` endpoints; embeddings/OCR pipelines (workers); tenant-filtered retrieval; AI evaluations. (AI is threaded through Phases 2–3; this phase deepens it.)
- **Dependencies:** Phases 1–3 (data to reason over); OpenAI; OCR provider finalized.
- **Success criteria:** retrieval never crosses orgs; AI drafts/ranks with explanations; humans decide/send; graceful degradation.
- **Estimate:** ~3–4 sprints. **Branch:** `feature/ai-assistant`.

### Phase 5 — Advertisements, Supplier Ops & Cockpits (05D + 05E)
- **Objective:** promoted placements + supplier/product operations, then dashboards.
- **Deliverables:** advertisements (moderated) + placements; supplier/showroom product ops (05D); B2B cockpit + admin completion + analytics (05E, dashboards last); subscription state gating; notifications maturity.
- **Dependencies:** Phases 2–4 (inner workflows exist before dashboards summarize them).
- **Success criteria:** ads moderated before live; cockpits are action surfaces (not vanity); analytics derived; admin governance + audit complete.
- **Estimate:** ~3–5 sprints. **Branch:** `feature/ads-supplier-ops`, `feature/cockpit-admin`.

---

## Future roadmap (post-MVP — see [`../technical/14_future_extensions.md`](../technical/14_future_extensions.md) & [`TECHNICAL_DEBT.md`](../technical/TECHNICAL_DEBT.md))

Payments / escrow / milestones / disputes · installation & service marketplace · industrial RFQ at scale · deeper supplier/technician matching · project-execution (milestones) · learning & training (Trainer/Trainee) · business opportunities · supply-chain workflow · advanced analytics/BI · mobile/web push · enterprise (org groups, SSO) · CI/CD pipeline · service extraction. **Each arrives with its own ADR/spec + migration + RLS tests.** Nothing on the product "never build" list.

## Cross-references
[`mvp-scope.md`](../product/mvp-scope.md) (scope + order) · [`PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md) (roadmap authority) · [`github-workflow.md`](../development/github-workflow.md) (milestones mirror these phases) · [`RUNTIME_STATE.md`](../operations/RUNTIME_STATE.md) (live phase).
