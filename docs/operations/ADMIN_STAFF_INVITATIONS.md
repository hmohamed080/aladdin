# Admin Staff invitations (first-assignment path for pure platform staff)

Status: implemented on branch `feat/admin-staff-invitations-20261105`, stacked on `feat/whatsapp-otp-admin-settings-20261103` (PR #136). **Not applied to any hosted database, not deployed.** Acceptance only; Production is untouched.

## 1. Why

`public.admin_staff_assign_role` (20260929100001) manages only people who already hold an Admin assignment; `app.admin_require_manageable_target` refuses everyone else ("onboarding a brand-new staff member is the Invitation sub-phase"). That guard is **unchanged**. This feature is the dedicated first-assignment path: an authorized inviter issues a single-use, expiring invitation bound to a verified e-mail; the invitee registers or signs in and explicitly accepts; acceptance re-validates everything in one transaction.

## 2. Pre-implementation compatibility checks (read-only, 2026-11-05)

| # | Check | Finding |
|---|---|---|
| 1 | Account-creation trigger with no audience/persona metadata | `app.handle_new_user()` (identity_core, the only definition; 20261021090006 only revokes execute) inserts `public.users (id, locale)` and `public.profiles (user_id, display_name)`. It reads only `display_name`/`full_name`/`locale`. No persona or audience is required or created. Other `auth.users` triggers (installer alias guard, contact e-mail claims, phone sign-up authority) are inert for a normal e-mail sign-up. |
| 2 | `primary_account_type` nullable? | Yes. `20260814090001_account_persona_decoupling` dropped `NOT NULL` and the default; the column means "personal persona state only". A fresh account has it NULL, which `app.admin_prepare_platform_account` treats as "no persona" (strict mode). |
| 3 | Consent receipts | The marketplace flow requires the `terms`, `privacy` and `pilot` consents at sign-up (form fields `consent_*`) and records them after e-mail verification with `record_consent`. Staff registration requires and records the same three. |
| 4 | Age / birth date | `registrationSchema` requires an adult birth date (`parseBirthDate`). Staff registration reuses the same rule through `staffRegistrationSchema` (same module, same helpers). |
| 5 | Registration state and redirects | A new account is `pending_verification`; `my_registration_state()` returns `consent_pending`/`account_type_pending` until it is `active` or has an active membership, and `postSessionRedirect` then sends it to `/auth/finish-registration` or `/onboarding`. `resolveActiveLanding` sends admin staff to `/admin` first. After activation, `needsAccountBasics` would have asked staff for a phone, location and specialties: staff are now exempt (tested). `/auth/staff-invitation` is allowed in `sanitizeNext`, `postSessionRedirect` and `entryLandingPath`, like `/auth/invite/`. Middleware only forces sign-in for `/b2b`, `/admin`, `/home`, `/onboarding`. |
| 6 | RBAC compatibility | `admin_actor`, `admin_rank_of`, `admin_permissions_of`, `admin_can_wield_role`, `admin_clean_reason`, `record_audit_event`, `admin_prepare_platform_account` are used unchanged. `admin_rank_of` already excludes suspended/deactivated users (so a suspended inviter has rank 0 and no permissions). The unique active-assignment index and the last-Super-Admin guard are untouched. |
| 7 | Hosted Acceptance function definitions | **Not verifiable by this session** (no authorized read access to the hosted database). The effective definitions follow from the migration chain (the only later migration that mentions these functions, `20261021090006`, changes grants, not bodies). Owner read-only check, when convenient: `select md5(pg_get_functiondef('app.admin_require_manageable_target(uuid)'::regprocedure));` and compare with the same query on a fresh local database. Nothing in this feature depends on the hosted body differing from the repository. |

No material incompatibility was found.

## 3. The journey

1. A Super Admin (or an Administrator, for roles strictly below their rank) opens **Admin Staff → Invitations**, enters the invitee's e-mail, a role and a reason. `super_admin` is not invitable in v1.
2. The page shows the one-time link **once**. v1 delivery is manual (secure channel of the inviter's choice); no e-mail provider is introduced. The design leaves a single seam for automated delivery (see section 6).
3. The invitee opens the link. `GET /auth/staff-invitation/<token>` moves the token into an httpOnly, SameSite=Lax cookie scoped to `/auth/staff-invitation` and redirects (303, `no-store`, `Referrer-Policy: no-referrer`) to the **tokenless** `/auth/staff-invitation`. The token is never again in a URL, `next` parameter, redirect or client state.
4. New person: **Create staff account** (`/auth/staff-invitation/register`): e-mail (must equal the invited address), name, password, birth date, consent, Turnstile; the same 6-digit e-mail code as the marketplace. No account type, no username, no onboarding. Existing account: normal sign-in with `next=/auth/staff-invitation`.
5. The invitation page shows the role and a masked address and, for the matching signed-in person, an explicit **Accept**.
6. `staff_invitation_accept` runs in one transaction and the person lands on `/admin`.

## 4. What acceptance checks (all inside the database)

Row lock on the invitation; pending and unexpired; the caller's **confirmed Supabase Auth e-mail** equals the invited address and is not banned; the caller is not the inviter; the inviter's **current** authority (rank, `admin_staff.manage`, the role still active, platform-scoped, not `super_admin`, still wieldable); the caller does not already hold the role; dedicated-staff eligibility through `app.admin_prepare_platform_account_core` (confirmed e-mail, not banned/suspended, **no persona, no active membership**; a pending account is promoted to active and audited with `source = staff_invitation` plus the invitation id, an active one is left as is, anything else is refused as `account_not_eligible`). Before any activation the caller must hold receipts for the CURRENT terms, privacy and pilot documents (`staff_invitation: consent_required` otherwise; nothing is written and the invitation stays pending). Then the assignment, consumption and audit rows are written together. A replay by the same person is idempotent; by anyone else it fails closed.

## 4a. Review follow-ups (2026-11-05)

**Consent is enforced by the database, not by the app.** `verifyStaffSignUp` now checks the `record_consent` result and retries once; a persistent failure never undoes the verified session, it only means the receipts are missing. `staff_invitation_accept` refuses any caller without all three CURRENT-version receipts (the same rule `my_registration_state` applies to the marketplace), so a partial or interrupted registration can never receive authority. `staff_invitation_lookup` reports the caller's own `consent_complete`; when it is false the invitation page shows a **consent step** (explicit checkbox, then `record_consent`, then the receipts are re-read before success is reported) instead of the Accept button. Recovery paths: (a) registration interrupted after e-mail verification: sign in, open the link, consent step; (b) recording failed: same; (c) already accepted: unaffected (replay is idempotent). The marketplace flow (`auth-password-preview.ts`) is unchanged and remains best-effort, as before.

**Activation provenance.** `app.admin_prepare_platform_account(uuid,text)` used to hard-code `source = dba_platform_prepare`. It now delegates to `app.admin_prepare_platform_account_core(user, reason, source, invitation_id)`: the source is a closed two-value allow-list (`dba_platform_prepare`, `staff_invitation`), the invitation id must accompany the invitation source and only it, every strict check (confirmed e-mail, not banned/suspended, no persona, no active membership) runs for both sources, and neither function is executable by any client role. The two-argument helper keeps its signature, grants and audit shape (test 85 is unchanged). An invitation-driven activation is audited as `account.platform_prepared` with `source = staff_invitation` and `invitation_id`, in the same transaction as the assignment.

**Staff-only Account Basics exemption.** `needsAccountBasics` skips the screen only when `loadIsAdminStaff` (the `admin_my_access` RPC) reports staff; a read error returns false, so the normal checks run. A marketplace account (no Admin assignment) is unaffected, and a test asserts it is still asked. The exemption also applies to the existing Super Admin account.

**Retention: `invited_by ... on delete restrict`.** An account that issued an invitation cannot be hard-deleted while the invitation row exists. That is deliberate (an audit trail that names an inviter must stay resolvable) and matches the rule that staff are never deleted: a hard delete fails with a foreign-key error, so use suspend or disable. Future privacy-safe approach (not implemented; needs its own design and approval): an `app.admin_staff_invitations_anonymize(user_id)` operation that, for accepted, revoked or expired rows only, nulls the invitee e-mail (the column becomes nullable for terminal states), points `invited_by`, `accepted_by` and `revoked_by` at a tombstone user, and records one audit event. Pending rows must be revoked first. Audit rows already hold masked data only.

## 5. Security guarantees (and the tests that prove them)

| Guarantee | Proof |
|---|---|
| The token is never stored (only its SHA-256), never in audit, logs or `next` | pgTAP B2/B3/B5; route and isolation tests; action log-spy test |
| Possession of the link grants nothing | pgTAP E2 (another account refused), E23 (unconfirmed), E24 (address changed) |
| Replay, double acceptance, races | pgTAP E16-E19; `admin_staff_invitation_concurrency_test.sh` (A, B, C) |
| No self-invitation or self-acceptance | pgTAP B14, E28 |
| No privilege escalation; no `super_admin` invitations | pgTAP B8-B10; accept re-checks the inviter's current rank at acceptance (E29, E33) |
| Expired / revoked / used invitations fail closed | pgTAP D5-D7, E26, E27 |
| No marketplace persona, username or onboarding is created | action test (no `onboarding_select_account_type`, `pending_registration_*`, `profile_set_username`; signUp metadata keys) |
| `admin_require_manageable_target` is not weakened | pgTAP F1/F2 |
| No authority without current consent receipts; recovery works; no partial acceptance | pgTAP G1-G11; action tests (retry, recovery, mismatch); entry-screen tests (en/ar) |
| Activation provenance is accurate and the preparation core is not a bypass | pgTAP G12-G20 (and the unchanged test 85) |
| The table is closed to all client roles; exact EXECUTE grants | pgTAP A1-A8; permission manifest `20261105090001.json` |
| Isolated from WhatsApp OTP, D1 and the Worker | static isolation test; no Worker/D1/frontend-binding file changed |

## 6. Delivery seam for later (not implemented)

Automated e-mail delivery needs an approved transactional provider and a separate security review for any wider rollout. The seam: the invite function already returns the one-time token to the **server action**; a future `deliverStaffInvitation(email, link)` step would run in that action immediately after `admin_staff_invite` succeeds, using the approved provider. No table, function or page changes are needed.

## 7. Migration, deployment dependencies, rollback

The step-by-step Acceptance readiness checklist, preflight queries and precise rollback plan are in [`ADMIN_STAFF_INVITATIONS_ACCEPTANCE_READINESS.md`](ADMIN_STAFF_INVITATIONS_ACCEPTANCE_READINESS.md); the summary below is kept for orientation.

* **Migration `20261105090001_admin_staff_invitations.sql`**: additive; one closed table, six public functions, two internal helpers, three audit actions appended to `ck_audit_action_known` (reads the live constraint; composes with `20261103090001` in either order). Permission manifest `supabase/permissions/20261105090001.json` (8 new functions, 2 anon-callable: `staff_invitation_lookup`, `staff_invitation_registration_check`).
* **Order of application**: `20261103090001` (PR #136) before this one on any database that has not applied both (the new migration only requires the audit constraint to exist).
* **Hosted rollout (each step needs separate approval)**: apply the migration to Acceptance (preflight: only this migration pending, permission gate), deploy the Acceptance frontend through the existing Preview workflow, then run the QA procedure.
* **Rollback**: do **not** assume an old frontend version. Immediately before any deploy, read the current Acceptance frontend version with `wrangler deployments list --name aladdin-frontend-preview` and record it. (Observed 2026-11-05 while preparing this PR: `45db2715-d9f9-4951-8210-0f63446de2cc`, 100%.) Roll back by `wrangler rollback <recorded version>`; that version already carries the WhatsApp OTP Preview functionality because it is the version being replaced. The migration is additive and safe to leave in place; to disable the feature entirely, withdraw pending invitations (audited) and, if required, ship a forward-fix migration that revokes EXECUTE on the six functions.

## 8. QA on Acceptance (after approvals)

1. Super Admin: **Invitations** → invite QA Administrator and QA Moderator (two addresses you control). Copy each link once.
2. In separate browser profiles: open the link, create the staff account, enter the e-mail code, accept.
3. Administrator profile: `/admin/whatsapp-otp` shows usage and status, no limits form, no connection probe button.
4. Moderator profile: `/admin/whatsapp-otp` is denied.
5. Do not initialize limits, send WhatsApp messages or change `WHATSAPP_DELIVERY_ENABLED`.

## 9. Deactivating or removing staff (never delete)

Use the existing audited controls on **Admin Staff**: **Remove role** (`admin_staff_unassign`) and **Disable** (`admin_staff_set_disabled`, reversible). Withdraw any pending invitation on the Invitations tab. Prefer suspending temporary QA accounts until audit and retention requirements are reviewed. Auth accounts, invitation rows and audit records are never deleted by this feature.
