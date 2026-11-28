# Sourced by the Production workflow: sets MEDIA_VARS (an array of wrangler arguments) for $MEDIA_MODE from the one script that owns the flags.
# Fails closed: if the script fails (including match-live being unable to read the active Production version), or match-live does not yield
# exactly its three `--var` pairs, nothing is built or uploaded. Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID for match-live.
_media_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_media_out="$(node "$_media_dir/check-cloudflare-production.mjs" --media-var-args "${MEDIA_MODE:?MEDIA_MODE is not set}")" || { echo "::error::media mode check failed"; return 1 2>/dev/null || exit 1; }
MEDIA_VARS=()
[ -z "$_media_out" ] || mapfile -t MEDIA_VARS <<< "$_media_out"
if [ "$MEDIA_MODE" = "match-live" ] && [ "${#MEDIA_VARS[@]}" -ne 6 ]; then
  echo "::error::match-live must add exactly 3 --var pairs, got ${#MEDIA_VARS[@]} arguments"
  return 1 2>/dev/null || exit 1
fi
unset _media_dir _media_out
