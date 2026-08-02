# 03 — API Standards, Shared Response & Error Models

| | |
|---|---|
| **Status** | Living document (canonical engineering reference) |
| **Version** | 1.0.0 |
| **Owner** | Engineering |
| **Last Updated** | 2026-08-01 |
| **Depends On** | [`../technical/08_api_contracts.md`](../technical/08_api_contracts.md), [`../decisions/ADR-0001-approved-architecture.md`](../decisions/ADR-0001-approved-architecture.md) |
| **Related** | [`05_validation_standards.md`](05_validation_standards.md), [`04_error_logging_observability.md`](04_error_logging_observability.md) |

Covers **API Standards (5)**, **Shared Response Models (16)**, **Shared Error Models (17)**. The *contracts* (every endpoint/action) live in [`08_api_contracts.md`](../technical/08_api_contracts.md); this doc defines the **shape and rules** those contracts share.

## 1. Surface model (recap)

Server-Action-first (ADR-0001): **reads** = RSC + typed queries; **mutations** = Server Actions (the write API); **HTTP Route Handlers** only for webhooks/BFF/health; **FastAPI** = internal, server-to-server, JWT-verified. Full detail: [`08_api_contracts.md`](../technical/08_api_contracts.md) §0.

## 2. Shared response model

Every action/endpoint returns a **discriminated result**, never a bare value or a thrown string across the boundary.

```ts
// lib/shared/result.ts (web)
type Ok<T>  = { ok: true;  data: T };
type Err    = { ok: false; error: ApiError };
export type Result<T> = Ok<T> | Err;
```

- **Success:** `{ ok: true, data }`. Lists return `{ items, page, pageSize, total | nextCursor }` — **always paginated**, never unbounded.
- **Failure:** `{ ok: false, error }` with the shared `ApiError` (below). Server Actions surface field errors to React Hook Form; they do not throw across the client boundary except for truly unexpected faults (→ error boundary + Sentry).
- **FastAPI** mirrors this as a JSON envelope: `{ "data": … }` on success; the error envelope (below) with the matching HTTP status on failure.

## 3. Shared error model

One canonical error shape across web actions and FastAPI:

```ts
type ApiError = {
  code: ErrorCode;          // stable machine code (below)
  message: string;          // localizable key or safe message (no internals)
  fields?: Record<string,string[]>; // field -> messages (validation)
  traceId?: string;         // correlation id (observability)
};
```

### Canonical error codes → HTTP status

| Code | HTTP | When |
|---|---|---|
| `UNAUTHENTICATED` | 401 | no/invalid session/JWT |
| `FORBIDDEN` | 403 | capability/RLS denies |
| `NOT_FOUND` | 404 | missing or not visible under RLS |
| `VALIDATION_ERROR` | 422 | Zod/Pydantic field errors (`fields` set) |
| `CONFLICT` | 409 | unique/state conflict (illegal transition, dup) |
| `RATE_LIMITED` | 429 | throttle (OTP/search/AI/export) — honor `Retry-After` |
| `DEPENDENCY_UNAVAILABLE` | 502/503 | upstream (OpenAI/OCR/WhatsApp) failed after retries |
| `INTERNAL` | 500 | unexpected fault |

Rules:
- **Never leak** stack traces, SQL, schema, or provider internals to clients ([`security-model.md`](../security/security-model.md)). `message` is a safe/localizable string; details go to Sentry/logs with the `traceId`.
- Map DB/RLS denials to `FORBIDDEN`/`NOT_FOUND` deliberately (don't reveal existence of rows a caller can't see).
- Validation failures always set `fields` for inline UI display.

## 4. API rules (shared)

- **Auth:** identity is **always derived from the session JWT**, never from input. Every mutation checks capability ([`07_permissions_matrix`](../technical/07_permissions_matrix.md)); the DB (RLS) is the final guarantee.
- **Validation:** Zod (web) / Pydantic (FastAPI) at the boundary before any work ([`05_validation_standards.md`](05_validation_standards.md)).
- **Versioning:** FastAPI paths are versioned (`/v1/...`). Server Actions are internal (no public URL versioning); breaking a shared action's contract is a `MAJOR`-type change tracked in the PR.
- **Idempotency:** retryable operations (webhooks, sends, exports) accept/dedupe an idempotency key.
- **Pagination:** `page ≥ 1`, `pageSize ≤ cap` (e.g. 100); cursor preferred for large/realtime lists.
- **Rate limits:** OTP, search, AI, export endpoints are throttled → `RATE_LIMITED` ([`13_integrations`](../technical/13_integrations.md)).
- **Bilingual:** error `message`/`fields` are localizable keys (AR/EN), not hard-coded English.
- **Events:** state-changing actions emit a domain event atomically ([`10_events`](../technical/10_events.md)); heavy work enqueues ([`09_background_jobs`](../technical/09_background_jobs.md)).
- **AI endpoints:** retrieval applies the org filter **before** returning content; outputs are drafts/rankings — never auto-actions.

## 5. Where to put the shared models

`frontend/src/lib/shared/{result,error}.ts` (web) and `backend/app/schemas/{response,error}.py` (FastAPI), each a thin, dependency-free module reused by every feature/capability. These are **the** canonical shapes — features never invent their own result/error envelopes.
