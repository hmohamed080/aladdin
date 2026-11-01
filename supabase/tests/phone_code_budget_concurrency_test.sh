#!/usr/bin/env bash
set -euo pipefail

# Real concurrency proof for the WhatsApp send budget (20261101090001): N parallel
# phone_challenge_issue calls against a limit of K must insert exactly K rows.
source "$(dirname "${BASH_SOURCE[0]}")/lib/db_target.sh"
db_target_require
psql_run() { docker exec -i "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At "$@"; }

total=12
limit=5
run="$(python3 -c 'import uuid;print(uuid.uuid4().hex[:8])')"
phone="+2010${RANDOM}${RANDOM}"; phone="${phone:0:13}"

cleanup() { psql_run >/dev/null -c "delete from public.phone_verification_challenges where phone_e164 like '+2010%' and created_at > now() - interval '5 minutes';" || true; rm -f "${out}"; }
out="$(mktemp)"; trap cleanup EXIT
psql_run >/dev/null -c "delete from public.phone_verification_challenges;"

for i in $(seq 1 "${total}"); do
  (
    id="$(python3 -c 'import uuid;print(uuid.uuid4())')"
    n="+20101$(printf '%07d' "${i}")"
    psql_run -c "set role service_role; select public.phone_challenge_issue('${id}', '${n}', repeat('a', 64), now() + interval '5 minutes', 5, ${limit});" | tail -1 >>"${out}"
  ) &
done
wait

issued="$(grep -c '^issued$' "${out}" || true)"
refused="$(grep -c '^budget_exhausted$' "${out}" || true)"
rows="$(psql_run -c "select count(*) from public.phone_verification_challenges;" | tr -d '[:space:]')"
echo "issued=${issued} refused=${refused} rows=${rows} (limit ${limit}, ${total} parallel)"
if [[ "${issued}" != "${limit}" || "${rows}" != "${limit}" || "${refused}" != "$((total - limit))" ]]; then
  echo "FAIL: the daily budget was exceeded or miscounted under concurrency" >&2; cat "${out}" >&2; exit 1
fi
echo "PASS: the send budget holds under ${total} parallel requests"
