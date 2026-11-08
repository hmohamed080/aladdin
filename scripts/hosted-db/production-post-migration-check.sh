#!/usr/bin/env bash
# READ-ONLY on Production. Run after the 26 baseline migrations were pushed to Production (kkpkgjrweysgvhvkhzun).
# It checks the migration history (191 versions, latest 20261024090011, nothing extra) and compares the live
# schema fingerprint with the tested 191-migration baseline. The only accepted difference is the one the rehearsal
# found: CRLF line endings in Production function bodies that otherwise equal the baseline. Output is counts,
# hashes and object names only (no row data). The password is read at a hidden prompt and never echoed.
#   bash scripts/hosted-db/production-post-migration-check.sh
# Test mode (Claude, local only): POSTCHECK_DB_URL=postgresql://...@127.0.0.1:PORT/postgres
set -euo pipefail
export LC_ALL=C
PROD="kkpkgjrweysgvhvkhzun"; EXPECT_COUNT=191; EXPECT_LATEST="20261024090011"
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE/../.."
sb() { pnpm exec supabase "$@"; }
rows() { node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{const j=JSON.parse(b),r=Array.isArray(j)?j:j.rows;if(!Array.isArray(r)){console.error("query failed: "+b.slice(0,400));process.exit(1)}process.stdout.write(r.map(x=>'"$1"').join("\n")+"\n")})'; }
for f in schema-fingerprint.sql schema-detail.sql local-noseed-fingerprint.txt local-noseed-detail.txt; do [ -s "$HERE/$f" ] || { echo "missing $HERE/$f"; exit 1; }; done
OUT="${HOME}/aladdin-production-post-migration-$(date +%Y%m%d-%H%M%S)"; umask 077; mkdir -p "$OUT"
if [ -n "${POSTCHECK_DB_URL:-}" ]; then
  case "$POSTCHECK_DB_URL" in *@127.0.0.1:*) ;; *) echo "test mode only accepts a local database"; exit 1;; esac
  SRC=(--db-url "$POSTCHECK_DB_URL")
else
  read -r -s -p "Production database password (input hidden; only read access is used): " SUPABASE_DB_PASSWORD; echo
  export SUPABASE_DB_PASSWORD
  trap 'rm -rf supabase/.temp' EXIT                                  # always unlink again
  sb link --project-ref "$PROD" >/dev/null
  [ "$(cat supabase/.temp/project-ref)" = "$PROD" ] || { echo "not linked to Production: stopping"; exit 1; }
  SRC=(--linked)
fi
q() { sb db query "${SRC[@]}" -o json -f "$1"; }
echo "select version as t from supabase_migrations.schema_migrations order by 1;" > "$OUT/.h.sql"
q "$OUT/.h.sql" | rows 'x.t' > "$OUT/history.txt"
q "$HERE/schema-fingerprint.sql" | rows '`${x.k}|${x.h}|${x.len}`' > "$OUT/fingerprint.txt"
q "$HERE/schema-detail.sql" | rows 'x.t' > "$OUT/detail.txt"
unset SUPABASE_DB_PASSWORD
ls supabase/migrations/*.sql | sed 's#.*/##; s/_.*//' | sort > "$OUT/repo-versions.txt"
fails=()
[ "$(wc -l < "$OUT/history.txt" | tr -d ' ')" = "$EXPECT_COUNT" ] || fails+=("history has $(wc -l < "$OUT/history.txt" | tr -d ' ') versions, expected $EXPECT_COUNT")
[ "$(tail -1 "$OUT/history.txt")" = "$EXPECT_LATEST" ] || fails+=("latest version is $(tail -1 "$OUT/history.txt"), expected $EXPECT_LATEST")
cmp -s "$OUT/history.txt" "$OUT/repo-versions.txt" || fails+=("history differs from the repository's migration files")
# Same rule as the rehearsal: a function that differs only by CRs in its body, every other field equal.
diff <(sort "$HERE/local-noseed-detail.txt") <(sort "$OUT/detail.txt") | grep '^[<>]' > "$OUT/detail-diff.txt" || true
awk -F'|' -v OFS='|' '
  { side = substr($1,1,1); sub(/^[<>] /, "", $1); k = $1 "|" $2; seen[k] = 1
    if ($1 == "function") { b = substr($3,6); lf = substr($4,9); $3 = ""; $4 = ""; norm = $0 } else { b = ""; lf = ""; norm = $0 }
    if (side == "<") { bl[k] = norm; bb[k] = b; blf[k] = lf } else { af[k] = norm; ab[k] = b; alf[k] = lf } }
  END { bad = 0; for (k in seen) { split(k, f, "|")
          if (f[1] == "function" && (k in bl) && (k in af) && bl[k] == af[k] && bb[k] == blf[k] && alf[k] == bb[k] && ab[k] != alf[k]) print "crlf " f[2]
          else { print "other " k; bad = 1 } }
        exit bad }' "$OUT/detail-diff.txt" | sort > "$OUT/detail-classified.txt" || fails+=("schema objects differ from the tested baseline (detail-classified.txt)")
OTHER="$(diff <(grep -v '^seeded_rowcounts|' "$HERE/local-noseed-fingerprint.txt" | sort) <(grep -v '^seeded_rowcounts|' "$OUT/fingerprint.txt" | sort) | grep '^>' | cut -d'|' -f1 | sed 's/^> //' | grep -vx functions || true)"
[ -z "$OTHER" ] || fails+=("fingerprint categories differ: $(echo $OTHER)")
grep -q '^seeded_rowcounts|' "$OUT/fingerprint.txt" && [ "$(grep '^seeded_rowcounts|' "$OUT/fingerprint.txt")" = "$(grep '^seeded_rowcounts|' "$HERE/local-noseed-fingerprint.txt")" ] \
  || fails+=("reference-data row counts differ from the baseline")
{
  echo "Production post-migration check $(date -u +%FT%TZ)"
  echo "History: $(wc -l < "$OUT/history.txt" | tr -d ' ') versions, latest $(tail -1 "$OUT/history.txt")"
  echo "Functions differing only by CRLF line endings (already on Production before the push): $(grep -c '^crlf ' "$OUT/detail-classified.txt" || true)"
  sed -n 's/^crlf /  /p' "$OUT/detail-classified.txt"
  if [ ${#fails[@]} -eq 0 ]; then echo "RESULT: PASS. Production schema equals the tested 191-migration baseline."
  else echo "RESULT: FAIL"; printf '  - %s\n' "${fails[@]}"; grep '^other ' "$OUT/detail-classified.txt" | head -40 | sed 's/^other /  object: /'; fi
} | tee "$OUT/REPORT.txt"
[ ${#fails[@]} -eq 0 ]
