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

- **Repo/product** semantic version `vMAJOR.MINOR.PATCH[-label]`, cut from `main` with an annotated tag. The **first repository/foundation release is `0.1.0`** (tag `v0.1.0-foundation`).
- **Phase numbers ≠ release versions.** "Phase 0.7 / 0.8 / 0.9" are *delivery-phase* labels ([`../roadmap/ROADMAP.md`](../roadmap/ROADMAP.md)); they do **not** imply releases `v0.7.0`/`v0.8.0`. The whole pre-implementation foundation (Phases 0 → 0.9) is a **single** release, `v0.1.0`.
- Independent, non-coupled versions: **Design System** (`DESIGN.md`, `1.0.0`) and **Technical Spec** (`docs/technical`, `1.0.0`). A repo release references, but does not renumber, these — the Design System stays `1.0.0` even though the product is pre-MVP at `v0.1.0`.
- `0.x` = pre-production foundation/pilot phase; `1.0.0` (repo) = first production-ready pilot (⚑ criteria set with the product owner).

## Release process

1. Ensure `main` is green (validation matrix — [`../engineering/06_testing_strategy.md`](../engineering/06_testing_strategy.md)) and the milestone's Definition of Done is met.
2. Update [`RUNTIME_STATE.md`](../operations/RUNTIME_STATE.md) (Last Stable Commit/Tag, Deployment Status) and append an [`AGENT_WORK_LOG.md`](../operations/AGENT_WORK_LOG.md) entry.
3. Tag: `git tag -a vX.Y.Z-<label?> <commit> -m "<summary>"` → `git push origin vX.Y.Z-<label?>`.
4. (Later, when CI/CD exists) create a GitHub Release from the tag with generated notes; deploy per [`ADR-0004`](../decisions/ADR-0004-deployment-platforms.md) (Staging → Production).
5. Tags are immutable; a mistake is superseded by a new tag, never moved.

---

## First release — `v0.1.0-foundation`

### What the tag represents
The **validated, pre-implementation foundation** — everything through Phase 0.9: architecture (ADRs), the finalized design system, validated infrastructure, the MVP technical blueprint, engineering standards, and repository governance. It is the stable, documented base that Phase-1 feature implementation begins from. It is the **first repository release**, version **`0.1.0`**.

### Why it is pre-MVP (`0.x`)
No product feature, table, API, or UI screen exists yet — the release is scaffold + decisions + specification only. Per SemVer, a pre-production product sits in `0.x`; `0.1.0` marks "foundation complete, implementation not started". The repo reaches `1.0.0` only at the first production-ready pilot (criteria ⚑ set with the product owner).

### Why the Design System can independently stay at `1.0.0`
The **Design System is versioned independently** of the repo/product (see [Versioning model](#versioning-model)). "The Aperture" is a **finalized, approved, complete** system (tokens, governance, implementation) — its `1.0.0` reflects *its* maturity, not the product's. A pre-MVP product at `v0.1.0` **does not downgrade** a finished design system to `0.x`; the two versions are decoupled by design.

### Scope & contents
Foundation and documentation only — modular-monolith scaffold (ADR-0001…0006); design system "The Aperture" `1.0.0`; locally-validated infra (backend Docker non-root + healthy `/health`; Supabase local stack + `db reset`×2 + `db lint`; extensions migration; **0 product tables**); the 15-doc technical blueprint; engineering standards; git/github/release governance + `.github` files (PR/issue templates, CODEOWNERS, CI); synchronized canonical project memory.

### Release criteria (met on merged `main`)
- ✅ Frontend `typecheck`/`lint`/`test`/`build` and Backend `ruff`/`pytest` green; backend Docker image builds (non-root, healthy `/health`).
- ✅ Supabase local stack + `db reset`×2 + `db lint`; extensions verified; **0 product tables**.
- ✅ Design system finalized (`1.0.0`), AA-verified both themes; technical spec complete; internal doc links 0-broken.
- ✅ No secrets/`.pen`/dependency dirs tracked; canonical `design.pen` private (gitignored).
- ✅ Repository on GitHub with full history (no squash/force); `main` protected; PR CI workflow present.

### Tag command — **created only AFTER this closeout PR is merged into `main`**
Run on the **merged `main`** (not the feature branch), so the tag captures the complete foundation:
```bash
git checkout main && git pull --ff-only
git tag -a v0.1.0-foundation -m "Foundation (v0.1.0): architecture, design system, infra, technical blueprint, engineering standards, governance"
git push origin v0.1.0-foundation
```
> **Documented, not executed here.** This task creates no tag — the tag must not be created from a feature branch, and only after the closeout PR merges. A maintainer runs the above on merged `main`.

### Next release
After Phase 1 (Identity & Multi-tenancy) ships, cut **`v0.2.0`** (first implementation increment); subsequent minor releases per the [roadmap phases](../roadmap/ROADMAP.md) / [milestones](github-workflow.md).
