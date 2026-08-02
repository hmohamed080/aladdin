# Secrets & Environments

**Status:** Living document · 2026-07-29

## Purpose

Define how configuration and secrets are handled across Local, Staging, and Production.

## Current decision

**Environments:** `Local` (developer machine + local Supabase) · `Staging` · `Production`. Development resembles production as closely as practical (12-factor).

**Secret handling:**
- Secrets live in each platform's secret store (Vercel, Railway, Supabase), **never in source control**.
- `.env` files are gitignored; only `*.env.example` templates are committed, with placeholder values, documenting each variable's **purpose, exposure level (public/secret), and required/optional** status.
- **No real Production secrets are used during foundation/dev tasks.**

**Frontend:**
- One validated env module (`frontend/src/lib/env/`). Components never read `process.env` directly.
- Only `NEXT_PUBLIC_`-prefixed variables may reach the client; **service-role, OpenAI, OCR, Railway, and other server secrets are never exposed client-side.**

**Backend:**
- `backend/app/config.py` (Pydantic Settings) is the only settings source; no `os.getenv`/`load_dotenv` in app code.
- **Fail fast** on missing required variables. **No silent defaults for security-sensitive config.**

**Exposure classes:**

| Class | Example | Where it may live |
|---|---|---|
| Public (client-safe) | `NEXT_PUBLIC_SUPABASE_URL`, anon key | browser + server |
| Server secret | service-role key, `OPENAI_API_KEY`, OCR key | server / worker only |
| Platform secret | DB connection string, Sentry DSN (server) | platform secret store |

## Rationale

A single validated settings module per service turns "missing/leaked env var" from a runtime surprise into a startup failure or a lint-visible mistake.

## Scope

All configuration and secret material.

## What is deferred

Secret rotation policy and per-environment CI wiring — added with the deployment pipeline.

## Consequences

A secret in client-reachable code or a bypass of the settings module is a release blocker.

## Related files

`security-model.md` · `frontend/.env.example` · `backend/.env.example` · root `AGENTS.md` (Configuration discipline)
