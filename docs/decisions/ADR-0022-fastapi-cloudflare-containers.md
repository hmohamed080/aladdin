# ADR-0022 — FastAPI backend on Cloudflare Containers, behind a service binding

**Status:** Proposed · 2026-10-22 · owner brief "complete Aladdin's infrastructure migration from Vercel to Cloudflare … FastAPI" (section 8: prefer Cloudflare Containers, evaluate Python Workers, a managed container only as a fallback). **Needs owner approval** for every hosted step: the preview deploy, Workers Paid (already required by [ADR-0021](ADR-0021-cloudflare-workers-frontend.md)), the production deploy and the cutover.

**Refines:** [ADR-0009](ADR-0009-vercel-services-deployment.md) (Vercel Services hosts both services) for the **backend**, as ADR-0021 did for the frontend. After cutover FastAPI runs in a Cloudflare Container; until then Vercel keeps serving it and stays the rollback. **Supersedes in part** [ADR-0021](ADR-0021-cloudflare-workers-frontend.md): its "FastAPI stays on Vercel" and "Not decided here: the FastAPI migration" lines are decided here; the rest of ADR-0021 stands. [ADR-0001](ADR-0001-approved-architecture.md) is unchanged: FastAPI is still the specialized AI/document/worker service, not the CRUD backend, and the app code is the same on every host.

## Decision

1. **Host: Cloudflare Containers** (`default` scheduling policy, `@cloudflare/containers` 0.3.7). The image is the existing `backend/Dockerfile`; nothing in the app is Cloudflare-specific except one fail-closed environment rule (5).
2. **One Worker, `aladdin-backend` (`edge/backend-worker/`),** owns the container class `BackendContainer`. It serves `/api/backend/*` only (404 JSON otherwise) and forwards each request unchanged to uvicorn on port 8000.
3. **No public hostname.** `workers_dev` is off and there are no routes in any environment. The frontend Worker calls it through a **`BACKEND` service binding**; `proxyToBackend` prefers the binding and falls back to `BACKEND_ORIGIN` (Vercel) when unbound. A binding call never leaves Cloudflare and costs no extra request fee.
4. **Least privilege into the container.** Only an allowlist of request-path variables is copied in (`APP_ENV`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, legacy `SUPABASE_JWT_SECRET`, `ALLOWED_ORIGINS`, `REDIS_URL`, `REDIS_KEY_ENV`, `OPENAI_API_KEY`). The service-role key, `DATABASE_URL` and R2 keys are never copied, even if bound to the Worker: no request path uses them (`Settings.missing_configuration`). The historical-media purge keeps running from an operator machine; video transcoding is a separate container owned by the media thread (`backend/cloudflare/transcode/`), not this one.
5. **Never `local` when deployed (two locks).** The Worker refuses to start a container without `APP_ENV` in `local|staging|production`. The backend treats a Cloudflare container (`CLOUDFLARE_APPLICATION_ID`, set by the runtime) with `APP_ENV` unset or `local` as production, the same rule it already applies to `VERCEL_ENV`. So a deployed backend always checks its configuration and refuses authenticated calls when it is incomplete.
6. **Sizing and placement.** `basic` instance (1/4 vCPU, 1 GiB, 4 GB disk), placement `WEUR` and Durable Object `locationHint: "weur"` (Supabase is in eu-west-3, Paris). A fixed pool of named instances (`BACKEND_INSTANCES`: preview 1, production 2) with random routing, since the app is stateless; `max_instances` 2 (preview) / 4 (production). `sleepAfter = "10m"`: an idle instance stops and costs nothing.
7. **Image changes (all hosts):** bytecode compiled at build time (`UV_COMPILE_BYTECODE=1`, `compileall app`), uv pinned and installed from PyPI instead of `ghcr.io/astral-sh/uv:latest`, the Docker health check on the real path (`/api/backend/health`; `/health` was a 404), uvicorn `--timeout-graceful-shutdown 30` for Cloudflare's SIGTERM on rollouts.

## Options evaluated

| | Cloudflare Containers (chosen) | Python Workers | Managed container (fallback) |
|---|---|---|---|
| Runs the app as is | Yes, same image | No: Pyodide build, `workers.asgi` entry, every dependency must be pure Python or Pyodide-built | Yes, same image |
| Dependencies | All (supabase-py, pyjwt[crypto], redis TCP, openai; future OCR/PDF native libs) | `supabase` pulls realtime/websockets and httpx transports; redis over TCP is "most operations"; native OCR/PDF libraries impossible | All |
| Long or heavy work | Yes (no request CPU cap; 15 min SIGTERM grace) | Per-request CPU limit, 128 MB isolate | Yes |
| Network path from the frontend Worker | Service binding, no public hostname | Service binding | Public origin (or a tunnel) |
| Billing | Workers Paid (already needed for the frontend) | Workers Paid | A second vendor and bill |
| Cold start (measured, see below) | 4.5 s on `basic` | Not measured (Pyodide snapshot + FastAPI import) | Vendor-dependent |

**Python Workers** were rejected on paper: the backend must keep one codebase that runs locally, in CI, on Vercel until cutover and in containers; Python Workers would fork its dependency set and entrypoint, rule out the planned OCR/document libraries, and add per-request CPU limits to an AI/document service. Revisit if the backend shrinks to pure-Python request handlers.

**Managed container fallback:** if Containers cannot be enabled (plan, region capacity), run the same image on a scale-to-zero container service in Paris (for example Cloud Run `europe-west9`) and point `BACKEND_ORIGIN` at it. No code change; the binding stays unbound.

## Measurements (local, 2026-10-22)

Docker with CPU quotas matching the instance types, image `backend/Dockerfile`, ready = first 200 from `/api/backend/health`:

| vCPU | Before (no bytecode) | After |
|---|---|---|
| 1/16 (`lite`) | 41.1 s | 26.5 s |
| 1/4 (`basic`) | 8.2 s | **4.5 s** |
| 1/2 (`standard-1`) | 3.3 s | 2.3 s |

- Memory: 59 MB RSS at idle (60 MB peak); `basic`'s 1 GiB leaves room for AI/document work, `lite`'s 256 MiB would fit today but its cold start does not.
- End to end through `wrangler dev` (workerd + Docker): a binding call from a frontend-like Worker to `aladdin-backend-preview` returned 200 from FastAPI; cold 1.8 s on a full CPU, warm 19 ms. The container environment held only the allowlisted names plus the runtime's `CLOUDFLARE_*`; a service-role key placed in `.dev.vars` did not reach it.
- Re-measured 2026-10-24 after the dependency upgrades below: 4.5–5.8 s at 1/4 vCPU over 6 runs (median 5.2 s), 40–52 MB RSS, image 396 MB. Exact preview prerequisites and approvals: [fastapi-preview-prerequisites.md](../operations/fastapi-preview-prerequisites.md).
- Not measured yet (needs the approved preview): real cold start on Cloudflare, Worker → container latency in WEUR, Supabase round trips from the container.

## Costs (Workers Paid, October 2026 rates)

Per `basic` instance-hour while running: memory $0.009, disk $0.001, CPU only when busy ($0.018 per hour at 100 % of 1/4 vCPU). Included each month: 25 GiB-h memory (25 `basic` hours), 200 GB-h disk (50 hours), 375 vCPU-minutes, 1 TB egress in Europe.

| Scenario | Monthly |
|---|---|
| Scale to zero, about 2 active hours a day (today's traffic: health checks only) | about $0.35 |
| One instance always warm, 5 % average CPU | about $7.25 |
| Production pool of 2, always warm | about $14.50 |
| Ceiling at `max_instances` 4, always warm | about $29 + CPU |
| CPU at volume | $0.40 per million requests at 20 ms CPU each |

The $5 Workers Paid fee is shared with the frontend (ADR-0021). Durable Object and service-binding requests are negligible. Containers are not on the Free plan.

## Security

- Not reachable from the internet: no workers.dev, no route, no custom domain. The only way in is the frontend Worker's binding, which forwards `/api/backend/*` only.
- Identity still comes only from the verified Supabase JWT inside FastAPI (`app.auth`); the Worker adds no trust and strips hop-by-hop headers in the frontend proxy. Supabase RLS applies to every caller-scoped query.
- Secrets are Worker secrets (`wrangler secret put`), checked at deploy by `secrets.required`; none in Git. Errors to callers are JSON without internals; details go to Workers Logs.
- The container runs as the non-root `appuser` (uid 10001).
- Dependency audit 2026-10-24 (`pip-audit` on the locked runtime set): pyjwt 2.13.0 had 15 advisories on the JWKS/JWT path `app.auth` uses; upgraded to 2.15.1 (and the floor raised to `>=2.15.1`), with cryptography 50.0.2, h2 4.4.1, multidict 6.9.1, certifi 2026.10.23. 0 known advisories after.

## Rollout and rollback

1. Owner approves the preview: `wrangler secret put SUPABASE_ANON_KEY --env preview` (acceptance project `nxossqhdfltcqdwvbewi` only), `wrangler deploy --env preview`, bind `BACKEND` → `aladdin-backend-preview` in the frontend `preview` environment. Never Production `kkpkgjrweysgvhvkhzun`.
2. Measure on the preview: cold start, warm latency, `/api/backend/health`, an authenticated call with a real acceptance session, a signed-out session (refused).
3. Production, after the owner approves the cutover: secrets, `wrangler deploy --env production`, bind `BACKEND` in the frontend `production` environment.
4. **Rollback:** remove the `BACKEND` binding (or redeploy the frontend without it); `/api/backend/*` goes back to `BACKEND_ORIGIN` (Vercel), which keeps running the same code until retired.

## Not decided here

- When to retire the Vercel backend.
- Moving the historical-media purge into a scheduled container (it stays operator-run).
- The video transcode container (owned with ADR-0020's follow-up).
