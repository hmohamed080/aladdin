# WhatsApp OTP: Production infrastructure preparation (B3), security decisions and Acceptance execution sequence

Status: **Acceptance A0–A9 CLOSED; A10 OPEN; Production not started.** Updated 2026-11-05 on PR [#136](https://github.com/hmohamed080/aladdin/pull/136) (stacked on #127) after the read-only Production readiness audit. A9 was closed through the approved no-send path (synthetic `reserved` journal rows, no Meta call); its evidence is in the [Production release plan](../security/WHATSAPP_OTP_PRODUCTION_RELEASE_PLAN.md), [RUNTIME_STATE](RUNTIME_STATE.md) and [AGENT_WORK_LOG](AGENT_WORK_LOG.md). A10 — the evidence pack, rollback drill and hosted-login matrix — is the remaining Acceptance gate and must close before any Production database or frontend change. Nothing was created, bound, deployed, migrated or changed by this documentation update; Production access was read-only (`supabase db push --dry-run`, one D1 `sqlite_master` SELECT). Every step in the two execution sequences still needs its own explicit approval.

## 1. Owner decisions recorded (2026-11-04)

| Ref | Decision | Where it lives |
|---|---|---|
| C-1 | All Acceptance and Production secrets stay independent; the owner confirms separate, secure generation and retention. Values are never revealed, logged or compared in chat. | checklist C-1 below |
| C-2 | Sender Phone Number ID `1458603463983505`. The real current Meta messaging limit must be verified before any Production activation; no generic tier is assumed. | release gate G-META |
| C-3 | Initial settings: Daily Send Limit **150** per rolling 24 h, Hard Ceiling **5,000**, Warning **70 %**, Critical **90 %**; all four stay configurable by the Super Admin without redeployment (they live in the Worker's D1, never in config). | Admin page; rehearsal R-2 |
| C-4 / F-1 | The admin-credential authorization gap is a **Production release blocker**: implemented as a database-issued, single-request grant (section 5.1), plus detection of unmatched Worker audit changes and an Admin alert. | PR #136 |
| C-4 / F-2 | Prefer a **Cloudflare Service Binding**: implemented; the Worker has no public address (section 5.2). | PR #136 |
| F-4 | The notification `source_env` is bound to the receiving app's environment; cross-environment alerts are refused (403) even when signed and schema-valid. | PR #136 |
| F-5 | Callback reachability from the Worker (including Cloudflare WAF and bot protection) is an **explicit release gate** with a built-in check (section 5.4). | gate G-NOTIFY |
| C-5 | Production callback host is **`aladdindecore.com`**, route `/api/internal/whatsapp-otp/notify`. | `wrangler.production.jsonc` |

Also fixed by the owner: preserve the prepared Production D1 and the existing Secrets Store entries; no duplicate resources; no allowlist dependency; no Supabase Send-SMS hook; the existing Admin notification system only (no email, no Resend).

## 2. Hosted inventory (read-only, 2026-11-04; refreshed 2026-11-05)

| Resource | State |
|---|---|
| D1 `aladdin-whatsapp-otp-production` (`30a16841-1108-47e9-99be-3dc9d827fd87`) | Exists once; 0 rows; no `d1_migrations` table; schema = migration `0001` exactly (section 3) |
| D1 `aladdin-whatsapp-otp-acceptance` (`da65d5e4-8344-4078-9c2d-8a4bb4907f79`) | Exists, untouched |
| Workers | `aladdin-whatsapp-otp-preview` exists (public workers.dev today); **`aladdin-whatsapp-otp-production` does not exist yet** |
| Secrets Store `acfaa67f391e499db6fde398022f50ce` | 12 secrets, all `workers` scope, `active`, none bound to a Production Worker (there is no Production Worker yet) |

| Environment | Meta token | Send signing | Admin signing | Notify signing | **Admin grant key (new, required)** |
|---|---|---|---|---|---|
| Acceptance | `WHATSAPP_ACCESS_TOKEN` | `PHONE_OTP_WORKER_SECRET` | `OTP_ADMIN_SIGNING_SECRET` | `OTP_NOTIFY_SIGNING_SECRET` | `OTP_ADMIN_GRANT_SECRET` (created; one row provisioned in A3) |
| Production | `WHATSAPP_ACCESS_TOKEN_PRODUCTION` | `PHONE_OTP_WORKER_SECRET_PRODUCTION` | `OTP_ADMIN_SIGNING_SECRET_PRODUCTION` | `OTP_NOTIFY_SIGNING_SECRET_PRODUCTION` | `OTP_ADMIN_GRANT_SECRET_PRODUCTION` (created; Production database row still absent) |

The two **grant key** secrets are the only new resources the F-1 hardening needs. Both Secrets Store entries now exist; the Acceptance key was provisioned into the Acceptance database in A3, while the Production database row is still absent (P-1). The grant key value must be inserted once into the matching Supabase database because the database is what issues grants.

Not found: `OTP_ALLOWED_RECIPIENTS_PRODUCTION` is not in this Secrets Store. It is not needed (Production is open mode) and the guard forbids any allowlist binding.

## 3. Production D1 `0001` verification (exact SQL) and baseline procedure

The live `CREATE` statements were compared, after normalising only `IF NOT EXISTS`, comments, case and whitespace, with `migrations/0001_hook_events.sql`: table `whatsapp_hook_events` (columns, PRIMARY KEY, `CHECK(length(event_hash)=64)`, `DEFAULT 'reserved'`, the state CHECK) and index `whatsapp_hook_events_created_at` are **identical**; no other object; 0 rows. Repeatable with `node scripts/d1-baseline-check.mjs aladdin-whatsapp-otp-production` (read-only, one SELECT), which now reports `schema.{matching,missing,different,unexpected}`; pinned by `test/d1-baseline.test.ts`.

Baseline (needs approval): (1) the check must say `untracked_partial`, `different=[]`, `unexpected=[]`; (2) `wrangler d1 export` backup; (3) `wrangler d1 migrations apply aladdin-whatsapp-otp-production --remote --config wrangler.production.jsonc` records `0001` as a no-op and applies `0002` (additive, idempotent, no configuration values); (4) re-run the check: `current`, six tables present; (5) `otp_settings` is empty, so the Worker answers `503 budget_unconfigured`. No rollback is needed for additive tables; re-run is idempotent; never drop tables in Production. Acceptance first (its state is `tracked_behind`).

## 4. Production Worker configuration (prepared in the repository)

`edge/whatsapp-otp-worker/wrangler.production.jsonc`, guard `scripts/check-production-config.mjs`, `test/production-config.test.ts`, wired into `WhatsApp OTP Transport CI` together with `wrangler deploy --dry-run --config wrangler.production.jsonc` (local bundle, no network).

| Setting | Value |
|---|---|
| Worker | `aladdin-whatsapp-otp-production`, **private**: `workers_dev=false`, `preview_urls=false`, no routes, no `env.*` |
| D1 | `IDEMPOTENCY_DB` = `aladdin-whatsapp-otp-production` / `30a16841-...fd87` |
| Secrets Store bindings (5, distinct, all `*_PRODUCTION`) | `WHATSAPP_ACCESS_TOKEN`, `OTP_SIGNING_SECRET`, `OTP_ADMIN_SIGNING_SECRET`, `OTP_NOTIFY_SIGNING_SECRET`, `OTP_ADMIN_GRANT_SECRET` |
| Vars | `OTP_ENVIRONMENT=production`, `OTP_RECIPIENT_MODE=open`, `WHATSAPP_DELIVERY_ENABLED=false`, sender `1458603463983505`, template `aladdin_otp`, `ar`, Graph `v25.0`, `OTP_NOTIFY_URL=https://aladdindecore.com/api/internal/whatsapp-otp/notify` |
| Cron | `* * * * *` (retention, thresholds, alert outbox) |
| Absent on purpose | any allowlist var or binding, any budget var, the SMS-hook secret, a Graph override, any Acceptance resource |

The guard refuses: a public address or preview URLs, delivery on, allowlist mode, a non-production marker, any allowlist, Acceptance name/D1/secrets/URL, a missing, shared or extra secret, routes/env blocks, unknown vars, committed numbers or credentials. The Acceptance guard (`check-preview-config.mjs`) now also requires a private Worker and the Acceptance grant key, and refuses the Production file. With delivery OFF the send path answers `503 delivery_disabled` before any budget, claim or token access (kill switch independent of the budget).

## 5. Security decisions

### 5.1 F-1: database-issued grant (preventive control)

**Assessment.** Yes, a server-issued, single-request authorization linked to a verified Supabase request is a practical preventive control and adds **no database call to the OTP send path** (it is checked only on `POST /v1/admin/settings`, a Super Admin action; the send path is untouched).

**Design.** The signed `begin` RPC (service role; it already checks the actor's effective permissions in the database) now also returns a **grant**: `base64(HMAC-SHA256(grant_key, "v1|request|actor|expected_version|daily|ceiling|warn|critical|ceilingAuthorized|expiry|sha256(reason)"))`, valid 5 minutes. The grant key exists only in the Supabase database (closed table `app.whatsapp_otp_grant_key`, no client or service-role access) and the Worker's Secrets Store (`OTP_ADMIN_GRANT_SECRET[_PRODUCTION]`); **the app server never holds it**. The Worker rebuilds the same string from the request it receives and verifies the HMAC in constant time before the replay claim; any difference in actor, values, version, reason, ceiling flag, request id or expiry is `403 grant_invalid`. `ceiling_authorized` is now backed by the grant, so it cannot be flipped. An unbound grant secret, or a database without the key, fails closed (`503 grant_unconfigured` / `grant_key_unconfigured`).

**What it prevents.** A leaked or misused **admin signing secret** (log, secret store read, Worker-side leak, replay tooling) can authenticate a request but can no longer apply a change, impersonate an administrator or authorize a ceiling change: it would also need a fresh grant minted by the database for that exact request. Tests: 8 Worker negatives (no grant, wrong key, each tampered field including actor and ceiling flag, expired, far-future, malformed, unbound) and 24 pgTAP assertions (G1-G24).

**Residual risk (stated honestly).** Someone holding the Supabase **service-role key** can still call `begin` for a real Super Admin; that key already grants full database access and is out of scope for this control. Detection covers it (below). Treat `OTP_ADMIN_SIGNING_SECRET*`, `OTP_ADMIN_GRANT_SECRET*` and the service-role key as root credentials.

**Detection of unmatched changes.** Every Admin page view (and every settings change) reconciles the Worker's authoritative audit against Supabase. A Worker change with no approved request for that actor, version **and values** (or one not recorded as applied) raises `whatsapp_otp.audit_unmatched`, once per version/time, to active, non-suspended staff holding `whatsapp_otp.view`, through the existing notification system (statistics only: the version number; no email, no Resend). Tests G13-G24 (no request, mismatched values, dedupe, no double alert, malformed rows skipped, recipients, closed function). Limitation: detection runs when an admin opens the page or changes a setting; a scheduled trigger in the app would remove that dependency (follow-up, not a blocker because the grant is preventive).

### 5.2 F-2: Service Binding (private frontend-to-Worker route)

**Decision: implemented; the Worker has no public address.**
- *Frontend changes:* `server/whatsapp-otp/worker-binding.ts` selects the transport; the binding `OTP_WORKER` is added to `frontend/wrangler.jsonc` for `env.preview` (`aladdin-whatsapp-otp-preview`) and `env.production` (`aladdin-whatsapp-otp-production`); the delivery runtime, the Admin page and the Admin actions pass the binding's `fetch` into the already-injectable clients (no change to the signing or grant logic). Policy (tested): the binding is used whenever present; **production, an unknown or unreadable environment never fall back to a public URL**; only explicit `local`/`staging` may use `PHONE_OTP_WORKER_URL` as a plain URL. With the binding, only the URL's *path* matters, so `PHONE_OTP_WORKER_URL` can be a non-routable placeholder such as `https://aladdin-whatsapp-otp.internal/v1/otp/send`.
- *Deployment requirements:* the target Worker must exist before the frontend that binds it is deployed (otherwise Cloudflare refuses that frontend deploy, a safe failure that leaves the running version in place). **Gate:** do not run the Production frontend deploy after this commit lands on the deploy branch until `aladdin-whatsapp-otp-production` exists; the Worker is therefore deployed first (Production step P-6) and the registration flows (email, Google, Facebook, existing accounts) are untouched because phone sign-up stays OFF.
- *Mobile compatibility:* mobile apps never contact the Worker. They use the Aladdin API (this app / Supabase), which calls the Worker over the binding; nothing about the binding limits future native clients.
- *Rollout safety:* Acceptance moves first and exercises the identical path; the Worker's own HMAC, replay claim and grant remain in force (defence in depth); rollback is a Worker/frontend version revert (section 8). A temporary public alternative is **not** enabled and is not needed. If one ever is (for example a Cloudflare limitation found in the rehearsal), it requires an explicit owner approval and must add: HMAC (already), a Cloudflare rate-limiting rule on the route, monitoring of 401/403/429 rates, and removal within the same release.
- *Operational consequence:* a private Worker cannot be probed from outside. The signed admin usage answer now carries the non-secret runtime facts (environment, recipient mode, delivery switch, which bindings are present, never a value), shown on the Admin page ("Sending service"), replacing the public preflight for verification. `scripts/worker-preflight.mjs` and the Meta preflight are no longer usable against a private Worker; use the Admin page.

### 5.3 F-4: notification environment binding

The receiving app trusts exactly one Worker environment: production app <- `production`, staging (Acceptance) app <- `acceptance`, local <- `local`. After signature and schema validation, any other `source_env` (including `local`, `worker`, `unknown`) is `403` and **nothing is recorded**; an app that cannot determine its own environment answers `503`. A prototype-key bug found by the new test (`__proto__`) was fixed with an own-key lookup. Tests: environment map, both cross-environment directions, odd names, matching acceptance, unknown environment.

### 5.4 F-5: Production callback reachability, an explicit release gate (G-NOTIFY)

The Worker calls `https://aladdindecore.com/api/internal/whatsapp-otp/notify` over the public internet, through Cloudflare's edge for that zone (WAF, bot rules, rate limits apply). The only meaningful test originates **from the Worker**, not a laptop. `POST /v1/admin/notify-check` (admin-signed, single-use; Admin page button "Test the alert connection", Super Admin only) makes the Worker send **one correctly signed, deliberately invalid probe** (`{"probe":true}`) to the pinned URL and report a category only:

| Result | Meaning |
|---|---|
| `reachable` | the app answered 400: edge passed it, the signature matched, the schema refused, nothing recorded, nobody notified |
| `secret_mismatch` | 401: the Worker and the app hold different notify keys |
| `blocked_by_cloudflare` | `cf-mitigated: challenge`: WAF/bot protection intercepts the call (add a narrow skip rule for `POST /api/internal/whatsapp-otp/notify`, re-test) |
| `refused` | 403 without a challenge: wrong environment or another security rule |
| `app_unconfigured` | 503: the app lacks `PHONE_OTP_NOTIFY_SECRET` or cannot tell its environment |
| `unreachable` / `unexpected` / `not_configured` | network failure, other status or redirect, or the Worker has no URL/secret |

**Release gate:** `reachable` must be recorded on Acceptance (rehearsal R-8) **and** on Production (step P-9) before any Production activation. Review Security Events in the Cloudflare dashboard during the Production check.

### 5.5 Findings status

| # | Finding | Status |
|---|---|---|
| F-1 | Admin credential could silently impersonate | **Resolved** (grant + detection + alert); residual risk documented |
| F-2 | Public Worker address | **Resolved** (service binding, no public address) |
| F-3 | One replay row per Admin page load | Accepted (purged by cron) |
| F-4 | `source_env` not tied to the app | **Resolved** |
| F-5 | Callback reachability unproven | **Gate defined and implemented**; must pass on Acceptance and Production |

Semgrep (`p/typescript`, `p/security-audit`, `p/owasp-top-ten`, local run on the original review set) found 0 findings and scanned every relevant file; its 61 errors were internal rule-engine errors in unrelated rule families. It is re-run on the final candidate (see PR).

## 6. Migration-policy workflow coverage

`CI` ran `migration-policy` only for pull requests into `main`; stacked PR #136 (base = an integration branch) therefore showed it as skipped. `ci.yml` now triggers on pull requests into `main` **and `integration/**`**; on commit `096395eb` the job ran and passed. The migration was also replayed locally against the PR base (`migration-policy.mjs`: no problems), with the history guard, policy and permission-gate unit tests, and the pgTAP suites that pin the audit and notification vocabularies (33, 42, 108, 121).

## 7. Frontend configuration checklist (no change made)

Targets `aladdin-frontend-preview` (Acceptance) and `aladdin-frontend-production`. Values are set by the owner; none is written to the repository.

| Name | Kind | Value / source |
|---|---|---|
| `OTP_WORKER` | service binding (in `frontend/wrangler.jsonc`) | `aladdin-whatsapp-otp-preview` / `aladdin-whatsapp-otp-production`; **the Worker must exist first** |
| `PHONE_OTP_WORKER_URL` | var | a placeholder such as `https://aladdin-whatsapp-otp.internal/v1/otp/send` (host unused with the binding; path `/v1/otp/send` matters) |
| `PHONE_OTP_ADMIN_SECRET` | secret | the SAME `whsec_...` value as `OTP_ADMIN_SIGNING_SECRET[_PRODUCTION]` |
| `PHONE_OTP_NOTIFY_SECRET` | secret | the SAME value as `OTP_NOTIFY_SIGNING_SECRET[_PRODUCTION]` |
| `PHONE_OTP_WORKER_SECRET` | secret | the SAME value as `PHONE_OTP_WORKER_SECRET[_PRODUCTION]` (cutover only) |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | already required by the admin RPC helpers; confirm present |
| **Never on the frontend** | - | `OTP_ADMIN_GRANT_SECRET*` (the app server must not hold the grant key) |
| Stay OFF / unset | - | `PHONE_VERIFICATION_ENABLED`, `PHONE_SIGNUP_VERIFICATION_ENABLED`, `PHONE_OTP_DELIVERY`, `PHONE_OTP_HMAC_KEYS` until cutover |

The three `whsec_` values must be identical on both sides, so the owner must retain each value (a Secrets Store value cannot be read back). Format: `whsec_` + base64 of >= 32 random bytes. The grant key reaches the Supabase database **only** through the reviewed helper in section 11 (never through SQL text, the SQL Editor, an argument, a file or chat).

## 8. Remaining values and owner actions

- **C-1** owner confirms independent generation and secure retention of all secrets (Acceptance and Production, including the two new grant keys).
- **C-6** owner creates `OTP_ADMIN_GRANT_SECRET` (Acceptance) and `OTP_ADMIN_GRANT_SECRET_PRODUCTION` (Production) in the Secrets Store, and inserts the same bytes into the matching Supabase database (once per environment).
- **G-META** the owner (or an approved read-only lookup) records the real current messaging limit tier and quality rating of Phone Number ID `1458603463983505` from Meta (Business Settings, or the Phone Number node's `messaging_limit_tier`/`quality_rating`), compares it with the approved budget, and attaches the evidence to the release record. Not assumed; required before Production activation.
- **G-NOTIFY** as in section 5.4.

## 9. Release blockers (updated)

| # | Blocker | State |
|---|---|---|
| B2 | Mandatory CI on the final combined commit | **open**: #127 is green on `512c3e52`; #136 (`f910bcd0`) has no retrievable check runs; no combined commit exists yet |
| B3 | Production Worker, D1 baseline, secrets, config guard | config + guard + `wrangler.production.jsonc` prepared; Production D1 = `0001` only; Worker absent; hosted steps pending approval |
| B3-F1 | Admin grant + unmatched detection + alert | **implemented**; both Secrets Store grant keys exist; Production database row pending (P-1) |
| B3-F2 | Private service-binding transport | **implemented**; Production frontend deploy gated on the Worker existing |
| B3-F4 | Environment-bound notifications | **implemented** |
| G-NOTIFY | Callback reachability incl. WAF/bot, Acceptance and Production | open |
| G-META | Verified Meta messaging limit for the sender | open |
| B4 | Production app secrets and bindings | pending approval |
| B5 | Acceptance rehearsals (below), enforce/observe rollback, build-swap drill, email/Google/Facebook/legacy login on the new build | **open — A10 only**: the hosted-login matrix, build-swap and `enforce → observe` drills remain |
| B6/B7 | Upload-only deploy stage; approvals and planned window | **open**: no upload-only stage; approvals, window, budget and alert channel unconfirmed |

## 10. Acceptance execution sequence (each step separately approvable; stop after each)

**Execution status (2026-11-05):**

| Step | Status | Evidence / remaining work |
|---|---|---|
| A0–A8 | **CLOSED** | Acceptance execution record in [RUNTIME_STATE](RUNTIME_STATE.md) and [AGENT_WORK_LOG](AGENT_WORK_LOG.md) |
| A9 | **CLOSED — approved no-send path** | Synthetic `reserved` journal rows at 105/135/150 produced the warning, critical and exhausted alerts exactly once each (HTTP 200, two recipients); cleanup returned usage to 0, the cron lowered `budget_level` to 0, and `episode=3`, the delivered outbox rows and the A8 evidence were preserved. No Meta message was sent. Full evidence: [Production release plan](../security/WHATSAPP_OTP_PRODUCTION_RELEASE_PLAN.md) |
| A10 | **OPEN — next Acceptance gate** | Evidence pack; preview frontend and Worker rollback drill; hosted email/Google/Facebook/legacy-phone login on the new build |
| P-0–P-9 (infrastructure, sending OFF) | **NOT STARTED** | Gated by B2, B6 and the owner approvals in B7, each with its own verification and rollback. **Not blocked by A10:** every one of these steps leaves delivery OFF (environment permit not `"true"` and no D1 switch row), so deploying them cannot send a message. After P-7 the email/Google/Facebook/legacy sign-in smoke is run on the Production build, with the recorded rollback ready |
| P-10 and the cutover (live OTP activation) | **NOT STARTED** | **Blocked on A10** (evidence pack, rollback drill, hosted login matrix) and on a separate owner approval |

Principles: Acceptance only; no Production resource is written (read-only Production checks are allowed and recorded in section 12); WhatsApp delivery stays **OFF** except inside an explicitly approved send window; no step changes existing registration, which stays on email/Google/Facebook with phone sign-up OFF. Every step lists its verification and rollback.

**A0. Migration preflight (read-only).** (a) Confirm CI is green on the final candidate commit (all mandatory workflows plus `migration-policy`); (b) `node scripts/migration-policy.mjs` against the PR base: no problems; (c) `node scripts/migration-permission-gate.mjs` result from `supabase-rls`; (d) read the Acceptance Supabase migration history (`supabase migration list`/`db push --dry-run` against the linked Acceptance project): exactly `20261103090001` is pending and nothing else; (e) `node scripts/d1-baseline-check.mjs aladdin-whatsapp-otp-acceptance`: `tracked_behind` with `schema.different=[]`; (f) confirm the Acceptance preview frontend and Worker current versions (record ids for rollback); (g) confirm Secrets Store holds the Acceptance names including `OTP_ADMIN_GRANT_SECRET` (after C-6). Output: a go/no-go note. *No hosted change.*

**A1. Owner: Acceptance grant key.** Owner creates `OTP_ADMIN_GRANT_SECRET` (Secrets Store) and keeps the value. *Rollback:* delete the unused secret.

**A2. Apply Supabase migration `20261103090001` to Acceptance.** Verify: the six functions + helper exist, the permission contract passes, ledgers and `app.whatsapp_otp_grant_key` are empty, `begin` raises `grant_key_unconfigured`, the new permissions exist with Super Admin = view/manage/ceiling_manage and Administrator = view. *Rollback:* none destructive (additive); forward-fix migration if needed.

**A3. Owner: provision the Acceptance grant key** with `scripts/hosted-db/provision-grant-key/provision-grant-key.mjs` (section 11): a dry run first, then `--write` after a typed confirmation. Verified by a non-sensitive fingerprint and a row count; the key is never read back. Adds no migration and no schema change.

**A4. Acceptance D1: backup and `migrations apply` (0002).** `wrangler d1 export`, then apply; baseline check says `current`, `otp_settings` empty. *Rollback:* none needed (additive).

**A5. Deploy the Acceptance Worker (private, five bindings, delivery OFF).** `check-preview-config.mjs` PASS and dry-run first. This removes the public workers.dev address; Acceptance phone codes are unavailable until A6 completes (the feature is OFF in Acceptance). Verify from the dashboard: no workers.dev route, bindings present, `WHATSAPP_DELIVERY_ENABLED=false`. *Rollback:* redeploy the previous Worker version `4d41419c` (public) - recorded in A0.

**A6. Acceptance frontend: secrets, vars and deploy.** Owner sets `PHONE_OTP_ADMIN_SECRET`, `PHONE_OTP_NOTIFY_SECRET`, `PHONE_OTP_WORKER_URL` placeholder on `aladdin-frontend-preview`; deploy the preview build containing the `OTP_WORKER` binding. Verify: the Admin page loads for a Super Admin and shows "Not configured" plus the "Sending service" card (environment `acceptance`, sending Off, bindings "All in place"). *Rollback:* redeploy the previous preview version.

**A7. Connection gates.** Admin page > "Test the alert connection" must report `reachable` (G-NOTIFY, Acceptance). Verify that an Administrator sees the page read-only and a user without `whatsapp_otp.view` is denied.

**A8. Rehearsal without any WhatsApp message (R-1..R-6, R-10..R-12).** R-1 initial state (`503 budget_unconfigured` path is covered by tests; the page shows "not configured"); R-2 initialize 150 / 5,000 / 70 / 90 with reason and typed ceiling; R-3 change the daily limit; change the ceiling (typed confirmation, >= 20-char reason); stale-version and double-submit refused; R-4 refusals (limit > ceiling, ceiling < limit, warn >= critical, short reason, wrong confirmation); R-5 permission failures (Administrator view-only, manage-without-ceiling cannot change the ceiling, no-view denied, suspended denied); R-10 reconcile of an applied-but-pending change; R-11 environment isolation (Acceptance credentials do not work against anything Production; the notify environment binding refuses a `production` event); R-12 **unmatched detection**: with approval, insert one audit row directly in the Acceptance D1 (a break-glass simulation), open the page, and confirm one `audit_unmatched` Admin notification, no duplicate on refresh, and that the grant still blocks a forged call. *Rollback:* restore the settings through the Admin page; delete the simulated D1 audit row.

**A9. Alert and exhaustion rehearsal (needs a separate approval for any WhatsApp send).** In an approved window with delivery ON for the allowlisted Acceptance number only: set a small limit, observe warning / critical / exhausted notifications (once each, re-armed after usage falls, no email), then the third attempt answers `budget_exhausted` with no Meta call; R-9 kill-switch independence (delivery OFF blocks sends while the Admin page and settings still work). Restore limit 150 and delivery OFF. Alternative without sending: a D1 console insert of journal rows to reach the thresholds (separate approval). **Status: CLOSED (2026-11-05)** through the approved no-send alternative; see the status table above and the [release plan](../security/WHATSAPP_OTP_PRODUCTION_RELEASE_PLAN.md). No Meta send occurred.

**A10. Evidence and rollback drill.** Record the results (screenshots, counts, no secrets); drill the rollback of the preview frontend and Worker to the recorded versions; confirm email/Google/Facebook/legacy sign-in on the new Acceptance build (existing registration undisturbed). **Status: OPEN — this is the remaining Acceptance gate before LIVE OTP ACTIVATION (P-10 and the cutover). It does not block Production infrastructure steps P-0 to P-9, which keep sending OFF.**

Stop after A10 and report. Production infrastructure preparation (P-0 to P-9, sending OFF) does not wait for A10; only live activation does:

**P-0** repeat the preflight for Production; **P-1** owner creates the Production grant key (C-6) and inserts it in the Production database after **P-2** the Supabase migration; **P-3** Production D1 backup and baseline (section 3); **P-4** owner sets the Production frontend values (section 7, no public Worker); **P-5** guard + dry-run; **P-6** deploy the private Production Worker with delivery OFF; **P-7** deploy the Production frontend (only now, because of the binding gate); **P-8** Super Admin initialises 150 / 5,000 / 70 / 90 and verifies audit and history; **P-9** G-NOTIFY on Production and Security Events review; **P-10** G-META evidence; then the separately approved cutover (a reviewed change of `wrangler.production.jsonc` and its guard to enable delivery, a controlled single send first).

## 11. A3 helper: secure one-time provisioning of the Acceptance grant key

**Where:** `scripts/hosted-db/provision-grant-key/` (`provision-grant-key.mjs`, the pinned Supabase Root 2021 CA, unit and integration tests). Owner-executed on the owner's machine. It adds no migration, no DDL, no dependency and no lockfile: it loads the repo's own pinned `postgres@3.4.9` (root `pnpm-lock.yaml`, via `edge/media-worker`) and refuses any other version. Install the normal way: `pnpm install --frozen-lockfile` at the repo root.

**Prerequisites:** A2 applied (done); the Acceptance Secrets Store entry `OTP_ADMIN_GRANT_SECRET` exists (done) and its `whsec_...` value is in your password manager; the Acceptance **database password** (Supabase Dashboard > Project Settings > Database; reset it there only if you do not have it) and a **Session pooler** connection string (Dashboard > Connect > Session pooler, `postgresql://postgres.nxossqhdfltcqdwvbewi:<password>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`).

**Run (an interactive terminal, ideally with shell history disabled):**
1. `node scripts/hosted-db/provision-grant-key/provision-grant-key.mjs` - **dry run**. Paste the connection string at the first hidden prompt and the key at the second (nothing is echoed). It validates, connects, verifies the target and reports; **it writes nothing**.
2. Compare the printed key fingerprint (12 hex characters of SHA-256) with your own record if you keep one.
3. `node scripts/hosted-db/provision-grant-key/provision-grant-key.mjs --write` - enter both again, type `PROVISION ACCEPTANCE` when asked. It inserts one row in one transaction, verifies it **before COMMIT** and again after, and prints only: rows (expected 1), fingerprint match, schema signature unchanged, migration history unchanged.
4. Close the terminal. Clear the clipboard.

**Safeguards (all unit-tested; the real driver path is integration-tested against a local Postgres):**

| Control | Behaviour |
|---|---|
| Input | key and connection string are accepted **only** at hidden prompts of an interactive terminal; any argument other than `--write`/`--help` is a usage error; never read from files, environment variables or pipes |
| Format | `whsec_` + canonical base64, decoded length >= 32 bytes (same rule as the Worker and the table CHECK), at least 16 distinct byte values; checked **before** any connection |
| SQL | constant statements; the key is only the bound `bytea` parameter `$1` of `insert ... values (1, $1)`; never interpolated, concatenated or logged |
| Target | the URI must be the Acceptance pooler (`postgres.nxossqhdfltcqdwvbewi` on `*.pooler.supabase.com`) or the Acceptance direct host; **the Production reference anywhere in the URI (also upper case or percent-encoded) is refused before any network use**; wrong database, port or scheme refused |
| TLS | verified against the pinned Supabase Root 2021 CA (SHA-256 `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`, check it in Dashboard > Database > Settings > SSL) and the host name; no unverified fallback |
| Independent identity checks (read-only transaction) | PostgreSQL 17.11 (Acceptance; Production differs), migration `20261103090001` applied, `app.whatsapp_otp_grant_key` present with RLS on and **0 rows** |
| No overwrite | any existing row stops the run; the write transaction takes an exclusive lock and re-checks the count; `on conflict do nothing` as a last guard |
| Verification | fingerprint of the stored key computed **inside the database** (`sha256(key)`) and compared with the local value before COMMIT (mismatch = rollback) and again after; row count 1; schema signature (relations, functions, constraints, policies, triggers) and migration history identical before and after |
| Output | one scrubbing channel; any registered secret (key, URI, password, hash) is replaced by `[hidden]`; errors are reported by code only |
| Cleanup | the key bytes are zeroed, the connection is closed, no file is written; JavaScript strings cannot be wiped, so close the terminal afterwards |
| Migration history | pure data write: no DDL, no migration file, no `schema_migrations` change (asserted) |

**If the step fails or is interrupted:** nothing is half-written (single transaction). Re-run the dry run; "a grant key already exists" means it is done or needs a reviewed rotation. Rotation is not part of this helper. **Production** uses the same procedure only after a separate approval, with its own prerequisites and a hardened Production variant of the identity checks; this helper refuses Production by design.

**Functional proof (not part of A3):** at A8 a real change through the Admin page must succeed; a key mismatch between the database and `OTP_ADMIN_GRANT_SECRET` makes the Worker answer `grant_invalid`, which fails safely.

## 12. Production migration dry run and D1 baseline (read-only, 2026-11-05)

No migration was applied: the command is a dry run and only reports the pending set. The CLI targeted Production explicitly; the linked Acceptance project was not the target.

**Update 2026-11-05 (delivery switch): the Production plan below now lists EIGHT Supabase migrations, not seven.** The Super Admin ON/OFF delivery switch (next section) adds `20261107090003_whatsapp_otp_delivery_switch` to #136. The seven approved migrations are unchanged and keep their order; the new one sorts last. Any dry run taken before this change is superseded: repeat `supabase db push --dry-run` from the new #136 head and expect exactly those eight, still without `20261105090001` (PR #137). **Ordering consequence for #137:** its `20261105090001` now sorts BEFORE `20261107090003`, so if #136 reaches Production first, #137's migration would later be out of order there (it needs `migration-policy: out-of-order-reviewed` and `db push --include-all`, or a rename through `retired-versions.json`). That choice is the owner's and must be made before #137 is promoted. The Worker D1 side gains one more idempotent migration, `0003_delivery_switch.sql` (two tables, no rows); the D1 baseline check derives its expectations from the migration files, so it reports it as pending until applied.

**Supabase migration dry run.** From the #136 head (`f910bcd0`), which contains the Admin settings migration:

```
supabase db push --dry-run --remote=kkpkgjrweysgvhvkhzun
```

reported **exactly 7** pending migrations, in this order: `20261028090001`, `20261028090003`, `20261029090001`, `20261029090002`, `20261030090001`, `20261030090002`, `20261103090001`. `20261105090001_admin_staff_invitations` (PR #137 lineage) is **absent** and must stay out of the Production push.

The same command from the #127 head (`512c3e52`, plus the local docs commit) lists only **6** — it omits `20261103090001` because #136 is not merged yet. **Consequence: the Production database step must run after #136 is merged into #127 and the combined commit is green; running it from #127 alone would leave the Admin settings schema out of Production.**

Production history remains 193 applied, latest `20261027090001`, zero of the seven present, zero newer versions, zero applied-not-in-repo rows, and no `app.phone_verification_config`.

**D1 baseline** (`node scripts/d1-baseline-check.mjs aladdin-whatsapp-otp-production`, one SELECT):

| Field | Result |
|---|---|
| `state` | `untracked_partial` |
| `tracked` | `false` (no `d1_migrations`) |
| `presentTables` | `whatsapp_hook_events` only |
| `missingTables` | `otp_settings`, `otp_settings_audit`, `otp_admin_requests`, `otp_alert_state`, `otp_notification_outbox` |
| `schema.matching` | `whatsapp_hook_events`, `whatsapp_hook_events_created_at` |
| `schema.different` / `unexpected` | none |
| next step (not executed) | `wrangler d1 migrations apply aladdin-whatsapp-otp-production --remote` (records `0001` as a no-op, applies `0002`) |


## 13. Super Admin delivery ON/OFF switch (code complete in the repository; nothing applied anywhere)

The read-only "Sending: On/Off" status on `/admin/whatsapp-otp` is replaced by a real, backend-persisted switch.

**Two independent gates, both fail closed.** Sending needs (a) the **environment permit** `WHATSAPP_DELIVERY_ENABLED = "true"` (set only by a deployment; Production and the Acceptance preview stay `"false"`, unchanged and still guarded by `check-production-config` / `check-preview-config`) **and** (b) the **Super Admin switch**, a row in the Worker's own D1 (`otp_delivery_switch`, migration `0003_delivery_switch.sql`). No row = OFF; an OFF row, an unreadable table and a missing database are all OFF. The send path reads the row on every request (no cache), after the signature, schema, recipient and database checks and before the replay claim, the token read and Meta, so OFF takes effect on the very next request and never touches Meta. An environment that already had the permit "true" therefore becomes **OFF until a Super Admin turns the switch on**: the change can only make sending stricter.

**Who and how.** `whatsapp_otp.manage` (Super Admin) toggles; Administrator (`whatsapp_otp.view`) sees the same state read-only (a badge and the same helper text, no control). The control is a real `role="switch"`; clicking opens a confirmation that requires a reason (10-500 characters) and never changes anything by itself. The form carries only the version the admin saw, the requested state and the reason; the actor and permissions always come from the verified session.

**Request chain (same security design as the limits).** Server action -> read the Worker's current state (never trusted from the browser; optimistic `expected_version`) -> turning ON additionally needs every prerequisite the Worker reports -> `admin_whatsapp_otp_delivery_begin` (service role; the DATABASE judges the actor's `manage`, records the request and the `whatsapp_otp.delivery_requested` audit event, and signs a 5-minute one-request grant `v1d|request|actor|version|enabled|expires|sha256(reason)` with the existing grant key) -> signed `POST /v1/admin/delivery` (admin-secret HMAC, replay-proof id, grant verified before anything is claimed or written) -> the Worker re-checks the prerequisites and applies the flag and its audit row in ONE atomic D1 batch (actor, old, new, reason, time; compare-and-set on the version) -> `admin_whatsapp_otp_delivery_finish` writes `whatsapp_otp.delivery_changed` with actor, old, new, reason and version. An ambiguous Worker answer stays pending and `admin_whatsapp_otp_delivery_reconcile` settles it from the Worker's authoritative D1 audit (also run by the page loader). A settings grant ("v1") can never authorize a delivery change ("v1d"), and the reverse.

**Prerequisites that disable the switch (turning ON only; OFF is always allowed).** Reported by the Worker itself as non-secret facts (`delivery_blockers`): environment permit not "true", admin secret, grant secret, alert callback (`OTP_NOTIFY_URL` plus its secret), Meta token, D1 reachability, limits row not initialized, no approved recipients (allowlist empty and not open mode). The Worker refuses an enable with `422 prerequisites_missing` even if the page was stale, and the page lists the missing items as helper text. An older Worker that does not report the facts keeps the switch disabled.

**Unmatched / direct D1 changes (implemented, four layers).** (1) *Preventive:* a change through the Worker needs the database-issued grant. (2) *Fail closed on the audit trail:* the switch counts as ON only when the NEWEST D1 audit row carries the same version, value and actor as the switch row, so a direct `UPDATE otp_delivery_switch`, a rollback to an older audited state, or a deleted audit row leaves delivery OFF. (3) *Detective:* `admin_whatsapp_otp_delivery_reconcile(rows, drift)` (also run on every Admin page view) raises `whatsapp_otp.delivery_unmatched` once per version/time to active, non-suspended staff holding `whatsapp_otp.view` (statistics only: the version). (4) *Independent periodic reconciliation, not dependent on anyone opening a page:* every cron run (1 minute) the Worker sends its switch state and audit tail over the private `APP_NOTIFY` binding to `POST /api/internal/whatsapp-otp/delivery-attest` (HMAC with the notify secret). The app settles pending requests, reads the AUTHORIZED state from the Aladdin database (`admin_whatsapp_otp_delivery_authorized()`: the latest applied request, none = OFF at version 0), raises the unmatched alert if the Worker's switch is not exactly that state, and answers the authorized state **signed** with the notify secret and bound to the Worker's nonce and environment (`v1a|env|enabled|version|issued_at|nonce`). The Worker stores the verified answer in D1 (`otp_delivery_attestation`) and **counts the switch as ON only when a correctly signed attestation says ON at the same version and is younger than 10 minutes.** A forged switch row plus a forged audit row cannot produce that signature (the secret is in the Secrets Store, never in D1), so it cannot send, and the app alerts on the next cron run. The authorized state is the latest APPLIED request, except that an OFF which was begun but never confirmed (pending, or abandoned after its completion was lost) still counts as OFF at the version D1 would have had, so a lost confirmation can never make delivery fall back to an earlier ON; a request the Worker definitively refused never counts. The reconcile function sweeps approvals older than 15 minutes BEFORE it considers any Worker row, so an expired approval cannot be resurrected by a row that appears in D1 later; a Worker row can only ever confirm a request a Super Admin approved in the database (matching actor, version and value), never create an approval. Consequences, all deliberate: turning OFF is immediate (it never needs an attestation); turning ON takes effect at the next successful attestation (at most about one minute); if the app is unreachable for more than 10 minutes delivery stops (fail closed; OTP sign-up needs the app anyway); a replay of an older genuine "ON" attestation is bounded by the 10-minute TTL; the attestation uses the notify secret with its own signed prefix, so an attacker holding BOTH D1 write access and Secrets Store read access could forge it (those are separate Cloudflare permissions; a dedicated attestation secret is a possible hardening). The app's own alert for "Worker cannot reach the app" is the Worker's `whatsapp_otp_maintenance_errors` log line, not a notification (the alert channel is the same path).

**Verified locally (2026-11-05).** Worker `npm test` 175/175 (after the unmatched-change and drift work; the DB-dependent items below are still unverified) and `tsc` clean; frontend `tsc` clean, eslint 0 errors on the changed files, 58 focused tests (change flow, client, component) plus the contract and ConfirmDialog suites; `migration-policy` clean for the new migration; the generated-types entries were added by hand.

**Not verified (blocked: Docker has no free network address pool for a second local Supabase stack).** pgTAP `123_whatsapp_otp_delivery_switch_test.sql` (54 planned) and `108` against the new migration; the function-permission manifest (`supabase/permissions/20261107090003.json` is derived from the three identical-shape settings functions and must be confirmed by the permission gate); the full pgTAP suite; any browser pass (light/dark, Arabic RTL, mobile). CI (`supabase-rls`, migration-policy, permission gate) is the first real check.

**Rollout order (each step needs its own approval; none taken).** 1. Push/merge through #136 with CI green. 2. Apply Supabase `20261107090003` and D1 `0003` to Acceptance; deploy the Worker and the frontend preview. 3. Acceptance rehearsal (add to A10): toggle ON with a prerequisite missing is refused; ON with them present; a send reaches only the allowlisted number; OFF blocks the next send with no Meta call; Administrator sees no control; the audit rows (D1 and Supabase) show actor, old, new, reason, time. 4. Production only after A10, with the eight migrations and the switch left OFF.
