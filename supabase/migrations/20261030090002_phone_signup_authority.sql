-- ===========================================================================
-- Phone verification authority, part 2 (R1): signup_proof + the phone-alias creation guard.
--
-- LOCAL / REVIEW ONLY until separately approved. Authored for the isolated local stack; NOT applied to Acceptance or Production.
-- Ships DORMANT, with three independent switches (all in app.phone_verification_config, none readable by an API role):
--     enabled             false   B1 master switch (also gates everything here)
--     signup_enabled      false   the signup_proof entry points answer 'unavailable'
--     alias_guard_mode    'off'   the auth.users guard is installed but does nothing ('off' | 'observe' | 'enforce')
-- With the defaults this migration changes no behaviour: no account creation path is blocked, nothing can be verified.
--
-- WHY. PR #122 measured that (a) an anonymous caller can create the internal phone-alias Auth user straight through GoTrue
-- /signup and so skip the WhatsApp proof, (b) a BEFORE INSERT trigger cannot tell Admin creation from public sign-up and cannot
-- read the Admin API's app_metadata (GoTrue applies it by a later UPDATE), but (c) the Admin INSERT and that UPDATE are ONE
-- transaction, so a DEFERRED constraint trigger that re-reads the committed row at COMMIT sees the final state.
--
-- THE GUARD. AFTER INSERT ON auth.users, DEFERRABLE INITIALLY DEFERRED, only for rows whose e-mail ends with the alias domain
-- (WHEN clause: e-mail, OAuth and every other sign-up never reach the function). At COMMIT it requires, for the final row:
--     app_metadata.phone_signup_grant         = id of an app.phone_signup_grants row,
--     app_metadata.phone_signup_registration  = that grant's registration_id,
--     grant.alias = the user's e-mail, not consumed, not expired, and the user is not anonymous,
-- and consumes the grant in the same transaction (single use). Anything else raises 42501 and GoTrue rolls the whole request
-- back. A public /signup body cannot set app_metadata (measured, SEC-A7/B5), so the marker cannot be forged by a caller.
--
-- A GRANT is minted ONLY by phone_signup_verify, i.e. only after a correct code for exactly that number was presented by the
-- registration that requested it. It is bound to: the canonical phone and its alias, the registration intent
-- ('phone_signup'), the registration id, the challenge it came from (unique), and exactly ONE permitted Auth user creation.
--
-- ATTACH. After the server created the Auth user and ran the usual initialisation RPCs (profile_set_phone sets the number),
-- phone_signup_attach(user, grant) sets profiles.phone_verified_at for that user ONLY IF the grant was consumed by that very
-- user, the Auth e-mail equals the grant's alias, the profile number equals the proven number, the attach window has not
-- passed and the grant was not attached before. Same completion rule as B1: under the profile row lock, WHERE phone matches
-- AND phone_verified_at IS NULL. It never touches auth.users / identities / MFA / roles / memberships / consents / points.
--
-- LOCK ORDER (extends B1's; every function follows it):
--   signup start/verify/invalidate: (1) registration advisory lock  (1b) phone advisory lock (start only)  (3) challenge row  (4) ip bucket
--   attach:                         (1) per-user advisory lock  (2) profiles row  (3) grant row
--   the guard (at COMMIT of the Auth transaction): grant row only - the Auth transaction holds no profile lock another path waits on.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Configuration: new switches and limits (all default OFF / conservative)
-- ---------------------------------------------------------------------------
alter table app.phone_verification_config
  add column signup_enabled      boolean  not null default false,
  add column alias_guard_mode    text     not null default 'off' check (alias_guard_mode in ('off', 'observe', 'enforce')),
  add column grant_ttl           interval not null default interval '10 minutes' check (grant_ttl between interval '1 minute' and interval '30 minutes'),
  add column grant_attach_window interval not null default interval '15 minutes' check (grant_attach_window between interval '1 minute' and interval '1 hour'),
  add column signup_phone_hourly smallint not null default 5 check (signup_phone_hourly between 1 and 20),
  add constraint ck_config_signup_needs_guard check (not signup_enabled or alias_guard_mode <> 'off');

-- A signup proof mints a grant that only the guard consumes (and attach requires that consumption), so signup_enabled needs the
-- guard at least observing. This also makes the activation order impossible to get wrong: guard first, then signup.
comment on column app.phone_verification_config.alias_guard_mode is
  'off = guard installed but inert (default); observe = never blocks, records would-be refusals in app.phone_alias_guard_observations; enforce = refuses alias creation without a valid grant. Switch to enforce only after the registration code mints grants (see docs/security/PHONE_SIGNUP_R1_MIGRATION_AND_ACTIVATION_PLAN.md).';

-- Every change to a switch is recorded (who, when, from, to). The log holds no phone number.
create table app.phone_verification_config_log (
  id         bigserial primary key,
  changed_at timestamptz not null default clock_timestamp(),
  changed_by text not null default current_user,
  session_by text not null default session_user,
  setting    text not null,
  old_value  text,
  new_value  text
);
alter table app.phone_verification_config_log enable row level security;
revoke all on app.phone_verification_config_log from public, anon, authenticated, service_role;

create function app.phone_verification_config_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.enabled is distinct from old.enabled then
    insert into app.phone_verification_config_log (setting, old_value, new_value) values ('enabled', old.enabled::text, new.enabled::text);
  end if;
  if new.signup_enabled is distinct from old.signup_enabled then
    insert into app.phone_verification_config_log (setting, old_value, new_value) values ('signup_enabled', old.signup_enabled::text, new.signup_enabled::text);
  end if;
  if new.alias_guard_mode is distinct from old.alias_guard_mode then
    insert into app.phone_verification_config_log (setting, old_value, new_value) values ('alias_guard_mode', old.alias_guard_mode, new.alias_guard_mode);
  end if;
  return null;
end;
$$;
revoke all on function app.phone_verification_config_audit() from public, anon, authenticated, service_role;
create trigger phone_verification_config_audit
  after update on app.phone_verification_config
  for each row execute function app.phone_verification_config_audit();

-- ---------------------------------------------------------------------------
-- 2. Challenges: a second purpose whose subject is a registration, not a user
-- ---------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'app.phone_verification_challenges'::regclass and contype = 'c'
       and (pg_get_constraintdef(oid) like '%purpose = ''primary_proof''%' or pg_get_constraintdef(oid) like '%invalidated_why = ANY%' or pg_get_constraintdef(oid) like '%invalidated_why)::text = ANY%')
  loop
    execute format('alter table app.phone_verification_challenges drop constraint %I', c.conname);
  end loop;
end $$;

alter table app.phone_verification_challenges
  alter column user_id drop not null,
  add column registration_id uuid,
  add constraint ck_pvc_purpose check (purpose in ('primary_proof', 'signup_proof')),
  add constraint ck_pvc_subject check (
       (purpose = 'primary_proof' and user_id is not null     and registration_id is null)
    or (purpose = 'signup_proof'  and user_id is null         and registration_id is not null)),
  add constraint ck_pvc_why_values check (invalidated_why in ('superseded', 'expired', 'claim_changed', 'too_many_attempts', 'delivery_failed', 'suppressed'));

create unique index uq_pvc_open_signup on app.phone_verification_challenges (registration_id)
  where purpose = 'signup_proof' and consumed_at is null and invalidated_at is null;
create index ix_pvc_registration_created on app.phone_verification_challenges (registration_id, created_at desc) where registration_id is not null;
create index ix_pvc_phone_created on app.phone_verification_challenges (phone_e164, created_at desc) where purpose = 'signup_proof';

-- ---------------------------------------------------------------------------
-- 3. Grants (the only thing the guard accepts) and observations (observe mode)
-- ---------------------------------------------------------------------------
create table app.phone_signup_grants (
  id               uuid primary key default gen_random_uuid(),
  alias            text not null check (alias ~ '^p[1-9][0-9]{6,14}@craftsman-login\.aladdin\.invalid$'),
  phone_e164       text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  intent           text not null default 'phone_signup' check (intent = 'phone_signup'),
  registration_id  uuid not null,
  challenge_id     uuid not null unique references app.phone_verification_challenges (id) on delete cascade,
  created_at       timestamptz not null default clock_timestamp(),
  expires_at       timestamptz not null,
  consumed_at      timestamptz,
  consumed_user_id uuid,
  attached_at      timestamptz,
  constraint ck_psg_alias_matches_phone check (alias = 'p' || substr(phone_e164, 2) || '@craftsman-login.aladdin.invalid'),
  constraint ck_psg_window check (expires_at > created_at and expires_at <= created_at + interval '30 minutes'),
  constraint ck_psg_consumed check ((consumed_at is null) = (consumed_user_id is null)),
  constraint ck_psg_attached check (attached_at is null or consumed_at is not null)
);
create index ix_psg_created on app.phone_signup_grants (created_at);
alter table app.phone_signup_grants enable row level security;
revoke all on app.phone_signup_grants from public, anon, authenticated, service_role;
comment on table app.phone_signup_grants is
  'Single-use permission to create ONE Auth user on ONE phone alias, minted only by phone_signup_verify. No API role has any privilege on it.';

create table app.phone_alias_guard_observations (
  id          bigserial primary key,
  observed_at timestamptz not null default clock_timestamp(),
  user_id     uuid not null,
  had_grant   boolean not null
);
alter table app.phone_alias_guard_observations enable row level security;
revoke all on app.phone_alias_guard_observations from public, anon, authenticated, service_role;
comment on table app.phone_alias_guard_observations is
  'observe mode only: alias-domain Auth users that enforce mode WOULD have refused (no valid grant). Carries no phone number or alias.';

-- ---------------------------------------------------------------------------
-- 4. THE GUARD
-- ---------------------------------------------------------------------------
create function app.phone_alias_guard()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
declare
  v_mode text;
  r      record;
  v_grant uuid;
  v_reg   uuid;
  v_ok    boolean := false;
begin
  select alias_guard_mode into v_mode from app.phone_verification_config;
  if v_mode is null or v_mode = 'off' then return null; end if;

  -- Re-read the COMMITTED state of the row: the Admin API's app_metadata arrives by a later UPDATE in the same transaction.
  select u.id, lower(u.email) as email, u.raw_app_meta_data as meta, u.is_anonymous as anon into r
    from auth.users u where u.id = new.id;
  if not found then return null; end if;                     -- removed again inside the same transaction
  if r.email !~ '^p[1-9][0-9]{6,14}@craftsman-login\.aladdin\.invalid$' then return null; end if;

  begin
    v_grant := nullif(r.meta ->> 'phone_signup_grant', '')::uuid;
    v_reg   := nullif(r.meta ->> 'phone_signup_registration', '')::uuid;
  exception when others then
    v_grant := null; v_reg := null;
  end;

  if v_grant is not null and v_reg is not null and not coalesce(r.anon, false) then
    update app.phone_signup_grants
       set consumed_at = clock_timestamp(), consumed_user_id = r.id
     where id = v_grant and alias = r.email and registration_id = v_reg and intent = 'phone_signup'
       and consumed_at is null and expires_at > clock_timestamp();
    v_ok := found;
  end if;
  if v_ok then return null; end if;

  if v_mode = 'observe' then
    insert into app.phone_alias_guard_observations (user_id, had_grant) values (r.id, v_grant is not null);
    return null;
  end if;
  raise exception 'phone alias requires a verified-phone grant' using errcode = '42501';
end;
$$;
revoke all on function app.phone_alias_guard() from public, anon, authenticated, service_role;
comment on function app.phone_alias_guard() is
  'Deferred constraint-trigger function on auth.users (alias-domain e-mails only). Inert while alias_guard_mode = off.';

create constraint trigger phone_alias_guard
  after insert on auth.users
  deferrable initially deferred
  for each row
  when (new.email is not null and lower(new.email) like '%@craftsman-login.aladdin.invalid')
  execute function app.phone_alias_guard();

-- ---------------------------------------------------------------------------
-- 5. Helpers
-- ---------------------------------------------------------------------------
create function app.phone_signup_registration_lock(p_registration_id uuid)
returns void language sql volatile set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('aladdin.phone_signup.registration:' || p_registration_id::text, 0));
$$;
revoke all on function app.phone_signup_registration_lock(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. SIGNUP START
--    Same response shape whether or not the number already belongs to an account (no existence oracle): a taken number
--    gets a row that is born closed ('suppressed') and `deliver = false`, so limits, timing and the reply are identical and
--    the server simply does not send. The destination number is returned to the trusted server only.
-- ---------------------------------------------------------------------------
create function public.phone_signup_start(p_registration_id uuid, p_phone text, p_challenge_id uuid, p_kid text, p_code_mac text, p_ip_key text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  cfg      app.phone_verification_config;
  v_now    timestamptz := clock_timestamp();
  v_last   timestamptz;
  v_n      integer;
  v_old    timestamptz;
  v_bump   integer;
  v_exp    timestamptz;
  v_taken  boolean;
begin
  if p_registration_id is null or p_challenge_id is null or p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$'
     or p_kid is null or p_kid !~ '^[A-Za-z0-9_-]{1,32}$'
     or p_code_mac is null or p_code_mac !~ '^[a-f0-9]{64}$' or p_ip_key is null or p_ip_key !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid verification request' using errcode = '22023';
  end if;

  select * into cfg from app.phone_verification_config;
  if not (cfg.enabled and cfg.signup_enabled) then return jsonb_build_object('status', 'unavailable'); end if;

  perform app.phone_signup_registration_lock(p_registration_id);                         -- (1)
  perform app.lock_phone(p_phone);                                                       -- (1b) caps per number cannot be overshot

  select max(created_at) into v_last from app.phone_verification_challenges where registration_id = p_registration_id;
  if v_last is not null and v_last > v_now - cfg.resend_cooldown then
    return jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', ceil(extract(epoch from (v_last + cfg.resend_cooldown - v_now)))::integer);
  end if;
  select count(*), min(created_at) into v_n, v_old from app.phone_verification_challenges
   where registration_id = p_registration_id and created_at > v_now - interval '1 hour';
  if v_n >= cfg.user_hourly_starts then
    return jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_old + interval '1 hour' - v_now)))::integer));
  end if;
  select count(*), min(created_at) into v_n, v_old from app.phone_verification_challenges
   where purpose = 'signup_proof' and phone_e164 = p_phone and created_at > v_now - interval '1 hour';
  if v_n >= cfg.signup_phone_hourly then
    return jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_old + interval '1 hour' - v_now)))::integer));
  end if;

  v_bump := app.phone_verification_ip_bump('start', p_ip_key, interval '1 hour');        -- (4) leaf
  if v_bump > cfg.ip_hourly_starts then
    return jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', 600);
  end if;

  v_taken := app.phone_is_primary_elsewhere(p_phone, null);

  update app.phone_verification_challenges                                               -- (3)
     set invalidated_at = v_now, invalidated_why = 'superseded'
   where registration_id = p_registration_id and purpose = 'signup_proof' and consumed_at is null and invalidated_at is null;

  v_exp := v_now + cfg.challenge_ttl;
  insert into app.phone_verification_challenges
    (id, user_id, registration_id, purpose, phone_e164, kid, code_mac, created_at, expires_at, invalidated_at, invalidated_why)
  values
    (p_challenge_id, null, p_registration_id, 'signup_proof', p_phone, p_kid, decode(p_code_mac, 'hex'), v_now, v_exp,
     case when v_taken then v_now end, case when v_taken then 'suppressed' end);

  return jsonb_build_object('status', 'challenge_created', 'challenge_id', p_challenge_id, 'expires_at', v_exp,
                            'resend_available_at', v_now + cfg.resend_cooldown, 'deliver', not v_taken, 'phone_e164', p_phone);
end;
$$;
revoke all on function public.phone_signup_start(uuid, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.phone_signup_start(uuid, text, uuid, text, text, text) to service_role;
comment on function public.phone_signup_start(uuid, text, uuid, text, text, text) is
  'service_role only. Opens a signup_proof challenge for a REGISTRATION (no Auth user yet) and a canonical number. Returns {status}: challenge_created (with deliver=false when the number already belongs to an account - same reply, nothing to send) | rate_limited | unavailable (disabled).';

-- ---------------------------------------------------------------------------
-- 7. SIGNUP VERIFY -> single-use grant
-- ---------------------------------------------------------------------------
create function public.phone_signup_verify(p_registration_id uuid, p_challenge_id uuid, p_candidates jsonb, p_ip_key text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  cfg     app.phone_verification_config;
  v_now   timestamptz := clock_timestamp();
  c       app.phone_verification_challenges;
  g       app.phone_signup_grants;
  v_cand  bytea;
  v_ok    boolean := false;
  v_fails integer;
  k       text;
begin
  if p_registration_id is null or p_challenge_id is null or p_ip_key is null or p_ip_key !~ '^[a-f0-9]{64}$'
     or p_candidates is null or jsonb_typeof(p_candidates) <> 'object' or (select count(*) from jsonb_object_keys(p_candidates)) not between 1 and 3 then
    raise exception 'invalid verification request' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_candidates) loop
    if k !~ '^[A-Za-z0-9_-]{1,32}$' or jsonb_typeof(p_candidates -> k) <> 'string' or (p_candidates ->> k) !~ '^[a-f0-9]{64}$' then
      raise exception 'invalid verification request' using errcode = '22023';
    end if;
  end loop;

  select * into cfg from app.phone_verification_config;
  if not (cfg.enabled and cfg.signup_enabled) then return jsonb_build_object('status', 'unavailable'); end if;

  select b.attempts into v_fails from app.phone_verification_ip_buckets b
   where b.action = 'fail' and b.ip_key = p_ip_key and b.window_start > v_now - interval '15 minutes';
  if coalesce(v_fails, 0) >= cfg.ip_failures_15m then
    return jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', 900);
  end if;

  perform app.phone_signup_registration_lock(p_registration_id);                         -- (1)

  <<attempt>>
  loop
    select * into c from app.phone_verification_challenges ch                            -- (3)
     where ch.id = p_challenge_id and ch.registration_id = p_registration_id and ch.purpose = 'signup_proof' for update;
    if not found then exit attempt; end if;
    if c.consumed_at is not null or c.invalidated_at is not null then exit attempt; end if;

    if c.expires_at <= v_now then
      update app.phone_verification_challenges set invalidated_at = v_now, invalidated_why = 'expired' where id = c.id;
      exit attempt;
    end if;
    -- The number may have been taken since the code was sent.
    if app.phone_is_primary_elsewhere(c.phone_e164, null) then
      update app.phone_verification_challenges set invalidated_at = v_now, invalidated_why = 'claim_changed' where id = c.id;
      exit attempt;
    end if;

    v_cand := case when jsonb_typeof(p_candidates -> c.kid) = 'string' then decode(p_candidates ->> c.kid, 'hex') end;
    if v_cand is null or v_cand is distinct from c.code_mac then
      update app.phone_verification_challenges
         set attempts = attempts + 1,
             invalidated_at  = case when attempts + 1 >= cfg.max_attempts then v_now end,
             invalidated_why = case when attempts + 1 >= cfg.max_attempts then 'too_many_attempts' end
       where id = c.id;
      exit attempt;
    end if;

    update app.phone_verification_challenges set consumed_at = v_now where id = c.id and consumed_at is null and invalidated_at is null;
    insert into app.phone_signup_grants (alias, phone_e164, registration_id, challenge_id, created_at, expires_at)
    values ('p' || substr(c.phone_e164, 2) || '@craftsman-login.aladdin.invalid', c.phone_e164, p_registration_id, c.id, v_now, v_now + cfg.grant_ttl)
    returning * into g;
    v_ok := true;
    exit attempt;
  end loop;

  if v_ok then
    return jsonb_build_object('status', 'verified', 'grant_id', g.id, 'registration_id', g.registration_id, 'alias', g.alias,
                              'phone_e164', g.phone_e164, 'expires_at', g.expires_at);
  end if;
  perform app.phone_verification_ip_bump('fail', p_ip_key, interval '15 minutes');       -- (4) leaf
  return jsonb_build_object('status', 'invalid');
end;
$$;
revoke all on function public.phone_signup_verify(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.phone_signup_verify(uuid, uuid, jsonb, text) to service_role;
comment on function public.phone_signup_verify(uuid, uuid, jsonb, text) is
  'service_role only. Checks a signup_proof code for the registration that asked for it and mints ONE single-use grant for creating the Auth user on that exact phone alias. One generic invalid for every failure. Does not create, touch or verify any account.';

-- ---------------------------------------------------------------------------
-- 8. ATTACH: the grant -> profiles.phone_verified_at for the exact proven number
-- ---------------------------------------------------------------------------
create function public.phone_signup_attach(p_user_id uuid, p_grant_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  cfg    app.phone_verification_config;
  v_now  timestamptz := clock_timestamp();
  v_prof public.profiles;
  g      app.phone_signup_grants;
  v_ok   boolean := false;
begin
  if p_user_id is null or p_grant_id is null then
    raise exception 'invalid verification request' using errcode = '22023';
  end if;
  select * into cfg from app.phone_verification_config;
  if not (cfg.enabled and cfg.signup_enabled) then return jsonb_build_object('status', 'unavailable'); end if;

  perform app.phone_verification_user_lock(p_user_id);                                   -- (1)

  <<attempt>>
  loop
    select p.* into v_prof from public.profiles p
     where p.user_id = p_user_id and p.deleted_at is null for update;                    -- (2)
    if not found or v_prof.phone_e164 is null then exit attempt; end if;

    select * into g from app.phone_signup_grants where id = p_grant_id for update;       -- (3)
    if not found or g.consumed_user_id is distinct from p_user_id or g.attached_at is not null then exit attempt; end if;
    if g.consumed_at + cfg.grant_attach_window <= v_now then exit attempt; end if;
    if v_prof.phone_e164 is distinct from g.phone_e164 then exit attempt; end if;
    if not exists (select 1 from auth.users u where u.id = p_user_id and lower(u.email) = g.alias) then exit attempt; end if;

    update public.profiles
       set phone_verified_at = v_now
     where user_id = p_user_id and phone_e164 = g.phone_e164 and phone_verified_at is null;
    if not found then exit attempt; end if;
    update app.phone_signup_grants set attached_at = v_now where id = g.id;
    insert into public.audit_log (actor_user_id, action, subject_type, subject_id, metadata)
    values (p_user_id, 'phone_verification.completed', 'user', p_user_id, jsonb_build_object('purpose', 'signup_proof', 'channel', 'whatsapp'));
    v_ok := true;
    exit attempt;
  end loop;

  return jsonb_build_object('status', case when v_ok then 'attached' else 'invalid' end);
end;
$$;
revoke all on function public.phone_signup_attach(uuid, uuid) from public, anon, authenticated;
grant execute on function public.phone_signup_attach(uuid, uuid) to service_role;
comment on function public.phone_signup_attach(uuid, uuid) is
  'service_role only. Sets profiles.phone_verified_at for the exact number a signup grant proved, only for the Auth user that consumed that grant, only while the profile still holds that number. Generic invalid otherwise.';

-- ---------------------------------------------------------------------------
-- 9. Delivery failure for a signup challenge
-- ---------------------------------------------------------------------------
create function public.phone_signup_invalidate(p_registration_id uuid, p_challenge_id uuid, p_reason text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_n integer;
begin
  if p_registration_id is null or p_challenge_id is null or p_reason is distinct from 'delivery_failed' then
    raise exception 'invalid verification request' using errcode = '22023';
  end if;
  perform app.phone_signup_registration_lock(p_registration_id);                         -- (1)
  update app.phone_verification_challenges                                               -- (3)
     set invalidated_at = clock_timestamp(), invalidated_why = 'delivery_failed'
   where id = p_challenge_id and registration_id = p_registration_id and purpose = 'signup_proof' and consumed_at is null and invalidated_at is null;
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;
revoke all on function public.phone_signup_invalidate(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.phone_signup_invalidate(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 10. Retention: the existing purge also clears observations (grants go with their challenge, ON DELETE CASCADE)
-- ---------------------------------------------------------------------------
create or replace function public.phone_verification_purge(p_older_than interval default interval '30 days')
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_ch integer; v_ip integer; v_ob integer; v_cut timestamptz;
begin
  if p_older_than is null or p_older_than < interval '1 day' then
    raise exception 'retention must be at least one day' using errcode = '22023';
  end if;
  v_cut := clock_timestamp() - p_older_than;
  delete from app.phone_verification_challenges
   where created_at < v_cut and (consumed_at is not null or invalidated_at is not null or expires_at < v_cut);
  get diagnostics v_ch = row_count;
  delete from app.phone_verification_ip_buckets where window_start < clock_timestamp() - interval '2 days';
  get diagnostics v_ip = row_count;
  delete from app.phone_alias_guard_observations where observed_at < v_cut;
  get diagnostics v_ob = row_count;
  return jsonb_build_object('challenges_deleted', v_ch, 'ip_buckets_deleted', v_ip, 'observations_deleted', v_ob);
end;
$$;
