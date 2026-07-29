# RLS Strategy

**Status:** Living document · 2026-07-29

## Purpose

Define how Row Level Security is applied consistently so tenant isolation is guaranteed and testable.

## Current decision

- **Every** table holding user, organization, verification, sales, project, file, or AI data has RLS **enabled** with explicit policies. Enabling RLS without a policy (which denies all) or shipping a table without RLS are both bugs.
- **Tenant ownership:** tenant-owned tables carry an ownership column (e.g. `organization_id`); branch-scoped tables also carry branch ownership. Policies filter on the authenticated user's org/branch/role.
- **Identity source:** policies derive identity from the JWT (`auth.uid()` and org/role claims), never from client-supplied values.
- **Roles:** client access uses `anon`/`authenticated` constrained by RLS. `service_role` bypasses RLS and is therefore **server-only** and used sparingly with explicit intent.
- **Storage:** bucket policies mirror table policies; upload/verification buckets are private by default and reviewed like DB policies.
- **Vector/AI:** retrieval queries **apply the same ownership filter before returning rows** — pgvector similarity never crosses org boundaries.

## Rationale

Centralizing authorization in the database makes the isolation guarantee independent of any single code path (web, worker, AI), which is exactly where multi-tenant products fail.

## Scope

All schema, storage, and retrieval authorization.

## What is deferred

Concrete policies for concrete tables — created **with each table's migration**, never speculatively (ADR-0002).

## Consequences

- **Every RLS policy requires tests**, including **organization-isolation tests** (org A cannot read/write org B) and storage-policy tests, in `supabase/tests/`.
- A migration adding a tenant table without an RLS policy + isolation test fails review.

## Related files

`security-model.md` · `../database/migration-strategy.md` · `supabase/AGENTS.md` · ADR-0002
