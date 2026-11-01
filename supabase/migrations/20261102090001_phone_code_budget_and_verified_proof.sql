-- ===========================================================================
-- WhatsApp sign-up codes: atomic send budget, billable-message marker, and the
-- server-only proof that a phone number was verified.
--
-- 1. WHY. Two gaps in the application code of #113/#116:
--    a) public.profiles has NO service_role UPDATE privilege (20260804090001 revoked
--       it), so the app cannot set profiles.phone_verified_at with a table update.
--       The column is intentionally unwritable by every API role (20261024090004).
--       The only safe writer is a narrow definer function, as that migration planned.
--    b) The send budget was "count rows, then insert", so concurrent requests could
--       all pass the check. Counting and inserting must be one serialized step.
--
-- 2. WHAT.
--    * phone_verification_challenges.provider_accepted_at: set when Meta accepted the
--      message (the billable event). A row exists from the moment the budget is
--      reserved; the app deletes it again when Meta rejects the send (not billed).
--    * public.phone_challenge_issue(...): takes one transaction-scoped advisory lock,
--      counts the rolling 24 h total and the number's rolling hour, and inserts the
--      challenge only inside both limits. Returns 'issued' | 'rate_limited' |
--      'budget_exhausted'. Concurrent callers queue on the lock, so the limits hold.
--    * public.phone_challenge_mark_sent(uuid): stamps provider_accepted_at once.
--    * public.phone_sign_up_mark_verified(uuid, text): sets phone_verified_at for the
--      user's CURRENT primary number, only if a sign-up code for exactly that number
--      was consumed in the last 30 minutes. The caller supplies no timestamp and no
--      flag; the proof is the consumed challenge row.
--
-- 3. SECURITY. All three functions are SECURITY DEFINER, search_path = '', schema
--    qualified, executable by service_role only (revoked from PUBLIC, anon,
--    authenticated). No table grant is widened and no RLS policy is touched.
-- ===========================================================================

alter table public.phone_verification_challenges
  add column provider_accepted_at timestamptz;

comment on column public.phone_verification_challenges.provider_accepted_at is
  'When Meta accepted the message (the billable event). NULL = reserved against the budget but not (yet) accepted. Accepted is not the same as delivered.';

create function public.phone_challenge_issue(
  p_id                  uuid,
  p_phone_e164          text,
  p_code_hash           text,
  p_expires_at          timestamptz,
  p_phone_hourly_limit  integer,
  p_daily_limit         integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_phone integer;
begin
  if p_phone_hourly_limit is null or p_phone_hourly_limit < 1
     or p_daily_limit is null or p_daily_limit < 1 then
    raise exception 'send limits must be positive' using errcode = '22023';
  end if;

  -- One global lock: the budget is a global quantity, so every issue serializes here.
  perform pg_advisory_xact_lock(hashtextextended('app.phone_challenge_issue', 0));

  select count(*)::integer into v_total
    from public.phone_verification_challenges
   where created_at >= clock_timestamp() - interval '24 hours';
  if v_total >= p_daily_limit then
    return 'budget_exhausted';
  end if;

  select count(*)::integer into v_phone
    from public.phone_verification_challenges
   where phone_e164 = p_phone_e164
     and created_at >= clock_timestamp() - interval '1 hour';
  if v_phone >= p_phone_hourly_limit then
    return 'rate_limited';
  end if;

  insert into public.phone_verification_challenges (id, purpose, phone_e164, code_hash, expires_at)
  values (p_id, 'sign_up', p_phone_e164, p_code_hash, p_expires_at);
  return 'issued';
end;
$$;

comment on function public.phone_challenge_issue(uuid, text, text, timestamptz, integer, integer) is
  'Service-role only. Atomically enforces the per-number hourly cap and the global rolling-24h budget, then inserts the sign-up challenge. Returns issued | rate_limited | budget_exhausted.';

revoke all on function public.phone_challenge_issue(uuid, text, text, timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.phone_challenge_issue(uuid, text, text, timestamptz, integer, integer) to service_role;

create function public.phone_challenge_mark_sent(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.phone_verification_challenges
     set provider_accepted_at = clock_timestamp()
   where id = p_id and purpose = 'sign_up' and provider_accepted_at is null;
  return found;
end;
$$;

comment on function public.phone_challenge_mark_sent(uuid) is
  'Service-role only. Stamps the moment Meta accepted a sign-up code message (billable). Idempotent.';

revoke all on function public.phone_challenge_mark_sent(uuid) from public, anon, authenticated;
grant execute on function public.phone_challenge_mark_sent(uuid) to service_role;

create function public.phone_sign_up_mark_verified(p_user_id uuid, p_e164 text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_e164 is null or p_e164 !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'phone number is not in a valid format' using errcode = '22023';
  end if;

  -- The proof: a sign-up code for exactly this number was consumed moments ago.
  if not exists (
    select 1 from public.phone_verification_challenges c
     where c.purpose = 'sign_up'
       and c.phone_e164 = p_e164
       and c.consumed_at is not null
       and c.consumed_at >= clock_timestamp() - interval '30 minutes'
  ) then
    return false;
  end if;

  -- Only the user's CURRENT primary number; a different number is never marked.
  update public.profiles
     set phone_verified_at = coalesce(phone_verified_at, clock_timestamp())
   where user_id = p_user_id
     and phone_e164 = p_e164;
  return found;
end;
$$;

comment on function public.phone_sign_up_mark_verified(uuid, text) is
  'Service-role only. Sets profiles.phone_verified_at for the user''s current primary number when a sign-up code for that exact number was consumed within 30 minutes. Verification of ownership only; it authorizes nothing (login, recovery and MFA are separate decisions).';

revoke all on function public.phone_sign_up_mark_verified(uuid, text) from public, anon, authenticated;
grant execute on function public.phone_sign_up_mark_verified(uuid, text) to service_role;
