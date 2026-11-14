# Admin verify / reject: Acceptance validation runbook

Scope: PR #192 only (migration `20261114090001_verification_apply_reviewer_gate.sql` plus the Admin Users / user page
controls). It does not depend on the View-As work (#193, migrations 090002-090004).

Never use real customer requests on Production. On Acceptance use the seeded accounts or accounts you create for this run.

## Preconditions

- The #192 migration is applied to Acceptance (owner approval step a). `supabase migration list` shows
  `20261114090001` on Acceptance only.
- Four Acceptance staff accounts: one Super Admin, one Administrator (A), a second Administrator (B), one Moderator or
  Support user. Three throwaway applicants (end consumers) with the "Request professional account" flow available.

## Automated (run before and after)

- Local: `pnpm exec supabase test db` (includes `128_admin_verification_retry_authorization_test.sql`, 48 checks, and
  `132_admin_verification_acceptance_test.sql`, 51 checks). Both roll back.
- Frontend: `pnpm exec vitest run src/features/admin src/server/actions/admin-forms.test.ts src/app/admin/users`.
- Read-only Acceptance SQL (SELECT only), see "Evidence queries" below.

## Manual steps (Acceptance)

| # | Actor | Action | Expected |
|---|---|---|---|
| 1 | Applicant 1-3 | Submit a professional upgrade request | Request shows "pending" for the applicant |
| 2 | Admin A | Open Admin > Users (and Verifications) | The three real pending requests are listed; no preview-only badge |
| 3 | Anonymous / applicant | Open the Admin URL / call review RPC | Redirect or 403; applicant sees only their own request |
| 4 | Support/Moderator | Open the user page | Verify/Reject controls are absent or refused (no `users.verify`) |
| 5 | Admin A | Approve applicant 1 (public listing OFF) | Status approved, account type changes, profile NOT listed |
| 6 | Admin A | Double-click Approve | One success; no second audit row; no error toast loop |
| 7 | Admin B | Approve or Reject applicant 1 afterwards | Refused ("only the assigned reviewer"); nothing changes |
| 8 | Super Admin | Reject applicant 2 with empty reason | Blocked in the UI and by the RPC |
| 9 | Super Admin | Reject applicant 2 with a reason | Status rejected, reason stored, account type unchanged |
| 10 | Admin A | Try to approve own request (if Admin A has one) | Refused |
| 11 | Two browsers | Admin A and Admin B act on applicant 3 at the same time (one Approve, one Reject) | Exactly one wins; the other gets a clean refusal; one decision audit row |

## Evidence queries (SELECT only, Acceptance)

```sql
-- decisions and audit (actor, role, action, subject, reason)
select a.created_at, a.actor_user_id, a.actor_role, a.action, a.subject_id, a.metadata
from public.audit_log a
where a.action in ('verification.approved','verification.rejected','account.type_changed','profile.listed')
  and a.created_at > now() - interval '1 day' order by a.created_at;

-- state of the three test requests
select id, user_id, status, reviewer_id, decided_at, applied_at, grants_public_listing, reason
from public.verifications where user_id in (/* test applicant ids */);

-- notification side effects: the reason must never appear in params
select event_type, recipient_user_id, params from public.notifications
where subject_type = 'verification' and created_at > now() - interval '1 day';
```

Pass criteria: exactly one decision audit row per request; actor is the deciding admin with the right `actor_role`;
reject rows carry the reason; no email, phone or document path in `metadata`; audit rows cannot be updated or deleted.

## Known behaviours to be aware of

- Only plain spaces are trimmed from a rejection reason (`btrim`); a reason made only of tabs or newlines is accepted.
  Pre-existing, not changed by #192.
- User (non-organization) verification decisions write no notification today; organization decisions notify the
  organization (pinned in test 32).
- The deciding reviewer must be the assigned reviewer (`review_start` claims). A second admin cannot override.

## Rollback

The migration only redefines functions (`create or replace`) and adds one internal helper. To roll back, re-apply the
previous definitions of `apply_account_upgrade`, `apply_organization_verification` and `review_approve` (default
`p_grant_public_listing` true) from migrations before 20261114090001. No data is changed by the migration.
