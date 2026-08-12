# Aladdin — MVP Technical Specification (Phase 0.7)

| | |
|---|---|
| **Status** | Specification · Phase 0.7 (pre-implementation) |
| **Version** | 1.0.0 |
| **Owner** | Architecture / Foundation |
| **Last Updated** | 2026-08-01 |
| **Depends On** | ../product/PRODUCT_DIRECTION_GUIDE.md, ../decisions/ |
| **Related** | all 01–14 technical documents |

The complete engineering blueprint for the Aladdin Private Pilot MVP. A senior engineer should be able to build the MVP from these documents without re-deriving product or architecture decisions.

**Status:** Specification only · 2026-08-01 · No code, migrations, APIs, or tables are created in this phase.

## Authority

This blueprint is **subordinate** to the canonical project memory and ADRs. On any conflict, the higher source wins in this order:

1. [ADRs](../decisions/) (`ADR-0001`…`ADR-0005`)
2. [`PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md)
3. [`mvp-scope.md`](../product/mvp-scope.md)
4. [`UI_UX_SYSTEM_GUIDE.md`](../../UI-UX/UI_UX_SYSTEM_GUIDE.md) + [`DESIGN.md`](../../DESIGN.md)
5. [`RUNTIME_STATE.md`](../operations/RUNTIME_STATE.md)

Where this blueprint had to reconcile a request against the approved architecture (e.g. media storage, push, maps, role names), the reconciliation is stated inline and consolidated in [`14_future_extensions.md`](14_future_extensions.md) and the Phase-0.7 final report.

## Documents

| # | Document | Scope |
|---|---|---|
| 01 | [System Overview](01_system_overview.md) | Architecture, bounded contexts, modules, data ownership, communication, integrations |
| 02 | [Domain Model](02_domain_model.md) | Every business entity: purpose, responsibilities, relationships, lifecycle, ownership, constraints |
| 03 | [Database Design](03_database_design.md) | Tables, columns, types, indexes, FKs, constraints, soft-delete, audit, search |
| 04 | [Relationships (ERD)](04_relationships.md) | Cardinality, cascade/delete/ownership rules |
| 05 | [Storage Design](05_storage_design.md) | Supabase buckets: purpose, visibility, paths, limits, MIME, retention |
| 06 | [RLS Strategy](06_rls_strategy.md) | Tenant isolation, ownership, org/admin/support access, public resources |
| 07 | [Permissions Matrix](07_permissions_matrix.md) | Every role × every action |
| 08 | [API Contracts](08_api_contracts.md) | Every MVP endpoint: method, URL, auth, I/O, validation, errors |
| 09 | [Background Jobs](09_background_jobs.md) | Async jobs, retry, dead-letter, schedules |
| 10 | [Domain Events](10_events.md) | Event catalog, producers, consumers |
| 11 | [State Machines](11_state_machines.md) | Every workflow: states, transitions, failure, recovery |
| 12 | [Validation Rules](12_validation_rules.md) | Every business validation |
| 13 | [Integrations](13_integrations.md) | External systems: auth, limits, failure, retry, security |
| 14 | [Future Extensions](14_future_extensions.md) | MVP vs deferred, with rationale |

## Conventions used throughout

- **DB naming** follows [`database/naming-conventions.md`](../database/naming-conventions.md) (snake_case, plural tables, `uuid` PKs, `organization_id`/`branch_id` tenancy columns, `ix_`/`uq_`/`fk_` prefixes).
- **Tenancy:** the **organization** is the tenant; branch scoping where applicable. RLS is the isolation spine ([`security/rls-strategy.md`](../security/rls-strategy.md)).
- **Identity:** **one person = one user ID** — one canonical passwordless identity, never a second user per role, channel, or business (a business is an `Organization` reached through a `Membership`). Access is **derived** from primary account type + org membership + branch + permission capabilities + verification + subscription — never a role toggle.
- **Open items** are marked `⚑ OPEN` inline and collected in the final report.
