# backend-worker — FastAPI on Cloudflare Containers

The `aladdin-backend` Worker runs the FastAPI service (`backend/Dockerfile`) in a
Cloudflare Container ([ADR-0022](../../docs/decisions/ADR-0022-fastapi-cloudflare-containers.md)).
Nothing here is deployed by CI. Every hosted step needs the owner's approval, and
Containers need the Workers Paid plan.

## How a request gets here

```
browser ── /api/backend/* ──▶ frontend Worker (aladdin-frontend[-env])
                                  │  BACKEND service binding (no public hop)
                                  ▼
                              aladdin-backend[-env]  ── 404 for any other path
                                  │  Durable Object "backend-<n>" (WEUR)
                                  ▼
                              BackendContainer: uvicorn :8000 (FastAPI)
```

This Worker has no workers.dev address and no route, so the binding is the only
way in. Without the binding the frontend falls back to `BACKEND_ORIGIN` (unused today).

## Files

| File | What |
|---|---|
| `src/index.ts` | Worker entry and the `BackendContainer` class (port, sleep, readiness, error mapping) |
| `src/policy.ts` | Pure rules: served paths, the container environment allowlist, the instance pool |
| `test/policy.test.ts` | Unit tests for those rules (Node, no account) |
| `wrangler.jsonc` | Environments `preview` and `production`, container sizing and placement |

## Commands (in this folder)

| Command | What it does |
|---|---|
| `pnpm test` | Unit tests |
| `pnpm typecheck` | Generates `cloudflare-env.d.ts` (gitignored) and type-checks |
| `pnpm bundle` | `wrangler deploy --env preview --dry-run`: bundles the Worker and builds the image with Docker, uploads nothing |
| `pnpm exec wrangler dev --env preview --port 8790` | Worker + container locally (needs Docker). Put test values in `.dev.vars` (gitignored) |
| `pnpm exec wrangler dev -c ../../frontend/wrangler.jsonc -c wrangler.jsonc --env preview` | Frontend and backend together, joined by the binding |

## Variables and secrets

Plain values are in `wrangler.jsonc` `vars`. Secrets only with
`pnpm exec wrangler secret put <NAME> --env <env>`. `secrets.required` makes the
deploy fail while a required one is missing.

| Name | Kind | Preview | Production | Notes |
|---|---|---|---|---|
| `APP_ENV` | var | `staging` | `production` | Required; the container will not start without it |
| `SUPABASE_URL` | var / secret | acceptance project (var) | secret, set at cutover | JWT issuer and JWKS |
| `SUPABASE_ANON_KEY` | secret | required | required | Caller-scoped account and session check |
| `BACKEND_INSTANCES` | var | `1` | `2` | Pool size, 1..8 |
| `REDIS_CACHE_ENABLED` | var | unset | unset | `true` turns Redis on; then `REDIS_URL` must be `rediss://` and `REDIS_KEY_ENV` set (backend refuses to start otherwise) |
| `REDIS_URL` | secret | optional | optional | `rediss://`; job locks only (ADR-0019) |
| `REDIS_KEY_ENV` | var | `cf-preview` | `production` when Redis is on | Separates environments sharing one Redis |
| `ALLOWED_ORIGINS` | var | unset | `https://aladdindecore.com,…` | CORS; the binding path is same-origin anyway |
| `OPENAI_API_KEY` | secret | optional | optional | Only when an AI endpoint ships |
| `SUPABASE_JWT_SECRET` | secret | optional | optional | Legacy HS256 projects only |

Never set `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` or R2 keys on this Worker.
They would not reach the container anyway (`src/policy.ts`), and no request path
needs them.

## Approved-preview checklist (owner runs, or approves an agent to run)

Gates and approvals before this list: [fastapi-preview-prerequisites.md](../../docs/operations/fastapi-preview-prerequisites.md).

1. Acceptance project only (`nxossqhdfltcqdwvbewi`), never `kkpkgjrweysgvhvkhzun`.
2. `pnpm exec wrangler secret put SUPABASE_ANON_KEY --env preview`
3. `pnpm exec wrangler deploy --env preview` (builds and pushes the image to Cloudflare's registry; the first container provisioning takes a few minutes).
4. In `frontend/wrangler.jsonc`, `env.preview.services`, add
   `{ "binding": "BACKEND", "service": "aladdin-backend-preview" }` and redeploy the frontend preview.
5. Check `GET /api/backend/health` on the frontend preview: `{"status":"ok","env":"staging"}`.

Rollback: remove the binding and redeploy the frontend; traffic returns to `BACKEND_ORIGIN`.
