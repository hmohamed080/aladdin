# Deployment Overview

**Status:** Living document · 2026-08-16 · Supersedes `agents/commands/deploy.md`

## Purpose

Describe how Aladdin's services deploy and the discipline around releases ([ADR-0009](../decisions/ADR-0009-vercel-services-deployment.md), superseding ADR-0004 on hosting).

> **First cloud STAGING:** the concrete, step-by-step setup — and the split between what the repository already does and what the owner must do by hand — is [`staging-deployment-runbook.md`](staging-deployment-runbook.md).

## Current decision

Both application services deploy through **Vercel Services**, declared in the repository-root **`vercel.json`** and shipped as one deployment unit — one preview URL per PR covering both, one rollback restoring both.

| Component | Platform | Build/Deploy |
|---|---|---|
| Next.js web app (`frontend/`) | **Vercel Services** | `services.frontend`, framework `nextjs`; Git-driven, preview per PR, promote to Production |
| FastAPI service (`backend/`) | **Vercel Services** | `services.backend`, runtime `python`, entrypoint `app/main.py`; same deployment as the web app |
| Python workers | **Undecided — deferred** | `backend/app/workers/` is interface-only; a new ADR picks the host when the first worker is implemented |
| Postgres/Auth/Storage/Realtime | **Supabase** | schema via `supabase/migrations` |
| Errors | **Sentry** | all services |

**Routing.** `vercel.json` routes `/api/backend(/.*)?` to the FastAPI service and everything else to Next.js, so both answer on one origin and FastAPI's base path is a relative `/api/backend` — no absolute backend URL to configure or rotate per environment. The boundary is unchanged: FastAPI is reached **from the server side of the web app, never from the browser**.

**Two code facts this depends on:** `frontend/src/middleware.ts` pins `runtime = "nodejs"` (Vercel Services hosts no Edge Function output), and `.vercel/` is gitignored (it holds the project link and a pulled OIDC token).

**Release discipline (kept from prior playbook):**
- Tests + typecheck/lint green before deploy; clean working tree.
- **Deploy to Staging before Production.**
- Build once, promote the same artifact; never rebuild for prod.
- Database migrations are **backward-compatible** and applied via the Supabase workflow (expand → backfill → contract).
- Every release has a documented rollback (Vercel rollback restores both services together / migration contract deferred).
- Tag releases; commit config changes with WHAT/WHY.

**Portability:** the FastAPI service takes no Vercel-specific API and `backend/Dockerfile` is **retained deliberately** — Vercel does not build from it, but it keeps the move to any container host a config change rather than a rewrite. No AWS/Azure platform infrastructure in the MVP (Azure Document Intelligence is a scoped OCR API, not hosting).

## Rationale

Vercel Services + Supabase minimizes ops for a small team: one platform, one deployment unit, one secret store, one rollback — instead of provisioning and wiring a second host for a service that is currently one health route. The retained Dockerfile preserves the exit path.

## Scope

Deployment topology and release process. Monitoring is in `monitoring-and-observability.md`.

## What is deferred

The CI/CD pipeline implementation, environment promotion gates, and rollback automation — a later task. No production connections during foundation work.

## Consequences

New services declare themselves in the root `vercel.json`, and must still provide a Dockerfile and a documented rollback. Vercel project settings must not restate what `vercel.json` declares — the Root Directory setting in particular no longer applies, since each service's root is declared in the file. New backend routes are reachable at `/api/backend/<path>`. Manual production DB edits are prohibited.

## Related files

`monitoring-and-observability.md` · `../security/secrets-and-environments.md` · `../../vercel.json` · `backend/Dockerfile` · [ADR-0009](../decisions/ADR-0009-vercel-services-deployment.md) (superseding [ADR-0004](../decisions/ADR-0004-deployment-platforms.md))
