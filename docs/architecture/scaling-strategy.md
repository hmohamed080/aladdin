# Scaling Strategy

**Status:** Living document · 2026-07-29

## Purpose

Record how Aladdin scales **when evidence demands it** — so we document options instead of building speculative infrastructure now (ADR-0001).

## Current decision

Ship the modular monolith. Reach for the next rung only when a measured bottleneck justifies it:

| Pressure | First response (cheap) | Later option (documented, not built) |
|---|---|---|
| Web app CPU/latency | Vercel autoscaling; more Server Component caching | Edge runtime for hot routes |
| DB read load | Indexes, query tuning, Postgres FTS/`pg_trgm` | Supabase read replicas |
| Vector search cost | `pgvector` with proper filters/indexes | Dedicated vector store (only if pgvector proves insufficient) |
| Heavy async volume | More Railway worker instances; Supabase Queues | Extract a worker service; managed queue |
| A domain outgrows the monolith | Enforce module boundary; extract via the existing seam | Standalone service behind the same auth |
| Full-text/search complexity | Postgres FTS | Search engine **only** with a proven requirement |

## Rationale

Every excluded technology (Kafka, Redis, Elasticsearch, Kubernetes, service mesh, CQRS, event sourcing, extra databases) carries real operational cost. Clean module boundaries (see `module-boundaries.md`) are what make later extraction cheap, so we invest in boundaries now and infrastructure later.

## Scope

Capacity and evolution planning. Not an implementation task.

## What is deferred

Everything in the right-hand column above, plus any multi-region or cloud-VPC migration — pursued only against measured need and a new ADR.

## Consequences

Proposals to add excluded infrastructure require a measured bottleneck and an ADR. Absent that, the answer is "tune the current rung."

## Related files

ADR-0001 · `module-boundaries.md` · `realtime-and-background-jobs.md`
