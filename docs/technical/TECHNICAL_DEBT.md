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
| **No `.dockerignore`** in `backend/` | full build context (incl. `.venv/`) sent to daemon; 3 local `__pycache__` dirs copied into image | add `.dockerignore`; image is otherwise clean (selective `COPY`) |
| **No `CODEOWNERS`** | review routing is manual | add when a team exists (ADR-0006) |
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
| **CI/CD pipeline** (documented in [`10_environment_and_cicd`](../engineering/10_environment_and_cicd.md), not wired) | before/at Phase 1 |
| Branch protection on `main` (requires CI) | with CI (ADR-0006) |
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

## 7. Open product/engineering decisions (`⚑ OPEN` — block dependent work)

Track as `needs-product-decision` issues ([`../development/github-workflow.md`](../development/github-workflow.md)):

- **Commercial:** subscription tiers/entitlement values/pricing; degradation behavior; ad billing model.
- **Providers:** email provider selection; OCR provider finalization + **Arabic accuracy validation**; PDF engine + Arabic-shaping font.
- **Data:** per-category product attribute schemas; required verification document sets per account type; Arabic FTS stemming config.
- **Limits/retention:** OTP length/TTL/attempts; media size/dimensions/video caps; retention windows (documents, verification, soft-delete purge, exports TTL).
- **Access:** exact verification/subscription gates on publish/RFQ-respond; org-visible audit scope.

## Maintenance
Add an item the moment a deferral/compromise is made (in the same PR). Removing an item requires the fix to land. This register is reviewed at each phase boundary and before any release.
