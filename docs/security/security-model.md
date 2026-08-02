# Security Model

**Status:** Living document · 2026-07-29

## Purpose

State Aladdin's security posture and the invariants every feature must uphold.

## Current decision

**Identity & auth (passwordless):** registration/sign-in via **WhatsApp OTP** or **Email OTP / verification link**. One verified primary contact per account; secondary added later from settings. **No passwords, no SMS.** reCAPTCHA only on account creation. One canonical identity regardless of verification method. Auth is backed by Supabase Auth; every session yields a JWT.

**Authorization:** **Row Level Security is the spine.** Authorization is enforced in the database on every user/organization/verification/sales/project/file/AI table, with app-layer checks as defense in depth — never as the only line. Multi-tenant isolation (organization, and branch where applicable) is mandatory.

**Trust boundaries:**
- The browser is untrusted. Only public, `NEXT_PUBLIC_`-prefixed, validated config reaches it.
- All third-party credentials (service-role key, OpenAI, OCR, WhatsApp, email) live server-side only.
- The FastAPI service verifies the Supabase JWT on every request and derives identity from the token, not the body.

**Data protection:** private-by-default Storage buckets for uploads/verification documents with policies reviewed like DB policies; PII minimized in logs; verbose errors never expose stack traces/schema to clients.

**AI-specific:** retrieval applies authorization filters **before** returning content; no cross-organization document leakage; model prompts never embed another tenant's data.

## Rationale

A multi-tenant B2B platform's dominant risk is cross-tenant data exposure. Enforcing authorization at the data layer makes the guarantee hold across web, worker, and AI paths uniformly.

## Scope

All services and data paths. Detailed RLS patterns in `rls-strategy.md`; environment/secret handling in `secrets-and-environments.md`.

## What is deferred

Formal threat model, pen-test, and per-feature authorization matrices — added as features land.

## Consequences

A table without RLS, a secret in client code, or an AI path without tenant filtering is a release blocker.

## Related files

`rls-strategy.md` · `secrets-and-environments.md` · `../architecture/data-flow.md` · `supabase/AGENTS.md`
