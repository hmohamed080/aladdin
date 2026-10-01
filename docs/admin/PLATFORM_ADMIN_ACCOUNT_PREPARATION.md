# Dedicated Platform-Admin Account Preparation

**Status:** Approved design, implemented and rehearsed locally 2026-10-01 · **Not yet run on Production** · **Owner:** Admin Core / Operations · **Related:** [`SUPER_ADMIN_BOOTSTRAP.md`](SUPER_ADMIN_BOOTSTRAP.md), [ADR-0011](../decisions/ADR-0011-admin-rbac-platform-authority.md), [BL-033](ADMIN_IMPLEMENTATION_BACKLOG.md), [BL-034](ADMIN_IMPLEMENTATION_BACKLOG.md)

## Purpose

Some people are **pure platform staff**: Auth identity + user/profile + an Admin role, and **no** personal persona, **no** organization membership. The product has no sign-up path that produces such an account as `active`: the canonical registration flow never activates anyone ([BL-033](ADMIN_IMPLEMENTATION_BACKLOG.md)), and `app.admin_bootstrap_super_admin()` accepts only `active` accounts. This procedure prepares such an account **without** hand-editing `users.status`, and without touching the business-account lifecycle.

## Why `active` is the whole bypass

`my_registration_state()` returns `active_personal` for any `status = 'active'` account **before** it checks consent, account type or username, and the sign-in chain then sends platform staff to `/admin` first (`resolveActiveLanding`). The `/admin` layout guards on `admin_my_access()` only, never on registration state. So a dedicated staff account needs exactly one thing the product cannot give it: `status = 'active'`. No frontend, middleware or `my_registration_state()` change is required.

## The two supported pieces

| Piece | What it is |
|---|---|
| `app.admin_prepare_platform_account(user_id, reason)` — migration `20260930100006` | DB-owner-only helper. **Strict mode:** confirmed Auth email, not banned, not suspended/deactivated, **no persona**, **no active membership**; `pending_verification → active` only; already-active is a no-op; reason mandatory; audited `account.platform_prepared`. Creates no persona/organization/membership/onboarding/consent row. No client grant (not even `service_role`). |
| [`ops/prepare_platform_admin_account.sql`](ops/prepare_platform_admin_account.sql) | The **atomic** DBA transaction: re-checks every precondition under lock, archives the disposable sign-up organization, removes the account's membership/draft/onboarding row, calls the helper, verifies postconditions, commits. Any failure rolls back **everything**. |

`app.admin_bootstrap_super_admin()` and the last-Super-Admin safeguards are **unchanged**; the bootstrap is a **separate** call after this commits and is verified.

## When the account signed up through the product (disposable artifacts)

If the person created the account through ordinary sign-up and went through business onboarding, the account carries disposable artifacts (an organization they alone created, its branch, their membership and capability rows, the business creation draft, the `onboarding_progress` row). Because strict mode refuses an account with an active membership, **cleanup and preparation must be one transaction** — committing the cleanup first would leave a `pending_verification` account with no membership and send it back into onboarding. The ops script does exactly that:

1. lock and re-check the selected account (exactly one Auth account for the email, confirmed, no persona, `pending_verification`);
2. confirm the organization is exclusively theirs: created by them, pristine (`pending_verification`, unverified, not deleted), **no other member**, no audit row written by anyone else, and **no row in any other table** that references the organization or the account (a generic foreign-key scan; anything unexpected aborts naming the table);
3. **soft-archive** the organization (`status = archived`, `deleted_at = now()`) — never hard-delete: `audit_log` is append-only and its rows reference the organization;
4. delete the membership (capabilities cascade); 5. delete the draft; 6. delete the business `onboarding_progress` row; 6b. write the explicit `account.platform_cleanup` audit event (below);
7. call the helper; 8. assert `status = active`, no persona/membership, organization archived, every retained record unchanged, all original audit rows still linked to the organization plus exactly one new, and the cleanup and preparation audit rows present; 9. commit.

**Never touched:** the Auth identity, the core `users` row, the profile, the avatar upload, **consent receipts**, audit history.

**Consent.** `app.admin_prepare_platform_account` does **not** create consent receipts and does **not** delete existing ones, and the cleanup does not touch them. For the first Production account prepared this way (`<platform-admin-email>`) the 3 receipts it recorded at sign-up (terms, privacy, pilot) already exist and are retained unchanged. Whether future dedicated staff accounts must record consent is a **separate product decision**, not part of this lifecycle change.

**Cleanup audit trail.** The cleanup steps are direct DML on tables with **no automatic audit trigger** (the only triggers there are `updated_at`, provenance and timezone validation), so the retained history alone would not record that a cleanup happened. The ops transaction therefore writes **one explicit event, `account.platform_cleanup`**, in the same transaction: the account (`subject_id`) and the archived organization (`organization_id`) as internal ids, the operator `reason` and `source`, the organization's status before, and the removed-row counts (membership, capabilities, draft, onboarding row). It contains no name, email or other personal data, commits only if the whole transaction commits, and disappears on any rollback.

## Procedure

1. A **fresh backup** of the target environment (the previous one predates intervening migrations).
2. Migration `20260930100005` (PostgREST hook compatibility fix) applied and verified **first**, then migration `20260930100006` (it adds the helper and the audit action).
3. Review the target account with the read-only artifact audit; confirm it matches the preconditions above and record the choice (who, which account, why).
4. Edit the single `v_email` constant in the ops script to the exact account and run it as the database owner. Success prints `PREPARED`; a repeat prints `NO-OP`.
5. Verify (status `active`, organization archived, retained counts, one `account.platform_prepared` row, `my_registration_state()` = `active_personal`).
6. Run the documented bootstrap ([`SUPER_ADMIN_BOOTSTRAP.md`](SUPER_ADMIN_BOOTSTRAP.md)) for the same account; verify exactly one Super Admin, the `dba_bootstrap` audit row, and that `admin_my_access()` reports Super Admin.

For an account with **no** sign-up artifacts, call the helper directly:
`select app.admin_prepare_platform_account('<user id>', '<reason>');`

## Verification record

- **pgTAP** `supabase/tests/69_admin_platform_account_preparation_test.sql` — **46/46**: prepared from a verified pending account; status via the supported path; one audit row (previous status, source, reason); no persona, organization, membership, onboarding or consent row created; resolves `active_personal` with no persona/organization; no staff authority before the bootstrap; idempotent; reason mandatory; refused for unconfirmed email, banned, suspended, deactivated, persona-holder, active-member and unknown user (each left untouched); other pending users never activated; the personal (consumer) activation path unchanged; bootstrap afterwards gives exactly one Super Admin (the prepared account) with the `dba_bootstrap` audit row; second bootstrap refused; last-Super-Admin trigger still refuses deactivation; helper executable by no client role; permission and role counts unchanged.
- **Full clean-database suite** (fresh `db start` from zero, 85 migrations): **70 files / 2824 tests PASS**.
- **Isolated rehearsal** (Production-shaped sign-up artifacts built through the real product RPCs): a second member in the organization → abort; a persona-holder → abort; a banned account whose preconditions all pass → steps 3–6 execute, the helper refuses at step 7, and the **whole transaction rolls back** (state identical to before); the happy path → `active`, organization archived with its 5 audit rows still linked, membership/27 capabilities/draft/onboarding removed, profile/consent/avatar retained, one `account.platform_prepared` row; re-run → no-op; bootstrap → exactly one Super Admin (only that account), `admin_my_access` = Super Admin rank 100 with 25 permissions; second bootstrap and last-Super-Admin removal refused; the other three accounts untouched. Direct membership deletion is **not** blocked by the last-owner protections (those live in the membership RPCs).
- **Cleanup audit trail** (rehearsed): after a successful run exactly one `account.platform_cleanup` row exists (subject = the account, `organization_id` = the archived organization, actor null = database owner, reason/source and removed-row counts in metadata, no email or name); the organization's 5 original audit rows stay linked (6 with the new one); a re-run is a no-op and writes no second event; in the banned-account failure case the event was written at step 6b and **vanished with the rollback** (zero events afterwards, state identical to before).
- The rehearsal confirmed the generic ownership scan is strict: seeded accounts that carry `contacts`/`user_trades` rows abort it. A real account is expected to have none; the pre-run audit shows what it owns.

## Known limits

- Not a general activation path: strict mode refuses any account with a persona or an active membership.
- An `active` account skips the consent step (the `active` early-return in `my_registration_state()` precedes it), so a dedicated staff account that never signed up through the product would hold no consent receipts. This procedure neither creates nor deletes any; a future staff-consent policy is a separate product decision.
- A persona-null staff account appears as "Business only" in the Admin type breakdown ([BL-034](ADMIN_IMPLEMENTATION_BACKLOG.md), cosmetic).
- The unapproved business-account activation proposal is kept apart in [`proposals/business-account-activation/`](proposals/business-account-activation/) and must not be applied as part of this procedure ([BL-033](ADMIN_IMPLEMENTATION_BACKLOG.md)).
