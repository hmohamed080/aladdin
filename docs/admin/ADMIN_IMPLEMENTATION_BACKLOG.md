# Admin Implementation Backlog

| | |
|---|---|
| **Status** | **Phase 0 → 0B → 0C are delivered; Phase 0D (Final Admin Product Blueprint) is implemented and awaiting Product Owner approval (2026-09-29)** — see the sections below. **Phase 2 scope is locked/approved** (Product Owner, 2026-09-19) — its information architecture below is authoritative for implementation, not still under discussion. **Phase 1 backend has NOT been implemented** — per PD-013 (frontend-first Admin delivery), Phase 1's sensitive/destructive backend work begins only after Product Owner review of the full Phase 0/0B/0C Preview. Phases 3–6 remain planning-only, several still blocked on a Product Decision (see each item's `Blocked by` field). |
| **Version** | 3.0.0 |
| **Owner** | Foundation / Operations |
| **Last Updated** | 2026-09-29 (Phase 0D scope; PD-008/014/015) |
| **Depends On** | [`ADMIN_FEATURE_MATRIX.md`](ADMIN_FEATURE_MATRIX.md), [`PRODUCT_DECISIONS_REGISTER.md`](PRODUCT_DECISIONS_REGISTER.md), [`PD-011_ORG_SUSPENSION_MODULE_EFFECTS.md`](PD-011_ORG_SUSPENSION_MODULE_EFFECTS.md), [`CRM_RBAC_GAP_ADOPTION.md`](CRM_RBAC_GAP_ADOPTION.md) |

Phases are ordered by operational necessity, not by convenience of implementation. Phase 0 (new) is the frontend blueprint every subsequent phase's UI is now expected to have been previewed through first (PD-013). Phase 1 items are the ones the original audit found to be genuine safety gaps (a live platform with no way to stop a bad actor, and a fully-built-but-unreachable Points correction primitive) — everything else is real but less urgent.

---

## Phase 0 — Admin Frontend Blueprint / Preview

**Status: approved, in delivery (this session).** Per PD-013, every subsequent phase's sensitive/destructive Admin UI is previewed here — information architecture, screens, states, flows, action placement, permission visibility, and data contracts — **before** any Phase 1 backend is wired. The backend/database remains the source of truth throughout; the Preview never owns business logic and never performs a real mutation.

- **Route:** `/admin/preview/**`, nested under the existing `app/admin/layout.tsx` — inherits the same `loadPlatformRole()` platform-staff gate the real Admin console already uses, so the Preview is admin-protected by construction, not by a second bespoke check.
- **Scope:** Dashboard, Users (directory + detail), Organizations (directory + detail), Review Center (queue + details), Points (ledger + adjustment/reversal interaction), Audit (explorer), plus the cross-cutting Admin Notes and Entity Timeline concepts, and a read-only Access/permissions-visibility view. No dynamic RBAC editor.
- **Data:** real, read-only Aladdin data through existing safe query paths wherever the data already exists (users, organizations, memberships, verifications, network referrals, points ledger, audit log); explicitly-labelled, preview-feature-scoped fixtures only where a field/state has no backend yet (e.g. Admin Notes content, Entity Timeline narrative assembly, an Activity feed) — never a second parallel backend, never a DB migration written solely to support the preview.
- **Interactivity:** navigation, tab switching, action menus, and dialogs (Suspend, Restore, Reject with reason, Points Adjust/Reverse) all open and are fully usable **as UI** — none of them call a real mutating RPC; each carries an explicit "Preview only — no changes are saved" affordance and never renders a real-looking success state.
- **Out of scope for Phase 0:** any real backend mutation, any status-model/RLS/Points-rule change, dynamic RBAC, organization merge, a CRM, support tickets — the existing Admin console (`/admin/**`) continues to work completely unchanged.
- **Validation:** admin-gated route, existing Admin unaffected, AR/EN + RTL/LTR, desktop + relevant responsive behavior, typecheck/lint/tests, live browser QA — see the session's own completion report for results.

---

## Phase 0B — Admin Product Blueprint Enrichment

**Status: delivered (2026-09-20), on top of Phase 0.** The Product Owner reviewed Phase 0 and found it "too skeletal" — this phase makes the same `/admin/preview/**` surface dense enough that a Product Owner can tell exactly what Admin sees, what actions it can take, where those actions live, and how Users/Organizations/Review/Access/Analytics operate. Still frontend-first (PD-013): no Phase 1 backend work started, the real `/admin/**` remains unchanged, and every mutating-looking control is still a `PreviewActionDialog`/`PreviewConfirmDialog` that never calls a real RPC.

- **Dashboard reworked into an operational command center:** the Phase 0 Recent Activity list is removed (Audit and each subject's own Activity tab already own that surface); replaced with a 10-tile KPI strip (total users, new registrations this week, pending verification, verified, rejected, suspended users, organizations, orgs pending verification, referrals pending, suspended orgs — every tile a real count, most reused from `adminSummary()`, three new ones from a new `previewDashboardExtras()` read) and an "Operational attention" list (pending verification, possible duplicate organizations, referrals awaiting a decision, incomplete user/org profiles, suspended accounts/organizations — real counts except the two profile-completeness rows, which are clearly-labelled preview fixtures, since no admin read path exists for onboarding-answer completeness yet).
- **Users Directory enriched:** columns for contact (fixture email/phone), organization (real), verification status (real), city (fixture), profile completeness (fixture), and a duplicate flag (fixture); real status tabs (All/Pending/Verified/Suspended/Rejected) and type/verification/city filters, all operating as real client-side operations over the existing 200-row-cap fetch (not a fake server query); real pagination (page size + prev/next) over the filtered set; a row "More" menu (`RowActionsMenu`, new shared component) covering View/Verify/Reject/Suspend/Restore/Activity/Points/View organization/Add note/Audit.
- **User Details enriched:** header now shows Verify/Reject (when pending) or Suspend/Restore (otherwise), plus a "More" menu (Add note/Audit/View organization); Overview tab gained a Points-balance field, an organizations-count field, and a "Recent flags" panel (suspended / rejected-verification / duplicate / incomplete-profile, each real except the duplicate/completeness flags); Points tab ledger gained direction/source/actor columns and a per-entry Reverse action; the Adjust dialog gained a credit/debit selector and a reference field.
- **Organizations Directory enriched:** columns for owner (real, derived from `org.manage` capability holders, bulk-read via a new `previewOrgsDirectoryContext()`), branch count (real), provenance (real), city (fixture) and a real directory-wide duplicate flag (`flagDuplicateOrgNames()`, the same exact-normalized-name technique used on the detail page's Network tab); same real status tabs/filters/pagination/row-menu pattern as Users.
- **Organization Details enriched:** header gained the same status-aware Verify/Reject/Suspend/Restore/More pattern; Overview tab gained member/branch counts, an ownership summary and a provenance summary; the Network/Referrals tab gained a real "Possible duplicates" panel (`previewOrgDuplicateCandidates()`, already built in Phase 0, now actually rendered) with Inspect/Link-to-existing actions.
- **NEW: Admin Staff / Access Management** (`/admin/preview/staff`) — does **not** reverse PD-008 (dynamic RBAC stays deferred). The roster is real (`platform_role_grants`, the same table `loadPlatformRole()` already reads for the caller, generalized to every row); every grant is honestly labelled "Active" since no `status` column exists yet to back invited/active/disabled for real. Invite / Change role / Disable / Restore are preview-only dialogs using the three real fixed roles (support/moderator/administrator) — never an arbitrary permission builder.
- **NEW: Analytics / User Activity** (`/admin/preview/analytics`) — investigated first: no product-usage tracking table exists anywhere in the schema (grepped every migration for `user_events`/`page_view`/`click_event`/`last_active_at` — zero matches), so traffic-over-time, top pages, top events and the visitor table are entirely fixture data, said so in a permanent banner. "Registrations by account type" is the one real section (reuses `adminSummary()`'s `usersByType`). Deliberately distinct from Audit (admin/system actions) and Entity Timeline (one subject's history) — the page's own subtitle states this.
- **Access matrix expanded:** from 8 to 13 capability rows, splitting the original "cross-tenant read"/"verification decide" rows into explicit read/verify/suspend pairs for Users and Organizations, adding "review referrals" and "manage Admin Staff" — per PD-004's principle, every suspend/govern/manage-* row stays Administrator-only rather than being available at Support.
- **Review Details enriched:** related User/related Organization links (resolved for real, including a direct `verifications` read for the subject id `listVerifications()` doesn't expose), contact data (real where the underlying referral captured it), previous decisions (real, other decided verifications for the same subject), plus Admin Notes, Entity Timeline and scoped Audit sections — reusing the exact same real query functions the User/Organization Details pages already use.
- **PD-011's documentation prerequisite produced:** [`PD-011_ORG_SUSPENSION_MODULE_EFFECTS.md`](PD-011_ORG_SUSPENSION_MODULE_EFFECTS.md) — the module-by-module effect of an organization suspension (Marketplace/products, jobs, RFQs/quotations, orders, projects, CRM, members, branches, messaging, payments, in-flight operations), required by PD-011 before BL-002's backend work can begin. Documentation only — does not start BL-002.
- **A real bug found and fixed during this phase's own browser QA:** the fixture `hashOf()` helper (`features/admin-preview/fixtures.ts`) used a naive `acc * 31 + charCode` accumulator that silently overflowed JS's 53-bit float precision on long/similar-prefix ids, collapsing all ten `preview-visitor-N` Analytics fixture rows to an identical row. Replaced with a bounded FNV-1a hash (`Math.imul`-based, never leaves the 32-bit integer range). Also fixed: two locale-formatting gaps (Dashboard's "Operational attention" counts and a few new table counts rendering as raw Latin digits instead of locale-aware `formatNumber`/`formatCount` in Arabic) found during the same QA pass.
- **Out of scope, unchanged from Phase 0:** any real backend mutation, any status-model/RLS/Points-rule change, dynamic RBAC, a full organization-merge engine, a CRM, support tickets — the existing Admin console (`/admin/**`) continues to work completely unchanged.
- **Validation:** `pnpm typecheck`/`lint`/`test` (all green, 1465 tests), live browser QA across Dashboard/Users/User Details/Organizations/Organization Details/Admin Staff/Analytics/Review Center/Review Details/Points/Access in English and Arabic (RTL), light and dark mode, desktop and mobile viewport, zero console errors on a clean tab.

---

## Phase 0C — Admin Blueprint Final Refinement

**Status: delivered (2026-09-20), refining Phase 0/0B's pages in place — no parallel Preview surface created.** Still frontend-first (PD-013): no Phase 1 backend, the real `/admin/**` untouched. This phase is the "final refinement" pass before Product Owner sign-off on the Blueprint as a whole.

- **Reference repositories:** Talent Admin (re-audited for 9 specific new areas: its User Activity Analytics page, Settings screen, admin-side Edit Talent Profile, "Complaint about this talent" dialog, "Log a new action" follow-up feature, its Audit/"Recent events" list, row-action button visibility, date-format convention, and search/filter interaction pattern). **New this phase: `hmohamed080/CRM`** (private, access confirmed via `gh`, cloned read-only) — a focused RBAC audit; see [`CRM_RBAC_GAP_ADOPTION.md`](CRM_RBAC_GAP_ADOPTION.md) for the full findings and adoption matrix. Neither reference's domain logic, schemas, naming or UI was copied blindly — every adoption below is Aladdin-adapted, and every CRM RBAC capability Aladdin lacks is explicitly deferred to a future PD-008 reopening, not adopted silently.
- **Global conventions established** (documented in `docs/admin/AGENT_WORK_LOG.md` entry and applied consistently): default 10 rows per page (options 10/25/50/100) on every Admin directory; **no standalone Search button** anywhere — text search debounces (300ms) and every select filter applies immediately, both via a new shared client component (`features/admin-preview/auto-filters.tsx`, `AutoFilters`/`SortableHeader`) that drives a real Next.js soft-navigation (`router.replace`, `scroll: false`) rather than a `<form>` submit; all-numeric day/month/year dates (`formatAdminDate()`, new export in `lib/ui/format.ts`, deliberately NOT reusing `en-EG`'s `Intl.DateTimeFormat` field order — verified in Node that `en-EG` resolves to the same month-first pattern as `en-US` for 2-digit/2-digit/numeric options, so the day/month/year order is built explicitly per component rather than trusted to the locale pattern).
- **Real vs. Preview data made visually honest:** a small `•` mark on a fixture-backed column header plus ONE `PreviewLegend` note per page/section (`features/admin-preview/preview-legend.tsx`) — never a badge on every fixture cell. The existing 200-row-cap fetch is now explicitly labelled "Preview fetch, capped at ~200 rows — not the real total" everywhere it's used, rather than presented as complete pagination.
- **Users Directory — final column model:** Name (+ a compact warning-dot near identity when any Flag applies) / Email / Phone (+ a real WhatsApp icon using the existing `lib/contact/whatsapp.ts` `wa.me` deep-link helper — no new messaging backend) / Organization / City / Verification (mapped to the four real, non-invented states verified/pending/unverified/rejected) / Registered (sortable) / Status / Last active / Profile completion (sortable, progress bar) / Flags / Actions. Core actions (View, WhatsApp, Verify/Reject or Suspend/Restore depending on status) are now VISIBLE icon buttons in the row, not hidden behind the overflow menu (a new pair of components, `row-icon-button.tsx`/`row-icon-action.tsx`) — the overflow menu keeps only the less-common actions (View as profile, Activity, Points, View org, Add note, Follow-up, Report, Audit). A "Needs attention" bar above the table surfaces real duplicate/verification-review counts and a fixture incomplete-profile count, each linking to a pre-filtered view.
- **Profile Completion's real status investigated and documented:** a real, persona-aware completeness engine already exists (`lib/profile/completeness.ts`, computed live from `profiles`/`individual_onboarding`, different required-field sets for consumer vs. professional personas) — but `individual_onboarding` is self-select-only RLS (`individual_onboarding_select_self`, no platform-read policy), so an admin cannot read another user's onboarding answers to compute it for real today. Profile Completion therefore stays a clearly-marked Preview fixture on every directory/detail page it appears on; closing this gap is a real, scoped future backend item (a new platform-read RLS policy or RPC), not decided or built here.
- **User Details enriched further:** a "View as profile" action opening the REAL public profile route (`/p/[profileId]`) in a new tab, clearly distinguished from "View" (the Admin Details page) — never an impersonation/sign-in-as-user action. A new "Follow-up" tab (history + a "Log a new action" dialog: call/WhatsApp/email/verification-follow-up/other, note, optional follow-up date) — explicitly a DIFFERENT concept from Admin Notes (freeform context), Audit (system change history) and Entity Timeline (human-readable history), never collapsed into any of them; fixture-backed (no backend). A new "Report" tab (subject/contact/description/attachment, Preview-only submit) — inspired by the reference implementation's complaint dialog, explicitly labelled as a future internal report/case concept pending PD-009 (Support Tickets), which remains deferred.
- **Organizations Directory brought to the same standard as Users:** owner/branch-count/provenance (real), phone+WhatsApp/city/profile-completion (fixture, same honesty marking), a directory-wide duplicate flag (real, `flagDuplicateOrgNames()`), sortable Registered/Completion, visible row-action icons, the same "Needs attention" bar pattern, 10-row default.
- **Dashboard simplified:** the Phase 0B "Needs attention" panel is REMOVED per direct Product Owner instruction (the KPI/status cards already communicate operational state; a second panel repeating the same signal was noise). The Recent Activity list stays removed (unchanged from Phase 0B). KPI cards and the two distribution charts are unchanged.
- **Points — complete rework:** the standalone `/admin/preview/points` page no longer stops at a user picker — selecting a user now shows, on the same page, real balance, a REAL derived level/tier (`lib/network/points-level.ts`'s `derivePointsLevel()` — the same presentation-only band the Network Points card already uses; never stored, never gates anything, per `docs/database/points-core.md`), real lifetime earned/spent, real transaction count, real last-activity date, and the full ledger with a derived running "balance after" column, Source/Reference/Reason/Automatic-or-manual/Actor columns, and per-entry Reverse — plus real, auto-applying ledger filters (event type/source/direction/automatic-or-manual). Verified live end-to-end against a real seeded ledger entry (a genuine +100 `referral.organization_approved` credit): balance 100, Level 2, correct running balance.
- **RBAC / Admin Staff / Access:** a focused audit of `hmohamed080/CRM`'s dynamic RBAC produced [`CRM_RBAC_GAP_ADOPTION.md`](CRM_RBAC_GAP_ADOPTION.md) — what CRM has, what Aladdin already has, what's adopted now (richer fixed-role Admin Staff/Access Preview UX only), and what requires a PD-008 reopening (dynamic role creation, per-tenant role scoping, rank-based inheritance machinery) — **PD-008 itself is unchanged.** Admin Staff gained email (fixture), scope ("Platform-wide", real — Aladdin's roles are deliberately platform-wide, unlike CRM's per-tenant roles), last-active (fixture), and View-permissions/View-history actions.
- **Analytics enriched:** 9 KPI cards (page views, profile views, searches, job applications, signups, logins, clicks, total registered [real], visitor-to-signup conversion), a new multi-series chart (`MultiTrendLine`, added to the shared `components/ui/charts.tsx` — same hand-rolled-SVG, no-charting-library approach as every existing chart here — 4 series: page views/signups/clicks/profile views, with a text legend), a real "Top pages by activity" table (Page/Views/Clicks/Avg. time), and an enriched Visitors table (Registered/Guest badge, IP address column that always reads "Not tracked" — confirmed, again, that Aladdin captures no visitor IP anywhere — with a `PreviewLegend` note on the retention/authorization considerations a real implementation would need; this page never starts collecting IP).
- **Audit — partial pagination without a full reload:** actor/action/entity filters stay a real (Next.js soft-navigated) `AutoFilters` bar; pagination itself is now pure local React state in a new client component (`features/admin-preview/audit-results.tsx`) — Next/Previous/page-size change ONLY that component's own subtree; the Admin shell, nav, header and filters never re-render and the URL never changes (verified live: clicking Next changed the visible entries with `window.location.href` unchanged). This is the reference pattern every future large Admin table should follow once built for real (Phase 2).
- **NEW: Admin Settings** (`/admin/preview/settings`) — the signed-in Admin's own profile (real name/role/email from `auth.getUser()`+`profiles`, Preview-only edit) and a "Sign-in & Security" section. ~~Deliberately does NOT include a password-change form: Aladdin's real auth architecture is passwordless~~ — *superseded 2026-09-28:* the canonical auth model on `main` is now Email + Password (Email OTP verification and recovery; installers/technicians: Phone + Password), per the root `CLAUDE.md` Authentication model and [`PRODUCT_DIRECTION_GUIDE.md` Change History](../product/PRODUCT_DIRECTION_GUIDE.md). A password-change surface in Admin Settings is therefore a legitimate Preview item, not a mechanism the product lacks.
- **Out of scope, unchanged from Phase 0/0B:** any real backend mutation, any status-model/RLS/Points-rule change, dynamic RBAC (PD-008 unchanged), a full organization-merge engine, a CRM, support tickets (PD-009 unchanged), a Flags database table (documented as a future data-contract requirement, not built), password/email change wiring, analytics/IP collection.
- **Validation:** `pnpm typecheck`/`lint`/`test` clean throughout (checked after every meaningful edit, 1465 tests green), `pnpm test -- i18n` clean (two genuine mixed-language Arabic-string bugs caught and fixed during this phase, see the Work Log entry), live browser QA across every changed/new page in English and Arabic (RTL), light and dark mode, desktop and mobile viewport, zero console errors on freshly opened tabs.

---

## Phase 0D — Final Admin Product Blueprint

**Status: implemented 2026-09-29 on `feature/admin-blueprint-recovery`, awaiting Product Owner approval.** The last frontend-only pass before any Phase 1 backend; on approval the work becomes Admin Core / production wiring (PD-016). Same `/admin/preview/**` architecture — no second Preview system; the real `/admin/**` stays unchanged. Decisions it implements as Preview: PD-008 (approved: adapt CRM Dynamic RBAC), PD-014 (password authentication), PD-015 (Organization Request ≠ Network Referral). **PD-016:** this Preview is the foundation of the production Admin, not throw-away code — after Product Owner approval it is *promoted* (fixtures → real queries, non-mutating interactions → authorized mutations), never rebuilt; Phase 0D is the final Preview-design stage.

**Scope (Preview only):**
- **Global table standard** (shared `DataTable`, not per-page patches): full identity names stay readable (no initials-only names); no overlapping or unreadably narrow columns; per-column minimum widths; horizontal scroll inside the table is acceptable for dense tables; width goes to useful columns, not empty space. Sticky identity/actions columns only if RTL-safe. Desktop = dense table; mobile/tablet = cards.
- **Global pagination standard:** a footer `Previous 1 2 … N Next · 10 per page` (label "10 per page", never "Rows per page: 10"); default 10, options 10/25/50/100; moved out of the filter bar; mirrors correctly in RTL.
- **Auto search / filter standard (retained from 0C):** typing or changing a filter updates results; no Search button anywhere.
- **Date standard:** `DD/MM/YYYY` and `DD/MM/YYYY HH:mm:ss` across Admin.
- **Users:** the 12 approved columns; full names; Registered sorts by registration date only and Profile Completion sorts independently (no cross-wired sort state); Preview-only registration-date variation so sorting is visually verifiable (real DB dates untouched).
- **Row actions:** the eye icon always means **View on platform** (opens the user-facing profile in a new tab); **Manage** opens Admin Details. No impersonation.
- **Follow-up workflow (requirements):** a follow-up is an operational contact attempt, separate from Admin Notes (freeform context), Audit (system change history) and Entity Timeline (human-readable history). Log action = type (Call · WhatsApp · Email · Verification follow-up · Other), outcome/internal note, follow-up date and time, acting/assigned staff, optional next-reminder concept; history shows type, outcome, actor, timestamp, next follow-up date, status. No persistence or reminder backend yet.
- **Report / internal case:** subject, name, phone, email, details, optional attachment, submit/cancel. PD-009 (support tickets) stays separate and deferred.
- **Global Command Palette:** `Ctrl+K` / `Cmd+K` from any Admin Preview page — **no new global-search backend or server-action architecture in Phase 0D** (Preview uses existing safe read data, existing queries, isolated fixtures and local navigation definitions); grouped results across Users, Organizations, Review requests, Network referrals, Admin Staff and Admin pages (Points, Analytics, Audit, Settings…); debounced search, arrow-key navigation, Enter opens, Escape closes, no page reload. Preview uses real rows where a query already exists plus fixtures; **real server-side global search is a later backend item**.
- **Settings:** Profile (Photo, Full Name, Username, Phone, Email) + Security → Change Password (current / new / confirm / save) per PD-014. No Auth wiring.
- **Admin Staff + Dynamic RBAC** (PD-008): the standalone Access page is removed; Admin Staff hosts Staff · Roles · Permissions; roles show name, description, rank, assigned-staff count, status, edit/duplicate/archive; the role editor groups `resource.action` permissions; scope concepts Platform · Organization · Branch · Department/Team · User. No enforcement.
- **Dashboard:** no Recent Activity and no Needs Attention; Users by status and Organizations by status, only states Aladdin actually supports.
- **Review Center** (PD-015): tabs All · Organization Requests · Network Referrals · Verifications, visually distinct; Organization Requests carry no Points context; Network Referrals show provenance, network relationship and reward eligibility.
- **Points:** the page shows a default user immediately (summary + ledger with running balance), plus Adjust and Reverse dialogs. Uses genuine existing ledger data when the environment has any; otherwise **clearly-labelled isolated Preview fixtures** — fixture balances/transactions are never presented as real, and **no referral/points records are created in the shared local database** to make the page look populated (that DB already carries leftover state that breaks order-dependent pgTAP). Adjust/Reverse stay non-mutating. A true Points E2E is deferred to an isolated/clean DB during backend acceptance.
- **Analytics (revised):** presets Today / Last 7 days / Last 30 days / Custom (From–To); Landing Page Views is the primary KPI; Profile Views, Searches, Job Applications and Clicks cards removed; Signups, Logins, Page Engagement, Total Registered and visitor-to-signup conversion kept; Visitors with `DD/MM/YYYY HH:mm:ss`; Top Pages grouped by canonical route (`/profile/[id]`); an interactive multi-series chart (legend toggles, hover tooltip, range controls) that never claims to be "Live". No tracking or IP collection.
- **Audit (revised presentation):** Actor · Action · Entity · Details · Context/route · Date & time; expandable details (target, before/after, reason, metadata, reference id) without raw JSON by default; filters Actor · Action · Entity type · Date range · text, auto-applied; the 0C partial pagination retained with the standard footer. Admin Audit and Analytics events are never mixed.

**Out of bounds for Phase 0D (backend):** password/Auth migrations and password enrollment; Dynamic RBAC schema, enforcement, role creation/assignment; Organization Request schema and Review Center workflow changes; referral lifecycle migrations; Points mutations; Follow-up persistence; report/ticket backend; analytics tracking; IP collection; realtime changes. **No Supabase migration is added in Phase 0D.**

**Pre-PR acceptance gate (mandatory):** the recovered backend work on this branch (`20260929090001_admin_network_referral_review.sql` + pgTAP `65_…`) was validated only against the shared, un-reset local database, where pgTAP files 11/16/20 fail for reasons proven independent of it. Before any PR/merge of this branch: run a **clean, isolated `supabase db reset` + full `supabase test db`** and record the result. Not done yet.

---

## Phase 1 — Admin operational safety (P0)

### BL-001 — User suspend / restore
- **Problem:** `users.status` has `suspended`/`deactivated` enum values with UI badge colors already wired, but exhaustive grep confirmed **zero write path** (no RPC) and **zero enforcement path** (no middleware/RLS check anywhere references these states). A platform admin currently cannot stop a bad-actor account from using Aladdin through any surface.
- **Expected outcome:** An admin can suspend a user (with a required reason), the suspension is actually enforced (the user cannot continue transacting/authenticating meaningfully), and the admin can restore them.
- **Related feature-matrix rows:** A3.
- **Dependencies:** none blocking; should land together with BL-004 (RBAC re-tiering).
- **Blocked by:** ~~PD-004~~ **RESOLVED — PD-004/PD-010 approved 2026-09-19.** Semantics locked (see `PRODUCT_DECISIONS_REGISTER.md` PD-010: preserve data, server-enforced, required reason, actor+timestamp, restorable, optional expiry if clean, audited, never hard-delete). Exact tier still to be fixed at design time per PD-010's own note (informed by PD-004's separation-of-duties principle, not defaulted to `support`). **Still blocked on PD-013's own gate: Phase 1 backend does not start until the Phase 0 Preview is reviewed.**
- **DB impact:** Additive migration only — two new `SECURITY DEFINER` RPCs (`platform_suspend_user`, `platform_restore_user`), no schema/column change (the enum values already exist). New audit vocabulary: `account.suspended`, `account.restored` (additive to `ck_audit_action_known`). An optional expiry column, if adopted per PD-010, plus a decision on what enforces auto-expiry.
- **Backend impact:** New RPCs gated on `is_platform(<tier per PD-004>)`, requiring a non-null reason, writing the audit event, updating `users.status`. Decide and implement the actual enforcement point — most consistent with the existing pattern is extending `app.require_verified_caller()` (the shared chokepoint most write RPCs already call) to reject a suspended caller, and/or `frontend/src/middleware.ts` reading status on every request the way Talent's does.
- **Frontend impact:** A suspend/restore action (button + reason field, reusing the `ConfirmationModal`-equivalent pattern already used for the referral reject flow) on `AdminUserDetailPage`.
- **Authorization impact:** New capability; must be genuinely server-enforced (RLS/RPC), never UI-hidden only, per root `AGENTS.md`'s security baseline.
- **Audit requirements:** `account.suspended`/`account.restored`, actor, subject, reason, timestamp — matching the existing `network_referral.rejected` pattern exactly.
- **i18n requirements:** New `admin.users.suspend*`/`admin.users.restore*` keys in both `en.ts`/`ar.ts`, verified by the existing `i18n.test.ts` parity check.
- **Required tests:** pgTAP — RPC requires a reason; RPC requires the correct platform tier; a non-staff caller is refused (`42501`); the enforcement point actually blocks a suspended user's subsequent action; restore reverses it cleanly. Frontend: the new action's server action, mirroring `network-referrals.ts`'s action tests if any exist for that pattern.
- **Acceptance criteria:** A suspended user cannot complete the action the enforcement point gates (verified live, not just by code inspection, per this session's own verification-before-completion practice); the action is audited; the reason is captured and visible to admin; restore fully reverses the block.
- **Suggested priority:** **P0**

### BL-002 — Organization suspend / restore
- **Problem:** Same shape as BL-001 for organizations — `organizations.status`/`deleted_at` exist and are read, but nothing in admin ever writes them.
- **Expected outcome:** An admin can suspend a fraudulent/abusive organization (with a required reason), affecting its members' effective access, and restore it.
- **Related feature-matrix rows:** A4.
- **Dependencies:** BL-001 (shares the same underlying design pass and reason-capture pattern).
- **Blocked by:** ~~PD-004~~ **RESOLVED — PD-004/PD-011 approved 2026-09-19.** Tier locked to `administrator`. Principle locked: suspension is NOT equivalent to suspending member accounts — restricts org-level capability only, preserves member identities/history/records/in-flight data unless a module says otherwise. **New, harder prerequisite added by PD-011: the module-by-module effect of an org suspension must be documented BEFORE backend implementation begins** — not yet produced; required before BL-002's backend work, not just before this note is resolved. Also still gated on PD-013 (Phase 0 Preview review before Phase 1 backend starts).
- **DB impact:** Additive migration — `platform_suspend_organization`/`platform_restore_organization` RPCs; new audit vocabulary `organization.suspended`/`organization.restored`.
- **Backend impact:** New RPCs gated on `is_platform('administrator')` (locked by PD-011, no longer a recommendation). The module-by-module cascade scope (which of RFQs/quotations/orders/directory visibility/etc. a suspension actually restricts) must be documented as its own deliverable before this item's backend work starts, per PD-011.
- **Frontend impact:** Suspend/restore action + reason field on `AdminOrgDetailPage`.
- **Authorization impact:** Higher blast radius than BL-001 (affects every member of the org) — must not be reachable at a lower tier than decided in PD-004.
- **Audit requirements:** `organization.suspended`/`organization.restored`, actor, subject, reason, timestamp.
- **i18n requirements:** New `admin.orgs.suspend*`/`admin.orgs.restore*` keys, both locales, parity-tested.
- **Required tests:** pgTAP mirroring BL-001's list, plus a specific test that a suspended organization's members are actually affected as scoped (whatever the scope decision lands on).
- **Acceptance criteria:** Mirrors BL-001, adapted for the organization/membership cascade scope decided during design.
- **Suggested priority:** **P0**

### BL-003 — Points admin adjustment UI
- **Problem:** `public.adjust_points()` and `public.reverse_points_entry()` are fully built, secure, audited, reason-required RPCs with **zero admin UI** anywhere calling them (confirmed by grep — the only references are in the auto-generated `database.types.ts`). This is the exact same "backend capability, no Admin UI" pattern the user already identified once with Network Referrals — and the cheapest possible P0 to close, since the hard part (the RPC) is already done and already schema-tested.
- **Expected outcome:** An admin can view a user's Points ledger history and issue a manual adjustment (with a required reason code) or reverse a specific prior entry, through the product.
- **Related feature-matrix rows:** J1 (context — the ledger architecture itself needs no change), J2.
- **Dependencies:** none — the RPCs are complete; this is UI-only work, directly analogous in shape to this session's own Network Referral admin UI build (query function → server action → thin review component → wire into an admin page).
- **Blocked by:** ~~PD-004~~ **RESOLVED — PD-004/PD-012 approved 2026-09-19.** Tier locked to `administrator` (stricter than the RPCs' current `is_platform('support')` gate — implementation must **re-tier** `adjust_points`/`reverse_points_entry`, not just build UI over the existing gate). Ledger model, required fields, and "never overwrite/edit/delete" guarantees are all ratified as-is (PD-012 confirms the existing architecture is correct — no redesign). Still gated on PD-013 (Phase 0 Preview review before Phase 1 backend starts).
- **DB impact:** **None** for the ledger/RPC logic itself (already correct per PD-012) — only the `is_platform('support')` → `is_platform('administrator')` re-tier inside each RPC body (a `create or replace function`, additive migration).
- **Backend impact:** A new query function (`listUserPointsLedger` or similar, reading `points_ledger` scoped to a user, RLS-respecting) and two thin server actions wrapping the re-tiered `adjust_points`/`reverse_points_entry` — following exactly the pattern `server/actions/network-referrals.ts`'s `approveNetworkReferral`/`rejectNetworkReferral` established this session.
- **Frontend impact:** A Points panel on `AdminUserDetailPage` (or a new `/admin/points` surface if ledger-wide review across users is also wanted — scope to decide at design time) showing ledger history + an adjust/reverse action.
- **Authorization impact:** None new — the RPCs already enforce everything server-side (`is_platform(...)`, non-null reason, non-zero delta); the UI is a thin, unprivileged wrapper, exactly like this session's referral-review UI.
- **Audit requirements:** Already handled by the existing RPCs (`points.adjusted`/`points.reversed` are already written) — no new audit work needed, only surfacing what already exists.
- **i18n requirements:** New `admin.points.*` keys (ledger labels, adjust/reverse action copy, reason-code labels if PD-005's taxonomy pattern is reused here), both locales, parity-tested.
- **Required tests:** No new pgTAP needed (the RPCs already have schema-level correctness — verify existing coverage in `35_points_core_test.sql`/`36_referral_points_test.sql` is sufficient, extend only if a gap is found). Frontend: query/action unit tests mirroring `network-referrals.ts`'s pattern; a live browser E2E adjustment + reversal, following this session's own verification methodology (local Supabase, real login, direct Postgres confirmation).
- **Acceptance criteria:** An admin can view any user's ledger, issue an adjustment that appears immediately (derived balance updates), reverse it, and see both the original and compensating entries — verified live end-to-end, not just by code inspection, mirroring the rigor this session applied to the Network Referral admin UI.
- **Suggested priority:** **P0**

### BL-004 — Re-tier sensitive RPCs to match the approved permissions spec
- **Problem:** Nearly every existing gated write RPC (`review_approve/reject`, `network_referral_approve/reject`, `showroom_referral_approve/reject`) uses `is_platform('support')` — the lowest tier — meaning all three platform roles can currently do all of these identically, contradicting Aladdin's own already-approved `docs/technical/07_permissions_matrix.md` §5, which explicitly differentiates Support/Moderator/Administrator authority.
- **Expected outcome:** The tier each existing (and each newly-built, per BL-001–003) sensitive RPC requires matches the approved spec, closing the spec-vs-implementation gap this audit found.
- **Related feature-matrix rows:** L1.
- **Dependencies:** Should land together with BL-001/002/003 (their tier is exactly what this item is retroactively correcting/confirming for the *existing* RPCs).
- **Blocked by:** ~~PD-004~~ **RESOLVED — approved 2026-09-19.** Principle locked: real separation of duties required, fixed 3-tier model retained (no dynamic RBAC, PD-008 deferred). Organization governance and Points adjustment are now explicitly Administrator-only (PD-011/PD-012); verification/referral review stays at `support` (unchanged, matches the approved spec's own "decide (cap)" row for all three tiers). Still gated on PD-013 for when implementation may begin.
- **DB impact:** None structural — literal string changes inside existing RPC bodies (`create or replace function ... is_platform('support') → is_platform('administrator')` where the spec calls for it), each its own additive migration per Aladdin's forward-only migration convention.
- **Backend impact:** Careful audit of every existing `is_platform('support')` call site against `07_permissions_matrix.md` §5's table, changing only where the spec and code genuinely disagree (verification/referral review likely stays at `support`, per the spec's own "decide (cap)" row applying to all three tiers there).
- **Frontend impact:** None beyond ensuring the UI doesn't offer an action to a role that will now be refused server-side (a courtesy, not the security boundary).
- **Authorization impact:** This item *is* a security-hardening change — closing a real gap between documented intent and enforced behavior.
- **Audit requirements:** No new audit events; existing ones are unaffected by a tier change.
- **i18n requirements:** None.
- **Required tests:** pgTAP updates to every affected existing test file (`51_network_referrals_test.sql`, etc.) asserting the corrected tier — e.g. a test that a `moderator`-only role is now refused where the spec requires `administrator`, if any such gap is found and closed.
- **Acceptance criteria:** Every RPC's gate matches `07_permissions_matrix.md` §5's table exactly, verified by a pgTAP assertion per changed RPC.
- **Suggested priority:** **P0** (as part of BL-001–003's own design; Later/P2 if scoped as a separate retroactive audit of pre-existing RPCs not touched by this backlog)

---

## Phase 2 — User & Organization operations (P1) — **APPROVED SCOPE, LOCKED 2026-09-19**

Per the Product Owner's Part B direction, this phase's scope is now approved and authoritative for implementation (still **not implemented** — this is a scope lock, not a build). It absorbs three items that were previously scattered in later phases (admin notes, entity timeline, duplicate management) because the Product Owner scoped them as Phase 2, not later — their original locations below are now forward-references only.

### BL-005 — Users Directory: server-side search, pagination, filters, sorting
- **Problem:** `listUsers()` hard-caps at 200 rows and does search via in-memory JS filtering after the fetch — not scalable, and silently misses users outside the newest 200.
- **Expected outcome:** Real DB-side search, status/account-type filters, sortable columns, and real server-side pagination. **Explicitly locked requirement: no fixed-200-row, browser-search architecture** — the replacement must not simply raise the cap, it must remove the "fetch everything then filter in JS" shape entirely.
- **Related feature-matrix rows:** A1.
- **Dependencies:** none.
- **Blocked by:** nothing.
- **DB impact:** Optional `pg_trgm` index on `profiles.display_name` for search performance (additive, non-breaking).
- **Backend impact:** Rewrite `listUsers()` to build search/filter/sort/pagination into the actual Postgres query (`.ilike()`/FTS, `.eq()`, `.order()`, `.range()`) instead of fetching-then-filtering.
- **Frontend impact:** Search box, status/account-type filter controls, sortable column headers, and pagination UI on `AdminUsersPage`, following the URL-state pattern already used elsewhere in Aladdin (e.g. the Network Directory's `?tab=&q=&trade=` convention).
- **Authorization impact:** None new — same RLS-scoped read, just a more complete query.
- **Audit requirements:** None (read-only).
- **i18n requirements:** New filter/sort-label keys, both locales, parity-tested.
- **Required tests:** Query-function unit tests for each filter/sort/pagination combination; a component test for the pagination controls.
- **Acceptance criteria:** Searching/filtering/sorting returns correct results regardless of total user count, entirely server-side; pagination works past any row count; no client-side full-list fetch remains.
- **Suggested priority:** P1

### BL-021 — User Details Page: locked information architecture
- **Problem:** `AdminUserDetailPage` today shows only type/status/joined/memberships/verifications, with no consistent structure for the richer set of tabs Phase 2 requires, and no actions at all.
- **Expected outcome:** The user detail page is organized into the following tabs/sections, each independently loadable:
  1. **Overview** — identity, status, verification badge, quick facts.
  2. **Profile** — the existing profile fields (headline, etc.), read-only in Phase 2.
  3. **Organizations** — the existing memberships list (already built), unchanged in substance, placed under this tab.
  4. **Verification** — the existing verification history (already built), placed under this tab.
  5. **Points** — ledger history for this user (new — see BL-003 for the adjustment/reversal actions themselves; this tab is the read surface those actions attach to).
  6. **Activity** — the Entity Timeline for this user (see BL-012, now Phase 2 scope).
  7. **Admin Notes** — internal notes for this user (see BL-008, now Phase 2 scope, Users included in its initial scope).
  8. **Audit** — audit_log entries where this user is the actor or the subject, filtered inline (a scoped view over BL-011's audit explorer, not a separate implementation).
- **Related feature-matrix rows:** D1, I1, G1, J1/J2.
- **Dependencies:** BL-003 (Points RPCs/query), BL-008 (Admin Notes), BL-011 (Audit filtering, for the scoped Audit tab), BL-012 (Entity Timeline).
- **Blocked by:** nothing structural for the tab shell itself; individual tabs are only as complete as their own dependency.
- **DB impact:** None beyond what BL-003/008/011/012 each already specify.
- **Backend impact:** A tab-shell composition over the existing `getUserDetail()` plus each dependency's own query.
- **Frontend impact:** New tabbed `AdminUserDetailPage` layout — reuse Aladdin's existing tab primitive if one exists in the shared component library (check before building a new one, per the design-strategy instruction below).
- **Authorization impact:** None new beyond each tab's own dependency.
- **Audit requirements:** None new for the shell itself.
- **i18n requirements:** New tab-label keys, both locales, parity-tested.
- **Required tests:** Component test that all 8 tabs render and switch correctly; each tab's own data test lives with its dependency item.
- **Acceptance criteria:** All 8 tabs are reachable, each shows real data (or a correct empty state) for its scope, and the page communicates — per the audit's own stated UX goal — who this user is, their current status, verification, organizations, Points, history, notes, and what Admin can do, in one place.
- **Suggested priority:** P1

### BL-006 — Organizations Directory: server-side search, pagination, filters, sorting
- **Problem:** `listOrganizations()` has the same `.limit(200)` ceiling and, worse, no search field at all.
- **Expected outcome:** Same as BL-005, for organizations (search by name, filter by org_type/status, sortable columns, real pagination) — same "no fixed-200-row, browser-search architecture" requirement.
- **Related feature-matrix rows:** A2.
- **Dependencies:** none (parallel, near-identical work to BL-005 — consider doing both in one pass given the shared pattern).
- **Blocked by:** nothing.
- **DB impact:** Optional `pg_trgm` index on `organizations.name`.
- **Backend/Frontend/Authorization/Audit/i18n/Tests:** Mirror BL-005 exactly, scoped to organizations.
- **Acceptance criteria:** Mirrors BL-005.
- **Suggested priority:** P1

### BL-022 — Organization Details Page: locked information architecture
- **Problem:** `AdminOrgDetailPage` today shows type/status/verified/branches/members/verifications, with no consistent structure for the richer set of tabs Phase 2 requires, no actions, and no referral-provenance visibility (BL-007's original gap).
- **Expected outcome:** The organization detail page is organized into the following tabs/sections:
  1. **Overview** — name, type, status, verification badge, quick facts.
  2. **Members** — the existing members list (already built), placed under this tab.
  3. **Branches** — the existing branches list (already built), placed under this tab.
  4. **Ownership** — who owns/manages this organization (derive from `memberships`' `org.manage` capability holders — new: not currently surfaced anywhere as its own concept, today it's implicit inside the flat Members list).
  5. **Verification** — the existing verification history (already built), placed under this tab.
  6. **Network / Referrals** — provenance (`organizations.source`/`referred_by_user_id`, BL-007's original scope) plus, where applicable, the specific Network/Sales referral record that produced this organization.
  7. **Activity** — the Entity Timeline for this organization (BL-012, Phase 2 scope).
  8. **Admin Notes** — internal notes for this organization (BL-008, Phase 2 scope, Organizations included in its initial scope).
  9. **Audit** — audit_log entries scoped to this organization (a scoped view over BL-011's audit explorer).
- **Related feature-matrix rows:** B1, D1, I1, G1.
- **Dependencies:** BL-007 (provenance data — folded into the Network/Referrals tab rather than built as a separate standalone field), BL-008 (Admin Notes), BL-011 (Audit filtering), BL-012 (Entity Timeline).
- **Blocked by:** nothing structural for the tab shell; individual tabs are only as complete as their own dependency.
- **DB impact:** None beyond what BL-007/008/011/012 each already specify; the "Ownership" concept (distinguishing an owner/manager membership from an ordinary member) is a read-only derivation from existing `membership_capabilities`, no schema change.
- **Backend impact:** A tab-shell composition over `getOrganizationDetail()`, extended to select `source`/`referred_by_user_id` (BL-007) and to flag owner-capability members for the Ownership tab.
- **Frontend impact:** New tabbed `AdminOrgDetailPage` layout, same shared tab primitive as BL-021.
- **Authorization impact:** None new beyond each tab's own dependency.
- **Audit requirements:** None new for the shell itself.
- **i18n requirements:** New tab-label + Ownership-concept keys, both locales, parity-tested.
- **Required tests:** Component test that all 9 tabs render and switch correctly; each tab's own data test lives with its dependency item.
- **Acceptance criteria:** All 9 tabs are reachable, each shows real data (or a correct empty state), and the page communicates — per the audit's own stated UX goal — what this organization is, who owns it, its members, branches, status, verification, network/referral provenance, activity, admin notes, and available actions, in one place.
- **Suggested priority:** P1

### BL-008 — Internal Admin Notes (Phase 2 initial scope: Users + Organizations)
- **Problem:** No internal-notes concept exists anywhere in Aladdin admin — an admin cannot record "called this showroom, confirmed legitimate" against a user or organization without leaving the product.
- **Expected outcome:** A generic, reusable internal-note capability, with **Phase 2's scope explicitly limited to Users and Organizations** (verification/referral notes are a later extension of the same mechanism, not required for Phase 2). Notes are internal-only by default and retain **author**, **timestamp**, and **content**, exactly as specified.
- **Related feature-matrix rows:** G1, D1.
- **Dependencies:** none.
- **Blocked by:** nothing.
- **DB impact:** New additive table `admin_notes` (`subject_type` constrained to `user`/`organization` for Phase 2, `subject_id`, `author_user_id`, `body`, `created_at`) — no UPDATE/DELETE grant to anyone (immutable history, matching the points-ledger "compensating entry, never edit" philosophy already established in this codebase), RLS scoped to platform staff only (self+platform pattern, matching `network_referrals`' own RLS shape).
- **Backend impact:** A `SECURITY DEFINER` RPC to add a note (`add_admin_note(subject_type, subject_id, body)`), a read query scoped by subject.
- **Frontend impact:** The "Admin Notes" tab on `AdminUserDetailPage` (BL-021) and `AdminOrgDetailPage` (BL-022).
- **Authorization impact:** Must never be readable by the subject themselves or by non-platform users.
- **Audit requirements:** `admin_note.created` (additive to `ck_audit_action_known`).
- **i18n requirements:** New `admin.notes.*` keys, both locales, parity-tested.
- **Required tests:** pgTAP — RLS denies the subject and non-staff read access; only platform staff can write; notes are immutable (no update/delete grant exists); `subject_type` is constrained to the Phase 2 set.
- **Acceptance criteria:** An admin can leave and later read a note on a user or an organization; the subject cannot see it; author and timestamp are always shown.
- **Suggested priority:** P1

### BL-012 — Entity Timeline (Phase 2 scope: user/organization)
- **Problem:** No unified, human-readable narrative exists for a user or organization's history — the underlying events (verifications, referrals, audit_log) are already queryable but not assembled into one timeline.
- **Expected outcome:** A "Registered → Profile completed → Verification submitted → Approved → ..." timeline, **explicitly distinct from the raw Audit Log** (BL-011) — this is the human-readable operational history, not a technical action feed — feeding the "Activity" tab on both `AdminUserDetailPage` (BL-021) and `AdminOrgDetailPage` (BL-022).
- **Related feature-matrix rows:** I1.
- **Dependencies:** none (purely a read-side composition of already-existing data).
- **Blocked by:** nothing.
- **DB impact:** None.
- **Backend impact:** A derived query unioning the relevant per-domain event sources for a given subject, sorted by time, translated into human-readable narrative entries (not raw audit rows).
- **Frontend impact:** An `EntityTimeline` component, shared between the User and Organization detail pages.
- **Authorization impact:** None new.
- **Audit requirements:** None (read-only composition).
- **i18n requirements:** New timeline-event-label keys, both locales.
- **Required tests:** Query-function unit test asserting correct chronological ordering across mixed event sources.
- **Acceptance criteria:** A reviewer can see a subject's full human-readable history in one place, without visiting three separate sections and without reading raw `audit_log` rows.
- **Suggested priority:** P1

### BL-015 — Duplicate Management (Phase 2 limited scope, per PD-006)
- **Problem:** Duplicate detection exists only inside the two referral-review flows; the Organizations directory itself has no dedup assistance, and the audit's original recommendation was open-ended ("generalize it eventually"). PD-006 has now formally approved a specific, limited scope.
- **Expected outcome:** **Detect probable duplicate → show candidate → link to existing where appropriate**, reusing the existing `pg_trgm` similarity technique already proven twice in this codebase (`admin_showroom_referrals_list`, `admin_network_referrals_list`). **Full transactional entity merge is explicitly out of scope for Phase 2** (remains BL-017, Phase 6, deferred per PD-006).
- **Related feature-matrix rows:** B2, B3.
- **Dependencies:** none (the SQL pattern already exists twice in this codebase).
- **Blocked by:** nothing (PD-006 resolved this item's scope).
- **DB impact:** None (reuses the existing `extensions.similarity()` pattern).
- **Backend impact:** A read-only query, mirroring `admin_network_referrals_list`'s match logic, generalized beyond the referral flows to the Organizations directory / org creation & verification flow.
- **Frontend impact:** A "possible duplicates" panel, surfaced wherever an organization is being created or verified, with a "link to this business" action — never a merge action.
- **Authorization impact:** None new.
- **Audit requirements:** None for the detection itself (read-only, non-blocking hint); a link-to-existing action, if taken, is audited exactly as the existing referral-link actions already are.
- **i18n requirements:** New copy, both locales.
- **Required tests:** Query-function unit test for match/no-match cases.
- **Acceptance criteria:** An admin creating or verifying an organization sees the same kind of duplicate hint a referral reviewer already gets, and can link to an existing organization instead of creating a duplicate; no merge action is exposed anywhere.
- **Suggested priority:** P1

---

## Phase 3 — Unified moderation / review enrichment (P1/P2)

### BL-009 — Enrich the generic verification review card
- **Problem:** The generic verification queue's cards show less context (no attachments/documents view, no prior-decision history for repeat submitters, no notes) than the referral review cards already built this session, on the same page.
- **Expected outcome:** Consistent review-details depth across all three queues on `/admin/verifications`.
- **Related feature-matrix rows:** D1.
- **Dependencies:** BL-008 (Admin Notes, now Phase 2 — its notes mechanism is reused here, but Phase 2's own scope for BL-008 is Users+Organizations only; extending notes to verifications is this item's own small addition, not a Phase 2 requirement).
- **Blocked by:** nothing for the history piece (data already exists); BL-008 for the notes piece.
- **DB impact:** None for history (already queryable); depends on BL-008 for notes.
- **Backend impact:** Extend the verification list/detail query to include the subject's prior verification attempts.
- **Frontend impact:** Render prior-attempt history and (once BL-008 lands) the notes panel inline on the verification review card.
- **Authorization impact:** None new.
- **Audit requirements:** None new (reads existing audit-adjacent data).
- **i18n requirements:** New copy for "previous attempts" section, both locales.
- **Required tests:** Query-function unit test for history resolution.
- **Acceptance criteria:** A reviewer sees a repeat submitter's prior decisions inline without leaving the page.
- **Suggested priority:** P1

### BL-010 — Structured rejection-reason taxonomy + internal admin note
- **Problem:** All rejection flows are free-text only; no reportable structure exists; no internal-note-vs-user-visible-message separation exists.
- **Expected outcome (scope updated per PD-005, approved):** A **required** `reason_code` (`duplicate | invalid_information | unable_to_verify | incomplete_information | not_eligible | other`) on every reject path, **plus an optional internal Admin note** kept as a genuinely separate concept from the user-visible rejection message — the note is never shown to the rejected subject.
- **Related feature-matrix rows:** A5.
- **Dependencies:** BL-008 (the internal-note piece should reuse the same `admin_notes` mechanism rather than a bespoke field, for consistency — though this item's note is attached to the rejection decision itself, which may mean extending `admin_notes.subject_type` beyond Phase 2's Users+Organizations scope to also cover verifications/referrals, a small scope extension of BL-008 rather than a new mechanism).
- **Blocked by:** ~~PD-005~~ **RESOLVED — approved 2026-09-19.** Taxonomy and required-vs-optional split are locked (see above); no further product sign-off needed on the code list itself.
- **DB impact:** Additive **non-nullable** (required, not nullable as originally scoped) enum column per reviewable table (`verifications.reason_code`, `network_referrals.reason_code`, `organization_referrals`' equivalent) — existing rows need a migration-time default or backfill decision since the column is now required, not optional as originally drafted.
- **Backend impact:** Extend each reject RPC to require `p_reason_code`; accept an optional internal note via BL-008's mechanism.
- **Frontend impact:** A required dropdown alongside the existing reason textbox on every reject form, plus an optional internal-note field.
- **Authorization impact:** None new.
- **Audit requirements:** Include `reason_code` in the existing rejection audit events' metadata; note creation is audited via BL-008's `admin_note.created`.
- **i18n requirements:** New `admin.reasonCodes.*` keys for each code, both locales.
- **Required tests:** pgTAP asserting the code is now required (rejects a null code, breaking change from the original optional design — intentional per the approved decision) and is correctly stored/audited.
- **Acceptance criteria:** A reviewer must select a structured reason on every reject action, may optionally add an internal note, and the note is never visible to the rejected subject.
- **Suggested priority:** P1 (raised from P2 — now a required field per the approved decision, not an optional enhancement)

---

## Phase 4 — Audit & history (P1/P2)

### BL-011 — Audit log filters (actor, action, entity, date range)
- **Problem:** `/admin/audit` is a flat, unfiltered, hard-capped-at-60-rows list with 60+ possible action types — not usable as an investigation tool at real volume. `metadata jsonb` is fetched but never rendered.
- **Expected outcome:** A reviewer can filter the audit log by actor, action type, subject type, and date range, and see an entry's metadata.
- **Related feature-matrix rows:** H1 (context — no change needed to the underlying single-table architecture), H2.
- **Dependencies:** none.
- **Blocked by:** nothing.
- **DB impact:** None required for basic filtering (existing indexes on `audit_log` likely sufficient for `actor_user_id`/`subject_type`/`created_at`; verify and add a composite index only if query performance testing shows a need).
- **Backend impact:** Extend `listAudit()` to accept `actor`, `action`, `subjectType`, `from`, `to` params, each an additional `.eq()`/`.gte()`/`.lte()` on the existing query.
- **Frontend impact:** Filter controls on `/admin/audit`; an expandable "details" row rendering `metadata` per entry; real pagination past 60.
- **Authorization impact:** None new — same RLS-scoped read.
- **Audit requirements:** None (read-only feature).
- **i18n requirements:** New filter-label keys, both locales.
- **Required tests:** Query-function unit tests per filter combination.
- **Acceptance criteria:** An admin can find "everything support-role X did on date Y" or "every points.adjusted entry this month" without a direct DB query.
- **Suggested priority:** P1

*(BL-012, Entity Timeline, was originally scoped here — the Product Owner locked it into Phase 2 instead; see the BL-012 entry under Phase 2 above. This heading is kept only so the BL numbering stays stable across the document's revision history.)*

---

## Phase 5 — Dashboard & discoverability (P2)

### BL-013 — Dashboard tiles link to filtered views
- **Problem:** Only 1 of 4 dashboard stat tiles (pending reviews) links to its filtered list; the rest, and the distribution lists, are static.
- **Expected outcome:** Every stat/distribution entry links to the corresponding filtered list view.
- **Related feature-matrix rows:** M1.
- **Dependencies:** BL-005, BL-006 (the destination pages need filter support for the links to be meaningful).
- **Blocked by:** nothing structural; sequencing depends on BL-005/006 landing first.
- **DB impact:** None.
- **Backend impact:** None beyond what BL-005/006 already provide.
- **Frontend impact:** Wrap each tile/list entry in a `Link` to the corresponding filtered URL.
- **Authorization impact:** None.
- **Audit requirements:** None.
- **i18n requirements:** None new.
- **Required tests:** None beyond existing coverage; a smoke test that each link resolves.
- **Acceptance criteria:** Clicking any dashboard number lands on the correctly pre-filtered list.
- **Suggested priority:** P2

### BL-014 — Pending-work badges in admin nav
- **Problem:** No nav-level indication of pending work; the count already exists (`pendingVerifications`) but isn't surfaced outside the dashboard.
- **Expected outcome:** A badge on the "Verifications" nav item showing the current pending count (including Network/Sales referrals now sharing that page).
- **Related feature-matrix rows:** P1.
- **Dependencies:** none.
- **Blocked by:** nothing.
- **DB impact:** None.
- **Backend impact:** Reuse the existing count computation; extend to include pending referrals if not already folded in.
- **Frontend impact:** A badge on `AdminSidebar`'s Verifications item.
- **Authorization impact:** None.
- **Audit requirements:** None.
- **i18n requirements:** None new (numeral only).
- **Required tests:** None beyond a component render test.
- **Acceptance criteria:** The nav badge count matches the actual pending-review count.
- **Suggested priority:** P2

*(BL-015, Duplicate Management, was originally scoped here — the Product Owner locked its limited "detect → suggest → link" scope into Phase 2 instead, per PD-006; see the BL-015 entry under Phase 2 above. This heading is kept only so the BL numbering stays stable across the document's revision history.)*

---

## Phase 6 — Advanced / deferred tooling (Later, several blocked on product decisions)

### BL-016 — Data export
- **Related feature-matrix rows:** R1. **Blocked by:** no formal PD (the capability itself is already spec'd in `07_permissions_matrix.md`). **Suggested priority:** Later.

### BL-017 — Full organization merge engine
- **Related feature-matrix rows:** B3. **Scope note:** this is specifically the full, transactional, every-FK-table re-parenting merge — the limited "detect → suggest → link to existing" scope is **approved and locked into Phase 2 as BL-015**, not this item. **Blocked by:** PD-006 (approved decision: do not build the full merge engine now). **Suggested priority:** Later, not scheduled.

### BL-018 — Dynamic RBAC (roles, permissions, scopes, Admin Staff)
- **Status 2026-09-30 — Phase 1A CLOSED / APPROVED** (branch `feature/admin-core-rbac-foundation`; deployment gate: one-time [Super Admin bootstrap](SUPER_ADMIN_BOOTSTRAP.md)): DB-backed RBAC, legacy-grant bridge, audited rank-checked RPCs, centralized frontend authorization, real Staff/Roles/Permissions. Design, cutover and retirement plan: [`ADMIN_RBAC_ARCHITECTURE.md`](ADMIN_RBAC_ARCHITECTURE.md); [ADR-0011](../decisions/ADR-0011-admin-rbac-platform-authority.md) (Accepted). **Next:** bridge retirement stage B, scoped-role UI (Phase 1B), Invitation sub-phase.
- **Related feature-matrix rows:** L2. **Unblocked 2026-09-29:** PD-008 is now **APPROVED — adapt CRM Dynamic RBAC to Aladdin** (was DEFERRED). **Previewed in:** Phase 0D (`/admin/preview/staff`). **First step:** a design audit of the tenant/scope model PD-008 lists (platform vs. organization roles; Platform · Organization · Branch · Department/Team · User scopes; super-admin safeguards; migration of every `app.is_platform(...)` call site and `membership_capabilities`). **Suggested priority:** after Phase 1 safety items; not scheduled.

### BL-023 — Organization Request workflow (PD-015)
- **What:** a distinct request record and lifecycle for "add my organization to Aladdin", reviewed in the Review Center next to (never inside) Network Referrals. No Points context. **Blocked by:** nothing — PD-015 is approved; needs its own schema design and approval. **Previewed in:** Phase 0D (Review Center → Organization Requests). **Suggested priority:** P1, not scheduled.

### BL-024 — Site-wide Data Freshness / Realtime Architecture Audit (PD-016)
- **What:** after the Admin Core backend-wiring stage, audit every module and classify how it stays fresh: **Realtime subscription** · **mutation-triggered refetch** · **focus/navigation refetch** · **polling** · **normal fetch**. **Not** part of Phase 0D — no realtime architecture is implemented there. **Blocked by:** Admin Core backend wiring. **Suggested priority:** Later.

### BL-025 — Dynamic RBAC actor-role snapshot in the audit trail
- **What:** `audit_log.actor_role` still stores the legacy `platform_role` tier (`support/moderator/administrator`), so events by a Super Admin or a custom-role holder show `administrator`/`support`. Record the actor's dynamic role(s) at event time — e.g. the highest active platform role key + name and rank (or the full active role-key set) — as an additive snapshot, and show it in Audit views.
- **Constraints:** additive only; **never** an authorization input (verified 2026-09-30 that `actor_role` is written only by `app.record_audit_event` and read by no policy/view/check); existing rows keep their legacy value; decide whether `actor_role` is then deprecated.
- **Blocked by:** nothing (ADR-0011 accepted). **Suggested priority:** P3, with the Audit module's wiring; not scheduled.

### BL-019 — Platform-level internal lead/prospect CRM
- **Related feature-matrix rows:** none directly (Talent-specific, see the matrix's "Talent-specific" table). **Blocked by:** PD-007 (approved decision: DEFERRED — do not build simply because Talent has one; revisit only when a real Aladdin Sales/Onboarding need justifies it). **Suggested priority:** Later, not scheduled.

### BL-020 — Support/contact-ticket queue
- **Related feature-matrix rows:** none directly (Talent-specific table). **Blocked by:** PD-009 (approved decision: DEFERRED — first evaluate existing Aladdin support/contact/chat flows and real operational need). **Suggested priority:** Later, not scheduled.

Each Phase 6 item is deliberately left at backlog-entry depth (not full field-by-field detail) since every one is blocked on a Product Decision whose answer would materially change scope — expanding them to full backlog-item detail before that decision lands would be speculative work.

---

## Summary

| Phase | Items | Priority | Status |
|---|---|---|---|
| 0 — Admin Frontend Blueprint / Preview | (this document's own delivery) | — | **Approved, in delivery** |
| 0B — Admin Product Blueprint Enrichment | (this document's own delivery) | — | **Delivered 2026-09-20** — enrichment of Phase 0's screens + Admin Staff + Analytics (new) + PD-011 module-effects doc |
| 0C — Admin Blueprint Final Refinement | (this document's own delivery) | — | **Delivered 2026-09-20** — global table/search/pagination conventions, Users/Organizations final column model, Points rework, Analytics KPI/chart/Top-Pages/Visitors, Audit partial pagination, new Settings page, CRM RBAC gap analysis |
| 0D — Final Admin Product Blueprint | (this document's own delivery) | — | **Implemented 2026-09-29, awaiting PO approval** — table/pagination standards, Command Palette, Follow-up/Report, Settings Change Password (PD-014), Dynamic RBAC Preview (PD-008), Review Center separation (PD-015), Points/Analytics/Audit revisions. **Pre-PR gate: clean DB reset + full pgTAP** |
| 1 — Admin operational safety | BL-001–004 | P0 | Semantics/tiers **approved** (PD-004/010/011/012); backend build gated on Phase 0/0B review (PD-013) |
| 2 — User & org operations | BL-005–006, BL-008, BL-012, BL-015, BL-021–022 | P1 | **Scope APPROVED/LOCKED** 2026-09-19; not yet implemented |
| 3 — Moderation/review enrichment | BL-009–010 | P1 | BL-010's taxonomy is approved (PD-005); not yet implemented |
| 4 — Audit & history | BL-011 | P1 | Not yet implemented (BL-012 moved to Phase 2) |
| 5 — Dashboard & discoverability | BL-013–014 | P2 | Not yet implemented (BL-015 moved to Phase 2) |
| 3 — Organization Requests | BL-023 | P1 | PD-015 approved; previewed in 0D; not implemented |
| 6 — Advanced/deferred | BL-016–020 | Later | BL-017/019/020 carry a **DEFERRED** decision (PD-006/007/009). BL-018 is **unblocked** (PD-008 approved 2026-09-29) and previewed in 0D; not scheduled |
