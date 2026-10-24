#!/usr/bin/env bash
set -uo pipefail

# Self-test for supabase/tests/lib/db_target.sh and for the wiring of every destructive script.
# SAFE BY CONSTRUCTION: `docker` is replaced by a shim on PATH, so no real container is ever contacted and nothing is
# written anywhere. Run:  bash supabase/tests/lib/db_target_selftest.sh

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tests_dir="$(cd "${here}/.." && pwd)"
helper="${here}/db_target.sh"
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
log="${work}/docker.log"
: > "${log}"

# --- the docker shim -------------------------------------------------------------------------------------------
cat > "${work}/docker" <<'SHIM'
#!/usr/bin/env bash
echo "docker $*" >> "${FAKE_LOG}"
cmd="$1"; shift
case "${cmd}" in
  ps)
    filter=""; while [[ $# -gt 0 ]]; do [[ "$1" == "--filter" ]] && filter="$2"; shift; done
    want="${filter#name=}"
    if [[ "${want}" == "^/supabase_db_" ]]; then printf '%s\n' ${FAKE_RUNNING:-}; exit 0; fi
    want="${want#^/}"; want="${want%\$}"
    for n in ${FAKE_RUNNING:-}; do [[ "${n}" == "${want}" ]] && echo "${n}"; done
    [[ -n "${FAKE_AMBIGUOUS:-}" ]] && echo "${want}_second"
    exit 0 ;;
  inspect)
    fmt=""; name=""; while [[ $# -gt 0 ]]; do if [[ "$1" == "--format" ]]; then fmt="$2"; shift; else name="$1"; fi; shift; done
    if [[ "${fmt}" == *Labels* ]]; then
      for pair in ${FAKE_LABELS:-}; do [[ "${pair%%=*}" == "${name}" ]] && echo "${pair#*=}"; done
    elif [[ "${fmt}" == *Config.Image* ]]; then echo "${FAKE_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.143}"; fi
    exit 0 ;;
  exec)
    sql=""; while [[ $# -gt 0 ]]; do [[ "$1" == "-c" ]] && sql="$2"; shift; done
    echo "SQL: ${sql}" >> "${FAKE_LOG}"
    case "${sql}" in
      "select current_database()"*) echo "${FAKE_IDENTITY:-postgres|3}" ;;
      "comment on database"*) echo "COMMENT" ;;
    esac
    exit 0 ;;
esac
exit 0
SHIM
chmod +x "${work}/docker"

pass=0; fail=0
ok()   { pass=$((pass+1)); echo "  ok   - $1"; }
bad()  { fail=$((fail+1)); echo "  FAIL - $1"; }

# run <label> <expected-exit> <expected-output-regex|-> <forbidden-output-regex|-> -- <env assignments...> -- <command...>
run() {
  local label="$1" want="$2" must="$3" never="$4"; shift 5
  local -a envs=(); while [[ "$1" != "--" ]]; do envs+=("$1"); shift; done; shift
  : > "${log}"
  local out code
  out="$(env -i PATH="${work}:${PATH}" HOME="${HOME:-/tmp}" FAKE_LOG="${log}" PGPASSWORD=SENTINEL_PASSWORD POSTGRES_PASSWORD=SENTINEL_PASSWORD "${envs[@]}" bash -c "$*" 2>&1)"
  code=$?
  local good=1
  [[ "${code}" -eq "${want}" ]] || good=0
  [[ "${must}" == "-" || "${out}" =~ ${must} ]] || good=0
  [[ "${never}" == "-" || ! "${out}" =~ ${never} ]] || good=0
  [[ "${out}" != *SENTINEL_PASSWORD* ]] || good=0   # never print a credential, ever
  if [[ "${good}" -eq 1 ]]; then ok "${label}"; else bad "${label} (exit ${code}, wanted ${want}) :: ${out}"; fi
}

REQ="source '${helper}'; db_target_require; echo resolved=\${db_container}"
RUNNING_ONE="supabase_db_aladdin_nom1"
LABELS_ONE="supabase_db_aladdin_nom1=aladdin_nom1"

echo "db_target.sh target selection"
run "no DB_CONTAINER is refused (no auto-selection) and the running stacks are only listed" 2 "DB_CONTAINER is not set.*supabase_db_aladdin_nom1" "resolved=" -- FAKE_RUNNING="supabase_db_aladdin_nom1 supabase_db_aladdin_sr2" -- "${REQ}"
if ! grep -q "SQL:" "${log}"; then ok "refusal ran no SQL"; else bad "refusal ran SQL"; fi
run "a connection string is refused and its password is never echoed" 2 "must be a local Supabase CLI database container name" "secret|resolved=" -- DB_CONTAINER="postgresql://postgres:secret@db.abc.supabase.co:5432/postgres" -- "${REQ}"
run "a hosted-looking host is refused" 2 "must be a local" "resolved=" -- DB_CONTAINER="db.kkpkgjrweysgvhvkhzun.supabase.co" -- "${REQ}"
run "a path / extra argument is refused" 2 "must be a local" "resolved=" -- DB_CONTAINER="supabase_db_x/../y" -- "${REQ}"
run "a staging name is refused" 2 "staging/production" "resolved=" -- DB_CONTAINER="supabase_db_aladdin_staging" FAKE_RUNNING="supabase_db_aladdin_staging" FAKE_LABELS="supabase_db_aladdin_staging=aladdin_staging" -- "${REQ}"
run "a prod name is refused" 2 "staging/production" "resolved=" -- DB_CONTAINER="supabase_db_prod" FAKE_RUNNING="supabase_db_prod" FAKE_LABELS="supabase_db_prod=prod" -- "${REQ}"
run "a name merely containing 'prod' inside a word is NOT mistaken for production" 0 "resolved=supabase_db_aladdin_pr84_acceptance" "REFUSED" -- DB_CONTAINER="supabase_db_aladdin_pr84_acceptance" FAKE_RUNNING="supabase_db_aladdin_pr84_acceptance" FAKE_LABELS="supabase_db_aladdin_pr84_acceptance=aladdin_pr84_acceptance" -- "${REQ}"
run "the shared stack is refused by default" 2 "SHARED local stack" "resolved=" -- DB_CONTAINER="supabase_db_aladdin" FAKE_RUNNING="supabase_db_aladdin" FAKE_LABELS="supabase_db_aladdin=aladdin" -- "${REQ}"
run "the shared stack is accepted only with the explicit CI opt-in" 0 "resolved=supabase_db_aladdin" "REFUSED" -- DB_CONTAINER="supabase_db_aladdin" ALLOW_SHARED_STACK=1 FAKE_RUNNING="supabase_db_aladdin" FAKE_LABELS="supabase_db_aladdin=aladdin" -- "${REQ}"
run "a container that is not running is refused" 2 "found 0" "resolved=" -- DB_CONTAINER="supabase_db_aladdin_nom1" FAKE_RUNNING="supabase_db_aladdin_sr2" -- "${REQ}"
run "an ambiguous match is refused" 2 "found 2" "resolved=" -- DB_CONTAINER="${RUNNING_ONE}" FAKE_RUNNING="${RUNNING_ONE}" FAKE_AMBIGUOUS=1 FAKE_LABELS="${LABELS_ONE}" -- "${REQ}"
run "a prefix of another stack's name does not match (exact name only)" 2 "found 0" "resolved=" -- DB_CONTAINER="supabase_db_aladdin" ALLOW_SHARED_STACK=1 FAKE_RUNNING="supabase_db_aladdin_nom1" -- "${REQ}"
run "a label that disagrees with the name is refused" 2 "matching Supabase CLI project label" "resolved=" -- DB_CONTAINER="${RUNNING_ONE}" FAKE_RUNNING="${RUNNING_ONE}" FAKE_LABELS="${RUNNING_ONE}=some_other_project" -- "${REQ}"
run "a missing label (not a CLI stack) is refused" 2 "matching Supabase CLI project label" "resolved=" -- DB_CONTAINER="${RUNNING_ONE}" FAKE_RUNNING="${RUNNING_ONE}" -- "${REQ}"
run "a non-supabase image is refused" 2 "not a supabase/postgres image" "resolved=" -- DB_CONTAINER="${RUNNING_ONE}" FAKE_RUNNING="${RUNNING_ONE}" FAKE_LABELS="${LABELS_ONE}" FAKE_IMAGE="postgres:16" -- "${REQ}"
run "a database without the Aladdin schemas is refused" 2 "did not answer as the expected Aladdin database" "resolved=" -- DB_CONTAINER="${RUNNING_ONE}" FAKE_RUNNING="${RUNNING_ONE}" FAKE_LABELS="${LABELS_ONE}" FAKE_IDENTITY="postgres|1" -- "${REQ}"
run "a remote Docker daemon is refused before anything is contacted" 2 "non-local daemon" "resolved=" -- DOCKER_HOST="tcp://10.0.0.5:2375" DB_CONTAINER="${RUNNING_ONE}" FAKE_RUNNING="${RUNNING_ONE}" FAKE_LABELS="${LABELS_ONE}" -- "${REQ}"
if [[ ! -s "${log}" ]]; then ok "remote-daemon refusal made no docker call"; else bad "remote-daemon refusal still called docker"; fi
run "an ssh Docker daemon is refused" 2 "non-local daemon" "resolved=" -- DOCKER_HOST="ssh://root@prod-host" DB_CONTAINER="${RUNNING_ONE}" FAKE_RUNNING="${RUNNING_ONE}" FAKE_LABELS="${LABELS_ONE}" -- "${REQ}"
run "a valid isolated target resolves, prints the target (no credentials) and runs only a SELECT" 0 "\[db-target\] container=supabase_db_aladdin_nom1 project=aladdin_nom1 image=postgres:17" "SENTINEL|REFUSED" -- DB_CONTAINER="${RUNNING_ONE}" FAKE_RUNNING="${RUNNING_ONE} supabase_db_aladdin_sr2" FAKE_LABELS="${LABELS_ONE}" -- "${REQ}"
if grep -E "^SQL:" "${log}" | grep -viE "^SQL: select current_database" | grep -q .; then bad "validation wrote or ran something other than the identity SELECT"; else ok "validation ran only the identity SELECT"; fi
run "direct 'check' mode validates read-only" 0 "OK \(validation only" "REFUSED" -- DB_CONTAINER="${RUNNING_ONE}" FAKE_RUNNING="${RUNNING_ONE}" FAKE_LABELS="${LABELS_ONE}" -- "bash '${helper}' check"

echo "db_target_mark_dirty"
run "marking needs a validated target first" 2 "db_target_require must run" "COMMENT" -- -- "source '${helper}'; db_target_mark_dirty x"
run "marking writes exactly one database comment and sanitises the script name" 0 "marked 'supabase_db_aladdin_nom1'" "REFUSED" -- DB_CONTAINER="${RUNNING_ONE}" FAKE_RUNNING="${RUNNING_ONE}" FAKE_LABELS="${LABELS_ONE}" -- "source '${helper}'; db_target_require; db_target_mark_dirty \"x'; drop table y; --\""
if [[ "$(grep -c '^SQL: comment on database' "${log}")" -eq 1 ]] && ! grep -q "drop table" "${log}" && grep -q "aladdin-test-dirty: x___drop_table_y__--" "${log}"; then ok "marker SQL is a single sanitised COMMENT ON DATABASE"; else bad "marker SQL unexpected: $(grep '^SQL:' "${log}")"; fi

echo "destructive scripts are wired to the helper"
destructive=(account_approval admin_suspension customer_update follow_up_update governance installer_phone_change last_owner lead_ownership lead_transition organization_application publisher quotation)
dirtying=(account_approval admin_suspension customer_update follow_up_update governance last_owner lead_ownership lead_transition organization_application publisher quotation)
for name in "${destructive[@]}"; do
  script="${tests_dir}/${name}_concurrency_test.sh"
  run "${name}: refuses to start without an explicit target and touches nothing" 2 "(DB_CONTAINER is not set|usage:)" "resolved=" -- FAKE_RUNNING="supabase_db_aladdin_nom1 supabase_db_aladdin_sr2" FAKE_LABELS="supabase_db_aladdin_nom1=aladdin_nom1" -- "bash '${script}'"
  if ! grep -q "^SQL:" "${log}"; then ok "${name}: no SQL ran without a target"; else bad "${name}: ran SQL without a target"; fi
  if grep -q "head -n 1" "${script}"; then bad "${name}: still auto-selects with head -n 1"; else ok "${name}: no first-match selection left"; fi
  req_line="$(grep -n 'db_target_require' "${script}" | head -1 | cut -d: -f1)"
  first_use="$(grep -n 'docker exec\|psql_db\|psql_run' "${script}" | grep -v '^[0-9]*:#' | grep -v 'psql_db()\|psql_run()' | head -1 | cut -d: -f1)"
  if [[ -n "${req_line}" && ( -z "${first_use}" || "${req_line}" -lt "${first_use}" ) ]]; then ok "${name}: validates the target before its first database use"; else bad "${name}: first database use precedes validation (${req_line} vs ${first_use})"; fi
  dirty_line="$(grep -n 'db_target_mark_dirty' "${script}" | head -1 | cut -d: -f1)"
  expect_dirty=0; for d in "${dirtying[@]}"; do [[ "${d}" == "${name}" ]] && expect_dirty=1; done
  if [[ "${expect_dirty}" -eq 1 ]]; then
    if [[ -n "${dirty_line}" && -n "${req_line}" && "${dirty_line}" -gt "${req_line}" && ( -z "${first_use}" || "${dirty_line}" -lt "${first_use}" ) ]]; then ok "${name}: marks the database as mutated before its first write"; else bad "${name}: missing or late dirty marker"; fi
  else
    if [[ -z "${dirty_line}" ]]; then ok "${name}: self-cleaning, deliberately not marked"; else bad "${name}: unexpectedly marks the database"; fi
  fi
done
run "admin_suspension: still refuses the shared stack even with the CI opt-in" 2 "Refusing to run against the shared local stack" "resolved=" -- ALLOW_SHARED_STACK=1 FAKE_RUNNING="supabase_db_aladdin" -- "bash '${tests_dir}/admin_suspension_concurrency_test.sh' supabase_db_aladdin"

echo
echo "passed=${pass} failed=${fail}"
[[ "${fail}" -eq 0 ]]
