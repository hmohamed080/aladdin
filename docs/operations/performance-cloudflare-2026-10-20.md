# Performance: Cloudflare Workers (OpenNext) vs Node (`next start`), 2026-10-20

**Purpose.** Compare the same frontend build on the two hosts it can run on: the Cloudflare Workers build
(`pnpm cf:build`, served in workerd by `wrangler dev`) and the Node build (`next build && next start`, the
runtime used on Vercel). Both used the same routes, workloads and local Supabase. Covered: lab Core Web Vitals,
server latency (pages, a Server Action, sign-in, session refresh), server CPU per request, memory, DB load per page,
and static asset / `next/image` headers. The doc also records whether a real Vercel deployment can be reached from here.

**Current decision.** None. This is a measurement for the Workers migration (ADR-0021). The findings below need
decisions from the lead and owner. They are listed in [Findings that need a decision](#findings-that-need-a-decision).

**Scope.** Commit `75c6b12` (`origin/claude/cloudflare-workers-2ibvgs`) plus one fix: `51bf389`, which makes the sharp import lazy (see
[Precondition](#precondition-sharp-broke-workers-routes)). Both builds were made from that same tree.

## Read this first: caveats

- **Local workerd is not the Cloudflare edge.** `wrangler dev` runs the Worker in a local `workerd`. It runs on the same
  4 shared vCPUs as everything else (1-minute load average 1.4–4.5 during the runs, recorded on each run). It adds wrangler's
  dev proxy (a second workerd process) in front, with the inspector enabled. There is no Cloudflare cache or tiered
  cache, no Smart Placement, and no isolate cold starts across locations. Production CPU speed, isolate reuse and the
  cache will differ.
- **There is no network RTT.** The browser, both servers and Supabase all ran on one host, so the TTFB values are server time
  plus loopback only. In production, add the RTT between the user and the edge, plus the RTT between the edge and Supabase.
  The Workers number depends on where the isolate runs relative to the Supabase region (Smart Placement is not configured).
- **The CPU per request approximates Workers billed CPU.** It is `utime + stime` from `/proc/<pid>/stat` of the serving
  process, sampled around N sequential requests and divided by N. The tick is 10 ms, so the resolution is 0.4 ms/request at N = 25. Like billed CPU, it
  leaves out time spent waiting on I/O (Supabase, GoTrue). It includes V8 GC and JIT threads and any background work
  of the process. Treat it as an estimate within about ±30%, not as the billed figure. **Limits:** Workers Free allows
  **10 ms CPU per request** (a hard limit, so the request fails). Workers Paid defaults to 30 s and can be configured up to 5 min.
- **Memory:** process RSS is not the Workers limit. The limit is **128 MB per isolate** (V8 heap plus
  Wasm and other isolate allocations). The V8 heap of the user-worker isolate was therefore also read through its inspector
  (`Runtime.getHeapUsage`, plus a forced `HeapProfiler.collectGarbage`).
- **Vercel could not be reached** (see [§7](#7-real-vercel-deployment)), so there is no real-host comparison.
- **pg_stat_statements was never reset**, because the stack is shared. Each target was bracketed by snapshots, so the counts include anything else that ran in the
  same window. The counts below were identical across repeats, so this did not affect them.

## Precondition: sharp broke Workers routes

On `75c6b12`, with sharp imported at the top level, **every route that imports `src/server/storage/media.ts` returned 500
in workerd**. The error was `Could not load the "sharp" module using the linuxnull-x64 runtime … Dynamic require … is not supported`. The cause was
`content-validation.mjs` and `public-image-variants.ts`, which import `sharp` at the top level and are loaded through
`validation.ts`. The routes affected in this run were `/home`, `/showroom/home`, `/showroom/catalog`, `/showroom/catalog/[id]`, `/p/[id]`,
`/api/media/avatar`, `/api/video/[id]/playback` and the catalog Server Action. The routes that worked were `/`, `/auth/sign-in`, `/admin`, `/b2b`, the sign-in POST and
`/api/health`.

Commit `51bf389` loads sharp on first use (`await import("sharp")`), so those modules load. Image verification
and derivatives still need sharp, and they **still cannot run on Workers**. Another branch is replacing them with the Images binding
(`claude/cf-media-runtime-2ibvgs`), and the lead may drop `51bf389` in favour of that branch. Both builds below include `51bf389`, so the
comparison is like for like.

## 1. Lab Core Web Vitals (median of 5)

The harness is `e2e/perf/web-vitals.mjs`, unchanged, run interleaved by `run-ab.sh` (for each page, Workers ran first, then Node right away).
Mobile = Pixel 5, 150 ms RTT, 1.6 Mbps down / 750 kbps up, CPU ×4. Desktop = 1440×900, no throttling. Every run used a fresh browser
context against a warm server. Sign-in used the real Email + Password flow, and only the third-party Turnstile script was stubbed.

### Mobile

| Page | Route (identity) | LCP ms Node → Workers | INP ms | CLS | TTFB ms | TBT ms | Total KB (Workers) |
|---|---|---|---|---|---|---|---|
| Landing | `/` | 2168 → **2356** | 56 → 64 | 0 → 0 | 27 → 28 | 145 → 131 | 491 |
| Auth | `/auth/sign-in` | 980 → **956** | 32 → 32 | 0 → 0 | 20 → 27 | 172 → 193 | 478 |
| Home | `/home` (consumer) | 980 → **980** | 56 → 56 | 0 → 0 | 75 → 88 | 269 → 273 | 562 |
| Showroom | `/showroom/home` (hana) | 1108 → **1240** | 64 → 64 | 0 → 0 | 120 → 112 | 195 → 149 | 567 |
| Admin | `/admin` (admin) | 1104 → **1104** | 64 → 56 | 0 → 0 | 246 → 266 | 204 → 180 | 473 |
| B2B | `/b2b` (a-owner) | 980 → **1096** | 48 → 56 | 0 → 0 | 87 → 155 | 331 → 385 | 634 |
| Marketplace | `/showroom/catalog` (hana) | 1564 → **1460** | 40 → 32 | 0 → 0 | 92 → 116 | 153 → 143 | 541 |

### Desktop

| Page | LCP ms Node → Workers | INP ms | CLS | TTFB ms | TBT ms |
|---|---|---|---|---|---|
| Landing | 168 → **844** | 56 → 56 | 0 → 0 | 21 → 34 | 0 → 2 |
| Auth | 152 → **152** | 16 → 16 | 0 → 0 | 18 → 26 | 0 → 2 |
| Home | 292 → **304** | 72 → 64 | 0 → 0 | 60 → 78 | 0 → 0 |
| Showroom | 608 → **640** | 24 → 24 | 0 → 0 | 101 → 105 | 0 → 7 |
| Admin | 364 → **292** | 16 → 16 | 0 → 0 | 217 → 194 | 0 → 0 |
| B2B | 396 → **460** | 104 → 80 | 0 → 0 | 102 → 98 | 0 → 0 |
| Marketplace | 368 → **552** | 16 → 16 | 0 → 0 | 66 → 88 | 0 → 0 |

- **Every page passes the targets on both runtimes** (LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1). The ranges are wide: Workers Landing mobile ran 1832–2576 ms. CLS was 0 on every run.
- **Landing is the one clear regression:** desktop LCP went from 168 to 844 ms (range 708–1084), and mobile from 2168 to 2356 ms. The LCP element is the hero `next/image`.
  On Workers, every `/_next/image` request is transformed again and is sent with **no `Cache-Control`**
  (§6): 130–255 ms per request locally, against about 1 ms for Node's cached optimizer.
- Other differences are within run-to-run noise at this load (±100–150 ms LCP). Signed-in TTFB is 10–70 ms higher on Workers (§2).

## 2. Server latency (sequential, n = 25 after 2 warm-ups; ms)

The harness is `e2e/perf/server-latency.mjs`: Node `fetch` with each identity's session cookies, and no browser. TTFB = time to the response headers;
total = time to the full body. There were two runs per runtime, in the order Workers, Node, Node, Workers. Run 1 is shown, with run 2's TTFB p50 in the last column.

| Target | Status | Node TTFB p50 / p95 | Workers TTFB p50 / p95 | Node total p50 / p95 | Workers total p50 / p95 | Run 2 TTFB p50 Node / Workers |
|---|---|---|---|---|---|---|
| `GET /` | 200 | 11.5 / 18.2 | 22.3 / 37.8 | 16.7 / 29.9 | 28.7 / 51.4 | 11.4 / 21.4 |
| `GET /auth/sign-in` | 200 | 7.8 / 14.0 | 18.9 / 25.7 | 12.2 / 18.9 | 24.5 / 31.7 | 7.9 / 18.6 |
| `GET /home` | 200 | 50.6 / 63.6 | 68.1 / 109.8 | 61.3 / 85.0 | 89.9 / 158.6 | 53.2 / 67.7 |
| `GET /showroom/home` | 200 | 73.8 / 91.4 | 87.9 / 123.3 | 121.4 / 162.9 | 172.3 / 260.0 | 70.7 / 66.3 |
| `GET /showroom/catalog` (Marketplace) | 200 | 63.8 / 83.9 | 64.6 / 95.9 | 74.0 / 93.4 | 92.6 / 112.5 | 54.1 / 64.7 |
| `GET /showroom/catalog/[id]` | 200 | 53.7 / 60.9 | 70.3 / 91.4 | 58.8 / 65.7 | 91.6 / 125.5 | 72.0 / 77.4 |
| `GET /p/[id]` | 200 | 16.3 / 21.9 | 29.8 / 40.8 | 19.4 / 23.9 | 37.0 / 46.2 | 19.6 / 22.6 |
| `GET /admin` | 200 | 165.5 / 228.7 | 217.0 / 330.1 | 174.1 / 235.2 | 228.9 / 341.6 | 165.1 / 161.4 |
| `GET /b2b` | 200 | 64.9 / 90.9 | 79.2 / 94.9 | 82.3 / 114.6 | 92.7 / 109.9 | 60.1 / 70.4 |
| `GET /b2b` RSC (soft nav) | 200 | 11.0 / 20.9 | 18.2 / 24.3 | 64.9 / 94.8 | 72.4 / 96.0 | 10.6 / 13.9 |
| `GET /api/health` | 200 | 2.8 / 5.7 | 8.4 / 16.5 | 3.2 / 6.0 | 9.4 / 17.4 | 2.4 / 7.9 |
| `GET /api/media/avatar` (auth check, miss) | 404 | 65.2 / 83.2 | 71.8 / 93.6 | 65.3 / 83.2 | 72.2 / 97.0 | 52.2 / 66.3 |
| `GET /api/video/[id]/playback` (video off) | 503 | 5.7 / 11.7 | 10.6 / 16.3 | 6.1 / 12.1 | 12.3 / 17.4 | 5.3 / 8.8 |
| **Server Action** `loadCatalogBatchAction` ("Show more" on `/showroom/catalog`) | 200 | 37.6 / 46.3 | 58.7 / 79.1 | 38.7 / 48.1 | 59.4 / 80.1 | 42.2 / 41.5 |
| **Sign-in POST** (Sign In Server Action, replayed) | 303 | 125.9 / 169.5 | 134.3 / 163.2 | 173.4 / 217.9 | 191.3 / 222.8 | 123.7 / 115.3 |
| `GET /onboarding`, valid session (baseline) | 307 | 33.1 / 44.8 | 44.6 / 59.7 | 37.3 / 52.2 | 50.4 / 74.2 | 34.0 / 46.4 |
| **Session refresh**: `GET /onboarding`, expired session | 307 | 135.5 / 161.6 | 145.9 / 187.7 | 142.9 / 166.3 | 150.0 / 197.2 | 165.6 / 178.8 |

- **Workers adds a roughly constant 5–15 ms per request locally** (`/api/health` 2.8 → 8.4 ms; static pages +10 ms). Part of that is wrangler's
  dev entry proxy (a separate workerd hop) and the inspector. On the edge, the hop does not exist, but the RTT from the edge to Supabase
  will dominate signed-in pages. Signed-in pages are +0–20 ms at p50. `/admin` was +50 ms in run 1 and −4 ms in run 2, which is noise.
- **Session refresh works through the middleware on both runtimes:** 25 of 25 requests rotated the refresh token. A refresh adds
  about 100–130 ms (the GoTrue token call) to the request that carries it.
- **Sign-in POST** costs about the same on both (115–135 ms p50). The time is mostly GoTrue's password check.
- The Server Action is about 20 ms slower on Workers in run 1 and the same in run 2.

## 3. Server CPU per request (ms; same runs as §2, n = 25)

`workerd app` = the user-worker isolate's process. The two dev-only processes are listed separately: wrangler's entry proxy (a second workerd) and
the wrangler CLI (Node). Neither exists in production.

| Target | Node `next-server` (run 1 / run 2) | **workerd app** (run 1 / run 2) | workerd entry proxy | wrangler CLI | Over the 10 ms Free limit? |
|---|---|---|---|---|---|
| `GET /` | 20.8 / 15.2 | **24.4 / 20.8** | 3.6 | 1.2 | **yes** |
| `GET /auth/sign-in` | 12.8 / 14.4 | **17.2 / 14.8** | 2.8 | 1.2 | **yes** |
| `GET /home` | 50.0 / 43.2 | **46.4 / 46.4** | 4.4 | 1.2 | **yes** |
| `GET /showroom/home` | 90.8 / 68.4 | **76.8 / 70.0** | 5.6 | 1.6 | **yes** |
| `GET /showroom/catalog` | 54.0 / 40.4 | **47.6 / 50.4** | 4.0 | 1.2 | **yes** |
| `GET /showroom/catalog/[id]` | 41.2 / 60.0 | **44.8 / 46.8** | 4.0 | 1.2 | **yes** |
| `GET /p/[id]` | 14.4 / 16.8 | **16.4 / 15.6** | 2.4 | 1.2 | **yes** |
| `GET /admin` | 71.6 / 53.6 | **58.4 / 66.0** | 4.4 | 1.6 | **yes** |
| `GET /b2b` | 61.2 / 56.0 | **55.6 / 54.8** | 4.8 | 1.2 | **yes** |
| `GET /b2b` RSC | 44.8 / 39.2 | **40.4 / 34.8** | 2.4 | 1.6 | **yes** |
| `GET /api/health` | 2.8 / 2.0 | **5.6 / 5.2** | 2.0 | 0.8 | no |
| `GET /api/media/avatar` (miss) | 5.6 / 5.2 | **9.6 / 9.2** | 2.8 | 1.6 | borderline |
| `GET /api/video/[id]/playback` | 6.0 / 6.8 | **8.0 / 6.8** | 2.4 | 0.8 | no |
| Server Action `loadCatalogBatchAction` | 17.6 / 18.8 | **23.6 / 19.6** | 2.8 | 1.2 | **yes** |
| Sign-in POST | 62.4 / 60.8 | **70.4 / 49.2** | 6.8 | 2.8 | **yes** |
| `/onboarding`, valid session | 22.8 / 22.8 | **27.2 / 25.2** | 2.8 | 1.2 | **yes** |
| `/onboarding`, session refresh | 28.0 / 29.6 | **29.2 / 30.4** | 3.6 | 1.6 | **yes** |

- **CPU per request is about the same on both runtimes.** Rendering React Server Components and serializing RSC dominates it, not the host.
- **Every HTML page, the Server Action, sign-in and session refresh exceed the Workers Free 10 ms limit**, most of them by 2–8×
  (15–77 ms). Only the light API routes stay under it. Even if Cloudflare's CPUs run 2× faster than this busy host, the signed-in pages would still be far over the limit.
  **In practice this app needs Workers Paid** (the 30 s default CPU limit; billed per CPU-ms above the included 30 M CPU-ms/month).
- Cost estimate on Paid, as an assumption to check against real `wrangler tail` / dashboard CPU: about 50 ms per signed-in page view means about 600 k page views/month
  inside the included 30 M CPU-ms.

## 4. Memory

| Process | Peak RSS over the whole session (VmHWM) | Notes |
|---|---|---|
| Node `next-server` | **622 MB** | one process serves all routes; RSS includes V8 heap, code and native buffers |
| workerd (user worker) | 911 MB | the whole runtime process, not the isolate; dev build, inspector on |
| workerd (wrangler entry proxy) | 323 MB | dev-only |
| wrangler CLI (Node) | 800 MB | dev-only (also runs the local Images emulation) |

**Isolate heap (the number the 128 MB limit is about):**

| Measurement (V8 heap of the user-worker isolate) | used / total MB |
|---|---|
| After the latency runs, idle | 103.8 / 136.7 |
| Peak sampled every 5 s during the CWV run (7 pages × 2 profiles × 5 runs, plus sign-ins) | **150.3 / 187.2** |
| After a forced full GC (`HeapProfiler.collectGarbage`), idle | **96.2 / 98.5** |

- **The live set after a full GC is about 96 MB, about 75% of the 128 MB isolate limit, with no request in flight.** Most of it
  is the code and module state of a 31 MB bundle (§8). The 150 MB peak includes garbage that a local V8 (with no 128 MB cap) had not
  collected yet. On the edge, V8 collects more aggressively near the limit. Even so, about 30 MB of headroom per isolate is thin for concurrent
  requests that each render large RSC payloads. Cloudflare resets an isolate that goes over the limit, and requests in flight on it fail.
  **This must be verified on the preview deployment** (dashboard "Exceeded Memory" errors / `wrangler tail`) before cutover.

## 5. DB load per page (pg_stat_statements delta ÷ 12 requests)

Only the `authenticated` and `anon` roles are counted. PostgREST runs `pgrst_hooks.pre_request()` once per HTTP request, so that count = the PostgREST requests the page makes.

| Target | PostgREST requests / page (Node → Workers) | Statements / page | DB exec ms / page (Node → Workers) |
|---|---|---|---|
| `/`, `/auth/sign-in` | 0 → 0 | 0 → 0 | 0 → 0 |
| `/home` | **18 → 19** | 54 → 57 | 12.0 → 17.0 |
| `/showroom/home` | **31 → 32** | 93 → 96 | 74.3 → 124.6 |
| `/showroom/catalog` | 17 → 17 | 51 → 51 | 24.5 → 31.0 |
| `/admin` | 26 → 26 | 78 → 78 | 54.2 → 60.4 |
| `/b2b` | 23 → 23 | 69 → 69 | 17.5 → 20.2 |
| Server Action `loadCatalogBatchAction` | 7 → 7 | 21 → 21 | 9.0 → 9.7 |
| `/onboarding` (valid / refresh) | 5 → 5 | 15 → 15 | 4.3 / 4.1 → 4.7 / 5.2 |

**The counts are not identical: Workers makes one extra PostgREST request on `/home` and on `/showroom/home`.** On every page load, the extra
request is an exact duplicate of a request made in the same render:

- `/home`: `users?select=primary_account_type&id=eq.<me>`, issued by both `loadPersonalHome()` and `loadIsSalesPersona()`. Each is
  `cache()`d, but they are different functions that make the same GET.
- `/showroom/home`: the `order_list` "confirmed" count (a HEAD with the same filters), issued by both `loadShowroomOrderCounts(window)` and
  `loadShowroomOrderCounts(previousWindow)`. That query does not depend on the window.

On Node, Next.js's per-render fetch memoization collapses each pair into one HTTP request. On the OpenNext/Workers build it does not. **Likely cause:**
the patched `fetch` that does the memoization is not the one supabase-js uses under OpenNext. This was not traced further. The **fix is in the app and
is runtime-independent**: share one `cache()`d loader for `primary_account_type`, and take the "confirmed" count out of the per-window
function. Do not rely on fetch memoization anywhere. DB milliseconds per page vary with load; only the counts are exact.

## 6. Static assets and `next/image`

The hashed asset is `/_next/static/chunks/5962-*.js` (47 KB gzip). The image is the Landing hero through `/_next/image` (`w=1200` / `w=640`, `q=75`). There were 12 sequential
requests each; "warm" = the median of requests 3–12.

| Asset | Node TTFB first / warm | Workers TTFB first / warm | Node `Cache-Control` | Workers `Cache-Control` |
|---|---|---|---|---|
| `_next/static/chunks/*.js` (hashed) | 2.9 / 2.5 ms | 5.1 / 4.9 ms | `public, max-age=31536000, immutable` | **`public, max-age=0, must-revalidate`** (+ `ETag`) |
| `_next/static/css/*.css` | — | — | `public, max-age=31536000, immutable` | **`public, max-age=0, must-revalidate`** |
| `/_next/image` hero `w=1200` (WebP) | 3.8 / **1.0 ms** (73 KB) | 252 / **256 ms** (83 KB) | `public, max-age=60, must-revalidate` + `ETag`, `X-Nextjs-Cache` | **none** (no `ETag` either) |
| `/_next/image` hero `w=640` (WebP) | 2.3 / 1.7 ms (30 KB) | 131 / 138 ms (34 KB) | same | **none** |

- **Hashed `_next/static` assets lose their immutable caching on Workers.** Workers static assets default to `max-age=0, must-revalidate`
  unless a `_headers` file says otherwise, and `public/_headers` does not exist. Browsers will revalidate every chunk on every
  navigation (a 304 round trip each). Fix: add `public/_headers` with `/_next/static/*` → `Cache-Control: public, max-age=31536000, immutable`
  (the OpenNext-documented setup).
- **`/_next/image` is transformed again on every request and is sent with no `Cache-Control`**, so neither the browser nor Cloudflare's cache keeps it.
  Locally that costs 130–255 ms per image (wrangler's local Images emulation). On Cloudflare it is a billed Images transformation
  each time (Free: 5,000 unique transformations/month) plus the transform latency. This explains the Landing LCP regression in §1.
  Fix candidates (owned by the media/runtime work): an OpenNext image loader or a Worker wrapper that sets
  `Cache-Control` and caches results (Cache API / R2), or serve preset sizes from R2.

## 7. Real Vercel deployment

Unreachable from this sandbox. The egress proxy refuses CONNECT to `aladdin-staging.vercel.app`, `vercel.com` and `aladdindecore.com`
(`curl: (56) CONNECT tunnel failed, response 403`). **No real-host TTFB samples were taken.** One GET was attempted against
`aladdindecore.com/api/health` (refused at the proxy), which is within the 30-request budget.

## 8. Other observations

- **Bundle size:** `wrangler deploy --dry-run` reports **Total Upload 31,225 KiB / gzip 5,920 KiB**. Since 2026-09-04 Cloudflare checks only the
  uncompressed size, 64 MiB on every plan (the old 3 MB Free / 10 MB Paid compressed limits were removed), so size is not a blocker. §3 alone makes Workers Paid required.
- **The signed-in redirect on `/auth/sign-in` drops refreshed cookies (both runtimes).** When the middleware refreshes a session and then
  redirects a signed-in caller from a signed-out entry page to `/onboarding`, it returns `NextResponse.redirect(url)` without copying
  `response.cookies`. The browser keeps the old (now rotated) refresh token. Page-level redirects (for example `/onboarding` → `/home`) do
  carry the cookies. The suspended and "onboarding" redirects in the same middleware have the same pattern. This is not Workers-specific. It is a small fix: copy the cookies onto
  every redirect, as the `session_active === false` branch already does.
- On Workers, the `/onboarding` response sent the refreshed `sb-…-auth-token` `Set-Cookie` **twice** (Node: once). It is harmless, and is noted here
  as a difference.

## Findings that need a decision

1. **Workers Paid is required.** Every page exceeds the 10 ms Free CPU limit (§3). The bundle (31 MiB uncompressed) is within the 64 MiB limit on every plan (§8).
2. **Isolate memory headroom is about 30 MB** (live set about 96 MB vs 128 MB, §4). Verify it on the preview under concurrent load before cutover. If
   it is tight, shrink the server bundle (the bilingual catalog and large server-only modules are candidates).
3. **Add `public/_headers`** for immutable `_next/static/*` (§6). This is a small, safe change for whoever owns the Workers config.
4. **`next/image` on Workers is uncached** (§6). This is the cause of the Landing LCP regression. It is owned by the cf-media work.
5. **Two duplicated PostgREST requests on Workers** (§5). Fix them in the app with shared `cache()` loaders. Runtime-independent.
6. **Middleware redirects drop refreshed cookies** (§8). This happens on both runtimes.

## Exact commands

```bash
git -C /home/claude/aladdin worktree add /home/claude/wt-cf-perf origin/claude/cloudflare-workers-2ibvgs
cd /home/claude/wt-cf-perf && git checkout -B claude/cf-perf-2ibvgs && cd frontend
pnpm install --frozen-lockfile --prefer-offline
cp <local .env.local> .env.local                      # local Supabase URL/keys (never committed)
{ cat .env.local; echo E2E_STUB_TURNSTILE=1; } > .dev.vars   # same runtime vars for workerd
pnpm cf:build          # .open-next/ (Workers); next build runs with the middleware switched to Edge
pnpm build             # .next/ (Node); .open-next/ is self-contained, so both can coexist
pnpm exec next start -p 3340 -H 127.0.0.1 &
WRANGLER_SEND_METRICS=false CI=1 pnpm exec wrangler dev --port 3341 --ip 127.0.0.1 &
# PIDs: next-server; workerd with --socket-addr=entry=127.0.0.1:0 (user worker) vs =127.0.0.1:3341 (entry proxy); wrangler-dist/cli.js
AID=$(node -e 'const m=require("./.next/server/server-reference-manifest.json");for(const[i,v]of Object.entries(m.node))if(v.exportedName==="loadCatalogBatchAction")console.log(i)')
export PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome

# 2+3. latency + CPU + RSS (order: workers, node, node, workers)
node e2e/perf/server-latency.mjs --base http://127.0.0.1:3341 --label workers --n 25 --catalog-action $AID \
  --cpu-pids <workerd-app>,<workerd-entry>,<wrangler-cli> --out w1.json
node e2e/perf/server-latency.mjs --base http://127.0.0.1:3340 --label node --n 25 --catalog-action $AID --cpu-pids <next-server> --out n1.json
# 1. lab CWV, interleaved
A_LABEL=workers B_LABEL=node AFTER=http://127.0.0.1:3341 BEFORE=http://127.0.0.1:3340 RUNS=5 OUT=cwv \
  PAGES="landing auth home showroom admin b2b marketplace" e2e/perf/run-ab.sh
A_LABEL=workers B_LABEL=node node e2e/perf/summarize.mjs cwv
# 4. isolate heap: the user worker's inspector (curl http://127.0.0.1:<inspector-port>/json), then over its WebSocket
#    Runtime.getHeapUsage, and HeapProfiler.enable + HeapProfiler.collectGarbage (the GC runs when the next request arrives)
# 5. DB load
node e2e/perf/server-latency.mjs --base http://127.0.0.1:3341 --label workers --n 10 --catalog-action $AID --pgss pgss-workers \
  --only "page /,page /auth/sign-in,page /home,page /showroom/home,page /showroom/catalog,page /admin,page /b2b,POST action loadCatalogBatch,GET /onboarding (valid session),GET /onboarding (expired session -> refresh)"
python3 -I ../scripts/perf/pgss-diff.py pgss-workers/2-a.tsv pgss-workers/2-b.tsv 400
# 6. assets
curl -s -o /dev/null -D - http://127.0.0.1:3341/_next/static/chunks/<hash>.js
curl -s -o /dev/null -D - -H 'accept: image/webp' 'http://127.0.0.1:3341/_next/image?url=%2Fpreview%2Flanding%2Fhero%2Fbackground-2-new-trimmed.png&w=1200&q=75'
# 8. bundle size (no upload)
pnpm exec wrangler deploy --dry-run --outdir <tmp>
# 7. Vercel reachability
curl -sI https://aladdin-staging.vercel.app/api/health
```

## Harness changes (this commit)

- `frontend/e2e/perf/server-latency.mjs`: optional `--cpu-pids` (`utime+stime` and RSS per target from `/proc`), `--catalog-action`
  (the read-only Server Action target), a replayed Sign In Server Action POST (captured during the harness's own browser sign-in),
  and a session-refresh target (the cookie's `expires_at` is moved into the past and the newest refresh token is sent on every request; the result reports how many
  responses rotated it). The old targets and output are unchanged.
- `frontend/e2e/perf/run-ab.sh`, `summarize.mjs`: `A_LABEL` / `B_LABEL` name the two sides (default `after` / `before`).

## Related files

- [`performance-2026-10-19.md`](performance-2026-10-19.md): the previous pass (same harness and route set).
- `frontend/scripts/build-cloudflare.mjs`, `frontend/wrangler.jsonc`, `frontend/cloudflare/worker.ts`: the Workers build.
- `frontend/src/server/storage/content-validation.mjs`, `public-image-variants.ts`: the lazy sharp import (`51bf389`).
- `frontend/src/middleware.ts`: session refresh and the redirects noted in §8.
