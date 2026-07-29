# Architecture Overview

**Status:** Living document · 2026-07-29

## Purpose

One-page orientation to how Aladdin is built. Start here, then follow links.

## Current decision

Aladdin is a **modular monolith** (ADR-0001): one Next.js web app, one Supabase data platform, one specialized FastAPI AI/document service, and background workers where async work is required.

```
          ┌──────────────────────────────────────────────┐
  Users   │  Next.js (App Router) on Vercel              │
  ───────▶│  Server Components · Server Actions · Route   │
  B2C/B2B │  Handlers · next-intl (AR-RTL / EN-LTR)       │
  /Admin  └───────┬───────────────────────┬──────────────┘
                  │ supabase-js (RLS)      │ authed calls (JWT)
                  ▼                        ▼
          ┌───────────────┐        ┌───────────────────────┐
          │   Supabase    │◀──────▶│  FastAPI service       │
          │  Postgres·Auth│  SQL   │  (Railway, Docker)     │
          │  Storage·RLS  │  read/ │  AI · OCR · RAG ·      │
          │  Realtime·    │  query │  embeddings · workers  │
          │  Queues·      │        └───────┬───────────────┘
          │  pgvector     │                │
          └───────────────┘                ▼
                                    OpenAI · (Azure DI OCR)
```

## Rationale

Keep the moving parts few and the boundaries clean. Most product logic is server-side in Next.js against Supabase (with RLS as the security spine). Only genuinely specialized AI/document workloads live in FastAPI. See ADR-0001.

## Scope

The whole system at a high level. Detailed boundaries, data flow, and async processing have their own documents.

## What is deferred

Feature-level designs, concrete schemas, and service extraction.

## Consequences

New capabilities default to the Next.js + Supabase path; FastAPI is chosen only for AI/OCR/document/worker needs.

## Related files

`system-context.md` · `module-boundaries.md` · `data-flow.md` · `realtime-and-background-jobs.md` · `scaling-strategy.md` · ADR-0001
