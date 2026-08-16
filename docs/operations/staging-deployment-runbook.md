# Staging Deployment Runbook

**Status:** Living document · 2026-08-16 (rev. 2 — Vercel Services) · First cloud STAGING deployment · Scope: **Staging only**

## Purpose

Take the current `main` branch from "runs locally" to "running in cloud STAGING" with the smallest correct set of services, and state exactly which steps a machine can do and which the repository owner must do by hand in a browser.

Production is **not** covered here. Production must use **separate** infrastructure (its own Supabase project, its own Vercel project, its own secrets) and must never depend on the demo seeds described below.

## Current decision

Per [ADR-0009](../decisions/ADR-0009-vercel-services-deployment.md), staging is **one Vercel project running two services**, plus Supabase:

| Component | Platform | Status for first staging |
|---|---|---|
| Next.js web app (`frontend/`) | **Vercel Services** (`services.frontend`) | **Required** |
| FastAPI service (`backend/`) | **Vercel Services** (`services.backend`) | **Required** — deployed alongside the web app |
| Postgres · Auth · Storage · RLS · RPC · Realtime | **Supabase Cloud** | **Required** |
| Python workers | — | Not implemented; host deferred to a future ADR |

> **Changed 2026-08-16.** An earlier revision of this runbook said FastAPI was *not required* for staging and was targeted at Railway, and that **no `vercel.json` was needed**. Both statements described the Vercel-project-per-service model that [ADR-0004](../decisions/ADR-0004-deployment-platforms.md) assumed. Under Vercel Services, `vercel.json` **is** the deployment definition and adding the backend costs one entry in it rather than a second platform account — so the backend now ships with the frontend, in the same deployment and the same rollback.

### What the backend actually serves today

`backend/app` registers exactly one router — `GET /health` (`backend/app/api/v1/health.py`). There is no AI, OCR, RAG, or document endpoint yet, and `frontend/src` contains no `fetch(` call, so **nothing in the web app calls it at runtime**. Deploying it now is still worth doing: under Services it is one config entry, it keeps both halves in one preview URL per PR, and it makes the first real endpoint a code change rather than a platform-provisioning project.

Two consequences follow from having *only* a health route, and they matter for how you configure it:

- **Leave `APP_ENV` unset on the backend service.** `backend/app/config.py` fails fast at import time when `APP_ENV` is `staging`/`production` and any of `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `DATABASE_URL` is missing. Setting it today would force provisioning a **service-role key that bypasses RLS** just to serve a health check — a breach surface with no feature behind it. Flip `APP_ENV=staging` and provision the four secrets in the **same change** that lands the first real endpoint.
- **Leave `ALLOWED_ORIGINS` at its default.** `vercel.json` routes the backend same-origin under `/api/backend`, so the browser issues no cross-origin preflight — and per [ADR-0001](../decisions/ADR-0001-approved-architecture.md) the service is called from the server side of the web app, never from the browser.

## Split of work

### AGENT / CODE TASKS — done on this branch

| # | Task | Where |
|---|---|---|
| 1 | Confirmed the runtime architecture (Vercel Services × 2 + Supabase) and wrote the root `vercel.json` | `vercel.json`, [ADR-0009](../decisions/ADR-0009-vercel-services-deployment.md) |
| 2 | Exported the env schemas and added the exposure-contract test — a service-role/secret-shaped name under `NEXT_PUBLIC_*` now fails the test suite | `frontend/src/lib/env/index.ts`, `frontend/src/lib/env/env.test.ts` |
| 3 | Documented the staging value/source of every variable | [Environment contract](#environment-contract) |
| 4 | Confirmed no code assumes `localhost:3000`, a callback URL, or Mailpit | [Cloud URL and auth readiness](#cloud-url-and-auth-readiness) |
| 5 | Verified all migrations apply in order from an empty database | [Supabase readiness](#supabase-readiness) |
| 6 | Added a one-time, guarded staging seed builder | `scripts/build_staging_seed.py` |
| 7 | Declared both services in the root `vercel.json` and pinned the middleware to the Node runtime | [Vercel readiness](#vercel-readiness) |
| 8 | Ran typecheck, lint, unit tests, production build, production start smoke test | recorded in `AGENT_WORK_LOG.md` |

### OWNER MANUAL TASKS — browser and terminal, in this order

Steps [1](#1-create-the-supabase-staging-project) → [10](#10-first-cloud-smoke-test) below. Nothing in this repository can perform them: they require accounts, billing, and secrets that must never be committed.

---

## Environment contract

Exact variable names as they exist in the repository. `frontend/src/lib/env/index.ts` is the only sanctioned reader of `process.env`; anything absent from that module is not read by the app.

| Variable | Required | Exposure | Local source | Staging value / source | Set in | Browser-visible |
|---|---|---|---|---|---|---|
| `NEXT_PUBLIC_APP_ENV` | Optional (defaults `local`) | **Public** | `frontend/.env.local` | Literal `staging` | Vercel | Yes |
| `NEXT_PUBLIC_SUPABASE_URL` | **Required** | **Public** | `pnpm supabase status` → `API_URL` | Supabase → Settings → API → Project URL (`https://<project-ref>.supabase.co`) | Vercel | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Required** | **Public** | `pnpm supabase status` → `ANON_KEY` | Supabase → Settings → API → anon / publishable key | Vercel | Yes |
| `NEXT_PUBLIC_SUPPORT_CONTACT` | Optional | **Public** | unset | Real support email or help-desk URL, or leave unset | Vercel | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | **SECRET** | `pnpm supabase status` → `SERVICE_ROLE_KEY` | **Do not set on Vercel.** Owner keeps it in a password manager for the admin tasks below | nowhere (Vercel) | **Never** |
| `AI_SERVICE_URL` | Optional | **SECRET** | `http://localhost:8000` | **Do not set.** FastAPI *is* deployed, but `vercel.json` routes it same-origin at `/api/backend`, so no absolute base URL is needed — and nothing calls it yet | nowhere | **Never** |

The **backend service** reads its own config through `backend/app/config.py`. For first staging it needs **no environment variables at all**: leave `APP_ENV` unset (defaults `local`) so the fail-fast validator does not demand `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_JWT_SECRET` / `DATABASE_URL` for a deployment whose only route is `GET /health`. See [What the backend actually serves today](#what-the-backend-actually-serves-today).

Rules that hold regardless of environment:

- The anon key is browser-exposed **by design**. It carries no privilege of its own; every read and write is decided by Postgres RLS under the caller's JWT (ADR-0007, [`../security/rls-strategy.md`](../security/rls-strategy.md)).
- The service-role key **bypasses RLS**. No application code path uses it (`frontend/src/lib/supabase/server.ts` documents this explicitly). Putting it in a Vercel environment variable adds a breach surface with no feature behind it.
- `NEXT_PUBLIC_*` values are **inlined into the client bundle at build time**. A credential placed there is published, not merely misconfigured, and rotation is the only remedy. `frontend/src/lib/env/env.test.ts` enumerates both schemas and fails on a secret-shaped public name.
- **No real secret is ever committed.** `.env.example` files carry names and placeholders only; CI already rejects a tracked `.env`.

## Cloud URL and auth readiness

**No code change was required, and none was made.** The audit looked specifically for the usual cloud-deployment breakages:

- **No hardcoded origin.** `frontend/src` contains no `http://localhost`, no `NEXT_PUBLIC_SITE_URL`, and no `window.location.origin`. `src/middleware.ts` builds every redirect with `request.nextUrl.clone()`, so the origin is whatever host served the request — localhost, the Vercel URL, and a later custom domain all work unchanged.
- **No auth callback to configure.** `frontend/src/server/actions/auth.ts` is pure OTP: `signInWithOtp` → `verifyOtp` with a typed 6-digit code. There is no `emailRedirectTo`, no `/auth/callback` route, and no `exchangeCodeForSession`. Redirect-URL misconfiguration therefore cannot break sign-in.
- **No Mailpit assumption in application code.** Mailpit exists only in `supabase/config.toml` (`[local_smtp]`, port 54324) for local development.

That leaves exactly one hosted setting that the code genuinely depends on, and it is easy to miss:

> **The Magic Link email template must be replaced in the hosted project.**
> `config.toml` points the local template at `supabase/templates/magic_link.html`, which renders `{{ .Token }}`. `content_path` is a **local-only** setting — a hosted project falls back to Supabase's stock template, which prints a **link, not a code**. The sign-in screen asks for six digits, so staging sign-in silently becomes impossible until the template is replaced. See [step 3](#3-configure-supabase-auth).

**CAPTCHA stays disabled.** `[auth.captcha]` is commented out in `config.toml` and no client passes a `captchaToken`. Enabling CAPTCHA in the hosted dashboard would make every OTP request fail. Revisit only alongside the code change that supplies the token.

## Supabase readiness

- **28 migrations** in `supabase/migrations/`, verified to apply in order from an empty database (`supabase db reset` locally, which drops and recreates before replaying every migration). No migration was edited for deployment convenience.
- Remote schema deployment is **`supabase db push`** only. **`supabase db reset` must never be run against a linked hosted project** — it drops the database.
- `[db] major_version = 17` in `config.toml`. Confirm the hosted project reports Postgres 17 (`select version();`) so local and staging stay on the same major.

### Staging seed decision

`supabase/seed.sql`, `seed-pilot.sql`, and `seed-showroom-sales.sql` together produce exactly the world worth inspecting in staging: **Cairo Ceramics Showroom / `hana@example.test`**, connected distributors and buyers, products, RFQs, quotations, orders, active projects, technicians and professionals, people-ops with a pending invitation, two organizations in the Admin verification queue, and the sales/demo analytics fixtures.

They are **not safe to hand to a hosted database as-is**: they run only under `supabase db reset` (which drops the database first), and they are not idempotent — every insert uses fixed UUIDs with no `ON CONFLICT`, including direct inserts into `auth.users`, so a second apply fails partway through and leaves a half-built world.

The smallest fix that does not touch the pgTAP-pinned and E2E-pinned seed files is a **generated one-time loader**:

```bash
python scripts/build_staging_seed.py      # → supabase/.staging-seed.sql (gitignored)
```

It concatenates the seed files in the order `config.toml` already declares — so the list cannot drift — wraps them in a **single transaction**, and fronts them with a guard that refuses to run when `auth.users` or `public.organizations` is non-empty, or when migrations have not been pushed. Applying it twice is a clean error, never a partial load, and it can never overwrite a populated database.

`supabase/demo-seed.sql` stays local-only: it is re-applied by the Playwright global setup, which truncates the sales tables first.

**Production must never load any of these files.** Its data comes from real usage.

## Vercel readiness

The deployment is defined by the repository-root **`vercel.json`**, not by project settings. Deploy from the **repository root** — do **not** set a Root Directory in the Vercel project; `vercel.json` declares each service's root itself, and setting both would put the same fact in two places.

```jsonc
{
  "services": {
    "frontend": { "root": "frontend", "framework": "nextjs" },
    "backend":  { "root": "backend", "framework": "fastapi",
                  "runtime": "python", "entrypoint": "app/main.py" }
  },
  "rewrites": [
    { "source": "/api/backend(/.*)?", "destination": { "type": "service", "service": "backend" } },
    { "source": "/(.*)",              "destination": { "type": "service", "service": "frontend" } }
  ]
}
```

Rewrites are ordered: the specific `/api/backend` prefix must stay **above** the `/(.*)` catch-all, or every request reaches Next.js.

| Setting | Value | Why |
|---|---|---|
| Root Directory | **unset** (repo root) | `vercel.json` declares `services.*.root`; a project-level Root Directory would conflict with it |
| Framework (frontend) | **`nextjs`**, declared in `vercel.json` | `next@15` App Router; `next.config.ts` adds nothing build-relevant |
| Runtime (backend) | **`python`**, entrypoint `app/main.py` | `backend/app/main.py` exposes the ASGI `app`; `pyproject.toml` requires Python ≥3.12 |
| Install / Build / Output | **default** | Vercel runs `pnpm install` honouring `packageManager: pnpm@9.0.0` via corepack; `next build` → `.next`. The root lockfile and `pnpm-workspace.yaml` resolve naturally because the deploy root *is* the repo root |
| Node.js Version | **22.x** | Root `engines.node: ">=20.0.0"` |

**Middleware runtime is load-bearing.** `frontend/src/middleware.ts` pins `export const runtime = "nodejs"` because Vercel Services does not host Edge Function output. The middleware never needed Edge — one round trip to Supabase auth plus cookie reads/writes — and Node middleware is stable as of Next.js 15.5 (installed: 15.5.22). Removing that export breaks the deployment.

**`.vercel/` is gitignored.** `vercel link` writes the project link there and pulls a short-lived OIDC token into it; it must never be committed.

---

# OWNER MANUAL TASKS

## 1. Create the Supabase STAGING project

1. <https://supabase.com/dashboard> → **New project**.
2. Name it `aladdin-staging`. Region: closest to Egypt (**Frankfurt `eu-central-1`** is the usual choice).
3. Choose Postgres **17** to match `config.toml`.
4. Generate a strong database password and **store it in your password manager immediately** — Supabase shows it once and `db push` needs it.

### Identifiers and credentials to retain

Keep these in a password manager, never in the repository:

| Item | Where to find it | Used for |
|---|---|---|
| Project ref (`<project-ref>`) | Settings → General | `supabase link` |
| Project URL | Settings → API | `NEXT_PUBLIC_SUPABASE_URL` |
| anon / publishable key | Settings → API | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| **service_role key** | Settings → API | Admin tasks from your terminal only |
| **Database password** | you set it in step 1 | `supabase db push`, `psql` |
| Pooler connection string | Settings → Database | loading the staging demo data |

### Never commit

The **service_role key**, the **database password**, any **connection string containing a password**, and any `.env` / `.env.local` file. If one is pasted into a commit, a PR, or a chat log, treat it as compromised and rotate it in Settings → API.

## 2. Push the schema

From the repository root, on the commit you intend to deploy:

```bash
pnpm supabase login
pnpm supabase link --project-ref <project-ref>     # prompts for the database password
pnpm supabase db push                              # applies all 28 migrations in order
```

Confirm with **Database → Migrations** in the dashboard, or `pnpm supabase migration list --linked`.

> **Never run `pnpm supabase db reset` while linked.** It drops the remote database. `db reset` is a local-only command in this repository.

## 3. Configure Supabase Auth

**Authentication → URL Configuration**

| Field | Value |
|---|---|
| Site URL | `https://aladdin-staging.vercel.app` — replace with the real Vercel URL from [step 5](#5-create-the-vercel-staging-project) |
| Redirect URLs | `https://aladdin-staging.vercel.app/**` and `http://localhost:3000/**` |

Add `https://<project-name>-*-<team-slug>.vercel.app/**` only if you want per-PR preview deployments to authenticate. Sign-in does not depend on these values today (the app never sends a redirect), so they are forward-compatibility for a later custom domain.

**Authentication → Providers → Email**

- Email provider: **enabled**.
- "Confirm email": **off** — matches `enable_confirmations = false` in `config.toml`.
- OTP length **6**, expiry **3600s** — matches `otp_length` / `otp_expiry`.

**Authentication → Emails → Magic Link — required, sign-in fails without it**

Replace the template body with the contents of `supabase/templates/magic_link.html`. The essential line is the one that prints the code:

```html
<p style="font-size:28px;letter-spacing:6px;font-weight:700">{{ .Token }}</p>
```

Set the subject to `رمز الدخول إلى علاء الدين` to match local. Send yourself a test code before going further.

**Authentication → Attack Protection**

- **CAPTCHA: leave OFF.** No client sends a `captchaToken`; enabling it breaks every OTP request.
- Rate limits: the defaults match `config.toml` closely enough for staging. Note that Supabase's **built-in email service sends only to project team members** and is limited to a few messages per hour — that constraint, not the code, is what makes [custom SMTP](#11-before-client-uat) a prerequisite for client UAT.

## 4. Load the staging demo data

Only after [step 2](#2-push-the-schema), and only against the empty staging database.

```bash
python scripts/build_staging_seed.py
```

Apply `supabase/.staging-seed.sql` once, either way:

- **psql:** `psql "<pooler connection string>" -f supabase/.staging-seed.sql`
- **Dashboard:** SQL Editor → paste the file → Run.

Expected outcome: it either succeeds, or it refuses with `Refusing to load the staging demo world: this database already has users or organizations.` — a refusal means the database is not empty and **nothing was written**.

### Signing in as a demo identity

Every seeded address ends in `@example.test`, which cannot receive email. Pick one:

**A — re-point the demo login to your own inbox (recommended; exercises the real flow).** In the SQL Editor, with an address you actually control:

```sql
update auth.users     set email = 'you+hana@example.com' where email = 'hana@example.test';
update public.contacts set value = 'you+hana@example.com' where value = 'hana@example.test';
```

Then sign in normally at `/auth/sign-in`. Built-in SMTP delivers to project team members, so use the address on the Supabase account.

**B — mint a code without sending email (any demo user).** From your terminal, with the service_role key:

```bash
curl -s -X POST "https://<project-ref>.supabase.co/auth/v1/admin/generate_link" \
  -H "apikey: <service_role-key>" -H "Authorization: Bearer <service_role-key>" \
  -H "Content-Type: application/json" \
  -d '{"type":"magiclink","email":"hana@example.test"}'
```

Use the `email_otp` field from the response as the 6-digit code on `/auth/verify`.

## 5. Create the Vercel STAGING project

1. <https://vercel.com/new> → import the GitHub repository.
2. Project name: **`aladdin-staging`**.
3. Production Branch: **`main`**. Do not change branch protection on the repository.
4. **Leave Root Directory unset** so the project deploys from the repository root. The root `vercel.json` declares both services and their roots — see [Vercel readiness](#vercel-readiness). Setting a Root Directory here scopes the deploy to one subdirectory and the backend service is never built.
5. Leave Install / Build / Output commands at their defaults.
6. Confirm the build log shows **two services** built (`frontend` and `backend`). If only one appears, `vercel.json` was not picked up — check it is at the repository root and is valid JSON.

## 6. Enter the environment variables

Vercel → Settings → Environment Variables. Apply to **Production and Preview** on this staging project:

```
NEXT_PUBLIC_APP_ENV=staging
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from Settings → API>
```

Optional: `NEXT_PUBLIC_SUPPORT_CONTACT=<support email or help-desk URL>` — leave unset and `/auth/support` shows a safe "unavailable" state rather than a fabricated contact.

**Do not add** `SUPABASE_SERVICE_ROLE_KEY` or `AI_SERVICE_URL`. Nothing reads them, and the first is a full RLS bypass.

**Do not add `APP_ENV` for the backend service either.** Leaving it unset keeps `backend/app/config.py`'s fail-fast validator satisfied without provisioning four secrets for a deployment whose only route is `GET /health`. See [What the backend actually serves today](#what-the-backend-actually-serves-today).

Then **Deploy**, and copy the resulting URL back into Supabase **Site URL** ([step 3](#3-configure-supabase-auth)).

## 7. First cloud smoke test

| # | Check | Expected |
|---|---|---|
| 0 | `GET /api/backend/health` | `200` `{"status":"ok","service":"backend","env":"local"}` — proves the backend service built and the rewrite routes to it. **See the note below if this 404s.** |
| 1 | `GET /api/health` | `200` with `{"status":"ok","service":"frontend",…}` |
| 2 | `/` | Landing renders; no environment error in the Vercel function logs |
| 3 | `/auth/sign-in` | Renders in Arabic (RTL) by default, with the locale switch working |
| 4 | `/b2b` signed out | Redirects to `/auth/sign-in?next=/b2b` |
| 5 | `/admin` signed out | Redirects to `/auth/sign-in?next=/admin` |
| 6 | Request a code, then verify it | Email arrives showing a **6-digit code**, and it is accepted |
| 7 | Signed in as the showroom owner | Lands on the showroom workspace |
| 8 | Walk the demo world | Products, RFQs, quotations, orders, projects, people, and sales analytics all show seeded rows |
| 9 | Sign out | Returns to `/auth/sign-in` |

A failure at #6 is almost always the Magic Link template ([step 3](#3-configure-supabase-auth)). A failure at #2 with a configuration error means a `NEXT_PUBLIC_*` variable is missing — Vercel requires a **redeploy** after adding one. **Check #0 is the one step not yet verified against a real deployment**, and it has two distinct failure modes:

- **The Next.js 404 page** → the catch-all rewrite matched first. Check rewrite order in `vercel.json` (`/api/backend` must precede `/(.*)`).
- **A FastAPI JSON `{"detail":"Not Found"}`** → routing worked, but the service received the path **with** the `/api/backend` prefix still attached, while `backend/app/api/v1/health.py` declares plain `/health`. Fix it in **one** place, not both: either mount the router under an `/api/backend` prefix in `backend/app/main.py`, or add the prefix strip to the rewrite. Record whichever you choose here and in [ADR-0009](../decisions/ADR-0009-vercel-services-deployment.md).

## 8. Before Client UAT

Out of scope for this runbook; each needs its own change:

- **Custom SMTP** — mandatory. Supabase's built-in email service only reaches project team members at a few messages per hour, so no external client can sign in until a real provider is configured under Authentication → Emails → SMTP Settings.
- **Stable custom domain** (optional but recommended) — attach it in Vercel, then update the Supabase **Site URL** and Redirect URLs to match.
- **WhatsApp OTP** — the canonical model includes it; only Email OTP is implemented today.

## Scope

The first cloud STAGING environment: which services exist, which variables they need, how schema and demo data reach them, and how to verify the result.

## What is deferred

- **Production rollout.** It requires **separate infrastructure** — its own Supabase project, its own Vercel project, its own secrets — and must never load the demo seeds. Not documented until staging is proven.
- Custom SMTP, custom domain, preview-deployment auth, and per-environment CI/CD promotion gates.
- **Backend secret provisioning** — `APP_ENV=staging` plus `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_JWT_SECRET` / `DATABASE_URL`, landing with the first real AI/OCR/document endpoint.
- **Worker hosting** — no worker is implemented; a new ADR picks the host ([ADR-0009](../decisions/ADR-0009-vercel-services-deployment.md)).

## Consequences

- Staging holds **synthetic data only** and can be recreated by rebuilding the project and re-running [steps 2](#2-push-the-schema) and [4](#4-load-the-staging-demo-data).
- Schema changes reach staging through `supabase db push` and nothing else; the local `db reset` flow stays local.
- Adding an environment variable means adding it to `frontend/src/lib/env/index.ts` (where the exposure test enforces the public/secret split), to `frontend/.env.example`, and to the table above.

## Related files

[`deployment-overview.md`](deployment-overview.md) · [`RUNTIME_STATE.md`](RUNTIME_STATE.md) · [`../security/secrets-and-environments.md`](../security/secrets-and-environments.md) · [`../decisions/ADR-0004-deployment-platforms.md`](../decisions/ADR-0004-deployment-platforms.md) · `scripts/build_staging_seed.py` · `frontend/src/lib/env/index.ts`
