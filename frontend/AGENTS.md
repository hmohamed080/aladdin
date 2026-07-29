---
description: Scoped agent instructions for the Aladdin Next.js web application.
alwaysApply: true
---

# Frontend — Agent Instructions

Extends the root `AGENTS.md`. Read that first. This file governs `frontend/`.

## Stack (locked — see ADR-0001)

Next.js **App Router** · React · TypeScript **strict** · Tailwind · Radix / carefully-chosen shadcn primitives · React Hook Form + Zod · next-intl · TanStack Table (where a real table is needed).

**Never** initialize Vite, create a React SPA, or add React Router.

## Rendering model

- **Server Components by default.** Add `"use client"` only when interactivity (state, effects, event handlers, browser APIs) genuinely requires it.
- **Server Actions** for mutations that belong to the app; **Route Handlers** (`src/app/**/route.ts`) for webhooks, BFF endpoints, and third-party integrations.
- Never expose server secrets to Client Components. Only `NEXT_PUBLIC_`-prefixed, validated variables may reach the client.

## Organization — by product domain, not file type

```
src/
  app/            # routes only: compose screens, load route data, route-level authz
  components/     # ui/ (primitives) · layout/ · shared/ (only after a 2nd real consumer)
  features/<domain>/   # auth, accounts, organizations, verification, catalog, inventory,
                       # sales, rfq, quotations, projects, notifications, advertisements,
                       # analytics, admin, ai — each owns its components, schemas, types,
                       # server actions, queries, tests, constants, mappers
  lib/            # env/ · supabase/ · auth/ · i18n/ · permissions/ · validation/ · observability/
  server/         # actions/ · queries/ · authorization/ · integrations/
  styles/  types/
```

- **Do not** create giant global `components/`, `hooks/`, `utils/`, or `services/` folders full of unrelated business logic. Shared code moves to a shared location only after a genuine second consumer exists.
- **Keep page and layout files thin**: compose the screen, load route-specific data, call domain services, handle route-level authorization. No hundreds of lines of business logic in a page file.

## Configuration

- One validated environment module in `src/lib/env/`. **Never** read `process.env` from components or ad-hoc code.
- Public variables must be `NEXT_PUBLIC_`-prefixed **and** validated; server-only variables must never be imported into a Client Component.

## i18n, RTL & theming

- English (LTR) and Arabic (**RTL**) are both first-class; build components RTL-aware from the start via next-intl. Arabic is part of the MVP.
- Light and Dark modes from the design system. Use Egyptian data conventions (localities, EGP) where relevant.

## Design fidelity

Implement against approved screens in `UI-UX/design.pen` (see `UI-UX/AGENTS.md`). Never edit `.pen` files from a coding task. Internal session labels / design-agent notes must never appear in production UI.

## Testing & quality (see `docs/` for strategy)

- TypeScript strict, ESLint clean — both must pass before "done".
- Unit tests for important pure logic (validation, mappers, permissions); component tests where behavior is non-trivial (loading/error/empty states, not internal state); Playwright for critical journeys later; accessibility and responsive checks.
- No meaningless placeholder tests.

## Commands

```bash
pnpm install            # from repo root or frontend/
pnpm --filter frontend dev
pnpm --filter frontend typecheck
pnpm --filter frontend lint
pnpm --filter frontend test
```
