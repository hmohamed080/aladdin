# Performance and load measurement — 2026-10-19

**Purpose.** Measure lab Core Web Vitals, server latency, Redis cache effect, DB load, media weight and the
video segment-authorization path **before** (`origin/main` @ `bd0de0a`) and **after**
(`origin/claude/video-r2-2ibvgs` @ `03369bc`), against the owner's mobile targets
(**LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1**). Then load-test `public.media_edge_video(...)` and set the result
against Supabase Free and Cloudflare Free limits.

**Status.** Measurement only. No product code changed. The fixes in [Proposed fixes](#proposed-fixes)
are proposals for the lead to accept or reject.

## Read this first: caveats

- **The CPU was shared and busy.** The host has 4 vCPUs. Other agents were building and testing at the same time,
  so the 1-minute load average was **6 to 24** during the runs (it is recorded on every run). Lab numbers
  are therefore pessimistic and noisy. To keep the comparison fair, the browser runs were **interleaved**: for
  each page the after build ran, then the before build ran right away, so both saw similar load. The
  latency runs were repeated in reverse order (before first), and the result held.
- **One local stack served both builds.** Both builds used the same local Supabase (Postgres 17, GoTrue,
  PostgREST), with the current schema, which includes the video migrations, and the same `.env.local`. They ran as production servers
  (`next build && next start`): after on `:3306`, before on `:3307`. The browser was the local Chromium
  1194. The Turnstile script was stubbed (`E2E_STUB_TURNSTILE=1`), so sign-in used the real Email + Password server action.
- **Lab numbers, not field numbers.** INP comes from **one scripted interaction** per run (Event Timing API, the
  slowest interaction counts). CLS covers page load plus that one interaction, with no scrolling. Real-user
  INP/CLS over a whole session will be higher.
- **There is no public Marketplace or public product page.** Every catalog and product route requires a
  signed-in, approved workspace. "Marketplace" was measured on `/showroom/catalog` (the buyer discovery
  list, signed in as the showroom owner). "Showroom product page" was measured on
  `/showroom/catalog/<seeded product>`. The only public detail page is `/p/[profileId]` (a public
  profile), so it was measured too.
- **pg_stat_statements was never reset**, because other agents use it. Each target was bracketed by two
  snapshots and the difference was taken. Other agents' traffic in the same window adds to these numbers,
  so read the DB figures as upper bounds.
- **Video delivery is not enabled locally** (`VIDEO_ENABLED` unset), so `/api/video/[id]/playback` returns 503
  on after and 404 on before (the route does not exist there). That number measures only the route's gate, not a
  playback.

## 1. Lab Core Web Vitals (median of 5 runs per page and profile)

Mobile = Pixel 5 viewport and touch, CDP `Network.emulateNetworkConditions` (150 ms RTT, 1.6 Mbps down, 750 kbps
up) and `Emulation.setCPUThrottlingRate` 4. Desktop = 1440×900, no throttling. Every run used a fresh browser
context (cold HTTP cache) against a warmed server. TBT is the sum of long-task time over 50 ms after FCP.

### Mobile (the targets apply here)

| Page | Route | LCP ms before → after | INP ms | CLS | TTFB ms | TBT ms | JS / total KB (after) | load1 b / a | After vs targets |
|---|---|---|---|---|---|---|---|---|---|
| Landing | `/` | 3380 → **2960** | 80 → **136** | 0 → **0** | 119 → 60 | 445 → 473 | 328 / 747 | 20.4 / 23.0 | **FAIL (LCP)** |
| Auth | `/auth/sign-in` | 1372 → **1580** | 64 → **80** | 0 → **0** | 34 → 86 | 231 → 275 | 282 / 527 | 15.8 / 19.3 | pass |
| Home | `/home` (consumer) | 1576 → **1664** | 72 → **72** | 0 → **0** | 410 → 309 | 368 → 306 | 382 / 640 | 14.5 / 15.5 | pass |
| Showroom | `/showroom/home` (hana) | 2320 → **1788** | 144 → **80** | 0 → **0** | 650 → 268 | 364 → 372 | 349 / 631 | 13.2 / 16.6 | pass |
| Showroom product | `/showroom/catalog/[id]` | 2212 → **2044** | 112 → **88** | 0 → **0** | 652 → 229 | 272 → 366 | 313 / 575 | 16.2 / 15.5 | pass (close) |
| Public profile | `/p/[profileId]` | 1384 → **1284** | 32 → **24** | 0 → **0** | 67 → 122 | 183 → 162 | 111 / 302 | 13.2 / 14.8 | pass |
| Admin | `/admin` (admin) | 1468 → **1688** | 104 → **96** | 0 → **0** | 400 → 567 | 293 → 259 | 293 / 551 | 10.0 / 11.3 | pass |
| B2B | `/b2b` (a-owner) | 1820 → **1612** | 104 → **120** | 0 → **0** | 455 → 249 | 656 → 675 | 446 / 721 | 10.1 / 11.0 | pass |
| Marketplace | `/showroom/catalog` (hana) | 2112 → **1796** | 96 → **80** | 0 → **0** | 565 → 191 | 385 → 363 | 316 / 591 | 11.0 / 9.5 | pass |

Before → after differences under about 200 ms (LCP) or 40 ms (INP) are inside run-to-run noise at this load. The per-run
ranges are below. The clear changes are **Showroom, Marketplace and Landing LCP** (better) and **TTFB on
every signed-in workspace page except Admin** (2–3× lower; see §2).

### Desktop (no throttling)

| Page | LCP ms before → after | INP ms | CLS | TTFB ms | TBT ms |
|---|---|---|---|---|---|
| Landing | 644 → **504** | 128 → **128** | 0 → **0** | 65 → 52 | 63 → 87 |
| Auth | 352 → **352** | 24 → **32** | 0 → **0** | 59 → 35 | 23 → 3 |
| Home | 908 → **808** | 104 → **128** | 0 → **0** | 410 → 233 | 32 → 43 |
| Showroom | 1548 → **1096** | 64 → **72** | 0 → **0** | 600 → 292 | 85 → 56 |
| Showroom product | 880 → **684** | 40 → **48** | 0 → **0** | 350 → 144 | 31 → 0 |
| Public profile | 220 → **236** | 8 → **8** | 0 → **0** | 52 → 91 | 9 → 15 |
| Admin | 708 → **604** | 24 → **16** | 0 → **0** | 462 → 339 | 0 → 4 |
| B2B | 752 → **668** | 136 → **152** | 0 → **0** | 345 → 107 | 21 → 71 |
| Marketplace | 872 → **548** | 32 → **16** | 0 → **0** | 375 → 127 | 0 → 0 |

Every desktop page passes all three targets.

### Spread and attribution (after build)

| Page | Profile | LCP range (5 runs) | INP range | LCP element | Scripted interaction |
|---|---|---|---|---|---|
| Landing | mobile | 2828–3192 | 80–192 | hero `img` `/preview/landing/hero/background-2-new-trimmed.png` at `w=1200` (72 KB WebP) | tap "Menu" |
| Landing | desktop | 404–964 | 72–256 | same image at `w=1920` (115 KB WebP) | tap "Learn more" |
| Auth | mobile | 1400–1696 | 56–96 | `h1` "Sign in to Aladdin" (text) | type into Email |
| Home | mobile | 1144–1744 | 56–112 | intro paragraph (text) | tap "Chat" |
| Showroom | mobile | 1420–2384 | 56–144 | `h1` "Your showroom today" (text) | tap "Chat" |
| Showroom product | mobile | 1856–2328 | 56–144 | product image (demo SVG) | tap "Chat" |
| Public profile | mobile | 1084–1368 | 24–32 | footer note paragraph (text) | tap the `h1` |
| Admin | mobile | 1536–1988 | **64–848** | intro paragraph (text) | tap "Chat" |
| B2B | mobile | 1436–1928 | 72–136 | `h1` "Your supply at a glance" (text) | tap "Chat" |
| Marketplace | mobile | 1652–2524 | 64–88 | product card image (demo SVG) | type "ceramic" into search |

- **CLS was 0.000 on every run of every page, in both builds.** No layout-shift entries were recorded.
- **Admin's INP outlier** (one run at 848 ms; the others were 64–104 ms) fell in a load spike. Re-measure it before acting on it.
- **Weight on every page:** fonts are 160 KB, the same on every page, because `next/font` preloads all four families (Readex Pro and
  Reem Kufi with Arabic subsets, Archivo, JetBrains Mono) even on English pages. The build holds 336 KB of `woff2` files.
  Shared JS is 103 KB. First-load JS per route grew by about 7–8 KB from before to after (for example, `/b2b` went from 266 to 273 KB and
  `/showroom/home` from 307 to 315 KB, per `next build`).
- On mobile, **text LCP is almost the same as FCP** on the workspace pages. Their LCP depends on how fast the first paint arrives
  (TTFB, CSS, and fonts competing for 1.6 Mbps), not on a late image.

## 2. Server latency (sequential, n = 25 after 2 warm-ups; ms)

Node `fetch` with the identity's session cookies, so no browser is involved. TTFB = time until the response headers arrive, total = time until the full body has arrived.

| Target | Before TTFB p50 / p95 | After TTFB p50 / p95 | After + Redis TTFB p50 / p95 | After total p50 / p95 | Status |
|---|---|---|---|---|---|
| `GET /` | 22 / 68 | 19 / 26 | 17 / 21 | 27 / 43 | 200 |
| `GET /auth/sign-in` | 15 / 23 | 14 / 26 | 11 / 21 | 23 / 39 | 200 |
| `GET /home` | 376 / 544 | **83 / 130** | 78 / 112 | 100 / 167 | 200 |
| `GET /showroom/home` | 355 / 658 | **112 / 181** | 96 / 124 | 195 / 306 | 200 |
| `GET /showroom/catalog` | 322 / 464 | **113 / 209** | 83 / 161 | 142 / 235 | 200 |
| `GET /showroom/catalog/[id]` | 418 / 671 | **112 / 193** | 87 / 105 | 122 / 249 | 200 |
| `GET /p/[profileId]` | 33 / 53 | 34 / 44 | 29 / 43 | 39 / 58 | 200 |
| `GET /admin` | 378 / 626 | 392 / 674 | 297 / 381 | 404 / 682 | 200 |
| `GET /b2b` | 341 / 568 | **120 / 223** | 77 / 146 | 153 / 280 | 200 |
| `GET /b2b` RSC (soft navigation) | 141 / 273 | **21 / 26** | 17 / 28 | 117 / 212 | 200 |
| `GET /api/health` | 5 / 8 | 4 / 8 | 4 / 7 | 4 / 8 | 200 |
| `GET /api/media/avatar` (auth check, miss) | 116 / 236 | 110 / 166 | 89 / 124 | 110 / 166 | 404 |
| `GET /api/video/[id]/playback` | 134 / 269 (404, no route) | 7 / 14 (503, video off) | 6 / 11 | 8 / 15 | — |

Load average during these runs: 6–12. A second run in reverse order (before first) confirmed it: `/home` 348 → 125,
`/showroom/home` 348 → 154, `/b2b` 343 → 114, `/admin` 371 → 441 (no change).

- **After cuts server time on every signed-in workspace page by 2–4×**, and the RSC soft navigation on `/b2b` by about 7×.
  `/admin` is unchanged at about 400 ms, because its middleware still asks GoTrue over the network (`getUser()`, by design for
  immediate revocation) and the page runs about 27 PostgREST requests.
- **Redis cache (`REDIS_CACHE_ENABLED=true`, local Redis on :6390, `REDIS_KEY_ENV=perf-2ibvgs`).** It saves another
  5–40 ms p50 on workspace pages and narrows p95. The Redis run happened at a slightly lower load (6–7), so treat the gain as
  "small and positive", not exact. `/api/health` reports `cache: ok` with Redis on and `cache: disabled` with it off.

## 3. DB load per page load (pg_stat_statements delta, divided by 12 requests)

Only the `authenticated` and `anon` roles are counted. PostgREST runs `pgrst_hooks.pre_request()` once per request, so its call count equals the
number of PostgREST requests a page makes.

| Page | PostgREST requests / page (before → after → after+Redis) | DB exec ms / page (before → after → after+Redis) | Heaviest statement (after) |
|---|---|---|---|
| `/` | 0 → 0 → 1 | 0 → 0 → 2 | none (the landing page is static apart from the session read) |
| `/home` | 27 → 19 → 18 | 48 → 23 → 24 | `admin_my_access()`, 2 calls/page, ≈ 3 ms each |
| `/showroom/home` | 41 → 34 → 31 | 230 → 168 → 156 | **`showroom_home_metrics(p_org_id, p_from, p_to, p_timezone)`: 2 calls/page, ≈ 28 ms each (55 ms/page)** |
| `/showroom/catalog` | 22 → 20 → 17 | 52 → 89 → 38 | `my_organization_application_slot()`: 13–27 ms per call |
| `/showroom/catalog/[id]` | 23 → 20 → 18 | 55 → 55 → 42 | `my_organization_application_slot()`: ≈ 13 ms |
| `/p/[profileId]` | 3 → 4 → 4 | 3 → 9 → 13 | `public_profile_reviews` select: ≈ 3 ms |
| `/admin` | 32 → 27 → 26 | 104 → 102 → 88 | `users` admin list select: ≈ 9 ms
| `/b2b` | 30 → 23 → 23 | 45 → 23 → 20 | `admin_my_access()` ≈ 4 ms; organization name select ≈ 3 ms |

- The after branch removes 5–8 PostgREST round trips from every workspace page. That fits the TTFB drop.
- **Fan-out is still high.** A workspace page makes 17–34 PostgREST requests, and each one also runs `pre_request`, which costs
  0.3–0.5 ms of DB time per request. On a Supabase Free (Nano) shared CPU, that request count matters more than the
  milliseconds per statement.
- `admin_my_access()` runs twice per page on Home (24 calls for 12 loads). A per-request `cache()` would remove one call.

## 4. Media

- **Landing hero:** a 1.59 MB source PNG served through `next/image` as WebP at quality 75: `w=1200` on mobile (72 KB,
  because `sizes="100vw"` × DPR 2.75 rounds up to 1200) and `w=1920` on desktop (115 KB). It is the mobile LCP element. A throttled mobile
  waterfall (after build, run alone at load 5) shows **why it arrives late**. The hero request starts at 214 ms but does not finish until **2,784 ms**,
  because the 1.6 Mbps link is shared at the same moment with six preloaded font files (160 KB, done by about 1.27 s), **the logo
  `/preview/landing/aladdin-logo.png` fetched at `w=1920` (104 KB, `priority` with no `sizes`, for a small logo)**, four CSS files and
  about 330 KB of JS. The largest chunk, `772-*.js` (141 KB transferred, 523 KB raw), holds the i18n catalog for **both** English and Arabic, every module's strings, plus the `Intl` formatters, and the landing page loads all of it. In that run FCP was 1,444 ms and LCP 2,812 ms.
- **Product and catalog images** in the seed are small SVGs (2–9 KB per page), so production photos will weigh more. No seeded
  product photo exists (`product_images` is empty), so the `/api/media/product` path could not be timed. The private-media
  auth gate itself (`/api/media/avatar`, ending in a 404 miss) costs about 110 ms p50, almost all of it the GoTrue `getUser()` round trip.
- **Video:** delivery is off locally, so only the database decision behind every playlist and segment was measured (§5).

## 5. Segment authorization load test — `public.media_edge_video(...)`

Signature: `media_edge_video(p_video uuid, p_viewer uuid, p_session uuid, p_workspace uuid, p_expires_at timestamptz) returns jsonb`.
The media Worker calls it once **for every** HLS playlist and segment request (no caching, so revocation is immediate).

**Setup.** `pgbench` ran inside the local DB container as the `media_edge` role (`PGOPTIONS='-c role=media_edge'`), with
prepared statements, for 30 s per level. The fixtures (`scripts/perf/segment-auth-fixture.sql`) were three ready `r2_hls` rows with ids
`0e7fa000-…` and one live `auth.sessions` row. All four were **deleted afterwards** (`segment-auth-cleanup.sql`; a check showed 0 rows left).
The three cases:

- **anon**: a public portfolio video, no viewer (checks the `profile_public_directory` join).
- **owner**: a private portfolio video seen by its signed-in owner (checks account active and session live).
- **product**: a product video seen by a signed-in non-member (`product_is_public` + `product_image_viewable`). This is the heaviest path.

| Case | Clients | Throughput (auth/s) | p50 ms | p95 ms | p99 ms | max ms | Failed | load1 |
|---|---|---|---|---|---|---|---|---|
| anon | 1 | 1,088 | 0.69 | 1.88 | 4.86 | 39 | 0 | 6.5 |
| anon | 5 | 3,540 | 0.87 | 3.95 | 9.27 | 99 | 0 | 8.4 |
| anon | 10 | 3,635 | 1.76 | 8.20 | 17.15 | 98 | 0 | 12.1 |
| anon | 20 | 3,457 | 3.80 | 17.32 | 31.34 | 165 | 0 | 17.1 |
| owner | 1 | 2,398 | 0.32 | 0.73 | 2.36 | 28 | 0 | 11.6 |
| owner | 5 | 12,197 | 0.30 | 0.87 | 1.44 | 186 | 0 | 12.7 |
| owner | 10 | 11,268 | 0.76 | 1.86 | 3.61 | 102 | 0 | 13.4 |
| owner | 20 | 9,460 | 1.42 | 6.06 | 12.54 | 179 | 0 | 18.3 |
| product | 1 | 416 | 2.02 | 3.85 | 6.75 | 75 | 0 | 13.4 |
| product | 5 | 1,244 | 2.79 | 9.80 | 18.84 | 139 | 0 | 12.0 |
| product | 10 | 1,141 | 6.69 | 21.67 | 37.17 | 300 | 0 | 13.5 |
| product | 20 | 1,057 | 14.68 | 50.12 | 91.72 | 273 | 0 | 16.9 |

Throughput saturates at about 5 connections (4 vCPUs, which pgbench and the other agents share). Above that, more
connections only add queueing latency. There were no errors at any level.

**Where the time goes** (2,000-call loops inside one transaction): `app.product_image_viewable` ≈ **0.96 ms**,
the `profiles` ⋈ `profile_public_directory` public check ≈ 0.45 ms, `app.product_is_public` ≈ 0.25 ms,
`app.jwt_session_is_live` ≈ 0.02 ms, and `app.account_is_active` ≈ 0.01 ms.

### Extrapolation to the hosted limits

Request model: HLS with 4 s segments means about **0.25 requests per second per viewer** (one segment every 4 s), plus a few playlist fetches at start.
ADR-0020 counts about **80 Worker requests and 80 DB decisions for a 5-minute view**. One request is one Worker invocation and one Hyperdrive query.

| Limit (checked on 2026-10-19 in the Cloudflare and Supabase docs) | Value | What it allows |
|---|---|---|
| Workers Free requests | 100,000 / day (resets 00:00 UTC) | **≈ 1,250 five-minute views/day** ≈ 111 viewer-hours/day ≈ **4.6 concurrent viewers averaged over 24 h** |
| Hyperdrive Free queries | 100,000 / day (resets 00:00 UTC) | the same 1,250 views/day: one query per request, so both caps are hit at once |
| Hyperdrive origin connections | ≈ 20 per config (Free), ≈ 100 (Paid) | not binding: the decision saturates at about 5 connections |
| Workers Free CPU | 10 ms per request | not measured; the Worker's ticket check plus a DB round trip is mostly wait time, but verify with `wrangler tail` |
| Supabase Free compute | Nano: shared CPU, ≤ 0.5 GB RAM, 60 direct connections, 200 pooler clients | see below |

**Database ceiling (estimate, unverified).** Locally, 4 busy vCPUs sustained about 1,100–1,250 decisions/s on the
product path and about 3,500/s on the public path. A shared-CPU Nano instance is assumed here to reach **⅛ to ¼** of that. This assumption
was not measured, so test it on staging before relying on it. On that assumption, Nano handles about **140–310 product decisions/s ≈ 550–1,250
concurrent viewers** (or ≈ 1,750–3,500 for public portfolio videos). That ceiling is shared with all other app traffic on the same database.

**Conclusion.** On the free tiers, **the daily request caps bind long before the database does.** At ~1,250 five-minute views/day,
a single popular video exhausts the Worker and Hyperdrive budgets. Requests over the cap fail, so the next segment is refused. That is
the free-tier limit. Workers Paid ($5/month: 10 M requests/month included, Hyperdrive queries unlimited) moves the binding
limit to the database: about 550+ concurrent viewers on the product path at Nano size, more with a larger compute add-on.

## Pages that miss a target, and why

| Page | Target missed | Likely cause |
|---|---|---|
| **Landing (mobile)** | LCP 2.96 s (before 3.38 s) vs 2.5 s | The LCP element is the hero `next/image` (72 KB). It arrives at about 2.8 s, because it downloads alongside the logo, which is preloaded at `w=1920` (104 KB, `priority` with no `sizes`), 160 KB of preloaded fonts (four families, Arabic subsets included, on the English page), 70 KB of CSS and about 330 KB of JS, all over 1.6 Mbps. TBT is about 470 ms (hydration of the whole page, including the catalog chunk below). |
| Showroom product (mobile) | passes, but at 2.04 s with runs up to 2.33 s | It is close to the limit: the product image's LCP comes after the TTFB, CSS and fonts. Real photos (heavier than the demo SVGs) are likely to push it over. |

INP and CLS pass on every page in both builds.

## Proposed fixes

These are proposals only, and none is implemented. They are in priority order.

1. **Landing LCP (the one failing page).** Clear the critical path for the hero. Give the logo `next/image` a real
   `sizes` (or width) and drop its `priority`: today it downloads 104 KB at `w=1920` in parallel with the hero. Preload only the
   fonts the current locale uses. Today all four families, Arabic subsets included, are preloaded (160 KB) on **every** page, which also slows every
   mobile FCP. Stop shipping the full bilingual message catalog (`772-*.js`, 141 KB) to every client: send only the active locale and the namespaces the route uses. It also loads on `/auth/sign-in` and very likely on the workspace pages, which were not checked one by one (it does not load on `/p/[id]`, which sends 111 KB of JS in total), so this helps their FCP and TBT too. Optionally enable AVIF (`images.formats: ["image/avif", "image/webp"]`).
   Expected effect: 250–350 KB less contention before the hero, which is worth roughly 1 s at 1.6 Mbps and enough to clear 2.5 s.
2. **Cut the database fan-out per workspace page.** Call `showroom_home_metrics` once instead of twice (55 ms/page on
   Showroom home). Wrap `admin_my_access()` in a per-request `cache()`, because it runs 2× per page on Home. Look at why `my_organization_application_slot()` (once per showroom page) costs 13–27 ms. Each PostgREST request avoided also saves a `pre_request`
   execution. On Nano's shared CPU, this is the main lever for TTFB once traffic grows. `/admin` TTFB (≈ 400 ms, unchanged)
   is mostly the deliberate GoTrue `getUser()` call plus 27 requests.
3. **Video authorization cost per segment.** Every 4 s segment costs one Worker request and one DB decision. On the free tiers the
   100k/day caps allow about 1,250 five-minute views/day. The options are for the lead or owner to decide:
   (a) longer segments (6 s cuts requests by about 33%); (b) authorize the playlist, then sign short-lived (for example 30–60 s)
   per-rendition segment tickets, which bounds the revocation window instead of making it immediate; (c) move to Workers Paid before
   launching video; and (d) whatever else is chosen, make `app.product_image_viewable` cheaper (≈ 1 ms, about half of the product path's single-client p50 of 2 ms) or precompute
   the public-portfolio flag on `media_videos`.

Secondary: `/b2b` has the largest JS bundle (446 KB transferred, TBT ≈ 670 ms on mobile); code-split its below-the-fold widgets.

## Exact commands

```bash
# worktrees (lead checkout untouched)
git -C /home/claude/aladdin worktree add /home/claude/wt-perf-after origin/claude/video-r2-2ibvgs
git -C /home/claude/aladdin worktree add --detach /home/claude/wt-perf-before origin/main
# in each: cp <local .env.local> frontend/.env.local; pnpm install --frozen-lockfile --prefer-offline; pnpm build
(cd /home/claude/wt-perf-after/frontend  && pnpm exec next start -p 3306) &
(cd /home/claude/wt-perf-before/frontend && pnpm exec next start -p 3307) &

cd /home/claude/wt-perf-after/frontend
export PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
# 1. interleaved lab vitals, 5 runs per page and profile, then the tables
OUT=/tmp/cwv RUNS=5 e2e/perf/run-ab.sh && node e2e/perf/summarize.mjs /tmp/cwv
# 2. server latency
node e2e/perf/server-latency.mjs --base http://127.0.0.1:3306 --label after  --n 25 --out /tmp/lat-after.json
node e2e/perf/server-latency.mjs --base http://127.0.0.1:3307 --label before --n 25 --out /tmp/lat-before.json
# 3. DB load: snapshot pg_stat_statements around each page target (no reset)
node e2e/perf/server-latency.mjs --base http://127.0.0.1:3306 --label after --n 10 \
  --only "page /,page /home,page /showroom/home,page /showroom/catalog,page /showroom/catalog/[id],page /p/[id],page /admin,page /b2b" \
  --pgss /tmp/pgss-after
python3 -I ../scripts/perf/pgss-diff.py /tmp/pgss-after/1-a.tsv /tmp/pgss-after/1-b.tsv 10
# Redis variant: restart :3306 with REDIS_CACHE_ENABLED=true REDIS_URL=redis://127.0.0.1:6390 REDIS_KEY_ENV=perf-2ibvgs
# 5. segment authorization
cd /home/claude/wt-perf-after
docker exec -i supabase_db_aladdin psql -U postgres -v ON_ERROR_STOP=1 < scripts/perf/segment-auth-fixture.sql
scripts/perf/segment-auth-loadtest.sh 30 "1 5 10 20" "anon owner product"
docker exec -i supabase_db_aladdin psql -U postgres -v ON_ERROR_STOP=1 < scripts/perf/segment-auth-cleanup.sql
```

## Related files

- `frontend/e2e/perf/web-vitals.mjs`: lab CWV runner (throttling, observers, scripted interaction).
- `frontend/e2e/perf/run-ab.sh`, `frontend/e2e/perf/summarize.mjs`: the interleaved before/after run and the tables.
- `frontend/e2e/perf/server-latency.mjs`: TTFB/total percentiles, with optional pg_stat_statements bracketing.
- `scripts/perf/pgss-snapshot.sh`, `scripts/perf/pgss-diff.py`: no-reset pg_stat_statements diff.
- `scripts/perf/segment-auth-*.{sql,pgbench,sh}`: fixtures, pgbench scripts, runner and cleanup for the segment-authorization test.
- `docs/decisions/ADR-0020-video-r2-hls.md`: video delivery design and its limits table, which these figures check.
