# WhatsApp OTP: Production infrastructure preparation (B3) and Acceptance rehearsal

Status: **prepared, nothing applied.** Written 2026-11-04 on PR #136 (stacked on #127). No hosted resource was created, bound, deployed, migrated or changed. Hosted reads were read-only (D1 `sqlite_master` SELECT, Secrets Store name listing, Workers list). Every step in "Ordered execution plan" needs its own explicit approval.

## 1. Hosted inventory (read-only, 2026-11-04)

| Resource | State |
|---|---|
| D1 `aladdin-whatsapp-otp-production` (`30a16841-1108-47e9-99be-3dc9d827fd87`) | Exists once; 0 rows; no `d1_migrations` table; schema = migration 0001 exactly (section 2) |
| D1 `aladdin-whatsapp-otp-acceptance` (`da65d5e4-8344-4078-9c2d-8a4bb4907f79`) | Exists, untouched |
| Workers | `aladdin-whatsapp-otp-preview` exists; **`aladdin-whatsapp-otp-production` does not exist yet** |
| Secrets Store `acfaa67f391e499db6fde398022f50ce` | 8 secrets, all `workers` scope, `active`, none bound to a Production Worker yet (below) |

Secrets Store (names only; values are never read):

| Environment | Meta token | Send signing | Admin signing | Notify signing |
|---|---|---|---|---|
| Acceptance | `WHATSAPP_ACCESS_TOKEN` | `PHONE_OTP_WORKER_SECRET` | `OTP_ADMIN_SIGNING_SECRET` | `OTP_NOTIFY_SIGNING_SECRET` |
| Production | `WHATSAPP_ACCESS_TOKEN_PRODUCTION` | `PHONE_OTP_WORKER_SECRET_PRODUCTION` | `OTP_ADMIN_SIGNING_SECRET_PRODUCTION` | `OTP_NOTIFY_SIGNING_SECRET_PRODUCTION` |

Eight distinct names and eight distinct creation timestamps. Independence of the VALUES cannot be proven (Secrets Store never returns them); the owner must confirm each was generated separately (see checklist C-1).

Not found: **`OTP_ALLOWED_RECIPIENTS_PRODUCTION`** is not in this Secrets Store. It is not needed (Production is open mode) and must stay unbound. If it was created somewhere else, delete it there or leave it unreferenced.

## 2. Production D1 0001 verification (exact SQL)

The live `CREATE` statements were read from `sqlite_master` and compared, after normalising only `IF NOT EXISTS`, comments, case and whitespace, with `migrations/0001_hook_events.sql`:

- `whatsapp_hook_events`: `event_hash TEXT PRIMARY KEY NOT NULL CHECK(length(event_hash)=64)`, `created_at INTEGER NOT NULL`, `state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','accepted','failed'))` - **identical**.
- Index `whatsapp_hook_events_created_at ON whatsapp_hook_events(created_at)` - **identical**.
- No other object. 0 rows.

This is now repeatable: `scripts/d1-baseline-check.mjs` (read-only; one SELECT) reports `schema.{matching,missing,different,unexpected}`; pinned by `test/d1-baseline.test.ts` using the captured live rows and drift cases (changed CHECK, default, index, extra object).

### Baseline and migration procedure (0001 and 0002) - needs approval to run

0001 and 0002 are idempotent and additive (`IF NOT EXISTS`, `INSERT OR IGNORE`; a test forbids DROP/ALTER/DELETE/UPDATE). 0002 contains no configuration values: the settings row only appears through an audited Super Admin action.

1. `node scripts/d1-baseline-check.mjs aladdin-whatsapp-otp-production` -> expect state `untracked_partial`, `schema.different=[]`, `unexpected=[]`. Anything else: stop.
2. Export a backup first: `wrangler d1 export aladdin-whatsapp-otp-production --remote --output <file>` (empty today; keep as the procedure).
3. `wrangler d1 migrations apply aladdin-whatsapp-otp-production --remote` (config: `wrangler.production.jsonc`). Wrangler creates `d1_migrations`, records 0001 as a no-op and applies 0002.
4. Re-run the check -> expect `current`, all six tables present, `different=[]`.
5. Verify the singleton alert row exists (`otp_alert_state` id 1) and `otp_settings` is **empty** (Worker then answers `503 budget_unconfigured`, fail closed).
6. Rollback: none needed for additive tables; if step 3 fails midway, re-run (idempotent). Never drop tables on Production.

Run the same sequence on Acceptance first (its state is tracked; step 1 will say `tracked_behind`).

## 3. Production Worker configuration (prepared in the repository)

`edge/whatsapp-otp-worker/wrangler.production.jsonc` + guard `scripts/check-production-config.mjs` + 8 tests (`test/production-config.test.ts`). Wired into `WhatsApp OTP Transport CI` (guard + `wrangler deploy --dry-run --config wrangler.production.jsonc`; local bundle, no network).

| Setting | Value |
|---|---|
| Worker name | `aladdin-whatsapp-otp-production` (workers.dev, no routes, no `env.*`) |
| D1 | `IDEMPOTENCY_DB` = `aladdin-whatsapp-otp-production` / `30a16841-...fd87` |
| Secrets Store bindings | `WHATSAPP_ACCESS_TOKEN` <- `WHATSAPP_ACCESS_TOKEN_PRODUCTION`; `OTP_SIGNING_SECRET` <- `PHONE_OTP_WORKER_SECRET_PRODUCTION`; `OTP_ADMIN_SIGNING_SECRET` <- `OTP_ADMIN_SIGNING_SECRET_PRODUCTION`; `OTP_NOTIFY_SIGNING_SECRET` <- `OTP_NOTIFY_SIGNING_SECRET_PRODUCTION` |
| Vars | `OTP_ENVIRONMENT=production`, `OTP_RECIPIENT_MODE=open`, `WHATSAPP_DELIVERY_ENABLED=false`, sender `1458603463983505`, template `aladdin_otp`, `ar`, Graph `v25.0`, `OTP_NOTIFY_URL=https://aladdindecore.com/api/internal/whatsapp-otp/notify` |
| Cron | `* * * * *` (retention, threshold evaluation, alert outbox) |
| Absent on purpose | any `OTP_ALLOWED_RECIPIENTS` (var or binding), any budget var (limits live in D1), `SUPABASE_SEND_SMS_HOOK_SECRET`, Graph override, any Acceptance resource |

The guard refuses: delivery on, allowlist mode, non-production marker, any allowlist, Acceptance name/D1/secret/URL, shared or missing secrets, routes/env blocks, unknown vars, committed numbers/credentials. The Acceptance guard in turn refuses the Production file. Enabling delivery at cutover is a reviewed change to the file AND the guard.

Delivery OFF and the independent kill switch: with `WHATSAPP_DELIVERY_ENABLED=false` the send path answers `503 delivery_disabled` before budget, D1 claim or token. Admin settings keep working (they never read the Meta token).

## 4. Production frontend configuration checklist (no change made)

Target: `aladdin-frontend-production` (`frontend/wrangler.jsonc`, `env.production`). Values the OWNER sets with `wrangler secret put`/dashboard; none is written to the repo.

| Name | Kind | Value / source |
|---|---|---|
| `PHONE_OTP_WORKER_URL` | var | `https://aladdin-whatsapp-otp-production.bstalent9.workers.dev/v1/otp/send` (the admin client uses only its origin) |
| `PHONE_OTP_ADMIN_SECRET` | secret | the SAME `whsec_...` value stored as `OTP_ADMIN_SIGNING_SECRET_PRODUCTION` |
| `PHONE_OTP_NOTIFY_SECRET` | secret | the SAME value stored as `OTP_NOTIFY_SIGNING_SECRET_PRODUCTION` |
| `PHONE_OTP_WORKER_SECRET` | secret | the SAME value as `PHONE_OTP_WORKER_SECRET_PRODUCTION` (needed only at cutover; the admin page does not use it) |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | already required by the existing admin RPC helpers; confirm present |
| Stay OFF / unset | - | `PHONE_VERIFICATION_ENABLED`, `PHONE_SIGNUP_VERIFICATION_ENABLED`, `PHONE_OTP_DELIVERY` (anything but `worker` = off), `PHONE_OTP_HMAC_KEYS` until cutover |

The three `whsec_` values must be identical on both sides, so the owner must hold each value when creating the frontend secret (a Secrets Store value cannot be read back). Format: `whsec_` + base64 of at least 32 random bytes (the env schema and Worker both reject anything shorter).

The Admin page needs only the Worker URL and the admin secret, so limits can be configured while sign-up codes remain OFF.

## 5. Security review (focused)

Scope: Worker `admin.ts`, `settings.ts`, `signing.ts`, `index.ts`, `maintenance.ts`; frontend `notify.ts`, `worker-admin.ts`, `settings-change.ts`, server action, page, reconcile RPC. Semgrep (`p/typescript`, `p/security-audit`, `p/owasp-top-ten`, run locally) scanned all 29 relevant files, **0 findings**; 61 internal rule-engine errors came only from unrelated rule families (crypto-js, express/koa CORS), not skipped files. The earlier "skipped files" were tool-side; they are covered by this run plus the manual review below.

Verified sound:
- **HMAC**: Standard-Webhooks style, 5-minute window, `^\d{10}$` timestamp, constant-time `crypto.subtle.verify`, key must be `whsec_` and >=32 bytes, id may not contain `.`. Three separate secrets and three separate Worker/app entry points; send secret cannot open admin or notify routes.
- **Authenticate before state**: signature checked before parsing, D1 or the replay claim; 404/415/413/503/401 all precede any write.
- **Replay**: `webhook-id` must equal `adm_<request_id>`; one-time `INSERT OR IGNORE` claim of its hash (409 on reuse) AND a UNIQUE `request_id` in the audit table inside the same batch; notify is bound to `ntf_<event_key>` and deduped by a ledger.
- **Authorization**: identity is the server-verified session; the DB (`begin`, service-role only) judges the actor's effective permissions; `ceiling_authorized` is sent only after DB confirmation and the Worker refuses a ceiling change without it, plus a typed confirmation of the new number and a >=20-char reason. A browser cannot reach the Worker or the service-role RPCs.
- **Atomicity**: compare-and-set on `version` with the audit insert in one D1 batch; limit never exceeds ceiling (CHECK constraints in D1 + Worker + RPC); lowering the ceiling below the limit is refused unless both change together.
- **Reconcile**: can only settle an existing `pending` request that matches actor AND expected version+1; it cannot fabricate a change. Stale pending rows are closed as `not_applied`.
- **Notification path**: statistics-only strict schema (key/value regexes, 2 KB cap), 401/400/503 semantics, failures never touch the send path.

Findings:

| # | Severity | Finding | Recommendation |
|---|---|---|---|
| F-1 | Medium (residual risk) | The admin secret is a full-control credential: anyone holding it can sign a change with any `actor_id` and `ceiling_authorized: true`. Such a change would appear in the Worker D1 audit and the page history, but there is **no Supabase request row**, and reconcile silently ignores it. | Before cutover, have reconcile count Worker audit rows without a matching request (`unmatched`) and raise an admin alert; until then, treat the admin secret like a root credential (owner-only, rotate on any doubt). Not a blocker for Acceptance; recommended before Production activation. |
| F-2 | Low | The Worker URL is public (workers.dev). Unauthenticated requests cost a Secrets Store read and a 401 but cannot change state; there is no rate limit. | Accept for first cutover, or move the app to a service binding (`workers_dev=false`) in a follow-up; needs a small frontend change (inject the binding's `fetch`). |
| F-3 | Low | Every Admin page load writes one replay-claim row (`usage`). Purged by cron (250/min, >24 h). | Accept. |
| F-4 | Low | `source_env` in notify is validated for shape but not tied to the receiving environment; protection is the separate notify secret per environment. | Keep Acceptance and Production secrets independent (C-1); optional: reject `source_env` != app environment. |
| F-5 | Info | Notify callback Worker -> `aladdindecore.com` is **unproven hosted**; Acceptance used workers.dev -> workers.dev, and the Admin/Notify secrets did not exist until today. Cloudflare WAF/bot rules on the zone could block the POST. | Prove it in the Acceptance rehearsal (R-8) and, before cutover, with a signed no-op against Production after the secrets are set. |

No critical or high findings.

### Routing from the Production frontend to the Worker

Proposed: HTTPS to `aladdin-whatsapp-otp-production.bstalent9.workers.dev`, HMAC-signed. Evidence: the same pattern (preview frontend -> `aladdin-whatsapp-otp-preview` over workers.dev, with `global_fetch_strictly_public` set in `frontend/wrangler.jsonc`) carried the 2026-11-02 Acceptance send end to end. Admin endpoints cannot bypass authorization: they require the admin HMAC (only the app server holds it), the app derives the actor from the verified session, and the database independently re-checks the permission before the Worker is called; direct calls with the send or notify secret are rejected (negative tests in `whatsapp-otp-admin.test.ts` and `admin.test.ts`). The hosted reachability of the Production URL itself can only be proven after the Worker exists (step 6 below, with delivery still OFF).

## 6. Migration-policy workflow coverage

`CI` ran `migration-policy` only on `pull_request` into `main`, so on the stacked PR (#136 targets an integration branch) it never triggered and the dispatch runs reported it as **skipped** - the check had effectively not run for this PR. Local replay against the PR base (`node scripts/migration-policy.mjs` with the real diff): **no problems** for `20261103090001_whatsapp_otp_admin_settings.sql`; `migration-history-guard`, `migration-policy` and `migration-permission-gate` unit tests pass. Fix prepared: `ci.yml` now triggers on `pull_request` to `main` **and `integration/**`**, so it runs on the next push. Other migration gates (`supabase-rls`: permission gate, pgTAP, upgrade path) already ran green on `b9b68382`.

## 7. Acceptance rehearsal checklist (after approval; Acceptance only)

Prereqs: Acceptance migration `20261103090001` applied; Acceptance D1 migrations applied; Worker redeployed with the admin/notify bindings; frontend-preview has `PHONE_OTP_WORKER_URL`, admin and notify secrets; delivery stays OFF except inside an approved send window; no Production touch.

- R-1 Initial state: Worker `/v1/preflight` shows `settings_initialized=false`, a send attempt (if delivery were on) is `503 budget_unconfigured`; Admin page shows "not configured".
- R-2 Initialise 150 / 5,000 / 70 / 90 as Super Admin with reason and typed ceiling; audit row + Supabase history match; version 1.
- R-3 Change the daily limit only (no ceiling field change, normal reason); then change the ceiling (typed confirmation, >=20-char reason); stale-version submit is refused; double-submit/replay is refused.
- R-4 Refusals: limit > ceiling; ceiling < limit alone; warn >= critical; short reason; wrong confirmation.
- R-5 Permission failures: Administrator sees the page read-only and cannot call the action; a user without `whatsapp_otp.view` is denied; a `manage` holder without `ceiling_manage` cannot change the ceiling; suspended/non-staff denied.
- R-6 Exhausted budget: set a tiny limit (e.g. 2) inside a send window, send to the allowlisted number only, third attempt -> `503 budget_exhausted`, no Meta call; restore the limit.
- R-7 Admin notifications: warning (70 %), critical (90 %), exhausted, failure-rate; each arrives once to staff with `whatsapp_otp.view`, not twice (dedupe), re-arms after usage falls; no email; statistics only; a failing notify endpoint does not affect a send.
- R-8 Notify path: Worker cron outbox -> `/api/internal/whatsapp-otp/notify` delivered (outbox drains); bad signature -> 401.
- R-9 Kill switch independence: `WHATSAPP_DELIVERY_ENABLED=false` blocks sends even with a healthy budget; Admin page and settings still work; re-enabling does not change the budget.
- R-10 Reconcile: simulate an ambiguous finish (applied in Worker, pending in Supabase) and confirm the page reconciles it.
- R-11 Isolation: Acceptance credentials do not authenticate against the Production Worker and the reverse (expect 401).

## 8. Remaining required values / decisions

C-1 Owner confirms the 4 Production and 4 Acceptance secrets were generated independently and that the three `whsec_` values per environment are recorded for the frontend secrets.
C-2 Confirm the Production sender is `1458603463983505` (same as Acceptance; Meta display-name activation was pending) and the Meta messaging limit for it.
C-3 Confirm initial budget values (150 / 5,000 / 70 % / 90 %) or give others.
C-4 Decide F-1 (reconcile `unmatched` alert before cutover) and F-2 (workers.dev vs service binding).
C-5 Confirm the Production frontend URL `aladdindecore.com` for `OTP_NOTIFY_URL`.

## 9. Ordered execution plan (each step separately approved; none performed)

1. Review/merge nothing; push this preparation commit to PR #136 (repo only). CI re-runs, `migration-policy` now included.
2. Acceptance: apply Supabase migration `20261103090001`; run D1 migrations; redeploy Acceptance Worker with the admin/notify bindings; set preview frontend secrets; run the rehearsal R-1..R-11.
3. Fix findings from the rehearsal; decide F-1/F-2.
4. Production D1: backup, baseline check, `migrations apply` (section 2).
5. Production Supabase: apply the migration (after Acceptance sign-off, via the normal release path).
6. Production Worker: deploy `wrangler.production.jsonc` with delivery OFF; verify `/v1/preflight` (signed) shows environment production, open mode, 0 allowlist entries, delivery false, `settings_initialized=false`.
7. Production frontend: set the checklist values (section 4), deploy through the normal Production workflow; verify the Admin page loads and a signed no-op notify returns 400 (not 401/403 from WAF).
8. Super Admin initialises the budget in Production; verify audit and history.
9. Meta limit verification, then the approved cutover (separate change to the config and guard to turn delivery on; a controlled single send first).
