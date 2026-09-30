# Product Decisions Register — Admin Gap Analysis

| | |
|---|---|
| **Status** | **APPROVED: PD-001–006, PD-008 (re-decided 2026-09-29), PD-010–016. DEFERRED: PD-007, PD-009.** PD-001–013 were decided on 2026-09-19; PD-008's deferral was replaced and PD-014/PD-015/PD-016 were added by the Product Owner on 2026-09-29 (Phase 0D). None of PD-001/002/003/008/010/011/012/015's approved semantics have been implemented in the backend yet — approval sets the target behavior; the current live behavior each documents remains unchanged until its own backlog item is built (see `ADMIN_IMPLEMENTATION_BACKLOG.md`). PD-014 is the one decision whose core is already live on `main` (see its *Current implementation* block). |
| **Version** | 3.0.0 |
| **Owner** | Product / Foundation |
| **Last Updated** | 2026-09-29 (Phase 0D — PD-008 approved as "Adapt CRM Dynamic RBAC to Aladdin"; PD-014 and PD-015 added) |
| **Depends On** | [`ADMIN_FEATURE_MATRIX.md`](ADMIN_FEATURE_MATRIX.md) |
| **Related** | [`ADMIN_IMPLEMENTATION_BACKLOG.md`](ADMIN_IMPLEMENTATION_BACKLOG.md), [`../database/points-core.md`](../database/points-core.md), [`PD-011_ORG_SUSPENSION_MODULE_EFFECTS.md`](PD-011_ORG_SUSPENSION_MODULE_EFFECTS.md) |

Every row below is a real business-rule question surfaced by the Admin gap analysis. PD-001 through PD-012 originally each carried a recommended *engineering-safe default* and a status of NEEDS OWNER DECISION; the Product Owner has now reviewed and approved (or deferred) each one, recorded in its **Decision (2026-09-19)** block. The original options/consequences analysis is kept underneath each decision as the recorded rationale — it is what the decision was made against, not a live open question anymore. PD-013 is a new, directly-approved architecture/delivery decision (frontend-first Admin delivery) with no prior "needs decision" state. **Approval here is a decision on target semantics and scope, not an implementation** — nothing in this register authorizes a schema/status-model/RLS/Points-rule change by itself; each approved decision is implemented only through its corresponding, separately-approved backlog item.

---

## PD-001 — Referral approval vs. organization actually joining

**Decision (2026-09-19, approved):** **Option B, target semantics only — not implemented yet.** Admin approval means the referral is accepted/verified; it does **not** inherently mean the organization has actually joined Aladdin. Target conceptual lifecycle: `pending → approved → invited → joined`. The exact transition mechanics (what marks `invited`, what marks the final `joined`) depend on Aladdin's existing invitation/account-claim architecture and are **not specified by this decision** — that mechanics design is separate follow-up work, not authorized to build from this approval alone. **Current live behavior** (`network_referral_approve` takes `pending` straight to `joined` in one step, per the "Current Aladdin behavior" section below) **remains unchanged in this phase** — this decision records the target, distinct from what runs today, per the task's explicit instruction not to implement the lifecycle migration yet.

**Topic:** What does "Admin approved this Network referral" mean?

**Current Aladdin behavior:** `network_referral_approve` (`supabase/migrations/20260911090001_network_referrals.sql`) takes a `pending` referral directly to `joined` in one step, simultaneously (a) materializing a new, **unowned**, `pending_verification`, unverified organization + primary branch, and (b) awarding the referrer +100 Points (only when a genuinely new org was created, never on link-to-existing). There is no membership, no owner, and no further step — the referral's own status is already terminal (`joined`) the instant admin approves it, even though the resulting organization has no one signed in as it yet and is not verified.

**Talent behavior, if relevant:** No direct analog (Talent has no referral/organization concept). The closest structural precedent is `booking_briefs.status`, which *did* need to grow a `changes_requested` intermediate state after `pending|accepted|rejected` proved too coarse for real usage — a general precedent that a two-state model sometimes needs a third state once real behavior is observed, not a specific parallel to this decision.

**Available options:**
- **A. Approval = admin verified the referral is a real, legitimate business.** Nothing more. "Joined" already means this today, and that's fine as the referral's own status — the organization's *own* `status`/`is_verified` fields are the correct place to track whether it has actually onboarded, and admin approving the referral is not claiming otherwise.
- **B. Approval should mean the organization actually joined Aladdin** (someone signed in as it, completed onboarding). This would require an intermediate lifecycle — e.g. `pending → approved → invited → joined` — where `approved` creates the organization (as today) but the referral itself only reaches `joined` once an owner/member actually activates it.

**Consequence of each option:**
- **A:** No change needed. The referral's `joined` label is a slight misnomer (it really means "resolved, organization exists") but is harmless if understood that way; the organization's own status fields already carry the real "has it joined" truth, so no information is lost — just potentially confusingly named at the referral-table level.
- **B:** Requires a new intermediate status, a new trigger event (something must mark the referral `joined` once the organization activates — likely tied to the first membership grant or the org's `status` leaving `pending_verification`), and reconsideration of *when* Points should award (see PD-003) — awarding at `approved` vs. at the new, later `joined` would change the referrer's incentive timing materially.

**Data model impact:** Option B requires a new `network_referral_status` enum value (additive) and a new trigger/RPC call site wherever "an organization actually activates" is determined — currently not fully defined anywhere as a single event.

**UX impact:** Option B changes what the installer's Network page shows for an approved-but-not-yet-active referral (`"pending activation"` vs. today's immediate `"joined"`).

**Backward-compatibility impact:** Every existing `joined` row today means "resolved (case A's current meaning)." If B is adopted, historical rows cannot be distinguished from new semantics without a backfill decision (do old `joined` rows get reinterpreted as the new terminal state, or as an intermediate one no longer reachable going forward?).

**Recommended engineering-safe default (superseded by the approved decision above):** Option A was the original engineering-safe recommendation; the Product Owner approved Option B's target semantics instead, kept here as the record of what was weighed.

**STATUS: APPROVED — 2026-09-19 (target semantics only; not yet implemented — see `ADMIN_IMPLEMENTATION_BACKLOG.md` for the follow-up item)**

---

## PD-002 — Rejected vs. cancelled

**Decision (2026-09-19, approved):** **Option B, target semantics only — not implemented yet.** `rejected` and `cancelled` represent different business events: `rejected` = an admin decision; `cancelled` = submitter withdrawal or an explicit operational cancellation. **Existing DB statuses are not to be changed yet** — this decision fixes the target data model (see PD-002's own migration/backfill considerations below) for a later, separately-scoped backlog item, not an authorization to migrate `network_referrals.status` in this phase.

**Topic:** Should an admin's rejection of a referral be distinguishable, in the data, from the referrer withdrawing it themselves?

**Current Aladdin behavior:** Both `network_referral_reject` (admin decision) and `network_referral_cancel` (referrer's own withdrawal) set the referral to the **same** terminal status, `cancelled`. The only difference recorded is `decided_by` (set to the acting admin on reject, the referrer on cancel) and, for rejection only, a required `decision_reason`. The two are audited under different action names (`network_referral.rejected` vs. `.cancelled`), but the referral's own `status` column cannot tell them apart without cross-referencing the audit log.

**Talent behavior, if relevant:** No direct analog. Talent's `booking_briefs.status` distinguishes `rejected` (the talent's own decision) from nothing resembling a "cancelled" concept at that layer — bookings separately have a `cancelled` status, but it's a different actor/meaning (either party abandoning the whole booking), not a rejected-vs-withdrawn distinction on the same request.

**Available options:**
- **A. Keep as-is.** `cancelled` is the single terminal negative state; `decided_by` + the audit log already carry "who ended this and why" for anyone who needs to distinguish rejected-by-admin from withdrawn-by-referrer.
- **B. Split into two distinct statuses** (`rejected` for admin decisions, `cancelled` for referrer withdrawal), so the distinction is visible directly on the row and in any UI/report built against `network_referrals.status` alone, without joining to `audit_log`.

**Consequence of each option:**
- **A:** No change. Any future feature that needs to distinguish the two (e.g. "show referrers their rejection reason but not a withdrawal reason," or a report on rejection rate specifically) must join through `audit_log`/`decided_by`, which is workable but an extra step every time.
- **B:** Cleaner at the referral-row level; requires updating the CHECK constraints (`ck_netref_case_a_status`, `ck_netref_decision_stamp`), the two RPCs, the read model (`my_network_referrals`), and the installer-facing UI's status badge/copy (currently a single "declined" concept covers both — would need to decide whether the installer-facing copy should actually *say* something different for "you withdrew this" vs. "this was rejected," which is itself a UX question, not just a data one).

**Data model impact:** Option B is a genuine, non-trivial migration: a new enum value, updated CHECK constraints, updated RPC bodies (`create or replace function`, so no data migration needed for the *functions*, but existing `cancelled` rows would need a one-time backfill decision — reinterpret every historical admin-rejected row as `rejected` retroactively, using `decided_by`/audit-log cross-reference, or leave history as `cancelled` and only split going forward).

**UX impact:** Option B changes the installer-facing "Pending invitations" tab's copy/badge for a rejected referral — today both show generically as no-longer-pending; splitting invites (but doesn't require) showing "declined by review" vs. "withdrawn" differently.

**Backward-compatibility impact:** Real, as described above (historical `cancelled` rows are ambiguous under the new model unless backfilled).

**Recommended engineering-safe default (superseded by the approved decision above):** Option A was the original recommendation; the Product Owner approved Option B's target semantics (a real `rejected`/`cancelled` split) instead, kept here as the record of what was weighed, including the backfill and constraint-rewrite cost the follow-up implementation must account for.

**STATUS: APPROVED — 2026-09-19 (target semantics only; existing DB statuses unchanged until the corresponding backlog item is built)**

---

## PD-003 — Referral Points trigger timing

**Decision (2026-09-19, approved):** **A later-milestone option, target semantics only — not implemented yet.** Referral reward Points should be awarded on the actual successful JOIN milestone — not merely admin approval, and not merely creation of a placeholder/unowned organization. The reward must remain idempotent and tied to the specific referral/reference (i.e. the existing `(user_id, event_type, source_type, source_id)` idempotency guarantee must be preserved under whatever the new trigger point becomes). **Current behavior is not changed yet** — Points continue to award at approval/creation, exactly as documented below, until the "actual JOIN milestone" is itself precisely defined (this decision approves the *principle*, not yet a specific new trigger point — see the "Options for when Points COULD instead trigger" list below for the candidates still to be chosen among) and a follow-up backlog item builds it. This decision is coupled to PD-001: the "actual JOIN milestone" this refers to is the same `joined` state PD-001's target lifecycle introduces.

**Topic:** At which exact milestone should the referral Points reward fire?

**Current implementation (documented exactly, not changed):** Both `network_referral_approve` and `showroom_referral_approve` award the referrer +100 Points **at the moment admin approval creates a genuinely new organization** — i.e., at the same instant PD-001 discusses. Specifically: `award_points(... p_event_type => 'referral.organization_approved' ...)` fires only when `organizations.source = 'installer_referral' (or salesperson_referral)` AND `referred_by_user_id is not null` are true on the row just inserted — i.e., only on the "create" path, never on the "link to an existing organization" path (confirmed no award fires when an admin links a referral to a pre-existing org). This is a single, idempotent, same-transaction award (`ux_points_ledger_event_identity` unique index prevents any double-award on retry or repeated approval calls).

**Options for when Points COULD instead trigger** (per the task's own list):
- **Admin approval** *(current behavior)* — reward is decoupled entirely from what happens to the organization afterward; the referrer is rewarded for a verified, legitimate lead, full stop.
- **Organization creation** — functionally identical to the current behavior today (creation and approval are the same transaction), but would diverge under PD-001 Option B (if approval no longer immediately creates the final-state organization).
- **Organization account registration** (someone actually signs up as/into that organization) — rewards actual onboarding, not just a verified lead; requires a new trigger point tied to first membership grant.
- **Invitation acceptance** — presupposes an invitation step that does not currently exist in this flow (case B never invites anyone — "the referrer receives NO membership... a Network referral is attribution, never employment," per the migration's own comment — so there is no natural "invitation" concept here to hang this on without inventing one).
- **Verified organization activation** (`organizations.is_verified` flips true via the separate `apply_organization_verification` flow) — rewards a fully trusted, live organization, the highest bar of the options listed.
- **Another explicit joining milestone** — undefined; would need to be specified before this option is even comparable to the others.

**Consequence of each option:**
- **Admin approval (current):** Simple, already built, already tested (pgTAP), already verified end-to-end live this session (installer earned +100 the moment admin approved). Risk: a referrer is rewarded even if the resulting unowned, unverified organization never actually gets claimed/activated by anyone — the "was this referral actually worth something" signal is weaker than a later milestone would provide.
- **Organization registration / activation / another later milestone:** Stronger signal that the referral produced real value, but requires: (a) a new trigger point precisely defining that milestone (none currently exists for "an organization was claimed" as a discrete event), (b) holding the Points award in a pending-eligible state between approval and that milestone (a new intermediate ledger/queue concept, since the current `points_ledger` is append-only and has no "pending, not yet awarded" state — this would be new architecture, not a parameter change), and (c) deciding what happens if the milestone never occurs (does the referrer simply never get rewarded? indefinitely?).

**Data model impact:** Staying with admin-approval timing: none. Moving to any later milestone: meaningful new architecture (a pending-award mechanism that doesn't exist today) — not a small change.

**UX impact:** A later trigger means the installer's Points balance would not update immediately upon seeing their referral marked "joined" — a real experience change from what was just verified working this session.

**Backward-compatibility impact:** The one already-awarded live-tested entry from this session (100 Points to the `sayed@example.test` local test account) is not production data, but any production-scale change in trigger timing would need to decide whether already-awarded historical Points get clawed back (via `reverse_points_entry`, the correct mechanism if ever needed) or are grandfathered.

**Recommended engineering-safe default (superseded by the approved decision above):** Keeping the current trigger was the original recommendation, specifically because moving to a later milestone requires new pending-award architecture (`docs/database/points-core.md` has no "pending, not yet awarded" ledger state today). The Product Owner approved the later-milestone principle regardless; **the follow-up backlog item must design that pending-award mechanism** rather than assume it already exists — this is flagged here so the implementation doesn't understate the work.

**STATUS: APPROVED — 2026-09-19 (principle only: award on actual JOIN, not approval/creation; current trigger unchanged until the follow-up item defines and builds the new trigger point)**

---

## PD-004 — Platform-role tiering for new destructive/adjustment actions

**Decision (2026-09-19, approved):** **Keep the existing fixed 3-tier role architecture** (`support`/`moderator`/`administrator`) — do **not** build dynamic RBAC management (see PD-008, deferred). But **enforce meaningful server-side permission separation going forward**: sensitive actions must not all be reachable through the lowest platform tier (`support`) the way most existing gated RPCs currently allow. Each specific new capability's exact tier (user suspend, org suspend, Points adjustment, etc.) is decided per-capability in its own PD (see PD-010, PD-011, PD-012) rather than by one blanket rule here — this decision approves the *principle* (real separation must exist) and rules out both extremes (Option A "everything at support" is rejected; Option B "adopt Talent's dynamic ACL" is deferred, not chosen).

**Topic:** Which of the three platform roles (`support`/`moderator`/`administrator`) should be required for the new capabilities this audit recommends (A3 user suspend, A4 org suspend, J2 Points adjustment)?

**Current Aladdin behavior:** None of these capabilities exist yet, so there is no current behavior to preserve — this decision gates how they get *built*, not a change to something live. For context: essentially every existing gated write RPC in the system uses `is_platform('support')` (the lowest tier, which the hierarchy also satisfies via moderator/administrator), meaning today's *only* real distinction the three roles carry in practice is at two isolated RLS policies and one moderation RPC (see `ADMIN_FEATURE_MATRIX.md` §L1).

**Talent behavior, if relevant:** Talent's `admin_no_delete`/`leads_moderator` seeded roles demonstrate a working precedent for withholding destructive capability from a lower tier while granting read/update — directly relevant as a *pattern* (not a specific tier to copy, since Talent's role names don't map onto Aladdin's).

**Available options:**
- **A. Gate all three new capabilities at `'support'`** (the current de-facto pattern for everything else) — simplest, consistent with existing code, but means the lowest platform tier can suspend a user, suspend an organization, and move Points.
- **B. Gate at `'administrator'` only**, matching `docs/technical/07_permissions_matrix.md` §5's already-approved spec ("Govern orgs: Administrator only").
- **C. Split by blast radius** — e.g. Points *reversal* (correcting a clear error) at `support`, Points *adjustment of an arbitrary amount* at `administrator`; user suspend at `moderator`+ (a trust-and-safety action, arguably a Moderator's core job); org suspend (affects every member of a tenant) at `administrator` only.

**Consequence of each option:**
- **A:** Fast to build, but perpetuates the spec-vs-implementation gap this audit already flagged (L1) rather than closing it.
- **B:** Matches the approved spec exactly; simplest to defend in a security review; may be operationally slower if `administrator` grants are scarce/DBA-mediated (see L2) and routine corrections (e.g. a small Points fix for a clear support-ticket error) then require administrator involvement for something that feels low-risk.
- **C:** Best matches real operational risk levels, but requires a case-by-case tiering decision (this register row) rather than one blanket rule, and is the most work to specify precisely.

**Data model impact:** None for any option — this is purely which literal string (`'support'` / `'moderator'` / `'administrator'`) each new RPC's `is_platform(...)` call uses.

**UX impact:** Determines which staff accounts can see/use the new admin buttons once built (buttons should be hidden for a role that can't use them, per normal UX, but the RPC-level gate is what actually matters).

**Backward-compatibility impact:** None (new capabilities, no existing behavior to preserve).

**Recommended engineering-safe default (adopted, refined by PD-010/011/012):** Option B/C's blast-radius-based split is the approach carried forward — org suspend and Points adjustment are gated at `administrator` (see PD-011, PD-012); user suspend's exact tier is set in PD-010's own text ("administrator-only initially" for Points per PD-012's explicit text — PD-010 does not itself restate a tier and should be read together with PD-004's principle at implementation time, i.e. not defaulting to `support`).

**STATUS: APPROVED — 2026-09-19 (principle: real separation of duties required, fixed 3-tier model retained, no dynamic RBAC; exact per-capability tiers in PD-010/011/012)**

---

## PD-005 — Structured rejection-reason taxonomy

**Decision (2026-09-19, approved):** **Option B.** Rejection flows must support a **required** `reason_code` (e.g. `duplicate | invalid_information | unable_to_verify | incomplete_information | not_eligible | other`) **plus an optional internal Admin note**. The internal note and the user-visible rejection message **must remain separate concepts** — the note is never shown to the rejected subject, and the existing free-text reason field (which is what may be user-visible, depending on the flow) is not replaced by the code, it is supplemented by it. This is a scope refinement over the original proposal below (which had the code as *optional* alongside a *required* free-text reason) — under the approved decision, `reason_code` becomes required, and the separate internal-note field is new (previously unscoped in this PD, now explicit and shared with G1/BL-008's admin-notes capability).

**Topic:** Should verification/referral rejection reasons move from free text only to a structured code (optionally alongside free text)?

**Current Aladdin behavior:** Every rejection path (`review_reject`, `network_referral_reject`, presumably `showroom_referral_reject`) requires a non-empty free-text reason, with no fixed taxonomy.

**Talent behavior, if relevant:** Also free-text only everywhere — Talent offers no working precedent for a taxonomy to adopt (confirmed by the Talent inventory agent). The candidates/leads pipeline's `stage_answers` JSON (a structured form captured only for specific pipeline stages like "Rejected") is the closest analog, but is a custom-per-stage-form pattern, not a fixed reusable reason-code enum.

**Available options:**
- **A. Keep free text only.** No change.
- **B. Add an optional structured `reason_code`** (e.g. `duplicate | invalid_information | unable_to_verify | incomplete_information | not_eligible | other`) alongside the existing required free-text field — the free text becomes the human-readable detail, the code becomes the reportable/filterable dimension.

**Consequence of each option:**
- **A:** No engineering cost; rejection data remains unstructured (cannot answer "what % of rejections are duplicates" without manual reading).
- **B:** Enables reporting/analytics on rejection patterns and speeds up reviewer decisions (pick a code, optionally add detail) at a small, purely additive cost.

**Data model impact:** Option B: an additive nullable enum column on each reviewable table (`verifications.reason_code`, `network_referrals.reason_code`, `organization_referrals`' equivalent) — no change to the existing required free-text field, no backfill required (nullable for historical rows).

**UX impact:** Option B adds a dropdown/select to each reject form, alongside (not instead of) the existing reason textbox.

**Backward-compatibility impact:** None — fully additive, nullable.

**Recommended engineering-safe default (adopted and scope-refined by the approved decision above):** Option B was recommended and is approved, with `reason_code` upgraded from optional to **required**, and a genuinely separate internal-note field added — a materially fuller scope than the original P2 proposal.

**STATUS: APPROVED — 2026-09-19 (required `reason_code` + optional internal note, kept separate from the user-visible message; not yet implemented — see `ADMIN_IMPLEMENTATION_BACKLOG.md`)**

---

## PD-006 — Organization merge capability

**Decision (2026-09-19, approved):** **Option A, with a defined near-term scope.** Do **not** build a general transactional merge engine yet. Near-term approved scope is the three-step flow already partially built for referrals, generalized: **detect probable duplicate → show candidate → link to existing where appropriate.** Full entity merge (re-parenting every FK'd table) remains explicitly deferred. This is Phase 2's "Duplicate Management — limited scope" item (see `ADMIN_IMPLEMENTATION_BACKLOG.md` Phase 2 and B2/BL-015).

**Topic:** Should Aladdin build a "merge two duplicate organizations into one" admin capability?

**Current Aladdin behavior:** Does not exist. Duplicate *detection* exists only inside the two referral-review flows (a non-blocking "link to existing" hint); there is no merge of two already-separately-created organizations anywhere.

**Talent behavior, if relevant:** Also does not exist anywhere in Talent (confirmed by exhaustive grep) — no reference implementation to draw from.

**Available options:**
- **A. Do not build this now.** Rely on the existing dedup-at-creation-time hints (and B2's proposed generalization of them) to *prevent* duplicates from being created in the first place, rather than cleaning them up after the fact.
- **B. Build a merge capability**, defining a re-parenting rule for every FK'd table (memberships, RFQs, quotations, orders, branches, reviews, verifications, audit history, points-ledger `organization_id` context fields...).

**Consequence of each option:**
- **A:** Zero cost now; risk of accumulating real duplicate organizations over time that become progressively harder to reconcile once each has accrued real transaction history.
- **B:** Substantial, genuinely risky engineering effort — this is one of the highest-blast-radius admin actions conceivable in this data model, touching nearly every domain table, and Talent offers no working pattern to reduce that risk.

**Data model impact:** Option B: significant — every table with an `organization_id` FK needs an explicit re-parenting/merge rule, and history (audit_log, points_ledger context) needs a defined "what does merged history mean" answer.

**UX impact:** Option B needs a careful review UI (which record is primary, what happens to conflicting data) that has no existing pattern anywhere in this codebase to build from.

**Backward-compatibility impact:** N/A (new capability).

**Recommended engineering-safe default (adopted, with the detect→suggest→link scope now explicitly locked as Phase 2):** Option A was recommended and is approved; the detect/suggest/link-to-existing scope is now formally part of the approved Phase 2 backlog rather than left as "build B2 eventually."

**STATUS: APPROVED — 2026-09-19 (limited scope: detect → suggest → link to existing, part of Phase 2; full merge engine deferred, not scheduled)**

---

## PD-007 — Platform-level internal sales/lead CRM

**Decision (2026-09-19, deferred):** **Option A.** Do not build this simply because Talent has one. Revisit only when Aladdin's own operational Sales/Onboarding needs justify it — i.e. a concrete internal pain point, not the existence of a reference-implementation feature, is the bar for reopening this.

**Topic:** Does Aladdin's own internal team (as distinct from each B2B tenant's own Sales module) need a platform-level lead-tracking tool, the way Talent's `/admin/leads` serves Talent's internal sales team?

**Current Aladdin behavior:** No such platform-level tool exists. Aladdin's `customers`/`leads`/`followups` domain (ADR-0008) is explicitly **per-organization** — it serves each B2B tenant's own sales team working their own customers, not Aladdin's own internal team prospecting new tenants to onboard.

**Talent behavior, if relevant:** `/admin/leads` is exactly this — Talent's internal team's own prospect-tracking tool, structurally a CRM pipeline (dynamic stages, categories, assignment, bulk actions, CSV/Sheet import), deliberately kept separate from `/admin/candidates` (their internal hiring pipeline) per Talent's own migration comment ("a candidate isn't a lead").

**Available options:**
- **A. No such tool needed.** Aladdin's own internal growth/onboarding team tracks prospective showrooms/suppliers/contractors to bring onto the platform using external tools (a spreadsheet, a separate CRM product) rather than a built-in admin feature.
- **B. Build a lightweight platform-level prospect tracker**, reusing the *pattern* (not the code) of Talent's leads pipeline, scoped to Aladdin's own team tracking businesses not yet on the platform.

**Consequence of each option:**
- **A:** No engineering cost; Aladdin's internal team stays on whatever external tooling they already use (or lack).
- **B:** A genuinely new, appreciable feature — not a small addition — that only makes sense if Aladdin's own growth/onboarding process actually needs it and doesn't already have a satisfactory external tool.

**Data model impact:** Option B: a wholly new domain (stages, categories, prospect records, actions/notes) — this is a feature-sized decision, not a gap-fill.

**UX impact:** Option B: a new admin section, comparable in scope to the existing Verifications page.

**Backward-compatibility impact:** N/A (new capability).

**Recommended engineering-safe default (adopted as the deferral decision):** Option A — this was the original recommendation and is now the approved deferral.

**STATUS: DEFERRED — 2026-09-19 (revisit only when a concrete internal Sales/Onboarding need is identified)**

---

## PD-008 — Dynamic, admin-creatable RBAC roles vs. fixed platform-role tiers

**Decision (2026-09-29, APPROVED — ADAPT CRM DYNAMIC RBAC TO ALADDIN):** **Option B, adapted.** The Product Owner replaced the 2026-09-19 deferral below. Aladdin will adapt the useful RBAC architecture of the audited reference implementation ([`hmohamed080/CRM`](https://github.com/hmohamed080/CRM); evidence in [`CRM_RBAC_GAP_ADOPTION.md`](CRM_RBAC_GAP_ADOPTION.md)) — **adapt, not copy**:

- **Adopt:** DB-backed roles; `resource.action` permissions; dynamic role creation and editing; role assignment; one centralized server-side authorization check; permission-change audit/history; Admin Staff as the entry point for access management. Hierarchy/rank inheritance (CRM's assignment ceiling) only where it genuinely fits.
- **Aladdin-specific requirements the eventual design must answer** (CRM is single-tenant in shape; Aladdin is not): Platform Admin roles vs. organization-level roles; scopes **Platform · Organization · Branch · Department/Team · User**; multi-tenant boundaries (an organization role can never read another tenant, and never grants platform authority); super-admin safeguards (no self-escalation, a role holder can grant only up to their own ceiling, the last super-admin cannot be removed or demoted); authorization enforced server-side (RLS/RPC), never UI-hidden only; migration of every existing `app.is_platform(...)` call site and the org-level `membership_capabilities` catalog onto the new model without a permission gap in between.
- **Aladdin resource vocabulary (initial, Admin domains — not CRM's resources):** `users.read/verify/suspend`, `organizations.read/verify/suspend`, `referrals.read/approve`, `points.read/adjust/reverse`, `audit.read`, `analytics.read`, `admin_staff.read/manage`, `roles.read/manage`.
- **Phase 0D delivers the Preview only** (`/admin/preview/staff` — Staff · Roles · Permissions, a role editor over the vocabulary above, scope concepts). The weak standalone Access page is removed from the Preview; its content is superseded by this model. **No RBAC schema, RPC, RLS or enforcement change is authorized by this decision** — that is a separately approved backlog item ([BL-018](ADMIN_IMPLEMENTATION_BACKLOG.md)), which must start with a design audit of the tenant/scope model above. Until it ships, the fixed 3-tier `support ⊆ moderator ⊆ administrator` model stays the only enforced authority.

**STATUS: APPROVED — 2026-09-29 (direction approved; Preview in Phase 0D).** **Implementation: Admin Core Phase 1A CLOSED / APPROVED 2026-09-30** — [ADR-0011](../decisions/ADR-0011-admin-rbac-platform-authority.md) Accepted; [`ADMIN_RBAC_ARCHITECTURE.md`](ADMIN_RBAC_ARCHITECTURE.md); deployment gate [`SUPER_ADMIN_BOOTSTRAP.md`](SUPER_ADMIN_BOOTSTRAP.md). The fixed three-tier model is no longer the enforced authority.

**Superseded decision (2026-09-19, deferred) — kept as the recorded rationale:** **Option A.** First establish correct, meaningfully-separated fixed server-side permission boundaries (PD-004/010/011/012's tiering work). A dynamic, admin-manageable permission-management UI may be considered later, only once the fixed model has genuinely been outgrown — nothing in this audit found evidence of that yet.

**Topic:** Should Aladdin ever move from its current fixed 3-tier platform-role hierarchy (`support`/`moderator`/`administrator`) toward Talent's fully dynamic, admin-creatable resource×action role model?

**Current Aladdin behavior:** 3 fixed, hierarchical roles, DBA-provisioned only (no self-service role management UI) — see `ADMIN_FEATURE_MATRIX.md` §L1/L2.

**Talent behavior, if relevant:** A real DB-backed resource+action ACL, admin-creatable roles, `requireSuperAdmin`-gated management UI, audited changes — see the matrix for full detail.

**Available options:**
- **A. Stay with the fixed 3-tier model**, closing PD-004's specific tiering gaps but not building a general role editor.
- **B. Adopt a dynamic, admin-manageable role/permission system** modeled on Talent's (or on Aladdin's own existing `docs/technical/07_permissions_matrix.md` §2 capability-key catalog, extended to platform roles).

**Consequence of each option:**
- **A:** Matches Aladdin's existing "fixed set, governance-controlled" philosophy already used for org-level capabilities (`membership_capabilities.capability_key` is a fixed catalog, "extend only via governance," per `07_permissions_matrix.md` §2) — consistent architecture, lower ongoing complexity, but any future need for finer-grained platform staff separation (e.g. a Finance-only role that can adjust Points but not verify organizations) requires a new migration each time rather than an admin self-service change.
- **B:** More operationally flexible as the platform-staff team grows and diversifies, but is a genuinely large build (mirrors Talent's `admin_roles`/`admin_role_permissions`/`admin_role_audit_log` three-table system plus a full management UI) and introduces the self-escalation risk Talent's own `requireSuperAdmin` safeguard exists specifically to prevent — a risk surface Aladdin does not have today at all.

**Data model impact:** Option B is substantial — new tables, new RLS, new RPCs, a UI comparable in scope to Talent's `/admin/roles`.

**UX impact:** Option B: an entirely new admin section.

**Backward-compatibility impact:** Option B would need to map every existing `is_platform(...)` call site onto the new model — a non-trivial migration of every gated RPC found in this audit.

**Recommended engineering-safe default (adopted as the deferral decision):** Option A — this was the original recommendation and is now the approved deferral.

~~**STATUS: DEFERRED — 2026-09-19 (fixed-tier model stays authoritative; revisit only once real role-diversity need is evidenced)**~~ — *superseded 2026-09-29 by the approval above.*

---

## PD-009 — Support/contact-ticket handling

**Decision (2026-09-19, deferred):** **Neither option chosen yet.** First evaluate Aladdin's existing support/contact/chat flows and the real operational need before deciding whether a dedicated admin-managed ticket queue is warranted. This audit did not assess current support volume or whether Chat already serves the need — that assessment is the prerequisite for reopening this decision, not a default to fall back on.

**Topic:** Does Aladdin want an admin-managed support-ticket queue (Talent's `/admin/support` pattern), or should support requests route through an existing channel (e.g. Chat, email)?

**Current Aladdin behavior:** No contact-form or support-ticket system of any kind exists today (confirmed absent from the admin nav and from every query file read this session).

**Talent behavior, if relevant:** `contact_messages` table + `/admin/support` — a simple `new → seen → process → done` queue, with an internal `admin_note` field, triage `assigned_admin`, and best-effort email reply (Resend, no-op if unconfigured).

---

## PD-010 — User suspension semantics

**Topic:** What must a user-suspension capability guarantee, precisely, before it's built?

**Current Aladdin behavior:** `users.status` has `suspended`/`deactivated` enum values that are fully inert — confirmed by exhaustive grep this repository has neither a write path (no RPC ever sets them) nor an enforcement/read path (`frontend/src/middleware.ts` never references status/suspend/block at all). See `ADMIN_FEATURE_MATRIX.md` §A3.

**Decision (2026-09-19, approved):** A suspension capability must:
- **Preserve** the account and all historical data — suspension is never a delete.
- **Prevent unauthorized product activity server-side** — the enforcement must be a real, server-enforced boundary (RLS/RPC/middleware-level), never UI-hidden only.
- **Require an admin-supplied reason.**
- **Record the acting admin (actor) and a timestamp.**
- **Support restoration** (reversing the suspension).
- **Support an optional expiry**, *if* it fits cleanly into the existing architecture without forcing new infrastructure (e.g. a scheduled job) that doesn't already exist — this is a "nice if cheap" requirement, not an unconditional one.
- **Generate audit records** for both the suspension and the restoration.
- **Never hard-delete user data.**
- The **exact session-invalidation/enforcement strategy must follow Aladdin's existing auth architecture** (Supabase Auth + RLS + `SECURITY DEFINER` RPC as the enforcing boundary) — not a bespoke mechanism, and not Talent's `adminClient`-bypass + hand-written-route-check pattern.

**Platform-role tier:** Not fixed by this decision alone — read together with PD-004's principle (real separation of duties; do not default to the lowest tier without deciding). The concrete tier is set at implementation-design time for the corresponding backlog item (`ADMIN_IMPLEMENTATION_BACKLOG.md` BL-001), informed by PD-004.

**Data model impact:** Additive only — new `SECURITY DEFINER` RPCs, new audit vocabulary (`account.suspended`/`account.restored`), no schema/column change (the enum values already exist). An expiry field, if adopted, is a new nullable timestamp column plus a decision on what enforces the auto-expiry (a scheduled job is new infrastructure — flag explicitly at design time if this is chosen, since "if architecture permits cleanly" is the given bar).

**Not implemented in this phase** — this decision defines the target semantics for BL-001; building it is separately scoped (Phase 1 of the backlog) and gated on Phase 0 (the Frontend Blueprint) being reviewed first, per PD-013.

**STATUS: APPROVED — 2026-09-19 (semantics only; not yet implemented)**

---

## PD-011 — Organization suspension semantics

**Topic:** What does suspending an organization actually mean, and what must NOT happen when it does?

**Current Aladdin behavior:** `organizations.status`/`deleted_at` exist and are read but nothing in admin ever writes either — the same "schema-ready, no write path" gap as PD-010, one level up. See `ADMIN_FEATURE_MATRIX.md` §A4.

**Decision (2026-09-19, approved principle):** **Organization suspension is NOT equivalent to suspending all member user accounts.** Suspension restricts organization-*level* capabilities while preserving:
- member identities (a suspended org's members remain themselves, personally unaffected as users unless independently suspended via PD-010),
- history,
- records,
- in-flight operational data — **unless a module-specific rule says otherwise.**

**Before any backend implementation, the module-by-module effect of an organization suspension must be documented** — e.g., precisely: can a suspended organization's members still read their existing RFQs/quotations/orders? Can they create new ones? Can a counterparty still see/interact with a suspended organization in an in-flight transaction? Does a suspended organization disappear from the public directory/search? None of these are answered by this decision — the decision only fixes the *principle* (restrict org capability, don't collapse into member-suspension) and *requires* the module-by-module documentation as a prerequisite gate before implementation, not as optional follow-up.

**Platform-role tier:** Per `docs/technical/07_permissions_matrix.md` §5 ("Govern orgs: Administrator only") and PD-004's principle, organization suspension is the kind of capability that spec already calls Administrator-only — carried forward as the working assumption for BL-002's design, subject to explicit confirmation at implementation time.

**Data model impact:** Additive — new RPCs, new audit vocabulary (`organization.suspended`/`organization.restored`), no schema change (status/deleted_at already exist). The module-by-module documentation itself is a design deliverable, not a schema change.

**Not implemented in this phase.** The module-by-module effect documentation required as a prerequisite for BL-002 has now been produced — see [`PD-011_ORG_SUSPENSION_MODULE_EFFECTS.md`](PD-011_ORG_SUSPENSION_MODULE_EFFECTS.md) (Phase 0B, 2026-09-20). That document is itself documentation only; it does not authorize or start BL-002's backend implementation.

**STATUS: APPROVED — 2026-09-19 (principle approved; module-by-module effect documentation produced 2026-09-20 — see `PD-011_ORG_SUSPENSION_MODULE_EFFECTS.md`; BL-002 implementation not started)**

---

## PD-012 — Manual Points adjustments

**Topic:** How should an admin be allowed to manually correct a user's Points balance?

**Current Aladdin behavior:** `public.adjust_points()`/`public.reverse_points_entry()` already exist, fully built, audited, reason-required, platform-gated (`is_platform('support')`) — but have zero admin UI anywhere calling them. See `ADMIN_FEATURE_MATRIX.md` §J1/J2.

**Decision (2026-09-19, approved):** Manual Points operations must use the **immutable ledger model already built** — this decision ratifies the existing architecture as correct and finalizes its access tier and requirements, it does not ask for a new design:
- **Administrator-only, initially** (a stricter tier than the RPCs' current `is_platform('support')` gate — implementing this decision means **re-tiering** `adjust_points`/`reverse_points_entry` from `support` to `administrator`, not just building a UI over the existing gate).
- Every adjustment requires: **amount/action** (credit or debit, i.e. the signed `points_delta`), **reason**, **actor**, **target** (the user), an **audit event**, and **reference/metadata** — all of which the existing `adjust_points` RPC signature already captures (`p_user_id, p_points_delta, p_reason_code, p_organization_id`, plus the `awarded_by_user_id`/audit-first pattern already built in).
- **Never directly overwrite the final balance** — balance stays derived (`SUM(points_delta)`), exactly as today.
- **Never edit or delete historical ledger rows as a correction mechanism** — corrections are new credit/debit/reversal records (`reverse_points_entry`'s compensating-entry pattern, already built), never an `UPDATE`/`DELETE` (which no role has grant for today, and this decision confirms that must stay true).

**Data model impact:** **None** — the ledger, both RPCs, and their guarantees already exist exactly as this decision requires. The only implementation work is (a) re-tiering the two RPCs from `support` to `administrator`, and (b) building the admin UI over them (`ADMIN_IMPLEMENTATION_BACKLOG.md` BL-003).

**Not implemented in this phase** — the UI and the tier change are Phase 1 backend work, gated on Phase 0 (Frontend Blueprint) review per PD-013.

**STATUS: APPROVED — 2026-09-19 (ratifies the existing ledger architecture; Administrator-only tier locked; UI not yet built)**

---

## PD-013 — Frontend-first Admin delivery

**Topic:** How should new, especially sensitive/destructive, Admin capabilities be delivered going forward?

**Decision (2026-09-19, approved):** For new Admin capabilities, **first represent** information architecture, screens, states, flows, action placement, permission visibility, and required data contracts **inside an isolated Admin Preview**, before wiring sensitive/destructive backend actions. This is a delivery-process/architecture decision, not a response to a prior open question — it applies going forward starting with the Phase 0 Admin Frontend Blueprint (see `ADMIN_IMPLEMENTATION_BACKLOG.md`).

**Important constraint, stated explicitly so it is never misread:** **Frontend-first does NOT mean frontend-owned business logic.** The backend/database remains the single source of truth for every rule, status, and permission this audit and register document. The Preview exists for product comprehension and UX validation — it previews the *shape* of an interaction (a suspend dialog, a Points-adjustment form, a rejection-reason picker), it does not decide, simulate, or fake the *outcome* of that interaction. A Preview screen must never claim a mutation succeeded when no real backend mutation occurred.

**Why this matters:** Every capability this register approves (PD-010, PD-011, PD-012, and PD-001/002/003's eventual implementations) is either destructive, financial-adjacent, or lifecycle-changing. Seeing and navigating the intended experience before any of that is wired lets the Product Owner catch information-architecture and UX problems — e.g. "the suspend dialog needs to show which organizations this user belongs to before confirming" — at near-zero cost, instead of after a sensitive RPC and its RLS policies are already built around an unreviewed UI assumption.

**Scope of this decision:** Applies to Admin capability delivery going forward. It does not retroactively require re-previewing the Network Referrals admin work already shipped (that work was itself effectively built and live-verified end-to-end before this process was formalized) — it governs Phase 1 onward.

**Data model impact:** None (process decision).

**STATUS: APPROVED — 2026-09-19 (process/architecture decision, in effect immediately for Phase 0 onward)**

**Available options:**
- **A. No dedicated support-ticket admin surface.** Route support needs through Aladdin's existing Chat/Conversations system or an external tool (e.g. a help-desk SaaS), rather than building a parallel in-product queue.
- **B. Build a lightweight support-ticket queue**, adapting Talent's simple 4-state pattern and internal-note field.

**Consequence of each option:**
- **A:** No engineering cost now; support requests live in whatever channel already exists, which may or may not be adequate for the platform's current support volume/needs (not assessed in this audit — out of scope).
- **B:** A moderate, well-scoped build (Talent's own implementation is genuinely simple — one table, four states, one note field) if the product wants an in-house queue rather than an external tool or the existing Chat system.

**Data model impact:** Option B: one new table (`support_tickets` or similar), reusing G1's proposed `admin_notes` pattern for the internal-note piece rather than a bespoke field, for consistency.

**UX impact:** Option B: a new admin section; a new/adapted "contact us" entry point for end users if one doesn't already exist.

**Backward-compatibility impact:** N/A (new capability).

**Recommended engineering-safe default:** No default was recommended either way, for the reason stated in the decision above — this is now formally deferred rather than left open indeterminately.

**STATUS: DEFERRED — 2026-09-19 (pending a support-volume/existing-channel-adequacy assessment, not scheduled)**

---

## PD-014 — Platform Password Authentication

**Decision (2026-09-29, APPROVED):** Every Aladdin user account supports password authentication. Daily sign-in must **not** cost a paid OTP each time. OTP stays where it earns its cost: account verification, account recovery / password reset, phone/email verification, and high-risk step-up verification. This replaces the earlier passwordless-only direction (superseded 2026-09-28 in [`PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md) Change History).

**Current implementation on `main` (already live — not new architecture):** canonical password auth was merged in PR #66 and smoke-tested on Production on 2026-09-28 (details: [`../frontend/auth-password-preview.md`](../frontend/auth-password-preview.md), [`../frontend/installer-phone-auth.md`](../frontend/installer-phone-auth.md)).
- **General accounts:** `/auth/sign-up` (Full Name + Email + Username + Account Type + Password, then Email OTP verification) · `/auth/sign-in` (Email + Password) · `/auth/forgot-password/*` (Email OTP recovery, 4 screens).
- **Installer/Technician:** `/installer/sign-up` and `/installer/sign-in` (Phone + Password, via an internal login alias that is never displayed).
- **Password policy:** 10 characters minimum, 72 bytes maximum, weak/common/sequential/account-derived passwords rejected, live strength meter.
- **Abuse protection:** application-scoped Turnstile on Create Account, Resend Signup and the Forgot Password request; Supabase's own rate limits (`sign_in_sign_ups`, `token_verifications`, `email_sent`) are the real throttle.
- **Password state:** tracked in service-role-only `app_metadata`, never in user-editable metadata; passwords live only inside Supabase Auth, never in public application tables.
- **Existing-account enrollment and change password:** both exist but are **unlinked compatibility routes** (`/preview/auth-password/migrate`, `/preview/auth-password/change-password`) — the only authenticated change-password flow today.

**Still missing (future Auth work — each item needs its own audit/approval before Phase 1 Auth):**
- Change Password inside Settings (member Settings and Admin Settings) — the product decision the post-rollout audit left open.
- Installer/Technician Forgot Password (phone accounts have no recovery flow yet).
- A linked password-enrollment path for any remaining passwordless accounts, then retirement of the legacy email-OTP compatibility routes (`/auth/verify`, `/auth/recovery`) once no account lacks a password; the `/preview/auth-password/*` redirects stay ≥ 90 days.
- Leaked-password protection (Supabase Pro native check, or server-side HaveIBeenPwned k-anonymity — pending approval).
- Emailed-link variant of recovery; hosted rate-limit values verified against the dashboard; step-up verification for high-risk Admin actions.

**Previewed in Phase 0D only:** Admin Settings (`/admin/preview/settings`) shows the planned **Change Password** section (Current password · New password · Confirm new password · Save password) with the real policy hints, and the Profile section (Photo · Full Name · Username · Phone · Email). Nothing is wired: no Supabase Auth call, no password mutation, no migration.

**Future requirements recorded for the Auth implementation:** reuse the existing password policy (one source, not a second copy); rate-limit change-password attempts and require the current password (or a fresh OTP) before a change; send the existing password-changed notification; keep recovery on OTP; never store or log passwords outside Supabase Auth; enrollment for existing accounts must not create a second identity.

**Data model impact:** none in Phase 0D. **STATUS: APPROVED — 2026-09-29 (core live on `main`; Settings Change Password previewed; remaining items above not started)**

---

## PD-015 — Organization Creation Request vs. Network Referral

**Decision (2026-09-29, APPROVED):** these are **two separate business workflows** and must stay separate in product, UI and (later) data model.

- **A. Organization Request** — a user wants their **own** organization/business added to Aladdin because it does not exist yet (showroom owner, supplier, manufacturer, importer, contractor, engineering/design office). It is **not** inherently a referral and carries **no** Points/reward context. Review needs: requester, organization name and `org_type`, contact information, location, submitted data, duplicate candidates, request date, status, notes/history, approve/reject.
- **B. Network Referral** — a user recommends an organization **they know**. It preserves referrer identity, referral provenance, the network relationship and reward/Points eligibility (+100 only when a genuinely new organization is created — the live rule in `20260911090001_network_referrals.sql`). Review needs: referrer, organization, provenance, potential duplicate, network relationship, reward eligibility, lifecycle, review history.

**Rules:**
- Do **not** retrofit Organization Requests into `network_referrals` (nor into the Sales `organization_referrals` family). They need distinct semantics and, most likely, a distinct record and lifecycle.
- The Review Center presents them as separate request types (All · Organization Requests · Network Referrals · Verifications). Phase 0D previews that separation visually only.
- Current reality, stated plainly: business creation today is either self-serve (registration creates organization + owner membership + primary branch) or referral-driven; **no Organization Request record exists yet**. The Phase 0D Organization Requests tab is fixture-backed and labelled as such.

**Data model impact:** a future, separately approved migration (new request record + lifecycle + audit vocabulary). None in Phase 0D. **STATUS: APPROVED — 2026-09-29 (Preview only; backend not started)**

---

## PD-016 — Admin Preview Promotion Strategy

**Decision (2026-09-29, APPROVED — added after the original Phase 0D prompt):** `/admin/preview/**` is **not** disposable prototype code. The approved Phase 0 / 0B / 0C / 0D architecture, components, information architecture and UX are the **foundation of the future production Admin**.

**After Phase 0D Product Owner approval:**
- Do **not** rebuild a separate Admin from scratch.
- Progressively replace Preview fixtures with real queries.
- Progressively replace non-mutating Preview interactions with authorized mutations.
- Move server-side search / filter / sort / pagination into the approved UI (BL-005, BL-006, BL-011).
- Preserve approved components and flows unless a later Product Decision changes them.

**Stage boundary:** Phase 0D is the **final Preview-design stage**. After approval the work becomes **Admin Core / production wiring** work.

**Backlog note — Data Freshness / Realtime Architecture Audit:** a site-wide audit will happen **after** the Admin Core backend-wiring stage (never inside Phase 0D, which must not implement any realtime architecture). It will classify every module as one of: **Realtime subscription** · **mutation-triggered refetch** · **focus/navigation refetch** · **polling** · **normal fetch**. Tracked as [BL-024](ADMIN_IMPLEMENTATION_BACKLOG.md).

**Data model impact:** none. **STATUS: APPROVED — 2026-09-29 (process/architecture decision, in effect from Phase 0D approval)**
