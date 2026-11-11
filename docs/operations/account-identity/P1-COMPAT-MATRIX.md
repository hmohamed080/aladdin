# P1 compatibility matrix - OLD app and NEW app against each database state

**Purpose.** Show, per flow, how the current application (OLD = `main` `1b00ff4`) and the Phase 1 application (NEW = PR-2/PR-3, not merged) behave against the database before M1, after M1, after M2 and after M3, and name every break with its fix. **Current decision.** Order stays M1, app release, Auth scrub, M2, M3; the matrix shows why that order is the only safe one. **Rationale.** The registration state machine, the sign-in resolver and the admin directory read username today, and the old and new app overlap during rollout. **Scope.** The flows requested: phone-only alias accounts, email and password, OAuth (Google), consent, registration readiness, pending registration save and consume, profile completion, admin directory. **Deferred.** M2/M3 SQL does not exist yet, so post-M2 and post-M3 columns are design-level analysis (marked DESIGN), not test results; NEW-app columns are based on the plan contract and the in-progress PR-2 worktree, not on merged code. **Consequences.** Seven breaks and risks are listed in section 3 with fixes. **Related files.** [P1-MIGRATION-DESIGN.md](P1-MIGRATION-DESIGN.md), [P1-IMPACT-INVENTORY.md](P1-IMPACT-INVENTORY.md), [P1-EVIDENCE.md](P1-EVIDENCE.md).

Legend: OK = works as intended; CHANGED = behaviour differs but is intended and safe; BREAK = defect to fix before that step. Evidence tags: **T** = executed locally against the M1 SQL (pgTAP 125 pre and post M1, see [P1-EVIDENCE.md](P1-EVIDENCE.md)) or in PR #171 CI; **C** = read from code; **D** = design analysis, not executable yet; **N** = cannot be tested locally (no Google provider, no WhatsApp delivery, no hosted data).

## 1. What each step changes in the database (actual M1; planned M2/M3)

| Step | Changes (actual for M1) | Deliberately NOT changed |
|---|---|---|
| M1 `20261110090002` | `my_registration_state()` loses only the `username_pending` branch; `app.profile_completion()` loses the username criterion and the all-audience denominator goes 4 to 3; `admin_users_directory()` loses only the username search term | `pending_registrations` (NOT NULL already dropped in `20261028090003`, lease check already admits NULL/NULL), `pending_registration_save/consume`, `admin_user_detail` (still returns the stored username), `username_available`, `profile_set_username`, every column, index and stored value |
| M2 (design) | `birth_date` and `profiles.username` set to NULL, lease columns cleared, optional audit redaction, `REVOKE UPDATE (birth_date)`, drop of `profile_set_username`, `username_available`, lease helpers | no column dropped |
| M3 (design) | drop columns, indexes, constraints, `reserved_usernames`, `normalize_username_for_uniqueness`; recreate `pending_registration_consume` without username; **redefine `admin_users_directory`, `admin_user_detail`, `pending_registration_save` without the dropped columns** (new, see break B5) | |

## 2. Matrix

### 2.1 Phone-only alias accounts (`p<digits>@craftsman-login.aladdin.invalid`)

| App / DB | Pre-M1 | Post-M1 | Post-M2 | Post-M3 |
|---|---|---|---|---|
| OLD sign-in by phone | OK (C) | OK (C): the resolver reads the phone alias, not username | OK (D) | OK (D) |
| OLD sign-in by stored username | OK | OK | CHANGED: lookup finds nothing, `invalidCredentials` (D) | **BREAK B3**: `resolveSignInEmail` queries `username_normalized`; the column is gone, the lookup throws (C, `admin-server.ts:370-374`) |
| OLD sign-up by phone | OK; stages username lease (C) | OK (T: save/consume unchanged, pgTAP 125) | **BREAK B2**: calls `username_available` and `profile_set_username`, both dropped | BREAK (same) |
| NEW sign-in by phone | OK (C) | OK (C) | OK (D) | OK (D) |
| NEW sign-in by username | `invalidCredentials`, same padding (design) | same | same | same |
| NEW sign-up by phone | **BREAK B1** if a username-less user exists: DB returns `username_pending` | OK (T) | OK (D) | OK (D) |
| Existing alias account, readiness | `active_personal` or state by consent/type (T) | identical (T: pgTAP 125 tests 26-34) | identical (D) | identical (D) |
| Account with a stored username and no verified phone or email | not stranded in the 2026-11-10 audit (master plan 3.6); phone-only accounts with an unknown password were **not checked** (blocker 7) | same | username sign-in gone: recovery is phone code or email reset only (D) | same |

### 2.2 Email and password

| App / DB | Pre-M1 | Post-M1 | Post-M2 | Post-M3 |
|---|---|---|---|---|
| OLD sign-up (username and birthday sent) | OK | OK (T) | **BREAK B2** | BREAK |
| OLD sign-in by email | OK | OK | OK | OK |
| NEW sign-up (no username, no birthday, 18+ attestation) | **BREAK B1** (readiness `username_pending`, see 2.5) | OK (T for the DB half) | OK (D) | OK (D) |
| NEW sign-in by email | OK | OK | OK | OK |
| `signUp` `options.data` | NEW must not send `birth_date`: a copy in `identity_data` can only be erased by an owner-approved direct write ([P1-AUTH-METADATA-SCRUB.md](P1-AUTH-METADATA-SCRUB.md)) | | | |

### 2.3 OAuth (Google) - not testable locally (N)

| App / DB | Pre-M1 | Post-M1 | Post-M2 | Post-M3 |
|---|---|---|---|---|
| OLD OAuth first login | consent, account type, then username step (`entry-oauth.ts:134` routes `username_pending`); **no age gate today** (C) | after M1 the username step is skipped by state, and the OLD app sends the user home without a username: CHANGED, harmless (C, T for the state) | OK (D) | OK (D) |
| NEW OAuth first login | **BREAK B1** | OK: consent, account type, age attestation at finish-registration (design; attestation storage open, see B6) | OK (D) | OK (D) |

### 2.4 Consent flow

| App / DB | All four states |
|---|---|
| OLD and NEW | OK. `consent_pending` is decided before account type and is untouched by M1 (the function keeps the same early returns and order; T: pgTAP 125 tests 26-34 and 22_business_onboarding unchanged). `consent_type` is an enum `{terms, privacy, pilot}` and the state needs all three at the current version: an age-attestation recorded as a **fourth consent type needs an enum migration** (B6); recording it inside the existing terms agreement needs none |

### 2.5 Registration readiness (`my_registration_state()`)

| Situation | Pre-M1 | Post-M1 | Evidence |
|---|---|---|---|
| unconfirmed email | `unverified` | `unverified` | T |
| suspended or deactivated | `manually_blocked` | same | T |
| active membership or `users.status = 'active'` | `active_personal` | same (a business-track account with zero memberships is never `active_personal`) | T |
| no consent | `consent_pending` | same | T |
| consent, no account type | `account_type_pending` | same (not `access_ready`) | T |
| consent, account type, **NULL username** | `username_pending` | **`access_ready`** | T (pgTAP 125 test 28 fails before M1 and passes after) |
| consent, account type, legacy username | `access_ready` | `access_ready` | T |
| no session | `unverified` | `unverified` | T |

OLD app on post-M1: `username_pending` is simply never returned, so no OLD user is held; a mixed rollout where a NEW instance staged a username-less pending row and an OLD instance consumes it ends on `finish-registration?reason=username_unavailable` and then on onboarding or home because the state is `access_ready` (C): a detour, not a lock-out (B4).

### 2.6 Pending registration save and consume

| Call | Pre-M1 | Post-M1 | Post-M2 | Post-M3 |
|---|---|---|---|---|
| `pending_registration_save(..., p_username => NULL, ...)` (NEW) | already valid; the NEW app must pass `p_username: null` **explicitly** (omitting it does not resolve: only `p_ttl_minutes` has a default) | same (T: pgTAP 125) | same (D) | **BREAK B5** until the function is redefined without the username column |
| `pending_registration_save(..., 'name', ...)` (OLD) | OK, takes the lease | OK (T) | OK until the lease helpers are dropped: B2 | BREAK |
| `pending_registration_consume()` | returns `(username, audience_kind, audience_value)`; `username` is NULL when no active lease backs it | same (T) | same | recreated returning `(audience_kind, audience_value)`: the OLD app reading `username` gets `undefined` (B2) |

### 2.7 Profile completion

| App / DB | Pre-M1 | Post-M1 | Post-M2/M3 |
|---|---|---|---|
| Both | `missing` may contain `username`; all-audience items = 4 | `missing` never contains `username`; 3 all-audience items; percent rebalanced (avatar only: 75 to 67) | same |

CHANGED, not breaking: shape `{percent, missing, audience, has_org}` unchanged; `my_profile_completion()` and the admin directory read the same function so they agree (T: pgTAP 125 tests 36-42; pgTAP 59 and others updated for the new numbers). Any frontend test that hard-codes a percent must follow (none found in the audit).

### 2.8 Admin directory

| App / DB | Pre-M1 | Post-M1 | Post-M2 | Post-M3 |
|---|---|---|---|---|
| OLD and NEW admin UI, display name, email, phone search | OK | OK (T) | OK | OK once redefined (B5) |
| Search by username | finds the account | finds nothing (CHANGED, intended) (T) | finds nothing | n/a |
| `rows[].username` | stored value | stored value, same key (T: test 46; the mapper must tolerate presence and absence) | `null` (D) | key must be removed in the same migration that drops the column (B5) |
| `admin_user_detail().username` | stored value | **unchanged by M1** (stored value) | `null` | **BREAK B5**: the function still selects `p.username`; plpgsql does not record column dependencies, so `DROP COLUMN` succeeds and the function fails at run time |
| `permission to call` | `users.read` required; `anon` has no execute | unchanged (T: tests 48-55, permission gate PASS 753 in CI) | | |

## 3. Breaks and fixes

| ID | Break | When | Fix |
|---|---|---|---|
| B1 | NEW app against a pre-M1 database: a user without a username gets `username_pending`; the NEW app does not know that value and falls back to `account_type_pending`, so the user loops between account type and the same state | NEW app deployed before M1 | Hard ordering: M1 is applied and verified on the environment **before** the NEW app is promoted; the PR-2 release note says so (the in-progress PR-2 code already documents "Apply M1 before promoting this release"). M1 is expand-only, so the OLD app keeps working in between |
| B2 | OLD app against post-M2 / post-M3: sign-up calls `username_available` and `profile_set_username`, which M2 drops, and reads `username` from `consume` | any OLD instance still serving or any stale tab / cached client after M2 | M2 only after the NEW app has been 100% live, sessions drained, and release evidence shows no traffic to the dropped RPCs (PostgREST logs); keep M2 and M3 separate so M2 can be paused |
| B3 | OLD sign-in by username after M3: the lookup on the dropped `username_normalized` throws instead of returning `invalidCredentials` | OLD app after M3 | Same as B2; the NEW app has no username resolver. Not an enumeration leak but a server error: M3 must not run while any OLD build can serve sign-in |
| B4 | Mixed-version rollout: NEW instance stages a username-less pending row, OLD instance consumes it | rolling deploy window between M1 and full promotion | Cosmetic detour through `finish-registration` to onboarding; keep the window short; verify with the post-deploy smoke |
| B5 | **M3 as designed would leave `admin_user_detail`, `admin_users_directory` and `pending_registration_save` referencing dropped columns** (plpgsql bodies do not block the drop). `pg_proc` scan on the M1 database lists these as the functions whose source still mentions username/birth: `admin_user_detail`, `admin_users_directory`, `pending_registration_save`, `pending_registration_consume`, `profile_set_username`, `username_available`, `app.lock_username`, `app.username_leased_by_other`, `app.normalize_username_for_uniqueness` (plus `my_registration_state` and `profile_completion`, which only mention it in comments) | M3 | Added to the M3 design: redefine the three functions in M2 or M3 **before** the column drops, and add a pgTAP catalog test that no function body in `public`/`app` references `username`, `username_normalized`, `username_reserved_at` or `birth_date` as identifiers after M3. Also #129's `admin_view_craftsman_profile` (section 4 of the [conflict matrix](P1-PR-CONFLICT-MATRIX.md)) |
| B6 | The 18+ attestation has no storage yet: `consent_type` is the enum `{terms, privacy, pilot}` and `my_registration_state` counts exactly those three | PR-2 | Decide before PR-2: (a) fold the attestation into the existing Terms agreement line and record it as the `terms` consent at a bumped version (no schema change), or (b) a small additive migration adding an enum value (needs its own timestamp after M1 and a `my_registration_state` check that does not require it for existing users). Owner and legal decide; the attestation must be server-enforced in every sign-up path and in OAuth finish-registration |
| B7 | Auth `identity_data` copy of `birth_date` (2 Production, 11 Acceptance) cannot be removed with the Admin API | scrub | Owner decision, see [P1-AUTH-METADATA-SCRUB.md](P1-AUTH-METADATA-SCRUB.md) section 4 |

## 4. Not testable locally

Google OAuth first login and callback (no provider on the local stack), WhatsApp code delivery (OFF locally; the verification authority is covered by its own suites), hosted data shapes (counts only, from the 2026-11-10 audit), concurrent OLD and NEW instances (needs a deployed preview pair), and every post-M2 / post-M3 cell (SQL not written). Acceptance rehearsal on a restored snapshot of each environment closes these before any hosted step.

## 5. Release order (v1.3)

M1 (`20261110090002`) must be applied to an environment **before** the new app release there: pre-M1 database plus new app cannot complete new registrations. The old app must be gone before M3. Merge #171, #172, #173 back-to-back (the e2e fixes in #172/#173 depend on each other). See master plan section 3.10 for the CI-trigger caveats and open gates.
