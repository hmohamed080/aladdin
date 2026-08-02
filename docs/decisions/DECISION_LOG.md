# Decision Log (ADR Index)

| | |
|---|---|
| **Status** | Living document (ADR index) |
| **Version** | 1.0.0 |
| **Owner** | Architecture |
| **Last Updated** | 2026-08-01 |
| **Depends On** | [`../architecture/ARCHITECTURE_GUIDE.md`](../architecture/ARCHITECTURE_GUIDE.md) |
| **Related** | all [ADRs](.) |

A one-screen index of every Architecture Decision Record — understand the decisions without opening each ADR. **ADRs are append-only and immutable**; a decision changes only via a new (superseding or refining) ADR. On conflict, the newest **Accepted** ADR wins and the [`ARCHITECTURE_GUIDE.md`](../architecture/ARCHITECTURE_GUIDE.md) is reconciled to it.

| ADR | Title | Status | Date | Summary | Current state |
|---|---|---|---|---|---|
| [0001](ADR-0001-approved-architecture.md) | Approved Architecture (Private Pilot MVP) | Accepted | 2026-07-29 | Modular monolith: Next.js (App Router) + Supabase + specialized FastAPI + workers; approved stack; explicit exclusions (no Vite/SPA/K8s/Kafka/Redis/ES/2nd DB). | **Active** — the governing architecture. |
| [0002](ADR-0002-database-migrations.md) | Database Migrations: Supabase SQL is the Only Schema Source of Truth | Accepted | 2026-07-29 | All schema via `supabase/migrations/*.sql`; no Alembic, no `create_all()` in staging/prod, no manual dashboard edits; RLS + isolation tests per table. | **Active** — data-access mechanism refined by 0005 (schema-source decision unchanged). |
| [0003](ADR-0003-agent-instruction-hierarchy.md) | Agent-Instruction Hierarchy | Accepted | 2026-07-29 | Root `AGENTS.md` + scoped `AGENTS.md` compose; nested files extend, never override product/architecture/security/memory rules; conflicts resolved explicitly. | **Active** — governs how agents read/apply instructions. |
| [0004](ADR-0004-deployment-platforms.md) | Deployment Platforms | Accepted | 2026-07-29 | Vercel (web) · Railway/Docker (FastAPI+workers) · Supabase (data) · OpenAI · Azure Document Intelligence (OCR candidate) · Sentry; portable containers; Local→Staging→Production. | **Active** — CI/CD wiring + provisioning deferred (tracked in [`TECHNICAL_DEBT.md`](../technical/TECHNICAL_DEBT.md)). |
| [0005](ADR-0005-python-data-access.md) | Python Data Access: `supabase-py` for the MVP; SQLAlchemy Deferred | Accepted | 2026-07-30 | FastAPI/workers use `supabase-py` preserving JWT/RLS; complex ops via PostgreSQL functions/RPC; SQLAlchemy deferred, Alembic excluded. Refines 0002 (mechanism only). | **Active** — reconsider SQLAlchemy Core only on evidenced need via a new ADR. |
| [0006](ADR-0006-repository-governance.md) | Repository Governance | Accepted (amended 2026-08-01) | 2026-08-01 | GitHub flow on protected `main`; branch/commit conventions; `--no-ff` PR merges (no squash/rewrite); SemVer; release/tag workflow; code/doc ownership. | **Active** — **amended 2026-08-01**: canonical branch prefixes = `feature/bugfix/hotfix/chore/docs/release` (`feat/` is commit-type only); next branch `feature/identity-multitenancy`. `CODEOWNERS` + CI branch-protection now added; branch-protection check selection is a follow-up. |
| [0007](ADR-0007-identity-and-tenancy-model.md) | Identity & Tenancy Implementation Model (Phase 1) | Accepted (amended 2026-08-02) | 2026-08-02 | RLS helpers as `security definer` (not JWT claims yet); branch access = `membership_branch_access` + capability-derived org-wide (primary_branch_id descriptive only); profile bootstrap via `auth.users` trigger; platform admin only in `platform_role_grants` (no user write path); explicit grants + RLS-with-policy on every table. Refines 0002 for the identity/tenancy tables. | **Active** — implemented on `feature/identity-multitenancy`. **Amended 2026-08-02 (Sprint 1.1 security review):** removed `administrator` account type; public discovery via curated views (base tables private); column-scoped inserts (no self-verification); **revoke Supabase default `TRUNCATE` from client roles + explicit `service_role` grants** (two criticals); `PUBLIC` execute revoked on helpers; audit metadata bounds; platform-admin provisioning documented. |

## Related decision material (not ADRs)
- [`agent-instruction-migration.md`](agent-instruction-migration.md) — source→destination map for the agent-instruction consolidation (supports ADR-0003).

## How to change a decision
Open a new ADR that **supersedes** or **refines** the old one (never edit the old ADR's decision), update this log, the [`ARCHITECTURE_GUIDE.md`](../architecture/ARCHITECTURE_GUIDE.md), [`RUNTIME_STATE.md`](../operations/RUNTIME_STATE.md), and [`AGENT_WORK_LOG.md`](../operations/AGENT_WORK_LOG.md) in the same change ([Architecture-Change Process](../architecture/ARCHITECTURE_GUIDE.md#architecture-change-process)).
