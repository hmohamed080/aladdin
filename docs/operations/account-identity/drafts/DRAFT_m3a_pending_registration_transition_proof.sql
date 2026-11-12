-- DRAFT (not a migration, never auto-applied): proof of the backward-compatible transition for public.pending_registration_consume()
-- and public.pending_registration_save(), the part of M3 that cannot be a plain redefinition.
--
-- Run with: bash docs/operations/account-identity/drafts/run-m3a-transition-proof.sh   (throwaway postgres container, no Supabase, no hosted project)
--
-- Why a harness and not the real stack: the question is PostgreSQL function semantics (return type, overloading, body dependencies), so the
-- harness recreates only what the two functions touch (auth.users/auth.uid, enum, app.pending_registrations, the lease helpers) with the
-- Production definitions copied from the catalog on 2026-11-12. The full-stack proof belongs to the real M3a pgTAP test (see
-- P1-CLEANUP-READINESS-20261112.md section 6).
--
-- FACTS THIS FILE PROVES
--   F1  `pending_registration_consume()` has no arguments, so it cannot be overloaded; CREATE OR REPLACE cannot change its RETURNS TABLE.
--   F2  CREATE OR REPLACE with the SAME signature and the SAME return table works and may stop reading the username columns (M3a).
--   F3  `pending_registration_save` can be overloaded by a username-less signature; named-argument calls resolve to exactly one overload (an UNTYPED positional call is ambiguous, so callers must use named arguments).
--   F4  After M3a the username columns can be dropped without breaking either function (bodies no longer reference them).
--   F5  After the app stops reading `username` from the consume result (it already ignores it), M3b can drop and recreate consume with the
--       two-column result in ONE transaction and no caller breaks.
\set ON_ERROR_STOP on

create schema auth; create schema app;
create table auth.users (id uuid primary key, email_confirmed_at timestamptz, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create type public.activity_audience_kind as enum ('organization_type', 'persona_type');
create table public.profiles (id uuid primary key default gen_random_uuid(), username_normalized text);
create table public.reserved_usernames (normalized text primary key);
create table app.pending_registrations (
  user_id uuid primary key, username text, username_reserved_at timestamptz,
  audience_kind public.activity_audience_kind not null, audience_value text not null, expires_at timestamptz not null,
  constraint ck_pending_registrations_lease_shape check ((username is null) = (username_reserved_at is null))
);
create index ix_pending_registrations_username_lease on app.pending_registrations (lower(username)) where username is not null;
create function app.username_lease_interval() returns interval language sql immutable as $$ select interval '30 minutes' $$;
create function app.normalize_username_for_uniqueness(p_username text) returns text language sql immutable as $$ select lower(btrim(p_username)) $$;
create function app.lock_username(p_norm text) returns void language sql as $$ select pg_advisory_xact_lock(hashtext(p_norm)) $$;
create function app.username_leased_by_other(p_norm text, p_except uuid) returns boolean language sql stable as $$
  select exists (select 1 from app.pending_registrations where lower(username) = p_norm and user_id <> p_except and username_reserved_at > now() - app.username_lease_interval()) $$;

-- ===== Production definitions today (copied from pg_get_functiondef, 2026-11-12) =====
create or replace function public.pending_registration_consume()
 returns table(username text, audience_kind public.activity_audience_kind, audience_value text)
 language plpgsql security definer set search_path to '' as $function$
declare
  v_uid uuid := (select auth.uid());
  v_row app.pending_registrations;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into v_row from app.pending_registrations where user_id = v_uid and expires_at > now();
  if not found then
    delete from app.pending_registrations where user_id = v_uid;
    return;
  end if;
  delete from app.pending_registrations where user_id = v_uid;
  username := case when v_row.username_reserved_at > now() - app.username_lease_interval() then v_row.username end;
  audience_kind := v_row.audience_kind;
  audience_value := v_row.audience_value;
  return next;
end;
$function$;

create or replace function public.pending_registration_save(p_user_id uuid, p_username text, p_audience_kind public.activity_audience_kind, p_audience_value text, p_ttl_minutes integer default 30)
 returns boolean language plpgsql security definer set search_path to '' as $function$
declare
  v_username text := btrim(p_username); v_norm text; v_existing app.pending_registrations; v_grant boolean := false;
begin
  if p_user_id is null then raise exception 'user id is required' using errcode = '22023'; end if;
  delete from app.pending_registrations where expires_at < now() - interval '1 day' and (username_reserved_at is null or username_reserved_at < now() - interval '1 day');
  if not exists (select 1 from auth.users u where u.id = p_user_id and u.email_confirmed_at is null and u.created_at > now() - interval '10 minutes') then return false; end if;
  if v_username is not null and v_username <> '' and char_length(v_username) between 3 and 24 and v_username ~ '^[a-zA-Z][a-zA-Z0-9]*([._][a-zA-Z0-9]+)*$' then
    v_norm := app.normalize_username_for_uniqueness(v_username); perform app.lock_username(v_norm);
  end if;
  select * into v_existing from app.pending_registrations where user_id = p_user_id for update;
  if found then return v_existing.username is not null and v_existing.username_reserved_at > now() - app.username_lease_interval(); end if;
  if v_norm is not null then
    v_grant := not exists (select 1 from public.reserved_usernames where normalized = v_norm)
           and not exists (select 1 from public.profiles where username_normalized = v_norm)
           and not app.username_leased_by_other(v_norm, p_user_id);
  end if;
  insert into app.pending_registrations (user_id, username, username_reserved_at, audience_kind, audience_value, expires_at)
  values (p_user_id, case when v_grant then v_username end, case when v_grant then now() end, p_audience_kind, p_audience_value, now() + make_interval(mins => greatest(coalesce(p_ttl_minutes, 30), 1)))
  on conflict (user_id) do nothing;
  return v_grant;
end;
$function$;

-- ===== helpers =====
create function pg_temp.expect_error(p_sql text, p_state text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL % : statement succeeded, expected SQLSTATE %', p_label, p_state;
exception when others then
  if sqlstate = 'P0001' and sqlerrm like 'FAIL %' then raise; end if;
  if sqlstate <> p_state then raise exception 'FAIL % : got SQLSTATE % (%), expected %', p_label, sqlstate, sqlerrm, p_state; end if;
  raise notice 'PASS %  (SQLSTATE %)', p_label, sqlstate;
end $$;
create function pg_temp.new_user(p_id uuid) returns void language sql as $$ insert into auth.users (id, email_confirmed_at, created_at) values (p_id, null, now()) $$;
create function pg_temp.assert(p_ok boolean, p_label text) returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FAIL %', p_label; end if; raise notice 'PASS %', p_label; end $$;

-- ===== F1: why a plain redefinition is impossible =====
select pg_temp.expect_error($q$ create or replace function public.pending_registration_consume() returns table(audience_kind public.activity_audience_kind, audience_value text)
  language sql as $f$ select null::public.activity_audience_kind, null::text where false $f$ $q$, '42P13', 'F1a CREATE OR REPLACE cannot change the RETURNS TABLE of consume()');
select pg_temp.expect_error($q$ create function public.pending_registration_consume() returns table(audience_kind public.activity_audience_kind, audience_value text)
  language sql as $f$ select null::public.activity_audience_kind, null::text where false $f$ $q$, '42723', 'F1b consume() cannot be overloaded by return type alone (no arguments)');

-- ===== M3a (expand): SAME signature and result shape for consume (username always NULL, no column read); username-less overload for save =====
create or replace function public.pending_registration_consume()
 returns table(username text, audience_kind public.activity_audience_kind, audience_value text)
 language plpgsql security definer set search_path to '' as $function$
declare
  v_uid uuid := (select auth.uid());
  v_row app.pending_registrations;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into v_row from app.pending_registrations where user_id = v_uid and expires_at > now();
  if not found then
    delete from app.pending_registrations where user_id = v_uid;
    return;
  end if;
  delete from app.pending_registrations where user_id = v_uid;
  username := null;  -- M3a: retained only so the result shape does not change; the column is no longer read
  audience_kind := v_row.audience_kind;
  audience_value := v_row.audience_value;
  return next;
end;
$function$;

create function public.pending_registration_save(p_user_id uuid, p_audience_kind public.activity_audience_kind, p_audience_value text, p_ttl_minutes integer default 30)
 returns boolean language plpgsql security definer set search_path to '' as $function$
begin
  if p_user_id is null then raise exception 'user id is required' using errcode = '22023'; end if;
  delete from app.pending_registrations where expires_at < now() - interval '1 day';
  if not exists (select 1 from auth.users u where u.id = p_user_id and u.email_confirmed_at is null and u.created_at > now() - interval '10 minutes') then return false; end if;
  if exists (select 1 from app.pending_registrations where user_id = p_user_id) then return false; end if;
  insert into app.pending_registrations (user_id, audience_kind, audience_value, expires_at)
  values (p_user_id, p_audience_kind, p_audience_value, now() + make_interval(mins => greatest(coalesce(p_ttl_minutes, 30), 1)))
  on conflict (user_id) do nothing;
  return true;
end;
$function$;

-- ===== F2/F3: both generations of caller work side by side after M3a =====
select pg_temp.new_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.assert(public.pending_registration_save(p_user_id => '00000000-0000-0000-0000-0000000000a1', p_username => null, p_audience_kind => 'persona_type', p_audience_value => 'engineer') is not null,
  'F3a OLD caller (named args with p_username: null, as the live app does) still resolves and runs');
select pg_temp.new_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.assert(public.pending_registration_save(p_user_id => '00000000-0000-0000-0000-0000000000a2', p_audience_kind => 'organization_type', p_audience_value => 'showroom_dealer') is true,
  'F3b NEW caller (named args without p_username) resolves to the new overload and stages the audience');
select pg_temp.expect_error($q$ select public.pending_registration_save('00000000-0000-0000-0000-0000000000a3', null, 'persona_type', 'engineer') $q$, '42725',
  'F3c an UNTYPED positional call is ambiguous between the two overloads (every caller must use named arguments or typed values; supabase-js rpc() sends named parameters)');
select pg_temp.new_user('00000000-0000-0000-0000-0000000000a3');
select pg_temp.assert(public.pending_registration_save('00000000-0000-0000-0000-0000000000a3'::uuid, null::text, 'persona_type'::public.activity_audience_kind, 'engineer'::text) is not null,
  'F3c2 a TYPED positional call to the old signature resolves');
select pg_temp.assert((select count(*) from pg_proc where proname = 'pending_registration_save') = 2, 'F3d exactly two overloads during the transition');

set test.uid = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.assert((select count(*) = 1 and bool_and(username is null) and bool_and(audience_value = 'engineer') from public.pending_registration_consume()), 'F2a consume() after M3a: same columns, username NULL, audience intact (staged by the OLD caller)');
set test.uid = '00000000-0000-0000-0000-0000000000a2';
select pg_temp.assert((select count(*) = 1 and bool_and(audience_kind = 'organization_type') from public.pending_registration_consume()), 'F2b consume() returns the audience staged by the NEW caller');

-- ===== F4: in M3b order (old save dropped first), the username columns can be dropped without breaking the M3a consume() or the new save; rolled back =====
begin;
drop function public.pending_registration_save(uuid, text, public.activity_audience_kind, text, integer);
drop index app.ix_pending_registrations_username_lease;
alter table app.pending_registrations drop constraint ck_pending_registrations_lease_shape;
alter table app.pending_registrations drop column username, drop column username_reserved_at;
select pg_temp.new_user('00000000-0000-0000-0000-0000000000a4');
select public.pending_registration_save(p_user_id => '00000000-0000-0000-0000-0000000000a4', p_audience_kind => 'persona_type', p_audience_value => 'engineer');
set local test.uid = '00000000-0000-0000-0000-0000000000a4';
select pg_temp.assert((select count(*) = 1 and bool_and(username is null) from public.pending_registration_consume()), 'F4a the M3a consume() works after the columns are dropped (body no longer references them)');
select pg_temp.new_user('00000000-0000-0000-0000-0000000000a5');
select pg_temp.assert(public.pending_registration_save(p_user_id => '00000000-0000-0000-0000-0000000000a5', p_audience_kind => 'persona_type', p_audience_value => 'engineer') is true, 'F4b the new save overload works after the columns are dropped');
rollback;
select pg_temp.assert(exists (select 1 from information_schema.columns where table_schema = 'app' and table_name = 'pending_registrations' and column_name = 'username'), 'F4c the rehearsal was rolled back (columns still present)');

-- ===== M3b: drop the old save, recreate consume with the two-column result in one transaction =====
begin;
drop function public.pending_registration_save(uuid, text, public.activity_audience_kind, text, integer);
drop function public.pending_registration_consume();
create function public.pending_registration_consume()
 returns table(audience_kind public.activity_audience_kind, audience_value text)
 language plpgsql security definer set search_path to '' as $function$
declare v_uid uuid := (select auth.uid()); v_row app.pending_registrations;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into v_row from app.pending_registrations where user_id = v_uid and expires_at > now();
  delete from app.pending_registrations where user_id = v_uid;
  if not found or v_row.user_id is null then return; end if;
  audience_kind := v_row.audience_kind; audience_value := v_row.audience_value; return next;
end; $function$;
drop index app.ix_pending_registrations_username_lease;
alter table app.pending_registrations drop constraint ck_pending_registrations_lease_shape;
alter table app.pending_registrations drop column username, drop column username_reserved_at;
commit;
select pg_temp.assert((select count(*) from pg_proc where proname = 'pending_registration_save') = 1, 'F5a only the username-less save remains');
select pg_temp.new_user('00000000-0000-0000-0000-0000000000a5');
select public.pending_registration_save(p_user_id => '00000000-0000-0000-0000-0000000000a5', p_audience_kind => 'persona_type', p_audience_value => 'engineer');
set test.uid = '00000000-0000-0000-0000-0000000000a5';
select pg_temp.assert((select count(*) = 1 and bool_and(audience_value = 'engineer') from public.pending_registration_consume()), 'F5b consume() with the two-column result returns the staged audience; a caller that ignores `username` is unaffected');
select pg_temp.expect_error($q$ select public.pending_registration_save(p_user_id => '00000000-0000-0000-0000-0000000000a5', p_username => null, p_audience_kind => 'persona_type', p_audience_value => 'x') $q$, '42883', 'F5c a stale OLD caller (p_username) now fails with function-not-found, which the app already logs and ignores');
\echo 'ALL M3a/M3b TRANSITION CHECKS PASSED'
