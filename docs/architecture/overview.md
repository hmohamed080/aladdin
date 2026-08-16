# Architecture Overview

**Status:** Living document · 2026-08-16

## Purpose

One-page orientation to how Aladdin is built. Start here, then follow links.

## Current decision

Aladdin is a **modular monolith** (ADR-0001): one Next.js web app, one Supabase data platform, one specialized FastAPI AI/document service, and background workers where async work is required.

Both application services deploy through **Vercel Services** from one repository-root `vercel.json` (ADR-0009), so they share an origin: `/api/backend/*` routes to FastAPI, everything else to Next.js.

```
          ┌═══════════════ one Vercel project ═══════════════┐
          ║                                                  ║
          ║ ┌──────────────────────────────────────────────┐ ║
  Users   ║ │  Next.js (App Router) — services.frontend    │ ║
  ───────▶║ │  Server Components · Server Actions · Route   │ ║
  B2C/B2B ║ │  Handlers · next-intl (AR-RTL / EN-LTR)       │ ║
  /Admin  ║ └───────┬───────────────────────┬──────────────┘ ║
          ║         │ supabase-js (RLS)      │ server-side    ║
          ║         │                        │ /api/backend   ║
          ║         │                        ▼   (JWT)        ║
          ║         │              ┌───────────────────────┐  ║
          ║         │              │  FastAPI               │  ║
          ║         │              │  services.backend      │  ║
          ║         │              │  (Python runtime)      │  ║
          ║         │              │  AI · OCR · RAG ·      │  ║
          ║         │              │  embeddings            │  ║
          ║         │              └───────┬───────┬───────┘  ║
          ╚═════════│══════════════════════│═══════│══════════╝
                    ▼                      │       ▼
            ┌───────────────┐              │   OpenAI · (Azure DI OCR)
            │   Supabase    │◀─────────────┘
            │  Postgres·Auth│   SQL read/query
            │  Storage·RLS  │
            │  Realtime·    │        ┌──────────────────────┐
            │  Queues·      │◀──────▶│ workers — not built; │
            │  pgvector     │        │ host undecided       │
            └───────────────┘        └──────────────────────┘
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

`system-context.md` · `module-boundaries.md` · `data-flow.md` · `realtime-and-background-jobs.md` · `scaling-strategy.md` · ADR-0001 · [ADR-0009](../decisions/ADR-0009-vercel-services-deployment.md)
