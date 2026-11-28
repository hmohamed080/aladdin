-- ===========================================================================
-- Account sessions and known devices (Settings -> Privacy & security).
--
-- Active sessions: a caller can list, and end, their OWN Supabase Auth
-- sessions. auth.sessions is not exposed to PostgREST, so the two functions
-- below are the only window onto it; both are scoped to auth.uid() and never
-- return another user's rows or any token material.
--
-- Known devices: public.known_devices remembers each browser that has signed
-- in (one row per user + device cookie id). Own-row read only; every write goes
-- through the two functions below. last_session_id lets "remove a device" also
-- end that device's session.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Sessions
-- ---------------------------------------------------------------------------
create or replace function public.my_active_sessions()
returns table (
  id             uuid,
  user_agent     text,
  ip             text,
  created_at     timestamptz,
  last_active_at timestamptz,
  is_current     boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id,
         left(s.user_agent, 400),
         host(s.ip),
         s.created_at,
         greatest(s.updated_at, s.refreshed_at at time zone 'utc', s.created_at),
         s.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
  from auth.sessions s
  where s.user_id = (select auth.uid())
    and (s.not_after is null or s.not_after > now())
  order by 6 desc, 5 desc;
$$;
comment on function public.my_active_sessions() is
  'The caller''s own live Auth sessions (never another user''s; no token material). is_current marks the session behind the caller''s JWT.';
revoke execute on function public.my_active_sessions() from public;
grant execute on function public.my_active_sessions() to authenticated;

create or replace function public.revoke_my_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_current uuid := nullif((select auth.jwt()) ->> 'session_id', '')::uuid;
  v_deleted integer;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  -- The caller's own session is ended through a normal sign-out, never here.
  if p_session_id is null or p_session_id = v_current then
    return false;
  end if;
  delete from auth.sessions where id = p_session_id and user_id = v_uid;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;
comment on function public.revoke_my_session(uuid) is
  'Ends one of the caller''s OTHER sessions (its refresh tokens go with it). Returns false for the current session, an unknown id, or another user''s session.';
revoke execute on function public.revoke_my_session(uuid) from public;
grant execute on function public.revoke_my_session(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Known devices
-- ---------------------------------------------------------------------------
create table public.known_devices (
  user_id         uuid        not null references auth.users (id) on delete cascade,
  device_id       uuid        not null,
  user_agent      text        not null default '' check (char_length(user_agent) <= 400),
  last_session_id uuid,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  constraint pk_known_devices primary key (user_id, device_id)
);
comment on table public.known_devices is
  'Browsers/devices that have signed in to an account, keyed by a random device cookie id. Own-row read only; written by touch_known_device / forget_known_device.';

alter table public.known_devices enable row level security;
create policy known_devices_select_own on public.known_devices
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.known_devices from anon, authenticated;
grant select on public.known_devices to authenticated;

create or replace function public.touch_known_device(p_device_id uuid, p_user_agent text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_session uuid := nullif((select auth.jwt()) ->> 'session_id', '')::uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_device_id is null then
    raise exception 'device id is required' using errcode = '22023';
  end if;

  insert into public.known_devices as d (user_id, device_id, user_agent, last_session_id)
  values (v_uid, p_device_id, left(coalesce(p_user_agent, ''), 400), v_session)
  on conflict (user_id, device_id) do update
    set user_agent = excluded.user_agent,
        last_session_id = excluded.last_session_id,
        last_seen_at = now();

  -- Bounded: keep the 50 most recently seen devices per user.
  delete from public.known_devices k
  where k.user_id = v_uid
    and k.device_id in (
      select o.device_id from public.known_devices o
      where o.user_id = v_uid
      order by o.last_seen_at desc
      offset 50
    );
end;
$$;
comment on function public.touch_known_device(uuid, text) is
  'Records (or refreshes) the calling browser as a known device of the caller, remembering the session it signed in with.';
revoke execute on function public.touch_known_device(uuid, text) from public;
grant execute on function public.touch_known_device(uuid, text) to authenticated;

create or replace function public.forget_known_device(p_device_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_current uuid := nullif((select auth.jwt()) ->> 'session_id', '')::uuid;
  v_session uuid;
  v_deleted integer;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select k.last_session_id into v_session
  from public.known_devices k
  where k.user_id = v_uid and k.device_id = p_device_id;

  delete from public.known_devices where user_id = v_uid and device_id = p_device_id;
  get diagnostics v_deleted = row_count;

  -- Removing a device also ends the session it signed in with (never the caller's own).
  if v_session is not null and v_session is distinct from v_current then
    delete from auth.sessions where id = v_session and user_id = v_uid;
  end if;
  return v_deleted > 0;
end;
$$;
comment on function public.forget_known_device(uuid) is
  'Removes one of the caller''s known devices and ends the session it signed in with (never the current session). Returns false when the device is not the caller''s.';
revoke execute on function public.forget_known_device(uuid) from public;
grant execute on function public.forget_known_device(uuid) to authenticated;
