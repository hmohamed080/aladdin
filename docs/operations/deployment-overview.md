# Deployment Overview

**Status:** Living document · 2026-07-29 · Supersedes `agents/commands/deploy.md`

## Purpose

Describe how Aladdin's services deploy and the discipline around releases (ADR-0004).

## Current decision

| Component | Platform | Build/Deploy |
|---|---|---|
| Next.js web app | **Vercel** | Git-driven; preview per PR, promote to Production |
| FastAPI service | **Railway** | Docker image from `backend/Dockerfile` |
| Python workers | **Railway** | same image, worker entrypoint |
| Postgres/Auth/Storage/Realtime | **Supabase** | schema via `supabase/migrations` |
| Errors | **Sentry** | all services |

**Release discipline (kept from prior playbook):**
- Tests + typecheck/lint green before deploy; clean working tree.
- **Deploy to Staging before Production.**
- Build once, promote the same artifact; never rebuild for prod.
- Database migrations are **backward-compatible** and applied via the Supabase workflow (expand → backfill → contract).
- Every release has a documented rollback (redeploy previous image / Vercel rollback / migration contract deferred).
- Tag releases; commit config changes with WHAT/WHY.

**Portability:** FastAPI + workers stay portable Docker containers — no host-specific coupling. No AWS/Azure platform infrastructure in the MVP (Azure Document Intelligence is a scoped OCR API, not hosting).

## Rationale

Vercel + Railway + Supabase minimizes ops for a small team while Docker preserves an exit path.

## Scope

Deployment topology and release process. Monitoring is in `monitoring-and-observability.md`.

## What is deferred

The CI/CD pipeline implementation, environment promotion gates, and rollback automation — a later task. No production connections during foundation work.

## Consequences

New services must provide a Dockerfile and a documented rollback. Manual production DB edits are prohibited.

## Related files

`monitoring-and-observability.md` · `../security/secrets-and-environments.md` · `backend/Dockerfile` · ADR-0004
