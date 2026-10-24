# R2 audit and prepared bucket rules (2026-10-22)

**Purpose.** Records what exists in Cloudflare R2 for Aladdin today. Holds the exact CORS and lifecycle rules the code needs, ready to apply. Maps each R2 requirement of the owner's brief to the code and tests that cover it, and names what still needs a test against real R2. Stage 2 of the [cutover plan](../cloudflare-frontend-cutover-plan.md) uses it.

**Current decision.** **Nothing in this folder has been applied.** The audit was read-only (Cloudflare MCP: `r2_buckets_list`, `r2_bucket_get`, `workers_list`, `workers_get_worker`, `hyperdrive_configs_list`). Applying a rule is a hosted change that needs the owner's approval at stage 2.

## 1. What exists (read on 2026-10-22)

| Bucket | Created | Location | Storage class | Jurisdiction | Role |
|---|---|---|---|---|---|
| `aladdin-r2-acceptance-20261011-private` | 2026-10-11 12:24 UTC | WEUR | Standard | default | Acceptance: the private media bucket (`R2_PRIVATE_BUCKET`). Every upload lands here, including `pending/`, images, variants and video. |
| `aladdin-r2-acceptance-20261011-public` | 2026-10-11 12:25 UTC | WEUR | Standard | default | Acceptance: `R2_PUBLIC_BUCKET`. **No current code path writes to it** (see finding 3). |
| `aladdin-production-db-backups` | 2026-10-15 08:29 UTC | WEUR | Standard | default | Database backups. Not media. Not touched by the app. Out of scope here. |

Other Cloudflare resources on the account:
- **Workers:** one, `aladdin-frontend-preview` (created 2026-10-22 06:36 UTC, modified 08:25 UTC). There is no media Worker (`aladdin-media-edge`) and no production frontend Worker.
- **Hyperdrive:** none. The media Worker needs one (query caching disabled) before edge delivery can work.
- **Production media bucket:** none. ADR-0018 names it `aladdin-media-private`, and this folder uses that name.

### Not readable with the available tools

The Cloudflare MCP tools return only name, date, location, storage class and jurisdiction. These settings were **not verified**:
- the CORS policy;
- lifecycle rules;
- public access and the `r2.dev` URL;
- custom domains;
- event notifications;
- bucket locks.

An operator can read them without changing anything:

```sh
pnpm exec wrangler r2 bucket cors list aladdin-r2-acceptance-20261011-private
pnpm exec wrangler r2 bucket lifecycle list aladdin-r2-acceptance-20261011-private
pnpm exec wrangler r2 bucket dev-url get aladdin-r2-acceptance-20261011-private
pnpm exec wrangler r2 bucket domain list aladdin-r2-acceptance-20261011-private
# repeat for -public
```

A CORS rule probably already exists on the private acceptance bucket. `frontend/src/server/storage/r2.live.test.ts:23-27` expects a preflight from `http://127.0.0.1:3187` to succeed against it, and that test was the 2026-10-11 acceptance. If one exists, the file below **replaces** it (`cors set` overwrites the whole policy) and keeps that origin.

## 2. Prepared rules (apply at stage 2, with approval)

| File | Bucket | What it does |
|---|---|---|
| [`cors-acceptance-private.json`](cors-acceptance-private.json) | `aladdin-r2-acceptance-20261011-private` | Lets the preview Worker origin and the local live-test origin `PUT` to presigned URLs. |
| [`cors-production-private.json`](cors-production-private.json) | `aladdin-media-private` (production, later) | The same rule for `aladdindecore.com`, `www`, and the stage-11 test hostname `next.aladdindecore.com`. Remove `next` after stage 12. |
| [`lifecycle-private.json`](lifecycle-private.json) | both private buckets | Deletes `pending/` objects after 2 days (ADR-0018). Aborts incomplete multipart uploads after 7 days (ADR-0020). |
| [`lifecycle-public.json`](lifecycle-public.json) | `aladdin-r2-acceptance-20261011-public` | Keeps only the 7-day multipart abort. |

Apply from `frontend/` with a token that has **R2 Admin Read & Write** on this account. This is an operator action, never CI:

```sh
pnpm exec wrangler r2 bucket cors set aladdin-r2-acceptance-20261011-private --file ../docs/operations/r2/cors-acceptance-private.json
pnpm exec wrangler r2 bucket lifecycle set aladdin-r2-acceptance-20261011-private --file ../docs/operations/r2/lifecycle-private.json
pnpm exec wrangler r2 bucket cors list aladdin-r2-acceptance-20261011-private       # verify
pnpm exec wrangler r2 bucket lifecycle list aladdin-r2-acceptance-20261011-private  # verify
```

The files use the Cloudflare API shape that `wrangler … set --file` takes. The dashboard's **R2 → bucket → Settings → CORS Policy → JSON** editor takes the S3 shape instead. The same rule in that shape:

```json
[
  {
    "AllowedOrigins": ["https://aladdin-frontend-preview.bstalent9.workers.dev", "http://127.0.0.1:3187"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type", "content-length"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

### Why the rules look like this

- **Only `PUT`, only on the private bucket.** The browser does exactly two things against R2:
  - image uploads: one `PUT` to a presigned `pending/<ns>/<key>` URL (`frontend/src/lib/storage/browser-upload.ts:24-32`);
  - video uploads: one `PUT` per multipart part (`frontend/src/features/video/upload-engine.ts:90-99`).

  Creating, listing, completing and aborting multipart uploads are server-side calls (`frontend/src/server/storage/r2-multipart.ts:42-100`). Reads never go from the browser to R2: they go through the app proxy (`delivery.ts`) or the media Worker's R2 binding. So no `GET`, `HEAD`, `POST` or `DELETE` is allowed, and the public bucket gets no CORS rule.
- **Headers `content-type` and `content-length`.** The image PUT sets `content-type`, which is signed into the URL (`r2-provider.ts:44-45`). `content-length` is set by the browser itself and is a forbidden header for scripts, so listing it costs nothing; it matches ADR-0020 and the E2E rule in `frontend/e2e/video/video-r2.spec.ts:141-142`.
- **`ETag` exposed.** The code does not read it: completion lists the parts R2 actually holds and never trusts a client ETag (`r2-multipart.ts:73-91`). It is exposed because the brief asks for it and because it is the standard way to debug a part upload in the browser. It reveals only an MD5 of bytes the browser just sent.
- **Exact origins, no wildcard.** R2 allows one `*` per origin. Wrangler's per-version preview URLs (`<version>-aladdin-frontend-preview.bstalent9.workers.dev`, `preview_urls: true`) are therefore **not** allowed, so uploads from a version-preview URL fail CORS. Add `https://*-aladdin-frontend-preview.bstalent9.workers.dev` only if the owner wants uploads tested there. The pattern stays inside the account's own subdomain.
- **Lifecycle.** `pending/` holds bytes the browser uploaded before server verification. They are kept until the receipt is written (`r2-provider.ts:69`), and anything older than 2 days is abandoned. Video originals are multipart uploads that the app expires after 24 h idle or 6 days in total (ADR-0020). The 7-day abort is the safety net under that. **`lifecycle set` replaces every rule**, including the default "abort multipart after 7 days" rule that R2 puts on new buckets. That is why both files contain the abort rule explicitly.

## 3. Findings

1. **No production media bucket, media Worker or Hyperdrive exists yet.** Real-R2 acceptance can use only the two acceptance buckets and the preview frontend Worker. Edge delivery (`MEDIA_EDGE_DELIVERY_ENABLED`), conditional public media and video playback all need the media Worker and Hyperdrive. Until those exist, real-R2 tests cover upload, verification, variants and **proxy** delivery only.
2. **The bucket settings that matter most for security** are public access off and `r2.dev` off on the private bucket. **They are not visible through the MCP tools.** Check them with `wrangler r2 bucket dev-url get` before stage 2 and record the result in the acceptance report.
3. **The public acceptance bucket is unused by current code.** The five revocable namespaces (`avatar`, `portfolio`, `certificate`, `product`, `organization`) refuse a public bucket (`r2-provider.ts:29-31`). Video and variants go to the private bucket. `R2_PUBLIC_BUCKET` and `R2_PUBLIC_BASE_URL` are optional in the env schema. Leave the bucket without public access, and do not create a production twin of it unless a public pipeline is approved (ADR-0018 "Mode B").
4. **The test name `deletes every variant together with the original` appears twice** in `frontend/src/server/storage/r2-provider.test.ts` (lines 19 and 84). This is harmless but confusing in reports. It should be fixed in the code thread, not here.

## 4. Requirement map

✅ covered by unit or local tests · 🟡 covered by tests against isolated or local storage, needs a run against **real R2** · 🔴 not testable until a missing hosted piece exists.

| Requirement | Code (file:line) | Tests (file:line) | Real-R2 acceptance still needed |
|---|---|---|---|
| **Byte verification**: the server reads the uploaded bytes and checks size, type and a full decode, then a sha256 receipt, before `ready`. | `frontend/src/server/storage/media.ts:91-127` (`verifyPendingMedia`: `readObject` :118, verify :119, commit :120, attest :123-126). `content-validation.mjs:17-29` (size, PDF parse, image decode, sha256), `:31-49` (bounded read). `r2-provider.ts:42-47` (URL signed for 120 s, bound to content type and exact length), `:56-70` (immutable final write, `IfNoneMatch`). Workers engine: `image-processing/cloudflare-processor.ts:40-100`, `container-check.ts:10`. Media Worker refuses an object whose size differs from the receipt: `edge/media-worker/src/handler.ts:115-120`. | `media.test.ts:50,55,63`. `image-processing/image-processing.test.ts:64,72,81,118,126`. `r2-provider.test.ts:29,42,50`. `r2.live.test.ts:17` (real CORS, wrong type and length refused, replay cannot replace final bytes). `media.live.test.ts:52,59,80`. `edge/media-worker/test/handler.test.ts:131`. | 🟡 `r2.live.test.ts` and `media.live.test.ts` against the acceptance bucket **from the Workers runtime** (Images binding verify path, error 9422 path). The 2026-10-11 run was Node and sharp. |
| **WebP variants** (thumb, card and full at 320/768/1600, EXIF baked in then stripped, best-effort) | `public-image-variants.ts:24-26`. `media.ts:78-88` (`storeVariants`), `:128-135` (manifest recorded). `r2-provider.ts:76-85` (`putVariant`, same bucket and privacy, idempotent). `edge-ticket.ts:102-115` (only recorded variants get URLs). | `public-image-variants.test.ts:12,29,41,50,62`. `image-processing.test.ts:86,107,137,156`. `media.test.ts:81,95,105`. `r2-provider.test.ts:74`. `edge-ticket.test.ts:106`. | 🟡 Upload a JPEG with EXIF orientation through the preview Worker. Check that three `image/webp` objects exist beside the original in the private bucket, that the `variants` manifest is recorded, and that Images usage rises by 3. |
| **Private access rechecked on every request** | App proxy: `delivery.ts:19-57`. It resolves as the caller before the fetch (:24) and **again after** (:32-35), with no-store headers (:7-14), and forwards no upstream ETag, cookie or location (:50). Edge: tickets are not authority (`edge-ticket.ts:12-20`); the Worker calls `media_edge_authorize` on every request (`edge/media-worker/src/handler.ts:179,189`). Video: every segment (`video.ts`). | `delivery.test.ts:17,26,37,46`. `edge-ticket.test.ts:43,90,116`. `handler.test.ts:92,105,116,126,168`. `video.test.ts:116`. `edge/media-worker/test/authority.live.test.ts:19` (local DB). pgTAP `supabase/tests/99_media_edge_authorization_test.sql`, `88_revocable_media_delivery_test.sql`. | 🟡 The proxy path against real R2 from the preview Worker (two users, cross-tenant read denied). 🔴 The edge path needs the media Worker, Hyperdrive with caching off, and the `media_edge_worker` role. |
| **Revocation** (delete, unpublish, audience change, suspension, sign-out deny the next request) | `delivery.ts:32-35` (bytes dropped if revoked mid-fetch). `r2-provider.ts:86-93` (`deleteObject` removes the final object, the pending object and every variant). `media.ts:146-149`. Video: delete revokes in the DB, then aborts the upload (`frontend/src/server/video/uploads.ts`). Session revocation in the DB: migrations `20261021090013`, `20261021090014`. | `delivery.test.ts:41,46,50`. `handler.test.ts:92,187,267`. `authority.live.test.ts:19`. `media.live.test.ts:144`. `video/uploads.test.ts:167,172`. `r2-provider.test.ts:19,84`. pgTAP `102_data_api_session_revocation_test.sql`, `103_storage_realtime_session_revocation_test.sql`, `48_portfolio_certificates_test.sql`. `supabase/tests/public_media_exposure_test.mjs`. | 🟡 Against real R2 through the proxy: upload, read, delete, read again (404), and list the bucket to confirm the original, pending object and variants are gone. 🔴 Edge path (edge cache must not outlive revocation, `handler.test.ts:267`) needs the media Worker. |
| **ETags and cache keys** | Edge byte cache keyed by object plus verified sha256, never by R2's ETag: `handler.ts:61-63`. Strong `ETag` = sha256 and 304 only for conditional public media, re-authorized each time: `handler.ts:84-91`. Private media sends `no-store` and no ETag: `handler.ts:22`, `delivery.ts:7-14,50`. Video cache key = object plus immutable revision: `video.ts:163`. Multipart completion uses the ETags R2 reports, not the client's: `r2-multipart.ts:60-73,79-91`. | `handler.test.ts:76,179,187,254,267,277,287,300`. `video.test.ts:182`. `video/uploads.test.ts:108,140,151`. | 🟡 Real multipart completion (R2's `-N` ETags) from the preview origin, with the CORS above. 🔴 Edge cache and 304 behaviour need the media Worker on `media.aladdindecore.com`. |
| **Certificates protected** | `certificate` is in the revocable set and refuses a public bucket: `r2-provider.ts:29-31`. Private-only Cache-Control `private, no-store`: `r2-provider.ts:60,80`. Edge content types for certificates: `handler.ts:9`. ADR-0018: certificates are never served without a session (Mode P only). | `r2-provider.test.ts:61`. `media.live.test.ts:110` (another tenant cannot upload, read or delete; service attestation). pgTAP `48_portfolio_certificates_test.sql`, `96_rc2_private_provider_media_test.sql`. | 🟡 Run `media.live.test.ts:110` against the acceptance bucket. Then confirm with `wrangler r2 object get` (operator) that the stored object has `Cache-Control: private, no-store`, and that the bucket has no public URL. |
| **Large or interrupted uploads** | Images: 120 s URL bound to exact length (`r2-provider.ts:42-47`); browser retries transport and 5xx failures 3 times with backoff and a 4-per-tab cap (`browser-upload.ts:8-43`); pending key replay cannot overwrite verified bytes (`r2-provider.ts:56-70`). Video: parts ≥ 8 MiB, ≤ 10,000; each part URL signed for one number and exact length for 600 s (`r2-multipart.ts:25,49-58`); resume from parts R2 holds (`:60-73`); complete only with exact parts 1..N (`:79-91`); abort (`:98-100`). The 7-day lifecycle abort is the backstop (this folder). | `r2.live.test.ts:40` (an expired presigned PUT is refused by real R2). `media.live.test.ts:96` (interrupted retries and concurrent uploads). `features/video/upload-engine.test.ts:55,69,80,89,100,109`. `video/uploads.test.ts:57,66,108,116,122,140,151`. `frontend/e2e/video/video-r2.spec.ts` (local S3 stand-in). | 🟡 From a browser on the preview origin against the acceptance bucket: a 1 GB+ video, killed mid-upload and resumed, completes with the right size. 🟡 Apply `lifecycle-private.json` and confirm with `lifecycle list`. 🔴 Playback needs the media Worker and the transcode container. |

## Related

- [ADR-0017](../../decisions/ADR-0017-rc2-private-media-integration.md), [ADR-0018](../../decisions/ADR-0018-r2-edge-media-delivery.md), [ADR-0020](../../decisions/ADR-0020-video-r2-hls.md), [ADR-0021](../../decisions/ADR-0021-cloudflare-workers-frontend.md)
- [Credentials checklist](../cloudflare-credentials-checklist.md): the R2 tokens and where they go.
- [Cutover plan](../cloudflare-frontend-cutover-plan.md): stage 2 (real R2 and Hyperdrive) and stage 7 (production R2).
