# System Context

**Status:** Living document · 2026-07-29

## Purpose

Show Aladdin's external actors and systems — who and what it talks to.

## Current decision

**Actors (separate roles under one canonical identity — one person = one user ID; one current primary account type at a time — no persona/profile switcher, though the same user may work across the personal surface and any organization where they hold an active membership):** End Consumer · Installer/Technician · Engineer · Interior Designer · Showroom/Dealer · Supplier · Manufacturer · Importer · Wholesaler · **Sales** (key daily-active B2B user) · Contractor · Trainer · Trainee · Administrator. Navigation/access is derived from primary account type, organization membership, branch assignment, permission capabilities, verification state, and subscription state.

**Surfaces:** B2C (marketplace-style discovery/consultation), B2B (Sales/organization workspace), Admin (control center).

**External systems:**

| System | Purpose | Boundary owner |
|---|---|---|
| Supabase | Auth, Postgres, Storage, Realtime, Queues, vector search | data platform |
| OpenAI | LLM + embeddings | FastAPI service |
| Azure Document Intelligence (candidate) | OCR of uploaded documents | FastAPI service |
| WhatsApp (OTP + operational messaging) | passwordless auth + notifications | server-side only |
| Email provider | Email OTP / verification links, transactional email | server-side only |
| Sentry | error monitoring | all services |
| Vercel / Railway | hosting | ops |

## Rationale

Auth is **passwordless** (WhatsApp OTP or Email OTP/verification link; one verified primary contact). No SMS, no passwords. Keeping every third-party credential server-side (never in the browser) is a hard boundary — see security docs.

## Scope

External interfaces and actors. Internal module structure is in `module-boundaries.md`.

## What is deferred

Payment/escrow providers, training-content delivery, and other integrations tied to post-MVP scope.

## Consequences

Every external integration is invoked from a trusted server context (Next.js server / FastAPI), never the client.

## Related files

`overview.md` · `module-boundaries.md` · `../security/security-model.md` · `../product/mvp-scope.md`
