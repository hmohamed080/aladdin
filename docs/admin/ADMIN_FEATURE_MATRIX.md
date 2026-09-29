# Admin Feature Matrix — Aladdin vs. `talent-project` (reference)

| | |
|---|---|
| **Status** | Audit — Phase 1 (gap analysis only, no implementation) |
| **Version** | 1.0.0 |
| **Owner** | Foundation / Operations |
| **Last Updated** | 2026-09-19 |
| **Depends On** | [`PRODUCT_DECISIONS_REGISTER.md`](PRODUCT_DECISIONS_REGISTER.md), [`ADMIN_IMPLEMENTATION_BACKLOG.md`](ADMIN_IMPLEMENTATION_BACKLOG.md) |
| **Related** | [`../technical/07_permissions_matrix.md`](../technical/07_permissions_matrix.md), [`../database/points-core.md`](../database/points-core.md), [`../operations/AGENT_WORK_LOG.md`](../operations/AGENT_WORK_LOG.md) |

## Reproducibility

| | Aladdin | `talent-project` (reference) |
|---|---|---|
| Repository | `hmohamed080/aladdin` | `bstalent8-ux/talent-project` (private; access confirmed via `gh`, owner `hmohamed080` has `repo` scope) |
| Branch inspected | `claude/showroom-approval-workflow-acd3de` (worktree) | `main` |
| HEAD commit | `2393334f7af9e5c9b5066756322fb5fa83420b77` | `9da175fc6caeeb723b2a2420bbd45ba420d925df` |
| Method | Direct inspection (Read/Grep/Glob) of the working tree + local Supabase (`supabase db reset`, `psql` via `docker exec`) | Shallow clone to `C:\tmp\talent-project`, direct inspection (Read/Grep/Glob) of the working tree by a dedicated research pass; no live database access — findings are code/migration-file evidence only |

## Critical reference rule

> **`talent-project` is a reference implementation, not a source to copy blindly.**
> Patterns may be adopted only when they fit Aladdin's domain model, security model, architecture, business rules, and operational needs.

This applies to every row below marked **D (Reference pattern only)** and to the applicable parts of every **C** row: the *pattern* (e.g. "server-side pagination with a sort/filter contract," "a resource+action permission matrix," "a rejection-reason taxonomy") is what transfers — Talent-specific nouns (talents, brands, bookings, candidates, leads-as-recruiting-pipeline) never do. Aladdin's own architecture is authoritative wherever the two disagree: RLS + `SECURITY DEFINER` RPC as the enforcing boundary (not `adminClient`/service-role-bypass + hand-written route checks), the shared `en.ts`/`ar.ts` i18n catalog (not per-component `TX` objects), and the append-only `points_ledger` model (not a raw mutable balance column) are all **already the stronger pattern on the Aladdin side** and nothing here suggests replacing them.

## Classification key

- **A** — Already exists, good enough
- **B** — Exists but incomplete
- **C** — Missing, applicable to Aladdin
- **D** — Reference pattern only (adapt, don't copy the domain)
- **E** — Talent-specific, not applicable
- **F** — Product decision required before any build

Priority (engineering/operational necessity only, not business preference): **P0** = required for safe core admin operation · **P1** = important for daily operations · **P2** = valuable improvement · **Later** = scale/optimization/future tooling.

## Summary counts

| Classification | Count | Rows |
|---|---|---|
| A — already good enough | 5 | C1, H1, J1, Q1, S1 |
| B — exists but incomplete | 6 | A1, A2, B1, D1, I1, M1 |
| C — missing, applicable | 6 | A3, A4, G1, H2, J2, P1 |
| D — reference pattern only | 8 | B2, E1, L2, + 5 in the "Reference-pattern-only" table |
| E — Talent-specific, not applicable | 7 | N1, + 6 in the "Talent-specific" table |
| F — product decision required | 5 | A5, B3, E2, L1, R1 |
| **Total rows** | **37** | |

Note: L1 straddles F and D (the specific re-tiering question is F; whether to adopt a dynamic role-editor model is D) — counted once under F, its dominant classification, since a product decision on tiering is the immediate blocker.

---

## A. User management

### A1. User directory — listing
- **Talent implementation:** `fetchAdminTalentsPage`/`fetchAdminBrandsPage` (`features/admin/services/admin.service.ts`) — real server-side pagination, sortable columns (`SortableTh`, `parseSortParam`) on `full_name, city, balance/brand_status, created_at`, page-size selector (10/25/100), server-side filters (status, category, city, profile-completion score, duplicate flag, free-text `q`).
- **Aladdin current state:** `listUsers()` (`frontend/src/server/queries/admin.ts:124`) does `.select(...).order(created_at desc).limit(200)` — a hard 200-row cap, then `q` search is applied as `rows.filter(...)` **in JavaScript after the fetch**. No status filter, no account-type filter, no sort-column control, no pagination UI (`frontend/src/app/admin/users/page.tsx`).
- **Gap:** Not scalable past 200 users; search silently misses anything outside the newest 200; no way to sort or filter by status/type at all.
- **Classification:** B (exists but incomplete)
- **Why it matters:** As the user base grows past 200, the admin literally cannot find or search for a user outside the most-recent 200 — a real operational blind spot, not a cosmetic one.
- **Suggested Aladdin adaptation:** Real server-side search (Postgres `ilike`/FTS) + status/account-type filters + `?sort=&dir=&page=` URL-state pagination, following the *pattern* Talent uses — implemented as an Aladdin RPC/query respecting RLS (`is_platform(...)`), not an `adminClient` bypass.
- **Dependencies:** none blocking; purely additive to `listUsers`/`AdminUsersPage`.
- **Security considerations:** must stay RLS-scoped like today (no service-role bypass); a text search must not turn into a way to enumerate PII across tenants beyond what admin already sees.
- **Data/migration impact:** none required for basic filter/sort; a `pg_trgm` index on `profiles.display_name` (already enabled repo-wide) would keep search fast at scale — index-only migration, no schema change.
- **Priority:** P1

### A2. Organization directory — listing
- **Talent implementation:** n/a directly (Talent has no multi-tenant org concept), but the same server-side pagination pattern applies to `talents`/`brands`.
- **Aladdin current state:** `listOrganizations()` (`admin.ts:218`) — same `.limit(200)` pattern, **no search field at all**, no filter, no sort (`frontend/src/app/admin/organizations/page.tsx`).
- **Gap:** Worse than the user directory — not even a free-text box exists.
- **Classification:** B
- **Why it matters:** Aladdin is B2B-first; the organization directory is arguably the single most important admin list, and it currently has zero search/filter capability.
- **Suggested Aladdin adaptation:** Same pattern as A1 — server-side search by name/org_type/status, sortable columns, real pagination.
- **Dependencies:** none.
- **Security considerations:** same as A1.
- **Data/migration impact:** none required; optional `pg_trgm` index on `organizations.name`.
- **Priority:** P1

### A3. User detail — destructive/status actions (suspend, restore, disable)
- **Talent implementation:** `PATCH /api/admin/users/[profileId]/status/route.ts` — block/suspend/unblock with `ConfirmationModal` + reason capture in several call sites; `middleware.ts` reads `profiles.account_status` on every request and redirects a blocked/suspended/rejected user to `/blocked`.
- **Aladdin current state:** `users.status` enum (`pending_verification|active|suspended|deactivated`, `20260802090001_identity_core.sql:44`) exists and `components/admin/parts.tsx`'s `statusTones` already has colors ready for `suspended`/`deactivated`. **Confirmed by exhaustive grep this session: zero RPC or code path anywhere ever sets a user to `suspended`/`deactivated`, and `frontend/src/middleware.ts` never references `status`/`suspend`/`block`/`deactivate` at all** — there is neither a write path nor an enforcement/read path. `frontend/src/app/admin/users/[id]/page.tsx` has no action of any kind — fully read-only.
- **Gap:** Complete — this is not "missing an admin button," it is a schema value that is inert end-to-end. Even a direct SQL `UPDATE` would currently do nothing, because nothing checks it.
- **Classification:** C (missing, applicable) — and the most severe finding in this audit.
- **Why it matters:** There is currently no way, through any surface, to stop a bad-actor account from using the platform. This is a baseline trust-and-safety requirement for any platform accepting public signups.
- **Suggested Aladdin adaptation:** (1) a `SECURITY DEFINER` RPC, `platform_suspend_user`/`platform_restore_user`, gated on `is_platform('support')` or narrower (see PD-004), requiring a reason, auditing `account.suspended`/`account.restored` (new audit vocabulary — additive to `ck_audit_action_known`); (2) an enforcement point — most naturally Aladdin's own `middleware.ts` reading `users.status` the way Talent's does, or an RLS-level check reused by every sensitive RPC (`app.require_verified_caller()` is the existing single chokepoint most write RPCs already call — the natural place to also reject a suspended caller); (3) a button + reason field on `AdminUserDetailPage`.
- **Dependencies:** the enforcement point (middleware or `app.require_verified_caller()`) should land in the same change as the write RPC — a suspend button that doesn't actually stop anything is worse than no button, because it would look like protection that isn't real.
- **Security considerations:** must be genuinely server-enforced (RLS/RPC-level), never UI-hidden only, per Aladdin's own root `AGENTS.md` security baseline.
- **Data/migration impact:** additive migration only (new RPCs + audit vocabulary; no schema change, the enum values already exist).
- **Priority:** **P0**

### A4. Organization status actions (suspend/archive)
- **Talent implementation:** brand `account_status` flips via the same shared `/api/admin/users/[profileId]/status` route (brands are `profiles` rows too in Talent's model).
- **Aladdin current state:** `organizations.status` and `organizations.deleted_at` exist and are read (`.is("deleted_at", null)` filters throughout the codebase), but no admin action anywhere writes either. `frontend/src/app/admin/organizations/[id]/page.tsx` is read-only, same as the user detail page.
- **Gap:** Same shape as A3 — schema supports it, nothing can trigger it from admin.
- **Classification:** C
- **Why it matters:** A fraudulent or abusive organization (e.g. a fake showroom) currently cannot be taken offline by platform staff.
- **Suggested Aladdin adaptation:** Mirror A3's RPC pattern for organizations; also consider whether suspending an organization should cascade to its memberships' effective access (a product question, not purely engineering — see PD-004).
- **Dependencies:** A3 (same underlying pattern; likely one combined design pass).
- **Security considerations:** same as A3; suspending an org is higher-blast-radius (affects every member), so this likely warrants `is_platform('administrator')` specifically rather than `'support'` (docs/technical/07_permissions_matrix.md §5 already specifies "Govern orgs: Administrator only").
- **Data/migration impact:** additive.
- **Priority:** **P0**

### A5. Rejection-reason taxonomy
- **Talent implementation:** free-text `reason` fields throughout (talent reject, brand reject, verification reject) — **no structured taxonomy found anywhere** (confirmed by the Talent inventory agent); candidates/leads capture a structured `stage_answers` JSON only for the specific "Rejected"/"Accepted" pipeline stages, which is closer to a custom-form pattern than a fixed reason-code enum.
- **Aladdin current state:** `verifications.reason`, `network_referrals.decision_reason`, `organization_referrals`' equivalent — all single free-text fields, required (enforced client- and server-side per `admin-forms.ts`), no fixed taxonomy (`Duplicate`/`Invalid information`/`Unable to verify`/etc.) anywhere.
- **Gap:** Both platforms are free-text only; Aladdin is not behind Talent here, but the task's suggested taxonomy is genuinely absent from both.
- **Classification:** F (product decision required) — see PD-005.
- **Why it matters:** A fixed taxonomy makes rejection reasons reportable/analyzable ("38% of rejections this month were duplicates") and reduces reviewer typing burden; free text alone doesn't.
- **Suggested Aladdin adaptation:** An optional `reason_code` enum column alongside the existing free-text field (additive, backward-compatible — existing `decision_reason`/`reason` stays as the human-readable detail); the RPCs already require *a* reason, so this only adds structure, not a new requirement.
- **Dependencies:** none technical; needs product sign-off on the exact code list (see PD-005).
- **Security considerations:** none.
- **Data/migration impact:** additive `reason_code` enum + column on each reviewable table (`verifications`, `network_referrals`, `organization_referrals`).
- **Priority:** P2

---

## B. Organization management

### B1. Organization detail — referral provenance visibility
- **Talent implementation:** n/a (no organization/referral concept).
- **Aladdin current state:** `organizations.source`/`referred_by_user_id` are real, write-once, audited columns (`20260815090002_showroom_affiliation.sql`, `20260911090001_network_referrals.sql`), but `getOrganizationDetail()`/`AdminOrgDetailPage` (`admin.ts:248`, `app/admin/organizations/[id]/page.tsx`) never selects or renders them. Confirmed by reading the full component — no provenance field exists on the page.
- **Gap:** An admin reviewing an organization cannot see, without a direct SQL query, that it was created via an installer's Network referral or a salesperson's Sales referral, or who referred it.
- **Classification:** B (exists but incomplete — the data exists, the view doesn't surface it)
- **Why it matters:** This is directly relevant context for a reviewer deciding whether to trust/verify an organization, and it's the kind of "how did this get here" question §D (Review details view) explicitly calls out.
- **Suggested Aladdin adaptation:** Add a "Provenance" field to `AdminOrgDetail`/`AdminOrgDetailPage`: source (`self_created`/`salesperson_referral`/`installer_referral`), and if referred, a link to the referring user and the referral record.
- **Dependencies:** none.
- **Security considerations:** none new (same RLS-scoped read).
- **Data/migration impact:** none — read-only addition to an existing query.
- **Priority:** P2

### B2. Duplicate detection for organizations (general-purpose)
- **Talent implementation:** talents get live in-memory union-find duplicate clustering with a filter and badge; leads/candidates get a `possible_duplicate_of` hint set at creation time (phone match only). No merge action exists for either.
- **Aladdin current state:** Duplicate detection exists **only inside the two referral-review flows** (`admin_showroom_referrals_list`, `admin_network_referrals_list` — pg_trgm similarity + exact `ilike` match against existing organizations, surfaced as a "link to this business" action). There is no general-purpose "is this organization already in the system" tool on the Organizations directory itself.
- **Gap:** A platform admin creating or reviewing an organization outside the referral flows (e.g. verifying an org that self-registered) has no dedup assistance at all.
- **Classification:** D (reference pattern only) — Talent's *technique* (similarity scoring, a non-blocking hint, never an automatic merge) is exactly Aladdin's own existing referral-flow pattern already; the adaptation is to generalize it to the Organizations directory, not to import Talent's specific union-find implementation.
- **Why it matters:** Fewer duplicate showroom/supplier records means cleaner data for buyers searching the directory and fewer split reputations/reviews for the same real business.
- **Suggested Aladdin adaptation:** A read-only "possible duplicates" panel on the org creation/verification flow, reusing the same `extensions.similarity()` + `org_type` match technique the referral RPCs already use — genuinely small, since the SQL pattern already exists twice in this codebase.
- **Dependencies:** none.
- **Security considerations:** none new.
- **Data/migration impact:** none (read-only, reuses existing extension).
- **Priority:** P2

### B3. Merge duplicate organizations
- **Talent implementation:** does not exist (confirmed by the inventory agent's grep — no merge route/UI anywhere for talents, leads, or candidates).
- **Aladdin current state:** does not exist.
- **Gap:** Neither platform has this. Not a case of Aladdin lagging a working Talent feature.
- **Classification:** F (product decision required) — merging is high-risk (must preserve memberships, RFQs, quotations, orders, audit history, reviews) and Talent offers no proven pattern to lean on.
- **Why it matters:** Worth deciding deliberately rather than bolting on later once real duplicate organizations accumulate real transaction history that a merge would need to reconcile.
- **Suggested Aladdin adaptation:** Not for this phase — flag as a deliberately deferred capability (see PD-006) rather than building against no reference implementation.
- **Dependencies:** B2 (dedup detection) as a prerequisite signal.
- **Security considerations:** a merge is one of the highest-blast-radius admin actions possible — would need `is_platform('administrator')`, mandatory reason, and full audit of what was merged into what.
- **Data/migration impact:** significant if ever built (every FK'd table needs a defined re-parenting rule).
- **Priority:** Later

---

## C. Unified approval / review center

### C1. Coherent pending-work surface across approval types
- **Talent implementation:** No single review center — `talents`, `brands`, `reviews`, `verifications` are four **separate** list pages, each with its own approve/reject UI. Candidates and leads are further separate pipelines again.
- **Aladdin current state:** `/admin/verifications` already hosts **three** review queues on one page — generic verifications (identity/professional/organization), Sales-referred showrooms, and Network-referred showrooms — explicitly by design (`admin/verifications/page.tsx` comment: "Referred showrooms are reviewed HERE rather than on a second Admin surface").
- **Gap:** None against Talent — Aladdin's approach (one coherent review surface, not scattered per-entity-type pages) is architecturally *better* than Talent's here. The page also has no tabs/counts distinguishing the three sub-sections visually beyond their own headers, and no cross-queue search.
- **Classification:** A (already good enough) — with a minor P2 polish opportunity (tab/count UI for the three sub-queues as more review types are added) noted for the backlog, not a real gap.
- **Why it matters:** N/A — recording this as a deliberate strength, not a gap, so the backlog doesn't waste effort "fixing" something already correct.
- **Suggested Aladdin adaptation:** n/a (keep the current pattern; add future approval types — e.g. job/listing moderation, if it emerges — as a fourth section on the same page, not a new route).
- **Dependencies:** none.
- **Security considerations:** none.
- **Data/migration impact:** none.
- **Priority:** P2 (cosmetic only — tab/count UI as queue count grows)

---

## D. Review details view

### D1. Review-details richness (submitter, history, duplicates, notes)
- **Talent implementation:** Talent detail pages show submitter identity, but internal admin notes (`TalentActionsPanel`) are a *separate* CRM feature bolted onto talents specifically — not integrated into the verification-review flow itself.
- **Aladdin current state:** The referral review cards (`ReferralReview`/`NetworkReferralReview`) already show submitter name + masked email, submitted data, location, phone/note, and a duplicate-candidate hint with a one-click link action — genuinely rich for what they cover. The generic verification queue (`admin/verifications/page.tsx`) shows less: subject name, type, requested account type, status, date — no attachments/documents view, no "previous decisions on this same subject" history, no internal notes.
- **Gap:** Generic verifications lack the richness the referral reviews already have (attachments/documents, prior-decision history for repeat submitters, internal notes).
- **Classification:** B (exists but incomplete — inconsistent depth across the three review types on the same page)
- **Why it matters:** A reviewer deciding a professional-upgrade or organization-verification request currently has less context than a reviewer deciding a referral, on the very same page.
- **Suggested Aladdin adaptation:** Bring the generic verification card up to the referral cards' bar: show the subject's prior verification attempts (already queryable via `verifications` history, just not rendered inline), and add an internal-notes field (see G1).
- **Dependencies:** G1 (admin notes) for the notes piece.
- **Security considerations:** none new.
- **Data/migration impact:** none for history (data exists); additive for notes (see G1).
- **Priority:** P1

---

## E. Status lifecycles (overloaded statuses)

### E1. Overloaded status — Talent's three-status-system case study
- **Talent implementation:** `profiles.account_status` (platform ban) + `profiles.brand_status` (brand onboarding) + `talent_profiles.status` (listing approval) + legacy `is_approved`/`is_suspended` booleans, confirmed **still physically present and still written** by a backward-compat migration (`20260810_profiles_account_status_only.sql:36-39`) even though `account_status` is now canonical. Talent's own CLAUDE.md flags this as known debt: "the admin talents list hardcodes `status: 'approved'` for every row... dashboard counters are not truthful."
- **Aladdin current state:** No equivalent multi-status collision found for a single entity. `users.status` (platform-level), `organizations.status`/`is_verified` (org-level), `verifications.status` (review-decision-level), and `network_referrals.status` (referral-lifecycle-level) are each scoped to a genuinely distinct concern, not stacked on the same entity redundantly.
- **Gap:** None — this is a documented case study of what to avoid, not a gap in Aladdin.
- **Classification:** D (reference pattern only — a cautionary pattern, not a positive one to copy)
- **Why it matters:** Directly informs PD-001/PD-002 below (do not let Network referral status quietly grow a second, overlapping meaning the way Talent's did).
- **Suggested Aladdin adaptation:** n/a — the lesson is procedural: whenever a new status concept is proposed for an existing entity, check first whether an existing status already covers it before adding a parallel one.
- **Dependencies:** none.
- **Security considerations:** none.
- **Data/migration impact:** none.
- **Priority:** Later (documentation/awareness only)

### E2. Network referral status — `approved` vs `joined`, `rejected` vs `cancelled`
- **Talent implementation:** n/a directly, but Talent's `booking_briefs.status` including a `changes_requested` state (added after the original `pending|accepted|rejected`) is a real precedent for a lifecycle *needing* an intermediate state once real usage revealed the two-state model was too coarse — directly analogous to PD-001's question.
- **Aladdin current state:** Documented precisely and NOT changed in this audit, per instruction. `network_referral_approve` currently takes a `pending` referral directly to `joined` (materializing an **unowned**, `pending_verification` organization) in one step; `network_referral_reject` takes `pending` directly to `cancelled` (the same terminal state a referrer's own withdrawal produces).
- **Gap:** Two distinct product questions, not yet decided: (1) does "Admin approved this referral" mean the same thing as "this organization has actually joined Aladdin" (PD-001)? (2) should an admin's rejection be distinguishable in the data from a referrer's own withdrawal (PD-002)?
- **Classification:** F (product decision required)
- **Why it matters:** The current behavior is explicitly out of scope to change per the task's instructions — this row exists to document it precisely and hand it to PD-001/PD-002 for a decision, not to flag it as broken.
- **Suggested Aladdin adaptation:** See PD-001 and PD-002 in the decisions register.
- **Dependencies:** none technical yet — pending decision.
- **Security considerations:** none.
- **Data/migration impact:** depends entirely on the decision (see PD-001/002 consequence tables).
- **Priority:** F (blocked on product decision, not an engineering priority in itself)

---

## F. Rejection reasons

(See A5 above — consolidated there since it applies platform-wide, not per-entity.)

---

## G. Admin notes

### G1. Internal admin notes (users, organizations, referrals, verifications)
- **Talent implementation:** Exists in **two different shapes**: `contact_messages.admin_note` (support tickets — a genuine standalone internal-only free-text field) and `talent_actions`/`candidate_actions`/`lead_actions` (a full CRM-style timestamped action log with author, optional follow-up date, and — for talents only — its own audit-of-edits table `talent_action_audit_log`).
- **Aladdin current state:** No internal admin-notes concept exists anywhere — not on users, not on organizations, not on verifications, not on referrals. Confirmed absent from every admin query/page read this session.
- **Gap:** An admin cannot leave a note like "called this showroom, confirmed legitimate, following up next week" anywhere in the product — it would have to live outside the system (Slack, a spreadsheet).
- **Classification:** C (missing, applicable)
- **Why it matters:** This is one of the most commonly needed pieces of admin tooling for any platform doing manual review/verification work, and Aladdin's entire admin model is built around manual review (verifications, referrals).
- **Suggested Aladdin adaptation:** A single, generic `admin_notes` table (`subject_type`, `subject_id`, `author_user_id`, `body`, `created_at`) usable against any entity — closer to Talent's `contact_messages.admin_note` simplicity than its heavier per-entity CRM-action-log pattern, since Aladdin doesn't (and per PD-007 shouldn't necessarily) need a full recruiting-CRM-style pipeline bolted on. Internal-only by RLS (`is_platform('support')` read/write), immutable history (no UPDATE — a correction is a new note, matching the points-ledger "compensating entry, never edit" philosophy already established elsewhere in this codebase).
- **Dependencies:** none.
- **Security considerations:** must never be readable by the subject or by non-platform users; RLS policy analogous to `network_referrals`' "self + platform, nothing org-scoped" pattern.
- **Data/migration impact:** one new additive table + RLS policies + audit vocabulary (`admin_note.created`).
- **Priority:** P1

---

## H. Audit log

### H1. Global vs. scattered audit coverage
- **Talent implementation:** **No single audit log.** Four separate, purpose-built tables: `admin_audit_log` (profile-config mutations only, explicitly optional/degradable per its own migration), `admin_role_audit_log` (roles/permissions only), `talent_action_audit_log` (talent CRM-note edits only), `booking_history` (booking status transitions only). Most admin mutations — approve/reject talent or brand, approve/reject/delete a review, block/suspend/unblock, bulk-delete, trusted-brands/blog/notification-broadcast CRUD — have **no audit trail at all** beyond a `moderated_by`/`reviewed_by`/`updated_at` "who did the last thing" column.
- **Aladdin current state:** A single, genuinely unified `audit_log` table (`actor_user_id, actor_role, action, subject_type, subject_id, organization_id, metadata jsonb, created_at`) with 60+ enumerated action types spanning every domain (referrals, jobs, memberships, verifications, points, quotations, orders, ...), already covering everything this audit found admin doing.
- **Gap:** None on coverage/architecture — Aladdin's model is already stronger than Talent's here. The gap is entirely on the **viewer** side (see H2).
- **Classification:** A (already good enough, architecturally)
- **Why it matters:** Recorded so the backlog doesn't propose "add a global audit log" — it already exists and is better-designed than the reference implementation's four-table split.
- **Suggested Aladdin adaptation:** n/a — keep the single-table model; do not fragment it into per-entity tables the way Talent did.
- **Dependencies:** none.
- **Security considerations:** none.
- **Data/migration impact:** none.
- **Priority:** n/a

### H2. Audit log viewer — search/filter/date range
- **Talent implementation:** Each of the four scattered tables is surfaced only inline in its own narrow context (e.g. `admin_role_audit_log` inline on `/admin/roles`) — never a standalone searchable page. So Talent has **no** cross-cutting audit viewer either.
- **Aladdin current state:** `/admin/audit` (`app/admin/audit/page.tsx`) calls `listAudit(supabase, 60)` — a flat, reverse-chronological list, hard-capped at 60 rows, **zero filters**: no actor filter, no action-type filter, no subject-type filter, no date range, no search box, no pagination past the initial 60. The 8-row dashboard widget is the same underlying function. `metadata jsonb` (the field that would show a `points.adjusted` entry's reason or a referral approval's `resolution: linked_existing|created`) is fetched but **never rendered** — invisible without direct DB access.
- **Gap:** With 60+ action types and growing, a flat unfiltered 60-row list stops being useful as an investigation tool almost immediately at real volume — this is where Aladdin is genuinely behind, even though its underlying data model is ahead.
- **Classification:** C (missing, applicable) — the pattern to build (filters, date range, search) has no strong reference implementation in Talent either (H2 gap exists on both sides), so this is Aladdin's own gap to close on its own terms, informed by, not copied from, Talent (which has nothing better here).
- **Why it matters:** An audit log nobody can effectively query is audit data that exists but isn't operationally usable — undermines the whole point of having it.
- **Suggested Aladdin adaptation:** Add `actor`, `action`, `subjectType`, `from`/`to` query params to `listAudit`, each translating to an additional `.eq()`/`.gte()`/`.lte()` filter (small, additive query change); render `metadata` inline (at minimum a "details" expandable row); real pagination past 60.
- **Dependencies:** none.
- **Security considerations:** none new — same RLS-scoped read.
- **Data/migration impact:** none (query-only change).
- **Priority:** P1

---

## I. Entity timeline / history

### I1. Human-readable entity timeline (distinct from raw audit)
- **Talent implementation:** `booking_history` is the closest analog — a dedicated, readable table (`from_status, to_status, changed_by, note`) scoped to one entity type, also readable by the booking's own participants (not just admin).
- **Aladdin current state:** No human-curated timeline exists for a user or organization — the closest thing is the raw `audit_log` (technical, not curated) and the `verifications`/`network_referrals` lists already shown on the detail pages (which *are* a partial timeline, just not labeled or unified as one).
- **Gap:** An admin viewing a user or organization cannot see one readable "Registered → Profile completed → Verification submitted → Approved → Referral joined → ..." narrative in one place; they'd have to mentally assemble it from the separate Memberships/Verifications sections already on the page.
- **Classification:** B (exists but incomplete — the underlying events are already queryable and partially rendered; they're just not assembled into one narrative)
- **Why it matters:** Directly useful for the review-details richness the task calls out (§D) and cheap to build given the data already exists.
- **Suggested Aladdin adaptation:** A derived, read-only timeline view on the user/org detail pages, built by unioning the already-existing per-domain event sources (verifications, network_referrals, audit_log filtered to that subject) sorted by time — no new write path, no new table required initially.
- **Dependencies:** none.
- **Security considerations:** none new.
- **Data/migration impact:** none (read-only composition of existing data).
- **Priority:** P2

---

## J. Points / ledger

### J1. Points ledger architecture
- **Talent implementation:** `profiles.balance` is a **raw mutable numeric column with no ledger/transaction table at all**. `increment_balance(user_id, amount)` is a bare `UPDATE ... SET balance = balance + amount` RPC — its own migration comment states it **had never existed** before a 2026-09-09 fix despite being called from live code, meaning every prior booking left the talent's balance silently uncredited (a real historical data-integrity bug, not backfilled). No admin route/UI to manually adjust a balance exists at all.
- **Aladdin current state:** `points_ledger` (`20260830090001_points_core.sql`) is a fully real, append-only, idempotent ledger: `user_id` is the sole authority column, `organization_id` is context-only (never in a `USING` clause), balance is *derived* (`SUM(points_delta)`, never stored/overwritable), corrections are compensating entries via `reverse_points_entry` (never edits/deletes — no UPDATE/DELETE grant exists to anyone), idempotency is a real unique index on `(user_id, event_type, source_type, source_id)`.
- **Gap:** None on the ledger design — Aladdin's model is unambiguously superior to Talent's raw-mutable-column approach and should never be replaced by it.
- **Classification:** A (already good enough, architecturally)
- **Why it matters:** Recorded explicitly so nothing in the backlog proposes simplifying toward Talent's weaker model.
- **Suggested Aladdin adaptation:** n/a — keep as-is.
- **Dependencies:** none.
- **Security considerations:** none.
- **Data/migration impact:** none.
- **Priority:** n/a

### J2. Points admin UI — the "Network Referrals pattern," again
- **Talent implementation:** No manual-adjustment UI exists in Talent either (there is no ledger to adjust against, only the raw balance column, and no admin route touches it directly).
- **Aladdin current state:** `public.adjust_points(p_user_id, p_points_delta, p_reason_code, p_organization_id)` and `public.reverse_points_entry(p_entry_id, p_reason_code)` **already exist, fully built**: platform-gated (`is_platform('support')`), require a non-null reason code, write a `points.adjusted`/`points.reversed` audit row first (the audit row is the ledger entry's own authoritative `source_id`), never floor the derived balance at zero. **Confirmed via grep: neither RPC is called anywhere in `frontend/src` except the auto-generated `database.types.ts`.** No admin page, no server action — nothing.
- **Gap:** This is the exact same pattern the user already identified once with Network Referrals: a real, secure, audited backend capability with zero admin UI exposing it.
- **Classification:** C (missing, applicable — and a near-zero-engineering-risk one, since the hard part — the RPC — is already done and already tested at the schema level)
- **Why it matters:** An admin currently cannot correct a wrongly-awarded or missing Points entry (e.g. a support ticket about a referral bonus that never arrived) through the product at all.
- **Suggested Aladdin adaptation:** A small admin page (or a panel on the user detail page) showing the caller's ledger history (already queryable) with an "Adjust" action (delta + `reason_code` + optional org context) and a "Reverse" action per entry — thin UI directly over the two existing RPCs, following exactly the pattern already used for `network_referral_approve`/`reject` this session (server action → RPC → `revalidatePath`).
- **Dependencies:** none — the RPCs are complete; this is UI-only work.
- **Security considerations:** none new — the RPCs already enforce everything server-side; the UI is a thin, un-privileged wrapper.
- **Data/migration impact:** none.
- **Priority:** **P0** (same tier as A3/A4 — an already-built, already-secure capability sitting completely unreachable is the cheapest possible P0 to close)

---

## K. Duplicate detection / link / merge

(Consolidated into B2/B3 above — organization-scoped, since Aladdin has no other entity type where this currently applies.)

---

## L. Admin roles / RBAC

### L1. Permission model granularity
- **Talent implementation:** A real, DB-backed resource+action ACL — `admin_roles`/`admin_role_permissions` (21 resource keys × read/create/update/delete), fails **closed** once a role is assigned to an admin (`profiles.admin_role_id` set), fails **open** only for legacy unrestricted admins (`admin_role_id IS NULL`, a deliberate migration-time compatibility choice). Roles are admin-creatable (`/admin/roles`, `requireSuperAdmin`-gated), not fixed. Three seeded presets (`full_admin`, `admin_no_delete`, `leads_moderator`) demonstrate real separation-of-duties is achievable (e.g. a leads-only moderator role). Changes are audited (`admin_role_audit_log`).
- **Aladdin current state:** Exactly 3 flat, **hierarchical** platform roles (`support < moderator < administrator`, via `app.is_platform(p_role)` — a role satisfies a check if it equals the required role OR is `administrator` OR is `moderator` when `support` was required). Confirmed by reading every gated RPC found this session: `review_approve/reject`, `network_referral_approve/reject`, `showroom_referral_approve/reject`, `adjust_points`, `reverse_points_entry` **all gate on `is_platform('support')` alone** — meaning all three roles can currently do all of these identically. Only two isolated call sites were found gated strictly to `'administrator'` (RLS policies in `20260802090003_audit_foundation.sql:48` and `20260802090002_organizations_tenancy.sql:433`), and one to `'moderator'` (job-review restore, `20260909090001_job_reviews.sql:357`).
- **Gap:** This directly contradicts Aladdin's *own already-approved* specification: `docs/technical/07_permissions_matrix.md` §5 explicitly differentiates the three roles — "Cross-tenant read: scoped/audited (Support) / moderation surfaces (Moderator) / full (Administrator)"; "Govern orgs (suspend/archive): — / — / ✔ (Administrator only)"; "Manage reference data: — / — / ✔ (Administrator only)." The implementation has not caught up to the spec it was written against.
- **Classification:** F (product decision required) for the specific tier assignment of each existing RPC; D (reference pattern only) for whether to adopt Talent's fully dynamic resource×action model.
- **Why it matters:** Right now, granting anyone the `support` role — the lowest tier, presumably intended for the most junior/limited staff — silently gives them the power to approve organization verifications, adjust anyone's Points balance, and approve referrals that create real organizations. There is no way today to have a narrowly-scoped support agent per the spec's own intent.
- **Suggested Aladdin adaptation:** Do **not** adopt Talent's fully dynamic, admin-creatable resource×action model wholesale — Aladdin's capability system (`docs/technical/07_permissions_matrix.md` §2, a fixed, governance-controlled key catalog) is the established Aladdin pattern, and platform roles should likely follow the same "fixed set, governance-controlled" philosophy rather than Talent's open-ended role editor. The concrete, minimal fix: **re-tier the existing gated RPCs to match the already-approved spec** — e.g. `adjust_points`/`reverse_points_entry` and org-suspend (A4) to `is_platform('administrator')`, keep verification/referral review at `'support'` as the spec's "decide (cap)" row already implies for all three tiers. This is a *narrower*, safer scope than importing Talent's role-editor UI.
- **Dependencies:** should land together with A3/A4/J2 rather than as a separate pass, since it changes *which* tier those new capabilities require.
- **Security considerations:** this is itself a security-hardening item — closing a real gap between documented intent and enforced behavior.
- **Data/migration impact:** none for re-tiering existing checks (literal string changes in existing RPC bodies via `create or replace function`); see PD-008 for whether a `/admin/roles`-equivalent UI is ever wanted.
- **Priority:** **P0** for re-tiering the sensitive RPCs (A4, J2) correctly as they're built; P2/Later for any general-purpose role-editor UI (see PD-008).

### L2. Roles management UI
- **Talent implementation:** `/admin/roles` — full CRUD on roles/permissions, `create-admin` (provisions a real login), assignment UI, inline audit log.
- **Aladdin current state:** No UI exists to grant/revoke `platform_role_grants` at all. Per `supabase/seed.sql`'s own comment, this is "the documented server-side/DBA provisioning path... no ordinary-user write path exists" — a deliberate current-state choice, not an oversight (mirrors Talent's own now-removed `/api/admin/promote-admin`, which Talent's team explicitly deleted as a security risk once real admins existed).
- **Gap:** None urgent — Aladdin's current DBA-only provisioning is arguably the *safer* posture Talent eventually converged toward removing its own equivalent bootstrap hole. Only becomes a real gap if/when platform staff turnover makes DBA-mediated grants operationally slow.
- **Classification:** D (reference pattern only) — useful precedent for *if and when* Aladdin outgrows DBA-only provisioning, not a current gap.
- **Why it matters:** Recorded so this isn't silently proposed as a near-term build — it would reopen exactly the kind of bootstrap risk Talent's own team closed.
- **Suggested Aladdin adaptation:** Defer; if ever built, require `is_platform('administrator')` (or a future Super Admin tier) and full audit, matching Talent's `requireSuperAdmin` + `admin_role_audit_log` pattern.
- **Dependencies:** L1 (a role-editor UI is meaningless without first deciding whether Aladdin wants a fixed or dynamic role model).
- **Security considerations:** self-escalation risk — any such UI must be unable to let a role holder grant themselves more power (Talent's own safeguard: `requireSuperAdmin` checks specifically for `admin_role_id IS NULL`, an unrestricted account).
- **Data/migration impact:** significant if ever built (new tables mirroring `admin_roles`/`admin_role_permissions`, or extending `platform_role_grants`).
- **Priority:** Later

---

## M. Admin dashboard

### M1. Dashboard metrics and actionable linking
- **Talent implementation:** `DashboardCard.tsx` confirmed to have **no `href`/`onClick`** — Talent's own dashboard cards are *not* clickable either (verified by the inventory agent).
- **Aladdin current state:** 4 tiles (total users, total orgs, pending reviews, active users) + 3 distribution lists + recent-activity feed. Only 1 of 4 top tiles (pending reviews) links to its filtered view (`app/admin/page.tsx:52`); the other 3 and the distribution lists are static.
- **Gap:** Aladdin is already slightly ahead of Talent here (1 linked tile vs. 0), but both fall short of "every card links to its filtered records."
- **Classification:** B (exists but incomplete)
- **Why it matters:** A dashboard that shows "14 active users" with no way to click through to see who they are is a display, not a tool.
- **Suggested Aladdin adaptation:** Link every stat tile and distribution-list entry to its corresponding filtered list view (requires A1/A2's filter support to be meaningful — e.g. linking "orgs by status: suspended" needs the org list to support a status filter first).
- **Dependencies:** A1, A2 (filters must exist on the destination pages for the links to be meaningful).
- **Security considerations:** none.
- **Data/migration impact:** none.
- **Priority:** P2

---

## N. Global admin search

### N1. Cross-entity search
- **Talent implementation:** Confirmed **does not exist** — no command palette, no cross-entity search component found anywhere (each table has only its own local filter).
- **Aladdin current state:** Confirmed **does not exist**, and explicitly **by design**: `app/admin/layout.tsx`'s own comment states "Admin record search is deliberately not wired here: the console's own lists are the searchable surface, and a second path into platform-wide data is a second place to get the gate wrong."
- **Gap:** None — both platforms lack this, and Aladdin's absence is a documented, deliberate architectural choice, not an oversight.
- **Classification:** E (Talent-specific — moot, since Talent doesn't have it either) with the note that Aladdin's stance is a considered non-gap.
- **Why it matters:** Recorded so this isn't proposed as a "catch-up" item — there is no working reference implementation to catch up to, and Aladdin's own reasoning for not building it (one fewer place to get an authorization check wrong) is sound.
- **Suggested Aladdin adaptation:** n/a unless A1/A2's per-list search proves insufficient in practice.
- **Dependencies:** none.
- **Security considerations:** the stated reason (search is a second surface that could leak cross-tenant data if the gate is wrong) is valid and should stay the default posture.
- **Data/migration impact:** none.
- **Priority:** Later (revisit only if per-list search, once built per A1/A2, proves insufficient)

---

## O. Server-side filtering / pagination

(Consolidated into A1/A2 above — this is the concrete mechanism those rows call for.)

---

## P. Admin notifications / badges

### P1. Pending-work badges in admin nav
- **Talent implementation:** Confirmed **does not exist** (`AdminSidebar.tsx` grepped for count/pending/badge — no numeric indicators found).
- **Aladdin current state:** Does not exist (`components/admin/admin-nav.tsx` has no badge/count rendering).
- **Gap:** None — parity with Talent, both lack it.
- **Classification:** C (missing, applicable) — genuinely useful regardless of Talent's absence, since Aladdin's dashboard already computes `pendingVerifications` (and could compute pending referral counts) — the data exists, just not surfaced in the nav itself.
- **Why it matters:** A small, low-risk addition that speeds up an admin's daily "what needs my attention" loop.
- **Suggested Aladdin adaptation:** A badge on the "Verifications" nav item showing the same `pendingVerifications`-style count already computed for the dashboard (extend to include pending Network/Sales referrals now that both live on that page).
- **Dependencies:** none.
- **Security considerations:** none.
- **Data/migration impact:** none (reuses existing counts).
- **Priority:** P2

---

## Q. Safe destructive actions

### Q1. Destructive-action discipline (confirmation, reason, audit, soft-delete)
- **Talent implementation:** `ConfirmationModal.tsx` used broadly (18 call sites) but is a generic confirm/cancel shell — it does **not** itself capture a reason; reason capture is inconsistent (present for verification/talent reject/suspend, **absent** for review delete, support-ticket delete, and talent hard-delete). **No soft-delete pattern exists anywhere** (grepped `deleted_at`/`is_deleted`/`soft.delete` across the whole repo — zero matches); every delete route performs a genuine SQL `DELETE`.
- **Aladdin current state:** The only destructive-adjacent actions that currently exist at all are the three review-reject flows, all of which **require** a reason (enforced client- and server-side). There is no delete action anywhere in Aladdin admin today (consistent with A3/A4's finding that essentially no write actions beyond review-decisions exist yet). `organizations.deleted_at` exists as a soft-delete column but nothing in admin ever sets or clears it.
- **Gap:** Aladdin's narrow existing surface (reject-with-reason) is actually more disciplined than Talent's broader-but-inconsistent one. The gap is forward-looking: as A3/A4/J2's new destructive actions (suspend, adjust points) get built, they must not regress to Talent's inconsistent pattern.
- **Classification:** A (already good enough) for what exists today; a standing constraint (not a gap) for what gets built next.
- **Why it matters:** Recorded as a design constraint for the backlog: every new destructive/adjustment action proposed in this matrix (A3, A4, J2) must require a reason and be fully audited from day one, matching the bar Aladdin's existing reject flows already set — not Talent's inconsistent one.
- **Suggested Aladdin adaptation:** n/a as a gap; carry forward as an explicit acceptance-criterion on every P0 backlog item below.
- **Dependencies:** none.
- **Security considerations:** this row *is* the security consideration for A3/A4/J2.
- **Data/migration impact:** none.
- **Priority:** n/a (a constraint, not a backlog item)

---

## R. Export / operations

### R1. Data export
- **Talent implementation:** Confirmed **does not exist** — `lib/leads/csv.ts` is import parsing only; no `.csv`/`Content-Disposition`/blob-download pattern found anywhere.
- **Aladdin current state:** Does not exist. Notably, `docs/technical/07_permissions_matrix.md` already **specifies** an `export.data` capability and an "Exports" domain (org-member self-service export to a private `exports/` path, plus platform-wide admin export) — this is a designed-but-unbuilt capability on the Aladdin side, independent of anything Talent does or doesn't have.
- **Gap:** Neither platform has a working reference implementation to adapt from; Aladdin's own spec already anticipates this.
- **Classification:** F (product decision required) — mainly "when," since the spec already exists; not blocked on Talent for a pattern.
- **Why it matters:** Useful for compliance/reporting asks, but with no working reference in either codebase and no current operational pain reported, this is not urgent.
- **Suggested Aladdin adaptation:** Build directly against Aladdin's own already-approved `export.data` capability spec (§07_permissions_matrix.md) when prioritized — no Talent pattern to lean on.
- **Dependencies:** none blocking.
- **Security considerations:** must respect the same tenant scoping org-side export already implies; admin export is platform-wide and should be audited (the spec already says so: "Administrator | ✔ | platform (audited)").
- **Data/migration impact:** depends on implementation (likely a background job for large exports, per the spec's own "private `exports/`" storage note).
- **Priority:** Later

---

## S. AR/EN + RTL/LTR

### S1. Translation-key parity mechanism
- **Talent implementation:** Confirmed **no shared i18n catalog exists at all** — no `messages/`/`i18n/`/`locales/` directory, no test file matching `locale|i18n|translat|lang` among 31 test files. Every bilingual string is a per-component hardcoded `{ar, en}` object (`TX`), manually kept in sync by whoever writes that component, with **zero automated mechanism** to catch a string added in one language and not the other.
- **Aladdin current state:** A real, shared, centralized `en.ts`/`ar.ts` message catalog with an automated key-parity test (`i18n.test.ts`, 20 tests) — confirmed passing this session immediately after adding new `admin.networkReferrals.*` keys to both files, proving the parity check is live and load-bearing, not aspirational.
- **Gap:** None — Aladdin's i18n architecture is unambiguously stronger than Talent's here.
- **Classification:** A (already good enough, architecturally superior to the reference)
- **Why it matters:** Recorded explicitly per the task's requirement to audit this axis, and so nothing in the backlog proposes "simplifying" toward Talent's per-component pattern.
- **Suggested Aladdin adaptation:** n/a — keep the shared catalog + parity test as the mandatory pattern for all future admin (and non-admin) UI work, exactly as this session's own Network Referral admin UI followed it.
- **Dependencies:** none.
- **Security considerations:** none.
- **Data/migration impact:** none.
- **Priority:** n/a

---

## Talent-specific capabilities — not applicable to Aladdin (E)

Recorded for completeness per the task's Step 2/5 instructions, each with the reason it doesn't transfer:

| Talent capability | Why it's Talent-specific (E), not Aladdin-applicable |
|---|---|
| **Candidates** (`/admin/candidates`) — internal HR/recruiting pipeline (stages, categories, CSV/Sheet import) | This is Talent's own internal hiring tool, unrelated to their marketplace domain and unrelated to Aladdin's. No Aladdin equivalent need identified. |
| **Leads** (`/admin/leads`) — platform-level sales-prospect CRM | Structurally similar to a CRM, but this is a *platform-admin-level* internal sales tool for Talent's own team, distinct from Aladdin's existing **per-organization** Sales `customers`/`leads`/`followups` domain (ADR-0008), which already serves the equivalent need inside each B2B tenant's own workspace. Building a *second*, platform-level lead CRM for Aladdin's own internal sales team is a genuinely different product question, not a gap in the existing system — see PD-007 if that need is ever raised. |
| **Blog admin** (`/admin/blog`) | Talent's own content-marketing surface; Aladdin has no blog today and no stated need for one in the audited scope. |
| **Testimonials / Brand moments / Trusted brands** (marketing CMS pages) | Landing-page content management for Talent's own marketing site; not part of Aladdin's admin scope as audited (Aladdin's landing/preview work is a separate, already-active workstream — see recent `AGENT_WORK_LOG.md` entries — with its own content model). |
| **Packages / Categories admin** (pricing tiers, talent/brand taxonomy) | Talent-domain-specific taxonomy admin; Aladdin already has its own trade-taxonomy migration (`20260901090001_trade_taxonomy.sql`) and no subscription/package system is in scope for this audit. |
| **Support tickets** (`/admin/support`, `contact_messages`) | Recorded here rather than as a "missing" row deliberately: Aladdin has no contact-form/support-ticket system of any kind today, and whether Aladdin wants a Talent-style *admin-managed* ticket queue vs. a different support channel (e.g. routed through existing Chat) is a genuine product question, not an obvious adopt — see PD-009. |

---

## Reference-pattern-only capabilities not already covered above (D)

| Talent capability | Adoptable pattern | Reason it's reference-only |
|---|---|---|
| **Health check** (`/admin/health-check`) — on-demand ops self-diagnostic (integration status, security self-probe, performance probe, AI-generated recommendations) | The *concept* of a single-page operational self-diagnostic for platform staff is generically useful | Talent's specific checks (Cloudinary usage, its own CSP/route probes) are 100% Talent-stack-specific; an Aladdon equivalent would need entirely different checks (Supabase/Vercel health, AI service reachability, migration-drift status) designed from scratch, not ported |
| **Streaming CSV/Sheet import with NDJSON progress** | The *UX pattern* (streamed progress instead of a blocking spinner for a long-running bulk import) is a good general pattern | No current Aladdin admin workflow needs bulk import of external records; nothing to attach this pattern to yet |
| **Sortable table columns** (`SortableTh`, `parseSortParam`, consistent `?sort=&dir=` URL contract) | Directly reusable *pattern* for A1/A2 | Already folded into A1/A2's suggested adaptation above — listed here only to name the specific reusable mechanism |
| **Bulk-assign / allow-listed bulk-delete** | The *allow-list* discipline (only cascade-safe, list-management tables get bulk delete; explicitly excluding anything with payment/moderation/reputation history) is a sound safety pattern | No current Aladdin admin table has the list-management-at-scale profile (many rows, routine cleanup need) that would justify bulk actions yet; premature to build |
| **Three-layer auth enforcement** (middleware page-nav gate + layout role check + per-route re-check) | The *defense-in-depth* principle is sound and already Aladdin's own stated posture | Aladdin's actual mechanism (RLS + SECURITY DEFINER RPC as the true boundary) is architecturally different from and stronger than Talent's (service-role-bypass + hand-written per-route checks, explicitly described by Talent's own CLAUDE.md as "defence-in-depth backstop," not primary) — adopt the *principle*, never the *mechanism* |
| **Rejection-reason taxonomy concept** *(see A5)* | listed here for cross-reference only | already covered under A5/F |
