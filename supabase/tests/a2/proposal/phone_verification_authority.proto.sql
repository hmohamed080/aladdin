-- ===========================================================================
-- PHASE A2 PROTOTYPE - candidate "database-native verification authority" (NOT A MIGRATION).
--
-- This file is loaded by supabase/tests/a2/phone_identity_a2_local.test.mjs into a SCRATCH schema (a2_proto)
-- of the isolated local stack and dropped again at the end of the run. It is never placed under
-- supabase/migrations, never applied to Acceptance/Production, and sends nothing: the transport is out of
-- scope - the trusted caller (a future server action / Worker) receives the code from start() and would hand it
-- to a delivery adapter. Raw codes are never stored: only a salted hash.
--
-- WHAT IT DECIDES (see docs/security/PHONE_IDENTITY_A2_LOCAL_VERIFICATION_REPORT.md):
--   * One challenge is bound to exactly: account + E.164 + purpose + claim (primary phone value, or a specific
--     secondary reservation id) at the moment of issue. Binding is re-validated against the LIVE claim at verify
--     time, so an edit / expiry / cancellation / conversion invalidates the challenge instead of resurrecting it.
--   * Every failure mode is a single generic outcome ('invalid'); no ownership hint leaks.
--   * Single use: the verifying UPDATE ... WHERE consumed_at IS NULL is the commit point; a replay or a racing
--     twin matches zero rows.
--   * Evidence is channel + time + challenge id. It grants NO permission: no login, recovery, MFA or contact opt-in.
--   * Prototype stops at the evidence row. The one-line completion write (profiles.phone_verified_at for the
--     exact current primary, or reservation.verified_at) is DELIBERATELY not exercised against any fixture in A2,
--     because writing it would simulate a successful production verification on an existing identity.
-- ===========================================================================
create schema a2_proto;

create table a2_proto.challenge (
  id               uuid primary key default extensions.gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  purpose          text not null check (purpose in ('signup_primary', 'primary_proof', 'secondary_proof')),
  phone_e164       text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  reservation_id   uuid,                       -- secondary_proof only: the exact reservation this proof belongs to
  salt             bytea not null default extensions.gen_random_bytes(16),
  code_hash        bytea not null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  attempts         smallint not null default 0,
  max_attempts     smallint not null default 5,
  consumed_at      timestamptz,
  invalidated_at   timestamptz,
  invalidated_why  text,
  constraint ck_chal_state check (not (consumed_at is not null and invalidated_at is not null)),
  constraint ck_chal_secondary check ((purpose = 'secondary_proof') = (reservation_id is not null))
);
-- At most one OPEN challenge per account+purpose: a new start supersedes the old one, never runs beside it.
create unique index uq_chal_open on a2_proto.challenge (user_id, purpose) where consumed_at is null and invalidated_at is null;

-- Evidence only. channel+time+challenge; grants nothing.
create table a2_proto.verified_claim (
  id             uuid primary key default extensions.gen_random_uuid(),
  challenge_id   uuid not null unique references a2_proto.challenge (id),   -- replay guard
  user_id        uuid not null references auth.users (id) on delete cascade,
  phone_e164     text not null,
  purpose        text not null,
  reservation_id uuid,
  channel        text not null default 'whatsapp',
  verified_at    timestamptz not null default now()
);

create function a2_proto.hash_code(p_salt bytea, p_id uuid, p_user uuid, p_phone text, p_purpose text, p_code text)
returns bytea language sql immutable set search_path = '' as $$
  select extensions.digest(p_salt || convert_to(p_id::text || '|' || p_user::text || '|' || p_phone || '|' || p_purpose || '|' || p_code, 'utf8'), 'sha256')
$$;

-- START: trusted (service_role) only. Returns the challenge id and the raw code for the transport adapter.
create function a2_proto.start(p_user uuid, p_purpose text, p_phone text, p_ttl interval default interval '5 minutes')
returns table (ch_id uuid, ch_code text, ch_expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_profile_phone text;
  v_res public.secondary_phone_reservations;
  v_id uuid := extensions.gen_random_uuid();
  v_salt bytea := extensions.gen_random_bytes(16);
  v_code text := lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');
  v_exp timestamptz := now() + p_ttl;
  v_recent integer;
begin
  perform app.lock_phone(p_phone);           -- same advisory lock every phone claim takes
  perform app.finalize_expired_phone_reservations(p_phone, p_user);

  if p_purpose in ('primary_proof', 'signup_primary') then
    select phone_e164 into v_profile_phone from public.profiles where user_id = p_user;
    if v_profile_phone is distinct from p_phone then raise exception 'not the caller''s current primary phone' using errcode = '42501'; end if;
  elsif p_purpose = 'secondary_proof' then
    select * into v_res from public.secondary_phone_reservations
     where user_id = p_user and phone_e164 = p_phone and status = 'active' and expires_at > now();
    if not found then raise exception 'no active reservation for this number' using errcode = '42501'; end if;
    v_exp := least(v_exp, v_res.expires_at);   -- a proof can never outlive the reservation, and never extends it
  else
    raise exception 'unknown purpose' using errcode = '22023';
  end if;

  -- Resend limiting: >= 1 per 60 s and <= 5 per hour per account+number.
  select count(*) into v_recent from a2_proto.challenge where user_id = p_user and phone_e164 = p_phone and created_at > now() - interval '1 hour';
  if v_recent >= 5 then raise exception 'rate limited' using errcode = '54000'; end if;
  if exists (select 1 from a2_proto.challenge where user_id = p_user and phone_e164 = p_phone and created_at > now() - interval '60 seconds') then
    raise exception 'rate limited' using errcode = '54000';
  end if;

  update a2_proto.challenge set invalidated_at = now(), invalidated_why = 'superseded'
   where user_id = p_user and purpose = p_purpose and consumed_at is null and invalidated_at is null;

  insert into a2_proto.challenge (id, user_id, purpose, phone_e164, reservation_id, salt, code_hash, expires_at)
  values (v_id, p_user, p_purpose, p_phone, v_res.id, v_salt, a2_proto.hash_code(v_salt, v_id, p_user, p_phone, p_purpose, v_code), v_exp);
  return query select v_id, v_code, v_exp;
end $$;

-- VERIFY: trusted (service_role) only; the caller passes the authenticated user id, never a client claim.
-- One generic outcome for every failure.
create function a2_proto.verify(p_user uuid, p_challenge uuid, p_code text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  c a2_proto.challenge;
  v_ok boolean;
begin
  -- Another account's challenge is invisible: no row, no side effect (an attacker cannot burn the owner's attempts).
  select * into c from a2_proto.challenge where id = p_challenge and user_id = p_user for update;
  if not found then return 'invalid'; end if;
  if c.consumed_at is not null or c.invalidated_at is not null then return 'invalid'; end if;
  if c.expires_at <= now() then
    update a2_proto.challenge set invalidated_at = now(), invalidated_why = 'expired' where id = c.id;
    return 'invalid';
  end if;

  -- Re-validate the binding against the LIVE claim.
  if c.purpose in ('primary_proof', 'signup_primary') then
    v_ok := exists (select 1 from public.profiles where user_id = c.user_id and phone_e164 = c.phone_e164);
  else
    v_ok := exists (select 1 from public.secondary_phone_reservations
                     where id = c.reservation_id and user_id = c.user_id and phone_e164 = c.phone_e164
                       and status = 'active' and expires_at > now());
  end if;
  if not v_ok then
    update a2_proto.challenge set invalidated_at = now(), invalidated_why = 'claim_changed' where id = c.id;
    return 'invalid';
  end if;

  if a2_proto.hash_code(c.salt, c.id, c.user_id, c.phone_e164, c.purpose, coalesce(p_code, '')) is distinct from c.code_hash then
    update a2_proto.challenge
       set attempts = attempts + 1,
           invalidated_at = case when attempts + 1 >= max_attempts then now() end,
           invalidated_why = case when attempts + 1 >= max_attempts then 'too_many_attempts' end
     where id = c.id;
    return 'invalid';
  end if;

  -- Commit point: exactly one caller can flip consumed_at.
  update a2_proto.challenge set consumed_at = now() where id = c.id and consumed_at is null and invalidated_at is null;
  if not found then return 'invalid'; end if;
  insert into a2_proto.verified_claim (challenge_id, user_id, phone_e164, purpose, reservation_id)
  values (c.id, c.user_id, c.phone_e164, c.purpose, c.reservation_id);
  return 'verified';
end $$;

revoke all on schema a2_proto from public, anon, authenticated;
revoke all on all tables in schema a2_proto from public, anon, authenticated;
revoke execute on all functions in schema a2_proto from public, anon, authenticated;
grant usage on schema a2_proto to service_role;
grant execute on function a2_proto.start(uuid, text, text, interval), a2_proto.verify(uuid, uuid, text) to service_role;
