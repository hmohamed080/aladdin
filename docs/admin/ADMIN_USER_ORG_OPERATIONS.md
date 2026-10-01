# Admin Core Phase 1B-B — Users & Organizations operational workflows

**Purpose:** design (written before implementation) and record of the Phase 1B-B operational workflows: user suspension (PD-010), organization suspension (PD-011), Admin Notes, Follow-up, Internal Report / Case, Entity Timeline, and organization duplicate detection / link-to-existing (PD-006).
**Status:** implemented 2026-09-30 on `feature/admin-core-user-org-operations` (base `2cdbacd`, Phase 1B-A approved) — migrations `20260930100001`–`100004`, pgTAP `68_admin_user_org_operations_test.sql`, `admin_suspension_concurrency_test.sh`. **Awaiting Product Owner approval.** Design (§1–§11) was written before implementation; the record is §12.
**Related:** [ADMIN_RBAC_ARCHITECTURE.md](ADMIN_RBAC_ARCHITECTURE.md) · [ADMIN_USERS_ORGS_READ_AUDIT.md](ADMIN_USERS_ORGS_READ_AUDIT.md) · [PD-011_ORG_SUSPENSION_MODULE_EFFECTS.md](PD-011_ORG_SUSPENSION_MODULE_EFFECTS.md) · [PRODUCT_DECISIONS_REGISTER.md](PRODUCT_DECISIONS_REGISTER.md) (PD-004, PD-006, PD-010, PD-011).

**Out of scope (unchanged):** Points adjust/reverse and every Points amount or rule (a later Points Engine phase owns them — nothing here calculates or hardcodes Points), Organization Requests, Network Referral redesign, full organization merge, analytics, Realtime, Admin invitations, scoped directories.

---

## 1. Audit findings that shape the design

| # | Finding | Evidence |
|---|---|---|
| A1 | Tenant authority is one helper: `app.has_capability(org, key)` (126 call sites). Every domain `can_*` helper goes through it except the four PERSONAL helpers (`can_upload_avatar_object`, `can_upload_portfolio_object`, `can_create_professional_asset`) and `can_review_verification` (Admin). | catalog query of `pg_proc` |
| A2 | Capability keys split cleanly: reads end in `.read` (`activity.read`, `catalog.read`, `project.read`, `sales.read`, `verification.read`); everything else is a write (`catalog.write/publish`, `order.create/manage`, `rfq.create/respond`, `quote.submit/decide`, `sales.write/assign/manage`, `org.manage`, `org.members.manage`, `branch.manage`, `project.write`, `job.post`, `verification.submit`). | `membership_capabilities` |
| A3 | Of the 33 organization write RPCs, 31 are gated by a write capability; only `dashboard_kpi_layout_*_personal` and `save_product` / `unsave_product` (a member's own bookmarks) gate on membership alone. | per-function classification |
| A4 | `app.require_verified_caller()` — the gate of **34 personal RPCs** (job applications, referrals, reviews, portfolio …) — checks email verification only, never account status. | function body |
| A5 | Nothing checks `users.status` outside Admin/RBAC code: a `suspended` user is fully functional today. | catalog query |
| A6 | `organization_public_directory` and the open-jobs feed already list only `status = 'active'` organizations. Published products are readable **regardless** of the owning organization's status; `job_application_submit` does not re-check the poster's status; order creation checks only the buyer's capability. | view / function bodies, `products_select_published` |
| A7 | A PostgREST `db_pre_request` function (Supabase's documented pre-request pattern) runs before every API request and sees the JWT claims and `request.path`; proven on the isolated stack (suspended caller refused, allow-listed RPC and anon reads unaffected). | isolated probe. **Caveat found in Production:** PostgREST prepares the hook as the request role, so the hook's schema must be usable by `service_role` too — see [`POSTGREST_PRE_REQUEST_HOOK.md`](POSTGREST_PRE_REQUEST_HOOK.md) |
| A8 | The only service-role client in the web app serves the two registration/auth actions — no product-activity bypass. | `lib/supabase/admin-server.ts` callers |
| A9 | Users cannot share a phone (`uq_profiles_phone_e164`), an email (Auth) or a username (`uq_profiles_username_normalized`): **no authoritative duplicate signal exists between two user records**. Organizations have no contact column; their only stable identifiers are the names. | unique indexes |
| A10 | Referral review already has detect (name ilike / trigram > 0.4) → suggest → link-to-existing (`network_referral_approve` / `showroom_referral_approve` with `p_link_organization_id`, referrer preserved). Organization-vs-organization duplicates have no link at all. | referral RPCs |

## 2. Permissions

Existing: `users.suspend` (Super Admin, Administrator, Moderator), `organizations.suspend` (Super Admin, Administrator). New `resource.action` keys — none of the three records is an edit of the user or organization, so `users.read` / `organizations.read` are never treated as write authority, and no unrelated key is overloaded:

| Key | Meaning | Super Admin | Administrator | Moderator | Support |
|---|---|:-:|:-:|:-:|:-:|
| `notes.read` | read internal Admin Notes | 🔒 | ✓ | ✓ | ✓ |
| `notes.create` | append an Admin Note | 🔒 | ✓ | ✓ | — |
| `follow_ups.read` | read the follow-up history | 🔒 | ✓ | ✓ | ✓ |
| `follow_ups.manage` | log / assign / complete follow-ups | 🔒 | ✓ | ✓ | — |
| `cases.read` | read internal reports / cases | 🔒 | ✓ | ✓ | ✓ |
| `cases.create` | open an internal report / case | 🔒 | ✓ | ✓ | — |
| `duplicates.resolve` | link or dismiss an organization duplicate | 🔒 | ✓ | ✓ | — |

Every write additionally requires the parent read permission (`users.read` / `organizations.read`). Support stays read-only (PD-004). Duplicate **candidates** are readable with `organizations.read`.

## 3. Scope

Every mutation calls `app.admin_require(<perm>)` — `has_admin_permission` without context — so only a **platform** assignment qualifies. An organization-, branch- or user-scoped holder of `users.suspend` / `organizations.suspend` / `notes.create` … cannot act, not even on the entity it is scoped to (no scoped Admin UI exists; scoped operations belong with BL-027). Tested directly.

## 4. User suspension (PD-010)

**Record.** `public.admin_suspensions` — one row per suspension episode (user or organization): reason (required), actor, `suspended_at`, the status to restore, and on restore: restorer, `restored_at`, restore reason. At most one open episode per subject (partial unique index). `users.status` becomes `suspended`; restore returns the recorded previous status. Nothing is deleted or anonymized: profile, memberships, Points ledger, history are untouched.

**Expiry:** not implemented — automatic expiry needs a scheduler that does not exist (PD-010 makes expiry conditional on fitting the current architecture). Restoration is manual.

**Safety.** No self-suspension. A non-Super-Admin cannot suspend a staff member whose platform rank is ≥ their own. A `BEFORE UPDATE OF status` trigger on `users` takes the same advisory lock as the RBAC last-Super-Admin guard and refuses any status change that would leave zero active, non-suspended platform Super Admins — through every path, including the DBA.

**What a suspended user is blocked from — enforcement points:**

| Area | Server-side effect | Enforcement point |
|---|---|---|
| Every Data API request (tables, views, RPCs) | refused `42501 account suspended`, except `my_account_status` | PostgREST pre-request `app.api_pre_request()` |
| Sign-in / session | Supabase Auth still issues a session (sessions are not revoked); every data request made with it is refused; the web app routes the person to an "account suspended" page | pre-request + web gate |
| Profile edits (name, username, phone, avatar row) | refused | pre-request |
| Avatar / portfolio / professional-asset uploads (Storage API, not PostgREST) | refused | the four personal storage helpers now require an active account |
| Organization actions (reads and writes, every module) | refused | pre-request; `has_capability` / `is_org_member` return false for an inactive caller (also covers Realtime and Storage RLS) |
| Referrals, job applications, reviews, portfolio and other personal RPCs | refused | pre-request; `require_verified_caller()` raises for an inactive account |
| Points-affecting actions | the referral/job/review actions that lead to Points are refused (above); no Points rule is changed | as above |
| Admin console | no authority (existing: `has_admin_permission` ignores suspended accounts) | RBAC |
| Messages / community | not implemented in the product today — nothing to enforce | — |

**Known gaps (recorded, not claimed):** Realtime subscriptions that read the user's OWN rows through self-only RLS (`user_id = auth.uid()`) are not refused (read-only, own data). The Supabase Auth session is not revoked (no Admin-API path from the database; data access is what is blocked).

## 5. Organization suspension (PD-011)

Members are **never** suspended with their organization. `organizations.status` becomes `suspended` (previous status recorded for restore); organization, members, branches, ownership, history and in-flight records are preserved; nothing is cancelled.

| Module | Suspended-organization behavior | Current enforcement point | Change |
|---|---|---|---|
| All org writes (catalog, orders, RFQs, quotations, projects, jobs, Sales CRM, members, branches, org settings, verification requests) | NEW activity refused for the suspended organization's members; reads of its existing records keep working | `app.has_capability(org, key)` | returns **false for every non-`.read` key** while the org is suspended |
| Public directory | hidden | `_organization_public_directory` (`status = 'active'`) | none (already) |
| Catalog — public | existing published products hidden from the public, not deleted | `products_select_published` (status-blind) | policy also requires the owner organization not suspended |
| Jobs board | open postings hidden | `_open_job_opportunities` (`status = 'active'`) | none (already) |
| Job applications | a professional cannot apply to a suspended organization's job; existing applications stay readable | `job_application_submit` (no org check) | `BEFORE INSERT` trigger on `job_applications` |
| Orders — counterparty | no NEW order with a suspended supplier (PD-011 §4 safe default, pending Product confirmation); existing orders readable by both sides | `create_order_from_quotation` (buyer capability only) | `BEFORE INSERT` trigger on `orders` checks both organizations |
| RFQ / quotation decisions by a counterparty | not blocked (PD-011 §3: the counterparty's capability is its own) | counterparty `has_capability` | none |
| In-flight RFQs / quotes / orders / projects | never cancelled or hidden (PD-011 §12) | — | none |
| Members leaving voluntarily | allowed (their own membership) | membership RPC | none |
| Member bookmarks and personal dashboard layout | allowed (no counterparty-visible activity) | `save_product`, `dashboard_kpi_layout_*_personal` | none — recorded |
| Messaging, subscriptions, new reviews of the org | not implemented in the product / Product decision open (PD-011 §9–§11) | — | none |

## 6. Admin Notes

`public.admin_notes` — append-only (no update/delete grant; a trigger refuses UPDATE/DELETE for every writer), one subject (user XOR organization), body 1–4000 characters, author, `created_at`. `admin_notes_list` (parent read + `notes.read`), `admin_note_add` (parent read + `notes.create`, audited `admin_note.created` without the body).

## 7. Follow-up

`public.admin_follow_ups` — action type (`call`, `whatsapp`, `email`, `verification_follow_up`, `other` — the approved list), outcome / internal note, logger, logged time, optional next follow-up time, optional assignee (must be active Admin Staff holding `follow_ups.manage`), completion (who / when). **Status is derived, never stored:** Done (completed) · Overdue (due time passed, not done) · Open (otherwise). `admin_follow_up_log`, `admin_follow_up_complete` (idempotent), `admin_follow_ups_list`. **No reminder is delivered** — the due time is stored; notification delivery is deferred and the UI says so.

## 8. Internal Report / Case

`public.admin_cases` — an internal Admin operational record (never the deferred public support-ticket system, PD-009): subject line, contact name / phone / email, details, creator, `created_at`. `admin_case_create` (parent read + `cases.create`), `admin_cases_list` (`cases.read`). **Attachments deferred:** they need a new private bucket and its own Storage policies; no existing policy is weakened, and the file field is shown as not available.

## 9. Entity Timeline

`admin_entity_timeline(subject_type, id)` — one human-readable, newest-first list composed from the source records (never a copy of `audit_log`): registered; verification submitted / decided; organization membership joined (user) or member joined (organization); suspended / restored (with reason); follow-up logged / completed; note added; case opened; duplicate linked / dismissed. Entries from notes, follow-ups and cases appear only for callers holding their read permission.

| Surface | What it is |
|---|---|
| Audit | immutable technical/admin event record (`audit_log`) |
| Follow-up | operational contact history |
| Admin Notes | internal freeform context |
| Entity Timeline | human-readable combined entity history |

## 10. Duplicates (PD-006: detect → suggest → link-to-existing, no merge)

- **Users:** no candidates — phone, email and username are unique-constrained (A9), and name similarity alone is not authoritative. Recorded, not faked.
- **Organizations:** `admin_organization_duplicate_candidates(org)` (`organizations.read`) suggests other non-deleted organizations with (a) an **identical normalized name** (case, whitespace and punctuation folded; `name`, `name_ar`, `name_en`) — "same name", or (b) the **same type and trigram similarity ≥ 0.6** — "similar name". Candidates are suggestions only; already-resolved pairs are not suggested again.
- **Resolution** (`duplicates.resolve`): `admin_organization_link_duplicate(duplicate, canonical, reason)` records that `duplicate` is the same business as `canonical`; `admin_organization_dismiss_duplicate(org, other, reason)` records "not a duplicate". `public.organization_duplicate_resolutions` keeps the pair, the reason, the actor, the time and a provenance snapshot of both organizations (`source`, `referred_by_user_id`, `created_by`, `created_at`). **Nothing is re-parented, merged, deleted or status-changed.** A duplicate links to one canonical; a canonical cannot itself be linked away (no chains); repeating the same link is a no-op.

## 11. Audit, idempotency, concurrency

New audit actions: `account.suspended`, `account.restored`, `organization.suspended`, `organization.restored`, `admin_note.created`, `admin_follow_up.logged`, `admin_follow_up.completed`, `admin_case.created`, `organization.duplicate_linked`, `organization.duplicate_dismissed`. Each records actor, target, reason where relevant, the record id and a before/after status where a status changes; note / case bodies and contact data are not copied into the audit trail. Suspend/restore lock the subject row (`FOR UPDATE`) and are no-ops (no second audit row) when the subject is already in the requested state; the partial unique index backs the one-open-episode rule. Follow-up completion and duplicate link/dismiss are idempotent.

## 12. Implementation record

### 12.1 Migrations and RPC surface

| Migration | Contents |
|---|---|
| `20260930100001_admin_operations_permissions.sql` | 7 permission keys + role matrix (§2); 1B-B audit vocabulary |
| `20260930100002_account_organization_suspension.sql` | `admin_suspensions`; `app.api_pre_request` (+ `pgrst.db_pre_request`), `my_account_status`; `has_capability` / `is_org_member` / `require_verified_caller` / personal storage helpers; product-catalog policy; job-application and order triggers; last-Super-Admin guard on `users.status`; `admin_user_suspend/restore`, `admin_organization_suspend/restore`, `admin_subject_suspension` |
| `20260930100003_admin_notes_follow_ups_cases.sql` | `admin_notes` (append-only), `admin_follow_ups` (+ `admin_follow_up_type` enum), `admin_cases`; `admin_note_add`, `admin_notes_list`, `admin_follow_up_log/complete`, `admin_follow_ups_list`, `admin_follow_up_assignees`, `admin_case_create`, `admin_cases_list` |
| `20260930100004_organization_duplicates_entity_timeline.sql` | `organization_duplicate_resolutions` (append-only); `admin_organization_duplicates`, `admin_organization_link_duplicate`, `admin_organization_dismiss_duplicate`; `admin_entity_timeline` |
| `20260930100005_postgrest_hook_service_role_compatibility.sql` | **Forward fix for the hook** (not yet applied to Production, where the hook is currently DISABLED by an emergency config reset): `pgrst_hooks.pre_request()` entry point delegating to `app.api_pre_request()`, so `service_role` needs no `USAGE` on schema `app`; repoints `pgrst.db_pre_request`. See [`POSTGREST_PRE_REQUEST_HOOK.md`](POSTGREST_PRE_REQUEST_HOOK.md) |

### 12.2 Behaviour changes to existing suites (reviewed, not regressions)

- `25_pilot_account_activation_test.sql` §3: a suspended caller used to *reach* `individual_complete_consumer` because suspension was inert; PD-010 now refuses it (`42501`). The section's guarantee (onboarding never revives a blocked identity) still holds.
- `41_trade_taxonomy_test.sql`: unchanged in this phase. `66_admin_rbac_foundation_test.sql`: Support's exact read-only list gains `cases.read`, `follow_ups.read`, `notes.read`, plus an explicit "no mutating permission" assertion.

### 12.3 Verification

- **Clean DB gate** (after the final migration edit): isolated `aladdin_1bb` (ports 573xx) rebuilt from zero — 84 migrations + 3 seeds → `supabase test db` **69 files / 2778 tests PASS** (2669 after 1B-A + 108 in file 68 + 1 in file 66). Two-session concurrency proof PASS on the fresh DB (mutual Super Admin suspension leaves exactly one; double suspension = one episode, one audit row, second call `changed:false`).
- **Frontend:** typecheck clean · lint 0 errors (1 pre-existing warning in `sidebar-shell.tsx`) · Vitest **164 files / 2018 tests PASS**.
- **Server-side blocked-action proof** (real Supabase Auth tokens, direct PostgREST): a suspended user's organization write, profile read and referral are refused `403 42501 account suspended`, only `my_account_status` answers; a member of a suspended organization keeps an active account, is refused new Sales activity (`sales.write required`) but still reads existing records; the public no longer sees the suspended organization's products or directory entry; an organization-scoped holder of `users.suspend` / `organizations.suspend` / `notes.create` is refused on its own organization; non-staff and anonymous are refused.
- **Browser QA** (isolated stack, `:3300`): suspend (reason, banner, actor/time), suspended person lands on `/auth/suspended`, restore from the row icon and the detail page; notes; follow-ups (Open / Overdue / Done, staff-only assignees, Mark done); internal case (prefill, invalid email refused, attachment disabled); Entity Timeline (user and organization); organization suspension; duplicate candidate → link-to-existing; Review Center detail reads the real notes and timeline. Roles: Super Admin and Administrator (all controls), Moderator (users.suspend but not organizations.suspend), Support (read-only, no write control), organization-scoped (every Admin route redirects), non-staff (redirected). English LTR, Arabic RTL, desktop, 375 px mobile (no horizontal overflow), dark and light.
- **Defects found in QA and fixed:** `/auth/suspended` crashed (a client-only card rendered from a Server Component — now a client panel with a render test); the canonical organization's timeline read "Linked as a duplicate" (now "A duplicate was linked here").
- **Semgrep:** Guardian authenticated (OAuth). Local CLI scan (`p/security-audit`, `p/secrets`, `p/typescript`, `p/react`, `p/nextjs`, `p/sql-injection`) over the 31 changed SQL/TS files: **0 actionable findings** — 1 INFO false positive (a Koa cookie rule matching the pre-existing Supabase cookie `set` in `middleware.ts`), and engine "internal matching errors" confined to four rules for libraries not used here (crypto-js, Express/Koa CORS, superagent).

### 12.4 Known gaps and follow-ups (recorded, not claimed)

- Supabase Auth sessions of a suspended account are not revoked (data access is what is blocked); Realtime self-row reads are not refused.
- Suspension expiry is not implemented (no scheduler).
- Follow-up reminder delivery does not exist (due time stored, shown Overdue).
- Case attachments deferred (need a private bucket and their own Storage policies).
- Admin date/time display uses the server's clock (`formatAdminDateTime`), so a UTC host shows UTC; entered due times are stored as Africa/Cairo. Pre-existing formatter behaviour.
- After a refused confirmation, React 19 resets the dialog form, so a typed reason must be retyped (shared `ConfirmDialog`).
- Verify / Reject on the Users/Organizations pages stay Preview dialogs (decisions happen in Verifications); Points adjust/reverse and all Points rules belong to the later Points Engine phase — nothing in 1B-B calculates or hardcodes Points.

