# ADR-0008 — B2B Sales Domain Foundation (Phase 2, Sprint 3)

**Status:** Accepted · 2026-08-03

## Purpose

Record the architectural decisions for the first Sales slice — the B2B beachhead the whole platform drafts off ([`PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md): *Sales is the daily-active user*). This ADR **reuses** the Phase 1 identity/tenancy spine ([ADR-0007](ADR-0007-identity-and-tenancy-model.md)) unchanged and refines the Phase 0.7 spec ([`02`](../technical/02_domain_model.md)–[`12`](../technical/12_validation_rules.md)) where the sales foundation left engineering choices open. It does not change product direction. Scope is a secure **operating workflow**, not a generic CRM.

## Context

Phase 1 established `organizations`/`branches`/`memberships`/`membership_capabilities`/`membership_branch_access`/`platform_role_grants`, the `app.*` tenancy helpers, the constrained `app.record_audit_event()` writer, and the hardened write-path convention (base tables SELECT-only; every privileged mutation is a `security definer` RPC; direct client/`service_role` DML revoked). Sprint 3 builds the sales entities on exactly that pattern.

## Decisions

### D1 — Sales entities: `customers`, `leads`, `sales_activities`, `follow_up_tasks`
The Sprint-3 pipeline unit is **`leads`** (not the broader `Opportunity` in [02](../technical/02_domain_model.md)). Its `stage` set (`new → contacted → qualified → proposal_pending → decision_pending`) deliberately omits the spec's `matching`/`quoted` stages, which require the deferred Match/RFQ/Quote modules. The richer `Opportunity → Need → Match → Quote` chain remains spec/deferred and will connect to `leads` later. `customers` is a new tenant-owned CRM record; `sales_activities` is an append-only timeline; `follow_up_tasks` are actionable follow-ups. **No** deal value, quotation, RFQ, product, order, project, message, or reminder is introduced.

### D2 — Everything is organization-owned; branch scope is optional
Every sales row carries `organization_id` (the tenant boundary) and an optional `branch_id` (`NULL` = organization-wide). The same real-world customer may exist independently per tenant; there is **no** global phone/email uniqueness and **no** market-wide customer directory.

### D3 — Structural tenant safety via composite foreign keys
Parents expose `unique (organization_id, id)`; every child reference (`branch_id`, `customer_id`, `assigned_membership_id`, `lead_id`) is a **composite FK** `(organization_id, <child>) → parent (organization_id, id)`. Cross-tenant linkage is therefore impossible **by construction** — no trigger needed. A `NULL` child column (org-wide row / no link) is permitted (MATCH SIMPLE).

### D4 — Minimal sales capability set: `sales.read`, `sales.write`, `sales.assign`, `sales.manage`
Added to the fixed catalog. `sales.read` = read in scope; `sales.write` = create/update customers, leads, activities, follow-ups; `sales.assign` = assign/reassign leads & follow-ups to others; `sales.manage` = org-wide sales authority (implies the others). `org.manage` also grants org-wide sales authority. The older speculative `sales.opportunity.*`/`match.share`/`task.write`/`followup.send` keys are retained but reserved for the future Opportunity/Match workflow.

### D5 — Read visibility model (RLS) — scope, not frontend filtering
A member sees a sales row when they are an active member **and** one of: org-wide sales authority (`sales.manage`/`org.manage`); or `sales.read` **and** (the row's `branch_id` ∈ their assigned branches **or** the row is assigned to them). Activities/follow-ups carry a **denormalized `branch_id`** (copied from the parent lead/customer) so their RLS uses the same predicate without cross-table recursion. Cross-tenant/cross-branch access never depends on client filtering.

### D6 — No platform cross-tenant read on customer PII
Unlike `organizations`/`users` (which grant `is_platform('support')` cross-tenant read), `customers`/`leads`/`sales_activities`/`follow_up_tasks` have **no platform read policy**. This honors *Customer Data Never Leaves the Platform* and the "no searchable market-wide customer database" guardrail. Platform governance over sales data is deferred to a purpose-built, audited path.

### D7 — Every mutation is a constrained, audited RPC (reuse of the Phase 1 pattern)
Base tables are SELECT-only for `authenticated`/`service_role`; `anon` has none; there are **no** write policies and **no** write grants. All 13 mutations are `public` `security definer` RPCs (`search_path=''`, schema-qualified), executable by `authenticated` **only** (a service-role key is not a business-authorization path). Each derives the caller from `auth.uid()`, resolves the active membership, enforces org + branch scope + capability, rejects arbitrary cross-tenant ids, and emits its `audit_log` event in the **same transaction** — so an audit failure rolls the mutation back and direct DML cannot bypass lifecycle/assignment/tenant/audit invariants.

### D8 — Lead lifecycle is optimistic-concurrency-safe
`transition_lead` takes the caller's `p_expected_version`, locks the row `FOR UPDATE`, and rejects a stale version (`40001`), so a concurrent transition cannot silently overwrite a newer stage/status. Legal edges only: `active → won|lost|archived` and `{won,lost,archived} → active` (reopen); stage changes only while active; `lost` requires a reason; `won`/`lost`/`reopened`/`archived` are audited and emit a `status_change` timeline activity.

### D9 — Phone normalization for intra-org duplicate detection
`app.normalize_phone()` (immutable) produces an E.164-style `+<cc><national>` string, stored in a generated column, with a **partial unique index** `(organization_id, primary_phone_e164) where … and status <> 'archived'`. This is the approved duplicate-detection strategy: one active customer per phone per org; archived rows free the number; other tenants are unaffected. It is WhatsApp-compatible but does **not** implement WhatsApp. Contact points live directly on `customers` (smallest model); a multi-contact-point table can be added additively later.

### D10 — Dashboard reads are `security_invoker` views
The read models (`sales_lead_stage_counts`, `sales_my_open_leads`, `sales_overdue_follow_ups`, `sales_follow_ups_due_today`, `sales_recent_activities`) are `security_invoker = true` views, so RLS scopes every row to the caller **before** aggregation — a branch-limited user never sees org-wide metrics. Read foundation only; no UI.

## Scope

New objects (migrations `20260805090001`–`3`): tables `customers`, `leads`, `sales_activities`, `follow_up_tasks`; enums `customer_type`, `customer_status`, `sales_source`, `sales_priority`, `lead_status`, `lead_stage`, `sales_activity_type`, `follow_up_status`; helpers `app.normalize_phone`, `app.can_manage_sales`, `app.membership_can_access_branch`, `app.active_membership_id`, `app.can_act_on_follow_up`; 13 workflow RPCs; 5 read-model views; capability-catalog + audit-action-allow-list extensions; composite-FK unique keys on `branches`/`memberships`.

## What is deferred (not in this ADR / sprint)

Opportunity/Need/Match, RFQ, quotes, projects, products/inventory, orders, payments, conversations/WhatsApp, notifications/reminders (the schema is reminder-ready — `due_at`, assignee), AI/market intelligence, Excel import/export execution (schema is import-ready — see [TECHNICAL_DEBT](../technical/TECHNICAL_DEBT.md)), recurring tasks, org-customizable pipeline stages, platform governance over sales data, and a scheduled overdue-materialization job.

## Consequences

- Sales data is strictly tenant-isolated and branch-scoped, enforced in RLS **and** the RPCs (defense in depth), proven by pgTAP (`15`/`16`) and the existing isolation suite. Total suite: **337** assertions.
- The workflow RPCs are the only production write path; a leaked service-role key cannot mutate sales data or bypass invariants.
- Future features (RFQ, quotes, projects, notifications, import/export) attach to `leads`/`customers` without redesign.

## Related files

[ADR-0007](ADR-0007-identity-and-tenancy-model.md) · [`02_domain_model.md`](../technical/02_domain_model.md) · [`06_rls_strategy.md`](../technical/06_rls_strategy.md) · [`07_permissions_matrix.md`](../technical/07_permissions_matrix.md) · [`11_state_machines.md`](../technical/11_state_machines.md) · [`12_validation_rules.md`](../technical/12_validation_rules.md) · [`DECISION_LOG.md`](DECISION_LOG.md) · [`../operations/RUNTIME_STATE.md`](../operations/RUNTIME_STATE.md)
