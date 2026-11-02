-- ===========================================================================
-- Phone verification authority (Phase B1): prove possession of an account's EXISTING primary phone.
--
-- LOCAL / REVIEW ONLY until separately approved. Authored for the isolated local stack; NOT applied to Acceptance or Production.
-- Ships DISABLED: app.phone_verification_config.enabled = false, so every entry point answers 'unavailable'.
--
-- WHAT THIS IS. One database authority that turns "a code reached the number on this account" into
-- profiles.phone_verified_at (the existing single source of truth), and into nothing else:
--   * It never reads or writes auth.users / auth.identities / auth.mfa_factors, never creates or links an Auth identity,
--     never touches roles, memberships, consents, points, the sign-in alias or registration state.
--   * Verification is evidence of possession at one moment. It is NOT a login, recovery, MFA or marketing permission.
--
-- TRUST BOUNDARY (the point of this design).
--   Application server (trusted):  generates the one-time code with a CSPRNG; holds the HMAC key(s); computes
--                                  MAC = HMAC-SHA256(key[kid], "otp1|challenge_id|user_id|purpose|code"); hands the code to
--                                  a delivery adapter (Cloudflare Worker / fake). It authenticates the user and passes the
--                                  user id; it never trusts a client-supplied user id.
--   Database (authority):          stores ONLY the MAC and the key id (kid). It never sees the raw code or the key, so a
--                                  database read (backup, replica, SQL injection, log) cannot be turned into an offline
--                                  brute force of a 6-digit code. It owns every state transition and the completion write.
--   service_role only:             every function below is executable by service_role and nobody else.
--
-- KEY ROTATION. The server signs new challenges with `current` and, on verify, offers a MAC for each accepted kid
-- ({kid: mac}); the database compares the entry for the challenge's own kid. Add key -> make it current -> after one
-- challenge lifetime (<= 10 min) retire the old kid. A challenge issued under a retired kid can only fail closed.
--
-- LOCK ORDER (global, every function here follows it; deadlock-free against the existing writers):
--   (1) per-user advisory lock   pg_advisory_xact_lock('aladdin.phone_verification.user:<id>')   -- serializes start/verify/invalidate per account
--   (2) profiles row FOR UPDATE                                                                  -- the SAME first lock profile_set_phone takes
--   (3) challenge row FOR UPDATE
--   (4) ip bucket upsert (leaf, always last)
--   The phone advisory lock (app.lock_phone) is deliberately NOT taken: profile_set_phone locks the profile row first and the
--   claim trigger takes the phone lock afterwards, so taking it before the row here would invert that order. Holding the
--   profile row FOR UPDATE already freezes the number for the whole transaction, which is all verification needs.
--   Isolation: READ COMMITTED (PostgREST default). After waiting on a row lock FOR UPDATE re-reads the committed row, so
--   the number compared is the current one. Under REPEATABLE READ/SERIALIZABLE a concurrent change surfaces as 40001 and
--   fails closed.
--
-- NO STALE VERIFIED STATE. Completion runs under the profile row lock and sets phone_verified_at only
-- `WHERE user_id = p_user AND phone_e164 = challenge.phone_e164 AND phone_verified_at IS NULL`.
--   * change committed BEFORE completion  -> the compare fails, challenge invalidated ('claim_changed'), nothing verified;
--   * change arrives AFTER completion      -> it waits for the lock, then the existing BEFORE UPDATE trigger
--                                              profiles_reset_phone_verification sets phone_verified_at back to NULL.
--   A phone change also invalidates every open challenge for the account (AFTER UPDATE OF phone_e164 trigger).
--
-- ERRORS. Verification failures are one generic outcome ('invalid') whatever the cause (wrong code, wrong account, unknown
-- or foreign challenge id, expired, consumed, invalidated, number changed): no ownership or state hint. Rate limiting is
-- reported as 'rate_limited' with a retry hint; it only ever concerns the caller's own account/IP.
--
-- LIMITS (config row, bounded by CHECKs): TTL 5 min, 5 attempts per challenge, 60 s resend cooldown, 6 starts/hour and 10/day
-- per account, 20 starts/hour per IP key, 30 failed verifications per 15 min per IP key. The IP key is an HMAC of the client
-- address computed by the server (the database never sees an address).
--
-- NOT IN B1 (explicit): mandatory verification for new sign-ups, secondary-phone verification, primary replacement
-- (verify-before-switch), the delivery adapter, any UI. purpose is constrained to 'primary_proof' so adding another purpose
-- is a reviewed migration, not a data change.
-- ===========================================================================

select app.audit_actions_add(array['phone_verification.started', 'phone_verification.completed']);

-- ---------------------------------------------------------------------------
-- 1. Configuration (single row, ships disabled)
-- ---------------------------------------------------------------------------
create table app.phone_verification_config (
  singleton            boolean primary key default true check (singleton),
  enabled              boolean  not null default false,
  challenge_ttl        interval not null default interval '5 minutes'  check (challenge_ttl between interval '1 minute' and interval '10 minutes'),
  max_attempts         smallint not null default 5                     check (max_attempts between 1 and 10),
  resend_cooldown      interval not null default interval '60 seconds' check (resend_cooldown between interval '30 seconds' and interval '1 hour'),
  user_hourly_starts   smallint not null default 6                     check (user_hourly_starts between 1 and 20),
  user_daily_starts    smallint not null default 10                    check (user_daily_starts between 1 and 50),
  ip_hourly_starts     smallint not null default 20                    check (ip_hourly_starts between 1 and 200),
  ip_failures_15m      smallint not null default 30                    check (ip_failures_15m between 1 and 300)
);
insert into app.phone_verification_config default values;
alter table app.phone_verification_config enable row level security;
revoke all on app.phone_verification_config from public, anon, authenticated, service_role;
comment on table app.phone_verification_config is
  'Phone verification authority switches and limits. Ships disabled. Changed only by the migration owner after explicit approval; no API role can read or write it.';

-- ---------------------------------------------------------------------------
-- 2. Challenges
-- ---------------------------------------------------------------------------
create table app.phone_verification_challenges (
  id              uuid primary key,   -- chosen by the server so the MAC can bind to it; the primary key blocks reuse
  user_id         uuid not null references public.users (id) on delete cascade,
  purpose         text not null check (purpose = 'primary_proof'),
  phone_e164      text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  kid             text not null check (kid ~ '^[A-Za-z0-9_-]{1,32}$'),
  code_mac        bytea not null check (octet_length(code_mac) = 32),
  created_at      timestamptz not null default clock_timestamp(),
  expires_at      timestamptz not null,
  attempts        smallint not null default 0 check (attempts >= 0),
  consumed_at     timestamptz,
  invalidated_at  timestamptz,
  invalidated_why text check (invalidated_why in ('superseded', 'expired', 'claim_changed', 'too_many_attempts', 'delivery_failed')),
  constraint ck_pvc_window check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  constraint ck_pvc_state check (not (consumed_at is not null and invalidated_at is not null)),
  constraint ck_pvc_why check ((invalidated_at is null) = (invalidated_why is null))
);
create unique index uq_pvc_open on app.phone_verification_challenges (user_id, purpose) where consumed_at is null and invalidated_at is null;
create index ix_pvc_user_created on app.phone_verification_challenges (user_id, created_at desc);
create index ix_pvc_created on app.phone_verification_challenges (created_at);
alter table app.phone_verification_challenges enable row level security;
revoke all on app.phone_verification_challenges from public, anon, authenticated, service_role;
comment on table app.phone_verification_challenges is
  'Possession-proof challenges. Stores the HMAC of the code and the key id only - never the code or the key. Written only by the phone_verification_* functions.';

create table app.phone_verification_ip_buckets (
  action       text not null check (action in ('start', 'fail')),
  ip_key       text not null check (ip_key ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,
  attempts     integer not null check (attempts >= 0),
  primary key (action, ip_key)
);
create index ix_pvib_window on app.phone_verification_ip_buckets (window_start);
alter table app.phone_verification_ip_buckets enable row level security;
revoke all on app.phone_verification_ip_buckets from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Internal helpers
-- ---------------------------------------------------------------------------
-- Leaf of the lock order: bump (or restart) a fixed window and return the new count.
create function app.phone_verification_ip_bump(p_action text, p_ip_key text, p_window interval)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); v_count integer;
begin
  insert into app.phone_verification_ip_buckets as b (action, ip_key, window_start, attempts)
  values (p_action, p_ip_key, v_now, 1)
  on conflict (action, ip_key) do update set
    attempts     = case when b.window_start <= v_now - p_window then 1 else least(b.attempts + 1, 1000000) end,
    window_start = case when b.window_start <= v_now - p_window then v_now else b.window_start end
  returning attempts into v_count;
  return v_count;
end;
$$;
revoke all on function app.phone_verification_ip_bump(text, text, interval) from public, anon, authenticated, service_role;

create function app.phone_verification_user_lock(p_user_id uuid)
returns void language sql volatile set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('aladdin.phone_verification.user:' || p_user_id::text, 0));
$$;
revoke all on function app.phone_verification_user_lock(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. START
-- ---------------------------------------------------------------------------
create function public.phone_verification_start(p_user_id uuid, p_challenge_id uuid, p_kid text, p_code_mac text, p_ip_key text)
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

-- ---------------------------------------------------------------------------
-- 5. VERIFY (and complete)
-- ---------------------------------------------------------------------------
create function public.phone_verification_verify(p_user_id uuid, p_challenge_id uuid, p_candidates jsonb, p_ip_key text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  cfg      app.phone_verification_config;
  v_now    timestamptz := clock_timestamp();
  v_prof   public.profiles;
  c        app.phone_verification_challenges;
  v_cand   bytea;
  v_ok     boolean := false;
  v_fails  integer;
  k        text;
begin
  if p_user_id is null or p_challenge_id is null or p_ip_key is null or p_ip_key !~ '^[a-f0-9]{64}$'
     or p_candidates is null or jsonb_typeof(p_candidates) <> 'object' or (select count(*) from jsonb_object_keys(p_candidates)) not between 1 and 3 then
    raise exception 'invalid verification request' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_candidates) loop
    if k !~ '^[A-Za-z0-9_-]{1,32}$' or jsonb_typeof(p_candidates -> k) <> 'string' or (p_candidates ->> k) !~ '^[a-f0-9]{64}$' then
      raise exception 'invalid verification request' using errcode = '22023';
    end if;
  end loop;

  select * into cfg from app.phone_verification_config;
  if not cfg.enabled then return jsonb_build_object('status', 'unavailable'); end if;

  -- Cheap early refusal for an IP key already over its failure budget (read only, takes no lock).
  select b.attempts into v_fails from app.phone_verification_ip_buckets b
   where b.action = 'fail' and b.ip_key = p_ip_key and b.window_start > v_now - interval '15 minutes';
  if coalesce(v_fails, 0) >= cfg.ip_failures_15m then
    return jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', 900);
  end if;

  perform app.phone_verification_user_lock(p_user_id);                                   -- (1)

  <<attempt>>
  loop   -- single pass; `exit attempt` is the one generic failure exit
    select p.* into v_prof from public.profiles p
     where p.user_id = p_user_id and p.deleted_at is null for update;                    -- (2)
    if not found or v_prof.phone_e164 is null then exit attempt; end if;
    if exists (select 1 from app.installer_phone_changes x where x.user_id = p_user_id and x.state in ('pending', 'needs_attention')) then exit attempt; end if;

    select * into c from app.phone_verification_challenges ch                            -- (3)
     where ch.id = p_challenge_id and ch.user_id = p_user_id for update;                 -- a foreign challenge id is simply not found
    if not found then exit attempt; end if;
    if c.consumed_at is not null or c.invalidated_at is not null then exit attempt; end if;

    if c.expires_at <= v_now then
      update app.phone_verification_challenges set invalidated_at = v_now, invalidated_why = 'expired' where id = c.id;
      exit attempt;
    end if;
    -- Re-validate the binding against the LIVE claim under the profile lock.
    if v_prof.phone_e164 is distinct from c.phone_e164 or v_prof.phone_verified_at is not null then
      update app.phone_verification_challenges set invalidated_at = v_now, invalidated_why = 'claim_changed' where id = c.id;
      exit attempt;
    end if;

    v_cand := case when jsonb_typeof(p_candidates -> c.kid) = 'string' then decode(p_candidates ->> c.kid, 'hex') end;
    if v_cand is null or v_cand is distinct from c.code_mac then
      -- Comparing two server-computed MACs: the caller controls only the code guess, never the MAC bytes, so a
      -- non-constant-time compare gives a guesser nothing to extend byte by byte.
      update app.phone_verification_challenges
         set attempts = attempts + 1,
             invalidated_at  = case when attempts + 1 >= cfg.max_attempts then v_now end,
             invalidated_why = case when attempts + 1 >= cfg.max_attempts then 'too_many_attempts' end
       where id = c.id;
      exit attempt;
    end if;

    -- SUCCESS: one transaction, under the profile lock. consumed_at is the single-use commit point.
    update app.phone_verification_challenges set consumed_at = v_now where id = c.id and consumed_at is null and invalidated_at is null;
    update public.profiles
       set phone_verified_at = v_now
     where user_id = p_user_id and phone_e164 = c.phone_e164 and phone_verified_at is null;
    if not found then
      raise exception 'phone verification completion invariant violated' using errcode = 'XX000';   -- rolls everything back
    end if;
    insert into public.audit_log (actor_user_id, action, subject_type, subject_id, metadata)
    values (p_user_id, 'phone_verification.completed', 'user', p_user_id, jsonb_build_object('purpose', 'primary_proof', 'channel', 'whatsapp'));
    v_ok := true;
    exit attempt;
  end loop;

  if v_ok then return jsonb_build_object('status', 'verified'); end if;
  perform app.phone_verification_ip_bump('fail', p_ip_key, interval '15 minutes');       -- (4) leaf
  return jsonb_build_object('status', 'invalid');
end;
$$;
revoke all on function public.phone_verification_verify(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.phone_verification_verify(uuid, uuid, jsonb, text) to service_role;
comment on function public.phone_verification_verify(uuid, uuid, jsonb, text) is
  'service_role only. Verifies a challenge for the server-authenticated account and, in the same transaction and under the profile row lock, sets profiles.phone_verified_at for that account''s exact current primary phone. p_candidates is {kid: hex MAC} for each accepted key. Every failure is the single generic status invalid; rate_limited and unavailable concern only the caller''s own IP/feature state. Grants no login, recovery, MFA or marketing permission.';

-- ---------------------------------------------------------------------------
-- 6. Delivery failure: close a challenge whose code could not be sent
-- ---------------------------------------------------------------------------
create function public.phone_verification_invalidate(p_user_id uuid, p_challenge_id uuid, p_reason text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_n integer;
begin
  if p_user_id is null or p_challenge_id is null or p_reason is distinct from 'delivery_failed' then
    raise exception 'invalid verification request' using errcode = '22023';
  end if;
  perform app.phone_verification_user_lock(p_user_id);                                   -- (1)
  update app.phone_verification_challenges                                               -- (3)
     set invalidated_at = clock_timestamp(), invalidated_why = 'delivery_failed'
   where id = p_challenge_id and user_id = p_user_id and consumed_at is null and invalidated_at is null;
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;
revoke all on function public.phone_verification_invalidate(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.phone_verification_invalidate(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. A number change closes every open challenge for the account
-- ---------------------------------------------------------------------------
create function app.phone_verification_on_phone_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update app.phone_verification_challenges
     set invalidated_at = clock_timestamp(), invalidated_why = 'claim_changed'
   where user_id = new.user_id and consumed_at is null and invalidated_at is null;
  return null;
end;
$$;
revoke all on function app.phone_verification_on_phone_change() from public, anon, authenticated, service_role;
create trigger phone_verification_on_phone_change
  after update of phone_e164 on public.profiles
  for each row when (old.phone_e164 is distinct from new.phone_e164)
  execute function app.phone_verification_on_phone_change();

-- ---------------------------------------------------------------------------
-- 8. Retention (privacy): closed challenges carry a phone number and are not needed after a short audit window
-- ---------------------------------------------------------------------------
create function public.phone_verification_purge(p_older_than interval default interval '30 days')
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_ch integer; v_ip integer; v_cut timestamptz;
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
  return jsonb_build_object('challenges_deleted', v_ch, 'ip_buckets_deleted', v_ip);
end;
$$;
revoke all on function public.phone_verification_purge(interval) from public, anon, authenticated;
grant execute on function public.phone_verification_purge(interval) to service_role;
comment on function public.phone_verification_purge(interval) is
  'service_role only. Deletes closed challenges older than the retention (>= 1 day, default 30) and stale IP buckets. Needs a scheduler before enablement (deployment blocker).';
