# R2 storage and direct image delivery: audit and architecture plan

Date: 2026-10-18. Branch audited: `/home/claude/r2wt` (draft PR #89; it includes PR #88). Hosted data: `kkpkgjrweysgvhvkhzun` (aladdin-staging). Everything was read-only: SELECT-only SQL on metadata and log queries. No object was downloaded, and no setting, code or billing was changed.
Inputs: `AGENTS.md`, ADR-0017, `ARCHITECTURE_GUIDE.md`, `frontend/src/server/storage/*`, `app/api/media/[namespace]`, `app/p/media/[itemId]`, `scripts/media-storage.mjs`, migrations `20261018100000`–`100003`, PR #88 `20261017160001_business_verification.sql`, `supabase-usage-audit.md`. `.notes/inputs.md` does not exist.

---

## 0. Decisions the owner must make first

| # | Decision | Recommendation | Why it is needed |
|---|---|---|---|
| D1 | May **published portfolio** photos become plain public CDN URLs, with withdrawal taking up to about 60 s at the edge plus the browser TTL? | **Not now.** Serve them through the Worker in conditional mode (Mode C, §3). It is CDN-fast, keeps "immediately" true, costs about $0–5 a month, and keeps every image byte off Supabase and Vercel. Move to Mode B (pure CDN) later only if traffic makes Worker requests matter. | Tests `48_*` (lines 536 and 587), `88_*` (line 68) and `public_media_exposure_test.mjs` §D assert immediate withdrawal. A cached CDN URL cannot meet that. |
| D2 | Should **product images** (published, audience-gated) and **organization logos** (members only today) become public? | Keep both **PRIVATE**, as ADR-0017 decides. Revisit only if the product wants anonymous catalog or directory pages. | `organization_media_resolve` requires an authenticated, active caller. Products are also gated by `product_image_viewable` (audience); logos by `is_org_member`. |
| D3 | Supabase egress for the bulk copy | **Wait for the cycle reset, or upgrade to Pro, before copying portfolio originals.** If a rehearsal is wanted now, copy only avatars and certificates (16 MB). | About 0.29 GB of headroom remains. The copy needs 0.273 GB (§5). |
| D4 | The media hostname | Use a separate domain for media, fully set up on Cloudflare's Free zone plan, for example `media.<new-domain>`. Alternatively, move `aladdindecore.com` DNS to Cloudflare. | An R2 custom domain and Worker routes need a Cloudflare zone. Partial (CNAME) setup is **Business or Enterprise only**. |
| D5 | Workers plan | **Workers Paid, $5/mo**, for production. | On the Free plan, Workers (100k requests/day), Hyperdrive (100k queries/day) and the 10 ms CPU limit **fail hard** once exceeded. |
| D6 | A new ADR is required | ADR-0018, "R2 edge media delivery", amending ADR-0017's "No public product CDN" and adding Cloudflare Workers to the hosting stack. | `AGENTS.md`: the stack is locked unless an ADR changes it. |

---

## 1. Inventory and classification (hosted staging, 2026-10-18)

Hosted staging has **164 migrations, up to `20261017134139`**. PR #88 (`20261017160000/1`), `20261018090000/1` and the four R2 migrations (`20261018100000`–`100003`) are **not applied**. The `business-verification-documents` bucket therefore does not exist on staging yet, and neither do `media_storage_locations` or the ledger.

| Bucket / namespace | Objects | Bytes | MIME | Referenced by | Who can read today (RC2 + PR #89) | Class |
|---|---|---|---|---|---|---|
| `professional-portfolio` / `portfolio` | 162 (146 ready+public, 16 ready+private; 4 pending rows have no object; 0 orphans) | **256.8 MB** (public 242.2 MB, avg 1.66 MB; max 4.98 MB) | 157 JPEG, 5 PNG | `portfolio_items.object_key` | The owner, while the item is not deleted. **Anyone, including anon**, when `app.is_published_portfolio_object`: the item is ready, visibility is public, and the owner is in `profile_public_directory` (listed, `users.status='active'`, not deleted, a professional persona). Anon access goes through `/p/media/<itemId>` → `public_portfolio_media_key`; the owner's own access goes through `/api/media/portfolio`. | **CONDITIONAL.** Unpublishing, delisting, **suspending** or deleting must withdraw it. Product rule and tests: **immediately**. |
| `avatars` / `avatar` | 143 (143 ready and current; 3 deleted rows; 1 pending) | 8.36 MB (avg 57 KB, max 145 KB) | JPEG (512 px crop) | `avatar_uploads`, `profiles.avatar_media_id` | The owner. **Any caller** for the *current* avatar (`app.is_current_avatar_object`, granted to anon; it does **not** check user status). The app route `/api/media/avatar` additionally requires a signed-in user. Today the UI renders avatars only in the owner's settings. | **CONDITIONAL.** Replacing or deleting must withdraw it. Recommendation: public only while the owner is listed and active, matching the directory. Otherwise authenticated-only. |
| `professional-certificates` / `certificate` | 4 | 7.94 MB | 4 JPEG | `professional_certificates.object_path` | Owner only (key `<owner>/<uuid>`) | **PRIVATE** |
| `product-images` / `product` | 0 | 0 | — | `product_images`, `products.primary_image_key` | Authenticated and active only. Org members, or a published product plus `product_image_viewable(product, workspace)` (workspace/persona audience). Offers re-use it (`signOfferImages`). | **PRIVATE** (audience-restricted; D2) |
| `organization-images` / `organization` | 0 | 0 | — | `organization_images`, `organizations.logo_media_id` | Active **org members** only (current logo) | **PRIVATE** (D2) |
| `business-verification-documents` (PR #88) | not on staging | — | PDF/JPEG/PNG/WebP, 10 MB | `business_verification_documents` | `app.can_read_bv_object`: org.manage holders, or reviewers (`organizations.verify` / `verification.approve`) for ready docs | **PRIVATE.** Stays in its own Supabase bucket (§7). |
| `purchase-request-images` | 0 | 0 | — | `purchase_request_images`, `request_image_grants` | Requester side, plus workspaces granted via `request_image_access_grant` (300 s caller-signed URLs) | **PRIVATE.** Out of scope per ADR-0017. |
| `verification_documents` (legacy table) | 0 rows, no bucket | — | — | — | — | n/a |
| Chat media | no bucket or table | — | — | — | — | n/a |

**Total to migrate: 309 objects, 273.1 MB** (decimal), all JPEG/PNG. No current namespace is unconditionally PUBLIC under today's product rules. "Public images" in practice means **CONDITIONAL** media: published portfolio items and listed avatars.

### What PR #89 already provides (reuse, do not rebuild)
- `media_storage_locations`: per-object provider identity, owner and org, size, sha256, `verified_at` and `cleaned_at`. The provider is immutable after reservation.
- `media_storage_resolve` / `organization_media_resolve` / `organization_media_read_keys`: the single authorization source for reads, uploads and deletes. They are caller-scoped and use `auth.uid()`.
- `media_storage_attest` and the `require_verified_media` triggers: pending→ready requires a verified receipt less than 10 minutes old.
- `media_migration_inventory`, `_switch`, `_rollback`, `media_migration_ledger`, `media_source_inventory_summary`, `media_cleanup_*`, and `media_storage_metrics`.
- `scripts/media-storage.mjs`: dry-run by default, restartable (cursor), single-write (`IfNoneMatch:*`), sha256 and size verification. It never deletes Supabase sources.
- `delivery.ts` / `MEDIA_NO_STORE`: an application proxy that re-resolves before and after fetching, bounds the stream, and adds no-store, `nosniff` and CSP sandbox headers.
- `r2-provider.ts`: refuses a public bucket for every revocable namespace. Uploads go to `pending/<ns>/<key>`, and final objects are written from the verified bytes.
- `public-image-variants.ts`: sharp WebP at 320, 768 and 1280 px, not yet wired in.
- The restrictive `revocable_media_backend_reads` policy on the five buckets. It excludes the PR #88 bucket by design.

### Measured egress problem (from `supabase-usage-audit.md`, re-checked today)
- The cycle so far is **4.71/5 GB** (owner-reported). 4.50 GB came from one burst of portfolio originals on 10-01: 2,195 GETs, each with a fresh token, so every one was a cache MISS. The post-burst baseline averages about 46 MB/day.
- **Last 24 h (queried today): Storage 2.6 MB, Auth 1.2 MB (2,515 requests), REST 0.24 MB.** Headroom is therefore still about **0.28–0.29 GB**.
- On the PR #89 branch, every image is an app URL (`/api/media/...`, `/p/media/...`) served with **no-store**. Every render therefore re-streams the full original through Vercel, plus `getUser` and 2–3 RPCs per image. That moves the cost to Vercel and Auth logs; it does not remove it.

---

## 2. Target architecture (component boundaries)

```
Browser ──(HTML/RSC)──> Vercel Next.js ──RPC──> Supabase Postgres (authority: identity, tenancy, lifecycle, media metadata)
   │                         │  issues media URLs only after resolve RPC authorizes
   │                         └─ verification + variants (sharp) ─> R2 private bucket (S3 API)
   │
   └──(img GET)──> media.<domain>  Cloudflare Worker "media-edge"
                      ├─ /c/...  CONDITIONAL (anon ok): per-request eligibility check ─┐
                      ├─ /m/...  PRIVATE: HMAC ticket + per-request authorization ────┤── Hyperdrive ─> Postgres
                      │          (viewer, workspace, session, active)                  ┘   (role media_edge, EXECUTE on 1–2 functions)
                      ├─ bytes from R2 private binding (+ Workers Cache API for bytes only, never for decisions)
                      └─ /p/...  PUBLIC (Mode B, only for owner-approved PUBLIC classes): R2 public bucket custom domain + CDN
```

Rules that hold in every mode:
1. **Postgres stays the only authority.** The Worker never copies authorization logic. It calls one SECURITY DEFINER function that evaluates the existing resolvers as the viewer.
2. **No browser ever receives a durable provider credential.** The Worker hostname replaces `/api/media` and `/p/media` for R2-provider rows. Supabase-provider rows (legacy, or not yet migrated) keep using `delivery.ts` until they are migrated.
3. **The application proxy stays as fallback.** A feature flag `MEDIA_EDGE_ENABLED` (default false) picks Worker URLs or app URLs when rendering. Rolling back means flipping the flag; no data changes.
4. **PR #88 business-verification documents are untouched** (§7).

---

## 3. Delivery modes

### Mode C: Worker-gated conditional media (recommended for published portfolio and listed avatars)
- URL: `https://media.<domain>/c/portfolio/<itemId>/<variant>.webp`, and `/c/avatar/<profileId>/<variant>.webp`. These are the same opaque identifiers the public pages already expose. No object key and no `users.id` appear (the `17_public_directory_hardening` rule).
- Per request:
  1. The Worker calls `media_edge_public(ns, id, variant)` via Hyperdrive. It returns `{key, sha256, contentType}` only when `is_published_portfolio_object` or the listed-and-active avatar rule holds.
  2. If it returns nothing, the Worker answers **404 with no-store**.
  3. Otherwise it serves the bytes. It tries `caches.default` first (cache key = the internal R2 key plus sha256, never the public URL), then the R2 binding `v/<ns>/<key>/<variant>.webp`.
- Response headers: `Cache-Control: private, no-cache` and a strong `ETag` (sha256 plus variant). The browser revalidates every view: a 304 sends no bytes but still runs the eligibility check. Also `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, `Referrer-Policy: no-referrer`, and `Cross-Origin-Resource-Policy: cross-origin`.
- **Revocation bound: 0 s for every subsequent request** (read-committed DB check). Already-downloaded copies and in-flight responses cannot be recalled. This preserves the existing "immediately" tests unchanged.
- Hyperdrive **query caching must be disabled** on this config. Hyperdrive caches SELECT results by default, which would add up to 60 s of staleness.

### Mode P: private media through the Worker (certificates, owner previews, products, logos)
- The app authorizes exactly as today (`readMediaUrl`, `organization_media_read_keys`). It then mints a ticket: `t = base64url({ns, k: key, var, v: viewer uid, w: workspace|null, sid: JWT session_id, exp: now+120, kid}) + "." + HMAC-SHA256`. URL: `https://media.<domain>/m/<ns>/<opaque>?t=...`.
- In the Worker:
  1. Verify the HMAC with the `kid` key (a Worker secret, rotated quarterly with a two-key overlap). Check `exp` and the namespace/variant allow-list.
  2. Call **`media_edge_authorize(ns, key, viewer, workspace, sid)`** via Hyperdrive. The function:
     - sets the claims locally (`set_config('request.jwt.claims', {sub, role:'authenticated', session_id}, true)`);
     - calls the existing `media_storage_resolve` / `organization_media_resolve` with operation `read`;
     - **additionally** requires `app.account_is_active(viewer)` (the owner-read branch of `media_storage_resolve` does not check it today) and that `auth.sessions` row `sid` exists and is not expired. Sign-out with global scope therefore cuts access.
  3. Stream from the R2 private binding with `Cache-Control: private, no-store` and the `MEDIA_NO_STORE` header set.
- **Revocation bound: 0 s for subsequent requests.** This covers delete, unpublish, audience change, membership suspension, account suspension and session revocation; each is re-checked on every request. Ticket TTL (120 s) only bounds replay by someone holding a copied URL *while the viewer is still authorized*. That is the same exposure as today's 30–300 s signed URLs, and smaller than the Supabase 300 s request-image URLs.
- Avoid re-minting on every render. Tickets are deterministic per 60 s bucket of `exp` (exp rounded up), so a `router.refresh()` within a minute produces identical URLs. Owner previews may then use `private, max-age=60`; certificates keep `no-store`.

### Comparison of revocation sources (for Mode P)

| Option | "Deleted or revoked PRIVATE media is denied on subsequent requests" | Bound | Cost/complexity | Verdict |
|---|---|---|---|---|
| Short-TTL HMAC token only | No: valid until `exp`. Suspension is not seen. | TTL (60–300 s) | Lowest | Not acceptable alone |
| Token + Workers KV deny-list | No: KV writes take **up to 60 s** to reach other locations, plus `cacheTtl` (min 30 s). It also needs a push pipeline from Postgres that can miss events. | ≈ min(TTL, 60–90 s) | Medium; duplicates revocation logic | Rejected |
| Token + Durable Object deny-list | Yes once pushed (strongly consistent), but revocation depends on an outbox push that is not atomic with the Postgres commit, and the DO duplicates authority. | Push lag (s), worst case TTL | High | Rejected |
| **Token + per-request Postgres authorization via Hyperdrive** | **Yes**: the same resolvers, same transaction semantics | **0 s** (in-flight streams excepted) | One indexed SECURITY DEFINER call per image (~1–3 ms DB, plus a round trip to the DB region). Free plan: 100k queries/day; Paid: unlimited. A few hundred bytes of pooler egress per call. | **Recommended** |
| Same, via a PostgREST RPC with a service secret | Yes | 0 s | Adds one Supabase `edge_logs` row per image, which worsens log ingestion | Fallback if Hyperdrive or the new DB role is not approved |
| Keep the application proxy (`delivery.ts`) | Yes | 0 s | Bytes go through Vercel (bandwidth plus function time); `getUser` per image fills Auth logs | Temporary fallback, and permanent for Supabase-provider rows |

**Where suspension cuts access:**
- Account suspension (`users.status`) applies through `app.account_is_active` in `media_edge_authorize`, `organization_media_resolve` and `has_capability`.
- Public withdrawal follows from `profile_public_directory` requiring `u.status='active'`.
- Membership or organization suspension applies through `is_org_member` / `has_capability`.
- In the app, middleware `my_account_status` stops new pages from rendering, so no new tickets are minted.

All of these are DB checks evaluated on each Worker request.

### Mode B: public R2 bucket plus CDN (only for classes the owner declares PUBLIC; optional later for portfolio, D1)
- Bucket `aladdin-media-public`, on the custom domain `pub.media.<domain>` (no `r2.dev`, which is rate-limited and not for production).
- It holds **only derived variants**, never originals, with EXIF stripped (sharp drops metadata; `rotate()` applies orientation first).
- Key: `p/<ns>/<token>/<variant>.<webp|avif>`, where `token = base32(HMAC(secret, ns|key|sha256|publication_epoch))[0:26]`. It is unguessable and **versioned per publication epoch**, so republishing never reuses a purged URL and cached 404s cannot hide it.
- Object `Cache-Control: public, max-age=300` (browser). A Cache Rule sets Edge TTL to 30 days, ignoring origin, and must match the `PURGE` method too. Smart Tiered Cache is on.
- Publish and withdraw are driven by a DB outbox: `media_public_events`, written by triggers on `portfolio_items` visibility/state, `profiles.public_profile_status`, `users.status`, `profiles.avatar_media_id` and deletes.
  - A Worker Cron (every 1 min), plus a fast-path call from the server action after commit, copies variants from private to public (inside Cloudflare, so no egress) on publish.
  - On withdraw it **deletes the objects, then purges by URL**. Instant Purge propagates in seconds. Free-plan limit: 800 URLs/s, 100 per request. It then verifies `CF-Cache-Status != HIT`.
- **Withdrawal bound:** about 1–2 s on the fast path, ≤ 60 s on the cron backstop, plus purge propagation (seconds), plus **browser TTL ≤ 300 s**. Downloaded or scraped copies can never be recalled. This changes the product contract, so it needs D1, an ADR, and an update to `public_media_exposure_test.mjs` §D to a bounded poll.
- Hosted steps the owner must approve: a Cloudflare zone, R2 buckets, the custom domain, a Cache Rule, an API token scoped to `Zone.Cache Purge` for that zone only, and R2 tokens per bucket.

---

## 4. Thumbnails and optimization
- **Client side, before upload** (portfolio and certificate images; avatars and logos are already cropped to 512/640 px):
  - Reuse the `lib/media/crop-image.ts` canvas path without a crop: long edge ≤ 2560 px, JPEG q0.88 or WebP q0.85, aiming for ≤ 1 MB.
  - Keep the 5 MB policy as the hard limit. PDFs are untouched.
  - This cuts upload time, storage, and verification CPU.
  - The bytes the client uploads become the retained **original**. If the owner wants camera originals kept untouched, skip the resize; storage cost is negligible either way.
- **Server side, after verification** (`verifyPendingMedia`, inside the same `withMediaProcessingSlot`): generate `thumb` 320, `card` 768 and `full` 1600 WebP at q80 from the *verified* bytes. Write them to `v/<ns>/<key>/<variant>.webp` in the private bucket with `IfNoneMatch:*`, and record `variants` (jsonb: variant → bytes/sha256/w/h) on `media_storage_locations`.
  - AVIF is deferred: sharp AVIF encoding takes roughly 5–10× the CPU on Vercel functions, and WebP is enough.
  - Limits: `limitInputPixels` 25 MP (already there), at most 2 concurrent decodes per instance (already there), and variant output ≤ 600 KB with a quality step-down.
- **Existing media:** a backfill job generates variants from the **R2 copies** after migration, so there is no Supabase egress.
- **Rendering:**
  - Grids use `thumb` or `card` with `srcset`/`sizes`; the lightbox uses `full`; the original goes only to an explicit "download original" (owner).
  - Plain `<img loading="lazy" decoding="async">` with width and height set.
  - Never use `next/image` for media. The optimizer is already locked out by `localPatterns`, and the regression test `media-image-cache.test.ts` must be extended to the media hostname.
- **No re-minting per render:** Mode C URLs are stable. Mode P tickets are bucketed to 60 s. Remove the per-item `createAssetReadUrl` server-action calls in `portfolio-manager.tsx`; batch them in the list query instead.

---

## 5. Bulk migration plan

**Pipeline** (all of these exist in PR #89; additions are marked ✚):

1. **Apply migrations** to staging (owner approval): PR #88, `20261018090000/1`, `20261018100000`–`100003`, and the new WP1 migration. Run the permission gate first.
2. **Inventory**: `node scripts/media-storage.mjs --project kkpkgjrweysgvhvkhzun` (dry-run) → `media_source_inventory_summary` (orphans and missing references; staging has 0 orphans today).
   - ✚ Print a `bytesToCopy` estimate from `storage.objects.metadata.size`.
3. **Copy**, one row at a time:
   - signed GET from Supabase (egress) → `verifyMediaBytes` (decode, sha256) → `PutObject IfNoneMatch:*` to `R2_PRIVATE_BUCKET/<ns>/<key>`;
   - read back from R2 (free) → compare size and sha256 → `media_migration_switch` (row-locked, stale-snapshot checks, ledger).
   - ✚ `--max-source-bytes <N>` stops the run before exceeding a byte budget. ✚ `--namespace <ns>` orders cheap namespaces first.
   - ✚ Write a JSONL run journal (namespace, key hash, size, sha256, result) to a local file, without keys or URLs in clear.
4. **Resume:** `--after <nextCursor>`. R2 rows are skipped, and `IfNoneMatch` makes a re-copy a no-op. A crash mid-row leaves the R2 object without a switch, and the next run verifies it again.
5. **Variants backfill** ✚ from R2 originals (no Supabase egress).
6. **Switch reads:** rows with `provider='r2'` render Worker URLs when `MEDIA_EDGE_ENABLED`; otherwise app URLs (still R2 via `delivery.ts`).
7. **Retain sources:** the tool never deletes Supabase objects. Delete sources only after ≥ 30 days, a full R2 re-hash against the ledger (free), and separate owner approval.
8. **Rollback:** `--rollback` → `media_migration_rollback` flips the provider back to `supabase` for ledger rows. The sources are intact and the R2 copies are kept for a later retry. `MEDIA_EDGE_ENABLED=false` instantly returns rendering to the app proxy.

**Egress math (decimal GB):**

| | Value |
|---|---|
| Remaining Supabase egress this cycle | 5 − 4.71 = **0.29 GB** (owner-reported). The last 24 h used about 4 MB. |
| Bytes needed: avatars + certificates | 8.36 + 7.94 = **0.016 GB** (147 objects) |
| Bytes needed: portfolio | **0.257 GB** (162 objects; avg 1.59 MB) |
| Total | **0.273 GB = 94% of the remaining headroom** |
| Headroom left after a full copy | about 17 MB, about 4 days at today's baseline. One portfolio browsing day (135–195 MB measured) would push the project over → **HTTP 402 on every API call = outage**. |

**Recommendation:**
- **(a)** Now, optionally: rehearse with avatars and certificates only (`--max-source-bytes 20000000`), using 5.5% of the headroom.
- **(b)** Copy the portfolio **after the cycle resets** (inferred around Nov 1, since the cycle began just before the Oct 1 burst; confirm on the Billing page) or **immediately after upgrading to Pro** (250 GB). At reset the full copy is 5.5% of 5 GB.
- Batch size 25 rows, about 40 MB per portfolio batch, giving 7 portfolio batches and 7 small ones: about 14 runs, which fit in one session. Stop rule: abort if Supabase storage egress for the day exceeds 400 MB.
- Before copying, set `R2_STORAGE_ENABLED=true` on staging so new uploads stop landing in Supabase. Also ship the no-re-mint fix so the baseline does not consume the headroom.

---

## 6. Costs: before and after

Assumptions: current traffic as measured (§1). A "scale" case of 10k MAU × 200 image views a month = 2M views, with an average variant of 150 KB, so 300 GB of image bytes a month. Prices were checked on 2026-10-18 in Cloudflare docs (R2 pricing updated Oct 1, 2026; Workers, KV and Hyperdrive pricing). **Vercel prices are to be verified**: Hobby includes 100 GB Fast Data Transfer, Pro 1 TB, with overage about $0.15/GB depending on region.

| Item | Before (main: Supabase signed URLs) | PR #89 as-is (app proxy) | After (Worker Modes C/P) |
|---|---|---|---|
| Supabase egress / month, current traffic | Measured **≈1.4 GB** baseline plus bursts (4.5 GB on 10-01); 4.71 GB cycle-to-date | Same until migrated (the proxy fetches from Supabase for supabase rows); after migration ≈ Auth+REST only | **≈0.05–0.15 GB** (Auth+REST 1.5–5 MB/day) + Hyperdrive auth bytes (~0.5 KB × requests ≈ 50 MB per 100k) + BV docs + request images. One-off migration **0.273 GB**. |
| Supabase egress at scale (300 GB) | 300 GB → requires Pro: $25 + 50 GB × $0.09 = **$29.50** | 0 after migration | **≈0.3–1 GB** → stays inside Free or Pro |
| Vercel bandwidth | ~0 (bytes go browser↔Supabase) | **All image bytes**: ≈1.4 GB/mo now (fine on Hobby); **300 GB at scale** plus one function invocation and 2–3 RPCs per image | **0 image bytes** (HTML/RSC only) |
| R2 storage | — | 0.27 GB | 0.27 GB originals + about 0.1 GB variants → **$0** (10 GB-month free) |
| R2 Class A | — | uploads | ~309 copies + ~930 variant writes + uploads ≪ 1M → **$0** |
| R2 Class B | — | 1 per proxied view | ≤ 1 per view not served from the Worker cache; scale ≤ 2M ≪ 10M free → **$0** |
| Workers | — | — | Now: well under 100k/day (Free). Scale: 2M requests/mo, within Paid's included 10M → **$5/mo** (recommended for production; D5) |
| Hyperdrive | — | — | Free: 100k queries/day; Paid: unlimited → included |
| CDN / zone | — | — | Free zone plan $0. A new domain costs about $10–15/yr (to verify). |
| **Monthly headline** | **$0 now with cap risk; ~$30 at scale** | **$0 now, but Vercel-bound; ~$20–45 Vercel overage at scale (to verify)** | **$0–5 now; ~$5 at scale**, plus optional Supabase Pro ($25) for production reliability, no longer driven by egress |

Logs: moving image bytes to the Worker also removes `getUser` and 2–3 RPCs per image from `/api/media` (each currently an `auth_logs` and `edge_logs` row). §8 removes the rest.

---

## 7. Remaining Supabase Storage dependencies after the switch
1. **`business-verification-documents` (PR #88), unchanged by contract.**
   - It keeps its private Supabase bucket, `bv_documents_*` policies, caller-signed 30 s URL and the `/business-verification/file/<org>/<file>` streaming route. It is low volume (≤ 10 MB per document, reviewer views only).
   - **Verified compatible with PR #89:**
     - `revocable_media_backend_reads` lists only the five revocable buckets, so the BV `SELECT` policy still applies.
     - `media_metadata`, the inventory, the migration and cleanup functions, the `buckets` map in `scripts/media-storage.mjs` and the `MediaNamespace` type do not include BV.
     - The migration-100003 check asserts exactly the five revocable buckets and ignores BV.
   - Not changing: the route has no size bound or fetch timeout. I note it as a separate PR #88 follow-up, not part of this work.
2. **`purchase-request-images`**: independent grant model, caller-signed 300 s URLs direct from Supabase (0 objects now). Candidate for a later move to Mode P with an explicit ADR (ADR-0017 excludes it).
3. **Legacy Supabase sources** of the five namespaces: kept ≥ 30 days as the rollback source. Any `provider='supabase'` row continues through `delivery.ts`. The Supabase upload branch in `browser-upload.ts` stays reachable while `R2_STORAGE_ENABLED=false`.
4. **Supabase Storage policies and buckets** (INSERT policies, the restrictive SELECT policy): retained.
5. **Metadata and authority** (`media_storage_locations`, source tables, resolvers, Auth): stays in Supabase by design (ADR-0017).

---

## 8. Auth and log request reduction (suspension stays enforced)

Code paths:
- `frontend/src/middleware.ts:46` calls `supabase.auth.getUser()` on every non-static request. Line 71 calls `rpc('my_account_status')` on product surfaces.
- `server/auth/session.ts:8` has an uncached `getCurrentUser()`.
- There are 49 `auth.getUser()` call sites.
- `app/api/media/[namespace]/route.ts:19` calls `getUser` once per image.
- JWTs are ES256 with a `kid`; `jwt_expiry` is 3600.

1. **Middleware → `auth.getClaims()`.**
   - It verifies locally against the cached JWKS and still refreshes an expired session through the same cookie adapter.
   - **Keep the `my_account_status` RPC** on product surfaces. Suspension authority is the DB, not Auth.
   - Skip both calls for RSC prefetches (the `next-router-prefetch` or `purpose: prefetch` header) and for `/api/media`, `/p/media` and the media host. Add those paths to the matcher exclusions.
2. **Request-scoped identity:**
   - `getCurrentUser = cache(...)` built on `getClaims()` returns `{id, sessionId, exp}`.
   - Add `requireFreshUser()` (cached `getUser()`) **only** for routes where server-side session revocation must be seen before JWT expiry: `/admin/**` layouts and actions, password/email change, session management, and business-verification review actions.
   - Replace the 49 call sites mechanically: read-only identity → `getCurrentUser`; the security-sensitive list → `requireFreshUser`.
3. **Why security is not weakened:**
   - RLS and every RPC still use `auth.uid()` from a signature-verified JWT. PostgREST already accepted a revoked-session JWT until `exp` before this change, so middleware `getUser` never protected data.
   - Suspension is enforced in the DB:
     - `app.account_is_active` / `has_capability` / `is_org_member` refuse suspended users;
     - the PostgREST `db_pre_request` hook refuses them on staging. **Note:** per `ARCHITECTURE_GUIDE.md` the hook is **disabled in Production**. Re-enabling it is a separate, owner-tracked item and the strongest guard;
     - the middleware `my_account_status` redirect remains.
   - The Worker checks `account_is_active` and `auth.sessions` on every private request.
   - The residual change: a globally signed-out session can still *navigate* non-admin pages for at most `jwt_expiry` (≤ 1 h). Optional hosted change: lower `jwt_expiry` to 900–1800 s (more refresh calls, still far fewer than today).
4. Expected effect (from the audit): about 90% fewer `auth_logs` rows and 30–45% fewer `edge_logs` rows. The media move removes the per-image `getUser` calls on top of that.

---

## 9. Monitoring and alerting

| Signal | Source | Alert |
|---|---|---|
| Supabase egress (cycle-to-date, daily by service) | Scheduled `edge_logs` sum query (as in the audit) + dashboard; Supabase usage emails | 60/80/90% of quota; any day > 300 MB storage egress |
| Log ingestion / day; `auth_logs` rows / day | Logs Explorer query | > 60% of the 1 GB monthly pace; `/auth/v1/user` > 1k/day after §8 |
| Media authority health | `media_storage_metrics()` (providers, stale pending) | stale_pending > 0 for 24 h; supabase-provider count rising after cutover |
| Migration integrity | ledger vs R2 re-hash job (weekly, free) | any mismatch |
| Worker | Workers analytics / Observability: requests, 4xx/5xx split, CPU p99, Hyperdrive errors | 5xx > 1% for 5 min; token-verify failures > 50/min (abuse); CPU p99 > 8 ms on Free |
| Free-plan hard limits | Workers req/day, Hyperdrive queries/day | > 70% of 100k/day (upgrade before failures) |
| R2 | R2 metrics: storage, Class A/B ops; Cloudflare billing notifications | Class B > 5M/month; storage > 8 GB |
| Mode B only | outbox age, purge API failures, post-purge HIT probe | oldest pending withdrawal > 2 min; any purge failure |
| Withdrawal canary | Scheduled staging probe: publish → fetch 200 → unpublish → fetch 404 (Mode C: immediate) | any 200 after unpublish |
| Vercel | Spend Management + Fast Data Transfer usage | > 50% of included; any image route bytes after cutover |

---

## 10. Implementation work packages (parallel-safe file ownership)

| WP | Scope | Files owned (only this WP edits them) | Tests to write | Depends |
|---|---|---|---|---|
| **WP0 Decisions/docs** | ADR-0018, classification table, D1–D6 outcomes, memory updates | `docs/decisions/ADR-0018-r2-edge-media-delivery.md` (new), `docs/decisions/DECISION_LOG.md`, `docs/architecture/ARCHITECTURE_GUIDE.md`, `docs/product/PRODUCT_DIRECTION_GUIDE.md`, `docs/database/professional-asset-storage.md`, `docs/operations/AGENT_WORK_LOG.md`, `docs/operations/RUNTIME_STATE.md` | — | owner decisions |
| **WP1 DB edge authorization** | `media_edge_authorize` (viewer, workspace, sid, active, session) + `media_edge_public` (portfolio item / avatar profile → key, sha256, variants); `variants jsonb` on `media_storage_locations`; `media_edge` role grants (EXECUTE only; created by a hosted step); permission contract | `supabase/migrations/20261019100000_media_edge_authorization.sql` (new), `supabase/permissions/20261019100000.json` (new), `supabase/tests/97_media_edge_authorization_test.sql` (new) | pgTAP: owner/foreign/anon; unpublish, delist, suspend user, suspend membership, delete → null immediately; revoked session → null; claims do not leak past the call; no anon/PUBLIC EXECUTE; workspace audience parity with `organization_media_resolve` | WP0 |
| **WP2 Variants pipeline** | Generate thumb/card/full in `verifyPendingMedia`; write `v/<ns>/<key>/<variant>.webp`; record variants; backfill CLI | `frontend/src/server/storage/public-image-variants.ts`, `frontend/src/server/storage/media.ts` (verify section only), `frontend/src/server/storage/r2-provider.ts` (add `putVariant`), `scripts/media-variants.mjs` (new) + tests beside each | Unit: sizes, EXIF stripped, quality step-down ≤ 600 KB, idempotent `IfNoneMatch`, CPU slot respected; live R2 test gated like `r2.live.test.ts` | WP1 (column) |
| **WP3 Media edge Worker** | Worker: `/c` and `/m` routes, HMAC verify (kid rotation), Hyperdrive calls (caching off), R2 binding, Cache API for bytes, headers, 404 uniformity | `edge/media-worker/**` (new: `src/index.ts`, `wrangler.jsonc`, `package.json`, tests), `pnpm-workspace.yaml` (add package) | vitest with `@cloudflare/vitest-pool-workers` (dependency to justify): bad/expired/forged ticket, kid rotation, DB-deny → 404 no-store, ETag/304 path still authorizes, no upstream header leak, range/size bounds | WP1 |
| **WP4 App ticket issuance + URL switch** | `mediaEdgeUrl()` / ticket minting (server-only, 60 s bucketed exp); `MEDIA_EDGE_ENABLED` flag; render Worker URLs for r2 rows, app URLs otherwise; variant-aware URLs | `frontend/src/lib/storage/media-url.ts`, `frontend/src/server/storage/edge-ticket.ts` (new), `frontend/src/lib/env/storage.ts`, `frontend/src/server/queries/{product-images,organization-image,profile-identity,portfolio,offers}.ts`, `frontend/src/server/actions/professional-assets.ts` | Unit: ticket fields/HMAC match the Worker test vectors; flag off → identical URLs to today; no key/users.id in public URLs (extend `public_media_exposure_test.mjs` §B) | WP3 (shared test vectors) |
| **WP5 Rendering** | `srcset` variants, lazy loading, stop per-item re-sign in the portfolio manager, ProductMedia sizes | `frontend/src/features/portfolio/{portfolio-manager,media-frame,hub-modules,certificates-manager}.tsx`, `frontend/src/features/profile/public-portfolio.tsx`, `frontend/src/features/settings/avatar-field.tsx`, `frontend/src/features/offers/offer-parts.tsx`, `frontend/src/lib/storage/media-image-cache.test.ts` | RTL: srcset/sizes present, `loading="lazy"`, no re-mint on rerender (spy), optimizer still refuses the media host | WP4 (URL shape) |
| **WP6 Client pre-resize** | Downscale portfolio/certificate images before upload | `frontend/src/features/portfolio/upload.ts`, `frontend/src/lib/media/resize-image.ts` (new, beside `crop-image.ts`) | Unit (canvas mocked): long edge ≤ 2560, type kept/converted, PDF untouched, falls back to the original when the resize is larger | none |
| **WP7 Migration tooling hardening** | `--max-source-bytes`, `--namespace`, byte estimate, JSONL journal, re-hash verify mode | `scripts/media-storage.mjs`, `scripts/media-storage.test.mjs` (or existing test file) | Budget stop before exceeding; resume after a mid-row crash; checksum mismatch → no switch; rollback only ledger rows; never deletes Supabase | none |
| **WP8 Auth/log reduction** | `getClaims` middleware, prefetch skip, matcher exclusions, cached `getCurrentUser`/`requireFreshUser`, call-site sweep | `frontend/src/middleware.ts`, `frontend/src/server/auth/session.ts`, the 49 call sites (sweep in one PR; coordinate with WP4/WP5 by rebasing; disjoint lines) | Middleware: expired token refresh path, suspended → `/auth/suspended`, prefetch skips RPC; `requireFreshUser` on admin rejects a revoked session | none |
| **WP9 Monitoring** | Scheduled usage queries, Worker alerts, canary probe | `scripts/usage-report.mjs` (new), `supabase/tests/public_media_exposure_test.mjs` (canary mode), `docs/operations/media-monitoring.md` (new, if WP0 approves) | Canary passes locally against the dev stack | WP3 |
| **WP10 (optional, D1) Mode B publisher** | Public bucket, epoch tokens, outbox triggers, cron withdraw + purge | `supabase/migrations/…_media_public_outbox.sql`, `edge/media-worker/src/publisher.ts` | Withdrawal ≤ bound, purge verified, republish gets a new URL | D1 = yes |

**Hosted steps that need owner approval** (none have been done):
1. Supabase staging: apply PR #88, `20261018090000/1`, `20261018100000`–`100003` and WP1 migrations, through the permission gate.
2. Create a Postgres login role `media_edge` with EXECUTE only on the two edge functions; store its password only in Hyperdrive.
3. Cloudflare: account; zone for the media domain (D4, full setup on Free); R2 buckets `aladdin-media-private` (plus `-public` only if Mode B); R2 lifecycle rule expiring `pending/` after 2 days; bucket-scoped R2 tokens (app read/write private; migration token time-limited).
4. Workers Paid plan (D5); deploy `media-edge` on `media.<domain>`; secrets (`TICKET_KEYS`); Hyperdrive config with caching **disabled**; R2 binding.
5. Vercel env vars per environment: `MEDIA_EDGE_ENABLED`, `MEDIA_EDGE_ORIGIN`, `MEDIA_TICKET_KEYS`, `R2_*`. Set `R2_STORAGE_ENABLED=true` on staging first; `R2_PRODUCTION_WRITES_APPROVED` stays false until a production go-live.
6. Run the migration (§5) at the chosen time: after the cycle reset or the Pro upgrade (D3).
7. Mode B only: Cache Rule (Edge TTL 30 d, matching GET and PURGE), purge-scoped API token, custom domain on the public bucket.
8. Optional: Supabase Pro; `jwt_expiry` change; re-enabling the Production `db_pre_request` hook (separate ticket).
9. Later (≥ 30 days and after a full re-hash): delete Supabase source objects (separate approval).

---

## Appendix A: Evidence queries (SELECT-only, 2026-10-18)
- `storage.buckets ⋈ storage.objects`: counts, bytes and MIME per bucket (the table in §1).
- `portfolio_items` by state/visibility, with object sizes: ready+public 146 / 242,172,741 B; ready+private 16 / 14,619,110 B; 0 orphan objects.
- `avatar_uploads`: ready 143, deleted 3, pending 1; `profiles.avatar_media_id` set for 143.
- `product_images`, `organization_images`, `purchase_request_images`, `verification_documents`: 0 rows.
- `supabase_migrations.schema_migrations`: 164, max `20261017134139`.
- Logs, last 24 h (`edge_logs`): storage 79 requests / 2.64 MB; auth 2,515 / 1.23 MB; rest 6,354 / 0.24 MB. `auth_logs` had 2,745 rows.

## Appendix B: Sources
Cloudflare docs (accessed via the docs search tool, 2026-10-18): R2 pricing (/r2/pricing, updated Oct 1, 2026); Workers, KV and Hyperdrive pricing (/workers/platform/pricing); KV write propagation "up to 60 seconds" (/kv/api/write-key-value-pairs) and `cacheTtl` minimum 30 s; Instant Purge, single-file purge and purge limits (/cache/how-to/purge-cache); R2 public buckets and r2.dev rate limiting (/r2/buckets/public-buckets, /r2/platform/limits); R2 cache consistency (/r2/reference/consistency); partial CNAME setup Business+ (/dns/zone-setups/partial-setup). Vercel bandwidth figures came from secondary sources (e.g. makerkit.dev/blog/md/tutorials/vercel-cost, schematichq.com/blog/vercel-pricing): **to verify on vercel.com/pricing**. Supabase plan figures are from `supabase-usage-audit.md`.
