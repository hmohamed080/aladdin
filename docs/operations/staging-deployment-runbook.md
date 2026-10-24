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

- **Superseded 2026-10-19:** `APP_ENV` is now derived from `VERCEL_ENV` when unset, so a deployment always runs the secret check. The backend needs `SUPABASE_URL` and `SUPABASE_ANON_KEY` on Preview and Production, and never the service-role key; until they are set, `/api/backend/health` answers 503 `misconfigured` and authenticated endpoints refuse, without a crash. Exact names: [vercel-environment-variables.md](../guides/vercel-environment-variables.md). (Earlier text: leave `APP_ENV` unset so the old import-time check never ran.)
- **Leave `ALLOWED_ORIGINS` at its default.** `vercel.json` routes the backend same-origin under `/api/backend`, so the browser issues no cross-origin preflight — and per [ADR-0001](../decisions/ADR-0001-approved-architecture.md) the service is called from the server side of the web app, never from the browser.

### Backend route mounting

**Vercel Services forwards the original request path** — it does not strip the matched rewrite prefix. Verified on the PR #28 Preview: `GET /api/backend/health` reached FastAPI, which answered with its own `{"detail":"Not Found"}` because the app then declared only `/health`.

The FastAPI app is therefore mounted under the prefix, on **one** side only:

| Where | What |
|---|---|
| `backend/app/main.py` | `API_PREFIX = "/api/backend"`, applied at the single `include_router(api_v1_router, prefix=API_PREFIX)` — plus the OpenAPI/docs/redoc/oauth2-redirect URLs, which would otherwise fall outside the prefix and be swallowed by the catch-all rewrite |
| `backend/app/api/v1/__init__.py` | the one aggregation point for v1 routers |
| `backend/app/api/v1/health.py` | keeps its **bare** `/health` path — route modules never repeat the prefix |
| `vercel.json` | **unchanged** — no prefix strip; two mechanisms would compete |

`root_path` is deliberately unused: it is for proxies that *strip* the prefix, which is the opposite of the observed behavior. `backend/tests/test_health.py` fails if a route is ever served bare, doubled, or mounted outside the prefix.

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
| 6a | Audited all 26 seeded accounts by impersonating each under RLS, and closed every empty or dead-end demo experience with a staging-only additive layer | `supabase/staging/demo-enrichment.sql`, `supabase/staging/demo-accounts.toml` |
| 6b | Made the demo mailbox configurable and the build **fail closed** without it — no real address in git | `scripts/staging_demo.py`, `supabase/staging/demo-email.example.toml` |
| 6c | Added the automated 26-account verifier and the local one-time-load rehearsal | `supabase/staging/verify-staging-seed.sql`, `scripts/rehearse_staging_seed.py` |
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

The **backend service** reads its own config through `backend/app/config.py`. Since 2026-10-19 it needs `SUPABASE_URL` and `SUPABASE_ANON_KEY` on every deployment (its environment comes from `VERCEL_ENV`); see [vercel-environment-variables.md](../guides/vercel-environment-variables.md).

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

**Supabase CAPTCHA stays disabled — permanently.** CAPTCHA is application-scoped: the password-auth preview's Create Account and Forgot Password server actions verify the Cloudflare Turnstile token themselves with Cloudflare Siteverify (`frontend/src/server/auth/turnstile.ts`) before calling Supabase Auth, and Sign In has no CAPTCHA. The Turnstile **secret goes in the app's server-only env (`TURNSTILE_SECRET_KEY` on Vercel), never in Supabase Auth settings**; the site key is `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Enabling CAPTCHA in the hosted Supabase dashboard would make every canonical OTP request and every password sign-in fail.

## Supabase readiness

- **Migration count drifts as the repository grows — check it live rather than trusting a number written here:**
  ```bash
  find supabase/migrations -maxdepth 1 -name "*.sql" -type f | wc -l   # local, current total
  supabase migration list --linked                                     # local vs. hosted, per-migration
  ```
  All migrations are verified to apply in order from an empty database (`supabase db reset` locally, which drops and recreates before replaying every migration). No migration is edited for deployment convenience.
- Remote schema deployment is **`supabase db push`** only. **`supabase db reset` must never be run against a linked hosted project** — it drops the database, and it is not a rollback mechanism (see [Migration safety protocol](#migration-safety-protocol) below).
- `[db] major_version = 17` in `config.toml`. Confirm the hosted project reports Postgres 17 (`select version();`) so local and staging stay on the same major.

## Migration safety protocol

> **Superseded for routine deploys.** Merged changes now reach staging through the migration-first workflow described in [Migration-first deployment](#migration-first-deployment). The manual steps below remain the procedure for an emergency or a one-off reconciliation, and the pre-migration snapshot guidance still applies to risky (destructive) migrations.

Added after a real incident: hosted `aladdin-staging` was found 21 migrations behind `main`, requiring a full Phase 0 reconciliation (inspection, rehearsal, a manual pre-migration snapshot, the real push, then post-push verification) before interactive account QA could safely begin. This protocol exists so that gap does not recur silently.

**Before any interactive staging QA session:**

```bash
supabase migration list --linked
```

Confirm every local migration shows a matching remote timestamp and nothing is pending. Treat a gap as a blocker, not a background task — do not start QA against a database that is not at the commit you think it is.

**Before any real migration push:**

1. Confirm the exact linked project ref: `cat supabase/.temp/project-ref` and/or `supabase projects list` — cross-check it against the project you intend to target. A wrong link pushes to the wrong project.
2. Dry-run first, always: `supabase db push --linked --dry-run` — confirms the exact ordered list of migrations that would apply, with nothing applied. Compare it against what you expect before proceeding.
3. **On the Free Plan** (no scheduled daily backups, no PITR): take a manual pre-migration snapshot before pushing. At minimum: `supabase db dump --linked -f roles.sql --role-only`, `supabase db dump --linked -f schema.sql`, `supabase db dump --linked -f data.sql --data-only --use-copy`, `supabase db dump --linked -f history_schema.sql --schema supabase_migrations`, `supabase db dump --linked -f history_data.sql --data-only --use-copy --schema supabase_migrations`, plus a limited read-only export of `auth.users` (id/email/timestamps only, never tokens/secrets) and a Storage bucket/object manifest (metadata only, never the objects). Store it **outside the Git worktree**, restricted to the current user, and never commit it.
   - **The default `supabase db dump` (no flags) contains schema only — no data — and always excludes the managed `auth` and `storage` schemas.** Do not treat a bare `db dump` as a full backup; use the explicit flag set above.
   - **`supabase db reset --linked` is not a rollback.** It drops and rebuilds the linked database from migrations + seed, discarding all real data — never describe or use it as a way to undo a bad push. A failed or unwanted migration is fixed with a new forward migration, restored from the snapshot above, or (where available) a managed backup/PITR checkpoint — never a reset.
4. Execute the real push exactly once: `supabase db push --linked`.

**After any real migration push, before declaring staging ready:**

1. **Migration parity** — `supabase migration list --linked` shows 0 pending.
2. **Hosted seed verification** — `python scripts/verify_staging_seed.py` (see [`staging-demo-accounts.md`](staging-demo-accounts.md) *Verifying*) passes for all 26 demo accounts, tolerating any unrelated non-demo registrations that may already exist on staging.
3. **Before/after row-count comparison** — compare the pre-push snapshot's counts (auth users, organizations, memberships, RFQs, quotations, orders, projects, storage buckets/objects) against the same counts post-push. Anything that changed outside what the pushed migrations were expected to change is a stop condition, not a footnote.
4. **Health endpoints** — `GET /api/health` and `GET /api/backend/health` both return `200`, against the **real** deployment domain (see the next point — never a guessed one).
5. **Final dry-run** — `supabase db push --linked --dry-run` reports `"upToDate": true`, nothing proposed. If it still proposes something, the push did not fully land; do not proceed.

**Resolve the actual Vercel deployment domain from project metadata — never guess `<project-name>.vercel.app`.** That pattern can collide with a completely unrelated third-party project that happens to use the same name, silently checking the wrong application's health instead of yours. Resolve it properly:

```bash
cat .vercel/project.json   # projectId + orgId, if this worktree has ever been linked
```

then look up the project's real domains via the Vercel MCP tools (`list_projects`/`get_project`) or the Vercel dashboard, and use one of the domains actually listed there (e.g. `<project>-<random>-<team>.vercel.app` or a configured alias) — not an assumed pattern.

**Git commit authors must use a GitHub-verifiable identity, or Vercel will refuse to deploy the commit.** A commit authored under a local-only identity (e.g. a synthetic `name <user@some.local>` set only in repository-local Git config) resolves to no GitHub account at all — GitHub's commit API reports `author: null`, and Vercel's Git integration blocks the deployment with "GitHub couldn't verify an account for the commit." Before pushing a commit that will trigger a Vercel deployment, confirm the repository-local `user.name`/`user.email` (`git config --local --get user.name` / `user.email`) resolves to your actual GitHub account — the standard, always-correct choice is `<github-numeric-id>+<github-login>@users.noreply.github.com`, found via `gh api user --jq '{id, login}'`. If a bad commit has already been pushed, fix the identity, `git commit --amend --reset-author` (not a plain `--amend`, which only updates the committer, not the author), and `git push --force-with-lease` to the same branch.

### Staging seed decision

`supabase/seed.sql`, `seed-pilot.sql`, and `seed-showroom-sales.sql` together produce exactly the world worth inspecting in staging: **Cairo Ceramics Showroom / `hana@example.test`**, connected distributors and buyers, products, RFQs, quotations, orders, active projects, technicians and professionals, people-ops with a pending invitation, two organizations in the Admin verification queue, and the sales/demo analytics fixtures.

They are **not safe to hand to a hosted database as-is**: they run only under `supabase db reset` (which drops the database first), and they are not idempotent — every insert uses fixed UUIDs with no `ON CONFLICT`, including direct inserts into `auth.users`, so a second apply fails partway through and leaves a half-built world.

The smallest fix that does not touch the pgTAP-pinned and E2E-pinned seed files is a **generated one-time loader**:

```bash
python scripts/build_staging_seed.py      # → supabase/.staging-seed.sql (gitignored)
```

It concatenates the seed files in the order `config.toml` already declares — so the list cannot drift — wraps them in a **single transaction**, and fronts them with a guard that refuses to run when `auth.users` or `public.organizations` is non-empty, or when migrations have not been pushed. Applying it twice is a clean error, never a partial load, and it can never overwrite a populated database.

`supabase/demo-seed.sql` stays local-only: it is re-applied by the Playwright global setup, which truncates the sales tables first. It is **not** part of the staging bundle — which is exactly why Org A looked populated locally and was empty in the staging rehearsal.

**Production must never load any of these files.** Its data comes from real usage.

### Making all 26 accounts usable as client demos

The bundle above loads the world, but two things stood between it and a client-facing demo. Both were measured by impersonating all 26 seeded users under RLS against a database holding **only** the bundled seeds, not by reading the SQL.

**1 — Eleven accounts had nothing to show.** `a-owner`, `a-cairo`, `b-owner` and `sara` returned zero rows in every module. Fourteen accounts land on `/home`, which is rendered almost entirely from `onboarding_progress` and `individual_onboarding` — **both empty repo-wide**, so those accounts opened on a blank profile at single-digit completeness. `a-cairo` held only the superseded `sales.opportunity.*` capabilities, so the nav offered Customers / Leads / Follow-ups while RLS returned nothing.

The fix is a staging-only additive layer, [`supabase/staging/demo-enrichment.sql`](../../supabase/staging/demo-enrichment.sql), appended inside the same transaction. It is deliberately **absent from `config.toml [db.seed].sql_paths`**, so `supabase db reset`, the pgTAP snapshots and the Playwright fixtures are unchanged. It edits no migration and no historical seed file, touches no RLS policy, grant, or security-definer function, and preserves every existing UUID and relationship — new rows use a reserved `fa……` prefix that no seed file uses.

**2 — No account could receive its sign-in code.** Every seeded address is `@example.test`, a reserved TLD that can never receive mail (RFC 6761). The app is passwordless — Email OTP and nothing else — so the address *is* the credential path, and there is no password or bypass to add instead. The loader therefore ends with a remap that repoints `auth.users.email`, `public.contacts.value` and the pending invitation onto addresses composed from a mailbox **you configure**: *(Superseded by the canonical password-auth rollout on 2026-09-28 — General = Email + Password; Installer = Phone + Password.)*

```toml
# supabase/staging/demo-email.toml — GITIGNORED, copy from demo-email.example.toml
mode = "plus"
base = "you@yourmailbox.com"    # → you+aladdin-hana-showroom-owner@yourmailbox.com
```

The build **fails closed**: with no mapping it refuses to write the cloud artifact and prints how to supply one. Reserved domains (including the `example.com` in the template) are rejected rather than accepted, so a half-edited config cannot ship 26 unreachable accounts. `--rehearsal` builds a separate, clearly-named artifact for local practice without needing a real mailbox.

**No real address enters the repository.** The committed manifest, [`staging-demo-accounts.md`](staging-demo-accounts.md), shows the composition pattern; the resolved addresses go to the gitignored `supabase/.staging-demo-manifest.md` / `.csv` at build time.

One account is deliberately left empty: **Nour Hegazy** is the pending invitation and the brand-new-user journey. The verifier knows this by name and fails if she gains data — or if any other account loses it.

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
pnpm supabase db push                              # applies every pending migration, in order
```

Confirm with **Database → Migrations** in the dashboard, or `pnpm supabase migration list --linked`.

> **Never run `pnpm supabase db reset` while linked.** It drops the remote database. `db reset` is a local-only command in this repository.

## 3. Configure Supabase Auth

**Authentication → URL Configuration**

| Field | Value |
|---|---|
| Site URL | the **real** URL from [step 5](#5-create-the-vercel-staging-project)'s deployment — resolve it from Vercel project metadata (`cat .vercel/project.json`, then the project's actual domains), **never assume the pattern `<project-name>.vercel.app`**; that guess can collide with an unrelated third-party project of the same name |
| Redirect URLs | the same real domain, `/**`, plus `http://localhost:3000/**` |

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

- **CAPTCHA: leave OFF.** CAPTCHA is verified by the app (Cloudflare Siteverify, `TURNSTILE_SECRET_KEY` in Vercel), not by Supabase; enabling it here breaks every OTP request and password sign-in.
- Rate limits: the defaults match `config.toml` closely enough for staging. Note that Supabase's **built-in email service sends only to project team members** and is limited to a few messages per hour — that constraint, not the code, is what makes [custom SMTP](#11-before-client-uat) a prerequisite for client UAT.

## 4. Load the staging demo data

Only after [step 2](#2-push-the-schema), and only against the empty staging database.

#### 4a. Configure the demo mailbox — once, before anything else

Every demo account signs in by Email OTP, so it needs an address that can actually receive a code.

```bash
cp supabase/staging/demo-email.example.toml supabase/staging/demo-email.toml
```

Edit it and set `base` to a mailbox you control. The file is **gitignored** — never commit it.

> **The built-in Supabase email service only delivers to project team members.** Until you configure [custom SMTP](#8-before-client-uat), use the address on your Supabase account, or every code will be silently dropped.

#### 4b. Generate the loader — the exact command

```bash
python scripts/build_staging_seed.py
```

That is the whole build. It writes three files:

| File | Contents | Committed? |
|---|---|---|
| `supabase/.staging-seed.sql` | the one-time loader — seeds + enrichment + email remap, one transaction | no (gitignored) |
| `supabase/.staging-demo-manifest.md` | all 26 accounts with their **real** addresses and what to demo | no (gitignored) |
| `supabase/.staging-demo-manifest.csv` | the same, machine-readable | no (gitignored) |

If it exits with `No demo email mapping configured — refusing to build the cloud staging seed`, step 4a was skipped. That refusal is the point: it is what stops 26 unreachable accounts reaching staging.

#### 4c. Apply it — ONCE

```bash
psql "<pooler connection string>" -f supabase/.staging-seed.sql
```

Or paste the file into the Dashboard SQL Editor and Run.

Expected outcome: it either succeeds, or it refuses with `Refusing to load the staging demo world: this database already has users or organizations.` A refusal means the database was not empty and **nothing was written** — the whole load is one transaction.

#### 4d. Verify — the exact commands

```bash
psql "<pooler connection string>" -f supabase/staging/verify-staging-seed.sql
```

Read-only, wrapped in a transaction that always rolls back. It fails loudly on the first problem and otherwise prints a 26-row table: display name, masked email, persona, workspaces, landing route, and the demo data that account can actually see. It checks:

- **population** — 26 accounts, each with the user, profile and primary-contact rows the app reads;
- **addresses** — unique, confirmed, non-reserved, GoTrue token columns non-NULL, and `public.contacts` in lockstep with `auth.users`;
- **linkage** — persona values are personas (never business types), and no membership, capability, branch grant, lead or customer crosses an organization boundary;
- **commerce** — every quotation and order total equals the sum of its own line items, every record names the same two parties as the record it descends from, and no accepted quotation is missing its order;
- **landing and non-emptiness** — all 26 accounts impersonated under RLS: each must resolve to the landing route the manifest claims, and each must have something to show. Nour Hegazy is the one exemption, by name, because she *is* the new-user journey.

A second, independent confirmation that the guard holds:

```bash
psql "<pooler connection string>" -f supabase/.staging-seed.sql   # must FAIL, writing nothing
```

Then open the manifest for the addresses and the demo script:

```bash
cat supabase/.staging-demo-manifest.md
```

> **Rehearse it locally first.**
>
> ```bash
> python scripts/rehearse_staging_seed.py --isolated    # recommended
> python scripts/rehearse_staging_seed.py               # uses your local Supabase stack
> ```
>
> Both apply the bundle to a database holding migrations and nothing else, run the verifier, then apply the bundle a **second** time and assert the refusal wrote **zero** rows (row counts captured before and after and compared — a guard that raises after writing half a world is worse than no guard). Neither touches a remote project.
>
> `--isolated` runs in a throwaway container: it boots the same Supabase Postgres image, lets the real GoTrue build the `auth` schema, replays `supabase/migrations` in order, and deletes the container afterwards. It needs no Supabase CLI and leaves your local stack completely alone — useful because the pinned CLI and a globally installed one can want different Postgres image tags, and an uncached tag turns the rehearsal into a 1.7 GB download.
>
> The rehearsal bundle's addresses are deliberately undeliverable, so it passes `-v rehearsal=on` to skip the deliverability check **and only that check**. A real staging run passes no such variable.

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

**Backend service:** leave `APP_ENV` unset (derived from `VERCEL_ENV`) and add `SUPABASE_URL` and `SUPABASE_ANON_KEY`; see [vercel-environment-variables.md](../guides/vercel-environment-variables.md).

Then **Deploy**, and copy the resulting URL back into Supabase **Site URL** ([step 3](#3-configure-supabase-auth)).

## 7. First cloud smoke test

| # | Check | Expected |
|---|---|---|
| 0 | `GET /api/backend/health` | `200` `{"status":"ok","service":"backend","env":"local"}` — proves the backend service built, the rewrite routes to it, and the app is mounted under the prefix |
| 1 | `GET /api/health` | `200` with `{"status":"ok","service":"frontend",…}` |
| 2 | `/` | Landing renders; no environment error in the Vercel function logs |
| 3 | `/auth/sign-in` | Renders in Arabic (RTL) by default, with the locale switch working |
| 4 | `/b2b` signed out | Redirects to `/auth/sign-in?next=/b2b` |
| 5 | `/admin` signed out | Redirects to `/auth/sign-in?next=/admin` |
| 6 | Request a code, then verify it | Email arrives showing a **6-digit code**, and it is accepted |
| 7 | Signed in as the showroom owner (`hana-showroom-owner` in the manifest) | Lands on `/b2b`, the showroom workspace |
| 8 | Walk the demo world | Products, RFQs, quotations, orders, projects, people, and sales analytics all show seeded rows |
| 9 | Sign in as a `/home` account (e.g. `karim-branch-sales`) | Lands on the personal home with a **complete** profile, not a blank one — then the workspace switcher reaches `/b2b` |
| 10 | Sign out | Returns to `/auth/sign-in` |

A failure at #6 is almost always the Magic Link template ([step 3](#3-configure-supabase-auth)). A failure at #2 with a configuration error means a `NEXT_PUBLIC_*` variable is missing — Vercel requires a **redeploy** after adding one. **Check #0 was verified on the PR #28 Preview deployment (2026-08-16)** and resolved: the rewrite routes correctly, rewrite order is right, and **Vercel Services forwards the original path without stripping the matched prefix** — FastAPI receives the literal `/api/backend/health`. The app is therefore mounted under the prefix (see [Backend route mounting](#backend-route-mounting)). If #0 regresses:

- **The Next.js 404 page** → the catch-all rewrite matched first. Check rewrite order in `vercel.json` (`/api/backend` must precede `/(.*)`).
- **A FastAPI JSON `{"detail":"Not Found"}`** → the app is no longer mounted under the prefix. Check `API_PREFIX` and the single `include_router(...)` in `backend/app/main.py`. Do **not** also change the rewrite — the prefix is handled on exactly one side.

## 8. Before Client UAT

Out of scope for this runbook; each needs its own change:

- **Custom SMTP** — mandatory. Supabase's built-in email service only reaches project team members at a few messages per hour, so no external client can sign in until a real provider is configured under Authentication → Emails → SMTP Settings.
- **Stable custom domain** (optional but recommended) — attach it in Vercel, then update the Supabase **Site URL** and Redirect URLs to match.
- **WhatsApp OTP** — the canonical model includes it; only Email OTP is implemented today.

## Migration-first deployment

> **Invariant.** The application must never become customer-facing while the database schema is older than the application expects.

**Why this exists.** After PR #73 merged, Vercel promoted the new `main` build automatically while the staging database still lacked 13 migrations. Every authenticated installer page failed with Next's generic "Application error", because `app/home/layout.tsx` calls `job_opportunities_page` for every `/home/*` page. Clearing cookies "fixed" it only because it signed the caller out. It was a deployment-ordering failure, not an auth failure, and it was the second time staging had fallen behind `main` (see [Migration safety protocol](#migration-safety-protocol)). A manual checklist did not prevent the repeat, so the order is now enforced by [`.github/workflows/deploy-staging.yml`](../../.github/workflows/deploy-staging.yml).

### The flow, for the exact commit that triggered the run

```
main commit
  -> Vercel BUILDS it but does NOT make it customer-facing        (project setting, owner action below)
  -> pin the Supabase target                                      supabase link + project-ref check
  -> migration-history plan                                       supabase migration list --linked --output-format json  +  scripts/migration-history-guard.mjs
  -> database dry run                                             supabase db push --linked --dry-run
  -> re-check that this commit is still main's head               scripts/main-head-check.mjs --stage pre-migrate
  -> migrate                                                      supabase db push --linked --yes        (once; stops on the first failure)
  -> verify                                                       0 mismatches, nothing pending, dry run upToDate
  -> find the READY Vercel deployment built from EXACTLY this commit   scripts/vercel-deploy.mjs find-deployment
  -> re-check that this commit is still main's head               scripts/main-head-check.mjs --stage pre-promote
  -> promote that existing deployment (no rebuild)                vercel promote
  -> authenticated smoke (read-only)                              frontend/e2e-staging/staging-smoke.spec.ts
```

A failed migration, verification or promotion stops the run: nothing is promoted and the previous deployment keeps serving.

**An older commit is never migrated or promoted after a newer one has become `main`.** `cancel-in-progress: false` serialises runs, but it does not stop `main` from advancing while a run is installing, planning, migrating or waiting for Vercel, so the head of `main` is re-checked at three points by one helper, `scripts/main-head-check.mjs` (full 40-character SHA comparison, never a prefix; it fails closed if it cannot tell):

| Check | Where | If superseded |
|---|---|---|
| `initial` | right after checkout | nothing is written |
| `pre-migrate` | immediately before `supabase db push` | **no migration**, no promotion; the run exits safely and the newer commit's run deploys it |
| `pre-promote` | immediately before `vercel promote` | **no promotion**; the database is **not** rolled back (it is forward-only) and the newer commit's run continues from the forward-compatible schema |

The last case is exactly why every migration must be backward-compatible (expand/contract, below). A superseded run is a normal, green outcome with a notice and a summary, not a failure. `scripts/deploy-staging-workflow.test.mjs` evaluates the workflow's real step conditions for every combination of answers and fails if `db push --yes`, `vercel promote` or the smoke can run after their own check says superseded.

### What is never automatic

`--include-all`, `supabase migration repair`, `supabase db reset`, raw SQL that bypasses the migration system, a database rollback, and a Vercel rollback. History drift and out-of-order migrations **fail the run and need a human**.

### The migration-history guard (`scripts/migration-history-guard.mjs`)

The Supabase CLI is the only authority on history; the script keeps no second model of it and never reads the database itself. It classifies the rows of `supabase migration list --linked --output-format json`:

| Case | Meaning | Result |
|---|---|---|
| matched | local version == remote version | fine |
| local-only, **newer** than the newest remote version | a normal pending migration | valid; listed |
| local-only, **older** than a version already applied | out-of-order history | **FAIL** |
| remote-only | applied to the database but absent from the repository (history drift) | **FAIL** |
| malformed CLI output | unusable | **FAIL closed** (exit 2) |

In the *verify* step the same guard runs with `--expect up-to-date`, so anything still pending reads "Database schema behind application". It also cross-checks `db push --dry-run` against the list; the two must agree. Unit tests: `node --test scripts/*.test.mjs` (also run on every PR by the `migration-policy` job).

There is **no permanent `staging-known-extras.txt`**: the ten Admin migrations that shared staging had recorded from an unmerged branch were reconciled into `main` by PR #74, and `supabase migration list --linked` from `main` shows 0 mismatches.

### Expand / contract (required)

Because the database is migrated **before** the new application is promoted, the **old** application briefly runs against the **new** schema. Every migration must therefore be backward-compatible with the application that is currently promoted.

- **Release N** adds compatible schema: a new column, table, or function signature *alongside* the old one. Old and new application both work. Promote the new application.
- **Release N+1** removes the old schema or signature, only after nothing that is still promoted depends on it.

`20261007090004_job_canonical_location_and_specialty.sql` is the pattern to avoid: it drops and recreates the `job_create` / `job_update` signatures in a single migration. (It was applied before this policy; it is history and is not rewritten.) `scripts/migration-policy.mjs`, run on pull requests by the `migration-policy` check, surfaces this class of change: drop table/column/function/view/type, renames, column type changes, `truncate`, and drop-and-recreate of a function signature. A destructive-looking migration **fails** unless the file carries a reviewed marker that states why it is safe and which earlier release made it safe:

```sql
-- migration-policy: destructive-reviewed - release N added new_rpc and was promoted; nothing calls old_rpc any more
```

The policy also fails any PR that edits, deletes or renames an already-merged migration (applied migrations are immutable), and any new migration whose version is not newer than the newest on the base branch (unless it carries `-- migration-policy: out-of-order-reviewed - <reason>`, as PR #74 would have). It is a **review aid, not a proof**: it cannot see dynamic SQL, and 14 of the 100 migrations that existed when it was written would have been flagged, because drop-and-recreate has been routine here. Treat a pass as "nothing obvious", not as "backward-compatible".

### Environment policy

| Environment | Database | Rule |
|---|---|---|
| **Local** | local Supabase (`supabase start`) | `db reset` is allowed and expected. |
| **Feature branch with database changes** | **isolated local Supabase only** | Never write a migration to shared staging from a branch. (Supabase preview branches need a paid plan; the local stack is what CI already uses.) |
| **Code-only preview** | currently shared staging | A **temporary compromise**, and explicitly **non-isolated**: it shares data, mutations, the auth backend and server-side effects with staging. No schema writes from a preview. A PR with migrations is tested locally, never previewed against staging. Later: an isolated Supabase preview branch per PR. |
| **Shared staging** | `aladdin-staging` | Merged `main` only. Migration-first -> verify -> promote -> smoke, by `deploy-staging.yml`. |
| **Production** (future) | its own Supabase project and its own Vercel project | The same migration-first architecture, a GitHub `production` Environment, and a required human approval before migration and promotion. |

### One-time setup (owner actions)

Nothing in `deploy-staging.yml` writes anything until **all** of this is done. Until then every run is **plan-only**: read-only checks that migrate nothing and promote nothing.

1. **GitHub Environment `staging`** (Settings -> Environments). Restrict *Deployment branches* to `main`; optionally add required reviewers. Secrets and variables are environment-scoped, not repository-wide:

   | Kind | Name | Used for |
   |---|---|---|
   | secret | `SUPABASE_ACCESS_TOKEN` | the Supabase CLI: `link`, `migration list`, `db push` (token auth through a temporary login role; no database password) |
   | secret | `SUPABASE_DB_PASSWORD` | **not used by the workflow.** It may stay in the Environment unused and be removed later. Do **not** pass it to the CLI in CI: a database password makes the CLI open a direct database connection (which failed from GitHub's runners with `LegacyDbConnectError`); the workflow authenticates with `SUPABASE_ACCESS_TOKEN` and the CLI's temporary login role instead. |
   | secret | `VERCEL_TOKEN` | listing and promoting deployments (project-scoped token) |
   | secret | `SMOKE_INSTALLER_PHONE`, `SMOKE_INSTALLER_PASSWORD` | the installer smoke account |
   | secret | `SMOKE_BUSINESS_EMAIL`, `SMOKE_BUSINESS_PASSWORD` | the business smoke account |
   | variable | `SUPABASE_PROJECT_REF` | the explicit Supabase target |
   | variable | `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | the explicit Vercel target. `VERCEL_ORG_ID` is the team **id** (`team_...`): used by the REST helper and, with `VERCEL_PROJECT_ID`, to identify the project to the CLI |
   | variable | `VERCEL_TEAM_SLUG` | the Vercel team URL **slug** (for example `aladdin8`): the only value the Vercel CLI `--scope` accepts (promote and the printed rollback command). Required for deploy mode; validated as lowercase letters, digits and hyphens and rejected if it looks like a `team_...` id |
   | variable | `STAGING_BASE_URL` | the live staging `https://` URL the smoke visits (never inferred) |
   | variable | `STAGING_PROMOTION_ENABLED` | the master switch; anything but exactly `true` keeps the workflow plan-only |

   No value is printed by the workflow, and none is committed.
2. **Smoke accounts.** Two dedicated, non-human staging accounts, not anyone's personal or manual-QA account: an installer/craftsman (`/installer/sign-in`, phone + password) and a business/poster (`/auth/sign-in`, email + password). Sign-in has no CAPTCHA, but sign-up does (Turnstile), so they are created once by hand through the real sign-up flows, then fully onboarded (the installer must reach `/home`; the business account must belong to an organization so `/b2b` and `/b2b/jobs` render). Passwords live **only** in the GitHub Environment, never in a migration, seed, source file or doc.
3. **Vercel: stop automatic promotion.** Project -> Settings -> Environments -> **Production** -> Branch Tracking -> turn **off** *Auto-assign Custom Production Domains* (API field `autoAssignCustomDomains = false`; verify the label in the current Vercel docs, it has moved before). Then a `main` build is *staged* and only `vercel promote` makes it live. The workflow reads this setting live and **refuses to migrate while it is on**. Run it once in plan mode first: it prints the current value without failing.
4. **Dry run.** Run *Deploy staging* manually with `mode = plan` and read the summary (migration history compatible, dry run agrees, Vercel setting reported).
5. **Switch on.** Set `STAGING_PROMOTION_ENABLED=true`. From then on a push to `main` migrates, promotes and smokes automatically.
6. **Require the check.** Add `migration-policy` to the `main` ruleset's required status checks.

Switching `STAGING_PROMOTION_ENABLED` back to anything else returns the workflow to plan-only without a code change.

### If something fails

| Failure | What happens | What a human does |
|---|---|---|
| plan: drift or out-of-order history | run fails before any write | reconcile the history through a reviewed PR; never `repair` or `--include-all` to make it pass |
| migrate fails | run fails; nothing is promoted; the previous deployment keeps serving; migrations are transactional per file | fix forward with a new migration; the failed file is not edited |
| verify fails | run fails; nothing is promoted | investigate; do not promote by hand |
| no READY deployment for the commit | run fails after waiting (25 min) | check the Vercel build |
| promote fails | run fails | re-run, or promote that deployment in Vercel |
| smoke fails **after** promotion | run goes **red**, prints the previous production deployment and the exact `vercel rollback` command; **nothing is rolled back automatically** | decide: roll back only if the previous application is known to be compatible with every migration just applied, otherwise fix forward |

The database is **forward-only**. Automatic alias rollback is deliberately not part of v1: it is only safe once expand/contract is enforced, because the previous application may not work against a schema that has just moved on.

### Error boundaries (defence in depth, not the fix)

`frontend/src/app/error.tsx` and `frontend/src/app/global-error.tsx` replace Next's generic "Application error" with an Aladdin-branded, Arabic/English, theme-aware recovery screen (Retry, Home, and an opaque reference code). They show no raw error text, never touch the session cookie, log only the error's name and digest, and never substitute empty data for a failed page: a missing migration still shows as a failure, and the deployment guard still fails first. `app/error.tsx` is what catches an exception thrown by a segment *layout* such as `app/home/layout.tsx`, which a segment's own `error.tsx` cannot.

### Follow-up (not in v1): schema-drift report

`supabase db diff --linked --schema public,app` (about a minute) correctly shows when staging's *definitions* differ from the repository, which a version-only check cannot. It is too noisy to gate on: a database populated from CRLF migration files differs in every function body, and it lists default-privilege lines and comment-only changes. A manual or scheduled, **informational** report that normalizes carriage returns and never modifies the database, and never blocks promotion, is the intended next step.

## Scope

The first cloud STAGING environment: which services exist, which variables they need, how schema and demo data reach them, and how to verify the result.

## What is deferred

- **Production rollout.** It requires **separate infrastructure** — its own Supabase project, its own Vercel project, its own secrets — and must never load the demo seeds. Not documented until staging is proven.
- Custom SMTP, custom domain, preview-deployment auth, and per-environment CI/CD promotion gates.
- **Backend secret provisioning** — `APP_ENV=staging` plus `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_JWT_SECRET` / `DATABASE_URL`, landing with the first real AI/OCR/document endpoint.
- **Worker hosting** — no worker is implemented; a new ADR picks the host ([ADR-0009](../decisions/ADR-0009-vercel-services-deployment.md)).

## Consequences

- Staging holds **synthetic data only** and can be recreated by rebuilding the project and re-running [steps 2](#2-push-the-schema) and [4](#4-load-the-staging-demo-data).
- Schema changes reach staging through `supabase db push` and nothing else - run by the migration-first workflow (see [Migration-first deployment](#migration-first-deployment)), never from a feature branch; the local `db reset` flow stays local.
- Adding an environment variable means adding it to `frontend/src/lib/env/index.ts` (where the exposure test enforces the public/secret split), to `frontend/.env.example`, and to the table above.

## Related files

[`deployment-overview.md`](deployment-overview.md) · [`RUNTIME_STATE.md`](RUNTIME_STATE.md) · [`staging-demo-accounts.md`](staging-demo-accounts.md) · [`../security/secrets-and-environments.md`](../security/secrets-and-environments.md) · [`../decisions/ADR-0004-deployment-platforms.md`](../decisions/ADR-0004-deployment-platforms.md) · `scripts/build_staging_seed.py` · `scripts/verify_staging_seed.py` · `scripts/rehearse_staging_seed.py` · `frontend/src/lib/env/index.ts`

## Supabase authentication in CI: token only, and failures are visible

* The workflow runs `supabase link --project-ref "$SUPABASE_PROJECT_REF" --yes`, `--output-format json migration list --linked`, `--output-format json db push --linked --dry-run` and (deploy mode only) `db push --linked --yes`. None of them takes a database password; `SUPABASE_DB_PASSWORD` is not read, required or injected.
* Both the dry run and the real push acquire access the same way: `POST /v1/projects/<ref>/cli/login-role` with the access token ("Initialising login role..."), then connect with that temporary role. A successful PLAN-only run therefore validates that the token can mint the role the later write needs.
* With `--output-format json` the CLI reports a failed command as `{"_tag":"Error","error":{"code","message","suggestion"}}` on **stdout**. A bare `> file` redirect hides it, so the read-only commands run through `scripts/supabase-capture.mjs`, which keeps stdout for the guard and, on failure, prints only `error.code`, `error.message` and `error.suggestion` (or a redacted tail of stderr) and exits non-zero. Secrets, credential-bearing URIs and token shapes are redacted, and `scripts/migration-history-guard.mjs` fails closed with a readable line when handed such an error file.

### `LegacyDbConfigIpv6Error` and the link diagnostic

GitHub's runners have no IPv6 and a project's direct database host (`db.<ref>.supabase.co`) is IPv6-only. Supabase CLI 2.110.0 resolves a `--linked` connection by probing that host over TCP; if it is unreachable it uses the pooler URL that `supabase link` saved in `supabase/.temp/pooler-url` (read only if present and non-empty; on the linked path there is no Management API fallback), validates it (parseable, user or `reference` option bound to this project ref, domain is the profile's pooler domain) and mints a temporary login role through it. With no usable pooler URL it fails with `LegacyDbConfigIpv6Error` ("IPv6 is not supported on your current network").

The step "Diagnose the Supabase link" runs `scripts/supabase-link-diagnostic.mjs` right after `supabase link`. It is **observation only**: it reads `project-ref` and `pooler-url` and prints just `project_ref_*`, `pooler_url_present|nonempty|parseable`, `pooler_host_is_supabase_pooler`, `pooler_project_binding_matches`, a port number and one `pooler_verdict` (`missing`, `empty`, `unparseable`, `not_supabase_pooler`, `project_binding_mismatch`, `looks_valid`). It never prints the URL, host, user or any secret, never writes, fetches or deletes anything, and fails only when the linked project-ref does not match `SUPABASE_PROJECT_REF`. Read the verdict together with the plan step's result:

* `missing` / `empty` -> `supabase link` did not leave a pooler URL on the runner.
* `unparseable` / `not_supabase_pooler` / `project_binding_mismatch` -> a file exists but the CLI will reject it.
* `looks_valid` and the plan still fails with the IPv6 error -> the CLI is not using a valid saved pooler URL for some other reason.

### Why `supabase link` can succeed with no `pooler-url`

In CLI 2.110.0, `link` learns the pooler URL as a **best-effort** step (`legacy-link-services-core.ts`): `GET /v1/projects/<ref>/config/database/pooler` (expected `200`, a JSON array), take the entry whose `database_type` is `PRIMARY`, strip the password placeholder, force session port 5432, and write `supabase/.temp/pooler-url`. The whole step is wrapped in `Effect.ignore`: a network error, `401`/`403`/`404`, an unexpected status, a response that does not decode, or no `PRIMARY` entry all leave **no** file while `link` still prints "Finished supabase link." and writes `project-ref`.

The step "Diagnose Supabase pooler Management API" (`scripts/supabase-pooler-api-diagnostic.mjs`) repeats that single read-only call with the same token and prints only `pooler_api_request_completed`, `pooler_api_http_status`, `pooler_api_success_status`, `pooler_api_json_parseable`, `pooler_api_entry_count`, `pooler_api_primary_found`, `pooler_api_primary_connection_string_present`, `pooler_api_primary_pool_mode` and one `pooler_api_verdict` (`request_failed`, `unauthorized`, `forbidden`, `not_found`, `unexpected_status`, `malformed_response`, `no_primary`, `primary_missing_connection_string`, `looks_valid`). It never prints the token, a header, the response body or any connection detail, reads the body only on `200`, and changes nothing. Read it with the "Diagnose the Supabase link" step: `pooler_url_present=false` together with `forbidden` means the token cannot read the pooler config; with `looks_valid` the call works from the runner and the missing file has another cause.

### Machine-readable output: ask for JSON on every captured command

The migration-history guard parses JSON. Supabase CLI 2.110.0 only **defaults** to JSON when it detects a coding agent; on a CI runner it prints human text unless `--output-format json` is passed. The first run that got past the pooler problem failed in the guard with "no JSON object found in the CLI output" because the dry run (`db push --linked --dry-run`) had not asked for JSON and printed the text sentence `Remote database is up to date.`. It was invisible in local runs from an agent-detected environment, where the CLI emits JSON by default.

Every command run through `scripts/supabase-capture.mjs` therefore passes the **global** flag first: `--output-format json migration list --linked` and `--output-format json db push --linked --dry-run` (both flag positions work; first is the documented form for a global flag). `supabase-capture.mjs` also checks the contract: if a command that asked for JSON exits 0 but its stdout holds no JSON object, it fails with the closed-vocabulary reason `unexpected_output_format` / `expected=json` plus `stdout_bytes`, `stdout_lines`, `stdout_starts_with` (`empty|brace|bracket|letter|digit|other`) and `stdout_has_json_object=false`. It never prints the stdout itself, which could contain connection details. The guard is unchanged and still fails closed.
