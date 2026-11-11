# P1 Migration Design - M1 / M2 / M3, Auth-metadata scrub, audit_log redaction

**Purpose.** Specify the forward-only database and data changes that retire application usernames and date of birth. **Current decision.** Three migrations plus an Auth-metadata scrub, compatibility first, no `CASCADE`, no edit of applied migrations (master plan D-18..D-22). **Rationale.** The registration state machine, sign-in resolver and admin directory depend on username today; removing columns first would break registration. **Scope.** M1 is **implemented** in PR-1 (#171, migration `20261110090002`) and section 2 below describes what it actually does; M2, M3, the Auth scrub and the audit redaction are design only. **Nothing here has been applied to any hosted environment and PR-0 contains no SQL.** Local proofs for the Auth scrub and the audit redaction are indexed in [P1-EVIDENCE.md](P1-EVIDENCE.md). **Deferred.** Execution, owner approvals, hosted runs. **Consequences.** M2/M3 data erasure is not reversible except from backup. **Related files.** [Master plan](../../architecture/ACCOUNT_IDENTITY_LIFECYCLE_MASTER_PLAN.md), [P1-IMPACT-INVENTORY.md](P1-IMPACT-INVENTORY.md), [P1-PR-CONFLICT-MATRIX.md](P1-PR-CONFLICT-MATRIX.md), [P1-COMPAT-MATRIX.md](P1-COMPAT-MATRIX.md), [P1-AUTH-METADATA-SCRUB.md](P1-AUTH-METADATA-SCRUB.md), [P1-AUDIT-LOG-REDACTION-DESIGN.md](P1-AUDIT-LOG-REDACTION-DESIGN.md), [P1-EVIDENCE.md](P1-EVIDENCE.md).

Facts are from read-only audits of 2026-11-10 (subagent-reported, awaiting reviewer verification): Production and Acceptance both at 207 migrations ending `20261107090006`; counts in master plan 3.2.

## 1. Ordering

1. #128/#129 are on **HOLD** (not merged, not modified); after Phase 1 they are reworked without username dependencies and relabelled to `>= 20261112...` (see the conflict matrix). Deployed history ends `20261107090006`; M1 is `20261110090002`; M2/M3 take `20261111...`.
2. **M1** `20261110090002_registration_stop_username_dob_compat` (PR-1).
3. App release (PR-2/PR-3): sign-in, sign-up, OAuth, staff, onboarding, settings, admin; age attestation (D-20). Sessions drained.
4. Restore-verified backup (aladdin-backups snapshot plus restore test).
5. Auth-metadata scrub (script, section 5).
6. **M2** `20261111090001_registration_username_dob_cleanup`.
7. **M3** `20261111090002_registration_username_dob_drop`.
8. Update #159 / #146 / runbooks; annotate and edit docs.

Each step: Acceptance first under separate owner approval, then Production under a new approval. No step runs on a hosted project from this PR.

## 2. M1 - compatibility (expand only) - ACTUAL implementation (PR #171, `20261110090002_registration_stop_username_dob_compat.sql`)

PR-0 originally described a larger M1. The implemented M1 is smaller because part of the described work was already true on `main`. Every item below is stated as implemented, already true, or deferred.

| Item | Actual state |
|---|---|
| `app.pending_registrations` | **No DDL.** `NOT NULL` on `username` was already dropped in `20261028090003`, and `ck_pending_registrations_lease_shape` (`(username is null) = (username_reserved_at is null)`) already admits a NULL/NULL row and still validates the old shape. The audience columns stay `NOT NULL`. Proven by pgTAP 125 |
| `public.pending_registration_save(uuid,text,activity_audience_kind,text,int)` | **Unchanged.** A NULL `p_username` already skips the name check, takes no advisory lock and no lease. The NEW app must pass `p_username: null` **explicitly**: omitting it does not resolve because only `p_ttl_minutes` has a default. Stays `service_role` only |
| `public.pending_registration_consume()` | **Unchanged.** Already returns `username` NULL when no active lease backs it; return type unchanged, so the OLD app keeps working. Recreated without `username` only in M3 |
| `public.my_registration_state()` | **Changed.** Only the `username_pending` branch and the username lookup are removed (copied from `20260924090007`); every earlier return and its order is identical, so account type, consent, verification and blocks cannot be bypassed. The state `access_ready` follows `account_type_pending` directly. `authenticated` only |
| `app.profile_completion(uuid)` | **Changed.** The `username` criterion is removed and the all-audience denominator goes 4 to 3 (a user missing only the avatar goes from 75 to 67). Return shape unchanged. No API role may call it |
| `public.admin_users_directory(...)` | **Changed in one place:** the `p.username ilike` search term is removed. It **still emits the stored `username` key** in `rows[]` until the column goes; the Admin mapper must tolerate the key being present or absent. `admin_users_list` delegates to it and needs no change |
| `public.admin_user_detail(uuid)` | **Untouched in M1.** It still returns the stored username until M3 (it never searched by username) |
| `public.username_available`, `public.profile_set_username` | **Untouched.** Retired in M2 after the OLD app is gone |
| Birth date | **Nothing in SQL.** No table, column or function requires it |
| Stored usernames, `username_normalized`, its unique index | Untouched |
| Permissions | `supabase/permissions/20261110090002.json`; every redefined function is `SECURITY DEFINER` with `search_path = ''` and re-asserts its grants; no widening of `anon`; nothing dropped, no `CASCADE` |

Locks: only `CREATE OR REPLACE FUNCTION` runs, which takes no table lock.

Rollback / forward-fix: M1 is expand-only, so the OLD app keeps working. The forward-fix is `CREATE OR REPLACE` of the previous definitions (`my_registration_state` from `20260924090007`, `app.profile_completion` from `20261107090002`, `admin_users_directory` from `20261021090003`), kept as a note in PR-1, **not** a migration. Rolling M1 back after the NEW app is live would bring `username_pending` back and loop username-less users (compat matrix B1), so M1 is not rolled back once the NEW app is promoted.

Verification gate and evidence: pgTAP 125 (56 tests; pre-M1 8 fail by design, post-M1 56 of 56); PR #171 CI green including `PASS 753 exact function permission contracts` and `Files=158, Tests=7350 Result: PASS` ([P1-EVIDENCE.md](P1-EVIDENCE.md)). Still to do before Acceptance: OLD-app and NEW-app smoke against an M1 database (email, phone alias, OAuth, staff), advisors diff.

**Deferred to M2/M3 (explicit):** `profile_set_username` / `username_available` / lease helpers removal; clearing stored usernames and birth dates; `admin_user_detail` and the `username` key in the directory rows; `pending_registration_consume` return type; every column, index, constraint and table drop; any audit redaction.

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

**Functions that still read the dropped columns must be redefined first (found by the `pg_proc` scan on the M1 database, [compat matrix B5](P1-COMPAT-MATRIX.md)):** `public.admin_user_detail` (selects `p.username`), `public.admin_users_directory` (emits `p.username`), `public.pending_registration_save` (writes `username`, `username_reserved_at`) and `pending_registration_consume`. PL/pgSQL bodies do not record column dependencies, so `DROP COLUMN` would succeed and these functions would fail at run time. Redefine them in M2 or at the top of M3, and add a pgTAP catalog test that no function body in `public`/`app` still references `username`, `username_normalized`, `username_reserved_at` or `birth_date` as identifiers after M3. `admin_view_craftsman_profile` from PR #129 (on HOLD) must not reference `p.username` when M3 lands. Index drops use plain `DROP INDEX` inside the transaction; `DROP INDEX CONCURRENTLY` only if the migration policy allows it outside a transaction (OPEN).

Locks: `DROP COLUMN` is metadata-only but takes a brief `ACCESS EXCLUSIVE`; use `lock_timeout = '5s'` with retries, off-peak.

Companion changes in the same PR: update test 14 so the service_role column grants are `users.locale` only; replace username/DOB tests with `hasnt_column` / `hasnt_function` / `hasnt_table` / `hasnt_index` absence tests; regenerate `frontend/src/types/database.types.ts`; renumber `supabase/tests`; retire `registration_username_lease_concurrency_test.sh` and its CI step; drop test 116's `ck_users_birth_date_range` assertion.

Rollback: not reversible except from backup; forward-fix only.

## 5. Auth-metadata scrub procedure (tested locally; full findings in [P1-AUTH-METADATA-SCRUB.md](P1-AUTH-METADATA-SCRUB.md))

Targets: `auth.users.raw_user_meta_data` key `birth_date` (2 Production / 11 Acceptance) and `auth.identities.identity_data` key `birth_date` (provider `email`, 2 / 11). No `username` key exists in Auth metadata (0 / 0).

Local findings (GoTrue v2.197.0, throwaway users):

- `auth.admin.updateUserById(id, { user_metadata: { birth_date: null } })` **removes only that key** from `raw_user_meta_data` and keeps unrelated metadata and app claims (merge semantics; `null` deletes). Supported, idempotent.
- It does **not** change `auth.identities.identity_data`. That copy is made once, at creation, by the public email `signUp` with `options.data` (admin `createUser` does not copy). No supported API removes a key from an existing `identity_data`: user and admin updates leave it, unlinking is disabled and cannot remove a last identity, and there is no admin identity-delete endpoint.

Procedure (script, run only after approval, Acceptance first): dry-run enumeration through the Admin API (counts only, ids stay in memory); batched `updateUserById` calls that send only `{birth_date: null}`, rate-limited, retrying 429/5xx with backoff; the work list is recomputed from live state so the run is idempotent and resumable; output holds counters only; re-count afterwards; smoke sign-up to prove no key reappears. Never SQL against `auth.*` as part of the supported procedure.

**Open (owner decision, before M3 sign-off):** the `identity_data` copy (2 / 11 rows). Options: accept it as a documented residual; a one-off owner-approved surgical write to `auth.identities` rehearsed on a restored snapshot (unsupported interface, untested); vendor support; user recreation is rejected. Until decided, the copy is reported as a residual and P1 is not declared complete without an explicit acceptance.

Non-recollection: the app release must stop writing `birth_date` to `signUp` `options.data`, `verifyOtp`, staff invitation, phone sign-up and OAuth completion before the scrub, or values will reappear (and `options.data` is exactly what creates the `identity_data` copy).

## 6. audit_log redaction - design APPROVED, hosted execution NOT approved

Detailed design, local proof and recovery plan: [P1-AUDIT-LOG-REDACTION-DESIGN.md](P1-AUDIT-LOG-REDACTION-DESIGN.md); draft SQL and tests under [drafts/](drafts/) (outside `supabase/migrations`, never auto-applied).

Summary: one reviewed migration, in a single transaction, replaces `app.guard_audit_actor_deletion()` with a copy that also permits exactly `metadata - 'username'` on `profile.username_set` rows (transaction-local token, migration login only, trigger depth 1, every other column identical), performs the update, restores the original guard byte for byte, and verifies row count, an aggregate checksum of everything except the username key, zero remaining keys, the guard fingerprint and ACL. No trigger is disabled. Local result: 39 of 39 assertions pass, including that every other UPDATE and DELETE stays blocked, the token does not outlive the transaction and a second run is a no-op. Preconditions for any hosted run: explicit per-environment owner approval, a restore-verified backup, the recorded pre-run aggregate, keep `profile.username_set` in `ck_audit_action_known`, and stop `app.record_audit_event('profile.username_set')` writing `{username}` (the action disappears with `profile_set_username` in M2). Old values survive only in backups, WAL and PITR windows until they expire.

## 7. Verification gates (every environment)

- Before/after counts: `profiles.username` non-null to 0; `users.birth_date` to 0; Auth `raw_user_meta_data` key to 0; the `identity_data` key per the owner decision in section 5; audit_log key to 0 only on the approved hosted run; `reserved_usernames` gone after M3.
- pgTAP `hasnt_*` absence tests; permission-gate diff shows removals only.
- Smoke: email, phone (including a phone-alias account), OAuth, staff-invitation sign-up and sign-in; username input yields the same `invalidCredentials`.
- Supabase advisors diff (new warnings triaged; old unrelated ones documented).
- Performance: p50/p95 via the `scripts/perf` pgbench + pgss harness before and after for sign-up, sign-in, directory, profile, admin users; baseline needed first (no EXPLAIN harness for the admin directory).
- Evidence kept as counts, never personal values.

## 8. Age policy (PROPOSED INTERIM requirement, pending legal approval)

Removing the birth date removes the only 18+ control in the product (it exists only in application code; OAuth has none). Nothing in this design silently drops eligibility protection. The **proposed interim requirement** (decision D-20, not yet approved by legal or the owner) is a required, server-enforced self-attestation "I confirm I am 18 or older" in every sign-up path (email, phone, staff invitation) and in OAuth finish-registration, with **no date of birth stored**. It is a PROPOSAL until legal and the owner approve it: the wording, where it is recorded (inside the existing Terms agreement line, or a new consent type, which needs an enum migration; compat matrix B6), and whether a version bump needs re-acceptance (the owner decided no automatic re-acceptance for removal alone) are all open. Whether the 18+ rule stays, changes per account type, or is dropped is a legal decision recorded as D-03 (CONDITIONAL). Until that decision is recorded, Acceptance and Production must not ship unrestricted account creation; PR-2 must ship the attestation or an explicitly approved alternative, and the Terms and Privacy copy changes go with it.

## Addendum (v1.3, 2026-11-11): label change and gates

M1 is `20261110090002` (renamed because `main` has its own `20261110090001`, media ids-only keys); M2/M3 stay `20261111090001` / `20261111090002`. Open gates, none executed: Auth `identity_data` copies, audit_log redaction placement (own migration versus M2 step; hosted run not approved), legal approval of the 18+ attestation, Privacy copy timing (no erasure claim before M2), #128/#129 HOLD. Detail: master plan section 3.10.
