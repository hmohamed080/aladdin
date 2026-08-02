# ADR-0007 — Identity & Tenancy Implementation Model (Phase 1)

**Status:** Accepted · 2026-08-02 (amended 2026-08-02 — Sprint 1.1 security review; see Amendments below)

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

## Amendments — Sprint 1.1 independent security review (2026-08-02)

An independent security/correctness review of the (unmerged) Phase 1 migrations produced the following binding refinements. They are applied by editing the still-unmerged migration set (no new migration), and are proven by the expanded pgTAP suite.

- **D2 refined — one source of branch authority.** `memberships.branch_id` is renamed **`primary_branch_id`** and is now purely descriptive default context. It grants **no** access: `app.current_branch_ids` derives authority solely from `membership_branch_access` (explicit assignment) plus an org-wide capability (`org.manage`/`branch.manage`). This removes the earlier dual-source ambiguity.
- **D4 reinforced — account type is never authority.** `administrator` is **removed from the `account_type` enum**. Platform staff hold a normal account type plus a `platform_role_grant`; no policy, helper, or bootstrap path may infer platform authority from `primary_account_type`. Proven by tests.
- **D6 (new) — public discovery uses curated views, not the base tables.** Anonymous/non-member B2C discovery is served only by `organization_public_directory` and `profile_public_directory`, which expose an explicit approved column set (never `created_by`, `user_id`, `status`, `deleted_at`, or timestamps). The base `organizations`/`profiles` tables are private (member/self/platform only) — the anon SELECT policy and grant were removed.
- **D7 (new) — no trust forgery on insert.** Client INSERT grants are column-scoped: a client cannot set `organizations.status`/`is_verified` (they default to `draft`/`false`, so no self-verification) nor `memberships.status`/`accepted_at` (default `invited`).
- **D8 (new, CRITICAL) — strip Supabase default table privileges.** Supabase grants `anon`/`authenticated` `TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN` on every new `public` table; `TRUNCATE` bypasses RLS **and** row-level triggers (it would wipe even the append-only `audit_log`). Every Phase 1 migration now `revoke all … from anon, authenticated, service_role` before granting back only the intended access. **Convention:** every future feature migration must do the same (documented in [06](../technical/06_rls_strategy.md)).
- **D9 (new, CRITICAL) — explicit `service_role` grants.** This Supabase version does not auto-grant DML to `service_role`, so the trusted-writer paths (audit inserts, worker outputs) would have failed in a real project. `service_role` is now granted the DML it needs (`audit_log`: `select, insert` only — append-only preserved; other tables: `select, insert, update, delete`; never `truncate`).
- **H1 — helper execute privileges.** `PUBLIC` execute is revoked on all `app.*` security-definer functions; execute is granted only to `authenticated` (tenancy helpers) — `anon` cannot invoke them.
- **H2 — audit hardening.** `audit_log.metadata` must be a bounded JSON object (`jsonb_typeof = 'object'`, ≤ 8 KB); `subject_type` ≤ 64 chars; `forbid_mutation` gains a pinned `search_path`. A constrained `record_audit_event()` RPC (so trusted callers cannot set an inconsistent actor) is deferred to Sprint 2.

### Platform-admin provisioning procedure (pilot)

Because there is deliberately **no** ordinary-user write path to `platform_role_grants` (D4), platform authority is provisioned out-of-band:

- **Who:** a repository maintainer / DBA with the project's Supabase **service-role** key or direct database (DBA) access — never an application user.
- **Environment:** a trusted server context (Supabase SQL editor as the service role, a one-off migration, or a `service_role` backend admin task). The service-role key lives only server-side and is never shipped to a browser.
- **Grant (exact):**
  ```sql
  insert into public.platform_role_grants (user_id, role, granted_by)
  values ('<auth-user-uuid>', 'administrator', '<granting-admin-uuid-or-null>');
  ```
- **Revoke:** `delete from public.platform_role_grants where user_id = '<uuid>' and role = '<role>';`
- **Audit:** each grant/revoke must also write an `audit_log` row (`platform_role.granted` / `platform_role.revoked`) via the service role. Automating this inside a `record_audit_event()`/grant RPC is the Sprint 2 requirement; until then it is a documented manual step.
- **Emergency recovery:** if all administrators are lost, a maintainer with the service-role key (or DBA access) re-inserts a grant using the statement above; RLS never blocks the service role. The service-role key and DB credentials are the root of trust and are rotated per the secrets policy.

## Related files

`docs/database/phase1-identity-tenancy-review.md` · `docs/technical/03_database_design.md` · `docs/technical/06_rls_strategy.md` · `docs/technical/07_permissions_matrix.md` · `supabase/migrations/*` · ADR-0001 · ADR-0002
