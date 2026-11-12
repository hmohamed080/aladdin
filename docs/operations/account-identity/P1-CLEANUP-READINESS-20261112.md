# P1 cleanup readiness (M2 / M3 / Auth scrub / audit redaction) - 2026-11-12

**Purpose.** State what Phase 1 has actually delivered, what username and date-of-birth (DOB) residue is left in code, database, Auth metadata and audit logs, and the ordered, gated plan to remove it. **Status: planning only. Nothing in this document was executed.** Evidence is aggregate counts and catalog names, never personal values. Read-only reads of Production (`kkpkgjrweysgvhvkhzun`) and Acceptance (`nxossqhdfltcqdwvbewi`) on 2026-11-12; `main` `c9cc67b4`.

## 1. Verdict

**NO-GO to execute M2, M3, the Auth scrub or the audit redaction today. GO to prepare them** (write M2 and the M3 expand step as PRs, rehearse on Acceptance) once the blockers in section 6 marked *owner* are decided. Phase 1 is **not complete**: sign-in, sign-up, registration and admin no longer use username or DOB, but the data and the schema still exist.

## 2. What is merged and deployed (verified)

| Item | State |
|---|---|
| #170 plan/docs, #171 M1 (`20261110090002`), #173 app (Auth, Frontend, Admin), #179 recovery gate + CI pinning, #181 account-type order, #182 age-attestation removal, #183 Production release media mode | merged into `main` |
| Media migration `20261110090001` and M1 `20261110090002` | applied on **Acceptance** (209) and **Production** (209, latest `20261110090002`), read-only check 2026-11-12 |
| Acceptance Preview Worker | version `6db4a740` (deployed from `main` `6b94bdbf`) |
| Production frontend Worker | version `32d08bff` at 100% since 2026-11-12 10:24 UTC (uploaded from `main` `c9cc67b4`). Its media flags are the R2-only ones; that is owned by another agent and not assessed here. The previous version `38d2db8a` no longer receives traffic. |
| Age attestation | removed by #182; no registration path asks or checks age; the 18+ copy now says the service is intended for people aged 18 or older (legal review of that wording is still open) |

## 3. Residue audit (read-only)

### 3.1 Counts

| Measure | Production | Acceptance | 2026-11-10 baseline (Prod / Acc) |
|---|---|---|---|
| Migrations applied | 209 | 209 | 207 / 207 |
| `profiles` rows | 987 | 24 | 976 / 23 |
| `profiles.username` set | 856 | 18 | 855 / 18 |
| `users.birth_date` set | **3** | 13 | **4** / 13 |
| `auth.users.raw_user_meta_data` has `birth_date` | 2 | 11 | 2 / 11 |
| `auth.identities.identity_data` has `birth_date` | 2 | 11 | 2 / 11 |
| `audit_log` rows holding a username or birth key | 863 (all `profile.username_set`) | 20 | 860 / 20 |
| `app.pending_registrations` holding a username | 0 | not measured | 0 / not measured |

Production `birth_date` fell from 4 to 3 since the 2026-11-10 audit; the cause was not investigated (a deleted or edited account is the likely reason). **Re-baseline before M2** so the post-check compares against the right number.

Account stranding re-check (Production, aggregate): of 856 accounts with a username, 220 have a confirmed real email, 636 are phone-alias accounts and all 636 have a known phone, and **0 have no contact at all**.

### 3.2 Database objects still present (catalog scan of `public` and `app`, Production)

- Columns: `public.profiles.username`, `profiles.username_normalized` (generated), `public.users.birth_date`, `app.pending_registrations.username`, `pending_registrations.username_reserved_at`. All are nullable already, so nulling the data in M2 needs no constraint change.
- Constraints (the scan covered `public` only): `ck_profiles_username_length`, `ck_profiles_username_shape`, `ck_users_birth_date_range`, and `audit_log.ck_audit_action_known` (it lists the historical action `profile.username_set`; **keep that value**, history rows use it). `app.pending_registrations` constraints were not scanned; the design names `ck_pending_registrations_lease_shape`.
- Indexes: `uq_profiles_username_normalized`, `app.ix_pending_registrations_username_lease`, `reserved_usernames_pkey` (table `public.reserved_usernames`, 20 rows).
- Functions still reading username: `public.profile_set_username`, `public.username_available`, `app.lock_username`, `app.normalize_username_for_uniqueness`, `app.username_lease_interval`, `app.username_leased_by_other`, `public.pending_registration_save` (takes `p_username`), `public.pending_registration_consume`, `public.admin_user_detail`, `public.admin_users_directory` (still emits a `username` key that the app ignores). `my_registration_state` and `app.profile_completion` mention username only in comments after M1.
- Views, policies, triggers: none reference username or birth date. `app.handle_new_user` does not touch either.

### 3.3 Application code

- Sign-in, sign-up, onboarding, staff, OAuth and the admin directory no longer collect, show or check either value; `signUp` metadata carries only display name and locale (tested).
- **Still coupled to database objects that M3 removes:** `frontend/src/lib/supabase/admin-server.ts:238` calls `pending_registration_save` with `p_username: null`; `frontend/src/server/phone-verification/integration-support.ts:86` selects `p.username` in a test-support SQL; `frontend/src/types/database.types.ts` carries the columns and functions.
- **Dead code to delete before or with M3:** `checkUsername` (`server/actions/sign-up.ts`), `chooseUsernameAction` (`server/actions/registration.ts`), `features/installer-phone-auth/username.ts`, `lib/identity/username.ts` and their tests; pgTAP `118_registration_username_lease_test.sql`, `registration_username_lease_concurrency_test.sh` and its CI step; the birth-date assertions in pgTAP `116_sign_up_birthday_phone_codes_test.sql` and test 14's service_role grants.

### 3.4 Auth metadata and audit logs

- `raw_user_meta_data.birth_date`: 2 Production / 11 Acceptance; removable with the supported Admin API (`updateUserById`, `birth_date: null`), tested locally ([P1-AUTH-METADATA-SCRUB.md](P1-AUTH-METADATA-SCRUB.md)).
- `identity_data.birth_date`: 2 / 11; **no supported API removes it**. Owner decision pending (accept as a residual, or a rehearsed one-off write).
- No `username` key exists in Auth metadata.
- `audit_log` username keys: removal needs the approved but unexecuted redaction migration ([P1-AUDIT-LOG-REDACTION-DESIGN.md](P1-AUDIT-LOG-REDACTION-DESIGN.md), drafts under `drafts/`).

## 4. Risks to existing accounts, authentication and permissions

| Risk | Status | Control |
|---|---|---|
| Username sign-in is gone for 856 accounts | **Already in effect** since the app release, not caused by M2 | 220 can use a confirmed email, 636 their phone number |
| Phone-alias accounts that forgot their password cannot recover while phone verification is OFF in Production | Existing exposure, unmeasured (passwords are unknown) | Owner to confirm the recovery path (phone code activation or a support reset) before announcing the cleanup |
| Stale OLD app code calling dropped functions | The OLD app is no longer served (only `32d08bff` at 100%) | Do not run M3 while any older version can receive traffic; check Worker deployments first |
| M3 redefining `pending_registration_save` changes its signature while the app still sends `p_username` | Real | Two steps: add a new username-less signature, ship the app change, then drop the old one (recommended, section 5) |
| `DROP COLUMN` succeeds while PL/pgSQL bodies still read the column (they fail at run time) | Real | Redefine `admin_user_detail`, `admin_users_directory`, `pending_registration_*` first; `pg_proc` scan before and after |
| Permissions | M2 drops 5 functions and revokes one column grant; M3 drops or redefines about 8 functions. The current contract is 754 functions | New contract file per migration; the gate diff must show removals only |
| Audit trail integrity | Redaction touches an append-only table guarded by a trigger | Approved single-transaction design restores the guard byte for byte; not executed |

## 5. Ordered plan (each step: Acceptance first under its own approval, then Production under a new approval)

| # | Step | Exact scope | Tests / gates | Rollback limit |
|---|---|---|---|---|
| 0 | Re-baseline and decisions (read-only) | Re-count section 3.1 on both projects; owner decides the `identity_data` residual, audit-redaction placement and execution, the legal wording, and the #128/#129 relabel | counts recorded as aggregates | none needed |
| 1 | App prep PR (no database change) | Delete the dead code in 3.3; keep `p_username: null` until step 7 | `tsc`, lint, full vitest, E2E sign-up and sign-in | normal code rollback |
| 2 | Auth metadata scrub (script, not a migration) | `birth_date` key in `raw_user_meta_data` only (2 / 11) | dry-run counts, idempotent rerun, a smoke sign-up proves the key does not return | **not reversible** (data removed); needs the step 3 backup |
| 3 | **Fresh restore-tested backup** per environment | The Acceptance snapshot `T094450Z` is at 203 migrations and is not a current recovery point; Production has no restore-verified snapshot after the 209 migrations | backup run and restore run PASS recorded | needs explicit owner approval (owner constraint: no new backups until then) |
| 4 | **M2** `20261111090001_registration_username_dob_cleanup` | `UPDATE users SET birth_date=NULL`; `UPDATE profiles SET username=NULL` (`username_normalized` follows); clear `pending_registrations.username` and `username_reserved_at`; `REVOKE UPDATE (birth_date) ON users FROM service_role`; drop `profile_set_username`, `username_available`, `app.username_leased_by_other`, `app.lock_username`, `app.username_lease_interval`; abort if any pending lease exists; `lock_timeout 5s`; idempotent | pgTAP: zero non-null in both columns, functions absent, grant gone; permission gate removals only; advisors diff; smoke (email, phone-alias, OAuth, staff) | **data erasure is not reversible except from backup**; the functions can be recreated by a forward-fix |
| 5 | Audit-log redaction migration (own migration, own approval) | `metadata - 'username'` on `profile.username_set` rows (863 / 20) per the approved design | row count and checksum of everything except the key; guard fingerprint and ACL restored | irreversible; backup first |
| 6 | **M3a** (expand) | add the username-less `pending_registration_save` signature and a username-less `pending_registration_consume`; redefine `admin_user_detail` and `admin_users_directory` without `username` | pgTAP behaviour tests; the old signature still works | a forward-fix drops the new overloads |
| 7 | App release using the M3a signatures | stop passing `p_username`; regenerate `database.types.ts`; fix `integration-support.ts` | CI green; Acceptance Preview smoke; Production upload at 0% then promote | Worker rollback (valid while the old signature still exists) |
| 8 | **M3b** `20261111090002_registration_username_dob_drop` | drop, in order: `ix_pending_registrations_username_lease`, `ck_pending_registrations_lease_shape`, the old `pending_registration_save` and `pending_registration_consume`, `pending_registrations.username` and `username_reserved_at`, `uq_profiles_username_normalized`, `profiles.username_normalized`, `ck_profiles_username_*`, `profiles.username`, `reserved_usernames`, `ck_users_birth_date_range`, `users.birth_date`, then `app.normalize_username_for_uniqueness` last; **no CASCADE**; keep the `profile.username_set` audit action | `hasnt_column/function/table/index` pgTAP; permission gate removals only; before/after `pg_proc` scan; performance baseline | **not reversible except from backup**; confirm no older Worker version can receive traffic |
| 9 | Close-out | The Privacy copy may claim erasure only after steps 2, 4 and 5 (and the `identity_data` decision); update the plan, runbook and evidence | final counts | - |

The M3 split (steps 6 to 8) is a recommendation that changes the original M3 design (one migration that recreates `pending_registration_save`), to avoid a window where the live app calls a function whose signature has changed. The migration numbers `20261111090001` and `20261111090002` are from the design; they sort after the applied `20261110090002`, but #128 and #129 must be relabelled around them.

## 6. Blockers

1. **Not written:** the M2, M3a and M3b migrations and the audit-redaction migration exist only as design and drafts (`drafts/`); no file under `supabase/migrations` yet.
2. *Owner:* approve fresh restore-tested backups (step 3) for each environment.
3. *Owner:* decide the `identity_data.birth_date` copies (2 Production / 11 Acceptance) and approve the audit-redaction execution.
4. *Owner/legal:* review the "intended for people aged 18 or older" wording.
5. *Owner:* confirm the recovery path for phone-alias accounts while phone verification is OFF.
6. #128 and #129 remain on HOLD; they must be reworked without username dependencies and relabelled before any M2/M3 migration is numbered.
7. Re-baseline the Production `birth_date` count (4 to 3, unexplained).

## 7. Out of scope here

R2 and media configuration (another agent). No data, migration, backup, merge or deployment was made for this report.
