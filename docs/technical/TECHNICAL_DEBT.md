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
| ~~**Supabase RLS/isolation CI job**~~ | **Resolved; expanded 2026-08-03** — `.github/workflows/supabase-rls.yml` (check `supabase-rls`) resets/lints and runs **254 pgTAP** assertions plus real two-session last-owner and approval races, then repeats reset+pgTAP. Owner must retain `supabase-rls` as a required check. |
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
| ~~**Last `org.manage` owner cannot be revoked** invariant~~ | **Resolved and concurrency-hardened 2026-08-03 (Sprint 2.1)** — every protected membership/capability mutation locks the stable organization row; a two-session test proves competing owner removals serialize and leave one owner — [12 §4](12_validation_rules.md) |
| ~~**Constrained `record_audit_event()` RPC**~~ | **Resolved/hardened 2026-08-03 (Sprint 2.1)** — internal writer forces actor from `auth.uid()`; direct application-role audit/business DML is denied, so every allowed sensitive production path emits its audit row in-transaction (ADR-0007 D16–D20). |
| ~~**Account-upgrade write path**~~ | **Resolved 2026-08-03 (Sprint 2)** — transactional `request → review → approve → apply` RPCs; `apply_account_upgrade` is the only path that changes `primary_account_type`/listing, idempotent (ADR-0007 D12–D14). |
| **Verification document storage + OCR** — Sprint 2 ships only a placeholder `verification_documents` table (no upload/OCR); doc-required-to-submit is deferred | when the storage/documents feature + private bucket land (05_storage_design.md) |
| **Subscription/package gate** in the account-upgrade flow (a gate step before `apply_account_upgrade`) | when subscriptions are implemented; the workflow has a clean insertion point (ADR-0007 Sprint 2 deferred) |
| **Platform-role grant/revoke RPC** — direct `service_role` DML is now denied; pilot provisioning is a reviewed migration/DBA owner transaction with an audit row | before platform-role administration becomes an application feature; build a constrained, attributed RPC rather than restoring table DML |
| **Verification expiry materialization** — `apply_account_upgrade` enforces `expires_at` immediately, but no scheduler currently changes an un-applied approved row's status to `expired` | when scheduled jobs land; use a constrained/audited worker RPC |
| **Live RLS integration test** in the backend suite (a real user JWT round-trip); the header approach is verified manually + by REST round-trip, unit tests assert the header | when a shared local-Supabase CI fixture exists |
| **Repo-wide default-privileges enforcement** — a CI/lint check that every new tenant table `revoke`s the Supabase default `TRUNCATE`/`REFERENCES`/`TRIGGER` from client roles (Sprint 1.1 CRIT-1 convention in [06](../engineering/../technical/06_rls_strategy.md)) | as feature migrations grow |

## 7. Open product/engineering decisions (`⚑ OPEN` — block dependent work)

Track as `needs-product-decision` issues ([`../development/github-workflow.md`](../development/github-workflow.md)):

- **Commercial:** subscription tiers/entitlement values/pricing; degradation behavior; ad billing model.
- **Providers:** email provider selection; OCR provider finalization + **Arabic accuracy validation**; PDF engine + Arabic-shaping font.
- **Data:** per-category product attribute schemas; required verification document sets per account type; Arabic FTS stemming config.
- **Limits/retention:** OTP length/TTL/attempts; media size/dimensions/video caps; retention windows (documents, verification, soft-delete purge, exports TTL).
- **Access:** exact verification/subscription gates on publish/RFQ-respond; org-visible audit scope.

## Sales domain (Phase 2, Sprint 3 — ADR-0008)

| Item | Trigger |
|---|---|
| **Sales UI (05C)** — schema/RPCs/read-models exist; no screens yet | the first approved sales frontend feature |
| **Link `leads`/`customers` to RFQ/quotes/projects** | when those modules land (Opportunity/Need/Match chain deferred) |
| **Notifications/reminders on `follow_up_tasks`** — schema is reminder-ready (`due_at`, assignee); no reminders/push/recurring | the notifications feature |
| **Excel import/export** — schema supports it; no bulk path built. **Do not add an unaudited bulk bypass** — build a constrained, audited, caller-scoped importer with row-level validation + duplicate detection (reuse `app.normalize_phone`) and an audited export within caller scope | the import/export feature |
| **Scheduled overdue materialization** — overdue is computed at read time; no job flips state | the jobs feature (use a constrained/audited worker RPC) |
| **Org-customizable pipeline stages** — stages are a fixed enum | if product requires per-org stages |
| **Platform governance over sales data** — no platform cross-tenant read on customer PII by design | a purpose-built, audited governance path |
| **Multi-contact-point customer table** — MVP stores one primary phone/email directly | if customers need multiple structured contacts |

## Maintenance
Add an item the moment a deferral/compromise is made (in the same PR). Removing an item requires the fix to land. This register is reviewed at each phase boundary and before any release.
