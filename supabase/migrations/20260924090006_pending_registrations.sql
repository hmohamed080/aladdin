-- ===========================================================================
-- Staging-prep Increment 6 — pending-registration state
--
-- CORRECTED KEY. An earlier draft keyed this table by normalized email. Per
-- explicit product-owner correction: use the auth user_id `signUp()` already
-- returns for an unconfirmed user as the authoritative key instead — email is
-- mutable/reusable in ways a user id is not, and the id is already in hand
-- the moment signUp() succeeds, before any confirmation.
--
-- NEVER stores a password or any auth secret. Written only via the
-- service-role/admin client (the same trust boundary
-- markPasswordAttachedAuthoritatively already uses in
-- frontend/src/lib/supabase/admin-server.ts) through
-- public.pending_registration_save, which takes an explicit p_user_id and is
-- granted to service_role ONLY — never authenticated/anon, since it would
-- otherwise let any caller stage state for an arbitrary user id. Consumption
-- (public.pending_registration_consume) runs the opposite way: as the
-- now-authenticated caller, reading auth.uid() itself, the standard pattern
-- used throughout this schema — it takes no user-id parameter at all.
--
-- A convenience cache, never an authority: whoever calls
-- pending_registration_consume() is expected to REVALIDATE everything it
-- returns (username availability, account-type validity) before applying it,
-- exactly as public.username_available / public.profile_set_username /
-- public.onboarding_select_account_type already do on their own terms.
-- ===========================================================================

create table app.pending_registrations (
  user_id        uuid primary key references public.users(id) on delete cascade,
  username       text not null,
  audience_kind  public.activity_audience_kind not null,
  audience_value text not null,
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table app.pending_registrations is
  'Short-lived staging area for a username + chosen top-level account type between signUp() and a successful verifyOtp(), keyed by auth user_id (not email — a user id is available the moment signUp() returns, before confirmation, and is stable in a way email is not). NEVER stores a password or any auth secret. Written only by public.pending_registration_save (service_role only); consumed once by public.pending_registration_consume (authenticated, reads auth.uid() itself). A convenience cache, never an authority — the consumer must revalidate everything before applying it.';

-- app schema is not exposed via PostgREST; no RLS policy grants any client
-- role direct table access either way. All access goes through the two RPCs.
revoke all on app.pending_registrations from anon, authenticated, service_role;

create or replace function public.pending_registration_save(
  p_user_id        uuid,
  p_username       text,
  p_audience_kind  public.activity_audience_kind,
  p_audience_value text,
  p_ttl_minutes    int default 30
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'user id is required' using errcode = '22023';
  end if;
  insert into app.pending_registrations (user_id, username, audience_kind, audience_value, expires_at)
  values (p_user_id, btrim(p_username), p_audience_kind, p_audience_value,
          now() + make_interval(mins => greatest(coalesce(p_ttl_minutes, 30), 1)))
  on conflict (user_id) do update
    set username       = excluded.username,
        audience_kind  = excluded.audience_kind,
        audience_value = excluded.audience_value,
        expires_at     = excluded.expires_at,
        updated_at     = now();
end;
$$;
comment on function public.pending_registration_save(uuid, text, public.activity_audience_kind, text, int) is
  'Upserts a pending-registration row for an explicit user id. Granted to service_role ONLY (never authenticated/anon) — this signature accepts an arbitrary user id and is safe only because it is called exclusively from the admin client, immediately after a trusted signUp() response, never with client-supplied input.';
revoke execute on function public.pending_registration_save(uuid, text, public.activity_audience_kind, text, int) from public, anon, authenticated;
grant execute on function public.pending_registration_save(uuid, text, public.activity_audience_kind, text, int) to service_role;

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
    return;  -- empty result: no valid pending state (never existed, already consumed, or expired)
  end if;

  delete from app.pending_registrations where user_id = v_uid;

  username := v_row.username;
  audience_kind := v_row.audience_kind;
  audience_value := v_row.audience_value;
  return next;
end;
$$;
comment on function public.pending_registration_consume() is
  'Reads and deletes (consumes exactly once) the CALLER''s own pending-registration row, via auth.uid() — takes no parameter. Returns an empty set if none exists or it expired. The caller MUST revalidate everything returned (username availability, account-type validity) before applying it; this is a convenience cache, never an authority.';
revoke execute on function public.pending_registration_consume() from public, anon;
grant execute on function public.pending_registration_consume() to authenticated;
