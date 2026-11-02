# Admin-controlled WhatsApp OTP limits: implementation plan (v2)

**Status:** approved architecture, implemented in the dependent PR stacked on #127. Version 2 (2026-11-02) replaces the first plan after the owner's decisions: a **Super Admin-configurable Hard Ceiling** (no fixed code-level maximum), **no email or Resend**, and notifications through the **existing** centralized notification system only.

## Purpose
Give the Primary Administrator (Super Admin) full control of the OTP limits from the existing Admin Dashboard, per environment, **without redeploying the Worker or the frontend**, while the global rolling-24-hour budget stays atomic and fail-closed, and every change is authorized, confirmed, concurrency-safe and audited.

## Current decision
**Authoritative settings live in the Worker's own D1, next to the atomic claim.** The Admin Dashboard changes them through a **signed server-to-server Worker endpoint**, after a Supabase RPC has proven the caller's permission and identity from the verified session. Operational alerts are written into the **existing** `public.notifications` inbox through one signed, narrow, idempotent app endpoint. Nothing else is introduced.

## Settings (all configurable from the dashboard)
| Setting | Initial value | Rule |
|---|---|---|
| Daily Send Limit | 150 | maximum **claimed** sends in any rolling 24 hours, all recipients; `1 <= limit <= ceiling` |
| Hard Ceiling | 5,000 | the Super Admin-configurable maximum for the Daily Send Limit; **a value in D1, not a constant** |
| Warning Threshold | 70 % | `1..99`, strictly below Critical |
| Critical Threshold | 90 % | `2..100` |

The initial values are **never seeded by code or migration**: the row is created by an explicit, audited owner action (the dashboard, or a reviewed one-off), so an unconfigured environment sends nothing.

**Sanity bounds that are not policy.** Integers only, `1 <= ceiling <= 1,000,000`, enforced identically in the RPC, the Worker and a D1 `CHECK`, to stop typos, overflow and absurd values. This is an integer bound, not an operational maximum, and changing the operational ceiling never needs a deploy. Independent safety limits stay in force: Meta's own messaging tier (verified separately before activation), and the per-phone, per-IP, cooldown, Turnstile, replay and verification protections, none of which this feature touches.

## Architecture
```
Admin browser
  -> Next.js server action (server-only; same-origin protected by Next)
       1. RPC admin_whatsapp_otp_settings_begin   [caller's own session: auth.uid() IS the actor; admin_require(manage) and, if the ceiling changes, admin_require(ceiling_manage); validation; pending ledger + audit "requested"]
       2. signed POST Worker /v1/admin/settings   [separate admin secret; replay claim; expected_version; actor from step 1, never from the browser]
            one D1 batch: audit INSERT (old values) + UPDATE ... WHERE version = expected
       3. RPC admin_whatsapp_otp_settings_finish  [service role, server-only; audit "changed" with actor, old, new, time]
Send path:  gates -> read settings (fail closed) -> ONE atomic D1 statement: claim only while claims in 24 h < min(daily_limit, hard_ceiling) -> Meta
Cron (every minute, never in the send path): purge journal -> evaluate usage -> D1 outbox -> signed POST app /api/internal/whatsapp-otp/notify -> app RPC -> app.notify -> public.notifications (admins with whatsapp_otp.view)
```

## Worker (`edge/whatsapp-otp-worker`)
**D1 migration `0002_otp_admin.sql`** (additive, idempotent `IF NOT EXISTS`): `otp_settings` (singleton, CHECK `daily_limit <= hard_ceiling`, `warn < critical`, integer bounds, `version`), `otp_settings_audit` (request id UNIQUE, actor, old and new values, version, reason, time: the authoritative record), `otp_admin_requests` (replay claims), `otp_alert_state` and `otp_notification_outbox` (event key UNIQUE, delivery state, attempts, next attempt).
**Baseline.** Production D1 was created by hand: 0001 is present (table and index, 0 rows) and there is **no `d1_migrations` tracking table**. 0001 is idempotent, so `wrangler d1 migrations apply` is a safe baseline: it records 0001 as a no-op and then applies 0002. The read-only checker `scripts/d1-baseline-check.mjs` prints the state before any apply.
**Enforcement.** The claim statement reads the limit inside the same statement: `WHERE (SELECT COUNT(*) ...) < (SELECT min(daily_limit, hard_ceiling) FROM otp_settings WHERE id = 1)`. A change applies to the very next claim; concurrent requests cannot overshoot; a missing row inserts nothing. A pre-read also validates the row in code; missing, invalid or unreadable means `503 budget_unconfigured` **before the token is read**. `WHATSAPP_DELIVERY_ENABLED` is checked first and never consults the budget, so the kill switch is independent. The `OTP_DAILY_SEND_LIMIT` env var of the interim candidate is removed.
**Admin endpoints (signed POST, separate secret, same timestamp window and constant-time check as the send route):**
- `/v1/admin/usage`: settings and version, accepted, failed, reserved, consumed, remaining, percent, level, failure rates (1 h, 24 h, 7 d), last failure time, outbox state and the last 20 audit rows.
- `/v1/admin/settings`: strict schema `{ request_id, actor_id, expected_version, daily_limit, hard_ceiling, warn_percent, critical_percent, reason, ceiling_confirmation? }`; unknown keys rejected; request id replay-claimed; stale version answers `409`.
**Hard Ceiling rules (sensitive).** Changing the ceiling needs the elevated permission, a reason of at least 20 characters, and a typed confirmation equal to the new number. The Daily Send Limit must never exceed the ceiling. If lowering the ceiling would invalidate the current limit, the request is **rejected with an explanation** (`ceiling_below_current_limit`) unless the same request explicitly and atomically sets a lower limit too. Both values are always sent together and written in one D1 batch.
**Scheduled run (every minute).** Purges journal rows older than 7 days and old replay claims; evaluates usage; writes alert events to the outbox; delivers the outbox. It is isolated from the send path: any failure is caught and logged and never blocks a delivery.

## Notifications (existing system only, no email, no Resend)
- **Target:** the existing per-person inbox `public.notifications`, written only through `app.notify`, rendered by the existing header panel and `NotificationList` (unread/read, history). The `ck_notifications_event_type_known` constraint, `KNOWN_NOTIFICATION_EVENTS` and the EN/AR copy get four events: `whatsapp_otp.budget_warning`, `.budget_critical`, `.budget_exhausted`, `.failure_rate`.
- **Recipients:** only users with an active platform role holding `whatsapp_otp.view` and a non-suspended account.
- **Path:** the Worker holds **no database credential**. It posts a signed event (its own notify secret, separate from the send and admin secrets) to one app route; the route verifies the signature, timestamp and a strict allow-listed payload (numbers only), then calls one service-role RPC that records the event in a dedupe ledger and fans out through `app.notify`. The Worker can only cause these four event kinds.
- **No duplicates, re-armed correctly:** the Worker keeps an alert level and an episode counter and raises an event only when the level rises; it falls back with 5 percentage points of hysteresis so a rolling window hovering around a threshold does not flap. Each event key is unique (`kind:episode`) in the outbox **and** in the app ledger, so a retry or replay is a no-op.
- **Content:** operational statistics only (limit, consumed, remaining, percent, failure percent, window), never a code, number, credential or secret.
- **Failures never interrupt delivery; nothing is lost:** a failed delivery stays in the D1 outbox with exponential backoff and is retried every minute for up to 7 days; the dashboard shows pending and undelivered events; a structured, numbers-only log line records each failure.
- **Acceptance note:** the preview app is behind Cloudflare Access, so the Worker's call to `/api/internal/whatsapp-otp/notify` needs an Access bypass for that single path (an owner step), otherwise events wait in the outbox. Production is not behind Access.

## Permissions and security
- `whatsapp_otp.view`: Administrator and higher. `whatsapp_otp.manage`: **Super Admin only**. `whatsapp_otp.ceiling_manage`: a distinct elevated permission, **Super Admin only by default**, delegable only through the existing role-management model.
- Everything is enforced on the server and again in the database: the route rule, the RPCs (`app.admin_require`) and the Worker. UI visibility is never the control.
- **Identity** comes from the verified authenticated session through the RPC (`auth.uid()`), never a client-supplied actor id. CSRF and same-origin protection are Next.js server-action behavior; replay is blocked by one-time request ids at the Worker; tampering fails the HMAC; privilege escalation is blocked by the RPCs and the locked role grants.
- **Separate credentials:** send secret, admin secret and notify secret are three different Secrets Store secrets per environment. The send secret cannot call an admin route and vice versa.
- **Concurrency:** `expected_version` compare-and-set inside one atomic D1 batch; two administrators cannot overwrite each other.
- **Audit integrity:** D1 `otp_settings_audit` is authoritative. Supabase gets `requested` (before) and `changed` or `failed` (after) events. If D1 succeeded but the Supabase completion step failed, the pending ledger row is reconciled from the D1 audit rows (returned by the signed usage endpoint) the next time the dashboard loads, using a service-role-only RPC so it cannot be forged from a browser.
- **Isolation:** Acceptance and Production each have their own Worker, D1, three secrets, settings row and notify target. An environment's dashboard talks only to its own Worker.

## Frontend and database changes
Supabase forward migration `20261103090001`: the three permissions and their locked role grants, the extended notification event constraint, the pending ledger and the notification ledger (RLS on, no grants), and the RPCs `admin_whatsapp_otp_settings_begin` (authenticated, permission-gated), `..._view_check`, `..._finish`, `..._reconcile` and `whatsapp_otp_notification_record` (service role). Frontend: the permission keys and route rule, nav entry, the `/admin/whatsapp-otp` page (settings, usage, failure rates, thresholds, history, pending notifications), server actions, the signed Worker client, the internal notify route, EN/AR copy including the four notification events.

## Production resources (inspected read-only 2026-11-02)
Present: D1 `aladdin-whatsapp-otp-production` (0001 table and index, 0 rows, no migration tracking table), Secrets Store `WHATSAPP_ACCESS_TOKEN_PRODUCTION`, `PHONE_OTP_WORKER_SECRET_PRODUCTION`. **Not present:** `OTP_ALLOWED_RECIPIENTS_PRODUCTION` in the Secrets Store (not needed and must never be bound), the admin and notify secrets, and the Production Worker. Production runs `OTP_ENVIRONMENT=production`, `OTP_RECIPIENT_MODE=open`, delivery OFF until the approved cutover, and no `SUPABASE_SEND_SMS_HOOK_SECRET`. R2 remains the single authority for verification and single-use grants.

## Testing
Worker real-SQL tests (concurrent claims against a changing limit and ceiling, concurrent updates with one winner, stale version, replay, tampered body, invalid values, ceiling rules, missing row, outbox dedupe, hysteresis, delivery failure and retry, send unaffected by notification failure); pgTAP (permissions and locked grants, begin/finish/reconcile gating, audit rows with actor and old/new, anon, non-admin and Administrator denied, notification fan-out only to `whatsapp_otp.view` holders, ledger idempotency); Vitest (signing, the notify route negatives, actions, view model and copy parity); then every mandatory CI workflow on the final combined commit.

## What is deferred
Meta delivery receipts, a second alert channel, the Production Worker deployment (hosted changes need separate approval), verifying the actual Meta messaging tier.

## Consequences
A launch-blocking but contained feature that keeps enforcement where the cost is incurred, uses only the existing admin authorization, audit and notification systems, and lets the Super Admin tune limits with no deploy.

## Related files
[Production release plan](WHATSAPP_OTP_PRODUCTION_RELEASE_PLAN.md) · [B1 report](B1_REGISTRATION_RECONCILIATION_REPORT.md) · [Worker README](../../edge/whatsapp-otp-worker/README.md) · [Notifications core](../database/notifications-core.md) · [work log](../operations/AGENT_WORK_LOG.md)
