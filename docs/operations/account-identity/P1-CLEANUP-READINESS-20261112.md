# P1 cleanup readiness (M2 / M3 / Auth scrub / audit redaction) - 2026-11-12, revision 2

**Purpose.** State what Phase 1 has actually delivered, what username and date-of-birth (DOB) residue is left in code, database, Auth metadata and audit logs, and the ordered, gated plan to remove it. **Status: planning only. Nothing in this document was executed against a hosted project.** Evidence is aggregate counts and catalog names, never personal values. Read-only reads of Production (`kkpkgjrweysgvhvkhzun`) and Acceptance (`nxossqhdfltcqdwvbewi`) on 2026-11-12; `main` `c9cc67b4`. Revision 2 fixes the execution order (backup before every irreversible step), replaces the M3 design with a transition proven in a throwaway database, records the phone-alias recovery finding and the `birth_date` reconciliation, adds the implementation PR sequence, and adds the R2 coordination rules.

## 1. Verdict

**NO-GO to execute M2, M3, the Auth scrub or the audit redaction today. GO to prepare them:** the first PR (M3a, a reversible function-only expand step) can be written and rehearsed on Acceptance as soon as the owner approves that scope. Phase 1 is **not complete**: sign-in, sign-up, registration and admin no longer use username or DOB, but the data and the schema still exist.

## 2. What is merged and deployed (verified)

| Item | State |
|---|---|
| #170 plan/docs, #171 M1 (`20261110090002`), #173 app (Auth, Frontend, Admin), #179 recovery gate + CI pinning, #181 account-type order, #182 age-attestation removal, #183 Production release media mode | merged into `main` |
| Media migration `20261110090001` and M1 `20261110090002` | applied on **Acceptance** (209) and **Production** (209, latest `20261110090002`), read-only check 2026-11-12 |
| Acceptance Preview Worker | version `6db4a740` (deployed from `main` `6b94bdbf`) |
| Production frontend Worker | version `32d08bff` at 100% since 2026-11-12 10:24 UTC (message "upload-only c9cc67b49db6 (r2-only)"); live media flags `R2_STORAGE_ENABLED=true`, `R2_PRODUCTION_WRITES_APPROVED=true`, `MEDIA_LEGACY_STORAGE_WRITES=false` (re-read 2026-11-12). R2 is owned by another agent; see section 8 |
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

Account stranding re-check (Production, aggregate): of 856 accounts with a username, 220 have a confirmed real email, 636 are phone-alias accounts and all 636 have a known phone, and **0 have no contact at all**.

### 3.2 Reconciliation: Production `birth_date` 4 to 3

What the data shows (Production, read-only, aggregates and timestamps only):

- All 3 current `birth_date` rows belong to accounts created on 2026-11-10 between 09:26 and 11:39 UTC. **No account created before 2026-11-10 has a `birth_date`**, and none created after 11:39 on 2026-11-10 has one (7 accounts that day, 3 with a birth date; 9 on 2026-11-11 and 2 on 2026-11-12, none).
- Of the 3 rows, 2 are email accounts (birth date also in `raw_user_meta_data` and `identity_data`) and 1 is a phone-alias account (database only). The 2026-11-10 baseline also had 2 Auth copies, so the fourth baseline row was a database-only row, that is, a phone-alias account.
- No sign of a nulled value: no older account was updated since 2026-11-10, and the accounts of 2026-11-10 without a birth date show `updated_at = created_at` (never written after creation).
- `public.users`, `auth.users` and `public.profiles` all hold 987 rows with **no orphans**, so a deleted account left no residue.
- The Auth service logs (last 24 hours only) record **one successful admin user delete at 2026-11-11 16:19 UTC**. Logs older than 24 hours are not available, and the deleted user cannot be identified.

**Conclusion (not provable, most likely):** the fourth row belonged to an account that was hard-deleted after the baseline (the app's phone sign-up cleanup also deletes an account when verification fails, and such accounts are created during the same hours). It was not erased by Phase 1: no migration after M1 touches data, and M2 has not run. **Control:** M2 must not hardcode a count. It records the live count inside the migration transaction before updating and compares afterwards (before count equals rows updated, after count is 0).

### 3.3 Database objects still present (catalog scan of `public` and `app`, Production)

- Columns: `public.profiles.username`, `profiles.username_normalized` (generated), `public.users.birth_date`, `app.pending_registrations.username`, `pending_registrations.username_reserved_at`. All are nullable already, so nulling the data in M2 needs no constraint change.
- Constraints (the scan covered `public` only): `ck_profiles_username_length`, `ck_profiles_username_shape`, `ck_users_birth_date_range`, and `audit_log.ck_audit_action_known` (it lists the historical action `profile.username_set`; **keep that value**, history rows use it). `app.pending_registrations` constraints were not scanned; the design names `ck_pending_registrations_lease_shape`.
- Indexes: `uq_profiles_username_normalized`, `app.ix_pending_registrations_username_lease`, `reserved_usernames_pkey` (table `public.reserved_usernames`, 20 rows).
- Functions still reading username: `public.profile_set_username`, `public.username_available`, `app.lock_username`, `app.normalize_username_for_uniqueness`, `app.username_lease_interval`, `app.username_leased_by_other`, `public.pending_registration_save` (takes `p_username`), `public.pending_registration_consume`, `public.admin_user_detail`, `public.admin_users_directory` (still emits a `username` key that the app ignores). `my_registration_state` and `app.profile_completion` mention username only in comments after M1.
- Views, policies, triggers: none reference username or birth date. `app.handle_new_user` does not touch either.

### 3.4 Application code

- Sign-in, sign-up, onboarding, staff, OAuth and the admin directory no longer collect, show or check either value; `signUp` metadata carries only display name and locale (tested).
- **Still coupled to database objects that M3 removes:** `frontend/src/lib/supabase/admin-server.ts:238` calls `pending_registration_save` with `p_username: null` (named arguments); `frontend/src/server/phone-verification/integration-support.ts:86` selects `p.username` in a test-support SQL; `frontend/src/types/database.types.ts` carries the columns and functions. The caller of `pending_registration_consume` (`server/actions/auth-password-preview.ts:506`) already ignores the `username` field.
- **Dead code to delete:** `checkUsername` (`server/actions/sign-up.ts`), `chooseUsernameAction` (`server/actions/registration.ts`), `features/installer-phone-auth/username.ts`, `lib/identity/username.ts` and their tests; pgTAP `118_registration_username_lease_test.sql`, `registration_username_lease_concurrency_test.sh` and its CI step; the birth-date assertions in pgTAP `116_sign_up_birthday_phone_codes_test.sql` and test 14's service_role grants.

### 3.5 Auth metadata and audit logs

- `raw_user_meta_data.birth_date`: 2 Production / 11 Acceptance; removable with the supported Admin API (`updateUserById`, `birth_date: null`), tested locally ([P1-AUTH-METADATA-SCRUB.md](P1-AUTH-METADATA-SCRUB.md)).
- `identity_data.birth_date`: 2 / 11; **no supported API removes it**. Owner decision pending (accept as a residual, or a rehearsed one-off write).
- No `username` key exists in Auth metadata.
- `audit_log` username keys: removal needs the approved but unexecuted redaction migration ([P1-AUDIT-LOG-REDACTION-DESIGN.md](P1-AUDIT-LOG-REDACTION-DESIGN.md), drafts under `drafts/`).

## 4. Risks to existing accounts, authentication and permissions

| Risk | Status | Control |
|---|---|---|
| Username sign-in is gone for 856 accounts | **Already in effect** since the app release, not caused by M2 | 220 can use a confirmed email, 636 their phone number |
| **Phone-alias accounts (636) have no self-service password recovery** | **Verified, existing gap** (see 4.1) | Owner decision (blocker 5) |
| Stale OLD app code calling dropped functions | The OLD app is no longer served (only `32d08bff` at 100%) | Do not run M3b while any older version can receive traffic; check Worker deployments first |
| Redefining `pending_registration_save` / `pending_registration_consume` | `consume()` has no arguments and cannot be overloaded; its return table cannot change in place | The transition in section 5.1, proven in a throwaway database |
| `DROP COLUMN` succeeds while PL/pgSQL bodies still read the column (they fail at run time) | Real | Redefine the readers first (M3a); `pg_proc` scan before and after |
| Permissions | M2 drops 2 functions and revokes one column grant; M3a adds 1 overload; M3b drops/redefines about 10. Current contract: 754 functions | New contract file per migration; the gate diff must show exactly the intended adds and removals |
| Audit trail integrity | Redaction touches an append-only table guarded by a trigger | Approved single-transaction design restores the guard byte for byte; not executed |
| **A frontend upload with the workflow's default `media_mode` would revert the live R2-only configuration** | Real (see section 8) | Run every frontend upload with `media_mode=r2-only` until a follow-up PR adds a match-live check |

### 4.1 Phone-alias recovery path (636 accounts) - verified without exposing or touching any account

- Password recovery is **email only**: `requestRecoveryCode` accepts an email address (`emailSchema`) and calls `resetPasswordForEmail`; the forgot-password form has no phone input. A phone-alias account's auth email is an internal `.invalid` address that cannot receive mail.
- The phone verification authority issues no recovery code: the only challenge purposes are `primary_proof` and `signup_proof` (Production holds 11 challenges, all `signup_proof`). The database config has `enabled = true` and `signup_enabled = true`; this is sign-up proof, not recovery.
- `/auth/support` renders the support contact only when `NEXT_PUBLIC_SUPPORT_CONTACT` is configured. It is not among the live Worker's variables nor the production environment's build variables, so the page shows its "unavailable" state.
- Admin password management is Phase P4 (HOLD).
- Net effect: a phone-alias account that has forgotten its password has no automated way back in and no visible support contact. Username sign-in was not a recovery path either (it needed the same password), so M2 does not worsen this, but the cleanup must not be announced as complete without an owner decision (for example set the support contact, a documented manual reset by an administrator, or a phone-code recovery flow as its own project).

## 5. Ordered plan (each step: Acceptance first under its own approval, then Production under a new approval)

**Rule: a verified backup and a restore test precede EVERY irreversible operation: the Auth metadata scrub, M2, the audit redaction and M3b.** Steps 1 to 2 below are reversible (function-only, forward-fix tested), so they come before the backup; everything after the backup that erases or drops is irreversible except from that backup.

| # | Step | Exact scope | Tests / gates | Rollback limit |
|---|---|---|---|---|
| 0 | Re-baseline and decisions (read-only) | Re-count section 3.1 on both projects; owner decides the `identity_data` residual, audit-redaction placement and execution, the legal wording, the phone-alias recovery path, and #128/#129 stay HOLD | counts recorded as aggregates | none needed |
| 1 | **M3a** migration (expand; function-only) | `CREATE OR REPLACE public.pending_registration_consume()` with the **same signature and the same result table**, returning `NULL` for `username` and no longer reading the username columns; **add** the overload `public.pending_registration_save(p_user_id, p_audience_kind, p_audience_value, p_ttl_minutes)` with no username; redefine `admin_user_detail` and `admin_users_directory` without reading `profiles.username`; grants identical to the old functions | pgTAP (section 6), proof in `drafts/` passes, permission gate adds exactly 1 function, fingerprint diff names exactly the changed functions | forward-fix file restores the previous bodies and drops the new overload (pinned by sha256 in the gate, like M1) |
| 2 | App release PR-B (no database change in the PR) | `savePendingRegistration` sends named arguments **without** `p_username`; delete the dead code in 3.4; additive type regeneration; fix `integration-support.ts` | `tsc`, lint, vitest, E2E sign-up and sign-in; **apply M3a to the target environment before this release** (DB first, as with M1) | Worker version rollback (valid, M3a keeps both overloads) |
| 3 | **Fresh backup and restore test** per environment | Acceptance snapshot `T094450Z` is at 203 migrations and is not a current recovery point; Production has no restore-verified snapshot after the 209 migrations. Evidence: backup run PASS, restore run PASS, migration count recorded | recorded in `P1-EVIDENCE.md` | requires explicit owner approval (owner constraint: no new backups until then) |
| 4 | Auth metadata scrub (script, not a migration) | `birth_date` key in `raw_user_meta_data` only (2 Production / 11 Acceptance) | dry-run counts, idempotent rerun, smoke sign-up proves the key does not return | **irreversible** except from the step 3 backup |
| 5 | **M2** data cleanup | In one transaction: record the live counts, then `UPDATE users SET birth_date=NULL`, `UPDATE profiles SET username=NULL` (`username_normalized` follows), clear `pending_registrations.username` and `username_reserved_at`; `REVOKE UPDATE (birth_date) ON users FROM service_role`; drop `profile_set_username` and `username_available` (the app calls neither). **The three lease helpers and `lock_username` stay until M3b**, because the old `pending_registration_save` overload (kept for step 2 rollbacks) still calls them. Abort if any pending lease exists; `lock_timeout 5s`; idempotent. Count comparison is relative to the recorded count, never a constant | pgTAP: both columns zero non-null, functions absent, grant gone, `audit_log` row count unchanged by the migration; permission gate removals only; advisors diff; smoke (email, phone-alias, OAuth, staff) | **data erasure is not reversible except from backup**; the two functions can be recreated by a forward-fix |
| 6 | Audit-log redaction migration (own migration, own approval) | `metadata - 'username'` on `profile.username_set` rows (863 / 20) per the approved design | row count and checksum of everything except the key; guard fingerprint and ACL restored | irreversible except from backup |
| 7 | **M3b** drop (single migration, no CASCADE) | In one transaction, in this order: drop the OLD `pending_registration_save(uuid, text, kind, text, integer)`; `DROP FUNCTION pending_registration_consume()` and `CREATE` it with the two-column result `(audience_kind, audience_value)` (the one caller already ignores `username`); then `ix_pending_registrations_username_lease`, `ck_pending_registrations_lease_shape`, `pending_registrations.username` and `username_reserved_at`, `uq_profiles_username_normalized`, `profiles.username_normalized`, `ck_profiles_username_*`, `profiles.username`, `reserved_usernames`, `ck_users_birth_date_range`, `users.birth_date`, the helper functions `lock_username`, `username_lease_interval`, `username_leased_by_other`, and `normalize_username_for_uniqueness` last; keep the `profile.username_set` audit action | `hasnt_column/function/table/index` pgTAP; permission gate; before/after `pg_proc` scan; performance baseline; confirm no older Worker version can receive traffic | **not reversible except from backup** |
| 8 | Close-out | Regenerate types (removals), delete the legacy tests and CI step, Privacy copy may claim erasure only after steps 4 to 6 (and the `identity_data` decision); update plan, runbook, evidence | final counts | - |

### 5.1 M3 compatibility design (replaces the earlier "recreate both functions in M3")

The earlier design recreated `pending_registration_consume()` and `pending_registration_save()` in one migration. PostgreSQL does not allow that to be backward compatible:

- `pending_registration_consume()` takes no arguments, so it **cannot be overloaded**, and `CREATE OR REPLACE` **cannot change its `RETURNS TABLE(username, audience_kind, audience_value)`** (SQLSTATE `42P13` / `42723`).
- Therefore the transition is: M3a keeps `consume()` with the **same result shape** (`username` is always `NULL` and the body stops reading the columns), so the columns become droppable; M3b then drops and recreates `consume()` with the two-column result **inside the same transaction** as the drops. This is safe because the single caller ignores `username` (tested in the app suite) and a function recreated in the same transaction is never visible half-done.
- `pending_registration_save` differs in its argument list, so M3a **adds** a username-less overload and the old one is dropped in M3b. Callers must use **named arguments** (supabase-js `rpc()` does): an untyped positional call is ambiguous between the two overloads (`42725`), which the proof records.

Proof: `drafts/DRAFT_m3a_pending_registration_transition_proof.sql`, run by `drafts/run-m3a-transition-proof.sh` in a throwaway `postgres:17` container (no Supabase, no hosted project). It uses the Production definitions copied from the catalog on 2026-11-12 and checks, all passing: F1 plain redefinition is impossible; F2 same-shape replace works for an old and a new caller; F3 both `save` overloads resolve by named arguments and the ambiguity case is documented; F4 the username columns drop without breaking either function (rehearsed and rolled back); F5 the M3b recreation works and a stale old caller fails with `42883`, which the app already logs and ignores. The full-stack proof is the real M3a pgTAP test below.

## 6. Implementation PR sequence and test gates (#128 and #129 stay on HOLD throughout)

| PR | Content | Merge gate | Environment gate |
|---|---|---|---|
| PR-A | M3a migration (next free version after `20261110090002`), new permission contract (755 functions), forward-fix `scripts/hosted-db/forward-fix/m3a-restore-previous.sql` pinned in the recovery gate as a new plan, pgTAP `127` | CI green incl. `migration-policy` and `supabase-rls`; pgTAP: both overloads, `consume()` shape unchanged, `username` NULL, grants equal to the old functions, `profile_completion` unchanged, directory and detail work without username; the transition proof passes | Acceptance preflight + apply under its own GO, then Production under a new GO; function-only, no backup needed (forward-fix) |
| PR-B | App: named-argument `savePendingRegistration` without `p_username`, dead-code deletion, additive types, `integration-support.ts` | CI green incl. E2E; unit test asserts the call has no `p_username` | After PR-A is applied in the target environment; deployed with the R2 rules in section 8 |
| (ops) | Backup and restore evidence (step 3) | backup and restore runs PASS, recorded | explicit owner approval per environment |
| PR-C | Auth scrub script and tests (counters only, idempotent, resumable) | tests with a mocked Admin API; local GoTrue proof reference | run on Acceptance, then Production, each under approval, after the backup |
| PR-D | M2 migration, contract, pgTAP, forward-fix for the two dropped functions | CI green; relative-count assertions; removals-only gate | after the backup and PR-C |
| PR-E | Audit redaction migration from `drafts/` | the draft tests plus guard restoration checks | own approval, after the backup |
| PR-F | M3b migration, contract, `hasnt_*` tests, regenerated types, legacy tests and CI step removed | CI green; `pg_proc` scan finds no username/birth readers; permission gate | after PR-B is live and no older Worker can serve traffic; after the backup |
| after PR-F | #128 and #129 are reworked without username dependencies and relabelled | their own review | HOLD until then |

Per-environment gates for every database PR: aggregate before/after counts, permission-gate diff matching the intent, advisors diff, smoke sign-up and sign-in (email, phone-alias, OAuth, staff invitation), evidence recorded as counts only.

## 7. Blockers

1. **Not written:** M3a, M2, M3b and the audit-redaction migration exist only as design and drafts; no file under `supabase/migrations` yet.
2. *Owner:* approve fresh restore-tested backups (step 3) for each environment; they gate steps 4 to 7.
3. *Owner:* decide the `identity_data.birth_date` copies (2 Production / 11 Acceptance) and approve the audit-redaction execution.
4. *Owner/legal:* review the "intended for people aged 18 or older" wording.
5. *Owner:* decide the recovery path for the 636 phone-alias accounts (section 4.1).
6. *Owner:* approve a small follow-up PR so the production workflow's `media_mode` can no longer revert the live R2-only configuration (section 8).
7. #128 and #129 remain on HOLD until after PR-F.

## 8. Frontend deployment and the live R2-only configuration (coordination with the R2 agent)

Live today (re-read 2026-11-12): Worker version `32d08bff` at 100%, `R2_STORAGE_ENABLED=true`, `R2_PRODUCTION_WRITES_APPROVED=true`, `MEDIA_LEGACY_STORAGE_WRITES=false`.

**Hazard.** The production workflow input `media_mode` (merged in #183) defaults to `legacy-hold`, which overrides the three media flags to R2 OFF and legacy writes ON. That default was right when the live Worker had R2 off; it is wrong now. A `frontend-upload` run with defaults followed by a promotion would silently reopen Supabase Storage writes and turn R2 off.

**Rules until a follow-up PR (for example `media_mode=match-live`, which reads the live version's three flags from the Cloudflare API and fails if the new version would differ) is merged:**

1. Run every `frontend-upload` with `media_mode=r2-only` (no overrides, so the committed R2-only flags apply).
2. Before testing or promoting, read the uploaded version's bindings through the Cloudflare API and require its three media flags to equal the live version's.
3. No frontend upload for this plan (PR-B or later) starts without the R2 agent's confirmation that no R2 change is in flight; uploads stay at 0% traffic; promotion is a separate owner approval.
4. The R2 agent keeps ownership of R2 settings, buckets and cutover steps; Phase 1 work never edits them.

**Coordination status.** No message was sent: the session list shows peer sessions but none is identifiable as the R2 agent, and sending project details to an unidentified session is not appropriate. The owner is asked to name the R2 session or relay these four rules.

## 9. Out of scope here

R2 and media configuration (another agent). No data, migration, backup, merge, environment change or deployment was made for this report; the only files created are documentation and the throwaway-container proof under `drafts/`.
