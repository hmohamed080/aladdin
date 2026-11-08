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
ck "the pin is 2.119.0 (gotrue v2.197.0, storage-api v1.79.28: matches Acceptance)" grep -q '^RESTORE_SUPABASE_CLI_VERSION=2.119.0$' "$R"
ck "the mismatch guard still exists and exits 2" bash -c "grep -q 'STACK MISMATCH' '$R' && grep -A3 'STACK MISMATCH' '$R' | grep -q 'exit 2'"
ck "the guard compares the full column list, filtering only marker lines" bash -c "grep -o \"grep -v '^marker '\" '$R' | wc -l | grep -qx 2"
ck "the guard runs before any restore (step 3 precedes step 4)" bash -c "[ \$(grep -n 'STACK MISMATCH' '$R' | head -1 | cut -d: -f1) -lt \$(grep -n '^# 4. Restore' '$R' | cut -d: -f1) ]"
ck "the guard is not bypassable by an environment switch" bash -c "! grep -qiE 'SKIP_(STACK|COLUMN|GUARD)|IGNORE_MISMATCH' '$R'"
echo "restore-pin-test: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
