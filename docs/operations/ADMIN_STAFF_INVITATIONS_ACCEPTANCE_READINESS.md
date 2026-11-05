# Admin Staff invitations: Acceptance deployment readiness and rollback

Status: **A7 is CLOSED on Acceptance (2026-11-05; evidence in sections 4a and 5a).** Migration applied and verified, frontend deployed, live role checks and final audit passed. Not part of this document and not started: A8 onward, Production. Each further step needs its own explicit owner approval.

## 1. Facts established read-only (2026-11-05)

| Item | Finding | Method and limit |
|---|---|---|
| Acceptance frontend (`aladdin-frontend-preview`) | Latest deployment `45db2715-d9f9-4951-8210-0f63446de2cc`, 100%, created 2026-11-04T12:46Z | `wrangler deployments list` (read-only). **Re-read immediately before any deploy; do not reuse this value.** |
| Migration chain in the repository | `…20261103090001_whatsapp_otp_admin_settings` then `20261105090001_admin_staff_invitations` are the only two migrations after the RC2 line | repository listing |
| A3 grant key | Owner ran `select count(*) from app.whatsapp_otp_grant_key` on Acceptance on 2026-11-05: **1 row**. Provisioned; do not recreate or overwrite. Key-to-Worker match still needs the functional proof at A8. | owner, read-only |
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

One query, run in the Acceptance SQL Editor. It reads catalogs and counts only and prints no key material.

```sql
-- Read-only. Acceptance preflight before migration 20261105090001. Prints one JSON document; it reads catalogs and counts only (no key material).
select jsonb_pretty(jsonb_build_object(
  'db_version', current_setting('server_version'),
  'newest_migrations', (select jsonb_agg(version order by version desc) from (select version from supabase_migrations.schema_migrations order by version desc limit 3) m),
  'A2_20261103090001_applied', exists (select 1 from supabase_migrations.schema_migrations where version = '20261103090001'),
  'A7_20261105090001_still_pending', not exists (select 1 from supabase_migrations.schema_migrations where version = '20261105090001'),
  'invitation_objects_absent', to_regclass('app.admin_staff_invitations') is null
      and to_regprocedure('public.staff_invitation_accept(text)') is null
      and to_regprocedure('app.admin_prepare_platform_account_core(uuid,text,text,uuid)') is null,
  'otp_admin_functions_present_expect_7', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where (n.nspname, p.proname) in (('public','admin_whatsapp_otp_view_check'), ('public','admin_whatsapp_otp_settings_begin'), ('public','admin_whatsapp_otp_settings_finish'),
                                       ('public','admin_whatsapp_otp_settings_reconcile'), ('public','whatsapp_otp_notification_record'),
                                       ('app','whatsapp_otp_record_unmatched'), ('app','whatsapp_otp_settings_valid'))),
  'grant_key_rows_expect_1', (select count(*) from app.whatsapp_otp_grant_key),
  'grant_key_table_closed', (select relrowsecurity from pg_class where oid = 'app.whatsapp_otp_grant_key'::regclass)
      and not exists (select 1 from unnest(array['anon','authenticated','service_role']) r where has_table_privilege(r, 'app.whatsapp_otp_grant_key', 'select')),
  'audit_vocabulary_has_whatsapp_otp', (select pg_get_constraintdef(oid) like '%whatsapp_otp.%' from pg_constraint where conname = 'ck_audit_action_known' and conrelid = 'public.audit_log'::regclass),
  'audit_vocabulary_lacks_staff_invitation_yet', (select pg_get_constraintdef(oid) not like '%admin_staff.invited%' from pg_constraint where conname = 'ck_audit_action_known' and conrelid = 'public.audit_log'::regclass),
  'manageable_target_guard_original', pg_get_functiondef('app.admin_require_manageable_target(uuid)'::regprocedure) like '%target is not an existing Admin Staff member%',
  'dba_prepare_helper_original', pg_get_functiondef('app.admin_prepare_platform_account(uuid,text)'::regprocedure) like '%dba_platform_prepare%'
      and pg_get_functiondef('app.admin_prepare_platform_account(uuid,text)'::regprocedure) not like '%_core%',
  'dba_prepare_helper_not_client_executable', not (has_function_privilege('anon', 'app.admin_prepare_platform_account(uuid,text)', 'execute')
      or has_function_privilege('authenticated', 'app.admin_prepare_platform_account(uuid,text)', 'execute')
      or has_function_privilege('service_role', 'app.admin_prepare_platform_account(uuid,text)', 'execute')),
  'record_consent_present', to_regprocedure('public.record_consent(public.consent_type[],text)') is not null,
  'active_super_admins', (select count(*) from public.admin_role_assignments a join public.admin_roles r on r.id = a.role_id where r.key = 'super_admin' and a.is_active)
)) as acceptance_preflight;
```

**Expected on Acceptance before step 2** (all must hold):

| Field | Expected |
|---|---|
| `A2_20261103090001_applied` | `true` |
| `A7_20261105090001_still_pending` | `true` |
| `invitation_objects_absent` | `true` |
| `otp_admin_functions_present_expect_7` | `7` |
| `grant_key_rows_expect_1` | `1` (A3 provisioned; key-to-Worker match is proved functionally at A8) |
| `grant_key_table_closed` | `true` |
| `audit_vocabulary_has_whatsapp_otp` | `true` |
| `audit_vocabulary_lacks_staff_invitation_yet` | `true` |
| `manageable_target_guard_original` | `true` |
| `dba_prepare_helper_original` | `true` |
| `dba_prepare_helper_not_client_executable` | `true` |
| `record_consent_present` | `true` |
| `active_super_admins` | `1` or more |

Any other value stops the rollout until explained. `newest_migrations` should start with `20261103090001`.

## 4. Post-migration verification (read-only)

1. `select count(*) from app.admin_staff_invitations;` returns 0 (run as the database owner; client roles have no access).
2. The permission contract: effective grants of the eight new functions equal `supabase/permissions/20261105090001.json` (the CI gate does this on a fresh database; on Acceptance compare `has_function_privilege` for `anon`, `authenticated`, `service_role`: only `staff_invitation_lookup` and `staff_invitation_registration_check` are executable by `anon`; neither `app.admin_prepare_platform_account` nor `app.admin_prepare_platform_account_core` is executable by any client role).
3. `ck_audit_action_known` still contains every pre-existing action plus the three `admin_staff.*` ones.
4. Existing behaviour unchanged: `select app.admin_prepare_platform_account(...)` is not executed on Acceptance; instead confirm its definition now delegates to the core (`pg_get_functiondef`).

### 4a. Evidence: migration applied and verified on Acceptance (2026-11-05)

* Applied by the owner with the pinned CLI (`supabase@2.110.0`) from `feat/admin-staff-invitations-20261105` at `09fdc130`; the dry run listed exactly `20261105090001_admin_staff_invitations.sql`.
* Preflight (section 3) passed 15/15 before the apply.
* The read-only post-migration query (20 JSON fields) was run by the owner in the Acceptance SQL Editor: **all 20 matched the expected values.**
  * Migration `20261105090001` recorded and newest.
  * `app.admin_staff_invitations` present, RLS on, no `anon`/`authenticated`/`service_role` table privilege, 0 policies, 0 rows; 0 `admin_staff.invit*` audit rows.
  * 9 new functions present; 7 SECURITY DEFINER with empty `search_path`; 2 internal helpers with empty `search_path`.
  * `anon` executes only `staff_invitation_lookup` and `staff_invitation_registration_check`; `authenticated` executes exactly the six public functions; `service_role` executes none; neither prepare function is client-executable.
  * `staff_invitation_lookup` reports `consent_complete`; `ck_audit_action_known` holds the `admin_staff.*`, `whatsapp_otp.*` and `account.platform_prepared` actions.
  * `admin_require_manageable_target` unchanged; the DBA prepare helper still carries `dba_platform_prepare` and delegates to the core.
  * Grant Key rows 1; OTP Admin functions 7; active Super Admins 1 (all unchanged).
* State now: schema ahead of the Acceptance frontend. Safe resting state (additive migration; the current frontend does not call the new functions).

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

### 5a. A7 closure evidence (2026-11-05)

* **Deployment:** Acceptance frontend `aladdin-frontend-preview` from `47d4fe0b` (workflow run 42026625795; docs-only difference from the CI-verified `09fdc130`). New version `deae226d-0686-4e0f-a545-db0c073e7db1` at 100%; replaced (rollback target) `45db2715-d9f9-4951-8210-0f63446de2cc`. Smoke: `/api/health`, `/`, `/auth/sign-in`, `/legal/terms` 200; `/showroom` 307 (static redirect to `/showroom/home`). The WhatsApp delivery Worker stayed on `11b9f694-1f2e-4e2c-ad41-8a8d0a8ae13e`; delivery OFF; Production untouched.
* **Live checks (owner, browser):** Super Admin sees Admin Staff, Invitations (form, empty roster). Moderator invitation accepted; `/admin/whatsapp-otp` gives the permission-based 404. Administrator invitation accepted; `/admin/whatsapp-otp` shows usage, delivery status, failure statistics and history, with no settings form and no connection probe. A used link, opened signed out, shows "This invitation has already been used" and cannot be accepted.
* **Final read-only audit (owner, SQL Editor): all checks passed.** 2 accepted invitations (Administrator, Moderator); 1 revoked Administrator invitation (withdrawn by the owner on purpose and replaced by a new invitation to the same address, which was accepted: intended QA activity); 0 pending. Active roles: 1 Super Admin, 1 Administrator, 1 Moderator. Assignments match user and role; consent complete; all duplicate counts 0; each accepted invitation has exactly one `admin_staff.invitation_accepted`, one `admin_role.assigned` (source `staff_invitation`) and one `account.platform_prepared` (source `staff_invitation`); no unauthorized assignment; no WhatsApp audit activity; invitation table still closed; grant key rows 1; limits uninitialized.
* **State kept for A8:** both QA accounts stay active (Administrator and Moderator roles). Remove them with the audited Remove role and Disable only after the A8 to A10 rehearsal, with separate approval.
* **Follow-ups (separate PRs, not blockers):** invitation e-mail reveal (design approved) and automatic invitation e-mail; see `ADMIN_STAFF_INVITATIONS.md` section 10.

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
