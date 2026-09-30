# ADR-0011 — Admin RBAC Is the Single Source of Platform Authority

**Status:** Proposed · 2026-09-30 (Admin Core Phase 1A — becomes Accepted when the Product Owner accepts Phase 1A) · **Supersedes [ADR-0007](ADR-0007-identity-and-tenancy-model.md) D4 on the source of platform authority** (the rest of ADR-0007 is unchanged)

## Purpose

Replace the fixed three-tier platform-role model (`support ⊆ moderator ⊆ administrator`, stored in `platform_role_grants`) with the dynamic, database-backed RBAC approved by PD-008 — without ever having two independent sources of platform authority.

## Context

ADR-0007 D4 put platform authority "solely in `platform_role_grants`", read through `app.is_platform(role)`. In practice almost every guard used the lowest tier (`is_platform('support')`), so the three tiers carried no real separation (PD-004). PD-008 (approved 2026-09-29) chose to adapt the CRM dynamic-RBAC architecture: `resource.action` permissions, roles, scoped assignments, one centralized server-side check, audited changes and super-admin safeguards.

## Decision

1. **`public.admin_role_assignments` is the single source of platform authority.** Roles (`admin_roles`), the permission catalog (`admin_permissions`) and the role→permission map (`admin_role_permissions`) complete the model. All four tables have RLS enabled with no policies and no client grant; they are read and written only through self-guarding `security definer` RPCs.
2. **`app.has_admin_permission(permission, org?, branch?, user?)` is the canonical check.** RPC guards and RLS policies use it. `app.is_platform(tier)` remains only as a deprecated compatibility shim *over the same assignments* for call sites not yet converted.
3. **`platform_role_grants` becomes a one-way compatibility bridge**, never read for authorization: INSERT mirrors into an assignment; DELETE revokes the linked assignment (before-delete trigger); UPDATE/TRUNCATE are refused; pre-existing grants were backfilled with per-row provenance audit. Retirement stages A–D are defined in [`ADMIN_RBAC_ARCHITECTURE.md` §6](../admin/ADMIN_RBAC_ARCHITECTURE.md).
4. **Escalation is impossible by construction:** no self-management; rank ceiling (manage only below your own rank; Super Admin excepted for Super Admins); permission ceiling (grant only permissions you hold); rank 100 reserved for the system Super Admin role; the last active Super Admin can never be removed (trigger, all writers); Super Admin bootstrap is DBA-only and one-time.
5. **The frontend has exactly one reader of authority:** `server/authorization/admin.ts` → `admin_my_access()`; navigation, page guards and control visibility all derive from one route→permission table (`lib/permissions/admin.ts`). Every Admin page guards its own route (enforced by a coverage test).

## Rationale

A second, independent authority source would let the two models disagree about who may act. Making the legacy table a write-only input keeps every existing provisioning path working during cutover while guaranteeing that revocation in RBAC always wins. Enforcing the ceilings in SQL (not the UI) means the rules hold for direct RPC calls, not only the console.

## Scope

Platform (Admin Staff) authority. Organization-level `membership_capabilities` (tenant authority) is untouched and remains governed by ADR-0007.

## What is deferred

- Scoped (organization/branch/user) role *creation and assignment UI* — the RPCs, triggers and tests exist; the scope picker belongs to the Organizations module (Phase 1B).
- The `department` scope (no departments/teams domain yet).
- Converting the remaining `is_platform('support')` commerce/jobs/trades read policies (their Admin modules).
- Retiring the bridge (stages B–C) and the shim (stage D).
- Onboarding a brand-new staff member (Invitation sub-phase).
- A suspension write path (PD-010) must refuse suspending the last active Super Admin.

## Consequences

- Legacy `support` holders lose every sensitive mutation and verification-document reads (intended, PD-004); Points adjust/reverse become Administrator-level (PD-012). Legacy moderators/administrators keep everything they had.
- `audit_log.actor_role` stays an informational legacy tier label (a Super Admin is recorded as `administrator`); it is never used for authorization.
- Local/staging environments have **no Super Admin until bootstrapped** (`app.admin_bootstrap_super_admin`), so nobody can manage roles until then.

## Related files

- `supabase/migrations/20260929100001_admin_rbac_foundation.sql`
- `supabase/tests/66_admin_rbac_foundation_test.sql`
- `frontend/src/lib/permissions/admin.ts`, `frontend/src/server/authorization/admin.ts`
- [`docs/admin/ADMIN_RBAC_ARCHITECTURE.md`](../admin/ADMIN_RBAC_ARCHITECTURE.md), [`docs/admin/PRODUCT_DECISIONS_REGISTER.md`](../admin/PRODUCT_DECISIONS_REGISTER.md) (PD-004, PD-008, PD-012, PD-016)
