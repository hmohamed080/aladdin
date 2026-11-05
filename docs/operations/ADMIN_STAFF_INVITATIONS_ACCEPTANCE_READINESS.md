# Admin Staff invitations: Acceptance deployment readiness and rollback

Status: **readiness only. Nothing here has been executed.** No hosted migration, no frontend deploy, no invitation or QA account, no Production change. Each numbered step below needs its own explicit owner approval. A8 is not part of this document.

## 1. Facts established read-only (2026-11-05)

| Item | Finding | Method and limit |
|---|---|---|
| Acceptance frontend (`aladdin-frontend-preview`) | Latest deployment `45db2715-d9f9-4951-8210-0f63446de2cc`, 100%, created 2026-11-04T12:46Z | `wrangler deployments list` (read-only). **Re-read immediately before any deploy; do not reuse this value.** |
| Migration chain in the repository | `…20261103090001_whatsapp_otp_admin_settings` then `20261105090001_admin_staff_invitations` are the only two migrations after the RC2 line | repository listing |
| Hosted Acceptance applied versions | `20261103090001` is recorded as applied by the earlier A2 step and its independent read-only identity check (`WHATSAPP_OTP_PRODUCTION_B3_PREPARATION.md`). **This session has no authorized read access to the hosted database, so it did not re-verify it.** | documentation only |
| Hosted function definitions | not verifiable by this session | see the owner query in section 3 |
| Branch allowed to deploy to `cloudflare-preview` | must include `feat/admin-staff-invitations-20261105` before the Preview workflow can run | GitHub Environment setting (owner) |

## 2. Dependency order (strict)

1. **Owner read-only preflight** (section 3). Gate: only `20261105090001` is pending; `20261103090001` is applied.
2. **Apply migration `20261105090001` to Acceptance** (needs approval). Atomic; additive; no data touched.
3. **Verify the migration** (section 4).
4. **Record the frontend rollback target** (`wrangler deployments list --name aladdin-frontend-preview`), then **deploy the frontend through the Preview workflow** from `feat/admin-staff-invitations-20261105` (needs approval, plus adding the branch to the environment's allowed branches).
5. **Create the QA invitations** (needs approval; two addresses the owner controls; Administrator and Moderator).
6. **Run the live role checks** (section 5) and then close A7.

The frontend deploy must not come before the migration: the new pages call functions that only exist after step 2. The old frontend works with the new schema (the migration is additive), so a migration without a deploy is a safe resting state.

## 3. Preflight (owner, read-only, hosted Acceptance)

```sql
-- applied versions: expect 20261103090001 as the newest and no 20261105090001
select version from supabase_migrations.schema_migrations order by version desc limit 5;
-- helper bodies, to compare with the same query on a fresh local database
select md5(pg_get_functiondef('app.admin_require_manageable_target(uuid)'::regprocedure));
select md5(pg_get_functiondef('app.admin_prepare_platform_account(uuid,text)'::regprocedure));
-- the audit allow-list currently enforced
select pg_get_constraintdef(oid) from pg_constraint where conname = 'ck_audit_action_known';
-- no object of the new migration exists yet
select to_regclass('app.admin_staff_invitations'), to_regproc('public.staff_invitation_accept(text)');
```

Expected: both `to_regclass` and `to_regproc` are NULL; the constraint list contains the WhatsApp OTP actions of `20261103090001`.

## 4. Post-migration verification (read-only)

1. `select count(*) from app.admin_staff_invitations;` returns 0 (run as the database owner; client roles have no access).
2. The permission contract: effective grants of the eight new functions equal `supabase/permissions/20261105090001.json` (the CI gate does this on a fresh database; on Acceptance compare `has_function_privilege` for `anon`, `authenticated`, `service_role`: only `staff_invitation_lookup` and `staff_invitation_registration_check` are executable by `anon`; neither `app.admin_prepare_platform_account` nor `app.admin_prepare_platform_account_core` is executable by any client role).
3. `ck_audit_action_known` still contains every pre-existing action plus the three `admin_staff.*` ones.
4. Existing behaviour unchanged: `select app.admin_prepare_platform_account(...)` is not executed on Acceptance; instead confirm its definition now delegates to the core (`pg_get_functiondef`).

## 5. Live QA checklist (after steps 2 to 4)

| # | Check | Expected |
|---|---|---|
| 1 | Super Admin creates an Administrator invitation on Admin Staff, Invitations | one-time link shown once; roster row `Pending` |
| 2 | Open the link signed out | redirected to the tokenless page; no token in the address bar or any link |
| 3 | Create the staff account with the invited address; enter the e-mail code | no account type, username or onboarding; lands on the invitation page |
| 4 | Interrupt after e-mail verification, sign in again, open the link | consent step shown, no Accept button; after agreeing, Accept appears |
| 5 | Accept | lands on `/admin`; audit shows `admin_role.assigned` (source `staff_invitation`), `admin_staff.invitation_accepted` and `account.platform_prepared` with `source = staff_invitation` and the invitation id |
| 6 | Administrator opens `/admin/whatsapp-otp` | usage and status visible; no limits form; no connection probe |
| 7 | Moderator (second invitation) opens `/admin/whatsapp-otp` | denied |
| 8 | A marketplace account signs in | unchanged: account basics still requested when it owes them |
| 9 | Reuse an accepted link and a withdrawn link | both refused |

Do not initialize limits, send WhatsApp messages or change `WHATSAPP_DELIVERY_ENABLED` during QA. Suspend (do not delete) the QA accounts afterwards.

## 6. Rollback plan

Order of preference, least to most invasive. None deletes data.

1. **Stop using the feature (no deploy, no SQL).** Withdraw pending invitations on Admin Staff, Invitations (audited). Remove any role granted during QA with the existing **Remove role**, and **Disable** the QA accounts. This is the normal path.
2. **Frontend rollback.** Immediately before step 4 of section 2 record `R = <current version id>` from `wrangler deployments list --name aladdin-frontend-preview` and keep it with the approval. To roll back: `wrangler rollback R --name aladdin-frontend-preview` (needs approval). `R` is, by definition, the version the deploy replaced. As observed today it would be `45db2715-d9f9-4951-8210-0f63446de2cc`, but **only the value read just before the deploy counts**. After the rollback the database stays on the new schema, which the older frontend does not call; this is safe because the migration is additive. The old frontend's Admin Staff page shows its previous Preview-only invitation dialog; nothing else changes.
3. **Database disable (forward-fix migration, needs approval).** Do not drop the table or edit history. A new migration revokes `EXECUTE` on the six public functions from `anon` and `authenticated` (and the permission manifest records it). Existing audit rows and invitation rows are retained.
4. **What is NOT a rollback.** Restoring a database backup, dropping `app.admin_staff_invitations`, or deleting auth users or audit rows. Any of these destroys the audit trail and needs a separate decision.

State that survives every rollback: invitation rows, audit events, any accepted assignments (remove them with the audited Remove role). The `account.platform_prepared` rows written with `source = staff_invitation` are history and stay.

## 7. Known limits at the time of writing

* Hosted function definitions and the applied-version list were not verified by this session (no authorized read access); section 3 is the owner's check.
* v1 delivery is manual (the link is shown once to the inviter). Automated e-mail delivery needs a provider and its own security review.
* Staff registration is e-mail and password only; Google and Facebook staff sign-up is out of scope for v1.
* Hard-deleting an account that issued an invitation is refused while the invitation row exists (`ON DELETE RESTRICT`); see `ADMIN_STAFF_INVITATIONS.md` section 4a for the retention rule and the future anonymization approach.
* PR #137 targets the branch of #136; `supabase-rls` and `ci.yml` do not run automatically for that base and are run by `workflow_dispatch`.
