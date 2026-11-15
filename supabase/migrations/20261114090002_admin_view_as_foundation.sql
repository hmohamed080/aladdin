-- Admin "View as account" — FOUNDATION (docs/admin/ADMIN_VIEW_AS_ARCHITECTURE.md §4, §5).
--
-- A read-only inspection of another user's account area, inside the Admin's OWN session. This migration adds only
-- the permission, the session/audit trail and the authorization gate that every later `admin_view_*` read must call.
-- It adds NO data-reading function and changes NO existing table, view, policy or function:
--   * auth.uid() is never altered; no impersonation token exists; no service-role path is introduced.
--   * Default deny: nothing is readable without (a) users.view_as, (b) an eligible subject and (c) a LIVE session.
--   * Revocation is immediate: the gate re-evaluates permission, rank and session on EVERY call.
--
-- Account kinds are a registry (`app.view_as_kind_matches`), so Showroom etc. add one branch, not a framework.
--
-- Forward-only (ADR-0002). Rollback = switch the app flag off and remove users.view_as from roles; objects stay inert.

-- ---------------------------------------------------------------------------
-- 1. Permission: users.view_as  (Super Admin — locked — and Administrator; never Moderator / Support by default)
-- ---------------------------------------------------------------------------
insert into public.admin_permissions (key, resource, action, description, sort_order) values
  ('users.view_as', 'users', 'view_as',
   'Open a read-only, audited view of another user''s account area (dashboard, profile, portfolio, work, points, reviews).', 13)
on conflict (key) do nothing;

insert into public.admin_role_permissions (role_id, permission_key, is_locked)
select r.id, 'users.view_as', r.key = 'super_admin'
from public.admin_roles r
where r.is_system and r.key in ('super_admin', 'administrator')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Audit vocabulary (append-only helper; never re-states the whole list)
-- ---------------------------------------------------------------------------
select app.audit_actions_add(array['admin.view_as.started', 'admin.view_as.ended']);

-- ---------------------------------------------------------------------------
-- 3. Sessions: one live row per (admin, subject, kind); 30 minutes, NON-sliding
-- ---------------------------------------------------------------------------
create table public.admin_view_sessions (
  id                uuid primary key default gen_random_uuid(),
  admin_user_id     uuid not null references public.users(id) on delete cascade,
  -- The Supabase Auth session (JWT session_id) the view was opened in. A NEW login has a new id, so it can never reuse an old view.
  auth_session_id   uuid not null,
  subject_user_id   uuid not null references public.users(id) on delete cascade,
  account_kind      text not null,
  started_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  ended_at          timestamptz,
  constraint ck_admin_view_sessions_kind check (account_kind in ('craftsman')),
  constraint ck_admin_view_sessions_window check (expires_at > started_at),
  constraint ck_admin_view_sessions_not_self check (admin_user_id <> subject_user_id)
);
create unique index uq_admin_view_sessions_live
  on public.admin_view_sessions (admin_user_id, subject_user_id, account_kind) where ended_at is null;
create index ix_admin_view_sessions_subject on public.admin_view_sessions (subject_user_id, started_at desc);

alter table public.admin_view_sessions enable row level security;
alter table public.admin_view_sessions force row level security;
-- No policy and no grant: only the SECURITY DEFINER functions below touch this table.
revoke all on public.admin_view_sessions from public, anon, authenticated, service_role;
comment on table public.admin_view_sessions is 'Audited read-only "view as account" sessions (Admin View-As). Written only by admin_view_as_begin/_end/_end_all; never client-readable. TTL 30 min, non-sliding.';

-- ---------------------------------------------------------------------------
-- 4. Account-kind registry (one branch per kind; showroom etc. are added here later)
-- ---------------------------------------------------------------------------
create or replace function app.view_as_kind_matches(p_kind text, p_subject uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    when 'craftsman' then exists (
      select 1 from public.users u
      where u.id = p_subject and u.primary_account_type = 'installer_technician')
    else false
  end;
$$;
revoke all on function app.view_as_kind_matches(text, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The gate. Evaluated on every call; any failure is the SAME generic error (no existence oracle).
-- ---------------------------------------------------------------------------
-- Rank used to PROTECT a subject. `app.admin_rank_of` reports 0 for a suspended / deactivated account (such a user
-- holds no live authority), which would let an Administrator open a view of a suspended peer or senior admin. For the
-- protection check we therefore ignore the account status: any active platform assignment still counts.
create or replace function app.view_as_protected_rank(p_user_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(r.rank), 0)
  from public.admin_role_assignments a
  join public.admin_roles r on r.id = a.role_id
  where a.user_id = p_user_id
    and a.is_active and a.scope_type = 'platform'
    and r.status = 'active';
$$;
revoke all on function app.view_as_protected_rank(uuid) from public, anon, authenticated, service_role;

create or replace function app.view_as_subject_ok(p_subject uuid, p_kind text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_rank  int;
begin
  if v_actor is null or p_subject is null or p_kind is null then return false; end if;
  if v_actor = p_subject then return false; end if;                       -- never one's own account
  if not app.has_admin_permission('users.view_as') then return false; end if;
  if not exists (select 1 from public.users u where u.id = p_subject) then return false; end if;
  if not app.view_as_kind_matches(p_kind, p_subject) then return false; end if;
  v_rank := app.admin_rank_of(v_actor);
  -- Never Admin Staff at or above the actor's rank (even if suspended), unless the actor is a Super Admin (rank >= 100).
  if v_rank < 100 and app.view_as_protected_rank(p_subject) >= v_rank then return false; end if;
  return true;                                                            -- suspended / deactivated / unverified are viewable
end;
$$;

create or replace function app.view_as_active(p_subject uuid, p_kind text default 'craftsman')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.view_as_subject_ok(p_subject, p_kind)
     and exists (
       select 1 from public.admin_view_sessions s
       where s.admin_user_id = (select auth.uid())
         and s.subject_user_id = p_subject
         and s.account_kind = p_kind
         and s.auth_session_id is not distinct from nullif((select auth.jwt()) ->> 'session_id', '')::uuid
         and s.ended_at is null
         and s.expires_at > now());
$$;

create or replace function app.require_view_as(p_subject uuid, p_kind text default 'craftsman')
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.view_as_active(p_subject, p_kind) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
end;
$$;

revoke all on function app.view_as_subject_ok(uuid, text) from public, anon, service_role;
revoke all on function app.view_as_active(uuid, text) from public, anon, service_role;
revoke all on function app.require_view_as(uuid, text) from public, anon, service_role;
-- Callable by signed-in users (RLS policies and admin_view_* run as the caller); each answers only about the CALLER's own authority.
grant execute on function app.view_as_subject_ok(uuid, text) to authenticated;
grant execute on function app.view_as_active(uuid, text) to authenticated;
grant execute on function app.require_view_as(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Begin / current / end
-- ---------------------------------------------------------------------------
create or replace function public.admin_view_as_begin(p_subject uuid, p_kind text default 'craftsman')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_auth  uuid := nullif((select auth.jwt()) ->> 'session_id', '')::uuid;
  v_s     public.admin_view_sessions;
  v_old   public.admin_view_sessions;
begin
  if v_auth is null or not app.view_as_subject_ok(p_subject, p_kind) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || p_subject::text || ':' || p_kind, 0));

  -- A lapsed (never explicitly ended) session is closed so the live-row uniqueness holds.
  update public.admin_view_sessions
     set ended_at = least(now(), expires_at)
   where admin_user_id = v_actor and subject_user_id = p_subject and account_kind = p_kind
     and ended_at is null and expires_at <= now();

  -- A view opened in ANOTHER login session is never reused: it is closed (audited) and a new authorized start follows.
  for v_old in
    update public.admin_view_sessions
       set ended_at = now()
     where admin_user_id = v_actor and subject_user_id = p_subject and account_kind = p_kind
       and ended_at is null and auth_session_id is distinct from v_auth
    returning *
  loop
    perform app.record_audit_event('admin.view_as.ended', 'user', p_subject, null, jsonb_build_object(
      'kind', p_kind, 'session_id', v_old.id, 'reason', 'session_changed'));
  end loop;

  select * into v_s from public.admin_view_sessions
   where admin_user_id = v_actor and subject_user_id = p_subject and account_kind = p_kind and ended_at is null;

  if not found then
    insert into public.admin_view_sessions (admin_user_id, subject_user_id, account_kind, auth_session_id, expires_at)
    values (v_actor, p_subject, p_kind, v_auth, now() + interval '30 minutes')
    returning * into v_s;
    perform app.record_audit_event('admin.view_as.started', 'user', p_subject, null, jsonb_build_object(
      'kind', p_kind, 'session_id', v_s.id, 'expires_at', v_s.expires_at));
  end if;

  return jsonb_build_object(
    'session_id', v_s.id, 'kind', v_s.account_kind, 'subject_user_id', v_s.subject_user_id,
    'started_at', v_s.started_at, 'expires_at', v_s.expires_at,
    'subject_name', coalesce((select p.display_name from public.profiles p where p.user_id = p_subject), ''));
end;
$$;

-- Read the live session without opening a new one (guard + banner). Raises the generic error if there is none.
create or replace function public.admin_view_as_current(p_subject uuid, p_kind text default 'craftsman')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_s public.admin_view_sessions;
begin
  perform app.require_view_as(p_subject, p_kind);
  select * into v_s from public.admin_view_sessions s
   where s.admin_user_id = (select auth.uid()) and s.subject_user_id = p_subject
     and s.account_kind = p_kind and s.ended_at is null and s.expires_at > now()
     and s.auth_session_id is not distinct from nullif((select auth.jwt()) ->> 'session_id', '')::uuid;
  return jsonb_build_object(
    'session_id', v_s.id, 'kind', v_s.account_kind, 'subject_user_id', v_s.subject_user_id,
    'started_at', v_s.started_at, 'expires_at', v_s.expires_at,
    'subject_name', coalesce((select p.display_name from public.profiles p where p.user_id = p_subject), ''));
end;
$$;

-- End the caller's live session for one subject (Exit). Allowed even if the permission has since been revoked, so a
-- demoted admin can always close their own session; it only ever touches the caller's own rows.
create or replace function public.admin_view_as_end(p_subject uuid, p_kind text default 'craftsman')
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_s     public.admin_view_sessions;
begin
  if v_actor is null then raise exception 'not permitted' using errcode = '42501'; end if;
  update public.admin_view_sessions
     set ended_at = least(now(), expires_at)
   where admin_user_id = v_actor and subject_user_id = p_subject and account_kind = p_kind and ended_at is null
  returning * into v_s;
  if not found then return false; end if;
  perform app.record_audit_event('admin.view_as.ended', 'user', p_subject, null, jsonb_build_object(
    'kind', p_kind, 'session_id', v_s.id, 'reason', 'exit'));
  return true;
end;
$$;

-- End every live session of the caller (sign-out). Returns how many were closed.
create or replace function public.admin_view_as_end_all()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_s     public.admin_view_sessions;
  v_n     integer := 0;
begin
  if v_actor is null then return 0; end if;
  for v_s in
    update public.admin_view_sessions
       set ended_at = least(now(), expires_at)
     where admin_user_id = v_actor and ended_at is null
    returning *
  loop
    v_n := v_n + 1;
    perform app.record_audit_event('admin.view_as.ended', 'user', v_s.subject_user_id, null, jsonb_build_object(
      'kind', v_s.account_kind, 'session_id', v_s.id, 'reason', 'sign_out'));
  end loop;
  return v_n;
end;
$$;

revoke all on function public.admin_view_as_begin(uuid, text) from public, anon, service_role;
revoke all on function public.admin_view_as_current(uuid, text) from public, anon, service_role;
revoke all on function public.admin_view_as_end(uuid, text) from public, anon, service_role;
revoke all on function public.admin_view_as_end_all() from public, anon, service_role;
grant execute on function public.admin_view_as_begin(uuid, text) to authenticated;
grant execute on function public.admin_view_as_current(uuid, text) to authenticated;
grant execute on function public.admin_view_as_end(uuid, text) to authenticated;
grant execute on function public.admin_view_as_end_all() to authenticated;

comment on function public.admin_view_as_begin(uuid, text) is 'Open (or reuse) a 30-minute, non-sliding, audited read-only view session on another user. Requires users.view_as and an eligible subject; one generic error otherwise. Never changes auth.uid().';
comment on function public.admin_view_as_current(uuid, text) is 'The caller''s live view session for a subject (guard + banner). Generic 42501 when there is none.';
comment on function public.admin_view_as_end(uuid, text) is 'Exit: end the caller''s own live view session for a subject (audited). Works even after the permission was revoked.';
comment on function public.admin_view_as_end_all() is 'Sign-out: end every live view session of the caller (audited).';
