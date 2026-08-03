# 06 — RLS Strategy

| | |
|---|---|
| **Status** | Specification · Phase 0.7 (pre-implementation) |
| **Version** | 1.0.0 |
| **Owner** | Architecture / Foundation |
| **Last Updated** | 2026-08-01 |
| **Depends On** | 03_database_design.md, ../security/rls-strategy.md, ../decisions/ADR-0002-database-migrations.md |
| **Related** | 07_permissions_matrix.md, 05_storage_design.md |

Row Level Security design for the MVP. Policies ship *with* each table's migration, each with organization-isolation tests (ADR-0002). This document defines the patterns every table migration must follow. Extends [`security/rls-strategy.md`](../security/rls-strategy.md) and [`security-model.md`](../security/security-model.md).

> **Implementation status (Phase 1 + Sprint 1.1 security review, 2026-08-02):** the §2 identity helpers are implemented as `security definer` functions in the `app` schema — `current_org_ids`, `current_branch_ids(org)`, `has_capability(org,key)`, `is_platform(role)`, plus `is_org_member(org)` (migrations `20260802090001–2`), with `PUBLIC` execute revoked. The tenant-owned (§3.1), personal (§3.2), and audit (§3.7) patterns are enforced on the identity/tenancy tables and covered by **98 pgTAP tests**. Public discovery (§3.6) is served by curated **views** (`organization_public_directory`, `profile_public_directory`) exposing only approved columns — the base tables are private. Rationale: **[ADR-0007](../decisions/ADR-0007-identity-and-tenancy-model.md)**. RFQ/quote/conversation patterns land with those features.
>
> **Mandatory grant convention (hardened Sprint 2.1 — every migration):** Supabase defaults are never trusted. Every table migration must `revoke all … from anon, authenticated, service_role` first, then grant back the minimum reviewed privileges. `TRUNCATE`/`REFERENCES`/`TRIGGER` are withheld from application roles. Sensitive business transitions use constrained, attributed RPCs; do not grant direct `service_role` DML merely because code is server-side. Any worker-specific write must be column/path scoped, documented, and audited. An omitted revoke or an unexplained privileged grant is a release blocker.
>
> **Server-controlled columns (Sprint 1.2):** RLS is **not** sufficient when a column grant still lets a user self-mutate a privileged field. Privilege/eligibility columns must be excluded from the `authenticated` **column** update grant (they change only via `service_role` / a future constrained RPC): `users.primary_account_type`, `users.is_verified`, `users.status`, and `profiles.public_profile_status`. A user editing their own row (RLS `*_update_self`) can still only touch the granted columns. Public professional discovery requires `profiles.public_profile_status = 'listed'` (server-set) — selecting a professional account type does not make a profile public.
>
> **Write-path RPCs (Sprint 2):** state-changing operations on privileged tables (`verifications`, account-type/listing transitions, membership/branch lifecycle) are **`security definer` RPCs** (`public.*`, `search_path=''`, schema-qualified), not direct table DML. `verifications` has **no** client INSERT/UPDATE/DELETE grant — it is written only through the RPCs. Each RPC derives authority from `auth.uid()` via `app.is_platform`/`app.has_capability` (never a spoofable parameter) and emits an `audit_log` row via the internal `app.record_audit_event()` (execute-revoked from clients; actor forced to `auth.uid()`). This is the canonical pattern for future feature write paths.

## 1. Principles

1. **RLS is the isolation spine.** Every table holding user/org/verification/sales/project/file/AI data has RLS **enabled with explicit policies**. RLS enabled without a policy (deny-all) or a tenant table without RLS are **both bugs / release blockers**.
2. **Identity from the JWT only.** Policies derive identity from `auth.uid()` and JWT claims — never from client-supplied `user_id`/`organization_id`.
3. **App checks are defense-in-depth, never the only line.** Server Actions also check capabilities, but the DB is the guarantee.
4. **`service_role` bypasses RLS** → server-only, used sparingly with explicit intent (audit inserts, worker outputs, admin tooling), never in client code.
5. **Policy naming:** `<table>_<action>_<audience>` (e.g. `products_select_same_org`, `verifications_update_reviewer`).

## 2. Identity helpers (to be provided by migrations)

Stable SQL helpers the policies rely on (defined once, security-reviewed):

| Helper | Returns | Use |
|---|---|---|
| `auth.uid()` | current user id | ownership checks |
| `app.current_org_ids()` | set of org ids the caller has an **active** membership in | tenant filter |
| `app.current_branch_ids()` | set of branch ids assigned to the caller | branch filter |
| `app.has_capability(org_id, key)` | boolean | write/approve gating |
| `app.is_platform(role)` | boolean (support/moderator/administrator) | admin/support access |
| `app.is_participant(conversation_id)` | boolean | conversation access |

> These are derived from `memberships`, `membership_capabilities`, and `platform_role_grants`; they must be `stable`, `security definer` where needed, and themselves protected. ⚑ Exact claim vs. table-lookup implementation is an engineering decision at first-migration time (JWT custom claims for org/role are the performance-preferred path).

## 3. Access patterns by data class

### 3.1 Tenant-owned (org) data
Tables: `organizations`, `branches`, `memberships`, `membership_capabilities`, `products`, `product_media`, `inventory`, `availability`, `opportunities`, `needs`(org), `matches`, `tasks`, `follow_ups`, `quotes`, `quote_items`, `projects`, `project_activities`, `advertisements`, `ad_placements`, `subscriptions`(org), `analytics_snapshots`(org).

- **SELECT:** `organization_id in app.current_org_ids()` **and** `deleted_at is null`. Branch-scoped rows additionally optionally filtered to `app.current_branch_ids()` per capability (org-wide vs branch-limited roles).
- **INSERT/UPDATE/DELETE:** same org membership **and** `app.has_capability(organization_id, '<key>')` (e.g. `catalog.write`, `quote.submit`). Soft-delete = UPDATE `deleted_at`.
- **Branch scoping:** a branch-limited membership sees only its `branch_id` rows; org-wide capability sees all branches.

### 3.2 Personal (user) data
Tables: `users`, `profiles`, `contacts`, `needs`(consumer), `notifications`, `notification_preferences`, personal `subscriptions`, personal `documents`/`media`.

- **SELECT/UPDATE:** `user_id = auth.uid()` (or `id = auth.uid()` for `users`). `notifications` recipient-only.

### 3.3 Verification data
Tables: `verifications`, `verification_documents`.

- **SELECT:** the **subject** (owning user, or members of the owning org with `verification.read`) **or** a platform reviewer.
- **INSERT/UPDATE(submit):** only through caller-attributed submission RPCs; no direct table DML grant.
- **Decision UPDATE** (`under_review`→approved/rejected/needs_more_info): only through the assigned-reviewer RPCs, gated by `app.is_platform('support')`, never the subject or an organization member reviewing their own org. Decisions are immutable and audited.

### 3.4 RFQ / quote (cross-org, scoped views)
- `rfq_requests`: **requester** side sees the full request; a **responder org** sees only requests addressed to it (via an `rfq_recipients` link — ⚑ add if fan-out is many providers) and only its own `quotes`.
- `quotes`: **responder org** members with `quote.*` see their own quotes; the **requester** sees submitted quotes to their RFQ (never other responders' drafts). This is the **anti-auction** guarantee: no responder sees another's pricing.
- `quote_decisions`: requester writes; both sides read the decision on their linked quote.

### 3.5 Conversations & messages
- Access gated by `app.is_participant(conversation_id)`. Participants are set from the subject context (RFQ parties, project members, consultation user + sales). No cross-tenant leakage: a participant row is required.

### 3.6 Public / reference data
Tables: `categories`, `brands`(global), `localities`, `plans`, account-type enum.
- **SELECT:** public/all authenticated (`anon`/`authenticated`). **Write:** platform admin only.
- Public **discovery** of `products`/`organizations`: a **published, verified** subset is world-readable (B2C discovery). Implemented as a dedicated policy `products_select_public` (`status = 'active' and deleted_at is null and <org verified>`), separate from the org-internal policy. Draft/archived products remain org-only.

### 3.7 Audit
- `audit_log`: **INSERT** only by the internal postgres-owned `app.record_audit_event()` invoked from constrained workflow RPCs; direct application-role/`service_role` INSERT is denied. **SELECT** by platform administrator (org-scoped subset for org admins remains ⚑ open). Never UPDATE/DELETE/TRUNCATE.

### 3.8 Privileged Phase 1 write boundary (implemented)

- Direct `authenticated` and `service_role` DML is prohibited on privileged identity/verification fields and on `memberships`, `membership_capabilities`, `membership_branch_access`, `platform_role_grants`, and `audit_log`.
- Normal trusted services preserve the caller JWT and invoke the constrained RPC; a server location or service-role key does not itself confer business authority.
- Membership/capability mutations acquire a stable organization-row lock before authority/status recheck and mutation. Verification decisions/apply acquire the verification-row lock.
- The postgres owner remains the migration/Auth-bootstrap/emergency root of trust. Emergency use is outside the normal production path and must follow ADR-0007's same-transaction mutation+audit procedure.

## 4. Admin & support access

- **Administrator:** cross-tenant **read** for governance + write on platform/reference data + verification/ad decisions + moderation. All admin cross-tenant actions are **audited**.
- **Moderator:** cross-tenant **read** limited to moderation surfaces (products, ads, profiles, reports) + moderation actions (approve/reject/hide). No access to private financial/quote internals beyond what moderation requires.
- **Support:** **read-only** cross-tenant on the subject a support ticket concerns (⚑ scope to a support-session/impersonation-audit model), plus verification review. Support never writes tenant business data silently; actions are audited.
- Platform access is expressed via `platform_role_grants` and evaluated by `app.is_platform(...)` in policies — **not** by disabling RLS.

## 5. Future enterprise / multi-org support

- The org tenant model already supports a user belonging to **multiple** organizations via multiple `memberships` (with **one current primary account type** governing their identity). `app.current_org_ids()` returns a set, so RLS scales to multi-org membership without change.
- ⚑ **Future** (not MVP): org groups / holding structures, delegated admin across child orgs, and enterprise SSO — deferred to [14](14_future_extensions.md); the tenancy columns and helper-set design leave room for them without a rewrite.

## 6. Storage RLS

Bucket policies mirror the table policies of the row that references the object ([05](05_storage_design.md)): public buckets = public read + owner write; private buckets = same org/participant/subject checks; `verification`/`exports` strictest. `service_role` writes worker outputs.

## 7. Testing requirement (blocking)

Every table migration adding RLS ships with, in `supabase/tests/`:
- **Organization-isolation tests:** org A cannot SELECT/INSERT/UPDATE/DELETE org B's rows (all four verbs).
- **Capability tests:** a member without the capability is denied writes.
- **Public-view tests:** only published+verified rows are visible unauthenticated; drafts are not.
- **Storage-policy tests:** private objects are not readable cross-tenant; signed-URL path only.
- **No-self-approval test** for verification decisions.

A migration without these tests fails review.
