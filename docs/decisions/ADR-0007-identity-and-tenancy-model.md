# ADR-0007 — Identity & Tenancy Implementation Model (Phase 1)

**Status:** Accepted · 2026-08-02 (amended 2026-08-02 — Sprint 1.1 security review, Sprint 1.2 account-type/eligibility fix; amended 2026-08-03 — Sprint 2 trusted write paths; see Amendments below)

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
- **D9 (new, CRITICAL; superseded for privileged Phase 1 writes by D17) — explicit `service_role` grants.** Sprint 1 made the then-assumed trusted-writer grants explicit. The Sprint 2.1 review proved that unrestricted DML contradicted the constrained-workflow invariant; D17 removes those grants from privileged identity, verification, membership, branch, platform-role, and audit tables.
- **H1 — helper execute privileges.** `PUBLIC` execute is revoked on all `app.*` security-definer functions; execute is granted only to `authenticated` (tenancy helpers) — `anon` cannot invoke them.
- **H2 — audit hardening.** `audit_log.metadata` must be a bounded JSON object (`jsonb_typeof = 'object'`, ≤ 8 KB); `subject_type` ≤ 64 chars; `forbid_mutation` gains a pinned `search_path`. A constrained `record_audit_event()` RPC (so trusted callers cannot set an inconsistent actor) is deferred to Sprint 2.

## Amendments — Sprint 1.2 account-type & public-eligibility fix (2026-08-02)

A merge-blocking authorization gap was found and closed: `authenticated` held a column UPDATE grant on `users.primary_account_type`, and `profile_public_directory` treated *any* non-consumer account type as publicly discoverable. Together an end consumer could self-promote to a professional type and immediately appear in public discovery — bypassing the approved account-upgrade workflow, verification, and future subscription gates. Confirmed empirically before the fix.

- **D10 — `primary_account_type` is server-controlled.** Removed from the `authenticated` update grant; only `locale` remains self-editable on `users` (`is_verified`/`status` were already withheld). The implemented boundary is the constrained account-upgrade RPC workflow; direct application-role DML is prohibited by D17. This enforces the canonical rule: *account upgrade extends the one identity through a trusted server-side workflow; it is not a user-editable profile field.*
- **D11 — public discovery requires explicit, server-controlled eligibility.** Added `profiles.public_profile_status` (`public.public_profile_status` enum: `hidden` default / `listed`), **not** in the `authenticated` update grant (server-controlled). `profile_public_directory` now requires `public_profile_status = 'listed'` **and** a professional (non-consumer) account type **and** active user **and** not soft-deleted. Selecting a professional account type no longer makes a profile public.
- **Six concepts kept distinct:** (1) identity = `users`+`profiles`; (2) `primary_account_type` = approved primary product experience (server-controlled); (3) organization membership = tenant access/capabilities; (4) platform role = `platform_role_grants`; (5) **professional verification** = the domain `Verification` request/decision entity (its feature is deferred — it is the workflow that will set `public_profile_status = 'listed'`); (6) **public-profile visibility** = `profiles.public_profile_status`. No single field represents more than one concept; `users.is_verified` (identity verification) is deliberately **not** reused for public eligibility.
- **Historical deferral, resolved in Sprint 2/2.1:** the transactional account-upgrade workflow landed in Sprint 2; Sprint 2.1 removed the temporary direct `service_role` DML that could bypass it.

## Amendments — Sprint 2 trusted write paths (2026-08-03)

Implements the write paths on top of the validated identity/RLS foundation. All state transitions are `security definer` RPCs (`search_path = ''`, schema-qualified) that derive the actor from `auth.uid()` — **no spoofable `user_id`/actor parameter exists anywhere**. `primary_account_type` and `public_profile_status` stay server-controlled; these RPCs are the only trusted path that changes them.

- **D12 — Verification entity + account-upgrade workflow.** New `verifications` (+ minimal `verification_documents`) with the spec state machine (`draft/submitted/under_review/approved/rejected/needs_more_info/expired`). The workflow is deliberately split into distinct functions so user submission and privileged approval never collapse into one call: `public.request_account_upgrade` (self-service, `execute` to `authenticated`, forces `user_id = auth.uid()`, one open request per user via a partial unique index, never mutates privileged fields) → `public.review_start` → `public.review_request_changes`/`review_reject` → `public.review_approve` → `public.apply_account_upgrade` (idempotent via `applied_at` + `FOR UPDATE`; the **only** path that writes `primary_account_type` and, when granted, `public_profile_status = 'listed'`). Spec extensions recorded here: `requested_account_type`, `grants_public_listing`, `applied_at`.
- **D13 — verification decisions are platform-only, no self-approval.** Review/approve/apply gate on `app.is_platform('support')` (reads `platform_role_grants` only — never account type or org role); `review_reject`/`review_approve` additionally reject when `reviewer = subject`. `reviewer_id` is set to `auth.uid()` inside the function, so a reviewer cannot be spoofed. Reason is required on reject/changes-requested.
- **D14 — public listing stays separate from account type and identity verification.** `apply_account_upgrade` lists a profile **only** when the approved verification's `grants_public_listing` is true (reviewer-set); rejection never lists; `public.set_profile_hidden` (platform-only) returns `listed → hidden`. Account type alone never lists; the user can never self-list (server-controlled column). `users.is_verified` (identity) is untouched by the professional-upgrade path.
- **D15 — membership & branch write-path RPCs** (`membership_invite/activate/set_capabilities/suspend/revoke`, `branch_assign/unassign`): authority from `app.has_capability(org,'org.members.manage'|'branch.manage')`; **no-escalation** (a manager may only grant capabilities they themselves hold); **last-owner protection** (`app.assert_not_last_owner` locks the stable organization row before counting/changing owners) — implemented, not deferred; **cross-tenant assignment impossible** (branch org must equal membership org); duplicate membership is rejected and duplicate branch assignment is an audited-once idempotent no-op. `primary_branch_id` still grants no access.
- **D16 — constrained `record_audit_event()` (resolves Sprint 1.1 H2).** `app.record_audit_event(action, subject_type, subject_id, org_id, metadata)` is `security definer`, **internal-only** (`execute` revoked from `anon`/`authenticated`), sets `actor_user_id = auth.uid()` and derives `actor_role` from `platform_role_grants` — callers cannot forge the actor. Invoked only by the gated workflow RPCs (running as owner). The audit action allow-list is widened for the new events; `audit_log` stays append-only (immutability trigger + no client/`service_role` update/delete).
- **RPC placement (engineering choice).** Workflow RPCs live in **`public`** (PostgREST-exposed) so the caller's JWT reaches them via `.rpc()`; each enforces authority internally from `auth.uid()`. Ordinary authenticated users may only *reach* the privileged functions — every one rejects unauthorized callers server-side (defense-in-depth). Pure helpers and `record_audit_event` stay execute-revoked (internal). No service-role client is exposed to the browser; the Next.js server actions forward the caller's own JWT.
- **Concurrency/idempotency.** One open verification per user (partial unique index); decisions and single-apply serialize on the verification row (`applied_at` makes apply idempotent); duplicate membership is rejected and duplicate branch assignment is idempotent. All membership/capability mutations first lock the stable organization row, so two transactions cannot each remove a different owner. Every RPC is transactional, so an audit-insert failure rolls the protected change back.
- **Deferred (Sprint 3+):** verification document storage upload + OCR (only a placeholder `verification_documents` table exists); org-subject verification review UX; subscription/package gates (the workflow has clean insertion points — a gate step before `apply_account_upgrade` — without redesigning identity); notification/Realtime fan-out; transactional outbox.

## Amendments — Sprint 2.1 independent trusted write-path review (2026-08-03)

The independent catalog and behavior review found two merge-blocking contradictions in the initial Sprint 2 report: `service_role` could directly update privileged identity/verification state, and authenticated/service roles could directly mutate membership tables around the invariant-enforcing RPCs. Migration `20260804090001_write_path_security_hardening.sql` closes both.

- **D17 — one enforceable privileged write boundary.** `anon` has no base-table privilege on the reviewed tables. `authenticated` and `service_role` have SELECT only on `users`, `profiles`, `verifications`, `verification_documents`, `memberships`, `membership_capabilities`, `membership_branch_access`, `branches`, `platform_role_grants`, and `audit_log`, except the explicitly non-privileged `users.locale` column update (`authenticated` and `service_role`) and safe self-profile columns (`authenticated`). Direct application-role INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER is absent. Normal trusted services preserve the caller JWT and call the constrained RPCs; possessing a service-role key is not a business-transition authorization mechanism.
- **D18 — verification decisions are sticky and immutable.** Subject/type/target/submission metadata are immutable after creation; reviewer assignment is sticky; only the assigned reviewer may decide or confirm a decision; listing eligibility changes only during approval; applied and terminal rows cannot be rewritten. Repeating `request_account_upgrade` for the same target resubmits `needs_more_info`, clears the prior review claim/reason, emits audit metadata, and requires a fresh `review_start`. Professional user approvals alone enter `apply_account_upgrade`; expired, rejected, needs-more-info, organization-subject, or already-applied requests cannot cross that boundary.
- **D19 — membership RPCs are mandatory.** Direct membership/capability/branch-assignment DML is revoked and obsolete write policies are removed. The RPCs recheck caller authority after acquiring the organization lock, reject invalid/duplicate capability keys, enforce no-escalation and last-owner safety, reject inactive membership/branch assignment, enforce tenant matching structurally, and emit audit only for real changes.
- **D20 — concurrency is empirically gated.** CI runs real two-session tests. Competing last-owner revocations serialize on the organization row and leave one owner. Conflicting approval flags serialize on the verification row; the second call is an idempotent no-op and cannot rewrite the committed decision. Sequential pgTAP alone is not accepted as proof.
- **Audit classification.** Allowed production transitions are the attributed RPC paths and write audit rows in the same transaction. Direct application-role paths are prohibited. Auth bootstrap is the postgres-owned `auth.users` trigger and creates only base identity/profile rows. Database-owner access is an operational root of trust for migrations or emergency recovery, not an application path; any emergency mutation requires the procedure below.

### Platform-admin provisioning and emergency recovery (pilot)

Because there is deliberately no application-role write path to `platform_role_grants` (D4/D17), platform authority is provisioned out-of-band:

- **Who:** an authorized DBA/repository maintainer using the database-owner migration channel — never an application user or normal service-role client.
- **Environment:** a reviewed migration for routine provisioning. Direct database-owner SQL is emergency-only, requires a change/incident record and two-person review where operationally available, and is not embedded in application code.
- **Grant (exact):**
  ```sql
  begin;
  with granted as (
    insert into public.platform_role_grants (user_id, role, granted_by)
    values ('<auth-user-uuid>', 'administrator', '<granting-admin-uuid-or-null>')
    returning id
  )
  insert into public.audit_log (
    actor_user_id, actor_role, action, subject_type, subject_id, metadata
  )
  select '<granting-admin-uuid-or-null>', 'administrator',
         'platform_role.granted', 'platform_role_grant', id,
         jsonb_build_object('change_id', '<approved-change-id>',
                            'operator', '<named-operator>')
  from granted;
  commit;
  ```
- **Revoke:** the same owner-transaction pattern: `DELETE … RETURNING id`, then insert `platform_role.revoked` with the returned subject id and required change/operator metadata before commit.
- **Audit:** the grant/revoke and its `audit_log` row (`platform_role.granted` / `platform_role.revoked`) are committed in the same owner transaction. Emergency metadata records the incident/change identifier and operator identity; failure to insert the audit row rolls the transaction back.
- **Emergency recovery:** if all administrators are lost, the authorized DBA uses the same owner transaction. `service_role` has no direct DML grant on `platform_role_grants` or `audit_log`; database-owner credentials remain the operational root of trust and are rotated per the secrets policy.

## Related files

`docs/database/phase1-identity-tenancy-review.md` · `docs/technical/03_database_design.md` · `docs/technical/06_rls_strategy.md` · `docs/technical/07_permissions_matrix.md` · `supabase/migrations/*` · ADR-0001 · ADR-0002
