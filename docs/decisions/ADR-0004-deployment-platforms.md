# ADR-0004 — Deployment Platforms

**Status:** Accepted · 2026-07-29

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
