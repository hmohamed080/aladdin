-- ===========================================================================
-- Staging-prep Increment 13 — Coming Soon account types are refused by the
-- AUTHORITATIVE database path, not only by the server actions.
--
-- THE GAP. The registration/onboarding server actions refuse a Coming Soon
-- choice (frontend/src/lib/onboarding/account-types.ts, `comingSoon: true`),
-- but public.onboarding_select_account_type is granted to `authenticated` and
-- accepted any persona. A direct PostgREST call could therefore select
-- Engineer, Contractor or the Personal (consumer) account while they are
-- closed — and since Increment 11 that selection becomes the declared persona.
--
-- THE RULE.
--   * app.coming_soon_account_types() is the ONE database list of closed
--     account-type keys: end_consumer (Personal Account — consumer track),
--     engineer, contractor. It must equal the frontend's `comingSoon` set;
--     frontend/src/lib/onboarding/coming-soon-parity.test.ts reads this file
--     and fails if the two ever disagree. Re-opening a type = removing it here
--     AND dropping `comingSoon` there, in one change.
--   * A FRESH selection of a closed type raises 22023 "this account type is
--     not available yet" before anything is written.
--   * A caller who already holds that exact type may still (re-)select it, so
--     existing accounts never lose their persona or data:
--       consumer     — an existing consumer track, a canonical end_consumer, or
--                      a completed consumer onboarding;
--       professional — the same persona already selected, declared, or
--                      Admin-applied (canonical).
--   * Nothing else changes: active types (Tradespeople, Sales, every business
--     organization type) behave exactly as in Increment 11; reads of legacy
--     values are untouched; my_registration_state() and active_personal are
--     not modified; no organization, membership or capability is created.
-- ===========================================================================

-- MARKER for the parity test — keep the array literal on one line.
create or replace function app.coming_soon_account_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['end_consumer', 'engineer', 'contractor']::text[];  -- COMING_SOON_ACCOUNT_TYPES
$$;
comment on function app.coming_soon_account_types() is
  'The account-type keys closed for FRESH self-service selection ("Coming Soon"). Must equal the frontend ACCOUNT_TYPE_CHOICES comingSoon set (parity test). end_consumer stands for the consumer track (Personal Account).';
revoke execute on function app.coming_soon_account_types() from public, anon, authenticated;

create or replace function app.holds_account_type(
  p_uid   uuid,
  p_track public.onboarding_track,
  p_key   text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_track = 'consumer' then
         exists (select 1 from public.onboarding_progress op
                  where op.user_id = p_uid and op.selected_track = 'consumer')
      or exists (select 1 from public.users u
                  where u.id = p_uid and u.primary_account_type = 'end_consumer')
      or exists (select 1 from public.individual_onboarding io
                  where io.user_id = p_uid and io.consumer_completed_at is not null)
    when p_track = 'professional' then
         exists (select 1 from public.onboarding_progress op
                  where op.user_id = p_uid and op.selected_track = 'professional'
                    and op.selected_persona::text = p_key)
      or exists (select 1 from public.individual_onboarding io
                  where io.user_id = p_uid and io.prof_concrete_type::text = p_key)
      or exists (select 1 from public.users u
                  where u.id = p_uid and u.primary_account_type::text = p_key)
    else false
  end;
$$;
comment on function app.holds_account_type(uuid, public.onboarding_track, text) is
  'Internal: does this identity ALREADY hold the given account type (selected, declared, completed or canonical)? Lets legacy holders of a now-Coming-Soon type resume/re-select it while fresh selection is refused.';
revoke execute on function app.holds_account_type(uuid, public.onboarding_track, text) from public, anon, authenticated;

create or replace function public.onboarding_select_account_type(
  p_track        public.onboarding_track,
  p_account_type text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := app.require_verified_caller();
  v_choice    text := nullif(btrim(coalesce(p_account_type, '')), '');
  v_persona   public.persona_type;
  v_org_type  public.organization_type;
  v_key       text;
begin
  if p_track is null then
    raise exception 'an onboarding track is required' using errcode = '22023';
  end if;

  if p_track = 'consumer' then
    if v_choice is not null and v_choice <> 'end_consumer' then
      raise exception 'consumer track takes no professional/business type' using errcode = '22023';
    end if;
  elsif p_track = 'business' then
    if v_choice is not null then
      if not exists (
        select 1 from unnest(enum_range(null::public.organization_type)) e
        where e::text = v_choice
      ) then
        raise exception 'business track requires a business organization type' using errcode = '22023';
      end if;
      v_org_type := v_choice::public.organization_type;
    end if;
  else
    if v_choice is null or v_choice = 'end_consumer' then
      raise exception 'this track requires a concrete account type' using errcode = '22023';
    end if;
    if not exists (
      select 1 from unnest(enum_range(null::public.persona_type)) e
      where e::text = v_choice
    ) then
      raise exception 'professional track requires a personal persona' using errcode = '22023';
    end if;
    v_persona := v_choice::public.persona_type;
  end if;

  -- NEW (Increment 13): COMING SOON IS ENFORCED HERE, not only in the server
  -- actions. A fresh selection of a Coming Soon type is refused; a caller who
  -- ALREADY holds that exact type (a legacy registrant resuming, or an
  -- Admin-applied / declared persona) may re-select it, so no existing account
  -- loses its persona or data. Business organization types are never Coming Soon.
  v_key := case
             when p_track = 'consumer' then 'end_consumer'
             when p_track = 'professional' then v_choice
           end;
  if v_key = any (app.coming_soon_account_types())
     and not app.holds_account_type(v_uid, p_track, v_key) then
    raise exception 'this account type is not available yet' using errcode = '22023';
  end if;

  insert into public.onboarding_progress (
    user_id, selected_track, selected_persona, selected_org_type,
    account_type_completed_at, completed_at
  ) values (
    v_uid, p_track, v_persona, v_org_type, now(), now()
  )
  on conflict (user_id) do update
    set selected_track            = excluded.selected_track,
        selected_persona          = excluded.selected_persona,
        selected_org_type         = excluded.selected_org_type,
        account_type_completed_at = excluded.account_type_completed_at,
        completed_at              = excluded.completed_at;

  -- NEW (Increment 11): the individual-professional persona becomes the
  -- DECLARED persona — the value every professional authority already reads.
  -- Same five-value allow-list as app.is_professional_persona and
  -- individual_save_professional (trainer/trainee are not individual
  -- professionals). Never touches users.primary_account_type.
  if v_persona in ('engineer', 'interior_designer', 'installer_technician', 'contractor', 'sales')
     and not exists (
       select 1 from public.users u
       where u.id = v_uid and u.primary_account_type is not null
         and u.primary_account_type <> v_persona) then
    insert into public.individual_onboarding as io (user_id, prof_concrete_type)
    values (v_uid, v_persona)
    on conflict (user_id) do update
      set prof_concrete_type = excluded.prof_concrete_type
      where io.prof_concrete_type is null
         or io.professional_completed_at is null;
  end if;

  perform app.record_audit_event('onboarding.completed', 'user', v_uid, null,
    jsonb_build_object('track', p_track, 'account_type', v_choice));
end;
$$;


comment on function public.onboarding_select_account_type(public.onboarding_track, text) is
  'Authoritative registration account-type selection. Refuses a FRESH selection of a Coming Soon type (app.coming_soon_account_types(): Personal/consumer, Engineer, Contractor) with 22023 — callers already holding that exact type may re-select it (Increment 13). Business track: intended org_type only, no organization/membership/capability. Professional track: records the declared persona (Increment 11); never writes users.primary_account_type and never overrides an established persona.';
