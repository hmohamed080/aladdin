# Acceptance OTP Worker: open-mode deployment and delivery permit (prepared, not executed)

Target: `aladdin-whatsapp-otp-preview` (Acceptance D1 `aladdin-whatsapp-otp-acceptance`, same Meta sender as Production). Production is never touched.
Owner decisions (2026-11-08): no allowlist and no dedicated test number; `OTP_RECIPIENT_MODE=open`; real CAPTCHA, rate limits, a low send budget and
the kill switches stay in force. Every step below needs its own approval; none has been run.

## Two separate changes, two approvals
| | Change | Code | Effect |
|---|---|---|---|
| **W1** | Deploy open mode, delivery still OFF | PR #161 (merged first) | `OTP_ENVIRONMENT=acceptance`, `OTP_RECIPIENT_MODE=open`, `WHATSAPP_DELIVERY_ENABLED="false"`. Sending is impossible. |
| **W2** | Delivery permit `"true"` | this change (stacked on #161; merge only after W1 is verified) | Adds the permit. Still nothing is sent until the Super Admin switch is ON and attestation is fresh. |

The permit is one of three Worker-side conditions: permit AND the audited Super Admin switch in D1 (starts OFF) AND a fresh attestation. Limits (D1, Super Admin) must exist first, or the Worker sends nothing.

## W1: open-mode deploy (delivery OFF)
Preconditions: #161 and #160 merged; checkout = exact `origin/main` SHA (pinned release candidate `b44061a1e4d3daf5b50b260af8495fbbd5bcea03` unless main moves), clean tree. Live Acceptance Worker at the time of writing: version `11b9f694-1f2e-4e2c-ad41-8a8d0a8ae13e` (100%, `OTP_RECIPIENT_MODE=allowlist`, `WHATSAPP_DELIVERY_ENABLED=false`).
1. Preflight (read-only, no upload): `node edge/whatsapp-otp-worker/scripts/check-preview-config.mjs` prints PASS; `pnpm --filter frontend exec wrangler deploy --config ../edge/whatsapp-otp-worker/wrangler.jsonc --dry-run --outdir <tmp>` (pinned wrangler 4.151.2) lists exactly: `IDEMPOTENCY_DB` (Acceptance D1), five Secrets Store bindings, `APP_NOTIFY -> aladdin-frontend-preview`, vars `OTP_ENVIRONMENT=acceptance`, `OTP_RECIPIENT_MODE=open`, `WHATSAPP_DELIVERY_ENABLED=false`. (`npm test` in `edge/whatsapp-otp-worker` passed 205/205 on the merged code.)
2. Separate owner approval, then: `cd frontend && WRANGLER_LOG_SANITIZE=true pnpm exec wrangler deploy --config ../edge/whatsapp-otp-worker/wrangler.jsonc --message "W1 open mode, delivery OFF (<sha12>)"` (Acceptance account only; never `--env production`; no secret is written; the five Secrets Store bindings already exist). Before it, record the D1 journal count and the switch row (step 3).
3. Verify read-only. Do NOT use `scripts/worker-preflight.mjs` here: the Worker is private (no public URL, reached only through service bindings) and the script also needs an initialised budget, so it cannot pass at this stage.
   - Deployment and bindings: `wrangler versions view --json` and `wrangler deployments status` show the new version at 100% with vars `OTP_ENVIRONMENT=acceptance`, `OTP_RECIPIENT_MODE=open`, `WHATSAPP_DELIVERY_ENABLED=false`, no `OTP_ALLOWED_RECIPIENTS`, and exactly the planned bindings (`IDEMPOTENCY_DB` = Acceptance D1, the five Secrets Store bindings, `APP_NOTIFY`). Values of secrets are never printed.
   - D1, read-only SELECTs on `aladdin-whatsapp-otp-acceptance`: record the send journal row count BEFORE the deploy and again AFTER it; the two must be equal (the count need not be zero: earlier tests may have left rows). The delivery switch row must read OFF (record its value and version).
   - The signed runtime usage path (`/v1/admin/usage`, the Super Admin page) is the runtime check; it becomes available once the Acceptance frontend with the Super Admin page is live and limits exist (W2 step 6).
4. Rollback: `cd frontend && pnpm exec wrangler rollback 11b9f694-1f2e-4e2c-ad41-8a8d0a8ae13e --name aladdin-whatsapp-otp-preview --message "rollback W1"` (restores allowlist mode, delivery OFF). Nothing in the database changes.
5. Known leftover, inert: the live version carries a Worker secret `OTP_ALLOWED_RECIPIENTS` from the earlier pilot. A code deploy keeps it, and open mode never reads it (`recipientAllowed` returns true first). It holds a phone number, so deleting it (`wrangler secret delete`) is an optional, separately approved secret change, not part of W1.

## W2: delivery permit and low budget
Preconditions: W1 verified; the Acceptance frontend (A1 redeploy from the final main, incl. PR #160) is live; Acceptance DB migrations 090003-090006 applied.
1. Merge this change (permit `"true"`; `check-preview-config.mjs` accepts `"true"`/`"false"` literals only, for the Acceptance Worker name and environment only). After #161 merges, this PR must show only its own commit(s): rebase or merge `main` into the branch before review.
2. **Gate before the permit:** read-only D1 SELECT must show the delivery switch OFF. If it is not OFF, stop and ask. Only then, with the owner's approval, redeploy as in W1 step 2 and verify the vars show `WHATSAPP_DELIVERY_ENABLED=true` and that nothing was sent (journal count equal to its value before the deploy, switch still OFF).
3. **Acceptance frontend flags** (the phone sign-up path is dormant without them; check names and presence only, never print values; set only with separate approval; the five names mirror the Production list in `provision-frontend-signup-secrets.mjs`): `PHONE_VERIFICATION_ENABLED=true`, `PHONE_SIGNUP_VERIFICATION_ENABLED=true`, `PHONE_OTP_DELIVERY=worker`, `PHONE_OTP_HMAC_KEYS`, `PHONE_SIGNUP_COOKIE_SECRET`; plus `PHONE_OTP_ADMIN_SECRET` (the delivery gate and the Super Admin page sign `/v1/admin/*` with it) and the service binding `OTP_WORKER -> aladdin-whatsapp-otp-preview` (already in `frontend/wrangler.jsonc`). A missing one leaves sign-up unavailable (fail closed).
4. **Acceptance DB config** (`app.phone_verification_config`, audited, SQL-flippable, ships `enabled=false, signup_enabled=false, alias_guard_mode=off`).
   - **Read and record first** (read-only SELECT of the three columns). Owner-verified 2026-11-08: `false, false, off`.
   - **Constraint:** migration `20261030090002` adds `ck_config_signup_needs_guard`: `not signup_enabled or alias_guard_mode <> 'off'`. Setting `signup_enabled=true` while the guard is `off` is rejected by the database. The guard comes first.
   - Set values only in steps 5-7 below, each change separately approved. `alias_guard_mode` goes to `observe` only, never `enforce` at this stage (enforce would refuse any alias creation without a grant and is tied to retiring every no-grant path).
   - **Audit verification after every change:** a read-only SELECT on `app.phone_verification_config_log` must show exactly one new row per changed setting (`setting`, `old_value`, `new_value`) and the config row must show the new value; record both.
5. **Super Admin on Acceptance** (`/admin/whatsapp-otp`) initialises the limits: **daily limit 20, hard ceiling 50, warn 70%, critical 90%** (typed confirmation of the ceiling, reason of 20+ characters, expected version 0), then turns the switch ON and waits for a fresh attestation.
6. Runtime check through the signed usage path (the Super Admin page, or `/v1/admin/usage`): `runtime.delivery_enabled=true`, `configured=true`, `remaining>0`. This is exactly what the sign-up gate (#160) reads.
7. **DB switches, each a separately approved write, in this order, with the audit check of step 4 after each:**
   1. `alias_guard_mode = 'observe'` (only after delivery is ready: steps 2, 3, 5 and 6 verified).
   2. `enabled = true`.
   3. `signup_enabled = true` (accepted only now, because the guard is no longer `off`).
   Then the owner runs the headed phone sign-up with real CAPTCHA (`docs/operations/ACCEPTANCE_E2E_HEADED_RUN.md`).
8. **Rollback / afterwards, in this order** (each step instant, no deploy; the constraint makes the order mandatory, because the guard cannot return to `off` while `signup_enabled` is true):
   1. `signup_enabled = false` first (new sign-ups are refused at once).
   2. Super Admin delivery switch OFF (audited; the Worker then answers 503 `delivery_disabled`).
   3. `enabled = false`.
   4. `alias_guard_mode`: leave at `observe`, or restore to `off` (allowed only after step 1). Never `enforce` here.
   5. Frontend flags (`PHONE_SIGNUP_VERIFICATION_ENABLED`, `PHONE_VERIFICATION_ENABLED`) off only if the whole path should be removed, and the permit back to `"false"` by redeploy if it should not stay.
   Audit-check each change as in step 4.

Kill switches, fastest first: Super Admin switch OFF (Worker answers 503 `delivery_disabled`; the sign-up gate sees it within about 5 s per isolate); `signup_enabled=false` in `app.phone_verification_config` (SQL, audited); redeploy with permit `"false"`.

Honest limits: Acceptance sends through the SAME Meta sender and WABA as Production, so a real message reaches the entered number and counts against the shared messaging tier; the low budget is the control. Delivery receipts do not flow (webhooks are not configured), so "sent" means accepted by Meta.
