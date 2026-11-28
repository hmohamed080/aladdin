#!/usr/bin/env bash
# Mandatory, explicit database target for every DESTRUCTIVE local test script (concurrency scripts etc.).
#
# WHY: these scripts COMMIT data (and some change seed rows that pgTAP relies on). They used to pick
# `docker ps --filter name=supabase_db_aladdin | head -n 1`, which with several local Supabase stacks silently
# selects an arbitrary one. This helper replaces that with a target the caller must NAME, then refuses anything
# ambiguous, shared, remote or not recognisably a local Supabase CLI database. It never starts, stops or resets
# anything, and never prints a password, connection string or token.
#
# USAGE (from a script that has `set -euo pipefail`):
#   source "$(dirname "${BASH_SOURCE[0]}")/lib/db_target.sh"
#   db_target_require            # validates DB_CONTAINER, prints the resolved target, sets $db_container
#   db_target_mark_dirty "$(basename "$0")"   # ONLY scripts that change seed/shared rows: before the first write
#
# CLI (read-only, safe anywhere):  DB_CONTAINER=<name> bash supabase/tests/lib/db_target.sh check
#
# Contract (each refusal exits 2, nothing is written):
#   1. DOCKER_HOST, if set, must be a LOCAL unix socket / named pipe (never tcp:// or ssh:// - that could be any machine).
#   2. DB_CONTAINER must be set. There is no default and no auto-selection.
#   3. It must look like a local Supabase CLI database container name (supabase_db_<project>): no URL, host, '/', ':' or '@'.
#   4. A name containing staging / prod / production is refused outright (shared environments).
#   5. The default shared stack `supabase_db_aladdin` is refused unless ALLOW_SHARED_STACK=1 (CI's throwaway runner sets it).
#   6. Exactly ONE running container must match the name exactly.
#   7. Its Supabase CLI label must agree with its name, and its image must be supabase/postgres.
#   8. It must answer as database `postgres` and carry the auth, app and public schemas.

# Git Bash on Windows rewrites arguments that look like POSIX paths (e.g. the `^/name$` docker filter); turn that off.
export MSYS_NO_PATHCONV=1

_dbt_fail() {
  echo "[db-target] REFUSED: $*" >&2
  echo "[db-target] Nothing was run. See supabase/tests/README.md (\"Safe invocation\")." >&2
  exit 2
}

_dbt_psql() { docker exec -i "$1" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "$2"; }

db_target_require() {
  # 1. Only a local Docker daemon.
  if [[ -n "${DOCKER_HOST:-}" && ! "${DOCKER_HOST}" =~ ^(unix://|npipe://) ]]; then
    _dbt_fail "DOCKER_HOST points at a non-local daemon; refusing to run destructive tests through it."
  fi

  # 2. Explicit target only.
  local name="${DB_CONTAINER:-}"
  if [[ -z "${name}" ]]; then
    local candidates
    candidates="$(docker ps --filter 'name=^/supabase_db_' --format '{{.Names}}' 2>/dev/null | tr '\n' ' ' || true)"
    _dbt_fail "DB_CONTAINER is not set. Name the ISOLATED stack's database container explicitly (running now: ${candidates:-none found})."
  fi

  # 3-4. Shape, and no shared environments.
  if [[ ${#name} -gt 100 || ! "${name}" =~ ^supabase_db_[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]; then
    _dbt_fail "DB_CONTAINER must be a local Supabase CLI database container name like supabase_db_<project>; connection strings, hosts and paths are not accepted."
  fi
  if [[ "${name,,}" =~ (^|[_.-])(staging|prod|production)([_.-]|$) ]]; then
    _dbt_fail "'${name}' looks like a shared staging/production environment."
  fi

  # 5. The shared dev/CI stack needs an explicit opt-in.
  if [[ "${name}" == "supabase_db_aladdin" && "${ALLOW_SHARED_STACK:-}" != "1" ]]; then
    _dbt_fail "supabase_db_aladdin is the SHARED local stack. Use an isolated stack, or set ALLOW_SHARED_STACK=1 (only on a throwaway CI runner)."
  fi

  # 6. Exactly one running container with exactly this name.
  local matches count
  matches="$(docker ps --filter "name=^/${name}\$" --format '{{.Names}}' 2>/dev/null || true)"
  count="$(printf '%s\n' "${matches}" | grep -c . || true)"
  if [[ "${count}" -ne 1 || "$(printf '%s' "${matches}")" != "${name}" ]]; then
    _dbt_fail "expected exactly one running container named '${name}', found ${count}."
  fi

  # 7. It really is that CLI project's database.
  local label image
  label="$(docker inspect --format '{{ index .Config.Labels "com.supabase.cli.project" }}' "${name}" 2>/dev/null || true)"
  image="$(docker inspect --format '{{.Config.Image}}' "${name}" 2>/dev/null || true)"
  if [[ -z "${label}" || "supabase_db_${label}" != "${name}" ]]; then
    _dbt_fail "'${name}' does not carry a matching Supabase CLI project label; not a recognised local stack."
  fi
  if [[ "${image}" != *supabase/postgres* ]]; then
    _dbt_fail "'${name}' is not a supabase/postgres image."
  fi

  # 8. The database inside answers as the Aladdin schema set.
  local identity
  identity="$(_dbt_psql "${name}" "select current_database() || '|' || (select count(*) from pg_namespace where nspname in ('auth','app','public'))" 2>/dev/null || true)"
  if [[ "${identity}" != "postgres|3" ]]; then
    _dbt_fail "'${name}' did not answer as the expected Aladdin database (got '${identity:-no answer}')."
  fi

  # 9. Show what will be touched (names only - never a password, URL or token).
  echo "[db-target] container=${name} project=${label} image=${image##*/} database=postgres" >&2
  db_container="${name}"
  export db_container
}

# Destructive scripts that change shared/seed rows call this BEFORE their first write. It records a marker on the
# database object itself (no migration, no table); the pgTAP guard `00_clean_database_guard_test.sql` then fails
# loudly until the database is rebuilt with `supabase db reset` (which recreates it and so clears the marker).
db_target_mark_dirty() {
  [[ -n "${db_container:-}" ]] || _dbt_fail "db_target_require must run before db_target_mark_dirty."
  local who="${1:-unknown}"
  who="${who//[^A-Za-z0-9_.-]/_}"
  _dbt_psql "${db_container}" "comment on database postgres is 'aladdin-test-dirty: ${who} $(date -u +%Y-%m-%dT%H:%M:%SZ)'" >/dev/null
  echo "[db-target] marked '${db_container}' as mutated by ${who}; run 'supabase db reset' before pgTAP (the 00_clean_database_guard test enforces this)." >&2
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  # Executed directly: read-only validation.
  set -euo pipefail
  case "${1:-check}" in
    check) db_target_require; echo "[db-target] OK (validation only; nothing was written)." >&2 ;;
    *) echo "usage: DB_CONTAINER=<name> $0 check" >&2; exit 2 ;;
  esac
fi
