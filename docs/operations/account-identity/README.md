# Account identity - Phase 1 working documents

Index for the removal of application usernames and date of birth. Authority: [master plan v1.5](../../architecture/ACCOUNT_IDENTITY_LIFECYCLE_MASTER_PLAN.md).

| Document | Content |
|---|---|
| [P1-IMPACT-INVENTORY.md](P1-IMPACT-INVENTORY.md) | Every occurrence, owner, planned action, verification (CONFIRMED / INFERRED / OPEN) |
| [P1-MIGRATION-DESIGN.md](P1-MIGRATION-DESIGN.md) | M1 (as implemented) / M2 / M3 spec, Auth-metadata scrub, audit_log redaction |
| [P1-PR-CONFLICT-MATRIX.md](P1-PR-CONFLICT-MATRIX.md) | Open-PR interaction matrix and ordering |
| [P1-COMPAT-MATRIX.md](P1-COMPAT-MATRIX.md) | OLD and NEW app against DB states pre-M1 / post-M1 / post-M2 / post-M3, breaks B1-B7 and fixes |
| [P1-AUDIT-LOG-REDACTION-DESIGN.md](P1-AUDIT-LOG-REDACTION-DESIGN.md) | audit_log username redaction: design, local proof, recovery plan (drafts in [drafts/](drafts/)) |
| [P1-AUTH-METADATA-SCRUB.md](P1-AUTH-METADATA-SCRUB.md) | Auth birth_date scrub: local findings, procedure design, owner decision |
| [P1-EVIDENCE.md](P1-EVIDENCE.md) | Evidence index: CI, local proofs, permission-gate investigation, Acceptance preflight (section 8) |
| [P1-ACCEPTANCE-RUNBOOK.md](P1-ACCEPTANCE-RUNBOOK.md) | Ordered Acceptance runbook: pre-flight, backup, apply (media / M1), verification, forward-fix, deploy, E2E, outstanding items |
| [drafts/P1-M1-FORWARD-FIX-RESTORE-PREVIOUS.sql](drafts/P1-M1-FORWARD-FIX-RESTORE-PREVIOUS.sql) | Proven SQL restoring the pre-M1 definitions of the three functions (not applied) |

Planned later (not yet written): `P1-TEST-MATRIX.md`, `P1-ACCEPTANCE-REPORT.md`, `P1-PRODUCTION-REPORT.md`. Nothing here is applied to a hosted environment; evidence holds counts only, never personal values.
