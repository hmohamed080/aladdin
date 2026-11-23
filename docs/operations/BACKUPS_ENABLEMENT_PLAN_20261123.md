# Backups enablement plan: automatic backups ON for Acceptance and Production - 2026-11-23

Status: PLAN. Nothing in this document has been changed or enabled. Every switch below is the owner's action (console, GitHub variable or Worker secret) and needs the owner's explicit GO; this repository never sets those values.

## Purpose
Turn on automatic, verified backups for both hosted databases and prove the Admin backup console works on both. A restore-verified Production snapshot is also the precondition for every Production migration step ([`PRODUCTION_CATCHUP_PLAN_20261123.md`](PRODUCTION_CATCHUP_PLAN_20261123.md)).

## Current state (read-only, 2026-11-23)

| Item | Acceptance (`nxossqhdfltcqdwvbewi`) | Production (`kkpkgjrweysgvhvkhzun`) |
|---|---|---|
| Backup control migration `20261107090006` | applied | applied |
| `app.backup_environment` | initialized 2026-11-11 (`acceptance`) | initialized 2026-11-11 (`production`) |
| `app.backup_settings` | `acceptance_schedule = off`, `production_enabled = false`, version 0 | same: both off, version 0 |
| `app.backup_runs` | 14 rows (manual and schedule runs on 11-16, 11-17, 11-22) | 0 rows: Production has never been backed up through the console |
| Private repo `aladdin-backups` variables | `ACCEPTANCE_BACKUP_SCHEDULE = off` | `PRODUCTION_BACKUP_ENABLED = false` |
| GitHub environments | `backup-acceptance`, `backup-check-acceptance`, `backup-control-acceptance`, `restore-test-acceptance` | `backup-production`, `backup-check-production`, `backup-control-production`, `restore-test-production` |
| Scheduler | the `Daily backup` workflow (`plan` job, then `control` job that reads the runtime schedule, then `backup`) | same workflow |

What the scheduled runs actually do today: the latest `Daily backup` runs are green, but only the `plan` and `control` jobs run; the data job `backup` is **skipped** because both schedules are off. A green run here is NOT a backup. Success is only a run whose `backup` / `restore` job concluded `success` and whose ledger row is `succeeded` (rule from `BACKUPS_ADMIN_ACTIVATION.md`).

Acceptance history worth knowing: the most recent scheduled restore test (2026-11-22) succeeded and the manual backup of 2026-11-17 succeeded; earlier attempts failed with `not_configured`, `dispatch_failed` and `workflow_failed` (token and workflow setup, since fixed); one scheduled backup of 2026-11-22 is still `running` with no finish time (a stale ledger row, to be reconciled or explained before relying on the schedule).

## Two layers of switches (both are needed)
1. **Outer gate, GitHub repository variables in `aladdin-backups` (owner only, NOT settable from the Admin console):** `plan.sh` lists the projects a scheduled run may cover: Acceptance only when `ACCEPTANCE_BACKUP_SCHEDULE` is `daily` (every night) or `weekly` (Sundays, Cairo); Production only when `PRODUCTION_BACKUP_ENABLED` is `true`. Scheduled backups fire in the Cairo 01:00-03:59 window (three firings a night, the first takes the backup, the others are retries).
2. **Inner gate, runtime settings (Admin console, super admin, audited, no redeploy):** for each project the `control` job reads `app.backup_settings` (`acceptance_schedule` off/daily/weekly, schedule time and weekday, `production_enabled`, pause). Frequency, weekday and time are changed in the console; they only take effect inside the outer gate.
So yes, the frequency can be changed from the Admin console, but the two GitHub variables must first be set once (Acceptance: `weekly`; Production: `true`) and the console values must match.

## Gaps to close
1. **Acceptance schedule is OFF** in both places (runtime setting and `ACCEPTANCE_BACKUP_SCHEDULE`).
2. **Production has no backup, no schedule, no console token proof.** `BACKUP_GITHUB_TOKEN` on the Production Worker was not verified (a secret cannot be read from here).
3. **A stale `running` backup row on Acceptance (blocking).** Ledger row `65296cc4-...` (kind `backup`, requested 2026-11-22 10:03Z) belongs to GitHub run 45010533680, which actually finished `success` (jobs `plan`, `control (acceptance)`, `gate` and `backup (acceptance)` all success; it is the run behind the pinned snapshot `aladdin-acceptance-20261122T100424Z`). The ledger never recorded the outcome. Because `uq_backup_run_pending` allows only ONE open (`requested`/`dispatched`/`running`/`unknown`) row per environment and kind, this row blocks every new Acceptance backup request (console or scheduled) until it is closed. Re-running the `Reconcile backup evidence` job for that run (attempt 2, 2026-11-23) succeeded but changed nothing: the reconciler returns silently in some branch (the GitHub log shows no output), cause not yet found. The sanctioned way to close it is the console's reconcile action (`admin_backup_reconcile`, super admin, which re-verifies the GitHub run and its job). Do not edit the ledger by hand.
4. **Production R2 media coverage (Track D).** The freshness alarm fails Production while `r2_media_records_not_covered` is above 0, so Production activation waits for that coverage; it is not waived.
5. **Admin console proof on both environments** (see below): nothing in this document proves the live pages work; only the owner's session can.

## Decision (owner, 2026-11-23)
Schedule frequency. Decided by the owner (2026-11-23): **daily for Production**, **weekly for Acceptance** (Acceptance holds test data; weekly limits R2 storage and Actions minutes). The console takes the schedule at runtime (audited, no redeploy). The repository variable `ACCEPTANCE_BACKUP_SCHEDULE` must agree with it (`weekly`), otherwise the planner and the console disagree.

## Steps (in order; each needs its own GO)

### Acceptance
A1. Close the stale `running` backup row through the console's reconcile action (super admin) and confirm the row becomes `succeeded` with a verified `backup` job; then find why the GitHub reconciler skipped it (read `backup/report-run.py` branches against that run) so it does not recur. Must be done BEFORE A2: while the row is open no Acceptance backup can start.
A2. Owner: set the repository variable `ACCEPTANCE_BACKUP_SCHEDULE` to `weekly`. Then in the Admin console on the Acceptance app (`/admin/backups`, super admin) set the Acceptance schedule to weekly (Sunday). Both must agree.
A3. Run **Backup** then **Restore test** from the console. Pass: both ledger rows `succeeded` AND the GitHub run's `backup` / `restore` job is `success` (a green `plan` alone does not count).
A4. After the first scheduled slot: confirm a `schedule` ledger row `succeeded` with a `backup` job `success`, then a freshness check run `success`.

### Production (after the Track D media coverage is in place)
P1. Confirm `BACKUP_GITHUB_TOKEN` exists on the Production Worker `aladdin-frontend-production` (fine-grained, `aladdin-backups` only, Actions read and write), followed by Promote version.
P2. Confirm the four Production GitHub environments hold the Production `SUPABASE_URL` and service key and a restore-test key different from Acceptance.
P3. Console activation on Production: typed `back up production`, current-password receipt and a reason. Set repository variable `PRODUCTION_BACKUP_ENABLED = true` (owner only; without it the scheduler never includes Production).
P4. Manual **Backup** then **Restore test** on Production with the same pass criteria as A3.
P5. Set the Production schedule (daily) in the console; confirm the first scheduled run as in A4.
P6. Pin the restore-verified Production snapshot: add its label (`aladdin-production-YYYYMMDDTHHMMSSZ`) with the backup run, restore run and migration count to `PRODUCTION_RESTORE_VERIFIED_SNAPSHOTS` in `scripts/hosted-db/acceptance-gate.mjs` through a reviewed PR. Only then can `production-apply.sh` pass its recovery gate. A snapshot taken before a migration batch must be taken within the batch's freshness window and at the batch's starting migration count or later.

## Admin console proof (both environments, owner session)
On `/admin/backups` of each app, record: the page loads for a super admin and is refused to any other role; the status card shows the environment (`acceptance` / `production`) and the schedule; the schedule control saves and is audited; Backup and Restore test start a GitHub run and the row moves `requested`, `dispatched`, `running`, `succeeded`; Production actions demand the typed phrase and the password receipt; with the token removed dispatch fails closed with `not_configured` and nothing runs.
I can verify the ledger and settings rows (read-only SQL) and the workflow runs (GitHub) after each step; I cannot sign in to the console.

## Rollback
Set the schedule to `off` in the console (Production: deactivate there) and set the repository variable back; remove `BACKUP_GITHUB_TOKEN` to make dispatch fail closed. The environment binding row stays by design.

## What is deferred
Retention and encryption policy review of the backup bucket; Production restore-test schedule (`production_restore_schedule_enabled`, currently false); alerting on a failed or stale run.

## Related files
- [`BACKUPS_ADMIN.md`](BACKUPS_ADMIN.md), [`BACKUPS_ADMIN_ACTIVATION.md`](BACKUPS_ADMIN_ACTIVATION.md)
- `scripts/hosted-db/acceptance-gate.mjs` (`PRODUCTION_RESTORE_VERIFIED_SNAPSHOTS`)
- Private repo `hmohamed080/aladdin-backups` (workflows `daily-backup.yml`, `restore-test.yml`, reconcile and freshness)
