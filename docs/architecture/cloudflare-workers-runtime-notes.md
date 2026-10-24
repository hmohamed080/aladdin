# Cloudflare Workers runtime notes: media processing

**Purpose.** What the Next.js server code needs to run under workerd (the OpenNext build for Cloudflare Workers, ADR-0021), as found by running the real Workers build under `wrangler dev`. This file covers image upload verification and variant generation, plus the other server modules that touch Node built-ins. Vercel stays the live host and the rollback, and its build is unchanged.

## Current decision

Image processing goes through one seam, `frontend/src/server/storage/image-processing/`:

| Runtime | Module | Engine |
|---|---|---|
| Node (Vercel, `next build`, scripts, Vitest) | `runtime.ts` → `sharp-processor.ts` | sharp, as before |
| Cloudflare Workers (`pnpm cf:build`) | `runtime.workers.ts` → `cloudflare-processor.ts` | Images binding `env.IMAGES` (wrangler.jsonc) |

The engine is chosen when the app is **built**, not while it runs. `open-next.config.ts` sets `buildCommand: "ALADDIN_BUILD_TARGET=workers pnpm build"`. With that variable set, `next.config.ts` replaces `runtime.ts` with `runtime.workers.ts` (webpack `NormalModuleReplacementPlugin`, server compilers only) and gives webpack a separate cache (`*-workers`). So the Worker bundle contains no sharp at all, and the Node bundle contains no Cloudflare code. CI checks this in job `frontend-cloudflare`: the bundled `worker.js` and OpenNext's `handler.mjs` must not contain `sharp-linux`, `@img/sharp` or `node_modules/sharp/`, and `worker.js` must contain the `cloudflare-images` engine.

`content-validation.mjs` no longer imports sharp. It takes the image verifier as an argument. `validation.ts` passes in the runtime's engine, and `scripts/media-storage.mjs` passes `sharp-verify.mjs`.

## Verification guarantee on Workers

sharp on Node decodes every pixel (`failOn: "warning"`, 25 MP limit). On Workers, `verify()` gives the same guarantee in three steps, for every image whether or not variants are stored:

1. **Container check** (`container-check.ts`, plain JS, no pixels). The signature must match the declared type. Every JPEG segment and every PNG chunk must lie inside the file, and PNG CRCs must be correct. A JPEG needs an end-of-image marker after its first scan; a PNG needs `IEND`; a WebP needs the full RIFF length. Animated WebP (VP8X flag, `ANIM`/`ANMF`) and APNG (`acTL`) are refused. Cloudflare Images is built to render what it can of a damaged file, so the binding is not relied on to refuse a truncated upload. A unit test checks this against a deliberately lenient engine.
2. **`info()`** (free). The format must equal the declared type, and width × height must be at most 25 MP.
3. **One real transform:** the 320 px `thumb` WebP, which makes Cloudflare decode the whole image. Its result is kept (WeakMap on the same bytes) and reused as the thumb variant.

What remains: a JPEG with corrupt entropy data that is still structurally complete could be accepted where sharp would refuse it. The browser sees the same pixels the variant shows, so the stored original is still a real, complete image of the declared type.

## Quota and billing (Images Free: 5,000 unique transformations a month)

- **R2 upload (variants stored):** 3 transformations (thumb, card, full). **Upload without variants** (Supabase provider): 1. Each quality step-down for a variant over 600 KiB is one more. `info()` calls are free. Re-processing the same bytes with the same parameters in the same month is billed once.
- That is about 1,600 R2 photo uploads a month on Free.
- **Exceeded:** the binding throws code 9422. That becomes `ImageQuotaExceededError`, so verification fails and the upload fails with the existing "upload failed" message. The row stays `pending` and can be retried; verification is never skipped. If the quota runs out while deriving variants (after verification), variants are skipped as before: they are best-effort, and the backfill can regenerate them.
- **Monitoring:** `console.error` event `media.images_quota_exceeded` (Workers Logs, observability is on). Other engine errors log `media.images_failed` with the numeric code only. `/api/health` → `imageMetrics` shows per-isolate counters (`transforms`, `infoCalls`, `quotaExceeded`, `failures`, `lastQuotaExceededAgoMs`). These counters are kept on `globalThis` because Next runs route handlers and server actions in separate module layers. The Images usage page in the dashboard is the authoritative count.

## Findings in workerd (local `wrangler dev`, Workers build)

| Area | Before | Now |
|---|---|---|
| sharp, statically imported via `server/storage/media.ts` | **38 of 163 routes returned 500** at module load (`Could not load the "sharp" module`), e.g. `/home`, `/home/profile/portfolio`, `/b2b/catalog`, the showroom pages, `/api/media/*`, `/api/video/*`. Upload finalize was unreachable. | Fixed by the seam. |
| Image verify + variants | Not reachable | Images binding. A 6000×4000 noisy JPEG (> 10 MB) went through the real UI: the browser prepared a 1.73 MB WebP, which was verified, and thumb 320×213, card 768×512 and full 1600×1067 were stored in the S3 stand-in. A 1800×1200 JPEG with EXIF orientation 6 was stored as JPEG with upright variants (1200×1800 full). No EXIF in any variant. Health showed 6 transforms for 2 uploads. |
| `@aws-sdk/client-s3` + `s3-request-presigner` (R2 provider, presigned PUT/GET, PutObject `IfNoneMatch`, DeleteObject) | Works | Works |
| R2 multipart for video (Create, sign part, ListParts, Complete, ranged GET, Abort) | Works in the OpenNext bundle | Works: E2E through `/api/video/uploads/*` |
| `pdf-lib` (certificate PDFs) | Works | Works |
| `node:crypto` (`createHash`, `createHmac`, `randomBytes`, AES-256-GCM in `recovery-grant.ts`), `Buffer` (base64url, concat) — `edge-ticket.ts`, `video/ticket.ts` | Works under `nodejs_compat` | Works |

There is one bundling trap. The OpenNext bundle resolves packages with the `workerd` condition and Node builds, so the AWS SDK parses XML with its Node parser. A Worker bundled **directly by wrangler** (default conditions include `browser`) gets the browser XML parser and fails on any XML response with `DOMParser is not defined` (seen with CreateMultipartUpload). A Worker that uses the AWS SDK outside OpenNext needs another XML parser or a different bundle setup.

A configuration error in `instrumentation.ts` (`readStorageEnv()` throwing a ZodError) shows only as `Cannot set property message of [object Object] which has only a getter`: Next tries to prefix the error's getter-only `message`. Every route returns 500 and the real issue list is hidden.

## Only on real Cloudflare (not provable locally)

Miniflare's local Images binding runs sharp in Node with `autoOrient: true`, so the following can only be confirmed on Cloudflare. `wrangler dev --remote` uses the real service.

- The **output quality** is ignored locally (sharp's default is used), so local file sizes and the number of quality step-downs differ.
- Local runs never return **9422**, are never billed, and do not enforce the 20 MB `.input()` limit (every namespace cap is ≤ 10 MiB).
- How lenient Cloudflare's decoder is with damaged files (the container check covers truncation either way).
- **EXIF orientation and metadata:** the Images docs say EXIF rotation is applied and all metadata is dropped for WebP output. This was checked locally only against the emulation.
- `info()` dimensions before or after orientation: not relied on, because variant dimensions come from `info()` on the output.
- Accounts on legacy Images billing get error 9432 (binding unavailable). Uploads would then fail, not bypass verification.

## Scope

Image verification and variants, plus the R2/PDF/crypto modules listed above. Redis over TCP on Workers is handled separately (REST transport, `server/cache/redis.ts`).

## Deferred / owner decisions

- Images plan: Free (5,000/month, uploads fail when it runs out) or Paid. Decide before the Workers cutover if more than about 1,600 R2 photo uploads a month are expected.
- An alert on the `media.images_quota_exceeded` event (Workers Logs alert or log drain). Not created: it needs a hosted change.
- A clearer user-facing message for "processing unavailable this month", in place of the generic upload failure. Not added: it needs translated copy.

## Reproduce

```bash
cd frontend
pnpm cf:build
pnpm exec wrangler deploy --env preview --dry-run --outdir /tmp/worker   # bundle; check for sharp as in CI
# .dev.vars: local Supabase + R2_* pointing at the S3 stand-in (R2_LOCAL_S3_ENDPOINT), see playwright.video.config.ts
pnpm exec wrangler dev --port 3320
PW_CHROMIUM=... pnpm exec playwright test -c playwright.workers-media.config.ts
```

The S3 stand-in bucket needs a CORS rule for the dev origin (PUT from `http://127.0.0.1:3320`).

## Related files

`frontend/src/server/storage/image-processing/*`, `frontend/src/server/storage/{content-validation.mjs,validation.ts,public-image-variants.ts,media.ts}`, `frontend/next.config.ts`, `frontend/open-next.config.ts`, `frontend/wrangler.jsonc`, `frontend/e2e/workers/image-upload.spec.ts`, `frontend/playwright.workers-media.config.ts`, `.github/workflows/ci.yml` (`frontend-cloudflare`), `docs/database/professional-asset-storage.md`.
