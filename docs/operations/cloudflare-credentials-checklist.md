# Cloudflare migration: credentials and variables checklist

**Purpose.** Lists every secret and variable the Cloudflare migration needs, per environment. For each one it gives where it is set, the least-privilege scope of each token, and whether it already exists. **Names only: no value belongs in this file, in Git or in a chat.** Values live in the GitHub Environment, in Cloudflare, or in the owner's password manager.

**Status 2026-10-28:** both stages are done; the production Workers serve aladdindecore.com and Vercel is retired. The table below is the record of what was set up.

**Original decision.** Preview first (acceptance Supabase `nxossqhdfltcqdwvbewi` and the acceptance R2 buckets), Production later, after the approvals in the [cutover plan](cloudflare-frontend-cutover-plan.md). The live Supabase project `kkpkgjrweysgvhvkhzun` never gets a credential in a preview location: the preview workflow refuses its URL (`.github/workflows/cloudflare-frontend-preview.yml`, step "Refuse the live Supabase project").

**Status key:** ✅ exists (confirmed) · ❔ unknown, could not be read from here · ⬜ to create · — not needed.

"Confirmed" means one of two things:
- the owner told us (the GitHub Environment items);
- it was seen read-only through the Cloudflare MCP on 2026-10-22 (Worker and buckets).

Secret values and the list of Worker secrets are not readable through that MCP. Check them with `pnpm exec wrangler secret list --env preview` (in `frontend/`), which shows names only.

## Where things are set

| Place | URL or menu path |
|---|---|
| GitHub Environment `cloudflare-preview` | https://github.com/hmohamed080/aladdin/settings/environments → `cloudflare-preview`. Restrict "Deployment branches" to `claude/cloudflare-workers-2ibvgs` (and `main` later). |
| Cloudflare account API tokens (preferred: not tied to a person) | https://dash.cloudflare.com/?to=/:account/api-tokens → **Create Token** |
| Cloudflare user API tokens | https://dash.cloudflare.com/profile/api-tokens |
| R2 S3 credentials (access key ID and secret) | https://dash.cloudflare.com/?to=/:account/r2/api-tokens → **Create API token** → "Object Read & Write" → **Apply to specific buckets only** |
| Worker variables and secrets | https://dash.cloudflare.com/?to=/:account/workers-and-pages → Worker → **Settings → Variables and Secrets**, or `pnpm exec wrangler secret put <NAME> --env <env>` in `frontend/` |
| Workers subdomain | https://dash.cloudflare.com/?to=/:account/workers/subdomain (it is `bstalent9`) |
| Hyperdrive | https://dash.cloudflare.com/?to=/:account/workers/hyperdrive, or `wrangler hyperdrive create … --caching-disabled` |
| Turnstile widget hostnames | https://dash.cloudflare.com/?to=/:account/turnstile → widget → **Hostname Management** |
| Supabase acceptance project settings | https://supabase.com/dashboard/project/nxossqhdfltcqdwvbewi/settings/api-keys (keys); `…/auth/url-configuration` (redirect URLs); SQL editor for the `media_edge_worker` role |
| Upstash Redis REST URL and token | https://console.upstash.com → database → **REST API** |

### Gotcha: `wrangler deploy` and dashboard variables

`wrangler deploy` replaces the Worker's plain variables with what the config and the `--var` flags contain, unless `keep_vars` is set. **Secrets survive a deploy; plain variables set in the dashboard do not.** So every non-secret variable for the preview belongs in one of two places:
- `frontend/wrangler.jsonc` → `env.preview.vars`;
- the workflow's `--var` list.

Never set them only in the dashboard.

## Tokens: least-privilege scopes

| Token | Used by | Permissions (nothing else) | Resources | Expiry | Status |
|---|---|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` (preview deploy) | GitHub Environment `cloudflare-preview`, workflow `Cloudflare frontend preview` | **Account → Workers Scripts: Edit** | the Aladdin account only | 90 days, renewable | ✅ exists and has deployed `aladdin-frontend-preview` |
| R2 S3 credential, acceptance | preview frontend Worker, local live tests, transcode container (preview) | **Object Read & Write** | **only** `aladdin-r2-acceptance-20261011-private`. Add `-public` only if a public pipeline is approved. | 90 days | ❔ (keys from the 2026-10-11 acceptance may exist; rotate rather than reuse if their holder is unclear) |
| R2 admin token (bucket rules) | operator only, stage 2 and stage 7, for `wrangler r2 bucket cors/lifecycle set` | **Account → Workers R2 Storage: Edit** | Aladdin account | 1 day, then delete | ⬜ create at the stage, delete after |
| Media Worker deploy | operator or a future workflow for `aladdin-media-edge` | **Account → Workers Scripts: Edit**, **Account → Hyperdrive: Edit** (only while creating Hyperdrive) | Aladdin account | short | ⬜ |
| Containers deploy (FastAPI, transcode) | owned by the containers thread | **Account → Workers Scripts: Edit**, **Account → Containers: Edit**, plus registry push via `wrangler containers` | Aladdin account | short | ⬜ (the containers thread decides) |
| DNS zone token | operator, stages 10 to 12 only | **Zone → DNS: Edit** | zone `aladdindecore.com` only | the stage window | ⬜ create when the zone exists on Cloudflare |
| Production deploy | GitHub Environment `cloudflare-production` | **Account → Workers Scripts: Edit**. Add **Zone → Workers Routes: Edit** on `aladdindecore.com` at stage 12 only. | Aladdin account; that zone | 90 days | ⬜ |

**Never:** the Global API Key, an "Edit Cloudflare Workers" template token (it grants far more), a token with account-wide R2 object access for the app, or any Cloudflare token in Vercel or in a cloud agent's environment (unless the owner chooses to).

## 1. GitHub Environment `cloudflare-preview` (build and deploy of the preview Worker)

| Name | Kind | Purpose | Status |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | secret | Uploads the preview Worker (scope above). | ✅ |
| `CLOUDFLARE_ACCOUNT_ID` | variable | Target account. | ✅ |
| `CLOUDFLARE_PREVIEW_ENABLED` | variable | Must be exactly `true` for the upload steps to run. | ✅ `true` |
| `NEXT_PUBLIC_SUPABASE_URL` | variable | Optional. The workflow defaults to the acceptance project and refuses the live one. | ❔ (default applies when unset) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | variable | Optional. The workflow defaults to the acceptance anon key, a public value. | ❔ (default applies when unset) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | variable | The Turnstile site key (public) for the widget that lists the workers.dev hostname. Without it, sign-up and recovery render no working widget on the preview. | ❔ |
| Deployment branch rule | setting | Only the migration branch may use this environment. | ❔ |

Runtime secrets are deliberately **not** stored here; they are set once on the Worker (section 2).

## 2. Preview Worker `aladdin-frontend-preview` (runtime)

Deployed on `https://aladdin-frontend-preview.bstalent9.workers.dev` (Worker ID `7c5549f1c03e4cadac42f787baac0f71`, last modified 2026-10-22 08:25 UTC). ✅ The Worker exists. Which secrets it holds is ❔.

| Name | Kind | Value source | Notes | Status |
|---|---|---|---|---|
| `NEXT_PUBLIC_APP_ENV` | var | `wrangler.jsonc` (`staging`) | | ✅ in config |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | var | workflow `--var` | acceptance project | ✅ set at each deploy |
| `REDIS_KEY_ENV` | var | `wrangler.jsonc` (`cf-preview`) | | ✅ in config |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** | acceptance project → API keys | **acceptance project only**, never the live one | ❔ |
| `AUTH_PASSWORD_PREVIEW_GRANT_SECRET` | **secret** | generate 32 random bytes (`.env.example`) | its own value, not the Vercel one | ❔ |
| `TURNSTILE_SECRET_KEY` | **secret** | Turnstile widget | pair of `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | ❔ |
| `TURNSTILE_ALLOWED_HOSTNAMES` | var | `aladdin-frontend-preview.bstalent9.workers.dev` | in `env.preview.vars` | ✅ in config |
| `BACKEND_ORIGIN` | var | FastAPI preview origin (https), from the containers thread | unset → `/api/backend` answers 503 | ⬜ |
| `R2_STORAGE_ENABLED` | var | `true` only at stage 2 | | ⬜ |
| `R2_PRODUCTION_WRITES_APPROVED` | var | `false` (preview is `staging`) | | ⬜ |
| `R2_ACCOUNT_ID` | var | account ID | | ⬜ |
| `R2_PRIVATE_BUCKET` | var | `aladdin-r2-acceptance-20261011-private` | | ⬜ |
| `R2_PUBLIC_BUCKET`, `R2_PUBLIC_BASE_URL` | var | leave unset | no code path needs them ([R2 audit](r2/README.md) finding 3) | — |
| `R2_ACCESS_KEY_ID` | **secret** | acceptance R2 credential | bucket-scoped | ❔ |
| `R2_SECRET_ACCESS_KEY` | **secret** | acceptance R2 credential | | ❔ |
| `MEDIA_EDGE_DELIVERY_ENABLED` | var | `false` until the media Worker exists | | ⬜ |
| `MEDIA_EDGE_PUBLIC_ENABLED` | var | `false` until then | | ⬜ |
| `MEDIA_EDGE_ORIGIN` | var | media Worker origin (https) | | ⬜ |
| `MEDIA_EDGE_TICKET_KID` | var | e.g. `k1` | | ⬜ |
| `MEDIA_EDGE_TICKET_SECRET` | **secret** | same value as the media Worker's `TICKET_KEYS[kid]` | | ⬜ |
| `VIDEO_ENABLED` | var | `false` until the transcode container and media Worker exist | | ⬜ |
| `REDIS_CACHE_ENABLED` | var | `true` at stage 3 | | ⬜ |
| `REDIS_REST_URL` | var | Upstash REST URL (https) | | ⬜ (stage 3) |
| `REDIS_REST_TOKEN` | **secret** | Upstash REST token (full, not read-only) | | ⬜ (stage 3) |
| Bindings `ASSETS`, `IMAGES`, `WORKER_SELF_REFERENCE`, `CF_VERSION_METADATA` | binding | `wrangler.jsonc` | no secrets | ✅ in config |

Outside Cloudflare, for the preview:
- Supabase acceptance → Auth → URL configuration: add `https://aladdin-frontend-preview.bstalent9.workers.dev/**` to the redirect URLs. ❔
- Turnstile widget: add the workers.dev hostname. ❔
- R2 CORS on the private acceptance bucket ([r2/cors-acceptance-private.json](r2/cors-acceptance-private.json)). ⬜

## 3. FastAPI container (Cloudflare Containers, preview; owned by the containers thread)

Names come from `backend/.env.example` and `backend/app/config.py`. The container gets them from the Worker that fronts it (Worker secrets, passed as container environment variables).

| Name | Kind | Notes | Status |
|---|---|---|---|
| `APP_ENV` | var | **Must be set explicitly to `staging`** (later `production`). In a Cloudflare container an unset or `local` value counts as `production` (fail closed, `backend/app/config.py`, `environment`), so a staging container must say `staging`. | ⬜ |
| `SUPABASE_URL` | var | acceptance project URL | ⬜ |
| `SUPABASE_ANON_KEY` | var (public) | acceptance anon key | ⬜ |
| `SUPABASE_JWT_SECRET` | **secret** | optional: legacy HS256 only; ES256 tokens verify through JWKS | — unless needed |
| `ALLOWED_ORIGINS` | var | `https://aladdin-frontend-preview.bstalent9.workers.dev` | ⬜ |
| `OPENAI_API_KEY` | **secret** | only once the AI layer is live | — |
| `REDIS_URL`, `REDIS_KEY_ENV` | **secret**, var | optional job locks; containers can use TCP `rediss://` | — / ⬜ |
| `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` | **secret** | **not** for the API service (operator jobs only) | — |

## 4. Transcode container (video, ADR-0020; owned by the containers thread)

`backend/app/workers/video_transcode.py` runs `--once`, a loop, or `--purge`. It uses a service-role Supabase client for the `video_job_*` RPCs and boto3 for R2.

| Name | Kind | Notes | Status |
|---|---|---|---|
| `APP_ENV` | var | `staging`, explicitly, as above | ⬜ |
| `SUPABASE_URL` | var | acceptance project | ⬜ |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** | acceptance project only; this job is a trusted worker | ⬜ |
| `R2_ACCOUNT_ID` | var | | ⬜ |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | **secret** | Its **own** R2 credential, "Object Read & Write" on the private acceptance bucket only. Not shared with the frontend, so each can be revoked alone. | ⬜ |
| `R2_PRIVATE_BUCKET` | var | `aladdin-r2-acceptance-20261011-private` | ⬜ |
| `REDIS_URL`, `REDIS_KEY_ENV` | **secret**, var | optional wake-up queue | ⬜ |

## 5. Media edge Worker `aladdin-media-edge` (ADR-0018/0020)

Does not exist yet. Template: `edge/media-worker/wrangler.toml`; steps: `edge/media-worker/README.md`.

| Name | Kind | Notes | Status |
|---|---|---|---|
| `TICKET_KEYS` | **secret** | JSON `{"<kid>":"<base64url secret>"}`; same secret as the frontend's `MEDIA_EDGE_TICKET_SECRET` | ⬜ |
| `MEDIA_BUCKET` | R2 binding | private bucket name (acceptance, then `aladdin-media-private`) | ⬜ |
| `HYPERDRIVE` | Hyperdrive binding | Config **with caching disabled**. Its connection string holds the `media_edge_worker` database password, and it is stored only in Hyperdrive. **No Hyperdrive config exists** (read 2026-10-22). | ⬜ |
| `media_edge_worker` DB role and password | Supabase (acceptance) | `create role … login`, member of `media_edge`, `statement_timeout` 3 s (README step) | ⬜ |
| `PRIVATE_ROUTES`, `PUBLIC_ROUTES`, `EDGE_CACHE`, `VIDEO_ROUTES`, `VIDEO_ALLOWED_ORIGINS` | var | in `wrangler.toml`. For the preview, `VIDEO_ALLOWED_ORIGINS` must list the workers.dev origin. | ⬜ |
| Route or hostname | setting | Preview: its own workers.dev URL. Production: `media.aladdindecore.com` (needs the zone on Cloudflare). | ⬜ |

## 6. Production (later, stages 7, 8 and 11; each needs its own approval)

| Item | Where | Status |
|---|---|---|
| GitHub Environment `cloudflare-production` (used by `.github/workflows/cloudflare-production.yml`): required reviewers = owner, deployment branch `main` only; secret `CLOUDFLARE_API_TOKEN` (production scope above, plus **Containers: Edit** for the backend); variables `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_PRODUCTION_ENABLED` (`false` until the deploy GO), `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (live project, no defaults) and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (the `aladdin-production` widget) | GitHub → Settings → Environments | ⬜ |
| First cutover, frontend Worker secrets only: `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET_KEY`, `AUTH_PASSWORD_PREVIEW_GRANT_SECRET` (declared in `secrets.required`, so the deploy refuses without them). The backend's `SUPABASE_URL`/`SUPABASE_ANON_KEY` are public live values uploaded by the workflow. R2, media-edge and Redis secrets wait for their own approvals. | `wrangler secret put <NAME> --env production` (owner, hidden prompt) | ⬜ |
| Production bucket `aladdin-media-private`, its CORS ([r2/cors-production-private.json](r2/cors-production-private.json)) and lifecycle ([r2/lifecycle-private.json](r2/lifecycle-private.json)) | Cloudflare R2 | ⬜ |
| A production R2 credential per consumer (frontend, transcode), each scoped to `aladdin-media-private` only | R2 → Manage API tokens | ⬜ |
| Worker `aladdin-frontend-production`: every secret in section 2 with **live** values (live Supabase service role, new grant secret, production Turnstile, production R2 keys, ticket secret, Redis token) and `R2_PRODUCTION_WRITES_APPROVED=true` only on approval | Worker settings / `wrangler secret put --env production` | ⬜ |
| Production FastAPI and transcode containers (sections 3 and 4 with live values) | containers thread | ⬜ |
| Production media Worker, Hyperdrive and `media_edge_worker` role on the live project | Cloudflare and Supabase | ⬜ |
| Workers Paid ($5/month) | Cloudflare → Billing | ⬜ owner decision |
| Zone `aladdindecore.com` on Cloudflare and the DNS token | stage 10 ([DNS export](dns-records-aladdindecore-2026-10-22.md)) | ⬜ |
| Supabase live project: add `https://next.aladdindecore.com/**` to the redirect URLs for stage 11; Turnstile hostname `next.aladdindecore.com` | Supabase / Turnstile | ⬜ |

## Rotation and cleanup

- Every token above has an expiry. Rotate R2 credentials and the ticket key using the media Worker README's two-key rotation (`k1` → `k2`).
- Delete the R2 admin token and the DNS token when their stage ends.
- Vercel was retired on 2026-10-28 and its project deleted with its variables ([ADR-0024](../decisions/ADR-0024-vercel-retired.md)).

## Related

- [Cloudflare frontend guide](../guides/cloudflare-frontend.md): variables per environment.
- [R2 audit](r2/README.md), [DNS export](dns-records-aladdindecore-2026-10-22.md), [cutover plan](cloudflare-frontend-cutover-plan.md).
