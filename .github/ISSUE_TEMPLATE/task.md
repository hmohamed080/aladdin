---
name: Engineering task
about: A technical task, chore, or refactor (no new product capability)
title: "task: <short summary>"
labels: ["type: task", "status: needs-triage"]
assignees: []
---

## Task
<!-- What needs to be done, concretely. -->

## Why / context
<!-- Why now? Link the driving issue/spec/ADR. -->

## Area
<!-- e.g. infra, design-system, database, ci, a specific feature module -->

## Scope
- In scope:
- Out of scope:

## Definition of Done
<!-- See docs/engineering/07_feature_workflow.md. -->
- [ ] Change matches an approved spec/ADR; no scope creep
- [ ] Validation green (typecheck/lint/test as applicable)
- [ ] Migrations ship RLS + isolation tests (if DB)
- [ ] Docs / project memory updated (RUNTIME_STATE / AGENT_WORK_LOG where relevant)
- [ ] No duplication; cross-referenced

## Dependencies / blockers
<!-- Other issues, product decisions (needs-product-decision), or external items. -->
