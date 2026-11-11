#!/usr/bin/env bash
set -euo pipefail
# LOCAL, standalone proof (no Docker, no hosted resource) of migration 20261110090001: legacy media copied to R2 gets
# the ids-only owner-scoped key, rollback is exact, the key stays immutable otherwise. It loads the REAL SQL of the
# migrations that define the table, key rule, trigger and switch/rollback into a throwaway PostgreSQL cluster with minimal
# stand-ins for users, organizations and the source tables. Needs PostgreSQL server binaries (PGBIN, default Ubuntu 16).
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; mig="${here}/../../migrations"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
dir="$(mktemp -d)"; port="${PGPORT_REHEARSAL:-55439}"; run=(); [[ "$(id -u)" == 0 ]] && { chown postgres "$dir"; run=(su postgres -c); }
cleanup() { "${PGBIN}/pg_ctl" -D "$dir/d" stop -m fast >/dev/null 2>&1 || su postgres -c "${PGBIN}/pg_ctl -D $dir/d stop -m fast" >/dev/null 2>&1 || true; rm -rf "$dir"; }
trap cleanup EXIT
pg() { if [[ ${#run[@]} -gt 0 ]]; then su postgres -c "$*"; else bash -c "$*"; fi; }
pg "${PGBIN}/initdb -D $dir/d -A trust" >/dev/null
pg "${PGBIN}/pg_ctl -D $dir/d -o '-p $port -k /tmp' -l $dir/log -w start" >/dev/null
psq() { pg "psql -h /tmp -p $port -U postgres -d postgres -At -v ON_ERROR_STOP=1 -f -"; }
extract() { sed -n "$2,$3p" "$mig/$1"; }
{
cat <<'SQL'
create role service_role; create role anon; create role authenticated;
create schema app; create schema auth;
create table public.users(id uuid primary key); create table public.organizations(id uuid primary key);
create table public.stub_media(ns text,key text,owner uuid,org uuid,state text default 'ready',ct text default 'image/jpeg',primary key(ns,key));
create function app.media_metadata(p_namespace text,p_key text) returns jsonb language sql stable as $f$
  select jsonb_build_object('owner',owner,'organization',org,'contentType',ct,'state',state,'createdAt',now())
  from public.stub_media where ns=p_namespace and key=p_key $f$;
-- loops used by the switch's row locks
create table public.portfolio_items(object_key text); create table public.professional_certificates(object_path text);
create table public.avatar_uploads(object_key text); create table public.product_images(object_key text); create table public.organization_images(object_key text);
SQL
extract 20261021090005_rc2_verified_media_storage.sql 3 17 | sed 's/references public.users(id)//; s/references public.organizations(id)//'
echo "alter table public.media_storage_locations drop constraint media_storage_locations_namespace_check;"
sed -n '/^create table public.media_migration_ledger/,/^);/p' "$mig/20261021090005_rc2_verified_media_storage.sql" | sed 's/references public.users(id)//'
extract 20261107090004_media_id_storage_keys.sql 19 70
cat "$mig/20261110090001_media_migration_ids_only_keys.sql" | sed '/^create or replace function public.media_migration_switch/,$!b' >/dev/null
} > "$dir/base.sql"
# The ORIGINAL switch/rollback (what Production has today), then the new migration on top.
sed -n '/^create function public.media_migration_switch/,/^\$\$;/p;/^create function public.media_migration_rollback/,/^\$\$;/p' "$mig/20261021090005_rc2_verified_media_storage.sql" >> "$dir/base.sql"
chmod 644 "$dir/base.sql"; cp "$dir/base.sql" /tmp/_mm_base.sql; chmod 644 /tmp/_mm_base.sql
fail=0; ok(){ echo "  PASS  $1"; }; bad(){ echo "  FAIL  $1"; fail=1; }
check(){ if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got '$2', want '$3')"; fi; }
q(){ echo "$1" | psq 2>&1; }
cat /tmp/_mm_base.sql | psq >/dev/null
U=11111111-1111-4111-8111-111111111111; O=22222222-2222-4222-8222-222222222222
A=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa; P=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb; PR=cccccccc-cccc-4ccc-8ccc-cccccccccccc
q "insert into public.users values('$U'); insert into public.organizations values('$O');
 insert into public.stub_media values('avatar','$A.jpg','$U',null),('product','$O/$P/$PR.jpg','$U','$O'),('organization','$O/$PR.jpg','$U','$O');
 insert into public.portfolio_items values('x');" >/dev/null
SW="select public.media_migration_switch('avatar','$A.jpg','$U',100,'image/jpeg',repeat('a',64))"
echo "== before the migration (Production today)"
q "$SW" >/dev/null
check "old switch leaves a flat legacy key" "$(q "select coalesce(storage_key,'NULL') from public.media_storage_locations where namespace='avatar'")" "NULL"
q "select public.media_migration_rollback('avatar','$A.jpg',repeat('a',64)); delete from public.media_storage_locations; delete from public.media_migration_ledger;" >/dev/null
# a Production-like pre-existing supabase-provider row with NULL key
q "insert into public.media_storage_locations(namespace,object_key,owner_user_id,provider,content_type) values('avatar','$A.jpg','$U','supabase','image/jpeg')" >/dev/null
echo "== apply 20261110090001"
psq < "$mig/20261110090001_media_migration_ids_only_keys.sql" >/dev/null
check "target key is owner-scoped ids-only (avatar)" "$(q "select public.media_migration_target_key('avatar','$A.jpg')")" "u/$U/profile/$A/original.jpg"
q "$SW" >/dev/null
check "switch records the ids-only key on the existing supabase row" "$(q "select storage_key||'|'||provider from public.media_storage_locations where namespace='avatar'")" "u/$U/profile/$A/original.jpg|r2"
check "re-run is idempotent, key unchanged" "$(q "$SW; select storage_key from public.media_storage_locations where namespace='avatar'" | tail -1)" "u/$U/profile/$A/original.jpg"
check "target key of an r2 record is its recorded key" "$(q "select public.media_migration_target_key('avatar','$A.jpg')")" "u/$U/profile/$A/original.jpg"
check "product key o/<org>/products/<product>/<id>" "$(q "select public.media_migration_target_key('product','$O/$P/$PR.jpg')")" "o/$O/products/$P/$PR/original.jpg"
check "organization key o/<org>/profile/<id>" "$(q "select public.media_migration_target_key('organization','$O/$PR.jpg')")" "o/$O/profile/$PR/original.jpg"
check "not-ready or unknown record has no target key" "$(q "select coalesce(public.media_migration_target_key('avatar','nope.jpg'),'NULL')")" "NULL"
err(){ q "$1" || true; }
if err "update public.media_storage_locations set storage_key='u/$U/profile/$A/original.png' where namespace='avatar'" | grep -q immutable; then ok "key is immutable outside the migration functions"; else bad "key immutable"; fi
if err "update public.media_storage_locations set provider='supabase' where namespace='avatar'" | grep -qi "check"; then ok "provider cannot flip while a key is set (constraint)"; else bad "constraint"; fi
if err "select public.media_migration_rollback('avatar','$A.jpg',repeat('b',64))" | grep -q "no verified"; then ok "wrong checksum cannot roll back"; else bad "wrong sha rollback"; fi
q "select public.media_migration_rollback('avatar','$A.jpg',repeat('a',64))" >/dev/null
check "rollback restores provider supabase and clears the key" "$(q "select provider||'|'||coalesce(storage_key,'NULL') from public.media_storage_locations where namespace='avatar'")" "supabase|NULL"
check "rollback marks the ledger" "$(q "select (rolled_back_at is not null)::text from public.media_migration_ledger where namespace='avatar'")" "true"
q "$SW" >/dev/null
check "switch after rollback recomputes the identical key" "$(q "select storage_key from public.media_storage_locations where namespace='avatar'")" "u/$U/profile/$A/original.jpg"
check "ledger re-armed after re-switch" "$(q "select (rolled_back_at is null)::text from public.media_migration_ledger where namespace='avatar'")" "true"
# a record already on r2 at a legacy flat key keeps it
q "insert into public.media_storage_locations(namespace,object_key,owner_user_id,provider,content_type,size_bytes,sha256,verified_at,organization_id) values('organization','$O/$PR.jpg','$U','r2','image/jpeg',100,repeat('c',64),now(),'$O')" >/dev/null
check "existing r2 legacy record keeps its flat key as target" "$(q "select public.media_migration_target_key('organization','$O/$PR.jpg')")" "organization/$O/$PR.jpg"
q "select public.media_migration_switch('organization','$O/$PR.jpg','$U',100,'image/jpeg',repeat('c',64))" >/dev/null
check "switching it again does not give it a second key" "$(q "select coalesce(storage_key,'NULL') from public.media_storage_locations where namespace='organization'")" "NULL"
check "flag is off after the functions" "$(q "select coalesce(current_setting('app.media_migration',true),'')")" ""
[[ $fail == 0 ]] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
