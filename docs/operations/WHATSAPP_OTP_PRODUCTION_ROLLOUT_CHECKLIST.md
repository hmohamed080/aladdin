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

## 1. Read-only hosted facts (verified 2026-11-07; the Production Supabase row was updated 2026-11-08, and the Workers row is historical: the OTP Worker now exists, P-6)

| Area | Fact |
|---|---|
| Supabase **Production** (`kkpkgjrweysgvhvkhzun`, Postgres 17.6.1) | **UPDATED 2026-11-08: 203 applied**, latest `20261107090003` (P-2 done, owner-run 2026-11-07), **no remote-only rows**. Exactly **4 pending** on `main` (`20261105090001`, `20261107090004`, `090005`, `090006`; Gate M); `20261105090001` sorts below the latest, so that push needs `--include-all`. (Superseded 2026-11-07 reading: 195 applied, 8 pending.) |
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
| **P-0** | Read-only: repeat section 1 from the final commit; CI green on that SHA. **Historical (first push, done).** For the Gate M follow-up the equivalent read-only check is: Production shows 203 applied, latest `20261107090003`, and the dry run with `--include-all` lists exactly the 4 pending. | the pending list equals the expected list; no remote-only rows | none (read-only) |
| **P-0b** | Read-only, **immediately before P-2**: `bash scripts/hosted-db/production-recovery-snapshot.sh` (dump only; validates the dump's COPY row counts against Production's SELECT counts, bracketing the dump because Production is live; writes `snapshot-meta.txt` only if valid), then `bash scripts/hosted-db/encrypt-backup.sh <folder>` (AES-256, decrypts it again and compares, then writes `<folder>.tar.gpg.verified`). The recovery point is this snapshot (restore with the existing `restore-acceptance.sh` procedure). | `OK for P-2` printed; `.verified` exists | none (read-only) |
| **P-2** | **COMPLETED 2026-11-07 (first push, 195 to 203). The same script now guards the Gate M follow-up (203 to 207, exactly 4 pending, `--include-all`); the sentence below describes the first push (its 195 / 8 / 203 numbers are historical).** **Only** `bash scripts/hosted-db/production-p2-push.sh <snapshot folder>` (add `--check-only` first to run every gate without pushing). It refuses unless: checkout clean and equal to `origin/main`; snapshot is of Production, history 195 / `20261107090002`, row counts validated, **at most 60 minutes old** (re-checked after the typed confirmation), backup files match their checksums; the encrypted copy is unchanged since its recovery check passed and belongs to this snapshot; the linked project is Production, 195 applied, no remote-only rows, **exactly the 8 expected pending**, and the `--include-all` dry run would push exactly those 8. It then pushes with `--include-all` and confirms 203 applied, none pending. The old frontend keeps running (all eight are additive except the two reviewed exceptions). | script prints `P-2 done: 203 applied, none pending`; then `count(*) from public.admin_permissions where key like 'whatsapp_otp.%'` = 3; `app.whatsapp_otp_grant_key` exists, RLS on, **empty**; sign-in still works on the OLD frontend | **no automatic down.** Forward-fix with a new migration, or restore from the P-0b snapshot. Each file is its own transaction, so a failure stops at the first failing file; a re-run resumes. |
| **P-1** | Owner provisions the Production grant key with the **Production helper** (section 4). | one row, fingerprint matches the owner's record, schema signature and history unchanged | delete that one row; the Worker then answers `grant_invalid` and every change fails safely |
| **P-3** | `wrangler d1 migrations apply aladdin-whatsapp-otp-production --remote` (records `0001` as a no-op, applies `0002`, `0003`) | `node scripts/d1-baseline-check.mjs aladdin-whatsapp-otp-production` reports `current`; 0 rows everywhere (no switch row = OFF) | additive and idempotent, tables empty: leave them |
| **P-4** | **COMPLETED 2026-11-07 (owner ran `--apply`): undeployed version `3fc37397-9157-4fa6-8fce-d32dffe0a194`; the live frontend `a3b08a22` is still alone at 100%. Verified read-only with `node scripts/hosted-db/provision-frontend-otp-secrets.mjs --verify-version=3fc37397-9157-4fa6-8fce-d32dffe0a194` (and independently by the owner against Cloudflare): not deployed, the only version newer than live, all 18 existing bindings identical, exactly the 4 new `secret_text` bindings, script etag and handlers identical, runtime identical after normalizing two documented asset defaults. Do NOT run `--apply` again.** How it is done: owner runs `node scripts/hosted-db/provision-frontend-otp-secrets.mjs` (read-only preflight), then `... --apply`. It creates **ONE undeployed frontend version (0% of traffic)** carrying `PHONE_OTP_ADMIN_SECRET`, `PHONE_OTP_NOTIFY_SECRET`, `PHONE_OTP_WORKER_SECRET` (each the SAME value as its Secrets Store twin `OTP_ADMIN_SIGNING_SECRET_PRODUCTION`, `OTP_NOTIFY_SIGNING_SECRET_PRODUCTION`, `PHONE_OTP_WORKER_SECRET_PRODUCTION`) and `PHONE_OTP_WORKER_URL` = placeholder `https://aladdin-whatsapp-otp.internal/v1/otp/send`, using `wrangler versions secret bulk` fed through **stdin** from hidden prompts (nothing on disk, in a command line, an environment variable or a log). **Never** `wrangler secret put` (it deploys immediately), never `OTP_ADMIN_GRANT_SECRET*` on the frontend. Leave `PHONE_VERIFICATION_ENABLED`, `PHONE_SIGNUP_VERIFICATION_ENABLED`, `PHONE_OTP_DELIVERY`, `PHONE_OTP_HMAC_KEYS` unset. | the script's postflight: deployment unchanged (the live version still alone at 100%), exactly one new version not in the deployment, its bindings = the live version's plus exactly the 4 new names (every other secret, var and service binding deep-equal, runtime settings unchanged). Independently: `wrangler deployments status --env production`, `wrangler versions view <new id> --env production` | nothing live changes, so nothing to undo: ignore the version (versions are inert until deployed). To drop the names anyway: `wrangler versions secret delete <NAME> --env production` (another undeployed version). Live rollback is always `wrangler rollback --env production`. |
| **P-5** | `node edge/whatsapp-otp-worker/scripts/check-production-config.mjs` (PASS) and `wrangler deploy -c wrangler.production.jsonc --dry-run`: 5 Secrets Store bindings, `IDEMPOTENCY_DB`, `APP_NOTIFY`, cron `* * * * *`, no routes | PASS and that binding list | none (nothing uploaded) |
| **P-6 COMPLETED 2026-11-07** (version `4415c515-cfe9-4e85-b2e5-1e5852ad8cc0`; see "P-6 result") | Owner deployed the **private** Production Worker (delivery OFF): from `edge/whatsapp-otp-worker`, `pnpm exec wrangler deploy -c wrangler.production.jsonc`. It must exist before any frontend version is uploaded or deployed. | **read-only:** `node edge/whatsapp-otp-worker/scripts/check-production-deployment.mjs` (see P-6 details). **Not** `worker-preflight.mjs`: it needs a public URL and assumes allowlist mode, and this Worker is private with recipient mode `open`. The authenticated runtime probe is P-7a, after the frontend upload. | before a frontend binds to it: `wrangler delete aladdin-whatsapp-otp-production` (nothing depends on it yet). Afterwards: roll back to the previous version, never delete. |
| **P-8** | After Phase 2: Super Admin initialises limits **150 / 5,000 / 70 / 90** on `/admin/whatsapp-otp` (typed ceiling confirmation, reason). Needs P-1 and the new frontend. | limits and one audit row shown; **the Sending switch stays OFF and disabled** (`environment_not_permitted`) | audited setting: change it through the page |
| **P-9** | G-NOTIFY: "Test the alert connection" on the Admin page; confirm the attestation cron (section 6); review Security Events | probe reachable; `delivery_attestation_age` 0 to 120 s; no `whatsapp_otp_attestation_failed` lines | none |

### P-4 details: secret handling and what can and cannot be proven

- **Why not `wrangler secret put`:** Cloudflare documents that it creates a new version **and deploys it immediately**. `wrangler versions secret bulk` only creates a version; `wrangler versions deploy` is a separate step. `bulk` patches the **latest** version, copying its bindings, so the script refuses unless the latest version IS the live one (`a3b08a22`, only deployed version, 100%). Cloudflare also documents that `wrangler deploy` never deletes secrets and that `versions upload` keeps secrets not in its file; **before promoting the uploaded frontend version, run `wrangler versions view <uploaded id> --env production` and confirm it lists the 3 `PHONE_OTP_*` secrets and the URL** (if not, run the script again on top of that version and promote that one).
- **Secret handling:** hidden prompts, each value typed twice; each must be a `whsec_` value of at least 32 bytes with real entropy (the grant-key rule); the three must differ; none may be the Production grant key (its 12-hex fingerprint `f52afdd8b900` from P-1 is pinned in the script, so `OTP_ADMIN_GRANT_SECRET_PRODUCTION` cannot be reused without pasting it); only 12-hex fingerprints are printed; the JSON goes to wrangler's stdin in memory; wrangler's own output is printed with every value redacted; never in CI.
- **Runtime comparison (found in the real run):** the new version reports `assets.html_handling: auto-trailing-slash` and `assets.not_found_handling: none` where the live version omits them; these are Cloudflare's documented defaults. The comparison normalizes **only these two keys** (absent equals the default); an explicit different value or any other runtime key still counts as a change. `--verify-version=<id>` re-runs the checks read-only against an existing version (creates nothing, prompts nothing, cannot be combined with `--apply`).
- **If something fails:** a nonzero wrangler exit is never taken to mean "nothing was created": the script re-reads deployments and versions (read-only) and says either "verified: no new version exists" or lists the new version id(s), or "could not verify" with the read-only commands to run. If postflight fails after a successful upload, it prints the new version id and the safe recovery steps (check `wrangler deployments status`, inspect with `wrangler versions view`, leave the undeployed version alone, roll back only if the live deployment moved, and only with approval). It never retries and never promotes.
- **Cannot be proven from here:** that each value equals its Secrets Store twin (a Secrets Store value cannot be read back). Paste the same password-manager entries that created the three `*_PRODUCTION` store secrets. A mismatch is harmless while delivery is OFF and is detected after P-6: the P-9 "Test the alert connection" and the attestation call prove the admin and notify pairs (401 on mismatch); the send pair is verified by the Worker before the delivery check (401 for a bad signature, 503 `delivery_disabled` for a good one), which no Meta call can follow while OFF.

### P-6 details: verification of a private Worker, and the expected cron noise

**Owner-run commands (Git Bash, from the repository root; not PowerShell):**

```bash
(cd edge/whatsapp-otp-worker && pnpm exec wrangler deploy -c wrangler.production.jsonc)
read -rsp 'Read-only Cloudflare API token: ' CLOUDFLARE_API_TOKEN; echo; export CLOUDFLARE_API_TOKEN   # Workers Scripts Read, Zone Read, Workers Routes Read; hidden prompt
export CLOUDFLARE_ACCOUNT_ID='<account id>'
node edge/whatsapp-otp-worker/scripts/check-production-deployment.mjs
unset CLOUDFLARE_API_TOKEN
```

The check lists zones, routes and domains page by page and refuses to pass if any list is incomplete. The D1 binding is compared by the API field `database_id`.

**P-4 log assessment (read-only, no values printed):** Wrangler's debug log for the P-4 run (`versions secret bulk`, 2026-11-07) records `INIT: omitted; set WRANGLER_LOG_SANITIZE to include sanitized data` for the request and `RESPONSE: omitted` for the reply, and contains no `whsec_` string and no `secret_text` binding; `WRANGLER_LOG_SANITIZE` is not set on this machine. The secrets were therefore not written to disk, and no rotation is needed. `provision-frontend-otp-secrets.mjs` now forces `WRANGLER_LOG_SANITIZE=true`, `WRANGLER_LOG=log` and `WRANGLER_SEND_METRICS=false` in the Wrangler child process whatever the shell says.

- **Verification (read-only, replaces `worker-preflight.mjs` and the Meta preflight for Production):** `node edge/whatsapp-otp-worker/scripts/check-production-deployment.mjs` runs only reads: (1) `deployments status`: one version at 100%; (2) `versions view` of that version: the deployed bindings equal `wrangler.production.jsonc` exactly (D1, the five Secrets Store secrets, `APP_NOTIFY`, the plain variables, nothing extra) and `WHATSAPP_DELIVERY_ENABLED="false"`, `OTP_RECIPIENT_MODE="open"`, `OTP_ENVIRONMENT="production"`; the config file has `workers_dev=false` and no routes. Binding **types and fields are compared exactly** (`d1` with the database id, `secrets_store_secret` with store id and secret name, `service` to `aladdin-frontend-production` in `production`, `plain_text` variables), never by substring; (3) one `SELECT` on D1: `otp_delivery_switch`, `otp_delivery_audit` and `otp_delivery_attestation` are empty (delivery was never switched on) and `otp_alert_state` has its one seed row; (4) **Cloudflare API reads (the evidence for privacy and cron):** `workers.dev` disabled, preview URLs disabled, no custom domain for the Worker, no route in any zone of the account pointing at it, and the cron trigger registered exactly as declared (`* * * * *`); this needs `CLOUDFLARE_API_TOKEN` (read-only: Workers Scripts Read, Zone Read, Workers Routes Read) and `CLOUDFLARE_ACCOUNT_ID` in the shell, and the check **refuses to pass without them**; (5) two unauthenticated GETs that must **not** reach the Worker (its `workers.dev` address and `https://aladdindecore.com/v1/otp/send`; the Worker answers any GET with a JSON 404 whose body is `{}`, so that fingerprint or any 2xx fails). These GETs are **supplementary**: a GET that misses the Worker proves nothing about routing. Before P-6 it fails cleanly at step 1 (Worker not deployed). It never sends, writes, tails or deploys.
- **Authenticated runtime probe:** a private Worker is reachable only through the frontend's `OTP_WORKER` service binding, so this probe is **P-7a**, run after the frontend upload (section 5).
- **Expected noise from P-6 until the frontend is promoted (P-7):** the Worker's cron (`* * * * *`) runs the attestation round trip through `APP_NOTIFY`, but the live frontend (`a3b08a22`) does not have `/api/internal/whatsapp-otp/delivery-attest` yet, so the Next app answers 404. Expect **one `{"event":"whatsapp_otp_attestation_failed","reason":"app_404"}` line per minute** in Workers Logs for `aladdin-whatsapp-otp-production`, and the same unsigned 404 appearing in the frontend's request log. This is harmless and fail-closed: nothing can send in this state (permit `"false"`, no switch row), and the attestation carries only switch metadata, never a code or a number. Do **not** alert or page on it before promotion. After promotion it must change to a steady success within about two minutes; a persisting `app_401` or `app_403` then means a secret or environment mismatch (investigate), and `app_404` after promotion means the promoted version lacks the route (roll the frontend back).

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
| L1 | Acceptance preview with the integration build | email + password sign-in for the three Acceptance test accounts; read-only | owner's headed real-browser run (`pnpm --filter frontend e2e:acceptance:headed`, `docs/operations/ACCEPTANCE_E2E_HEADED_RUN.md`, #156): **11/11 PASS reported by the owner 2026-11-08**. The GitHub-runner workflow `hosted-acceptance-e2e.yml` cannot pass the real Turnstile challenge headless (4/11), so it is not the gate; CAPTCHA and Access are never weakened to make it pass |
| L2 | Acceptance | Google, Facebook, legacy phone number, username, forgot password, sign out; existing registration undisturbed; `/installer/*` and `/showroom/*` redirect to `/auth/*` | owner, manually (OAuth is interactive); no account is created |
| L3 | Production, **uploaded version via the override header** | sign-in as an existing, owner-designated Production account (email, username, legacy phone); no sign-up, no data change | owner, manually, with a CAPTCHA-capable browser (hosted CAPTCHA is ON) |
| L4 | Production, same version | `/auth/sign-in` and `/auth/sign-up` render; `POST /api/internal/whatsapp-otp/delivery-attest` answers 401 to an unsigned request (not 404/500); `/admin/whatsapp-otp` loads for a Super Admin | owner / read-only requests |
| **P-7a** (L4a) | Production, **uploaded version via the override header**, after P-6 | **authenticated runtime probe through the private service binding:** a Super Admin opens `/admin/whatsapp-otp`; the "Sending service" panel (the signed `/v1/admin/usage` answer) must show environment `production`, recipient mode `open`, the delivery permit `false`, no switch row, and the expected bindings present (never a value). "Test the alert connection" must succeed. A 401 means a secret mismatch; an `unavailable` message means the `OTP_WORKER` binding or `PHONE_OTP_WORKER_URL` is missing on that version. Read-only; do not switch anything ON. | owner, in a browser with the override header |
| L5 | after promotion | repeat L3/L4 without the header within minutes; keep the previous version id ready for rollback | owner |

### P-6 result (recorded 2026-11-07)

- **Deployed by the owner:** `aladdin-whatsapp-otp-production`, version `4415c515-cfe9-4e85-b2e5-1e5852ad8cc0`, delivery OFF (`WHATSAPP_DELIVERY_ENABLED="false"`).
- **Owner's local `check-production-deployment.mjs`:** every check passed except the one that needs Cloudflare API credentials (not set in that shell).
- **Owner's independent Cloudflare API verification:** private routing (no workers.dev, no routes, no custom domains), preview URLs disabled, bindings correct, cron registered, the live frontend unchanged, D1 switch tables empty, delivery OFF.
- **Agent read-only re-check (no credentials):** configuration file, one version at 100%, deployed bindings equal to `wrangler.production.jsonc`, D1 `otp_delivery_switch`/`otp_delivery_audit`/`otp_delivery_attestation` = 0 and `otp_alert_state` = 1: all ok. Frontend: `a3b08a22` alone at 100%; newest version is the undeployed P-4 version `3fc37397`.

### P-7 prerequisites (read-only, verified 2026-11-07)

| Prerequisite | Result |
|---|---|
| `main` holds the integrated OTP, registration, authentication and UI changes | **yes:** `main` = `5861d879`; `integration/otp-main-20261107` (`a54bdf95`), #143 (`de64476a`) and #144 are ancestors; CI on `main` is green. #137, #140 and #142 stay out by decision. |
| `frontend-upload` stage is on `main` and runs only from `main` | yes (`if: github.ref == 'refs/heads/main'`); it also requires the private OTP Worker (now deployed) and the backend Worker |
| Upload switch | **closed (kept `false` on purpose):** `CLOUDFLARE_PRODUCTION_ENABLED=false` in the `cloudflare-production` environment; without it every stage only builds |
| Reviewer on the `cloudflare-production` environment | **set 2026-11-07:** `hmohamed080` is a required reviewer (self-review allowed because the owner is the only user; admin bypass is still the GitHub default `true`). Every Production stage now waits for that approval. |
| Acceptance preview build (L1/L2) | **UPDATED 2026-11-08: A1 done (preview `d8ff501d` from `fc62c4b5`); manual L1/L2 summary PASS as reported by the owner, per-row evidence incomplete (PR #151).** Historical readiness note: **A1 readiness verified 2026-11-07 (read-only):** `cloudflare-preview` allows `main` (custom branch policy), `CLOUDFLARE_PREVIEW_ENABLED=true`, `NEXT_PUBLIC_SUPABASE_URL` is the isolated Acceptance project `nxossqhdfltcqdwvbewi`, its publishable key equals that project's key (not Production's), and the workflow refuses any URL containing the Production ref. The preview Worker still runs an older build (run `47d4fe0b`, 2026-11-05), (superseded: A1 has since been run). |
| Hosted Acceptance E2E (L1) | `hosted-acceptance-e2e.yml` already signs in through the one-field `/auth/sign-in` form and checks `/installer/sign-in`; the three test-account secrets exist in `acceptance-e2e` |
| Post-upload verification of secrets and bindings | **new, read-only:** `scripts/hosted-db/verify-frontend-upload.mjs --version=<id> --expect-sha=<40 hex>` (JSON parsing tolerates wrangler banner lines; also run against real Production data, where it correctly refuses the P-4 version as "not a new upload"; `--expect-sha` checks the version's `workers/message` label, see step B3) |

### Release candidate and migration gate (added 2026-11-08, before any A or B step)

**Release-candidate (RC) rule (re-pinned 2026-11-08 to `main` d0517c2f, after #156).** The pinned runtime baseline is `d0517c2f696022a4bc500ee0ead88db20f056324` (`d0517c2f`, `main` after #152, #153 and #156). The previous baseline `fc62c4b5` differs from it in exactly ONE runtime-path line: the `frontend/package.json` script `e2e:acceptance:headed` (added by #156; a developer test launcher, not part of the bundle, the dependencies or the upload). Everything else that changed since `fc62c4b5` is e2e suites, playwright configs, `scripts/hosted-db` gate scripts and docs. So the Acceptance preview `d8ff501d` (A1, built from `fc62c4b5`) and the owner-reported L1/L2 result still describe the same application bytes; A1/A2/A3 do NOT need repeating because of this re-pin (verify: `git diff fc62c4b5a3f9284fb2fc7d9b52df8193d558a13a d0517c2f696022a4bc500ee0ead88db20f056324 -- frontend/package.json` shows one added line, `e2e:acceptance:headed`). The workflow can only be dispatched from `main` and builds `GITHUB_SHA` (= `main` HEAD at dispatch). So the **RC for deployment is `main` HEAD at dispatch time if, and only if, the RUNTIME diff against `d0517c2f` is empty; otherwise STOP and re-fix the RC** (new RC SHA, new Acceptance A1 build and A2/A3, Gate M re-derived). A later script-only edit to `frontend/package.json` will also print a line: review it and re-pin deliberately, never skip the check.

**RUNTIME paths** (everything that is built into, or decides how the frontend bundle is built, uploaded or bound): `frontend/src`, `frontend/public`, `frontend/cloudflare`, `frontend/scripts` (build helper `build-cloudflare.mjs`), `frontend/wrangler.jsonc`, `frontend/next.config.ts`, `frontend/open-next.config.ts`, `frontend/tailwind.config.ts`, `frontend/postcss.config.mjs`, `frontend/tsconfig.json`, `frontend/package.json` (whole file, so a dependency change cannot hide), root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `backend/`, `edge/`, `supabase/` (includes migrations) and `.github/workflows/cloudflare-production.yml` (the upload definition itself). Not runtime: `frontend/e2e*`, `playwright*.config.ts`, `ci.yml`, `hosted-acceptance-e2e.yml`, `ops/`, `scripts/`, `docs/`.

Owner command at dispatch (Git Bash, repository root; run it before A1, again immediately before B0, and once more right before B1):

```bash
git fetch origin main && RC=$(git rev-parse origin/main) && echo "RC=$RC"
git diff --stat d0517c2f696022a4bc500ee0ead88db20f056324 origin/main -- frontend/src frontend/public frontend/cloudflare frontend/scripts frontend/wrangler.jsonc frontend/next.config.ts frontend/open-next.config.ts frontend/tailwind.config.ts frontend/postcss.config.mjs frontend/tsconfig.json frontend/package.json package.json pnpm-workspace.yaml pnpm-lock.yaml backend edge supabase .github/workflows/cloudflare-production.yml
# MUST print NOTHING. Any output (even one line): STOP, do not dispatch, re-fix the RC.
git diff --stat d0517c2f696022a4bc500ee0ead88db20f056324 origin/main   # review only: .github (other workflows), docs, scripts, e2e, ops may appear
```

`$RC` printed by the first line is the SHA to compare with the run's head SHA and to pass to the verifier (`--expect-sha`). A1 and B1 must run from a `main` whose runtime diff against `d0517c2f` is empty; compare the run's head SHA (`gh run view <id> --json headSha -q .headSha`) with `$RC`. If `main` moves between A1 and B1 the diff command decides again; a runtime change means redo A.

**Gate M (blocks PROMOTION, step D1; it does NOT block the 0% upload B1):** the Production database must have the 4 pending migrations before the new frontend takes traffic. Confirmed from `.github/workflows/cloudflare-production.yml`: `frontend-upload` only builds and runs `wrangler versions upload` (no database access, no migration check), and an uploaded version serves 0% until `versions deploy`. From repository files only (no Production connection was made): `main` has 207 migrations; `5861d879` had 203, which is what P-2 applied. The delta `5861d879..78d1b5c0` adds exactly `20261105090001_admin_staff_invitations`, `20261107090004_media_id_storage_keys`, `20261107090005_request_and_verification_media` and `20261107090006_admin_backup_control`. The frontend depends on them (staff-invitation pages and actions, media-id storage keys and the media route, purchase-request and business-verification uploads, `/admin/backups` and its server actions; `database.types.ts` gained their tables and functions), so **promoting it (D1) against a database without them would break those features: D1 is blocked until a separately approved P-2 follow-up applies the 4 migrations.** Consequences for the order: B0 to B3 may run before Gate M; in step C (tests through the override header, which hit the real Production database) only the OTP and sign-in probes (L3, L4, P-7a) are meaningful, and pages that need the 4 migrations (staff invitations, media, request uploads, `/admin/backups`) are expected to fail until Gate M is closed; that is not a stop condition for B or C. Notes: (a) `20261105090001` is older than the latest applied `20261107090003`, so the push needs `db push --include-all` (the same out-of-order handling as the first P-2); (b) the runbook and the updated gate (`EXPECT_APPLIED` 203, latest `20261107090003`, 4 pending) are PR #148, **now merged on `main` (`a0aa2296`)** (`docs/operations/MIGRATION_DRYRUN_RUNBOOK_20261108.md`); (c) take a fresh Production recovery snapshot (P-0b) before the push; (d) re-verify the applied count and the four names read-only right before D1; (e) **do not use `scripts/hosted-db/production-post-migration-check.sh`**: it expects 191 versions (latest `20261024090011`), is obsolete and now exits 2 immediately. After the push use `production-p2-push.sh`'s own post-push check (207 applied, none pending) and `supabase migration list --linked`. The migrations are additive, and the OTP path itself does not need them, but the build as a whole does.

Other gating items: `LIVE_VERSION` in `provision-frontend-otp-secrets.mjs` is pinned to `a3b08a22`, so the verifier fails closed (REFUSED) if the live version changes in between. What the verifier can prove about the source commit is described under B3.

### Production phone sign-up secrets (5)

The Production frontend (P-4 version `3fc37397`, checked read-only 2026-11-08, names only) has the four `PHONE_OTP_*` secrets but **lacks the five the new phone sign-up needs**: `PHONE_OTP_DELIVERY` (`worker`; absent means off), `PHONE_VERIFICATION_ENABLED` (`true`), `PHONE_SIGNUP_VERIFICATION_ENABLED` (`true`), `PHONE_OTP_HMAC_KEYS` (keyring JSON, fresh kid plus 32 random bytes) and `PHONE_SIGNUP_COOKIE_SECRET` (random, at least 32 characters). Rules: `frontend/src/lib/env/phone-verification.ts`. Without them the new sign-up (`frontend/src/server/phone-verification/*`) cannot work in Production.

The live frontend (`a3b08a22`) serves the legacy OTP-less phone registration and ignores these five, so setting them to their enabled values is safe before promotion. **The real control is the database**: `app.phone_verification_config.enabled` / `signup_enabled` (default `false`) are the instant gate. There is no sign-up allowlist step in this cutover.

**Owner commands** (Git Bash, repository root; no `pnpm install` needed beyond the existing one). The script `scripts/hosted-db/provision-frontend-signup-secrets.mjs` generates the values in its own memory (`crypto.randomBytes`), pipes them to `wrangler versions secret bulk --env production --tag p4b-signup-secrets` on stdin, and never prints, logs or writes them (only names are shown; wrangler runs with `WRANGLER_LOG_SANITIZE=true`). It creates ONE undeployed version on top of the P-4 version (the latest upload, which `versions secret bulk` patches).

```bash
node scripts/hosted-db/provision-frontend-signup-secrets.mjs            # DRY RUN (default): read-only checks, lists the five NAMES it would set, writes nothing
node scripts/hosted-db/provision-frontend-signup-secrets.mjs --apply    # owner only, own approval: asks you to type  SET 5 PHONE SIGNUP SECRETS ON aladdin-frontend-production
```

It refuses unless: production env (hard-coded), not CI, interactive terminal, the live deployment is exactly `a3b08a22` alone at 100%, the latest uploaded version is the P-4 version with its four names, none of the five exist yet, and the typed phrase matches; it re-checks immediately before the write. Post-check (read-only, names only): deployment unchanged, exactly one new version, not deployed, bindings equal the P-4 version plus exactly the five `secret_text` names. Do not promote that version. **Run it once, and before B1** (the 0% upload carries secrets from the latest version).

**Order (matches the release sequence in PR #158):** 1. provision the five secrets (above) → 2. 0% upload (B0 to B2) → 3. verify (B3: expects P-4 secrets + these five + `OTP_WORKER`, refuses a version lacking any of them, an unknown extra secret, or the P-4-only set) → 4. minimal live delivery check through the version-override header (step C; the database switches are what permit a send) → 5. promote (D1, after Gate M). Nothing is promoted by steps 1 to 4. Recovery if step 1 goes wrong: the new version serves no traffic; inspect with `versions view` and leave it, or remove names with `wrangler versions secret delete` after review.

### P-7 owner-approved execution sequence (Git Bash, repository root; every step needs its own approval)

Build everything below from `RC` (see the RC rule above: empty runtime diff against `d0517c2f`, else STOP). Every step needs its own approval; stop at the first failed check. Gate M is required only before step D1.

**A. Acceptance (L1/L2), no Production resource involved**

```bash
gh workflow run cloudflare-frontend-preview.yml --ref main          # A1: redeploy the Acceptance preview from the RC (DONE 2026-11-08: preview d8ff501d from d0517c2f; re-run only if the RC changes); check the run's head SHA equals $RC
gh run watch                                                         # wait for green
gh workflow run hosted-acceptance-e2e.yml --ref main                # A2: L1, read-only sign-in of the 3 test accounts
gh run watch
```

A3 (L2, owner, manual, on `https://aladdin-frontend-preview.bstalent9.workers.dev`): Google, Facebook, legacy phone number, username, forgot password, sign out; `/installer/*` and `/showroom/*` redirect to `/auth/*`; no account is created. Any failure stops the rollout.

**B. Production upload only (0% of traffic): open the switch, dispatch, close the switch, verify**

```bash
RC=$(git rev-parse origin/main)      # same RC as proven above; do not dispatch if the runtime diff against d0517c2f is not empty
gh variable set CLOUDFLARE_PRODUCTION_ENABLED --env cloudflare-production --body true      # B0: switch OPEN (reviewer already set)
gh workflow run cloudflare-production.yml --ref main -f stage=frontend-upload               # B1: the owner approves the environment review in the GitHub UI
gh run list --workflow cloudflare-production.yml --event workflow_dispatch --branch main --limit 1 --json databaseId,headSha,status,createdAt # note the run id (it must be the run you just dispatched); headSha must equal $RC
gh run watch <RUN_ID>                                                                       # the run summary prints 'Version ID' and the message 'upload-only <12 hex of the SHA>'
gh variable set CLOUDFLARE_PRODUCTION_ENABLED --env cloudflare-production --body false     # B2: switch CLOSED again, even if B1 failed
node scripts/hosted-db/verify-frontend-upload.mjs --version=<UPLOADED_VERSION_ID> --expect-sha="$RC"   # B3: read-only; stop if it says REFUSED
```

**B3 proves** (by name and type; values cannot be read): all P-4 secrets kept and nothing lost, the four `PHONE_OTP_*` secrets present, **plus exactly the five sign-up secrets (all `secret_text`; a missing one, an unknown extra secret, or the P-4-only set is REFUSED)**, plain variables equal to live, `BACKEND`/`WORKER_SELF_REFERENCE`/assets/images unchanged, exactly one new binding (`OTP_WORKER` to `aladdin-whatsapp-otp-production`), no `PHONE_`/`WHATSAPP_`/`OTP_` plain switch, the live version still alone at 100% and the upload at 0%. **With `--expect-sha`** it also proves the version's `workers/message` annotation equals `upload-only <first 12 hex of RC>` (the workflow passes `--message "upload-only ${GITHUB_SHA::12}"`; read-only `versions view --json` exposes it under `annotations`; the P-4 version shows `workers/message` and `workers/tag` the same way). **It cannot prove** that the bundle bytes were built from that commit: the message is a label written by the workflow, only 12 hex characters long, and the workflow sets no `--tag`. Manual cross-check (mandatory): the run's `headSha` equals `$RC`, and the run summary's version id equals the id given to the verifier. `--expect-sha` is **required** (the verifier exits 2 without it): otherwise an older version with identical bindings would pass.

- **Switch timing:** the workflow reads `CLOUDFLARE_PRODUCTION_ENABLED` when the job starts, which is after the environment reviewer approves, so keep the switch open until the run has finished (`gh run watch`), then close it in B2 whatever the outcome. Approving the review with the switch closed only builds (no upload).
- **Stop conditions for B:** the run's head SHA is not `$RC`; the runtime diff against `d0517c2f` was not empty at B0 or B1; the run summary shows no `Version ID` or says `upload: false`; B3 prints REFUSED or cannot complete; the upload shows any traffic percentage; the switch could not be closed (close it, then investigate). Nothing is deployed in B, so there is nothing to roll back; the unused version may stay at 0%.

**C. Production tests of the uploaded version (override header; no data change beyond the minimal live delivery check owned by PR #158)**

```bash
V=<UPLOADED_VERSION_ID>; H="Cloudflare-Workers-Version-Overrides: aladdin-frontend-production=\"$V\""
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" https://aladdindecore.com/auth/sign-in                               # L4: 200
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" https://aladdindecore.com/auth/sign-up                               # L4: 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "$H" https://aladdindecore.com/api/internal/whatsapp-otp/delivery-attest   # L4: 401 (not 404/500)
```

- **L3 (owner, browser with a header extension and CAPTCHA):** sign in with an owner-designated existing Production account by email, username and legacy phone number.
- **P-7a (owner, same browser and header):** as Super Admin open `/admin/whatsapp-otp`. "Sending service" must show environment `production`, recipient mode `open`, permit `false`, no switch row; "Test the alert connection" must succeed. 401 = secret mismatch; "unavailable" = missing `OTP_WORKER` binding or `PHONE_OTP_WORKER_URL`. Do not switch anything ON.
- **Stop conditions:** any failure in A, B3, L3, L4 or P-7a. Nothing has been promoted; leave the version at 0%.

**D. Promotion (separate approval; requires Gate M closed and C passed), then L5 and rollback**

```bash
(cd frontend && pnpm exec wrangler versions deploy <UPLOADED_VERSION_ID>@100% --env production)   # D1: goes live
# L5: repeat L3/L4 without the header within minutes. The cron attestation noise (app_404) should stop within a minute.
# ROLLBACK, if anything is wrong:
(cd frontend && pnpm exec wrangler rollback a3b08a22-f82e-4851-9786-9442c01e43c8 --env production -m "rollback P-7 (RC d0517c2f)")   # never wrangler delete
```

Rollback never touches the OTP Worker or D1 (delivery is OFF); never `wrangler delete` the frontend. Rolling the frontend back does not undo applied database migrations (they are additive and harmless to the old build). Before promotion there is nothing to roll back; the rollback target is always `a3b08a22-f82e-4851-9786-9442c01e43c8`, and this plan must be re-read if the live version is no longer that id.
### STATE AND NEXT GATE (2026-11-08): A1 done, owner-reported L1/L2 PASS, next Gate M / B0-B3

**STATE 2026-11-08 (owner-reported, not agent-verified):** A1 is **done** (Acceptance preview `d8ff501d-4d01-4d4c-95ac-e0948347a46b`, built from `fc62c4b5`). The owner reports the manual L1/L2 **summary as PASS**; per-row evidence is incomplete (see PR #151), so treat it as the owner's statement, not as a recorded matrix. **Next gate: Gate M / B0 to B3 per the owner's approvals** (each step needs its own approval; Gate M only blocks promotion D1, not the 0% upload B1). Live Production frontend is still `a3b08a22-f82e-4851-9786-9442c01e43c8` at 100%; delivery OFF.

The A1 commands below are kept as the record and as the re-run procedure if the RC changes (A1 must be repeated from a new RC); they are **not** the next step.

Exactly one step is next. It touches **Acceptance only** (no Production resource, no secret, no switch, no migration). Git Bash, repository root:

```bash
git fetch origin main && RC=$(git rev-parse origin/main) && echo "RC=$RC"
git diff --stat d0517c2f696022a4bc500ee0ead88db20f056324 origin/main -- frontend/src frontend/public frontend/cloudflare frontend/scripts frontend/wrangler.jsonc frontend/next.config.ts frontend/open-next.config.ts frontend/tailwind.config.ts frontend/postcss.config.mjs frontend/tsconfig.json frontend/package.json package.json pnpm-workspace.yaml pnpm-lock.yaml backend edge supabase .github/workflows/cloudflare-production.yml   # must print NOTHING, else STOP
gh workflow run cloudflare-frontend-preview.yml --ref main
gh run list --workflow cloudflare-frontend-preview.yml --event workflow_dispatch --branch main --limit 1 --json databaseId,headSha,status
gh run watch <RUN_ID>                                   # must end green
gh run view <RUN_ID> --json headSha -q .headSha         # must equal $RC
```

Real CAPTCHA stays ON on hosted Acceptance (owner decision; PR #155 is on hold). **Gate list after A1, in order, each needing its own approval; stop at the first failure:** A2 (`hosted-acceptance-e2e.yml`, L1) then A3 (L2, manual) then the runtime-diff command again, then B0 (open switch), B1 (dispatch `frontend-upload`, approve the environment review), B2 (close switch), B3 (`verify-frontend-upload.mjs --version=<id> --expect-sha="$RC"`) then C (override-header tests L4, L3, P-7a) then **Gate M** (the 4 migrations, fresh P-0b snapshot first) then D1 (promotion) then L5. WhatsApp delivery stays OFF in all of them.

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
| *(before frontend promotion only)* `{"event":"whatsapp_otp_attestation_failed","reason":"app_404"}` once a minute | Workers Logs for `aladdin-whatsapp-otp-production` | **expected and harmless** until P-7 (see P-6 details); do not alert. |
| `{"event":"whatsapp_otp_attestation_failed","reason":"<code>"}` (codes: `app_401`, `app_403`, `app_503`, `answer_unsigned`, `answer_stale`, `answer_invalid`, `notify_transport_unavailable`, `notify_unconfigured`, `d1_unreadable`, `attest_failed`, `exception`) | Workers Logs for `aladdin-whatsapp-otp-production` | **alert on 3 or more in 5 minutes**; sustained failure stops delivery from being ON |
| `whatsapp_otp_maintenance_errors`, `whatsapp_otp_notify_failed` | same | step failures, alert outbox retries |
| `delivery_attested`, `delivery_attestation_age` (healthy: age 0 to 120 s; `delivery_attested` is true only once a switch row exists and matches) | Admin page, signed `/v1/admin/usage` | overdue notice after 3 minutes while ON |
| `whatsapp_otp.delivery_unmatched`, `whatsapp_otp.audit_unmatched` | Admin notification inbox (staff with `whatsapp_otp.view`) | security event: turn OFF, investigate D1 access |
| steady 200 every minute from `POST /api/internal/whatsapp-otp/delivery-attest` | frontend Worker logs | 401/403/503 patterns point at the secret, environment or database |

There is **no automated paging** today: the events are searchable but nobody is notified. Before activation the owner chooses a channel (a Workers Logs / Notifications rule on the event above, or a log drain) and the recipient.

## 7. First Production step, rollback, remaining blockers

**Done in Production so far (owner-run, all with delivery OFF):** P-2 (203 migrations applied), P-1 (grant key, fingerprint `f52afdd8b900`), P-3 (D1 current, switch tables empty), P-4 (undeployed frontend version `3fc37397-9157-4fa6-8fce-d32dffe0a194` with the three `PHONE_OTP_*` secrets and the placeholder URL; the live frontend `a3b08a22` is still alone at 100%). P-6 (private OTP Worker `4415c515-cfe9-4e85-b2e5-1e5852ad8cc0`, verified; see "P-6 result"). **Next step (for separate approval): P-7**, steps A to D in "P-7 owner-approved execution sequence". No user-facing change happens before D1.

**Rollback summary:** P-2 is additive: forward-fix with a new migration, or restore from the P-0b snapshot (hours, loses writes since the snapshot); P-1 delete one row; P-3 leave empty tables; P-4 nothing live changes (ignore the undeployed version); P-6 delete the new Worker (before the frontend binds to it); frontend: uploaded versions serve 0% until promoted, and `wrangler rollback --env production` returns to `a3b08a22`.

**Remaining blockers (updated 2026-11-08, RC = `main` with an empty runtime diff against `d0517c2f`):** (1) `CLOUDFLARE_PRODUCTION_ENABLED` is `false` (owner switch, steps B0/B2; kept closed on purpose; the owner is the required reviewer of the environment); (2) A1 is done (preview `d8ff501d` from `d0517c2f`) and the owner reports the manual L1/L2 summary PASS (per-row evidence incomplete, PR #151); no further A step is required unless the RC changes; (3) **Gate M, before promotion only:** the 4 pending Production migrations (`20261105090001`, `20261107090004` to `090006`) applied with `--include-all` after a fresh snapshot (#148 is merged); (4) the hosted login gate L1 to L5 and the P-7a runtime probe before any promotion; (5) P-8 limits initialisation and P-9 alert-connection and attestation checks after promotion; (6) alert recipients and A10, which block only live activation. Resolved: `main` holds the integrated build, P-6 is done and verified.

## 8. A10 and activation (not part of this checklist)

A10 (evidence pack, rollback drill, hosted login matrix) gates **live activation**: P-10 (G-META evidence), the permit change and the first controlled send. Section 5 is the login gate for **P-7**; it is a prerequisite for user-facing activation, not for the infrastructure phase.
