# Cloudflare Workers frontend: build, preview and configuration

How the Next.js frontend is built and run on Cloudflare Workers ([ADR-0021](../decisions/ADR-0021-cloudflare-workers-frontend.md)). Vercel stays the live host until the owner approves the cutover ([cutover plan](../operations/cloudflare-frontend-cutover-plan.md)). Names only: values live in Cloudflare, the GitHub Environment and the owner's password manager, never in Git.

## Commands (in `frontend/`)

| Command | What it does |
|---|---|
| `pnpm cf:build` | `next build` with the middleware on the Edge runtime, then the OpenNext bundle in `.open-next/` (`scripts/build-cloudflare.mjs`). The Vercel build (`pnpm build`) is unchanged. |
| `pnpm exec wrangler dev --port 8787` | Serves that build in the real Workers runtime (workerd) locally. Reads runtime variables from `frontend/.dev.vars` (gitignored). |
| `pnpm exec playwright test -c playwright.workers.config.ts [spec]` | The E2E suite against the Workers build, local Supabase only. Writes `.dev.vars` from `npx supabase status`. |
| `pnpm exec wrangler deploy --env preview --dry-run --outdir /tmp/w` | Bundles without uploading; prints the size that counts against the 64 MiB limit. |
| `pnpm cf:preview:deploy` | Uploads to the `preview` environment (workers.dev). Needs `CLOUDFLARE_API_TOKEN`. Prefer the manual GitHub workflow `Cloudflare frontend preview`. |

`NEXT_PUBLIC_*` values are compiled into the build, exactly as on Vercel, so each environment is built with its own values.

## Environments (`frontend/wrangler.jsonc`)

| Environment | Worker | Address | Data |
|---|---|---|---|
| (top level) | `aladdin-frontend` | `wrangler dev` only | local Supabase stack |
| `preview` | `aladdin-frontend-preview` | `aladdin-frontend-preview.<account>.workers.dev` | **aladdin-r2-acceptance only** (`nxossqhdfltcqdwvbewi`), acceptance R2 buckets |
| `production` | `aladdin-frontend-production` | none until cutover | live project, after owner approval only |

## Variables and secrets per environment

Build-time (set in the build environment, e.g. the GitHub Environment): `NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_SUPPORT_CONTACT`.

Runtime, on the Worker. Plain values go in `wrangler.jsonc` `vars` or `wrangler deploy --var`; secrets only with `wrangler secret put <NAME> --env <env>`:

| Name | Kind | Notes |
|---|---|---|
| `NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | var | Same values as the build; server code also reads them at runtime. |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** | As on Vercel. |
| `AUTH_PASSWORD_PREVIEW_GRANT_SECRET` | **secret** | As on Vercel. |
| `TURNSTILE_SECRET_KEY` | **secret** | Add the workers.dev hostname to the Turnstile widget and to `TURNSTILE_ALLOWED_HOSTNAMES` (var) for the preview. |
| `BACKEND_ORIGIN` | var | FastAPI origin for `/api/backend/*`, e.g. the Vercel deployment's own URL. `https` only. Unset answers 503 on `/api/backend`. |
| `R2_*`, `MEDIA_EDGE_*`, `VIDEO_ENABLED` | var / **secret** for keys | Same names and approvals as on Vercel ([vercel-environment-variables.md](vercel-environment-variables.md)). Preview: acceptance buckets only. |
| `REDIS_CACHE_ENABLED`, `REDIS_REST_URL`, `REDIS_KEY_ENV` | var | Workers use Upstash's HTTPS interface; a TCP `REDIS_URL` is refused on Workers ([upstash-setup.md](upstash-setup.md)). |
| `REDIS_REST_TOKEN` | **secret** | Full (not read-only) token of the existing database. |

Bindings (in `wrangler.jsonc`, no secrets): `ASSETS` (static files), `IMAGES` (Cloudflare Images: `next/image` and upload variants), `WORKER_SELF_REFERENCE`.

## Cloudflare API token (least privilege)

For the preview upload: **Account → Workers Scripts: Edit** on the Aladdin account only, with an expiry date. Nothing else. Add **Zone → Workers Routes: Edit** on `aladdindecore.com` only at cutover time, when the zone is on Cloudflare. Store it as the `CLOUDFLARE_API_TOKEN` secret of the `cloudflare-preview` GitHub Environment (or in the operator's own shell); never in this repository or in a cloud agent's environment unless the owner chooses to.

## Plan limits that matter

- **CPU:** Workers Free allows 10 ms CPU per request; server-rendered pages need more (see [performance-cloudflare-2026-10-20.md](../operations/performance-cloudflare-2026-10-20.md)). Production on Workers needs **Workers Paid ($5/month)**, which needs owner approval.
- **Requests:** Free is 100,000 a day per account, shared with the media Worker. Static assets are free and unlimited.
- **Size:** 64 MiB uncompressed per Worker; this app is about 32 MiB.
- **Images:** 5,000 unique transformations a month free; after that new transformations fail (error 9422) until the Images Paid plan is bought. Nothing is charged automatically.
