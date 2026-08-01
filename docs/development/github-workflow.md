# GitHub Workflow — Labels, Milestones, Project Board

| | |
|---|---|
| **Status** | Living document (recommended configuration) |
| **Version** | 1.0.0 |
| **Owner** | Foundation / Engineering |
| **Last Updated** | 2026-08-01 |
| **Depends On** | [`git-workflow.md`](git-workflow.md), [`release-strategy.md`](release-strategy.md) |
| **Related** | [`../product/mvp-scope.md`](../product/mvp-scope.md), [`../technical/README.md`](../technical/README.md) |

Recommended GitHub project-management configuration. **These are documented, not auto-created** — a maintainer applies them in the GitHub UI/API. Repo: `https://github.com/hmohamed080/aladdin`.

## 1. Labels

### Type
| Label | Color | Meaning |
|---|---|---|
| `type: feature` | blue | new capability |
| `type: bug` | red | defect |
| `type: task` | grey | engineering task/chore |
| `type: docs` | teal | documentation |
| `type: refactor` | purple | non-behavioral change |
| `type: test` | green | tests |
| `type: db` | brown | migration/schema |

### Area (mirrors the feature modules — [`../architecture/module-boundaries.md`](../architecture/module-boundaries.md))
`area: auth` · `area: accounts` · `area: organizations` · `area: verification` · `area: catalog` · `area: inventory` · `area: sales` · `area: rfq` · `area: quotations` · `area: projects` · `area: notifications` · `area: advertisements` · `area: analytics` · `area: admin` · `area: ai` · `area: design-system` · `area: infra`

### Priority
`priority: P0` (blocker) · `priority: P1` (high) · `priority: P2` (normal) · `priority: P3` (low)

### Status / workflow
`status: needs-triage` · `status: blocked` · `status: in-progress` · `status: needs-review` · `status: ready-to-merge`

### Cross-cutting flags
`security` · `rls` · `accessibility` · `rtl` · `i18n` · `performance` · `good-first-issue` · `needs-product-decision` (maps to the `⚑ OPEN` items in the technical spec)

## 2. Milestones

Mirror the design/implementation roadmap ([`../product/PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md), [`../product/mvp-scope.md`](../product/mvp-scope.md)):

| Milestone | Covers |
|---|---|
| **v0.7.0 — Foundation** | Architecture, design system, infra validation, technical spec (**done**; see [`release-strategy.md`](release-strategy.md)) |
| **v0.8.0 — Engineering Standards** | This phase — engineering reference for implementation |
| **Phase 1 — Identity & Multi-tenancy** | canonical identity, orgs/branches/memberships/capabilities, RLS helpers + isolation tests |
| **05C — B2B Sales Workflow** | the wedge (Opportunity→Quote→Pipeline→Task) |
| **05A — Core B2C Value Journey** | AI consult → discovery → matching → RFQ |
| **05B — Quote & Project Journey** | RFQ → quotes → decision → project |
| **05D — Supplier/Product Ops** | catalog/availability/requests/quotes/campaigns |
| **05E — Cockpit & Admin** | dashboards last |

Do not start a milestone before its prerequisites (roadmap order is authoritative).

## 3. Project board

A single GitHub **Project (v2)** board, "Aladdin Delivery":

**Columns:** `Backlog` → `Triaged` → `Ready` → `In Progress` → `In Review` → `Blocked` → `Done`.

**Recommended views:**
- **By milestone** (roadmap progress).
- **By area** (module load).
- **By priority** (P0/P1 first).
- **Needs product decision** (filter `needs-product-decision` — the spec's `⚑ OPEN` items awaiting sign-off).

**Automation (recommended):** issue opened → `Backlog`; PR opened & linked → `In Review`; PR merged / issue closed → `Done`; `status: blocked` label → `Blocked`.

## 4. Conventions

- Every issue gets exactly one `type:`, one `priority:`, and one or more `area:` labels at triage.
- Feature issues link to the relevant technical-spec section(s) ([`../technical/README.md`](../technical/README.md)) and their milestone.
- `needs-product-decision` issues capture the spec `⚑ OPEN` items and block dependent work until resolved.
- PRs link the issue(s) they close; see [`../engineering/09_pull_request_and_review.md`](../engineering/09_pull_request_and_review.md).
