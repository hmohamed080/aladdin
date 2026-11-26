# Backups controlled from the Admin console: design

Status: **proposed, waiting for the owner's approval.** Nothing in this document is built. Date: 2026-11-26.

## Intent

The owner wants to run backups from `/admin/backups`: what runs, when, how often it retries, when it is reviewed, and who hears about it. A backup set for 01:30 should start at about 01:30, and nothing should wake up all day without a reason. History must stay quick to open. Secrets and the protections that keep old backups safe stay out of the console, so a stolen admin account or a mistake in the console cannot expose or destroy them.

## Today (verified 2026-11-26)

- `daily-backup.yml` asks GitHub for a run every 30 minutes. The last 25 scheduled runs (18 to 26 Nov) came about three times a day, roughly 3 to 12 hours apart. A slot stays due for 24 h (`runtime-schedule.py`, added 2026-11-07), so GitHub decides when a backup or its retry happens.
- Later runs the same day record `skipped` rows.
- `freshness.yml` is asked for 05:00 UTC; the last five scheduled runs started between 13:02 and 15:39 UTC. It is the only part of the kit that sends email (`RESEND_API_KEY`, `ALERT_EMAIL`).
- Production needs two switches: `backup_settings.production_enabled` and the repository variable `PRODUCTION_BACKUP_ENABLED`.
- Saving the schedule needs a typed phrase (Production), the password and a reason.
- `admin_backup_status` returns the last 25 runs, skipped ones included. No migration deletes ledger rows.
- The site has an in-app inbox (`public.notifications`, bell in the shared header, also in the admin shell). `app.notify` never notifies the acting user, and event types are a database check constraint. `docs/database/notifications-core.md` puts email delivery and preferences out of scope until a further approved spec; this document is that spec for backup notices only.
- Draft PRs aladdin#277, #279 and #278 fix the restore-test switch, stuck runs, run labels, the freshness limit and the console display.

## Goals

1. Backup and restore-test times set in the console are what triggers them.
2. No periodic polling. One wake-up per scheduled event, plus one daily safety check.
3. Schedule, retries, review window, restore test, activation and notifications are editable in the console, per environment.
4. Each notification type can go to email, to the site, to both, or to neither.
5. History is paginated.

Non-goals: WhatsApp or push notifications; per-recipient event choices for email; correcting old ledger rows; changing what a backup contains or how it is encrypted and kept.

Anti-goals: a secret readable or writable in the console; a path where backups stop and nobody can hear about it without having chosen that; a duplicate backup because a timer fired twice.

## Approaches

| | Approach | Trade-off |
|---|---|---|
| A | More GitHub cron lines | No change to the delay. Rejected. |
| B | Cloudflare cron every minute | Close to on time, 1,440 wake-ups and settings reads a day, almost all useless. Rejected by the owner. |
| C | `pg_cron` in Supabase | Exact and event-driven, but the GitHub token lives in the database, the timer stops with the database it watches, and Cairo daylight saving needs handling in a UTC cron. Rejected. |
| D | **Cloudflare Durable Object alarm** | One alarm set to the next event and re-armed when settings change. A new Worker to deploy and watch. **Chosen** (owner, 2026-11-26). |

## Scheduler

A new Worker, `edge/backup-scheduler-worker`, one deployment per environment, holding one Durable Object.

- The object computes the next event from the settings and sets a single alarm to it. Events: backup slot, retry, backup review, restore-test slot, restore-test review, delivery retry.
- Times are Africa/Cairo and computed per occurrence. A time skipped by the clock change runs at the first valid minute after it; a repeated time runs once, the first time.
- **Re-arm.** After any settings change the app calls the Worker over a service binding. The call carries no settings: the object re-reads the database. If the call fails, the setting is saved and the console says the timer was not updated, with a retry button.
- **Result ping.** After `reconcile-runs.yml` records a result it sends the Worker an authenticated request with no payload. The Worker re-reads the ledger, then queues the next retry or sends what is due. A lost ping is covered by the review alarm.
- **No duplicates.** Alarms can fire more than once. Each scheduled attempt is one ledger row with a unique key (environment, kind, slot, attempt number), created before dispatch.
- **Dispatch.** The Worker creates the row (`trigger = schedule`) with a service-role RPC, then dispatches the workflow with its `request_id`. The control job accepts a system request from the ledger; the typed Production phrase stays only for runs started by hand on GitHub.
- **A late alarm** (outage) still starts the slot's backup once and raises the "late" notice.
- Paused or off: no backup alarm. The next one is the first slot after the pause ends.

The console shows the next backup and review time **as the timer has them**, so a timer that was not re-armed is visible.

### Retries and review

| Setting | Default | Allowed |
|---|---|---|
| Retries after the first attempt | 2 | 0 to 5 |
| Gap between attempts, counted from a recorded failure | 30 min | 10 to 240 |
| Review window, counted from the slot | 120 min | 30 to 1440 |

- The console warns on save when the retries cannot fit in the window (retries x (gap + 15 min) is more than the window).
- A new attempt starts only after the previous one is recorded as failed. An attempt still running is never doubled.
- No retry starts after the review (the only attempt that may start later is the single late start above). The 24-hour "still due" rule and the later "skipped" checks end.
- A dispatch that GitHub refuses or does not answer is a failed attempt and follows the same retry rule, after checking by `request_id` that no run was created.
- **Review** (once per slot): is there a verified success? The size and media-completeness checks of `freshness.sh` also run once, by dispatching `freshness.yml`, which reports its result to the ledger instead of emailing by itself.
- The age limits (26 h, 194 h) are replaced by "no verified success for this slot by the review time".
- A run pending for more than 6 h is still closed as `stale_unverified` (aladdin#279).

### Restore test

On or off, day of month (1 to 28), time, and its own review window (default 180 min). Manual "Run a restore test" stays.

### Daily safety check

One GitHub workflow a day, independent of Cloudflare: if a due slot has no review record, it emails that the scheduler may be down. It may run hours late; it is an alarm of last resort. It takes no backup. It uses the email key it already has in the `backup-check-*` environment, in a job without the service-role key; recipients come from a control job and are masked in logs.

## Production activation

- One On/Off toggle. Turning **off** opens an "Are you sure?" confirmation. No password, phrase or reason.
- Needs `backup.schedule_manage`; who and when are written to the audit log automatically.
- `PRODUCTION_BACKUP_ENABLED` is removed as a second switch. The data job's Production guard takes the control job's answer, which comes from the console setting. This removes one independent layer; the isolation of credentials is unchanged.
- **Proposed, to confirm:** schedule, retry, restore-test and notification settings save the same way (confirmation only when something is switched off or paused). "Back up now" and "Run a restore test" keep today's password and reason.

## Notifications

Per environment, edited in the console with `backup.schedule_manage`.

- Master switch.
- **Email recipients:** up to 10 addresses, add and remove, "send a test" per address.
- **Site recipients:** chosen from active admins who hold `backup.view` (all of them by default), plus "send a test site notification".
- Per type, two independent boxes:

| Type | Email | Site |
|---|---|---|
| Backup failed after all attempts | on | on |
| No successful backup by the review time (includes a late start) | on | on |
| Size under half of the previous one, or media incomplete | on | on |
| Restore test failed or missed | on | on |
| Backup succeeded | off | off |
| Restore test succeeded | off | on |
| Backups switched off or paused | on | on |
| Schedule or other settings changed | on | on |
| Timer problem (cannot read settings or start a run) | on | on |

- A type with both boxes off shows a warning on the four failure types and the timer problem; it is allowed.
- **Change protection:** removing a recipient, switching off a channel, a type or the master switch sends a notice to the previous recipients on both channels, whatever the new settings say.
- Content: environment, event, time, link to `/admin/backups`. No keys, database data or object names.
- **Site delivery:** a `backup.*` event type added to the constraint, bilingual `content`, deep link `/admin/backups`, written in the same transaction as the event. Backup notices **include the acting user**, through a narrow internal writer; `app.notify` itself is unchanged.
- **Email delivery:** an outbox table written in the same transaction as the event; the Worker sends it when pinged, re-armed or woken, with up to 3 retries. The console lists recent notices: time, type, channel, recipient, "accepted for sending" or "failed". Accepted is not proof of delivery.
- **Limits:** site notices appear only to someone who opens the site, and cannot be written while the database is down. The Worker keeps the last known email recipients so it can still email "cannot reach the database".

## History

- 20 runs per page, read on the server one page at a time, newest first, with filters for kind and status.
- Old `skipped` rows stay hidden unless asked for, and the filter applies **before** paging, so a page is always full.
- Opening the page no longer waits for GitHub. Results arrive from the reconciler; the refresh button stays.
- All rows are kept.

## Stays outside the console

Database URL, service-role key, R2 keys, email service key, GitHub token, encryption keys, bucket names, retention and delete protection, the sender address, and which files a backup covers. The console may show "configured / missing", never a value. The owner enters secrets; agents do not.

## Data changes (expand only)

- `backup_settings`: retries, retry gap, review window, restore day, time and review window.
- Ledger: slot key and attempt number with a unique index; review records.
- New: notification settings, email recipients, site recipients, outbox and delivery log. Closed tables; access only through definer RPCs.
- New RPCs: scheduler read, system run request, record review, outbox claim and result, paginated history, notification settings read and save.
- Existing RPCs keep their signatures until the console that uses them is replaced.

## Constraints

- Hosted Acceptance and Production are behind `main`; these migrations queue after the waiting ones and need a gate plan and the owner's GO.
- Durable Objects on the current Cloudflare plan must be confirmed before building.
- The GitHub token is fine-grained: `aladdin-backups` only, Actions read and write.
- Merging, syncing the kit, applying migrations and deploying each need the owner's approval.

## Rollout

1. Merge aladdin#277, #279, #278 (approved). They stay useful: stuck-run expiry, labels, links and times. The freshness-limit logic of #279 and the activation section of #278 are replaced here.
2. History pagination and the activation toggle (database and console).
3. Notification settings, site delivery and outbox (database and console).
4. Scheduler Worker and kit changes, tested offline.
5. Acceptance: turn the timer on with the GitHub cron still present (the completed-snapshot check prevents a second snapshot), observe one week including a forced failure, then remove the GitHub cron.
6. Production, with a separate GO.

## Tests

Next-event calculation (daily, weekly, pause, off, both clock changes); duplicate alarm; retry and review transitions; lost ping; database unreachable; pgTAP for permissions, the unique slot key, change protection and acting-user delivery; credential isolation of the workflows; console tests for the toggle, notification matrix and paging; one browser pass on Acceptance with a real test email and site notice. Start delay after dispatch is measured on Acceptance and reported before Production.

## Left to the builder

Table and function names, the ping authentication, the layout of the console sections, and Arabic and English wording.
