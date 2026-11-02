# Admin-controlled WhatsApp OTP send budget: implementation plan

**Status:** plan for review, **not implemented**. This is the focused plan and the "smallest safe approach" you asked for before any change. It adds no code to the current candidate.

## Purpose
Let authorized administrators view and change the global rolling-24-hour OTP send limit (and its warning thresholds) from the existing Admin Dashboard, per environment, **without deploying the frontend or the Worker**, with a full audit trail, while the budget stays atomic and fail-closed.

## Current decision (proposed, for approval)
**Authoritative settings live in the Worker's own D1, next to the atomic claim.** The Admin Dashboard changes them through a **signed, server-to-server admin endpoint on the Worker**, gated first by the **existing** admin permission and audit infrastructure. Deliver it as **one dependent PR stacked on #127's final head**, then rerun the mandatory CI on the final combined commit.

### Why this is the smallest safe approach
| Option | Verdict |
|---|---|
| Keep `OTP_DAILY_SEND_LIMIT` as an env var | needs a Worker redeploy per change: rejected by requirement 4 |
| Store the limit in Supabase and read it per OTP | one external database request on every OTP, a new availability dependency in the send path: rejected by requirement 5 |
| **Store it in the Worker's D1, change it through a signed admin endpoint** | **no per-OTP external call, no staleness (same database as the claim), no redeploy; reuses Supabase only for authorization and audit** |

### Is it "small"?
It touches four layers (Worker, one Supabase migration, the frontend, tests), so it is not a one-file change and should **not** be folded into the current integration. It is, however, self-contained and additive: no existing authority, grant or verification logic changes. One dependent PR with four reviewable commits is the right unit; splitting it into two PRs would only add a second CI cycle.

## Architecture
```
Admin browser ──▶ Next.js server action (server-only) ──▶ Supabase RPC  begin   [permission check + validation + audit "requested"]
                                   │
                                   └─▶ signed POST  Worker /v1/admin/settings   [separate admin secret, replay claim, optimistic version]
                                                       │ one D1 batch: UPDATE otp_settings + INSERT otp_settings_audit
                                   ┌─◀ result {old, new, version} ◀┘
                                   └─▶ Supabase RPC  finish  [audit "changed" with actor, old, new, time]
Worker send path:  gates ▶ read settings (fail closed) ▶ ONE atomic D1 statement: claim only while claims in 24 h < otp_settings.daily_limit ▶ Meta
```

## Worker changes (`edge/whatsapp-otp-worker`)
**D1 migration `0002_otp_settings.sql`** (additive; Production and Acceptance each apply it to their own D1):
- `otp_settings` (one row, `id = 1`): `daily_limit` (CHECK 1..5000), `warn_percent`, `critical_percent` (CHECK `warn < critical`), `alert_email` (optional), `alert_level`, `version`, `updated_at`, `updated_by` (the Supabase user id, opaque).
- `otp_settings_audit`: `at`, `actor`, `request_id` (UNIQUE), old and new limit and thresholds, `reason`. This is the authoritative record of what was applied.
- `otp_admin_requests`: hashed request ids for replay protection.

**Enforcement:** the claim statement reads the limit **inside the same statement** (`... WHERE (SELECT COUNT(*) ...) < (SELECT daily_limit FROM otp_settings WHERE id = 1)`), so a change applies to the very next claim and concurrent requests cannot overshoot. A pre-read validates the row (integer in `1..MAX_DAILY_LIMIT`, a constant in code so a compromised administrator account cannot set an unbounded value; raising the ceiling needs a reviewed deploy). Missing, invalid or unreadable means `503 budget_unconfigured` **before the token is read**. `WHATSAPP_DELIVERY_ENABLED` stays a separate switch: it is checked first and never consults the budget.

**Admin endpoints (signed POST, never reachable without the admin secret):**
- `POST /v1/admin/usage`: returns the settings, consumed in 24 h (split `accepted / failed / reserved`), remaining, percentage, level, failure ratio (24 h and 7 d), last failure time, and the last 20 audit rows.
- `POST /v1/admin/settings`: body `{ expected_version, daily_limit, warn_percent, critical_percent, alert_email?, reason, actor_id }`. One D1 `batch`: `UPDATE ... WHERE id = 1 AND version = expected_version` then the audit `INSERT ... WHERE changes() = 1`. A stale version answers `409` and changes nothing, so two administrators cannot overwrite each other. First-time initialization uses `expected_version = 0`.
- **Authentication:** a **separate** `OTP_ADMIN_SIGNING_SECRET` (a Secrets Store binding), not the send secret; the same timestamp window and constant-time comparison as the send route; request id `adm_<uuid>` claimed once in `otp_admin_requests`. The send secret can never call an admin route, and the admin secret can never send a message.

**Alerts and retention:** a Cron Trigger (every 5 minutes) computes usage; when the level worsens (`ok` to `warn` to `critical` to `exhausted`) it records `alert_level`, writes a structured `whatsapp_otp_budget_level` log line (numbers only) and emails `alert_email` through the Resend API with a Worker-only Secrets Store key. It also alerts on a high Meta failure ratio over the last hour. The same run purges journal rows older than 7 days. The level resets when usage drops.

## Supabase changes (one forward migration, reusing existing infrastructure)
Following the precedent of `phones.cooldown_override` (`20261021090004`): permission rows in `public.admin_permissions` and the role grants, `app.admin_require(...)` inside `SECURITY DEFINER` RPCs with `search_path = ''`, `app.record_audit_event(...)` for the audit trail, and `service_role`-only execution where the app server is the caller.
- **Permissions:** `whatsapp_otp.view` (Administrator and above) and `whatsapp_otp.manage` (Super Admin by default; the owner decides the mapping). There is **no new authorization system**.
- **RPC `admin_whatsapp_otp_settings_begin(...)`:** checks `manage`, validates bounds and a mandatory reason (10 to 500 characters), writes the audit event `whatsapp_otp.settings_requested` (actor, requested values), returns a request id. A non-administrator never reaches the Worker call.
- **RPC `admin_whatsapp_otp_settings_finish(...)`:** records `whatsapp_otp.settings_changed` (or `..._failed`) with the **authorized actor, the old value, the new value and the timestamp**.
- Regenerate `supabase/permissions/<version>.json` (the permission gate) and the generated types.

## Frontend changes (`frontend`)
- `src/lib/permissions/admin.ts`: the two keys and the route map entry `/admin/whatsapp-otp`.
- `src/server/actions/whatsapp-otp-settings.ts` (server only): re-checks permission through the RPC, calls the Worker with the admin secret, then records the result. The admin secret `PHONE_OTP_ADMIN_SECRET` is added to `src/lib/env/phone-verification.ts` and is **never** sent to the browser or logged.
- `src/app/admin/whatsapp-otp/page.tsx`, modeled on `phone-cooldowns`: current limit, consumed, remaining, percentage and level; delivery-failure statistics; thresholds and alert email; a form with a mandatory reason and a typed confirmation of the new number; the change history. A view-only user sees no form.
- Admin navigation entry and English / Arabic strings.

## Validation and fail-closed matrix
| Case | Result |
|---|---|
| Limit not an integer, `< 1`, `> MAX`, thresholds out of order, reason missing | refused by the RPC, the Worker and the D1 CHECK (three layers) |
| Stale `expected_version` (two admins, double click) | `409`, nothing changes |
| Replay of a signed admin request | refused by the replay claim |
| Worker unreachable, D1 unreadable, settings row missing or invalid | sends nothing (`503 budget_unconfigured`); the dashboard shows the state |
| Concurrent OTP requests at the limit | exactly the limit are claimed (real-SQL test) |
| Admin without `manage` | refused at the RPC and the route; the Worker is never called |
| Budget exhausted | `503 budget_exhausted` before Meta; delivery switch untouched |

The per-phone, per-IP, cooldown, attempt, Turnstile, replay and verification protections are **unchanged**; this adds a layer and removes none.

## Per-environment
Acceptance and Production each have their own Worker, D1 database, admin secret and settings row. An environment's dashboard talks only to that environment's Worker (derived from its `PHONE_OTP_WORKER_URL`), so a change in Acceptance can never reach Production.

## Testing plan
Worker real-SQL tests (concurrent claims against a changing limit, concurrent updates with one winner, stale version, replay, invalid values, missing row, boundaries, cron thresholds); pgTAP (permissions, begin/finish gating, audit rows with actor and old/new, anon and non-admin denied); Vitest (actions, no secret in client output); Playwright with the local rig (Administrator is read-only, Super Admin updates, audit shown). The full mandatory CI then reruns on the final combined commit.

## Suggested delivery
One PR, four commits: Worker, Supabase, frontend, docs and runbook. Interim: the current candidate keeps the env-var budget; the PR removes it. Launch is blocked until this PR is merged and its CI is green.

## Decisions needed from the owner
1. Approve the proposed initial values in the [Production release plan](WHATSAPP_OTP_PRODUCTION_RELEASE_PLAN.md) (150 per 24 h, 70 % and 90 %).
2. The alert channel and recipient (email by default) and whether a Worker-only Resend key is acceptable.
3. Which roles hold `whatsapp_otp.view` and `whatsapp_otp.manage`.
4. The hard ceiling `MAX_DAILY_LIMIT` (proposed 5000).

## What is deferred
All implementation; the second alert channel; Meta delivery receipts.

## Consequences
A launch-blocking but contained feature that keeps enforcement where the cost is incurred, uses the existing admin authorization and audit systems, and needs no deploy to adjust the limit.

## Related files
[Production release plan](WHATSAPP_OTP_PRODUCTION_RELEASE_PLAN.md) · [B1 report](B1_REGISTRATION_RECONCILIATION_REPORT.md) · [Worker README](../../edge/whatsapp-otp-worker/README.md) · [work log](../operations/AGENT_WORK_LOG.md)
