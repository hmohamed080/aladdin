# shellcheck shell=bash disable=SC2034
# Sourced by tests: a throwaway local PostgreSQL (listens on 127.0.0.1 only) for the SQL the kit runs.
# start_pg sets PGURL (a psql connection string); stop_pg removes it. Touches nothing hosted. Needs PostgreSQL
# server binaries; run as root it drops to the `postgres` user, as a normal user it runs as that user.
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
start_pg() {
  [ -x "${PGBIN:-}/initdb" ] || { echo "SKIP: no PostgreSQL server binaries"; return 1; }
  PGROOT="$(mktemp -d)"; chmod 755 "$PGROOT"; PGPORT=54399
  local as=""; if [ "$(id -u)" = 0 ]; then chown postgres "$PGROOT"; as="runuser -u postgres --"; fi
  PG_AS="$as"
  $as "$PGBIN/initdb" -D "$PGROOT/d" -A trust -U postgres >/dev/null 2>&1 || return 1
  $as "$PGBIN/pg_ctl" -D "$PGROOT/d" -o "-c listen_addresses=127.0.0.1 -c unix_socket_directories=$PGROOT -c port=$PGPORT -c fsync=off" -l "$PGROOT/log" -w start >/dev/null 2>&1 || return 1
  PGURL="postgresql://postgres@127.0.0.1:$PGPORT/postgres"
}
stop_pg() { [ -n "${PGROOT:-}" ] || return 0; $PG_AS "$PGBIN/pg_ctl" -D "$PGROOT/d" -m immediate stop >/dev/null 2>&1; rm -rf "$PGROOT"; }
