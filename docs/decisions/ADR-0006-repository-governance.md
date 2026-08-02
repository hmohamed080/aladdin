# ADR-0006 — Repository Governance

**Status:** Accepted · 2026-08-01

## Purpose

Fix the **repository governance model** — branching, merging, versioning, ownership, and release flow — so contributors (human and AI) stop re-deciding process per task, and so the repo is production-grade before feature implementation begins. This ADR records the *decision and rationale*; the *operational detail* lives in the development docs it references.

## Context

The repository is now the canonical Git remote (`https://github.com/hmohamed080/aladdin.git`) with full history. Foundation, architecture, design system, technical spec, and engineering standards are complete. Implementation (Phase 1) needs a stable, enforceable process.

## Current decision

### Branch strategy — trunk-based **GitHub flow**
- **`main`** is the single stable, always-releasable trunk. Work happens on short-lived branches cut from `main` and merged back via reviewed PR.
- No long-lived `develop`/`release` branches (avoids merge drift for a small team).

### Branch naming conventions
`<prefix>/<short-kebab-summary>` where `<prefix> ∈ feature · bugfix · hotfix · chore · docs · release` (optional `-#<issue>` suffix). **`feat/` is not a branch prefix** — it is a Conventional-Commit *message* type only. Full table: [`../development/git-workflow.md`](../development/git-workflow.md) §1. *(See the 2026-08-01 amendment below.)*

### Protected branches
- **`main` is protected:** no direct pushes; merge only via PR; requires ≥1 review + green CI (once CI is wired — [`../engineering/10_environment_and_cicd.md`](../engineering/10_environment_and_cicd.md)); linear-enough history preserved (no force-push, no history rewrite).
- Release **tags** are immutable.

### Merge strategy
- **`--no-ff` merge via reviewed PR only.** **Never squash, never rebase-rewrite published history, never force-push shared branches.** Full commit history is preserved. Detail: [`../development/git-workflow.md`](../development/git-workflow.md) §3.

### Pull Request policy
- Every change lands through a PR using [`../../.github/PULL_REQUEST_TEMPLATE.md`](../../.github/PULL_REQUEST_TEMPLATE.md); ≥1 approval; security/RLS changes get a security-focused review; validation green; Definition of Done met. Workflow + review checklist: [`../engineering/09_pull_request_and_review.md`](../engineering/09_pull_request_and_review.md).

### Semantic Versioning
- Repo/product version `vMAJOR.MINOR.PATCH[-label]` (MAJOR=breaking, MINOR=capability/phase, PATCH=fix/docs). The **Design System** (`DESIGN.md`) and **Technical Spec** are versioned **independently** and not renumbered by a repo release. Rules: [`../development/git-workflow.md`](../development/git-workflow.md) §5.

### Release workflow
- Releases cut from `main`, marked with an **annotated tag**, promoted Local → Staging → Production per [ADR-0004](ADR-0004-deployment-platforms.md). First release **`v0.1.0-foundation`** (repo version `0.1.0`; the Design System is versioned independently and stays `1.0.0`). Process + criteria: [`../development/release-strategy.md`](../development/release-strategy.md).

### Commit conventions
- `<type>: <what>` + `Why:` body; same `<type>` set as branches; small focused commits; no secrets; dependency additions justified in the body (root [`AGENTS.md`](../../AGENTS.md) Git discipline). Detail: [`../development/git-workflow.md`](../development/git-workflow.md) §2.

### Code ownership
- Ownership follows the **module boundaries** ([`../architecture/module-boundaries.md`](../architecture/module-boundaries.md)) and the `area:` labels ([`../development/github-workflow.md`](../development/github-workflow.md)). A `CODEOWNERS` file is **recommended, not yet created** (⚑ add when a team exists); until then, the maintainer reviews all PRs, with security/RLS and design-system changes requiring the relevant standard's checklist.

### Documentation ownership
- Each document carries an **Owner** in its metadata block ([documentation standard](../README.md#documentation-standard)). Canonical-memory files (`PRODUCT_DIRECTION_GUIDE`, `ARCHITECTURE_GUIDE`, `UI_UX_SYSTEM_GUIDE`, `RUNTIME_STATE`, `AGENT_WORK_LOG`) are governed by root [`AGENTS.md`](../../AGENTS.md); the **sync rule** requires updating the relevant memory + spec + ADR + runtime + work-log in the same change.

## Rationale

GitHub flow with a protected trunk and `--no-ff` PR merges gives a small team a simple, auditable history without the ceremony of Git-flow. Preserving history (no squash/rewrite) keeps the ADR/decision trail and the append-only work log intact — a core project value. Independent versioning of the design system and spec avoids coupling brand/spec cadence to product releases.

## Scope

All repository process. Does **not** change architecture, product direction, or the stack (ADR-0001…0005 stand).

## Consequences

- `main` gains branch protection; contributors branch + PR for every change.
- A `CODEOWNERS` file and CI branch-protection checks are follow-ups ([`../engineering/10_environment_and_cicd.md`](../engineering/10_environment_and_cicd.md)).
- Deviations from this governance require a superseding ADR.

## Amendments

- **2026-08-01 (Phase 0 Foundation Closeout):** the **branch naming convention** was reconciled to the canonical prefix set **`feature · bugfix · hotfix · chore · docs · release`**. The original draft listed commit-message types (`feat · fix · db · refactor · docs · chore · test · deploy`) as branch prefixes; **`feat/` is no longer a branch prefix** (it remains a Conventional-Commit message type). The recommended first implementation branch is therefore **`feature/identity-multitenancy`** (superseding earlier `feat/identity-multitenancy` references). Merge strategy, protection, and ownership are unchanged. **Version reconciliation:** the first repository/foundation release is **`v0.1.0-foundation`** (repo `0.1.0`, pre-MVP) — not `v0.7.0`; phase numbers (0.7/0.8/0.9) are delivery labels, not release versions, and the Design System stays independently at `1.0.0`. Recorded in [`DECISION_LOG.md`](DECISION_LOG.md).

## Related files

[`../development/git-workflow.md`](../development/git-workflow.md) · [`../development/github-workflow.md`](../development/github-workflow.md) · [`../development/release-strategy.md`](../development/release-strategy.md) · [`../engineering/09_pull_request_and_review.md`](../engineering/09_pull_request_and_review.md) · [`DECISION_LOG.md`](DECISION_LOG.md) · root [`AGENTS.md`](../../AGENTS.md)
