# FastAPI container preview: prerequisites and approvals

**Status (2026-10-24):** on hold by the owner's choice (Option B). Gate 1 cleared 08:16 UTC; waiting on gate 2. Nothing is deployed. Design and numbers: [ADR-0022](../decisions/ADR-0022-fastapi-cloudflare-containers.md). Worker: [`edge/backend-worker`](../../edge/backend-worker/README.md). PR #98, stacked on #97 (which now contains #100).

## Gates, in order

| # | Gate | Owner of the step | State |
|---|---|---|---|
| 1 | `aladdin-frontend-preview` serves pages over HTTPS on workers.dev (TLS issued, preview workflow green) | Frontend Workers thread | **Done** 2026-10-24 (run 40077176318; `/`, `/api/health` 200; `/api/backend/health` 503 until a backend is bound) |
| 2 | Acceptance `nxossqhdfltcqdwvbewi` rebuilt to the 180-migration baseline (#100). FastAPI's auth calls `public.my_account_status`, whose session-revocation form is in `20261021090013`/`…14`; on the drifted 105-migration project authenticated calls cannot be tested faithfully | Acceptance thread, separate owner approval | **In progress**: 180 migrations applied 2026-10-24, but grant/ACL fingerprints still differ; Acceptance NO-GO until fixed |
| 3 | **Approval A: Workers Paid** on the Cloudflare account ($5/month base, shared with the frontend). Containers are not available on Free | Owner (billing) | Not requested yet |
| 4 | **Approval B: isolated FastAPI preview** on Acceptance only, as below | Owner | Not requested yet |

Production (`kkpkgjrweysgvhvkhzun`) is out of scope until an owner-approved cutover.

## What Approval B covers, exactly

1. A Cloudflare API token for the account, scoped to that account only: the **Edit Cloudflare Workers** template (Workers Scripts edit) plus container application rights, held as a GitHub Actions secret or on the owner's machine, never in Git. The token in this environment is invalid, so an agent cannot deploy until a working one exists.
2. A machine with Docker (GitHub Actions `ubuntu-latest` has it): `wrangler deploy` builds `backend/Dockerfile` and pushes it to Cloudflare's registry.
3. `pnpm --dir edge/backend-worker exec wrangler secret put SUPABASE_ANON_KEY --env preview`, with the **Acceptance** anon key. Nothing else: no service-role key, `DATABASE_URL` or R2 keys (they would not reach the container anyway).
4. `pnpm --dir edge/backend-worker exec wrangler deploy --env preview`, which creates the Worker `aladdin-backend-preview` (no workers.dev address, no route), its Durable Object namespace and a container application: `basic`, WEUR, at most 2 instances, sleeping after 10 minutes idle.
5. In `frontend/wrangler.jsonc` `env.preview.services`, add `{ "binding": "BACKEND", "service": "aladdin-backend-preview" }` and redeploy the frontend preview through GitHub Actions.
6. Checks on the frontend preview: `GET /api/backend/health` returns `{"status":"ok","env":"staging"}`; cold and warm latency; an authenticated call with a real Acceptance session; a signed-out or revoked session is refused.

**Rollback:** remove the binding and redeploy the frontend (traffic returns to `BACKEND_ORIGIN`, Vercel); `wrangler delete --env preview` removes the backend Worker. Neither touches data.

## Expected cost of the preview

At Acceptance traffic the container sleeps most of the time: well inside the included 25 GiB-h memory, 375 vCPU-min and 200 GB-h disk, so **$0 beyond the $5 Workers Paid base**. Worst case, if the 2 preview instances stayed awake all month: about $14.50. Rates re-checked against Cloudflare's pricing page (updated 2026-10-05) on 2026-10-24: unchanged.

## Verified on 2026-10-24 without an account

- `wrangler deploy --dry-run` for `preview` and `production`: 56 KiB Worker, image builds; bindings match the table in the Worker README.
- Image 396 MB (the `basic` disk is 4 GB), runs as uid 10001, contains only `.venv` and `app/`, no `.env` or keys.
- Cold start at 1/4 vCPU, 6 runs: 4.5–5.8 s (median 5.2 s); warm health 3 ms locally; 40–52 MB RSS.
- Dependency audit (`pip-audit` on the locked runtime set): 19 advisories fixed by upgrading pyjwt 2.13.0 → 2.15.1 (15, including JWKS redirect-following and algorithm-confusion fixes on the path `app.auth` uses), cryptography 49 → 50.0.2, h2 4.4.1, multidict 6.9.1, certifi 2026.10.23. Now 0 known. Backend tests 106 passed.
