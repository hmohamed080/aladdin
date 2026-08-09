# Sprint 10 — Orders → Projects → Completion

Completes the B2B execution workflow past the Sprint 9 boundary:

```
accepted quotation → ORDER (immutable snapshot) → start order
→ PROJECT (execution) → activate → complete → PROJECT COMPLETED
```

No invoice / payment / accounting is created (explicitly out of scope).

## Scope

Delivers the execution half of the value chain (`… → Decision → Execution → Follow-up`).
Reuses — without change — the hardened tenancy, capability, RLS, audit, optimistic-
concurrency, i18n, and client-ready UI patterns established by the Sales (ADR-0008)
and Commerce (Sprint 9) domains.

## Data model (`supabase/migrations/20260811090001_orders_projects.sql`)

| Table | Purpose |
|-------|---------|
| `orders` | Committed deal — an **immutable** commercial snapshot of an accepted quotation (parties, branch, totals, `order_items`). One order per accepted quotation (`uq_orders_quotation`). |
| `order_items` | Frozen priced lines copied from the quotation. No edit/add/remove RPC — immutable by construction. `line_total` generated. |
| `projects` | Execution record for an order. Exactly one per order (`uq_projects_order`). Minimal by design — no task/Gantt system. |

Read models (`security_invoker` views, RLS-scoped): `order_list`, `project_list`.

### Enums / lifecycles (smallest useful)

- `order_status`: `confirmed → in_progress → completed`, plus `confirmed → cancelled`.
- `project_status`: `planned → active → completed`.

### Actor model (both parties participate, each scoped to its side)

- **Requester (buyer)** creates the order from the quotation they accepted (`order.create`).
- **Supplier (executing org)** starts the order (`order.manage`), then creates / activates /
  completes the project (`project.write`, pre-existing capability).
- **Either party** may cancel a still-`confirmed` order (`order.manage`).
- **Completing the project completes its parent order** in the same transaction —
  execution is delivered *through* the project, so that is where an order ends.

New capabilities: `order.create`, `order.manage` (appended to the capability catalog).
`project.read` / `project.write` already existed.

## Security (reused architecture, ADR-0008)

Base tables are `SELECT`-only for client/service roles; **every** mutation is a
`security-definer` RPC that:

- derives the actor from `auth.uid()` (never a client-supplied id),
- checks organization membership + capability + branch scope,
- enforces the lifecycle guard and `version` optimistic concurrency,
- emits an audit event in the **same** transaction.

No direct write grant exists, so nothing can bypass lifecycle / tenant / audit
invariants. Order snapshot immutability is enforced by the **absence** of any write
path to the commercial columns, not by triggers.

RPCs: `create_order_from_quotation`, `start_order`, `cancel_order`,
`create_project_from_order`, `activate_project`, `complete_project`.

## Proven (pgTAP `supabase/tests/24_orders_projects_test.sql`, 30 assertions)

Full journey (accepted quotation → order → start → project → activate → complete →
`PROJECT COMPLETED` + parent order completed) plus:

- RPC-only write boundary (direct DML denied on `orders` / `projects`).
- Invalid quotation cannot create an order (non-accepted → error).
- **Duplicate order denied**, **duplicate project denied** (the "exactly one" invariants).
- Cross-tenant denial: an intruder cannot create or read either entity; the
  counter-party (requester) can see the project.
- Lifecycle gates: project cannot be created before the order is started; requester
  cannot start the order or create the project (supplier-only actions).
- Order cancellation (`confirmed → cancelled`) and its guards.
- Audit emission for all six lifecycle events.

Test 23 (Sprint 9 boundary) was updated: it now asserts accepting a quotation still
does **not** auto-create an order (the order is a separate, explicit action).

## Frontend

- Routes: `/b2b/orders`, `/b2b/orders/[orderId]`, `/b2b/projects`, `/b2b/projects/[projectId]`.
- Navigation: **Orders** and **Projects** added to the workspace rail + mobile bar.
- Server layer: `server/queries/execution.ts`, `server/actions/execution.ts`
  (typed RPC wrappers), `server/actions/execution-forms.ts` (Server Actions),
  `mapExecutionError` (SQLSTATE/fragment → i18n key).
- UI (`features/execution/`): status badges, order/project lists, order detail
  (commercial snapshot table, execution timeline, start/cancel, inline create-project
  form), project detail (overview, activity trail from audited lifecycle timestamps,
  activate/complete, `PROJECT COMPLETED` banner).
- The accepted-quotation view now shows a **Create order** CTA (requester) or a
  **View order** link once the order exists — the live handoff from Commerce.
- Full EN/LTR + AR/RTL, status badges, commercial-total hierarchy, responsive layouts,
  empty/loading/error states, no horizontal overflow.

## Validation

- `pnpm typecheck`, `pnpm lint` (0 errors), `pnpm test` (157 unit incl. new
  `execution.test.ts`), `pnpm build` — all green.
- `supabase db reset` + `supabase test db` — 25 files / 579 tests pass (incl. new #24).
- `supabase db lint` — no findings in any Sprint 10 object.
- Targeted E2E (`e2e/orders-projects.spec.ts`) — pages render, nav wiring, bilingual
  empty states, no horizontal overflow, graceful not-found. The full two-tenant
  workflow is proven in pgTAP (the demo seed is single-org), matching the Sprint 9
  convention.

## Out of scope (not implemented)

Payments, invoices, accounting, refunds, warehouses, delivery integrations, advanced
scheduling, tasks/Gantt, contracts, new media infrastructure, Admin UI, persona seed
expansion, unrelated CRM changes.
