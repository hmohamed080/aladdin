# Cloudflare target architecture: cost and scalability at 1k / 10k / 100k DAU (2026-10-22)

**Purpose.** Estimate the monthly infrastructure cost of the target Cloudflare architecture at 1,000, 10,000 and 100,000 daily active users (DAU), compare it with the current Vercel hosting, and name the scaling bottlenecks and security tradeoffs.

**Current decision.** None. This is an input to the owner's decisions on [ADR-0021](../decisions/ADR-0021-cloudflare-workers-frontend.md) (Workers frontend), [ADR-0018](../decisions/ADR-0018-r2-edge-media-delivery.md) (R2 media), [ADR-0019](../decisions/ADR-0019-redis-cache-and-rate-limits.md) (Upstash) and [ADR-0020](../decisions/ADR-0020-video-r2-hls.md) (video). Nothing here is approved or provisioned. Supabase stays on Free until the owner approves Pro.

**Every dollar figure in this document is an estimate.** The usage model below is an assumption, not a measurement of real traffic. Re-check each number against the dashboards (Cloudflare billable usage, Supabase usage, Upstash usage, Vercel usage) once real traffic exists.

**Not included:** OpenAI and Azure Document Intelligence usage, domain registration, email (Resend), taxes, people time, and a Cloudflare zone plan above Free.

## 1. Headline (estimates)

| Monthly total (estimate) | 1,000 DAU | 10,000 DAU | 100,000 DAU |
|---|---|---|---|
| **Target: Cloudflare (Workers + Containers + R2 + Images + Hyperdrive) + Upstash + Supabase + Sentry** | **≈ $38** | **≈ $202** | **≈ $2,026** |
| Same, with image variants made in the container instead of Cloudflare Images (§6) | ≈ $36 | ≈ $160 | ≈ $1,580 |
| **Comparison: Vercel Pro app + FastAPI, with the same Cloudflare media, R2, video container, Upstash, Supabase and Sentry** | **≈ $72** | **≈ $256** | **≈ $1,927** |
| Today: Vercel Hobby `aladdin-staging` | $0, but not usable: Hobby is non-commercial and the 4 h Active CPU quota is exceeded from about 1,000 DAU (≈ 9.5 h needed, §5) | — | — |

- The whole architecture does **not** cost $5/month. $5 is only the Workers Paid subscription. At 1,000 DAU the total is about $38, and **Supabase Pro ($25) is the largest line**.
- At 100,000 DAU **Supabase is about half the bill** (compute, monthly active users and egress), and **Cloudflare Images is the largest Cloudflare line** (about $448).
- The Workers host is cheaper than Vercel Pro at 1k and 10k DAU. At 100k DAU it is about 5% more expensive, because image variants move from free `sharp` CPU on Node to billed Images transformations. With variants made in the container, it is about 18% cheaper.

## 2. Usage assumptions (all estimates)

| Assumption | Value | Basis |
|---|---|---|
| Month | 30 days | — |
| Page views per DAU per day (SSR documents + RSC soft navigations) | 12 | B2B Sales is the daily driver; no traffic data yet |
| App Worker requests per DAU per day | 16 (12 pages + 4 Server Actions / API / session refreshes) | static assets are free on Workers and not counted |
| SSR CPU per app request | 40 ms average | measured 15–77 ms per page, 20–30 ms per Server Action / refresh ([perf 2026-10-20 §3](performance-cloudflare-2026-10-20.md#3-server-cpu-per-request-ms-same-runs-as-2-n--25)); production CPUs may be faster |
| Media Worker requests per page view | 6 images, each one Worker request + one Hyperdrive query (no browser cache: `no-store` / `no-cache`) | ADR-0018; the Redis guide assumes 10 per view |
| Media / video Worker CPU | 3 ms per request | estimate; the light app API routes measured 5–10 ms |
| PostgREST requests per page view | 20 (each runs about 3 SQL statements) | measured 17–32 per signed-in page, 0 on public pages ([perf 2026-10-20 §5](performance-cloudflare-2026-10-20.md#5-db-load-per-page-pg_stat_statements-delta--12-requests)) |
| Supabase egress | 1.5 KB per PostgREST response, 0.4 KB per Hyperdrive decision | estimate |
| Photo uploads per month | 3,000 / 30,000 / 300,000 | 0.1 per DAU per day |
| Image transformations | 3 unique per R2 photo upload (thumb, card, full; the thumb also serves as the decode check) + ≈ 300 for static `/_next/image` | [runtime notes](../architecture/cloudflare-workers-runtime-notes.md) |
| Stored size per photo | 1.5 MB (original ≤ 2560 px + 3 WebP variants) | estimate |
| Video minutes uploaded per month | 50 / 500 / 5,000 | estimate |
| Stored size per uploaded video minute | 120 MB (≈ 75 MB original + 1.6× for renditions) | ADR-0020 |
| Video watched | 5% of DAU play one video a day, 2 min each = 3,000 / 30,000 / 300,000 min/month; 35 Worker requests per play (4 s segments) | ADR-0020 |
| Media storage | shown at **month 12** of steady uploads: 126 GB / 1.26 TB / 12.6 TB | month 1 is about 1/12 of this |
| R2 reads | 50% of image requests and 67% of video requests miss the edge byte cache | ADR-0020 measured about a third from cache |
| R2 writes | 4 per photo, 60 per uploaded video minute | estimate |
| FastAPI calls | 0.5 per DAU per day, 1 vCPU-s each | AI / OCR / documents; estimate |
| FastAPI container | `standard-1` (½ vCPU, 4 GiB, 8 GB disk); awake 4 h/day at 1k, 16 h/day at 10k, 2 instances always on at 100k | assumption; the Containers evaluation is a separate thread |
| FFmpeg container | `standard-3` (2 vCPU, 8 GiB, 16 GB disk); transcode time = 1× video duration at 90% CPU | ADR-0020: 0.5–2× on 2 vCPUs |
| Redis commands | 3 per DAU per day + 26,000 reference refills a month (edge delivery on, so no per-image limiter) | [upstash-setup.md](../guides/upstash-setup.md#command-estimate) |
| Logs | 1.5 events of 1 KB per request; app Worker 100% sampled, media/video Workers 5% | estimate |
| Monthly active users | 3,000 / 30,000 / 250,000 | DAU/MAU ≈ 0.33–0.4 |
| Database size | 1 / 5 / 30 GB | estimate |

Derived monthly volumes:

| Volume (estimate) | 1,000 DAU | 10,000 DAU | 100,000 DAU |
|---|---|---|---|
| Page views | 0.36 M | 3.6 M | 36 M |
| App Worker requests | 0.48 M | 4.8 M | 48 M |
| Media + video Worker requests (= Hyperdrive queries) | 2.21 M | 22.1 M | 221 M |
| All Worker requests (incl. FastAPI routing) | 2.71 M | 27.1 M | 271 M |
| Worker CPU | 25.9 M CPU-ms | 259 M CPU-ms | 2,587 M CPU-ms |
| PostgREST requests | 7.2 M | 72 M | 720 M |
| Average DB request rate (PostgREST + media decisions) | 3.6 /s | 36 /s | 363 /s (peaks likely 3–5×) |
| Supabase egress | ≈ 12 GB | ≈ 117 GB | ≈ 1,170 GB |
| Unique image transformations | 9,300 | 90,300 | 900,300 |
| Redis commands | 0.12 M | 0.93 M | 9.0 M |

## 3. Prices used (official pages, checked 2026-10-22)

| Component | Included | Overage / price | Source (checked 2026-10-22) |
|---|---|---|---|
| Workers Paid | $5/month; 10 M requests, 30 M CPU-ms; static assets free | $0.30 / M requests; $0.02 / M CPU-ms | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Workers limits | 128 MB per isolate; Free plan 10 ms CPU | — | [perf 2026-10-20](performance-cloudflare-2026-10-20.md) (checked there 2026-10-20) |
| Hyperdrive | Paid: unlimited queries; ≈ 100 origin connections per config (Free ≈ 20, 100k queries/day) | $0 | [Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/), [limits](https://developers.cloudflare.com/hyperdrive/platform/limits/) |
| R2 Standard | 10 GB-month, 1 M Class A, 10 M Class B; egress free | $0.015 / GB-month; $4.50 / M Class A; $0.36 / M Class B | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| Images (transformations, incl. binding) | Free: 5,000 unique / month, then error 9422; Paid: first 5,000 included | $0.50 / 1,000 unique transformations / month | [Images pricing](https://developers.cloudflare.com/images/pricing/) |
| Containers (Workers Paid) | 375 vCPU-min, 25 GiB-h memory, 200 GB-h disk / month; egress 1 TB NA/EU, 500 GB elsewhere | $0.000020 / vCPU-s (active use); $0.0000025 / GiB-s; $0.00000007 / GB-s; egress $0.025–0.05 / GB | [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/) |
| Container instance types | `standard-1` ½ vCPU / 4 GiB / 8 GB; `standard-3` 2 vCPU / 8 GiB / 16 GB; `standard-4` 4 vCPU / 12 GiB / 20 GB | — | same page |
| Durable Objects (one per container) | 1 M requests, 400,000 GB-s | $0.15 / M requests; $12.50 / M GB-s (rounded up to the next million) | [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Workers Logs (until 2026-11-30) | 20 M events / month, 7-day retention | $0.60 / M events | [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) |
| Cloudflare Observability (from 2026-12-01) | Paid: 50 GB ingestion, 10 GB-month storage | $0.25 / GB ingested; $0.10 / GB-month | [Observability pricing](https://developers.cloudflare.com/observability/pricing/) |
| Upstash Redis | Free: 500 K commands, 256 MB, 10 GB bandwidth | PAYG $0.20 / 100 K commands; Fixed 250 MB $10/month (no per-command billing); 10,000 commands/s cap below the 100 GB plan | [Upstash Redis pricing](https://upstash.com/pricing/redis) |
| Supabase Free | 500 MB DB, 5 GB egress, 50 K MAU, shared CPU / 0.5 GB RAM, paused after 1 week idle | over quota: HTTP 402 on API calls (staging history, ADR-0018) | [Supabase pricing](https://supabase.com/pricing) |
| Supabase Pro | $25/month incl. $10 compute credit (covers Micro), 8 GB disk, 250 GB egress, 100 K MAU | $0.125 / GB disk; $0.09 / GB egress; $0.00325 / MAU | [Supabase pricing](https://supabase.com/pricing) |
| Supabase compute | Micro $10 (60 / 200 conns), Small $15, Medium $60 (120 / 600), Large $110 (2 vCPU, 160 / 800), XL $210, 2XL $410 (8 vCPU, 380 / 1,500) | billed hourly | [Compute and disk](https://supabase.com/docs/guides/platform/compute-and-disk) |
| Vercel Hobby | 1 M invocations, 4 h Active CPU, 360 GB-h memory, 100 GB transfer, 1 M CDN requests, 5 K image transformations; personal, non-commercial | — | [Vercel pricing](https://vercel.com/pricing) |
| Vercel Pro | $20/month incl. $20 credit and Flat Rate CDN tier 1 (1 M CDN requests, 1 TB) | Active CPU from $0.128 / h; memory from $0.0106 / GB-h; invocations $0.60 / M; image transformations $0.05 / 1K; CDN tiers $20 (10 M req), $100 (50 M), $300 (150 M) | [Vercel pricing](https://vercel.com/pricing), [Pro plan](https://vercel.com/docs/plans/pro), [Flat Rate CDN](https://vercel.com/docs/pricing/flat-rate-cdn) |
| Sentry | Developer free: 1 user, 5 K errors; Team $26/month (annual), 50 K errors; Business $80/month (annual) | — | [Sentry pricing](https://sentry.io/pricing/) |

## 4. Target architecture: cost per tier (estimates)

### 1,000 DAU

| Component | Usage (est.) | Included | Overage (est.) | Monthly (est.) |
|---|---|---|---|---|
| Workers Paid (app + media + video Workers) | 2.71 M req, 25.9 M CPU-ms | 10 M req, 30 M CPU-ms | none (CPU at 86% of included) | $5.00 |
| Hyperdrive | 2.21 M queries | unlimited | — | $0 |
| Images | 9,300 unique transformations | 5,000 | 4,300 | $2.15 |
| R2 | 126 GB (month 12), 15 K Class A, 1.1 M Class B | 10 GB, 1 M, 10 M | 116 GB | $1.74 |
| Containers (FastAPI + FFmpeg) | 120 h FastAPI + 0.8 h transcoding; 20 K vCPU-s, 1.75 M GiB-s, 3.5 M GB-s | 22.5 K vCPU-s, 90 K GiB-s, 720 K GB-s | memory 1.66 M GiB-s, disk 2.8 M GB-s | $4.35 |
| Durable Objects (containers) | 54 K GB-s | 400 K GB-s | — | $0 |
| Upstash | 0.12 M commands | 0.5 M (Free) | — | $0 |
| Monitoring (Workers Logs / Observability, Sentry Developer) | 0.9 M events ≈ 0.9 GB | 20 M events / 50 GB | — | $0 |
| Supabase | 12 GB egress, 3 K MAU, Micro | Free: 5 GB egress | **Free egress exceeded about 2×** → Pro | $25.00 |
| **Total** | | | | **≈ $38** |

### 10,000 DAU

| Component | Usage (est.) | Included | Overage (est.) | Monthly (est.) |
|---|---|---|---|---|
| Workers Paid | 27.1 M req, 259 M CPU-ms | 10 M, 30 M | 17.1 M req ($5.40), 229 M CPU-ms ($4.58) | $14.98 |
| Hyperdrive | 22.1 M queries | unlimited | — | $0 |
| Images | 90,300 | 5,000 | 85,300 | $42.65 |
| R2 | 1.26 TB, 150 K Class A, 11.2 M Class B | 10 GB, 1 M, 10 M | 1,250 GB; 1.2 M Class B | $19.47 |
| Containers | 480 h FastAPI + 8.3 h transcoding; 204 K vCPU-s, 7.15 M GiB-s, 14.3 M GB-s | as above | | $22.24 |
| Durable Objects | 220 K GB-s | 400 K GB-s | — | $0 |
| Upstash | 0.93 M commands | Free 0.5 M | PAYG on all commands | $1.85 |
| Monitoring | 9.1 M events ≈ 9 GB; Sentry Team | | | $26.00 |
| Supabase Pro + Medium compute | 117 GB egress, 30 K MAU, 5 GB DB, 36 req/s average | 250 GB, 100 K MAU, 8 GB, $10 credit | Medium $60 − $10 credit | $75.00 |
| **Total** | | | | **≈ $202** |

### 100,000 DAU

| Component | Usage (est.) | Included | Overage (est.) | Monthly (est.) |
|---|---|---|---|---|
| Workers Paid | 271 M req, 2,587 M CPU-ms | 10 M, 30 M | 261 M req ($78.30), 2,557 M CPU-ms ($51.14) | $134.44 |
| Hyperdrive | 221 M queries | unlimited | — | $0 |
| Images | 900,300 | 5,000 | 895,300 | **$447.65** |
| R2 | 12.6 TB, 1.5 M Class A, 111.5 M Class B | 10 GB, 1 M, 10 M | storage $188.85, Class A $4.50, Class B $36.72 | $230.07 |
| Containers | 2 × 720 h FastAPI + 83 h transcoding; 2.04 M vCPU-s, 23.1 M GiB-s, 46.3 M GB-s | as above | CPU $40.35, memory $57.62, disk $3.19 | $101.16 |
| Durable Objects | 686 K GB-s | 400 K | 1 M GB-s (rounded) | $12.50 |
| Upstash | 9.0 M commands | — | Fixed 250 MB (PAYG would be $18.05) | $10.00 |
| Monitoring | 91 M events ≈ 93 GB (from Dec 2026: $11.93; under the old Workers Logs price: $42.60); Sentry Business $80 | 50 GB | | $91.93 |
| Supabase Pro + 2XL compute | 1,170 GB egress, 250 K MAU, 30 GB DB, 363 req/s average | 250 GB, 100 K MAU, 8 GB, $10 credit | 2XL $400, MAU $487.50, egress $82.66, disk $2.75 | $997.91 |
| **Total** | | | | **≈ $2,026** |

## 5. Comparison: Vercel Pro hosting (estimates)

Vercel Hobby (today) is not a valid comparison: it is for personal, non-commercial use, and the app plus FastAPI would need ≈ 9.5 h of Active CPU at 1,000 DAU against 4 h included. So the comparison is Vercel Pro for the Next.js app and FastAPI (Vercel Services, ADR-0009). Media still needs R2, the media Worker (Workers Paid) and an FFmpeg container on either host (ADR-0018, ADR-0020); on Vercel, image variants come from `sharp` on Node, so there is no Images line. CPU per request is the same on both runtimes (measured).

Vercel Fluid memory is an estimate: 2 GB instances, 150 ms wall time per request, idle factor 3× / 1.5× / 1× by tier.

| Vercel stack line (estimate) | 1,000 DAU | 10,000 DAU | 100,000 DAU |
|---|---|---|---|
| Active CPU (app + FastAPI) | 9.5 h → $1.22 | 95 h → $12.16 | 950 h → $121.60 |
| Provisioned memory | 137 GB-h → $1.45 | 767 GB-h → $8.13 | 5,667 GB-h → $60.07 |
| Invocations | 0.5 M → $0.30 | 5.0 M → $2.97 | 49.5 M → $29.70 |
| Usage after the $20 credit | $0 | $3.26 | $191.37 |
| Pro platform fee | $20 | $20 | $20 |
| Flat Rate CDN tier (app + static requests: 1.1 M / 11 M / 110 M) | $20 | $100 | $300 |
| **Vercel hosting subtotal** | **$40** | **$123** | **$511** |
| Workers Paid for media + video Workers only | $5.00 | $9.64 | $81.28 |
| R2 | $1.74 | $19.47 | $230.07 |
| FFmpeg container only | $0 | $1.01 | $16.42 |
| Upstash | $0 | $1.85 | $10.00 |
| Sentry | $0 | $26.00 | $80.00 |
| Supabase (same as §4) | $25.00 | $75.00 | $997.91 |
| **Vercel stack total** | **≈ $72** | **≈ $256** | **≈ $1,927** |
| **Cloudflare target total (§4)** | **≈ $38** | **≈ $202** | **≈ $2,026** |

The difference is in the hosting line: Vercel's CDN tiers count every static asset request, Workers serves static assets free. Against that, Workers pays per Images transformation for upload variants.

## 6. Scaling bottlenecks

| Bottleneck | Where it binds (estimate) | Mitigation |
|---|---|---|
| **Supabase Free egress (5 GB)** | about 1,000 DAU (≈ 12 GB/month of PostgREST and Hyperdrive traffic). Over quota means HTTP 402 on every API call, a full outage | Approve Pro ($25) before launch; cut the 17–32 PostgREST requests per page (shared `cache()` loaders, fewer entitlement reads) |
| **Supabase compute** | Nano/Micro shared CPU at 1k; Medium at 10k; dedicated 2XL at 100k (363 req/s average, `showroom_home_metrics` ≈ 28 ms per call) | Reduce fan-out; fix `my_organization_application_slot()`; read replicas later |
| **Supabase connections** | Micro: 60 direct / 200 pooler; Hyperdrive Paid opens up to ≈ 100 origin connections per config; 2XL: 380 / 1,500 | Size Hyperdrive's origin connection limit below the plan's direct limit; keep app traffic on the pooler (PostgREST) |
| **Supabase MAU** | over 100 K MAU on Pro: $0.00325 each (≈ $488 at 250 K MAU) | Budget for it; it grows linearly with users |
| **Per-request media authorization** | 221 M DB decisions a month at 100k DAU (6 per page view + 35 per video play) | Per-playlist grant for HLS segments (ADR-0020 option b); fewer images per page |
| **Images transformations** | Free stops at 5,000 a month (≈ 1,600 photo uploads, then uploads fail with 9422); Paid ≈ $448/month at 100k DAU | Generate variants with libvips/FFmpeg in the FastAPI or FFmpeg container (saves ≈ 90% of this line for a few dollars of container CPU; §1 second row); keep `/_next/image` widths fixed |
| **Workers CPU** | 15–77 ms per page, billed per CPU-ms; 30 M included ≈ 750 K app requests | Cut server render cost; cache public pages |
| **Workers isolate memory** | live set ≈ 96 MB of 128 MB | Verify under load on the preview; shrink the server bundle |
| **Container disk and CPU** | largest listed instance has 20 GB disk; ADR-0020 needs 2.5× the original free, so originals above ≈ 6–8 GB cannot be transcoded; transcoding takes 0.5–2× video length on 2 vCPUs | Cap upload size, or stream from R2 instead of downloading; run several transcode instances |
| **Upstash** | Free 500 K commands at about 5,000 DAU; PAYG becomes dearer than Fixed $10 above 5 M commands; 10,000 commands/s on all but the largest plans; REST adds one HTTPS round trip per command | Move to Fixed 250 MB at ≈ 5 M commands/month; set a budget |
| **Observability** | Workers Logs pricing changes on 2026-12-01; 100% sampling on the media Worker would add ≈ 315 M events at 100k DAU | Sample media/video logs (5% assumed); export only errors to Sentry |

## 7. Security tradeoffs

| Choice | Gain | Cost / risk |
|---|---|---|
| Per-request Postgres authorization for every image and segment (Hyperdrive, caching off) | Immediate revocation; one authority | The database is on the hot path of every media byte; DB or Hyperdrive down → media 404 (fails closed). Turning Hyperdrive caching on to save load would delay revocation and must not be done |
| Images binding instead of `sharp` for upload verification | Runs on Workers | Slightly weaker than a full `sharp` decode: a structurally complete JPEG with corrupt entropy data can pass ([runtime notes](../architecture/cloudflare-workers-runtime-notes.md)) |
| Upstash over REST from Workers | Works on Workers | A bearer token in a Worker secret; rate limits fall back to per-isolate memory when Redis is unavailable, so N isolates allow up to N× the limit |
| FFmpeg in a Cloudflare Container | Scale to zero; no VM to patch | Untrusted media parsed by FFmpeg; keep `-protocol_whitelist file`, a non-root user, an R2 token scoped to the private bucket, and no service-role key in that container |
| FastAPI in a Container | Same platform as the app | The service-role key now lives in Cloudflare secrets; FastAPI must stay server-side only (reachable from the Worker, not the public internet) |
| Usage-billed edge (Workers, Images, Containers) | No hard outage at quota | Denial-of-wallet: abusive traffic costs money instead of failing. Set Worker CPU limits, Cloudflare budget alerts, Upstash budget, Vercel spend management; keep image widths and upload sizes bounded |
| Supabase Free | $0 | Quota exhaustion is an outage (402), not a bill |
| One vendor for DNS, app, media and video | Simpler operations | Concentration risk: a Cloudflare account compromise or outage takes everything down; protect the account with hardware keys and scoped API tokens |
| Log sampling on the media Worker | Lower cost | Fewer records of denied requests for incident review |

## Rationale, scope and what is deferred

- **Rationale.** The owner asked for the cost at three traffic levels before approving the Workers migration and paid plans. Measured CPU and DB numbers come from the 2026-10-19 and 2026-10-20 performance reports. Real traffic does not exist yet, so the model is an assumption.
- **Scope.** Recurring monthly infrastructure only, for production. Preview and staging would add a few dollars (a second Supabase project is separate).
- **Update from the FastAPI Containers evaluation (ADR-0022, PR #98).** FastAPI runs on the `basic` instance (¼ vCPU, 1 GiB, 4 GB disk; measured 59 MB RSS, 4.5 s cold start; `lite` is not viable at 26 s). Per running instance-hour: memory $0.009 + disk $0.001, plus CPU only while busy (at most $0.018/h). Scale-to-zero at today's traffic ≈ $0.35/month; one warm instance ≈ $7.25; a production pool of 2 warm instances ≈ $14.50 (ceiling at `max_instances` 4 ≈ $29 + CPU). Backend traffic does not grow with DAU until AI/document endpoints ship, so the realistic FastAPI line is ≈ $14.50 at every tier instead of the `standard-1` assumption above. Net effect on the Cloudflare totals, approximate: ≈ +$10 at 1k, ≈ −$7 at 10k, ≈ −$70 at 100k DAU (the FFmpeg container line is unchanged).
- **Update from the video transcode evaluation** ([video-transcode-cloudflare-containers.md](../architecture/video-transcode-cloudflare-containers.md)). Measured 2.2–3.5 vCPU-s per second of 1080p video on a 2 vCPU / 6 GiB / 20 GB instance gives ≈ $0.25–0.40 per hour of source video (up to ≈ $0.55 if container-to-R2 uploads count as egress past the allowance). The FFmpeg lines above (≈ $0.20/h) are therefore a little low: at 100k DAU (83 h of video) the line is ≈ $21–33 instead of $16.42.
- **Deferred.** The Containers evaluation for FastAPI may still change instance size and wake-up model once AI endpoints exist. Re-run this estimate after a week of real traffic on the workers.dev preview, using `wrangler tail` CPU, the Images usage page and Supabase usage.
- **Consequences.** Before launch: approve Supabase Pro and Workers Paid; decide whether image variants move to a container; set budget alerts on every usage-billed service.

## Related files

- [performance-cloudflare-2026-10-20.md](performance-cloudflare-2026-10-20.md), [performance-2026-10-19.md](performance-2026-10-19.md)
- [ADR-0018](../decisions/ADR-0018-r2-edge-media-delivery.md), [ADR-0019](../decisions/ADR-0019-redis-cache-and-rate-limits.md), [ADR-0020](../decisions/ADR-0020-video-r2-hls.md), [ADR-0021](../decisions/ADR-0021-cloudflare-workers-frontend.md)
- [cloudflare-frontend-cutover-plan.md](cloudflare-frontend-cutover-plan.md), [upstash-setup.md](../guides/upstash-setup.md), [cloudflare-workers-runtime-notes.md](../architecture/cloudflare-workers-runtime-notes.md)
