#!/usr/bin/env bash
# Static guard for the restore test's local stack: the CLI is pinned to an exact version, that version is the one that
# matches the hosted Auth/Storage schema, and the strict compatibility guard (step 3) is intact: it compares every
# column, filters nothing but the marker lines, and exits non-zero on any difference.   bash ops/backups/restore-pin-test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; R="$HERE/restore-test.sh"
pass=0; fail=0
ck() { local d="$1"; shift; if "$@"; then pass=$((pass+1)); echo "PASS  $d"; else fail=$((fail+1)); echo "FAIL  $d"; fi; }
ck "the restore stack CLI is pinned to an exact version" grep -qE '^RESTORE_SUPABASE_CLI_VERSION=[0-9]+\.[0-9]+\.[0-9]+$' "$R"
ck "the default CLI uses that pinned version, never latest" grep -q 'supabase@\$RESTORE_SUPABASE_CLI_VERSION' "$R"
ck "the CLI pin is 2.122.1 (newest stable v2; the service images below are pinned explicitly on top of it)" grep -q '^RESTORE_SUPABASE_CLI_VERSION=2.122.1$' "$R"
ck "Storage is pinned to the version Acceptance reports (v1.89.13, migrations through 0079)" grep -q '^RESTORE_STORAGE_API_VERSION=v1.89.13$' "$R"
ck "Auth is pinned to gotrue v2.197.0 (migrations through 20260831180000)" grep -q '^RESTORE_GOTRUE_VERSION=v2.197.0$' "$R"
ck "Postgres is pinned to the image of the passing 2026-11-01 restore (17.11.0.002)" grep -q '^RESTORE_POSTGRES_VERSION=17.11.0.002$' "$R"
ck "no service pin is a floating tag" bash -c "! grep -E '^RESTORE_[A-Z_]+_VERSION=(latest|main|)$' '$R'"
ck "the pins are written to the stack's supabase/.temp/*-version files" bash -c "grep -q 'RESTORE_STORAGE_API_VERSION\" > \"\$R/supabase/.temp/storage-version' '$R' && grep -q 'RESTORE_GOTRUE_VERSION\" > \"\$R/supabase/.temp/gotrue-version' '$R' && grep -q 'RESTORE_POSTGRES_VERSION\" > \"\$R/supabase/.temp/postgres-version' '$R'"
ck "the pin files are written before the stack starts" bash -c "[ \$(grep -n 'supabase/.temp/storage-version' '$R' | head -1 | cut -d: -f1) -lt \$(grep -n '^sb start' '$R' | head -1 | cut -d: -f1) ]"
ck "the mismatch guard still exists and exits 2" bash -c "grep -q 'STACK MISMATCH' '$R' && grep -A3 'STACK MISMATCH' '$R' | grep -q 'exit 2'"
ck "the guard compares the full column list, filtering only marker lines" bash -c "grep -o \"grep -v '^marker '\" '$R' | wc -l | grep -qx 2"
ck "the guard runs before any restore (step 3 precedes step 4)" bash -c "[ \$(grep -n 'STACK MISMATCH' '$R' | head -1 | cut -d: -f1) -lt \$(grep -n '^# 4. Restore' '$R' | cut -d: -f1) ]"
ck "the guard is not bypassable by an environment switch" bash -c "! grep -qiE 'SKIP_(STACK|COLUMN|GUARD)|IGNORE_MISMATCH' '$R'"
echo "restore-pin-test: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
