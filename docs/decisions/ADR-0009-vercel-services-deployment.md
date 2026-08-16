# ADR-0009 — Vercel Services for Both the Web App and the FastAPI Service

**Status:** Accepted · 2026-08-16 · **Supersedes [ADR-0004](ADR-0004-deployment-platforms.md)** (hosting targets for `frontend/` and `backend/` only)

## Purpose

Fix the runtime hosting target for the two application services. ADR-0004 sent the Next.js app to Vercel and the FastAPI service to Railway as two separately provisioned platforms. This ADR replaces that split: **both deploy through Vercel Services from a single repository-root `vercel.json`.**

## Context

ADR-0004 was written on 2026-07-29, when running Python on Vercel meant accepting a small package budget and no first-class framework support, so a container host was the reasonable target for FastAPI. Two things changed:

1. **Vercel runs FastAPI natively.** Python is a first-class runtime on Fluid Compute, and the package budget is no longer the constraint it was when ADR-0004 was written.
2. **Vercel Services deploys a multi-service repository as one project.** One `vercel.json` at the repository root declares both services and the routing between them, so the two halves of the app share a deployment, a domain, a preview URL per PR, and a rollback.

The `chore/staging-deployment-readiness` pass (2026-08-16) additionally concluded that FastAPI was **not required** for first staging and that **no `vercel.json` was needed**. Both conclusions were correct for the Vercel-project-per-service model they assumed, and both are **withdrawn by this ADR** — the Services model needs the config file, and deploying the backend alongside the frontend costs one entry in that file rather than a second platform account.

## Current decision

### Hosting targets

| Component | Platform | Deploy mechanism |
|---|---|---|
| Next.js web app (`frontend/`) | **Vercel Services** | `services.frontend` in root `vercel.json`, framework `nextjs` |
| FastAPI service (`backend/`) | **Vercel Services** | `services.backend` in root `vercel.json`, runtime `python`, entrypoint `app/main.py` |
| Python background workers | **Undecided — deferred** | see [Workers are explicitly out of scope](#workers-are-explicitly-out-of-scope) |
| Postgres · Auth · Storage · RLS · Realtime | **Supabase Cloud** | schema via `supabase/migrations` (ADR-0002) |
| LLM + embeddings | **OpenAI** | — |
| OCR (candidate) | **Azure Document Intelligence** | scoped API, not hosting |
| Error monitoring | **Sentry** | all services |

The Supabase, OpenAI, OCR, and Sentry rows are **carried over from ADR-0004 unchanged**. This ADR supersedes ADR-0004 only on where `frontend/` and `backend/` run.

### Routing contract

The root `vercel.json` routes by path, so both services answer on **one origin**:

| Source | Destination |
|---|---|
| `/api/backend(/.*)?` | `backend` service (FastAPI) |
| `/(.*)` | `frontend` service (Next.js) |

`/api/backend` is therefore the FastAPI base path, and it is **same-origin with the web app**. This does not relax the boundary in [ADR-0001](ADR-0001-approved-architecture.md): FastAPI remains the specialized AI/OCR/RAG/document service reached **from the server side of the web app, never from the browser**. Same-origin is a routing property, not an invitation to call it from client components.

### Consequences for application code

Two code changes are load-bearing for this decision and ship with it:

- **`frontend/src/middleware.ts` pins `export const runtime = "nodejs"`.** Vercel Services does not host Edge Function output. The middleware never needed the Edge runtime — it makes one round trip to the Supabase auth server and reads/writes cookies, both supported on Node — and Node.js middleware is stable as of Next.js 15.5 (installed: 15.5.22).
- **`.vercel/` is gitignored.** `vercel link` writes the project link there and pulls a short-lived OIDC token into it. It must never be committed.

### Backend configuration on Vercel

`backend/app/config.py` fails fast when `APP_ENV` is `staging` or `production` and any of `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `DATABASE_URL` is missing. That validator runs at import time, so the choice of `APP_ENV` on the backend service decides whether the deployment boots.

**Decision for first staging: leave `APP_ENV` unset on the backend service** (it defaults to `local`). `backend/app` registers exactly one route — `GET /health` — which needs no Supabase credential, so setting `APP_ENV=staging` today would force provisioning a **service-role key that bypasses RLS** in order to serve a health check. That is a breach surface with no feature behind it.

**Flip `APP_ENV=staging` and provision the four secrets in the same change that lands the first real AI/OCR/document endpoint** — not before, and not separately.

`ALLOWED_ORIGINS` (CORS) stays at its default. Same-origin routing means the browser issues no cross-origin preflight, and the service is called server-to-server regardless.

### Workers are explicitly out of scope

`backend/app/workers/` is **interface-only scaffolding** — no worker is implemented. This ADR deliberately does **not** assign it a host, because a persistent queue consumer is a different deployment shape from a request-driven function and picking one now would be a guess.

When the first worker gains an implementation, a **new ADR** decides its host against the real workload. The two live candidates: Vercel Cron Jobs / Queues on Fluid Compute (keeps one platform), or a container host using the retained `backend/Dockerfile` (better fit for long-lived consumers).

## Rationale

- **One platform, one deployment unit.** A PR gets a single preview URL that exercises both services against each other; a rollback restores both together. The Railway split needed two provisioning flows, two secret stores, two rollback procedures, and cross-origin wiring between them, for a service that is currently one health route.
- **The cross-service URL problem disappears.** Path-based rewrites make the backend reachable at a relative `/api/backend`, so nothing has to discover, configure, or rotate an absolute backend base URL per environment.
- **Cost of reversal is low and stays low.** `backend/Dockerfile` is retained and the service takes no Vercel-specific API, so moving to any container host remains a config change, not a rewrite. That is the same portability guarantee ADR-0004 was protecting.

## Scope

Runtime hosting and routing for `frontend/` and `backend/`, plus the environment/secret consequences above. Does not change the approved stack (ADR-0001), the schema source of truth (ADR-0002), or the data-access decision (ADR-0005).

## What is deferred

- The **worker host** — a new ADR, gated on the first implemented worker (above).
- **Production topology.** This ADR is written against first cloud STAGING. Production must use separate infrastructure (its own Supabase project, its own Vercel project, its own secrets) and must never load the staging seeds.
- CI/CD promotion gates and rollback automation, unchanged from ADR-0004's deferral and still tracked in [`../technical/TECHNICAL_DEBT.md`](../technical/TECHNICAL_DEBT.md).

## Consequences

- The root **`vercel.json` is required** and is the source of truth for service roots, runtimes, and routing. Vercel project settings must not restate what it declares.
- Vercel's **Root Directory setting no longer applies** — `vercel.json` declares each service's root, so the project is deployed from the repository root.
- New backend routes are reachable at `/api/backend/<path>` and must be added with that prefix in mind.
- Any new service added to the repository declares itself in `vercel.json`, and must still ship a Dockerfile and a documented rollback (carried over from ADR-0004).
- The `backend/Dockerfile` is **kept deliberately** as the portability exit path even though Vercel does not build from it.

## Related files

`vercel.json` · `frontend/src/middleware.ts` · `.gitignore` · [`../operations/deployment-overview.md`](../operations/deployment-overview.md) · [`../operations/staging-deployment-runbook.md`](../operations/staging-deployment-runbook.md) · [`../security/secrets-and-environments.md`](../security/secrets-and-environments.md) · `backend/Dockerfile` · [ADR-0004](ADR-0004-deployment-platforms.md)
