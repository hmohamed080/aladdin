#!/usr/bin/env bash
# Turn on Supabase Auth CAPTCHA protection (Turnstile) in THIS checkout's supabase/config.toml, for one CI run.
#
# Usage: scripts/ci/enable-gotrue-captcha.sh <cloudflare-test-secret>
#
# Accepts ONLY Cloudflare's public, documented Turnstile TEST secrets
# (https://developers.cloudflare.com/turnstile/troubleshooting/testing/):
#   1x0000000000000000000000000000000AA  always passes (any token, as observed in CI)
#   2x0000000000000000000000000000000AA  always fails
#   3x0000000000000000000000000000000AA  always answers "token already spent"
# A real secret never belongs in a file; hosted projects are configured in the Supabase dashboard (ADR-0023).
# Run it before `supabase start`. It refuses to run twice on the same checkout.
set -euo pipefail

secret="${1:-}"
case "$secret" in
  1x0000000000000000000000000000000AA | 2x0000000000000000000000000000000AA | 3x0000000000000000000000000000000AA) ;;
  *) echo "enable-gotrue-captcha: pass one of Cloudflare's public Turnstile TEST secrets" >&2; exit 2 ;;
esac

config="$(cd "$(dirname "$0")/../.." && pwd)/supabase/config.toml"
if grep -qE '^\[auth\.captcha\]' "$config"; then
  echo "enable-gotrue-captcha: $config already has an [auth.captcha] table" >&2
  exit 1
fi

cat >> "$config" <<TOML

# Added for this CI run only by scripts/ci/enable-gotrue-captcha.sh (Cloudflare public test secret).
[auth.captcha]
enabled = true
provider = "turnstile"
secret = "$secret"
TOML
echo "Supabase Auth CAPTCHA protection enabled for this run (Turnstile test secret ${secret:0:2}...)."
