# CRM RBAC Gap / Adoption Analysis

| | |
|---|---|
| **Status** | ANALYSIS — the evidence base for PD-008. *Update 2026-09-29:* the Product Owner has since **approved PD-008 as "Adapt CRM Dynamic RBAC to Aladdin"** (see [`PRODUCT_DECISIONS_REGISTER.md` §PD-008](PRODUCT_DECISIONS_REGISTER.md)); §4's "requires Product Owner approval" items are now approved direction, previewed in Phase 0D, with no backend built. The "deferred" conclusions below are the 2026-09-20 analysis as written, kept as history. |
| **Version** | 1.1.0 |
| **Owner** | Product / Foundation |
| **Created** | 2026-09-20 (Phase 0C — Admin Blueprint Final Refinement) |
| **Reference repository** | `hmohamed080/CRM` (private, accessed via `gh`, cloned read-only for this audit — `web/` subtree, Next.js + Supabase multi-tenant CRM) |
| **Depends on** | [`PRODUCT_DECISIONS_REGISTER.md`](PRODUCT_DECISIONS_REGISTER.md) — PD-004, PD-008 |

Per the task's explicit instruction: this document reports evidence and a proposed adoption path. **It does not itself change PD-004 or PD-008** — anything below marked "requires Product Owner approval" stays exactly that until a separate, explicit decision is recorded in `PRODUCT_DECISIONS_REGISTER.md`.

---

## 1. What CRM has (evidence-cited)

CRM implements a genuine **per-organization, dynamic RBAC system** — not a fixed role enum:

1. **Roles** are DB rows in `public.roles` (`organization_id`, `name`, `is_system_role`), not a code constant. Six system roles are seeded per organization (Owner/Admin/Manager/Sales/Support/Viewer) by `create_default_roles_for_organization()` (`web/supabase/migrations/20260611000000_seed_manager_support_roles.sql:75-175`). Beyond the six seeded roles, **an admin holding `roles.manage` can create a new custom role at runtime** (`createRole()`, `web/src/app/actions/settings.ts:181-223`) via a "Create role" button and `RoleEditorModal`.
2. **Permissions** are resource.action capability keys (e.g. `contacts.delete`, `pipelines.manage`) — 54 keys, canonically listed in `PERMISSION_REGISTRY` (`web/src/lib/access/registry.ts:349-429`), each carrying a label/description/category/risk/`ownerOnlyGrant` flag. A dedicated test (`permission-registry-parity.test.mjs`) asserts the DB catalog, the TS union type and the registry never drift apart.
3. **Permission groups**: 15 UI-facing categories (Workspace, Users & Access, Clients & Contacts, Leads, Deals, Tasks, Projects, Reports, Email, Calendar, Automations, Integrations, Data & Files, Billing, Security) — `registry.ts:298-316`.
4. **Role editing**: only custom roles (`is_system_role = false`) — `updateRolePermissions()` explicitly rejects editing a system role, enforced at both the app layer and RLS (`role_permissions_manage_insert`/`_delete`).
5. **Role assignment**: invite-time (`createInvitation`, picks a `roleId`) or post-hoc (`updateUserRole`, sets `users.role_id`) — both rank-gated (below).
6. **Scope**: strictly per-organization. `roles.organization_id` FKs to `organizations`; every role is a separate row per tenant — no cross-tenant sharing, no platform-wide role.
7. **Branch scope**: **not found** — grepped for `branch`/`location.scope`/`departments` tables; scoping stops at the organization level.
8. **User-specific overrides**: **not found** — grepped for `user_permission`/`permission_override`; effective permissions come only from the assigned role.
9. **Inheritance**: two explicit mechanisms, neither transitive — a numeric `roleRank()` (Owner 100 > Admin 80 > Manager 60 > Sales 40 > Support 30 > Viewer 10) gating who can manage/assign whom, and each role's permission array hand-listed (Admin is a strict, explicit subset of Owner's array — not "inherits Owner minus X").
10. **Server enforcement**: centralized through one resolver (`requirePermission()` → `AuthError(403)`, `web/src/lib/tenant/authorization.ts:282-345`), called at the top of every server action/route handler, re-checked independently by Postgres RLS (`has_permission()`). **No Next.js middleware** — route protection is page-level (`requirePageAccess()`), not edge middleware.
11. **Audit**: partial. Role *deletion* and ownership *transfer* are logged to a generic `activities` table; **role creation and permission edits are NOT audited** (confirmed by grep — no `logActivity` call in `createRole`/`updateRolePermissions`).
12. **Safeguards**: an owner-only-grant ceiling (`billing.manage`/`roles.manage` can never be granted to a custom role, even by Owner), self-escalation blocked, Owner role can never be assigned via the normal invite/change-role paths.

## 2. What Aladdin already has

- Three **fixed**, hierarchical **platform-wide** roles (`support`/`moderator`/`administrator`) in `platform_role_grants` — one flat table, no per-organization copy, no custom roles.
- A **capability-key** model already exists at the *organization* layer (`membership_capabilities.capability_key`, e.g. `org.manage`, `sales.write`) — closer in shape to CRM's resource.action keys than the platform roles are, but still a fixed catalog extended only via migration, never admin-editable.
- Server enforcement is the same shape as CRM's: a shared `is_platform(...)`/`has_capability(...)` check inside `SECURITY DEFINER` RPCs, re-checked by RLS — genuinely comparable architecture, just fixed rather than DB-editable.
- No Next.js middleware gate either (confirmed earlier this program) — Aladdin's own `/admin` route guard is a `layout.tsx`-level `loadPlatformRole()` check, the same shape as CRM's page-level `requirePageAccess()`.
- `platform_role_grants` changes are **not audited today** — the exact same gap CRM has for its own role/permission edits (§1.11). Neither system covers this well.

## 3. What should be adopted now (Preview-only, Phase 0C)

These require **no PD-008 change** — they are UI/documentation improvements over the *existing* fixed 3-tier model, previewing better information density the way CRM presents its own roles, not adopting dynamic creation:

- **A richer Access/Admin Staff Preview** (this phase): the capability matrix expanded from 8 to 13 rows (already delivered in Phase 0B/0C), an Admin Staff roster with role/status/granted-by/since columns and Invite/Change-role/Disable/Restore actions — all **still fixed-role pickers** (a `<select>` of the three real roles), never a permission-checkbox editor. This mirrors CRM's *role assignment* UX (a role picker on invite, a role picker on reassignment) without mirroring its *role creation* UX.
- **Auditing platform-role grants** — CRM's own gap here (§1.11) is a cautionary example, not a pattern to copy: Aladdin's `platform_role_grants` changes should be audited via the existing `audit_log` table once BL-004/backend work begins. This is a real, actionable, low-risk gap-close that needs no RBAC redesign — flagged here for `ADMIN_IMPLEMENTATION_BACKLOG.md`, not decided as a scope change to this document.

## 4. What requires Product Owner approval (PD-008 implications)

Everything below is a genuine capability CRM has that Aladdin's fixed model does not — each would require reopening PD-008 (currently DEFERRED: "stay with the fixed 3-tier model... revisit only once real role-diversity need is evidenced"). **None of these are adopted, built, or decided by this document.**

- **Dynamic, admin-creatable custom roles** (§1.1, §1.4) — the core of PD-008's original question. CRM's own audit trail gap on this exact feature (§1.11) is itself evidence that adopting it is nontrivial to get right, not just to build.
- **Per-organization role scoping** — Aladdin's platform roles are deliberately platform-wide (an Administrator governs every tenant); CRM's roles are deliberately per-tenant (they exist to let each *customer's own team* self-manage). These solve different problems — this is not a like-for-like adoption candidate at all, and any future proposal must be explicit about which problem it is solving.
- **A rank-based inheritance/assignment-ceiling model** (§1.9, §1.12) — a genuinely good pattern (self-escalation prevention, owner-only-grant ceiling) that Aladdin's flat 3-role hierarchy technically already gets "for free" (only 3 levels, `administrator ⊇ moderator ⊇ support` already enforced by the existing hierarchical check) — adopting CRM's *general* rank-comparison machinery only becomes necessary if Aladdin ever moves beyond 3 fixed levels, which is exactly the PD-008 question.

## 5. Adoption matrix

| CRM capability | Aladdin equivalent | Already exists | Adopt now | Adapt | Defer | Reject |
|---|---|---|---|---|---|---|
| Fixed system roles (Owner/Admin/.../Viewer) | `support`/`moderator`/`administrator` | ✓ (3, not 6) | — | — | — | — |
| Dynamic custom role creation | none | — | — | — | **✓ (PD-008)** | — |
| Resource.action permission keys | `membership_capabilities.capability_key` (org layer only) | ✓ partial | — | — | — | — |
| Permission categories/grouping | none for platform roles | — | ✓ (documentation grouping, this doc's own §5) | — | — | — |
| Role editing (custom roles) | N/A (no custom roles) | — | — | — | **✓ (PD-008)** | — |
| Role assignment (fixed picker) | Admin Staff page's Change-role dialog | ✓ (Phase 0B/0C Preview) | ✓ (already delivered) | — | — | — |
| Per-organization role scope | N/A (platform roles are global by design) | — | — | — | — | ✓ (different problem, not comparable) |
| Branch scope | none in either system | — | — | — | — | — (neither system has this) |
| Per-user permission overrides | none in either system | — | — | — | — | — (neither system has this) |
| Rank-based inheritance/ceiling | 3-level hierarchical check (`support ⊆ moderator ⊆ administrator`) | ✓ (implicitly, at 3 levels) | — | — | **✓ if role count ever grows (PD-008)** | — |
| Centralized server-side `requirePermission()` resolver | `is_platform(...)` inside `SECURITY DEFINER` RPCs + RLS | ✓ (comparable shape) | — | — | — | — |
| No Next.js middleware; page-level gate instead | Same shape (`layout.tsx` + `loadPlatformRole()`) | ✓ | — | — | — | — |
| Audit trail for role/permission changes | **Gap in CRM too** (role deletion only) | Gap in Aladdin too (`platform_role_grants` unaudited) | — | ✓ (add `audit_log` coverage when BL-004 lands — a real, independent gap-close, not RBAC redesign) | — | — |
| Owner-only-grant ceiling / self-escalation block | N/A (no dynamic grants to escalate) | — | — | — | **✓ (only relevant if PD-008 reopens)** | — |

---

**Bottom line:** CRM's dynamic RBAC is a well-built, real reference for *if and when* Aladdin ever reopens PD-008 — but nothing audited here changes the current recommendation. PD-004's principle (real separation of duties, no capability defaulting to the lowest tier) and PD-008's deferral (fixed 3-tier model, no dynamic role editor) both stand unchanged. The one concrete, low-risk action item this audit surfaces — auditing `platform_role_grants` changes — is a backlog note, not a decision requiring Product Owner sign-off, and is recorded in `ADMIN_IMPLEMENTATION_BACKLOG.md`.
