# Engineering Standards (Phase 0.8)

| | |
|---|---|
| **Status** | Living document (canonical engineering reference) |
| **Version** | 1.0.0 |
| **Owner** | Engineering / Foundation |
| **Last Updated** | 2026-08-01 |
| **Depends On** | Root [`AGENTS.md`](../../AGENTS.md), scoped [`frontend/AGENTS.md`](../../frontend/AGENTS.md) · [`backend/AGENTS.md`](../../backend/AGENTS.md) · [`supabase/AGENTS.md`](../../supabase/AGENTS.md), [`../technical/README.md`](../technical/README.md) |
| **Related** | [`../development/git-workflow.md`](../development/git-workflow.md), [`../decisions/`](../decisions/) |

The engineering reference **every future contributor and AI agent must follow** when implementing Aladdin. These standards **do not restate** the ADRs, the technical spec, or the scoped `AGENTS.md` files — they **operationalize** them and fill the gaps. On any conflict, the [documentation authority order](../technical/README.md#authority) wins.

## Standards documents

| Doc | Covers |
|---|---|
| [`01_project_structure.md`](01_project_structure.md) | Feature folder structure · Layer responsibilities · Dependency-injection strategy |
| [`02_coding_standards.md`](02_coding_standards.md) | Coding standards · Naming conventions |
| [`03_api_standards.md`](03_api_standards.md) | API standards · Shared response models · Shared error models |
| [`04_error_logging_observability.md`](04_error_logging_observability.md) | Error-handling standards · Logging strategy · Observability guidelines |
| [`05_validation_standards.md`](05_validation_standards.md) | Validation strategy · Shared validation rules |
| [`06_testing_strategy.md`](06_testing_strategy.md) | Testing strategy |
| [`07_feature_workflow.md`](07_feature_workflow.md) | Feature development workflow · Feature checklist · Definition of Done |
| [`08_database_migration_workflow.md`](08_database_migration_workflow.md) | Database migration workflow |
| [`09_pull_request_and_review.md`](09_pull_request_and_review.md) | Pull-request workflow · Code-review checklist |
| [`10_environment_and_cicd.md`](10_environment_and_cicd.md) | Environment strategy · CI/CD strategy |
| [`11_performance_and_security.md`](11_performance_and_security.md) | Performance guidelines · Security checklist |
| [`12_ai_agent_rules.md`](12_ai_agent_rules.md) | AI-agent development rules |

## Topic → document map (Phase 0.8 brief, all 25 topics)

| # | Topic | Document |
|---|---|---|
| 1 | Feature Folder Structure | [01](01_project_structure.md) |
| 2 | Layer Responsibilities | [01](01_project_structure.md) |
| 3 | Coding Standards | [02](02_coding_standards.md) |
| 4 | Naming Conventions | [02](02_coding_standards.md) |
| 5 | API Standards | [03](03_api_standards.md) |
| 6 | Error Handling Standards | [04](04_error_logging_observability.md) |
| 7 | Logging Strategy | [04](04_error_logging_observability.md) |
| 8 | Validation Strategy | [05](05_validation_standards.md) |
| 9 | Testing Strategy | [06](06_testing_strategy.md) |
| 10 | Feature Development Workflow | [07](07_feature_workflow.md) |
| 11 | Database Migration Workflow | [08](08_database_migration_workflow.md) |
| 12 | Pull Request Workflow | [09](09_pull_request_and_review.md) |
| 13 | Code Review Checklist | [09](09_pull_request_and_review.md) |
| 14 | Definition of Done | [07](07_feature_workflow.md) |
| 15 | Feature Checklist | [07](07_feature_workflow.md) |
| 16 | Shared Response Models | [03](03_api_standards.md) |
| 17 | Shared Error Models | [03](03_api_standards.md) |
| 18 | Shared Validation Rules | [05](05_validation_standards.md) |
| 19 | Environment Strategy | [10](10_environment_and_cicd.md) |
| 20 | CI/CD Strategy | [10](10_environment_and_cicd.md) |
| 21 | Dependency Injection Strategy | [01](01_project_structure.md) |
| 22 | Performance Guidelines | [11](11_performance_and_security.md) |
| 23 | Security Checklist | [11](11_performance_and_security.md) |
| 24 | Observability Guidelines | [04](04_error_logging_observability.md) |
| 25 | AI Agent Development Rules | [12](12_ai_agent_rules.md) |

## How this relates to existing docs (no duplication)

- **What to build / contracts:** [`../technical/`](../technical/) (domain, DB, RLS, API, jobs, events, state machines, validation).
- **Why decisions hold:** [`../decisions/`](../decisions/) (ADRs).
- **Stack-scoped rules:** [`../../frontend/AGENTS.md`](../../frontend/AGENTS.md), [`../../backend/AGENTS.md`](../../backend/AGENTS.md), [`../../supabase/AGENTS.md`](../../supabase/AGENTS.md).
- **Design-system rules:** [`../../design/GOVERNANCE.md`](../../design/GOVERNANCE.md).
- **These engineering docs:** *how* to implement consistently. When a rule already exists elsewhere, these docs **link** it rather than copy it.
