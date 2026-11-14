# Admin edit of users and organizations: decision brief

| | |
|---|---|
| **Status** | Decision brief for the owner. **Nothing is implemented.** |
| **Date** | 2026-11-14 |
| **Scope** | Whether and how platform staff may change a user's or an organization's record. Not View-As (read-only by design, `ADMIN_VIEW_AS_ARCHITECTURE.md`). |
| **Evidence** | Admin writes on `main` today: verify/reject, suspend/restore (reason required), notes, follow-ups, cases, duplicate resolution, roles/staff, points adjust/reverse. **No admin RPC edits a profile or an organization** (`docs/admin/ADMIN_FEATURE_MATRIX.md` audited the idea; it was never built). Schema read from the local database at `20261112090001`. |

## 1. Candidate editable fields

Risk tiers: **L** = presentation/moderation, **M** = identity-adjacent, **H** = takeover or trust-bearing, **X** = never editable by an admin.

**Users** (`users`, `profiles`)

| Field | Tier | Note |
|---|---|---|
| `display_name`, `display_name_ar`, `display_name_en`, `headline`, `bio` | L | Typical moderation fix (abusive or wrong text). Clearing `display_name_confirmed_at` is a re-confirmation trigger. |
| `languages`, `locality_id`, `governorate_key`, `city_key`, `city_custom_name`, `available_for_work` | L | Data corrections. |
| `avatar_media_id`, `cover_media_id` | M | **Remove only** (moderation), never replace or upload as the user. |
| `phone_e164`, `phone_country_iso2`, `phone_national` (and the sign-in email) | H | Account-takeover vector; changes who can sign in and receive OTPs. |
| `primary_account_type`, `is_verified`, `status` | M/H | Not field edits: they already have workflows (account upgrade + verification, suspend/restore). Keep it that way. |
| `username`, `birth_date` | X | Being removed by Phase 1. |
| password, Auth identity, ids, points | X | Points stay a ledger (compensating entries only). |

**Organizations** (`organizations`)

| Field | Tier | Note |
|---|---|---|
| `name`, `name_ar`, `name_en`, `description`, `facebook_url`, `instagram_url`, `tiktok_url`, `website_url`, `locality_id`, `primary_locale`, `timezone` | L | Presentation. |
| `contact_phone`, `contact_email` | M | Public contact surface; abuse risk (redirecting buyers). |
| `legal_name`, `org_type` | H | Verification-bearing: they are what the Verified badge vouches for. |
| `is_verified`, `business_verified_at`, `business_verification_id` | X | Only the business-verification workflow sets them. |
| `status`, `deleted_at` | M | Existing suspend/restore; no hard delete. |
| `slug`, ownership, memberships, logo | M/X | Slug is a public URL (breaks links); ownership and memberships stay with organization governance; logo remove-only. |

## 2. Proposed audit policy (all options)

- **One RPC per subject kind** (for example `admin_user_update_profile`, `admin_organization_update`), `security definer`, allow-listed fields only, writing the change **and** its audit row in one transaction. No generic "update any column".
- **Audit row** (`admin.user.edited`, `admin.organization.edited`): **who** (actor id and role/rank), **when**, **subject**, **reason**, and **old -> new per changed field**. Contact identifiers are stored **masked** (for example last 3 digits, email domain), never in full; media only as "removed". An edit with no effective change writes nothing.
- **Reason required** (same rule as suspend): non-empty, trimmed, bounded length; optionally a short fixed code plus free text for reporting (matches the open rejection-reason taxonomy decision, PD-005).
- **Immutable history**: no update or delete grant on audit rows, like the points ledger and notes.
- **Re-verification triggers** (applied by the same RPC, never by the UI): a verified organization's `legal_name` or `org_type` change clears `business_verified_at`/`is_verified` and opens a new business-verification request (or flags it, see decision 3); a user's phone change clears `phone_verified_at`; a name change clears `display_name_confirmed_at`.
- **Permissions** (new keys, on the existing RBAC): `users.edit_profile` and `organizations.edit` (Administrator and above, delegable); `users.edit_contact` and `organizations.edit_legal` (Super Admin only, only if Option B/C is chosen). Rank rule as for suspend: never edit staff at or above your own rank (a suspended peer stays protected); never edit yourself here (own settings exist). **No edit control inside View-As.**
- **Notification**: the affected user is told what changed (not the reason text) so a silent profile change is impossible.

## 3. Options

| | Option A: moderation edits only | Option B: A + contact edits with step-up | Option C: full edit incl. legal fields |
|---|---|---|---|
| Fields | Tier L, remove-only media, org contact **excluded** | A + user/org contact (tier M/H) | B + `legal_name`, `org_type` |
| Controls | Reason, audit, notify | A + Super Admin only, second approver or user confirmation code, extra audit alert | B + automatic demotion and re-verification |
| Takeover / fraud risk | Low | Medium-high (needs the extra controls to be real) | High; admin can change what the badge vouches for |
| Build size | Small: 2 RPCs, 2 permissions, one form each | Medium: approval/confirmation flow | Large |
| Reversible | Yes (old values are in the audit row) | Mostly | Partly (re-verification cost) |

**Recommendation: Option A now.** It covers the real support cases (fix or remove abusive or wrong text, correct location, tidy an organization page) with the smallest attack surface and a complete audit trail. Contact and legal changes stay with the owner's own flows (phone/email change with OTP, business re-verification) or a support-assisted request. Revisit B only on a concrete need, with the step-up design agreed first. **Do not build C**: letting an admin change what a verified badge attests is the exact failure the verification workflow prevents.

## 4. Decisions needed from the owner

1. Option A, B or C (recommended: A).
2. Who may edit: Administrator and above only (recommended), or Moderator/Support through a delegable role.
3. When a re-verification trigger fires: demote and open a new request automatically (recommended), or flag for review and keep the badge until a reviewer decides.
4. Reason: free text only, or a fixed code list plus text (ties to PD-005).
5. Notify the affected user of what changed (recommended: yes, field names only).
6. Audit privacy: masked contact values (recommended) versus full old and new.
7. Confirm that View-As stays strictly read-only and edits live on their own, explicit, separate page.

*Migration numbers, if approved: after `20261114090004` (the View-As stack), allocated with the other tracks.*
