-- ===========================================================================
-- Secondary phone reservations (V1, unverified) + current-password confirmation
--
-- THE CONTRACT (owner decision, 2026-10-18):
--   * One UNVERIFIED secondary phone reservation per account, canonical E.164 only (the app normalizes with
--     libphonenumber-js, exactly like profile_set_phone; the database re-checks the outer shape).
--   * Global, atomic uniqueness across accounts and across primary/secondary claims. Every claim of a number
--     (a reservation, a primary phone written to profiles) takes the same transaction-scoped advisory lock on
--     that number, and partial unique indexes back it up.
--   * A reservation lasts 7 days; exactly one manual renewal adds 7 days (14 days at most). No auto-renewal,
--     no auto-displacement. Expiry is DERIVED from expires_at (nothing has to run at expiry); a stale row is
--     finalized lazily by the next operation that touches the number or the account.
--   * An ACTIVE reservation blocks every other account from the number, including primary signup/change
--     (enforced by a trigger on profiles.phone_e164, so every write path is covered).
--   * Expiry or cancellation releases the number and starts a 30-day global cooldown for it. During the
--     cooldown nobody may RESERVE it as a secondary; primary signup/change is NOT blocked by a cooldown.
--     Turning your own reserved secondary into your primary ends the reservation as `converted`, which
--     starts no cooldown.
--   * Only Admin Staff holding `phones.cooldown_override` may lift a cooldown, with a mandatory reason; the
--     override row and its audit event are immutable. The built-in Support role stays read-only (PD-004), so
--     the permission is held by Super Admin and is granted to the Support staff who are authorized for it
--     through a role (Staff · Roles), never implicitly.
--   * No Phone OTP in V1: a secondary phone is never verified, never a login credential, never a recovery
--     channel and never a verified contact. It lives ONLY in this table; no auth, recovery or contact path
--     reads it. Organization / showroom contact numbers (organizations.contact_phone, organization contacts)
--     are a separate namespace and are not touched.
--   * Adding, changing or promoting the secondary phone needs the CURRENT PASSWORD: account_password_confirm
--     checks it against the account's own Auth hash and issues a single-use authorization receipt that lives
--     60 seconds and is bound to (user, operation, target number). 5 wrong passwords in 15 minutes lock
--     confirmation for 15 minutes. A failed confirmation is recorded (the function returns a status instead
--     of raising, so the counter is never rolled back).
--   * A phone-login (Craftsman) account cannot move its primary phone here: the existing
--     guard_phone_password_identity trigger keeps the login phone fixed, so promotion fails closed for it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create type public.secondary_phone_status as enum ('active', 'expired', 'cancelled', 'converted');

create table public.secondary_phone_reservations (
  id             uuid primary key default extensions.gen_random_uuid(),
  user_id        uuid not null references public.users (id) on delete cascade,
  phone_e164     text not null,
  status         public.secondary_phone_status not null default 'active',
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  renewal_count  smallint not null default 0,
  renewed_at     timestamptz,
  ended_at       timestamptz,
  constraint ck_spr_phone check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint ck_spr_renewals check (renewal_count between 0 and 1),
  constraint ck_spr_window check (expires_at <= created_at + interval '14 days' and expires_at > created_at),
  constraint ck_spr_ended check ((status = 'active') = (ended_at is null))
);
comment on table public.secondary_phone_reservations is
  'Unverified secondary phone reservations (V1, no OTP). Never a login credential, recovery channel or verified contact. Written only by the secondary_phone_* RPCs.';
create unique index uq_spr_active_phone on public.secondary_phone_reservations (phone_e164) where status = 'active';
create unique index uq_spr_active_user on public.secondary_phone_reservations (user_id) where status = 'active';
create index ix_spr_phone_ended on public.secondary_phone_reservations (phone_e164, ended_at desc) where status in ('expired', 'cancelled');

alter table public.secondary_phone_reservations enable row level security;
revoke all on public.secondary_phone_reservations from public, anon, authenticated, service_role;

create table public.phone_cooldown_overrides (
  id             uuid primary key default extensions.gen_random_uuid(),
  phone_e164     text not null constraint ck_pco_phone check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  overridden_by  uuid not null references public.users (id),
  reason         text not null constraint ck_pco_reason check (char_length(btrim(reason)) between 1 and 500),
  created_at     timestamptz not null default now()
);
comment on table public.phone_cooldown_overrides is
  'Immutable Support overrides of the 30-day secondary-phone cooldown. An override lifts every cooldown of that number that started at or before it.';
create index ix_pco_phone on public.phone_cooldown_overrides (phone_e164, created_at desc);
alter table public.phone_cooldown_overrides enable row level security;
revoke all on public.phone_cooldown_overrides from public, anon, authenticated, service_role;

create or replace function app.guard_phone_cooldown_override_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'cooldown overrides are immutable' using errcode = '42501';
end;
$$;
revoke all on function app.guard_phone_cooldown_override_immutable() from public, anon, authenticated;
create trigger guard_phone_cooldown_override_immutable before update or delete on public.phone_cooldown_overrides
  for each row execute function app.guard_phone_cooldown_override_immutable();

-- Password confirmation throttle (one row per account) and the receipts it issues.
create table app.password_confirm_attempts (
  user_id       uuid primary key references public.users (id) on delete cascade,
  window_start  timestamptz not null,
  failures      smallint not null default 0,
  locked_until  timestamptz
);
alter table app.password_confirm_attempts enable row level security;
revoke all on app.password_confirm_attempts from public, anon, authenticated, service_role;

create table app.reauth_receipts (
  id          uuid primary key default extensions.gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  operation   text not null,
  target      text not null,
  created_at  timestamptz not null default clock_timestamp(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index ix_reauth_receipts_created on app.reauth_receipts (created_at);
alter table app.reauth_receipts enable row level security;
revoke all on app.reauth_receipts from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Permission and audit vocabulary
-- ---------------------------------------------------------------------------
insert into public.admin_permissions (key, resource, action, description, sort_order) values
  ('phones.cooldown_override', 'phones', 'cooldown_override',
   'Lift the 30-day cooldown on a released secondary phone number, with a mandatory reason (granted to authorized Support through a role; delegable).', 60)
on conflict (key) do nothing;
insert into public.admin_role_permissions (role_id, permission_key, is_locked)
select r.id, 'phones.cooldown_override', true
  from public.admin_roles r
 where r.key = 'super_admin'
on conflict (role_id, permission_key) do nothing;

do $$
declare
  v_def text;
  v_missing text[];
  v_add text[] := array[
    'account.password_confirmed', 'account.password_confirm_locked',
    'secondary_phone.reserved', 'secondary_phone.renewed', 'secondary_phone.cancelled',
    'secondary_phone.changed', 'secondary_phone.converted', 'phone_cooldown.overridden'];
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'ck_audit_action_known' and c.conrelid = 'public.audit_log'::regclass;
  if v_def is null or v_def !~ '\]\)\)\)( NOT VALID)?$' then
    raise exception 'ck_audit_action_known has an unexpected shape: %', coalesce(v_def, '<missing>');
  end if;
  select coalesce(array_agg(a order by a), '{}') into v_missing
    from unnest(v_add) a where position('''' || a || '''::text' in v_def) = 0;
  if cardinality(v_missing) > 0 then
    alter table public.audit_log drop constraint ck_audit_action_known;
    execute 'alter table public.audit_log add constraint ck_audit_action_known '
      || regexp_replace(v_def, '\]\)\)\)( NOT VALID)?$',
           (select ', ' || string_agg('''' || a || '''::text', ', ') || '])))' from unnest(v_missing) a) || ' NOT VALID');
  end if;
end $$;
alter table public.audit_log validate constraint ck_audit_action_known;

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
-- Audit metadata never carries a whole number: app.mask_phone (20260819090001, country code + last two digits).

-- The one lock every claim of a number takes (reservation, primary write, override).
create or replace function app.lock_phone(p_phone text)
returns void language sql volatile set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('aladdin.phone:' || p_phone, 0));
$$;
revoke all on function app.lock_phone(text) from public, anon, authenticated;

create or replace function app.require_canonical_phone(p_phone text)
returns text language plpgsql immutable set search_path = '' as $$
begin
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'phone number is not in a valid format' using errcode = '22023';
  end if;
  return p_phone;
end;
$$;
revoke all on function app.require_canonical_phone(text) from public, anon, authenticated;

-- Finalize reservations whose time ran out (lazy expiry). Call under the relevant lock.
create or replace function app.finalize_expired_phone_reservations(p_phone text, p_user_id uuid)
returns void language sql volatile security definer set search_path = '' as $$
  update public.secondary_phone_reservations
     set status = 'expired', ended_at = expires_at
   where status = 'active' and expires_at <= now()
     and (phone_e164 = p_phone or user_id = p_user_id);
$$;
revoke all on function app.finalize_expired_phone_reservations(text, uuid) from public, anon, authenticated;

-- When the 30-day cooldown on a number ends (NULL = no cooldown). Expired-but-not-finalized rows count from
-- their expires_at; a converted reservation never starts one; a Support override lifts every cooldown that
-- started at or before it.
create or replace function app.phone_cooldown_until(p_phone text)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select max(coalesce(r.ended_at, r.expires_at) + interval '30 days')
    from public.secondary_phone_reservations r
   where r.phone_e164 = p_phone
     and (r.status in ('expired', 'cancelled') or (r.status = 'active' and r.expires_at <= now()))
     and coalesce(r.ended_at, r.expires_at) + interval '30 days' > now()
     and not exists (select 1 from public.phone_cooldown_overrides o
                      where o.phone_e164 = p_phone and o.created_at >= coalesce(r.ended_at, r.expires_at));
$$;
revoke all on function app.phone_cooldown_until(text) from public, anon, authenticated;

-- Is the number someone's primary or login phone (any account other than p_except)?
create or replace function app.phone_is_primary_elsewhere(p_phone text, p_except uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.phone_e164 = p_phone and p.user_id is distinct from p_except)
      or exists (select 1 from auth.users au
                  where lower(au.email) = 'p' || substr(p_phone, 2) || '@craftsman-login.aladdin.invalid'
                    and au.id is distinct from p_except);
$$;
revoke all on function app.phone_is_primary_elsewhere(text, uuid) from public, anon, authenticated;

-- Consume a receipt: single-use, unexpired, bound to the caller, the operation and the target.
create or replace function app.consume_reauth_receipt(p_receipt uuid, p_operation text, p_target text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  update app.reauth_receipts
     set used_at = clock_timestamp()
   where id = p_receipt
     and user_id = (select auth.uid())
     and operation = p_operation
     and target = p_target
     and used_at is null
     and expires_at > clock_timestamp();
  if not found then
    raise exception 'password confirmation required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app.consume_reauth_receipt(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Current-password confirmation
-- ---------------------------------------------------------------------------
create or replace function public.account_password_confirm(p_password text, p_operation text, p_target text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := app.require_verified_caller();
  v_now  timestamptz := clock_timestamp();
  v_hash text;
  v_row  app.password_confirm_attempts%rowtype;
  v_id   uuid;
begin
  if p_operation is null or p_operation not in ('secondary_phone.reserve', 'secondary_phone.change', 'secondary_phone.convert') then
    raise exception 'unsupported operation' using errcode = '22023';
  end if;
  perform app.require_canonical_phone(p_target);
  if p_password is null or char_length(p_password) = 0 or char_length(p_password) > 200 then
    raise exception 'password required' using errcode = '22023';
  end if;

  insert into app.password_confirm_attempts (user_id, window_start) values (v_uid, v_now)
  on conflict (user_id) do nothing;
  select * into v_row from app.password_confirm_attempts where user_id = v_uid for update;

  if v_row.locked_until is not null and v_row.locked_until > v_now then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'retry_at', v_row.locked_until);
  end if;
  if v_row.locked_until is not null or v_row.window_start <= v_now - interval '15 minutes' then
    update app.password_confirm_attempts set window_start = v_now, failures = 0, locked_until = null where user_id = v_uid;
    v_row.failures := 0;
  end if;

  select au.encrypted_password into v_hash from auth.users au where au.id = v_uid;
  if v_hash is null or v_hash = '' then
    -- Social-only accounts have no password to confirm.
    return jsonb_build_object('ok', false, 'reason', 'no_password');
  end if;

  if extensions.crypt(p_password, v_hash) is distinct from v_hash then
    if v_row.failures + 1 >= 5 then
      update app.password_confirm_attempts set failures = 0, locked_until = v_now + interval '15 minutes' where user_id = v_uid;
      perform app.record_audit_event('account.password_confirm_locked', 'user', v_uid, null,
        jsonb_build_object('operation', p_operation));
      return jsonb_build_object('ok', false, 'reason', 'locked', 'retry_at', v_now + interval '15 minutes');
    end if;
    update app.password_confirm_attempts set failures = v_row.failures + 1 where user_id = v_uid;
    return jsonb_build_object('ok', false, 'reason', 'wrong_password', 'remaining', 4 - v_row.failures);
  end if;

  update app.password_confirm_attempts set failures = 0, window_start = v_now, locked_until = null where user_id = v_uid;
  delete from app.reauth_receipts where created_at < v_now - interval '1 day';
  insert into app.reauth_receipts (user_id, operation, target, created_at, expires_at)
  values (v_uid, p_operation, p_target, v_now, v_now + interval '60 seconds')
  returning id into v_id;
  perform app.record_audit_event('account.password_confirmed', 'user', v_uid, null,
    jsonb_build_object('operation', p_operation, 'target', app.mask_phone(p_target)));
  return jsonb_build_object('ok', true, 'receipt', v_id, 'expires_at', v_now + interval '60 seconds');
end;
$$;
comment on function public.account_password_confirm(text, text, text) is
  'Checks the caller''s CURRENT password against their own Auth hash and returns {ok, receipt} (single-use, 60 s, bound to user + operation + target) or {ok:false, reason: wrong_password|locked|no_password}. 5 wrong passwords in 15 minutes lock confirmation for 15 minutes. Returns a status instead of raising so a failure is always counted.';
revoke all on function public.account_password_confirm(text, text, text) from public, anon;
grant execute on function public.account_password_confirm(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Owner RPCs
-- ---------------------------------------------------------------------------
create or replace function app.secondary_phone_json(r public.secondary_phone_reservations)
returns jsonb language sql stable set search_path = '' as $$
  select case when r.id is null then null else jsonb_build_object(
    'id', r.id,
    'phone', r.phone_e164,
    'status', case when r.status = 'active' and r.expires_at <= now() then 'expired' else r.status::text end,
    'verified', false,
    'created_at', r.created_at,
    'expires_at', r.expires_at,
    'renewal_count', r.renewal_count,
    'can_renew', r.status = 'active' and r.expires_at > now() and r.renewal_count = 0) end;
$$;
revoke all on function app.secondary_phone_json(public.secondary_phone_reservations) from public, anon, authenticated;

create or replace function public.my_secondary_phone()
returns jsonb language sql stable security definer set search_path = '' as $$
  select app.secondary_phone_json(r)
    from public.secondary_phone_reservations r
   where r.user_id = (select auth.uid()) and r.status = 'active' and r.expires_at > now();
$$;
comment on function public.my_secondary_phone() is
  'The caller''s current (active, unexpired) secondary phone reservation, or NULL. Always unverified.';
revoke all on function public.my_secondary_phone() from public, anon;
grant execute on function public.my_secondary_phone() to authenticated;

-- Shared core of reserve / change: claim p_phone for v_uid under the number lock. Raises on any conflict.
create or replace function app.claim_secondary_phone(p_uid uuid, p_phone text)
returns public.secondary_phone_reservations
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_until timestamptz;
  v_own   boolean;
  r       public.secondary_phone_reservations;
begin
  perform app.lock_phone(p_phone);
  perform app.finalize_expired_phone_reservations(p_phone, p_uid);

  if exists (select 1 from public.profiles p where p.user_id = p_uid and p.phone_e164 = p_phone) then
    raise exception 'this is already your primary phone' using errcode = '22023';
  end if;
  if app.phone_is_primary_elsewhere(p_phone, p_uid)
     or exists (select 1 from public.secondary_phone_reservations x where x.phone_e164 = p_phone and x.status = 'active') then
    -- Enumeration-safe: never says which account or which kind of claim holds the number.
    raise exception 'phone number is unavailable' using errcode = '23505';
  end if;
  v_until := app.phone_cooldown_until(p_phone);
  if v_until is not null then
    v_own := exists (select 1 from public.secondary_phone_reservations x
                      where x.phone_e164 = p_phone and x.user_id = p_uid and x.status in ('expired', 'cancelled')
                        and x.ended_at + interval '30 days' > now());
    if v_own then
      raise exception 'phone number is in cooldown until %', v_until using errcode = '55P03';
    end if;
    raise exception 'phone number is unavailable' using errcode = '23505';
  end if;

  insert into public.secondary_phone_reservations (user_id, phone_e164, expires_at)
  values (p_uid, p_phone, now() + interval '7 days')
  returning * into r;
  return r;
end;
$$;
revoke all on function app.claim_secondary_phone(uuid, text) from public, anon, authenticated;

create or replace function public.secondary_phone_reserve(p_phone text, p_receipt uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_verified_caller();
  v_phone text := app.require_canonical_phone(p_phone);
  r public.secondary_phone_reservations;
begin
  perform app.consume_reauth_receipt(p_receipt, 'secondary_phone.reserve', v_phone);
  perform pg_advisory_xact_lock(hashtextextended('aladdin.phone-user:' || v_uid::text, 0));
  perform app.finalize_expired_phone_reservations(null, v_uid);
  if exists (select 1 from public.secondary_phone_reservations x where x.user_id = v_uid and x.status = 'active') then
    raise exception 'you already have a secondary phone; change it instead' using errcode = '23505';
  end if;
  r := app.claim_secondary_phone(v_uid, v_phone);
  perform app.record_audit_event('secondary_phone.reserved', 'user', v_uid, null,
    jsonb_build_object('reservation_id', r.id, 'phone', app.mask_phone(v_phone), 'expires_at', r.expires_at));
  return app.secondary_phone_json(r);
end;
$$;
revoke all on function public.secondary_phone_reserve(text, uuid) from public, anon;
grant execute on function public.secondary_phone_reserve(text, uuid) to authenticated;

-- Change = cancel the current reservation (its number enters the cooldown) and reserve the new one, atomically.
create or replace function public.secondary_phone_change(p_phone text, p_receipt uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_verified_caller();
  v_phone text := app.require_canonical_phone(p_phone);
  v_old public.secondary_phone_reservations;
  r public.secondary_phone_reservations;
begin
  perform app.consume_reauth_receipt(p_receipt, 'secondary_phone.change', v_phone);
  perform pg_advisory_xact_lock(hashtextextended('aladdin.phone-user:' || v_uid::text, 0));
  perform app.finalize_expired_phone_reservations(null, v_uid);
  select * into v_old from public.secondary_phone_reservations x where x.user_id = v_uid and x.status = 'active';
  if not found then
    raise exception 'no secondary phone to change' using errcode = 'P0002';
  end if;
  if v_old.phone_e164 = v_phone then
    raise exception 'this is already your secondary phone' using errcode = '22023';
  end if;
  perform app.lock_phone(v_old.phone_e164);
  update public.secondary_phone_reservations set status = 'cancelled', ended_at = now() where id = v_old.id;
  r := app.claim_secondary_phone(v_uid, v_phone);
  perform app.record_audit_event('secondary_phone.changed', 'user', v_uid, null,
    jsonb_build_object('from_reservation_id', v_old.id, 'reservation_id', r.id,
                       'from_phone', app.mask_phone(v_old.phone_e164), 'phone', app.mask_phone(v_phone)));
  return app.secondary_phone_json(r);
end;
$$;
revoke all on function public.secondary_phone_change(text, uuid) from public, anon;
grant execute on function public.secondary_phone_change(text, uuid) to authenticated;

create or replace function public.secondary_phone_renew()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_verified_caller();
  r public.secondary_phone_reservations;
begin
  perform pg_advisory_xact_lock(hashtextextended('aladdin.phone-user:' || v_uid::text, 0));
  perform app.finalize_expired_phone_reservations(null, v_uid);
  select * into r from public.secondary_phone_reservations x where x.user_id = v_uid and x.status = 'active' for update;
  if not found then
    raise exception 'no active secondary phone to renew' using errcode = 'P0002';
  end if;
  if r.renewal_count >= 1 then
    raise exception 'a secondary phone can be renewed only once' using errcode = '22023';
  end if;
  update public.secondary_phone_reservations
     set expires_at = expires_at + interval '7 days', renewal_count = 1, renewed_at = now()
   where id = r.id
  returning * into r;
  perform app.record_audit_event('secondary_phone.renewed', 'user', v_uid, null,
    jsonb_build_object('reservation_id', r.id, 'expires_at', r.expires_at));
  return app.secondary_phone_json(r);
end;
$$;
revoke all on function public.secondary_phone_renew() from public, anon;
grant execute on function public.secondary_phone_renew() to authenticated;

create or replace function public.secondary_phone_cancel()
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_verified_caller();
  r public.secondary_phone_reservations;
begin
  perform pg_advisory_xact_lock(hashtextextended('aladdin.phone-user:' || v_uid::text, 0));
  perform app.finalize_expired_phone_reservations(null, v_uid);
  select * into r from public.secondary_phone_reservations x where x.user_id = v_uid and x.status = 'active' for update;
  if not found then
    raise exception 'no active secondary phone to cancel' using errcode = 'P0002';
  end if;
  perform app.lock_phone(r.phone_e164);
  update public.secondary_phone_reservations set status = 'cancelled', ended_at = now() where id = r.id;
  perform app.record_audit_event('secondary_phone.cancelled', 'user', v_uid, null,
    jsonb_build_object('reservation_id', r.id, 'phone', app.mask_phone(r.phone_e164)));
end;
$$;
revoke all on function public.secondary_phone_cancel() from public, anon;
grant execute on function public.secondary_phone_cancel() to authenticated;

-- Promote the caller's own reserved secondary to their primary phone. Ends the reservation as `converted`
-- (no cooldown). Phone-login accounts are refused by guard_phone_password_identity.
create or replace function public.secondary_phone_make_primary(p_receipt uuid, p_country_iso2 text default null, p_national text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_verified_caller();
  r public.secondary_phone_reservations;
begin
  perform pg_advisory_xact_lock(hashtextextended('aladdin.phone-user:' || v_uid::text, 0));
  perform app.finalize_expired_phone_reservations(null, v_uid);
  select * into r from public.secondary_phone_reservations x where x.user_id = v_uid and x.status = 'active' for update;
  if not found then
    raise exception 'no active secondary phone' using errcode = 'P0002';
  end if;
  perform app.consume_reauth_receipt(p_receipt, 'secondary_phone.convert', r.phone_e164);
  if p_country_iso2 is not null and p_country_iso2 !~ '^[A-Z]{2}$' then
    raise exception 'invalid country code' using errcode = '22023';
  end if;
  perform app.lock_phone(r.phone_e164);
  -- End the reservation first so the primary-claim trigger sees no active reservation on the number.
  update public.secondary_phone_reservations set status = 'converted', ended_at = now() where id = r.id;
  begin
    update public.profiles
       set phone_e164 = r.phone_e164, phone_country_iso2 = p_country_iso2, phone_national = p_national
     where user_id = v_uid;
  exception
    when unique_violation then
      raise exception 'phone number is unavailable' using errcode = '23505';
  end;
  if not found then
    raise exception 'profile not found for the current user' using errcode = 'P0002';
  end if;
  perform app.record_audit_event('secondary_phone.converted', 'user', v_uid, null,
    jsonb_build_object('reservation_id', r.id, 'phone', app.mask_phone(r.phone_e164)));
end;
$$;
revoke all on function public.secondary_phone_make_primary(uuid, text, text) from public, anon;
grant execute on function public.secondary_phone_make_primary(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Primary claims respect active reservations (every write path to profiles.phone_e164)
-- ---------------------------------------------------------------------------
create or replace function app.guard_primary_phone_reservation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.phone_e164 is null or (tg_op = 'UPDATE' and new.phone_e164 is not distinct from old.phone_e164) then
    return new;
  end if;
  perform app.lock_phone(new.phone_e164);
  perform app.finalize_expired_phone_reservations(new.phone_e164, null);
  if exists (select 1 from public.secondary_phone_reservations x
              where x.phone_e164 = new.phone_e164 and x.status = 'active' and x.user_id <> new.user_id) then
    raise exception 'phone number is unavailable' using errcode = '23505';
  end if;
  -- Setting your own reserved secondary as your primary through any path is a conversion: no cooldown.
  update public.secondary_phone_reservations
     set status = 'converted', ended_at = now()
   where phone_e164 = new.phone_e164 and status = 'active' and user_id = new.user_id;
  return new;
end;
$$;
revoke all on function app.guard_primary_phone_reservation() from public, anon, authenticated;
create trigger guard_primary_phone_reservation before insert or update of phone_e164 on public.profiles
  for each row execute function app.guard_primary_phone_reservation();

-- ---------------------------------------------------------------------------
-- 7. Support: cooldown status and override
-- ---------------------------------------------------------------------------
create or replace function public.admin_phone_cooldown_status(p_phone text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_phone text := app.require_canonical_phone(p_phone);
begin
  perform app.admin_require('phones.cooldown_override');
  return jsonb_build_object(
    'phone', v_phone,
    'cooldown_until', app.phone_cooldown_until(v_phone),
    'reserved', exists (select 1 from public.secondary_phone_reservations x
                         where x.phone_e164 = v_phone and x.status = 'active' and x.expires_at > now()),
    'overrides', coalesce((select jsonb_agg(jsonb_build_object('created_at', o.created_at, 'reason', o.reason) order by o.created_at desc)
                             from public.phone_cooldown_overrides o where o.phone_e164 = v_phone), '[]'::jsonb));
end;
$$;
revoke all on function public.admin_phone_cooldown_status(text) from public, anon;
grant execute on function public.admin_phone_cooldown_status(text) to authenticated;

create or replace function public.admin_phone_cooldown_override(p_phone text, p_reason text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_phone text := app.require_canonical_phone(p_phone);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  perform app.admin_require('phones.cooldown_override');
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  perform app.lock_phone(v_phone);
  if app.phone_cooldown_until(v_phone) is null then
    raise exception 'this number is not in cooldown' using errcode = '22023';
  end if;
  insert into public.phone_cooldown_overrides (phone_e164, overridden_by, reason)
  values (v_phone, (select auth.uid()), v_reason)
  returning id into v_id;
  perform app.record_audit_event('phone_cooldown.overridden', 'phone_cooldown_override', v_id, null,
    jsonb_build_object('phone', app.mask_phone(v_phone), 'reason', v_reason));
  return v_id;
end;
$$;
revoke all on function public.admin_phone_cooldown_override(text, text) from public, anon;
grant execute on function public.admin_phone_cooldown_override(text, text) to authenticated;

notify pgrst, 'reload schema';
