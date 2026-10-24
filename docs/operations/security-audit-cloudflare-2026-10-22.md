# Security audit: Cloudflare Workers frontend (2026-10-22)

**Scope.** The request path for the Workers deployment (ADR-0021, PR #97). It runs Browser → Cloudflare (Worker entry `frontend/cloudflare/worker.ts`, the edge `/_next/image` cache, the `/api/backend` proxy) → Next.js server (OpenNext) or FastAPI → Supabase, R2 and Redis. The owner brief, section 10, sets the scope.

**Method.**
- Code review of the branch `claude/cloudflare-workers-2ibvgs` at `68110d2`.
- A read-only grep of an OpenNext build (`frontend/.open-next`, built 2026-10-22 07:35 UTC from the same branch in the main checkout).
- Unit tests (vitest).

**Not done:**
- No hosted request was made: no Cloudflare, Supabase or Upstash call.
- No local Supabase or pgTAP run.
- No `wrangler dev` run.

Anything marked **hosted test** in the tables below still needs a real request against the preview Worker.

Branch with the fixes: `claude/cf-security-2ibvgs` (not pushed).

## Findings

| # | Severity | Where | Finding | Status |
|---|---|---|---|---|
| F1 | **High** | `frontend/src/server/auth/phone-auth-limit.ts:13`; `frontend/cloudflare/worker.ts` (entry) | **Client IP for the phone sign-in / sign-up throttle is spoofable on Workers, and honest callers share one bucket.** The throttle keys the IP on `x-vercel-forwarded-for`, which only Vercel's edge sets and overwrites. Cloudflare passes a client's own `x-vercel-forwarded-for` through unchanged. On Workers this has two effects. (a) An attacker picks any IP per request, so the per-IP limit no longer applies. (b) Every caller who does not send the header is counted under `ip:unknown`, so one abuser can lock out phone sign-in and sign-up for everyone. The per-phone limit still applied. | **Fixed.** New `src/lib/cloudflare/forwarded-headers.ts`, called first in the Worker entry. It rebuilds `x-vercel-forwarded-for`, `x-forwarded-for` and `x-real-ip` from `cf-connecting-ip`, which Cloudflare always overwrites, and deletes them when that header is absent. Test: `forwarded-headers.test.ts`. **Hosted test:** check on the preview that a spoofed `x-vercel-forwarded-for` does not change the throttle bucket. |
| F2 | Medium | `frontend/src/server/auth/turnstile.ts:92`, `frontend/src/server/actions/entry-oauth.ts:19`, `frontend/src/server/actions/auth-password-preview.ts:237`, `frontend/src/server/video/http.ts:32` | **`x-forwarded-host` and `x-forwarded-proto` are client-controlled on Workers.** Vercel overwrites them; Cloudflare does not. They feed four things: the Turnstile hostname fallback (used when `TURNSTILE_ALLOWED_HOSTNAMES` is unset), the OAuth `redirectTo`, absolute URLs in the password flows (email links), and the video same-origin check. A browser cannot set this header cross-site, so CSRF is not opened, but a scripted caller can. Supabase's redirect allowlist is the remaining guard for email and OAuth links. `turnstile.ts:190` also took the first `x-forwarded-for` entry, which a client can prepend on Cloudflare. That value is only an advisory `remoteip` hint. | **Fixed** by the same entry step: `x-forwarded-host` and `x-forwarded-proto` are set from the URL the request was addressed to. Test: `forwarded-headers.test.ts`. Keep `TURNSTILE_ALLOWED_HOSTNAMES` set on every Worker environment (already in `docs/guides/cloudflare-frontend.md`). **Hosted test:** check the Supabase redirect allowlist has no broad wildcard. |
| F3 | Medium | `frontend/src/lib/cloudflare/backend-proxy.ts:48` | **The `/api/backend` proxy forwarded the browser's `Cookie` header to `BACKEND_ORIGIN`.** That header holds the Supabase session, including the refresh token, and on Workers `BACKEND_ORIGIN` is a different origin from the app. FastAPI reads only `Authorization` (`backend/app/auth/__init__.py:122`). | **Fixed:** the cookie is dropped before forwarding. Test: `backend-proxy.test.ts` (updated). |
| F4 | Medium | `frontend/next.config.ts` (both hosts) | **No clickjacking or MIME-sniffing protection on app pages.** Neither host sent `X-Frame-Options`/`frame-ancestors` or `X-Content-Type-Options`, so another site could frame the sign-in page or Server Action forms. | **Fixed:** `next.config.ts` `headers()` adds `X-Frame-Options: SAMEORIGIN` and `X-Content-Type-Options: nosniff` on `/:path*`, from `src/lib/security/response-headers.ts`. Test: `response-headers.test.ts`. The app frames only other sites (OpenStreetMap, Turnstile). **Hosted test:** confirm that OpenNext emits the headers on Workers (`curl -I`). |
| F5 | Medium | `frontend/src/server/cache/rate-limit.ts:43` | **On Workers the rate limits (`media-read`, `media-upload`, `video-part`) are per isolate unless the Upstash REST variables are set.** Workers run many isolates, so the memory fallback allows roughly N × the limit. ADR-0019 already notes this weakness, but on Workers N is larger and changes more often. | Documented. Set `REDIS_REST_URL`, `REDIS_REST_TOKEN` and `REDIS_CACHE_ENABLED=true` on the preview and production Workers before cutover. **Hosted test:** `/api/health` reports `cacheMetrics.transport: "rest"`. |
| F6 | Low | `frontend/src/server/cache/reference.ts:31,55` | **A module-level in-flight promise is shared across requests.** On Workers, request B can await a load started by request A's I/O. If request A is cancelled, B fails. workerd also warns about promises settled from another request context. The data is global reference vocabulary (`is_active` filtered, ADR-0019), so this is a reliability issue and nothing leaks. | Documented. Suggested fix: on Workers, scope the in-flight map per request (React `cache()`), or drop it. |
| F7 | Low | `frontend/cloudflare/worker.ts:52,56` | **Edge image cache: the key keeps every query parameter, and hits return the edge `Cache-Control`.** Extra junk parameters create extra cache entries and extra transforms (cache bloat; the Images unique-transform count is per source and options). A hit sends browsers `public, max-age=86400` instead of the intended 1 hour. Neither affects private data. | Documented. Not changed, to keep `worker.ts` edits minimal while PR #98 is in flight. Suggested fix: build the key from `url`, `w` and `q` only, and set `IMAGE_BROWSER_CACHE` on hits. |
| F8 | Low | `frontend/src/lib/env/index.ts:35` (bundled into client chunks such as `1413-*.js` and `app/b2b/layout-*.js`) | **The server-env Zod schema (variable *names* only) ships in browser chunks**, because `lib/env/index.ts` is shared with client code. No values are present (see "Verified OK"). | Documented. Suggested fix: split the server schema into a `server-only` module. |
| F9 | Low (load) | `frontend/src/app/api/media/[namespace]/route.ts:39`, `frontend/src/server/storage/delivery.ts:24,32` | **Private media read cost per image.** Each read makes one Auth `getUser`, one rate-limit command, and 4 `resolveMedia` RPCs for owner media: before and after the stream, plus the `owner` callback twice, which runs `resolveMedia` again. The before/after re-check is a deliberate time-of-check/time-of-use guard. The owner callback could reuse `before.owner` and save 2 RPCs per image. | Documented. ADR-0018 removes this cost for R2 rows once edge delivery is on. |
| F10 | Info | `frontend/src/lib/supabase/server.ts` (cookie options) | **Session cookies are readable by JavaScript** (not HttpOnly), as `@supabase/ssr` requires. An XSS would expose the refresh token, and there is no Content-Security-Policy. | Documented. A CSP needs a nonce strategy for Next's inline scripts, which is a separate change. |
| F11 | Info | `frontend/cloudflare/worker.ts:29` | HSTS is `max-age=63072000` without `includeSubDomains` or `preload`, the same as Vercel's default. | No change. `includeSubDomains` waits until every subdomain (including `media.`) is HTTPS-only on Cloudflare. |
| F12 | Info | `frontend/cloudflare/worker.ts` (entry) | `withPlatformForwardedHeaders` builds a new `Request` from the incoming one. workerd keeps the body. Whether `request.cf` is carried over has not been checked; the app does not read it. | **Hosted test:** run a smoke test after deploy (sign-in, a Server Action POST, an upload). |

## Verified OK (with evidence)

- **Edge `/_next/image` cache cannot hold private or authenticated media.**
  - `next.config.ts` allows only static directories (`localPatterns`, `search: ""`) and declares no `remotePatterns`.
  - In the built `.open-next/cloudflare/images.js`, `handleImageRequest` enforces `hasLocalMatch`/`hasRemoteMatch`. The remote list is `[]`.
  - Local sources are fetched with `env.ASSETS.fetch` (static assets only, no cookies, never an app route). An `/api/media` or `/p/media` URL therefore cannot reach the optimizer, even with `..` segments, because the compiled patterns reject dot segments.
  - The cache key carries no user input other than the URL and `Accept`, and only `200` responses are stored.
- **Private media is authorized on every request.**
  - `/api/media/[namespace]` calls `auth.getUser()` (Auth server) on every read, then runs RLS-scoped `resolveMedia` before and after streaming.
  - `/p/media/[itemId]` re-checks publication before and after.
  - Both send `no-store, private` and `cdn-cache-control: no-store`, which Cloudflare honours.
  - Neither forwards upstream ETag, Set-Cookie or Location headers (`delivery.ts`).
  - Neither route is cached by the Worker: only `/_next/image` goes through the Cache API.
  - OpenNext uses no incremental cache (`open-next.config.ts`), and pages are `force-dynamic`.
  - **Hosted test:** confirm that no zone Cache Rule ("cache everything") is added at cutover.
- **The service-role key is not reachable by the browser.**
  - `lib/supabase/admin-server.ts` and `phone-auth-limit.ts` import `server-only`.
  - The built client assets (`.open-next/assets`) contain only the schema *names* (F8) and supabase-js's `sb_secret_` prefix check. They contain no `sb_secret_…` value and no service JWT. The only JWT found is the public local-demo `anon` key.
  - Caveat: that build used local values. A hosted build should be re-grepped in CI.
- **No open proxy or SSRF via `BACKEND_ORIGIN`.**
  - `backendOrigin()` accepts only a bare `https` origin (or loopback `http` in `local`), with no path or credentials.
  - The forwarded path always starts with `/api/backend`, so its host cannot change.
  - `redirect: "manual"`.
  - `global_fetch_strictly_public` is on in `wrangler.jsonc`.
  - Tests: `backend-proxy.test.ts`.
- **Session revocation.**
  - `db_pre_request` refuses ended sessions on every PostgREST request (migrations `20261021090013_data_api_session_revocation.sql` and `20261021090014_storage_realtime_session_revocation.sql`).
  - The middleware calls `my_account_status` on product surfaces and clears stale cookies.
  - Admin paths use `getUser()`.
  - The media proxy uses `getUser()` per read.
  - FastAPI's `require_active_principal` checks the session per request.
  - Code-reviewed only. The pgTAP and E2E proofs referenced in ADR-0018 were not re-run here. **Hosted test:** sign out everywhere, then the next page, media and backend request must each be refused.
- **Turnstile** is verified server-side with fail-closed handling, an action and hostname check, and refusal of a testing key outside `local` (`turnstile.ts`, existing tests). F2 hardens the hostname fallback.
- **Cross-tenant leakage in server state.**
  - `getServerSupabase` is per-request (`cache()`), with no module-level clients.
  - The module-level maps hold only rate-limit counters (keyed by user), metrics, format caches and the global reference in-flight map (F6).
  - Redis holds no authorization decision (ADR-0019).
- **DB connections.**
  - The frontend Worker opens no Postgres connection: everything goes over HTTPS (PostgREST, Auth, Storage).
  - `wrangler.jsonc` binds no Hyperdrive.
  - Redis on Workers is REST (stateless); TCP is refused (ADR-0019 Workers revision).
- **Duplicate queries per navigation.** The middleware makes at most a token refresh, plus `my_account_status`, plus `getUser` on admin paths. Server Components share one client per request. Further per-page counts are in ADR-0019 Revision 2 and were not re-measured here.
- **RLS and least privilege** were not re-audited policy by policy in this pass. The repo's pgTAP suite is the authority, and it was not run (no local Supabase).

## Changes in this branch

| File | Change |
|---|---|
| `frontend/cloudflare/worker.ts` | 3 lines: import and call `withPlatformForwardedHeaders` on the incoming request. **Overlaps PR #98**, which passes `env.BACKEND`. |
| `frontend/src/lib/cloudflare/backend-proxy.ts` | 3 lines: `headers.delete("cookie")`. **Overlaps PR #98**, which adds an optional `binding`. |
| `frontend/src/lib/cloudflare/backend-proxy.test.ts` | The cookie is now expected to be dropped. |
| `frontend/src/lib/cloudflare/forwarded-headers.ts` and its `.test.ts` | New. |
| `frontend/next.config.ts`, `frontend/src/lib/security/response-headers.ts` and its `.test.ts` | Baseline security headers. |
