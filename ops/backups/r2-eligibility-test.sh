#!/usr/bin/env bash
# shellcheck disable=SC2319  # the tests read `[ cond ]; ok $?` on purpose
# Which R2 originals a media backup must hold (r2-eligibility.sql) and the same rule over a dump
# (snapshot-objects.py), on a throwaway local PostgreSQL. Proves: only PROVABLY retired originals are excluded, every
# doubt stays required, and the live/restored-database rule and the dump rule agree on the same data.
#   bash ops/backups/r2-eligibility-test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; . "$HERE/pgtemp.sh"
T="$(mktemp -d)"; trap 'stop_pg; rm -rf "$T"' EXIT
start_pg || { echo "r2-eligibility-test: skipped (no local PostgreSQL)"; [ -n "${REQUIRE_PG:-}" ] && exit 1; exit 0; }
pass=0; fail=0
ok() { if [ "$1" -eq 0 ]; then pass=$((pass+1)); echo "PASS  $2"; else fail=$((fail+1)); echo "FAIL  $2"; fi; }
Q() { psql "$PGURL" -X -q -At -F $'\t' -v ON_ERROR_STOP=1 "$@"; }

U1=11111111-1111-1111-1111-111111111111; U2=22222222-2222-2222-2222-222222222222
# One fixture. $1 = "plain" (no storage_key column, the layout before migration 20261107090004) or "keyed".
build() {
  Q -c "drop schema if exists public cascade; drop schema if exists storage cascade; create schema public; create schema storage" >/dev/null
  python3 - "$1" "$U1" "$U2" > "$T/fixture.sql" <<'PY'
import sys
variant, U1, U2 = sys.argv[1:4]
sk = ", storage_key text" if variant == "keyed" else ""
out = [f"""
create table storage.objects (id uuid, bucket_id text, name text, metadata jsonb);
create table public.avatar_uploads (id uuid primary key, object_key text, owner_user_id uuid, state text);
create table public.portfolio_items (id uuid primary key, object_key text, owner_user_id uuid, state text);
create table public.professional_certificates (id uuid primary key, object_path text, owner_user_id uuid, state text);
create table public.product_images (id uuid primary key, object_key text, created_by uuid, state text);
create table public.organization_images (id uuid primary key, object_key text, created_by uuid, state text);
create table public.profiles (user_id uuid, avatar_media_id uuid, cover_media_id uuid);
create table public.organizations (id uuid, logo_media_id uuid);
create table public.media_storage_locations (namespace text, object_key text, owner_user_id uuid, provider text, sha256 text,
  size_bytes bigint, created_at timestamptz default now(), verified_at timestamptz, cleaned_at timestamptz{sk}, primary key (namespace, object_key));
insert into storage.objects values ('00000000-0000-0000-0000-000000000001','avatars','x','{{"size":5}}');
"""]
TAB = {"avatar": ("avatar_uploads", "object_key", "owner_user_id"), "portfolio": ("portfolio_items", "object_key", "owner_user_id"),
       "certificate": ("professional_certificates", "object_path", "owner_user_id"), "product": ("product_images", "object_key", "created_by"),
       "organization": ("organization_images", "object_key", "created_by")}
def uid(n): return f"00000000-0000-0000-0000-{n:012d}"
def case(n, ns, state, owner=U1, loc_owner=U1, canon=1, extra_loc="", verified=True, cleaned=False, provider="r2", key=None, sha=None, storage_key=None):
    key = key or f"case{n}.bin"; sha = sha or f"{n:064x}"
    t, kc, oc = TAB.get(ns, (None, None, None))
    if t:
        for i in range(canon):
            o = f"'{owner}'" if owner else "null"
            out.append(f"insert into public.{t} (id,{kc},{oc},state) values ('{uid(n*10+i)}','{key}',{o},'{state}');")
    cols = "namespace,object_key,owner_user_id,provider,sha256,size_bytes,verified_at,cleaned_at" + (",storage_key" if variant == "keyed" else "")
    vals = f"'{ns}','{key}','{loc_owner}','{provider}','{sha}',10,{'now()' if verified else 'null'},{'now()' if cleaned else 'null'}" + \
           ((f",'{storage_key}'" if storage_key else ",null") if variant == "keyed" else "")
    out.append(f"insert into public.media_storage_locations ({cols}) values ({vals});")
case(1, "avatar", "deleted")
case(2, "avatar", "ready"); out.append(f"insert into public.profiles values ('{U1}','{uid(20)}',null);")
case(3, "avatar", "deleted"); out.append(f"insert into public.profiles values ('{U2}',null,'{uid(30)}');")
case(4, "avatar", "deleted"); out.append(f"insert into public.profiles values ('{U2}','{uid(40)}',null);")
case(5, "avatar", "pending")
case(6, "avatar", "deleted", canon=0)
case(7, "avatar", "deleted", canon=2)
case(8, "avatar", "deleted", owner=U2)
case(9, "avatar", "deleted", owner=None)
case(11, "portfolio", "deleted")
case(12, "portfolio", "ready")
case(13, "certificate", "deleted")
case(14, "product", "deleted")
case(15, "organization", "deleted")
case(16, "organization", "deleted"); out.append(f"insert into public.organizations values ('{U1}','{uid(160)}');")
case(17, "avatar", "deleted", key="shared-name.bin")
out.append(f"insert into public.portfolio_items (id,object_key,owner_user_id,state) values ('{uid(171)}','shared-name.bin','{U1}','ready');")
case(18, "avatar", "deleted", cleaned=True)
case(19, "avatar", "deleted", verified=False)
case(20, "avatar", "deleted", provider="supabase")
case(21, "weird", "deleted")
case(24, "avatar", "deleted", sha=f"{2:064x}")   # same content as the active case 2: retired by its own key, but the sha stays needed
if variant == "keyed":
    case(10, "avatar", "deleted", storage_key="shared/phys.bin")
    case(25, "avatar", "deleted", storage_key="shared/phys.bin", sha=f"{10:064x}")   # two records, one physical object
    case(26, "avatar", "deleted", storage_key="u/own/phys26.bin")   # a keyed location of its own: retired
print("\n".join(out))
PY
  Q -f "$T/fixture.sql" >/dev/null
}
RETIRED_PLAIN="1 11 13 14 15 24"
REQUIRED_PLAIN="2 3 4 5 6 7 8 9 12 16 17 21"
NOT_LISTED="18 19 20"
check() { # <variant> <retired cases> <required cases>
  local v="$1" retired="$2" required="$3" n c
  build "$v" || { ok 1 "[$v] fixture builds"; return; }
  Q -f "$HERE/r2-eligibility.sql" > "$T/$v.tsv"; ok $? "[$v] r2-eligibility.sql runs"
  # a case is found by its physical key (case 24 shares case 2's content, so the sha cannot tell them apart)
  phys() { case "$1" in 10|25) echo shared/phys.bin;; 26) echo u/own/phys26.bin;; 17) echo avatar/shared-name.bin;;
           11|12) echo portfolio/case$1.bin;; 13) echo certificate/case$1.bin;; 14) echo product/case$1.bin;;
           15|16) echo organization/case$1.bin;; 21) echo weird/case$1.bin;; *) echo avatar/case$1.bin;; esac; }
  cls() { awk -F'\t' -v k="$(phys "$1")" '$3 == k {print $4}' "$T/$v.tsv" | sort -u | tr '\n' ' ' | sed 's/ $//'; }
  for n in $retired; do
    c="$(cls "$n")"; [ "${c:0:8}" = "retired:" ]; ok $? "[$v] case $n is excluded as retired ($c)"
  done
  for n in $required; do c="$(cls "$n")"; [ "$c" = required ]; ok $? "[$v] case $n stays required ($c)"; done
  for n in $NOT_LISTED; do c="$(cls "$n")"; [ -z "$c" ]; ok $? "[$v] case $n (cleaned, unverified or not R2) is not listed at all"; done
  # the same data through the dump rule
  "$PGBIN/pg_dump" --data-only -d "$PGURL" -n public -n storage > "$T/$v.data.sql" 2>/dev/null || $PG_AS "$PGBIN/pg_dump" --data-only -d "$PGURL" > "$T/$v.data.sql"
  python3 "$HERE/snapshot-objects.py" "$T/$v.data.sql" "$T/$v.objects.tsv" "$T/$v.r2.tsv" "$T/$v.ex.json" > "$T/$v.count"; ok $? "[$v] snapshot-objects.py reads the dump"
  awk -F'\t' '$4 == "required" {print $3}' "$T/$v.tsv" | sort -u > "$T/$v.sql.keys"; cut -f3 "$T/$v.r2.tsv" | sort > "$T/$v.py.keys"
  cmp -s "$T/$v.sql.keys" "$T/$v.py.keys"; ok $? "[$v] the dump rule and the database rule require exactly the same originals ($(wc -l < "$T/$v.py.keys" | tr -d ' '))"
  awk -F'\t' '$4 ~ /^retired:/ {n[$4]++} END {for (k in n) print k "\t" n[k]}' "$T/$v.tsv" | sort > "$T/$v.sql.ex"
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); [print(k+"\t"+str(v)) for k,v in sorted(d.items())]' "$T/$v.ex.json" > "$T/$v.py.ex"
  cmp -s "$T/$v.sql.ex" "$T/$v.py.ex"; ok $? "[$v] both report the same retired counts: $(tr '\t\n' '= ' < "$T/$v.py.ex")"
  ! grep -qE "case[0-9]|shared|phys|u/own" "$T/$v.ex.json"; ok $? "[$v] the exclusion report holds no object keys"
  [ "$(cat "$T/$v.count")" = "$(Q -c "select count(*) from public.media_storage_locations where provider='r2' and cleaned_at is null")" ]; ok $? "[$v] the manifest count of live R2 records is unchanged by the exclusion"
}
check plain "$RETIRED_PLAIN" "$REQUIRED_PLAIN"
check keyed "$RETIRED_PLAIN 26" "$REQUIRED_PLAIN 10 25"
# Two records for one physical object that disagree about its bytes are ambiguous: the snapshot must fail, not guess.
Q -c "update public.media_storage_locations set sha256 = repeat('e', 64) where storage_key = 'shared/phys.bin' and object_key like '%case25%'" >/dev/null
"$PGBIN/pg_dump" --data-only -d "$PGURL" > "$T/dis.sql" 2>/dev/null || $PG_AS "$PGBIN/pg_dump" --data-only -d "$PGURL" > "$T/dis.sql"
python3 "$HERE/snapshot-objects.py" "$T/dis.sql" "$T/dis.o" "$T/dis.r" "$T/dis.e" >/dev/null 2>&1; [ $? -ne 0 ]; ok $? "two records that disagree about one physical object fail the snapshot"
# A record that lacks a table the rule needs must fail, never be read as "nothing retired"-by-accident or crash silently.
Q -c "drop table public.profiles" >/dev/null
Q -f "$HERE/r2-eligibility.sql" >/dev/null 2>&1; [ $? -ne 0 ]; ok $? "the live rule errors (fails closed) when a table it depends on is missing"
echo "r2-eligibility-test: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
