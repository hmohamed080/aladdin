# Architecture Guide

<!-- CANONICAL PROJECT MEMORY — the currently active architecture. Read before any code or infra change. -->

| | |
|---|---|
| **Status** | Living document (canonical project memory) |
| **Version** | Living (canonical) · rev 2026-08-16 |
| **Owner** | Architecture |
| **Last updated** | 2026-08-16 (deployment targets reconciled to [ADR-0009](../decisions/ADR-0009-vercel-services-deployment.md)) |
| **Scope** | The **currently active** architecture of Aladdin — what is decided and in effect right now. |
| **Authority** | Authoritative for the current architecture state. It **does not replace ADRs**: [ADRs](../decisions/) explain *why* a decision was made and are append-only; this guide explains *what is active now* and is updated continuously. On conflict, the newest **Accepted** ADR wins and this guide must be reconciled to it. |
| **Update triggers** | Any change to module boundaries, data ownership, the multi-tenancy/identity/authorization model, migration ownership, the data-access approach, deployment targets, or the non-goals list. Every such change also updates an ADR, `RUNTIME_STATE.md`, and `AGENT_WORK_LOG.md`. |

This is **core architecture**, not optional documentation.

## Current Architecture Summary
Aladdin is a **modular monolith** built from four cooperating parts (ADR-0001):

1. **Web application** — Next.js (App Router) · React · TypeScript strict · Tailwind. The primary product surface and the primary CRUD path against Supabase.
2. **Data platform** — Supabase: PostgreSQL, Auth, Storage, RLS, Realtime, Queues, FTS, `pg_trgm`, `pgvector`, PostGIS.
3. **Specialized service** — Python 3.12+ / FastAPI for AI, OCR, RAG, documents, chunking, embeddings, evaluations, NLP, large-Excel, and workers. **Not** the CRUD backend.
4. **Background workers** — only where asynchronous processing is genuinely required.

As of 2026-07-30 the foundation is **scaffolded**: services build and pass their checks; **no product features, tables, or production connections exist yet.**

## Modular-Monolith Decision
One well-structured monolith with clean module boundaries — not premature microservices (ADR-0001). Module boundaries are kept clean enough that a domain can be **extracted later** without a rewrite, but nothing is extracted speculatively. See [Scalability Stages](#scalability-stages--extraction-triggers).

## Web Application Responsibilities
- All standard product CRUD and user-facing flows: Server Components by default, Server Actions for mutations, Route Handlers for webhooks/BFF/integrations.
- Talks to Supabase via **`supabase-js`**, preserving the authenticated user's JWT so **RLS is the enforcement layer**.
- Owns i18n (AR-RTL / EN-LTR), theming (light/dark), and PWA/responsive behavior.
- Holds no service-role secret in client code — only validated `NEXT_PUBLIC_*` values reach the browser.

## Design System (frontend)

The Aladdin Design System — **"The Aperture"** — is part of the architecture, not incidental styling. It is **finalized and semantically versioned** (`1.0.0`, approved/hardened, pre-feature):

- **Authority chain:** [`../product/PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md) → root [`../../DESIGN.md`](../../DESIGN.md) → [`../../design/tokens/*.json`](../../design/tokens/) (canonical machine tokens) → [`../../UI-UX/UI_UX_SYSTEM_GUIDE.md`](../../UI-UX/UI_UX_SYSTEM_GUIDE.md) → `UI-UX/design.pen` → frontend CSS variables + Tailwind config.
- **Governance:** [`../../design/GOVERNANCE.md`](../../design/GOVERNANCE.md) (versioning, synchronization, component & AI-agent rules); changelog [`../../design/CHANGELOG.md`](../../design/CHANGELOG.md).
- **Implementation:** `frontend/src/styles/tokens.css` (CSS vars, light/dark), `frontend/tailwind.config.ts` (theme), `next/font` in `frontend/src/app/layout.tsx`. Frontend code consumes **semantic** tokens; it never invents values outside the canonical tokens.

Token/brand changes follow the design-system edit-order (token JSON first) and update the design-system memory files in the same change — analogous to the [Architecture-Change Process](#architecture-change-process) for architecture.

## FastAPI Service Responsibilities
- **Specialized workloads only:** AI orchestration, OCR, document processing/chunking, embeddings, RAG, AI evaluations, NLP, large-Excel processing, and background/queue handlers.
- **Does not recreate application CRUD.** If a feature can be a Server Action / Route Handler against Supabase, it belongs in the web app, not here.
- Talks to Supabase/Postgres via **`supabase-py`** (see [Python Data-Access Decision](#python-data-access-decision)).
- Verifies the Supabase JWT on every request and derives identity from the token.

## Supabase Platform Responsibilities
- **PostgreSQL** — the single shared database and the system of record.
- **Auth** — Email + Password identity with Email OTP verification and Email OTP recovery (installer/technician exception: Phone + Password via an internal login alias), JWT issuance. *(Superseded 2026-09-28: passwordless WhatsApp/Email OTP identity.)*
- **Storage** — files/documents with storage policies.
- **RLS** — the tenant-isolation spine for all tenant/user/verification/sales/project/file/AI data.
- **Realtime** — live status streams (see [Realtime Responsibilities](#realtime-responsibilities)).
- **Queues** — background-job hand-off (see [Queue / Background-Job Responsibilities](#queue--background-job-responsibilities)).
- **Extensions** — FTS, `pg_trgm`, `pgvector`, PostGIS, `pgcrypto` (installed via the extensions migration).

## Module Boundaries
- The web app is organized by **feature/domain** modules; the FastAPI service is organized by **capability** modules (`ai`, `retrieval`, `documents`, `ocr`, `ingestion`, `embeddings`, `workers`, plus cross-cutting `auth`, `database`, `schemas`, `security`, `observability`).
- Cross-module access goes through explicit interfaces, not reach-ins. Shared truth is the database schema (owned by migrations), not shared in-process state.
- The web↔FastAPI boundary is an authenticated HTTP boundary; neither shares a process or an ORM with the other.

## Data Ownership
- **The database schema is owned exclusively by `supabase/migrations/*.sql`** (ADR-0002). No application component — JS or Python — creates or alters schema.
- The web app owns user-facing CRUD; the FastAPI service owns derived/AI artifacts (embeddings, extractions, evaluations) it writes back through the same RLS-governed tables.
- No second database. No per-service private schema unless a future ADR introduces one.
- **Organization activity is a PII-minimised projection, never a view over the security audit.** `public.audit_log` remains platform-administrator-only; the single audit writer atomically copies only allow-listed business actions and explicitly named safe parameters into the separately RLS-governed `organization_activity_events` table ([ADR-0010](../decisions/ADR-0010-organization-activity-log.md)).

## Multi-Tenancy Model
- The **tenant unit is the organization**, with **branch** scoping where applicable.
- **RLS is the isolation spine** — cross-tenant data must never leak in UI, API, worker, or AI retrieval.
- Tenancy attaches to the canonical identity via organization membership + branch assignment; it does not fork the account. One user may hold **zero, one, or many** memberships on the same identity, and a personal (organization-less) account is fully valid.

## Identity & Authorization Model
- **One person = one user ID.** One canonical identity per person (Email + Password, or the installer Phone + Password exception); creating or joining another business never creates a second auth user. A business is an **Organization**, never a second account. See the [Product Direction Guide](../product/PRODUCT_DIRECTION_GUIDE.md) *Canonical Identity Model*, *Personal Identity Is Not a Business*, and *Switching*.
- **One current primary account type** at a time — **no persona/profile switcher**. What a user can see/do is **derived** from primary account type, organization membership, branch assignment, permission capabilities, verification state, and subscription state.
- **Work context ≠ identity.** Switching the active work context between the personal surface (User+Profile) and an organization where the same user holds an **active membership** (Organization+Membership) is allowed and is *not* persona switching. Both workspaces are **derived** — there is no `workspaces` table.
- **No duplicated identity.** Personal identity lives in `users`/`profiles`, business identity in `organizations`, and the relationship in `memberships`; neither side is copied into the other as a second source of truth (onboarding drafts excepted, until commit).
- **Business classification is an organization property, enforced by the type system.** Two **disjoint** database types carry the two taxonomies: `public.persona_type` (a person — consumer, engineer, interior designer, installer/technician, contractor, salesperson, trainer, trainee) and `public.organization_type` (a business — showroom/dealer, supplier, manufacturer, importer, wholesaler, contractor company, design office). `users.primary_account_type` is a `persona_type` and is **nullable** (a business-only identity has no personal persona); `organizations.org_type` is an `organization_type`. Since the value sets do not overlap, `users.primary_account_type = 'supplier'` and `organizations.org_type = 'engineer'` are **type errors in every path**, including direct SQL. The shared `account_type` enum was dropped in Sprint 13 (migration `20260815090001`); the transitional debt is closed.
- **Affiliation is a membership, not an account type.** A salesperson working in someone else's showroom holds an ACTIVE `memberships` row with the sales capability set — never `org.manage`, and never a business classification on their person. Requests to join (`organization_join_requests`) and referred business candidates (`organization_referrals`) are *requests*: they grant nothing, are decided through the existing `org.members.manage` capability or platform authority respectively, and converge on `app.membership_grant_sales` so "approved" means one thing. Referral provenance (`organizations.source`, `organizations.referred_by_user_id`) is write-once and confers no relationship.
- **Effective personal persona = declared ?? canonical.** `app.effective_persona(uid)` resolves `individual_onboarding.prof_concrete_type` (declared — written by registration's account-type RPC or the professional editor) before `users.primary_account_type` (canonical — Admin-applied, trust-reviewed). Professional gates (`app.is_professional_persona`, `app.is_sales_persona`) accept either; persona-scoped writes (`user_activities_set`) and `my_profile_completion()` use the resolved value. Registration never writes the canonical column, never overrides a different canonical persona, and never creates a membership or capability (migration `20260924090011`).
- **User identity settings are workspace-independent.** `/settings/profile` requires only application access (`access_ready` / `active_personal`) — never a personal workspace or a membership. Organization-scoped editing (organization activities/subtypes) stays on `/b2b/settings` behind `org.manage`.
- **CAPTCHA is application-scoped.** Supabase's project-wide `[auth.captcha]` stays OFF. Create Account, Resend Signup and the Forgot Password request (canonical `/auth/*`; the installer sign-up uses the same verifier) verify a Cloudflare Turnstile token server-side via Cloudflare Siteverify (`frontend/src/server/auth/turnstile.ts`, secret in server-only `TURNSTILE_SECRET_KEY`) before calling Supabase Auth, failing closed; Sign In has no CAPTCHA.
- **Installer phone login alias (permanent, role-specific).** `/installer/sign-up` creates ordinary installer/technician accounts whose Supabase Auth email is an internal, undeliverable alias derived from the canonical E.164 phone (`p<digits>@craftsman-login.aladdin.invalid`, `email_confirm: true`, `app_metadata.registration_source = "temporary_craftsman_password_flow"`). It is a login key, never a contact: app surfaces render the auth email only through `userFacingEmail()` and `app.mask_email` masks the alias to `•••`. Service role is used only for the phone-uniqueness read, user creation and rollback delete; everything else runs as the user under RLS. See [`../frontend/installer-phone-auth.md`](../frontend/installer-phone-auth.md).
- **Authorization is enforced server-side** (RLS + explicit permission checks). The UI never implies access it cannot grant. Identity is always derived from the verified JWT, never from a request body.
- **Platform (Admin) authority is dynamic RBAC — one source (Phase 1A, [ADR-0011](../decisions/ADR-0011-admin-rbac-platform-authority.md), Accepted).** `admin_role_assignments` is the only source of platform authority, checked by `app.has_admin_permission()` in RPCs/RLS and read by the frontend only through `admin_my_access()` (`server/authorization/admin.ts`, one route→permission table in `lib/permissions/admin.ts`, every Admin page guards its own route). `platform_role_grants` is a never-read, one-way compatibility bridge until retirement ([`ADMIN_RBAC_ARCHITECTURE.md` §6](../admin/ADMIN_RBAC_ARCHITECTURE.md)); `app.is_platform()` is a deprecated shim over the same assignments. Tenant authority (`membership_capabilities`) is unchanged.
- **Admin Users / Organizations reads are server-side RPCs (Phase 1B-A, awaiting approval).** `admin_users_list` / `admin_user_detail` (`users.read`) and `admin_organizations_list` / `admin_organization_detail` (`organizations.read`) — platform-scoped, security-definer, deterministic (primary-key tie-break), paging/search/filter/sort over the full dataset in Postgres; the frontend reads them through `server/queries/admin-directory.ts` with one URL parser (`features/admin-preview/directory-params.ts`). Profile completion has ONE formula, `app.profile_completion(user_id)`, which `my_profile_completion()` wraps. Account email is read from `auth.users` only inside those RPCs (Installer login alias excluded). Details: [`ADMIN_USERS_ORGS_READ_AUDIT.md`](../admin/ADMIN_USERS_ORGS_READ_AUDIT.md).
- **Suspension is enforced by the database, centrally (Admin Core Phase 1B-B, awaiting approval).** A PostgREST `db_pre_request` hook (`app.api_pre_request`) refuses every Data API request from a suspended/deactivated account except `my_account_status`; `has_capability` / `is_org_member` / `require_verified_caller` / the personal storage helpers treat such a caller as having no authority (Storage/Realtime paths). A suspended **organization** keeps only its `.read` capabilities (members untouched). The middleware routes a suspended account to `/auth/suspended`. Admin Notes (append-only), Follow-ups (derived status), internal Cases, the Entity Timeline and organization duplicate resolution are security-definer RPCs behind their own `resource.action` permissions. Details: [`ADMIN_USER_ORG_OPERATIONS.md`](../admin/ADMIN_USER_ORG_OPERATIONS.md).

## RLS Strategy
- RLS is **mandatory** on every tenant/user/verification/sales/project/file/AI table; every policy ships with tests (pgTAP + isolation tests).
- Policies are SQL and version as migrations alongside the tables they protect.
- Service-role access **bypasses RLS** and is therefore restricted to trusted internal workers and explicitly authorized operations only. Detail: [`../security/rls-strategy.md`](../security/rls-strategy.md).

## Storage Security
- Supabase Storage buckets are governed by storage policies (also SQL migrations).
- Private design IP (`.pen`) and customer documents never enter Git; document access is authorized per-organization the same way row data is.

## Realtime Responsibilities
Supabase Realtime carries live status for: notifications, opportunity/pipeline status, task updates, verification status, project activity, inventory availability, and quotation status. Realtime is a delivery channel, not a source of truth — the database remains authoritative.

## Queue / Background-Job Responsibilities
- Heavy/slow/external work runs **off the request path** via Supabase Queues + Python workers: OCR, embeddings, document chunking, Excel imports, PDF/document generation, email + operational WhatsApp delivery, and expensive analytics refreshes. No worker is implemented yet and **its host is deliberately undecided** ([ADR-0009](../decisions/ADR-0009-vercel-services-deployment.md)).
- Request handlers stay fast; the UI reflects progress via Realtime. Never run blocking AI/OCR/parsing in a request event loop.

## AI, OCR, RAG & Embedding Boundaries
- All of these live in the **FastAPI service**, not the web app.
- **Retrieval applies authorization filters before returning content** — vector/document search must never cross organizations.
- AI **drafts, explains, and ranks; it never auto-sends** or takes irreversible action without human review.
- Embeddings/extractions are persisted through RLS-governed tables owned by migrations.

## Database Migration Ownership
- **`supabase/migrations/*.sql` is the only schema source of truth** (ADR-0002). Every change is a new, ordered SQL migration reviewed as a concrete artifact (tables, policies, grants, indexes).
- **No Alembic. No `Base.metadata.create_all()` in Staging/Production.** Production schema is never changed by hand once the migration workflow is established.

## Python Data-Access Decision
Current decision (ADR-0005, refining ADR-0002 for the Private Pilot MVP):

- **Next.js uses `supabase-js`; FastAPI and trusted Python workers use `supabase-py`.**
- Complex database operations use **PostgreSQL functions / RPC** where appropriate.
- **User-facing operations preserve the authenticated user JWT and RLS context.** Service-role access is restricted to trusted internal workers and explicitly authorized operations.
- **SQLAlchemy is deferred** until an evidenced requirement exists; it is **not** a current dependency. **Alembic remains prohibited** for the shared Supabase database.
- If a future need for typed SQL composition / connection pooling is evidenced, **SQLAlchemy Core** (not the ORM, never Alembic) may be reconsidered via a new ADR. Migration path and triggers are in [ADR-0005](../decisions/ADR-0005-python-data-access.md).

## Environment / Configuration Model
- One validated settings module per service is the **only** config source: `frontend/src/lib/env/` (Zod-validated) and `backend/app/config.py` (Pydantic Settings).
- **Never** read `process.env` / `os.getenv` in application code; **never** call `load_dotenv`.
- **Fail fast** on missing required config; **no silent defaults for secrets**. Each service ships a `.env.example`. Real `.env` files are never committed. Detail: [`../security/secrets-and-environments.md`](../security/secrets-and-environments.md).

## Deployment Targets
- **Vercel Services** — **both** the Next.js web app (`services.frontend`) and the FastAPI service (`services.backend`, Python runtime), declared in the repository-root `vercel.json` and shipped as **one deployment unit**: one preview URL per PR covering both, one rollback restoring both. Path rewrites put FastAPI same-origin at **`/api/backend`**, so there is no absolute backend URL to configure per environment. This does not relax the boundary — FastAPI is called from the **server side** of the web app, never the browser.
- **Worker host — undecided.** `backend/app/workers/` is interface-only; a new ADR picks between Vercel Cron/Queues and a container host when the first worker is implemented. `backend/Dockerfile` is retained as the portability exit path.
- **Supabase** — Postgres/Auth/Storage/Realtime/Queues.
- **OpenAI** — LLM/embeddings. **Azure Document Intelligence** — OCR candidate. **Sentry** — error tracking.

Staging precedes Production; migrations are backward-compatible. Detail: [ADR-0009](../decisions/ADR-0009-vercel-services-deployment.md) (supersedes [ADR-0004](../decisions/ADR-0004-deployment-platforms.md) on hosting) · [`../operations/deployment-overview.md`](../operations/deployment-overview.md).

## Observability
Structured logging (`structlog` in FastAPI), Sentry for errors across web + service, and health endpoints (`/api/health` web, `/health` FastAPI). Detail: [`../operations/monitoring-and-observability.md`](../operations/monitoring-and-observability.md).

## Performance Strategy
- **Postgres-first** search/analytics (FTS / `pg_trgm` / `pgvector`); expensive aggregations refresh asynchronously.
- Server-side pagination/sort/filter for large sets; never fetch unbounded rows.
- Long/expensive work is queued, not run inline; the UI stays responsive with live status.

## Scalability Stages & Extraction Triggers
Ship the monolith; move to the next rung only against **measured** need:
1. **Now** — modular monolith on the approved stack.
2. **Vertical scaling + Postgres tuning** — indexes, read patterns, connection management.
3. **Worker scale-out** — more worker instances behind Supabase Queues for AI/OCR/import load.
4. **Service extraction** — extract a domain **only** when a measured bottleneck or team-scaling need justifies it, using the clean module boundaries already in place.

Options are documented, not pre-built. Detail: [`scaling-strategy.md`](./scaling-strategy.md).

## Explicit Non-Goals
No Kubernetes, Kafka, RabbitMQ, Redis, Elasticsearch/OpenSearch, event sourcing, CQRS frameworks, service mesh, API gateway, or additional databases — unless an existing approved requirement makes it unavoidable and a new ADR records it. No Vite / React SPA / React Router. No Alembic. No second CRUD backend in FastAPI.

## ADR Index
- [ADR-0001 — Approved Architecture](../decisions/ADR-0001-approved-architecture.md)
- [ADR-0002 — Database Migrations (Supabase SQL is the only source of truth)](../decisions/ADR-0002-database-migrations.md)
- [ADR-0003 — Agent-Instruction Hierarchy](../decisions/ADR-0003-agent-instruction-hierarchy.md)
- [ADR-0004 — Deployment Platforms](../decisions/ADR-0004-deployment-platforms.md)
- [ADR-0005 — Python Data Access (supabase-py; SQLAlchemy deferred)](../decisions/ADR-0005-python-data-access.md)

## Architecture-Change Process
Every architecture change must, in the same session:
1. Be recorded in an **ADR** (new, or a new ADR that supersedes an old one — ADRs are append-only).
2. Update this **ARCHITECTURE_GUIDE.md**.
3. Update **`../operations/RUNTIME_STATE.md`**.
4. Be recorded in **`../operations/AGENT_WORK_LOG.md`**.
5. Update relevant **`AGENTS.md`** files and service documentation.
6. Include **validation results** (the commands run and their outcomes).

## Architecture Change History
Newest first.

### 2026-09-30 — Admin RBAC becomes the single source of platform authority
Admin Core Phase 1A ([ADR-0011](../decisions/ADR-0011-admin-rbac-platform-authority.md), Accepted; supersedes ADR-0007 D4). Each environment needs the one-time [Super Admin bootstrap](../admin/SUPER_ADMIN_BOOTSTRAP.md) before Roles management is operational. DB-backed roles/permissions/scoped assignments, SQL-enforced escalation safeguards, `platform_role_grants` demoted to a never-read bridge with a staged retirement, centralized frontend authorization with per-page route guards. Details: [`docs/admin/ADMIN_RBAC_ARCHITECTURE.md`](../admin/ADMIN_RBAC_ARCHITECTURE.md).

### 2026-09-28 — Email + Password is the canonical auth model
- **What:** `/auth/sign-up` (Full Name + Email + Username + Account Type + Password → Email OTP verification), `/auth/sign-in` (Email + Password) and `/auth/forgot-password/*` (Email OTP recovery; recovery `redirectTo` `<origin>/auth/forgot-password/reset`) serve the password flow; `/preview/auth-password/*` redirect there. Installer/technician Phone + Password (`/installer/*`, internal login alias) is unchanged and linked from `/auth/sign-in`. Supabase global CAPTCHA stays off; application-scoped Turnstile on Create Account, Resend Signup and Forgot Password request.
- **Supersedes:** the passwordless (WhatsApp/Email OTP) auth rule. The legacy email-OTP actions (`server/actions/auth.ts`, `/auth/recovery`) remain in the codebase.
- **Where:** PR #66; product decision in [PRODUCT_DIRECTION_GUIDE](../product/PRODUCT_DIRECTION_GUIDE.md) Change History 2026-09-28.

### 2026-09-28 — Raw authentication identifiers are internal (rule)
- **Rule:** Raw authentication identifiers (e.g. `auth.users.email`, which for an installer phone account is an internal login alias) are internal identity data and must not be passed directly to user-facing components. User-facing identity data must pass through a presentation-safe boundary — today `userFacingEmail()` in application code and `app.mask_email` in SQL, kept together as defense in depth. A server boundary that serves a flow which does not apply to an account (e.g. an email-only flow for a phone account) refuses that account before any identifier is read into a response.
- **Why:** Aladdin will support accounts with no usable email address — phone + password today; WhatsApp/SMS OTP and social providers later. Future UI must not assume `user.email` is the user-facing contact identity. (Documented only: no identity abstraction, provider table, OTP, social login, account linking or security settings were built.)
- **Details:** [`../frontend/installer-phone-auth.md`](../frontend/installer-phone-auth.md) → "Alias is never exposed".

### 2026-09-27 — Installer phone + password routes promoted
- **What:** `/installer/sign-up` / `/installer/sign-in` are the permanent installer entry point (`/temporary/craftsman/*` → 308 redirects in `next.config.ts`). `signOut` returns a phone-alias account to `/installer/sign-in` (identity read before sign-out); protected-route redirects stay on the shared `/auth/sign-in?next=…`, which offers a secondary installer link forwarding the validated `next`. Installer sign-in applies the exact `verifyEmailOtp` `next` rule. No schema change.
- **Details:** [`../frontend/installer-phone-auth.md`](../frontend/installer-phone-auth.md).

### 2026-09-27 — Temporary craftsman phone + password entry point
- **What:** Phone + password accounts via an internal login alias on the existing Supabase Auth email identity (no phone provider, no gate changes); one migration (`20260927090001`) makes `app.mask_email` return `•••` for the alias domain. Rollback-safe creation (admin delete on any initialization failure).
- **Why:** Unblock craftsman registration without enabling the hosted phone provider or widening the `email_confirmed_at` verified-caller gates (a production auth change).
- **Approved by:** User (Option B, 2026-09-27). Details: [`../frontend/installer-phone-auth.md`](../frontend/installer-phone-auth.md).

### 2026-09-24 — Application-scoped CAPTCHA (Cloudflare Siteverify)
- **What:** Turnstile tokens are verified by the app via Cloudflare Siteverify (fail closed) on Create Account and Forgot Password; Sign In's invisible CAPTCHA removed; `TURNSTILE_SECRET_KEY` added server-only; `NEXT_PUBLIC_TURNSTILE_INVISIBLE_SITE_KEY` removed; `[auth.captcha]` permanently off.
- **Why:** With Supabase's CAPTCHA off, the previous wiring only checked that a token was non-empty — any string passed.

### 2026-09-24 — Registration persona assignment; workspace-independent profile settings
- **What:** The registration account-type RPC records Tradespeople/Sales as the declared persona (`app.effective_persona` added; `user_activities_set` and `my_profile_completion()` resolve through it); `/settings/profile` added as the user-identity surface with no workspace prerequisite; completion's organization-activities item is asked only of `org.manage` holders; locality removed from completion until a locality write path exists.
- **Why:** A registered Tradesperson was not recognised as a professional anywhere, and a business-intent user with zero organizations had no reachable identity editor — both made profile completion unreachable. No new table, state or permission.

### 2026-08-01 — Design System finalized & hardened (v1.0.0)
- **What:** Recorded the versioned Aladdin Design System ("The Aperture") as part of the architecture: added the *Design System (frontend)* section and the authority chain (`DESIGN.md` → `design/tokens/*.json` → `UI_UX_SYSTEM_GUIDE.md` → `design.pen` → frontend). Canonical machine tokens, governance, component inventory, and icon policy added under `design/`.
- **Why:** The token/brand system is durable architecture; agents must consume canonical tokens rather than invent values. **No product feature, table, or connection was added.**

### 2026-07-30 — Architecture guide created; Python data access reconciled
- **What:** Created this current-state architecture guide. Reconciled the Python data-access approach to **`supabase-py`** and **deferred SQLAlchemy** (new ADR-0005 refining ADR-0002); SQLAlchemy removed from the backend scaffold as an unused dependency.
- **Why:** Give agents a single current-state reference distinct from the ADRs, and align the backend with the Private Pilot MVP data-access decision.
- **Validation:** see `AGENT_WORK_LOG.md` entry for 2026-07-30.

### 2026-07-29 — Foundation architecture accepted
- **What:** ADR-0001…0004 accepted; modular-monolith foundation scaffolded (Next.js + Supabase + specialized FastAPI + workers).
- **Why:** Stop re-deciding the stack per task; establish the isolation and migration spine before features.

## Related files
[`../engineering/README.md`](../engineering/README.md) (engineering standards) · [`../development/git-workflow.md`](../development/git-workflow.md) · [`overview.md`](./overview.md) · [`system-context.md`](./system-context.md) · [`module-boundaries.md`](./module-boundaries.md) · [`data-flow.md`](./data-flow.md) · [`realtime-and-background-jobs.md`](./realtime-and-background-jobs.md) · [`scaling-strategy.md`](./scaling-strategy.md) · [`../product/PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md) · [`../../AGENTS.md`](../../AGENTS.md)
