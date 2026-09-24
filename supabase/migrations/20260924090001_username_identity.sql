-- ===========================================================================
-- Staging-prep Increment 1 — username identity
--
-- Username becomes MANDATORY registration data (not optional profile
-- completion — see public.my_registration_state()'s new `username_pending`
-- state, added by 20260924090007_registration_state_access_ready.sql). This
-- migration only builds the storage/validation/uniqueness layer; the gate
-- itself lives in that later migration.
--
-- NORMALIZATION IS NON-DESTRUCTIVE, ON PURPOSE. An earlier draft of this
-- feature lowercased AND stripped disallowed characters in one function,
-- silently turning `ahmed!` into `ahmed` — normalization and validation were
-- conflated, so a caller reading back a "successful" write could not tell
-- their input had been altered. That is corrected here: normalization
-- (`app.normalize_username_for_uniqueness`) does exactly one thing — trim +
-- lowercase, purely to drive the case-insensitive uniqueness index. Shape is
-- enforced by CHECK constraints that REJECT a disallowed character, never
-- rewrite it.
--
-- `auth.users` and the password sign-in identifier are untouched. Username
-- lives only on `profiles`, decoupled from GoTrue's identity table on
-- purpose, so a later "sign in with Email OR Username" needs no second
-- migration — only a lookup from username to email at the login form.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. app.normalize_username_for_uniqueness — trim + lowercase, nothing else
-- ---------------------------------------------------------------------------
create or replace function app.normalize_username_for_uniqueness(p_username text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(p_username));
$$;

comment on function app.normalize_username_for_uniqueness(text) is
  'Case-insensitive uniqueness key for a username: trim + lowercase, and NOTHING else. Never strips or rewrites characters — a shape violation is rejected by ck_profiles_username_shape/ck_profiles_username_length instead of being silently sanitized here. Feeds uq_profiles_username_normalized only.';

-- ---------------------------------------------------------------------------
-- 2. profiles.username / username_normalized
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column username text,
  add column username_normalized text
    generated always as (app.normalize_username_for_uniqueness(username)) stored;

alter table public.profiles
  add constraint ck_profiles_username_length check (
    username is null or char_length(username) between 3 and 24
  ),
  add constraint ck_profiles_username_shape check (
    -- Starts with a letter; letters/digits; '.'/'_' allowed only as an
    -- interior separator (never leading, trailing, or doubled). Anything
    -- outside this shape is REFUSED, never rewritten.
    username is null or username ~ '^[a-zA-Z][a-zA-Z0-9]*([._][a-zA-Z0-9]+)*$'
  );

comment on column public.profiles.username is
  'Public, unique (case-insensitively) handle. Written only via public.profile_set_username — never a direct client UPDATE grant. NULL until the caller completes the mandatory username step (see my_registration_state()''s username_pending state).';

create unique index uq_profiles_username_normalized
  on public.profiles (username_normalized)
  where username_normalized is not null;

-- ---------------------------------------------------------------------------
-- 3. reserved_usernames — a name nobody may claim, indistinguishable in the
--    client-facing error from "already taken" (see profile_set_username).
-- ---------------------------------------------------------------------------
create table public.reserved_usernames (
  normalized text primary key
);
comment on table public.reserved_usernames is
  'Usernames no caller may claim (product/brand/system words). Seeded by migration only — no client write grant. profile_set_username raises the SAME error shape for "reserved" as for "taken", so neither case is distinguishable from the response alone.';

revoke all on public.reserved_usernames from anon, authenticated, service_role;
grant select on public.reserved_usernames to authenticated, service_role;
alter table public.reserved_usernames enable row level security;
create policy reserved_usernames_select_all on public.reserved_usernames
  for select to authenticated using (true);

insert into public.reserved_usernames (normalized) values
  ('admin'), ('administrator'), ('support'), ('aladdin'), ('root'), ('api'),
  ('auth'), ('system'), ('help'), ('security'), ('moderator'), ('staff'),
  ('null'), ('undefined'), ('me'), ('test'), ('billing'), ('privacy'), ('legal'), ('www');

-- ---------------------------------------------------------------------------
-- 4. public.username_available — boolean-only, no distinguishing signal
--    between "reserved" and "taken" and no error is raised at all.
-- ---------------------------------------------------------------------------
create or replace function public.username_available(p_username text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_norm text;
begin
  if p_username is null or p_username !~ '^[a-zA-Z][a-zA-Z0-9]*([._][a-zA-Z0-9]+)*$'
     or char_length(p_username) not between 3 and 24 then
    return false;
  end if;
  v_norm := app.normalize_username_for_uniqueness(p_username);
  if exists (select 1 from public.reserved_usernames where normalized = v_norm) then
    return false;
  end if;
  return not exists (select 1 from public.profiles where username_normalized = v_norm);
end;
$$;

comment on function public.username_available(text) is
  'Returns ONLY a boolean — never distinguishes "malformed", "reserved" and "taken" in its return value, so the client cannot enumerate reserved words or existing accounts from this call alone. Rate-limited at the Next.js layer (debounce + light per-IP throttle), not in Postgres.';

revoke execute on function public.username_available(text) from public;
grant execute on function public.username_available(text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 5. public.profile_set_username — the only write path
-- ---------------------------------------------------------------------------
create or replace function public.profile_set_username(p_username text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_norm text;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_username is null or char_length(p_username) not between 3 and 24 then
    raise exception 'username must be between 3 and 24 characters' using errcode = '22023';
  end if;
  if p_username !~ '^[a-zA-Z][a-zA-Z0-9]*([._][a-zA-Z0-9]+)*$' then
    raise exception 'username may contain only letters, digits, "." and "_", must start with a letter, and may not start, end, or double up on separators'
      using errcode = '22023';
  end if;

  v_norm := app.normalize_username_for_uniqueness(p_username);
  -- Reserved names fail with the SAME errcode/message shape as a uniqueness
  -- collision below — see the table's comment. Both read to the caller as
  -- "username.error.unavailable".
  if exists (select 1 from public.reserved_usernames where normalized = v_norm) then
    raise exception 'username is unavailable' using errcode = '23505';
  end if;

  begin
    update public.profiles set username = p_username where user_id = v_uid;
  exception
    when unique_violation then
      raise exception 'username is unavailable' using errcode = '23505';
  end;

  if not found then
    raise exception 'profile not found for the current user' using errcode = 'P0002';
  end if;

  perform app.record_audit_event('profile.username_set', 'user', v_uid, null,
    jsonb_build_object('username', p_username));
end;
$$;

comment on function public.profile_set_username(text) is
  'The only write path for profiles.username. Validates length/shape itself (defense in depth alongside ck_profiles_username_length/ck_profiles_username_shape) and raises the SAME errcode (23505, "username is unavailable") for a reserved name and for a genuine uniqueness collision, so neither is distinguishable from the error alone.';

revoke execute on function public.profile_set_username(text) from public;
grant execute on function public.profile_set_username(text) to authenticated;
