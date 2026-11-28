# Auth session reads per request (WP8)

Status: implemented on `local/wp-auth` (2026-10-18), not deployed. No hosted setting was changed. Sign-in, sign-up, OTP, password and OAuth flows are unchanged; only how an existing session is read per request changed.

Source evidence: `/mnt/project-files/showroom-admin/supabase-usage-audit.md` (finding 3: `GET /auth/v1/user` was ~94% of `auth_logs` rows and 30–45% of `edge_logs` rows) and `r2-delivery-architecture.md` §8.

## What changed

| Where | Before | After |
|---|---|---|
| `src/middleware.ts` | `auth.getUser()` (Auth request) on every non-static request | `auth.getClaims()`: local ES256 verification against the cached JWKS. `/admin` and `/admin/**` still call `auth.getUser()`. |
| Middleware `my_account_status` RPC | Every product-surface request | Every product-surface request except router prefetches (`next-router-prefetch`, `Sec-Purpose`/`Purpose: prefetch`, GET/HEAD only) |
| Middleware matcher | Ran on `/api/media/*`, `/p/media/*`, fonts, css/js, txt/xml | Skips them. Media routes authorize every request themselves through the caller's client (RLS). |
| `server/auth/session.ts` | Uncached `getCurrentUser()` | `getSessionIdentity()` / `readSessionIdentity(client)`: `cache()`d `getClaims()` identity `{ id, email, phone, sessionId, expiresAt }`. `getCurrentUser()`: `cache()`d `getUser()`, network-validated. |
| Read-only loaders (`server/queries/{context,identity,onboarding,trades,registration,platform,business-setup,personal-home,activities,sales-persona,professional-profile}.ts`, `b2b/activity`) | One `getUser()` each, no dedupe | `readSessionIdentity(supabase)`: one local verification per render |
| `api/media/[namespace]` (private media proxy) | `getUser()` per image | Still `getUser()` per image (changed back in `26edd40`), so that sign-out, a ban or session revocation denies the next read. The edge Worker makes the same check in the database, so this call ends for R2 rows once `MEDIA_EDGE_DELIVERY_ENABLED=true` ([ADR-0018](../decisions/ADR-0018-r2-edge-media-delivery.md)). |
| Admin (`server/authorization/admin.ts`, `/admin/users`, `/admin/users/[id]`, `/admin/staff`, `/admin/settings`) and account-settings pages (`/home/settings`, `/b2b/settings`, showroom settings) | Several `getUser()` per render | One shared `getCurrentUser()` per render (still network-validated) |
| Server Actions (password, email, phone, secondary phone, sign-out, registration, invitations, availability, service areas, portfolio, professional assets) | `getUser()` | Unchanged: always network-validated |

`getClaims()` (auth-js 2.111) reads the session from cookies, refreshes it through the same cookie adapter when the access token is expired (the only Auth request it makes), then verifies signature and `exp`. With a symmetric (HS256) key it falls back to a network `getUser()` itself, so a project that is not on asymmetric keys keeps today's behaviour and cost. The hosted project signs ES256 with a `kid` (audit). The JWKS is cached in-process for 10 minutes (`JWKS_TTL`).

## Auth requests per page load (from code)

Counted as `GET /auth/v1/user` calls for one full navigation by a signed-in user with a fresh token.

| Route | Before | After |
|---|---|---|
| `/home` (personal) | 8 (middleware 1; layout: mandatory-setup 2, sales persona 1, personal home 1, header identity 1; page: registration state 1, admin check 1) | 0 |
| `/b2b/*` (non-Showroom org) | 3 (middleware, workspace context, header identity) | 0 |
| Showroom frame pages | 3 | 0 |
| `/home/settings` | 9 | 1 (`loadMyIdentity` shares the cached `getCurrentUser()` since `73b1a75`) |
| `/admin/users` | 3 | 2 (middleware + one shared `getCurrentUser`) |
| Each RSC navigation or prefetch | ≥ 1 | 0 |
| Each private image via `/api/media` | 2 | 1 (`26edd40`); 0 through the edge Worker |

Token refresh adds about one Auth request per active session per `jwt_expiry`. That is unchanged.

## Why suspension and session revocation stay enforced

1. **Data authority never depended on the middleware call.** PostgREST, RLS (`auth.uid()`) and every RPC verify the same JWT locally on each request and never ask the Auth server. A revoked session's access token was already accepted by the database until `exp` before this change.
2. **Suspension is a database rule, not an Auth rule.** `my_account_status` still runs in middleware on every non-prefetch product-surface request, including every Server Action POST. `app.account_is_active`, `has_capability`, `is_org_member` and `require_verified_caller` refuse a suspended caller. Suspension takes effect at once, with no JWT-expiry window. **Caveat (unchanged by this work):** the PostgREST `db_pre_request` hook is disabled in Production ([POSTGREST_PRE_REQUEST_HOOK.md](../admin/POSTGREST_PRE_REQUEST_HOOK.md)). Applying `20260930100005` remains the strongest guard and needs owner approval.
3. **Prefetch skip.** A prefetch is a GET that mutates nothing. Dynamic segments are not served from a prefetch (default `staleTimes.dynamic = 0`, no `prefetch={true}` in the app). The real navigation that follows runs the status check before the page renders. Spoofing the header gains a suspended user nothing beyond what direct Data API calls with their JWT already allow, because middleware is routing and not the data boundary.
4. **Admin and account-security paths are still network-validated.** `/admin/**` middleware, `loadAdminAccess`, admin pages, account-settings pages and every privileged Server Action call `getUser()`. A session revoked by sign-out-everywhere, a ban or a deletion is refused there immediately.
5. **Expiry bound.** `supabase/config.toml` sets `jwt_expiry = 3600`. The hosted value is 3600 (audit and `r2-delivery-architecture.md` §8). Refresh-token rotation is on, so a revoked session cannot refresh past `exp`.

**Residual window:** after sign-out-everywhere, a ban or a deletion, a still-unexpired access token can keep navigating **non-admin** pages for at most `jwt_expiry` (≤ 1 h). It can still read only what RLS already allowed it to read. Admin pages and privileged mutations reject it at once.

**Recommendation (hosted change, owner approval):** lower hosted `jwt_expiry` to 1800 s. That halves the window and adds about one refresh per active session per hour, still far fewer Auth requests than before. 900 s is the floor worth considering.

## Call sites deliberately unchanged

- Sign-in / sign-up / finish-registration / suspended pages and `server/actions/{auth,auth-password-preview,registration,invitations}.ts`, `server/auth/phone-password.ts`: these are auth flows owned by the sign-in thread, or they are mutations.
- Media-owned files: `server/queries/profile-identity.ts` (`loadMyIdentity`) now uses the shared `getCurrentUser()` (`73b1a75`), so it stays network-validated without a second call. `server/actions/professional-assets.ts` stays on `getUser()` (mutation).

## Tests

`src/middleware.test.ts` (22), `src/server/auth/session.test.ts` (6), `src/server/auth/request-gate.test.ts` (6). They cover:
- a suspended account is still blocked, including a POST that carries a prefetch header;
- a missing, invalid or forged JWT redirects as before, with `next` preserved;
- verification failures fail closed;
- anon and service-role tokens are rejected;
- cookie refresh is carried onto the response;
- `/admin` uses `getUser()` and rejects a revoked session that still verifies locally;
- prefetch skips only the RPC;
- the matcher exclusions;
- the per-request dedupe of both helpers.
