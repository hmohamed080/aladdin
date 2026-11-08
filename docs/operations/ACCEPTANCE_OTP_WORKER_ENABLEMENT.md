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
Preconditions: #161 merged; checkout = exact `origin/main` SHA, clean tree.
1. `node edge/whatsapp-otp-worker/scripts/check-preview-config.mjs` prints PASS; `npm test` in `edge/whatsapp-otp-worker` passes; `npx wrangler deploy --dry-run` passes.
2. Owner approves, then: `cd edge/whatsapp-otp-worker && WRANGLER_LOG_SANITIZE=true npx wrangler deploy` (Acceptance account only; never pass `--env production`; no secret is written, the five Secrets Store bindings already exist).
3. Verify read-only. Do NOT use `scripts/worker-preflight.mjs` here: the Worker is private (no public URL, reached only through service bindings) and the script also needs an initialised budget, so it cannot pass at this stage.
   - Deployment and bindings: `wrangler versions view --json` and `wrangler deployments status` show the new version at 100% with vars `OTP_ENVIRONMENT=acceptance`, `OTP_RECIPIENT_MODE=open`, `WHATSAPP_DELIVERY_ENABLED=false`, no `OTP_ALLOWED_RECIPIENTS`, and exactly the planned bindings (`IDEMPOTENCY_DB` = Acceptance D1, the five Secrets Store bindings, `APP_NOTIFY`). Values of secrets are never printed.
   - D1, read-only SELECTs on `aladdin-whatsapp-otp-acceptance`: send journal row count unchanged (0 sends) and the delivery switch row is OFF (record its value and version).
   - The signed runtime usage path (`/v1/admin/usage`, the Super Admin page) is the runtime check; it becomes available once the Acceptance frontend with the Super Admin page is live and limits exist (W2 step 6).
4. Rollback: redeploy the previous version (record its id before step 2).

## W2: delivery permit and low budget
Preconditions: W1 verified; the Acceptance frontend (A1 redeploy from the final main, incl. PR #160) is live; Acceptance DB migrations 090003-090006 applied.
1. Merge this change (permit `"true"`; `check-preview-config.mjs` accepts `"true"`/`"false"` literals only, for the Acceptance Worker name and environment only). After #161 merges, this PR must show only its own commit(s): rebase or merge `main` into the branch before review.
2. **Gate before the permit:** read-only D1 SELECT must show the delivery switch OFF. If it is not OFF, stop and ask. Only then, with the owner's approval, redeploy as in W1 step 2 and verify the vars show `WHATSAPP_DELIVERY_ENABLED=true` and that nothing was sent (journal count 0, switch still OFF).
3. **Acceptance frontend flags** (the phone sign-up path is dormant without them; check names and presence only, never print values; set only with separate approval; the five names mirror the Production list in `provision-frontend-signup-secrets.mjs`): `PHONE_VERIFICATION_ENABLED=true`, `PHONE_SIGNUP_VERIFICATION_ENABLED=true`, `PHONE_OTP_DELIVERY=worker`, `PHONE_OTP_HMAC_KEYS`, `PHONE_SIGNUP_COOKIE_SECRET`; plus `PHONE_OTP_ADMIN_SECRET` (the delivery gate and the Super Admin page sign `/v1/admin/*` with it) and the service binding `OTP_WORKER -> aladdin-whatsapp-otp-preview` (already in `frontend/wrangler.jsonc`). A missing one leaves sign-up unavailable (fail closed).
4. **Acceptance DB signup switches** (audited, SQL-flippable, ship OFF): `app.phone_verification_config.enabled` and `.signup_enabled` set to `true` only after step 5 below succeeds; `alias_guard_mode` is not touched. Read the current values first; record before and after.
5. **Super Admin on Acceptance** (`/admin/whatsapp-otp`) initialises the limits: **daily limit 20, hard ceiling 50, warn 70%, critical 90%** (typed confirmation of the ceiling, reason of 20+ characters, expected version 0), then turns the switch ON and waits for a fresh attestation.
6. Runtime check through the signed usage path (the Super Admin page, or `/v1/admin/usage`): `runtime.delivery_enabled=true`, `configured=true`, `remaining>0`. This is exactly what the sign-up gate (#160) reads.
7. Flip the DB signup switches (step 4), then the owner runs the headed phone sign-up with real CAPTCHA (`docs/operations/ACCEPTANCE_E2E_HEADED_RUN.md`).
8. Afterwards: DB `signup_enabled=false`, Super Admin switch OFF (instant, audited), and, if the permit should not stay, redeploy with `"false"`.

Kill switches, fastest first: Super Admin switch OFF (Worker answers 503 `delivery_disabled`; the sign-up gate sees it within about 5 s per isolate); `signup_enabled=false` in `app.phone_verification_config` (SQL, audited); redeploy with permit `"false"`.

Honest limits: Acceptance sends through the SAME Meta sender and WABA as Production, so a real message reaches the entered number and counts against the shared messaging tier; the low budget is the control. Delivery receipts do not flow (webhooks are not configured), so "sent" means accepted by Meta.
