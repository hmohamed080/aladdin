# Admin RBAC Architecture (Admin Core Phase 1A)

**Status:** Admin Core Phase 1A **CLOSED / APPROVED** (2026-09-30) — `supabase/migrations/20260929100001_admin_rbac_foundation.sql`, branch `feature/admin-core-rbac-foundation`. [ADR-0011](../decisions/ADR-0011-admin-rbac-platform-authority.md) Accepted.
**Authority:** PD-008 (approved 2026-09-29 — adapt dynamic RBAC), PD-004 (real tier separation), PD-012 (Points = Administrator-level), PD-016 (promote the Admin Preview). Backlog: BL-018.
**Tests:** `supabase/tests/66_admin_rbac_foundation_test.sql` (114 assertions, direct RPC/table invocation as `authenticated`/`anon`).

---

## 1. One source of authority

`public.admin_role_assignments` is **the single source of platform authority**. Every authorization decision — RPC guards, RLS policies, the frontend permission helper — resolves through it:

| Check | Meaning |
|---|---|
| `app.has_admin_permission(permission, org?, branch?, user?)` | **The canonical check.** Caller holds `permission` through an active assignment of an active role, the permission is active, and the account is not suspended/deactivated. Without context only **platform-scoped** assignments count. |
| `app.is_admin_staff()` | Caller holds any active platform assignment (the Admin console door). |
| `app.can_review_verification(id)` | `users.verify` or `organizations.verify` depending on the verification's subject. |
| `app.is_platform(tier)` | **Deprecated compatibility shim** over the same assignments (`support` = any staff, `moderator` = rank ≥ 60, `administrator` = rank ≥ 80). Kept only for call sites not yet converted (§9). |
| `public.admin_my_access()` | The caller's own rank, roles and effective permissions — what the frontend renders from. |

`public.platform_role_grants` is **not** an authority source. No SQL function, RLS policy or application query reads it for authorization (verified against `pg_proc`/`pg_policies` after migration; the frontend readers were removed in the same phase). See §6.

## 2. Model

- **`admin_permissions`** — system-defined `resource.action` catalog (migration-only; no write path). Keys: `users.read/verify/suspend`, `organizations.read/verify/suspend`, `referrals.read/approve`, `job_reviews.moderate`, `points.read/adjust/reverse`, `audit.read`, `analytics.read`, `admin_staff.read/manage`, `roles.read/manage`.
- **`admin_roles`** — system roles (seeded, immutable identity, never archived) and custom roles (created through `admin_role_create`). `rank` 1–100; **100 is reserved for Super Admin** (CHECK constraint). Roles are archived, never deleted.
- **`admin_role_permissions`** — role → permission. `is_locked` marks a system role's **core** permissions; a trigger refuses removing them for every writer, including the DBA path.
- **`admin_role_assignments`** — who holds which role at which **scope**: `platform · organization · branch · user` (`department` is representable but rejected until a departments domain exists — no fake foreign keys). Rows are never deleted; removal/disable/role change **deactivates** (`deactivation_kind`), keeping history.

All four tables: RLS enabled, **no policies, no DML grant to any application role** — only the security-definer RPCs can read or write them.

## 3. Scope rules

- A scoped assignment **never** leaks into platform authority: with no context argument, `has_admin_permission` considers platform assignments only.
- With context, an organization assignment matches that organization (and its branches); a branch assignment matches that branch; a user assignment matches that user.
- A role's scope type is fixed at creation; an assignment's scope must match its role's scope (trigger + RPC check). A branch scope must belong to its stated organization.

## 4. System role matrix

| Permission | Super Admin (100) | Administrator (80) | Moderator (60) | Support (40) |
|---|:-:|:-:|:-:|:-:|
| users.read | 🔒 | 🔒 | 🔒 | 🔒 |
| users.verify | 🔒 | ✓ | ✓ | — |
| users.suspend | 🔒 | ✓ | ✓ | — |
| organizations.read | 🔒 | 🔒 | 🔒 | 🔒 |
| organizations.verify | 🔒 | ✓ | ✓ | — |
| organizations.suspend | 🔒 | ✓ | — | — |
| referrals.read | 🔒 | ✓ | ✓ | ✓ |
| referrals.approve | 🔒 | ✓ | ✓ | — |
| job_reviews.moderate | 🔒 | ✓ | ✓ | — |
| points.read | 🔒 | ✓ | ✓ | ✓ |
| points.adjust / points.reverse | 🔒 | ✓ | — | — |
| audit.read / analytics.read | 🔒 | ✓ | — | — |
| admin_staff.read | 🔒 | 🔒 | — | — |
| admin_staff.manage | 🔒 | ✓ | — | — |
| roles.read | 🔒 | 🔒 | — | — |
| roles.manage | 🔒 | — | — | — |

🔒 = locked core permission. Support is **read-only** (PD-004). Points adjust/reverse are **Administrator-level** (PD-012).

## 5. Escalation safeguards (all enforced in SQL, tested in §F/§G of the test file)

1. **No self-management** — nobody changes, adds to, disables or restores their own assignments.
2. **Rank ceiling** — an actor may manage only staff whose current platform rank is **below** their own (a Super Admin may manage other Super Admins).
3. **Permission ceiling** — an actor may hand out, edit or restore a role only if its rank is below theirs **and every permission it carries is one they hold**. A role edit may only add/remove permissions the actor holds. So no assignment or role edit can ever escalate.
4. **Rank 100 reserved** — no custom role can reach the top; the Super Admin role itself is not editable.
5. **Last Super Admin** — an `AFTER UPDATE OR DELETE` trigger (advisory-locked against concurrent removals) refuses any change leaving zero active, non-suspended Super Admins — through every path, including the DBA.
6. **Bootstrap** — `app.admin_bootstrap_super_admin(user)` is DBA/migration-only (no grant) and refuses once any active Super Admin exists.
7. **Deny by default** — inactive assignment, archived role, inactive permission, suspended/deactivated account → no authority.
8. **Audit** — every RBAC mutation writes `audit_log` (`admin_role.*`, `admin_staff.*`) with actor, target, before/after and reason.

## 6. The `platform_role_grants` compatibility bridge — and its retirement

### What it is now
A **write-only input** kept so that anything still provisioning staff the old way (DBA scripts, `supabase/seed.sql`, the staging seed) keeps working during cutover. It never grants authority by itself — it only feeds the canonical table:

| Legacy operation | Effect on the canonical model |
|---|---|
| `INSERT` (user, role) | **After-insert trigger** mirrors it into an active platform assignment of the same-named system role (adopting an equivalent existing assignment rather than duplicating), audited `admin_role.assigned` with `source = legacy_platform_role_grant`. |
| `DELETE` | **Before-delete trigger** deactivates every linked active assignment (`deactivation_kind = legacy_revoked`), audited `admin_role.unassigned`. It must run *before* the row disappears: `legacy_grant_id` is `ON DELETE SET NULL`, and that FK action is an internal `AFTER` trigger that fires ahead of any user `AFTER` trigger and would erase the link first (the original defect). |
| `UPDATE`, `TRUNCATE` | **Refused** (`42501`) — the mirror cannot follow them. |
| Pre-existing rows at migration time | `app.admin_backfill_legacy_grants()` copied each into an assignment and wrote one audit row per copy (`source = legacy_backfill`, original granter and grant time, no human actor). Idempotent. |

Because authority flows one way only (legacy → canonical), **the two models cannot act as independent authorities**: revoking in RBAC takes effect immediately regardless of the legacy row; the legacy row is not consulted. (Consequence, accepted for the cutover window: after an RBAC-side change the legacy table is no longer a truthful roster — nothing may read it as one.)

### Retirement — stages and exit criteria

| Stage | What happens | Exit criterion |
|---|---|---|
| **A — Bridge live** (this migration) | Canonical model enforced everywhere; legacy writes mirrored; no reader. | Phase 1A accepted. |
| **B — Writers moved** | Replace every legacy writer: `supabase/seed.sql` staff grant → `app.admin_bootstrap_super_admin` / direct assignments; the staging seed and `verify-staging-seed.sql` → assignments; any DBA runbook → `admin_staff_*` RPCs. Add a pgTAP assertion that no migration after this stage inserts into `platform_role_grants`. | `grep -r platform_role_grants supabase/ frontend/ scripts/` shows only historical migrations and the bridge itself. Hosted staging has been migrated and verified. |
| **C — Bridge removed** | One migration: drop the mirror/guard triggers and functions, drop the `platform_role_grants_*` policies, drop `admin_role_assignments.legacy_grant_id` (after confirming no active assignment depends on it for anything but history — provenance stays in `audit_log`), drop `platform_role_grants`. Regenerate `database.types.ts`. | Full pgTAP suite green on a from-zero rebuild; staging verified. |
| **D — Shim removed** | Convert the §9 call sites to named permissions; drop `app.is_platform` and the `platform_role` enum's authz use (`audit_log.actor_role` keeps its informational legacy label or is migrated to a role key). | No `is_platform(` in `pg_proc`/`pg_policies`. |

Stage **B** is the first Admin Core item after Phase 1A acceptance; **C** must not ship until B's exit criterion holds on hosted staging. Owner: Admin Core backlog (BL-018 follow-ups).

## 7. Intentional access changes (Phase 1A)

- Legacy `support` holders lose every sensitive mutation (verification decisions, organization verification, referral decisions, Points adjust/reverse, job-review moderation) and verification-**document** reads — PD-004. This is intended; tests assert the denial. No seeded or staging account holds `support` today.
- Points adjust/reverse become Administrator-level (PD-012).
- Everything a legacy `moderator`/`administrator` could do, they still can.
- The Admin-domain cross-tenant RLS reads (users, profiles, organizations, branches, memberships, audit, Points ledger, referrals, verifications) moved from "any staff" to named `*.read` permissions.

## 8. RPC surface (all `security definer`, `authenticated` only, each self-guarding)

Reads: `admin_my_access()`, `admin_rbac_permissions()` (`roles.read`), `admin_rbac_roles()` (`roles.read`), `admin_rbac_staff()` (`admin_staff.read`).
Mutations: `admin_role_create`, `admin_role_update`, `admin_role_set_archived` (`roles.manage`); `admin_staff_assign_role`, `admin_staff_change_role`, `admin_assignment_change_scope`, `admin_staff_unassign`, `admin_staff_set_disabled` (`admin_staff.manage`). Onboarding a brand-new staff member (someone with no assignment history) is the Invitation sub-phase and is **not** in 1A.

## 9. Remaining compatibility-shim call sites (converted in later modules)

`is_platform('support')` in the platform-read RLS policies of `rfqs`, `quotations`, `orders`, `projects`, `products`, `saved_products`, `jobs`, `job_applications`, `job_assignments`, `job_progress_updates`, `trades`, `user_trades`; plus one non-guard `is_platform('moderator')` reference inside `job_review_moderate` (its guard line itself is re-tiered). All resolve through `admin_role_assignments` today; converting each to a named permission belongs to that domain's Admin module.

## 10. Known limitations / deferred

- `users.status` changes (suspension, PD-010) have no write path yet; the last-Super-Admin trigger guards assignments, not account status. When PD-010's suspend RPC lands it must refuse suspending the last active Super Admin.
- `department` scope is deferred until a departments/teams domain exists.
- **Scoped role UI** — organization/branch/user-scoped roles are fully supported by the schema, RPCs and tests, but the console creates and assigns **platform** roles only; the scope picker belongs to the Organizations module (Phase 1B). Phase 1B-A (Users / Organizations reads) did not add it: the global directories require a platform-scoped read (§13). `admin_assignment_change_scope` has no UI yet.
- **Invite Admin Staff** stays a Preview dialog: the RBAC RPCs only manage people who already have Admin history; onboarding a new person is the Invitation sub-phase.
- **No Super Admin exists after a fresh seed or on any deployed environment** until the one-time, DB-owner-only bootstrap is performed — a **deployment gate**, procedure in [`SUPER_ADMIN_BOOTSTRAP.md`](SUPER_ADMIN_BOOTSTRAP.md). Until then nobody holds `roles.manage` (Administrators can still manage staff below rank 80).
- **`audit_log.actor_role` is informational / legacy — verified not an authorization source (closure pass 2026-09-30).** It holds the legacy tier enum (`support/moderator/administrator`), so a Super Admin actor is recorded as `administrator`. The only database object referencing it is `app.record_audit_event` (the writer); no RLS policy, view or security check reads it; the frontend only renders it as a badge in audit lists. The precise role is derivable from the assignment history. A dynamic actor-role snapshot is backlog item [BL-025](ADMIN_IMPLEMENTATION_BACKLOG.md).
- Organization-level `membership_capabilities` remains the tenant-side model; unifying it with this catalog is a later PD-008 stage.

## 11. Frontend enforcement (one reader, one route table)

| Layer | File | Role |
|---|---|---|
| Authority snapshot | `frontend/src/server/authorization/admin.ts` | `loadAdminAccess()` — `admin_my_access()` once per request (React `cache`), fails closed. `requireAdminStaff()` (console door → redirect `/`), `requireAdminPermission()` / `requireAdminRoute(path)` (staff lacking the permission → non-disclosing 404). |
| Rules | `frontend/src/lib/permissions/admin.ts` | Pure, client-safe: permission keys, `parseAdminAccess` (drops unknown keys), `can` / `meets`, and **`ADMIN_ROUTE_RULES`** — the single route→permission table (longest prefix wins). |
| Direct-route enforcement | every `frontend/src/app/admin/**/page.tsx` | First statement: `await requireAdminRoute("<own route>")`. `admin-route-coverage.test.ts` fails if any current or future Admin page omits it or passes a different route. |
| Navigation | `components/admin/admin-nav.tsx`, `features/admin-preview/preview-shell.tsx` | Filtered with `canAccessAdminPath(access, href)` — same table. The command palette indexes only sources the caller may read. |
| Controls | `features/admin-rbac/eligibility.ts` | Mirrors the SQL ceilings to decide which buttons/options to draw (presentation only; the RPC decides). Verification/referral decision UI is drawn only with `*.verify` / `referrals.approve`. |
| Mutations | `server/actions/admin-rbac.ts` | Forward the caller JWT to one RPC each; `admin-rbac-errors.ts` maps RPC messages to translation keys (never raw DB text). |
| Legacy reader removed | `server/queries/platform.ts` | Now `loadIsAdminStaff()` over `admin_my_access()`; the `/home`, landing, search and settings consumers moved with it. `previewAdminStaff()` (which read `platform_role_grants`) was deleted. |

The Preview shell shows a **"Live"** banner (not the "nothing is saved" Preview banner) on promoted routes (`LIVE_PREVIEW_ROUTES`: `/admin/preview/staff`), per PD-016.

## 12. Verification record (Phase 1A)

- Isolated `aladdin_rbac` Supabase stack (ports 553xx; the shared `aladdin` stack untouched), rebuilt from zero (78 migrations + seeds): **pgTAP 67 files / 2591 tests PASS** (2477 pre-RBAC baseline + 114 in `66_admin_rbac_foundation_test.sql`).
- Direct PostgREST probes with real password sign-ins (Super Admin, Administrator, Moderator, Support, non-staff, anon): every escalation / self-management / last-Super-Admin / cross-tier attempt → `403 42501`; non-staff `admin_my_access` → empty snapshot; anon → denied.
- Browser QA (EN + AR/RTL, desktop + mobile, light/dark): real Staff/Roles/Permissions reads; change role, create / duplicate-rejected / archive / restore custom role; system-role editor keeps locked permissions; per-role navigation and direct-URL 404s; non-staff redirected from every `/admin/**` route.
- One defect found and fixed during QA: the re-tiered Points RPCs still said "platform **support** authority is required" — now `admin permission points.adjust|reverse required` (§8 retier).

## 13. First domain consumers — Users & Organizations reads (Phase 1B-A)

The Users and Organizations directories and detail pages read through four self-guarding RPCs (`admin_users_list`, `admin_user_detail` → `users.read`; `admin_organizations_list`, `admin_organization_detail` → `organizations.read`), each calling `app.admin_require(<perm>)` — i.e. `has_admin_permission` **without context**, so only a **platform** assignment qualifies (§3). A scoped `users.read` / `organizations.read` is refused (`42501`), never widened into the global directory; a scoped directory is backlog BL-027. Nested panels keep their own permission: Points (`points.read`, RLS `points_ledger_select_platform`) and Audit (`audit.read`, RLS `audit_log_select_admin`). Contracts, field sources and proofs: [`ADMIN_USERS_ORGS_READ_AUDIT.md`](ADMIN_USERS_ORGS_READ_AUDIT.md).
