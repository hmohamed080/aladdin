# Production OTP Worker: delivery permit `"true"` (prepared, not deployed)

Target: `aladdin-whatsapp-otp-production` (private; its own D1 `aladdin-whatsapp-otp-production`, five `*_PRODUCTION` Secrets Store bindings, `APP_NOTIFY -> aladdin-frontend-production`). Nothing here touches Acceptance. This file describes the one-time permit deployment; it has not been run.

## What the change does
`WHATSAPP_DELIVERY_ENABLED` goes from `"false"` to `"true"` in `edge/whatsapp-otp-worker/wrangler.production.jsonc`, and both guards (`check-production-config.mjs`, `check-production-deployment.mjs`) accept the literals `"true"` or `"false"` only (anything else is refused; `"false"` stays valid so the rollback deploys). Recipient mode stays `open` with no allowlist, and every secret, D1 and routing binding is unchanged.

The permit sends nothing by itself. A send needs ALL four: the permit, the audited Super Admin Delivery Switch ON (D1 `otp_delivery_switch` with its audit row), configured limits (D1 `otp_settings`, set by the owner in Super Admin), and a fresh signed attestation of ON from the app. `test/production-permit.test.ts` proves, for a Production-shaped environment, that permit true with no switch row, an OFF switch, a stale, wrong-environment, OFF or missing attestation, or missing limits never sends and never calls Meta, and that the full set sends once and stops at once when the switch goes OFF.

One guard detail: the post-deploy check `check-production-deployment.mjs` counts attestations that say ON (`enabled = 1`), not all attestation rows, because the promoted frontend now writes a signed OFF attestation every minute.

## Preconditions (all read-only, all must hold)
1. This PR merged; checkout = exact `origin/main`, clean tree; runtime-path diff against the release candidate shows only this PR's Worker files.
2. Production frontend `38d2db8a` at 100% (promoted), 207 migrations applied.
3. D1: `otp_delivery_switch` and `otp_delivery_audit` empty, no attestation with `enabled=1`; Supabase `app.phone_verification_config` = `false, false, off`.
4. `node edge/whatsapp-otp-worker/scripts/check-production-config.mjs` prints PASS; `pnpm --filter frontend exec wrangler deploy --config ../edge/whatsapp-otp-worker/wrangler.production.jsonc --dry-run --outdir <tmp>` lists exactly the declared bindings and `WHATSAPP_DELIVERY_ENABLED="true"`.

## Deploy (separate owner approval)
`cd frontend && WRANGLER_LOG_SANITIZE=true pnpm exec wrangler deploy --config ../edge/whatsapp-otp-worker/wrangler.production.jsonc --message "Production permit true, switch OFF (<sha12>)"`

Record the previous version first: `4415c515-cfe9-4e85-b2e5-1e5852ad8cc0` (permit `false`).

## Verify (read-only)
- New version at 100%; vars `WHATSAPP_DELIVERY_ENABLED=true`, `OTP_RECIPIENT_MODE=open`, `OTP_ENVIRONMENT=production`; same bindings as before; no `OTP_ALLOWED_RECIPIENTS`.
- D1: switch and audit still empty, `whatsapp_hook_events` still 0, attestation still `enabled=0`.
- Usage through the Super Admin page shows `delivery_enabled=false` (switch OFF) until the owner turns it ON.
- `node edge/whatsapp-otp-worker/scripts/check-production-deployment.mjs` passes (needs a read-only Cloudflare token).

## Rollback
- Fastest, no deploy: Super Admin Delivery Switch OFF (audited; the Worker answers 503 `delivery_disabled`), then `signup_enabled=false`.
- Remove the permit: `wrangler rollback 4415c515-cfe9-4e85-b2e5-1e5852ad8cc0 --config ../edge/whatsapp-otp-worker/wrangler.production.jsonc --message "rollback permit"`, or set `"false"` in the config via a reviewed change and redeploy. No database change is involved.

## What stays separate
Limits are set by the owner in Super Admin (no value is predefined or committed). Activation order after this deploy, each its own approval: owner sets limits, switch ON with a fresh attestation, `alias_guard_mode` to `observe`, `enabled=true`, `signup_enabled=true`, then one real owner sign-up.
