# Admin backup control — activation readiness (Track A, 2026-11-10)

Status: code merged and deployed (#140, `78d1b5c0`); migration `20261107090006` is on both hosted databases (both at 207). **The environment binding is not initialized on either database**, so every console action fails closed ("not initialized") and the private workflows' `control` jobs refuse to authorize work. Production R2 writes and automatic backups stay OFF. This page is preparation only; every hosted step below needs the owner's GO, one per step and per environment.

Rules that hold throughout: no trial, soak or passive-monitoring gate; success is only a verified run whose data job (`backup` / `restore`) concluded `success`, never a green `plan` with a skipped backup job; schema changes only as versioned migrations (none needed here).

## What was missing and is now in the repo

| Gap | Fix |
|---|---|
| No runnable way to call `public.admin_backup_initialize` (service role only) | `ops/backups/admin-initialize.sh`. Default is a read-only preflight (`backup_schedule_read`). `--apply` is the one write: needs `CONFIRM="initialize <label>"`, a super-admin `ACTOR_USER_ID`, a URL/key pinned to that project. Idempotent; a different environment is refused by the database. Tested offline by `admin-initialize-test.sh` (12 checks, wired into CI). |
| `BACKUP_GITHUB_*` settings were documented nowhere outside the env module | Added to `frontend/.env.example` (token is a Worker secret, fine-grained, `aladdin-backups` only, Actions read+write). |
| `BACKUPS_ADMIN.md` still said "none applied" | Superseded by this page. |

Verified locally on 2026-11-10 (no hosted access): `plan-test.sh` 86/86, `restore-pin-test.sh` 7/7, `target-guard-test.sh` 20/20, `workflow-isolation-test.py` all PASS, `runtime-schedule-test.py` 7/7, `admin-initialize-test.sh` 12/12. Not re-run here: `supabase/tests/124_admin_backup_control_test.sql` and the frontend vitest suites (no Docker or installed dependencies in this container); they were green in #140's CI.

## Evidence reused

- Acceptance backup and restore: PASS, aladdin-backups run 42461215127 (schema exact, 167 tables / 2548 rows, 9/9 R2 media), CLI 3.0.0 pin in `restore-test.sh`.
- 090006 read-only checks on Acceptance (2026-11-08 triage): RLS on, no policies on `app.backup_*`, SECURITY DEFINER with pinned `search_path`, only `admin_backup_status` granted to `authenticated`; settings singleton OFF, 0 runs.

## Owner GO list: Acceptance (in order)

1. **GO-A1 aladdin-backups repo ready.** `aladdin-backups` PR #1 re-synced from aladdin main (CLI 3.0.0 pin) and merged; environments `backup-control-acceptance` (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` only), `backup-acceptance`, `backup-check-acceptance`, `restore-test-acceptance` exist per `ops/backups/README.md`. Hosted GitHub settings.
2. **GO-A2 initialize Acceptance.** Preflight first (read-only, no GO needed beyond holding the key): `BACKUP_LABEL=acceptance SUPABASE_URL=https://nxossqhdfltcqdwvbewi.supabase.co SUPABASE_SERVICE_ROLE_KEY=… bash ops/backups/admin-initialize.sh`. Then, on GO: same plus `ACTOR_USER_ID=<super admin uuid> CONFIRM="initialize acceptance" … --apply`. One write; the audit event `backup.environment_initialized` is recorded for that actor. Schedule stays `off`.
3. **GO-A3 console token.** Set Worker secret `BACKUP_GITHUB_TOKEN` on the Acceptance Worker (dashboard edits need *Promote version*). Without it dispatch refuses with `not_configured`.
4. **GO-A4 first real run through the console.** Super admin starts *Backup*, then *Restore test* on `/admin/backups`. Pass criteria: ledger status `succeeded` for both, and the GitHub run's `backup` / `restore` job is `success`. A `plan`-only green, a skipped data job or an unresolved dispatch is a FAIL.
5. **GO-A5 schedule.** Set the Acceptance schedule (daily or weekly) in the console; it is audited and needs no redeploy.

## Owner GO list: Production (separate GO per step; after Track C/D prerequisites)

P1. Production already has `20261107090006` applied (read-only `list_migrations` on 2026-11-10: latest entry `admin_backup_control`). No migration step remains for this track.
P2. `backup-control-production`, `backup-production`, `backup-check-production`, `restore-test-production` environments with a different restore-test key.
P3. `admin-initialize.sh` for `production` (same preflight/`--apply`).
P4. `BACKUP_GITHUB_TOKEN` on `aladdin-frontend-production` plus Promote version.
P5. Activation in the console (typed `back up production`, current-password receipt, reason), then a manual backup and a restore test with the same pass criteria.

Blocking dependency owned by Track D: until R2 media is covered, the freshness alarm fails Production when `r2_media_records_not_covered` is above 0, so Production activation should wait for that coverage rather than be waived.

## Rollback

Initialization changes no schedule and starts nothing. To stop everything again: set the Acceptance schedule to `off` in the console (Production: deactivate there); remove `BACKUP_GITHUB_TOKEN` to make dispatch fail closed. The binding row itself is intentionally not removable by any API role.
