# Realtime & Background Jobs

**Status:** Living document · 2026-07-29

## Purpose

Draw the line between what happens live (Realtime) and what happens asynchronously (workers), so features pick the right mechanism.

## Current decision

**Supabase Realtime** pushes state changes to clients for:
- Notifications
- Opportunity status (Sales)
- Task updates
- Verification status
- Project activity
- Inventory availability
- Quotation status

**Background jobs** (Supabase Queues + Python workers) handle work that is slow, expensive, or external. No worker is implemented yet, and its **host is deliberately undecided** — a new ADR picks between Vercel Cron/Queues and a container host when the first one lands ([ADR-0009](../decisions/ADR-0009-vercel-services-deployment.md)):
- OCR
- Embeddings
- Document chunking
- Excel imports
- PDF generation
- Email delivery
- Operational WhatsApp delivery
- Expensive analytics refreshes

**AI service responsibilities** (FastAPI, sync or enqueued as appropriate):
- Intent extraction
- Product-suggestion explanation
- Follow-up drafting
- Document retrieval / RAG
- AI evaluations

## Rationale

Anything that can exceed a request budget or call a rate-limited external API must not block the request event loop. Realtime keeps the UI fresh without polling.

## Scope

Interfaces and boundaries only. **This foundation does not implement the jobs** — it defines where they live (`backend/app/workers/`) and how they are triggered (queue), plus the Realtime channels above.

## What is deferred

Concrete job handlers, retry/dead-letter policy, and channel schemas — added with the features that need them, each with idempotent handlers.

## Consequences

A feature proposing inline heavy work is rejected; it must enqueue. A feature needing live status uses Realtime, not client polling.

## Related files

`data-flow.md` · `scaling-strategy.md` · `backend/AGENTS.md` · `supabase/AGENTS.md`
