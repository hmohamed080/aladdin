#!/usr/bin/env bash
# Pre-activation negative test: an Acceptance run handed a Production-shaped database URL (dummy credentials), the
# wrong bucket, the wrong endpoint or the wrong Supabase URL must stop BEFORE any network access or backup write.
# Every tool that could reach a network or write (aws, psql, npx, curl, docker, age) is replaced by a shim that records
# the call; the test fails if any shim runs. No real secret, no hosted project, no Production credential is used.
#   bash ops/backups/target-guard-test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"
for tool in aws psql npx curl docker age pg_dump supabase wrangler; do
  printf '#!/usr/bin/env bash\necho "%s $*" >> "%s/calls.txt"\nexit 97\n' "$tool" "$T" > "$T/bin/$tool"; chmod +x "$T/bin/$tool"
done
pass=0; fail=0
ok() { if [ "$1" -eq 0 ]; then pass=$((pass+1)); echo "PASS  $2"; else fail=$((fail+1)); echo "FAIL  $2"; fi; }
PROD_REF=kkpkgjrweysgvhvkhzun; ACC_REF=nxossqhdfltcqdwvbewi
# A syntactically valid, Production-shaped URL with a dummy password (a made-up string, not a credential).
PROD_POOLER="postgresql://postgres.$PROD_REF:dummy-not-a-password@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"
PROD_DIRECT="postgresql://postgres:dummy-not-a-password@db.$PROD_REF.supabase.co:5432/postgres"
ACC_POOLER="postgresql://postgres.$ACC_REF:dummy-not-a-password@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"
TXN_POOLER="postgresql://postgres.$ACC_REF:dummy-not-a-password@aws-0-eu-west-1.pooler.supabase.com:6543/postgres"
ENDPOINT="https://a4c2b7ac45e58a81691b9165492ce6a2.r2.cloudflarestorage.com"
run() { # <name> <expected message> <script> <env assignments...>
  local name="$1" want="$2" script="$3"; shift 3
  : > "$T/calls.txt"
  env -i PATH="$T/bin:/usr/bin:/bin" HOME="$T" AGE_RECIPIENTS=age1dummy R2_ENDPOINT="$ENDPOINT" AWS_ACCESS_KEY_ID=dummy AWS_SECRET_ACCESS_KEY=dummy \
    BACKUP_STATE_DIR="$T/state" "$@" bash "$HERE/$script" > "$T/out.txt" 2>&1; local rc=$?
  [ "$rc" -ne 0 ] && grep -q "$want" "$T/out.txt" && [ ! -s "$T/calls.txt" ]; ok $? "$name (exit $rc, no tool ran: $(wc -l < "$T/calls.txt" | tr -d ' ') calls)"
  ! grep -q "dummy-not-a-password" "$T/out.txt"; ok $? "$name: the URL's password never reaches the output"
}
A="BACKUP_LABEL=acceptance BACKUP_BUCKET=aladdin-acceptance-backups-weur"
run "acceptance + Production pooler URL" "is not the acceptance project" db-backup.sh $A BACKUP_DB_URL="$PROD_POOLER"
run "acceptance + Production direct URL" "is not the acceptance project" db-backup.sh $A BACKUP_DB_URL="$PROD_DIRECT"
run "acceptance + transaction-pooler URL (6543)" "is not the acceptance project" db-backup.sh $A BACKUP_DB_URL="$TXN_POOLER"
run "acceptance + a local database URL" "hosted label cannot read a local database" db-backup.sh $A BACKUP_DB_URL="postgresql://postgres:dummy-not-a-password@127.0.0.1:54322/postgres"
run "acceptance + Production bucket" "must use its own bucket" db-backup.sh BACKUP_LABEL=acceptance BACKUP_BUCKET=aladdin-production-db-backups BACKUP_DB_URL="$ACC_POOLER"
run "acceptance + the old shared/ENAM bucket" "must use its own bucket" db-backup.sh BACKUP_LABEL=acceptance BACKUP_BUCKET=aladdin-acceptance-backups BACKUP_DB_URL="$ACC_POOLER"
run "acceptance + a non-R2 endpoint" "must go to R2" db-backup.sh BACKUP_LABEL=acceptance BACKUP_BUCKET=aladdin-acceptance-backups-weur R2_ENDPOINT=https://example.com BACKUP_DB_URL="$ACC_POOLER"
run "production label, switch off" "not activated" db-backup.sh BACKUP_LABEL=production BACKUP_BUCKET=aladdin-production-db-backups BACKUP_DB_URL="$PROD_POOLER"
run "production label + Acceptance URL, switch on" "is not the production project" db-backup.sh BACKUP_LABEL=production BACKUP_BUCKET=aladdin-production-db-backups PRODUCTION_BACKUP_ENABLED=true BACKUP_DB_URL="$ACC_POOLER"
run "r2 media step: acceptance + Production URL" "is not the acceptance project" r2-media-backup.sh $A BACKUP_DB_URL="$PROD_POOLER" \
  R2_SOURCE_ENDPOINT="$ENDPOINT" R2_SOURCE_BUCKET=aladdin-r2-acceptance-20261011-private R2_SOURCE_ACCESS_KEY_ID=other R2_SOURCE_SECRET_ACCESS_KEY=dummy
echo "target-guard-test: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
