#!/usr/bin/env bash
set -euo pipefail

# Real two-session proof for the one-open-additional-application rule. A user with an APPROVED
# organization fires two simultaneous "open + submit" sequences. The per-user advisory lock must
# serialise them: exactly one wins and creates the pending additional organization; the other is refused with
# `additional_pending`. The user ends with exactly ONE pending additional organization (never two).

source "$(dirname "${BASH_SOURCE[0]}")/lib/db_target.sh"
db_target_require   # explicit DB_CONTAINER only; refuses shared / ambiguous / remote targets (no auto-selection)
db_target_mark_dirty "$(basename "$0")"   # this script changes shared/seed rows: pgTAP must not run on this database afterwards

psql_run() { docker exec -i "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At "$@"; }

# Unique ids per run: the audit log is append-only, so organizations created here cannot be
# deleted afterwards. The isolated local database is cleared by `supabase db reset`.
run="$(python3 -c 'import uuid;print(uuid.uuid4().hex[:8])')"
uid="77c0${run:0:4}-0000-4000-8000-0000${run}"
oid="77c1${run:0:4}-0000-4000-8000-0000${run}"
mid="77c2${run:0:4}-0000-4000-8000-0000${run}"

psql_run >/dev/null <<SQL
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                        email_confirmed_at, created_at, updated_at)
values ('${uid}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'concurrency-${run}@example.test', '{"provider":"email","providers":["email"]}'::jsonb,
        '{"display_name":"C7","locale":"en"}'::jsonb, now(), now(), now());
update public.users set primary_account_type = 'engineer' where id = '${uid}';
insert into public.organizations (id, name, org_type, status, is_verified, created_by)
values ('${oid}', 'C7 Approved Office', 'design_office', 'active', true, '${uid}');
insert into public.memberships (id, user_id, organization_id, status)
values ('${mid}', '${uid}', '${oid}', 'active');
insert into public.membership_capabilities (membership_id, capability_key)
values ('${mid}', 'org.manage');
SQL

session_sql() {
  cat <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true);
select public.business_draft_save(p_display_name => 'C7 Additional', p_org_type => 'importer');
select pg_sleep(2);
select 'ORG:' || public.business_draft_submit(null);
commit;
SQL
}

t1="$(mktemp)"; t2="$(mktemp)"
trap 'rm -f "${t1}" "${t2}"' EXIT

session_sql | docker exec -i "${db_container}" psql -U postgres -d postgres -At >"${t1}" 2>&1 &
p1=$!
sleep 0.3
session_sql | docker exec -i "${db_container}" psql -U postgres -d postgres -At >"${t2}" 2>&1 &
p2=$!
wait "${p1}" || true
wait "${p2}" || true

o1="$(grep -o 'ORG:[0-9a-f-]*' "${t1}" | sed -n 1p || true)"
o2="$(grep -o 'ORG:[0-9a-f-]*' "${t2}" | sed -n 1p || true)"
pending="$(psql_run -c "select count(*) from public.organizations where created_by = '${uid}' and status = 'pending_verification';")"
refused="$(cat "${t1}" "${t2}" | grep -c 'additional_pending' || true)"

echo "session1=${o1:-refused} session2=${o2:-refused} pending_orgs=${pending} refused_sessions=${refused}"
winners=0
[[ -n "${o1}" ]] && winners=$((winners + 1))
[[ -n "${o2}" ]] && winners=$((winners + 1))
if [[ "${pending}" != "1" || "${winners}" != "1" || "${refused}" -lt 1 ]]; then
  echo "FAIL: expected exactly one winner, one refusal and one pending organization" >&2
  cat "${t1}" "${t2}" >&2
  exit 1
fi
echo "PASS: concurrent applications serialised - one pending organization, the other session refused"
