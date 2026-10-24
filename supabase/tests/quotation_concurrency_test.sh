#!/usr/bin/env bash
set -euo pipefail

# B2: real two-session proof for the quotation lifecycle.
#
#  1. Two sessions update the SAME draft at the SAME expected version. T1 holds the row lock
#     (update_quotation does select ... for update) while T2 enters. T2 must BLOCK, then re-read the
#     bumped version and be refused with the dedicated business-conflict SQLSTATE VC001 - NOT the
#     retryable 40001 that PostgREST re-runs until the gateway times out (60 s hang, measured).
#     T1's note survives: no lost update, one version bump.
#  2. Two sessions submit the SAME quotation. The second waits for the lock and is refused (the
#     quotation is no longer a draft): exactly one 'quotation.submitted' audit row and one version
#     bump, so a duplicate attempt can never create a duplicate business record or notification.

DB_CONTAINER="${DB_CONTAINER:-${E2E_DB_CONTAINER:-}}"   # the E2E harness names its own isolated stack
source "$(dirname "${BASH_SOURCE[0]}")/lib/db_target.sh"
db_target_require   # explicit DB_CONTAINER only; refuses shared / ambiguous / remote targets (no auto-selection)
db_target_mark_dirty "$(basename "$0")"   # this script changes shared/seed rows: pgTAP must not run on this database afterwards

psql_q() { docker exec -i "${db_container}" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 "$@"; }

SUP='{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}'
REQ='{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}'

# Self-contained fixture through the real RPCs: supplier A publishes a product, requester B sends an
# RFQ, supplier prices the quotation. Prints "<quotation_id>|<version>".
fixture="$(psql_q <<SQL
-- the other concurrency scripts leave seed memberships revoked; this one needs both owners active
update public.memberships set status = 'active' where id in ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'e3333333-eeee-4eee-8eee-eeeeeeeeeee3');
insert into public.membership_capabilities (membership_id, capability_key) values
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'catalog.publish'),
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'rfq.respond'),
  ('e3333333-eeee-4eee-8eee-eeeeeeeeeee3', 'rfq.create'),
  ('e3333333-eeee-4eee-8eee-eeeeeeeeeee3', 'quote.decide')
on conflict do nothing;
begin;
set local role authenticated;
select set_config('request.jwt.claims', '${SUP}', true);
select public.create_product('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Race Tile ' || clock_timestamp()::text, 'finishing', 'piece') as pid \gset
select public.product_audiences_set(:'pid', array['showroom_dealer','supplier','manufacturer','importer','contractor','engineer','installer_technician','end_consumer']);
select public.set_product_published(:'pid', true, (select version from public.products where id = :'pid'));
select set_config('request.jwt.claims', '${REQ}', true);
select public.create_rfq('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Race RFQ ' || clock_timestamp()::text) as rid \gset
select public.add_rfq_item(:'rid', :'pid', 10);
select public.submit_rfq(:'rid', (select version from public.rfqs where id = :'rid'));
select set_config('request.jwt.claims', '${SUP}', true);
select public.create_quotation(:'rid') as qid \gset
select public.set_quotation_item_price((select id from public.quotation_items where quotation_id = :'qid' limit 1), 100);
select :'qid' || '|' || (select version from public.quotations where id = :'qid');
commit;
SQL
)"
quotation_id="${fixture##*$'\n'}"
quotation_id="${quotation_id%%|*}"
start_version="$(psql_q -c "select version from public.quotations where id = '${quotation_id}'")"

fail() { echo "$1" >&2; sed -n '1,60p' "${t1_output}" "${t2_output}" >&2; exit 1; }
t1_output="$(mktemp)"
t2_output="$(mktemp)"
trap 'rm -f "${t1_output}" "${t2_output}"' EXIT

# race <t1 sql statement> <t2 sql statement>: T1 runs and holds the lock ~3 s, T2 starts 0.5 s later.
race() {
  docker exec -i "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >"${t1_output}" 2>&1 <<SQL &
begin;
set local role authenticated;
select set_config('request.jwt.claims', '${SUP}', true);
$1
select pg_sleep(3);
commit;
SQL
  local t1_pid=$!
  sleep 0.5
  local start_ns end_ns
  start_ns="$(date +%s%N)"
  set +e
  docker exec -i "${db_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose >"${t2_output}" 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '${SUP}', true);
$2
commit;
SQL
  t2_status=$?
  wait "${t1_pid}"
  t1_status=$?
  set -e
  end_ns="$(date +%s%N)"
  elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))
  [[ ${t1_status} -eq 0 ]] || fail "first session unexpectedly failed"
  [[ ${t2_status} -ne 0 ]] || fail "second session unexpectedly succeeded (lost update / duplicate!)"
  [[ ${elapsed_ms} -ge 2000 ]] || fail "second session did not wait on the row lock (${elapsed_ms}ms)"
  [[ ${elapsed_ms} -lt 10000 ]] || fail "second session took ${elapsed_ms}ms - far longer than the lock wait"
}

# ---- 1. concurrent update at the same version -> VC001, no lost update -------------------------
race "select public.update_quotation('${quotation_id}', ${start_version}, 'first writer');"      "select public.update_quotation('${quotation_id}', ${start_version}, 'second writer');"
grep -q 'ERROR:  VC001' "${t2_output}" || fail "stale update did not raise VC001"
grep -q 'modified concurrently' "${t2_output}" || fail "stale update failed for the wrong reason"
if grep -q '40001' "${t2_output}"; then fail "stale update still raises the retryable 40001"; fi
update_ms=${elapsed_ms}
state="$(psql_q -F '|' -c "select version, note from public.quotations where id = '${quotation_id}'")"
[[ "${state}" == "$(( start_version + 1 ))|first writer" ]] || fail "expected the first writer to win exactly once, got ${state}"

# ---- 2. concurrent submit -> exactly one applies --------------------------------------------
next_version=$(( start_version + 1 ))
race "select public.submit_quotation('${quotation_id}', ${next_version});"      "select public.submit_quotation('${quotation_id}', ${next_version});"
grep -q 'only a draft quotation can be submitted' "${t2_output}" || fail "duplicate submit failed for the wrong reason"
submit_ms=${elapsed_ms}
final="$(psql_q -F '|' -c "select version, status from public.quotations where id = '${quotation_id}'")"
[[ "${final}" == "$(( next_version + 1 ))|submitted" ]] || fail "expected version|status = $(( next_version + 1 ))|submitted, got ${final}"
audits="$(psql_q -c "select count(*) from public.audit_log where action = 'quotation.submitted' and subject_id = '${quotation_id}'")"
[[ "${audits}" == "1" ]] || fail "expected exactly one quotation.submitted audit row, got ${audits}"

echo "quotation concurrency PASS: stale update refused with VC001 after ${update_ms}ms (no lost update); duplicate submit refused after ${submit_ms}ms; final=${final}; submitted audit rows=${audits}"
