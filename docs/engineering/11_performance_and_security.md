# 11 — Performance Guidelines & Security Checklist

| | |
|---|---|
| **Status** | Living document (canonical engineering reference) |
| **Version** | 1.0.0 |
| **Owner** | Engineering / Security |
| **Last Updated** | 2026-08-01 |
| **Depends On** | [`../security/security-model.md`](../security/security-model.md), [`../security/rls-strategy.md`](../security/rls-strategy.md), [`../architecture/ARCHITECTURE_GUIDE.md`](../architecture/ARCHITECTURE_GUIDE.md) |
| **Related** | [`04_error_logging_observability.md`](04_error_logging_observability.md), [`09_pull_request_and_review.md`](09_pull_request_and_review.md) |

Covers **Performance Guidelines (22)** and **Security Checklist (23)**. Operationalizes the [Performance Strategy](../architecture/ARCHITECTURE_GUIDE.md#performance-strategy) and [`security-model.md`](../security/security-model.md).

## 1. Performance guidelines

- **Postgres-first search/analytics** (FTS / `pg_trgm` / `pgvector` / PostGIS); expensive aggregations refresh **asynchronously** into `analytics_snapshots`, never inline.
- **Always paginate/sort/filter server-side**; never fetch unbounded rows. Cap `pageSize`; prefer cursors for large/live lists.
- **Index intentionally** — every index justified in its migration; index the columns RLS and hot queries filter on (`organization_id`, status, FKs).
- **Off the request path:** OCR, embeddings, chunking, imports, PDF/report generation, bulk email/WhatsApp → **workers** ([`09_background_jobs`](../technical/09_background_jobs.md)). Request handlers stay fast; UI stays live via Realtime.
- **Web:** Server Components by default (small client bundle); stream AI responses; lazy-load heavy client islands; `next/font` self-hosted (no layout shift); `next/image` for imagery.
- **AI cost/latency:** cap tokens, batch embeddings, cache where safe, and degrade gracefully on provider failure.
- **N+1 avoidance:** batch/join reads; don't loop queries. Measure before optimizing; optimize the measured bottleneck, not a guess.
- **Realtime, not polling** for live status.

## 2. Security checklist (per change; the non-negotiable spine)

### Identity & authorization
- [ ] Identity derived from the **Supabase JWT**, never request body
- [ ] **RLS enabled + explicit policies** on every new tenant/user/verification/sales/project/file/AI table, with **organization-isolation tests**
- [ ] Capability checked in the action layer (defense-in-depth over RLS)
- [ ] `service_role` used only server-side, sparingly, with explicit intent — never in client code

### Data & tenancy
- [ ] No cross-organization leakage in UI, API, workers, or **AI retrieval** (org filter applied **before** returning rows)
- [ ] Private-by-default storage; verification/export buckets strictest; signed URLs only ([`05_storage_design`](../technical/05_storage_design.md))
- [ ] PII minimized in logs; no secrets in logs; verbose errors never reach clients

### Secrets & config
- [ ] Only `NEXT_PUBLIC_*` validated vars reach the browser; all third-party keys server-side
- [ ] No `.env`/secrets/`.pen` committed; config via the validated settings module; fail-fast on missing

### Auth model
- [ ] Passwordless preserved — **no password/forgot/reset** anywhere; OTP via WhatsApp/Email; reCAPTCHA only on account creation
- [ ] No self-approval on verification/moderation decisions; admin/support cross-tenant actions **audited**

### AI
- [ ] AI **drafts/ranks/explains**; a human decides and sends — never auto-acts or takes irreversible action silently
- [ ] Prompts never embed another tenant's data

### Input & abuse
- [ ] Zod/Pydantic validation at boundaries; rate limits on OTP/search/AI/export; idempotency on retryable ops
- [ ] Webhooks signature-verified and idempotent

**A table without RLS, a secret in client code, an AI path without tenant filtering, or a password flow is a release blocker** ([`security-model.md`](../security/security-model.md)).

## 3. Deferred (documented)
Formal threat model, pen-test, per-feature authorization matrices, secret-rotation, and load/perf budgets — added as features land / traffic justifies ([`../architecture/scaling-strategy.md`](../architecture/scaling-strategy.md)).
