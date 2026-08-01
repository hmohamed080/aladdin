# 07 — Feature Development Workflow, Checklist & Definition of Done

| | |
|---|---|
| **Status** | Living document (canonical engineering reference) |
| **Version** | 1.0.0 |
| **Owner** | Engineering |
| **Last Updated** | 2026-08-01 |
| **Depends On** | [`../development/git-workflow.md`](../development/git-workflow.md), [`../technical/README.md`](../technical/README.md) |
| **Related** | [`08_database_migration_workflow.md`](08_database_migration_workflow.md), [`09_pull_request_and_review.md`](09_pull_request_and_review.md), [`06_testing_strategy.md`](06_testing_strategy.md) |

Covers **Feature Development Workflow (10)**, **Feature Checklist (15)**, **Definition of Done (14)**.

## 1. Feature development workflow

1. **Confirm scope & authority.** The feature exists in [`mvp-scope.md`](../product/mvp-scope.md)/roadmap and has a technical-spec home ([`../technical/`](../technical/)). Resolve any `⚑ OPEN` product decision first (label `needs-product-decision`) — do not invent it.
2. **Branch** from `main`: `feat/<summary>` ([`git-workflow`](../development/git-workflow.md)).
3. **Read the spec slice:** domain ([`02`](../technical/02_domain_model.md)), DB ([`03`](../technical/03_database_design.md)), RLS ([`06`](../technical/06_rls_strategy.md)), permissions ([`07`](../technical/07_permissions_matrix.md)), API ([`08`](../technical/08_api_contracts.md)), validation ([`12`](../technical/12_validation_rules.md)), state ([`11`](../technical/11_state_machines.md)), events ([`10`](../technical/10_events.md)).
4. **Database first (if new data):** write the migration + RLS policies + **organization-isolation tests** ([`08_database_migration_workflow.md`](08_database_migration_workflow.md)); `db reset` green.
5. **Schemas:** Zod (+ Pydantic if FastAPI) from the validation rules.
6. **Server layer:** queries (RSC reads) + Server Actions (mutations: validate → authorize → mutate → emit event) using the shared `Result`/`ApiError` ([`03_api_standards`](03_api_standards.md)).
7. **UI:** components consuming design-system **semantic tokens**; AR-RTL + EN-LTR, Light + Dark, all required states (default/hover/focus/loading/disabled/error/empty) and a11y ([`../../design/GOVERNANCE.md`](../../design/GOVERNANCE.md)).
8. **Async/AI (if any):** enqueue heavy work ([`09_background_jobs`](../technical/09_background_jobs.md)); AI drafts/ranks, human decides.
9. **Tests:** unit + integration + isolation ([`06_testing_strategy.md`](06_testing_strategy.md)).
10. **Docs & memory:** update the technical doc if the contract changed; update `RUNTIME_STATE.md`; append `AGENT_WORK_LOG.md`; add the component to the design inventory if new.
11. **PR:** open against `main` with the template; pass review ([`09_pull_request_and_review.md`](09_pull_request_and_review.md)); merge `--no-ff`.

## 2. Feature checklist (copy into the PR)

- [ ] In `mvp-scope`/roadmap; product decisions resolved (no `⚑ OPEN` left unhandled)
- [ ] DB: migration + RLS + **org-isolation tests**; `db reset` green
- [ ] Zod/Pydantic schemas from [`12_validation_rules`](../technical/12_validation_rules.md)
- [ ] Server Actions: validate → authorize (capability) → mutate → emit event; shared `Result`/`ApiError`
- [ ] Reads paginated; identity from JWT; no cross-tenant leakage
- [ ] UI: semantic tokens; AR-RTL + EN-LTR; Light + Dark; all states; WCAG 2.2 AA
- [ ] Heavy/AI work enqueued; AI human-reviewed (never auto-acts)
- [ ] Tests green (typecheck/lint/test + isolation)
- [ ] Docs/memory synced (spec/RUNTIME_STATE/AGENT_WORK_LOG/design inventory)
- [ ] No secrets/`.env`/`.pen`; no technical copy in UI; no duplication

## 3. Definition of Done

A change is **Done** only when **all** hold:

1. **Scope:** matches an approved spec/roadmap item; no scope creep; product decisions resolved.
2. **Correct:** implements the spec contract (domain/DB/API/state/validation).
3. **Secure & isolated:** RLS on new tenant tables + isolation tests pass; identity from JWT; no service-role in client; no secret exposure.
4. **Validated:** Zod-first; typed `Result`/`ApiError`; localizable messages.
5. **Accessible & bilingual:** AR-RTL + EN-LTR, Light + Dark, WCAG 2.2 AA, semantic tokens (UI changes).
6. **Tested:** required-path tests green (`typecheck`/`lint`/`test` + isolation); no placeholder tests.
7. **Observable:** structured logs + `traceId`; async work has retry/dead-letter.
8. **Documented:** spec/memory synced; PR checklist complete.
9. **Reviewed & green:** approved PR; CI/validation green; merged `--no-ff` (no squash/force).

If any item cannot be met, the work stays open (or ships behind an explicitly-documented follow-up issue) — it is not marked Done.
