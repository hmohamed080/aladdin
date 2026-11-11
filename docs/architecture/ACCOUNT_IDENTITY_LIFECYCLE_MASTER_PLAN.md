# Aladdin — Account, Identity & Lifecycle Master Plan

**Document ID:** ALD-ARCH-ACCOUNT-LIFECYCLE-001  
**Version:** 1.6 (backup evidence reconciled to snapshot `aladdin-acceptance-20261108T094450Z`; function-only M1 no longer needs a fresh backup (tested forward-fix pinned); fresh backup stays mandatory before M2/M3/Auth cleanup/audit redaction; media and M1 stay separate gates; supersedes 1.0 to 1.5 in place, all retained in the change log)  
**Date:** 2026-11-10  
**Status:** Approved product direction; P0 IN PROGRESS and P1 IN PROGRESS (PR-0 documentation, PR-1 compatibility migration and the combined PR-2/PR-3 application PR #173 under review); nothing applied to any hosted environment; P2-P6 HOLD  
**Document owner:** Aladdin product owner  
**Repository home:** `docs/architecture/ACCOUNT_IDENTITY_LIFECYCLE_MASTER_PLAN.md` (added by PR-0, a reviewed documentation-only PR). Companion documents: [`docs/operations/account-identity/`](../operations/account-identity/README.md)  
**Execution priority:** **PHASE 1 ONLY — completely remove application Username and Date of Birth.** All other phases remain **ON HOLD** until Phase 1 is accepted and authorized separately.

> **Operator instruction:** This document is the durable plan, decision record, execution checklist, retention register, and evidence index. It is not permission to mutate Production. Preserve a chronological change log and add links to PRs, tests, and evidence as tasks are actually completed. Do not mark boxes complete just because a plan or a PR exists. On each work session, read this document first. No secret values, personal data dumps, OTPs, tokens, or passwords may be placed in this file or its evidence.

## 0. Quick start for the implementation agent

**Execute now:** Phase 1 (`P1.1`–`P1.8`) only: a complete end-to-end removal of *application-managed* `username` and date of birth (`birth_date`, `birthDate`, `birthday`, DOB aliases) from user-facing UI, authentication/onboarding workflows, project-owned database structures, stored personal data, metadata, APIs, tests, translations, and living documentation. Keep necessary Supabase-managed system fields untouched. Retain all existing account identities, business records, secure phone-login aliases, and authentication functionality.

**Do not execute now:** Admin password changes, self-pause, user/admin deletion, lifecycle schema redesign, data erasure, R2 cleanup, business account anonymization, organization archiving, or any related destructive operations outside the explicitly approved Phase 1 cleanup. These are specified in later sections for future execution only.

**Delivery model:** Coordinator + specialist subagents in isolated worktrees, discovery and architecture sign-off first, reviewed PRs, automated security/performance tests, Acceptance verification, then a *separately authorized* Production rollout.

**Meaning of `[x]`:** a reviewer has verified a linked artifact/evidence; not simply “agent says done.”

### Progress board

| Phase | Description | State | PR(s) / evidence | Release approval |
|---|---|---|---|---|
| P0 | Baseline, scope, inventory & decision tracking | [ ] IN PROGRESS (PR-0 under review; audits done 2026-11-10, awaiting reviewer verification) | PR-0 (this PR); [impact inventory](../operations/account-identity/P1-IMPACT-INVENTORY.md); [evidence index](../operations/account-identity/P1-EVIDENCE.md) | Required before edits |
| **P1** | **Remove application Username and Date of Birth** | **[ ] IN PROGRESS — PR-0, PR-1 (#171) and the combined application PR #173 (contains #172) under review; nothing merged or applied** | PR-0, PR-1 (#171, compat migration M1), #173 (combined PR-2 + PR-3; #172 superseded); release strategy and Acceptance checklist in 3.10 and 3.11; [migration design](../operations/account-identity/P1-MIGRATION-DESIGN.md); [PR matrix](../operations/account-identity/P1-PR-CONFLICT-MATRIX.md); [compat matrix](../operations/account-identity/P1-COMPAT-MATRIX.md); [audit_log redaction design + local proof](../operations/account-identity/P1-AUDIT-LOG-REDACTION-DESIGN.md); [Auth metadata scrub findings](../operations/account-identity/P1-AUTH-METADATA-SCRUB.md); [evidence](../operations/account-identity/P1-EVIDENCE.md) | Required for Acceptance and Production |
| P2 | Self-deactivation and secure reactivation | [ ] HOLD | TBD | Not granted |
| P3 | Self-service deletion, 30-day grace, business retention | [ ] HOLD | TBD | Not granted |
| P4 | Admin password management and delegated RBAC | [ ] HOLD | TBD | Not granted |
| P5 | Admin deletion: standard and immediate | [ ] HOLD | TBD | Not granted |
| P6 | Lifecycle reconciliation, retention reporting, compliance & full release | [ ] HOLD | TBD | Not granted |

---

## 1. Goals and non-negotiable rules

1. **Data minimization:** application Username and DOB are unnecessary; remove both from every account type and user journey. Age-policy removal is **conditional on legal eligibility review**; do not conflate deleting DOB with a conclusion that minors may use all account types.
2. **Single authority:** centralize identity, authorization, account state and sensitive operations. Reuse Aladdin's existing Supabase Auth, SQL/RLS/RBAC, server authorization, and Cloudflare/R2 services; avoid extra services or per-screen policy forks.
3. **Account deletion ≠ deleting all business history:** after deletion, credentials and unneeded personal attributes are erased; relevant business transactions may be preserved under a documented legal/business basis, access policy and end date. **Soft delete must not be a loophole for perpetual personal-data retention.**
4. **No unsafe cascades:** do not delete an Auth user while business-data foreign keys could cascade-delete orders, history or audit records. Preserve referential integrity intentionally.
5. **No orphan media:** personal media must eventually be removed only through reviewed, ownership-verified workflows; organizational/legally retained media must not be removed just because a user is deleted.
6. **Strict security:** server-side permission checks; no client-controlled actor/target authority; protected secrets; step-up verification; rate limiting; CSRF-safe state changes; fail closed; audit trails free of secrets.
7. **Fast critical paths:** no heavyweight deletion scans or R2 operations during login, middleware, or ordinary page loads. Use indexed state checks and background jobs for future lifecycle processing.
8. **Safe releases:** forward-only reviewed migrations, compatibility windows, testable rollout, read-only Production inspection before authorization, evidence, rollback/forward-fix plans. Never rewrite applied historical migrations.
9. **Mobile-compatible:** designs must support future mobile applications via the same server APIs/policies, including user-initiated deletion requests.
10. **Explicit checkpoints:** no deployment, schema changes on hosted resources, purge or merge is implicitly approved by adopting this document.

## 2. Product decision register — 2026-11-10

| ID | Decision | State |
|---|---|---|
| D-01 | Completely eliminate application Username (UI, flows, login, DB, APIs, metadata). Login is email or phone. | **APPROVED** |
| D-02 | Completely eliminate birth date from account registration/storage; remove historical stored DOB in app-owned locations. | **APPROVED** |
| D-03 | Remove blanket 18+ rule **if legally permissible**. Legal review decides eligibility per account type and jurisdiction; no DOB collection by default. | **CONDITIONAL** |
| D-04 | A user can temporarily deactivate their own account, with Facebook-like behavior: personal public presence hidden; data and shared history retained. | **APPROVED DIRECTION**; exact module matrix pending |
| D-05 | Reactivation requires login plus independent verification using a verified identity channel. Admin suspension cannot be bypassed. | **APPROVED** |
| D-06 | User-initiated deletion has 30-day grace. The user can cancel their own request during grace after identity verification. | **APPROVED** |
| D-07 | Admin-initiated standard deletion has 30-day grace; **only an authorized admin** may cancel that request. | **APPROVED** |
| D-08 | Admin may alternatively select immediate deletion (skip grace, not safety/retention checks). | **APPROVED** |
| D-09 | Super Admin has default permissions for admin password management and deletion and may explicitly delegate them through existing RBAC. | **APPROVED** |
| D-10 | Account deletion preserves justified business/ERP/CRM history; remove unnecessary registration identifiers, personal fields and access credentials. | **APPROVED** |
| D-11 | Re-registration with the old email/phone is allowed **once final identity deletion releases them**. It creates a new identity; no automatic restoration of historical access or business data. | **APPROVED** |
| D-12 | Owner of a multi-member organization must transfer ownership before final deletion. Submission of deletion request is allowed immediately. | **APPROVED** |
| D-13 | Sole owner: archive organization (logical/soft-delete); prevent new transactions; allow narrowly authorized handling/closure of existing obligations; retain relevant records. | **APPROVED** |
| D-14 | Retain real names only on specific legally required invoices/documents, with need-to-know controls and defined retention; elsewhere remove/anonymize personal identifiers where justified. | **APPROVED** |
| D-15 | Do not indiscriminately remove old orders, conversations, reviews and transactions; assess each data class and counterparties' rights. | **APPROVED** |
| D-16 | Future admin operations require step-up auth and independent server-side RBAC/target protection. | **SECURITY REQUIREMENT** |
| D-17 | Prioritize finishing Username/DOB work **before** new lifecycle/password/deletion features. | **APPROVED — EXECUTION GATE** |

### 2.1 Owner decisions added 2026-11-10 (v1.1)

| ID | Decision | State |
|---|---|---|
| D-18 | Application usernames are **fully retired**: username sign-in, settings/profile surfaces, DB columns, functions and historical data. Login is email or phone only. | **APPROVED** |
| D-19 | Date of birth is **fully removed** for all collection methods (email, phone, OAuth, staff invitation) and all account types, including stored values. | **APPROVED** |
| D-20 | Age restriction: prefer removal if legally permissible. Until legal verification, **preserve the necessary age restriction WITHOUT storing DOB**. Evaluate a minimal self-attestation interim ("I confirm I am 18 or older") including OAuth and staff registration. **Never silently weaken** the restriction. | **APPROVED DIRECTION; interim mechanism pending legal and owner sign-off** |
| D-21 | Existing accounts: run an **aggregate read-only audit**; no account may lose access without a safe recovery path. | **APPROVED; audit performed 2026-11-10 (see 3.6)** |
| D-22 | Historical data: remove app usernames and DOB including Auth metadata; identify embedded copies; perform **controlled redaction without destroying audit integrity**. | **APPROVED; audit_log redaction mechanism needs separate owner approval (see 3.7)** |
| D-23 | Legal documents: update Privacy Policy and Terms; **no automatic re-acceptance solely for removing unnecessary fields**; identify any material change that does need re-acceptance. | **APPROVED; re-acceptance mechanics to verify** |

**D-20 status (v1.2):** the 18+ self-attestation is a **PROPOSED INTERIM requirement pending legal and owner approval**, not an approved mechanism and not a legal conclusion. No wording in this plan means eligibility protection is dropped: until legal records a decision (D-03), Acceptance and Production must not ship unrestricted account creation; PR-2 ships the attestation or an explicitly approved alternative. Open details: exact wording, where it is recorded (inside the Terms agreement line, or a new `consent_type`, which is an enum and needs a migration), re-acceptance mechanics. See [P1-MIGRATION-DESIGN.md section 8](../operations/account-identity/P1-MIGRATION-DESIGN.md) and [P1-COMPAT-MATRIX.md B6](../operations/account-identity/P1-COMPAT-MATRIX.md).

**PR hold (v1.2):** #128 and #129 are recorded as **HOLD** (not merged, not modified). After Phase 1 they are reworked without username dependencies (#129 `admin_view_craftsman_profile` reads `p.username`) and relabelled to migration timestamps `>= 20261112...`, because deployed history ends `20261107090006`, M1 is `20261110090002` and M2/M3 are `20261111...`.

**Owner constraints recorded 2026-11-10:** do not close, modify or merge unrelated PRs without approval; nothing is deployed or applied to hosted environments; no merge to `main` without approval; PR-2..PR-5 do not start until PR-1 compatibility and the blockers in 3.9 are reviewed.

**Policy decisions not yet signed off:** exact retention durations and jurisdictional legal bases; account-type eligibility without DOB; special-case removal of content from communications/reviews; detailed Facebook-like visibility by module; whether particularly sensitive admin deletion needs a second independent approval; exact purge SLA for retained backups; treatment of open disputes and holds. Track these as open decisions, not invented defaults.

## 3. Grounded repository and database baseline

**Verification date:** 2026-11-10 (v1.1 corrects the v1.0 numbers). **Code source:** `hmohamed080/aladdin`, `main` at `1b00ff4`. **Hosted DB:** read-only metadata/count inspection of Production (`kkpkgjrweysgvhvkhzun`) and Acceptance (`nxossqhdfltcqdwvbewi`), reported by read-only audit subagents and labelled as such; this PR did not touch any hosted resource. These are snapshots, not claims that every branch or pending PR is merged. Re-inventory at implementation time.

**Hosted migration state (v1.1):** Production and Acceptance are both at **207 applied migrations ending `20261107090006`**. The "4 pending" notes in PR #154 and `migration-policy-reviewed.json` are stale. The md5 of the 12 audited function definitions is identical across both environments.

### 3.1 Confirmed project-owned columns (both environments)

| Table | Fields subject to Phase 1 review/removal |
|---|---|
| `public.users` | `birth_date` |
| `public.profiles` | `username`, `username_normalized` |
| `app.pending_registrations` | `username`, `username_reserved_at` |
| `auth.users.raw_user_meta_data` | JSON `birth_date` key (stored data, not a standalone column); no alternate DOB keys and no `username` key found |
| `auth.identities.identity_data` (provider `email` rows) | Copy of the `birth_date` key (2 Production / 11 Acceptance): CONFIRMED by count; cleanup mechanism OPEN |
| `public.audit_log.metadata` | key `username` on action `profile.username_set` (860 / 20) |
| `public.reserved_usernames` | Entire table may become obsolete; dependency and ownership review required |

**Do not modify:** `auth.scim_users.user_name` (Supabase-managed SCIM), `auth.sessions.user_agent`, arbitrary unrelated columns containing `age`, other provider/system metadata, or internal phone login aliases used to authenticate legacy/phone accounts. Match field semantics, not wildcard string replacement.

### 3.2 Snapshot counts (corrected 2026-11-10; not account-level exports)

| Metric | Production | Acceptance |
|---|---:|---:|
| `public.profiles` rows | 976 | 23 |
| `public.profiles.username IS NOT NULL` | 855 | 18 |
| `public.profiles` without username | 121 | 5 |
| `public.users.birth_date IS NOT NULL` | 4 | 13 |
| Auth accounts with `birth_date` key in `raw_user_meta_data` | 2 | 11 |
| Auth accounts with `birth_date` key in `auth.identities.identity_data` (provider `email`) | 2 | 11 |
| Auth accounts with `username` key in Auth metadata | 0 | 0 |
| `app.pending_registrations` rows | 0 | 0 |
| `public.reserved_usernames` rows | 20 | 20 |
| `public.audit_log` rows whose metadata has key `username` (all are `profile.username_set`) | 860 | 20 |
| `public.audit_log` total rows | 3267 | 165 |

**v1.0 numbers superseded:** v1.0 listed Acceptance `username` 16, `birth_date` 11, Auth metadata DOB 10 and omitted identities, audit_log, reserved_usernames and profile totals. The values above replace them.

**Checked with no hits (counts only):** `notifications`, `organization_activity_events`, `sales_activities`, `verifications`, `points_ledger`, `saved_searches`, `branches.public_identity`, backup tables, WhatsApp OTP tables, storage object metadata, `auth.audit_log_entries`, SCIM tables; no provider `preferred_username` / `user_name` keys.

**Never interpret these counts as a complete personal-data inventory.** Other JSON, logs, external systems, histories, files, uploads and search replicas need separate checks (backups: see 3.8). Counts may change before migration. Label: read-only audit, subagent-reported, awaiting reviewer verification.

### 3.3 Database functions already discovered mentioning affected concepts (12 per environment)

`app.lock_username(text)`; `app.normalize_username_for_uniqueness(text)`; `app.profile_completion(uuid)`; `app.username_lease_interval()`; `app.username_leased_by_other(text,uuid)`; `public.admin_user_detail(uuid)`; `public.admin_users_directory(...)`; `public.my_registration_state()`; `public.pending_registration_consume()`; `public.pending_registration_save(...)`; `public.profile_set_username(text)`; `public.username_available(text)`.

Also investigate: `ix_pending_registrations_username_lease`, `uq_profiles_username_normalized`, related constraints/leases, `ck_users_birth_date_range`, `ck_profiles_username_*`, views, grants, policies, triggers, other SQL references and application callers. Do not drop a function that is still required by an active client or by a pending branch.

### 3.4 Confirmed code hotspots (not exhaustive)

- Signup form/schema: `frontend/src/features/auth-password-preview/sign-up-form.tsx`, `password-policy.ts`, `birth-date-select.tsx`, `username-check.tsx`.
- Main signup + OTP: `frontend/src/server/actions/auth-password-preview.ts`; `frontend/src/server/auth/phone-sign-up.ts`.
- Staff invitation signup: `frontend/src/server/actions/staff-invitation.ts`, `frontend/src/features/staff-invitation/staff-register-form.tsx`.
- OAuth and registration-state routing: `frontend/src/server/auth/entry-oauth.ts`, `frontend/src/server/queries/registration.ts`, `/app/auth/finish-registration`, `/app/onboarding`.
- Username lookup and editing: `frontend/src/server/actions/sign-up.ts`, `frontend/src/lib/identity/username.ts`, `frontend/src/server/identity/username-change.ts`, `frontend/src/lib/supabase/admin-server.ts`.
- Sign-in supports a username branch: `frontend/src/server/actions/auth-password-preview.ts`, current `resolveSignInEmail(...)` implementation in `frontend/src/lib/supabase/admin-server.ts`.
- Public/admin/profile/settings surfaces: scan all `frontend/src` including preview settings, directory/profile reads, public profile routes, admin user directory/details, and all locales.
- Types, tests and legal copy: `frontend/src/types/database.types.ts`, `frontend/src/lib/i18n/messages/*`, `frontend/src/features/legal/content.ts`, `frontend/e2e/*`, `supabase/tests/*`, `docs/*`, `CLAUDE.md` and architecture/decision docs.
- DB migrations to *read for lineage, not edit once applied*: `20260924090001_username_identity.sql`, `20260924090007_registration_state_access_ready.sql`, `20261028090001_sign_up_birthday_and_phone_codes.sql`, `20261028090003_registration_username_lease.sql` and later related migrations.

**Critical finding:** username is tied to the registration `username_pending` state, signup availability checks/leases and login resolver. DOB is validated for normal, phone and invited-staff signup, inserted into Auth metadata and copied into `public.users`. Merely removing inputs will break registration.

### 3.5 Security/performance baseline — not verdict of vulnerability

Hosted Supabase advisors reported on 2026-11-10: `function_search_path_mutable` 9; executable `SECURITY DEFINER` function warnings for `anon` 11 / `authenticated` 330; `auth_leaked_password_protection` 1; unindexed FKs 122; multiple permissive RLS policies 37 (Production). These alerts require triage; counts do **not** equal confirmed exploits. Do not expand Phase 1 into a blanket refactor, but report any directly impacted critical finding. Reference: https://supabase.com/docs/guides/database/database-linter

### 3.6 Confirmed findings: existing-account stranding audit (aggregate, 2026-11-10)

Of 873 accounts that currently hold a username (855 Production / 18 Acceptance):

| Sign-in path available | Production | Acceptance |
|---|---:|---:|
| Confirmed real email only | 20 | 0 |
| Phone + password alias account only | 638 | 3 |
| Email + phone | 5 | 13 |
| Confirmed email + OAuth, no phone | 192 | 2 |
| OAuth only | 0 | 0 |
| **Stranded (no remaining path)** | **0** | **0** |
| Unconfirmed real email | 0 | 0 |
| Alias accounts lacking `phone_e164` | 0 | 0 |
| Accounts with no password (OAuth users) | 191 | 2 |

Findings:

- No account is stranded by removing username sign-in. **Not checked:** locked-out or unknown passwords on phone-only accounts.
- **638 Production accounts rely solely on the phone resolver path** (`resolveSignInEmail` via `profiles.phone_e164` to the internal `p<digits>@craftsman-login.aladdin.invalid` alias). That path must stay untouched. It does not check `phone_verified_at` (2 verified / 655 unverified in Production); this is existing behavior, recorded, not changed by Phase 1.
- Users whose only memory of their login is the username lose that hint. This is a UX and communication item (message that sign-in is by mobile number or email), not a stranding.

### 3.7 Confirmed findings: audit_log and historical username copies

- `audit_log` is protected by triggers `audit_log_no_update` (`app.guard_audit_actor_deletion`, allows only `actor_user_id` set to null for a deleted user) and `audit_log_no_delete`. No bypass, GUC or redaction helper exists.
- `app.record_audit_event('profile.username_set')` writes `{username}` into metadata. The allowlist `ck_audit_action_known` must keep `profile.username_set` so existing rows stay valid.
- Options: (1) leave rows; (2) reviewed one-shot migration `UPDATE public.audit_log SET metadata = metadata - 'username' WHERE action = 'profile.username_set'` with the trigger relaxed only inside that transaction through a narrowly scoped, documented exception, a pgTAP proof that all other updates remain forbidden and a count-only audit event (for example `audit.username_redacted`); (3) tokenise (weaker).
- **Option 2 is the approved design** (owner, 2026-11-10; D-18, D-22). **Hosted execution is NOT approved**: it needs explicit per-environment approval and a restore-verified backup first. The design (single transaction, original guard restored byte for byte, no trigger disabled) and its recovery plan are in [P1-AUDIT-LOG-REDACTION-DESIGN.md](../operations/account-identity/P1-AUDIT-LOG-REDACTION-DESIGN.md); the draft SQL and tests live under `docs/operations/account-identity/drafts/` (never auto-applied). **Local proof (2026-11-10): 39 of 39 assertions pass** (username key gone, every other column and key identical, row count unchanged, other UPDATE/DELETE stay blocked, token does not persist, idempotent re-run); see [P1-EVIDENCE.md](../operations/account-identity/P1-EVIDENCE.md). That is local evidence, not hosted evidence.

### 3.8 Confirmed findings: code, state machine, age gate

- Username is a **sign-in method** (one field "Mobile number, username or email", ADR-0025). Classifier `lib/auth/sign-in-identifier.ts`, the `u:` rate-limit key, `resolveSignInEmail` in `lib/supabase/admin-server.ts` and `server/actions/auth-password-preview.ts` must change together. Sign-in must stay enumeration-safe: non-email, non-phone input returns the same `invalidCredentials` after the same padding and CAPTCHA, with no new message.
- `my_registration_state()` returns `username_pending` when `profiles.username` is null (introduced `20260924090007`; redefined by `20260924090008/10/11`, `20260930090001`, `20260930100006`, `20261021090006`, `20261105090001`). `access_ready` depends on the stored username. UI routing on it lives in `server/queries/registration.ts`, `app/onboarding/{page,account-type,complete}`, `app/onboarding/username`, `auth/finish-registration`, `entry-oauth`, `complete-profile-card`.
- `pending_registrations.username` is NOT NULL with `ck_pending_registrations_lease_shape` and a lease index; `pending_registration_save(uuid,text,activity_audience_kind,text,int)` is `service_role` only; `consume()` returns `table(username,audience_kind,audience_value)` to `authenticated`.
- Birth date is written by: email `signUp` `options.data` (`auth-password-preview.ts` ~L332), `verifyOtp` `saveVerifiedBirthDate` (~L525), `staff-invitation.ts` L120/161, `phone-sign-up.ts`, and `admin-server.ts saveVerifiedBirthDate` to `users.birth_date`.
- **18+ is enforced only in application code** by `parseBirthDate` / `MINIMUM_SIGN_UP_AGE` in `password-policy.ts` (email twice, phone, staff). The database has only `ck_users_birth_date_range` (>= 1900). **OAuth has no age gate today.** Removing DOB therefore removes the only age control unless D-20 interim attestation lands.
- Interim proposal (a PROPOSED INTERIM requirement for PR-2, pending legal and owner sign-off; not approved): a required, server-enforced self-attestation "I confirm I am 18 or older" in all sign-up schemas and in OAuth finish-registration, recorded (if approved) through existing consent plumbing, with no DOB. Privacy `content.ts:46,149` and Terms `:474` reworded; `LEGAL_UPDATED_AT` bumped. Whether the version bump forces re-acceptance is **to verify** (owner: no automatic re-acceptance for removal alone).
- No public username URLs exist (`/p/[profileId]` is id-based); `backend/` and edge have no references; only `en.ts` and `ar.ts` locales exist.
- Security: `username_available` is the only anon-granted username function (no visible rate limit: unverified); `profile_set_username` is `authenticated`; lease helpers are revoked; `admin_users_directory` / `admin_user_detail` search and return username (`20261021090003`, permissions reconcile `20261021090006`). Any redefinition must re-assert grants and `search_path=''`.
- Gates that run on a Phase 1 change: `ci.yml` (frontend typecheck/lint/vitest/build/worker tests, migration-policy, docs), `supabase-rls.yml` (db reset, lint, `scripts/migration-permission-gate.mjs`, pgTAP, concurrency scripts including `registration_username_lease_concurrency_test.sh`, which must be retired), `phone-signup-security.yml`. **No Semgrep configuration exists in the repo** (OPEN: does it run as a GitHub app or org ruleset?). The perf harness is `scripts/perf` (pgbench + pgss); there is no EXPLAIN harness for the admin directory, so baselines are needed.

### 3.9 Open-PR matrix, M1/M2/M3 plan, risks and unresolved blockers

**Open-PR matrix (summary; full detail in [P1-PR-CONFLICT-MATRIX.md](../operations/account-identity/P1-PR-CONFLICT-MATRIX.md)).** Verified by `git cherry` / `merge-base` / `merge-tree`; PR state alone proves nothing.

| PR(s) | Finding | Phase 1 risk |
|---|---|---|
| #116 #120 #121 #122 #124 #125 #126 #127 #136 | Heads are ancestors of `main` (0 commits ahead): open but already in `main` (stale PRs). Only unmerged remainder: #116's tip holds `20261102090001_phone_code_budget_and_verified_proof.sql`, not on `main` (superseded). Do not base on them. | Low; housekeeping needs owner approval |
| #117 | Docs only, clean | None |
| #128 | **HOLD.** Base `main`; migration `20261101090001_verification_apply_reviewer_gate.sql` not on `main`; no username/birth touch | Medium: out-of-order timestamp and pgTAP number clash |
| #129 | **HOLD.** Stacked on #128; migrations `20261101090001/2/3` not on `main`; `admin_view_craftsman_profile` returns `p.username` and calls `app.profile_completion` | **High**: merge-tree conflicts with `main` in `auth.ts`, `auth-sign-out.test.ts`, pgTAP 41/85 and `AGENT_WORK_LOG`; must be reworked and must not depend on username before M3 |
| #130 | CI validation only, conflicts | Never merge |
| #131 #134 | Validation only; #134 has stale registration copies and unique migrations `20261102090001_phone_authority_send_budget`, `20261103090002_request_and_verification_media` | Do not merge |
| #149 #159 #168 | Low risk (#159 docs only, touches the same workflow as #146) | Low |
| #146 | Conflicts with `main`; its hosted-acceptance spec may sign in by username (check) | Medium |

pgTAP numbers 116-118 are already taken on `main` (tests run to 124), so #128/#129 test files clash by prefix. No open head has a migration `>= 20261108`, so M1-M3 do not collide by name, but #128/#129 migrations (`20261101...`) sort **before** M1-M3: out-of-order apply problem. Resolution (HOLD; after Phase 1 relabel to `>= 20261112...`) needs the owner's go when the hold is lifted and was not done. **Recommended order:** #128/#129 on HOLD, M1, app release, Auth-metadata scrub, M2, M3, then update #159 / #146 / runbooks.

**Migration plan (summary; full spec in [P1-MIGRATION-DESIGN.md](../operations/account-identity/P1-MIGRATION-DESIGN.md)).**

| Step | Content | Reversibility |
|---|---|---|
| M1 `20261110090002_registration_stop_username_dob_compat` (PR #171, implemented) | Compatibility only, **function revisions with no DDL**: `my_registration_state` drops only the `username_pending` branch; `profile_completion` drops the username criterion (denominator 4 to 3); `admin_users_directory` drops only the username search term (still emits the stored `username` key). `pending_registrations` needed no DDL (NOT NULL already dropped in `20261028090003`, lease check already admits NULL/NULL); `pending_registration_save/consume` unchanged (the app passes `p_username: null` explicitly); `admin_user_detail`, `username_available`, `profile_set_username` untouched (M2/M3). No drops, no CASCADE. Old and new app both work. | Forward-fix by `CREATE OR REPLACE` of previous definitions (note in PR-1, not a migration) |
| App release (PR-2/PR-3) | Remove username/DOB from UI and server; age attestation per D-20 | Standard release rollback |
| Auth-metadata scrub | Script via Auth Admin API `updateUserById` (removes the key from `raw_user_meta_data`, verified locally); never SQL on `auth.users`; counts-only evidence; `identities.identity_data` is **not** cleaned by any supported API (verified locally): owner decision | Not reversible except from backup |
| M2 `20261111090001_registration_username_dob_cleanup` | Data erasure and function/grant removal; audit_log redaction only with owner approval | Not reversible except from backup |
| M3 `20261111090002_registration_username_dob_drop` | Redefine `admin_user_detail`, `admin_users_directory`, `pending_registration_save` and `consume` first (PL/pgSQL does not block a column drop), then drop columns, indexes, constraints, `reserved_usernames`, `normalize_username_for_uniqueness` in dependency order, no CASCADE | Not reversible except from backup |

**Risks:** stranding (none found, residual unchecked case above); loss of the only age control; OAuth ungated until attestation ships; audit-integrity damage from redaction; partial-deploy window where old app calls dropped functions; out-of-order migrations from #128/#129; lock waits on `profiles`/`users` during DROP COLUMN; enumeration regression in the sign-in classifier; stale docs/tests; unknown Semgrep coverage.

**Unresolved blockers (owner/legal/engineering):**

1. Legal sign-off on age policy and the attestation wording; re-acceptance mechanics.
2. Owner approval of audit_log redaction option 2 (or alternative).
3. `auth.identities.identity_data` copy of `birth_date` (2 Production, 11 Acceptance): **answered locally** - `updateUserById` does not clean it and no supported API does ([P1-AUTH-METADATA-SCRUB.md](../operations/account-identity/P1-AUTH-METADATA-SCRUB.md)); the owner must choose: accept as a documented residual, an owner-approved surgical write rehearsed on a restored snapshot, or vendor support.
4. #128/#129: recorded as HOLD; the owner confirms the hold and, later, the relabel to `>= 20261112...`.
5. Restore-verified backup before M2.
6. `username_available` rate-limit status (unverified); Semgrep coverage (unverified).
7. Locked-out/unknown-password phone-only accounts (not checked).
8. Whether `DROP INDEX CONCURRENTLY` is permitted by the migration policy (OPEN).
9. Where the age attestation is stored (Terms line vs a new `consent_type` enum value) and its wording (legal).
10. M3 design gap found 2026-11-10: functions that still read the dropped columns must be redefined first ([P1-COMPAT-MATRIX.md B5](../operations/account-identity/P1-COMPAT-MATRIX.md)); closed in the design, to be implemented with M2/M3.
11. The 13 local permission-gate deviations are **resolved as a local CLI/image artifact** (CLI 3.0.0 image vs the repo pin 2.110.0; the gate passes with the pin locally and in CI): [P1-EVIDENCE.md section 5](../operations/account-identity/P1-EVIDENCE.md).

### 3.10 PR stack, combined release PR, release order and open gates (v1.4, 2026-11-11)

**Stack and strategy (v1.4).** #170 (this documentation, PR-0) is independent. The implementation PRs all target `main`: **#171** (M1, DB compatibility only), **#172** (PR-2, auth) and **#173** (PR-3, frontend/admin). **#173 is the combined Auth + Frontend/Admin application PR:** it contains every commit of #171 and #172 (`git rev-list` of #171 and of #172 against #173: 0 commits missing, verified 2026-11-11). Its diff against `main` is 109 files, +28983 / -2013 by `git diff --numstat` (the size is almost entirely the permission snapshot `supabase/permissions/20261110090002.json`, +27279 lines; the only migration is `supabase/migrations/20261110090002_registration_stop_username_dob_compat.sql`).

| PR | Role | Merge on its own? |
|---|---|---|
| #171 | M1, DB-only: function revisions, no DDL. CI green. | **Yes, and first** (recommended): lets M1 reach Acceptance independently, before the app |
| #172 | Auth part of the app change | **No, never alone.** Its `auth-captcha-e2e` fails because the old sign-up specs and UI are incompatible with the server-side `ageConfirmed` (a stacking artifact, confirmed from the job logs by the owner); the fix is in #173. Superseded by #173 |
| #173 | Combined application PR (contains #171 and #172) | Yes, **after M1 has been applied to the target environment** (see release order); it is the only way the app part ships |

**Merge options (owner decides; nothing executed).**

- **Recommended: #171 first, then #173, then close #172.** Merge #171 as the DB-only step so M1 can go through Acceptance on its own, before any app code is on `main`. Because #173 contains #171's commits, merge `main` into the #173 branch afterwards (`git merge-tree` of #173 against the current `main` is conflict-free on 2026-11-11; re-verify after #171 merges), wait for CI on the new head, then merge #173. After #173 is merged, #172 is superseded: **close #172 with a comment pointing to #173** (owner action, not executed by this documentation).
- **Alternative: #173 alone** (#171 and #172 both superseded; close both with a comment). It carries M1 plus the app in one merge, which couples the M1 apply to the app release and removes the independent M1 step. Not recommended.
- **Never:** #172 alone, or #172 before #173.

**What a merge to `main` triggers (verified from `.github/workflows` of the repository, 2026-11-11).**

- **No workflow applies a hosted migration.** A grep of `.github/workflows` for `db push`, `migration up` and `migration repair` finds nothing; the only `supabase db reset` calls run against throwaway local CI stacks. Migrations reach a hosted database only through the owner-run scripts (`scripts/hosted-db/*`, `supabase db push`).
- **No workflow deploys to Production on a push to `main`.** `ci.yml` runs on `push: main` (build, tests, `wrangler deploy --dry-run` only). `cloudflare-production.yml` is `workflow_dispatch` only, runs only from `main` (`if: github.ref == 'refs/heads/main'`), uses the GitHub Environment `cloudflare-production` (owner as reviewer, `main` only; `CLOUDFLARE_PRODUCTION_ENABLED` must be `"true"`, otherwise it only builds and bundles) and is staged: `check` -> `backend` -> `frontend-upload` (new Worker version at 0% traffic) -> `frontend` (goes live). The preview workflows (`cloudflare-frontend-preview.yml`, `cloudflare-backend-preview.yml`, `hosted-acceptance-e2e.yml`) are `workflow_dispatch` plus a push trigger on named feature branches, not `main`.
- **NOT verifiable from the repository (OPEN owner checks before the first merge):** (1) whether the Cloudflare dashboard has Workers Builds or Pages Git integration that auto-builds or auto-deploys on `main`; (2) whether the Supabase dashboard has the GitHub integration or branching that auto-applies `supabase/migrations` from `main`; (3) whether any Vercel project is linked to the repository. If any of the three is on, a merge could reach a hosted environment without the gates below; confirm each is off (or builds only a preview) first.
- **Safe merge/deploy gates (all must hold):** the three dashboard checks above are confirmed off; the PR head is green on every check for its exact SHA; a restore-verified backup and a separate owner GO exist per environment before M1 is applied; the migration history guard and dry run pass (see 3.11); the new app is deployed to an environment only after M1 is applied there; every hosted step needs its own authorization.
- **CI trigger caveats:** workflows trigger only for pull requests based on `main` or `integration/**`; do **not** retarget stacked PRs onto feature branches. `pull_request` CI does **not** trigger while a PR conflicts with `main` (GitHub cannot build the merge ref), so after `main` moves, merge or rebase `main` into the branch before checks appear; "no checks reported" on a conflicting PR is not a pass. Some workflows have path filters (`auth-captcha-e2e`, `showroom-rc2-e2e`), and `supabase-rls` runs on pull requests against `main` only, so a missing check can mean "not triggered", never "passed".

**Release order per environment (Acceptance first, then Production with its own GO; never the new app before M1).**

1. **Backup gate, then M1.** A restore-verified backup (restore test PASS) and an owner approval. Apply M1 `20261110090002` through the repository's documented migration procedure (`docs/operations/MIGRATION_DRYRUN_RUNBOOK_20261108.md`: link to the correct project ref, `migration list` and `db push --dry-run` through `scripts/migration-history-guard.mjs`, `supabase db push --linked`, no `--include-all` unless the dry run demands it, never repair or SQL Editor). **The hosted-db scripts pin the 2026-11-08 state** (`acceptance-gate.mjs`: 203 applied, latest `20261107090002`, pending 090003..090006; `acceptance-apply.sh`: `PRE_CONTRACT=20261107090002`): they must be re-pinned to the live history and to the `main` contract `20261110090001` -> `20261110090002` before use for M1. Read the live history first (read-only) and do not assume that state.
2. **Verify M1:** smoke SQL equivalent to pgTAP `125_registration_stop_username_dob_compat_test.sql` (read-only checks of `my_registration_state` values, `profile_completion` denominator 3, directory search), `scripts/hosted-db/verify-permissions-readonly.sh <acceptance|production> 20261110090002` (SELECT-only; run it first as a baseline against `20261110090001`), and the Supabase security and performance advisors compared with the pre-apply snapshot.
3. **Deploy the new app** to that environment (Acceptance: `cloudflare-frontend-preview.yml` via `workflow_dispatch`, environment `cloudflare-preview`; Production: `cloudflare-production.yml` stages `check` -> `backend` -> `frontend-upload` -> test with the version-override header -> `frontend`, each stage its own approval), then **smoke:** email sign-up + OTP, phone-alias sign-in, OAuth, staff invitation, admin users directory.
4. **Later, per design (not in this release):** the Auth-metadata scrub (gate c), then M2 `20261111090001` (needs a restore-verified backup), then M3 `20261111090002`. **The old app must be gone** (no old Worker version, cached client or preview calling the removed functions) before M3.

**Remaining gates: all OPEN, none executed. A permanent residual of date-of-birth or username data is not accepted silently:** each item needs a recorded owner decision, and any "accept as residual" decision must be written down with an owner, a rationale and an expiry date.

| Gate | Needed decision / owner | State |
|---|---|---|
| (a) Legal approval of the 18+ self-attestation (D-20, proposed interim): wording and storage (Terms line, or a new `consent_type` enum value, which needs a migration) | Legal/owner | OPEN |
| (b) Privacy copy timing | Must **not** claim historical username/DOB are erased before M2 and the gates here have run; PR-3 already rewords it to that rule; legal confirms | OPEN (legal confirmation) |
| (c) `auth.identities.identity_data` `birth_date` copies (2 Production, 11 Acceptance) | `updateUserById` does not clear them ([P1-AUTH-METADATA-SCRUB.md](../operations/account-identity/P1-AUTH-METADATA-SCRUB.md)). Owner picks one: an owner-approved surgical write rehearsed on a restored snapshot, or Supabase support. **Accepting the copies as a residual requires an explicit documented owner decision with an expiry.** Not accepted by default | OPEN, not executed |
| (d) `audit_log` username redaction | Design approved and proven locally; **hosted execution NOT approved**; open: own migration versus a step of M2 ([P1-AUDIT-LOG-REDACTION-DESIGN.md](../operations/account-identity/P1-AUDIT-LOG-REDACTION-DESIGN.md)). Historical usernames stay in `audit_log` until then | OPEN, not executed |
| (e) #128 / #129 | HOLD (not merged, not modified); rework without username dependency and relabel to `>= 20261112...` after Phase 1 | HOLD |
| (f) Permission-gate `upgrade` mode and shell concurrency tests | `supabase-rls.yml` runs `migration-permission-gate.mjs ... upgrade` and the concurrency proofs in CI on the PR; on the #173 head `42d5218d` the CI run `42995730943` logged `PASS atomic migration 20261110090002_registration_stop_username_dob_compat.sql` (upgrade mode) and `PASS 754 exact function permission contracts` twice. They have **not** been run by hand locally on the final #173 head. The gate cannot read a hosted database (it accepts only named local RC2 containers), so the hosted comparison is `verify-permissions-readonly.sh`. Before Acceptance, run the gate locally with the pinned CLI (`pnpm exec supabase`, 2.110.0) on #173 | OPEN for the local hand run and the hosted comparison; CI evidence recorded |
| (g) `database.types.ts` regeneration | Regenerate after M1 is on the hosted database; resolve the `null` cast follow-up | OPEN |

### 3.12 Acceptance preflight (v1.5, 2026-11-11; read-only hosted reads and local work only)

Full procedure: **[P1-ACCEPTANCE-RUNBOOK.md](../operations/account-identity/P1-ACCEPTANCE-RUNBOOK.md)**. Evidence: [P1-EVIDENCE.md](../operations/account-identity/P1-EVIDENCE.md) section 8.

- **Live Acceptance history (read 2026-11-11T10:14Z):** 207 applied, latest `20261107090006`, no gaps (the four 2026-11-07 migrations are already applied; the 203/090002 numbers in earlier docs are history). Repo `main` `2aa365a5` has 208 files, so the pending set is exactly **`20261110090001`** (media ids-only keys). M1 `20261110090002` (#171) becomes pending once merged. Production: same 207 / `20261107090006`.
- **Migration order and OWNER DECISION D1:** `supabase db push` applies every pending file, so the standard M1 push would also apply the media migration. Recommended: media first as its own GO (plan `media`, 207 -> 208, it is Track C step A-ACC), then M1 (plan `m1`, 208 -> 209); alternative one push of both (plan `media+m1`, 207 -> 209) after #171 merges. The re-pinned gate (PR #179) refuses any other pending set.
- **Compatibility evidence (local, pinned CLI 2.110.0):** M1 as the only extra migration on the 207 replay changes exactly three functions (`my_registration_state`, `app.profile_completion`, `admin_users_directory`) and nothing else in the catalog; grants unchanged (753/753 vs contract `20261107090006`); pgTAP 125 plus the eight modified tests: 9 files / 439 tests PASS. Hosted Acceptance's catalog fingerprint equals the local 207 replay (12 of 12 sections), function permissions equal (753, same aggregate hash). Forward-fix SQL restoring the previous definitions is proven (`drafts/P1-M1-FORWARD-FIX-RESTORE-PREVIOUS.sql`).
- **Backup state (corrected v1.6):** the newest restore-verified Acceptance snapshot is `aladdin-acceptance-20261108T094450Z` (backup run 42468447400 PASS, restore run 42469078723 PASS; 167 tables, 2,584 rows, 203 migrations, 9 R2 files; objects still present, bucket has no lock rule). It is a **historical reference, not a current full recovery point**: it predates the four 2026-11-07 migrations and every data change after 2026-11-08 09:44Z. It is sufficient evidence for the **function-only** M1, whose recovery path is the locally tested forward-fix pinned by sha256 in `acceptance-gate.mjs` (PR #179); no redundant fresh backup is required for M1 (the media migration reuses the pinned label). `app.backup_environment` has 1 row (initialized 2026-11-11 12:29Z); schedules are off. **A fresh, restore-tested backup remains mandatory before M2, M3, Auth metadata cleanup, audit-log redaction and any Production step.** The first action needing the owner's authorization is merging #179 and #170 (apply scripts require HEAD = `origin/main`), then the read-only preflight and the separate GO-M (media) and GO-M1 gates (runbook section 10).
- **Auto-deploy checks:** no workflow applies migrations or deploys on push to `main`; Supabase has no branches; no Workers Builds git triggers on four Workers; Vercel team has 0 projects. Dashboard-side Supabase GitHub integration and Cloudflare Pages Git remain owner-confirmed (UNVERIFIED by tooling).
- **PR heads (final read 2026-11-11 ~15:15 UTC, v1.6):** #171 `82accd9cce031e3a516f10f8e2b8c89152e313a7` (7 of 7 checks pass, MERGEABLE/CLEAN); #173 `6f6076571abb73b9be4326ab0e3939dc98a4f5dc` (11 of 11 checks pass incl. `showroom-rc2-e2e` and `auth-captcha-e2e`, MERGEABLE/CLEAN; the earlier `showroom-mvp.spec.ts:419` failure was a hydration-timing flake, hardened in `6f607657`, one passing run is weak proof); #179 `9ba06a57d5677005976ec386b988626cdcbfab28` (7 of 7 pass, draft; recovery-gate change); #170 this documentation PR (its head moves with every docs commit: read it live with `gh pr view 170 --json headRefOid`, expected 7 of 7); #172 `5cd0cbc6` superseded and never merged alone. All four PRs are still **draft**; marking ready and merging are owner actions. M1 version and file unchanged (`20261110090002`, sha256 `83bde2643a371fd5...`). Details: P1-EVIDENCE section 8.3.

### 3.11 Acceptance checklist (ordered; **nothing executed**; boxes stay unticked until a reviewer verifies evidence)

"Auth." marks a step that changes a hosted environment, `main` or a PR and therefore needs the owner's separate authorization. Read-only hosted steps still need access to the hosted project and are marked too. Record each result in `P1-ACCEPTANCE-REPORT.md` (counts and results only, no personal data).

- [ ] 0. Owner confirms the three dashboard integrations (Cloudflare Git builds, Supabase GitHub integration/branching, Vercel) are off for `main`. *(owner dashboard check)*
- [ ] 1. Reviewer verifies #170 (this documentation) and merges it. *(Auth.: merge)*
- [ ] 2. Re-read heads and CI for #171 and #173 per exact SHA (`gh pr view N --json headRefOid`, `gh pr checks N`). *(read-only, no authorization)*
- [ ] 3. Merge #171 (M1, DB only) after review. *(Auth.: merge to `main`)*
- [ ] 3b. **Owner decision D1:** media migration `20261110090001` first as its own step (recommended) or both in one push (3.12, runbook section 1). *(owner decision)*
- [ ] 4. Backup evidence: reuse snapshot `aladdin-acceptance-20261108T094450Z` (restore PASS, historical reference) for the function-only media migration and M1 (M1 relies on its pinned forward-fix); **no fresh backup for M1**. A fresh restore-tested backup is mandatory before steps 15 (Auth scrub), M2, M3, audit redaction, Production. *(read-only evidence; fresh backup run needs Auth. only for those later steps)*
- [ ] 5. Read-only Acceptance preflight: `supabase migration list --linked`, `node scripts/migration-history-guard.mjs`, `supabase db push --linked --dry-run`; the dry run must list exactly `20261110090002` plus whatever the live history shows pending (any unexpected row: stop). The scripts are re-pinned in PR #179 (plans `media`, `m1`, `media+m1`); run `bash scripts/hosted-db/acceptance-preflight.sh <plan>`. *(Auth.: hosted read with the DB password)*
- [ ] 6. Pre-apply baselines: `bash scripts/hosted-db/verify-permissions-readonly.sh acceptance 20261110090001`, advisor snapshot, row counts (`profiles`, `pending_registrations`, `storage.objects`, `media_storage_locations`). *(Auth.: hosted read)*
- [ ] 7. Apply M1 to Acceptance: `bash scripts/hosted-db/acceptance-apply.sh --plan m1 --sha <origin/main sha>` (no backup label; pinned forward-fix checked; no `--include-all`, no repair, typed confirmation). Only after the separate media step (3b/GO-M) and the #171 merge. *(Auth.: hosted migration; separate GO)*
- [ ] 8. Verify M1: history shows `20261110090002` applied and none pending; `verify-permissions-readonly.sh acceptance 20261110090002` passes; smoke SQL (`my_registration_state` values, `profile_completion` denominator 3, username search no longer matches in the directory); advisor diff. *(Auth.: hosted read)*
- [ ] 9. Merge `main` into the #173 branch (conflict-free expected), push, and wait until every check on the new head is green. *(Auth.: push to the PR branch)*
- [ ] 10. Merge #173. *(Auth.: merge to `main`)*
- [ ] 11. Close #172 with a comment pointing to #173. *(Auth.: PR close and comment)*
- [ ] 12. Deploy the merged `main` to the Acceptance preview Worker through the documented path (`cloudflare-frontend-preview.yml`, `workflow_dispatch`, environment `cloudflare-preview`); record the deployed version id. *(Auth.: deploy)*
- [ ] 13. Manual smoke on Acceptance: email sign-up + OTP, phone-alias sign-in, OAuth, staff invitation, admin users directory, onboarding without username/DOB, attestation shown (subject to gate a). *(Auth.: uses test accounts)*
- [ ] 14. `hosted-acceptance-e2e` (`workflow_dispatch`, environment `acceptance-e2e`; read-only specs; `pnpm --filter frontend e2e:acceptance:headed` is the real-Turnstile variant). *(Auth.: workflow dispatch)*
- [ ] 15. Auth metadata scrub on Acceptance: dry-run first (counts only), then apply via `updateUserById`, then verify; `identity_data` copies per gate (c). Needs the script and a restore-verified backup. *(Auth.: hosted write; separate GO)*
- [ ] 16. Write `P1-ACCEPTANCE-REPORT.md` with build commit, applied migrations, test artifacts, counts, reviewer and `GO / NO-GO`. M2, M3 and Production are separate later requests, each with its own GO, backup, rehearsal (`production-rehearsal.sh` for Production) and the same order.

---

## 4. PHASE 1 ONLY: complete removal of Username & DOB

### 4.1 Required resulting behavior

**Registration:** user may register using supported verified email or phone flows and existing OAuth providers without selecting a username or providing a birth date. Staff-invitation registration must also work. Preserve password policy, CAPTCHA/Turnstile, phone verification single authority, OTP consent, account-type selection, organization membership, and anti-abuse checks unrelated to username/DOB.

**Sign-in:** input labels and validators support **email or mobile number only**; no username alias lookup. Keep phone account's **internal non-deliverable Auth email alias** if needed to reach the existing Auth user: internal alias ≠ public username. Never expose the internal alias or a service role client to the browser. Reject unsupported username strings safely without enumerating whether they used to exist. Keep password recovery functional for all supported identity methods; do not invent SMS recovery if unavailable.

**Onboarding:** no `username_pending`, username setup/availability request, birthday prompt, username profile-completeness score, autogenerated username, username repair flow, or dependency on username for `access_ready`. All existing user personas including invited staff and old accounts must be able to continue onboarding. Existing verified accounts must not regress to pending.

**Profiles/settings/admin/public:** no username or birth date rendering, storage, editing, search/sorting/filtering, URL identity, response payload or public copy where unnecessary. Use safe canonical stable account/profile IDs for routing; audit deep links and determine redirect/retirement behavior for obsolete username links. **Do not secretly preserve usernames as permanent aliases** to satisfy redirects; log the compatibility/product trade-off first.

**Data:** complete approved removal of project-owned columns, indexes, constraints, helper routines, username reservation tables (if truly unused), and live DOB stored in Auth user metadata. No personally identifiable values in migration logs or test evidence. `auth` schema system-owned tables remain intact.

**Legal:** change statements that still promise DOB collection or an unconditional 18+ signup control only after legal/product review of eligibility. **Do not remove age eligibility based solely on frontend convenience.** If age gating is legally required, propose a non-DOB, privacy-minimizing legally adequate method and obtain approval before go-live.

### 4.2 Execution checklist (all boxes initially unchecked)

#### P1.1 — Discovery, schema audit and impact report (read-only)

- [ ] Branch/worktree matrix: inspect main, open PRs touching registration/auth/admin/R2, Acceptance and Production applied migration histories; assign a base commit and avoid parallel migration collisions.
  - Status: audit performed 2026-11-10 (read-only, subagent-reported), awaiting reviewer verification / PR-0 review. See [P1-PR-CONFLICT-MATRIX.md](../operations/account-identity/P1-PR-CONFLICT-MATRIX.md). Hosted migration histories compared: both at 207 ending `20261107090006`.
- [ ] Enumerate **all** application DOB/username spellings in TS/TSX, SQL, dynamic SQL, JSON selectors, configs, scripts, i18n, legal, metadata, RPC signatures, RLS, views, tests, examples, backend, Workers and stored/public content.
  - Status: audit performed 2026-11-10, awaiting reviewer verification / PR-0 review. Code/test/i18n/docs occurrences are in [P1-IMPACT-INVENTORY.md](../operations/account-identity/P1-IMPACT-INVENTORY.md); dynamic SQL and later-migration redefinitions remain OPEN there.
- [ ] Enumerate objects and dependencies from `pg_catalog`/`information_schema`: columns, foreign keys, defaults, indexes, `CHECK`, constraints, triggers, functions, views, grants, RLS policies, security-definer callers, generated types and indexes; include `app`, `public`, `auth`, storage-relevant code.
  - Status: audit performed 2026-11-10, awaiting reviewer verification / PR-0 review. The 12 functions, indexes and constraints are listed with a drop order in the inventory; a full `pg_depend` view/policy/trigger sweep is marked OPEN where not performed.
- [ ] Read-only scan of **keys and counts** in user metadata (`raw_user_meta_data`, `raw_app_meta_data`), pending registrations and other JSON columns without exposing actual users' values.
  - Status: audit performed 2026-11-10, awaiting reviewer verification / PR-0 review. Counts in 3.2; the `auth.identities.identity_data` copy of `birth_date` was found by this scan.
- [ ] Audit flows: email signup/verification; phone/WhatsApp signup; OAuth; staff invitation; login; password reset; existing users; incomplete onboarding; public profile and profile edits; Admin views; redirects.
  - Status: audit performed 2026-11-10 for email, phone, OAuth, staff invitation, sign-in and the stranding audit (3.6, 3.8), awaiting reviewer verification / PR-0 review. Password reset, redirects and public-profile paths: see inventory (OPEN rows).
- [ ] Confirm external service/analytics/CRM/export/cache/search/backup copies and determine lawful erasure propagation; never claim an exhaustive audit based on database column-name matching alone.
  - Status: partial audit performed 2026-11-10 (database-side copies, storage metadata, backup tables), awaiting reviewer verification / PR-0 review. External analytics/CRM/search/immutable backups not audited: OPEN.
- [ ] Produce `docs/operations/account-identity/P1-IMPACT-INVENTORY.md` listing every occurrence, owner, planned action, and verification. Identify unavoidable compatibility risks and legal decisions.
  - Status: drafted in PR-0 (this PR); awaiting reviewer verification / PR-0 review.
- [ ] Obtain review of DB migration design before any destructive schema changes; no hosted DDL or data deletion at this stage.
  - Status: [P1-MIGRATION-DESIGN.md](../operations/account-identity/P1-MIGRATION-DESIGN.md) drafted in PR-0, awaiting reviewer verification / PR-0 review. No hosted DDL or deletion performed.

#### P1.2 — Approved contract and migration design

- [ ] Define new signup input contracts, server schemas, field errors and one-field sign-in format (phone/email only). Confirm accepted E.164 normalization and existing phone alias resolution remain unchanged.
- [x] Define `my_registration_state()` without a username-required branch; preserve consent/account type/verification states and existing activation semantics. *Evidence: implemented in PR #171 (`20261110090002`); pgTAP 125 tests 26-34 prove every state and order (56 of 56 pass post-M1, 8 fail pre-M1 by design); PR #171 CI run `42848064753` (`Files=158, Tests=7350 Result: PASS`, `PASS 753 exact function permission contracts`). Local and CI evidence only; reviewer sign-off on PR #171 pending.* See [P1-EVIDENCE.md](../operations/account-identity/P1-EVIDENCE.md).
- [ ] Define behavior for existing accounts with a username only and no verified phone/email. Do not strand them; document a safe recovery/remediation path.
- [ ] Decide treatment of old username URLs/deep links with an explicit incompatibility note; do not keep a hidden username field without approval.
- [ ] Define DOB metadata deletion scope and non-recollection guarantees for OAuth/signup/invitations; document which snapshots/backups are immutable and their retention/expiry process. *Partial: scope, local tests and the `identity_data` finding are in [P1-AUTH-METADATA-SCRUB.md](../operations/account-identity/P1-AUTH-METADATA-SCRUB.md); backup expiry wording and the owner decision on `identity_data` are open, so this box stays unticked.*
- [ ] Record legal/product sign-off for removing 18+ copy/eligibility and updating Terms/Privacy/consent. Mark conditional if not available; do not silently ship unrestricted commercial account creation. *Not available: the 18+ self-attestation is a PROPOSED INTERIM requirement pending legal approval (D-20); box stays unticked.*
- [ ] Produce reviewed migration plan: compatibility-before-cleanup; never `CASCADE` blindly; no rewrite of applied migration files; staged rollback/forward-fix for each step. *Drafted and synced with the real M1 ([P1-MIGRATION-DESIGN.md](../operations/account-identity/P1-MIGRATION-DESIGN.md), [compat matrix](../operations/account-identity/P1-COMPAT-MATRIX.md)); review pending, so unticked.*

#### P1.3 — Compatibility-first backend + database change (local first)

- [ ] Refactor server-side sign-in parser and resolver to phone/email only, preserving existing real user accounts and internal phone aliases.
- [ ] Remove signup username availability/lease dependencies and `username_pending` state via deliberate DB function revisions and server callers. *DB half done in PR #171 (state removed; the lease helpers stay until M2); server callers belong to PR-2/PR-3 (not started): unticked.*
- [ ] Remove DOB inputs, validation, writes and reads from all authentication paths, including staff invitation and OAuth completion.
- [ ] Update admin profile completeness, username-dependent search/sort/filters, public profile queries, API response types and server business logic.
- [ ] Add explicit tests that registration and login succeed with no username/DOB and that data is not re-written by triggers or auth metadata writers.
- [ ] Validate new security-definer/RPC guards, grants, `search_path` and RLS; do not widen anonymous access in the process. *M1 only: pgTAP 125 tests 48-56 and the CI permission gate (753 contracts) pass; later steps still to validate: unticked.*

#### P1.4 — UI and client cleanup

- [ ] Remove fields from signup, staff signup, finish-registration, onboarding, account/profile/admin/settings, completion cards and previews; remove dead username-only pages/actions.
- [ ] Replace relevant labels/placeholders/help/errors in all locales, screen reader labels and onboarding text; keep forms and layout accessible.
- [ ] Remove unused Username helper/component modules and DOB picker only once all imports are gone; preserve any unrelated `autoComplete="username"` attribute if it is needed for a login identity field and semantically appropriate, else change to correct HTML autocomplete.
- [ ] Update product/legal/technical living docs and consent disclosures; preserve historical ADR/migrations as history, annotating as superseded instead of falsifying the record.
- [ ] Regenerate or update typed DB interfaces based on actual final schema and verified source generation procedure.

#### P1.5 — Data cleanup and schema contract (after compatibility verified)

- [ ] Run read-only before-snapshot counts, compare schema and check backups/restore readiness in a safe environment; request explicit approval for each hosted environment write.
- [ ] Ensure frontend/backend deployed versions no longer read/write affected columns before dropping them; Account signup/recovery smoke tests pass on a staging-like copy.
- [ ] Clean DOB user metadata using a supported, auditable **Auth Admin API** or vetted supported procedure; never direct-write Supabase-owned Auth internals casually. Delete only the DOB keys while preserving unrelated metadata and app permission claims.
- [ ] Clean app-owned DOB and username data and retire their columns/indexes/constraints/functions/tables in approved forward-only migrations. Avoid `DROP ... CASCADE` to bulldoze dependencies.
- [ ] Confirm no legacy writers, retries, batch jobs, triggers or unpublished clients recreate removed values.
- [ ] Re-inventory identifiers, indexes, grants, policies, JSON keys and public response surfaces to prove absence. Keep counts/evidence, not raw private values.
- [ ] Define what is excluded (immutable historical backups, Supabase-managed fields) and documented expiry/retention rather than making an untrue absolute “all backups purged” claim.

#### P1.6 — Security, integration and performance verification

- [ ] Tests cover email signup + OTP, phone signup + OTP, OAuth first login, staff invitation, existing email/phone user login, password reset, incomplete registrations, profile view/edit, admin directory, re-auth and onboarding.
- [ ] Tests confirm username is not accepted as a sign-in mode, not required for account completion and absent from APIs/UI; no enumeration of formerly used usernames.
- [ ] Tests confirm DOB is neither collected nor stored in app-owned columns/known metadata paths and legal/consent behavior matches signed-off policy.
- [ ] SQL/pgTAP tests: RLS, RPC grants, privileged functions, absent/retired objects, no hidden dependency; negative tests for unprivileged access and privilege escalation.
- [ ] Test concurrent registrations, username-lease removal races, OTP retries, stale session and account-state transitions; no sign-up deadlock.
- [ ] Baseline and compare critical-path p50/p95 for signup/login, directory, profile, admin users query; inspect SQL `EXPLAIN (ANALYZE, BUFFERS)` on safe fixtures and watch for full scans/regressions.
- [ ] Lint/typecheck/unit/integration/E2E and database tests pass; Supabase security and performance advisors run and **new** warnings triaged (old unrelated warnings documented, not silently waived).
- [ ] Run secret/log leakage checks: no birth dates, usernames, Auth tokens or passwords in new logs, error payloads, analytics or URL query params.

#### P1.7 — Acceptance deployment gate

- [ ] New reviewed PRs, CI passes, approved migration manifest, tested backup/restore path and written rollback/forward-fix.
- [ ] Obtain explicit permission for Acceptance migration and preview deployment; do not rely on a prior unrelated approval.
- [ ] Execute Acceptance-only migration/deploy; rerun automated plus manual smoke checks on real supported auth flows; test cleanup evidence.
- [ ] Record build commit, applied migrations, test artifacts, redacted before/after counts, reviewer and decision `GO / NO-GO` in `docs/operations/account-identity/P1-ACCEPTANCE-REPORT.md`.

#### P1.8 — Production deployment gate (NOT approved by this document)

- [ ] Obtain explicit user authorization for Production schema/data changes and deployment after Acceptance sign-off.
- [ ] Verify Production migration drift, backups, rollout order, externally linked features, metrics and rollback plan just before execution.
- [ ] Deploy compatible application before destructive cleanup; monitor live registrations, login, OTP, auth errors, PostgREST/RLS, latency and query regressions.
- [ ] Execute approved data/schema cleanup, complete post-deployment negative scans, observe defined monitoring window, record evidence, and mark **P1 COMPLETE** only after acceptance criteria pass.

### 4.3 P1 acceptance criteria (release blocker)

- No user/admin/account UI requires or displays Username or DOB.
- No application API, profile public response or first-party export leaks these fields without a separately justified legal exception documented in this project.
- All supported account personas and Auth flows work without them (including legacy phone aliases, staff invitations and OAuth).
- There is no username login mode, pending-username gate, uniqueness lease or Username requirement for account activation.
- Application-owned live schema no longer contains targeted project fields; sensitive DOB keys removed from live Auth metadata with verified safe handling; Supabase-managed system fields intact.
- No regression to RLS, privilege boundaries, CAPTCHA, OTP/rate limits or session-revocation protections.
- No material performance regression beyond pre-agreed budgets; no user data lost other than the **explicitly approved field erasure**.
- Legal/eligibility consequences approved; fully reviewed deployment and evidence/rollback artifacts present.

---

## 5. Future architecture — DESIGN ONLY / implementation HOLD

### 5.1 Conceptual domains (one logical service layer, not a new microservice)

- **Auth identity:** Supabase Auth credentials, providers, email/phone ownership, sessions and MFA. Secrets are never stored in public tables.
- **Business principal:** durable internal UUID for CRM/ERP/audit history, which survives account deletion when retention is justified; not a login credential and not automatically linkable to a new signup.
- **Account lifecycle authority:** a server-side state-machine + protected DB transitions; computes effective status from independently recorded user pause, admin suspension, deletion request and legal/business hold.
- **Retention policy engine:** data-class rules for erase, pseudonymize, retain, defer, archival and eventual purge; backed by a reviewed inventory.
- **Deletion orchestrator:** durable, idempotent jobs with checkpoints, retry and reconciliation, never running heavy work inline with a browser request.
- **Media ownership & cleanup:** reuse R2 upload receipts, verified ownership records, lifecycle cleanup and edge cache invalidation where supported, with special treatment of legal documents and shared media.
- **Admin authorization:** reuse `public.admin_role_assignments`, `app.has_admin_permission(...)`, `admin_my_access()` and app `server/authorization/admin.ts` / `lib/permissions/admin.ts` only. Privileged operations must re-check authoritative DB permissions and target rank/state at execution.

**Important blocker:** currently `public.users.id REFERENCES auth.users(id) ON DELETE CASCADE`. Production schema also has 126 foreign-key references to `public.users` across 93 distinct tables, including restrictive/non-cascading relationships. **Never assume deleting `auth.users` is safe.** A detailed FK redesign/migration or durable distinct principal is required to avoid cascading business-history deletion. No chosen physical model yet. Whichever path is selected must preserve existing business identifiers, audit referential consistency and mobile/client compatibility.

### 5.2 State model — behavioral invariants

Suggested orthogonal dimensions (actual schema subject to design review):

1. Registration: `pending_verification` / `active` as appropriate today.
2. User pause: `not_paused` / `self_paused`.
3. Admin enforcement: `clear` / `admin_suspended` (with immutable case history).
4. Erasure: `none` / `requested` / `grace` / `finalizing` / `retention_blocked` / `completed`, with terminal/non-reversible finalization boundary.
5. Business organization: independent active/suspended/archived obligations state.

**Precedence:** completed deletion > deletion/finalization hold > admin suspension > user pause > ordinary account access. Do not overload existing `suspended` and `deactivated` so that self-reactivation could undo an admin ban. Every transition must be idempotent, server authorized, audited and concurrency-safe, and should retain status history while minimizing identifying data.

**Session handling:** block data access immediately at the central gate, revoke sessions/refresh tokens and ensure already-issued JWTs are rejected for sensitive routes. Reuse existing session-live/`my_account_status` logic, but explicitly test Auth, PostgREST, Storage, Realtime, backend and edge paths; some do not run the PostgREST pre-request hook. Provide a narrowly scoped recovery route for paused/deletion-grace users that cannot access normal application data.

### 5.3 Self-pause and reactivation (P2; HOLD)

- User chooses **Temporarily deactivate account** in Account Settings; reauthenticate using a verified channel and confirm.
- Personal public profile disappears from search/discovery; cannot publish, message anew, transact or manage organizations while paused. Preserve existing messages already delivered to others and transaction history; no blanket deletion of other parties' records.
- Define per-module behavior before execution: profile, products, jobs, reviews, messages, subscriptions, notifications, activity feeds, invitations, referrals, memberships, organization workspaces, uploads and API access.
- Reactivation: sign in through a **restricted** recovery flow + independent verified-channel step-up; restore only the user pause if no admin suspension, deletion-finalization or legal block applies. Audit both operations.
- No account deletion, username/DOB reintroduction, direct edits to admin suspension history or breaking organization ownership changes.

### 5.4 Self-service deletion with 30-day grace (P3; HOLD)

1. User requests deletion from account settings; prove live identity with fresh reauthentication + second factor / verified email or phone method, independent of a mere signed-in UI session.
2. System performs a **read-only obligations/ownership inventory** and shows clear user disclosure: account access stops, 30-day cancellation period, retained business/legal records and why, treatment of organizations and media. Do not block submission merely because ownership resolution is pending.
3. Persist durable request with `actor`, `subject`, origin `self`, created/due timestamps, state/version, retention/hold status and audit **without embedding personal data/password/OTP in logs**.
4. Restrict account, revoke active sessions and disable new activity immediately; maintain only a restricted cancel/status path. Notify the user over a verified channel where feasible.
5. Through day 30, the **user can cancel a self-request** via reauthentication + independent verification. Cancellation of a user request does not lift any unrelated admin suspension.
6. At expiry, mark request non-cancellable, recheck legal holds/ownership/active obligations, then queue erasure/pseudonymization/retention work asynchronously. Do not use raw SQL `DELETE FROM auth.users` as the orchestrator.
7. Remove Auth identities/credentials and release contact uniqueness **only after** safe business-principal separation, dependency reconciliation and deletion finalization. Subsequent same phone/email signup creates a fresh account/UUID and gains no old permissions or order history.
8. Produce privacy-safe completion receipt, retention manifest and a bounded operational audit record. Failures enter explicit retry/blocked states; never falsely show completed.

**Important:** Supabase Auth `deleteUser(..., shouldSoftDelete: true)` is NOT a reversible 30-day deactivation workflow; it must not be used as the grace-period implementation. See https://supabase.com/docs/reference/javascript/auth-admin-deleteuser .

### 5.5 Organizations and commerce obligations (P3/P5; HOLD)

- Multi-member organization: allow owner deletion **request** immediately, but require ownership transfer and a reliable authorized successor before final identity erasure. Handle pending invites, co-owners, staff assignments, Super Admin last-owner protection, disputes, branches and authority scope.
- Sole-owner organization: archive/soft-delete business operational presence, stop **new** transactions/jobs/orders/public listings, prevent new assignments as owner; preserve historic CRM/ERP, mandatory documents and counterparties' ability to view records they legitimately need.
- Existing obligations: special **restricted administrative closure** path with strict audit/permissions; do not let a deleted owner log back in or let ordinary users exploit archive status. Handle outstanding orders, invoices, RFQs, projects, support cases and disputed payments independently.
- Never automatically delete shared organization media, compliance verification documents, invoices or legally required data as a consequence of personal-account deletion.

### 5.6 Admin password management (P4; HOLD)

- Permission: `users.password.manage` seeded for Super Admin; Super Admin may delegate using the existing role editor and no privilege escalation. Validate any limitations from RBAC rank and permission ceilings before implementation.
- Design both (a) force/reset flow sent to the user's verified channel and (b) direct set-new-password for an authorized admin; determine preferred UI emphasis after threat model. Do not expose current password or any reset secret to admin.
- Mandatory fresh step-up, target/actor rank and last-Super-Admin safeguards, rate limiting and append-only audit of actor, target, reason, method, outcomes (never password/token), notification and reliable session invalidation.
- Use server-only narrowly scoped Supabase Auth Admin API; do not let client supply `service_role` or untrusted admin role claims. Consider OAuth-only accounts / no password; avoid account takeover via editing contact channels in same workflow.
- No direct modification of Supabase Auth password hashes via SQL.

### 5.7 Admin account deletion (P5; HOLD)

- Independent permissions: `users.deletion.request` (normal 30-day grace) and `users.deletion.immediate` (skip grace), Super Admin by default, explicitly delegable via existing RBAC, always rechecked on server and DB. **Delegation does not waive target-rank safeguards.**
- Normal admin request: affected account immediately blocked; 30-day grace; **only duly authorized admin** may cancel an admin-created request, even if the user authenticates. User may contact support; cannot silently cancel admin action.
- Immediate admin request: after strong step-up, reason and deliberate confirmation, skip grace and begin finalization **as soon as allowed by obligations, retention and system safety**. It is not an unrestricted SQL hard delete or a guarantee all work finishes synchronously.
- Protect last active Super Admin, actor's own account, equal/higher-rank administrators, ownership and enterprise compliance evidence; decide whether dual authorization is needed before shipping. Use target/actor locks and idempotency to prevent race-based privilege bypass.
- Failed jobs or legal holds result in explicit `manual_review` / `retention_blocked`, not silent partial deletion. Record what was retained and what remains pending.

### 5.8 Data erasure and retention design (P3/P5/P6; HOLD)

**Erasure model:** `DELETE` sensitive fields where not necessary; `PSEUDONYMIZE` business-facing records that require continuity; `RETAIN_RESTRICTED` specific legal/commercial records for documented purpose and limited time; `BLOCK/DEFER` only where lawful hold/obligation applies; `PURGE_LATER` at retention expiry. Replace app-visible name with a non-identifying display such as “Deleted account.” If re-identification is still possible, the resulting data is pseudonymized, not fully anonymous.

**Business tombstone:** minimal non-login internal key + lifecycle/completion status + permitted immutable audit link. Never store email/phone merely to prevent re-registration; never auto-link a newly registered identity to the tombstone based solely on reuse of contact details.

**Media:** preserve legal/transactional documents where justified; remove personal avatar, personal profile cover, non-retained portfolio and variants/cache only after ownership/inclusion checks; account for legacy Supabase Storage (if any) and current R2. Follow the current verified media-delete receipts/journal. No direct bucket prefix purge without owner-qualified inventory, review, and read-back verification.

**Backups/derived copies:** define standard expiry and restoration re-erasure protocol for immutable backups, exports, analytics, search indexes, logs and caches. Never promise immediate physical erasure from historic immutable backups without evidence.

---

## 6. Retention and deletion register (living, auditable)

This table is a **policy draft / engineering inventory**; it is **not** a legal opinion or a final retention schedule. The owner/legal reviewer must approve exact purposes, lawful bases and duration **before P3/P5 release**. Adding new CRM/ERP tables or media types requires adding rows here, with tests for erasure behavior. A retained field may be accessible only to an explicitly named role for a named purpose and limited period.

| Data class / examples | During self-pause | During 30-day grace | After completed deletion (target) | Why / access | Retention duration | Review |
|---|---|---|---|---|---|---|
| Auth password, OAuth links, sessions, recovery tokens | Restrict sessions | Revoke / lock | Erase Auth identity/credentials only after safe FK migration | No business need after completion | None beyond technical/legal necessities, define | [ ] |
| Signup email and phone; verified contact aliases | Keep protected for recovery | Keep for cancellation and mandatory notice | Remove identifiers; allow new registration | Account recovery during grace only | Until completion, exceptions need basis | [ ] |
| DOB, public username, username reservation | **Phase 1 removal** | N/A after P1 | Absent from live app data | No product requirement | Remove in P1; backups per approved schedule | [ ] |
| Personal public profile, avatar, cover | Hide from discovery | Hidden | Remove personal data and personal media/variants | No retained need unless specific hold | Delete on completion + cleanup SLA | [ ] |
| Individual portfolio/certificates | Hidden/frozen | Frozen | Erase unless contractual/legal evidence retention is justified | Ownership-specific review | TBD per class | [ ] |
| Orders, invoices, RFQs, quotations, fulfillment | Retain | Retain/freeze new | Preserve restricted business facts and necessary invoice names | Legal/accounting/counterparty purpose | **TBD by jurisdiction and document type** | [ ] |
| CRM leads/customers/activities and ERP history | Existing obligations only | Restricted | Retain minimum history; remove extra contacts/free-text PII | Documented business continuity only | TBD | [ ] |
| Messages / conversations | Delivered history persists for recipients | Freeze new | Evaluate delete/redact/retain on both parties' rights and records | Case-by-case policy | TBD | [ ] |
| Reviews, referrals, points ledger | Frozen | Frozen | Keep legitimate aggregate/ledger history as needed; suppress identifiable profile | Integrity, disputes, audit | TBD | [ ] |
| Organization memberships / ownership / branch roles | Inactive personal authority | Freeze access | Transfer/close; retain necessary historical actor references | Business and permissions integrity | TBD | [ ] |
| Organization catalog, documents and R2 media | Organization unaffected solely by member pause | Protect transactions | Retain legally/business-necessary org assets; archive sole-owner org | Other members and counterparties | TBD | [ ] |
| Admin action/security logs, abuse prevention evidence | Keep restricted | Keep restricted | Minimum event proof, masked/pseudonymized identifiers where possible | Security, accountability, claims | TBD with purpose & access | [ ] |
| Backups, logs, caches, search/export copies | Normal retention | Normal retention | Erasure propagates where feasible; backups expire and are re-scrubbed on restore | Recovery or operations | TBD, explicit expiry SLA | [ ] |

**Every row of a final retention schedule must eventually include:** `table/field or R2 namespace`, data controller, type of subject, processing purpose, lawful basis, reason retained, precise duration/trigger, visibility/authorized role, archival or encryption controls, delete mechanism, subprocessor/backup impact, legal approval reference, engineering test, last review date. **Do not fill TBD with guessed durations.**

### Example deletion receipt (privacy-preserving; schema to be finalized)

```
request_id: UUID
origin: user | admin
mode: grace_30d | immediate
status: requested | grace | finalizing | retention_blocked | completed | failed_retryable
requested_at: timestamp
grace_until: timestamp | null
completed_at: timestamp | null
auth_identity_removed: bool
personal_data_erased: count/category summary
business_records_retained: count/category summary
media_cleanup: completed | pending | blocked
legal_hold_categories: redacted categorical summary
policy_version: e.g. ALD-ARCH-ACCOUNT-LIFECYCLE-001/v1
```

Actual schema needs safety review: do not embed user email, password, phone, OTP, raw media keys or message contents in receipts. Audit record itself has bounded retention and must not recreate a shadow identity database.

---

## 7. Security, performance and compliance gates (all phases)

### 7.1 Security gate

- [ ] Threat model includes account takeover, admin RBAC delegation abuse, target-ID substitution, replay, CSRF, session/JWT persistence, stale privilege claims, malicious or timed deletion, self-unban, permission rank conflicts, multi-owner races, legal-hold bypass, and orphan-media deletion.
- [ ] Fresh verification for sensitive mutations, short-lived single-use challenge, anti-bruteforce/rate limits, secure audit, verification through owned channel; existing users who only have phone or social identity have an implementable recovery option.
- [ ] Every privileged path checks identity and **current** authoritative permission at execution; `service_role` never leaves server; no policy depends on user-editable JWT metadata.
- [ ] Direct API / RPC and browser tests prove forbidden operations are impossible, including revoked sessions via PostgREST, Storage, Realtime and media edge.
- [ ] Review `SECURITY DEFINER` exposure, search paths, RLS grants/policies, ownership checks and audit integrity specifically for modified code.
- [ ] Test retry/idempotency/concurrency, simultaneous login/reactivation/deletion, transaction boundaries and failure recovery.

### 7.2 Performance gate

- [ ] No per-row N+1 privilege lookups, no new network call on every simple page without justified benchmark, and no broad scans in pre-request hook.
- [ ] Add selective indexes only for measured workflow queries; measure their write cost and inspect explain plans.
- [ ] Heavy lifecycle/media work is queued and retryable, not part of user-facing requests; use bounded concurrency and checkpoints.
- [ ] Establish and record baseline/after p50/p95 login/signup, profile loads, directory and admin pages; define explicit regression budget with product owner before release.
- [ ] Separate historical advisor warnings from new warnings attributable to PRs, with documented remediation owners.

### 7.3 Legal/privacy and mobile-app gate

- [ ] Counsel/product review of Egyptian and any applicable international data-protection requirements and eligibility/age requirements by account type; no implied legal clearance from this document.
- [ ] Terms, Privacy, Data Deletion instructions, consent and user communications accurately reflect retention and cancellation policy; no false promise that all legal/business documents are erased on demand.
- [ ] Future mobile apps include an in-app account-deletion request path and a public web request path as required by applicable app-store policies, and honor the same server-side lifecycle.
- [ ] Support data-subject requests, exemptions, dispute holds and meaningful deletion completion reports without exposing other users' or organizations' confidential information.

## 8. Subagent plan, ownership and merge protocol

**Coordinator (one):** owns scope, task dependencies, worktrees, architectural decisions, migration naming/order, signed-off plan, PR integration and release gates. All subagent findings must link to code/SQL evidence and use `CONFIRMED / INFERRED / OPEN` classifications.

| Agent | NOW (Phase 1) | LATER (on hold) | Output |
|---|---|---|---|
| A — Identity/Auth auditor | Search flows, email/phone/OAuth/staff paths, username & DOB dependencies, legacy login aliases | Admin password recovery | Auth dependency matrix + tests |
| B — Database/security architect | Live schema metadata/SQL dependency audit, design compatibility & cleanup migrations, RLS/grants review | Business principal split, lifecycle jobs | Migration design + pgTAP proof |
| C — Frontend/i18n engineer | Remove fields and repair onboarding/registration/profile/admin UI and translations | Pause/delete screens | UI diff + accessibility tests |
| D — QA/performance engineer | Existing accounts, E2E, concurrent signup, Auth security, baseline metrics | Deletion chaos tests | QA matrix + regression report |
| E — Legal/privacy documentation analyst | Review birthday/age impact; remove stale legal copy only after approval; prepare P1 erasure evidence | Retention schedule, user disclosures | Decision note + policy review |
| F — Data lifecycle & R2 specialist | **Audit only** any accidental references, no media deletion | Retention/cleanup/reconciler architecture | Later-phase retention inventory |

**Coordination rules:** agents may audit independently in parallel. Only **one** assigned owner modifies a particular SQL migration or central auth/RBAC file at a time; share an integration branch or reviewed cherry-picks after tests. Do not let an independent agent deploy to hosted environments. Never run a rewrite of history, cleanup commands, storage deletion or multi-PR blind merges. The coordinator resolves conflicts and re-runs all cross-feature tests after integration.

### P1 suggested handoff sequence

1. Parallel **read-only** A + B + D + E inventory. Coordinator reconciles code/DB drift, signs off the impact report and defines approved migration order.
2. B prepares local compatible SQL revisions while A updates backend contracts; integrate without changing hosted DB.
3. C updates UI/translations; D adds E2E/negative tests and benchmarks; E finalizes legally approved content. A and B resolve call-site and RPC compatibility.
4. Coordinator runs full local tests plus DB permission testing and review; only then Acceptance under separate approval.
5. After Acceptance GO and explicit Production authorization, deploy compatibility-first and finalize cleanup; publish evidence and update this file.

## 9. Required reporting and evidence convention

Suggested repo subtree after approved documentation-only PR:

```
docs/architecture/ACCOUNT_IDENTITY_LIFECYCLE_MASTER_PLAN.md
 docs/operations/account-identity/
   P1-IMPACT-INVENTORY.md
   P1-MIGRATION-DESIGN.md
   P1-TEST-MATRIX.md
   P1-ACCEPTANCE-REPORT.md
   P1-PRODUCTION-REPORT.md
   P2-SELF-PAUSE-DESIGN.md           # future
   P3-DELETION-RETENTION-DESIGN.md   # future
   DATA-RETENTION-REGISTER.md       # future: detailed field inventory
   RELEASE-DECISIONS.md             # future
```

**Status update template (append once per completed task or review):**

```markdown
### YYYY-MM-DD — [P1.x] Short action title
- Status: NOT STARTED | IN PROGRESS | BLOCKED | REVIEW | DONE
- Owner / subagent:
- Commit / PR / migration:
- Environment: local | Acceptance | Production (read-only or changed)
- Changed objects / scope:
- Tests + exact pass/fail summary:
- Security / performance evidence:
- Data privacy impact / before-after counts (no personal values):
- Reviewer / approval link:
- Next gate / rollback or forward-fix:
```

### Status updates (append-only)

### 2026-11-10 - [P0 / P1.1] PR-0 documentation baseline and read-only audits
- Status: IN PROGRESS
- Owner / subagent: Claude Code for product owner (audits reported by read-only subagents)
- Commit / PR / migration: PR-0 (draft, branch `docs/p1-username-dob-plan-20261110`); no migration in this PR (M1 is PR-1)
- Environment: local documentation only; hosted state read-only (Production and Acceptance, both 207 migrations ending `20261107090006`)
- Changed objects / scope: this plan (v1.1), `docs/operations/account-identity/{README,P1-IMPACT-INVENTORY,P1-MIGRATION-DESIGN,P1-PR-CONFLICT-MATRIX}.md`, work log, runtime state, docs index. No code, SQL or migration change.
- Tests + exact pass/fail summary: documentation link check and the other `docs` CI steps run locally; results recorded in the work-log entry.
- Security / performance evidence: none new; baselines still to capture (no EXPLAIN harness for the admin directory).
- Data privacy impact / before-after counts (no personal values): before counts in 3.2; no data changed.
- Reviewer / approval link: awaiting PR-0 review. No checkbox in this document is ticked.
- Next gate / rollback or forward-fix: PR-1 compatibility migration M1 review; owner decisions on the 3.9 blockers; nothing is applied to a hosted environment.

### 2026-11-10 - [P1.2 / P1.5 design] PR-0 sync with PR-1, local proofs, owner-decision findings (W2)
- Status: REVIEW
- Owner / subagent: Claude Code (W2, worktree `aladdin-wt-p1-docs`)
- Commit / PR / migration: PR-0 (#170, draft); M1 is PR #171, migration `20261110090002`; no migration in this PR
- Environment: local only (Supabase CLI 3.0.0 stack; a second stack with the repo-pinned CLI 2.110.0 for the gate check); no hosted write
- Changed objects / scope: design docs synced to the real M1 (what was already true, what changed, what is deferred to M2/M3); #128/#129 recorded as HOLD; audit_log redaction design plus draft SQL and tests under `docs/operations/account-identity/drafts/`; Auth metadata scrub findings; compatibility matrix; evidence index with the permission-gate investigation; age policy wording
- Tests + exact pass/fail summary: audit redaction proof 39 of 39 pass; pgTAP 125 pre-M1 8 fail (intended), post-M1 56 of 56; permission gate: 13 deviations on CLI 3.0.0 (also on `main`), `PASS 753` on the pinned CLI locally and in CI
- Security / performance evidence: findings only (M3 would leave functions reading dropped columns; `identity_data` cannot be cleaned by a supported API; `service_role` EXECUTE on 13 functions comes from newer image defaults); no performance data
- Data privacy impact / before-after counts (no personal values): none; synthetic fixtures only, throwaway users deleted
- Reviewer / approval link: pending; one checkbox ticked with evidence recorded next to it
- Next gate / rollback or forward-fix: owner decisions (audit_log execution, `identity_data`, age attestation, #128/#129 hold); PR-2/PR-3 start only after PR-1 review

### 2026-11-11 - [P1 stack sync] PR-0 sync with the PR stack and new `main` (docs agent)
- Status: REVIEW
- Owner / subagent: Claude Code (docs agent, worktree `aladdin-wt-p1-docs`)
- Commit / PR / migration: PR-0 (#170); M1 `20261110090002` in #171; PR-2 #172; PR-3 #173; no migration in this PR
- Environment: documentation only; hosted state untouched
- Changed objects / scope: renamed M1 references after `main` took `20261110090001`; added 3.10 (stack, release order, CI-trigger caveats, open gates a-e); evidence section 7 with SHAs per PR and CI per check
- Tests + exact pass/fail summary: see P1-EVIDENCE section 7 (only what was verified through `gh`)
- Reviewer / approval link: pending; no new checkbox ticked (no new reviewer-verified evidence)
- Next gate / rollback or forward-fix: owner decisions on gates (a)-(e); merge #171, #172, #173 back-to-back only after review

A checkbox is changed to `[x]` **only** when there is a working link or artifact reference, the reviewer has checked the result, and production/acceptance evidence is not conflated with local tests. Keep unfinished work unchecked and describe reasons. Records of failures and superseded decisions should remain in the history.

## 10. Change log

| Date | Version | Change | Author | Evidence |
|---|---|---|---|---|
| 2026-11-10 | 1.0 | Initial product decisions, DB/code findings, future lifecycle architecture, retention draft, **Phase 1-first gated execution plan**, all checkboxes initially open | ChatGPT drafting for product owner | Conversation; direct read-only GitHub/Supabase inspection |
| 2026-11-10 | 1.1 | Added to repository as PR-0; progress board (P0/P1 IN PROGRESS); decisions D-18..D-23 and owner constraints; baseline corrected with verified 2026-11-10 numbers; stranding, audit_log, code and age-gate findings; open-PR matrix; M1/M2/M3 plan; risks and blockers; P1.1 status notes (no box ticked); status-update entry. All v1.0 phases, decisions and retention content retained unchanged. | Claude Code for product owner | PR-0 + read-only audits (2026-11-10) |
| 2026-11-10 | 1.2 | Synced with the actual PR-1 implementation (M1 is function revisions only; pending_registrations, save/consume and admin_user_detail untouched); #128/#129 HOLD and relabel plan; audit_log redaction design approved / execution not approved with local proof; Auth metadata findings (`identity_data` not cleanable by a supported API); M3 function-redefinition gap; permission-gate deviations explained; age attestation marked PROPOSED INTERIM; one checkbox ticked with evidence | Claude Code for product owner | [P1-EVIDENCE.md](../operations/account-identity/P1-EVIDENCE.md) |
| 2026-11-11 | 1.3 | Merged `main` `d95bb416`; M1 renamed to `20261110090002`; PR stack #171 -> #172 -> #173 and release rules (3.10); gates (a)-(e) recorded as OPEN; CI-trigger caveats; evidence table with exact SHAs (P1-EVIDENCE section 7); no checkbox ticked beyond the one already evidenced | Claude Code for product owner | [P1-EVIDENCE.md](../operations/account-identity/P1-EVIDENCE.md) section 7 |
| 2026-11-11 | 1.4 | Merged `main` (`66a0f0ab`); combined release PR strategy: #173 contains #171 and #172, #172 superseded and never merged alone, #171 first as the DB-only step (3.10); verified merge and deploy triggers (no workflow applies a migration or deploys Production on a push to `main`; Cloudflare/Supabase/Vercel dashboard integrations are OPEN owner checks); release order per environment; gates (a)-(g) restated as OPEN with no silent permanent residual; new 3.11 Acceptance checklist (all unticked, authorization marked); evidence section 7 re-read per exact SHA; no checkbox ticked | Claude Code for product owner | [P1-EVIDENCE.md](../operations/account-identity/P1-EVIDENCE.md) section 7 |
| 2026-11-11 | 1.5 | Acceptance preflight: live Acceptance history 207 / `20261107090006` (pending exactly `20261110090001`); migration order and owner decision D1 (3.12); hosted-db scripts re-pinned in #179; local M1-only dry run (exactly 3 functions changed, pgTAP PASS); Acceptance runbook; backup staleness; auto-deploy checks; PR heads in P1-EVIDENCE section 8; no checkbox ticked | Claude Code for product owner | [P1-ACCEPTANCE-RUNBOOK.md](../operations/account-identity/P1-ACCEPTANCE-RUNBOOK.md), [P1-EVIDENCE.md](../operations/account-identity/P1-EVIDENCE.md) section 8 |
| 2026-11-11 | 1.6 | Backup evidence reconciled: snapshot `aladdin-acceptance-20261108T094450Z` (backup 42468447400, restore 42469078723) replaces `...T060819Z`; existence verified read-only, bucket has no lock rule; historical reference, not a current recovery point; function-only M1 backed by the pinned forward-fix, no fresh backup for M1; fresh backup mandatory before M2/M3/Auth cleanup/audit redaction; `app.backup_environment` initialized 2026-11-11 12:29Z; apply scripts re-pinned (#179 `9ba06a57`); media-before-M1 sequence | Claude Code for product owner | P1-EVIDENCE 8.2; runbook sections 3 and 10 |

## 11. Next action

**Current state (v1.6, backup evidence reconciled, nothing hosted written):** the runbook ([P1-ACCEPTANCE-RUNBOOK.md](../operations/account-identity/P1-ACCEPTANCE-RUNBOOK.md)) is ready; no backup is needed for M1. The first action needing the owner's authorization is merging #179 and #170, then the read-only preflight, then GO-M (media, 207 to 208) and, after #171 merges, GO-M1 (208 to 209). **Previous state (v1.4):** PR-0 (this documentation), PR-1 (#171, M1) and the combined application PR #173 (contains PR-2, #172) are under review; nothing is merged or applied. Next: owner decisions on gates (a)-(g) and the three dashboard checks (3.10), then the ordered Acceptance checklist (3.11). Follow-ups to land with the app work, not in PR-0: update `CLAUDE.md` lines 46-47 and `PRODUCT.md` 65-66; annotate the docs listed in the inventory.

**Original v1.0 immediate agent task:** read this document, start with **P1.1 read-only inventory** and proposed SQL migration plan, use specialist subagents, present impact and legal-decision blockers, then implement **Phase 1 only** in isolated worktrees subject to normal change review. When ready, provide reviewed PR(s), a concise test report, an Acceptance rollout request and updates to the checklist. **Do not begin P2–P6; do not merge/deploy/purge Production without a new explicit authorization.**
