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
3. Verify read-only: `wrangler versions view --json` shows the new version at 100%, vars `OTP_ENVIRONMENT=acceptance`, `OTP_RECIPIENT_MODE=open`, `WHATSAPP_DELIVERY_ENABLED=false`; `node scripts/worker-preflight.mjs` reports `delivery_enabled=false`, `allowlist_entries=0`; Acceptance D1 send journal count unchanged (0).
4. Rollback: redeploy the previous version (record its id before step 2).

## W2: delivery permit and low budget
Preconditions: W1 verified; the Acceptance frontend (A1 redeploy from the final main, incl. PR #160) is live; Acceptance DB migrations 090003-090006 applied.
1. Merge this change (permit `"true"`; `check-preview-config.mjs` accepts `"true"`/`"false"` literals only, for the Acceptance Worker name and environment only).
2. Owner approves, then redeploy as in W1 step 2; verify the vars show `WHATSAPP_DELIVERY_ENABLED=true` and nothing sent yet (the D1 switch is OFF).
3. Super Admin (`/admin/whatsapp-otp` on Acceptance) initialises LOW limits (suggested: limit 20, ceiling 50, warn 70, critical 90; typed confirmation of the ceiling, reason of 20+ characters), turns the switch ON, waits for fresh attestation.
4. `worker-preflight.mjs`/`/v1/admin/usage` must show `runtime.delivery_enabled=true`, `configured=true`, `remaining>0`: this is what the sign-up gate (#160) reads.
5. Owner runs the headed phone sign-up with real CAPTCHA (`docs/operations/ACCEPTANCE_E2E_HEADED_RUN.md`).
6. Afterwards: switch OFF in Super Admin (instant, audited) and, if the permit should not stay, redeploy with `"false"`.

Kill switches, fastest first: Super Admin switch OFF (Worker answers 503 `delivery_disabled`; the sign-up gate sees it within about 5 s per isolate); `signup_enabled=false` in `app.phone_verification_config` (SQL, audited); redeploy with permit `"false"`.

Honest limits: Acceptance sends through the SAME Meta sender and WABA as Production, so a real message reaches the entered number and counts against the shared messaging tier; the low budget is the control. Delivery receipts do not flow (webhooks are not configured), so "sent" means accepted by Meta.
