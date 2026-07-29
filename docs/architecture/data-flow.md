# Data Flow

**Status:** Living document · 2026-07-29

## Purpose

Describe how a request and its data move through the system, and where authorization is enforced.

## Current decision

**Standard product read/write (the common case):**

1. Browser renders Server Components; interactive islands are Client Components.
2. Mutations call **Server Actions**; reads call server **queries** — both run in the Next.js server against Supabase using the caller's session.
3. **RLS enforces authorization in the database.** The app also checks permissions, but RLS is the backstop that must hold even if app code is wrong.
4. Realtime subscriptions push status changes back to the client (see `realtime-and-background-jobs.md`).

**AI / document flow (specialized):**

1. Server (Next.js) forwards an authenticated request to the **FastAPI service**, passing the Supabase JWT.
2. FastAPI **verifies the JWT**, derives identity from the token (never from the body), and checks permissions.
3. Fast work runs inline; **expensive work (OCR, embeddings, chunking, large imports) is enqueued** to a worker.
4. Retrieval (RAG/vector search) **applies organization/authorization filters before returning content** — no cross-tenant leakage.
5. Results are written back through the governed schema; the client is notified via Realtime.

## Rationale

Authorization lives at the data layer (RLS) so every path — web, worker, AI — inherits the same guarantees. Identity always comes from a verified token, never client-supplied IDs.

## Scope

Request/response and job data paths. Storage-object flows follow the same RLS/storage-policy rules.

## What is deferred

Concrete per-feature sequences.

## Consequences

Any new data path must state where RLS applies and how identity is derived before it is approved.

## Related files

`realtime-and-background-jobs.md` · `../security/rls-strategy.md` · `../security/security-model.md` · `backend/AGENTS.md`
