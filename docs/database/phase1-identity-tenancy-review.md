# Phase 1 — Pre-Implementation Spec Review (Identity & Multi-Tenancy)

| | |
|---|---|
| **Status** | Review · Sprint 1 (Tenant Isolation Foundation) |
| **Version** | 1.0.0 |
| **Owner** | Engineering |
| **Last Updated** | 2026-08-02 |
| **Depends On** | [`../technical/02_domain_model.md`](../technical/02_domain_model.md), [`../technical/03_database_design.md`](../technical/03_database_design.md), [`../technical/06_rls_strategy.md`](../technical/06_rls_strategy.md), [`../technical/07_permissions_matrix.md`](../technical/07_permissions_matrix.md) |
| **Related** | [`../decisions/ADR-0007-identity-and-tenancy-model.md`](../decisions/ADR-0007-identity-and-tenancy-model.md) |

An independent review of the Phase 0.7 specification **before** writing the first migration, per the Phase 1 charter. The goal is to find gaps, contradictions, and ambiguities and record how each is resolved in implementation — not to blindly transcribe the spec, and not to invent product direction.

## 1. Confirmed entities (in Phase 1 scope)

The spec is coherent and directly implementable for the tenancy foundation:

- **`users`** — mirrors `auth.users` (`id = auth.uid()`), holds `primary_account_type`, `status`, `is_verified`, `locale`. One canonical identity.
- **`profiles`** — 1–1 with `users` (`uq_profiles_user_id`); shared identity/display data only.
- **`contacts`** — verified/pending contact channels; exactly one `is_primary` per user.
- **`organizations`** — the tenant; `org_type`, `status`, `is_verified`, `created_by`.
- **`branches`** — child of organization; `is_active`.
- **`memberships`** — canonical user↔org link; `uq_memberships_user_org`; carries lifecycle status.
- **`membership_capabilities`** — granular capability grants on a membership (fixed catalog).
- **`platform_role_grants`** — platform admin/support/moderator authority, distinct from org roles.
- **`audit_log`** — append-only, immutable security/state-change record.

## 2. Findings and resolutions

### F1 — Table name: `memberships` vs. task's "organization_memberships"
The Phase 1 charter lists `organization_memberships`; the spec source of truth ([03](../technical/03_database_design.md), [06](../technical/06_rls_strategy.md), [07](../technical/07_permissions_matrix.md)) consistently names it **`memberships`**. **Resolution:** follow the spec name `memberships` for consistency with every RLS/permission reference. The charter's name is descriptive, not a rename directive. Documented so the naming choice is explicit.

### F2 — Branch access can't be modeled by a single `memberships.branch_id`
[03](../technical/03_database_design.md) gives `memberships.branch_id uuid` (0–1). But [06 §3.1](../technical/06_rls_strategy.md) requires `app.current_branch_ids()` to return a **set**, and the charter requires "employee access limited to **assigned branches**" (plural) alongside "organization-wide access". A single nullable column cannot express *multi-branch* assignment nor cleanly distinguish org-wide vs. branch-limited.
**Resolution (genuine design decision → [ADR-0007](../decisions/ADR-0007-identity-and-tenancy-model.md)):** keep `memberships.branch_id` as an optional **home/primary** branch, and add a `membership_branch_access(membership_id, branch_id)` join table for explicit multi-branch assignment. Org-wide access is **derived from capability** (`org.manage` / `branch.manage`), not from an assignment row. `app.current_branch_ids(org_id)` returns *all* org branches for org-wide members and *only assigned* branches otherwise.

### F3 — RLS helper implementation left open (JWT claims vs. table lookup)
[06 §2](../technical/06_rls_strategy.md) flags the "claim vs. table-lookup" choice as an engineering decision, preferring JWT custom claims for performance.
**Resolution (→ ADR-0007):** Phase 1 implements helpers as `stable` **`security definer`** functions that read `memberships` / `membership_capabilities` / `platform_role_grants`. This is correct-by-construction and directly testable in pgTAP without an auth-hook. The custom-access-token claim optimization is deferred to a later performance pass (tracked in TECHNICAL_DEBT). `security definer` also avoids RLS **recursion** (a policy on `memberships` that queries `memberships`), because a definer function owned by `postgres` bypasses RLS on the tables it reads.

### F4 — Profile bootstrap must not depend on the frontend
[02](../technical/02_domain_model.md)/charter §6: a profile is created with the user and must not be creatable by client code alone, and duplicates must be impossible.
**Resolution:** an `AFTER INSERT` trigger `handle_new_user()` on `auth.users` (`security definer`) inserts the `public.users` row and a minimal `public.profiles` row atomically. Duplicate prevention is structural: `users.id` PK = `auth.users.id`, and `profiles.user_id` carries `uq_profiles_user_id`. There is no client-writable INSERT policy on `users`; `profiles` INSERT is not exposed to `authenticated` (bootstrap owns creation).

### F5 — Platform admin must not be a profile field or an org role
Charter §10–11 and [07 §5](../technical/07_permissions_matrix.md): platform authority is cross-tenant governance, not an org membership role, and must not be user-editable.
**Resolution:** platform authority lives **only** in `platform_role_grants` (not on `users`/`profiles`, not in `membership_capabilities`). No policy lets an ordinary user INSERT/UPDATE `platform_role_grants` (writes are service-role / migration / DBA only for the pilot). `app.is_platform(role)` reads that table via a definer function. Provisioning is documented in ADR-0007.

### F6 — `org_type` reuses the `account_type` enum
[03](../technical/03_database_design.md) types `organizations.org_type` as `account_type`, but an org must not be `end_consumer` ([12 §3](../technical/12_validation_rules.md)).
**Resolution:** add a `CHECK (org_type <> 'end_consumer')`. Keeping the shared enum avoids a parallel type while the constraint enforces the product rule.

### F7 — `created_at`/`updated_at` maintenance
[03 §0](../technical/03_database_design.md) mandates `updated_at` maintained by a `set_updated_at` trigger.
**Resolution:** one shared `app.set_updated_at()` trigger function, attached to every mutable table. `audit_log` is exempt (append-only, no `updated_at`).

### F8 — Duplicate/verified contact uniqueness
[03](../technical/03_database_design.md): "unique verified value per channel" and "one primary per user".
**Resolution:** two partial unique indexes — `uq_contacts_verified_channel_value` (`WHERE is_verified`) and `uq_contacts_primary_per_user` (`WHERE is_primary`). Pending/unverified duplicates are allowed (two people can both be mid-verification on the same email); only a *verified* value is globally unique per channel.

### F9 — "last owner" protection is application-level
[12 §4](../technical/12_validation_rules.md): cannot revoke the last `org.manage` owner.
**Resolution:** this is a multi-row invariant awkward to express as a single CHECK; it is enforced in the write path (Server Action / RPC) in the membership-management feature, not this migration. Flagged as a follow-up so it is not forgotten. RLS still prevents *cross-tenant* membership tampering now.

## 3. Ambiguities intentionally deferred (not blocking Phase 1)

None of these block the tenant-isolation foundation; they are `⚑ OPEN` product decisions already tracked in [`../technical/TECHNICAL_DEBT.md`](../technical/TECHNICAL_DEBT.md) §7:

- Verification/subscription **gates** on publish/RFQ-respond (no catalog/RFQ tables in this phase).
- Subscription tiers/entitlement values, retention windows, per-category attribute schemas.
- Org-visible **audit scope** (Phase 1 grants audit reads to platform admins only; org-admin subset is deferred).
- Per-user org-creation cap (anti-abuse) — deferred to the org-creation write path.

## 4. Missing indexes / constraints added beyond the bare spec

- FK `on delete` behaviors made explicit (cascade for owned children; restrict/set-null where history matters).
- `ix_memberships_branch` (branch filter path) and `ix_membership_branch_access_branch`.
- `ix_platform_role_grants_user` for the hot `app.is_platform` lookup.
- `ix_audit_actor` in addition to the spec's subject/org indexes.

## 5. Conclusion

The specification is internally consistent and implementable with **no blocking product decision outstanding**. The only genuine architectural choices not fully pinned by the spec — the branch-access model (F2), the helper-function strategy (F3), the bootstrap trigger (F4), and the platform-admin boundary (F5) — are recorded in **[ADR-0007](../decisions/ADR-0007-identity-and-tenancy-model.md)**. Implementation proceeds on that basis.
