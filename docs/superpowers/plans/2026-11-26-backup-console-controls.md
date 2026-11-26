# Backup console controls (phase 1 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paginated backup history, Production activation as one On/Off switch, and schedule saving without password, phrase or reason.

**Architecture:** One expand-only migration adds a paginated read RPC and two simpler write RPCs beside the old ones. The console moves to them. Writes keep today's path: server action, then a service-role RPC that re-checks the verified actor's permission.

**Tech Stack:** Postgres (pgTAP), Next.js App Router, TypeScript, Vitest.

**Spec:** `docs/operations/BACKUP_ADMIN_CONTROL_DESIGN.md`

## The four phases

| Phase | Delivers | Plan |
|---|---|---|
| 1 | History pages, activation switch, simpler saving | this file |
| 2 | Notification settings, site notices, outbox, delivery log | written when phase 1 is merged |
| 3 | Scheduler Worker, retries, review, restore-test times, daily safety check, kit changes (including removing `PRODUCTION_BACKUP_ENABLED`) | written when phase 2 is merged |
| 4 | Acceptance week, then Production | runbook, each step with the owner's GO |

Email notices are only delivered once phase 3 exists, because the Worker sends them.

**Said plainly:** after phase 1 and until phase 3, the GitHub variable `PRODUCTION_BACKUP_ENABLED` is still a second Production switch, and switching backups off sends no notice until phase 2.

## Before Task 1

aladdin#277, #279 and #278 are merged. Branch `feat/backup-console-controls` from the new `origin/main`.

## Global Constraints

- Expand only: `admin_backup_status`, `admin_backup_activate` and `admin_backup_update_schedule` stay unchanged. Merged migrations are not edited. Migrations contain no transaction control.
- Page size is exactly 20, newest first by `requested_at`, then `id`. All rows are kept.
- The skipped filter applies before paging.
- Production switch: turning off opens a confirmation; turning on does not. No password, phrase or reason.
- Schedule saving: no password, phrase or reason. A confirmation appears only when something is switched off or paused.
- "Back up now" and "Run a restore test" keep password, reason and the Production phrase.
- Permissions: read `backup.view`; write `backup.schedule_manage`. Every change writes an audit event with the actor.
- Opening the page does not call GitHub.
- Arabic and English strings for all new text; layouts work right to left.
- A new permission contract `supabase/permissions/<version>.json` for the migration; CI's gate on a clean replay is the authority.
- No hosted apply or deploy in this plan.

## Review Focus

1. A page number past the end, zero, negative or not a number: the last or first page is shown, never an empty table that looks like lost history. (Tasks 1, 3)
2. Two admins, or a double click on the switch: asking for the state it already has changes nothing and writes no second audit event. (Task 1)
3. An old tab saves the schedule after the switch was flipped elsewhere: refused as stale, and the new activation state is not overwritten. (Task 1)
4. A confirmation that is cancelled changes nothing, including the form values on screen. (Task 4)
5. An administrator with `backup.view` only sees history and a disabled switch, and a crafted request is refused by the database. (Tasks 1, 4)

---

### Task 1: Database functions

**Files:**
- Create: `supabase/migrations/20261126130001_backup_console_controls.sql` (check the version is unused on `main` and open PRs; otherwise take the next free one)
- Create: `supabase/permissions/20261126130001.json`
- Create: `supabase/tests/<next free number>_backup_console_controls_test.sql` (fixtures and `pg_temp` helpers copied from `124_admin_backup_control_test.sql`)

**Interfaces (produces):**
- `public.admin_backup_runs(p_page integer default 1, p_kind text default null, p_status text default null, p_include_skipped boolean default false) returns jsonb` giving `{"runs":[…],"total":int,"page":int,"page_size":20,"skipped_total":int}`. Granted to `authenticated`, guarded by `app.admin_require('backup.view')`. Each run has the same keys as in `admin_backup_status`.
- `public.admin_backup_set_production(p_actor uuid, p_enabled boolean) returns boolean`, service role only.
- `public.admin_backup_save_schedule(p_actor uuid, p_acceptance_schedule text, p_production_restore_schedule_enabled boolean, p_expected_version integer, p_config jsonb) returns integer`, service role only; `p_config` is `{"time":"HH:MM","weekday":0-6,"pause_hours":0-168}`.

Rules the tests do not fully determine: `p_page` below 1 or null becomes 1; past the end becomes the last page (1 when empty). `p_status = 'skipped'` returns skipped rows even when `p_include_skipped` is false. `skipped_total` counts skipped rows matching the kind filter. `total` counts rows matching all filters.

- [ ] **Step 1: Write the failing pgTAP file** with these assertions (45 rows seeded for the bound environment: 25 succeeded backups, 15 skipped backups, 5 failed restore tests):
  - default call: `total` 30, `jsonb_array_length(runs)` 20, `page` 1, `page_size` 20, `skipped_total` 15, no `skipped` row;
  - page 2: 10 rows, none shared with page 1; pages 3, 99: `page` 2; pages 0, -4, null: `page` 1;
  - `p_include_skipped`: `total` 45; `p_status 'skipped'`: `total` 15; `p_kind 'restore_test'`: `total` 5; kind `'x'` or status `'x'`: `22023`; empty result: `page` 1, `total` 0;
  - rows of another environment never appear; Moderator and plain user: `42501`; Administrator reads;
  - `set_production`: Administrator `42501`; on Acceptance `22023`; Super Admin on changes `production_enabled`, bumps `version` by 1, writes `backup.production_activated`; the same value again returns it, with `version` and audit count unchanged; off clears `production_restore_schedule_enabled` and writes `backup.production_deactivated`; the audit row's actor is the Super Admin;
  - `save_schedule`: saves daily 01:30 with no receipt; stale version `VC001`; a version read before `set_production` is `VC001`; restore enabled while Production is off `22023`; time `25:00`, weekday 7, pause 169, pause -1: `22023`; pause 24 sets `paused_until` about 24 h ahead and 0 clears it; Administrator `42501`; writes `backup.settings_changed`;
  - `anon` and `authenticated` cannot execute the two write functions.
- [ ] **Step 2: Run it** on a local stack (`supabase test db`, or the file inside its own rolled-back transaction). Expected: FAIL, functions do not exist.
- [ ] **Step 3: Write the migration** following the bodies of `admin_backup_status`, `admin_backup_activate` and `admin_backup_update_schedule` in `20261107090006`: `security definer`, `set search_path = ''`, explicit revoke and grant, `app.backup_actor` for writes, `for update` on the settings row.
- [ ] **Step 4: Run the new file and `124_admin_backup_control_test.sql`.** Expected: all pass.
- [ ] **Step 5: Add the permission contract** (previous contract plus the three functions) and run `node scripts/migration-permission-gate.mjs` as CI does. Expected: pass.
- [ ] **Step 6: Commit** `feat(db): paginated backup history and simpler backup controls`.

### Task 2: Server layer

**Files:**
- Modify: `frontend/src/types/database.types.ts`, `frontend/src/lib/supabase/admin-server.ts`, `frontend/src/server/queries/admin-backups.ts`, `frontend/src/server/actions/admin-backups.ts`
- Create: `frontend/src/server/queries/admin-backups.test.ts`, `frontend/src/server/actions/admin-backups.test.ts`

**Interfaces:**
- Consumes: the three RPCs of Task 1.
- Produces:
  - `type BackupRunsFilter = { page: number; kind: BackupKind | null; status: BackupRunStatus | null; includeSkipped: boolean }`
  - `type BackupRunsPage = { runs: BackupRun[]; total: number; page: number; pageSize: number; skippedTotal: number }`
  - `loadBackupRuns(supabase: Client, filter: BackupRunsFilter): Promise<BackupRunsPage | null>` (`null` on RPC error or wrong shape)
  - `adminBackupSetProduction({ actor, enabled })`, `adminBackupSaveSchedule({ actor, acceptanceSchedule, productionRestoreScheduleEnabled, expectedVersion, config })`
  - `setProductionBackupAction(prev: FormState, fd: FormData): Promise<FormState>`, field `enabled` = `"true"` or `"false"`; any other value gives `backups.errors.invalid`
  - `saveBackupScheduleAction` keeps its name and drops `password`, `reason` and `confirmation`

- [ ] **Step 1: Failing tests.** Query: parses a page; an error or a payload without `total` gives `null`. Actions (Supabase and admin RPCs mocked at the module boundary): `enabled="yes"` calls no RPC; no signed-in user gives `backups.errors.forbidden`; success codes are `backups.done.activated` and `backups.done.deactivated`; saving the schedule never calls `account_password_confirm` and sends `pause_hours` from `pauseHoursFor("keep", pausedUntil)`; `VC001` gives `backups.errors.stale`.
- [ ] **Step 2: Run** `npx vitest run src/server/queries/admin-backups.test.ts src/server/actions/admin-backups.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Remove `setProductionBackupActivationAction` and `adminBackupActivate` together with the activation form in Task 4; `requestBackupAction` stays as it is.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(admin): server side of the simpler backup controls`.

### Task 3: History pages

**Files:**
- Modify: `frontend/src/features/admin/backups/backup-view.ts` and its test, `frontend/src/app/admin/backups/page.tsx`, `frontend/src/lib/i18n/messages/ar.ts`, `en.ts`
- Create: `frontend/src/features/admin/backups/backup-history.tsx`, `backup-history.test.tsx` (move `HistoryRow` and `STATUS_TONE` here)

**Interfaces:**
- Consumes: `BackupRunsFilter`, `BackupRunsPage`, `loadBackupRuns`.
- Produces: `historyFilterFrom(params: Record<string, string | string[] | undefined>): BackupRunsFilter`; `historyHref(filter: BackupRunsFilter): string`; `pageCount(total: number, pageSize: number): number` (at least 1). `splitSkipped` is deleted.

- [ ] **Step 1: Failing tests:**
  - `historyFilterFrom({})` is `{page:1, kind:null, status:null, includeSkipped:false}`; `page` of `"0"`, `"-2"`, `"abc"`, `"1.5"`, `["2","3"]` gives 1; unknown `kind` or `status` gives null; `skipped:"1"` gives true;
  - `historyHref` of the default filter is `/admin/backups`; defaults are omitted; a round trip through `URLSearchParams` returns the same filter;
  - `pageCount(0,20)` 1, `(20,20)` 1, `(21,20)` 2;
  - component: previous is absent on page 1 and next on the last page; the page indicator uses the page the server returned; a filter or skipped-toggle link goes to page 1; a `null` result renders a load error, not "no runs yet".
- [ ] **Step 2: Run** `npx vitest run src/features/admin/backups`. Expected: FAIL.
- [ ] **Step 3: Implement.** Filters are links (server rendered, no client state). Remove the `reconcileBackupRuns` call from the page render; `refreshBackupRunsAction` keeps it. First check read-only on hosted that recent runs got `reported_at` within minutes of finishing without anyone opening the page. If they did not, stop and tell the owner: the page-load call is then still what records results. Summary tiles keep using `admin_backup_status`.
- [ ] **Step 4: Run tests, `npx tsc --noEmit`, `npx eslint src/features/admin/backups src/app/admin/backups`.** Expected: all clean.
- [ ] **Step 5: Commit** `feat(admin): backup history in pages of 20 with filters`.

### Task 4: Switch and simpler schedule form

**Files:**
- Create: `frontend/src/features/admin/backups/backup-production-switch.tsx` and test
- Modify: `backup-schedule-form.tsx` and its test, `backup-view.ts` and its test, `app/admin/backups/page.tsx`, `ar.ts`, `en.ts`, `docs/operations/AGENT_WORK_LOG.md`
- Delete: `backup-activation-form.tsx`

**Interfaces:**
- Consumes: `setProductionBackupAction`, `saveBackupScheduleAction`.
- Produces: `needsStopConfirmation(current: BackupSettings, next: { schedule: BackupSettings["acceptance_schedule"]; pauseChoice: string; restore: boolean }): boolean`; `<BackupProductionSwitch enabled canManage />`.

Follow `features/admin-ops/whatsapp-otp-delivery-switch.tsx` for the `role="switch"` markup and `ConfirmDialog`'s `renderTrigger`. Turning on submits directly. The switch goes near the top of the page, Production only, and replaces the bottom `<details>`.

- [ ] **Step 1: Failing tests:**
  - `needsStopConfirmation`: true for daily to off, a new pause `"24"`, restore true to false; false for off to off, `"keep"`, `"0"`, a time change, daily to weekly, restore false to true;
  - switch: `aria-checked` follows `enabled`; off to on submits with no dialog; on to off opens a dialog, and cancelling calls no action; with `canManage={false}` it is disabled; it renders no password, reason or phrase field;
  - form: no `password`, `reason` or `confirmation` field; a time change submits directly; choosing off asks first, and cancelling keeps "off" selected on screen and calls no action;
  - the run dialog still has `password`, `reason` and, for a Production backup, `confirmation`.
- [ ] **Step 2: Run** `npx vitest run src/features/admin/backups`. Expected: FAIL.
- [ ] **Step 3: Implement**, remove the unused activation strings and the old action, add the work-log entry.
- [ ] **Step 4: Run** `npx vitest run src/features/admin src/server src/lib/i18n`, `npx tsc --noEmit`, eslint. Expected: all clean.
- [ ] **Step 5: Browser pass** on a local stack bound as Production, Arabic and English, desktop and mobile width: flip the switch both ways, cancel once, save the schedule, open page 2 and each filter. Record what was and was not checked.
- [ ] **Step 6: Commit** `feat(admin): Production backup switch and simpler schedule saving`, then open a draft PR against `main`.
