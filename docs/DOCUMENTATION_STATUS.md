# Documentation Status

| | |
|---|---|
| **Status** | Living document (documentation coverage tracker) |
| **Version** | 1.0.0 |
| **Owner** | Foundation / Documentation |
| **Last Updated** | 2026-08-01 |
| **Depends On** | [`README.md`](README.md) (index) |
| **Related** | [`decisions/DECISION_LOG.md`](decisions/DECISION_LOG.md), [`technical/TECHNICAL_DEBT.md`](technical/TECHNICAL_DEBT.md), [`roadmap/ROADMAP.md`](roadmap/ROADMAP.md) |

Documentation coverage by area. **Coverage %** = how completely the area is documented **for the current phase (pre-implementation)** — high coverage here means "specified", not "implemented". `Missing Items` are gaps or `⚑ OPEN` decisions ([`TECHNICAL_DEBT.md`](technical/TECHNICAL_DEBT.md) §7). Index: [`README.md`](README.md).

| Area | Coverage | Status | Owner | Last Updated | Missing items |
|---|---|---|---|---|---|
| **Product** | 95% | Stable | Product | 2026-08-01 | Commercial/pricing model, pilot success metrics (`⚑ OPEN`); `client-brief.md` is a placeholder |
| **Architecture** | 100% | Stable | Architecture | 2026-08-01 | — (ADR-0001…0006 + guide; revisit on measured scaling need) |
| **Technical spec** | 100% | Stable (Phase 0.7) | Architecture | 2026-08-01 | Per-category product attribute schemas; several `⚑ OPEN` product decisions flagged inline |
| **Database** | 95% | Stable (spec) | Engineering/Data | 2026-08-01 | Only extensions migration exists; product tables authored per feature (by design); AR FTS stemming config `⚑ OPEN` |
| **Security** | 95% | Stable | Security | 2026-08-01 | Formal threat model, pen-test, per-feature authz matrices (deferred, tracked in debt) |
| **API** | 100% | Stable (contracts) | Engineering | 2026-08-01 | Contracts complete; realized endpoints land with features |
| **Engineering standards** | 100% | Stable (Phase 0.8) | Engineering | 2026-08-01 | — (12 docs + index; all 25 topics covered) |
| **Testing** | 90% | Stable (strategy) | Engineering | 2026-08-01 | Strategy set; concrete test suites land with features/migrations |
| **Development / Repo governance** | 100% | Stable (Phase 0.9) | Foundation | 2026-08-01 | `CODEOWNERS` recommended, not yet created (ADR-0006) |
| **Operations** | 85% | Stable | Ops | 2026-08-01 | CI/CD not wired; deployment provisioning + metrics/alerting deferred |
| **Design system** | 100% | Stable (`v1.0.0`) | Design System | 2026-08-01 | Runtime asset exports (logo/app-icon/WebGL); theme toggle wiring (tracked in debt) |
| **Governance / planning** | 100% | Stable (Phase 0.9) | Foundation | 2026-08-01 | GitHub labels/milestones/board are documented, not yet applied in GitHub |

## Legend
- **Status:** `Stable` (current for its phase) · `Draft` · `Needs update`.
- **Coverage** is re-assessed at each phase boundary; implementation phases will add runtime/operational coverage (deploy runbooks, per-feature test suites) that is intentionally low now.

## Maintenance
Update the affected row whenever a document in that area changes (the [sync rule](README.md#documentation-standard)). New areas get a row. This tracker + [`DECISION_LOG.md`](decisions/DECISION_LOG.md) together give a one-screen view of "what's documented and what's decided."
