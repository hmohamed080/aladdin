# Vercel environment variables (Preview and Production)

Names only. Values live in Vercel (Project → Settings → Environment Variables) and in the owner's password manager, never in Git. One Vercel project serves both services (`frontend` Next.js and `backend` FastAPI, root `vercel.json`, [ADR-0009](../decisions/ADR-0009-vercel-services-deployment.md)); a variable set there is visible to both, but each service reads only its own names, through its settings module (`frontend/src/lib/env`, `backend/app/config.py`).

Tick both **Preview** and **Production** for every row below unless the row says otherwise.

## Backend (FastAPI, `/api/backend`)

| Variable | Preview | Production | Notes |
|---|---|---|---|
| `SUPABASE_URL` | **Required** | **Required** | Project URL. JWT issuer and JWKS for token verification. Same value as `NEXT_PUBLIC_SUPABASE_URL`. |
| `SUPABASE_ANON_KEY` | **Required** | **Required** | Public anon/publishable key. Caller-scoped account and session check (`my_account_status`). Same value as `NEXT_PUBLIC_SUPABASE_ANON_KEY`. |
| `APP_ENV` | Optional | Optional | Leave unset. Derived from Vercel's own `VERCEL_ENV`: Production → `production`, Preview → `staging`. If set, it must be `staging` or `production`; `local` is ignored on a deployment. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Do not set** | **Do not set** | Bypasses RLS. No deployed backend route uses it; the media jobs run from an operator machine or a worker host with their own environment. |
| `DATABASE_URL` | **Do not set** | **Do not set** | Read by no backend code today. |
| `SUPABASE_JWT_SECRET` | **Do not set** | **Do not set** | Legacy HS256 only. The hosted project signs ES256 (JWKS). |
| `OPENAI_API_KEY` | Not yet | Not yet | Set with the first AI endpoint. |

`VERCEL_ENV` is set by Vercel on every deployment; never add it by hand.

**What happens when a required backend variable is missing.** The service still starts, so the rest of the site is unaffected. `GET /api/backend/health` answers `503` with `{"status": "misconfigured", "env": "production", "missing": ["SUPABASE_URL", ...]}` (names only), and every authenticated or job endpoint answers `503` until the variables are set and the deployment is rebuilt. A healthy deployment answers `200` with `{"status": "ok", "service": "backend", "env": "production"}` (or `"staging"` on a Preview).

After setting the two variables, redeploy and check:

```bash
curl -s https://aladdindecore.com/api/backend/health      # expect 200, "env":"production"
curl -s https://<preview-url>/api/backend/health          # expect 200, "env":"staging"
```

## Web app (Next.js)

| Variable | Preview | Production | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_APP_ENV` | **Required** (`staging`) | **Required** (`production`) | Unset means `local`: auth cookies without `Secure`, and the always-pass Turnstile test secret whenever `TURNSTILE_SECRET_KEY` is also unset. The web app does not derive it from `VERCEL_ENV`. |
| `NEXT_PUBLIC_SUPABASE_URL` | **Required** | **Required** | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Required** | **Required** | |
| `SUPABASE_SERVICE_ROLE_KEY` | **Required** | **Required** | Server-only: password-auth `app_metadata` writes, pending registrations, media verification. |
| `AUTH_PASSWORD_PREVIEW_GRANT_SECRET` | **Required** | **Required** | Forgot Password recovery grant (32+ characters). |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | **Required** | **Required** | |
| `TURNSTILE_SECRET_KEY` | **Required** | **Required** | Unset fails every CAPTCHA check closed outside `local`. |
| `TURNSTILE_ALLOWED_HOSTNAMES` | Recommended | Recommended | Comma-separated hostnames. |
| `NEXT_PUBLIC_SUPPORT_CONTACT` | Optional | Optional | |
| `R2_STORAGE_ENABLED`, `R2_PRODUCTION_WRITES_APPROVED`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BUCKET`, `R2_PRIVATE_BUCKET`, `R2_PUBLIC_BASE_URL` | Only with R2 | Only with R2 | Owner approval required ([ADR-0018](../decisions/ADR-0018-r2-edge-media-delivery.md)). |
| `MEDIA_EDGE_DELIVERY_ENABLED`, `MEDIA_EDGE_PUBLIC_ENABLED`, `MEDIA_EDGE_ORIGIN`, `MEDIA_EDGE_TICKET_KID`, `MEDIA_EDGE_TICKET_SECRET` | Only with the media Worker | Only with the media Worker | Same approval. |
| `AI_SERVICE_URL` | **Do not set** | **Do not set** | The backend is same-origin at `/api/backend`. |

The authoritative definitions are the schemas themselves: `frontend/src/lib/env/index.ts`, `frontend/src/lib/env/storage.ts` and `backend/app/config.py` (with `backend/.env.example`).
