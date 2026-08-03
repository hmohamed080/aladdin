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
| **Database** | 98% | Stable (spec + Phase 1 impl) | Engineering/Data | 2026-08-03 | Phase 1 identity/tenancy + Sprint 2/2.1 constrained write paths implemented through migration `20260804090001`; direct privileged/service-role and membership-table DML bypasses closed; remaining product tables authored per feature; AR FTS stemming config `⚑ OPEN` |
| **Security** | 98% | Stable | Security | 2026-08-03 | Independent Sprint 2.1 catalog/behavior review completed: one privileged RPC boundary, exact role/table/function ACLs, verification immutability, audit rollback, and real last-owner/approval concurrency gates. Formal threat model, pen-test, and future-feature authz matrices remain deferred. |
| **API** | 100% | Stable (contracts) | Engineering | 2026-08-01 | Contracts complete; realized endpoints land with features |
| **Engineering standards** | 100% | Stable (Phase 0.8) | Engineering | 2026-08-01 | — (12 docs + index; all 25 topics covered) |
| **Testing** | 96% | Stable (strategy + Phase 1 RLS suite) | Engineering | 2026-08-03 | **254 pgTAP** assertions across 14 files plus two real-session race tests (last-owner and conflicting approval), gated by `supabase-rls`; frontend 7 tests and backend 10 tests pass. Further suites land with features. |
| **Development / Repo governance** | 100% | Stable (Phase 0 closeout) | Foundation | 2026-08-01 | `CODEOWNERS` + minimum PR CI added; branch-protection required-check selection is a maintainer follow-up |
| **Operations** | 89% | Stable | Ops | 2026-08-02 | PR CI present (`frontend`/`backend`/`docs`) + **`supabase-rls`** RLS/isolation gate; **CD**, cloud provisioning, Docker-image CI job, and metrics/alerting deferred |
| **Design system** | 100% | Stable (`v1.0.0`) | Design System | 2026-08-01 | Runtime asset exports (logo/app-icon/WebGL); theme toggle wiring (tracked in debt) |
| **Governance / planning** | 100% | Stable (Phase 0.9) | Foundation | 2026-08-01 | GitHub labels/milestones/board are documented, not yet applied in GitHub |

## Legend
- **Status:** `Stable` (current for its phase) · `Draft` · `Needs update`.
- **Coverage** is re-assessed at each phase boundary; implementation phases will add runtime/operational coverage (deploy runbooks, per-feature test suites) that is intentionally low now.

## Maintenance
Update the affected row whenever a document in that area changes (the [sync rule](README.md#documentation-standard)). New areas get a row. This tracker + [`DECISION_LOG.md`](decisions/DECISION_LOG.md) together give a one-screen view of "what's documented and what's decided."
