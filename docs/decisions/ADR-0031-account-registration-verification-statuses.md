# ADR-0031 — Account, Registration and Verification are three separate statuses; two organization trust levels; revocation; one account per chosen type

**Status:** Accepted (owner decisions, 2026-11-22) · Implementation is staged and each step needs its own owner GO before it touches Acceptance or Production. Nothing in this ADR is applied anywhere hosted.

**Refines:** the account/organization/workspace model in `CLAUDE.md` and [`PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md) (one person = one user ID; an Organization is not a user; the workspace is derived). It changes no rule there; it removes a UI/registration side effect (a personal account created next to a business) and names three states that were being mixed.

## Purpose

Admin pages show "Status", "Personal verification" and a profile percentage next to each other, and they disagree: a person with a 100 % profile and an approved verification can still read "pending verification". The cause is that one column (`users.status`) carries two different facts, and that the organization side has two trust flags with similar names. This ADR separates the facts and fixes the vocabulary before any code moves.

## Current decision

### 1. Three statuses, never mixed

| Status | Question it answers | Source | Values |
|---|---|---|---|
| **Account Status** | May this account act? | `users.status` | active · suspended · deactivated |
| **Registration Status** | How far did the person get in sign-up? | derived (today `my_registration_state()`; the Admin gets a per-user version) | email not confirmed · consent pending · account type pending · access ready · active |
| **Verification Status** | Did an Admin vouch for this person or business? | `verifications` (+ organization flags below) | not requested · submitted · under review · needs more information · approved · rejected · revoked |

- **Active is automatic.** An account is active from creation unless an Admin suspends it. There is no "send for review" or "request activation" step. Verification and public listing stay separate and are decided by an Admin.
- **Active never bypasses sign-up.** Active does not skip email confirmation, consent or account-type selection. Those are Registration Status and keep gating entry.
- **The legacy "pending verification" user status ends as an operating state** (staged, see Rollout). Until then the UI says "did not finish registration", never "pending verification", for a user.
- `users.is_verified` (a legacy column: 0 of 34 accounts on Acceptance, ignored by the UI) is removed in the last stage.

### 2. Two organization trust levels, one visible badge

| Level | Name shown | Meaning | Database |
|---|---|---|---|
| 1 | **Approved** (معتمدة) | An Admin approved the organization's application. It is active and listed. | `organizations.is_verified` + `status = 'active'` |
| 2 | **Commercially verified** (موثّقة تجاريًا) | An Admin reviewed the commercial documents. | `organizations.business_verified_at` |

- The public directory and every public surface show **only the highest level reached**, one badge. Level 2 also shows which document types were verified and when (`commercial_register`, `tax_card`, `national_id`, `lease_or_ownership`, `other`).
- The public badge was already driven by level 2 (migration `20261021090002`, the database column is still *named* `is_verified` there). The Admin directory reads level 1 under the same word, so the same organization read "verified" to the Admin and "unverified" to the public. After this ADR the two words differ and the Admin shows both levels.

### 3. Revocation

- **Revoking a verification removes the verification and everything public that depends on it, for every account type.** It does not suspend the account (suspension is a separate Admin action).
- A written reason is mandatory. The owner is notified through the notification-template system (new templates, editable at `/admin/notification-templates`).
- **Level 1 (approval) revoked:** the organization returns to "pending verification" and leaves the directory. New unauthorized activity stops, including new selling. Existing orders, quotations and transactions are kept and stay readable.
- **Level 2 revoked:** only the commercial badge is removed.
- Verified persons (Engineer, Craftsman, Contractor, Sales Team) lose the verified state and any public listing that was granted with it.

### 4. One account per chosen type

- Sign-up creates the type the person picks among the nine (Showroom, Supplier, Manufacturer, Importer, Craftsman, Sales Team, Contractor, Engineer, Personal) and nothing else. Choosing a business type no longer produces a separate personal account next to it.
- Technically the person is still one user ID. A business is an Organization with an owner membership, created in the same step. The rule "one person = one user ID; no second login for another business" is unchanged.
- To add another business the owner uses the same login, fills the new business's missing data, and the new organization goes through its own review. Each organization is verified separately. The person switches between organizations (the existing work-context switch; it is not persona switching).
- **Verification attaches to the right subject:** Showroom, Supplier, Manufacturer, Importer → the organization; Craftsman, Sales Team, Contractor, Engineer → the person; **Personal → identity verification** (a future paid public badge, like other platforms, is a later product decision and out of scope here).

### 5. Admin surfaces

- Approve (✓) is available on a Users or Organizations row **whether or not the owner asked for verification, and whatever the profile completion**; it is hidden once the subject is verified. Reject and Revoke are the other actions. For a business-type user the row action opens that user's organization (one organization: directly; several: the list).
- "Verifications" and "Review Center" show the same queue (verifications, Sales referrals, Network referrals). They become one Review Center, and the old page is removed only after every function, permission, log and filter is proven to exist in the new one.
- Notification templates cover verification rejected, verification revoked and account suspended in addition to the six Marketplace templates, and the templates page is grouped by area instead of one long list.

## Rationale

The owner reads the Admin as one connected system. The investigation (code and live Acceptance definitions, read-only, 2026-11-22) found: `my_registration_state()` already gates entry without `users.status`; `activate_personal_account` runs only inside two onboarding terminals; admin approval (`apply_account_upgrade`) never touches `users.status`; the Admin "Pending" tab puts every unfinished registration in with real requests (25 of 34 accounts have no account type at all); and the Admin and public pages used one word for two organization levels.

## Rollout (each step its own PR and its own owner GO)

| # | Step | Needs a migration |
|---|---|---|
| 0 | This ADR | no |
| 1 | Admin shows Registration Status separately; "Pending" tab driven by verification requests only; user wording "did not finish registration" | function-only |
| 2 | Approve rules (without request, hidden when verified, organization routing) | yes |
| 3 | Revocation, with its notification templates; grouped templates page | yes |
| 4 | "Approved" / "Commercially verified" labels and badges everywhere; rename the misleading `is_verified` output | yes |
| 5 | Merge Verifications into Review Center after a feature-parity checklist | no |
| 6 | End `pending_verification` as an operating state; remove `users.is_verified` | yes |

Conditions for step 6 (owner, 2026-11-22):
1. `my_registration_state` is changed first and every legacy bypass built on `users.status = 'active'` is removed before the default changes or any backfill runs.
2. Active does not allow skipping email confirmation, consent or account-type selection.
3. The Craftsman "send profile for review" button stops being a condition for activation. Sign-up completes normally; verification and public listing stay separate and decided by an Admin.
4. The backfill keeps each account's real registration state and never activates a suspended or deactivated account.
5. Before step 6, a full impact audit of every account function and permission, with regression tests.

## What is deferred

The paid public badge for Personal accounts; a registration-flow change so that choosing a business type stops creating a personal-side record (designed here, built after step 4); the exact wording of the new notification templates; whether verified persons keep a public listing after revocation of a business (not affected: persons and organizations are independent).

## Related

[ADR-0030](ADR-0030-site-wide-media-upload-policy.md) (media limits and notification templates share the admin-editable pattern) · migration `20261021090002_business_verification.sql` · migration `20261115090002_admin_initiated_verification.sql`.
