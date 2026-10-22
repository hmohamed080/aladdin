-- ===========================================================================
-- Installer primary-phone change journal (ported from the Settings Part 2B rehearsal, M1/M3/M4 + journal-aware guard)
--
-- PORT NOTES (2026-10-21, integration onto PR #88):
--   * The password proof is PR #88's reauth receipt (operation 'primary_phone.change', target = the new E.164),
--     spent through app.consume_reauth_receipt_for (20261021090001). The rehearsal's M2 gate is NOT imported.
--   * BEGIN takes app.lock_phone(new number) - the same advisory lock every secondary-phone claim takes - before
--     it checks for collisions, so a primary change and a reservation of the same number serialize. PR #88's
--     guard_primary_phone_reservation trigger still runs on the profile write and refuses a number another
--     account has actively reserved (generic 23505, translated to "phone number is unavailable").
--   * guard_phone_password_identity (20261014085731) becomes journal-aware: a profile phone that differs from
--     the login alias is allowed ONLY while an ACTIVE journal row names that phone (rehearsal 20261017090004).
--   * Audit: journal state transitions write profile.phone_changed / _compensated / _needs_attention in the
--     same transaction; a password change is audited once per spent 'password.change' receipt.
-- ===========================================================================
-- (Original rehearsal notes follow.)
-- M3 - Installer phone-change journal (database side of a recoverable phone change)
--
-- WHAT THIS IS. An installer signs in with an INTERNAL LOGIN ALIAS derived from their phone
-- (p<E.164 digits>@craftsman-login.aladdin.invalid, stored in auth.users.email). Changing the
-- phone therefore means changing TWO systems that cannot share a transaction:
--
--     (1) Postgres:  profiles.phone_e164 / phone_national / phone_country_iso2
--     (2) GoTrue:    auth.users.email (the alias), changed ONLY through the supported
--                    Auth Admin API (admin.auth.admin.updateUserById) by the server.
--
-- This migration gives the server a journal and three service-only operations so that, whatever
-- crashes between (1) and (2), the two sides are brought back to a consistent state and nothing is
-- ever guessed. It does NOT call GoTrue, change any password, send anything, or verify the new phone.
--
--   BEGIN   (public.installer_phone_change_begin)   one transaction: validate the account, SPEND the
--           reauth receipt, move the profile to the new number, write a 'pending' journal row, and hand
--           the server the DB-derived old/new alias. The receipt is spent iff the change commits.
--   (the server now calls updateUserById({ email: new_alias, email_confirm: true }))
--   SETTLE  (public.installer_phone_change_settle)  reads the AUTHORITATIVE auth.users.email inside
--           the database and decides: alias == new -> done; alias == old -> compensate (restore the
--           profile); anything else -> needs_attention (fail closed). It never takes a success flag
--           from the caller, and it is idempotent.
--
-- STATE MACHINE
--     pending --(alias is new, profile is new)-------------> done            (terminal)
--     pending --(alias is old, safe to restore)------------> compensated     (terminal)
--     pending --(anything else)----------------------------> needs_attention
--     needs_attention --(re-observed: consistent now)------> done | compensated
--     compensated --(the new alias appears LATER)----------> needs_attention (a late Admin API write)
--   done is final. pending and needs_attention are the ACTIVE states: one per user (partial unique
--   index), and while one exists the user can neither begin another change nor call profile_set_phone.
--
-- PHONE OWNERSHIP IS NOT VERIFIED (accepted temporary product decision). The current password proves
-- control of the ACCOUNT, not that the caller owns the NEW number. So a successful change leaves
-- profiles.phone_verified_at NULL ("unverified"); nothing here sets it. A future SMS/WhatsApp OTP step
-- will set it from its own definer function without redesigning identity. Residual risks, accepted
-- for V1: number squatting (an account can hold a number it does not own and block its owner),
-- wrong-number contact (notifications go to a number the user does not control) and unreachable
-- numbers. The register's anti-enumeration answer stays generic ("phone number is unavailable").
--
-- SECURITY. Every new function is SECURITY DEFINER, search_path pinned empty, schema-qualified, and
-- executable by service_role ONLY (explicit revokes from PUBLIC/anon/authenticated). The journal is a
-- private app-schema table: RLS on, no policy, no privilege for any API role. No client-supplied alias,
-- verification result or privilege flag is trusted: the alias pair is DERIVED inside the database
-- from the account's actual auth email and the requested E.164. The journal stores phone numbers (it
-- must, to restore them) and no password, token or receipt secret; it is not copied into audit
-- metadata. Rows go away with the user (ON DELETE CASCADE), so the sign-up rollback is unaffected.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Phone verification status (canonical, NULL = unverified)
-- ---------------------------------------------------------------------------
-- No phone-verification state existed anywhere: installer phones were never verified (password-only
-- sign-up) and email accounts verify their email, not a phone. The column is read-only for every API
-- role: authenticated holds no UPDATE on it (column grants are explicit), and only a future definer
-- function may set it.
alter table public.profiles add column phone_verified_at timestamptz;
comment on column public.profiles.phone_verified_at is
  'When ownership of phone_e164 was proven by an out-of-band challenge (SMS/WhatsApp OTP). NULL = NOT verified. Never set by a password-only phone change; reset to NULL whenever phone_e164 changes unless the same statement sets it. No API role can write it.';

create function app.profiles_reset_phone_verification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A different number is, by definition, not the number that was verified. The only way to keep a
  -- verification across a change is to set phone_verified_at in the same statement (OTP, later).
  if new.phone_e164 is distinct from old.phone_e164
     and new.phone_verified_at is not distinct from old.phone_verified_at then
    new.phone_verified_at := null;
  end if;
  return new;
end;
$$;
revoke execute on function app.profiles_reset_phone_verification() from public, anon, authenticated, service_role;

create trigger profiles_reset_phone_verification
  before update of phone_e164 on public.profiles
  for each row execute function app.profiles_reset_phone_verification();

-- ---------------------------------------------------------------------------
-- 2. The journal
-- ---------------------------------------------------------------------------
create table app.installer_phone_changes (
  id                      uuid        primary key default extensions.gen_random_uuid(),
  user_id                 uuid        not null references public.users (id) on delete cascade,
  request_id              uuid        not null,
  state                   text        not null default 'pending',
  resolution              text,
  old_e164                text        not null,
  old_country_iso2        text,
  old_national            text,
  old_phone_verified_at   timestamptz,
  old_alias               text        not null,
  new_e164                text        not null,
  new_country_iso2        text        not null,
  new_national            text        not null,
  new_alias               text        not null,
  receipt_id              uuid        not null,
  settle_attempts         integer     not null default 0,
  lease_expires_at        timestamptz not null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  settled_at              timestamptz,
  constraint uq_installer_phone_changes_request unique (user_id, request_id),
  constraint ck_installer_phone_changes_state check (state in ('pending', 'done', 'compensated', 'needs_attention')),
  constraint ck_installer_phone_changes_resolution check (
    resolution is null or resolution in ('applied', 'restored', 'alias_unexpected', 'profile_mismatch', 'restore_conflict', 'late_auth_change')),
  constraint ck_installer_phone_changes_old_e164 check (old_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  constraint ck_installer_phone_changes_new_e164 check (new_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  constraint ck_installer_phone_changes_distinct check (old_e164 <> new_e164),
  constraint ck_installer_phone_changes_old_alias check (old_alias = 'p' || substr(old_e164, 2) || '@craftsman-login.aladdin.invalid'),
  constraint ck_installer_phone_changes_new_alias check (new_alias = 'p' || substr(new_e164, 2) || '@craftsman-login.aladdin.invalid'),
  constraint ck_installer_phone_changes_settled check ((state in ('done', 'compensated')) = (settled_at is not null))
);
comment on table app.installer_phone_changes is
  'Journal of installer phone changes: one row per change, written only by the service-only installer_phone_change_* functions. Holds the old and new phone (needed to restore) and the DB-derived old/new login alias; never a password, token or receipt secret. At most one ACTIVE (pending / needs_attention) row per user. Private: RLS on, no policy, no API-role privilege.';
comment on column app.installer_phone_changes.lease_expires_at is
  'Until this instant a pending change is treated as possibly still in flight at GoTrue: settle will not compensate an alias that still reads "old" unless the server says its Admin API call has returned.';

create unique index uq_installer_phone_changes_active
  on app.installer_phone_changes (user_id) where state in ('pending', 'needs_attention');
create index ix_installer_phone_changes_recovery
  on app.installer_phone_changes (lease_expires_at) where state = 'pending';

alter table app.installer_phone_changes enable row level security;
revoke all on app.installer_phone_changes from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. M1 guard: a user cannot disturb an active phone change through profile_set_phone
-- ---------------------------------------------------------------------------
-- Identical to the M1 definition (20261017090001) plus ONE new refusal, taken after the profile row
-- lock: while a change is pending / needs_attention the profile phone belongs to the journal. Without
-- it the M1 "heal" branch would let the user write the OLD alias number back mid-change.
create or replace function public.profile_set_phone(
  p_country_iso2 text,
  p_national     text,
  p_e164         text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid          uuid := (select auth.uid());
  v_email        text;
  v_alias_suffix constant text := '@craftsman-login.aladdin.invalid';
  v_alias_phone  text;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_e164 !~ '^\+[1-9]\d{1,14}$' then
    raise exception 'phone number is not in a valid format' using errcode = '22023';
  end if;
  if p_country_iso2 is not null and p_country_iso2 !~ '^[A-Z]{2}$' then
    raise exception 'invalid country code' using errcode = '22023';
  end if;

  -- Serialize with any other writer of this profile, THEN read the login alias,
  -- so a concurrent re-key of the alias can never be missed by this check.
  perform 1 from public.profiles where user_id = v_uid for update;
  if not found then
    raise exception 'profile not found for the current user' using errcode = 'P0002';
  end if;

  if exists (select 1 from app.installer_phone_changes c
              where c.user_id = v_uid and c.state in ('pending', 'needs_attention')) then
    raise exception 'a phone number change is in progress' using errcode = '55006';
  end if;

  select lower(btrim(u.email)) into v_email from auth.users u where u.id = v_uid;

  if v_email is not null and right(v_email, length(v_alias_suffix)) = v_alias_suffix then
    -- An alias account. The address must be EXACTLY p<digits>@<alias domain>;
    -- anything else in the alias domain is malformed and fails closed.
    if v_email !~ ('^p[1-9][0-9]{6,14}' || replace(v_alias_suffix, '.', '\.') || '$') then
      raise exception 'sign-in phone alias is malformed' using errcode = '42501';
    end if;
    v_alias_phone := '+' || substr(split_part(v_email, '@', 1), 2);
    if p_e164 is distinct from v_alias_phone then
      raise exception 'the phone number of this account is its sign-in identifier and cannot be changed here'
        using errcode = '42501';
    end if;
  end if;

  begin
    update public.profiles
      set phone_country_iso2 = p_country_iso2,
          phone_national     = p_national,
          phone_e164         = p_e164
      where user_id = v_uid;
  exception
    when unique_violation then
      -- GENERIC, never "already used by another account" - mirrors
      -- isAccountExistsError's enumeration-normalization in
      -- server/actions/auth-password-preview.ts exactly.
      raise exception 'phone number is unavailable' using errcode = '23505';
  end;

  if not found then
    raise exception 'profile not found for the current user' using errcode = 'P0002';
  end if;

  perform app.record_audit_event('profile.phone_set', 'user', v_uid, null, '{}'::jsonb);
end;
$$;

comment on function public.profile_set_phone(text, text, text) is
  'The only write path for profiles.phone_* outside a journaled phone change. Takes an ALREADY-CANONICALIZED E.164 value (computed by libphonenumber-js in the application, never re-derived in Postgres) and raises a GENERIC "phone number is unavailable" error on a uniqueness collision, never revealing that another account holds the number. For an installer phone-alias account (auth email p<digits>@craftsman-login.aladdin.invalid) the only number it will write is the one the alias encodes (initial assignment or same-number re-save); any other number raises 42501, and a malformed alias fails closed. While the account has an active phone-number change (app.installer_phone_changes pending / needs_attention) it refuses with 55006. Changing the number an alias account signs in with is the server-only installer_phone_change_* operation.';

revoke execute on function public.profile_set_phone(text, text, text) from public;
grant execute on function public.profile_set_phone(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. BEGIN
-- ---------------------------------------------------------------------------
create function public.installer_phone_change_begin(
  p_user_id      uuid,
  p_request_id   uuid,
  p_receipt_id   uuid,
  p_country_iso2 text,
  p_national     text,
  p_e164         text
)
returns table (change_id uuid, state text, old_alias text, new_alias text, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_lease        constant interval := interval '5 minutes';
  c_suffix       constant text := '@craftsman-login.aladdin.invalid';
  v_profile      public.profiles;
  v_email        text;
  v_old_phone    text;
  v_new_alias    text;
  v_existing     app.installer_phone_changes;
  v_id           uuid;
begin
  if p_user_id is null or p_request_id is null or p_receipt_id is null
     or p_country_iso2 is null or p_national is null or p_e164 is null then
    raise exception 'invalid phone change request' using errcode = '22023';
  end if;
  if p_e164 !~ '^\+[1-9][0-9]{6,14}$' or p_country_iso2 !~ '^[A-Z]{2}$' or p_national !~ '^[0-9]{1,15}$' then
    raise exception 'phone number is not in a valid format' using errcode = '22023';
  end if;

  -- Serialization point for this user (the same lock profile_set_phone takes): concurrent begins queue
  -- here, and every later step sees the previous one's committed journal row.
  select * into v_profile from public.profiles p where p.user_id = p_user_id for update;
  if not found then
    raise exception 'account is not eligible for a phone change' using errcode = '55000';
  end if;

  -- Idempotent replay: the same (user, request) returns the same change, spends nothing, changes nothing.
  select * into v_existing from app.installer_phone_changes c where c.user_id = p_user_id and c.request_id = p_request_id;
  if found then
    if v_existing.new_e164 is distinct from p_e164 then
      raise exception 'request id was already used for a different change' using errcode = '22023';
    end if;
    return query select v_existing.id, v_existing.state, v_existing.old_alias, v_existing.new_alias, true;
    return;
  end if;

  -- The receipt first: nothing about the account is revealed to a caller without a valid proof. It is
  -- spent in THIS transaction, so any later refusal below rolls the spend back with everything else.
  if not app.consume_reauth_receipt_for(p_user_id, p_receipt_id, 'primary_phone.change', p_e164) then
    raise exception 'verification required' using errcode = '42501';
  end if;

  if exists (select 1 from app.installer_phone_changes c where c.user_id = p_user_id and c.state in ('pending', 'needs_attention')) then
    raise exception 'a phone number change is in progress' using errcode = '55006';
  end if;

  -- The account must be an installer phone-alias account whose alias and profile agree.
  select lower(btrim(u.email)) into v_email from auth.users u where u.id = p_user_id;
  if v_email is null or v_email !~ ('^p[1-9][0-9]{6,14}' || replace(c_suffix, '.', '\.') || '$') then
    raise exception 'account is not eligible for a phone change' using errcode = '55000';
  end if;
  v_old_phone := '+' || substr(split_part(v_email, '@', 1), 2);
  if v_profile.phone_e164 is distinct from v_old_phone then
    raise exception 'account is not eligible for a phone change' using errcode = '55000';
  end if;
  if p_e164 = v_old_phone then
    raise exception 'the new phone number is the current one' using errcode = '22023';
  end if;

  -- The lock every claim of a number takes (PR #88): a concurrent secondary reservation of the same number
  -- queues behind this change, and vice versa.
  perform app.lock_phone(p_e164);

  -- Generic collision: another profile on that number OR another login already on that alias.
  v_new_alias := 'p' || substr(p_e164, 2) || c_suffix;
  if exists (select 1 from public.profiles p where p.phone_e164 = p_e164 and p.user_id <> p_user_id)
     or exists (select 1 from auth.users u where lower(btrim(u.email)) = v_new_alias and u.id <> p_user_id) then
    raise exception 'phone number is unavailable' using errcode = '23505';
  end if;

  -- The journal row is written BEFORE the profile phone moves: main's guard_phone_password_identity (20261014085731) refuses a
  -- profile phone that differs from the login alias unless an ACTIVE journal row names that phone (20261017090004), and a
  -- failure of the profile update below aborts this whole function, journal row included.
  insert into app.installer_phone_changes (
    user_id, request_id, old_e164, old_country_iso2, old_national, old_phone_verified_at, old_alias,
    new_e164, new_country_iso2, new_national, new_alias, receipt_id, lease_expires_at)
  values (
    p_user_id, p_request_id, v_old_phone, v_profile.phone_country_iso2, v_profile.phone_national, v_profile.phone_verified_at, v_email,
    p_e164, p_country_iso2, p_national, v_new_alias, p_receipt_id, now() + c_lease)
  returning id into v_id;

  begin
    update public.profiles p
       set phone_country_iso2 = p_country_iso2,
           phone_national     = p_national,
           phone_e164         = p_e164
     where p.user_id = p_user_id;
  exception when unique_violation then
    raise exception 'phone number is unavailable' using errcode = '23505';  -- lost the race at the unique index
  end;

  return query select v_id, 'pending'::text, v_email, v_new_alias, false;
end;
$$;
comment on function public.installer_phone_change_begin(uuid, uuid, uuid, text, text, text) is
  'Step 1 of a password-confirmed installer phone change. In ONE transaction: checks the account is an installer phone-alias account whose alias and profile agree, spends the primary_phone.change reauth receipt (user + exact new E.164, single-use, 60 s), refuses a number held by another profile or login with the generic "phone number is unavailable", moves the profile to the new number (verification status reset to NULL) and writes a pending journal row. Returns the DB-derived old/new alias for the server to apply through the Auth Admin API. Idempotent per (user, request id). Does not touch auth.users. service_role ONLY.';

-- ---------------------------------------------------------------------------
-- 5. SETTLE
-- ---------------------------------------------------------------------------
create function public.installer_phone_change_settle(
  p_user_id           uuid,
  p_change_id         uuid,
  p_attempt_finished  boolean default false
)
returns table (state text, resolution text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  j         app.installer_phone_changes;
  v_email   text;
  v_state   text;
  v_res     text;
begin
  if p_user_id is null or p_change_id is null or p_attempt_finished is null then
    raise exception 'invalid phone change request' using errcode = '22023';
  end if;

  -- Lock order everywhere: profile row, then journal row.
  select * into v_profile from public.profiles p where p.user_id = p_user_id for update;
  if not found then
    raise exception 'unknown phone change' using errcode = 'P0002';
  end if;
  select * into j from app.installer_phone_changes c where c.id = p_change_id and c.user_id = p_user_id for update;
  if not found then
    raise exception 'unknown phone change' using errcode = 'P0002';
  end if;

  -- The AUTHORITATIVE observation. Nothing the caller says about Auth is believed.
  select lower(btrim(u.email)) into v_email from auth.users u where u.id = p_user_id;

  if j.state = 'done' then
    return query select j.state, j.resolution;
    return;
  end if;

  if j.state = 'compensated' then
    -- A compensated change must STAY compensated. If the Admin API call we gave up on lands afterwards
    -- (alias reads new while the profile was restored) and no newer change exists, the two sides now
    -- disagree: fail closed rather than restore twice.
    if v_email = j.new_alias and v_profile.phone_e164 is distinct from j.new_e164
       and not exists (select 1 from app.installer_phone_changes c2 where c2.user_id = p_user_id and c2.created_at > j.created_at) then
      update app.installer_phone_changes c set state = 'needs_attention', resolution = 'late_auth_change', updated_at = now(), settled_at = null
       where c.id = j.id;
      return query select 'needs_attention'::text, 'late_auth_change'::text;
      return;
    end if;
    return query select j.state, j.resolution;
    return;
  end if;

  -- j.state is pending or needs_attention from here.
  if v_email = j.new_alias then
    -- CASE A / E: the alias is already the new one (also when the Admin API response was lost).
    if v_profile.phone_e164 = j.new_e164 then
      v_state := 'done'; v_res := 'applied';
    else
      v_state := 'needs_attention'; v_res := 'profile_mismatch';
    end if;

  elsif v_email = j.old_alias then
    -- CASE B: the alias never changed. Do not compensate a change that may still be landing.
    if j.state = 'pending' and not p_attempt_finished and j.lease_expires_at > now() then
      update app.installer_phone_changes c set settle_attempts = c.settle_attempts + 1, updated_at = now() where c.id = j.id;
      return query select 'pending'::text, null::text;
      return;
    end if;
    if v_profile.phone_e164 = j.new_e164 then
      begin
        update public.profiles p
           set phone_country_iso2    = j.old_country_iso2,
               phone_national        = j.old_national,
               phone_e164            = j.old_e164,
               phone_verified_at     = j.old_phone_verified_at
         where p.user_id = p_user_id;
        v_state := 'compensated'; v_res := 'restored';
      exception when unique_violation then
        -- Someone else took the old number while it was released: do not take it back by force.
        v_state := 'needs_attention'; v_res := 'restore_conflict';
      end;
    elsif v_profile.phone_e164 = j.old_e164 then
      v_state := 'compensated'; v_res := 'restored';   -- already restored (a retried settle)
    else
      v_state := 'needs_attention'; v_res := 'profile_mismatch';
    end if;

  else
    -- CASE C: neither expected alias. Never guess, never overwrite the identity.
    v_state := 'needs_attention'; v_res := 'alias_unexpected';
  end if;

  if v_state is distinct from j.state or v_res is distinct from j.resolution then
    update app.installer_phone_changes c
       set state = v_state,
           resolution = v_res,
           settle_attempts = c.settle_attempts + 1,
           updated_at = now(),
           settled_at = case when v_state in ('done', 'compensated') then now() else null end
     where c.id = j.id;
  else
    update app.installer_phone_changes c set settle_attempts = c.settle_attempts + 1, updated_at = now() where c.id = j.id;
  end if;
  return query select v_state, v_res;
end;
$$;
comment on function public.installer_phone_change_settle(uuid, uuid, boolean) is
  'Step 3 of an installer phone change: resolve the journal row against the AUTHORITATIVE auth.users.email read inside the database. alias = new -> done (profile must match); alias = old -> restore the old profile phone and mark compensated (but not while the lease is open unless the caller says its Admin API call has returned); anything else -> needs_attention (fail closed). Idempotent; safe to retry after a crash or a lost response. The caller never reports whether the Auth step succeeded. service_role ONLY.';

-- ---------------------------------------------------------------------------
-- 6. STATUS and RECOVERY discovery
-- ---------------------------------------------------------------------------
create function public.installer_phone_change_status(p_user_id uuid)
returns table (change_id uuid, state text, resolution text, lease_expired boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.state, c.resolution, c.lease_expires_at <= now()
    from app.installer_phone_changes c
   where c.user_id = p_user_id and c.state in ('pending', 'needs_attention');
$$;
comment on function public.installer_phone_change_status(uuid) is
  'The active (pending / needs_attention) phone change of a user, if any - so a server that crashed between the database and Auth steps can find the row to settle. service_role ONLY.';

create function public.installer_phone_change_recoverable(p_limit integer default 50)
returns table (change_id uuid, user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.user_id
    from app.installer_phone_changes c
   where c.state = 'pending' and c.lease_expires_at <= now()
   order by c.lease_expires_at
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;
comment on function public.installer_phone_change_recoverable(integer) is
  'Pending phone changes whose lease has expired (the server that started them is presumed gone), oldest first, for a recovery sweeper to settle. service_role ONLY.';

-- ---------------------------------------------------------------------------
-- 7. Privileges - explicit, because Postgres grants EXECUTE to PUBLIC by default
-- ---------------------------------------------------------------------------
revoke execute on function public.installer_phone_change_begin(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.installer_phone_change_settle(uuid, uuid, boolean)               from public, anon, authenticated;
revoke execute on function public.installer_phone_change_status(uuid)                              from public, anon, authenticated;
revoke execute on function public.installer_phone_change_recoverable(integer)                      from public, anon, authenticated;
grant  execute on function public.installer_phone_change_begin(uuid, uuid, uuid, text, text, text) to service_role;
grant  execute on function public.installer_phone_change_settle(uuid, uuid, boolean)               to service_role;
grant  execute on function public.installer_phone_change_status(uuid)                              to service_role;
grant  execute on function public.installer_phone_change_recoverable(integer)                      to service_role;

-- ---------------------------------------------------------------------------
-- 8. guard_phone_password_identity: allow a JOURNALED installer phone change (rehearsal 20261017090004)
-- ---------------------------------------------------------------------------
create or replace function app.guard_phone_password_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  select lower(email) into v_email from auth.users where id = new.user_id;
  if v_email ~ '^p[1-9][0-9]{6,14}@craftsman-login\.aladdin\.invalid$'
     and new.phone_e164 is distinct from ('+' || split_part(split_part(v_email, '@', 1), 'p', 2)) then
    if new.phone_e164 is not null and exists (
         select 1 from app.installer_phone_changes j
          where j.user_id = new.user_id
            and j.state in ('pending', 'needs_attention')
            and new.phone_e164 in (j.new_e164, j.old_e164)) then
      return new;
    end if;
    raise exception 'phone identity changes require verified recovery' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_phone_password_identity() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Audit (rehearsal M4): actions are ADDED to the vocabulary, never re-listed
-- ---------------------------------------------------------------------------
select app.audit_actions_add(array['profile.phone_changed', 'profile.phone_change_compensated', 'profile.phone_change_needs_attention', 'profile.password_changed']);

-- Phone change events: derived from journal state transitions, same transaction, journal user as actor. Metadata is the
-- change id and a closed resolution code only - never a phone number or alias.
create function app.installer_phone_change_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if new.state is not distinct from old.state then
    return new;   -- a retried settle that changes nothing records nothing
  end if;
  v_action := case new.state
    when 'done'            then 'profile.phone_changed'
    when 'compensated'     then 'profile.phone_change_compensated'
    when 'needs_attention' then 'profile.phone_change_needs_attention'
    else null
  end;
  if v_action is null then
    return new;
  end if;
  insert into public.audit_log (actor_user_id, actor_role, action, subject_type, subject_id, organization_id, metadata)
  values (new.user_id, app.admin_legacy_tier(app.admin_rank_of(new.user_id)), v_action, 'user', new.user_id, null,
          jsonb_build_object('change_id', new.id, 'resolution', new.resolution));
  return new;
end;
$$;
comment on function app.installer_phone_change_audit() is
  'Trigger function: audits installer phone-change state transitions (done / compensated / needs_attention) in the same transaction, with the journal user as actor. Metadata is the change id and a closed resolution code only. Not callable by any API role.';
revoke execute on function app.installer_phone_change_audit() from public, anon, authenticated, service_role;

create trigger installer_phone_changes_audit
  after update of state on app.installer_phone_changes
  for each row execute function app.installer_phone_change_audit();

-- Password change event: bound to a SPENT password.change reauth receipt of that user (consumed in the last 15 minutes),
-- at most once per receipt. The password itself changes through the Auth Admin API, outside Postgres.
create function public.identity_password_change_audit(p_user_id uuid, p_receipt_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user_id is null or p_receipt_id is null then
    return false;
  end if;
  update app.reauth_receipts r set audited_at = clock_timestamp()
   where r.id = p_receipt_id
     and r.user_id = p_user_id
     and r.operation = 'password.change'
     and r.used_at is not null
     and r.used_at > clock_timestamp() - interval '15 minutes'
     and r.audited_at is null
  returning r.id into v_id;
  if v_id is null then
    return false;
  end if;
  insert into public.audit_log (actor_user_id, actor_role, action, subject_type, subject_id, organization_id, metadata)
  values (p_user_id, app.admin_legacy_tier(app.admin_rank_of(p_user_id)), 'profile.password_changed', 'user', p_user_id, null, '{}'::jsonb);
  return true;
end;
$$;
comment on function public.identity_password_change_audit(uuid, uuid) is
  'Records profile.password_changed for the user who owns a SPENT password.change reauth receipt (consumed within 15 minutes), at most once per receipt, with that user as actor and empty metadata. Returns false (writes nothing) for any other receipt. service_role ONLY.';
revoke execute on function public.identity_password_change_audit(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.identity_password_change_audit(uuid, uuid) to service_role;

-- Spend a password.change receipt for the server, which then calls the Auth Admin API. Separate from the audit so the
-- receipt is spent BEFORE the password changes (a replayed receipt can never change it twice).
create function public.identity_password_change_authorize(p_user_id uuid, p_receipt_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.account_is_active(p_user_id) then
    return false;
  end if;
  return app.consume_reauth_receipt_for(p_user_id, p_receipt_id, 'password.change', 'self');
end;
$$;
comment on function public.identity_password_change_authorize(uuid, uuid) is
  'Spends the user''s password.change reauth receipt (single-use, 60 s). True = the server may now set the new password through the Auth Admin API and then call identity_password_change_audit. service_role ONLY.';
revoke execute on function public.identity_password_change_authorize(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.identity_password_change_authorize(uuid, uuid) to service_role;
