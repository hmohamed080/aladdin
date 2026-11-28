# Organization governance (Phase 6+7, M1)

Status: M1 (`20261022090001`), M2 (application lifecycle + UI) and M3 (`20261023090001-90003`: verified
identity changes, verified co-owners, branch governance) are implemented and locally committed. Independent
publishers (M4) are NOT implemented; see `m4-independent-publisher-impact-assessment.md`.

## Three separate concepts

| Concept | Record | Granted by |
|---|---|---|
| A. User identity verification | email-confirmed caller (`app.require_verified_caller`) | sign-up |
| B. Organization approval | `organizations.status = 'active'` via a `verifications` row (subject `organization`) | Admin review |
| C. Independent professional commercial publishing | **not built yet** (M4) | Admin review |

A verified user is never an approved organization, and approval of one organization never
carries to another. Authorization asks the question that matches the operation.

## Organization Application

The application IS the existing `verifications` row (`subject_type = 'organization'`) - one
review system, not two. The organization row created at submit time is a **provisional,
non-operational** record: `status = 'pending_verification'`, `is_verified = false`.

States shown to the owner (`my_organization_applications()`):
`draft` -> `pending_review` -> `approved` | `needs_changes` (-> resubmit) | `rejected`.

Operational predicate: `app.org_is_approved(org)` = `organizations.status = 'active'`. Clients
cannot write `status`/`is_verified` (column grants); only the approval path does.

### A pending organization can
sign in, complete its profile, upload application documents, submit and track the review, and
prepare (draft) catalog content.

### A pending organization cannot
resolve a business audience (`app.org_product_audience`, `app.viewer_offer_audience`), view
restricted products/offers/images as a business, publish products or offers
(`can_publish_catalog`), create RFQs (`can_create_rfq`), respond to requests
(`can_respond_rfq`), decide quotations (`can_decide_quote`), appear in the public directory,
or have its published products/offers seen by anyone else. `my_workspaces()` lists it with
`is_approved = false` so the owner can track it; it is not an operational workspace.

## Approval is atomic

`review_approve` (existing Admin RPC, unchanged) fires an AFTER UPDATE trigger that applies an
approved organization verification in the same transaction. `apply_organization_verification`
remains as an idempotent no-op for already-applied rows, so the existing Admin UI keeps working.
Reviewer identity (`verifications.reviewer_id`) and an `organization.verified` audit event are
recorded. The owner membership already exists from submit time, so approval creates no duplicate
rows.

## Second and later organizations

`business_draft_save` (new draft) and `business_draft_submit` refuse unless the caller owns no
organization yet or already owns an **approved** one (`app.may_apply_for_organization`), under a
per-user advisory lock. Draft, pending, needs-changes and rejected first organizations all block
a second. There is deliberately **no maximum count**. Each additional organization needs its own
approval, and approved organizations stay usable while another is pending.

## Contractor and Engineer operating models

Contractor and Engineer remain two of the nine public accounts. `contractor_company` and
`design_office` are internal organization types reached only through this application path:
`contractor_company` by a Contractor (a Contractor persona may only open a contractor
organization), enforced in the draft RPCs and in `organization_create_owned`; the organizations
guard trigger still refuses every direct insert/update by a signed-in user.

## Application lifecycle (20261022090002-90004)

- **Statuses shown to the owner:** `draft`, `pending_review`, `needs_changes`, `rejected`, `approved`,
  `abandoned` (and `closed` for an organization archived by someone other than its owner). `cancelled` is
  the one new `verification_status` value: an application the APPLICANT closed.
- **Rejected is final for that application.** It cannot be resubmitted. The owner may **abandon** it: the
  rejected record (reviewer, reason, timestamps) is untouched, a separate `cancelled` record is added, the
  organization is **archived, never deleted**, and it stops counting toward the slot. A replacement first
  application can then be opened and must receive full Admin approval; the abandoned organization can never
  become operational.
- **Abandon is allowed** for a draft, a needs-changes or a rejected application, and refused while a decision is
  pending. Abandoning twice is a no-op.
- **One open additional application.** `app.application_slot(uid)` returns `first_available`, `first_pending`,
  `first_rejected`, `additional_available` or `additional_pending`. A new application opens only from the two
  `*_available` states. An application is "open" while its organization is pending and its latest review record is
  not rejected or cancelled, so draft, pending review and needs-changes all occupy the slot while a rejected or
  abandoned one does not. There is no cap on approved organizations.
- **Enforcement** is in `business_draft_save`, `business_draft_submit`, `organization_application_submit` and
  `..._abandon`, all under one per-user advisory lock. `organization_application_slot` is exposed to the UI only to
  explain a refusal. Proven by pgTAP 77 and by `supabase/tests/organization_application_concurrency_test.sh`
  (two real sessions: exactly one wins, the other is refused, one pending organization results).

## Security investigation (the authorization-bypass warnings)

Automated reviews flagged `20261022090001` and `20261022090003` without a scenario. Investigation, against the
isolated database and the real PostgREST interface as a signed-in user:

- **Confirmed and fixed: client-writable `organizations.org_type`.** The column was UPDATE-able by an organization's
  owner, so an approved Showroom could retype itself to Supplier (or an Engineering Office to Showroom) and take that
  audience with no review. Reproduced, then closed by revoking the column privilege; regression tests C1/C2 (pgTAP 77).
- **Hardened: `organizations.deleted_at`.** A client could not soft-delete only because the SELECT policy rejected the
  resulting row, an accident. Soft-deleting a pending application would have freed the one-open slot. The privilege
  is now revoked explicitly (C3b).
- **Removed a trust assumption: the `app.org_application` session setting.** It was only unreachable because
  PostgREST exposes no `set_config`. The contractor_company guard now keys on the executing role (`authenticated` /
  `anon` are refused; a vetted definer path is not); a client that sets any session setting gains nothing (C4/C5).
- **Verified, no change needed:** internal functions (`organization_create_owned`, `_apply_org_approval`, the audience
  resolvers) are not callable through the API (404); `review_approve` is refused to non-admins; direct writes to
  `verifications`, `onboarding_progress` and `business_creation_drafts` are SELECT-only for clients; every
  SECURITY DEFINER function pins `search_path`; a forged workspace cookie naming a pending organization resolves to an
  approved one.
- **Known limitations, stated rather than hidden:** a signed URL cannot be revoked, so its 5-minute lifetime bounds
  access after revocation, while a new grant or a re-signing after revocation is refused. The two earlier
  limitations (a co-owner counted as owning an approved organization; an owner renaming an approved organization
  with no re-review) are RESOLVED by M3, below.

## Browser regression (small sequential batches)

`frontend/playwright.regression.config.ts` + `frontend/e2e/regression/*.spec.ts`: one worker, no retries, no
production build, reuses a running dev server (`E2E_PORT`, default 3026) and the isolated database
(`E2E_DB_CONTAINER`, default `supabase_db_aladdin_sr2`). Run one batch at a time, restarting the dev server between
batches on a low-memory machine:

    E2E_PORT=3026 pnpm exec playwright test -c playwright.regression.config.ts e2e/regression/a-showroom.spec.ts

Fixtures are built through real sign-ins, RPCs and Storage uploads (never service-role writes). Batches: A Showroom
Home / Browse / Details / My Products / Saved; B product form, audiences, image upload, workspace switching; C offers;
D direct RFQ, cross-organization access, English LTR / Arabic RTL; E 430px and 390px, Light and Dark; F signed URL
lifetime / expiry / refresh and denial after audience or membership revocation; G the organization application journey.

## M3 - identity changes, verified co-owners, branches (20261023090001 / 90002 / 90003)

All three reuse the existing `verifications` review system (subject `organization`). New `verification_type`
values: `organization_identity`, `co_owner`, `branch_location`. They appear in the existing Admin queue and are
decided with the existing `review_start / review_request_changes / review_reject / review_approve`; the effect of
an approval is applied by the same atomic AFTER UPDATE trigger (`app._apply_org_approval`, now a dispatcher). The
existing Admin approve action needs no extra apply step for a type other than `professional` / `organization`, so
no Admin UI change is required. The Admin queue shows the raw type string for the new types until its label map
(`admin.verificationType`) gains entries; the proposed values live in `verifications.metadata`.

### A. Verified identity (name, Arabic name, English name, public address/slug)
- Protected once `is_verified` or `status = 'active'`. A BEFORE UPDATE guard (`organizations_identity_guard`, keyed
  on the executing role like the org_type guard) refuses a direct client update; `organization_update_i18n` refuses
  a name change for a verified organization (timezone and other ordinary fields still work); no other writer exists.
- `organization_identity_change_request(org, name, name_ar, name_en, slug)`: NULL = unchanged, an empty string clears
  an Arabic/English name. It has **no `org_type` parameter**. One open request per organization (partial unique
  index); a needs-changes request is superseded by the corrected one (the old record and reason stay). Withdraw is
  allowed until a reviewer picks it up. The proposal and the previous values are immutable in `metadata`; nothing is
  duplicated into a second table. The approved values stay public and the organization stays fully operational.
- Approval applies `name / name_ar / name_en / slug` atomically and audits `organization.identity_changed`
  (previous, proposed, reviewer). Rejection leaves everything unchanged. Slug uniqueness is re-enforced by the unique
  index at apply time.
- **Dependencies, not silently widened:** every public surface reads `organizations.name` (and the Arabic/English
  overrides and `slug`) live - the catalog views' `supplier_name/supplier_slug`, the public directories, offers, RFQ /
  quotation / order lists - so an approved rename propagates to all of them at once. No table column stores a copy of
  the name (checked); notification text and audit metadata that quoted the old name stay as historical records.
  Ordinary descriptive profile edits and image moderation are unchanged.

### B. Verified co-owners
- `public.org_co_owners` is the only trusted record. It is written solely by the approval of a `co_owner`
  verification (Admin) and ended solely by `org_co_owner_revoke` (platform administrator). Clients have SELECT on
  their own rows and no write privilege.
- Any active member of an APPROVED organization may file a claim (`org_co_owner_request`); it proves nothing. The
  founder (`organizations.created_by`) is the primary owner and needs no claim.
- **Ownership for the application slot** (`app.owned_org_ids`) is now: an organization the person FOUNDED and still
  manages, or an approved organization where they are an ACTIVE verified co-owner with an active membership. An
  `org.manage` capability, a role label, an invitation or a generic Verified badge are not ownership.
- `app.can_create_or_complete_business` previously let ANY `org.manage` member of an approved
  Showroom/Supplier/Manufacturer/Importer open a business of their own. It now requires ownership (above). A
  verified co-owner is therefore eligible; a manager or sales manager is not. The one-open-application rule, the
  rejected-first and abandon rules and the Admin approval of the new organization are unchanged; the new
  organization starts pending with no audience.
- Revocation ends the eligibility basis immediately (`is_verified_co_owner` is evaluated live) and also lapses if the
  membership is suspended or the organization stops being approved. Historical applications are never touched.
- Scope note: the eligibility basis is limited to the four seller types that already carried it. Engineers and
  Contractors are eligible through their persona; an Engineering Office / Contractor Organization co-owner who is
  not an Engineer/Contractor persona is NOT made eligible by this decision (no Coming Soon bypass).
- Admin integration requirement: the Admin UI should show the candidate (`metadata.candidate_user_id`, `note`) when
  reviewing a `co_owner` item, and offer `org_co_owner_revoke(org, user, reason)`. The backend contract is complete;
  no Admin UI was changed.

### C. Branches
- No second model: the existing `branches` table, `membership_branch_access`, `branch_assign`, `branch_update_i18n`
  and the `branch.manage` capability are reused. New: `branch_create` (approved parent, active membership,
  `branch.manage` or `org.manage`, at most 100 per organization, unique name, audited), `branch_set_locality`,
  `branch_set_active` (an organization keeps one active branch), `my_branches`, `branch_verification_request`.
- A branch is **internal** from creation. It carries no audience and never affects the organization's audience,
  type or capabilities (nothing reads branches to resolve an audience). A pending organization cannot create or
  verify branches.
- **Public verified location** is `branches.public_identity` (an approved snapshot of name / names / addresses /
  locality) plus `verified_at/by`, written only by approving a `branch_location` review. The single public read,
  `showroom_branches`, now lists approved organizations' active branches only, uses the approved snapshot name for a
  verified branch and flags every other branch `location_verified = false` (its address is never exposed).
- Edits to an already verified branch do not freeze it and never reach the public view: the owner sees "unreviewed
  changes", submits an amendment, and the last approved snapshot stays public until it is approved; a rejection
  keeps it. Previous and new values are audited (`branch.verified`).
- Existing branches (created before M3) have no snapshot and read as unverified until reviewed.
- Out of scope, documented for a later phase: branch-specific inventory / marketplace publishing (none exists).

### Security review of the M3 backend
- Check-then-act: every governance writer takes a SHARE lock on the organization row and the actor's membership
  before checking authority (`app._lock_org_actor`), proven by two real sessions in
  `supabase/tests/governance_concurrency_test.sh` (a suspension waits for an in-flight writer; a writer that starts
  after a suspension is refused and creates nothing).
- Direct SQL/PostgREST updates, the profile RPC, server actions, the onboarding/draft writers and batch updates
  cannot change a verified identity; member/manager privileges and simultaneous requests are covered by pgTAP 78.

## Open decisions flagged for the owner

1. Registration-time Contractor / Engineer **organization** choice is implemented. The Contractor stays behind the
   existing Coming Soon gate until M4 and an explicit go-ahead. The Engineer gate was opened by the owner on
   2026-11-28 (`20261128100007`); the `independent_commerce` flag is unchanged.
2. Whether an Engineering Office / Contractor Organization co-owner (not an Engineer / Contractor persona) should also
   become eligible through a verified co-ownership (see B, scope note).
3. M4 scope split: whether Direct RFQ / quotation / order / chat for an independent publisher ships with M4 or as
   M4b (see the impact assessment).

## DEFERRED - approved contracts, intentionally not implemented

Nothing below has a schema, route, navigation entry or placeholder.

### Purchase Request matching (tags)
Access order: (1) account/audience eligibility, (2) specialties/categories/tags relevance,
(3) subscription entitlements. Tags and packages never bypass audience eligibility. Future tabs:
"مناسبة لك" (matching) and "كل الطلبات المسموحة" (all eligible). Matching considers request
ITEM categories/tags, not only the title. No fake badges or scores until requested.

### Quotation credits (shared Purchase Request responses only)
Not for direct RFQs, offers or product management. Browsing/opening/searching/revisiting and
drafting cost zero. One credit is consumed only by the first successfully submitted response to
a distinct request (full or partial). Revising a response, a validation failure, or a colleague
working on the same response costs nothing more. Credits are organization-level (an approved
individual Contractor/Engineer publisher may own an individual credit balance). Enforcement must
be atomic and idempotent. When credits run out, request details stay viewable. Refunds on
withdrawal, carryover, period length and Admin adjustments are undecided business questions.
The earlier "Request Unlock" concept is withdrawn.

### Admin-driven tags and subscriptions
Central Tags Library (add/rename/archive, propagate to linked accounts, compatible with the
fourteen Craftsman specialties) and configurable subscription/page management (packages, prices,
duration, entitlements, validated draft/preview/publish with audit history; a displayed feature
must match its enforced backend entitlement). A future standalone phase; not a general CMS.

## M3 corrections and M4a (20261023090004 - 90009)

- **Branches are private until verified.** `showroom_branches` returns only Admin-approved snapshots; an internal or
  pending branch appears in no public listing. `branch_verification_revoke` (administrator) removes a public
  verification (history kept). The 100-branch limit was an unapproved arbitrary guard and is removed; branch limits
  are a deferred commercial decision.
- **Co-owner eligibility** now follows verified ownership of ANY approved organization type. The `contractor_company`
  persona guard, Coming Soon registration and the one-open-application rule are unchanged.
- **Reviewer evidence:** `review_context(verification_id)` (platform reviewers) returns the people, organization,
  previous/proposed values, branch snapshot and history. The Admin UI does not render it yet (integration requirement).
- **M4a:** `publishers` (organization / independent_contractor / independent_engineer), `products` and
  `product_offers` (+ prices, images, items) carry an immutable `publisher_id`; independent approval is the review
  type `independent_publisher`; suspend / revoke / reinstate are administrator RPCs; the gate
  `platform_flags.independent_commerce` (default off, no API writer) hides independent content from everyone else.
  See `m4-independent-publisher-impact-assessment.md` and `m4b-implementation-plan.md`.
- Independent image keys use `{publisher_id}/{product_id}/{uuid}.ext` (not `p/...`) so the existing key format check
  still holds; the prefix is never an authorization input.
