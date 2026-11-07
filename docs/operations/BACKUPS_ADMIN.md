# Admin backup control — integration candidate

## Purpose and decision

Continue the November 7 reconciliation from latest main, preserving completed OTP,
staff invitations and R2 work. This candidate is preparation only. No hosted
migration, deployment, schedule activation, backup dispatch or deletion is authorized.

The existing private GitHub Actions repository remains the executor. The database
owns the environment binding, centralized Admin permissions, audited schedule and
run ledger. The frontend never holds GitHub credentials in browser code.

Automatic scheduling is independent of manual backup and isolated restore testing.
A bounded pause expires automatically. Daily/weekly schedules use Africa/Cairo local
time; delayed jobs consult the due slot, rather than requiring an exact cron minute.
Concurrent requests are refused while a run is outstanding. Uncertain dispatches
must remain unresolved until reconciled, never automatically dispatched twice.

## Scope and consequences

Production activation is a readiness gate, separate from schedule pause. Restores
run only inside disposable runner stacks, with environment-specific read keys.
Success requires the actual data-moving job and complete coverage; skipped jobs
and green planners are not backup evidence. Original media and retention rules
remain unchanged. No deletion UI is provided.

## Validation and deferred activation

Hosted Acceptance currently has 203 migrations through 20261107090002; Production
has 193 through 20261027090001 (read-only inspection on November 7). Proposed R2
migrations use 20261107090003/4; backup control uses 20261107090005, none applied.
Acceptance writes for seven-flow E2E require separate owner approval under this
task's explicit prohibition on hosted changes. Local tests do not substitute for
that evidence. Infrastructure and runtime credentials remain owner-controlled.

Related: [runtime state](RUNTIME_STATE.md),
[R2 and backups ADR](../decisions/ADR-0027-r2-id-keys-and-backups.md),
[backup kit](../../ops/backups/README.md).
