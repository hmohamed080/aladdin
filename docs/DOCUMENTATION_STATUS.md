# Documentation Status

| | |
|---|---|
| **Status** | Living document (documentation coverage tracker) |
| **Version** | 1.0.0 |
| **Owner** | Foundation / Documentation |
| **Last Updated** | 2026-08-03 |
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
| **Testing** | 96% | Stable (strategy + Phase 1/2 suites) | Engineering | 2026-08-04 | **337 pgTAP** assertions across 16 files (254 identity/tenancy + 83 sales) + three real-session race tests, gated by `supabase-rls`; frontend **92 tests** (Sprint-4 UI + Sprint-4.1 review: i18n parity, error-mapping, capability + branch/org resolvers, auth boundary, query org/branch narrowing, search sanitization, no-nested-form DOM test) pass; backend 10 tests pass on CI. **Sprint 4.2:** pgTAP **337 → 366** (+29, new `17_public_directory_hardening`: Advisor definer-view catalog checks, exact grants, PUBLIC-execute denial, base-table privacy, end-to-end discovery). **Sprint 5:** frontend **92 → 104** (+12: customer/lead/follow-up edit actions, follow-up-not-open mapping, ConfirmDialog a11y) + a local Playwright E2E foundation (12 smoke scenarios, not executed in the authoring sandbox); pgTAP unchanged (no SQL change). Further suites land with features. |
| **Frontend / UI** | 46% | In progress (Phase 2 Sprint 5) | Engineering | 2026-08-04 | Sprint 4/4.1 B2B workspace + **Sprint 5 depth**: real customer/lead/follow-up **edit** flows via trusted RPCs, richer customer detail (add-activity/add-follow-up/follow-up lists), accessible confirmation dialog for terminal actions, and a local **Playwright** E2E foundation. Active org+branch scoping, optimistic lead concurrency, and localized errors preserved. See [`frontend/sprint-5-sales-ui-depth.md`](frontend/sprint-5-sales-ui-depth.md). Live cross-breakpoint browser QA + E2E execution pending a maintainer (sandbox blocks browser launch). Remaining B2B/B2C/Admin screens per roadmap. |
| **Development / Repo governance** | 100% | Stable (Phase 0 closeout) | Foundation | 2026-08-01 | `CODEOWNERS` + minimum PR CI added; branch-protection required-check selection is a maintainer follow-up |
| **Operations** | 89% | Stable | Ops | 2026-08-02 | PR CI present (`frontend`/`backend`/`docs`) + **`supabase-rls`** RLS/isolation gate; **CD**, cloud provisioning, Docker-image CI job, and metrics/alerting deferred |
| **Design system** | 100% | Stable (`v1.0.0`) | Design System | 2026-08-01 | Runtime asset exports (logo/app-icon/WebGL); theme toggle wiring (tracked in debt) |
| **Governance / planning** | 100% | Stable (Phase 0.9) | Foundation | 2026-08-01 | GitHub labels/milestones/board are documented, not yet applied in GitHub |

## Legend
- **Status:** `Stable` (current for its phase) · `Draft` · `Needs update`.
- **Coverage** is re-assessed at each phase boundary; implementation phases will add runtime/operational coverage (deploy runbooks, per-feature test suites) that is intentionally low now.

## Maintenance
Update the affected row whenever a document in that area changes (the [sync rule](README.md#documentation-standard)). New areas get a row. This tracker + [`DECISION_LOG.md`](decisions/DECISION_LOG.md) together give a one-screen view of "what's documented and what's decided."
