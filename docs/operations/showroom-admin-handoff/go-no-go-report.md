# Showroom V2 & Admin: status and GO/NO-GO (updated 2026-10-18)

PR: [#88 Business verification](https://github.com/hmohamed080/aladdin/pull/88). The full scope checklist is in [remaining-scope-checklist.md](remaining-scope-checklist.md).

## Production verdict: NO-GO

This is not a production release yet, for these reasons:

1. The R2 integration is not cleared. Your instruction was not to deploy until it is.
2. The two new migrations are not applied anywhere. They need your approval, staging first.
3. No browser journey has been run against a real Supabase stack, on desktop or mobile, in Arabic or English, in light or dark. This environment cannot run one because Docker image pulls are rate-limited.
4. The hosted GoTrue CAPTCHA gap is still open. It belongs to the Auth security owner.
5. The rest of the 2026-10-18 scope (phone reservations, Admin users/staff fixes, Offers, R2, the Supabase usage audit) is in progress.

## Implemented in PR #88 (business verification, high priority)

**Showroom owner (`/showroom/verification`):**
- Private document upload: PDF, JPG, PNG or WebP, up to 10 MB each and 10 per request.
- Drafts, submitting, and resubmitting after a request for information.
- Pending / Under review / Information requested / Verified / Not approved states, with reasons and the full history.
- Documents stay optional during registration. They can be uploaded while the application is still pending and sent once the business is approved.

**Admin (`/admin/business-verification`):**
- A queue with status, business-type and name filters, plus pagination.
- An evidence view with each submission round and the earlier requests.
- Admin Notes.
- Start review, Request information, Approve and Reject. Every one needs a reason, is audited and notifies the business.

**Authority:**
- `verification.approve` sits with Administrator and Super Admin by default and can be delegated to a custom role.
- A Moderator can review and request information but cannot approve or reject.
- A reviewer cannot review their own organization.
- All of this is enforced in the RPCs, RLS and storage policies.

**Badge source:**
- `business_verified_at` drives the badge in the directory, catalog, offers, purchase requests, Settings and the Admin organization page.
- `is_verified` keeps meaning "approved" for every gate.
- **No backfill (Decision B, 2026-10-18):** existing organizations lose the badge until their documents are approved; activation, access and seller permissions are unchanged. `verification.approve` never approves an organization application.

## Verified tests

| Check | Result |
|---|---|
| Typecheck | Clean |
| Lint | 0 errors |
| Vitest | 3,807 passed, 13 skipped |
| Production build | Passed |
| pgTAP (CI, real Supabase stack, `supabase-rls`) | Green: all 117 files pass, including the new file 96. |
| GitHub CI on the PR | frontend, backend, docs, migration-policy and supabase-rls all green; Vercel preview Ready |
| Migration policy | No problems found |

## Still open (not built)

- **Invitation revoke, token hashing and audit, and the false "Invitation sent by email" copy.**
- **The Shared Purchase Requests UI.** Only the backend exists.
- **Points adjust/reverse, staff invite, Admin Settings and the Review Center fixture tab.** These are still Preview.
- **Deferred, not implemented:** subscriptions, ratings, quotation credits and advanced Points.

## Migration and deployment plan

1. Apply `20261017160000` and then `20261017160001` to staging, in that order and only after your approval.
2. Regenerate the types and run the browser journeys on staging.
3. Production: only after R2 is cleared, the staging journeys pass and you approve.
