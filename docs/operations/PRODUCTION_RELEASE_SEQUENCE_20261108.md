# Release sequence: Acceptance first, then Production general availability (WhatsApp OTP and RC fc62c4b5), rev 2026-11-08 (owner decisions)

Status: owner runbook, DOCUMENT ONLY. Nothing here was run: no merge, deployment, workflow dispatch, Production or Acceptance write, database write, secret change, CAPTCHA change or WhatsApp activation. Every gate below needs its own explicit owner approval ("approval needed: yes" on all). Git Bash from the repository root unless stated. Never paste a password, token, key or phone number into Git, chat or logs.

This file orders the gates and points at the documents that hold the exact commands. It does not duplicate them.

Owner decisions applied (2026-11-08): (1) the single-recipient allowlist pilot is removed; PR #157 is closed (branch `feat/otp-single-recipient-test-20261108` kept for reference; no allowlist secret, no dedicated test number). (2) `OTP_RECIPIENT_MODE=open` in both environments. (3) Acceptance first, full manual E2E. (4) Production goes directly to general availability (GA) without repeating the Acceptance suite: smoke, ONE live delivery check, monitoring. (5) Requirement 9: never a period where phone registration asks for an OTP while delivery is unavailable. (6) No Production change without separate approval.

## Shortest safe path (strictly in this order)

1. Merge docs/script PRs #145, #154, #151 (no runtime path); re-run the RC check; the two new code PRs (Acceptance open mode, sign-up delivery gate) are merged only after review and only when the RC rule is re-pinned for them (they touch runtime paths; see G0).
2. A-1: apply migrations 090003-090006 to Acceptance with `acceptance-apply.sh`; A-2: deploy the Acceptance Worker and frontend with open mode; A-3: P-8 limits, switch, attestation; database switches stay false until A-4.
3. A-4/A-5: enable frontend flags and DB switches on Acceptance only, owner runs the full manual E2E in a browser (real CAPTCHA ON). STOP on any failure.
4. P-1: fresh Production snapshot, `--check-only`, push of the 4 pending migrations (separate GO), read-only verify, smoke of live `a3b08a22`.
5. P-2: 0% frontend upload, `verify-frontend-upload.mjs --expect-sha`, override-header read-only checks; then promote `@100%` (code gate PR already in the RC), with `signup_enabled=false` and delivery OFF.
6. P-3: Production P-8 limits, P-9 alerts, owner-only Meta checks, deploy Worker with the permit true, switch ON, attestation, ONE live delivery verification.
7. P-4 (LAST): only then set `app.phone_verification_config.enabled` and `signup_enabled` true. GA blocker: the sign-up delivery gate must be live before this step.
8. Monitor; kill-switch rule: delivery OFF always together with `signup_enabled=false`.

## Facts this sequence is built on

| Item | Value |
|---|---|
| `origin/main` when written | `7d9653949a9020e3abad12b87e1f27842a9d81e2` |
| Release candidate (RC) | `fc62c4b5a3f9284fb2fc7d9b52df8193d558a13a` (runtime paths identical on main `7d965394`) |
| Production frontend live, 100%, rollback target | `a3b08a22-f82e-4851-9786-9442c01e43c8` |
| OTP Worker production `aladdin-whatsapp-otp-production` | `4415c515-cfe9-4e85-b2e5-1e5852ad8cc0`, `WHATSAPP_DELIVERY_ENABLED="false"`, `OTP_RECIPIENT_MODE` open (committed config) |
| Production database `kkpkgjrweysgvhvkhzun` | 203 applied (latest `20261107090003`), 4 pending: `20261105090001`, `20261107090004`, `090005`, `090006`; 207 after push |
| Acceptance database `nxossqhdfltcqdwvbewi` | at `20261107090002`; missing `090003` (`whatsapp_otp_delivery_switch`), `090004`, `090005`, `090006` (DRYRUN: 203 applied before apply, 207 after) |
| Acceptance frontend preview | version `d8ff501d-4d01-4d4c-95ac-e0948347a46b` (from `fc62c4b5`) |
| Acceptance OTP Worker `aladdin-whatsapp-otp-preview` | version `11b9f694` at time of writing, `WHATSAPP_DELIVERY_ENABLED=false`, `OTP_ENVIRONMENT=acceptance`, `OTP_RECIPIENT_MODE=allowlist` in `wrangler.jsonc`; preview guard enforces that |
| Sender (SAME for both environments) | phone number id `1458603463983505`, WABA `1674249287385148`, business `590771698500945`. Acceptance sends are REAL WhatsApp messages from the Production WABA and share its messaging-tier capacity |
| Upload switch | `CLOUDFLARE_PRODUCTION_ENABLED=false`; environment `cloudflare-production` requires reviewer `hmohamed080` |

Code facts (verified in the repo): `edge/whatsapp-otp-worker/src/index.ts:191-192` honours `open` only when `OTP_ENVIRONMENT === "production"`, so Acceptance `open` needs the reviewed code change (PR in preparation). Sign-up replies "sent" independent of delivery (anti-enumeration; `frontend/src/server/phone-verification/signup-service.ts` delivers after the reply and on failure only invalidates the challenge). The Worker answers 503 `delivery_disabled` when off (`src/index.ts` around lines 434 and 440). The Super Admin kill switch lives in the Worker's D1 and is not coupled to the frontend. Frontend gates: server env flags `PHONE_VERIFICATION_ENABLED` and `PHONE_SIGNUP_VERIFICATION_ENABLED` (only the literal `true` is ON) and the database config `app.phone_verification_config.enabled` and `.signup_enabled` (default false; audited through `app.phone_verification_config_log`; when false the signup RPCs answer `unavailable`; `supabase/migrations/20261030090002_phone_signup_authority.sql`). Note `signup_enabled` requires the alias guard mode not `off` (check constraint `ck_config_signup_needs_guard`).

## Parallel versus blocked

| Work | Can start now? | Blocked by |
|---|---|---|
| Merge #145, #151, #154 (docs, scripts) | yes | nothing (owner decision) |
| Owner-only Meta checks (P-3.0) | yes, any time; a failure changes the plan | nothing |
| Review and finish the two code PRs | yes | in preparation |
| A-1 Acceptance apply | yes | owner GO, backup-label decision (DRYRUN G), HEAD at pinned main |
| A-2 Acceptance deploy with open mode | no | code PR (Acceptance open mode) merged; A-1 |
| A-3 to A-6 Acceptance E2E | no | A-2 |
| P-1 Production migrations | no | A-6 pass (or owner waiver); separate GO |
| P-2 upload (0%) | technically yes (inert), but sequenced after A-6 by decision | A-6; RC rule; sign-up delivery gate PR merged BEFORE the RC is re-pinned |
| P-2 promotion | no | P-1, upload verified; sign-up delivery gate in the build |
| P-3 limits, alerts, Meta, switch ON, ONE live check | no | P-2 promotion |
| P-4 enable DB switches (GA) | no | P-3 passed; gate PR live (GA blocker) |

Parallel pairs: (merges, Meta checks, code PR review); (A-1 and RC re-check). Everything else is a chain.

## Prepared PRs and their status

- #145 `docs(release)`: P-6 complete, P-7 plan, `verify-frontend-upload.mjs`. Open, to merge in G0.
- #151 Acceptance L1/L2 readiness runbook. Open, docs only. Note its RC wording is `78d1b5c0` in the title; this file uses `fc62c4b5`.
- #154 Production migrations gate. Open, docs only.
- #158 this document. Draft; must stay draft until the owner reviews.
- #159 `ci(acceptance-e2e)`: smoke-only scope for the hosted acceptance workflow (automation covers smoke only; real CAPTCHA blocks the full flow, so the full E2E is manual). Open; check its file list against the RC path list before merging.
- Code PR "accept open mode on acceptance": in preparation (no number yet).
- Code PR "sign-up delivery gate" (sign-up consults global delivery availability, fails closed and hides mobile sign-up, preserves anti-enumeration): in preparation (no number yet). GA blocker.
- Closed: #157 (allowlist pilot). Not on the path: #155, #156, #150.
- #153 (Acceptance apply tooling) is already on main (`scripts/hosted-db/acceptance-apply.sh`, `acceptance-gate.mjs`, `acceptance-postcheck.mjs`).

## Remaining blockers

1. GA blocker: the sign-up delivery gate code PR is not written or merged. Without it, an outage after launch leaves sign-up replying "sent" with no code (the operational rule in P-4 is the only protection).
2. Acceptance open mode code PR not merged; Acceptance cannot use `open` until it is.
3. Acceptance lacks four migrations; Production lacks four.
4. Owner-only Meta checks not done (quality rating, tier, display name, token scopes); the delivery-status webhook is not flowing, so "accepted by Meta" is the only signal.
5. Alert channel and recipient (no automated paging) not chosen (CHECKLIST section 6).
6. Production Worker delivery permit is `"false"` in the committed config; turning it true needs a reviewed PR (config plus guard `check-production-config.mjs`, which refuses it today) and its own deploy approval. The PR is not yet prepared.
7. Shared WABA: Acceptance test volume consumes Production messaging-tier capacity; keep Acceptance limits low.
8. No scripted Production restore exists (GATE-M section 7); migrations are forward-only.

---

## G0. Merges and RC rule (sequential, each approval separate)

**G0.1 Merge #145, #154, #151.** Owner action: GitHub UI. Preconditions: CI green; none touches a runtime path. Verify (read-only): `git fetch origin main && git log --oneline -5 origin/main`; `git ls-tree origin/main scripts/hosted-db/verify-frontend-upload.mjs`. STOP: any runtime-path file or CI red. Rollback: revert the merge (docs). Approval needed: yes.

**G0.2 Code PRs (Acceptance open mode, sign-up delivery gate).** They touch `edge/` and `frontend/src`, so merging them changes the RC. Owner action: review, merge, then re-pin the RC to the new `origin/main` and redo Acceptance from A-2 on that build (Acceptance must test the build that will go to Production). Preconditions: CI green; the Production config guard still pins mode `open` and delivery `"false"`. Verify: `gh pr diff <N> --name-only`. STOP: any change to the Production wrangler config permit. Rollback: revert before deploy. Approval needed: yes.

**G0.3 RC re-check (before A-2 deploy, P-1 push, B0, B1).** CHECKLIST (#145) path list, compared against the pinned RC:

```bash
git fetch origin main && RC=$(git rev-parse origin/main) && echo "RC=$RC"
git diff --stat fc62c4b5a3f9284fb2fc7d9b52df8193d558a13a origin/main -- frontend/src frontend/public frontend/cloudflare frontend/scripts frontend/wrangler.jsonc frontend/next.config.ts frontend/open-next.config.ts frontend/tailwind.config.ts frontend/postcss.config.mjs frontend/tsconfig.json frontend/package.json package.json pnpm-workspace.yaml pnpm-lock.yaml backend edge supabase .github/workflows/cloudflare-production.yml
```

After G0.2 the expected output is the two code PRs only; the owner then pins a NEW RC and replaces `fc62c4b5` in this file. STOP: any output not explained by approved PRs. Rollback: none (read-only). Approval needed: yes.

## ACCEPTANCE

### A-1 Apply migrations 090003-090006 to Acceptance

Owner action: `bash scripts/hosted-db/acceptance-apply.sh --sha <MAIN_SHA> --backup-label aladdin-acceptance-<YYYYMMDDTHHMMSSZ>` (typed phrase `APPLY 4 MIGRATIONS TO ACCEPTANCE`); plan in [MIGRATION_DRYRUN_RUNBOOK_20261108.md](MIGRATION_DRYRUN_RUNBOOK_20261108.md) sections F to H; backup freshness is an owner decision (section G). Preconditions: clean checkout, HEAD equals `<MAIN_SHA>` equals `origin/main`; Acceptance snapshot restore test PASS. Verify (read-only): the script's final `PASS:` line (207 applied, permissions equal `20261107090006` contract); `supabase migration list --linked` shows 090003-090006. STOP: any pre- or post-check failure; do not retry after a failed push, read the migration list. Rollback: forward-fix, or `restore-acceptance.sh` from the named snapshot (Acceptance only). Approval needed: yes.

### A-2 Deploy Acceptance with open mode

Owner action: after the Acceptance open-mode PR is merged (G0.2), deploy the Acceptance OTP Worker and the preview frontend from the pinned RC using the existing preview deploy path (`edge/whatsapp-otp-worker` preview config; frontend preview workflow). Exact commands: the CHECKLIST preview rows; they are not respelled here. Preconditions: A-1 done; the reviewed preview config sets `OTP_ENVIRONMENT=acceptance` and `OTP_RECIPIENT_MODE=open`, and the preview guard accepts exactly that; `WHATSAPP_DELIVERY_ENABLED=false` still. Verify (read-only): the Worker version changed from `11b9f694`; Super Admin panel on Acceptance shows environment `acceptance`, recipient mode `open`, permit state, switch OFF. STOP: panel shows any other mode. Rollback: roll the Worker back to `11b9f694` and the frontend to `d8ff501d-4d01-4d4c-95ac-e0948347a46b`. Approval needed: yes.

### A-3 Limits, switch and attestation (Acceptance)

Owner action: Super Admin on the Acceptance `/admin/whatsapp-otp`: initialise P-8 with LOW limits so they can be observed (for example daily send limit 5, hard ceiling within the page's validity rule: daily at least 1 and not above the ceiling; the shared WABA tier must absorb it); alert-connection test; switch ON; wait for `delivery_attested` true (age 0 to 120 s). Preconditions: A-2; permit allows sending on Acceptance (a permit equal to `"true"` in the Acceptance Worker config is part of the reviewed preview change; if absent, the switch stays disabled with `environment_not_permitted`). Verify: audit rows for limits and switch. STOP: alert probe fails, or attestation not recorded within a few minutes. Rollback: switch OFF (immediate). Approval needed: yes.

### A-4 Enable the sign-up gates (Acceptance only)

Owner action: set server secrets `PHONE_VERIFICATION_ENABLED=true` and `PHONE_SIGNUP_VERIFICATION_ENABLED=true` on the Acceptance frontend (secret change, own approval); then set `app.phone_verification_config.enabled` and `signup_enabled` to true on the Acceptance database through a reviewed owner-run SQL path (R1/R2 doc `docs/security/PHONE_SIGNUP_R2_INTEGRATION.md`; no script invented here; the alias guard mode must not be `off`). Do this strictly AFTER A-3. Preconditions: A-3 attested. Verify (read-only SELECT): the config row shows both true; `app.phone_verification_config_log` has the two audited rows. STOP: guard mode `off` (constraint refuses). Rollback: set `signup_enabled` false first, then `enabled`; remove or set flags to anything other than `true`. Approval needed: yes.

### A-5 Manual E2E on Acceptance (owner, browser, real CAPTCHA ON)

Owner action (automation cannot pass the CAPTCHA; #159 smoke covers only non-CAPTCHA smoke). Use a real phone you control. Checklist, record pass/fail per row with timestamps (no numbers in notes):

1. Phone sign-up: code arrives on the real phone via WhatsApp; wrong code rejected with the expected attempt limit; correct code proceeds.
2. Resend: cooldown and resend limit enforced; limit message is user-safe.
3. Expiry: wait past expiry, an old code is refused, a new request works.
4. Account created with the single-use grant; username, account type, birthday saved; consents recorded.
5. Sign-in with the phone number and password (one-field sign-in); sign-in by email and username still work.
6. Forgot-password (email OTP) unaffected.
7. Email sign-up (email OTP) unaffected.
8. Rate limits and budget: with the low P-8 limits from A-3, exhaust the daily limit and observe the budget refusal and the Super Admin alert; the user-visible effect is generic, not a technical message.
9. Kill switch: turn the Super Admin switch OFF; attempt mobile sign-up and record the user-visible effect (expected today: the page replies "sent" and no code arrives, because the frontend is not coupled; this is exactly requirement 9 and the reason for the gate PR; after that PR the form must fail closed or hide mobile sign-up). Turn it ON again and confirm sends resume after attestation.
10. Super Admin pages: settings, alerts, audit log, "Sending service" panel (counters moved by exactly the sends made, no phone numbers shown).

Preconditions: A-4. STOP: any row fails, any send to an unintended number, a Meta error or quality drop, `whatsapp_otp_attestation_failed` 3 or more in 5 minutes, `delivery_unmatched`, `audit_unmatched`. Rollback: switch OFF; set `signup_enabled=false`. Approval needed: yes.

### A-6 Close Acceptance testing

Owner action: record the evidence (per-row result, versions, RC), switch delivery OFF and `signup_enabled=false` on Acceptance (or leave Acceptance sends low and documented; owner decision). Verify: panel shows OFF. STOP: n/a. Rollback: n/a. Approval needed: yes. The Production gates below start only after A-5 passes (or an owner-signed waiver).

## PRODUCTION (general availability)

### P-1 Production migrations (Gate M)

Forward-only; applied before promotion; not required for the 0% upload. Exact commands: `docs/operations/PRODUCTION_MIGRATIONS_20261108_GATE.md` (PR #154) section 6; do not retype them. Owner action in order: (a) fresh snapshot `bash scripts/hosted-db/production-recovery-snapshot.sh` then `bash scripts/hosted-db/encrypt-backup.sh ~/aladdin-production-snapshot-<stamp>`; (b) `bash scripts/hosted-db/production-p2-push.sh ~/aladdin-production-snapshot-<stamp> --check-only`; (c) the same without `--check-only` and typed phrase `PUSH 4 MIGRATIONS TO PRODUCTION` (separate GO; snapshot at most 60 minutes old); (d) the SELECT-only post-apply queries of #154 section 6 (re-link first). Preconditions: A-5 passed; G0.3 clean; Production history exactly 203 / `20261107090003` with the four pending. Verify (read-only): 207 rows, latest `20261107090006`, dry run lists exactly the four versions in order, backup tables and permissions as in #154. Then smoke the live `a3b08a22`: sign in, open a showroom page, load one media image, open an admin page. STOP: any other history or pending list; do not retry or repair after a partial failure. Rollback: forward-fix through the same gate; frontend rollback to `a3b08a22` is safe (schema is a superset); data restore has no script. Do NOT run `production-post-migration-check.sh` (stale, expects 191 versions). Approval needed: yes.

### P-2 Upload at 0%, verify, promote

Commands: CHECKLIST step B and D (in #145). Owner action in order: B0 `gh variable set CLOUDFLARE_PRODUCTION_ENABLED --env cloudflare-production --body true`; B1 `gh workflow run cloudflare-production.yml --ref main -f stage=frontend-upload`, owner approves the environment review, watch the run; B2 set the variable back to `false` (always); B3 `node scripts/hosted-db/verify-frontend-upload.mjs --version=<UPLOADED_VERSION_ID> --expect-sha="$RC"` plus the manual cross-check that the run's `headSha` equals `$RC` and its version id equals the verified one. Read-only checks with the override header (CHECKLIST step C): `/auth/sign-in` and `/auth/sign-up` print 200, `POST /api/internal/whatsapp-otp/delivery-attest` prints 401, owner sign-in by email, username and phone, `/admin/whatsapp-otp` loads. Promote: `(cd frontend && pnpm exec wrangler versions deploy <UPLOADED_VERSION_ID>@100% --env production)`, then repeat the curl and sign-in checks without the header. Preconditions: P-1 done, G0.3 clean, DB switches (`enabled`, `signup_enabled`) false, Production delivery OFF, live still `a3b08a22` alone at 100%. Verify: as above; the cron noise `whatsapp_otp_attestation_failed` / `app_404` becomes steady 200s within about a minute. STOP: REFUSED from the verifier, any 5xx, a persisting `app_401`/`app_403`. Rollback (instant): `(cd frontend && pnpm exec wrangler rollback a3b08a22-f82e-4851-9786-9442c01e43c8 --env production -m "rollback")`; never `wrangler delete`; it does not undo migrations. Approval needed: yes (upload, promotion each).

### P-3 Limits, alerts, Meta, delivery ON, ONE live verification

Owner action in order:

1. Owner-only Meta checks (can run early, must pass before step 4): quality rating of sender `1458603463983505` not Low or flagged (the `meta-preflight.mjs` script fails only on RED; use the stricter wording); messaging tier allows at least 150 unique recipients per 24 h now (and 10,000 for a 5,000 ceiling), with Acceptance traffic counted; business display name approved; `debug_token` shows scopes `whatsapp_business_messaging` and `whatsapp_business_management`, WABA in `granular_scopes`, `expires_at` 0; system user has the WABA and the phone-number asset with Full control. Read-only helper: `edge/whatsapp-otp-worker/scripts/meta-preflight.mjs` (does not read the tier). Delivery-status webhook is NOT flowing, so confirm on the recipient's phone.
2. P-8: Super Admin initialises limits 150 / 5,000 / 70 / 90 on `/admin/whatsapp-otp` (typed ceiling confirmation, reason). P-9: "Test the alert connection", confirm the attestation cron, pick the alert channel.
3. Reviewed PR (separate, in preparation): `WHATSAPP_DELIVERY_ENABLED` to `"true"` in `edge/whatsapp-otp-worker/wrangler.production.jsonc` with the guard update (mode stays `open`; the guard today refuses `"true"`); merge, then deploy per CHECKLIST P-5/P-6 (`--dry-run` first), with its own approval. Merging it touches `edge/`: do it only after the P-2 upload, as an `edge/` change does not alter the frontend bundle but does trip the RC rule (re-pin). Read-only verification: `check-production-deployment.mjs` (read-only API token, unset afterwards).
4. Super Admin switch ON; wait for `delivery_attested` true.
5. ONE minimal live delivery verification: request exactly one code to an owner-controlled number through the normal path. DB switches are still false, so use the owner-run Super Admin "send test" path if it exists; the sources do not say which flow requests a single code before sign-up is enabled; the owner chooses and records it (open item). Confirm it arrives on the phone and counters moved by exactly 1.

Preconditions: P-2 promotion, Meta checks pass. Verify: panel shows permit true, switch ON, attested, counters +1, no number in logs. STOP (any): message does not arrive; counters move by more than 1; Meta error or quality drop; `whatsapp_otp_attestation_failed` 3+ in 5 minutes; `delivery_unmatched`, `audit_unmatched`, overdue notice; `whatsapp_otp_budget_exhausted`. Rollback: switch OFF (immediate, no deploy; ALSO keep `signup_enabled=false`); revert the permit and redeploy, or roll the Worker back to `4415c515-cfe9-4e85-b2e5-1e5852ad8cc0`. Approval needed: yes.

### P-4 General availability: enable the database switches LAST

Owner action: set `PHONE_VERIFICATION_ENABLED=true` and `PHONE_SIGNUP_VERIFICATION_ENABLED=true` (frontend server secrets) if not already, then `app.phone_verification_config.enabled` then `signup_enabled` to true through the reviewed owner-run SQL path (audited). Preconditions: P-3 passed and delivery ON, attested and live-verified; the sign-up delivery gate PR is merged and in the live build (GA blocker); CAPTCHA, limits, alerts and audit still in place. Verify (read-only): config row shows both true, two rows in `app.phone_verification_config_log`, the panel still attested; monitor the first sign-ups on the Super Admin pages and alerts. STOP: any alert above, a delivery failure, attestation lost. Rollback: `signup_enabled=false` first (instant gate, signup RPCs answer `unavailable`), then switch delivery OFF if needed. Approval needed: yes.

## Kill-switch operating rule (requirement 9, interim until the gate PR is live)

Ordering protects only the FIRST enablement. Until the code gate is live and verified, whenever the delivery kill switch is turned OFF (Super Admin switch, permit revert or Worker rollback), set `signup_enabled=false` in the SAME step, before or immediately after the switch. Shape of the SQL, owner-run through a reviewed path (no script is provided; do not invent one): a single UPDATE of the one row of `app.phone_verification_config` setting `signup_enabled` to false (the audit trigger logs old and new values to `app.phone_verification_config_log`). Read-only verification: a SELECT of that row shows `signup_enabled` false, and a SELECT of the newest `phone_verification_config_log` row shows `signup_enabled` true to false. The reverse (re-enable) is allowed only after delivery is ON, attested and a delivery check succeeded. Email sign-up and sign-in are unaffected by this gate.

## Contradictions and gaps between sources

1. **Allowlist residue.** PR #145 and the CHECKLIST on main still contain P-7a text and rows written for the allowlist (`allowlist_entries`); with #157 closed, the Production Worker stays in `open` mode and those expectations must read `open`. Also the CHECKLIST P-6 binding count (six) was for #157; check against the live Worker `4415c515` (read-only script) before relying on it.
2. **Acceptance recipient mode.** The preview `wrangler.jsonc` and its guard enforce `allowlist`; Acceptance `open` is impossible without the code PR (src/index.ts:191-192 requires production).
3. **Frontend rollback target.** `MIGRATION_DRYRUN_RUNBOOK_20261108.md` section C (main) says `39bdf3a2`; #154 and the CHECKLIST say `a3b08a22`; this file uses `a3b08a22`.
4. **Migration counts.** CHECKLIST P-2 row and older numbers say 195 / 8; DRYRUN, #154 and this file say 203 / 4 / 207. Acceptance is at 203 before A-1 and its pending set includes 090003; Production pending excludes it.
5. **Stale script.** `production-post-migration-check.sh` expects 191 versions; use the SELECT list in #154.
6. **RC path list.** The CHECKLIST lists 16 path groups; #151 lists fewer. The CHECKLIST list is a superset and is used.
7. **RC versus Acceptance.** #154 requires Acceptance at 207 before Production; the earlier owner-reported Acceptance PASS was on a build whose new migrations were not applied to Acceptance. The new A-1 to A-5 replace that evidence.
8. **Code PRs change the RC.** Both new PRs touch runtime paths; Acceptance must be re-run on the final RC, and this file's RC constant must be re-pinned afterwards.
9. **Quality wording.** "not Low/flagged" (first-live doc) versus `meta-preflight.mjs` failing only on RED; use the stricter.
10. **Secrets and commands not spelled in sources.** The Worker rollback flags and the Acceptance preview deploy commands are not spelled in any single source; confirm with `pnpm exec wrangler rollback --help` and the CHECKLIST.
11. **Single-code trigger.** No source names a flow that requests exactly one code while `signup_enabled=false` (P-3 step 5); the owner decides.
12. **Delivery coupling.** Sign-up replies "sent" regardless of delivery and the kill switch is not coupled to the frontend; only the gate PR plus the operating rule above close this.
