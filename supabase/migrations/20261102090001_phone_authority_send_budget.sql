-- ===========================================================================
-- Phone authority: global send budget and provider-acceptance record (reconciles PR #116's cost controls with the R1 authority).
--
-- WHY. PR #116 built an atomic send budget, a per-number cap and a "provider accepted" marker for its own in-app sender and its own
-- table (public.phone_verification_challenges from 20261028090001). The approved architecture is ONE authority (app.phone_verification_*,
-- 20261030090001/2) plus the signed delivery Worker, so that legacy table has no caller and those functions would have been unused
-- controls. This migration moves the protections the R1 authority did not yet have INTO the R1 authority:
--
--   * a GLOBAL rolling-24h send budget across every number and both purposes (config.daily_send_budget), enforced inside
--     phone_verification_start and phone_signup_start under one advisory lock, so concurrent starts cannot overshoot. A challenge that
--     was suppressed (the number already belongs to an account, nothing is sent) does not spend budget. Exhaustion answers the same
--     'unavailable' as a disabled feature, whatever the number, so it reveals nothing about any account.
--   * provider_accepted_at: stamped by phone_verification_mark_sent when the delivery Worker reported that Meta accepted the message
--     (the billable event; accepted is not delivered). A challenge with no stamp was reserved against the budget but is not known sent.
--
-- Already in R1 and NOT duplicated: per-account hourly/daily caps, per-registration caps, per-number signup cap, per-IP caps, resend
-- cooldown, HMAC-only code storage, completion under the profile row lock for the account's CURRENT primary number
-- (phone_verification_verify / phone_signup_attach), single-use grants, generic 'invalid' outcomes.
--
-- The feature itself stays disabled (config.enabled = false) until separately approved. The two start functions keep their signatures
-- (create or replace), so callers and existing grants are unaffected.
-- ===========================================================================

alter table app.phone_verification_config
  add column daily_send_budget integer not null default 200 check (daily_send_budget between 1 and 100000);

comment on column app.phone_verification_config.daily_send_budget is
  'Maximum phone-verification challenges that may be created in any rolling 24 hours across ALL numbers and purposes (suppressed ones excluded). Exhausted = the start entry points answer unavailable.';

alter table app.phone_verification_challenges
  add column provider_accepted_at timestamptz;

comment on column app.phone_verification_challenges.provider_accepted_at is
  'When the delivery Worker reported that Meta accepted the message (the billable event). NULL = reserved against the budget, not known to have been sent. Accepted is not delivered.';

create index ix_pvc_budget_window on app.phone_verification_challenges (created_at) where invalidated_why is distinct from 'suppressed';

create or replace function app.phone_verification_config_audit()
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
  if new.daily_send_budget is distinct from old.daily_send_budget then
    insert into app.phone_verification_config_log (setting, old_value, new_value) values ('daily_send_budget', old.daily_send_budget::text, new.daily_send_budget::text);
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Start functions: the R1 bodies plus the global budget check
-- ---------------------------------------------------------------------------
create or replace function public.phone_verification_start(p_user_id uuid, p_challenge_id uuid, p_kid text, p_code_mac text, p_ip_key text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  cfg      app.phone_verification_config;
  v_now    timestamptz := clock_timestamp();
  v_prof   public.profiles;
  v_last   timestamptz;
  v_n_hour integer;
  v_n_day  integer;
  v_old_h  timestamptz;
  v_bump   integer;
  v_exp    timestamptz;
begin
  -- Malformed input is a server bug, not a user outcome.
  if p_user_id is null or p_challenge_id is null or p_kid is null or p_kid !~ '^[A-Za-z0-9_-]{1,32}$'
     or p_code_mac is null or p_code_mac !~ '^[a-f0-9]{64}$' or p_ip_key is null or p_ip_key !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid verification request' using errcode = '22023';
  end if;

  select * into cfg from app.phone_verification_config;
  if not cfg.enabled then return jsonb_build_object('status', 'unavailable'); end if;

  perform app.phone_verification_user_lock(p_user_id);                                   -- (1)

  select p.* into v_prof from public.profiles p
   where p.user_id = p_user_id and p.deleted_at is null for update;                       -- (2)
  if not found or v_prof.phone_e164 is null
     or not exists (select 1 from public.users u where u.id = p_user_id and u.status in ('active', 'pending_verification'))
     or exists (select 1 from app.installer_phone_changes c where c.user_id = p_user_id and c.state in ('pending', 'needs_attention')) then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if v_prof.phone_verified_at is not null then
    return jsonb_build_object('status', 'already_verified');
  end if;

  -- Per-account limits (counted from the challenge table under the user lock, so concurrent starts cannot overshoot).
  select max(created_at) into v_last from app.phone_verification_challenges where user_id = p_user_id;
  if v_last is not null and v_last > v_now - cfg.resend_cooldown then
    return jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', ceil(extract(epoch from (v_last + cfg.resend_cooldown - v_now)))::integer);
  end if;
  select count(*), min(created_at) into v_n_hour, v_old_h from app.phone_verification_challenges where user_id = p_user_id and created_at > v_now - interval '1 hour';
  if v_n_hour >= cfg.user_hourly_starts then
    return jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_old_h + interval '1 hour' - v_now)))::integer));
  end if;
  select count(*) into v_n_day from app.phone_verification_challenges where user_id = p_user_id and created_at > v_now - interval '1 day';
  if v_n_day >= cfg.user_daily_starts then
    return jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', 3600);
  end if;

  -- Global send budget (cost control, ALL numbers): serialized under one advisory lock so concurrent starts cannot overshoot.
  -- Taken after every per-account lock and before the leaf ip bucket; no path takes a per-account lock while holding it.
  perform pg_advisory_xact_lock(hashtextextended('aladdin.phone_verification.send_budget', 0));
  if (select count(*) from app.phone_verification_challenges
       where created_at > v_now - interval '24 hours' and invalidated_why is distinct from 'suppressed') >= cfg.daily_send_budget then
    return jsonb_build_object('status', 'unavailable');
  end if;

  v_bump := app.phone_verification_ip_bump('start', p_ip_key, interval '1 hour');        -- (4) leaf
  if v_bump > cfg.ip_hourly_starts then
    return jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', 600);
  end if;

  update app.phone_verification_challenges                                               -- (3)
     set invalidated_at = v_now, invalidated_why = 'superseded'
   where user_id = p_user_id and purpose = 'primary_proof' and consumed_at is null and invalidated_at is null;

  v_exp := v_now + cfg.challenge_ttl;
  insert into app.phone_verification_challenges (id, user_id, purpose, phone_e164, kid, code_mac, created_at, expires_at)
  values (p_challenge_id, p_user_id, 'primary_proof', v_prof.phone_e164, p_kid, decode(p_code_mac, 'hex'), v_now, v_exp);

  insert into public.audit_log (actor_user_id, action, subject_type, subject_id, metadata)
  values (p_user_id, 'phone_verification.started', 'user', p_user_id, jsonb_build_object('purpose', 'primary_proof'));

  -- phone_e164 is returned to the trusted server ONLY so it can address the delivery adapter; it never reaches the browser.
  return jsonb_build_object('status', 'challenge_created', 'challenge_id', p_challenge_id, 'expires_at', v_exp,
                            'resend_available_at', v_now + cfg.resend_cooldown, 'phone_e164', v_prof.phone_e164);
end;
$$;
revoke all on function public.phone_verification_start(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.phone_verification_start(uuid, uuid, text, text, text) to service_role;
comment on function public.phone_verification_start(uuid, uuid, text, text, text) is
  'service_role only. Opens a possession-proof challenge for the caller-supplied (server-authenticated) account''s CURRENT primary phone. The server generates the code and passes only HMAC(key[kid], ctx+code). Returns {status} (challenge_created also carries the destination phone_e164 for the server-side delivery adapter): challenge_created | already_verified | rate_limited | unavailable (disabled, no phone, inactive account, phone change in progress).';

create or replace function public.phone_signup_start(p_registration_id uuid, p_phone text, p_challenge_id uuid, p_kid text, p_code_mac text, p_ip_key text)
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

  -- Global send budget (cost control, ALL numbers): serialized under one advisory lock so concurrent starts cannot overshoot.
  -- Taken after every per-account lock and before the leaf ip bucket; no path takes a per-account lock while holding it.
  perform pg_advisory_xact_lock(hashtextextended('aladdin.phone_verification.send_budget', 0));
  if (select count(*) from app.phone_verification_challenges
       where created_at > v_now - interval '24 hours' and invalidated_why is distinct from 'suppressed') >= cfg.daily_send_budget then
    return jsonb_build_object('status', 'unavailable');
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
-- Provider acceptance record (service_role only, idempotent)
-- ---------------------------------------------------------------------------
create function public.phone_verification_mark_sent(p_challenge_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_n integer;
begin
  if p_challenge_id is null then
    raise exception 'invalid verification request' using errcode = '22023';
  end if;
  update app.phone_verification_challenges
     set provider_accepted_at = clock_timestamp()
   where id = p_challenge_id and provider_accepted_at is null and consumed_at is null and invalidated_at is null;
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;
revoke all on function public.phone_verification_mark_sent(uuid) from public, anon, authenticated;
grant execute on function public.phone_verification_mark_sent(uuid) to service_role;
comment on function public.phone_verification_mark_sent(uuid) is
  'service_role only. Stamps provider_accepted_at on an OPEN challenge once the delivery Worker reported Meta accepted the message. Idempotent (a second call, or a closed challenge, returns false). Carries no phone number and changes no proof state.';
