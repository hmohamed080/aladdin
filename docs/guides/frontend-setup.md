# Frontend Setup

The web app is a Next.js (App Router) workspace managed with **pnpm**. See `frontend/AGENTS.md` for rules.

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9 (`corepack enable` then `corepack prepare pnpm@9 --activate`, or install pnpm directly)

## Install

```bash
# from the repo root (installs the pnpm workspace)
pnpm install
```

## Environment

```bash
cp frontend/.env.example frontend/.env.local
# fill in local Supabase values (see docs/guides/supabase-setup.md)
```

Only `NEXT_PUBLIC_`-prefixed variables reach the browser. All config is read through the validated module in `frontend/src/lib/env/` — never `process.env` directly.

## Run

```bash
pnpm --filter frontend dev        # http://localhost:3000
```

## Validate

```bash
pnpm --filter frontend typecheck  # tsc --noEmit (strict)
pnpm --filter frontend lint       # eslint
pnpm --filter frontend test       # unit/component tests
```

## Notes

- Server Components by default; add `"use client"` only when needed.
- Do not initialize Vite or add React Router — this is Next.js App Router (ADR-0001).
