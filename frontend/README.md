# Aladdin Frontend

Next.js (App Router) web application. Read `frontend/AGENTS.md` before changing anything here.

## Quick start

```bash
pnpm install                      # from repo root
cp frontend/.env.example frontend/.env.local
pnpm --filter frontend dev        # http://localhost:3000
```

## Scripts

| Script | Purpose |
|---|---|
| `pnpm --filter frontend dev` | Dev server |
| `pnpm --filter frontend build` | Production build |
| `pnpm --filter frontend typecheck` | `tsc --noEmit` (strict) |
| `pnpm --filter frontend lint` | ESLint (next config) |
| `pnpm --filter frontend test` | Vitest unit tests |

## Layout

- `src/app/` — routes only (thin: compose, load data, route-level authz). Health probe at `src/app/api/health`.
- `src/features/<domain>/` — product domains own their components/schemas/types/actions/queries/tests.
- `src/lib/` — `env` (validated config), `supabase`, `auth`, `i18n`, `permissions`, `validation`, `observability`.
- `src/server/` — `actions`, `queries`, `authorization`, `integrations`.

See `docs/architecture/module-boundaries.md`.
