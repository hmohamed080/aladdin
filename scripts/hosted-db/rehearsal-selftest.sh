#!/usr/bin/env bash
# Local only, never touches a hosted project. Proves production-rehearsal.sh end to end on this machine
# (Linux or Windows Git Bash) without Production: builds a throwaway source stack on Production's
# Auth/Storage/Postgres versions with Production's migration history, adds Auth/Storage rows and the
# hosted-only parameter grant, runs the rehearsal in test mode against it, then removes the source stack.
#   bash scripts/hosted-db/rehearsal-selftest.sh
set -euo pipefail
export LC_ALL=C
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"; cd "$ROOT"
PROD_LATEST="20261020090001"          # Production's latest applied migration (165 in total)
sb() { pnpm exec supabase "$@"; }
dk() { MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' docker "$@"; }
S="$(mktemp -d)/selftest-source"; mkdir -p "$S/supabase/.temp" "$S/supabase/migrations"; cp -r supabase/templates "$S/supabase/"
# Pick the first port block (x20..x29) that nothing listens on; the rehearsal itself uses 644xx.
busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
P=""; for base in 571 572 573 574 418 419 428 438; do
  free=1; for n in 20 21 22 23 24 25 26 27 28 29; do ! busy "$base$n" || { free=0; break; }; done
  [ "$free" = 0 ] || { P="$base"; break; }
done
[ -n "$P" ] || { echo "no free port block for the self-test source stack"; exit 1; }
echo "Self-test source stack ports: ${P}20-${P}29"
sed "s/project_id = \"aladdin\"/project_id = \"aladdin_selftest_src\"/; s/543\([0-9][0-9]\)/$P\1/g; s/^sql_paths = .*/sql_paths = []/" supabase/config.toml > "$S/supabase/config.toml"
printf v2.197.0 > "$S/supabase/.temp/gotrue-version"; printf v1.80.2 > "$S/supabase/.temp/storage-version"; printf 17.6.1.155 > "$S/supabase/.temp/postgres-version"
for f in supabase/migrations/*.sql; do b="$(basename "$f")"; [ "${b:0:14}" \> "$PROD_LATEST" ] || cp "$f" "$S/supabase/migrations/"; done
[ -n "${SELFTEST_KEEP:-}" ] || trap 'sb stop --workdir "$S" --no-backup >/dev/null 2>&1 || true' EXIT
sb start --workdir "$S" -x edge-runtime,logflare,vector,studio,supavisor,imgproxy,realtime,mailpit,postgres-meta > "$S/start.log" 2>&1 || { tail -20 "$S/start.log"; exit 1; }
SRC="supabase_db_aladdin_selftest_src"
# Production's default privileges for postgres in public lack the UPDATE-on-new-sequences grant to the client roles that
# the local image starts with; mirror that before the migrations, so the source's ACLs look like Production's.
dk exec "$SRC" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 -c 'alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role'
sb migration up --workdir "$S" --local >/dev/null
dk exec -i "$SRC" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', format('selftest%s@example.test', g),
       crypt('not-a-real-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', 'Selftest ' || g), now(), now()
from generate_series(1,3) g;
insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
select id::text, id, jsonb_build_object('sub', id::text, 'email', email), 'email', now(), now() from auth.users;
insert into auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to, created_at, updated_at, expires_at)
select gen_random_uuid(), u.id, t::auth.one_time_token_type, md5(u.id::text || t), u.email, now(), now(), now() + interval '1 hour'
from auth.users u, unnest(array['confirmation_token','recovery_token','reauthentication_token']) t;
insert into storage.objects (bucket_id, name, owner_id, metadata) select 'avatars', 'u/' || id || '/a.png', id::text, '{"size":1}' from auth.users;
SQL
# Production's history table has three more columns than the local CLI creates; mirror that.
dk exec "$SRC" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 -c 'alter table supabase_migrations.schema_migrations add column if not exists created_by text, add column if not exists idempotency_key text, add column if not exists rollback text[]'
dk exec "$SRC" psql -U supabase_admin -d postgres -q -v ON_ERROR_STOP=1 -c 'GRANT SET ON PARAMETER "log_min_messages" TO "supabase_realtime_admin"'
# On Production this identity sequence has a NULL (owner-default) ACL, so it is absent from the security tail; the
# restore must keep it NULL. Throwaway source stack only.
dk exec "$SRC" psql -U supabase_admin -d postgres -q -v ON_ERROR_STOP=1 -c "update pg_class set relacl = null where oid = 'public.job_review_moderations_seq_seq'::regclass"
# Nine Production function bodies carry CRLF line endings (SQL pasted from Windows); give one function the same trait.
dk exec "$SRC" psql -U supabase_admin -d postgres -q -v ON_ERROR_STOP=1 -c "update pg_proc set prosrc = replace(prosrc, E'\\n', E'\\r\\n') where oid = 'app.can_participate(uuid)'::regprocedure"
echo "Source ready: $(dk exec "$SRC" psql -U postgres -d postgres -At -c "select format('%s users, %s one-time tokens (%s with expires_at), %s storage objects', (select count(*) from auth.users), (select count(*) from auth.one_time_tokens), (select count(expires_at) from auth.one_time_tokens), (select count(*) from storage.objects))")"
REHEARSAL_SOURCE_DB_URL="postgresql://postgres:postgres@127.0.0.1:${P}22/postgres?sslmode=disable" REHEARSAL_VERSIONS_DIR="$S/supabase/.temp" \
  bash "$HERE/production-rehearsal.sh"
