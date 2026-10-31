#!/usr/bin/env bash
# SOURCE this file (do not execute) to prepare a shell for the R2 registration E2E against the isolated stack from stack.sh.
#
#   bash supabase/tests/r2/stack.sh up confirm-on
#   source supabase/tests/r2/e2e-env.sh [phone]        # "phone" also turns the outbox-driven phone sign-up on
#   cd frontend && E2E_NEXT_MODE=dev pnpm exec playwright test --project=chromium-desktop e2e/one-field-auth.spec.ts
#
# Nothing printed here contains a key. Every secret is generated for this shell only (a throwaway keyring) or comes from the scratch stack's
# private .stack.env. Cloudflare's PUBLIC Turnstile test keys are used, with the E2E stub on, exactly like the showroom-rc2-e2e workflow.
# Hosted projects are never referenced: the API URL must be loopback and the DB container an isolated supabase_db_<project>.
_r2_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_r2_repo="$(cd "${_r2_here}/../../.." && pwd)"
_r2_work="${R2_STACK_DIR:-$(cd "${_r2_repo}/.." && pwd)/aladdin-r2-stack}"
_r2_project="${R2_PROJECT:-aladdin_r2int}"
_r2_prefix="${R2_PORT_PREFIX:-536}"
set -a
# shellcheck disable=SC1091
. "${_r2_work}/.stack.env"
set +a
case "${API_URL}" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "REFUSED: API_URL is not loopback" >&2; return 2 2>/dev/null || exit 2;; esac
export NEXT_PUBLIC_SUPABASE_URL="${API_URL}" NEXT_PUBLIC_SUPABASE_ANON_KEY="${ANON_KEY}" SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY}"
export NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_APP_ENV=local
export NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
export TURNSTILE_ALLOWED_HOSTNAMES=127.0.0.1,localhost E2E_STUB_TURNSTILE=1 E2E_TURNSTILE_STUB=1
export E2E_DB_CONTAINER="supabase_db_${_r2_project}" MAILPIT_URL="http://127.0.0.1:${_r2_prefix}24"
AUTH_PASSWORD_PREVIEW_GRANT_SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")"; export AUTH_PASSWORD_PREVIEW_GRANT_SECRET
if [[ "${1:-}" == "phone" ]]; then
  export PHONE_VERIFICATION_ENABLED=true PHONE_SIGNUP_VERIFICATION_ENABLED=true PHONE_OTP_DELIVERY=outbox
  PHONE_OTP_HMAC_KEYS="$(node -e "process.stdout.write(JSON.stringify({current:'r2e2e',keys:{r2e2e:require('crypto').randomBytes(32).toString('base64')}}))")"; export PHONE_OTP_HMAC_KEYS
  export PHONE_OTP_OUTBOX_DIR="${_r2_repo}/frontend/.local/phone-otp-outbox"
  mkdir -p "${PHONE_OTP_OUTBOX_DIR}"
  export E2E_ALIAS_GUARD="${E2E_ALIAS_GUARD:-enforce}"
  echo "[r2] E2E env ready: phone sign-up ON (outbox), alias guard ${E2E_ALIAS_GUARD}, DB ${E2E_DB_CONTAINER}. Run the app with E2E_NEXT_MODE=dev."
else
  echo "[r2] E2E env ready: phone sign-up left OFF (shipped), DB ${E2E_DB_CONTAINER}."
fi
unset _r2_here _r2_repo _r2_work _r2_project _r2_prefix
