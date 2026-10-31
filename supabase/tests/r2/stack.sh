#!/usr/bin/env bash
set -euo pipefail

# R2 integration: an ISOLATED local Supabase stack (project aladdin_r2int, ports 536xx) for the registration + phone-authority tests.
#
#   bash supabase/tests/r2/stack.sh up   [confirm-on|confirm-off] [captcha]   # create/refresh the scratch project, start, db reset
#   bash supabase/tests/r2/stack.sh env                                      # print the (non-secret) variable NAMES the test shell must load
#   bash supabase/tests/r2/stack.sh down
#
# Why a scratch project: the committed config uses project "aladdin" and the default ports, which other worktrees' stacks already hold. This
# copies THIS worktree's migrations/templates/seeds next to the repo (never inside it), remaps every 543xx port to 536xx and the project id,
# and refuses to touch any container that is not named supabase_*_aladdin_r2int. Keys go to $WORK/.stack.env (mode 600), never to stdout.
#
#   confirm-on  (default) e-mail confirmations ON  (the shipped setting)
#   confirm-off           e-mail confirmations OFF
#   captcha               also turn on Supabase Auth CAPTCHA with Cloudflare's PUBLIC always-pass TEST secret (like auth-captcha-e2e.yml)

cmd="${1:-}"; mode="${2:-confirm-on}"; captcha="${3:-}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "${here}/../../.." && pwd)"
project="aladdin_r2int"
work="${R2_STACK_DIR:-$(cd "${repo}/.." && pwd)/aladdin-r2-stack}"
cli=(npx -y supabase@2.110.0)   # the CI toolchain (.github/workflows use the pinned devDependency 2.110.0)

case "${work}" in *aladdin-r2-stack*) ;; *) echo "[r2] REFUSED: R2_STACK_DIR must be the aladdin-r2-stack scratch directory" >&2; exit 2;; esac

case "${cmd}" in
  up)
    case "${mode}" in confirm-on) confirmations=true;; confirm-off) confirmations=false;; *) echo "[r2] mode must be confirm-on|confirm-off" >&2; exit 2;; esac
    ( [[ -d "${work}/supabase" ]] && cd "${work}" && "${cli[@]}" stop --no-backup >/dev/null 2>&1 ) || true
    rm -rf "${work}/supabase"; mkdir -p "${work}/supabase"
    cp -r "${repo}/supabase/migrations" "${repo}/supabase/templates" "${work}/supabase/"
    cp "${repo}"/supabase/seed*.sql "${repo}/supabase/demo-seed.sql" "${work}/supabase/"
    git -C "${repo}" show HEAD:supabase/config.toml \
      | sed -e "s/^project_id = .*/project_id = \"${project}\"/" -e 's/\b543\([0-9][0-9]\)\b/536\1/g' -e 's/\b8083\b/53683/' > "${work}/supabase/config.toml"
    sed -i "/^\[auth\.email\]/,/^\[auth\.email\.[a-z]*\]/ s/^enable_confirmations = .*/enable_confirmations = ${confirmations}/" "${work}/supabase/config.toml"
    grep -A40 '^\[auth\.email\]' "${work}/supabase/config.toml" | grep -m1 '^enable_confirmations' | grep -q "= ${confirmations}" \
      || { echo "[r2] could not set enable_confirmations=${confirmations}" >&2; exit 1; }
    if [[ "${captcha}" == "captcha" ]]; then
      printf '\n[auth.captcha]\nenabled = true\nprovider = "turnstile"\nsecret = "1x0000000000000000000000000000000AA"\n' >> "${work}/supabase/config.toml"
    fi
    ( cd "${work}" && "${cli[@]}" start --exclude studio,postgres-meta,edge-runtime,logflare,vector,supavisor > "${work}/start.log" 2>&1 \
        && "${cli[@]}" db reset >> "${work}/start.log" 2>&1 ) || { echo "[r2] stack did not start; see ${work}/start.log" >&2; exit 1; }
    ( cd "${work}" && "${cli[@]}" status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=' ) > "${work}/.stack.env"
    chmod 600 "${work}/.stack.env"
    echo "[r2] up: project=${project} confirmations=${confirmations} captcha=${captcha:-off} api=http://127.0.0.1:53621 db=supabase_db_${project} mail=http://127.0.0.1:53624"
    ;;
  env)
    echo "load with: set -a; . ${work}/.stack.env; set +a"
    echo "NEXT_PUBLIC_SUPABASE_URL (=API_URL), NEXT_PUBLIC_SUPABASE_ANON_KEY (=ANON_KEY), SUPABASE_SERVICE_ROLE_KEY (=SERVICE_ROLE_KEY)"
    echo "E2E_DB_CONTAINER=supabase_db_${project}   MAILPIT_URL=http://127.0.0.1:53624"
    ;;
  down)
    ( cd "${work}" && "${cli[@]}" stop --no-backup ) || true
    ;;
  *) echo "usage: $0 up [confirm-on|confirm-off] [captcha] | env | down" >&2; exit 2;;
esac
