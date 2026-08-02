# 04 — Error Handling, Logging & Observability

| | |
|---|---|
| **Status** | Living document (canonical engineering reference) |
| **Version** | 1.0.0 |
| **Owner** | Engineering |
| **Last Updated** | 2026-08-01 |
| **Depends On** | [`../operations/monitoring-and-observability.md`](../operations/monitoring-and-observability.md), [`03_api_standards.md`](03_api_standards.md) |
| **Related** | [`../security/security-model.md`](../security/security-model.md), [`09_background_jobs`](../technical/09_background_jobs.md) |

Covers **Error-Handling Standards (6)**, **Logging Strategy (7)**, **Observability Guidelines (24)**. Operationalizes [`monitoring-and-observability.md`](../operations/monitoring-and-observability.md).

## 1. Error-handling standards

- **Validate at boundaries, trust internal state** (root [`AGENTS.md`](../../AGENTS.md)). No defensive handling for cases that can't happen.
- **Return errors, don't throw across boundaries.** Use the shared `Result`/`ApiError` model ([`03_api_standards.md`](03_api_standards.md)); throw only for truly unexpected faults → error boundary + Sentry.
- **Map deliberately:** DB/RLS denial → `FORBIDDEN`/`NOT_FOUND`; unique/state → `CONFLICT`; upstream failure (after retries) → `DEPENDENCY_UNAVAILABLE`.
- **Never leak internals** (stack, SQL, schema, provider payloads) to clients; safe/localizable `message` only. Details go to logs/Sentry keyed by `traceId`.
- **User-facing:** inline, specific, non-blaming; names the problem + the recovery (UI_UX guide). No native `alert`/`confirm`.
- **Graceful degradation:** an AI/OCR/optional-provider failure shows "unavailable" and never blocks core CRUD.
- **Workers:** idempotent; transient → retry (backoff); permanent → dead-letter + alert ([`09_background_jobs`](../technical/09_background_jobs.md)). Never silently drop a side effect.

## 2. Logging strategy

- **Structured JSON logs** with consistent fields: `timestamp, level, service, traceId, userId?, orgId?, event, message`. Backend uses `structlog`; the web app logs server-side with the same fields.
- **Levels:** `error` (needs attention) · `warn` (recoverable/degraded) · `info` (state changes, job start/finish) · `debug` (dev only, off in prod).
- **No PII or secrets in logs** ever (phone/email/tokens/document contents). Scrub before logging; log ids, not values.
- **One log per meaningful outcome**, not per line of code; include the correlation id and the subject entity id.
- **Client errors** are captured via Sentry (browser) with PII scrubbed; never `console.log` sensitive data.

## 3. Observability guidelines

- **Error tracking:** Sentry across web, FastAPI, and workers (server DSN server-side; scrub PII/secrets).
- **Correlation:** generate a `traceId` at the web edge and **propagate** it into FastAPI calls and enqueued jobs; every log/error carries it so a web→AI→worker flow is traceable end-to-end. The same id is returned to clients as `error.traceId` for support.
- **Health:** every service exposes health — `/api/health` (web Route Handler), `/health` (FastAPI) — covering liveness and, where relevant, readiness (dependency reachability).
- **Job visibility:** workers log start/finish/failure with the triggering id; failures are retryable and surfaced (dead-letter → Sentry alert + admin ops surface).
- **Realtime for users, logs/Sentry for operators** — user-facing status uses Realtime channels ([`10_events`](../technical/10_events.md)); operational visibility uses logs + Sentry.

## 4. Definition of "observable enough" (per new service/feature)

Before a feature/service is production-ready it has: structured logging with the standard fields, a health endpoint (services), Sentry wired, `traceId` propagation, and for async work — start/finish/failure logs + dead-letter handling.

## 5. Deferred (documented, not built now)

Metrics/dashboards (Prometheus-style), SLOs, alert thresholds, and a distributed-tracing backend — added when traffic justifies ([`../architecture/scaling-strategy.md`](../architecture/scaling-strategy.md)).
