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

| Type | Use | Example |
|---|---|---|
| `feat` | a product feature / capability | `feat/identity-multitenancy` |
| `fix` | a bug fix | `fix/otp-rate-limit` |
| `db` | migrations / schema | `db/organizations-rls` |
| `refactor` | non-behavioral restructuring | `refactor/sales-queries` |
| `docs` | documentation only | `docs/technical-finalization` |
| `chore` | tooling / repo maintenance | `chore/repository-architecture-foundation` |
| `test` | tests only | `test/rls-isolation` |
| `deploy` | deployment/config | `deploy/railway-worker` |

Optionally suffix a tracking id: `feat/identity-multitenancy-#42`.

## 2. Commits

Follow the root [`AGENTS.md`](../../AGENTS.md) format exactly:

```
<type>: <what changed — short, specific, imperative>

Why: <the reason or intent behind this change>
```

- **Types:** `feat · fix · db · deploy · test · refactor · style · docs · chore` (same set as branches).
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
- **Planned first tag:** `v0.7.0-foundation` at the validated foundation commit (`7499ab1`) — see [`release-strategy.md`](release-strategy.md).

## 6. Do / Don't

- **Do** branch from `main`, keep branches short-lived, open a PR, keep validation green, and update project memory in the same change.
- **Don't** commit to `main` directly, squash/force-push shared history, commit secrets/`.env`/`.pen` (gitignored), or merge with failing checks or an unmet Definition of Done.
