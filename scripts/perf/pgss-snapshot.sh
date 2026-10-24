#!/usr/bin/env bash
# Snapshot extensions.pg_stat_statements from the LOCAL DB into a TSV (never resets it:
# the stack is shared). Diff two snapshots with pgss-diff.py.
#   scripts/perf/pgss-snapshot.sh /tmp/pgss-before.tsv
set -euo pipefail
DB="${E2E_DB_CONTAINER:-supabase_db_aladdin}"
docker exec -i "$DB" psql -U postgres -d postgres -tA -F $'\t' -c "
  select queryid, r.rolname, calls, round(total_exec_time::numeric, 3), rows, shared_blks_hit, shared_blks_read,
         regexp_replace(left(query, 160), '\s+', ' ', 'g')
  from extensions.pg_stat_statements s join pg_roles r on r.oid = s.userid" > "$1"
wc -l < "$1"
