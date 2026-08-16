# ADR-0004 — Deployment Platforms

**Status:** **Superseded (in part) by [ADR-0009](ADR-0009-vercel-services-deployment.md) · 2026-08-16** · originally Accepted 2026-07-29

> **Superseded — read this first.** The **FastAPI service and Python workers rows below are no longer the current decision.** [ADR-0009](ADR-0009-vercel-services-deployment.md) deploys `frontend/` **and** `backend/` through **Vercel Services** from a single repository-root `vercel.json`; Railway is not used. The worker host is deferred to a future ADR.
>
> Everything else in this ADR — **Supabase** for Postgres/Auth/Storage/Realtime, **OpenAI**, **Azure Document Intelligence** as the OCR candidate, **Sentry**, the Local→Staging→Production environment split, and the portability requirement — **remains in force** and is carried forward by ADR-0009.
>
> The text below is preserved **unedited** as the historical record of the 2026-07-29 decision and its reasoning. Do not treat it as current guidance.

## Purpose

Fix the hosting targets for the MVP and keep services portable enough to move later.

## Current decision

| Component | Platform |
|---|---|
| Next.js web app | **Vercel** |
| FastAPI service | **Railway** (Docker) |
| Python workers | **Railway** (Docker) |
| PostgreSQL / Auth / Storage / Realtime | **Supabase** |
| LLM + embeddings | **OpenAI** |
| OCR (candidate) | **Azure Document Intelligence** |
| Error monitoring | **Sentry** |

- All FastAPI and worker services remain **portable Docker containers**.
- **No AWS or Azure platform infrastructure** for the complete platform during the foundation task (Azure Document Intelligence is a scoped OCR API candidate, not platform hosting).
- Environments: **Local, Staging, Production** — documented in `docs/security/secrets-and-environments.md`. Do not connect to real Production services during foundation work.

## Rationale

- Vercel is the first-class Next.js host; Railway runs portable Docker with minimal ops; Supabase hosts the managed data platform. This trio minimizes DevOps burden for a small team on a six-week MVP.
- Keeping compute in Docker preserves an exit path (any container host) without rework.

## Scope

Deployment and environment configuration for all services.

## What is deferred

A concrete future migration path (e.g. to a cloud VPC) is **documented, not implemented** — see `docs/architecture/scaling-strategy.md`. CI/CD pipeline implementation is deferred to a later task.

## Consequences

- Dockerfiles are required for FastAPI/workers and are part of the foundation scaffold.
- Secrets are managed in each platform's secret store, never in source. The generic multi-platform `agents/commands/deploy.md` playbook is **superseded** by `docs/operations/deployment-overview.md`.

## Related files

`docs/operations/deployment-overview.md` · `docs/operations/monitoring-and-observability.md` · `docs/security/secrets-and-environments.md` · `backend/Dockerfile`
