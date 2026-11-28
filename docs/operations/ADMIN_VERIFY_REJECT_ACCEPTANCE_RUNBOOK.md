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
| 4 | Moderator (holds `users.verify`) / Support (does not) | Open the user page | Moderator sees live Verify/Reject (centralized `users.verify`); a role without `users.verify` sees no controls and the RPC refuses |
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

## Acceptance UI results (2026-11-15, preview version 9ce3d4a9, commit 8dd4a379, Acceptance project only)

Isolated data: two `TEST-192` showroom organizations (owners: existing Acceptance accounts `+t1`, `+t2`), created through
`app.organization_create_owned` / `organization_application_submit`, then completed with `organization_contact_set`,
`organization_activities_set` and a branch address. Real requests were not touched.

| Check | Surface | Result |
|---|---|---|
| Approve, public listing off | Organization page header | PASS: org `active`, verification `approved` + applied, `grants_public_listing=false`; one each of `verification.review_started`, `verification.approved`, `organization.verified`; one owner notification with empty params |
| Approve blocked by incomplete showroom data | Organization page header | Refused by the database ("complete showroom business information before approval"), nothing approved. The UI shows only the generic "Something interrupted the request", not the cause (UX gap) |
| Reject with empty reason | Organizations list row | PASS: blocked in the form, database unchanged |
| Reject with reason + double-click confirm | Organizations list row | PASS: one `review_started` and one `verification.rejected` (reason recorded), org unchanged, one owner notification with empty params |
| Approve controls on an approved org | Organizations list / page | Controls no longer drawn |

Not covered in the browser (recorded gaps):

- Multi-session UI: Administrator B refused as non-assigned reviewer (step 7), Administrator/Moderator permission matrix (step 4),
  and the concurrent approve/reject race (step 11). Covered by the rolled-back SQL tests (`128`, `132`) only.
- Professional account (user) approval/rejection in the UI: needs throwaway applicants signed in by the owner.
