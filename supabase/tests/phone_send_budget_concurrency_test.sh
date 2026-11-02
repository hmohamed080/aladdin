#!/usr/bin/env bash
set -euo pipefail

# Real concurrency proof for the GLOBAL phone-verification send budget (20261102090001): N parallel phone_signup_start calls
# (distinct registrations, numbers and IP keys, so no per-account cap can interfere) against a budget of K must create exactly K
# challenges. The destructive guard in lib/db_target.sh refuses to run against anything but a disposable local stack.
source "$(dirname "${BASH_SOURCE[0]}")/lib/db_target.sh"
db_target_require
psql_run() { docker exec -i "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At "$@"; }

total=12
limit=5
out="$(mktemp)"
cleanup() {
  psql_run >/dev/null -c "delete from app.phone_verification_challenges where purpose = 'signup_proof'; update app.phone_verification_config set signup_enabled = false; update app.phone_verification_config set alias_guard_mode = 'off', enabled = false, daily_send_budget = 200;" || true
  rm -f "${out}"
}
trap cleanup EXIT

psql_run >/dev/null -c "delete from app.phone_verification_challenges where purpose = 'signup_proof'; update app.phone_verification_config set enabled = true, alias_guard_mode = 'observe'; update app.phone_verification_config set signup_enabled = true, daily_send_budget = ${limit};"

for i in $(seq 1 "${total}"); do
  (
    reg="$(python3 -c 'import uuid;print(uuid.uuid4())')"
    ch="$(python3 -c 'import uuid;print(uuid.uuid4())')"
    n="+20102$(printf '%07d' "${i}")"
    mac="$(python3 -c 'print("ab"*32)')"
    ip="$(python3 -c "import hashlib;print(hashlib.sha256(b'budget-ip-${i}').hexdigest())")"
    psql_run -c "set role service_role; select public.phone_signup_start('${reg}', '${n}', '${ch}', 'k2', '${mac}', '${ip}') ->> 'status';" | tail -1 >>"${out}"
  ) &
done
wait

created="$(grep -c '^challenge_created$' "${out}" || true)"
refused="$(grep -c '^unavailable$' "${out}" || true)"
rows="$(psql_run -c "select count(*) from app.phone_verification_challenges where purpose = 'signup_proof';" | tr -d '[:space:]')"
echo "created=${created} refused=${refused} rows=${rows} (budget ${limit}, ${total} parallel)"
if [[ "${created}" != "${limit}" || "${rows}" != "${limit}" || "${refused}" != "$((total - limit))" ]]; then
  echo "FAIL: the global send budget was exceeded or miscounted under concurrency" >&2; cat "${out}" >&2; exit 1
fi
echo "PASS: the send budget holds under ${total} parallel requests"
