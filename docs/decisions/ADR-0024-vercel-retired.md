# ADR-0024 — Vercel retired: Cloudflare Workers host the web app and FastAPI

**Status:** Accepted · 2026-10-28 · owner decision ("Remove Vercel fully now", 2026-10-28 07:47Z)

**Supersedes:** [ADR-0009](ADR-0009-vercel-services-deployment.md) (Vercel Services hosts both services). **Completes:** [ADR-0021](ADR-0021-cloudflare-workers-frontend.md) (frontend on Workers) and [ADR-0022](ADR-0022-fastapi-cloudflare-containers.md) (FastAPI on Cloudflare Containers). [ADR-0001](ADR-0001-approved-architecture.md) is unchanged.

## Context

- 2026-10-27: the `aladdindecore.com` zone moved to Cloudflare (stage 10). At 17:40Z `aladdindecore.com` and `www` were attached as Custom Domains to the Worker `aladdin-frontend-production`, which binds `aladdin-backend-production` (FastAPI) as `BACKEND` (stage 12). The owner's 60-minute watch found no errors.
- The cutover plan kept Vercel as the rollback for a monitoring period before retiring it ([stages 13 to 15](../operations/cloudflare-frontend-cutover-plan.md)). On 2026-10-28 the owner chose to retire Vercel at once instead, knowingly giving up the quick rollback.

## Decision

1. **Hosting.** Next.js runs on Cloudflare Workers (OpenNext, `frontend/wrangler.jsonc`); FastAPI runs on Cloudflare Containers (`edge/backend-worker`), reached only through the `BACKEND` service binding, same-origin at `/api/backend`. Supabase is unchanged.
2. **Deploys.** Production: the manual `Cloudflare production` workflow (`.github/workflows/cloudflare-production.yml`), backend first. Preview: `cloudflare-frontend-preview.yml` and `cloudflare-backend-preview.yml` on the Acceptance project. Migrations are pushed to each Supabase project by the owner before the matching deploy.
3. **Removed from the repository:** `vercel.json`, `.github/workflows/deploy-staging.yml` (Vercel promotion pipeline), `scripts/vercel-deploy.mjs` and its tests, the two Supabase link/pooler diagnostics that only that workflow ran, `docs/guides/vercel-environment-variables.md`, and the `.vercel/` ignore rule.
4. **Removed by the owner (dashboard):** the Vercel project `aladdin-staging` with its domains, deployments and variables; the Vercel GitHub app on this repository; the `*` CNAME to Vercel in the Cloudflare zone.

## Rollback

There is no quick rollback to Vercel. A Worker problem is rolled back on Cloudflare (Deployments → roll back to a previous version). Recreating Vercel would be a fresh setup from the variable names below.

Vercel production variable names at retirement (names only): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_PASSWORD_PREVIEW_GRANT_SECRET`. Preview also had `APP_ENV`, `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `DATABASE_URL`.

## Consequences

- One platform for the web app, FastAPI, media and DNS.
- The migration-first promotion pipeline (`deploy-staging.yml`) is gone; until a Cloudflare equivalent exists, the owner pushes migrations before each production deploy.
- Follow-up done 2026-10-28: `backend/app/config.py` no longer reads `VERCEL_ENV`; code comments and current guides describe Cloudflare; the unused `scripts/main-head-check.mjs` (a Vercel-promotion guard) is removed. Dated reports, the work log, earlier ADRs and runbooks marked historical still mention Vercel on purpose. The internal header name `x-vercel-forwarded-for` is kept: the frontend Worker rebuilds it from `cf-connecting-ip` on every request.
