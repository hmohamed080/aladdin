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
| **Database** | 96% | Stable (spec + Phase 1 impl) | Engineering/Data | 2026-08-02 | Phase 1 identity/tenancy tables + RLS + audit implemented (migrations `2026080209000x`, ADR-0007, `database/phase1-identity-tenancy-review.md`); remaining product tables authored per feature (by design); AR FTS stemming config `⚑ OPEN` |
| **Security** | 96% | Stable | Security | 2026-08-02 | Phase 1 identity/tenancy independently security-reviewed (Sprint 1.1: TRUNCATE/default-privilege hardening, public-view projections, service_role grants; Sprint 1.2: `primary_account_type` + `public_profile_status` made server-controlled, closing a self-promotion path — ADR-0007 amendments); formal threat model, pen-test, per-feature authz matrices still deferred |
| **API** | 100% | Stable (contracts) | Engineering | 2026-08-01 | Contracts complete; realized endpoints land with features |
| **Engineering standards** | 100% | Stable (Phase 0.8) | Engineering | 2026-08-01 | — (12 docs + index; all 25 topics covered) |
| **Testing** | 92% | Stable (strategy + Phase 1 RLS suite) | Engineering | 2026-08-02 | Strategy set; concrete suite landed — **112 pgTAP** tenant-isolation/privilege tests (`supabase/tests/*`, incl. adversarial public-discovery, TRUNCATE, self-verification, self-promotion/eligibility, bootstrap-injection) gated in CI (`supabase-rls`) + backend data-access tests; further suites land with features |
| **Development / Repo governance** | 100% | Stable (Phase 0 closeout) | Foundation | 2026-08-01 | `CODEOWNERS` + minimum PR CI added; branch-protection required-check selection is a maintainer follow-up |
| **Operations** | 89% | Stable | Ops | 2026-08-02 | PR CI present (`frontend`/`backend`/`docs`) + **`supabase-rls`** RLS/isolation gate; **CD**, cloud provisioning, Docker-image CI job, and metrics/alerting deferred |
| **Design system** | 100% | Stable (`v1.0.0`) | Design System | 2026-08-01 | Runtime asset exports (logo/app-icon/WebGL); theme toggle wiring (tracked in debt) |
| **Governance / planning** | 100% | Stable (Phase 0.9) | Foundation | 2026-08-01 | GitHub labels/milestones/board are documented, not yet applied in GitHub |

## Legend
- **Status:** `Stable` (current for its phase) · `Draft` · `Needs update`.
- **Coverage** is re-assessed at each phase boundary; implementation phases will add runtime/operational coverage (deploy runbooks, per-feature test suites) that is intentionally low now.

## Maintenance
Update the affected row whenever a document in that area changes (the [sync rule](README.md#documentation-standard)). New areas get a row. This tracker + [`DECISION_LOG.md`](decisions/DECISION_LOG.md) together give a one-screen view of "what's documented and what's decided."
