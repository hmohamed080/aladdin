# WhatsApp OTP — Phase C: one controlled real message (Acceptance)

**Status:** **PREPARED, NOT APPROVED, NOT EXECUTED.** Phase B is closed ([results](WHATSAPP_OTP_PHASE_A_CLOSURE_AND_PHASE_B_PLAN.md#phase-b--actual-results-closed)). Everything is OFF today. No step in this document has been run, and no message has been sent. Two separate owner approvals are required: one for the preparation (C3–C4, Worker delivery still OFF) and one, explicit and last, for setting `WHATSAPP_DELIVERY_ENABLED=true` (C5).

## Purpose

Prove, on Acceptance only, that one real WhatsApp code is delivered to the owner's allow-listed handset, that the code verifies once, and that the database ends with the right Auth user, `phone_verified_at`, a single-use grant and a matching D1 journal row. Meta accepting the request is not sufficient evidence.

## Current decision (the OFF state Phase C starts from)

All of these are OFF after B9 and **all must be accounted for**, not only the Worker switch:

| Layer | Setting | Today |
|---|---|---|
| Database | `app.phone_verification_config.enabled` | `false` |
| Database | `signup_enabled` | `false` |
| Database | `alias_guard_mode` | `off` |
| Frontend (`aladdin-frontend-preview`, version `dbe1a188`) | `PHONE_VERIFICATION_ENABLED` | `false` |
| Frontend | `PHONE_SIGNUP_VERIFICATION_ENABLED` | `false` |
| Frontend | `PHONE_OTP_DELIVERY` | `off` |
| Worker `aladdin-whatsapp-otp-preview` (version `6eb9364d`) | `WHATSAPP_DELIVERY_ENABLED` | `"false"` |

A message can leave only if **all seven** are in the ON position and the number is allow-listed. Turning any one OFF stops it.

## The quota problem, and how the pilot is limited

The allowlist restricts *who* can be messaged, not *how many* messages. Verified from the code:

- The Worker has **no per-recipient or per-day quota**. Each `delivery_id` makes one D1 claim, so a *retry of the same delivery* is never re-sent, but every new start or resend has a new `delivery_id` and would send again.
- The database limits are the real throttle, and their defaults are generous for a pilot: `signup_phone_hourly=5`, `user_hourly_starts=6`, `resend_cooldown=60s`, `ip_hourly_starts=20`. At defaults the owner's number could receive up to five messages in an hour.
- `signup_phone_hourly` counts `signup_proof` challenges for that phone in the last hour. The two Phase B dry-run challenges (13:38:18Z and 13:39:22Z) are included.

Pilot controls, in layers (any one is sufficient; together they leave no realistic path to a second message):

1. **Database hard cap (C3):** set `signup_phone_hourly=1`, `user_hourly_starts=1`, `resend_cooldown='1 hour'` (the schema maximum, longer than the 5-minute code life). A second start or any resend for that number returns `rate_limited` **before** anything is sent. `ip_hourly_starts` stays at its default; the per-phone cap is the binding control. These limit settings are **not** written to `phone_verification_config_log` (only the three switches are), so the exact before/after values are recorded in the evidence file by hand.
2. **Timing consequence:** because the Phase B challenges count, a cap of 1 means **the pilot cannot start before 14:40Z** (one hour after the later dry-run challenge). Before then the owner's first real attempt would be rate-limited, which is safe but wasteful. No limit is raised to work around this.
3. **Allowlist:** `OTP_ALLOWED_RECIPIENTS` has exactly one number; any other recipient is refused by the Worker.
4. **Short delivery window (C7):** the Worker switch is ON only until the first accepted delivery is observed in D1, then immediately OFF. The operator watches the D1 journal during the window.
5. **Stop rule:** if D1 ever shows more than one row, or a row appears for any unexpected reason, delivery is turned OFF at once and the pilot stops for review.
6. **Owner discipline:** the owner makes exactly one sign-up attempt, does not refresh/resubmit the form, and does not press "Resend" (Resend is also blocked by control 1).

Accepted trade-off: with a cap of 1 there is **no second try in the same hour**. If the message is accepted by Meta but not received, the pilot is reported as a delivery failure and any retry needs a new approval.

## Rationale

Delivery stays OFF while the database and the app are prepared and the signed preflight is re-run, so the only irreversible event (a real message) is a single, observed, separately approved switch. Verifying the code does **not** call the Worker (`phone_signup_verify` is database-only), so Worker delivery can be turned OFF the moment the message is accepted and the owner still has the full 5-minute code life to enter the code.

## Exact sequence

### C0. Reconfirm (read-only; Worker still OFF)

- Acceptance project ref is `nxossqhdfltcqdwvbewi`; 199 migrations applied; switches `false|false|off`; 0 open challenges; `auth.users` count recorded as the baseline (13 at the end of Phase B, to be re-read).
- Worker active version is `6eb9364d` and `WHATSAPP_DELIVERY_ENABLED="false"`; frontend active version is `dbe1a188`.
- Allowlist: the signed preflight (C1) reports `allowlist_entries: 1`. The number itself is never printed or written down by the operator.
- Account safety: the owner confirms the pilot number has **no existing Acceptance account** and is not one of the 4 profiles that already carry a phone. The operator checks `select count(*) from public.profiles where phone_e164 = ...` only as a count, with the number supplied by the owner, not recorded in the evidence.

### C1. Signed Worker preflight (owner-run, secret never shown to the operator)

In the owner's PowerShell, with a hidden prompt:

```powershell
cd D:\projects\aladdin-wa-otp
$s = Read-Host "Worker signing secret" -AsSecureString
$env:PHONE_OTP_WORKER_SECRET = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
node edge/whatsapp-otp-worker/scripts/worker-preflight.mjs https://aladdin-whatsapp-otp-preview.bstalent9.workers.dev
Remove-Item Env:PHONE_OTP_WORKER_SECRET
```

Expected: `ok:true`, `delivery_enabled:false`, `environment:"acceptance"`, `allowlist_entries:1`. The owner pastes back only that JSON.

### C2. Owner pre-check

The owner confirms: the handset is on and has WhatsApp, the browser can complete Turnstile, and it is **after 14:40Z**.

### C3. Prepare the database and frontend with Worker delivery still OFF (needs approval 1)

1. Tighten the limits (the quota controls above) and record old → new values.
2. `alias_guard_mode='observe'`, then `enabled=true, signup_enabled=true`; read back `true|true|observe`.
3. `wrangler secret put` for `PHONE_OTP_DELIVERY=worker`, then `PHONE_VERIFICATION_ENABLED=true` and `PHONE_SIGNUP_VERIFICATION_ENABLED=true`, in that order. Record the resulting version.
4. **The owner must not submit the sign-up form during C3–C4.** With the Worker still OFF, a start would fail as `delivery_failed` and consume the only allowed start for the hour.

### C4. Readiness check before any real delivery

- Read-only: switches `true|true|observe`; limits as set; 0 open challenges; challenge count unchanged since C0; D1 journal 0 rows; Worker still `delivery_enabled:false` (re-run the preflight if the owner prefers).
- Owner, **without submitting**: open the Acceptance sign-up page and confirm the mobile-number option is available (no longer "isn't available right now").
- Stop here and report. Nothing real has been sent.

### C5. Explicit approval to set `WHATSAPP_DELIVERY_ENABLED=true` (needs approval 2)

The operator asks, naming the exact action and window. Nothing proceeds on prior approvals.

### C6. Open the delivery window and run the test

1. From `edge/whatsapp-otp-worker`: `npx wrangler deploy --var WHATSAPP_DELIVERY_ENABLED:true`. The committed `wrangler.jsonc` still says `"false"`, so ON exists only in this one deployment and the repository default remains OFF. Confirm the active version shows `"true"`, the allowlist secret is still bound and the version/time is recorded.
2. The operator says "go". The owner signs up **once** with the allow-listed number, completes Turnstile and reaches the code screen.
3. The operator polls D1 `whatsapp_hook_events` every few seconds for the first row with `state='accepted'`.

### C7. Close the window promptly

As soon as one row with `state='accepted'` exists (or after 3 minutes with none, or on any stop-rule trigger): `npx wrangler deploy` (no override; the file value is `false`). Confirm the active version shows `"false"`. The code stays valid for 5 minutes from issue because verification is database-only.

### C8. Owner enters the real code

The owner types the received code into the app within its 5-minute life (5 attempts maximum) and reports whether registration completes. Nobody pastes the code into chat.

### C9. Verify the outcome (database and D1, counts and booleans only)

- `auth.users` = baseline + 1. Phone accounts use the internal login alias (`…@craftsman-login.aladdin.invalid`), so the new user is an alias-domain user (the alias census goes 0 → 1, confirmed, with a profile). `public.profiles.phone_verified_at` is set for that profile only (`phone_signup_attach` sets it for the exact proven number and touches nothing else); the 4 pre-existing phone profiles stay unverified.
- Exactly one `signup_proof` challenge for the pilot, `consumed_at` set, not invalidated; exactly one grant, consumed once and not reusable; 0 open challenges.
- D1 `whatsapp_hook_events`: exactly 1 row with `state='accepted'` (the table holds a hash, a timestamp and the state only; `reserved` or `failed` is a failed delivery). Meta's HTTP 200 is not treated as proof of delivery by itself: delivery is proven by the owner receiving the code **and** the database verifying it.
- `alias_guard` observations reviewed (mode is `observe`; none expected for a phone sign-up).
- Existing accounts: the Auth user count and the 4 pre-existing phone profiles are unchanged except for the one new user.

### C10. Restore the full safe state and verify

1. Worker: `WHATSAPP_DELIVERY_ENABLED="false"` confirmed on the active version (done in C7; re-verified).
2. Database: `enabled=false, signup_enabled=false, alias_guard_mode='off'`; limits restored to `5 / 6 / '60 seconds'` (and `ip_hourly_starts` untouched at 20); audit rows recorded; 0 open challenges.
3. Frontend: `PHONE_VERIFICATION_ENABLED=false`, `PHONE_SIGNUP_VERIFICATION_ENABLED=false`, `PHONE_OTP_DELIVERY=off`; record the final version.
4. The new test account and its profile are kept for review; deleting it is a separate, owner-approved clean-up, not part of this plan.
5. Write the evidence file (versions, counts, booleans; no phone number, code or secret) and update the runtime state and work log.

## Stop conditions and rollback

- **Any mismatch in C0 or C4** (project ref, migration count, switch state, unexpected challenge, Worker not `false`): stop; nothing is enabled.
- **More than one D1 row, an unexpected recipient, a log line containing a number/code/secret, or a start that is not rate-limited when it should be:** turn Worker delivery OFF first (`npx wrangler deploy`), then the database switches and the three app settings; report as an incident.
- **Instant stop at any time:** Worker delivery OFF is the master gate. The database switches off and `PHONE_OTP_DELIVERY=off` are independent second and third gates.
- There is no down migration; tables and functions stay dormant.

## Scope and what is deferred

In scope: one message, one allow-listed handset, Acceptance only. Deferred: any second message or recipient, Production Worker/D1/secrets, DNS, Supabase Auth providers/hooks, `alias_guard_mode='enforce'`, retention scheduling, merging PR #127, deleting the test account, and the `20261031090001` contract step.

## Consequences

- After C3 the sign-up surface is live behind Cloudflare Access with Worker delivery OFF; any start fails closed as `delivery_failed` and uses up the pilot number's hourly allowance.
- After C9 the Acceptance database holds one real, phone-verified test user and its audit trail.
- After C10 all seven switches are OFF again; the only lasting changes are that user and the recorded evidence.

## Related files

- [Phase A closure and Phase B plan/results](WHATSAPP_OTP_PHASE_A_CLOSURE_AND_PHASE_B_PLAN.md)
- [Phase B results (evidence JSON)](../operations/evidence/whatsapp-otp/phase-b-results-20261101.json)
- [Exact activation and rollback steps](WHATSAPP_OTP_ACCEPTANCE_ACTIVATION.md)
- [Worker integration and pilot plan](WHATSAPP_OTP_R2_PILOT_AND_RELEASE.md)
- [Signed preflight script](../../edge/whatsapp-otp-worker/scripts/worker-preflight.mjs)
- [Worker source](../../edge/whatsapp-otp-worker/src/index.ts)

## Preparation incident and findings — 2026-11-01 (C4 attempt, no message sent)

**What happened.** After C3 (switches ON, Worker delivery OFF) the owner opened the sign-up page for the C4 availability check and clicked *Create Account* by mistake. The app showed the WhatsApp code screen; no message was sent (Worker delivery was `false`). No code was entered and no resend was made. C5 was not approved and delivery was never enabled.

**Evidence (read-only).**

- Accidental attempt: challenge created **2026-11-01T14:47:04.390Z**, invalidated **14:47:04.599Z** with `invalidated_why='delivery_failed'` (0.2 s), `attempts=0`, not consumed.
- Open challenges 0; signup grants 0; `auth.users` 13 (unchanged); alias-guard observations 0; D1 `whatsapp_hook_events` 0 rows; Worker `6eb9364d` with `WHATSAPP_DELIVERY_ENABLED="false"` throughout.
- The single hourly start allowed for the pilot number is **spent**. The rolling window (`created_at > now() - 1 hour`) frees up at **2026-11-01T15:47:04Z**.
- Safe state restored at 14:50Z: DB `false|false|off`, `PHONE_VERIFICATION_ENABLED=false`, `PHONE_SIGNUP_VERIFICATION_ENABLED=false`, `PHONE_OTP_DELIVERY=off` (frontend version `7ff6c04d-ce50-4dde-8387-77b4e3550d89`). The temporary pilot limits (`1 / 1 / '1 hour'`) were kept; original values to restore after the pilot are `5 / 6 / '1 minute'`.

**Finding F1 — resend countdown does not follow the server cooldown (frontend only; record for Production readiness).** The phone sign-up form starts a fixed client countdown, `PHONE_RESEND_COOLDOWN_SECONDS = 60` in `frontend/src/features/auth-password-preview/sign-up-form.tsx`, and ignores the `resendAvailableAt` the server returns (`signup-service.ts` returns `resend_available_at`; no UI file reads it). The ~23 s the owner saw is that 60 s countdown observed mid-way, so it is not a server-side gap: the database enforces `resend_cooldown` in `phone_signup_start` (`20261030090002`, `v_last > v_now - cfg.resend_cooldown` → `rate_limited`). That enforcement is verified by code and unit tests, **not exercised live** in this pilot (no resend was made). Consequence: with a long server cooldown the UI would enable *Resend* after 60 s and the click would be refused. Recommended later fix (not made): drive the countdown from `resendAvailableAt` and show a clear message on `rate_limited`.

**Finding F2 — the code screen claims a code was sent even when delivery failed (UX; record for Production readiness).** This is by design: the start reply is deliberately independent of delivery (anti-enumeration; `signup-service.ts` defers delivery and closes the challenge as `delivery_failed` afterwards). The cost is that a user whose delivery failed sees "code sent" and has no recourse except waiting out the cooldown. Options for a later decision (none implemented): neutral wording ("If this number can receive WhatsApp, a code is on its way"), plus a visible help path after the code expires.

**F3 — process.** A readiness check that opens the live form can be triggered by one stray click and burns the only allowed start. For the repeat, verify the surface read-only and do not load the form (see below).

## Repeating C3/C4 and C5

- Earliest safe repeat: **after 15:47:04Z**; plan for **15:50Z or later** and re-check `count(created_at > now() - 1 hour) = 0` first.
- C3 is repeated as written. C4's browser step changes: the owner does **not** open the sign-up form. Readiness is the read-only checklist only (switches, limits, flags written, Worker `false`, D1 0 rows, 0 challenges in the window, preflight already passed). The owner opens the page only at C6, when the operator says "go".
- C5 (`WHATSAPP_DELIVERY_ENABLED=true`) still needs its own explicit approval.

## Production readiness findings (owner-accepted 2026-11-01)

Recorded for the Production readiness review. Neither is fixed; no code was changed.

- **F1 — resend timer (must be corrected before general Production activation).** The frontend resend timer is a fixed 60-second countdown and does not follow the server-enforced availability and retry limits (`resendAvailableAt`, `rate_limited` / `retry_after_seconds`). The countdown and the Resend button must be driven by the server's values, and a refused resend must show a clear message.
- **F2 — OTP delivery wording.** Keep the account-enumeration protection (the start reply is independent of delivery and of whether the number already belongs to an account). Consider more neutral OTP wording. The UI must not reveal whether a number exists or whether delivery succeeded.

## Owner instructions in force (2026-11-01)

- Acceptance stays in the safe OFF state; no sign-up requests or browser tests by the operator; the owner will not open or submit the sign-up form during preparation.
- Pilot limits stay at `signup_phone_hourly=1`, `user_hourly_starts=1`, `resend_cooldown='1 hour'` until Phase C is completed or cancelled; then restore `5 / 6 / '1 minute'`.
- On the owner's explicit message after 15:50Z: re-check the rolling-hour quota, repeat C3/C4 as read-only readiness, stop, and request the separate C5 approval. At C5 the operator watches D1 and turns Worker delivery OFF promptly after the first accepted attempt; the owner submits the form only after the operator says GO.

## Pilot rate limits — revision (owner-approved 2026-11-01, applied 15:21Z)

Acceptance only; rate limiting is not disabled and the Production policy is unchanged. `user_daily_starts=10` and `ip_hourly_starts=20` are untouched.

| Setting | Original default | First pilot value | **Current pilot value** |
|---|---|---|---|
| `signup_phone_hourly` | 5 | 1 | **3** |
| `user_hourly_starts` | 6 | 1 | **3** |
| `resend_cooldown` | 1 minute | 1 hour | **1 minute** |

Supersedes the "database hard cap" values in the quota section above. **Consequence:** the database limit is now a ceiling of up to 3 starts in a rolling hour for the pilot number, not a guarantee of exactly one message. The remaining controls are the one-number allowlist, the short monitored delivery window (Worker OFF immediately after the first `state='accepted'` D1 row or on any stop condition), no automatic retry or resend, and owner discipline (one submission after GO). If the first real delivery fails, the evidence is reported and a new approval is needed before another attempt.

After Phase C completes or is cancelled, restore `5 / 6 / '60 seconds'` and set all seven activation/delivery settings to OFF.

At 15:21Z the rolling hour held 1 challenge (the 14:47:04Z accidental attempt) against the cap of 3 and 3 in 24 h against 10, so a new attempt was allowed without waiting for 15:47Z. C3 was repeated at 15:22Z (frontend `bcdf4aa3-bc2f-4253-894e-723d06c91b25`) with Worker delivery `false`, and C4 read-only readiness passed. C5 is not approved.
