# Engineer contact phone — deployment handoff

## Purpose and current decision

The owner explicitly deferred WhatsApp OTP integration on 2026-10-29 because the shared integration is still being prepared. This is a deployment handoff, not a claim that verification or conditional phone disclosure is implemented.

## Scope and rationale

When resuming this feature, reuse the canonical WhatsApp OTP flow adopted by the other account types. Inspect that implementation at deployment time; do not invent a parallel provider or use login-phone mutation to verify a separate contact number.

The engineer may choose an already verified account phone or verify a different contact phone. Keep contact-phone verification separate from authentication credentials. A saved number alone is not proof of ownership.

## Required implementation before enabling disclosure

- Use the shared server-side WhatsApp verification flow, including its expiry, attempt limits, resend limits and replay prevention. Bind successful verification to the exact number and authenticated owner; changing the number invalidates verification.
- Reuse an account number only when the canonical system provides authoritative verification evidence for that number.
- Enforce contact read authorization on the server/database: the viewer is signed in and has started work with this engineer. Completed work also qualifies; merely viewing a profile, messaging, requesting a quote or accepting a request without starting work does not.
- Resolve started-work status from the platform's authoritative work relationship. Do not trust a client-provided relationship flag.
- Keep the contact number out of anonymous/public profile payloads, page source, metadata and shared caches. Hiding a rendered field is insufficient.
- Until the canonical integration is available, keep new contact numbers unverified and undisclosed. Do not add demo OTP codes or mark successful saving as verification.

## Deferred work and consequences

Actual WhatsApp sending/verification and started-work-only contact disclosure remain unfinished. Deployment of other changes is not authorization to enable this feature. If the shared integration is still missing at release time, leave disclosure disabled and report the remaining dependency.

## Validation and related files

The implementing agent should run focused authorization checks for anonymous viewers, unrelated signed-in viewers, pre-start relationships, started work and completed work, plus invalid/expired/replayed OTPs. The owner performs browser/page-experience testing and receives a short manual checklist.

Existing implementation entry points to inspect: `frontend/src/features/settings/identity-card.tsx`, `frontend/src/server/actions/profile-identity.ts`, and `frontend/src/server/actions/contacts.ts`. These references identify existing code, not evidence that its current behavior satisfies this new policy.
