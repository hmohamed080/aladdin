# Supabase usage audit: aladdin-staging (`kkpkgjrweysgvhvkhzun`)

Date: 2026-10-18. Read-only audit: log queries, SELECT-only SQL and advisors. No repository file, hosted setting, billing setting or deployment was changed.
Owner-reported usage on the Free plan: Egress 4.71/5 GB · Log ingestion 0.89/1 GB · DB 58/500 MB · Storage 0.14/1 GB · MAU 541/50k.

## Verdict (ranked)

1. **Egress comes from portfolio photos, and one event caused most of it.** On **2026-10-01, from 18:10 to 20:40 UTC**, browsers downloaded **4.50 GB** of `professional-portfolio` originals: 2,195 GETs of 64 objects from 10 client IPs. Every GET used a **new signed-URL token**, so every one was a CDN **MISS**. Measured share of edge egress since Oct 1: **about 86%**.
2. **The steady baseline is also mostly portfolio originals: about 20–200 MB per day (average about 46 MB).** Uploads are not resized: the average object is 1.5 MB and the largest is 4.9 MB. The owner's portfolio manager (`/home/profile/portfolio`) re-signs every item on every render and on every `router.refresh()`, so the browser re-downloads every full-size photo each time.
3. **Logs: `GET /auth/v1/user` is the largest single source of log rows.** It runs 3–7k times a day, about 30–45% of `edge_logs` rows and about 94% of `auth_logs` rows. In one day, 83 users made 7,343 calls; the heaviest user made 690. The cause is middleware `auth.getUser()` on every non-static request, plus 47 more `auth.getUser()` call sites in server code, with no per-request dedupe. Next is `rpc/my_account_status`, which middleware calls on every product-surface request.
4. Auth, REST and Realtime egress is small: about 1–4 MB/day of Auth and about 0.1–0.3 MB/day of PostgREST. Realtime egress is negligible. DB size and storage size are not at risk.

## Measured evidence

Source: `edge_logs`, summing `response.headers.content_length` per 24 h window (08:00–08:00 UTC). These bytes are uncompressed response lengths, an approximation of billed egress.

| Day (start) | Storage | Auth | REST | Notes |
|---|---|---|---|---|
| 09-25 | 0 | 14 KB | 1 KB | pre-launch |
| 09-28 / 09-29 | 0.4 MB | ~0.3 MB | ~0.1 MB | |
| 09-30 | 83.6 MB | | | |
| **10-01** | **4,500 MB** | 5 KB | 0.25 MB | portfolio burst |
| 10-02 … 10-17 | 0.6–195 MB/day | 0.6–3.7 MB/day | 0.1–0.3 MB/day | 10-04: 195 MB, 10-11: 175 MB, 10-03: 135 MB |

- Measured total from 10-01 to 10-18 is about **5.2 GB (decimal), about 4.9 GiB**. That agrees with the dashboard's 4.71 GB. Inferred: the billing cycle began just before the Oct 1 burst.
- On the burst day, all 2,195 GETs were `cf_cache_status = MISS`, with 2,195 distinct tokens. Each GET followed about 2 server-side `POST /storage/v1/object/sign/...` calls (UA `node`), so the URLs were re-minted on every render.
- On 10-04 and 10-11 the same pattern holds: browser GETs of 10–18 portfolio objects, 68–101 times each, average 1.9–2.6 MB.
- `/p/media/<id>` is the public proxy (server UA `node`). It is almost unused today: 1 GET on 10-11. Every view through it is still `no-store` and streams the full original, so traffic through it will grow with public profiles.
- `storage.objects` by bucket: `professional-portfolio` 162 objects, 245 MB, average 1.5 MB, max 4.9 MB · `avatars` 143 objects, 8 MB, average 57 KB (cropped, fine) · `professional-certificates` 4 objects, 7.8 MB.
- Log rows per day are about 10–34k in `edge_logs` and 2.7–7.8k in `auth_logs`. `postgres_logs`, `pgbouncer`, `supavisor` and `realtime` are each under 300 rows a day. Postgres logs are mostly `checkpoint starting: time`, so log-level noise is not the problem.
- JWTs are **ES256 with a `kid`**: asymmetric signing keys are already on. `auth.getClaims()` can therefore verify locally from the cached JWKS, with no call to Auth.
- `pg_stat_statements`:
  - Realtime WAL polling (`supabase_admin`) ran 376k times. It is internal, not egress. The `supabase_realtime` publication has only `leads` and `follow_up_tasks`.
  - `SELECT name FROM pg_timezone_names` ran 385 times at about 520 ms each (Studio/PostgREST).
  - 56 `pg_dump`-style catalog sweeps by `postgres` and 345 calls by `cli_login_postgres`: CLI `db pull`, `dump` or `gen types` runs. These count as Shared Pooler egress, probably a few MB each (inferred, not measured).
- Realtime: `public.leads` and `follow_up_tasks` are subscribed with branch/org filters (`frontend/src/features/sales/sales-realtime.tsx`). Logs show only a few `realtime_logs` rows a day, so it is negligible.

### Advisors (reported only, nothing fixed)
- Performance:
  - 106 unindexed foreign keys (INFO)
  - 51 unused indexes (INFO)
  - 35 multiple-permissive-policy warnings (`branches` and others)
- Security:
  - 265 `authenticated` SECURITY DEFINER functions callable over RPC (WARN, mostly by design here)
  - 3 callable by `anon`, e.g. `invitation_lookup`
  - 9 functions with a mutable `search_path`, e.g. `app.set_updated_at`
  - 20 tables with RLS enabled but no policy (INFO)
  - Leaked-password protection is off (WARN)
- None of these drives egress. The `search_path` warnings and leaked-password protection are worth a separate ticket.

## Prioritized fixes

Type: (a) safe code change · (b) hosted config change, needs owner approval · (c) billing change, needs owner approval.

| # | Fix | Expected saving | Risk | Reversible | Type |
|---|---|---|---|---|---|
| 1 | **Downscale and re-encode portfolio and certificate images in the browser before upload.** Reuse `lib/media/crop-image.ts`-style canvas output (for example long edge 1600–2048 px, WebP or JPEG q≈0.8, target ≤400 KB) in `features/portfolio/upload.ts`. Optionally also upload a small thumbnail (≈480 px) for grids. | **80–90%** of future portfolio egress and storage per view. Today's 2 MB average would drop to about 250 KB. | Low. Only affects new uploads. Keep the signature and type checks. | Yes (revert commit) | (a) |
| 2 | **Stop re-minting a new signed URL on every render** of `/home/profile/portfolio`. Cache each owner preview URL for most of its 300 s life, keyed by user and object key. Uploads already carry `cacheControl` 3600, so a stable URL lets the browser cache serve repeat views and `router.refresh()`. Also mint fewer signatures: one batched `createSignedUrls` call instead of N `createAssetReadUrl` calls, each of which also calls `getUser`. | Removes the repeat-download multiplier (68–100× per object measured on 10-04 and 10-11). Most of the 20–200 MB/day baseline goes away. | Low. Owner-only previews, cache key includes the user id, TTL stays under the token expiry. | Yes | (a) |
| 3 | **Middleware: use `supabase.auth.getClaims()` instead of `getUser()`.** It verifies the ES256 JWT locally and still refreshes an expired session through the same cookie path. Add a request-scoped `cache()`d `getCurrentUser()` helper for the 47 server call sites. Skip the `my_account_status` RPC on prefetch requests, or carry suspension in a short-lived signed cookie. | Inferred: about 30–45% fewer `edge_logs` rows and about 90% fewer `auth_logs` rows. That is the main lever on the 1 GB log figure, and it also cuts latency. Egress saving is small (about 1–3 MB/day). | Medium. `getClaims` does not see a server-side ban or deletion until the JWT expires (≤1 h default); the RLS and suspension RPC remain the authority. Needs a test of the refresh path. | Yes | (a) |
| 4 | Show grid thumbnails instead of originals (from fix 1), and keep `loading="lazy"` | A further 50–70% on grid views | Low | Yes | (a) |
| 5 | `/p/media` proxy: once images are small, consider a short `private, max-age=60` or an ETag + 304. The current `no-store` is a deliberate privacy decision, so this needs the owner's call. | Repeat public views | Product/privacy trade-off | Yes | (a), needs a decision |
| 6 | Re-encode the existing 162 portfolio originals (245 MB) with a one-off server job | About 200 MB storage and the egress they drive | Medium (touches stored user media) | Only with a backup | (b) |
| 7 | Run CLI `db pull`/`dump`/`gen types` against a local or branch database, not hosted staging | A few MB per run (inferred) | None | Yes | process |
| 8 | Upgrade to Pro ($25/mo): 250 GB egress, Smart CDN, image transformations | Removes the cap risk | Cost | Yes (downgrade) | (c) |

## How much R2 reduces usage

- ADR-0017 is **not in this checkout**. R2 work exists only on the unmerged branch `feature/cloudflare-r2-storage` (`43722a2`, 4 migrations), per `docs/operations/showroom-v2-release-integration-matrix.md`. I could not read its design.
- **Upper bound:** storage is about **94%** of measured edge egress since Oct 1 (about 4.9 of 5.2 GB). Moving portfolio, avatar and certificate media to R2 would remove that from Supabase egress. Supabase egress would then be about 1–5 MB/day of Auth and REST, about 0.1 GB per month.
- **Only if the browser fetches from R2 directly** (presigned R2 URL or an R2 custom domain). A same-origin byte proxy like today's `/p/media` would move the bytes onto **Vercel** bandwidth instead of removing them.
- Cloudflare R2 pricing (from Cloudflare's published pricing, not re-checked today because the Cloudflare MCP failed to connect):
  - $0 egress
  - 10 GB-month storage free, then $0.015/GB-month
  - Class A writes: 1M/month free, then $4.50/M
  - Class B reads: 10M/month free, then $0.36/M
  - At current volume (<1 GB stored, <100k reads/month) that is **$0**.
- R2 does **not** reduce logs. Each R2 read is still minted by an app request, but storage edge-log rows (about 100–250 a day) are a tiny share of log volume.
- **Fixes 1–2 alone recover about 80–95% of the same egress** without a migration. Doing them first also makes any later R2 move smaller.

## Plans, limits and costs (Supabase docs checked 2026-10-18)

| | Free | Pro ($25/mo, includes $10 compute credit) |
|---|---|---|
| Egress (uncached / cached) | 5 GB / 5 GB | 250 GB / 250 GB, then $0.09 / $0.03 per GB |
| Logs ingest | docs: 5 GB (dashboard shows 1 GB; the dashboard governs) | 5 GB, then $0.50/GB |
| Logs query | 1,000 GB | 1,000 GB, then $0.002/GB |
| Smart CDN (caches signed URLs per token) | No | Yes |
| Image transformations | No | 100 origin images, then $5 per 1,000 |
| Spend cap | n/a | On by default |

- Docs say Logs Ingest/Query billing is "being rolled out… enforcement not yet live".
- MAU (Free 50k / Pro 100k), DB (500 MB / 8 GB) and storage (1 GB / 100 GB) are from the Supabase pricing page, as recalled. Please confirm on supabase.com/pricing.
- Sources: [Manage Egress usage](https://supabase.com/docs/guides/platform/manage-your-usage/egress) · [Logs Ingest](https://supabase.com/docs/guides/platform/manage-your-usage/logs-ingest) · [Billing FAQ / Fair Use](https://supabase.com/docs/guides/platform/billing-faq) · [Smart CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn) · [Image transformations usage](https://supabase.com/docs/guides/platform/manage-your-usage/storage-image-transformations)

**Alternatives:**
- Cloudflare R2 for media (above).
- Cloudflare Images or Vercel Image Optimization for resizing. Vercel's has its own quota, and next/image cannot cache short-lived signed URLs safely.
- Self-hosting Supabase moves the ops burden onto the team.
- Pro plus fixes 1–3 is the lowest-effort safe combination.

## Risk of hitting the egress cap

- **Headroom is about 0.29 GB.** The post-burst average is about 46 MB/day, which uses that up in **about 6 days**. A single heavy portfolio day uses it up in about 2 days (10-04: 195 MB, 10-11: 175 MB). Another burst like Oct 1 exceeds the cap within an hour.
- The cycle-reset date is not visible through these tools; it is on the dashboard's Billing page. If it is more than about a week away, **exceeding the cap this cycle is likely** unless fixes 1–2 ship or the plan changes.
- **What happens on Free** (docs): a notification to the billing email and a **grace period**, then Fair Use restrictions:
  - project pause
  - a read-only database
  - **HTTP 402 `exceed_egress_quota` on every API request**, applied to all projects in the org
- Restrictions lift when the quota refills at the next cycle, or immediately on upgrading to Pro.
- After a grace period has been used, a later overage gets **no new grace period** until the account stays under the limits for several cycles.
- For a live app with about 541 MAU, a 402 on Auth and REST is a full outage.

**Recommended order:**
1. Ship fixes 1, 2 and 3 now (code only).
2. Owner decides on Pro before the remaining about 0.29 GB is spent (c).
3. Then decide whether R2 is still worth merging, and run the existing-media re-encode (b).
