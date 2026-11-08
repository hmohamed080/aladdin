# Production release sequence: WhatsApp OTP and release candidate fc62c4b5 (2026-11-08)

Status: owner runbook, DOCUMENT ONLY. Nothing here was run: no merge, deployment, workflow dispatch, Production or database write, secret change, CAPTCHA change or WhatsApp activation. Every step below needs its own explicit owner approval ("approval needed: yes" on all of them). Git Bash from the repository root unless stated. Never paste a password, token, key or phone number into Git, chat or logs.

This file only orders the gates and links to the documents that hold the exact commands. It does not duplicate them. Sources (read for this file):

- [WHATSAPP_OTP_PRODUCTION_ROLLOUT_CHECKLIST.md](WHATSAPP_OTP_PRODUCTION_ROLLOUT_CHECKLIST.md) on main, plus its revision in PR #145 (sections "Release candidate and migration gate" and "P-7 owner-approved execution sequence", steps A to D). Called CHECKLIST below.
- PR #154 `docs/operations/PRODUCTION_MIGRATIONS_20261108_GATE.md` (called GATE-M), on top of [MIGRATION_DRYRUN_RUNBOOK_20261108.md](MIGRATION_DRYRUN_RUNBOOK_20261108.md) (called DRYRUN) and `scripts/hosted-db/production-p2-push.sh`.
- PR #145 `scripts/hosted-db/verify-frontend-upload.mjs` (required `--expect-sha`).
- PR #157 `docs/operations/WHATSAPP_OTP_FIRST_LIVE_TEST.md` (called FIRST-LIVE) and its Worker change.
- PR #151 [ACCEPTANCE_L1_L2_READINESS.md](https://github.com/hmohamed080/aladdin/pull/151) (Acceptance evidence).

## Facts this sequence is built on

| Item | Value |
|---|---|
| `origin/main` when written | `7d9653949a9020e3abad12b87e1f27842a9d81e2` |
| Release candidate (RC) application | `fc62c4b5a3f9284fb2fc7d9b52df8193d558a13a` |
| Production frontend (live, 100%, instant rollback target) | `a3b08a22-f82e-4851-9786-9442c01e43c8` |
| OTP Worker `aladdin-whatsapp-otp-production` | `4415c515-cfe9-4e85-b2e5-1e5852ad8cc0`, `WHATSAPP_DELIVERY_ENABLED="false"`, recipient mode `open` |
| Production database `kkpkgjrweysgvhvkhzun` | 203 applied, latest `20261107090003`, four pending: `20261105090001`, `20261107090004`, `20261107090005`, `20261107090006` |
| Upload switch | `CLOUDFLARE_PRODUCTION_ENABLED=false`; environment `cloudflare-production` requires reviewer `hmohamed080` |
| Acceptance | preview redeployed from `fc62c4b5` (run 42469324988, version `d8ff501d-4d01-4d4c-95ac-e0948347a46b`); owner-reported manual PASS, per-row evidence incomplete (#151); real CAPTCHA stays ON; automated L1 waived by an owner-signed exception |
| Sender / WABA / business | phone number id `1458603463983505`, WABA `1674249287385148`, business "Business Solution" `590771698500945` |

## Shortest safe path (strictly in this order)

1. G0: owner merges #145, #154, #151 (docs and scripts only), checks the RC rule; #157 is NOT merged yet (it touches `edge/`, which the RC rule watches).
2. G1: Acceptance has the four migrations (GATE-M precondition) then Production: fresh snapshot, `--check-only`, push (typed phrase), read-only verify, live smoke of `a3b08a22`.
3. G2: B0 open switch, B1 upload (0% traffic, owner approves the environment review), B2 close switch, B3 `verify-frontend-upload.mjs --expect-sha`, manual run-SHA cross-check.
4. G3: L4 curl checks, L3 sign-in and P-7a probe on the uploaded version via the override header (delivery OFF).
5. G4: create the secret `OTP_ALLOWED_RECIPIENTS_PRODUCTION`, merge #157, redeploy the OTP Worker (own approval), read-only binding check, open (not merge) the permit-change PR.
6. G5: D1 promotion `versions deploy <id>@100%`, then L5 at once; rollback to `a3b08a22` if anything is off.
7. G6: P-8 limits (150 / 5,000 / 70 / 90), P-9 alert connection and attestation.
8. G7: owner-only Meta checks, then merge+deploy the permit change, switch ON, ONE message to the one owner number, abort on any criterion below.

## What can run in parallel now vs what is blocked by what

| Work | Can start now? | Blocked by |
|---|---|---|
| Merge #145, #151, #154 (docs, scripts) | yes, in parallel with each other and with the Meta checks | nothing (owner decision) |
| Owner-only Meta checks (G7.0) | yes, any time | nothing; do them early because a failure changes the whole plan |
| Create secret `OTP_ALLOWED_RECIPIENTS_PRODUCTION` (G4.1) | yes (a Secrets Store write, own approval) | nothing; must exist before the Worker deploy |
| Acceptance apply of the four migrations (G1.0) | yes | nothing in this file (needs the Acceptance backup decision in DRYRUN section G) |
| Production snapshot, encrypt, `--check-only` (G1.1, G1.2) | yes, but the 60-minute snapshot age clock runs to the push | G1.0 done, owner present |
| Production push (G1.3) | no | G1.0, G1.1, G1.2 and a separate GO (typed phrase) |
| 0% upload B0 to B3 (G2) | yes, independent of G1 (inert version, no DB access; GATE-M section 3 and CHECKLIST) | G0 (#145 merged: it holds `verify-frontend-upload.mjs`), RC check empty |
| L3, L4, P-7a on the uploaded version (G3) | after G2 | G2; recommended after G1 (see contradiction 8) |
| Merge #157 and redeploy the Worker (G4.2, G4.3) | after the upload only | G2 (RC rule), G4.1 secret |
| Promotion D1 (G5) | no | G1 (Gate M), G2, G3 all passed; stays strictly sequential |
| P-8, P-9 (G6) | no | G5 (needs the new frontend; attestation endpoint exists only there) |
| Permit change merge and deploy, switch ON, first message (G7) | no | G4, G5, G6, G7.0 |

Parallel pairs: (G0 merges, G7.0 Meta checks, G4.1 secret); (G1 and G2). Everything else is a chain.

---

## G0. Merge decisions and RC re-check (parallel merges; the RC check is sequential after them)

**G0.1 Merge #145, #154, #151.** Owner action: GitHub UI, review then merge each (they change docs and `scripts/hosted-db` only; none touches a runtime path). Preconditions: CI green on each. Verify (read-only): `git fetch origin main && git log --oneline -5 origin/main`; `git ls-tree origin/main scripts/hosted-db/verify-frontend-upload.mjs` lists the file. STOP: any of the three touches a path in the G0.3 list, or CI red. Rollback: revert the merge commit (docs only). Approval needed: yes.

**G0.2 Smoke-scope PR (if opened).** Owner action: review its file list before merging: `gh pr diff <N> --name-only` and compare with the G0.3 path list. Preconditions: PR is draft-reviewed. Verify: no file in the runtime path list; otherwise it changes the RC. STOP: any runtime-path file (then re-pin the RC, redo Acceptance A1 to A3 and re-derive GATE-M; CHECKLIST RC rule). Rollback: revert. Approval needed: yes. Do not merge #155, #156 or #150 as part of this sequence (not on the path; #155 is on hold by owner decision).

**G0.3 RC re-check (repeat immediately before G1.3, B0 and B1).** Owner command (from CHECKLIST, #145; the paths are the CHECKLIST's, the longest of the three variants, see contradiction 4):

```bash
git fetch origin main && RC=$(git rev-parse origin/main) && echo "RC=$RC"
git diff --stat fc62c4b5a3f9284fb2fc7d9b52df8193d558a13a origin/main -- frontend/src frontend/public frontend/cloudflare frontend/scripts frontend/wrangler.jsonc frontend/next.config.ts frontend/open-next.config.ts frontend/tailwind.config.ts frontend/postcss.config.mjs frontend/tsconfig.json frontend/package.json package.json pnpm-workspace.yaml pnpm-lock.yaml backend edge supabase .github/workflows/cloudflare-production.yml
```

STOP: any output at all. Rollback: none (read-only). Approval needed: yes (the owner's go to continue).

## G1. Gate M, Production migrations (precedes PROMOTION only)

The four migrations are forward-only (no down migration; `migration repair` and `db reset --linked` are not rollbacks). They must be applied and verified BEFORE G5 (promotion). They are NOT required for the 0% upload in G2 (GATE-M section 3). The exact commands live in GATE-M section 6; do not retype `supabase link`, `migration list` or `db push`.

**G1.0 Acceptance has the four applied (GATE-M precondition A).** Owner action: DRYRUN section H: `bash scripts/hosted-db/acceptance-apply.sh --sha <MAIN_SHA> --backup-label <label>` (typed phrase `APPLY 4 MIGRATIONS TO ACCEPTANCE`); backup freshness is an owner decision (DRYRUN section G). Preconditions: clean checkout detached at `<MAIN_SHA>` equal to `origin/main`; Acceptance snapshot restore test PASS; `supabase-rls` green on that SHA. Verify (read-only): the script's final `PASS:` line (207 applied, permissions equal the `20261107090006` contract, 753 functions); advisors; Acceptance sign-in smoke. STOP: any failed pre- or post-check; do not retry after a failed push, read `supabase migration list --linked`. Rollback: forward-fix, or `restore-acceptance.sh` from the named snapshot (Acceptance only). Approval needed: yes. If the owner already did this since DRYRUN section G, record the evidence (207 applied) and skip.

**G1.1 Fresh Production snapshot (stop point B).** Owner action: `bash scripts/hosted-db/production-recovery-snapshot.sh` then `bash scripts/hosted-db/encrypt-backup.sh ~/aladdin-production-snapshot-<stamp>`. Preconditions: clean checkout equal to `origin/main`; owner present; record `media_storage_locations` and `audit_log` row counts (baseline). Verify: snapshot reports 203 / `20261107090003`, counts validated, `.verified` file exists; confirm the Supabase dashboard backup state (GATE-M section 5). STOP: any other history, invalid counts, no `.verified`. Rollback: none (read-only). Approval needed: yes.

**G1.2 Check-only (stop point C).** Owner action: `bash scripts/hosted-db/production-p2-push.sh ~/aladdin-production-snapshot-<stamp> --check-only`. Preconditions: G1.1 snapshot at most 60 minutes old when G1.3 will run. Verify: every gate passes, dry run lists exactly the four versions in order (`20261105090001`, `090004`, `090005`, `090006`, `--include-all`). STOP: any other pending list or order, any refusal. Rollback: none (cannot push). Approval needed: yes.

**G1.3 Push (stop point D).** Owner action: `bash scripts/hosted-db/production-p2-push.sh ~/aladdin-production-snapshot-<stamp>` and type `PUSH 4 MIGRATIONS TO PRODUCTION`. Preconditions: G1.2 reviewed, G0.3 empty, snapshot still inside 60 minutes (else take a new one). Verify: script ends with 207 applied, none pending. STOP: history other than 203 / `20261107090003` before apply; any refusal. If a file fails, history stops at it: do not retry or repair. Rollback: forward-only. Fix forward with a new reviewed migration through the same gate; frontend rollback to `a3b08a22` is safe because the schema is a superset; data loss would need a separately designed restore (no scripted Production restore exists, GATE-M section 7). Approval needed: yes (separate GO).

**G1.4 Post-apply verification, read-only (stop point E).** Owner action: the SELECT-only queries in GATE-M section 6 "Post-apply verification" (re-link first, the script unlinks on exit); optionally `bash scripts/hosted-db/verify-permissions-readonly.sh production 20261107090006` (DRYRUN section D, expects 753 functions). Do NOT run `production-post-migration-check.sh` (stale, expects 191 versions). Verify: 207 rows, latest `20261107090006`, the four versions present, `with_key = 0`, `app.admin_staff_invitations` 0 rows, `ck_audit_action_known` validated, 4 `backup.*` permissions, `backup_environment` and `backup_runs` 0, the four `public.admin_backup_*`/`backup_report_run` functions not executable by `authenticated` or `anon`. STOP: any query differs; any new advisor ERROR. Rollback: as G1.3. Approval needed: yes.

**G1.5 Live smoke of the CURRENT frontend `a3b08a22` (before any promotion).** Owner action: sign in, open a showroom page, load one media image, open an admin page (GATE-M section 6). Verify: all work. STOP: any failure, then roll the frontend to `a3b08a22` if it was not it (it is the live one) and investigate. Rollback: none needed (nothing changed in the frontend). Approval needed: yes.

## G2. 0%-traffic frontend upload and verification (B0 to B3; sequential inside the gate; may run in parallel with G1)

Nothing is deployed by this gate; the uploaded version serves 0% until G5. Commands are CHECKLIST step B (in #145), repeated here only as the order. Run G0.3 right before B0 and again right before B1.

**B0 Open the switch.** `gh variable set CLOUDFLARE_PRODUCTION_ENABLED --env cloudflare-production --body true`. Preconditions: G0.1 merged (verifier on main), G0.3 empty, the live version is still `a3b08a22` alone at 100% (`(cd frontend && pnpm exec wrangler deployments status --env production)`; the verifier also refuses otherwise). Verify: `gh variable list --env cloudflare-production`. STOP: live version changed, RC check not empty. Rollback: set it back to `false`. Approval needed: yes.

**B1 Upload.** `gh workflow run cloudflare-production.yml --ref main -f stage=frontend-upload`, then the owner approves the environment review in the GitHub UI, then `gh run list --workflow cloudflare-production.yml --event workflow_dispatch --branch main --limit 1 --json databaseId,headSha,status,createdAt` and `gh run watch <RUN_ID>`. Verify: `headSha` equals `$RC`; the run summary prints `Version ID` and the message `upload-only <12 hex of RC>`. STOP: head SHA is not `$RC`; no `Version ID` or `upload: false`; any traffic percentage on the upload. Keep the switch open until the run finishes. Rollback: nothing deployed; the unused version may stay at 0%. Approval needed: yes.

**B2 Close the switch (always, even if B1 failed).** `gh variable set CLOUDFLARE_PRODUCTION_ENABLED --env cloudflare-production --body false`. Verify: `gh variable list --env cloudflare-production` shows `false`. STOP: cannot close it (close, then investigate). Rollback: n/a. Approval needed: yes.

**B3 Verify the upload (read-only).** `node scripts/hosted-db/verify-frontend-upload.mjs --version=<UPLOADED_VERSION_ID> --expect-sha="$RC"` (`--expect-sha` is required; exit 2 without it). Proves by name and type: nothing lost from the P-4 version `3fc37397-9157-4fa6-8fce-d32dffe0a194`, the four `PHONE_OTP_*` secrets present, plain variables equal to live, exactly one new binding `OTP_WORKER` to `aladdin-whatsapp-otp-production`, no switch variable, live still alone at 100%, upload at 0%, and `workers/message` equal to `upload-only <12 hex>`. Manual cross-checks (mandatory, the script cannot prove bundle bytes): the run's `headSha` equals `$RC` (`gh run view <RUN_ID> --json headSha -q .headSha`), and the run summary's version id equals the id given to the verifier. STOP: REFUSED or cannot complete; any mismatch above. Rollback: none; leave the version at 0%. Approval needed: yes.

## G3. Tests of the uploaded version via the override header (delivery OFF; no sign-up, no data change)

Commands: CHECKLIST step C. `V=<UPLOADED_VERSION_ID>; H="Cloudflare-Workers-Version-Overrides: aladdin-frontend-production=\"$V\""`. Preconditions: G2 done; G1 done is recommended (contradiction 8). Owner approves each manual test.

- **L4 (read-only requests):** `curl -s -o /dev/null -w '%{http_code}\n' -H "$H" https://aladdindecore.com/auth/sign-in` and `/auth/sign-up` must print 200; `curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "$H" https://aladdindecore.com/api/internal/whatsapp-otp/delivery-attest` must print 401 (not 404 or 500). Also `/admin/whatsapp-otp` loads for a Super Admin (CHECKLIST section 5 table).
- **L3 (owner, browser with a header extension and a CAPTCHA-capable session; hosted CAPTCHA stays ON):** sign in with an owner-designated existing Production account by email, username and legacy phone number.
- **P-7a (owner, same browser and header):** as Super Admin open `/admin/whatsapp-otp`; "Sending service" must show environment `production`, permit `false`, no switch row, and recipient mode `open` while the Worker is still `4415c515` (CHECKLIST on main) or `allowlist` with `allowlist_entries` 1 after G4.3 (FIRST-LIVE); "Test the alert connection" must succeed. 401 = secret mismatch; "unavailable" = missing `OTP_WORKER` binding or `PHONE_OTP_WORKER_URL`. Do not switch anything ON.

STOP: any failure. Rollback: nothing promoted; leave the version at 0%. Approval needed: yes.

## G4. Single-recipient WhatsApp path (sequential; G4.1 may start any time)

**G4.1 Create the secret.** Owner action: in the account Secrets Store (store `acfaa67f391e499db6fde398022f50ce`), name `OTP_ALLOWED_RECIPIENTS_PRODUCTION`, value = ONE Egyptian mobile in E.164, no commas or spaces (FIRST-LIVE owner step 1 and its format rules). FIRST-LIVE names only the store, not the command; the prompt form is documented in `WHATSAPP_OTP_ACCESS_SERVICE_AUTH.md` line 59 for another secret: `(cd edge/whatsapp-otp-worker && pnpm exec wrangler secrets-store secret create acfaa67f391e499db6fde398022f50ce --name OTP_ALLOWED_RECIPIENTS_PRODUCTION --scopes workers)` (it prompts for the value; never pass it as an argument), or Dashboard, Secrets Store, Add secret. Preconditions: owner decides which single number; it exists before the Worker deploy (the deploy fails otherwise). Verify (read-only): the secret name is listed (value cannot be read back). STOP: value with a comma, a space or more than one number (the Worker would treat the list as empty and refuse every send). Rollback: delete or empty the secret (nothing sends). Approval needed: yes.

**G4.2 Merge #157.** Owner action: review and merge #157 (Worker `edge/whatsapp-otp-worker`, FIRST-LIVE doc, CHECKLIST wording). Preconditions: G2 complete (the upload is already built from the RC; #157 touches `edge/`, which would fail G0.3 if merged earlier, contradiction 6); worker tests and CI green. Verify: `node edge/whatsapp-otp-worker/scripts/check-production-config.mjs` prints PASS from a checkout of the merged main. STOP: CI red, or G0.3 was needed again later (re-pin the RC per the CHECKLIST rule before any further dispatch). Rollback: revert the merge before the Worker deploy; nothing live changes by merging. Approval needed: yes.

**G4.3 Redeploy the OTP Worker (separate approval; delivery stays OFF).** Owner action: `(cd edge/whatsapp-otp-worker && pnpm exec wrangler deploy -c wrangler.production.jsonc --dry-run)` first, then the same without `--dry-run` (CHECKLIST P-5 and P-6 rows). Preconditions: G4.1 and G4.2; config still `WHATSAPP_DELIVERY_ENABLED="false"`. Verify: G4.4. STOP: dry run does not list 6 Secrets Store bindings, `IDEMPOTENCY_DB`, `APP_NOTIFY`, cron `* * * * *` and no routes. Rollback: roll the Worker back to the previous version `4415c515-cfe9-4e85-b2e5-1e5852ad8cc0` (CHECKLIST P-6 row: "roll back to the previous version, never delete"; the exact flags are not spelled in any source, confirm with `pnpm exec wrangler rollback --help`); `wrangler delete` is forbidden once the frontend binds to it. Approval needed: yes.

**G4.4 Read-only binding verification.** Owner action (CHECKLIST P-6 details): `read -rsp 'Read-only Cloudflare API token: ' CLOUDFLARE_API_TOKEN; echo; export CLOUDFLARE_API_TOKEN` (Workers Scripts Read, Zone Read, Workers Routes Read), `export CLOUDFLARE_ACCOUNT_ID='<account id>'`, `node edge/whatsapp-otp-worker/scripts/check-production-deployment.mjs`, `unset CLOUDFLARE_API_TOKEN`. Verify: six secret bindings, `OTP_RECIPIENT_MODE="allowlist"`, `WHATSAPP_DELIVERY_ENABLED="false"`, `OTP_ENVIRONMENT="production"`, private routing; then repeat P-7a (G3): mode `allowlist`, `allowlist_entries` 1. STOP: any other binding set, mode or entry count. Rollback: as G4.3. Approval needed: yes.

**G4.5 Permit-change PR (draft only).** Owner action: the agent or owner opens a SEPARATE reviewed PR that changes `WHATSAPP_DELIVERY_ENABLED` to `"true"` in `edge/whatsapp-otp-worker/wrangler.production.jsonc` AND updates the guard `check-production-config.mjs` (it refuses `"true"` by design; FIRST-LIVE first-test step 3). Preconditions: G4.4 passed. Verify: tests pass; the PR is not merged. STOP: merging or deploying it before G7.1. Rollback: close the PR. Approval needed: yes (to open and, separately, to merge).

## G5. Promotion D1 and L5 (strictly sequential; separate approval)

Preconditions: G1.4 and G1.5 passed (Gate M closed), G2 B3 passed, G3 passed, G0.3 unchanged for the uploaded version (it is a version id, not a rebuild). Owner action (CHECKLIST step D): `(cd frontend && pnpm exec wrangler versions deploy <UPLOADED_VERSION_ID>@100% --env production)`. Verify (L5, within minutes, without the header): repeat L3 and L4; the Worker cron noise `whatsapp_otp_attestation_failed` / `app_404` stops within about a minute and becomes steady 200s on `POST /api/internal/whatsapp-otp/delivery-attest` (CHECKLIST sections 6). STOP: any failed sign-in, any 5xx, a persisting `app_401` or `app_403`. Rollback (instant, safe, schema is a superset): `(cd frontend && pnpm exec wrangler rollback a3b08a22-f82e-4851-9786-9442c01e43c8 --env production -m "rollback P-7 (RC fc62c4b5)")`; never `wrangler delete`; it does not touch the OTP Worker or D1 and does not undo the migrations. Approval needed: yes.

## G6. Limits initialization and monitoring (after G5)

**G6.1 P-8.** Owner action: Super Admin initialises limits **150 / 5,000 / 70 / 90** on `/admin/whatsapp-otp` (typed ceiling confirmation, reason). Preconditions: G5 passed, P-1 grant key present. Verify: limits and one audit row shown; the Sending switch stays OFF and disabled (`environment_not_permitted`). STOP: the switch is enabled while the permit is `"false"`. Rollback: change through the page (audited). Approval needed: yes.

**G6.2 P-9.** Owner action: "Test the alert connection" on the Admin page; confirm the attestation cron; review Security Events. Verify: probe reachable; `delivery_attestation_age` 0 to 120 s; no `whatsapp_otp_attestation_failed` lines. STOP: `app_401`, `app_403`, `answer_*` codes (CHECKLIST section 6). Rollback: none. Approval needed: yes. Open item: there is no automated paging; the owner picks an alert channel and recipient before activation (CHECKLIST section 6).

## G7. First live message (single owner-controlled number)

**G7.0 Owner-only Meta checks (can be done any time, must pass before G7.1).** From FIRST-LIVE; nobody else can run them:

- Quality rating of sender `1458603463983505` is not Low or flagged.
- Messaging tier allows at least 150 unique recipients per 24 h now, and at least 10,000 for a Hard Ceiling of 5,000.
- Business display-name status is approved.
- `debug_token` of the system-user token: scopes include `whatsapp_business_messaging` and `whatsapp_business_management`; `granular_scopes` lists WABA `1674249287385148`; `expires_at` is 0 (non-expiring).
- System user has the WABA and the phone-number asset with Full control; the sender is in business "Business Solution" `590771698500945`.
- Known: the delivery-status webhook is NOT flowing, so "accepted by Meta" is the only signal; confirm receipt on the recipient's phone.

Tooling that exists: `edge/whatsapp-otp-worker/scripts/meta-preflight.mjs` (read-only, run in the owner's shell from the secret store; checks sender status, name approval and quality; `debug_token` only with `META_PREFLIGHT_RESOLVE_FROM_TOKEN=1`). It does not check the messaging tier: read that in Meta Business Settings. STOP: any check fails. Rollback: none. Approval needed: yes.

**G7.1 Permit change, merge and deploy.** Owner action: merge the G4.5 PR, then redeploy the Worker as in G4.3 (separate approval). Preconditions: G7.0, G6 passed, G5 live. Verify: G4.4 checks with `WHATSAPP_DELIVERY_ENABLED="true"` and no switch row: still OFF, a Super Admin can now switch ON. STOP: anything but the permit changed. Rollback: set the permit back to `"false"` by reverting and redeploying (immediate kill switch whatever the Admin state), or roll back to `4415c515`. Approval needed: yes.

**G7.2 Low limits, then switch ON.** Owner action (FIRST-LIVE steps 2 and 4): as Super Admin set a LOW Daily Send Limit (for example 5) and a low Hard Ceiling within the validity rules (daily limit at least 1 and not above the ceiling; `settings.ts`), then turn the switch ON. Verify: attestation recorded (`delivery_attested` true; sending starts at the next successful attestation, about one minute; OFF is immediate). STOP: attestation not recorded within a few minutes, or `delivery_unmatched` / `audit_unmatched` alert. Rollback: switch OFF (immediate, no deploy). Approval needed: yes.

**G7.3 Exactly ONE message.** Owner action (FIRST-LIVE steps 6 and 7): request exactly one code for the allow-listed number, confirm it arrives on the phone and works, do not retry blindly (a Meta message id means accepted, not delivered), then check the usage counters moved by exactly 1. The sources do not say which user flow triggers the request; the owner chooses a flow that requests a WhatsApp code for that number. Abort criteria (any one): the message does not arrive after reasonable time; counters move by more than 1 or a second send appears; any send to another number (it must answer 403); a Meta error or quality drop; `whatsapp_otp_attestation_failed` 3 or more in 5 minutes; `delivery_unmatched`, `audit_unmatched`, overdue notice; `whatsapp_otp_budget_exhausted`. Abort and rollback (FIRST-LIVE): switch OFF; revert the permit to `"false"` and redeploy or roll the Worker back; empty or remove the secret `OTP_ALLOWED_RECIPIENTS_PRODUCTION` (with no valid single entry nothing sends). Approval needed: yes. Open to the public (`open` mode, 150 / 5,000 limits for all users) is a separate later decision and is not part of this sequence (A10 and activation, CHECKLIST section 8).

---

## Contradictions and gaps between sources

1. **Frontend rollback target.** `MIGRATION_DRYRUN_RUNBOOK_20261108.md` section C (main) says `39bdf3a2`; PR #154 and the CHECKLIST say `a3b08a22` (the live version). This file uses `a3b08a22`; `39bdf3a2` only if `a3b08a22` itself must be abandoned.
2. **Migration counts.** The CHECKLIST P-2 row and the older numbers on main say 195 applied / 8 pending; DRYRUN, #154 and this file say 203 applied / 4 pending / 207 final.
3. **Stale script.** `scripts/hosted-db/production-post-migration-check.sh` still expects 191 versions / `20261024090011` (#154 section 2; #145 touches the script by 5 lines, not re-checked here). Use the SELECT list in G1.4.
4. **RC path list differs in three files.** The CHECKLIST lists 16 path groups (including `frontend/cloudflare`, `frontend/scripts`, `package.json`, `.github/workflows/cloudflare-production.yml`); `ACCEPTANCE_L1_L2_READINESS.md` (#151) and the task text list only `frontend/src frontend/public frontend/wrangler.jsonc frontend/next.config.ts backend edge supabase pnpm-lock.yaml`. The CHECKLIST list is a superset; G0.3 uses it.
5. **P-7a expected recipient mode.** CHECKLIST on main expects `open`; #157's edit expects `allowlist` and `allowlist_entries` 1. Both are right for their Worker version: `open` before G4.3, `allowlist` after.
6. **#157 versus the RC rule.** #157 changes `edge/whatsapp-otp-worker/*`, a path the RC rule watches, so merging it before B1 makes G0.3 print output and blocks the upload. The frontend bundle does not contain the Worker, but the rule as written does not say so; this sequence avoids the question by merging #157 after the upload (G4.2). If the owner wants #157 earlier, the owner must first amend the rule. Also `check-production-deployment.mjs` from #157 expects six bindings and mode `allowlist`, so it fails against the live Worker `4415c515` until G4.3.
7. **Acceptance state.** #154 section 4 requires Acceptance at 207 with a restore PASS before the Production push. DRYRUN sections F and G (2026-11-08 09:40Z) show Acceptance at 203 with the apply not yet done. The owner-reported Acceptance PASS (#151) is therefore on a build whose four new migrations may not have been applied to Acceptance, so the invites, backups and media routes may be untested there. The owner must confirm which, and G1.0 covers it.
8. **Order of tests versus Gate M.** The CHECKLIST (#145) runs step C (override-header tests) before Gate M; #154 says the 0% upload is inert either way but does not address the tests. L3 and P-7a exercise the uploaded build against the Production database, which lacks the four migrations until G1. This file recommends G1 first (a recommendation, not stated in a source).
9. **Quality rating wording.** FIRST-LIVE says "not Low/flagged"; `meta-preflight.mjs` fails only on `RED` (`quality_not_red`). The owner check should use the stricter wording.
10. **Daily limit.** P-8 initialises 150 while FIRST-LIVE asks for a low limit such as 5 "within the P-8 bounds". The Worker accepts any daily limit of at least 1 up to the ceiling (`settings.ts`), so G6.1 (150) then G7.2 (low) is valid, but "P-8 bounds" is not defined in FIRST-LIVE.
11. **Secret creation command.** FIRST-LIVE gives no command, only the store id; the command in G4.1 is borrowed from `WHATSAPP_OTP_ACCESS_SERVICE_AUTH.md` and must be confirmed against `wrangler secrets-store secret create --help`.
12. **Worker rollback command.** The CHECKLIST says "roll back to the previous version"; no source spells the command or flags.
13. **First-message trigger.** FIRST-LIVE does not name the user flow that requests the code (G7.3).
