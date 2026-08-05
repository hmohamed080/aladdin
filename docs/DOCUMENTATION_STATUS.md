# Documentation Status

| | |
|---|---|
| **Status** | Living document (documentation coverage tracker) |
| **Version** | 1.0.0 |
| **Owner** | Foundation / Documentation |
| **Last Updated** | 2026-08-05 |
| **Depends On** | [`README.md`](README.md) (index) |
| **Related** | [`decisions/DECISION_LOG.md`](decisions/DECISION_LOG.md), [`technical/TECHNICAL_DEBT.md`](technical/TECHNICAL_DEBT.md), [`roadmap/ROADMAP.md`](roadmap/ROADMAP.md) |

Documentation coverage by area. **Coverage %** = how completely the area is documented **for the current phase (pre-implementation)** — high coverage here means "specified", not "implemented". `Missing Items` are gaps or `⚑ OPEN` decisions ([`TECHNICAL_DEBT.md`](technical/TECHNICAL_DEBT.md) §7). Index: [`README.md`](README.md).

| Area | Coverage | Status | Owner | Last Updated | Missing items |
|---|---|---|---|---|---|
| **Product** | 95% | Stable | Product | 2026-08-01 | Commercial/pricing model, pilot success metrics (`⚑ OPEN`); `client-brief.md` is a placeholder |
| **Architecture** | 100% | Stable | Architecture | 2026-08-01 | — (ADR-0001…0006 + guide; revisit on measured scaling need) |
| **Technical spec** | 100% | Stable (Phase 0.7) | Architecture | 2026-08-01 | Per-category product attribute schemas; several `⚑ OPEN` product decisions flagged inline |
| **Database** | 98% | Stable (spec + Phase 1/2 impl) | Engineering/Data | 2026-08-03 | Phase 1 identity/tenancy + Sprint 2/2.1 write paths + **Phase 2 Sprint 3 sales domain** (`customers`/`leads`/`sales_activities`/`follow_up_tasks`, 13 RPCs, read-models — migrations `2026080509000x`, ADR-0008); composite-FK tenant safety; direct client/service DML bypasses closed; remaining product tables authored per feature; AR FTS stemming config `⚑ OPEN` |
| **Security** | 98% | Stable | Security | 2026-08-04 | Independent Sprint 2.1 catalog/behavior review completed: one privileged RPC boundary, exact role/table/function ACLs, verification immutability, audit rollback, and real last-owner/approval concurrency gates. **Sprint 4.2:** the two public-directory Advisor "Security Definer View" findings were resolved (`security_invoker` views over constrained `security definer` `app._*` readers; ADR-0007 D21). Formal threat model, pen-test, and future-feature authz matrices remain deferred. |
| **API** | 100% | Stable (contracts) | Engineering | 2026-08-01 | Contracts complete; realized endpoints land with features |
| **Engineering standards** | 100% | Stable (Phase 0.8) | Engineering | 2026-08-01 | — (12 docs + index; all 25 topics covered) |
| **Testing** | 96% | Stable (strategy + Phase 1/2 suites) | Engineering | 2026-08-04 | **337 pgTAP** assertions across 16 files (254 identity/tenancy + 83 sales) + three real-session race tests, gated by `supabase-rls`; frontend **92 tests** (Sprint-4 UI + Sprint-4.1 review: i18n parity, error-mapping, capability + branch/org resolvers, auth boundary, query org/branch narrowing, search sanitization, no-nested-form DOM test) pass; backend 10 tests pass on CI. **Sprint 4.2:** pgTAP **337 → 366** (+29, new `17_public_directory_hardening`: Advisor definer-view catalog checks, exact grants, PUBLIC-execute denial, base-table privacy, end-to-end discovery). **Sprint 5:** frontend **92 → 104** (+12: customer/lead/follow-up edit actions, follow-up-not-open mapping, ConfirmDialog a11y) + a local Playwright E2E foundation. **Sprint 5.1:** frontend **104 → 114**; pgTAP **366 → 382**; **5** race scripts; Playwright E2E executed. **Sprint 6:** frontend **114 → 130** (ownership wrapper contracts + delta-computing form actions); pgTAP **382 → 416** (+34 `19_sales_ownership`: security posture, scope/capability, concurrency, audit-on-success + none-on-conflict, lifecycle immutability, strand rejection, cross-tenant rejection, direct-DML denial, Realtime publication membership) across 19 files; **6** race scripts (added `lead_ownership`); **executed** E2E (two-context Realtime), visual-QA matrix, and production-perf gates. **Sprint 6.1:** added `realtime-scope` E2E (6 two-context scenarios: branch-scope narrowing/teardown, sign-out removal, revoked-membership no-leak, open-form deferral, duplicate→one-row) via a test-safe `window.__salesRealtime` adapter; visual-QA extended to **both roles** full 4×{en,ar}×{light,dark} + dialogs/states (fixed a customer-detail 360px overflow); **Lighthouse executed** (sign-in Desktop 100/Mobile 98, /b2b 98, /b2b/leads 96 — all targets met); extended perf.spec (cold+median-warm, slowest-actual-request, channels=1/dup=0); a sign-in test flake made deterministic (0/14 full-suite runs). Further suites land with features. |
| **Frontend / UI** | 50% | In progress (Phase 2 Sprint 6) | Engineering | 2026-08-05 | **Sprint 6** adds post-create **ownership** edits (customer branch/assignee, lead source/branch) via trusted RPCs behind capability-gated confirm dialogs, and **scoped Realtime** (refresh-only, RLS-scoped) on the pipeline + follow-up board; executed E2E (incl. two-context Realtime), visual-QA matrix (fixed a 360px overflow), and production-perf gates ([`frontend/sprint-6-sales-ownership-realtime.md`](frontend/sprint-6-sales-ownership-realtime.md)). Sprint 4/4.1/5/5.1 delivered the B2B workspace + edit flows. Remaining B2B/B2C/Admin screens per roadmap. |
| **Development / Repo governance** | 100% | Stable (Phase 0 closeout) | Foundation | 2026-08-01 | `CODEOWNERS` + minimum PR CI added; branch-protection required-check selection is a maintainer follow-up |
| **Operations** | 89% | Stable | Ops | 2026-08-02 | PR CI present (`frontend`/`backend`/`docs`) + **`supabase-rls`** RLS/isolation gate; **CD**, cloud provisioning, Docker-image CI job, and metrics/alerting deferred |
| **Design system** | 100% | Stable (`v1.0.0`) | Design System | 2026-08-01 | Runtime asset exports (logo/app-icon/WebGL); theme toggle wiring (tracked in debt) |
| **Governance / planning** | 100% | Stable (Phase 0.9) | Foundation | 2026-08-01 | GitHub labels/milestones/board are documented, not yet applied in GitHub |

## Legend
- **Status:** `Stable` (current for its phase) · `Draft` · `Needs update`.
- **Coverage** is re-assessed at each phase boundary; implementation phases will add runtime/operational coverage (deploy runbooks, per-feature test suites) that is intentionally low now.

## Maintenance
Update the affected row whenever a document in that area changes (the [sync rule](README.md#documentation-standard)). New areas get a row. This tracker + [`DECISION_LOG.md`](decisions/DECISION_LOG.md) together give a one-screen view of "what's documented and what's decided."
