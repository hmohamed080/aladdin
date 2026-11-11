#!/usr/bin/env bash
# LOCAL-ONLY proof harness for the audit_log username redaction draft. Refuses to run against anything but a local
# Supabase CLI database container (supabase_db_*). Never touches a hosted project.
# Usage: run-audit-redaction-proof.sh [container]   (default supabase_db_aladdin)
# NOTE: stage 3c COMMITS the draft on the local database (it holds no username rows locally); only use a throwaway stack.
set -euo pipefail
cd "$(dirname "$0")"
C="${1:-supabase_db_aladdin}"
case "$C" in supabase_db_*) ;; *) echo "refusing: $C is not a local supabase_db_* container" >&2; exit 2;; esac
[ "$(docker inspect -f '{{.State.Running}}' "$C")" = true ] || { echo "container not running" >&2; exit 2; }
psql_() { docker exec -i "$C" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
DRAFT=DRAFT_audit_log_username_redaction.sql
HELD="$(mktemp)"
build() { awk -v inc="$2" '{ if ($0 ~ /^-- @@INCLUDE_/) { while ((getline l < inc) > 0) print l; close(inc) } else print }' "$1"; }
# held variant = draft steps 1-2 only (narrow guard installed, token set), then close the DO block
awk '/^  -- 3\. The redaction itself\./{exit} {print}' "$DRAFT" > "$HELD"
printf '  null;\nend;\n$redact$;\n' >> "$HELD"
GUARD_MD5="select 'guard md5: ' || md5(prosrc) from pg_proc where oid='app.guard_audit_actor_deletion()'::regprocedure"
TOKEN="select 'token in a new session: [' || coalesce(current_setting('app.audit_redaction', true), 'NULL') || ']'"

echo "== 1. migration proof (pgTAP, one transaction, ROLLBACK)"
build DRAFT_audit_log_username_redaction_test.sql "$DRAFT" | psql_ -At
echo "== 2. narrow guard while installed (pgTAP, ROLLBACK)"
build DRAFT_audit_log_username_redaction_held_test.sql "$HELD" | psql_ -At
echo "== 3. (e) the token does not persist outside its transaction"
psql_ -At <<'SQL'
begin;
select set_config('app.audit_redaction', 'profile.username_set:remove-username:v1', true);
select 'in-tx token: ' || current_setting('app.audit_redaction', true);
commit;
select 'same session after commit: [' || coalesce(current_setting('app.audit_redaction', true), 'NULL') || ']';
SQL
psql_ -At -c "$TOKEN"
echo "== 3b. the draft in a transaction that is ROLLED BACK leaves the original guard"
{ echo "begin;"; cat "$DRAFT"; echo "rollback;"; } | psql_ -At
psql_ -At -c "$GUARD_MD5"; psql_ -At -c "$TOKEN"
echo "== 3c. the draft COMMITTED twice (idempotent; no username rows exist locally)"
for i in 1 2; do { echo "begin;"; cat "$DRAFT"; echo "commit;"; } | psql_ -At 2>&1; done
psql_ -At -c "$GUARD_MD5"; psql_ -At -c "$TOKEN"
echo "== 3d. after the committed run the redaction shape is still blocked (rolled-back insert)"
psql_ -At <<'SQL' 2>&1 || true
begin;
insert into public.audit_log (action, subject_type, metadata) values ('profile.username_set','user','{"username":"synthetic"}');
set local app.audit_redaction = 'profile.username_set:remove-username:v1';
update public.audit_log set metadata = metadata - 'username' where action='profile.username_set';
rollback;
SQL
rm -f "$HELD"
echo "done"
