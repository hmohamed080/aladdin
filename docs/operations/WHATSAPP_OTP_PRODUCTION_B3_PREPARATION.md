# WhatsApp OTP: Production infrastructure preparation (B3), security decisions and Acceptance execution sequence

Status: **prepared, nothing applied.** Updated 2026-11-04 on PR #136 (stacked on #127) after the owner's review of the first B3 report. No hosted resource was created, bound, deployed, migrated or changed by this work. Hosted access was read-only (D1 `sqlite_master` SELECT, Secrets Store name listing, Workers list). Every step in the two execution sequences needs its own explicit approval.

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

Also fixed by the owner: preserve the prepared Production D1 and the eight existing Secrets Store entries; no duplicate resources; no allowlist dependency; no Supabase Send-SMS hook; the existing Admin notification system only (no email, no Resend).

## 2. Hosted inventory (read-only, 2026-11-04)

| Resource | State |
|---|---|
| D1 `aladdin-whatsapp-otp-production` (`30a16841-1108-47e9-99be-3dc9d827fd87`) | Exists once; 0 rows; no `d1_migrations` table; schema = migration `0001` exactly (section 3) |
| D1 `aladdin-whatsapp-otp-acceptance` (`da65d5e4-8344-4078-9c2d-8a4bb4907f79`) | Exists, untouched |
| Workers | `aladdin-whatsapp-otp-preview` exists (public workers.dev today); **`aladdin-whatsapp-otp-production` does not exist yet** |
| Secrets Store `acfaa67f391e499db6fde398022f50ce` | 8 secrets, all `workers` scope, `active`, none bound to a Production Worker |

| Environment | Meta token | Send signing | Admin signing | Notify signing | **Admin grant key (new, required)** |
|---|---|---|---|---|---|
| Acceptance | `WHATSAPP_ACCESS_TOKEN` | `PHONE_OTP_WORKER_SECRET` | `OTP_ADMIN_SIGNING_SECRET` | `OTP_NOTIFY_SIGNING_SECRET` | `OTP_ADMIN_GRANT_SECRET` (not created) |
| Production | `WHATSAPP_ACCESS_TOKEN_PRODUCTION` | `PHONE_OTP_WORKER_SECRET_PRODUCTION` | `OTP_ADMIN_SIGNING_SECRET_PRODUCTION` | `OTP_NOTIFY_SIGNING_SECRET_PRODUCTION` | `OTP_ADMIN_GRANT_SECRET_PRODUCTION` (not created) |

The two **grant key** secrets are the only new resources the F-1 hardening needs. Nothing was created; they are listed for the owner to create (checklist C-6). The grant key value must also be inserted once into the matching Supabase database (Acceptance step A3, Production step P-1), because the database is what issues grants.

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

The three `whsec_` values must be identical on both sides, so the owner must retain each value (a Secrets Store value cannot be read back). Format: `whsec_` + base64 of >= 32 random bytes. Supabase side: one SQL statement run once by the owner per environment inserts the grant key (`insert into app.whatsapp_otp_grant_key (id, key) values (1, decode('<base64 of the key bytes>', 'base64'))`, same bytes as the Worker secret after `whsec_`).

## 8. Remaining values and owner actions

- **C-1** owner confirms independent generation and secure retention of all secrets (Acceptance and Production, including the two new grant keys).
- **C-6** owner creates `OTP_ADMIN_GRANT_SECRET` (Acceptance) and `OTP_ADMIN_GRANT_SECRET_PRODUCTION` (Production) in the Secrets Store, and inserts the same bytes into the matching Supabase database (once per environment).
- **G-META** the owner (or an approved read-only lookup) records the real current messaging limit tier and quality rating of Phone Number ID `1458603463983505` from Meta (Business Settings, or the Phone Number node's `messaging_limit_tier`/`quality_rating`), compares it with the approved budget, and attaches the evidence to the release record. Not assumed; required before Production activation.
- **G-NOTIFY** as in section 5.4.

## 9. Release blockers (updated)

| # | Blocker | State |
|---|---|---|
| B2 | Mandatory CI on the final combined commit | rerun after the 2026-11-04 security changes |
| B3 | Production Worker, D1 baseline, secrets, config guard | config + guard prepared; hosted steps pending approval |
| B3-F1 | Admin grant + unmatched detection + alert | **implemented**; hosted: create grant keys (C-6) |
| B3-F2 | Private service-binding transport | **implemented**; Production frontend deploy gated on the Worker existing |
| B3-F4 | Environment-bound notifications | **implemented** |
| G-NOTIFY | Callback reachability incl. WAF/bot, Acceptance and Production | open |
| G-META | Verified Meta messaging limit for the sender | open |
| B4 | Production app secrets and bindings | pending approval |
| B5 | Acceptance rehearsals (below), enforce/observe rollback, build-swap drill, email/Google/Facebook/legacy login on the new build | open |
| B6/B7 | Upload-only deploy stage; approvals and planned window | open |

## 10. Acceptance execution sequence (each step separately approvable; stop after each)

Principles: Acceptance only; no Production resource is read or written; WhatsApp delivery stays **OFF** except inside an explicitly approved send window; no step changes existing registration, which stays on email/Google/Facebook with phone sign-up OFF. Every step lists its verification and rollback.

**A0. Migration preflight (read-only).** (a) Confirm CI is green on the final candidate commit (all mandatory workflows plus `migration-policy`); (b) `node scripts/migration-policy.mjs` against the PR base: no problems; (c) `node scripts/migration-permission-gate.mjs` result from `supabase-rls`; (d) read the Acceptance Supabase migration history (`supabase migration list`/`db push --dry-run` against the linked Acceptance project): exactly `20261103090001` is pending and nothing else; (e) `node scripts/d1-baseline-check.mjs aladdin-whatsapp-otp-acceptance`: `tracked_behind` with `schema.different=[]`; (f) confirm the Acceptance preview frontend and Worker current versions (record ids for rollback); (g) confirm Secrets Store holds the Acceptance names including `OTP_ADMIN_GRANT_SECRET` (after C-6). Output: a go/no-go note. *No hosted change.*

**A1. Owner: Acceptance grant key.** Owner creates `OTP_ADMIN_GRANT_SECRET` (Secrets Store) and keeps the value. *Rollback:* delete the unused secret.

**A2. Apply Supabase migration `20261103090001` to Acceptance.** Verify: the six functions + helper exist, the permission contract passes, ledgers and `app.whatsapp_otp_grant_key` are empty, `begin` raises `grant_key_unconfigured`, the new permissions exist with Super Admin = view/manage/ceiling_manage and Administrator = view. *Rollback:* none destructive (additive); forward-fix migration if needed.

**A3. Owner: insert the Acceptance grant key into the Acceptance database** (same bytes as A1; SQL in section 7). Verify with a single `begin` through the app after A6 (no value is ever read back).

**A4. Acceptance D1: backup and `migrations apply` (0002).** `wrangler d1 export`, then apply; baseline check says `current`, `otp_settings` empty. *Rollback:* none needed (additive).

**A5. Deploy the Acceptance Worker (private, five bindings, delivery OFF).** `check-preview-config.mjs` PASS and dry-run first. This removes the public workers.dev address; Acceptance phone codes are unavailable until A6 completes (the feature is OFF in Acceptance). Verify from the dashboard: no workers.dev route, bindings present, `WHATSAPP_DELIVERY_ENABLED=false`. *Rollback:* redeploy the previous Worker version `4d41419c` (public) - recorded in A0.

**A6. Acceptance frontend: secrets, vars and deploy.** Owner sets `PHONE_OTP_ADMIN_SECRET`, `PHONE_OTP_NOTIFY_SECRET`, `PHONE_OTP_WORKER_URL` placeholder on `aladdin-frontend-preview`; deploy the preview build containing the `OTP_WORKER` binding. Verify: the Admin page loads for a Super Admin and shows "Not configured" plus the "Sending service" card (environment `acceptance`, sending Off, bindings "All in place"). *Rollback:* redeploy the previous preview version.

**A7. Connection gates.** Admin page > "Test the alert connection" must report `reachable` (G-NOTIFY, Acceptance). Verify that an Administrator sees the page read-only and a user without `whatsapp_otp.view` is denied.

**A8. Rehearsal without any WhatsApp message (R-1..R-6, R-10..R-12).** R-1 initial state (`503 budget_unconfigured` path is covered by tests; the page shows "not configured"); R-2 initialize 150 / 5,000 / 70 / 90 with reason and typed ceiling; R-3 change the daily limit; change the ceiling (typed confirmation, >= 20-char reason); stale-version and double-submit refused; R-4 refusals (limit > ceiling, ceiling < limit, warn >= critical, short reason, wrong confirmation); R-5 permission failures (Administrator view-only, manage-without-ceiling cannot change the ceiling, no-view denied, suspended denied); R-10 reconcile of an applied-but-pending change; R-11 environment isolation (Acceptance credentials do not work against anything Production; the notify environment binding refuses a `production` event); R-12 **unmatched detection**: with approval, insert one audit row directly in the Acceptance D1 (a break-glass simulation), open the page, and confirm one `audit_unmatched` Admin notification, no duplicate on refresh, and that the grant still blocks a forged call. *Rollback:* restore the settings through the Admin page; delete the simulated D1 audit row.

**A9. Alert and exhaustion rehearsal (needs a separate approval for any WhatsApp send).** In an approved window with delivery ON for the allowlisted Acceptance number only: set a small limit, observe warning / critical / exhausted notifications (once each, re-armed after usage falls, no email), then the third attempt answers `budget_exhausted` with no Meta call; R-9 kill-switch independence (delivery OFF blocks sends while the Admin page and settings still work). Restore limit 150 and delivery OFF. Alternative without sending: a D1 console insert of journal rows to reach the thresholds (separate approval).

**A10. Evidence and rollback drill.** Record the results (screenshots, counts, no secrets); drill the rollback of the preview frontend and Worker to the recorded versions; confirm email/Google/Facebook/legacy sign-in on the new Acceptance build (existing registration undisturbed).

Stop after A10 and report. Production preparation (P-steps) is planned only after the Acceptance results are accepted:

**P-0** repeat the preflight for Production; **P-1** owner creates the Production grant key (C-6) and inserts it in the Production database after **P-2** the Supabase migration; **P-3** Production D1 backup and baseline (section 3); **P-4** owner sets the Production frontend values (section 7, no public Worker); **P-5** guard + dry-run; **P-6** deploy the private Production Worker with delivery OFF; **P-7** deploy the Production frontend (only now, because of the binding gate); **P-8** Super Admin initialises 150 / 5,000 / 70 / 90 and verifies audit and history; **P-9** G-NOTIFY on Production and Security Events review; **P-10** G-META evidence; then the separately approved cutover (a reviewed change of `wrangler.production.jsonc` and its guard to enable delivery, a controlled single send first).
