#!/usr/bin/env bash
# Load test for public.media_edge_video (the per-request authorization the media Worker
# runs for every HLS playlist and segment). LOCAL stack only: runs pgbench inside the
# local Supabase DB container, as the media_edge role, with prepared statements (the
# Worker's postgres.js driver also uses the extended protocol).
#
#   docker exec -i supabase_db_aladdin psql -U postgres -v ON_ERROR_STOP=1 < scripts/perf/segment-auth-fixture.sql
#   scripts/perf/segment-auth-loadtest.sh [seconds] [concurrency list] [cases]
#   docker exec -i supabase_db_aladdin psql -U postgres -v ON_ERROR_STOP=1 < scripts/perf/segment-auth-cleanup.sql
#
# Prints one CSV row per case x concurrency: case,clients,tps,p50_ms,p95_ms,p99_ms,max_ms,failed,load1.
set -euo pipefail
DB="${E2E_DB_CONTAINER:-supabase_db_aladdin}"
SECS="${1:-30}"
LEVELS="${2:-1 5 10 20}"
CASES="${3:-anon owner product}"
HERE="$(cd "$(dirname "$0")" && pwd)"
echo "case,clients,tps,p50_ms,p95_ms,p99_ms,max_ms,failed,load1"
for c in $CASES; do
  docker exec -i "$DB" sh -c "cat > /tmp/segauth-$c.sql" < "$HERE/segment-auth-$c.pgbench"
  for n in $LEVELS; do
    j=$(( n < 4 ? n : 4 ))
    docker exec "$DB" sh -c "rm -f /tmp/segauth_log*"
    out=$(docker exec -e PGOPTIONS='-c role=media_edge' "$DB" sh -c \
      "cd /tmp && pgbench -U postgres -d postgres -n -M prepared -c $n -j $j -T $SECS -l --log-prefix=segauth_log -f /tmp/segauth-$c.sql 2>&1")
    load1=$(cut -d' ' -f1 /proc/loadavg)
    tps=$(grep -oP 'tps = \K[0-9.]+' <<<"$out" | head -1)
    failed=$(grep -oP 'number of failed transactions: \K[0-9]+' <<<"$out" || echo 0)
    # Column 3 of a pgbench transaction log line is the latency in microseconds.
    stats=$(docker exec "$DB" sh -c "cat /tmp/segauth_log*" | awk '{print $3}' | sort -n | awk '
      {a[NR]=$1} END {n=NR;
        printf "%.2f,%.2f,%.2f,%.2f", a[int(n*0.50)]/1000, a[int(n*0.95)]/1000, a[int(n*0.99)]/1000, a[n]/1000}')
    echo "$c,$n,$tps,$stats,$failed,$load1"
  done
done
docker exec "$DB" sh -c "rm -f /tmp/segauth_log* /tmp/segauth-*.sql"
