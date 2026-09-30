# Admin Core Phase 1B-A — Users & Organizations field-to-source audit

**Purpose:** Step 1 of Phase 1B-A. For every field the approved Phase 0D Users / Organizations directories and detail pages show, record where it comes from today, what the authoritative source is, which permission gates it, how the server will query it, and whether it is **REAL**, **DERIVED** or **UNAVAILABLE**. Written *before* any schema work; the implementation follows this table.
**Status:** Audit complete 2026-09-30 on `feature/admin-core-users-organizations` (base `bc16841`).
**Related:** [ADMIN_RBAC_ARCHITECTURE.md](ADMIN_RBAC_ARCHITECTURE.md) · [ADMIN_IMPLEMENTATION_BACKLOG.md](ADMIN_IMPLEMENTATION_BACKLOG.md) · [ADR-0011](../decisions/ADR-0011-admin-rbac-platform-authority.md).

---

## 0. Facts established by the audit (not assumptions)

| # | Fact | Evidence |
|---|---|---|
| F1 | Directories load **at most 200 rows** (`listUsers`, `listOrganizations` → `.limit(200)`) and search / filter / sort / paginate that snapshot in JavaScript. | `frontend/src/server/queries/admin.ts` |
| F2 | `app.has_admin_permission(p)` **without context** matches **platform-scoped assignments only**: organization/branch/user scopes compare against `NULL` and fail. | `20260929100001_admin_rbac_foundation.sql` §has_admin_permission |
| F3 | **Email.** `public.contacts` is written by **no** product path (no migration inserts; `is_verified` is not grantable to `authenticated`; only `supabase/seed.sql` inserts). The account's real email is `auth.users.email`. Installer phone accounts carry an internal login alias there (`…@craftsman-login.aladdin.invalid`) that must never be shown. | grep of migrations/frontend; `20260927090001_mask_craftsman_login_alias.sql`; `lib/auth/craftsman-login-alias.ts` |
| F4 | **Phone.** Canonical phone is `profiles.phone_e164` (E.164, unique; written by `profile_set_phone` and registration). | `20260924090002_canonical_phone.sql` |
| F5 | **City.** No locality table exists; `profiles.locality_id` / `organizations.locality_id` / `branches.locality_id` are orphaned (never written). The only live location data is `individual_onboarding.prof_governorate` / `consumer_governorate` (+ `*_city`), a closed vocabulary (`GOVERNORATES`: cairo, giza, alexandria, qalyubia), written by the live professional profile editor and the consumer flow. Organizations have **no** city source. | `lib/onboarding/persona-fields.ts`; `features/profile/professional-profile-editor.tsx` |
| F6 | **Profile completion.** The canonical formula is `public.my_profile_completion()` (latest: `20260924090011`), self-only (`auth.uid()`). No per-user callable form exists. Organizations have **no** completion formula anywhere. | migrations `…090008`, `…090010`, `…090011` |
| F7 | **Last Active.** No product-activity source exists (no `user_events`, `last_active_at`, page views). `auth.users.last_sign_in_at` exists — it is *last sign-in*, not activity. | grep; Phase 0D fixtures note |
| F8 | **Public profile.** `/p/[profileId]` is keyed by `profiles.id`; `profile_public_directory` is the single source of "will this render". Organizations have **no** public route. | `server/queries/admin-preview.ts` |
| F9 | **Admin Notes / Follow-up / Report / duplicate linking** have no backend. | BL-008 and Phase 0D notes |

## 1. Users Directory

Permission for the whole directory: **`users.read` at platform scope** (F2, option A — see §5).

| UI field | Current Preview source | Authoritative source | Permission | Server query plan | Class |
|---|---|---|---|---|---|
| Name | `profiles.display_name` (real, via 200-row snapshot) | `profiles.display_name` (+ `display_name_ar/en`) | users.read | column; trigram search | REAL |
| Email | `previewContactFor()` **fixture** | `auth.users.email`, `NULL` when it is the craftsman login alias (F3) | users.read (inside definer RPC; never `auth.users` to the browser) | left join `auth.users`; search via `ilike` | REAL |
| Phone | fixture | `profiles.phone_e164` (F4) | users.read | column; digit-normalized prefix/contains match | REAL |
| WhatsApp | link built from fixture phone | same `phone_e164` | users.read | derived link, no extra data | DERIVED |
| Organization | active memberships (real) | `memberships` (status active) → `organizations.name`; count | users.read | lateral subquery: first active org by `memberships.created_at, id` + count | REAL |
| City | `previewCityFor()` **fixture** | `individual_onboarding` governorate (+ city when present) (F5) | users.read | coalesce(prof_*, consumer_*) | REAL (partial coverage — `—` when never given) |
| Verification | latest user verification (real) + `users.is_verified` | `users.is_verified` + latest `verifications` row (subject user) | users.read | lateral latest-by `submitted_at desc, id desc` | DERIVED |
| Registered | `previewRegisteredAt()` **shifted fixture date** | `users.created_at` | users.read | column; sort key | REAL |
| Status | `users.status` | `users.status` | users.read | column; filter | REAL |
| Last Active | "unavailable" text | **none** (F7) | — | not queried | UNAVAILABLE |
| Profile Completion | `previewCompletenessFor()` **fixture** | shared helper extracted from `my_profile_completion()` (F6) | users.read | computed per row in SQL; sortable | REAL |
| Flags | fixture duplicate / `<70` threshold / rejected | only `verification_issue` (latest verification rejected) is authoritative | users.read | derived from the latest-verification lateral | DERIVED |
| View on Platform | profile id + `profile_public_directory` (real) | same | users.read | `profiles.id` + exists in `profile_public_directory` | REAL |
| Status tabs + counts | counted over the 200-row snapshot | same mapping, counted server-side over the full filtered set | users.read | `count(*) filter (...)` in the same statement | DERIVED |
| Type filter | `primary_account_type` over the snapshot | `users.primary_account_type` (persona) | users.read | equality filter | REAL |
| Warnings card | pending count (real) + duplicate/incomplete (fixture) | pending-verification count only | users.read | from the facet counts | DERIVED |

**Removed / not implemented (reported):** *possible duplicate* flag + chip (Phase 1B-B duplicate workflow) · *incomplete critical profile* flag + chip (the `< 70` threshold has no product authority; completion is shown in its own column) · City filter over free text (replaced by the real governorate vocabulary).

## 2. Organizations Directory

Permission: **`organizations.read` at platform scope**.

| UI field | Current Preview source | Authoritative source | Permission | Server query plan | Class |
|---|---|---|---|---|---|
| Name | `organizations.name` | `name`, `name_ar`, `name_en` | organizations.read | trigram search on all three | REAL |
| Type | `org_type` | `organizations.org_type` | organizations.read | filter | REAL |
| Owner | first `org.manage` member (real) | `memberships` (active) with `membership_capabilities.capability_key = 'org.manage'` → `profiles.display_name` | organizations.read | lateral, deterministic (`m.created_at, m.id`) | REAL |
| Phone / WhatsApp | fixture | **none** — organizations have no contact column | — | not queried | UNAVAILABLE |
| City | fixture | **none** (F5) | — | not queried | UNAVAILABLE |
| Verification | `is_verified` / status | `organizations.is_verified` + `status` | organizations.read | derived | DERIVED |
| Members | `memberships(count)` (all statuses) | active memberships | organizations.read | lateral count | REAL |
| Branches | branch count (real) | `branches` where `deleted_at is null` | organizations.read | lateral count | REAL |
| Status | `org_status` | `organizations.status` | organizations.read | filter | REAL |
| Created (Registered) | shifted fixture date | `organizations.created_at` | organizations.read | sort key | REAL |
| Profile Completion | fixture | **none** (F6) — no organization formula exists | — | not queried; sort disabled | UNAVAILABLE |
| Provenance | `organizations.source` | same | organizations.read | column | REAL |
| Flags | duplicate (exact name, over snapshot) + fixture incomplete | none authoritative outside the 1B-B duplicate workflow | — | — | UNAVAILABLE (no flags shown) |
| View on Platform | disabled | no public org route (F8) | — | — | UNAVAILABLE (disabled) |

Deleted organizations (`deleted_at is not null`) are excluded from the directory, matching every other organization read in the product.

## 3. User Details tabs

| Tab | Source | Permission | Class |
|---|---|---|---|
| Overview | `users`, `profiles`, completion helper, org count, `auth.users.last_sign_in_at` (labelled *Last sign-in*, not *Last active*) | users.read | REAL |
| Profile | `profiles` (display names, username, headline, bio, phone), governorate/city | users.read | REAL |
| Organizations | `memberships` + `organizations` + capabilities | users.read | REAL |
| Verification | `verifications` for the user (status, type, dates, reason) | users.read (history). Documents are not shown. | REAL |
| Points | `points_ledger` + `points_balance` | users.read **and** points.read (own check) | REAL (read-only; Adjust/Reverse not wired) |
| Activity | no product activity source (F7) | — | UNAVAILABLE (honest empty state) |
| Follow-up | no backend (F9) | — | DEFERRED 1B-B (no fixture rows) |
| Report / Internal Case | no backend (F9) | — | DEFERRED 1B-B |
| Admin Notes | no backend (F9) | — | DEFERRED 1B-B (fixture notes removed) |
| Audit | `audit_log` where user is actor or subject | users.read **and** audit.read (own check) | REAL |

## 4. Organization Details tabs

| Tab | Source | Permission | Class |
|---|---|---|---|
| Overview | `organizations`, counts, owners, provenance | organizations.read | REAL |
| Members | `memberships` + `profiles` + capabilities | organizations.read | REAL |
| Branches | `branches` (not deleted) | organizations.read | REAL |
| Ownership | active `org.manage` holders | organizations.read | REAL (derived from capability; no separate ownership record exists) |
| Verification | `verifications` for the organization | organizations.read | REAL |
| Network | provenance (`source`, `referred_by_user_id`) is real; duplicate candidates belong to 1B-B | organizations.read | REAL (provenance) / DEFERRED (duplicates) |
| Referrals | provenance only — no referral-relationship read model beyond `source`/`referred_by_user_id` | organizations.read | REAL (provenance) |
| Activity | no organization product-activity source; `organization_activity_log` (ADR-0010) is the tenant's own sales log, not Admin activity | — | UNAVAILABLE |
| Admin Notes | no backend | — | DEFERRED 1B-B |
| Audit | `audit_log` scoped to the organization | organizations.read **and** audit.read | REAL |

## 5. Scope decision

Global directories and details use **option A — a platform-scoped read permission is required** (`app.has_admin_permission('users.read')` with no context). An organization-, branch- or user-scoped `users.read` assignment is **denied** (not silently widened). Option B (restricting results to the caller's scope) needs a scoped-directory UI that Phase 1B-A does not have; it is recorded as later work.

## 6. Implemented read contracts

| RPC | Guard | Arguments | Returns |
|---|---|---|---|
| `admin_users_list` | platform `users.read` | `p_search`, `p_status` (pending · verified · suspended · rejected), `p_account_type` (persona), `p_verification` (unverified · pending · verified · rejected), `p_governorate`, `p_sort` (`registered:desc/asc`, `completeness:desc/asc`), `p_page ≥ 1`, `p_page_size ∈ {10, 25, 50, 100}` | `{rows, total, page, page_size, sort, counts{all, pending, verified, suspended, rejected}}` |
| `admin_user_detail` | platform `users.read` | `p_user_id` | user read model, or `NULL` (no such user) |
| `admin_organizations_list` | platform `organizations.read` | `p_search`, `p_status` (pending · verified · suspended), `p_org_type`, `p_sort` (`registered:desc/asc`), `p_page`, `p_page_size` | `{rows, total, page, page_size, sort, counts{all, pending, verified, suspended}}` |
| `admin_organization_detail` | platform `organizations.read` | `p_organization_id` | organization read model, or `NULL` (missing or deleted) |

- **Pagination.** The database ranks the whole filtered set with a window ordered by the sort key **then the primary key** (deterministic ties), counts it, clamps a too-high page to the last page and returns only that page. Any other argument → `22023`. The frontend (`parseUsersDirectoryParams` / `parseOrgsDirectoryParams`) turns invalid URL values into safe defaults before the call; navigation is `router.replace` (no full reload); search, filter and sort changes drop `page`; paging keeps every other parameter.
- **Search.** Users — `display_name`, `display_name_ar`, `display_name_en`, `username`, the account email (login alias excluded) and `phone_e164`, by digit substring or by `app.normalize_phone` of the whole term (Arabic-Indic / Persian digits folded first). Organizations — `name`, `name_ar`, `name_en` only; no contact data exists or is searched. LIKE wildcards are escaped; 100-character cap.
- **Filters** combine with AND; tab counts are computed under every filter except the status tab itself, so each tab shows its own count.
- **Profile completion.** `app.profile_completion(user_id)` holds the body of `my_profile_completion()` verbatim; `my_profile_completion()` is now its `auth.uid()` wrapper. Items: username, avatar, phone, confirmed display name (everyone); headline, years of experience, bio, activities (professional personas; activities only when satisfiable); business set-up and business activities (business track; the latter only with `org.manage`). `locality` is not an item (Product Owner decision 2026-09-24).
- **Flags.** Only `verification_issue` (the latest user verification is `rejected`). Organizations show none.
- **Last Active.** Not shown as a value — no product-activity source exists. `auth.users.last_sign_in_at` appears on User Details as **Last sign-in**, never relabelled.
- **View on Platform.** Users → `/p/[profiles.id]` only when `profile_public_directory` lists that profile. Organizations → always disabled (no public route).
- **Private identity data.** Email and phone are read only inside the definer RPCs after the permission check; `auth.users` is never exposed; a row carries exactly the approved fields (asserted in pgTAP).

## 7. Scope and nested permissions

- Directories and details require **platform-scoped** `users.read` / `organizations.read` (option A). Scoped assignments are refused (`42501`) — pgTAP §A.
- Points panel: `points.read`, enforced by the page and by `points_ledger_select_platform`. Adjust / Reverse stay Preview dialogs, drawn only for `points.adjust` / `points.reverse`.
- Audit panel: `audit.read`, enforced by the page and by `audit_log_select_admin`.
- A caller with `users.read` alone opens User Details but reads no audit row and no one else's ledger — pgTAP §F.
- Option B (a directory restricted to the caller's scope) is not built; it needs a scoped-directory UI ([BL-027](ADMIN_IMPLEMENTATION_BACKLOG.md)).

## 8. Query plans and indexes (measured)

Scaled inside a rolled-back transaction to **20,287 users / 5,242 organizations** on the isolated stack:

| Query | Before inlining | After |
|---|---|---|
| Users default / deep page 1500 / Registered asc | 437 / 398 / 383 ms | 128 / 127 / 115 ms |
| Users name / email search | 277 / 240 ms | ~125 ms |
| Users persona filter | 115 ms | 44 ms |
| Organizations default / name search / type + tab | 50 / 19 / 8 ms | 12 / 14 / 4 ms |
| Users Profile Completion sort, full set | 4,140 ms | 3,755 ms |

- **Change made:** the four per-row SQL helpers carry no `SET search_path`, so PostgreSQL inlines them (a SET clause prevents inlining; the base scan went 256 → 61 ms). They are schema-qualified, have no client grant and run only inside definer RPCs that pin `search_path`. The email search became a set-based `IN (…)`.
- **No index added.** Every query must count the whole filtered set (total + tab counts), so a `created_at` index would not remove that pass; `profiles.display_name` and `organizations.name` already have trigram indexes; `auth.users` belongs to Supabase Auth and is not indexed here.
- **Scaling boundary:** sorting the **full** user set by completion evaluates the per-user formula for every row (~0.19 ms each). Fine at pilot scale; beyond roughly 10k users a stored, trigger-maintained completion value is the next step ([BL-026](ADMIN_IMPLEMENTATION_BACKLOG.md)).

## 9. More-than-200-rows proof (isolated QA data)

The QA rows were created **oldest**, so every filter match sat outside the newest 200 rows the old snapshot loaded. 287 users / 242 organizations: totals 287 and 242; page 1 = 10 rows; users page 25 (rows 241–250) and organizations page 23 (rows 221–230) reachable; the last users page holds the oldest rows (`QA Load 007 … 001`); concatenating all 29 user pages (Registered desc) and all 25 organization pages (asc) reproduced the exact database order with no duplicate and no skip; Profile Completion stayed monotonic across page boundaries; filters found their oldest-only matches (engineer 37, suspended 5, importer 33, Arabic organization search 23, engineer + Cairo 9); clearing restored 287.

## 10. Fixture retirement inventory

| Fixture removed | Real source replacing it |
|---|---|
| `previewContactFor` email / phone (Users directory, Report dialog) | `auth.users.email` (alias excluded), `profiles.phone_e164` |
| `previewCityFor` / `PREVIEW_CITIES` | `individual_onboarding` governorate (+ city) |
| `previewCompletenessFor` in the Users directory and details | `app.profile_completion` |
| `previewUserDuplicateFlag`, the `< 70` incomplete flag and their warning chips | none — flags limited to `verification_issue` |
| `previewRegisteredAt` shifted dates | `users.created_at` / `organizations.created_at` |
| 200-row `listUsers` / `listOrganizations` snapshot in the directories; legacy `/admin/users*`, `/admin/organizations*` pages | `admin_users_list` / `admin_organizations_list`; legacy routes redirect to the promoted pages |
| `getUserDetail` / `getOrganizationDetail`, `preview*DirectoryContext`, `previewOrgOwners`, `previewOrgProvenance` | `admin_user_detail` / `admin_organization_detail` |
| Fixture Admin Notes, fixture Follow-up history, composed Activity timeline (Users / Organizations) | honest "not connected" / "not tracked" states; Follow-up keeps its approved UI with an empty history |
| Organization phone / city / completion fixtures and the snapshot duplicate flag | "Not available" states |

| Remaining placeholder | Why it remains | Owner |
|---|---|---|
| `listUsers` / `listOrganizations` (200 rows) | command-palette index and Points user picker — not the directories | [BL-028](ADMIN_IMPLEMENTATION_BACKLOG.md) |
| `previewCompletenessFor` | Preview dashboard "incomplete profiles" counts | dashboard promotion |
| `previewNotesFor`, timelines, duplicate candidates | Review Center detail page | Review Center / Phase 1B-B |
| Suspend / Restore / Verify / Reject, Notes, Follow-up, Report dialogs | no persistence yet (labelled Preview) | Phase 1B-B |
| Organization phone / city / completion columns | no authoritative source | organization profile work |

## 11. Data freshness

Normal server reads: every navigation (page, filter, sort, tab, detail tab) is a fresh `force-dynamic` server render calling the RPC; nothing is cached across requests and there is no Realtime subscription. Classification for [BL-024](ADMIN_IMPLEMENTATION_BACKLOG.md): **navigation refetch**.

## 12. Browser QA (isolated stack, dev server on :3200)

Signed in with real password sessions against `aladdin_1b` (QA accounts and >200-row data exist only there).

- **Users:** page 1, page 2, page 25 (rows 241–250) and the last page; search by email, local-format phone (`01100000009` → `+201100000009`) and Arabic name; one filter, two combined filters, search + filter, search + status tab; Registered and Profile Completion in both directions; invalid URL values degrade to page 1 / default sort; View on Platform → `/p/[profile id]` (new tab, 200) — the same URL with the user id is a 404 — and a non-link for unlisted profiles; all ten detail tabs render real data or an honest state with no fixture text; missing user → 404.
- **Organizations:** 242 total, page 23 (rows 221–230) and the last page, English and Arabic search, type and tab + type filters, Registered ascending, unsupported sort → default, all nine detail tabs, View on Platform disabled with its reason, missing / malformed id → 404, legacy `/admin/users?q=` and `/admin/organizations/[id]` redirect with parameters kept.
- **Permissions:** Super Admin and Administrator — full reads, Points with Adjust, both Audit panels; Support (restricted) — directories and read-only Points (no Adjust), Audit **locked**; organization-scoped `users.read` — every Admin route redirects and, with its own Auth token, all four RPCs return `403 / 42501` (even its own organization's detail) and 0 audit rows; non-staff — redirected, all four RPCs `42501`; anonymous — `401`.
- **UI:** English LTR and Arabic RTL (Arabic-Indic numerals, mirrored layout), desktop and 375 px mobile (stacked cards, no horizontal overflow), dark and light.
- **Defects found and fixed:** (1) a link or reload to page N silently returned to page 1 after 300 ms (the filter bar navigated on mount) — fixed with a regression test; (2) the pagination strip overflowed a 375 px phone in RTL — it now wraps; (3) stale "Planned … 200-row cap" subtitles and a "Preview fixture" label on the empty follow-up history — replaced with truthful copy in both languages.
