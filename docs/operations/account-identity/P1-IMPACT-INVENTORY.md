# P1 Impact Inventory - remove application Username and Date of Birth

**Purpose.** List every occurrence of the application-managed username and date of birth that Phase 1 touches, with owner, planned action and verification. **Current decision.** Per [the master plan v1.1](../../architecture/ACCOUNT_IDENTITY_LIFECYCLE_MASTER_PLAN.md) decisions D-18..D-23. **Rationale.** Plan item P1.1; implementers need one reviewed list before any code or SQL. **Scope.** `origin/main` at `1b00ff4`, read-only audits of 2026-11-10 (subagent-reported, awaiting reviewer verification). **Deferred.** Everything outside Phase 1 (P2-P6). **Consequences.** Rows marked OPEN block the dependent step. **Related files.** [P1-MIGRATION-DESIGN.md](P1-MIGRATION-DESIGN.md), [P1-PR-CONFLICT-MATRIX.md](P1-PR-CONFLICT-MATRIX.md).

Status legend: **CONFIRMED** = read from code/DB metadata in the audit; **INFERRED** = deduced from naming or lineage, not read in full; **OPEN** = not yet checked or needs a decision. Only counts and key names appear here; no personal values.

## 1. Database objects and dependency drop order

Hosted state: Production (`kkpkgjrweysgvhvkhzun`) and Acceptance (`nxossqhdfltcqdwvbewi`) both at 207 migrations ending `20261107090006`; md5 of the 12 audited function definitions identical.

| # | Object | Owner / lineage | Planned action | Verification | Status |
|---|---|---|---|---|---|
| D1 | `public.users.birth_date` + `ck_users_birth_date_range` | `20261028090001_sign_up_birthday_and_phone_codes` | M2 NULL data; M3 drop constraint then column | `hasnt_column`; count 4/13 to 0 | CONFIRMED |
| D2 | service_role column grant on `users.birth_date` (and `users.locale`) | test 14 asserts it | M2 `REVOKE UPDATE(birth_date)`; test 14 to `users.locale` only | grants snapshot diff = removals only | CONFIRMED |
| D3 | `public.profiles.username` | `20260924090001_username_identity` | M2 NULL data (855/18); M3 drop after checks | count to 0; `hasnt_column` | CONFIRMED |
| D4 | `profiles.username_normalized` (generated) + `uq_profiles_username_normalized` | same | M3: drop unique index, then column | `hasnt_index`, `hasnt_column` | CONFIRMED (generated column follows NULL: verify) |
| D5 | `ck_profiles_username_*` checks | same | M2 confirm they allow NULL; M3 drop | pg_constraint scan | INFERRED (names from plan, allow-NULL not read) |
| D6 | `app.pending_registrations.username`, `username_reserved_at` (NOT NULL), `ck_pending_registrations_lease_shape`, `ix_pending_registrations_username_lease` | `20260924090006`, `20261028090003` | M1: **no DDL** (NOT NULL already dropped in `20261028090003`; the lease check already admits NULL/NULL); M3 drop index, check, then columns | rows 0/0; `hasnt_column` | CONFIRMED |
| D7 | `public.reserved_usernames` (20/20 rows) + RLS policy | `20260924090001` | M3 drop table with policy | `hasnt_table` | CONFIRMED |
| D8 | `app.lock_username(text)` | lease | M2 drop | `hasnt_function` | CONFIRMED |
| D9 | `app.username_lease_interval()` | lease | M2 drop | same | CONFIRMED |
| D10 | `app.username_leased_by_other(text,uuid)` | lease | M2 drop | same | CONFIRMED |
| D11 | `app.normalize_username_for_uniqueness(text)` | identity | M3 drop **last** (generated column/index depend on it) | same | CONFIRMED |
| D12 | `public.username_available(text)` (anon-granted; rate limit unverified) | identity | M1 untouched; M2 drop | same; anon grant gone | CONFIRMED |
| D13 | `public.profile_set_username(text)` (authenticated) | identity | M1 untouched; M2 drop | same | CONFIRMED |
| D14 | `public.pending_registration_save(uuid,text,activity_audience_kind,text,int)` (service_role) | `20260924090006`, `20261028090003` | M1: **unchanged** (a NULL `p_username` already stages audience only, no lease; the app passes `p_username: null` explicitly); M3 redefine without the username columns | pgTAP | CONFIRMED |
| D15 | `public.pending_registration_consume()` returns `(username,audience_kind,audience_value)` (authenticated) | same | M1: **unchanged** (already returns NULL username without a lease); M3 drop + recreate returning `(audience_kind,audience_value)` | pgTAP; app already stopped reading username | CONFIRMED |
| D16 | `public.my_registration_state()` `username_pending` branch; `access_ready` | `20260924090007`; redefined `...090008/10/11`, `20260930090001`, `20260930100006`, `20261021090006`, `20261105090001` | M1 drop only that branch; keep account_type/consent/verification states | pgTAP matrix of states; existing verified accounts do not regress | CONFIRMED |
| D17 | `app.profile_completion(uuid)` username criterion | `20260924090008/10`, `20260930090001`, `20261024090011` | M1 drop criterion | pgTAP 59 updated | CONFIRMED |
| D18 | `public.admin_users_directory(...)`, `public.admin_user_detail(uuid)` search and return username | `20260930090002`, `20261021090003`; perms `20261021090006` | M1 (actual): `admin_users_directory` drops **only the username search term** and still emits the stored `username` key (mapper tolerant); `admin_user_detail` **untouched** (still returns the stored username); M2/M3 must redefine both before the column drop (compat matrix B5); grants and `search_path=''` re-asserted | permissions snapshot `20261110090002.json`; mapper test | CONFIRMED |
| D19 | `public.admin_view_craftsman_profile` (PR #129) returns `p.username` | #129, not on main | must not reference username before M3 | rebase review | CONFIRMED (PR content) |
| D20 | `audit_log.metadata->'username'` on `profile.username_set` (860/20); `ck_audit_action_known` must keep the action | `20260924090009` | Option 2 redaction, **proposal needing owner approval** | count of key to 0 | CONFIRMED |
| D21 | `auth.users.raw_user_meta_data` key `birth_date` (2/11); no `username` key | Auth | Admin API scrub (design doc section 5) | count to 0 | CONFIRMED |
| D22 | `auth.identities.identity_data` key `birth_date` (provider email; 2/11) | Auth | Local test 2026-11-10: `updateUserById` does **not** clean it; no supported API does; created by public email `signUp` `options.data` ([P1-AUTH-METADATA-SCRUB.md](P1-AUTH-METADATA-SCRUB.md)) | owner decision on residual vs surgical write | OPEN (owner decision) |
| D23 | Other migrations that mention username/birth_date text (32 files, listed below) | various | Read-only lineage; confirm none defines a live function outside the 12 | `pg_proc` source scan = the 12 | INFERRED (hosted scan found 12 functions) |

32 migration files matching `username|birth_date` (history, never edited): `20260924090001/06/07/08/09/10/11`, `20260929100001`, `20260930090001/02`, `20260930100001/04/06`, `20261014133000`, `20261014160000`, `20261015090004/08/16/17/18/20/28/30/33/35/37`, `20261021090003/06`, `20261024090011`, `20261028090001/03`, `20261107090002`. Most are older definitions superseded by later `CREATE OR REPLACE`; D23 stays INFERRED until the hosted `pg_proc` source scan is repeated against the final M3 state.

**Drop order (no CASCADE):** M1 function revisions (no DDL); app release; Auth scrub; M2 data NULLing + function drops + grant revoke; M3: lease index and `ck_pending_registrations_lease_shape` -> `pending_registrations.username`/`username_reserved_at` (after recreating `consume`) -> `uq_profiles_username_normalized` -> `profiles.username_normalized` -> `ck_profiles_username_*` -> `profiles.username` -> `reserved_usernames` -> `ck_users_birth_date_range` -> `users.birth_date` -> `app.normalize_username_for_uniqueness` last.

**Checked, no hits (counts only):** `notifications`, `organization_activity_events`, `sales_activities`, `verifications`, `points_ledger`, `saved_searches`, `branches.public_identity`, backup tables, WhatsApp OTP tables, storage object metadata, `auth.audit_log_entries`, SCIM. CONFIRMED (subagent-reported). Immutable backups and external copies: OPEN.

## 2. Server and authentication code

| # | File (under `frontend/src`) | Occurrence | Planned action | Verification | Status |
|---|---|---|---|---|---|
| S1 | `lib/auth/sign-in-identifier.ts` | classifier: username branch, `u:` rate-limit key | email/phone only; other input returns the same `invalidCredentials` after the same padding and CAPTCHA | `sign-in-identifier.test.ts`; enumeration test | CONFIRMED |
| S2 | `lib/supabase/admin-server.ts` | `resolveSignInEmail` username lookup; `saveVerifiedBirthDate` to `users.birth_date`; username helpers | remove username branch and DOB writer; **leave phone path (profiles.phone_e164 to alias) untouched** | phone sign-in test for the 638/3 alias accounts | CONFIRMED |
| S3 | `server/actions/auth-password-preview.ts` | email `signUp` `options.data` birth date (~L332), `verifyOtp` `saveVerifiedBirthDate` (~L525), sign-in username branch | remove writes and branch; add attestation per D-20 | action tests | CONFIRMED |
| S4 | `server/actions/staff-invitation.ts` | DOB at L120/L161 | remove; attestation | staff tests | CONFIRMED |
| S5 | `server/auth/phone-sign-up.ts` | DOB, `parseBirthDate` | remove | phone-sign-up tests | CONFIRMED |
| S6 | `server/auth/entry-oauth.ts` | username-pending routing; no age gate | route without username; add attestation at finish-registration | entry-oauth tests | CONFIRMED |
| S7 | `server/queries/registration.ts` | routes on `username_pending` | remove state handling (last, with migration + types regen) | page tests | CONFIRMED |
| S8 | `server/actions/sign-up.ts`, `server/actions/registration.ts`, `server/actions/auth.ts` | username availability/lease/set | remove | tests | CONFIRMED |
| S9 | `server/actions/profile-identity.ts`, `server/queries/profile-identity.ts`, `server/identity/username-change.ts` (`setUsernameAction`) | username edit/read | delete with settings UI | tests | CONFIRMED |
| S10 | `lib/identity/username.ts`, `features/installer-phone-auth/username.ts` | helpers | delete after imports gone | tsc | CONFIRMED |
| S11 | `features/auth-password-preview/password-policy.ts` | `parseBirthDate`, `MINIMUM_SIGN_UP_AGE` (the only 18+ control) | replace with attestation validator (PR-2); remove DOB parsing last | password-policy tests | CONFIRMED |
| S12 | `server/phone-verification/integration-support.ts`, `lib/cloudflare/backend-proxy.ts`, `lib/env/cache.ts`, `lib/onboarding/social-links.ts`, `app/admin/points`, `app/admin/review/[type]/[id]`, `app/admin/settings` | text matches for username/birth tokens | review each; likely **false positives** (see section 7) | grep + read | OPEN |
| S13 | `types/database.types.ts` | generated | regenerate after M3 from the real schema | diff = removals | CONFIRMED |
| S14 | Backend (`backend/`), Worker, edge | no references | none | grep | CONFIRMED |
| S15 | Password-reset and redirect paths for obsolete username links | no public username URLs (`/p/[profileId]` is id based) | confirm no username deep links | route scan | OPEN (reset path not read) |

## 3. UI

| # | File (under `frontend/src`) | Action | Status |
|---|---|---|---|
| U1 | `features/auth-password-preview/sign-up-form.tsx` | remove username and DOB fields; add attestation | CONFIRMED |
| U2 | `features/auth-password-preview/sign-in-form.tsx` | label "Mobile number or email"; fix `autoComplete` | CONFIRMED |
| U3 | `features/auth-password-preview/{birth-date-select,username-check}.tsx` | delete (after imports) | CONFIRMED |
| U4 | `features/auth-password-preview/finish-registration-screen.tsx` (`continue-registration-form.tsx` was removed 2026-11-12), `app/auth/finish-registration/page.tsx`, `app/preview/auth-password/finish-registration/page.tsx` | remove username/DOB; attestation for OAuth | CONFIRMED |
| U5 | `features/staff-invitation/staff-register-form.tsx` | remove DOB; attestation | CONFIRMED |
| U6 | `app/onboarding/{page,account-type,complete}`, `app/onboarding/username/page.tsx`, `features/onboarding/username-step.tsx` | remove username step; delete route and redirect | CONFIRMED |
| U7 | `features/profile/complete-profile-card.tsx` | drop username item | CONFIRMED |
| U8 | `app/home/settings/page.tsx`, `features/settings/*`, `features/installer-settings/{installer-settings.tsx,production-copy.ts}`, `features/installer-settings-preview/{installer-settings-preview.tsx,settings-copy.ts}` | remove username labels/editing | CONFIRMED |
| U9 | `app/admin/users/[id]/page.tsx`, `app/admin/users/page.tsx`, `features/admin-preview/directory-mappers.ts` | remove username column; mapper tolerates the key during M1 window | CONFIRMED |

## 4. i18n keys (only `lib/i18n/messages/en.ts` and `ar.ts` exist)

Remove in **both** locales: the `registration.username.*` block; sign-up keys `birthDate*`, `birthMonth`, `birthDay`, `birthYear`, `username*`; validation keys `birthDateRequired`, `birthDateInvalid`, `birthDateTooYoung`; settings username labels; admin users username column keys. **Edit, do not delete:** `usersSearchPlaceholder`, `identifierLabel`, `subtitle`, `accountBody`, staff-invitation intro; also copy in `features/installer-settings/production-copy.ts`, `features/installer-settings-preview/settings-copy.ts`. Add attestation keys (PR-2) in both locales. Verification: `username-copy.test.ts` replaced by an absence test; en/ar key-parity test. Status: CONFIRMED (key families), exact key list OPEN until PR-2.

## 5. Legal copy

| # | Location | Action | Status |
|---|---|---|---|
| L1 | `features/legal/content.ts:46,149` (Privacy) | reword: no DOB collected; attestation wording | CONFIRMED |
| L2 | `features/legal/content.ts:474` (Terms) | reword 18+ clause | CONFIRMED |
| L3 | `LEGAL_UPDATED_AT` | bump; verify whether it forces re-acceptance (D-23: not for removal alone) | OPEN |
| L4 | Legal sign-off on D-20 attestation and wording | needed before PR-2 merge | OPEN |

## 6. Tests

**Vitest (31 files, all matching username/birth tokens):** `app/admin/users/[id]/page.test.tsx`, `app/admin/users/page.test.tsx`, `app/auth/canonical-routes.test.tsx`, `app/auth/finish-registration/page.test.tsx`, `app/onboarding/business/page.test.tsx`, `app/settings/profile/page.test.tsx`, `features/admin-preview/directory-mappers.test.ts`, `features/auth-password-preview/{captcha-wiring.test.tsx, finish-registration-screen.test.tsx, password-policy.test.ts, sign-in-form.test.tsx, sign-up-form.test.tsx, username-check.test.tsx}`, `features/installer-phone-auth/validation.test.ts`, `features/installer-settings/installer-settings.test.tsx`, `features/settings/personal-settings.test.tsx`, `features/staff-invitation/staff-invitation.test.tsx`, `lib/auth/{form-limits.test.ts, sign-in-identifier.test.ts}`, `lib/i18n/messages/username-copy.test.ts`, `server/actions/{auth-password-preview, auth-sign-out, profile-username, sign-up, staff-invitation}.test.ts`, `server/auth/{entry-oauth, phone-sign-up}.test.ts`, `server/identity/username-change.test.ts`, `server/phone-verification/{service.local-integration, signup.local-integration}.test.ts`, `server/queries/profile-identity-legacy.test.ts`. Action: update/replace; delete the dead-module tests first. Status: CONFIRMED.

**Playwright (20 files under `frontend/e2e`):** `account-registration`, `account-workspace-model`, `admin-referral-location-correction`, `auth-password-preview`, `business-onboarding`, `business-registration-mandatory`, `helpers/auth.ts`, `helpers/fixtures.ts`, `helpers/phone-sign-up.ts`, `installer-profile-completion`, `one-field-auth`, `personal-sales-readiness`, `profile-completion`, `registration-persona`, `regression/m-personal-profile`, `regression/n-first-registration`, `shared-onboarding`, `showroom-social-links`, `video/r2-images`, `video/video-r2` (`.spec.ts` unless a helper). Action: remove username/DOB steps; helpers first. Status: CONFIRMED (token match; some may be incidental, verify per file: OPEN).

**pgTAP and DB tests (about 25 files, `supabase/tests`):** `104_installer_phone_alias_guard`, `104_media_id_storage_keys`, `106_installer_sensitive_action_audit`, `108_installer_integration_compat`, `116_sign_up_birthday_phone_codes`, `117_showroom_social_links_settings`, `118_registration_username_lease`, `11_individual_persona_onboarding`, `14_write_path_security_review`, `21_shared_onboarding`, `22_business_onboarding`, `25_pilot_account_activation`, `58_staging_prep_registration`, `59_staging_prep_profile_completion`, `60_registration_persona_assignment`, `82_admin_users_organizations_read`, `83_personal_data_privacy`, `85_admin_platform_account_preparation`, `87_registration_data_sync`, `90_showroom_phone_auth`, `91_account_entry_allowed` (all `_test.sql`), plus `a2/phone_identity_a2_local.test.mjs`, `pgrst_pre_request_hook_api_test.mjs`, `registration_username_lease_concurrency_test.sh`, `sec/{design_probe,signup_authority,signup_concurrency_stress}.test.mjs`. Test 14 asserts the service_role grants (`users.birth_date`, `users.locale`); test 116 asserts `ck_users_birth_date_range`. Action: replace with `hasnt_*` absence tests, retire lease concurrency script and its CI step, renumber carefully (numbers 116-118 already doubled on main; main runs to 124). Status: CONFIRMED.

## 7. False positives to keep

| Item | Why it stays |
|---|---|
| `auth.scim_users.user_name` | Supabase-managed SCIM |
| `auth.sessions.user_agent` | Supabase-managed |
| Internal phone alias `p<digits>@craftsman-login.aladdin.invalid` and `profiles.phone_e164` | sign-in route for 638 Production phone accounts |
| HTML `autoComplete="username"` on the login identity field | semantic HTML; fix only if wrong |
| Columns/words containing `age` (for example `page`, `image`) and unrelated `birth` text | match semantics, not substrings |
| Provider metadata keys (`preferred_username`, `user_name`) | none exist; do not add stripping |
| `public.users.locale` | kept; remains the only service_role-updatable column in test 14 |
| `profile.username_set` audit action name | allowlist must still accept historical rows |
| Historical migrations and ADR/decision text | frozen; annotate, do not rewrite |

## 8. Docs: annotate versus freeze

**Annotate, do not rewrite (add a superseded/Phase 1 note):** [ADR-0025](../../decisions/ADR-0025-one-field-sign-in-whatsapp-sign-up.md) (and ADR-0026), `docs/decisions/DECISION_LOG.md`, `docs/frontend/*` (`auth-password-preview`, `entry-auth-methods`, `installer-phone-auth`, `legal-pages`, `m4-frontend-reality-audit`, `showroom-v2-reference-alignment`), `docs/admin/*` (`ADMIN_IMPLEMENTATION_BACKLOG`, `ADMIN_USERS_ORGS_READ_AUDIT`, `ADMIN_USER_ORG_OPERATIONS`, `PLATFORM_ADMIN_ACCOUNT_PREPARATION`, `PRODUCT_DECISIONS_REGISTER`), `docs/architecture/ARCHITECTURE_GUIDE.md`, `docs/product/PRODUCT_DIRECTION_GUIDE.md` (lines 71-74, 366, 385, 396; requires owner approval and change-history entry). **Edit when the app work lands (follow-ups, not in PR-0):** `CLAUDE.md` lines 46-47 (sign-in label) and `PRODUCT.md` lines 65-66.

**Frozen:** `docs/security/*`, `docs/operations/*` logs and runbooks (append only), applied migrations, `docs/decisions/ADR-0027-r2-id-keys-and-backups.md` unless its text is touched by the change.

## 9. OPEN summary

D22 identity_data cleanup mechanism; D23 final `pg_proc` scan; S12 incidental matches; S15 password-reset/redirect paths; Playwright per-file relevance; L3/L4 legal; audit_log redaction approval; external copies and immutable backups; Semgrep coverage; locked-out phone-only accounts.
