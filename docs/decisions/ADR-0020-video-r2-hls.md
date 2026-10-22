# ADR-0020 — Video: R2 originals, HLS transcoding worker, per-request edge authorization

**Status:** Proposed · 2026-10-19 · Revision 2 (same day, owner decisions: no size or length caps, mixed photo/video order, Stream later behind a provider seam) · **Needs owner approval** before any hosted step (migration, R2 CORS rule, Worker route, transcode host). The code ships switched off (`VIDEO_ENABLED=false`, Worker `VIDEO_ROUTES="off"`); with it off nothing changes.

**Builds on:** [ADR-0018](ADR-0018-r2-edge-media-delivery.md) (private R2 + ticketed edge Worker + per-request Postgres decision) and [ADR-0019](ADR-0019-redis-cache-and-rate-limits.md) (Redis as accelerator only).

## Decision

Portfolio and product videos are stored in the **private R2 bucket**, transcoded to **adaptive HLS** by a separate worker, and delivered **only** by the media Worker at `/v/<videoId>/<file>`, with a database decision on **every** playlist, segment and poster request.

```
browser ──multipart PUT (presigned parts, ≥ 100 MiB)──▶ R2  video/<id>/original
   ▲                                                   │
   │ app (Vercel): begin / sign parts / complete       │ transcode worker (ffmpeg)
   │ — decides in Postgres, never sees bytes           ▼
   └──────── HLS from the media Worker ◀── R2  video/<id>/<revision>/{master.m3u8, poster.jpg, 360p|720p|1080p/…}
                 (Postgres media_edge_video per request)
```

No video byte passes through Supabase or Vercel.

### Upload
- **No product size or length cap (Revision 2).** Types `video/mp4`, `video/quicktime`, `video/webm`. The only size ceiling is R2's 5 TiB object limit. Count quotas are the existing ones only: a product's videos share its 3 gallery slots with its photos (owner decision 2026-10-19, "shared limit"); portfolios have no video count limit; at most 10 unfinished uploads per person, as for images.
- Part size grows with the file so no upload exceeds R2's 10,000 parts: `max(100 MiB, ceil(bytes / 10,000) rounded up to 1 MiB)` (100 MiB is the approved chunk size).
- `video_upload_begin` (caller's JWT, RLS) decides; only then is an R2 multipart upload opened. Part URLs are signed per part number **and exact length** for 10 minutes, at most 8 per request, rate-limited per user (`video-part`, ADR-0019).
- The browser uploads 3 parts at a time with byte progress, retries each part 4 times with backoff on a freshly signed URL, and resumes after a reload: it remembers only the file fingerprint and upload id, and asks the server which parts R2 holds.
- Completion never trusts client ETags: the server lists the parts R2 stored, completes with exactly parts 1..N at their expected lengths, checks the stored size and the container signature, then moves the row to `processing` and pushes a Redis wake-up (optional).
- An unfinished upload expires after 24 h **without activity** (every part signature or status check renews it) or 6 days in total, safely before R2 aborts multipart uploads after 7 days; the purge aborts it. The browser waits for the network to come back instead of spending its retries while offline.

### Transcoding (`backend/app/workers/video_transcode.py`)
- Leases a job in SQL (`video_job_claim`, `SKIP LOCKED`, 3 attempts). A heartbeat renews the 15-minute lease every 5 minutes (`video_job_renew`) while ffmpeg runs, so a long video is never handed to a second worker; ffmpeg's own timeout scales with the duration (8 s per media second, at least 25 min). Before downloading, the worker checks for 2.5 × the original in free disk; with less, the job is released for a larger host instead of failing. Several workers need no coordination.
- ffprobe/ffmpeg run with the demuxer forced by the declared type and `-protocol_whitelist file`, so a crafted container cannot make ffmpeg open a URL or another file. No video stream or unreadable media is rejected without retry. There is no length limit.
- Output: HLS fMP4, 4 s segments, 360p/720p/1080p never above the source (rotation-aware), AAC stereo when the source has audio, metadata stripped, plus `poster.jpg`. Written under a fresh `revision`, playlists last, then `video_job_finish`.
- `--purge` is the only path that deletes video bytes: deleted or expired rows → abort multipart, delete `video/<id>/`, mark purged.

### Delivery (`edge/media-worker/src/video.ts`)
- The app mints a **page ticket** (≤ 120 s, viewer + Auth session + workspace). At the master playlist the Worker swaps it for a **play ticket** (4 h) and rewrites every playlist URI to carry it, so a long video keeps playing. A ticket carries no access of its own.
- Every request calls `public.media_edge_video`: owner, product audience (workspace), or a published portfolio video of a listed profile (anonymous, no ticket). Live session check: sign-out refuses the next segment. Delete, unpublish, delisting, suspension and audience changes do the same.
- HTTP Range (206/416), CORS for the app origins only (`VIDEO_ALLOWED_ORIGINS`), playlists ≤ 256 KB with only known relative URIs, `nosniff` + sandbox CSP.
- Edge byte cache keyed by object + immutable revision (segments, init, poster ≤ 20 MB). Authorization is never cached. Browsers get `no-store` for ticketed bytes and `no-cache` for public bytes.
- Player (`frontend/src/features/video/video-player.tsx`): poster only (`preload="none"`), no autoplay on load or scroll. Desktop with a fine pointer: resting on the video for 300 ms starts a **muted preview** at the lowest rendition with a 6 s buffer; leaving stops it and releases the stream. Click or tap plays from the start with sound and controls. Touch devices and reduced-motion users get no preview. Native HLS on Safari/iOS, `hls.js/light` loaded on the first interaction elsewhere, capped to the player size; aspect ratio from stored dimensions (no layout shift). A ticketed source older than 50 s is refreshed through `GET /api/video/<id>/playback`, which re-decides access, so a revoked viewer gets "unavailable" instead of a stale ticket.

## Revision 2 — ordering, provider seam, technical limits

**One order for photos and videos.** Portfolio photos (`portfolio_items.sort_order`) and portfolio videos (`media_videos.sort_order`) share one position space; `portfolio_media_move(kind, id, direction)` renumbers both under an advisory lock. Product photos (`product_images.slot`) and product videos (`media_videos.slot`) share slots 1–3; `product_media_reorder(product, [{kind,id}…])` places every ready item, and `product_images_enforce_max` counts both. A video may come first. The product's main photo for cards stays the first **photo**. Public portfolios, the product page and the owner's managers render the merged order (`frontend/src/lib/media/media-order.ts`).

**Provider seam.** `media_videos.provider` is `r2_hls` (default) or `cloudflare_stream`, with `provider_ref`. Public and edge functions only serve `r2_hls` rows today. `frontend/src/server/video/provider.ts` is the only place that knows the storage; the upload plan names its `transport` (`r2-multipart`), and the browser refuses a transport it does not speak. Adding Stream later means: a `tus` transport (Stream's direct creator upload), a webhook that marks the row ready, and a playback source that returns a signed Stream manifest. Ordering, quotas, permissions and the UI do not change. Stream is **not** activated and nothing is bought.

**Unavoidable technical limits (not product caps).**
| Limit | Value | Where |
|---|---|---|
| R2 object size | 5 TiB | Cloudflare R2 |
| Multipart parts | 10,000 per upload, ≥ 5 MiB each (we use ≥ 100 MiB) | R2/S3 |
| Unfinished upload lifetime | 24 h idle or 6 days total (R2 aborts at 7 days via lifecycle rule) | SQL + R2 lifecycle |
| Transcode disk | ≈ 2.5 × the original free on the worker host | worker host |
| Transcode time | roughly 0.5–2 × the video's duration on 2 vCPUs for three renditions | worker host |
| Browser | a file must stay selected/readable for the upload; resume after reload needs the same file chosen again | browser |
| Media Worker | Workers Free: 100,000 requests/day ≈ 1,250 five-minute full views/day | Cloudflare |

**What processing needs before Stream, and what it costs (estimates, check current prices).** A transcode host with ffmpeg and disk for the largest expected original: e.g. a 2 vCPU / 4 GB VM with 40–80 GB disk (≈ $5–10/month, handles originals up to ≈ 15–30 GB), or per-second machines (Fly.io / Cloud Run jobs, ≈ $0.02–0.05 per hour of source video transcoded, plus attached disk). R2 storage ≈ $0.015/GB-month after 10 GB free: an original plus three renditions is ≈ 1.6 × the original. Stream instead: ≈ $5 per 1,000 minutes stored and $1 per 1,000 minutes delivered, encoding included, but revocation bounded by token lifetime. **Neither is activated.**

## R2 + HLS vs Cloudflare Stream

| | R2 + HLS (chosen) | Cloudflare Stream |
|---|---|---|
| Revocation | Every segment is decided in Postgres: immediate | Signed-URL JWT valid until it expires; no per-segment DB check |
| Tenant isolation | Same SQL rules as images (RLS + `media_edge_*`) | Separate access model to keep in sync |
| Storage | $0.015/GB-month (first 10 GB free) | $5 per 1,000 minutes stored / month |
| Delivery | R2 egress free; Worker requests | $1 per 1,000 minutes viewed |
| Encoding | Our worker (ffmpeg) — needs a host | Included |
| Example: 200 videos × 2 min, 2,000 views × 2 min / month | ≈ $0 storage (≈ 20 GB → $0.15); requests within Workers Paid's included 10 M | ≈ $2 stored + $4 delivered ≈ $6/month, plus the Stream subscription |
| Operational cost | Worker host + ffmpeg upkeep | None |

Stream is cheaper to operate but cannot meet "immediate revocation of files and segments" and "same tenant isolation" without a second permission system. R2 + HLS meets both with the authority we already have.

## Deployment dependencies (each needs owner approval)

1. Apply migration `…_media_videos.sql` (renamed to sort after the revocation migration when the PR stack merges) to the target project (Supabase stays on Free).
2. R2 bucket **CORS**: allow `PUT` from the app origin(s), headers `content-type`, `content-length`. Lifecycle rule: abort incomplete multipart uploads after 7 days (the app expires them sooner).
3. Media Worker: `VIDEO_ROUTES="on"`, `VIDEO_ALLOWED_ORIGINS="https://<app origin>"` on the `media.aladdindecore.com` route (DNS approval pending, ADR-0018).
4. **Transcode host** with ffmpeg, Python 3.12, `uv sync --group video-worker`, and env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (a token scoped to the private bucket), `R2_PRIVATE_BUCKET`, optional `REDIS_URL`. Run `--loop` (always on) or `--once` on a schedule plus `--purge` hourly. It cannot run on Vercel (no bytes through Vercel, long CPU jobs). Options: a small always-on VM (≈ $4–6/month), Fly.io Machines with scale-to-zero (pay per second of transcoding), or Google Cloud Run jobs. **Paid; not activated.**
5. App env: `VIDEO_ENABLED=true` (requires `R2_STORAGE_ENABLED` and `MEDIA_EDGE_DELIVERY_ENABLED`).

## Verification (2026-10-19, isolated local stack)

`frontend/playwright.video.config.ts` ([guide](../guides/video-local-e2e.md)), desktop and mobile Chromium, S3-compatible stand-in for R2, the Worker's real handler, the real worker: upload in parts, transcode, owner play + seek + Range 206, publish, anonymous play, unpublish refuses the next anonymous segment, delete refuses the owner's next segment, sign-out refuses the owner's play ticket, purge removes every object, no video byte through the app. Measured locally: first frame 0.6–0.8 s after pressing play, seek 50–110 ms, only posters requested before play, about a third of edge requests served from the byte cache, 12 s 720p clip transcoded in about 6 s. Real R2, a real Cloudflare edge and H.264 decoding in a branded browser were **not** exercised (no network path to R2 from the test sandbox; the test browser lacks H.264, so the test encodes VP9 with `--test-codec`, local only).

## Load note

One full view of a 5-minute video is about 80 Worker requests and 80 Postgres decisions (4 s segments). Workers Free allows 100,000 requests/day; Workers Paid ($5/month) includes 10 M/month. The per-request decision is a single indexed function call; it is the price of immediate revocation and is not cached.

## Rejected

- Progressive MP4 through the app proxy: puts bytes through Vercel.
- Short-lived signed R2 URLs per segment: revocation waits for expiry, and playlists would need re-signing per request anyway.
- Caching authorization in Redis or at the edge: stale permission decisions.
