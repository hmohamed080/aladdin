# P1 Migration Design - M1 / M2 / M3, Auth-metadata scrub, audit_log redaction

**Purpose.** Specify the forward-only database and data changes that retire application usernames and date of birth. **Current decision.** Three migrations plus an Auth-metadata scrub, compatibility first, no `CASCADE`, no edit of applied migrations (master plan D-18..D-22). **Rationale.** The registration state machine, sign-in resolver and admin directory depend on username today; removing columns first would break registration. **Scope.** Design only. **Nothing here has been applied to any hosted environment and PR-0 contains no SQL.** **Deferred.** Execution, owner approvals, hosted runs. **Consequences.** M2/M3 data erasure is not reversible except from backup. **Related files.** [Master plan](../../architecture/ACCOUNT_IDENTITY_LIFECYCLE_MASTER_PLAN.md), [P1-IMPACT-INVENTORY.md](P1-IMPACT-INVENTORY.md), [P1-PR-CONFLICT-MATRIX.md](P1-PR-CONFLICT-MATRIX.md).

Facts are from read-only audits of 2026-11-10 (subagent-reported, awaiting reviewer verification): Production and Acceptance both at 207 migrations ending `20261107090006`; counts in master plan 3.2.

## 1. Ordering

1. Decide #128/#129 fate and timestamp relabel (owner; they sort before M1-M3).
2. **M1** `20261110090001_registration_stop_username_dob_compat` (PR-1).
3. App release (PR-2/PR-3): sign-in, sign-up, OAuth, staff, onboarding, settings, admin; age attestation (D-20). Sessions drained.
4. Restore-verified backup (aladdin-backups snapshot plus restore test).
5. Auth-metadata scrub (script, section 5).
6. **M2** `20261111090001_registration_username_dob_cleanup`.
7. **M3** `20261111090002_registration_username_dob_drop`.
8. Update #159 / #146 / runbooks; annotate and edit docs.

Each step: Acceptance first under separate owner approval, then Production under a new approval. No step runs on a hosted project from this PR.

## 2. M1 - compatibility (expand only)

Content (no drops, no `CASCADE`):

- `app.pending_registrations`: drop NOT NULL on `username`; relax `ck_pending_registrations_lease_shape` so a row with NULL username and no lease is valid.
- `public.pending_registration_save(uuid,text,activity_audience_kind,text,int)`: accept NULL username; stage audience only; take no lease. Stays `service_role` only.
- `public.pending_registration_consume()`: works with NULL username (still returns the same columns, so the old app keeps working).
- `public.my_registration_state()`: remove **only** the `username_pending` branch and the username dependence of `access_ready`. Must not bypass account_type, consent or verification states; existing verified accounts must not regress to pending.
- `app.profile_completion(uuid)`: drop the username criterion.
- `public.admin_users_directory(...)`, `public.admin_user_detail(uuid)`: drop username search and key. The TypeScript mapper must tolerate the missing key (old and new shape).
- `public.username_available` and `public.profile_set_username` untouched.
- New permissions snapshot `supabase/permissions/20261110090001.json`; every redefined function re-asserts grants and `SET search_path = ''`; no widening of `anon`.

Locks: function replacement and `ALTER COLUMN DROP NOT NULL` / constraint replace are brief; use `SET lock_timeout = '5s'`.

Rollback / forward-fix: M1 is expand-only, so the old app keeps working. Forward-fix is `CREATE OR REPLACE` of the previous definitions, kept as a note in PR-1, **not** a migration.

Verification gate: pgTAP for each state of `my_registration_state` (no username, with consent, without, verified, unverified); old-app and new-app smoke (email, phone, OAuth, staff); permission-gate diff; advisors diff.

## 3. M2 - data cleanup (destructive of data; only after the new app is promoted and sessions are drained)

Pre-check inside the migration (abort on failure): new app version live is recorded by the release evidence, not inferable in SQL, so the migration only checks that no `pending_registrations` row holds a lease.

Steps:

1. `UPDATE public.users SET birth_date = NULL WHERE birth_date IS NOT NULL` (4 / 13 rows).
2. `UPDATE public.profiles SET username = NULL WHERE username IS NOT NULL` (855 / 18). `username_normalized` is generated and follows; **verify** that `ck_profiles_username_*` and the generated expression allow NULL.
3. Clear `pending_registrations.username` and `username_reserved_at` (0 rows today).
4. `audit_log` redaction **only if the owner approves** (section 6).
5. `REVOKE UPDATE (birth_date) ON public.users FROM service_role`.
6. Drop `public.profile_set_username`, `public.username_available`, `app.username_leased_by_other`, `app.lock_username`, `app.username_lease_interval`.
7. New permissions snapshot; destructive-reviewed marker per the migration policy.

Locks and timeouts: `SET lock_timeout = '5s'` and `statement_timeout`; the row updates are small (under 1000 rows) but run off-peak; retry the whole migration on lock timeout (it is transactional and idempotent: a re-run updates zero rows).

Rollback: **data erasure is not reversible except from backup.** Require a restore-verified backup before M2; recovery is forward-fix only.

## 4. M3 - schema drop (destructive-reviewed)

Order, one transaction per step group, **no CASCADE**:

1. `ix_pending_registrations_username_lease`, `ck_pending_registrations_lease_shape`.
2. `DROP FUNCTION public.pending_registration_consume()` then recreate it returning `(audience_kind, audience_value)` only; then drop `pending_registrations.username` and `username_reserved_at`. The app release must already have stopped reading `username` (coordinate; verified by release evidence).
3. `uq_profiles_username_normalized`.
4. `profiles.username_normalized`.
5. `ck_profiles_username_*`.
6. `profiles.username`.
7. `public.reserved_usernames` with its policy.
8. `ck_users_birth_date_range`, then `users.birth_date`.
9. `app.normalize_username_for_uniqueness(text)` **last** (the generated column and index depend on it until steps 3-4).

`admin_view_craftsman_profile` from PR #129 must not reference `p.username` when M3 lands. Index drops use plain `DROP INDEX` inside the transaction; `DROP INDEX CONCURRENTLY` only if the migration policy allows it outside a transaction (OPEN).

Locks: `DROP COLUMN` is metadata-only but takes a brief `ACCESS EXCLUSIVE`; use `lock_timeout = '5s'` with retries, off-peak.

Companion changes in the same PR: update test 14 so the service_role column grants are `users.locale` only; replace username/DOB tests with `hasnt_column` / `hasnt_function` / `hasnt_table` / `hasnt_index` absence tests; regenerate `frontend/src/types/database.types.ts`; renumber `supabase/tests`; retire `registration_username_lease_concurrency_test.sh` and its CI step; drop test 116's `ck_users_birth_date_range` assertion.

Rollback: not reversible except from backup; forward-fix only.

## 5. Auth-metadata scrub procedure

Targets: `auth.users.raw_user_meta_data` key `birth_date` (2 Production / 11 Acceptance) and `auth.identities.identity_data` key `birth_date` (provider `email`, 2 / 11). No `username` key exists in Auth metadata (0 / 0).

Procedure (script, run only after approval, Acceptance first):

1. Read-only: enumerate user ids that carry the key (counts and ids stay on the operator machine; evidence records counts only).
2. For each id call the Auth Admin API `updateUserById`, **merging** `user_metadata` so only `birth_date` is removed and unrelated metadata and app claims are preserved. Never run SQL against `auth.users` / `auth.identities`; never casual direct writes to Auth internals.
3. Re-count both locations; expect 0 / 0.
4. **OPEN / TO VERIFY LOCALLY:** whether `updateUserById` also cleans the `auth.identities.identity_data` copy of `birth_date`. If it does not, a supported alternative must be documented and approved (for example unlinking and relinking is not acceptable); decide **before M3 sign-off**. Until then the identity-data copy is reported as residual.
5. Evidence: counts only, script commit hash, timestamp, reviewer. No raw values in logs.

Non-recollection: the app release must stop writing `birth_date` to `signUp` `options.data`, `verifyOtp`, staff invitation, phone sign-up and OAuth completion before the scrub, or values will reappear; verify with a post-scrub re-count after a smoke sign-up.

## 6. audit_log redaction - proposal, needs owner approval

State: `audit_log_no_update` (`app.guard_audit_actor_deletion`, only FK `actor_user_id` to null for a deleted user) and `audit_log_no_delete`. No bypass, GUC or redaction helper. 860 / 20 rows (all `profile.username_set`) carry `metadata.username`; total 3267 / 165.

Options: (1) leave as is; (2) one-shot reviewed migration `UPDATE public.audit_log SET metadata = metadata - 'username' WHERE action = 'profile.username_set'` with the update trigger relaxed only inside that transaction, via a narrowly scoped and documented exception (for example a transaction-local setting checked by the guard and cleared at the end), a pgTAP proof that every other update stays forbidden and that the exception is unreachable by `anon` / `authenticated`, and a count-only audit event such as `audit.username_redacted`; (3) tokenise (weaker, still a stable pseudonym).

**Recommendation: option 2** because the owner decided to erase historical usernames. **Proposal - needs owner approval; NOT approved to run anywhere.** Preconditions: explicit approval, restore-verified backup, count-only evidence, keep `profile.username_set` in `ck_audit_action_known` so remaining rows stay valid, and stop `app.record_audit_event('profile.username_set')` writing `{username}` (the action itself disappears with `profile_set_username` in M2).

## 7. Verification gates (every environment)

- Before/after counts: `profiles.username` non-null to 0; `users.birth_date` to 0; Auth metadata and identities keys to 0 (identities pending item 5.4); audit_log key to 0 only if approved; `reserved_usernames` gone after M3.
- pgTAP `hasnt_*` absence tests; permission-gate diff shows removals only.
- Smoke: email, phone (including a phone-alias account), OAuth, staff-invitation sign-up and sign-in; username input yields the same `invalidCredentials`.
- Supabase advisors diff (new warnings triaged; old unrelated ones documented).
- Performance: p50/p95 via the `scripts/perf` pgbench + pgss harness before and after for sign-up, sign-in, directory, profile, admin users; baseline needed first (no EXPLAIN harness for the admin directory).
- Evidence kept as counts, never personal values.
