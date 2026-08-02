# ADR-0007 — Identity & Tenancy Implementation Model (Phase 1)

**Status:** Accepted · 2026-08-02

## Purpose

Record the architectural decisions made when implementing the Phase 1 identity and multi-tenancy foundation, where the Phase 0.7 specification ([`docs/technical/02`–`07`](../technical/README.md)) left a genuine engineering choice open. This ADR **refines** the specification for implementation; it does not change product direction (which stays governed by [`PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md)). Context and the full gap analysis: [`docs/database/phase1-identity-tenancy-review.md`](../database/phase1-identity-tenancy-review.md).

## Decisions

### D1 — RLS helper functions are `security definer`, not JWT custom claims (yet)
The tenant-isolation helpers (`app.current_org_ids`, `app.current_branch_ids`, `app.has_capability`, `app.is_platform`, `app.is_org_member`) are implemented as `stable` **`security definer`** functions in a dedicated `app` schema that read `memberships` / `membership_capabilities` / `platform_role_grants`.

- **Why:** correct-by-construction and directly testable in pgTAP without wiring an auth access-token hook. `security definer` (owner = `postgres`) also **avoids RLS recursion** — a policy on `memberships` may call a helper that reads `memberships` because the definer function bypasses RLS on the tables it owns.
- **Hardening:** every definer function pins `set search_path = ''` (fully-qualified object names) and is granted `execute` only to `anon`/`authenticated` as needed.
- **Deferred:** promoting org/role membership into **JWT custom claims** (a `custom_access_token` hook) as a read-path optimization — tracked in [`TECHNICAL_DEBT.md`](../technical/TECHNICAL_DEBT.md). The helper API is claim-agnostic, so that swap needs no policy rewrite.

### D2 — Branch access = optional home branch + explicit assignment table + capability-derived org-wide access
`memberships.branch_id` is an **optional home/primary** branch. Multi-branch assignment is modeled by a new join table **`membership_branch_access(membership_id, branch_id)`**. Whether a member sees all branches is **derived from capability**, not stored:

- A member with `org.manage` or `branch.manage` → **org-wide** (sees every branch of the org).
- Otherwise → sees only branches in `membership_branch_access` (plus their `branch_id` home branch if set).

`app.current_branch_ids(org_id)` encodes exactly this. This satisfies [06 §3.1](../technical/06_rls_strategy.md)'s set-returning contract and the charter's "assigned branches" requirement, which a single `branch_id` column could not.

### D3 — Profile bootstrap via an `auth.users` trigger, not client code
An `AFTER INSERT` trigger `handle_new_user()` (`security definer`) on `auth.users` creates the `public.users` row and a minimal `public.profiles` row atomically. There is **no** client INSERT path for `users`, and `profiles` INSERT is not exposed to `authenticated`. Duplicate base identity is **structurally impossible**: `users.id` PK = `auth.users.id`, and `profiles.user_id` is `unique`. This is the enforcement point for the product invariant *"account upgrade extends the one identity; it never creates a second user or a duplicate base profile."*

### D4 — Platform-admin boundary lives only in `platform_role_grants`
Platform authority (`support` / `moderator` / `administrator`) is **not** a column on `users`/`profiles` and **not** a `membership_capability`. It exists solely in `platform_role_grants`, which has **no ordinary-user write policy** — for the pilot it is provisioned by a trusted server/migration/DBA path (service-role or a SQL seed run out-of-band), and every grant is auditable via `audit_log`. `app.is_platform(role)` is the single read point. This keeps org admins from ever escalating to platform admins.

### D5 — Explicit `grant`s, RLS on every table, deny-by-default
Because Supabase's Data API no longer auto-exposes new `public` objects, every table receives **explicit** `grant`s to `authenticated` (and `anon` only for public reference reads), and **RLS is enabled with explicit policies** on every table. RLS-enabled-without-policy (deny-all) or a tenant table without RLS are treated as release blockers ([06 §1](../technical/06_rls_strategy.md)).

## Scope

The Phase 1 tables: `users`, `profiles`, `contacts`, `organizations`, `branches`, `memberships`, `membership_capabilities`, `membership_branch_access`, `platform_role_grants`, `audit_log`, plus the `app` schema helpers and triggers. Later feature migrations reuse these helpers unchanged.

## What is deferred (not in this ADR / phase)

- JWT custom-claim optimization for helpers (D1).
- "Last `org.manage` owner cannot be revoked" multi-row invariant — enforced in the membership write path, not a CHECK.
- Org-visible audit scope; verification/subscription gates; org-creation caps — all `⚑ OPEN` in [`TECHNICAL_DEBT.md`](../technical/TECHNICAL_DEBT.md).

## Consequences

- The tenant-isolation spine is enforced by Postgres RLS from the first product migration, with pgTAP isolation tests as the gate ([06 §7](../technical/06_rls_strategy.md)).
- Helpers are the single choke point for tenancy logic; policy files stay readable (`<table>_<action>_<audience>`).
- A future claims-based optimization or enterprise org-group model ([14](../technical/14_future_extensions.md)) fits without a schema rewrite.

## Related files

`docs/database/phase1-identity-tenancy-review.md` · `docs/technical/03_database_design.md` · `docs/technical/06_rls_strategy.md` · `docs/technical/07_permissions_matrix.md` · `supabase/migrations/*` · ADR-0001 · ADR-0002
