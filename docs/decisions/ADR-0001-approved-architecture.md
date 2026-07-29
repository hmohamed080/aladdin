# ADR-0001 — Approved Architecture (Private Pilot MVP)

**Status:** Accepted · 2026-07-29

## Purpose

Fix the technology and architectural style for the Aladdin Private Pilot MVP so that agents and contributors stop re-deciding the stack per task.

## Current decision

A **modular monolith** built from four cooperating parts:

1. **Web application** — Next.js (App Router) · React · TypeScript strict · Tailwind · Radix/shadcn primitives · React Hook Form + Zod · next-intl · TanStack Table. Server Components by default; Server Actions for mutations; Route Handlers for webhooks/BFF/integrations. Responsive Web / PWA, Arabic RTL + English LTR, Light + Dark.
2. **Data platform** — Supabase: PostgreSQL, Auth, Storage, RLS, Realtime, Queues, FTS, pg_trgm, pgvector, PostGIS (where geo is required).
3. **Specialized service** — Python 3.12+ / FastAPI for AI, OCR, documents, chunking, embeddings, RAG, evaluations, NLP, large-Excel, and workers. **Not** the primary CRUD backend.
4. **Background workers** — only where asynchronous processing is genuinely required.

Explicitly excluded: Vite, React SPA, React Router (frontend); Kubernetes, Kafka, RabbitMQ, Redis, Elasticsearch/OpenSearch, event sourcing, CQRS frameworks, service mesh, API gateway, additional databases (infrastructure).

## Rationale

- One well-structured monolith with clean module boundaries ships an ambitious MVP in ~6 weeks far more reliably than premature microservices.
- Supabase collapses Auth + Postgres + Storage + Realtime + vector search into one governed platform with RLS as the security spine — a strong fit for a multi-tenant B2B product.
- Next.js App Router keeps most logic server-side (Server Components/Actions), minimizing client bundle and secret exposure, and supports RTL/i18n and PWA needs.
- FastAPI is reserved for genuinely specialized AI/document workloads Python does best, without becoming a second CRUD layer.

## Scope

Applies to all application code created in this repository during and after the foundation task.

## What is deferred

Concrete feature schemas, authz policy details, and any service extraction. Speculative scaling infrastructure is deferred to `docs/architecture/scaling-strategy.md`.

## Consequences

- Contributors must justify (in an ADR) any deviation before introducing an excluded technology.
- The FastAPI/CRUD boundary must be actively policed in review.

## Related files

Root `AGENTS.md` · `frontend/AGENTS.md` · `backend/AGENTS.md` · ADR-0002 · ADR-0004 · `docs/architecture/overview.md`
