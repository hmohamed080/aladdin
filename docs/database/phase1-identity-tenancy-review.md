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

## 5. Conclusion (initial implementation)

The specification is internally consistent and implementable with **no blocking product decision outstanding**. The only genuine architectural choices not fully pinned by the spec — the branch-access model (F2), the helper-function strategy (F3), the bootstrap trigger (F4), and the platform-admin boundary (F5) — are recorded in **[ADR-0007](../decisions/ADR-0007-identity-and-tenancy-model.md)**. Implementation proceeds on that basis.

---

## 6. Independent security review (Sprint 1.1, 2026-08-02)

A second, independent security/correctness/schema audit of the implemented (unmerged) migrations. Findings were fixed by editing the unmerged migration set; each is covered by an expanded pgTAP suite (98 tests) and, for the two criticals, verified directly against the live database catalog and a REST round-trip. Decisions are recorded in [ADR-0007 §Amendments](../decisions/ADR-0007-identity-and-tenancy-model.md#amendments--sprint-11-independent-security-review-2026-08-02).

### Merge-blocking findings (fixed)

| # | Finding | Resolution | Proof |
|---|---|---|---|
| **CRIT-1** | Supabase's default privileges grant `anon`/`authenticated` **`TRUNCATE`** on every table; `TRUNCATE` bypasses RLS and the row-level immutability trigger — a client could wipe any table incl. `audit_log`. | `revoke all … from anon, authenticated, service_role` in every migration, then grant back only intended access. | catalog acl; empirical `anon TRUNCATE` → denied; pgTAP truncate-denial tests |
| **CRIT-2 (historical; superseded by §9)** | `service_role` had **no DML** on the tables (this Supabase version doesn't auto-grant it), so the then-documented trusted-writer paths would fail. | Sprint 1 temporarily added broad grants. Sprint 2.1 proved they created workflow bypasses and revoked them; current services use constrained RPCs. | historical empirical insert + current denial/catalog tests |
| **B1** | Anon/non-member discovery exposed the **entire** `organizations`/`profiles` rows (incl. `created_by`, `user_id`, `status`, timestamps). | Base tables made private; curated `organization_public_directory` / `profile_public_directory` views expose only approved columns. **Sprint 4.2 (2026-08-04):** both were created `security_invoker=false`, which the Supabase Advisor flags as "Security Definer View"; re-expressed as `security_invoker` views over constrained `security definer` `app._*` readers (migration `20260805100000`) — Advisor cleared, `anon` still holds no base-table grant, columns/eligibility unchanged ([ADR-0007 D21](../decisions/ADR-0007-identity-and-tenancy-model.md)). | `columns_are` tests; REST round-trip; pgTAP `17_public_directory_hardening` (catalog + grants + visibility) |
| **B2** | All-column INSERT grant let a client self-set `status='active'`/`is_verified=true` (forged verification). | Column-scoped INSERT grant excludes `status`/`is_verified`; they default to `draft`/`false`. | pgTAP: insert-with-`is_verified` denied; defaults asserted |
| **B3** | `memberships.branch_id` ("home") silently granted branch access alongside `membership_branch_access` — two sources of authority. | Renamed `primary_branch_id` (descriptive only); removed from `current_branch_ids`. | pgTAP: primary-branch-only member sees 0 branches |
| **B4** | `administrator` in the `account_type` enum invited treating account type as privilege. | Removed from the enum; platform authority solely via `platform_role_grants`. | pgTAP: enum cast fails; account-type change grants no platform authority |

### Hardening (fixed): H1 `PUBLIC` execute revoked on `app.*`; H2 audit metadata/subject-type bounds + trigger `search_path`; H3 org-slug format `CHECK`; H4 `SUPABASE_ANON_KEY` documented in `backend/.env.example`.

### PASS (verified, unchanged): `handle_new_user` ignores hostile `raw_user_meta_data` (no injected account type / platform role / verification; locale validated; name truncated; idempotent, `security definer`, pinned `search_path`, schema-qualified). Helpers are `stable security definer` with `search_path=''`. Client construction creates a fresh instance per call (no global token leakage); the user client uses the **anon** key + caller JWT (RLS verified end-to-end via REST); the service client is the only service-role user.

### Deferred (documented debt): constrained `record_audit_event()` RPC; automated audit emission from write paths; last-owner protection; org-orphaning on create; live RLS integration test in the backend suite; repo-wide default-privileges convention enforcement in CI. See [`../technical/TECHNICAL_DEBT.md`](../technical/TECHNICAL_DEBT.md).

---

## 7. Account-type & public-eligibility fix (Sprint 1.2, 2026-08-02)

A second merge-blocking authorization gap, independent of Sprint 1.1, in the committed migrations. Fixed in the unmerged migration set; proven by pgTAP (98 → **112** tests) and catalog inspection.

| # | Finding | Resolution | Proof |
|---|---|---|---|
| **SELF-PROMO (merge-blocking)** | `authenticated` had a column UPDATE grant on `users.primary_account_type`, and `profile_public_directory` treated any non-consumer account type as public. An end consumer could self-promote to a professional type and appear in public discovery, bypassing the upgrade workflow, verification, and future subscription gates. **Confirmed empirically** (`update … set primary_account_type='engineer'` as the consumer succeeded → then appeared in the directory). | (1) `primary_account_type` removed from the `authenticated` update grant → server-controlled (only `locale` self-editable). Sprint 2.1 additionally removed the temporary direct `service_role` transition path; the constrained RPC is now mandatory. (2) Added server-controlled `profiles.public_profile_status` (`hidden`/`listed`); the directory now requires `listed` **and** professional type **and** active **and** not deleted. | catalog: `authenticated` and `service_role` cannot UPDATE `primary_account_type`; empirical direct updates denied; pgTAP `10`/`11`/`14` |

**Six concepts separated** (ADR-0007 D10/D11): identity · `primary_account_type` (server-controlled) · membership · platform role · professional verification (future `Verification` entity) · public visibility (`public_profile_status`). `users.is_verified` (identity) is **not** reused for public eligibility.

**Deferred:** the transactional/auditable account-upgrade write path and the professional `Verification` feature that sets `listed` — Sprint 2.

---

## 8. Sprint 2 — trusted write paths (2026-08-03)

Implements the account-upgrade, verification, membership, and branch write paths on top of the validated foundation. Migrations `20260803090001` (verification + upgrade + `record_audit_event`) and `20260803090002` (membership/branch RPCs). All decisions in [ADR-0007 §Amendments — Sprint 2](../decisions/ADR-0007-identity-and-tenancy-model.md). Covered by pgTAP suites `11`/`12`/`13` (suite grew 112 → **169**, repeatable across two clean resets).

### What was built
| Area | Path | Key guarantees |
|---|---|---|
| Account upgrade (self-service) | `public.request_account_upgrade` | caller-scoped (`user_id = auth.uid()`); one open request/user; never mutates privileged fields; idempotent |
| Verification review | `public.review_start` / `review_request_changes` / `review_reject` / `review_approve` | platform-only (`app.is_platform`); no self-approval; reason required on reject/changes; reviewer_id unspoofable |
| Apply upgrade | `public.apply_account_upgrade` | only path that writes `primary_account_type` + (if granted) `public_profile_status='listed'`; idempotent (`applied_at` + `FOR UPDATE`) |
| Public listing | `apply_account_upgrade` / `public.set_profile_hidden` | listed only when `grants_public_listing`; account type alone never lists; user can never self-list |
| Membership | `public.membership_invite/activate/set_capabilities/suspend/revoke` | capability-gated; **no-escalation**; **last-owner protected**; duplicates rejected |
| Branches | `public.branch_assign/unassign` | tenant-matched (cross-tenant impossible); duplicates idempotent; `primary_branch_id` grants nothing |
| Audit | `app.record_audit_event` (internal-only) | actor = `auth.uid()` (unspoofable); append-only; every listed RPC emits an event (direct-DML bypasses were subsequently closed in §9) |

### Catalog verification (post-migration)
- All 16 new functions: `security definer` + `search_path=""` (confirmed via `pg_proc`).
- `app.record_audit_event` and `app.assert_not_last_owner`: **not** executable by `anon`/`authenticated` (internal-only).
- `verifications`: `authenticated` and `service_role` = SELECT only; every production write uses the constrained RPCs. RLS enabled on `verifications` + `verification_documents`.

### Verified behaviours (pgTAP)
Self-promote still denied; approved upgrade transitions exactly once; double-apply idempotent; rejected request unchanged; unapproved profile not listed / approved profile listed / user cannot self-list; org admin ≠ platform verifier; no-escalation; cross-tenant branch denied; last-owner suspend/revoke blocked; audit actor unspoofable + append-only under UPDATE/DELETE.

### Deferred (Sprint 3+)
Verification document storage upload + OCR (placeholder table only); org-subject verification UX; subscription/package gates (clean insertion point before `apply_account_upgrade`); notification/Realtime fan-out; transactional outbox.

---

## 9. Sprint 2.1 — independent trusted write-path security review (2026-08-03)

The committed Sprint 2 implementation was inspected directly; the previous completion report was not treated as evidence. Migration `20260804090001_write_path_security_hardening.sql`, adversarial suite `14_write_path_security_review_test.sql`, and two real two-session scripts close and prove the findings below.

### Merge-blocking findings (fixed)

| Finding | Confirmed behavior | Enforceable resolution |
|---|---|---|
| Direct `service_role` identity bypass | `service_role UPDATE public.users SET primary_account_type=…` succeeded without verification, approval, `applied_at`, listing checks, concurrency lock, or audit. | Revoked direct identity/profile/verification DML. `service_role` now has SELECT plus only `users.locale` UPDATE; it cannot execute caller-attributed workflow RPCs. Normal services use an authenticated caller JWT. |
| Direct membership bypass | `authenticated` and `service_role` table DML could bypass no-escalation, last-owner, lifecycle, tenant match, immediate revocation, and audit. | Revoked direct membership/capability/branch-assignment DML and dropped write policies. The seven membership/branch RPCs are mandatory. |
| Last-owner race | Locking the changing membership/capability row set did not prove safety when two transactions targeted different owners. | Every protected mutation locks the stable `organizations` row before rechecking authority/status and changing the owner set. A two-session test proves the second revoke blocks, rechecks committed state, fails, and leaves one owner. |
| Stale/concurrent verification decisions | Reviewer ownership was not sticky enough, and only sequential behavior was tested. | Review assignment is sticky; only the assigned reviewer can decide/confirm; terminal fields are immutable. A two-session conflicting-approval test proves row-lock serialization and one immutable approval/audit. |

### Final write model

- `anon`: no base-table privilege on the ten reviewed tables.
- `authenticated`: SELECT under RLS; safe column updates only (`users.locale` and self-profile display fields). No direct privileged identity, verification, membership, capability, branch-assignment, platform-role, or audit write.
- `service_role`: SELECT on the reviewed tables and `users.locale` UPDATE only. No direct privileged DML and no execute on caller-attributed workflow RPCs.
- `postgres` owner: migration/bootstrap/emergency root of trust, not an application path. Platform-role provisioning or emergency recovery must use the documented same-transaction business mutation + audit procedure in ADR-0007.
- Workflow functions: fourteen `public` functions, all postgres-owned, volatile, `security definer`, `search_path=""`, executable only by `authenticated`, with authority derived inside SQL from `auth.uid()`/`platform_role_grants`/active membership capabilities. Four `app` helpers are postgres-only.

### Validation evidence

- pgTAP: **254/254 PASS** on the final post-fix reset (14 files); exact ACL/grant, resubmission, and bounded audit-reason assertions included.
- Concurrency: last owner PASS (second session blocked ≈2.74–2.80 s across both final cycles, harness gate ≥2 s; one active owner remains); approval PASS (second session blocked ≈2.70–2.71 s; one immutable decision/audit).
- Schema lint: no findings in `public,app`.
- History: an early Sprint 2.1 reset applied all migrations but its CLI timed out while restarting containers; catalog inspection confirmed all seven versions, and the suite passed after test-harness corrections (246 assertions at that intermediate point, before the resubmission and bounded-audit-reason fixes added two). The exact final tree was then validated with **two fully completed clean cycles** (`db reset` → `db lint public,app` → `supabase test db` → both concurrency scripts); both reset commands finished normally, both suites reported **254/254 PASS**, and both concurrency scripts passed.
