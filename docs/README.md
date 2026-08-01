# Aladdin Documentation

| | |
|---|---|
| **Status** | Living document — canonical documentation index |
| **Version** | 1.0.0 |
| **Owner** | Foundation / Documentation |
| **Last Updated** | 2026-08-01 |
| **Depends On** | Root [`AGENTS.md`](../AGENTS.md) |
| **Related** | [`technical/README.md`](technical/README.md), [`../design/README.md`](../design/README.md) |

The documentation map for the Aladdin repository — the single place to discover every document. All links are relative.

## Documentation standard

Every **major document** carries a metadata block near its title with: **Status · Version · Owner · Last Updated · Depends On · Related**. Conventions by family:

- **Canonical memory** (`PRODUCT_DIRECTION_GUIDE`, `ARCHITECTURE_GUIDE`, `UI_UX_SYSTEM_GUIDE`, `RUNTIME_STATE`, `AGENT_WORK_LOG`) — a metadata table + `Update triggers`; these are always kept in sync when architecture/product/design changes.
- **Technical spec** (`docs/technical/*`) — the full 6-field block; versioned `1.0.0` (Phase 0.7).
- **Design system** (`DESIGN.md`, `design/*`) — semantic-versioned block (Version/Status/Owner-or-Maintainer/Last Updated); authority chain in [`../design/GOVERNANCE.md`](../design/GOVERNANCE.md).
- **ADRs** (`docs/decisions/ADR-*`) — the ADR convention (`Status` + date); immutable/append-only.

**Sync rule:** an architecture/product/design change updates, in the same change, the relevant canonical-memory file(s), the affected technical doc(s), the relevant ADR (when architectural), `RUNTIME_STATE.md`, and `AGENT_WORK_LOG.md`. See root [`AGENTS.md`](../AGENTS.md) "Persistent project memory".

## Start here

Read these in order before making any change (this mirrors the reading order in the root [`AGENTS.md`](../AGENTS.md)):

1. [`product/PRODUCT_DIRECTION_GUIDE.md`](product/PRODUCT_DIRECTION_GUIDE.md) — product direction & guardrails
2. [`architecture/ARCHITECTURE_GUIDE.md`](architecture/ARCHITECTURE_GUIDE.md) — currently active architecture
3. [`../UI-UX/UI_UX_SYSTEM_GUIDE.md`](../UI-UX/UI_UX_SYSTEM_GUIDE.md) — design system, tokens, UX rules
4. [`operations/AGENT_WORK_LOG.md`](operations/AGENT_WORK_LOG.md) — append-only session log & unfinished work
5. [`operations/RUNTIME_STATE.md`](operations/RUNTIME_STATE.md) — current live repository state
6. Root [`AGENTS.md`](../AGENTS.md) — universal coding rules & reading order

## Core project memory

The five files above are **persistent project memory and part of the core architecture** — not optional docs. Their authority rules live in the root [`AGENTS.md`](../AGENTS.md) ("Persistent project memory") and the end-of-session checklist in [`AGENTS.md`](AGENTS.md) (docs scope).

## Product

- [`product/PRODUCT_DIRECTION_GUIDE.md`](product/PRODUCT_DIRECTION_GUIDE.md) — **canonical** product direction
- [`product/mvp-scope.md`](product/mvp-scope.md) — MVP scope & ordering (authoritative for sequencing)
- [`product/client-brief.md`](product/client-brief.md) — client brief
- [`product/design-idea.md`](product/design-idea.md) — original founder brief (Arabic)

## Architecture

- [`architecture/ARCHITECTURE_GUIDE.md`](architecture/ARCHITECTURE_GUIDE.md) — **canonical** current-state architecture
- [`architecture/overview.md`](architecture/overview.md)
- [`architecture/system-context.md`](architecture/system-context.md)
- [`architecture/module-boundaries.md`](architecture/module-boundaries.md)
- [`architecture/data-flow.md`](architecture/data-flow.md)
- [`architecture/realtime-and-background-jobs.md`](architecture/realtime-and-background-jobs.md)
- [`architecture/scaling-strategy.md`](architecture/scaling-strategy.md)

## Decisions (ADRs)

- [`decisions/ADR-0001-approved-architecture.md`](decisions/ADR-0001-approved-architecture.md)
- [`decisions/ADR-0002-database-migrations.md`](decisions/ADR-0002-database-migrations.md)
- [`decisions/ADR-0003-agent-instruction-hierarchy.md`](decisions/ADR-0003-agent-instruction-hierarchy.md)
- [`decisions/ADR-0004-deployment-platforms.md`](decisions/ADR-0004-deployment-platforms.md)
- [`decisions/ADR-0005-python-data-access.md`](decisions/ADR-0005-python-data-access.md)
- [`decisions/agent-instruction-migration.md`](decisions/agent-instruction-migration.md) — source→destination map

## Security

- [`security/security-model.md`](security/security-model.md)
- [`security/secrets-and-environments.md`](security/secrets-and-environments.md)
- [`security/rls-strategy.md`](security/rls-strategy.md)

## Database

- [`database/migration-strategy.md`](database/migration-strategy.md)
- [`database/naming-conventions.md`](database/naming-conventions.md)

## Operations

- [`operations/AGENT_WORK_LOG.md`](operations/AGENT_WORK_LOG.md) — **canonical** append-only session log
- [`operations/RUNTIME_STATE.md`](operations/RUNTIME_STATE.md) — **canonical** live-state snapshot
- [`operations/deployment-overview.md`](operations/deployment-overview.md)
- [`operations/monitoring-and-observability.md`](operations/monitoring-and-observability.md)

## Guides

- [`guides/frontend-setup.md`](guides/frontend-setup.md)
- [`guides/backend-setup.md`](guides/backend-setup.md)
- [`guides/supabase-setup.md`](guides/supabase-setup.md)

## UI/UX

- [`../UI-UX/UI_UX_SYSTEM_GUIDE.md`](../UI-UX/UI_UX_SYSTEM_GUIDE.md) — **canonical** design system & UX rules
- [`../UI-UX/AGENTS.md`](../UI-UX/AGENTS.md) — operational `.pen` handling rules

## Design System ("The Aperture", v1.0.0)

- [`../DESIGN.md`](../DESIGN.md) — **normative** brand & visual-design language (token frontmatter + rules)
- [`../design/README.md`](../design/README.md) — design-system index
- [`../design/tokens/`](../design/tokens/) — **canonical** machine-readable tokens
- [`../design/GOVERNANCE.md`](../design/GOVERNANCE.md) — source-of-truth, versioning, component & AI-agent rules
- [`../design/COMPONENT_INVENTORY.md`](../design/COMPONENT_INVENTORY.md) · [`../design/icons/README.md`](../design/icons/README.md) · [`../design/CHANGELOG.md`](../design/CHANGELOG.md)

## Engineering standards (Phase 0.8)

The engineering reference every implementation task and AI agent follows. Index: [`engineering/README.md`](engineering/README.md).

- Structure/layers/DI · coding/naming · API + shared response/error models · error/logging/observability · validation · testing · feature workflow (DoD/checklist) · migration workflow · PR/review · env + CI/CD · performance + security · AI-agent rules.

## Development & repository standards

- [`development/git-workflow.md`](development/git-workflow.md) — branch/commit/merge/release/tagging conventions
- [`development/github-workflow.md`](development/github-workflow.md) — recommended labels, milestones, project board
- [`development/release-strategy.md`](development/release-strategy.md) — release process + the `v0.7.0-foundation` release
- GitHub community files: [`../.github/PULL_REQUEST_TEMPLATE.md`](../.github/PULL_REQUEST_TEMPLATE.md), [`../.github/ISSUE_TEMPLATE/`](../.github/ISSUE_TEMPLATE/)

## Technical Specification (Phase 0.7 — MVP blueprint)

The engineering blueprint every implementation task follows. **Specification only** (no code/migrations/APIs). See [`technical/README.md`](technical/README.md) for the index.

- [`technical/01_system_overview.md`](technical/01_system_overview.md) · [`02_domain_model.md`](technical/02_domain_model.md) · [`03_database_design.md`](technical/03_database_design.md) · [`04_relationships.md`](technical/04_relationships.md)
- [`05_storage_design.md`](technical/05_storage_design.md) · [`06_rls_strategy.md`](technical/06_rls_strategy.md) · [`07_permissions_matrix.md`](technical/07_permissions_matrix.md) · [`08_api_contracts.md`](technical/08_api_contracts.md)
- [`09_background_jobs.md`](technical/09_background_jobs.md) · [`10_events.md`](technical/10_events.md) · [`11_state_machines.md`](technical/11_state_machines.md) · [`12_validation_rules.md`](technical/12_validation_rules.md)
- [`13_integrations.md`](technical/13_integrations.md) · [`14_future_extensions.md`](technical/14_future_extensions.md)

## Historical / source material

- [`../agents/README.md`](../agents/README.md) — reusable agent personas (non-authoritative source material)
- `../UI-UX/design.pen` — canonical Pencil design file (gitignored, private; never opened by coding tasks)
