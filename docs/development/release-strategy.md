# Release Strategy

| | |
|---|---|
| **Status** | Living document (canonical process) |
| **Version** | 1.0.0 |
| **Owner** | Foundation / Engineering |
| **Last Updated** | 2026-08-01 |
| **Depends On** | [`git-workflow.md`](git-workflow.md) |
| **Related** | [`github-workflow.md`](github-workflow.md), [`../operations/RUNTIME_STATE.md`](../operations/RUNTIME_STATE.md), [`../decisions/ADR-0004-deployment-platforms.md`](../decisions/ADR-0004-deployment-platforms.md) |

How Aladdin is versioned and released. Tagging/branch mechanics are in [`git-workflow.md`](git-workflow.md) §4–5.

## Versioning model

- **Repo/product** semantic version `vMAJOR.MINOR.PATCH[-label]`, cut from `main` with an annotated tag.
- Independent, non-coupled versions: **Design System** (`DESIGN.md`, `1.0.0`) and **Technical Spec** (`docs/technical`, `1.0.0`). A repo release references, but does not renumber, these.
- `0.x` = pre-production foundation/pilot phase; `1.0.0` = first production-ready pilot (⚑ criteria set with the product owner).

## Release process

1. Ensure `main` is green (validation matrix — [`../engineering/06_testing_strategy.md`](../engineering/06_testing_strategy.md)) and the milestone's Definition of Done is met.
2. Update [`RUNTIME_STATE.md`](../operations/RUNTIME_STATE.md) (Last Stable Commit/Tag, Deployment Status) and append an [`AGENT_WORK_LOG.md`](../operations/AGENT_WORK_LOG.md) entry.
3. Tag: `git tag -a vX.Y.Z-<label?> <commit> -m "<summary>"` → `git push origin vX.Y.Z-<label?>`.
4. (Later, when CI/CD exists) create a GitHub Release from the tag with generated notes; deploy per [`ADR-0004`](../decisions/ADR-0004-deployment-platforms.md) (Staging → Production).
5. Tags are immutable; a mistake is superseded by a new tag, never moved.

---

## First release — `v0.7.0-foundation`

### Purpose
Mark the **validated pre-implementation foundation**: the point at which architecture, design system, infrastructure, and the MVP technical blueprint are complete and verified, so feature implementation can begin against a stable, documented base.

### Scope
Foundation and documentation only — **no product features, tables, APIs, or UI screens**. Everything shipped is scaffold + decisions + specification.

### Contents
- **Architecture:** modular monolith scaffolded and validated (ADR-0001…0005); Next.js + Supabase + FastAPI + workers.
- **Design system:** "The Aperture" `v1.0.0` — `DESIGN.md`, canonical tokens (`design/tokens/*`), governance, component inventory, frontend token implementation.
- **Infrastructure (validated locally):** backend Docker image builds/runs (non-root, healthy `/health`); Supabase local stack starts / resets ×2 / lints; extensions migration applies; 0 product tables.
- **Technical spec:** the 15-document MVP blueprint (`docs/technical/*`).
- **Repository standards:** git/github/release workflow, `.github` community files, engineering standards (Phase 0.8).
- **Canonical project memory** synchronized (`PRODUCT_DIRECTION_GUIDE`, `ARCHITECTURE_GUIDE`, `UI_UX_SYSTEM_GUIDE`, `RUNTIME_STATE`, `AGENT_WORK_LOG`).

### Release criteria (all met at the foundation commit `7499ab1`)
- ✅ Frontend `typecheck` / `lint` / `test` / `build` green.
- ✅ Backend `uv sync` / `ruff` / `pytest` green; Docker image build + non-root + healthy `/health`.
- ✅ Supabase local stack + `db reset` ×2 + `db lint`; extensions verified; **0 product tables**.
- ✅ Design system finalized (`1.0.0`), AA-verified in both themes.
- ✅ Technical spec complete; internal doc links 0-broken.
- ✅ No secrets/`.pen` tracked; canonical `design.pen` private (gitignored).
- ✅ Repository published to GitHub with full history (no squash/force).

### Recommended tag command
```bash
git tag -a v0.7.0-foundation 7499ab1 -m "Foundation: architecture, design system, infra, and MVP technical blueprint"
git push origin v0.7.0-foundation
```
> Documented, **not executed** here — a maintainer applies the tag (this task creates no GitHub resources beyond the branch pushes already made).

### Next release
`v0.8.0-engineering-standards` (this phase's engineering reference), then Phase-1 feature releases per the roadmap milestones ([`github-workflow.md`](github-workflow.md)).
