# ADR-0028 — Retired entry URLs answer 404 for everyone

**Status:** Accepted · 2026-11-15 · owner decision in the project thread ("why not 404 for everyone, with /auth/sign-in the only sign-in?").

**Amends:** [ADR-0025](ADR-0025-one-field-sign-in-whatsapp-sign-up.md), Revision 2026-11-15 ("retired entry URLs no longer redirect"), which is kept unchanged as history. Linked both ways.

## Purpose

State exactly what the retired phone entry URLs do, after the redirects to `/auth/*` were removed.

## Current decision

All six retired URLs answer **404 for everyone**, logged in or not, with no redirect: `/installer/sign-in|sign-up`, `/showroom/sign-in|sign-up`, `/temporary/craftsman/sign-in|sign-up`. Sign in and sign up exist only at `/auth/sign-in` and `/auth/sign-up`.

## Rationale

ADR-0025's revision said the app "answers 404 like for any unknown path". That was true for `/installer/*` and `/temporary/craftsman/*` but not for `/showroom/sign-in|sign-up`: they matched the dynamic route `app/(workspace)/showroom/[page]`, and the Showroom layout guard (`requireShowroomContext`) redirected a logged-out visitor to `/auth/sign-in?next=...`. The owner spotted it; the Auth CAPTCHA E2E on `main` then failed on the same point (expected 404, received 307). A single behaviour for all six paths is simpler to explain and to test than a guard-dependent redirect.

## Scope

- Two route handlers, `frontend/src/app/(workspace)/showroom/sign-in/route.ts` and `.../sign-up/route.ts`, answer a plain 404. A route handler is not wrapped by the layout guard, so the paths never reach `/showroom/[page]`.
- `e2e/one-field-auth.spec.ts` asserts 404 for all six paths; `showroom-shell/persistent-shell.test.ts` pins that each of the two folders holds only `route.ts` and that it answers 404.
- On the public production domain Cloudflare still blocks all of them at the edge (403), so they never reach the Worker there; this decision matters for every other origin (local, preview, version URLs).

## What is deferred

Nothing. If a redirect for old shared links is ever wanted again, it needs its own decision (it would send the visitor to `/auth/sign-in`).

## Consequences

Old shared links to these URLs show a 404 page. A new dynamic route under `/showroom` must not shadow these two names with a guard redirect (the unit test fails if the folders gain a page).

## Related files

`frontend/src/app/(workspace)/showroom/sign-in/route.ts`, `frontend/src/app/(workspace)/showroom/sign-up/route.ts`, `frontend/e2e/one-field-auth.spec.ts`, `frontend/src/features/showroom-shell/persistent-shell.test.ts`, `frontend/next.config.ts`, [ADR-0025](ADR-0025-one-field-sign-in-whatsapp-sign-up.md).
