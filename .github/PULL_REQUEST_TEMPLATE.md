<!--
Aladdin PR template. Keep PRs small and focused (root AGENTS.md).
Workflow: docs/engineering/09_pull_request_and_review.md
-->

## What & why

<!-- What does this PR change, and why? Link the issue(s) it closes. -->

Closes #

## Type

- [ ] feat  [ ] fix  [ ] db  [ ] refactor  [ ] test  [ ] docs  [ ] chore  [ ] deploy

## Area

<!-- e.g. auth, organizations, catalog, sales, design-system, infra -->

## Checklist (Definition of Done — docs/engineering/07_feature_workflow.md)

- [ ] Scope matches an approved spec / technical doc; no scope creep
- [ ] `typecheck` · `lint` · `test` green (frontend and/or backend)
- [ ] New/changed DB tables ship a **migration + RLS policy + organization-isolation tests** (ADR-0002, docs/technical/06_rls_strategy.md)
- [ ] No secrets/`.env`/`.pen` committed; only `NEXT_PUBLIC_*` reach the client
- [ ] Validation is Zod-first; errors are typed and localizable (docs/technical/12_validation_rules.md)
- [ ] AR-RTL + EN-LTR and Light + Dark both handled (UI changes)
- [ ] Accessibility respected (WCAG 2.2 AA; design/GOVERNANCE.md) (UI changes)
- [ ] Consumes design-system **semantic tokens**; no invented values (UI changes)
- [ ] No cross-tenant leakage; identity derived from JWT, never the body
- [ ] Project memory updated where required (RUNTIME_STATE / AGENT_WORK_LOG / spec / ADR)
- [ ] Docs updated / cross-referenced; no duplication

## Validation evidence

<!-- Paste the commands run and their results (typecheck/lint/test/build, RLS isolation tests, etc.). -->

## Screenshots / notes (optional)
