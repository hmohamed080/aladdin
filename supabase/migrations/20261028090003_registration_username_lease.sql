-- ===========================================================================
-- Registration resume + pending-username lease
--
-- PROBLEM. public.username_available() and public.profile_set_username() only
-- looked at CONFIRMED profiles. A username staged in app.pending_registrations
-- during the email-code window reserved nothing, so two unconfirmed
-- registrations could both pick the same name and the slower one only found
-- out after verifying its email.
--
-- DESIGN. The pending row itself becomes a short-lived LEASE on its username:
--
--   * Lease = 30 minutes from the moment THIS user first staged THIS name
--     (username_reserved_at). A repeat sign-up for the same unconfirmed user
--     and the same name keeps the ORIGINAL lease; it never extends it. Once a
--     user's lease on a name has run out it is not granted again for that
--     name (the row keeps the account type and drops the username), so one
--     account cannot squat a name forever by re-submitting sign-up. Picking a
--     DIFFERENT name starts a new lease and releases the old one (one row per
--     user, so at most one active lease per account).
--   * Concurrency: every lease grant and every final claim takes the same
--     transaction-scoped advisory lock on the normalized name, then checks
--     profiles + reserved words + other users' active leases. Two concurrent
--     saves or a save racing a claim serialize on that lock; exactly one wins.
--   * A lease never blocks its OWN holder, and is ignored once expired.
--   * The final claim (profile_set_username) stays authoritative: the unique
--     index on profiles.username_normalized is still the last word. It now
--     also refuses a name another user holds an ACTIVE lease on, so a
--     verified account cannot snipe a name mid-registration.
--   * A registration whose username lease could not be granted (taken,
--     reserved, leased by someone else, or lease already used up) still keeps
--     its account type; pending_registration_consume() returns a NULL username
--     and the app sends the person to finish-registration to pick another
--     name. Nothing about the account or the email is revealed.
--
-- COMPATIBILITY. Additive for existing accounts: profiles and their unique
-- index are untouched. Existing pending rows (all short-lived) get
-- username_reserved_at = created_at, so a row older than 30 minutes simply has
-- no active lease. pending_registration_save now RETURNS boolean (was void):
-- the only caller (frontend admin-server savePendingRegistration) ignores the
-- value, so an old frontend keeps working against the new function. Grants
-- are unchanged: save = service_role only; consume = authenticated;
-- username_available = anon + authenticated; profile_set_username =
-- authenticated.
--
-- The same migration widens the shared durable auth limiter
-- (app.phone_auth_attempts / public.phone_auth_consume_limit) with an
-- 'email-resend' action so "send me a new code" is throttled per email and per
-- IP on the server, independently of GoTrue's own limits. HMAC keys only.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Lease columns on the existing staging table.
-- ---------------------------------------------------------------------------
alter table app.pending_registrations
  alter column username drop not null,
  add column username_reserved_at timestamptz;

update app.pending_registrations
   set username_reserved_at = created_at
 where username is not null and username_reserved_at is null;

alter table app.pending_registrations
  add constraint ck_pending_registrations_lease_shape
    check ((username is null) = (username_reserved_at is null));

create index ix_pending_registrations_username_lease
  on app.pending_registrations (app.normalize_username_for_uniqueness(username), username_reserved_at)
  where username is not null;

comment on column app.pending_registrations.username is
  'The username this unconfirmed registration holds a lease on, or NULL when no lease could be granted (taken, reserved, leased by someone else, or this user''s lease on it already expired). NULL never blocks anyone.';
comment on column app.pending_registrations.username_reserved_at is
  'When this user''s lease on `username` began. The lease is active while now() < username_reserved_at + app.username_lease_interval(). Never moved forward by a repeat sign-up for the same name.';

create or replace function app.username_lease_interval()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '30 minutes' $$;
comment on function app.username_lease_interval() is
  'Maximum lifetime of a pending-registration username lease. One place to change it.';
revoke all on function app.username_lease_interval() from public, anon, authenticated, service_role;

-- Is `p_norm` held by an ACTIVE lease of a user other than `p_except`?
create or replace function app.username_leased_by_other(p_norm text, p_except uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.pending_registrations pr
     where pr.username is not null
       and app.normalize_username_for_uniqueness(pr.username) = p_norm
       and pr.username_reserved_at > now() - app.username_lease_interval()
       and pr.user_id is distinct from p_except
  );
$$;
revoke all on function app.username_leased_by_other(text, uuid) from public, anon, authenticated, service_role;

-- The one lock every lease grant and every final claim takes, keyed by the
-- normalized name. Transaction-scoped: released at commit/rollback.
create or replace function app.lock_username(p_norm text)
returns void
language sql
set search_path = ''
as $$ select pg_advisory_xact_lock(hashtextextended('aladdin.username:' || p_norm, 0)) $$;
revoke all on function app.lock_username(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. pending_registration_save — stage + lease. Returns whether the username
--    lease is held after the call. Same signature; return type void → boolean.
-- ---------------------------------------------------------------------------
drop function public.pending_registration_save(uuid, text, public.activity_audience_kind, text, int);

create function public.pending_registration_save(
  p_user_id        uuid,
  p_username       text,
  p_audience_kind  public.activity_audience_kind,
  p_audience_value text,
  p_ttl_minutes    int default 30
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username   text := btrim(p_username);
  v_norm       text;
  v_existing   app.pending_registrations;
  v_reserved   timestamptz;
  v_grant      boolean := false;
begin
  if p_user_id is null then
    raise exception 'user id is required' using errcode = '22023';
  end if;

  -- Housekeeping: rows whose staging AND lease are both long gone.
  delete from app.pending_registrations
   where expires_at < now() - interval '1 day'
     and (username_reserved_at is null or username_reserved_at < now() - interval '1 day');

  if v_username is not null and v_username <> ''
     and char_length(v_username) between 3 and 24
     and v_username ~ '^[a-zA-Z][a-zA-Z0-9]*([._][a-zA-Z0-9]+)*$' then
    v_norm := app.normalize_username_for_uniqueness(v_username);
    perform app.lock_username(v_norm);

    select * into v_existing from app.pending_registrations where user_id = p_user_id for update;

    if found and v_existing.username is not null
       and app.normalize_username_for_uniqueness(v_existing.username) = v_norm then
      -- Same user, same name: keep the ORIGINAL lease, never extend it.
      v_reserved := v_existing.username_reserved_at;
      v_grant := v_reserved > now() - app.username_lease_interval();
    else
      v_reserved := now();
      v_grant := true;
    end if;

    if v_grant then
      v_grant := not exists (select 1 from public.reserved_usernames where normalized = v_norm)
             and not exists (select 1 from public.profiles where username_normalized = v_norm)
             and not app.username_leased_by_other(v_norm, p_user_id);
    end if;
  end if;

  insert into app.pending_registrations
    (user_id, username, username_reserved_at, audience_kind, audience_value, expires_at)
  values (p_user_id,
          case when v_grant then v_username end,
          case when v_grant then v_reserved end,
          p_audience_kind, p_audience_value,
          now() + make_interval(mins => greatest(coalesce(p_ttl_minutes, 30), 1)))
  on conflict (user_id) do update
    set username             = excluded.username,
        username_reserved_at = excluded.username_reserved_at,
        audience_kind        = excluded.audience_kind,
        audience_value       = excluded.audience_value,
        expires_at           = excluded.expires_at,
        updated_at           = now();

  return v_grant;
end;
$$;
comment on function public.pending_registration_save(uuid, text, public.activity_audience_kind, text, int) is
  'Upserts the pending-registration row for an explicit user id and tries to take a 30-minute lease on its username (see app.username_lease_interval). Returns true when the lease is held. Never extends an existing lease for the same user and name; never grants a name that is reserved, taken, or actively leased by another user. Granted to service_role ONLY — it accepts an arbitrary user id and is called exclusively from the admin client right after a trusted signUp() response.';
revoke execute on function public.pending_registration_save(uuid, text, public.activity_audience_kind, text, int) from public, anon, authenticated;
grant execute on function public.pending_registration_save(uuid, text, public.activity_audience_kind, text, int) to service_role;

-- ---------------------------------------------------------------------------
-- 3. pending_registration_consume — username only while its lease is active.
-- ---------------------------------------------------------------------------
create or replace function public.pending_registration_consume()
returns table (username text, audience_kind public.activity_audience_kind, audience_value text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row app.pending_registrations;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_row from app.pending_registrations
   where user_id = v_uid and expires_at > now();
  if not found then
    -- Nothing valid to restore; drop any stale lease this user still holds.
    delete from app.pending_registrations where user_id = v_uid;
    return;
  end if;

  delete from app.pending_registrations where user_id = v_uid;

  username := case when v_row.username_reserved_at > now() - app.username_lease_interval()
                   then v_row.username end;
  audience_kind := v_row.audience_kind;
  audience_value := v_row.audience_value;
  return next;
end;
$$;
comment on function public.pending_registration_consume() is
  'Reads and deletes (consumes exactly once) the CALLER''s own pending-registration row, via auth.uid(). Returns an empty set if none exists or it expired. `username` is NULL when no active lease backs it — the caller must then ask for a username. The caller MUST still revalidate everything (the final profile_set_username claim is authoritative).';
revoke execute on function public.pending_registration_consume() from public, anon, service_role;
grant execute on function public.pending_registration_consume() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. username_available — also false while another registration leases it.
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
  if exists (select 1 from public.profiles where username_normalized = v_norm) then
    return false;
  end if;
  -- A lease held by the caller themself never counts against them.
  return not app.username_leased_by_other(v_norm, (select auth.uid()));
end;
$$;
comment on function public.username_available(text) is
  'Returns ONLY a boolean — "malformed", "reserved", "taken" and "leased by a pending registration" all read as false, so the client cannot tell them apart. Advisory: the final profile_set_username claim decides.';
revoke execute on function public.username_available(text) from public, service_role;
grant execute on function public.username_available(text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 5. profile_set_username — same lock, refuses another user's active lease.
--    Body otherwise identical to 20260924090001_username_identity.sql.
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
  perform app.lock_username(v_norm);
  -- Reserved, leased-by-someone-else and taken all fail with the SAME
  -- errcode/message, so none is distinguishable from the error alone.
  if exists (select 1 from public.reserved_usernames where normalized = v_norm)
     or app.username_leased_by_other(v_norm, v_uid) then
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

  -- The name is now owned outright; any lease this user held is released.
  update app.pending_registrations
     set username = null, username_reserved_at = null, updated_at = now()
   where user_id = v_uid and username is not null;

  perform app.record_audit_event('profile.username_set', 'user', v_uid, null,
    jsonb_build_object('username', p_username));
end;
$$;
comment on function public.profile_set_username(text) is
  'The only write path for profiles.username. Takes the per-name advisory lock shared with pending_registration_save, refuses a reserved name or one another user holds an active registration lease on, and raises the SAME errcode (23505, "username is unavailable") for reserved, leased and taken names alike. The unique index on profiles.username_normalized remains the final authority.';
revoke execute on function public.profile_set_username(text) from public, anon, service_role;
grant execute on function public.profile_set_username(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Shared durable limiter: add 'email-resend' (sign-up code resends and
--    "continue registration"). Subject 'phone' carries the HMAC of the
--    contact (email here); the column name is historical.
-- ---------------------------------------------------------------------------
alter table app.phone_auth_attempts drop constraint phone_auth_attempts_action_check;
alter table app.phone_auth_attempts
  add constraint phone_auth_attempts_action_check
  check (action in ('sign-in', 'sign-up', 'email-resend'));

create or replace function public.phone_auth_consume_limit(p_action text, p_ip_key text, p_phone_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_subject text;
  v_key text;
  v_count integer;
  v_limit integer;
  v_allowed boolean := true;
begin
  if p_action is null or p_action not in ('sign-in', 'sign-up', 'email-resend')
     or p_ip_key is null or p_ip_key !~ '^[a-f0-9]{64}$'
     or p_phone_key is null or p_phone_key !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid throttle input' using errcode = '22023';
  end if;
  -- Bound retention; indexed window_start supports expiry without full scans.
  delete from app.phone_auth_attempts where window_start < v_now - interval '1 day';
  -- Always lock IP then contact. The UPSERT row lock serializes concurrent attempts
  -- across app replicas; a new IP cannot reset an account bucket.
  foreach v_subject in array array['ip', 'phone'] loop
    v_key := case when v_subject = 'ip' then p_ip_key else p_phone_key end;
    v_limit := case p_action
                 when 'sign-up' then case when v_subject = 'ip' then 10 else 5 end
                 when 'email-resend' then case when v_subject = 'ip' then 20 else 5 end
                 else case when v_subject = 'ip' then 30 else 10 end
               end;
    insert into app.phone_auth_attempts as buckets (action, subject, key_hash, window_start, attempts)
      values (p_action, v_subject, v_key, v_now, 1)
    on conflict (action, subject, key_hash) do update set
      attempts = case when buckets.window_start <= v_now - interval '15 minutes' then 1
                      else least(buckets.attempts + 1, 1000000) end,
      window_start = case when buckets.window_start <= v_now - interval '15 minutes' then v_now
                          else buckets.window_start end
    returning attempts into v_count;
    if v_count > v_limit then
      -- An IP already over budget cannot grow storage by rotating contact keys.
      if v_subject = 'ip' then return false; end if;
      v_allowed := false;
    end if;
  end loop;
  return v_allowed;
end;
$$;
revoke all on function public.phone_auth_consume_limit(text, text, text) from public, anon, authenticated;
grant execute on function public.phone_auth_consume_limit(text, text, text) to service_role;
