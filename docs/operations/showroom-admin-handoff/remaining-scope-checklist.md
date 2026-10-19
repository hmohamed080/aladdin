# Showroom V2 & Admin — remaining scope checklist

Base: `main` @ `9d9a1b6` (RC2 `8bde19c` + Admin Core PR #86 + Google/Facebook/email sign-in PR #87). 164 migrations.
Checked against code, migrations and `docs/` decisions on 2026-10-17. "Inferred" marks anything not proven by a test run.

## Business verification (high priority)

| Item | State | Evidence |
|---|---|---|
| Organization application (activation) review: submit, request changes, resubmit, approve, reject, history | Implemented | `20261015090028/30/47`, `review_*`, `my_organization_applications()` |
| Application approve is Administrator-only | Implemented (hard-coded tier) | `20261015090052_org_review_administrator_only.sql` |
| Separate **business verification** (legal documents → Verified badge) distinct from activation | **Missing** | Approving the application sets `organizations.is_verified = true` in the same step (`app._apply_org_approval`), so every activated org already shows the badge without evidence |
| Document upload, private storage, owner/admin-only access | **Missing** | `verification_documents.storage_object_path` is a placeholder; no bucket; decision D-A2 was open |
| Delegated `verification.approve` authority (Support/Moderator may review, not approve) | **Missing** | No such permission in `admin_permissions` |
| Admin queue with filters, evidence panel, previous submissions | Partial | `/admin/verifications` lists rows with raw types; `/admin/review/[type]/[id]` reads real data but Approve/Reject are Preview dialogs |
| Mandatory reasons + audit on every decision | Partial | Reason required on reject / request changes, not on approve |
| Showroom status page: Pending / Under review / Verified / Rejected, reasons, history, resubmit | **Missing** for business verification (exists for the application at `/business/applications`) |

## Showroom V2

| Item | State | Evidence |
|---|---|---|
| Shell, Home, Catalog, Saved, My Products, Settings (business, branches, identity) | Implemented | `app/showroom/(app)/*` |
| Offers, My Offers | Built, **switched off for rc1** | Pages and RPCs exist; `notFound()` layouts and hidden nav from commit `47191cc` |
| Shared Purchase Requests | Partial | Backend `20261015090020`; no frontend (nav item hidden) |
| Direct RFQs, quotations, orders, customers, leads, follow-ups, projects, reports, activity, points | Implemented through the legacy `/b2b/*` modules inside the shell | `features/showroom-shell/navigation.ts` |
| Team & invitations | Partial | `invitation_create/_accept/_lookup` exist; **no revoke**, token stored in clear, no invitation audit rows, branch/role assignment on invite unverified; copy says "Invitation sent by email" but no email is sent |
| Business profile, branches, account-completion states | Implemented (identity, branch and co-owner requests reviewed by Admin) | contract §3.2–3.4 |

## Admin

| Item | State | Evidence |
|---|---|---|
| Users / Organizations directories, detail pages | Implemented (real reads) | Admin Core PR #86 |
| User and organization suspend / restore | Implemented (RPCs + UI) | `admin_user_suspend`, `admin_organization_suspend` |
| Notes, follow-ups, entity timeline, audit feed | Implemented on detail pages; Preview on Review detail | `admin_note_add`, `admin_follow_up_log` |
| Admin Staff roles (assign, change, disable) | Implemented; "Invite staff" button is Preview | `admin_staff_*` |
| Points adjust / reverse | Backend exists (`adjust_points`, `reverse_points_entry`); UI buttons are Preview | |
| Review Center "Organization Requests" tab | Fixture data (BL-023) | `PREVIEW_ORG_REQUESTS` |
| Admin Settings profile/password | Preview | |

## Security and decisions

| Item | State |
|---|---|
| 30-day phone reservation cooldown | **Not found** in migrations, server code or docs on `main` — need a pointer to where it was approved or built |
| Hosted GoTrue CAPTCHA enforcement gap | Blocked: owned by the separate Auth security thread |
| Subscriptions, showroom ratings, quotation credits, advanced Points | Deferred, not started; need approved requirements |
| R2 private media | In progress, **uncommitted** on the device (`codex/r2-rc2-integration`, 4 migrations `20261017100227..100309`). Verification documents stay out of its namespaces (it already excludes purchase-request/chat media) so the two do not collide |

## Defaults taken for this PR (business verification)

1. New review type `business`, one open request per organization, in the existing `verifications` queue.
2. Application approval activates the organization only; `is_verified` (the badge everywhere) is set only by an approved business verification. Organizations already approved keep their current value (no data rewrite).
3. New permission `verification.approve`: Super Admin and Administrator hold it; any other role gets it only by explicit delegation in Admin Staff. Starting a review and requesting information need `organizations.verify` (Moderator by default). Approve and reject need `verification.approve`, with a mandatory reason. The application approval uses the same permission instead of the hard-coded Administrator check.
4. Documents are optional for the activation application; a business verification request needs at least one document. PDF/JPEG/PNG/WebP, 10 MB each, up to 10 per request, private bucket, readable only by the organization's `org.manage` holders and verification reviewers.
