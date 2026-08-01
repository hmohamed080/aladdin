# 13 — Integrations

| | |
|---|---|
| **Status** | Specification · Phase 0.7 (pre-implementation) |
| **Version** | 1.0.0 |
| **Owner** | Architecture / Foundation |
| **Last Updated** | 2026-08-01 |
| **Depends On** | ../decisions/ADR-0001-approved-architecture.md, ../decisions/ADR-0004-deployment-platforms.md, ../security/security-model.md |
| **Related** | 09_background_jobs.md, 05_storage_design.md |

Every external system the MVP touches. Only the **approved stack** (ADR-0001/0004, [`security-model.md`](../security/security-model.md)) is built in MVP. All third-party credentials are **server-side only**; the browser gets only `NEXT_PUBLIC_*` validated config. Each integration is wrapped behind a small internal adapter so a provider can be swapped without touching feature code.

## Common rules

- **Auth/secrets:** stored in each platform's secret store + the validated config module (`frontend/src/lib/env`, `backend/app/config.py`); never in source, never in the client.
- **Failure handling:** timeouts on every outbound call; circuit-breaker/limiter per provider; user-facing errors are generic (no provider internals); details to Sentry/structlog.
- **Retry:** idempotent calls retry with exponential backoff + jitter (respect `Retry-After`); non-idempotent sends carry an idempotency key ([09](09_background_jobs.md)).
- **Security:** verify webhook signatures; least-privilege API scopes; PII minimized in logs; no tenant data crosses into another tenant's prompt/retrieval.

## Approved integrations

### 1. Supabase (core platform)
- **Purpose:** Postgres (system of record), Auth (OTP/JWT), Storage, Realtime, Queues, search/vector/geo extensions.
- **Auth:** anon/publishable key in browser (RLS-constrained); `service_role` server-only. User JWT preserved through `supabase-js`/`supabase-py`.
- **Limits:** per-plan connection/row limits; use server-side pagination; pooling for the Python service (⚑ pooler currently disabled locally).
- **Failure/retry:** DB errors surface as domain errors; transient connection errors retried; Realtime auto-reconnect on the client.
- **Security:** RLS spine ([06](06_rls_strategy.md)); storage policies mirror table policies; service-role never in client.

### 2. OpenAI (LLM + embeddings)
- **Purpose:** AI consultation, intent extraction, match explanation, follow-up drafting, RAG, embeddings, evaluations.
- **Auth:** API key, **FastAPI server only**.
- **Limits:** token + RPM/TPM limits → per-worker token-bucket limiter; batch embeddings; stream consultation responses.
- **Failure/retry:** 429/5xx retried with backoff; hard failures degrade gracefully (feature shows "unavailable", never blocks core CRUD); cost guardrails (max tokens, truncation).
- **Security:** **retrieval applies org authorization filters before content reaches the prompt**; never embed another tenant's data; prompts logged with PII minimized; outputs are drafts/rankings — **never auto-actions**.

### 3. Azure Document Intelligence — OCR (candidate)
- **Purpose:** OCR for verification/documents (Arabic + Latin).
- **Status:** **candidate, not finalized** (ADR-0004). Wrapped behind an `OcrProvider` adapter so it can be swapped.
- **Auth:** key, FastAPI/worker only.
- **Limits:** page/req limits → enqueue + limiter.
- **Failure/retry:** retry→dead-letter; OCR failure never blocks manual verification review.
- **Security:** documents from private buckets via signed URL; results (`ocr_text`) stored on the RLS-governed row; ⚑ **must validate Arabic OCR accuracy before finalizing** ([12](12_validation_rules.md)).

### 4. WhatsApp Business API (auth + operational messaging)
- **Purpose:** phone **OTP** (no SMS) + operational notifications (order/quote/verification updates) per user prefs.
- **Auth:** Meta app token/secret, server only; inbound webhook signature-verified.
- **Limits:** Meta messaging + template rate limits; pre-approved templates only; per-recipient throttling.
- **Failure/retry:** send via `whatsapp.send` job with backoff; delivery/read via webhook; dead-letter on permanent failure (undelivered OTP = reliability incident).
- **Security:** opt-in required; **never surface "WhatsApp Business API"** or implementation copy in UI.

### 5. Email provider (auth + operational)
- **Purpose:** email OTP/verification links + operational email.
- **Status:** provider **⚑ OPEN** (e.g. Resend/Postmark/SES); behind an `EmailProvider` adapter. (Local dev uses Supabase Inbucket/Mailpit.)
- **Auth:** API key, server only; signed webhooks for delivery/bounce.
- **Limits:** provider send limits → `email.send` job + limiter; suppression list from bounces/complaints.
- **Failure/retry:** backoff + dead-letter; verification links are signed, single-use, TTL.
- **Security:** SPF/DKIM/DMARC; links open verification (never password reset — none exists).

### 6. Sentry (error monitoring)
- **Purpose:** error tracking across web + FastAPI.
- **Auth:** DSN (client DSN is public by design but scoped); server DSN server-side.
- **Security:** scrub PII/secrets from events; no request bodies with credentials.

### 7. Excel import/export (library capability)
- **Purpose:** bulk product/catalog import; report/data export.
- **Not** an external SaaS — an in-app/worker library (justified per dependency policy). Large files parsed in the `excel.import` worker, never inline.
- **Security:** validate/normalize every row against schemas ([12](12_validation_rules.md)); output to private `exports/`.

### 8. PDF generation (library capability)
- **Purpose:** quote/report PDFs.
- **Constraint:** **must embed Arabic-shaping-capable fonts** ([`DESIGN.md`](../../DESIGN.md) Typography — the web font stack does not apply to PDFs). ⚑ Choose the PDF engine/font strategy at build.
- **Security:** rendered server/worker-side; output to `exports/`/`documents`.

## Explicitly NOT approved (do not build in MVP without a new ADR)

| Requested example | Why not / approved substitute |
|---|---|
| **Cloudinary** | Media store is **Supabase Storage** ([05](05_storage_design.md)); image transforms via Supabase built-in transforms or an in-app worker. |
| **Firebase / mobile push** | No native app in MVP (responsive PWA). MVP channels = in-app **Realtime** + email + WhatsApp. Web/mobile push is [14](14_future_extensions.md). |
| **Google Maps / Places** | Locality data is **internal Egyptian reference data** (`localities`) + **PostGIS**; no external maps/places dependency in MVP. |
| **Payment providers** | Payments/escrow/milestones are **deferred** (PRODUCT_DIRECTION_GUIDE non-goals). Subscriptions have no billing integration in MVP. |
| **Future AI services** (beyond OpenAI) | Only OpenAI is approved now; other providers require an ADR. The `LlmProvider` adapter leaves room. |

## Integration adapter map (internal seams)

`AuthProvider` (Supabase) · `LlmProvider` (OpenAI) · `OcrProvider` (Azure DI candidate) · `WhatsAppProvider` · `EmailProvider` · `StorageProvider` (Supabase) · `ErrorReporter` (Sentry). Feature code depends on the adapter interface, not the vendor — this is what keeps the "candidate/OPEN" providers swappable.

## Open items
- ⚑ Email provider selection.
- ⚑ OCR provider finalization + Arabic accuracy validation.
- ⚑ PDF engine + Arabic font embedding.
- ⚑ Provider rate-limit numbers (to size limiters/queues).
