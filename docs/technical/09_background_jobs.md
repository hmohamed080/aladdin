# 09 — Background Jobs

| | |
|---|---|
| **Status** | Specification · Phase 0.7 (pre-implementation) |
| **Version** | 1.0.0 |
| **Owner** | Architecture / Foundation |
| **Last Updated** | 2026-08-01 |
| **Depends On** | ../architecture/realtime-and-background-jobs.md, 10_events.md |
| **Related** | 08_api_contracts.md, 13_integrations.md |

All asynchronous work for the MVP. **Specification only.** Per [realtime-and-background-jobs.md](../architecture/realtime-and-background-jobs.md): anything slow, expensive, or external runs **off the request path** via **Supabase Queues → Python workers** (in `backend/app/workers/`, currently interface-only; host undecided per [ADR-0009](../decisions/ADR-0009-vercel-services-deployment.md)). Request handlers stay fast; the UI reflects progress via Realtime ([10](10_events.md)).

## 1. Principles

- **Enqueue, don't block.** A Server Action/webhook enqueues a job and returns immediately; it never runs OCR/AI/email/import inline.
- **Idempotent handlers.** Every handler is safe to run twice (dedupe by a natural key / job id) — queues guarantee at-least-once.
- **Tenant context travels with the job.** The payload carries `organization_id`/`user_id` + the acting identity so workers preserve RLS via `supabase-py`; `service_role` only for explicitly-authorized worker writes.
- **Observable.** Each job logs structured start/finish/fail (structlog) + Sentry on error; status surfaces to the UI via Realtime where the user is waiting.
- **Bounded.** No unbounded fan-out; batch sizes and concurrency are capped.

## 2. Job catalog

| Job | Trigger | Payload | Handler work | Idempotency key | Realtime |
|---|---|---|---|---|---|
| `notification.deliver` | domain event → notification created | `{notificationId, channels[]}` | render + fan out to in-app/email/WhatsApp per prefs | notificationId+channel | notifications |
| `email.send` | `notification.deliver` / verification / invite | `{to, templateId, vars, idempotencyKey}` | call email provider; record delivery | idempotencyKey | — |
| `whatsapp.send` | OTP / operational notify | `{to, templateId, vars, idempotencyKey}` | call WhatsApp Business API; record | idempotencyKey | — |
| `verification.ocr` | `uploadVerificationDoc` | `{documentId}` | OCR (Azure DI candidate) → write `documents.ocr_text` | documentId | verification status |
| `document.ocr` | project/spec doc upload | `{documentId}` | OCR → text | documentId | — |
| `embedding.generate` | product publish / doc ingest | `{entity, id}` | OpenAI embeddings → pgvector column | entity+id+version | — |
| `excel.import` | `POST /v1/imports/excel` | `{documentId, mapping, orgId}` | parse large Excel → staged rows → validated upsert | documentId | import progress |
| `export.generate` | `requestExport` | `{type, scope, filters, requesterId}` | build Excel/PDF → `exports/` bucket → notify | requestId | export ready |
| `pdf.generate` | quote accepted / report | `{subjectType, subjectId}` | render PDF (Arabic-shaping aware) → `documents`/`exports` | subjectId+type | — |
| `analytics.refresh` | schedule + significant events | `{scope}` | recompute `analytics_snapshots` | scope+window | dashboard |
| `ai.evaluate` | AI output logged | `{runId}` | run evaluation, store result | runId | — |
| `retention.purge` | schedule | `{}` | hard-delete soft-deleted rows + orphaned storage past window (⚑ windows OPEN) | window date | — |
| `exports.purge` | schedule | `{}` | delete `exports/` objects past TTL (⚑ 7d default) | date | — |
| `otp.cleanup` | schedule | `{}` | expire stale OTP challenges | date | — |
| `followup.dispatch` | schedule | `{}` | send `scheduled` follow-ups whose time has come (already human-approved) | followUpId | — |

## 3. Scheduled jobs (cron)

Supabase scheduled triggers / a worker scheduler (⚑ mechanism: `pg_cron` vs worker cron — decide at build). Candidates:

| Schedule | Job |
|---|---|
| every 5 min | `followup.dispatch`, `otp.cleanup` |
| hourly | `analytics.refresh` (light) |
| nightly | `retention.purge`, `exports.purge`, `analytics.refresh` (full) |
| weekly | integrity/orphan checks (report) |

## 4. Retry strategy

- **Transient failures** (network, 429, 5xx from providers): retry with **exponential backoff + jitter**, capped attempts (default **5**), base 30s. Respect provider `Retry-After` for 429.
- **Rate-limited providers** (WhatsApp/OpenAI/OCR): a per-provider concurrency + token-bucket limiter in the worker; jobs re-queue rather than hammer.
- **Permanent failures** (invalid input, 4xx non-retryable): **do not retry** — go straight to the dead-letter path with the error captured.
- Handlers are idempotent so a retry after a partial success is safe.

## 5. Dead-letter strategy

- After max attempts (or a permanent error), the job moves to a **dead-letter queue** (a `job_dead_letters` table or the queue's DLQ) with: original payload, error, attempt count, first/last failure time.
- Dead-lettered jobs raise a **Sentry alert** and appear in an **admin ops surface** for inspection/manual replay.
- Replay is a deliberate admin action (audited); it re-enqueues with a fresh id, reusing the idempotency key so no duplicate side effects.
- **Never silently drop** a job; a lost side effect (e.g. undelivered OTP) is a reliability incident.

## 6. Ordering & concurrency

- Jobs are **not** assumed ordered; handlers tolerate out-of-order delivery (state checks before acting — e.g. don't email a decision for a quote already superseded).
- Per-entity concurrency guards (advisory locks / unique in-flight key) prevent double-processing (e.g. two `verification.ocr` for one doc).

## 7. What is NOT a background job

- Fast, user-blocking reads/writes stay in the request (Server Action) path.
- Live status is **Realtime**, not a polling job.
- AI that must stream to the user (consultation) runs synchronously in the FastAPI request with streaming, not a queue (unless it's a heavy batch like bulk embedding).

## 8. Open items

- ⚑ Queue mechanism specifics (Supabase Queues topic names, `pg_cron` vs external scheduler).
- ⚑ Retention/TTL windows (purge, exports, verification docs).
- ⚑ Provider rate-limit numbers (WhatsApp/OpenAI/OCR) to size limiters.
