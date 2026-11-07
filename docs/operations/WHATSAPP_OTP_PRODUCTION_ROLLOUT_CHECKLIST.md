# WhatsApp OTP: Production rollout and rollback checklist (delivery stays OFF)

**Prepared 2026-11-07. NOTHING in this document has been executed against Production.** Every step needs its own explicit owner approval; no step enables real sending. The only Production commands run while preparing it were read-only (section 1). This extends [B3 preparation](WHATSAPP_OTP_PRODUCTION_B3_PREPARATION.md) section 10 (P-0 to P-10) and replaces its P-step prose.

## 0. Read first: what blocks starting

| # | Blocker | State |
|---|---|---|
| G1 | **Integration with `main`.** The Production frontend deploys from `main` only (`cloudflare-production.yml`). The OTP stack (#126 > #127 > #136 > #137) is **205 commits / 482 files ahead of `main`** (the sign-in, onboarding and registration lineage as well as the OTP work). `main` has since merged #139 (showroom social links, 2 migrations). A trial merge of `main` into the stack conflicts in **5 files**: `docs/operations/AGENT_WORK_LOG.md`, `docs/operations/RUNTIME_STATE.md`, `frontend/e2e/showroom-auth.spec.ts` (deleted vs modified), `frontend/src/features/onboarding/business-flow.tsx`, `frontend/src/server/actions/business-onboarding.ts`. The merge was aborted; nothing was resolved. | **open: needs an integration decision and owner of the onboarding code** |
| G2 | Mandatory CI on the final combined commit (including `supabase-rls` and the permission gate). The stack alone is green; the combination with current `main` does not exist yet. | open |
| G3 | **P-1 has no approved tool.** `scripts/hosted-db/provision-grant-key/provision-grant-key.mjs` deliberately refuses the Production project (`production_refused`). A reviewed Production variant (or an owner-run alternative) must exist first. Until the Production grant key exists, no settings or switch change can be made from the Admin page (OFF is unaffected). | open |
| G4 | #137 (`20261105090001`) go or no-go for Production (section 2, decision D1). | open |
| G5 | Recovery point: the owner records the Supabase Production backup / point-in-time-recovery position **before** P-2 (not verified by this preparation). | open |
| G6 | Owner approvals and window (B7), alert recipients, A10 (**only** for live activation, see section 6). | open |

## 1. Read-only Production facts (verified 2026-11-07)

| Area | Fact | How it was checked |
|---|---|---|
| Supabase Production (`kkpkgjrweysgvhvkhzun`, `aladdin-production`, eu-west-3) | **193** migrations applied, latest `20261027090001`, no remote-only rows, no out-of-order | `supabase migration list --linked --output-format json` from a throwaway workdir |
| Pending set | **11** (list in section 2) for stack + current `main`; 9 for the stack alone | `supabase db push --linked --dry-run` from the same workdir |
| D1 `aladdin-whatsapp-otp-production` (`30a16841-1108-47e9-99be-3dc9d827fd87`) | untracked, `whatsapp_hook_events` only; missing: `otp_settings`, `otp_settings_audit`, `otp_admin_requests`, `otp_alert_state`, `otp_notification_outbox`, `otp_delivery_switch`, `otp_delivery_audit`, `otp_delivery_attestation` | `node edge/whatsapp-otp-worker/scripts/d1-baseline-check.mjs aladdin-whatsapp-otp-production` (one SELECT) |
| Workers | `aladdin-whatsapp-otp-production` **does not exist**; `aladdin-frontend-production` last modified **2026-10-30** (predates all of this work) | Cloudflare API list |
| Secrets Store `acfaa67f391e499db6fde398022f50ce` | all five `*_PRODUCTION` secrets exist and are active (token, send, admin, notify, grant) | `wrangler secrets-store secret list` (names only) |
| Production frontend secrets | `AUTH_PASSWORD_PREVIEW_GRANT_SECRET`, `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET_KEY`. **No `PHONE_OTP_*`.** | `wrangler secret list --env production` |
| Production Worker config | `check-production-config.mjs` PASS: private, isolated D1, `*_PRODUCTION` secrets, open recipient mode, **delivery disabled**, and (new) the `APP_NOTIFY` binding | offline guard |

**Fixed while preparing:** `wrangler.production.jsonc` had **no `APP_NOTIFY` service binding** (Acceptance has one) and the guard did not check it. Without it the alert callback and the delivery attestation have no transport, so delivery could never be turned ON and no alert would be delivered. The binding (`APP_NOTIFY` > `aladdin-frontend-production`), a guard rule and tests are now in #136, and the "alert connection" prerequisite refuses ON without it.

To reproduce the read-only checks without touching any repo checkout: copy `supabase/migrations`, `supabase/templates` and `supabase/config.toml` to a scratch folder, run `supabase link --project-ref kkpkgjrweysgvhvkhzun --workdir <scratch>`, then `migration list --linked` and `db push --linked --dry-run` with the same `--workdir`. Never run `db push --linked` without `--dry-run` outside an approved P-2.

## 2. The complete pending Supabase list (11), in apply order

| # | Version | What it is | Lineage | Related to WhatsApp delivery? |
|---|---|---|---|---|
| 1 | `20261028090001_sign_up_birthday_and_phone_codes` | birthday and phone-code sign-up fields | #113 / registration | **No** (unrelated) |
| 2 | `20261028090003_registration_username_lease` | pending-registration username lease. Reviewed exception: `drop function` + recreate of `pending_registration_save` (same name, arguments and `service_role`-only grant) | #116 | **No** |
| 3 | `20261029090001_account_basics` | account basics onboarding | #113 | **No** |
| 4 | `20261029090002_account_basics_specialty_lists` | specialty lists. Reviewed exception: `drop table user_specialties` (added only on Acceptance, never on Production) | #113 | **No** |
| 5 | `20261030090001_phone_verification_authority` | phone verification authority (dormant, ships OFF) | #121 / #125 | Dormant OTP chain |
| 6 | `20261030090002_phone_signup_authority` | phone sign-up authority (dormant, ships OFF) | #125 / #126 | Dormant OTP chain |
| 7 | `20261103090001_whatsapp_otp_admin_settings` | limits, alerts, grant key table, notification vocabulary | #136 | **Yes** |
| 8 | `20261105090001_admin_staff_invitations` | Admin Staff invitations | #137 | **No** (unrelated) |
| 9 | `20261105100001_whatsapp_otp_delivery_switch` | delivery switch ledger, reconcile, authorized-state function | #136 | **Yes** |
| 10 | `20261107090001_showroom_social_links` | showroom social links | #139, already on `main` | **No** |
| 11 | `20261107090002_showroom_social_links_settings` | showroom social links settings | #139, already on `main` | **No** |

**Dependencies (verified by CI):** #9 depends on #7 only (the grant-key table, notification tables and permissions). It does **not** depend on #8: the stack is green with and without it, and the union manifest passes the permission gate. #8 depends on nothing in the OTP work. Production applies them in version order in one push, so nothing is out of order (Production's latest is `20261027090001`).

**Decision D1 (#137):** including #8 now is the clean order (version order, no `--include-all`). Excluding it means that when #137 is promoted later its migration is older than the already-applied `20261105100001` and needs `migration-policy: out-of-order-reviewed` plus `db push --include-all`, or a rename through `retired-versions.json`. The permission manifest `20261105100001.json` on the union branch is already the union of both (732 contracts); on #136 alone it is 723.

**Unrelated-change warning:** migrations #1 to #4, #8, #10 and #11, and most of the frontend delta, are not WhatsApp delivery. They ship because the stack is stacked on them and because the Production frontend deploys from `main`. They change live sign-in and onboarding (`/auth/sign-in`, `/auth/sign-up`, `/onboarding/*`, retired `/installer/*` and `/showroom/*` sign-in pages). Deploying the frontend is therefore **not** "infrastructure only": see P-7.

## 3. Rollout checklist, delivery OFF throughout

**Execution order:** P-0, P-2, P-1, P-3, P-4, P-5, P-6, P-7, P-8, P-9. Stop after each and record the evidence. **Delivery stays OFF in every step:** `WHATSAPP_DELIVERY_ENABLED = "false"` (the guard refuses anything else), and there is no switch row, so a fresh deployment sends nothing.

| Step | Action (needs approval) | Verify | Rollback |
|---|---|---|---|
| **P-0** | Repeat section 1 from the final combined commit. Confirm CI green on that exact SHA (G2). Record backup / PITR position (G5). | Pending list equals section 2 and nothing else; no remote-only rows | none (read-only) |
| **P-2** | Apply the Supabase migrations: `supabase db push --linked` from the approved commit (Production link). | `migration list --linked`: 204 matched, none pending. `select count(*) from public.admin_permissions where key like 'whatsapp_otp.%'` = 3. `app.whatsapp_otp_grant_key` exists and is **empty**. `select * from app.phone_verification_config` shows the OFF defaults. The existing sign-in still works on the OLD frontend. | **No automatic down.** Forward-fix with a new migration, or restore to the recorded recovery point. Each file runs in its own transaction, so a failure stops at the first failing file and a re-run resumes. |
| **P-1** | Owner inserts the Production grant key (same bytes as `OTP_ADMIN_GRANT_SECRET_PRODUCTION`) into `app.whatsapp_otp_grant_key`. **Blocked by G3.** Never via SQL text, chat, an argument or a file. | one row, fingerprint matches the owner's record, schema signature and migration history unchanged | `delete` that one row; the Worker then answers `grant_invalid` and every change fails safely |
| **P-3** | D1: `wrangler d1 migrations apply aladdin-whatsapp-otp-production --remote` (records `0001` as a no-op, applies `0002` and `0003`). | `d1-baseline-check.mjs` reports `current`; all 8 tables present; 0 rows in every table (no switch row = OFF) | Additive and idempotent (`IF NOT EXISTS`), tables empty: leave them. Do not drop. |
| **P-4** | Owner sets the Production frontend values with `wrangler secret put <NAME> --env production`: `PHONE_OTP_ADMIN_SECRET` (same value as `OTP_ADMIN_SIGNING_SECRET_PRODUCTION`), `PHONE_OTP_NOTIFY_SECRET` (same as `OTP_NOTIFY_SIGNING_SECRET_PRODUCTION`), `PHONE_OTP_WORKER_SECRET` (same as `PHONE_OTP_WORKER_SECRET_PRODUCTION`), and `PHONE_OTP_WORKER_URL` = a placeholder `https://aladdin-whatsapp-otp.internal/v1/otp/send` (host unused with the binding; the admin routes still need it set). **Never** `OTP_ADMIN_GRANT_SECRET*` on the frontend. Leave `PHONE_VERIFICATION_ENABLED`, `PHONE_SIGNUP_VERIFICATION_ENABLED`, `PHONE_OTP_DELIVERY`, `PHONE_OTP_HMAC_KEYS` unset. | `wrangler secret list --env production` shows the four new names and none of the OFF flags | `wrangler secret delete <NAME> --env production` |
| **P-5** | Guard and dry run: `node scripts/check-production-config.mjs` (PASS), `wrangler deploy -c wrangler.production.jsonc --dry-run`. Confirm the dry-run lists exactly: 5 Secrets Store bindings, `IDEMPOTENCY_DB`, `APP_NOTIFY`, cron `* * * * *`, no routes. | PASS and the binding list above | none (nothing uploaded) |
| **P-6** | Deploy the **private** Production Worker (delivery OFF): `wrangler deploy -c wrangler.production.jsonc` from `edge/whatsapp-otp-worker`. It must exist **before** P-7 (the frontend binds to it). | `workers_list` shows it; no public address; the signed preflight (`node scripts/worker-preflight.mjs`, needs `PHONE_OTP_WORKER_SECRET`) reports `delivery_permitted: false`, `delivery_enabled: false`; cron runs (see section 5) | before P-7: `wrangler rollback` to no version is not possible for a first deploy; remove with `wrangler delete aladdin-whatsapp-otp-production` (nothing depends on it yet). After P-7: never delete; roll back to the previous version. |
| **P-7** | Deploy the Production frontend: GitHub Actions `cloudflare-production`, `stage=frontend`, from `main` (G1), environment `cloudflare-production`, `CLOUDFLARE_PRODUCTION_ENABLED=true`. **This ships the entire stack, including live sign-in and onboarding changes.** Run the sign-in smoke immediately: email, Google, Facebook, legacy phone, username (existing registration must be undisturbed). | smoke passes on `aladdindecore.com`; `/auth/sign-in` renders; `POST /api/internal/whatsapp-otp/delivery-attest` answers 401 to an unsigned request (not 404, not 500) | `wrangler rollback --env production` (frontend), or the previous version in the dashboard. Never `wrangler delete` the frontend. |
| **P-8** | Super Admin initialises limits **150 / 5,000 / 70 / 90** on `/admin/whatsapp-otp` (typed ceiling confirmation, reason). Needs P-1 and P-7. | Admin page shows the limits, one audit row, history entry; **the Sending switch stays OFF and is disabled** (blocker `environment_not_permitted`) | limits are an audited setting: change it again through the page |
| **P-9** | G-NOTIFY: press "Test the alert connection" on the Admin page (Worker > app over `APP_NOTIFY`); review Security Events. Confirm the attestation cron works (section 5). | probe answers reachable; `delivery_attestation_age` is 0 to 120 s (an OFF/version 0 attestation is stored every minute; `delivery_attested` stays `false` until a switch row exists, which is correct); no `whatsapp_otp_attestation_failed` lines | none needed |

## 4. Expected ON/OFF behaviour

| Condition | Result |
|---|---|
| Shipped state (permit `"false"`, no switch row) | Every send answers `503 delivery_disabled`; Meta and the token are never touched. Admin switch is disabled with "this environment does not allow sending". |
| Permit `"true"` (separate reviewed change to `wrangler.production.jsonc` **and** the guard, approved cutover), no switch row | Still OFF. The switch is enabled for a Super Admin once every prerequisite is met. |
| Super Admin turns ON (begin > signed grant > Worker D1 change > finish) | The D1 row is ON immediately, but **sending starts at the next successful attestation (about one minute)**. The page says it is waiting for the Aladdin database's confirmation. |
| Super Admin turns OFF | **Immediate** (the very next request): OFF never waits for an attestation. |
| Permit set back to `"false"` | Immediate kill switch whatever the Admin state says. Independent of D1. |
| App unreachable, attestation stale (over 10 minutes), bad signature, wrong environment or wrong version | OFF (fail closed). Admin page shows "overdue" after 3 minutes with the switch on. |
| Direct D1 write (flag flipped, audit row deleted, rolled back to an older audited state) | OFF immediately; alert `delivery_unmatched` within about one minute. |
| Forged switch row **and** forged audit row | cannot send (no valid signed attestation); alert within about one minute |
| Missing `APP_NOTIFY` binding | "alert connection" prerequisite fails: ON is refused with an explanation |

## 5. Monitoring (attestation and delivery integrity)

| Signal | Where | Meaning / action |
|---|---|---|
| `{"event":"whatsapp_otp_attestation_failed","reason":"<code>"}` | Workers Logs (observability is on) for `aladdin-whatsapp-otp-production` | One line per failed minute. Codes: `app_401` (secret mismatch), `app_403` (environment), `app_503` (database or config), `answer_unsigned`, `answer_stale`, `answer_invalid`, `notify_transport_unavailable` (binding missing), `notify_unconfigured`, `d1_unreadable`, `attest_failed` (unreachable), `exception`. **Alert when 3 or more occur within 5 minutes.** Fail-closed: ON stops sending. |
| `whatsapp_otp_maintenance_errors`, `whatsapp_otp_notify_failed` | same | step failures; alert outbox retries with backoff |
| Runtime facts `delivery_attested`, `delivery_attestation_age` | Admin page (overdue notice, shown only while the switch is on) and the signed `/v1/admin/usage` response | Healthy: age 0 to 120 s; `delivery_attested` is true only once a switch row exists and matches |
| `whatsapp_otp.delivery_unmatched` notification | Admin notification inbox (staff with `whatsapp_otp.view`) | A Worker delivery state the database never approved, once per version/time. Treat as a security event: turn OFF, then investigate D1 access. |
| `whatsapp_otp.audit_unmatched`, budget alerts | same | limits changed outside the Admin page; budget thresholds |
| Production `POST /api/internal/whatsapp-otp/delivery-attest` | frontend Worker logs | steady 200 every minute; 401/403/503 pattern points at the secret, environment or database |

There is **no automated paging** for these today: the log events are searchable but nobody is notified. Before activation the owner chooses a channel (a Cloudflare Workers Logs / Notifications rule on the event above, or a log drain) and the on-call recipient. While OFF, a failing attestation has no user impact; it only stops a future ON.

## 6. A10 and activation (not part of this checklist)

A10 (evidence pack, rollback drill, hosted login matrix) gates **live activation**, meaning P-10 (G-META evidence), the permit change and the first controlled send. **Caveat found while preparing:** P-7 changes live sign-in for every user, so the sign-in smoke in P-7 is mandatory and the hosted login matrix is strongly recommended before P-7, not only before activation. This is the owner's call.
