-- ===========================================================================
-- Installer login-alias guard on auth.users.email (+ guard-aware phone-change settlement)
-- Ported from the Settings Part 2B rehearsal (M6). PORT NOTE (2026-10-21): the operator break-glass is authorized by the
-- Admin RBAC permission phones.alias_exception (granted to Super Admin, delegable through a role) instead of the
-- rehearsal's "admin rank >= 80", matching how PR #88 authorizes phones.cooldown_override.
--
-- WHY. An installer signs in with an INTERNAL LOGIN ALIAS, p<E.164 digits>@craftsman-login.aladdin.invalid, stored in
-- auth.users.email. Any signed-in user can reach GoTrue directly (PUT /auth/v1/user) and the Admin API is a separate door,
-- and neither knows the alias is a login key tied to profiles.phone_*. Verified against GoTrue v2.193.0:
--   * with double_confirm_changes OFF, a user-scoped email change confirmed from the NEW address alone replaces the
--     login email (account takeover, and the account silently stops being an alias account);
--   * an Admin API write that was started before a phone change was compensated can still commit AFTER it, because an
--     in-flight HTTP call cannot be cancelled or ordered. Two observations a moment apart do not prove otherwise.
-- GoTrue and Postgres cannot share a transaction, but every GoTrue write IS a Postgres UPDATE. This migration puts the
-- authorization where the write lands.
--
-- THE GUARD (BEFORE UPDATE OF email ON auth.users). It is scoped to alias accounts only: it returns immediately, touching
-- no application table, unless the OLD or the NEW email is in the alias domain. So ordinary email accounts, sign-up
-- (an INSERT), sign-in and password flows are never affected, and a broken application schema cannot block them. The
-- column is not intercepted when GoTrue re-writes the same value. A change of an alias account's email is allowed ONLY if
--   (1) a PENDING phone-change journal row (M3) exists for exactly this user, old alias -> new alias, locked FOR UPDATE until the
--       writing transaction ends - so it is serialized with settlement, which locks the same row: either the write commits
--       first (settlement then observes the new alias), or settlement compensates first (the write then finds a non-pending
--       row and is refused); or
--   (2) an operator exception for exactly this user, old alias and new alias exists, unexpired, unrevoked, and is consumed
--       here atomically (single use).
-- Anything else raises 42501 and GoTrue rolls the whole request back (auth.identities included).
--
-- NO BYPASS SWITCH. There is no on/off flag and no time window: the only exception is the scoped, single-use, audited
-- one below. If the exception state is missing or invalid the guard refuses. The password column is NOT intercepted:
-- password changes use GoTrue's native require-current-password setting.
--
-- OPERATOR EXCEPTION (break-glass). An Admin Staff member holding phones.alias_exception, identified by user id, may authorize ONE
-- alias change for ONE user: exact user, exact current alias (read from auth.users, never supplied), exact new alias, a
-- required reason, a short expiry (30 s - 15 min), consumed atomically by the guard when GoTrue performs the write. Issuing,
-- using and revoking are audited with the operator as the actor; the reason lives in the private table, not in the audit
-- metadata. Only service_role may call the issue/revoke functions - the server application authenticates the operator.
--
-- SETTLEMENT. With the guard active, compensating an alias that still reads "old" is safe at ANY time, because an
-- in-flight or late write can no longer commit afterwards. When the guard cannot be shown to be active (trigger absent or
-- disabled, or this session is not in 'origin' replication mode) settlement keeps the conservative M3 rule: compensate only
-- when the caller says its Admin API call has returned or the lease has expired.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Permission (Admin RBAC)
-- ---------------------------------------------------------------------------
insert into public.admin_permissions (key, resource, action, description, sort_order) values
  ('phones.alias_exception', 'phones', 'alias_exception',
   'Authorize ONE Installer sign-in phone change for ONE account (single use, short expiry, mandatory reason; audited). Break-glass for support disputes.', 61)
on conflict (key) do nothing;
insert into public.admin_role_permissions (role_id, permission_key, is_locked)
select r.id, 'phones.alias_exception', true
  from public.admin_roles r
 where r.key = 'super_admin'
on conflict (role_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Audit vocabulary (existing 123 actions preserved)
-- ---------------------------------------------------------------------------
-- Audit vocabulary: ADD ONLY this migration's actions to whatever the constraint currently allows. The earlier
-- version of this file re-created ck_audit_action_known from a LITERAL list and so would have DROPPED every action
-- main added in the meantime. app.audit_actions_add (20261017090005) appends, never removes, and fails loudly on an
-- unexpected constraint shape.
select app.audit_actions_add(array['profile.phone_alias_exception_issued', 'profile.phone_alias_exception_used', 'profile.phone_alias_exception_revoked']);

-- ---------------------------------------------------------------------------
-- 2. Operator exceptions (private; single use; scoped)
-- ---------------------------------------------------------------------------
create table app.installer_alias_exceptions (
  id               uuid        primary key default extensions.gen_random_uuid(),
  user_id          uuid        not null references public.users (id) on delete cascade,
  old_alias        text        not null,
  new_alias        text        not null,
  operator_user_id uuid        not null,
  reason           text        not null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  consumed_at      timestamptz,
  revoked_at       timestamptz,
  constraint ck_installer_alias_exceptions_aliases check (old_alias = lower(old_alias) and new_alias = lower(new_alias) and old_alias <> new_alias),
  constraint ck_installer_alias_exceptions_reason  check (char_length(btrim(reason)) between 10 and 500),
  constraint ck_installer_alias_exceptions_expiry  check (expires_at > created_at and expires_at <= created_at + interval '15 minutes'),
  constraint ck_installer_alias_exceptions_operator check (operator_user_id <> user_id),
  constraint ck_installer_alias_exceptions_state   check (not (consumed_at is not null and revoked_at is not null))
);
comment on table app.installer_alias_exceptions is
  'Operator break-glass for ONE installer login-alias change: exact user, exact old alias, exact new alias, a required reason, a short expiry, consumed atomically by the auth.users guard. Private: RLS on, no policy, no API-role privilege. The reason stays here and is never copied into audit metadata.';
create unique index uq_installer_alias_exceptions_open
  on app.installer_alias_exceptions (user_id) where consumed_at is null and revoked_at is null;

alter table app.installer_alias_exceptions enable row level security;
revoke all on app.installer_alias_exceptions from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Narrowly constrained audit writer (internal; not callable by any API role)
-- ---------------------------------------------------------------------------
create function app.installer_alias_exception_audit(p_actor uuid, p_action text, p_subject uuid, p_exception_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action not in ('profile.phone_alias_exception_issued', 'profile.phone_alias_exception_used', 'profile.phone_alias_exception_revoked') then
    raise exception 'unsupported audit action' using errcode = '22023';
  end if;
  insert into public.audit_log (actor_user_id, actor_role, action, subject_type, subject_id, organization_id, metadata)
  values (p_actor, app.admin_legacy_tier(app.admin_rank_of(p_actor)), p_action, 'user', p_subject, null,
          jsonb_build_object('exception_id', p_exception_id));
end;
$$;
revoke execute on function app.installer_alias_exception_audit(uuid, text, uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The guard
-- ---------------------------------------------------------------------------
create function app.installer_alias_email_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_suffix constant text := '@craftsman-login.aladdin.invalid';
  v_old text := lower(coalesce(old.email, ''));
  v_new text := lower(coalesce(new.email, ''));
  v_journal_id uuid;
  v_exc_id uuid;
  v_operator uuid;
begin
  -- Ordinary accounts return BEFORE any application table is touched.
  if right(v_old, length(c_suffix)) <> c_suffix and right(v_new, length(c_suffix)) <> c_suffix then
    return new;
  end if;
  -- GoTrue may re-write the same value (UPDATE OF lists a column even when its value does not change).
  if v_new = v_old then
    return new;
  end if;

  -- (1) A matching PENDING phone-change operation, locked until this transaction ends (serialized with settlement).
  select c.id into v_journal_id
    from app.installer_phone_changes c
   where c.user_id = new.id and c.state = 'pending' and c.old_alias = v_old and c.new_alias = v_new
   for update;
  if found then
    return new;
  end if;

  -- (2) A scoped, single-use operator exception, consumed atomically.
  update app.installer_alias_exceptions e
     set consumed_at = now()
   where e.user_id = new.id and e.old_alias = v_old and e.new_alias = v_new
     and e.consumed_at is null and e.revoked_at is null and e.expires_at > now()
  returning e.id, e.operator_user_id into v_exc_id, v_operator;
  if found then
    perform app.installer_alias_exception_audit(v_operator, 'profile.phone_alias_exception_used', new.id, v_exc_id);
    return new;
  end if;

  raise exception 'login alias change is not authorized' using errcode = '42501';
end;
$$;
comment on function app.installer_alias_email_guard() is
  'BEFORE UPDATE OF email ON auth.users. For installer alias accounts only (old or new email in the alias domain): allows a change solely under a matching PENDING installer_phone_changes row (locked, serialized with settlement) or one scoped single-use operator exception; otherwise raises 42501. No bypass switch.';
revoke execute on function app.installer_alias_email_guard() from public, anon, authenticated, service_role;

create trigger installer_alias_email_guard
  before update of email on auth.users
  for each row execute function app.installer_alias_email_guard();

-- Whether THIS session can rely on the guard: the trigger exists, is enabled, and replication mode is 'origin'.
create function app.installer_alias_guard_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from pg_catalog.pg_trigger t
            where t.tgrelid = 'auth.users'::regclass and t.tgname = 'installer_alias_email_guard'
              and not t.tgisinternal and t.tgenabled in ('O', 'A'))
     and pg_catalog.current_setting('session_replication_role') = 'origin';
$$;
revoke execute on function app.installer_alias_guard_active() from public, anon, authenticated, service_role;

create function public.installer_alias_guard_status()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select app.installer_alias_guard_active(); $$;
comment on function public.installer_alias_guard_status() is
  'True when the auth.users alias guard is installed, enabled and in force for this session. Read-only deployment check. service_role ONLY.';

-- ---------------------------------------------------------------------------
-- 5. Operator exception: issue / revoke (service-only; the server authenticates the operator)
-- ---------------------------------------------------------------------------
create function public.installer_alias_exception_issue(
  p_operator_id uuid,
  p_user_id     uuid,
  p_new_alias   text,
  p_reason      text,
  p_ttl_seconds integer default 300
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_suffix constant text := '@craftsman-login.aladdin.invalid';
  v_new  text := lower(btrim(coalesce(p_new_alias, '')));
  v_old  text;
  v_id   uuid;
begin
  if p_operator_id is null or p_user_id is null or p_new_alias is null or p_reason is null or p_ttl_seconds is null then
    raise exception 'invalid alias exception request' using errcode = '22023';
  end if;
  if p_operator_id = p_user_id then
    raise exception 'an operator cannot authorize a change to their own login' using errcode = '42501';
  end if;
  -- Authorized operator identity: active Admin Staff holding phones.alias_exception, looked up by id.
  if not ('phones.alias_exception' = any(app.admin_permissions_of(p_operator_id))) then
    raise exception 'operator is not authorized' using errcode = '42501';
  end if;
  if char_length(btrim(p_reason)) not between 10 and 500 then
    raise exception 'a reason of 10 to 500 characters is required' using errcode = '22023';
  end if;
  if p_ttl_seconds not between 30 and 900 then
    raise exception 'expiry must be between 30 and 900 seconds' using errcode = '22023';
  end if;

  select lower(btrim(u.email)) into v_old from auth.users u where u.id = p_user_id;
  if v_old is null then
    raise exception 'unknown user' using errcode = 'P0002';
  end if;
  -- The old alias is READ here, never supplied. The exception concerns alias accounts only.
  if right(v_old, length(c_suffix)) <> c_suffix and right(v_new, length(c_suffix)) <> c_suffix then
    raise exception 'not an installer alias change' using errcode = '22023';
  end if;
  if v_new = v_old or char_length(v_new) > 254 or v_new !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    raise exception 'invalid new login' using errcode = '22023';
  end if;
  if right(v_new, length(c_suffix)) = c_suffix and v_new !~ ('^p[1-9][0-9]{6,14}' || replace(c_suffix, '.', '\.') || '$') then
    raise exception 'invalid new login' using errcode = '22023';
  end if;

  delete from app.installer_alias_exceptions e where e.user_id = p_user_id and e.consumed_at is null and e.revoked_at is null and e.expires_at <= now();
  begin
    insert into app.installer_alias_exceptions (user_id, old_alias, new_alias, operator_user_id, reason, expires_at)
    values (p_user_id, v_old, v_new, p_operator_id, btrim(p_reason), now() + make_interval(secs => p_ttl_seconds))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'an alias exception is already open for this user' using errcode = '55006';
  end;
  perform app.installer_alias_exception_audit(p_operator_id, 'profile.phone_alias_exception_issued', p_user_id, v_id);
  return v_id;
end;
$$;
comment on function public.installer_alias_exception_issue(uuid, uuid, text, text, integer) is
  'Operator break-glass: authorize ONE login-alias change for ONE user (exact current alias read from auth.users, exact new alias, required reason, 30 s - 15 min expiry, single use, audited with the operator as actor). Refuses an operator without phones.alias_exception, the operator acting on their own account, a non-alias change, a second open exception, and any wildcard. service_role ONLY.';

create function public.installer_alias_exception_revoke(p_operator_id uuid, p_exception_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if p_operator_id is null or p_exception_id is null then
    raise exception 'invalid alias exception request' using errcode = '22023';
  end if;
  if not ('phones.alias_exception' = any(app.admin_permissions_of(p_operator_id))) then
    raise exception 'operator is not authorized' using errcode = '42501';
  end if;
  update app.installer_alias_exceptions e set revoked_at = now()
   where e.id = p_exception_id and e.consumed_at is null and e.revoked_at is null
  returning e.user_id into v_user;
  if v_user is null then
    return false;
  end if;
  perform app.installer_alias_exception_audit(p_operator_id, 'profile.phone_alias_exception_revoked', v_user, p_exception_id);
  return true;
end;
$$;
comment on function public.installer_alias_exception_revoke(uuid, uuid) is
  'Revokes an open (unconsumed) alias exception; audited with the operator as actor. service_role ONLY.';

-- ---------------------------------------------------------------------------
-- 6. Settlement: identical to M3 except that, with the guard active, a still-old alias is compensated at once
-- ---------------------------------------------------------------------------
create or replace function public.installer_phone_change_settle(
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

  -- Lock order everywhere: profile row, then journal row. The auth.users guard locks the journal row too, which is what
  -- serializes an Auth write with this settlement.
  select * into v_profile from public.profiles p where p.user_id = p_user_id for update;
  if not found then
    raise exception 'unknown phone change' using errcode = 'P0002';
  end if;
  select * into j from app.installer_phone_changes c where c.id = p_change_id and c.user_id = p_user_id for update;
  if not found then
    raise exception 'unknown phone change' using errcode = 'P0002';
  end if;

  -- The AUTHORITATIVE observation, taken AFTER the journal lock: any Auth write that passed the guard has committed by now.
  select lower(btrim(u.email)) into v_email from auth.users u where u.id = p_user_id;

  if j.state = 'done' then
    return query select j.state, j.resolution;
    return;
  end if;

  if j.state = 'compensated' then
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
    if v_profile.phone_e164 = j.new_e164 then
      v_state := 'done'; v_res := 'applied';
    else
      v_state := 'needs_attention'; v_res := 'profile_mismatch';
    end if;

  elsif v_email = j.old_alias then
    -- Guard active: a write that has not committed can never commit once this row leaves 'pending', so compensating is
    -- safe at any time. Otherwise (guard absent / disabled / not in force) keep the conservative rule.
    if not app.installer_alias_guard_active()
       and j.state = 'pending' and not p_attempt_finished and j.lease_expires_at > now() then
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
        v_state := 'needs_attention'; v_res := 'restore_conflict';
      end;
    elsif v_profile.phone_e164 = j.old_e164 then
      v_state := 'compensated'; v_res := 'restored';
    else
      v_state := 'needs_attention'; v_res := 'profile_mismatch';
    end if;

  else
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
  'Resolve a phone-change journal row against the AUTHORITATIVE auth.users.email read inside the database AFTER taking the journal lock. alias = new -> done (profile must match); alias = old -> restore the old profile phone and mark compensated - immediately when the auth.users alias guard is active (a late write can no longer commit), otherwise only when the caller says its Admin API call has returned or the lease expired; anything else -> needs_attention. Idempotent. service_role ONLY.';

-- ---------------------------------------------------------------------------
-- 7. Privileges - explicit
-- ---------------------------------------------------------------------------
revoke execute on function public.installer_alias_guard_status()                                   from public, anon, authenticated;
revoke execute on function public.installer_alias_exception_issue(uuid, uuid, text, text, integer) from public, anon, authenticated;
revoke execute on function public.installer_alias_exception_revoke(uuid, uuid)                     from public, anon, authenticated;
grant  execute on function public.installer_alias_guard_status()                                   to service_role;
grant  execute on function public.installer_alias_exception_issue(uuid, uuid, text, text, integer) to service_role;
grant  execute on function public.installer_alias_exception_revoke(uuid, uuid)                     to service_role;
-- (create or replace kept the existing grants of installer_phone_change_settle: service_role only)
