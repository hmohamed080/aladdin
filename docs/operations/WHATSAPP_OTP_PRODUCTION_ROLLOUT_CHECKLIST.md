# WhatsApp OTP: Production rollout and rollback checklist (delivery stays OFF)

**Prepared and revised 2026-11-07. NOTHING in this document has been executed against Production, Acceptance or Cloudflare.** Every step needs its own explicit owner approval; no step enables real sending. The only commands run against hosted systems while preparing it were read-only (section 1). It supersedes the P-step prose in [B3 preparation](WHATSAPP_OTP_PRODUCTION_B3_PREPARATION.md) section 10.

**Two phases, deliberately separate.**
- **Phase 1, infrastructure with delivery OFF (P-0 to P-6, P-8, P-9):** database migrations, D1, secrets, the private OTP Worker. No user-facing page changes; sending is impossible (permit `"false"`, no switch row).
- **Phase 2, user-facing frontend activation (P-7):** the Production frontend deploys from `main` and ships the entire integrated build, including the new sign-in, onboarding and registration lineage. It needs its own hosted login compatibility gate (section 5) before any traffic reaches it.

## 0. Where the work is, and what blocks starting

**Integration branch (pushed, validation only, nothing merged):** `integration/otp-main-20261107` = latest `main` (`b957ebeb`, with #139 and #138) + the OTP stack (#113, #116, #125, #126, #127, #136). **#137 is not included** (section 2). Merge of the stack into `main` had 5 conflicts, all resolved keeping both sides:

| Conflict | Resolution |
|---|---|
| `frontend/src/server/actions/business-onboarding.ts` | main's showroom link validation **and** the stack's activity-type validation, both kept |
| `frontend/src/features/onboarding/business-flow.tsx` | main's links card / description order / `identityFieldsDone` **and** the stack's generalized activity field and account-basics step; `identityFieldsDone` also requires the activity when the type is preselected |
| `frontend/e2e/showroom-auth.spec.ts` | stack's deletion kept (it drove the retired `/showroom/*` sign-in pages; `one-field-auth.spec.ts` replaces it); the surviving showroom e2e helper now fills the link main requires |
| `docs/operations/AGENT_WORK_LOG.md`, `RUNTIME_STATE.md` | union of both sides (append-only) |

Semantic follow-ups the merge exposed (not textual conflicts): main's 5 `business-flow` tests assumed no activity step, `118_showroom_social_links_atomicity_test.sql` asserted the old message `invalid showroom activity` (the stack generalized it to `invalid business activity`), and `persistent-shell.test.ts` expected the retired `/showroom/sign-in|up` directories. All three were updated to the merged behaviour. Newer `main` showroom/authentication code was not overwritten.

| # | Blocker | State |
|---|---|---|
| G1 | **Integration branch decided:** `integration/otp-main-20261107` (a54bdf95 plus the commits of this round) is the OTP release candidate. #137 and #140 stay separate; #142 is non-blocking. | decided (owner, 2026-11-07) |
| G2 | Mandatory CI on the final commit. `migration-policy`: the 6 older migrations are accepted through hash-pinned reviews in `supabase/migration-policy-reviewed.json` (files stay byte-for-byte unchanged). Local run: no problems. | CI on the final SHA pending |
| G3 | **Recovery point.** An encrypted logical backup of Production exists (owner-confirmed). A **fresh quick snapshot is taken immediately before P-2** with `scripts/hosted-db/production-recovery-snapshot.sh` (dump only, no restore rehearsal; section 3, P-0b). | covered by P-0b |
| G4 | P-1 (Production grant key) tool: **built** (section 4), reviewed by tests; needs your approval of the code and the written approval reference to run. | ready for review |
| G5 | #137 stays out; decision recorded in section 2. | decided (recommendation) |
| G6 | Owner approvals and window (B7), alert recipients, **A10 only for live activation**; the new `frontend-upload` stage must first reach `main` (it cannot run from a branch); hosted login matrix before P-7 (section 5). | open |

## 1. Read-only hosted facts (verified 2026-11-07)

| Area | Fact |
|---|---|
| Supabase **Production** (`kkpkgjrweysgvhvkhzun`, Postgres 17.6.1) | **195** applied, latest `20261107090002` (both #139 migrations applied), **no remote-only rows**. Exactly **8 pending** on this branch (section 2); **7 of them sort below the latest applied version**, so P-2 needs `--include-all`. |
| Supabase **Acceptance** (`nxossqhdfltcqdwvbewi`, Postgres 17.11) | **203** applied, latest `20261107090002`, **#137's `20261105090001` already applied**. The delivery migration's old version `20261105100001` would be pending *below* the latest: out of order there. Hence the relabel in section 2. |
| Production D1 `aladdin-whatsapp-otp-production` | untracked, `whatsapp_hook_events` table only; 8 tables missing (incl. `otp_delivery_switch`, `otp_delivery_audit`, `otp_delivery_attestation`) |
| Workers | `aladdin-whatsapp-otp-production` **does not exist**. `aladdin-frontend-production` last modified **2026-10-30**. |
| Secrets Store | all five `*_PRODUCTION` secrets exist and are active. The Production frontend has **no `PHONE_OTP_*` secrets**. |
| Production backups | `pitr_enabled: false`; an encrypted logical backup exists; a fresh snapshot is taken at P-0b |
| Production Worker config | `check-production-config.mjs` PASS, including the `APP_NOTIFY` service binding added in #136 |

Reproduce without touching any checkout: copy `supabase/migrations`, `supabase/templates` and `supabase/config.toml` to a scratch folder, `supabase link --project-ref <ref> --workdir <scratch>`, then `migration list --linked --output-format json` and `db push --linked --dry-run` with the same `--workdir`. **Never run `db push --linked` without `--dry-run` outside an approved P-2.**

## 2. The complete pending Supabase list (8), apply order, and the #137 decision

| # | Version | What | Lineage | WhatsApp delivery? |
|---|---|---|---|---|
| 1 | `20261028090001_sign_up_birthday_and_phone_codes` | birthday and phone-code sign-up fields | #113 | No |
| 2 | `20261028090003_registration_username_lease` | username lease. Reviewed exception: `drop function` + recreate of `pending_registration_save` (same name, arguments, `service_role`-only grant) | #116 | No |
| 3 | `20261029090001_account_basics` | account basics | #113 | No |
| 4 | `20261029090002_account_basics_specialty_lists` | specialty lists. Reviewed exception: `drop table user_specialties` (created in #3, never existed on Production before) | #113 | No |
| 5 | `20261030090001_phone_verification_authority` | phone verification authority (dormant, OFF) | #121/#125 | dormant OTP chain |
| 6 | `20261030090002_phone_signup_authority` | phone sign-up authority (dormant, OFF) | #125/#126 | dormant OTP chain |
| 7 | `20261103090001_whatsapp_otp_admin_settings` | limits, alerts, grant-key table, vocabulary | #136 | **Yes** |
| 8 | `20261107090003_whatsapp_otp_delivery_switch` | delivery switch ledger, reconcile, authorized-state function | #136 | **Yes** |

**Order: out of order by design, resolved with `--include-all`.** Production's latest applied version is `20261107090002`. Versions 1 to 7 are older than it (they were applied to Acceptance first and cannot be renumbered or edited), so a plain `db push` stops with `DbPushMissingRemoteError`. `db push --linked --include-all` applies all 8 in version order (verified today by dry run: exactly these 8, nothing else, no remote-only rows). Checked against the CURRENT Production schema (read-only queries, 2026-11-07):
- none of the created tables or columns exists on Production; the 7 functions the migrations replace exist with the expected signatures (`pending_registration_save` is the reviewed drop-and-recreate), the other 7 `create or replace` functions are new there;
- **no object overlap** with #139's `20261107090001/2` (`business_draft_save_v3`, `business_draft_submit_v3`, `app.profile_completion`, `business_verification_detail`, `organization_social_links_set`, `app.social_link_valid` and the new social-link columns) or with any other applied migration, so the final schema equals the sorted-order replay that CI and pgTAP test;
- #139's v3 functions only *call* `business_draft_save_v2` / `business_draft_submit_v2` by name at run time; the older `20261029090002` replaces those two with the same signatures, so Social Links v3 keeps working and additionally accepts the generalized business activity;
- permission gate **PASS 727 contracts**, pgTAP **153 files / 7,047 tests** pass on the integrated branch (reused CI evidence; no code under test changed in this round).
No already-applied file or history row is modified. `migration-policy` accepts the 6 older files only through the hash pins in `supabase/migration-policy-reviewed.json`; editing any of them breaks the pin.

**Relabel (done in this branch):** the delivery migration was `20261105100001`. It was never applied anywhere, but Acceptance had already applied through `20261107090002`, so the old version would be out of order there. It is now `20261107090003` (matching draft PR #140), and the old version is registered in `supabase/permissions/retired-versions.json` so a merge of #136 cannot reintroduce it. Dependencies: it depends only on #7.

**#137 (`20261105090001_admin_staff_invitations`): not required now, can ship separately.**
- Nothing in the OTP stack depends on it (verified by CI with and without it). It is unrelated to WhatsApp delivery.
- A trial merge of #137 onto this branch conflicts only in `docs/operations/AGENT_WORK_LOG.md` and `supabase/tests/108_installer_integration_compat_test.sql` (same union resolution as before).
- **Cost of shipping it later:** the same as the 7 older files here: out of order on Production, needs `db push --include-all` and a hash pin, and the latest permission manifest must be re-unioned (9 functions). **Cost of shipping it now:** it adds an unrelated Admin feature and a `create or replace` of `app.admin_prepare_platform_account` to the same release. Recommendation: keep it out unless the owner wants Admin Staff invitations in this release.
- Acceptance already has it applied (remote-only relative to this branch), which is harmless.

## 3. Phase 1: infrastructure with delivery OFF

**Execution order:** P-0, P-0b, P-2, P-1, P-3, P-4, P-5, P-6, then P-8, P-9. Delivery stays OFF in every step: `WHATSAPP_DELIVERY_ENABLED = "false"` (the guard refuses anything else) and no switch row exists.

| Step | Action (needs approval) | Verify | Rollback |
|---|---|---|---|
| **P-0** | Read-only: repeat section 1 from the final commit; CI green on that SHA. Confirm Production still shows 195 applied, latest `20261107090002`, and the dry run with `--include-all` lists exactly the 8. | the pending list equals section 2; no remote-only rows | none (read-only) |
| **P-0b** | Read-only, **immediately before P-2** (same sitting, at most 60 minutes before): `bash scripts/hosted-db/production-recovery-snapshot.sh`, then `bash scripts/hosted-db/encrypt-backup.sh <folder>`. The script refuses unless history is 195 / `20261107090002`. The recovery point is this snapshot (restore with the existing `restore-acceptance.sh` procedure). | `snapshot-meta.txt` OK, checksums verified, encrypted file recreated and verified | none (read-only) |
| **P-2** | `supabase db push --linked --include-all` from the approved commit (never without `--include-all`: it would stop before applying anything). The old frontend keeps running (all eight are additive except the two reviewed exceptions). | `migration list --linked`: 203 matched (195 + 8), none pending; `count(*) from public.admin_permissions where key like 'whatsapp_otp.%'` = 3; `app.whatsapp_otp_grant_key` exists, RLS on, **empty**; sign-in still works on the OLD frontend | **no automatic down.** Forward-fix with a new migration, or restore from the P-0b snapshot. Each file is its own transaction, so a failure stops at the first failing file; a re-run resumes. |
| **P-1** | Owner provisions the Production grant key with the **Production helper** (section 4). | one row, fingerprint matches the owner's record, schema signature and history unchanged | delete that one row; the Worker then answers `grant_invalid` and every change fails safely |
| **P-3** | `wrangler d1 migrations apply aladdin-whatsapp-otp-production --remote` (records `0001` as a no-op, applies `0002`, `0003`) | `node scripts/d1-baseline-check.mjs aladdin-whatsapp-otp-production` reports `current`; 0 rows everywhere (no switch row = OFF) | additive and idempotent, tables empty: leave them |
| **P-4** | Owner sets Production frontend secrets with `wrangler secret put <NAME> --env production`: `PHONE_OTP_ADMIN_SECRET`, `PHONE_OTP_NOTIFY_SECRET`, `PHONE_OTP_WORKER_SECRET` (each the SAME value as its `*_PRODUCTION` Secrets Store twin) and `PHONE_OTP_WORKER_URL` = placeholder `https://aladdin-whatsapp-otp.internal/v1/otp/send`. **Never** `OTP_ADMIN_GRANT_SECRET*` on the frontend. Leave `PHONE_VERIFICATION_ENABLED`, `PHONE_SIGNUP_VERIFICATION_ENABLED`, `PHONE_OTP_DELIVERY`, `PHONE_OTP_HMAC_KEYS` unset. | `wrangler secret list --env production` shows the four new names and no OFF flags | `wrangler secret delete <NAME> --env production` |
| **P-5** | `node edge/whatsapp-otp-worker/scripts/check-production-config.mjs` (PASS) and `wrangler deploy -c wrangler.production.jsonc --dry-run`: 5 Secrets Store bindings, `IDEMPOTENCY_DB`, `APP_NOTIFY`, cron `* * * * *`, no routes | PASS and that binding list | none (nothing uploaded) |
| **P-6** | Deploy the **private** Production Worker (delivery OFF): `wrangler deploy -c wrangler.production.jsonc` from `edge/whatsapp-otp-worker`. It must exist before any frontend version is uploaded or deployed. | `workers_list` shows it, no public address; `node scripts/worker-preflight.mjs` (needs `PHONE_OTP_WORKER_SECRET`) reports `delivery_permitted: false`, `delivery_enabled: false`; cron runs (section 6) | before a frontend binds to it: `wrangler delete aladdin-whatsapp-otp-production` (nothing depends on it yet). Afterwards: roll back to the previous version, never delete. |
| **P-8** | After Phase 2: Super Admin initialises limits **150 / 5,000 / 70 / 90** on `/admin/whatsapp-otp` (typed ceiling confirmation, reason). Needs P-1 and the new frontend. | limits and one audit row shown; **the Sending switch stays OFF and disabled** (`environment_not_permitted`) | audited setting: change it through the page |
| **P-9** | G-NOTIFY: "Test the alert connection" on the Admin page; confirm the attestation cron (section 6); review Security Events | probe reachable; `delivery_attestation_age` 0 to 120 s; no `whatsapp_otp_attestation_failed` lines | none |

## 4. P-1: the Production grant-key helper (built, not run)

`scripts/hosted-db/provision-grant-key/provision-grant-key-production.mjs` runs the **same reviewed code path** as the Acceptance helper (its 23 tests pass unchanged) under a stricter `PRODUCTION_PROFILE`:

| Requirement | Enforced by |
|---|---|
| a **written approval reference** for any write: `--approval=PROD-GRANT-YYYYMMDD-XXXX` (from the release record), checked before any prompt or connection and echoed in the output | code + tests |
| a different typed phrase, `PROVISION PRODUCTION` (the Acceptance phrase is rejected) | code + tests |
| exact Production host/user only; a connection string mentioning the **Acceptance** project is refused; Acceptance's parser still refuses Production | code + tests |
| Postgres `17.6` pinned, history at least 194 rows, migration `20261103090001` applied, table present, RLS on, **empty** (never overwrites a key) | code + tests |
| never in CI; hidden prompts only (interactive terminal); key and URI never from an argument, file, environment variable or pipe | code + tests |
| key only as a bound `bytea` parameter of a constant statement; only a 12-hex fingerprint is ever printed; nothing written to disk | code + tests |
| a **dry run** (default) is read-only and needs no approval | code + tests |

Run it from the owner's machine: dry run first (`node provision-grant-key-production.mjs`), then, with approval, `node provision-grant-key-production.mjs --write --approval=PROD-GRANT-YYYYMMDD-XXXX`. The value must be the same bytes as `OTP_ADMIN_GRANT_SECRET_PRODUCTION` (a Secrets Store value cannot be read back, so the owner must hold it). Record the printed approval, fingerprint and time in the release record. 14 new tests cover each refusal before any connection and that no secret reaches the output.

## 5. Phase 2: user-facing frontend activation, with a hosted login compatibility gate

**Why separate:** the Production frontend (`aladdin-frontend-production`, last deployed 2026-10-30) deploys from `main`. The integrated build changes live sign-in (`/auth/sign-in`, `/auth/sign-up`, retired `/installer/*` and `/showroom/*` entry pages become permanent redirects), onboarding and registration for every user. It must not go live as a side effect of the OTP infrastructure.

**Upload-only staging (added to `.github/workflows/cloudflare-production.yml`):** `stage = frontend-upload` builds and uploads the frontend as a **new version that is not deployed (0% of traffic)**. Both `frontend-upload` and `frontend` now refuse unless the private OTP Worker exists. The workflow runs only from `main` and only with `CLOUDFLARE_PRODUCTION_ENABLED=true` in the `cloudflare-production` environment (owner reviewer). Test the version on the live hostname with the header `Cloudflare-Workers-Version-Overrides: aladdin-frontend-production="<version id>"`: only requests that carry it reach the new version. **Promotion is a separate manual step and approval:** `wrangler versions deploy <version id>@100% --env production`. Rollback after promotion: `wrangler rollback --env production` (or the previous version in the dashboard); never `wrangler delete` the frontend.

**Hosted login compatibility gate (run in this order; any failure stops the rollout):**

| # | Where | Check | How |
|---|---|---|---|
| L1 | Acceptance preview with the integration build | email + password sign-in for the three Acceptance test accounts; read-only | existing `hosted-acceptance-e2e.yml` (needs a build deployed to the preview: its own approval) |
| L2 | Acceptance | Google, Facebook, legacy phone number, username, forgot password, sign out; existing registration undisturbed; `/installer/*` and `/showroom/*` redirect to `/auth/*` | owner, manually (OAuth is interactive); no account is created |
| L3 | Production, **uploaded version via the override header** | sign-in as an existing, owner-designated Production account (email, username, legacy phone); no sign-up, no data change | owner, manually, with a CAPTCHA-capable browser (hosted CAPTCHA is ON) |
| L4 | Production, same version | `/auth/sign-in` and `/auth/sign-up` render; `POST /api/internal/whatsapp-otp/delivery-attest` answers 401 to an unsigned request (not 404/500); `/admin/whatsapp-otp` loads for a Super Admin | owner / read-only requests |
| L5 | after promotion | repeat L3/L4 without the header within minutes; keep the previous version id ready for rollback | owner |

## 6. Expected ON/OFF behaviour and monitoring

| Condition | Result |
|---|---|
| Shipped state (permit `"false"`, no switch row) | Every send answers `503 delivery_disabled`; Meta and the token are never touched. The Admin switch is disabled. |
| Permit `"true"` (a separate reviewed change to `wrangler.production.jsonc` **and** the guard, the approved cutover) and no switch row | Still OFF; a Super Admin can switch ON once every prerequisite is met. |
| Super Admin turns ON | D1 row ON immediately; **sending starts at the next successful attestation (about one minute)**; the page says it is waiting for the Aladdin database's confirmation. |
| Super Admin turns OFF | **Immediate** (OFF never waits for an attestation). |
| Permit set back to `"false"` | Immediate kill switch whatever the Admin state says. |
| App unreachable, attestation older than 10 minutes, bad signature, wrong environment or version | OFF (fail closed); the page shows "overdue" after 3 minutes with the switch on. |
| Direct D1 write, rollback to an older state, forged switch **and** audit row | cannot send; alert `delivery_unmatched` within about a minute. |
| Missing `APP_NOTIFY` binding | the "alert connection" prerequisite fails: ON is refused with an explanation |

| Monitoring signal | Where | Action |
|---|---|---|
| `{"event":"whatsapp_otp_attestation_failed","reason":"<code>"}` (codes: `app_401`, `app_403`, `app_503`, `answer_unsigned`, `answer_stale`, `answer_invalid`, `notify_transport_unavailable`, `notify_unconfigured`, `d1_unreadable`, `attest_failed`, `exception`) | Workers Logs for `aladdin-whatsapp-otp-production` | **alert on 3 or more in 5 minutes**; sustained failure stops delivery from being ON |
| `whatsapp_otp_maintenance_errors`, `whatsapp_otp_notify_failed` | same | step failures, alert outbox retries |
| `delivery_attested`, `delivery_attestation_age` (healthy: age 0 to 120 s; `delivery_attested` is true only once a switch row exists and matches) | Admin page, signed `/v1/admin/usage` | overdue notice after 3 minutes while ON |
| `whatsapp_otp.delivery_unmatched`, `whatsapp_otp.audit_unmatched` | Admin notification inbox (staff with `whatsapp_otp.view`) | security event: turn OFF, investigate D1 access |
| steady 200 every minute from `POST /api/internal/whatsapp-otp/delivery-attest` | frontend Worker logs | 401/403/503 patterns point at the secret, environment or database |

There is **no automated paging** today: the events are searchable but nobody is notified. Before activation the owner chooses a channel (a Workers Logs / Notifications rule on the event above, or a log drain) and the recipient.

## 7. First Production step, rollback, remaining blockers

**First Production step (for separate approval): P-0b then P-2**, in one sitting: the read-only P-0b recovery snapshot, followed by `supabase db push --linked --include-all` from the approved `main` commit. Before that: this branch is merged to `main` by the owner (so CI, the `frontend-upload` stage and the Cloudflare workflow exist on `main`). Nothing user-facing changes at P-2: the old frontend `a3b08a22` keeps serving, and it is the rollback baseline for P-7.

**Rollback summary:** P-2 is additive: forward-fix with a new migration, or restore from the P-0b snapshot (hours, loses writes since the snapshot); P-1 delete one row; P-3 leave empty tables; P-4 delete secrets; P-6 delete the new Worker (before the frontend binds to it); frontend: uploaded versions serve 0% until promoted, and `wrangler rollback --env production` returns to `a3b08a22`.

**Remaining blockers:** (1) owner approval to merge to `main`; (2) approval of P-0b/P-2 and a window; (3) written approval reference and code approval for the Production grant helper (P-1); (4) final CI on the pushed SHA; (5) the hosted login gate L1 to L5 before P-7 (needs the OTP Worker deployed and the upload-only version, therefore after `main`); (6) alert recipients and A10, which block only live activation.

## 8. A10 and activation (not part of this checklist)

A10 (evidence pack, rollback drill, hosted login matrix) gates **live activation**: P-10 (G-META evidence), the permit change and the first controlled send. Section 5 is the login gate for **P-7**; it is a prerequisite for user-facing activation, not for the infrastructure phase.
