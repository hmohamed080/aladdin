# FastAPI: next phase (prepared, not started)

**Status:** plan only, 2026-10-19. The owner asked not to begin a broad backend migration until R2 is proven stable. Nothing here is implemented beyond the jobs already on PR #91, PR #92 and the video PR.

## Entry criteria (all required)

1. PRs #88 → #89 → #91 merged, and the R2/edge migrations applied to the target project with approval.
2. R2 live for new uploads for at least a week with: zero authorization regressions in the `media.denied` / `media.verified` logs, edge 5xx rate under 0.1 %, and a passing real-R2 run of `frontend/src/server/storage/r2.live.test.ts` against the disposable acceptance buckets.
3. Historical purge executed (or explicitly deferred) with its journal confirmed.
4. Video (ADR-0020) either live on a chosen transcode host or explicitly deferred.

## What moves to FastAPI, and what does not

The rule from ADR-0001 stands: FastAPI is for AI, OCR, RAG, documents and workers, **not** a second CRUD backend. To avoid duplicate implementations:

| Concern | Owner | Why |
|---|---|---|
| Pages, CRUD, RLS-scoped reads and writes | Next.js + Supabase | Already there; moving it would duplicate every permission path |
| Upload authorization, presigned URLs, media/video tickets | Next.js | Needs the caller's session at request time; one signer only |
| Byte delivery and per-request authorization | Media Worker + Postgres | Bytes never through Vercel |
| Media jobs: historical purge, video transcode and purge, variant backfill | FastAPI codebase (`backend/app/workers`) | Long-running, CPU-heavy, service-role, idempotent |
| AI (OpenAI), OCR of certificates and documents, RAG/embeddings | FastAPI | ADR-0001 scope |
| Job coordination | Postgres leases + optional Redis wake-ups/locks (ADR-0019) | No queue product needed yet |

## Proposed work, in order

1. **One worker image.** The jobs run from the backend codebase but **not** inside the Vercel FastAPI function (time limits, no ffmpeg, no bytes through Vercel). Package `uv sync --group video-worker` plus ffmpeg as one container with three entry points: `video_transcode --loop`, `video_transcode --purge` (hourly), `historical_media_purge` (manual). Host choice needs approval (ADR-0020, "Deployment dependencies").
2. **Variant backfill job** (`backend/app/workers/variant_backfill.py`): regenerate missing WebP variants from verified R2 originals and record them with `media_storage_record_variants`, so the app's best-effort variant step can stay best-effort.
3. **Job health endpoint** on the existing FastAPI service (`/api/backend/jobs/health`, service-authenticated): last successful run per job, queue depth (`processing` videos, unpurged deletions). Read-only.
4. **Document OCR** for business-verification evidence, preserving the caller's JWT (ADR-0005) and never moving those files out of their Supabase bucket.
5. **Set `APP_ENV` in Production** for the FastAPI service so its startup secret check runs (owner approval; noted in the 2026-10-19 report).

## Explicitly out of scope

Moving any CRUD, page data or authorization decision into FastAPI; a second media signer; a message broker; caching authorization anywhere.
