# 09 — Pull Request Workflow & Code Review Checklist

| | |
|---|---|
| **Status** | Living document (canonical engineering reference) |
| **Version** | 1.0.0 |
| **Owner** | Engineering |
| **Last Updated** | 2026-08-01 |
| **Depends On** | [`../development/git-workflow.md`](../development/git-workflow.md), [`../../.github/PULL_REQUEST_TEMPLATE.md`](../../.github/PULL_REQUEST_TEMPLATE.md) |
| **Related** | [`07_feature_workflow.md`](07_feature_workflow.md), [`11_performance_and_security.md`](11_performance_and_security.md) |

Covers **Pull Request Workflow (12)** and **Code Review Checklist (13)**.

## 1. Pull-request workflow

1. **Branch** from `main` (naming per [`git-workflow`](../development/git-workflow.md)); keep the PR **small and focused** (one feature/fix).
2. **Open a PR** against `main` using [`.github/PULL_REQUEST_TEMPLATE.md`](../../.github/PULL_REQUEST_TEMPLATE.md); link the issue(s) it closes; apply `type:`/`area:`/`priority:` labels.
3. **Self-review** against the checklist below and the [Definition of Done](07_feature_workflow.md#3-definition-of-done); paste **validation evidence** (commands + results).
4. **CI/validation green** (typecheck/lint/test + isolation tests for DB changes — [`10_environment_and_cicd`](10_environment_and_cicd.md)).
5. **Review:** at least one reviewer approves; security/RLS changes get a security-focused review. `code-review` tooling may assist but does not replace the human gate.
6. **Address feedback** with additional commits (do not force-push shared history).
7. **Merge** with `--no-ff` once approved + green + Done; **no squash, no rewrite**. Delete the merged branch.
8. **Post-merge:** confirm `main` still green; project board → Done.

**Never:** commit to `main` directly, merge with failing checks or an unmet Definition of Done, squash/force-push shared history, or bypass review for a "small" change that touches auth/RLS/secrets.

## 2. Code review checklist

### Correctness & scope
- [ ] Matches an approved spec/roadmap item; no scope creep or invented product decisions
- [ ] Implements the spec contract (domain/DB/API/state/validation)
- [ ] Edge/empty/error/loading states handled

### Security & tenancy (highest priority)
- [ ] New tenant tables have **RLS + organization-isolation tests**
- [ ] Identity derived from the **JWT**, never request body; capability checked
- [ ] No cross-tenant leakage (queries, storage, AI retrieval filtered before return)
- [ ] No secrets/`service_role`/`.env`/`.pen` in client-reachable code or the diff
- [ ] Errors don't leak stack/SQL/schema/provider internals

### Architecture & standards
- [ ] Respects module boundaries (no cross-feature internal imports)
- [ ] Server-Action-first; heavy/AI work enqueued; AI human-reviewed
- [ ] Shared `Result`/`ApiError`; Zod-first validation
- [ ] No new dependency without the dependency-policy justification (commit body)
- [ ] Naming/coding standards ([`02_coding_standards`](02_coding_standards.md)); no prohibited names

### UX, a11y, i18n (UI)
- [ ] Design-system **semantic tokens** only; no raw values
- [ ] AR-RTL + EN-LTR and Light + Dark both correct
- [ ] WCAG 2.2 AA (focus, keyboard, contrast, non-color status); no technical copy in UI

### Data
- [ ] Migration follows [`08_database_migration_workflow`](08_database_migration_workflow.md); explicit `on delete`; intentional indexes; `db reset` ×2 clean

### Tests & docs
- [ ] Required-path tests green; no placeholder tests
- [ ] Spec/`RUNTIME_STATE`/`AGENT_WORK_LOG`/design inventory synced
- [ ] No duplicated docs; links resolve

## 3. Reviewer etiquette

Be specific and kind; name the problem + a suggested fix; block only on correctness/security/standards, not taste. Approvals mean "I'd ship this" — the reviewer shares responsibility for what merges.
