# Git Workflow & Repository Standards

| | |
|---|---|
| **Status** | Living document (canonical process) |
| **Version** | 1.0.0 |
| **Owner** | Foundation / Engineering |
| **Last Updated** | 2026-08-01 |
| **Depends On** | Root [`AGENTS.md`](../../AGENTS.md) (Git discipline) |
| **Related** | [`github-workflow.md`](github-workflow.md), [`release-strategy.md`](release-strategy.md), [`../engineering/09_pull_request_and_review.md`](../engineering/09_pull_request_and_review.md) |

The canonical Git workflow for the Aladdin repository. Extends — never contradicts — the **Git discipline** section of the root [`AGENTS.md`](../../AGENTS.md).

## 1. Branches

- **`main`** — the stable, release-ready trunk. Protected; never committed to directly. Only fast-forwarded via reviewed merges.
- **Working branches** are short-lived and branch **from `main`** (or the latest integration branch when explicitly directed).

### Branch naming convention

`<type>/<short-kebab-summary>` — lowercase, hyphenated, no spaces.

**Canonical branch prefixes** (use exactly these — **not** `feat/`):

| Prefix | Use | Example |
|---|---|---|
| `feature/` | a product feature / capability (incl. its migrations, tests, UI) | `feature/identity-multitenancy` |
| `bugfix/` | a bug fix | `bugfix/otp-rate-limit` |
| `hotfix/` | an urgent production fix off the latest release | `hotfix/quote-total-rounding` |
| `chore/` | tooling, deps, infra, refactor, or stand-alone migrations/tests | `chore/foundation-closeout` |
| `docs/` | documentation only | `docs/technical-finalization` |
| `release/` | release preparation | `release/v0.1.0` |

Optionally suffix a tracking id: `feature/identity-multitenancy-#42`.

> **Branch prefix vs. commit type:** the six prefixes above name *branches*. The Conventional-Commit *message* types (`feat · fix · db · …`, §2) are a **separate** vocabulary used in commit subjects. Do not use a commit type (`feat/`) as a branch prefix.

## 2. Commits

Follow the root [`AGENTS.md`](../../AGENTS.md) format exactly:

```
<type>: <what changed — short, specific, imperative>

Why: <the reason or intent behind this change>
```

- **Commit-message types** (Conventional Commits, per root `AGENTS.md`): `feat · fix · db · deploy · test · refactor · style · docs · chore`. These are **commit subject** types, **distinct from the branch prefixes** in §1 (e.g. a `feat:` commit lands on a `feature/…` branch).
- Small, focused commits; never batch unrelated changes. Never commit broken code (use a `wip:` prefix + note only if genuinely incomplete).
- Never commit with just `fix`/`update`/`changes`.
- Add a runtime dependency only with the dependency-policy justification in the commit body (root `AGENTS.md`).
- **Do not** skip hooks or bypass signing unless explicitly asked.

## 3. Merge strategy

- **Merge via reviewed Pull Request only** ([`../engineering/09_pull_request_and_review.md`](../engineering/09_pull_request_and_review.md)). No direct pushes to `main`.
- **Preserve history — never squash, never rebase-rewrite a pushed branch, never force-push shared branches.** (`--no-ff` merge keeps the branch topology and the full commit history.)
- Recommended merge command (local, no remote automation):
  ```bash
  git checkout main && git merge --no-ff <branch>
  ```
- A branch merges only when its **Definition of Done** ([`../engineering/07_feature_workflow.md`](../engineering/07_feature_workflow.md)) is met and validation (typecheck/lint/test + RLS/isolation tests where applicable) is green.
- Rebasing a **local, unpushed** branch onto fresh `main` to keep it current is allowed; rewriting **published** history is not.

## 4. Release strategy (summary)

- Releases are cut from **`main`** and marked with an **annotated tag** (§5). The first release is documented in [`release-strategy.md`](release-strategy.md).
- Semantic versioning at the **repository/product** level: `MAJOR.MINOR.PATCH` (see §5). This is distinct from the independently-versioned **Design System** (`DESIGN.md`, currently `1.0.0`) and the **Technical Spec** (`1.0.0`).
- Pre-`1.0.0` (`0.x`) marks the pre-production foundation/pilot phase; `MINOR` may include larger changes while `0.x`.

## 5. Version tagging strategy

- **Annotated tags** only: `git tag -a vX.Y.Z-<label?> <commit> -m "<summary>"`, then `git push origin vX.Y.Z-<label?>`.
- **Format:** `v<MAJOR>.<MINOR>.<PATCH>[-<label>]`. A `-<label>` marks a milestone flavor (e.g. `-foundation`, `-pilot`, `-rc.1`).
- **Bump rules (repo/product):** `MAJOR` = breaking product/contract change · `MINOR` = new capability/phase · `PATCH` = fixes/docs.
- Tags are immutable — never move or delete a published tag; supersede with a new one.
- **Planned first tag:** `v0.1.0-foundation` (repo version `0.1.0`), created on **merged `main`** after the foundation-closeout PR — see [`release-strategy.md`](release-strategy.md). (The Design System is versioned independently and stays `1.0.0`.)

## 6. Do / Don't

- **Do** branch from `main`, keep branches short-lived, open a PR, keep validation green, and update project memory in the same change.
- **Don't** commit to `main` directly, squash/force-push shared history, commit secrets/`.env`/`.pen` (gitignored), or merge with failing checks or an unmet Definition of Done.
