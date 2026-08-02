# Technical Debt Register

| | |
|---|---|
| **Status** | Living document (tracked debt) |
| **Version** | 1.0.0 |
| **Owner** | Engineering |
| **Last Updated** | 2026-08-01 |
| **Depends On** | [`14_future_extensions.md`](14_future_extensions.md), [`../operations/RUNTIME_STATE.md`](../operations/RUNTIME_STATE.md) |
| **Related** | [`../product/BACKLOG.md`](../product/BACKLOG.md), [`../roadmap/ROADMAP.md`](../roadmap/ROADMAP.md), [`../engineering/README.md`](../engineering/README.md) |

Every known deferral, compromise, and improvement — so **nothing is forgotten after MVP**. Items are `⚑ OPEN` (needs a decision), `Deferred` (scheduled later), or `Debt` (a compromise to revisit). Foundation/spec items marked `⚑ OPEN` in [`docs/technical/`](README.md) are consolidated here.

## 1. Deferred features (product)

Full list + rationale in [`14_future_extensions.md`](14_future_extensions.md) and [`../product/BACKLOG.md`](../product/BACKLOG.md) (Won't Have). Highlights:

| Item | State | Revisit |
|---|---|---|
| Payments / escrow / milestones / disputes | Deferred | needs payment ADR + compliance |
| Installation & service marketplace; industrial RFQ at scale | Deferred | full-platform |
| Learning & training feature surface | Deferred | post-MVP |
| Enterprise (org groups, SSO/SAML) | Deferred | tenancy already set-based ([`06_rls_strategy`](06_rls_strategy.md)) |
| Org-customizable pipeline stages | Deferred | MVP uses fixed enum |
| Product "followers" notifications on publish | ⚑ OPEN | decide in Phase 2 |

## 2. Known compromises (Debt)

| Item | Impact | Fix |
|---|---|---|
| ~~No `.dockerignore` in `backend/`~~ | — | **Resolved 2026-08-01** — `backend/.dockerignore` added; image rebuild verified |
| ~~No `CODEOWNERS`~~ | — | **Resolved 2026-08-01** — `.github/CODEOWNERS` added (single-owner map; enforcement needs branch-protection setting) |
| **`.impeccable/design.json` breakpoints** (430/1080/1360) differ from canonical (768/1024/1440) | none (gitignored local sidecar, non-authoritative) | reconcile if the sidecar is ever promoted |
| **Vector (logflare) container flaps** on local Supabase | benign; unrelated to Postgres/schema | ignore locally; monitor in staging |
| **Font OFL formal license audit** pending | low | verify OFL files before production ship |
| Design-system runtime assets (logo/app-icon exports, Aperture React components, WebGL auth artwork) not produced | placeholders in the plate | produce during Phase 2 auth/UI |
| **Theme toggle** not wired (tokens ready via `.dark`) | none yet | wire during first UI feature |

## 3. Performance improvements (deferred)

| Item | Trigger |
|---|---|
| Metrics/dashboards (Prometheus-style), SLOs, alert thresholds | traffic ([`monitoring-and-observability.md`](../operations/monitoring-and-observability.md)) |
| Read replicas / connection pooling tuning (pooler disabled locally) | DB load |
| Materialized analytics + refresh scheduling | dashboard load (05E) |
| pgvector index tuning (`hnsw`/`ivfflat` params) | retrieval scale |
| Load/perf budgets per surface | pre-production hardening |

## 4. Security improvements (deferred; spine already enforced)

The RLS/isolation spine, passwordless model, and tenant filtering are **not** debt — they are enforced from day one ([`security-model.md`](../security/security-model.md), [`11_performance_and_security`](../engineering/11_performance_and_security.md)). Deferred hardening:

| Item | Trigger |
|---|---|
| Formal threat model + pen-test | pre-production |
| Per-feature authorization matrices | as features land |
| Secret rotation policy | with CI/CD |
| Rate-limit tuning (OTP/search/AI/export numbers) | real traffic |
| EXIF stripping / magic-byte sniffing hardening on uploads | Phase 1–2 storage work |

## 5. Infrastructure improvements (deferred)

| Item | Trigger |
|---|---|
| **Minimum PR CI** (`.github/workflows/ci.yml`: `frontend`/`backend`/`docs`) added 2026-08-01 | **CD**, Docker-image + Supabase RLS/isolation CI jobs, and **SHA-pinning of actions** remain deferred ([`10_environment_and_cicd`](../engineering/10_environment_and_cicd.md)) |
| **Supabase RLS/isolation CI job** — the Phase 1 pgTAP suite (`supabase/tests/*`, 58 tests) is CI-ready but not yet wired | wire a `supabase db reset` + `supabase test db` job (needs Docker in CI) so tenant-isolation tests gate merges |
| Branch protection required-checks selection | after CI runs once, select `frontend`/`backend`/`docs` in `main` protection (ADR-0006) |
| Staging/Production cloud provisioning (Vercel/Railway/Supabase) | first deploy |
| `docker build` in CI + image scanning | with CI |
| Preview-environment automation | later |

## 6. Future refactoring

| Item | When |
|---|---|
| Service extraction (a domain → its own service) | only on **measured** bottleneck (ADR-0001) |
| Transactional outbox implementation for side-effecting events | Phase 1–2 (recommended in [`10_events`](10_events.md)) |
| Event payload schema versioning (`version` field) | from first event |
| Shared component/service extraction | on genuine 2nd consumer (never preemptive) |
| **JWT custom-claim optimization** for `app` RLS helpers (org/role in `custom_access_token`) instead of table lookups | measured RLS read-path cost (ADR-0007 D1); helper API is claim-agnostic, so no policy rewrite |
| **Last `org.manage` owner cannot be revoked** invariant | implement in the membership write-path feature (multi-row invariant, not a single CHECK) — [12 §4](12_validation_rules.md) |

## 7. Open product/engineering decisions (`⚑ OPEN` — block dependent work)

Track as `needs-product-decision` issues ([`../development/github-workflow.md`](../development/github-workflow.md)):

- **Commercial:** subscription tiers/entitlement values/pricing; degradation behavior; ad billing model.
- **Providers:** email provider selection; OCR provider finalization + **Arabic accuracy validation**; PDF engine + Arabic-shaping font.
- **Data:** per-category product attribute schemas; required verification document sets per account type; Arabic FTS stemming config.
- **Limits/retention:** OTP length/TTL/attempts; media size/dimensions/video caps; retention windows (documents, verification, soft-delete purge, exports TTL).
- **Access:** exact verification/subscription gates on publish/RFQ-respond; org-visible audit scope.

## Maintenance
Add an item the moment a deferral/compromise is made (in the same PR). Removing an item requires the fix to land. This register is reviewed at each phase boundary and before any release.
