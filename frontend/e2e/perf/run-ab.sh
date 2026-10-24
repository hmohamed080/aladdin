#!/usr/bin/env bash
# Interleaved before/after lab run: for each page, measure AFTER then BEFORE back to back
# so both builds see the same background CPU load (the machine is shared).
#   AFTER=http://127.0.0.1:3306 BEFORE=http://127.0.0.1:3307 RUNS=5 OUT=/tmp/cwv e2e/perf/run-ab.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${OUT:-/tmp/cwv}"; RUNS="${RUNS:-5}"
mkdir -p "$OUT"
for p in ${PAGES:-landing auth home showroom showroom-product public-profile admin b2b marketplace}; do
  for side in after before; do
    base=$([ "$side" = after ] && echo "${AFTER:-http://127.0.0.1:3306}" || echo "${BEFORE:-http://127.0.0.1:3307}")
    E2E_STUB_TURNSTILE=1 node e2e/perf/web-vitals.mjs --base "$base" --label "$side" --runs "$RUNS" --pages "$p" --out "$OUT/$side-$p.json"
  done
done
