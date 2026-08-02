# 10 — Environment & CI/CD Strategy

| | |
|---|---|
| **Status** | Living document (canonical engineering reference) |
| **Version** | 1.0.0 |
| **Owner** | Engineering / Ops |
| **Last Updated** | 2026-08-01 |
| **Depends On** | [`../security/secrets-and-environments.md`](../security/secrets-and-environments.md), [`../decisions/ADR-0004-deployment-platforms.md`](../decisions/ADR-0004-deployment-platforms.md), [`../operations/deployment-overview.md`](../operations/deployment-overview.md) |
| **Related** | [`06_testing_strategy.md`](06_testing_strategy.md), [`../development/release-strategy.md`](../development/release-strategy.md) |

Covers **Environment Strategy (19)** and **CI/CD Strategy (20)**. The canonical secret/env policy is [`secrets-and-environments.md`](../security/secrets-and-environments.md); deployment targets are ADR-0004.

## 1. Environment strategy

Three environments, 12-factor (dev resembles prod): **Local · Staging · Production**.

| Concern | Rule |
|---|---|
| **Config source** | one validated module per service — `frontend/src/lib/env` (Zod), `backend/app/config.py` (Pydantic). Never `process.env`/`os.getenv`/`load_dotenv` in app code. |
| **Secrets** | in each platform's secret store (Vercel/Railway/Supabase); **never in source**. Only `*.env.example` templates committed (placeholder values + purpose/exposure/required). |
| **Exposure classes** | Public (`NEXT_PUBLIC_*`, anon key) → browser+server · Server secret (`service_role`, `OPENAI_API_KEY`, OCR/WhatsApp/email keys) → server/worker only · Platform secret (DB URL, Sentry DSN) → platform store. |
| **Fail-fast** | missing required config → startup failure; no silent defaults for security-sensitive values. |
| **Prod safety** | no real Production secrets in dev/foundation tasks; migrations promote Local → Staging → Production (never dashboard edits). |

Targets (ADR-0004): Vercel (web) · Railway/Docker (FastAPI + workers) · Supabase (data) · OpenAI · Azure Document Intelligence (OCR candidate) · Sentry.

## 2. CI/CD strategy

**Status:** CI/CD is **documented, not yet wired** (ADR-0004; the commands exist in the README). This defines the target pipeline for the first implementation phase.

### CI (on every PR to `main`)
1. **Frontend:** `pnpm install --frozen-lockfile` → `typecheck` → `lint` → `test` → `build`.
2. **Backend:** `uv sync --frozen --python 3.12` → `ruff check .` → `pytest`.
3. **Database:** `supabase db reset` (clean apply) → `supabase db lint` → **RLS/organization-isolation tests** → repeatability (2nd reset, no drift).
4. **Docs/repo checks:** internal markdown link check (0 broken); secret scan (no `.env`/`.pen`/keys tracked); `git diff --check`.
5. **Container:** backend `docker build` (non-root, healthy `/health`) on backend changes.

**Gate:** a PR cannot merge unless all CI jobs are green. Branch protection on `main` requires review + green CI ([`09_pull_request_and_review.md`](09_pull_request_and_review.md)).

### CD (later, per release)
- Merge to `main` → deploy **Staging** (Vercel preview + Railway staging + Supabase staging migrations).
- Tagged release (`vX.Y.Z`) → promote to **Production** after Staging verification ([`release-strategy.md`](../development/release-strategy.md)).
- Migrations run through the migration workflow in each environment; backward-compatible (expand→backfill→contract).

### Tooling
- **GitHub Actions** (recommended) for CI; secrets from GitHub encrypted secrets → platform stores. Keep workflows minimal and cache-friendly.
- The same commands run locally, so "works in CI" == "works locally".

## 3. Deferred
Secret rotation policy, per-env CI wiring, preview-env automation, and metrics/alerting — added with the pipeline implementation (a future `deploy/*` task + ADR update if architectural).
