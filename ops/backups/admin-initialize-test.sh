#!/usr/bin/env bash
# Offline test for admin-initialize.sh. curl is a shim that serves canned RPC answers and records the calls; no network,
# no real key. Proves: preflight never writes, wrong project/key/phrase/actor stop before any call, idempotency, mismatch refusal.
#   bash ops/backups/admin-initialize-test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT; mkdir -p "$T/bin"
cat > "$T/bin/curl" <<'SH'
#!/usr/bin/env bash
fn=""; for a in "$@"; do case "$a" in */rpc/*) fn="${a##*/rpc/}";; esac; done
echo "$fn" >> "$CALLS"
case "$fn" in
  backup_schedule_read) cat "$STATE";;
  admin_backup_initialize) [ "${REFUSE:-0}" = 1 ] && exit 22; echo '{"initialized":true,"environment":"acceptance","acceptance_schedule":"off","production_enabled":false,"version":0}' > "$STATE"; echo '"acceptance"';;
  *) exit 97;;
esac
SH
chmod +x "$T/bin/curl"
pass=0; fail=0; ok() { if [ "$1" -eq 0 ]; then pass=$((pass+1)); echo "PASS  $2"; else fail=$((fail+1)); echo "FAIL  $2"; fi; }
export CALLS="$T/calls" STATE="$T/state"
ACC=nxossqhdfltcqdwvbewi; PROD=kkpkgjrweysgvhvkhzun; ACTOR=11111111-2222-3333-4444-555555555555
NOTINIT='{"initialized":false,"environment":null,"acceptance_schedule":"off","production_enabled":false,"version":0}'
run() { : > "$CALLS"; env -i PATH="$T/bin:/usr/bin:/bin" CALLS="$CALLS" STATE="$STATE" REFUSE="${REFUSE:-0}" "$@" > "$T/out" 2>&1; echo $? > "$T/rc"; }
rc() { cat "$T/rc"; }; calls() { wc -l < "$CALLS" | tr -d " "; }
base=(BACKUP_LABEL=acceptance "SUPABASE_URL=https://$ACC.supabase.co" SUPABASE_SERVICE_ROLE_KEY=sb_secret_dummy)
S="bash $HERE/admin-initialize.sh"

echo "$NOTINIT" > "$STATE"
run "${base[@]}" $S;
if [ "$(rc)" = 0 ] && grep -q "NOT INITIALIZED" "$T/out" && [ "$(calls)" = 1 ] && ! grep -qx admin_backup_initialize "$CALLS"; then ok 0 "preflight: one read, no write"; else ok 1 "preflight: one read, no write"; fi
run "${base[@]}" CONFIRM="initialize acceptance" ACTOR_USER_ID=$ACTOR $S;
if [ "$(grep -c admin_backup_initialize "$CALLS")" = 0 ]; then ok 0 "preflight ignores CONFIRM and ACTOR (writes only with --apply)"; else ok 1 "preflight ignores CONFIRM and ACTOR (writes only with --apply)"; fi
run BACKUP_LABEL=acceptance SUPABASE_URL=https://$PROD.supabase.co SUPABASE_SERVICE_ROLE_KEY=x $S --apply;
if [ "$(rc)" != 0 ] && [ "$(calls)" = 0 ] && grep -q "not the acceptance project" "$T/out"; then ok 0 "Production URL with acceptance label: refused before any call"; else ok 1 "Production URL with acceptance label: refused before any call"; fi
run BACKUP_LABEL=production SUPABASE_URL=https://$ACC.supabase.co SUPABASE_SERVICE_ROLE_KEY=x $S;
if [ "$(rc)" != 0 ] && [ "$(calls)" = 0 ]; then ok 0 "Acceptance URL with production label: refused before any call"; else ok 1 "Acceptance URL with production label: refused before any call"; fi
run "${base[@]}" $S --apply;
if [ "$(rc)" != 0 ] && [ "$(grep -c admin_backup_initialize "$CALLS")" = 0 ] && grep -q "CONFIRM" "$T/out"; then ok 0 "--apply without the typed phrase: no write"; else ok 1 "--apply without the typed phrase: no write"; fi
run "${base[@]}" CONFIRM="initialize production" ACTOR_USER_ID=$ACTOR $S --apply;
if [ "$(rc)" != 0 ] && [ "$(grep -c admin_backup_initialize "$CALLS")" = 0 ]; then ok 0 "--apply with the other environment's phrase: no write"; else ok 1 "--apply with the other environment's phrase: no write"; fi
run "${base[@]}" CONFIRM="initialize acceptance" ACTOR_USER_ID=not-a-uuid $S --apply;
if [ "$(rc)" != 0 ] && [ "$(grep -c admin_backup_initialize "$CALLS")" = 0 ]; then ok 0 "--apply with a bad actor id: no write"; else ok 1 "--apply with a bad actor id: no write"; fi
REFUSE=1 run "${base[@]}" CONFIRM="initialize acceptance" ACTOR_USER_ID=$ACTOR $S --apply;
if [ "$(rc)" != 0 ] && grep -q "refused" "$T/out"; then ok 0 "database refuses the actor (not a super admin): reported, exit non-zero"; else ok 1 "database refuses the actor (not a super admin): reported, exit non-zero"; fi
echo "$NOTINIT" > "$STATE"
run "${base[@]}" CONFIRM="initialize acceptance" ACTOR_USER_ID=$ACTOR $S --apply;
if [ "$(rc)" = 0 ] && grep -q "RESULT: INITIALIZED as acceptance" "$T/out" && [ "$(grep -c admin_backup_initialize "$CALLS")" = 1 ]; then ok 0 "--apply with GO phrase and actor: exactly one write, read back"; else ok 1 "--apply with GO phrase and actor: exactly one write, read back"; fi
run "${base[@]}" CONFIRM="initialize acceptance" ACTOR_USER_ID=$ACTOR $S --apply;
if [ "$(rc)" = 0 ] && [ "$(grep -c admin_backup_initialize "$CALLS")" = 0 ] && grep -q "ALREADY INITIALIZED" "$T/out"; then ok 0 "second --apply is idempotent: no write"; else ok 1 "second --apply is idempotent: no write"; fi
echo '{"initialized":true,"environment":"production","acceptance_schedule":"off","production_enabled":false,"version":0}' > "$STATE"
run "${base[@]}" CONFIRM="initialize acceptance" ACTOR_USER_ID=$ACTOR $S --apply;
if [ "$(rc)" != 0 ] && [ "$(grep -c admin_backup_initialize "$CALLS")" = 0 ] && grep -q "refusing" "$T/out"; then ok 0 "bound to the other environment: refused, no write"; else ok 1 "bound to the other environment: refused, no write"; fi
if ! grep -q "sb_secret_dummy" "$T/out"; then ok 0 "the key never reaches the output"; else ok 1 "the key never reaches the output"; fi
echo "admin-initialize-test: $pass passed, $fail failed"; [ "$fail" -eq 0 ]
