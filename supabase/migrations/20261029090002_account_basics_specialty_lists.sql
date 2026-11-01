-- ===========================================================================
-- Account basics: the specialty list that suits the account type
-- (owner request 2026-10-29: "why do I see the installer specialties at a
-- showroom?", and the owner's lists of the same day).
--
-- 20261029090001 offered one list (public.trades, the installer trades) to
-- every account. The owner's lists are the platform's existing vocabularies,
-- so nothing new is invented:
--
--   * Craftsmen: public.trades (the 14 active trades), kept in
--     public.user_trades through public.user_trades_set, as before.
--   * Showroom, Supplier, Manufacturer, Importer: the business activities of
--     their organization type (public.activities, 20260924090003). They belong
--     to the BUSINESS, not the person (business classification is the
--     organization's), so they are answered in business setup and stored in
--     public.organization_activities. Business setup now accepts the activity
--     of any business type that has a list, not only a Showroom.
--   * Engineer: the persona activities of public.activities, now the owner's
--     Civil engineer / Architect (the placeholder "finishing" is retired, kept
--     for history like any retired key), kept in public.user_activities.
--   * Sales Team, Contractor, Personal: no list yet (owner: later), so no
--     specialties question and never counted as missing.
--
-- app.account_specialty_kind names which personal list an account answers in
-- account basics: trades | engineer | none. Business accounts answer 'none'
-- there because their list is the business activity, asked in business setup.
--
-- It also seeds a professional's service area from the first location they
-- give (Preview finding 2026-10-29: a Craftsman's profile still said "Service
-- area not set" after answering the location step).
--
-- public.user_specialties (20261029090001) held installer trade ids for
-- non-professional accounts, which a business should never have been offered.
-- It was never on Production and the application no longer reads or writes
-- it, so it is dropped here.
--
-- A specialty or activity is a profile signal and NEVER an authorization
-- input: no RLS policy, capability or app.can_* predicate may read it.
-- ===========================================================================

-- migration-policy: destructive-reviewed - user_specialties was added by 20261029090001 (Acceptance only, never on Production) and is read and written only by account_basics_set/my_account_basics, which this same migration replaces; no promoted application reads the table directly

-- ---------------------------------------------------------------------------
-- 1. Engineer: the owner's list.
-- ---------------------------------------------------------------------------
insert into public.activities (persona_type, key, sort_order) values
  ('engineer', 'civil_engineer', 20),
  ('engineer', 'architect', 30)
on conflict do nothing;

update public.activities
   set is_active = false
 where persona_type = 'engineer' and key = 'finishing';

-- ---------------------------------------------------------------------------
-- 2. Business setup: the activity of any business type that has a list.
--    Bodies unchanged except the two activity checks (was: Showroom only).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_draft_save_v2(p_draft_id uuid DEFAULT NULL::uuid, p_legal_name text DEFAULT NULL::text, p_display_name text DEFAULT NULL::text, p_org_type public.organization_type DEFAULT NULL::public.organization_type, p_description text DEFAULT NULL::text, p_governorate text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_primary_branch_name text DEFAULT NULL::text, p_city_custom_name text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text, p_activity_type text DEFAULT NULL::text, p_detailed_address text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := app.require_verified_caller();
  v_id  uuid;
  v_completed timestamptz;
  v_lock public.organization_type;
  v_gov text;
  v_city text;
  v_custom text;
  v_email text := nullif(lower(btrim(p_contact_email)), '');
  v_address text := nullif(btrim(p_detailed_address), '');
  v_slot text;
begin
  perform pg_advisory_xact_lock(hashtextextended('org-application:' || v_uid::text, 0));
  if p_org_type = 'contractor_company' and not app.may_hold_contractor_company(v_uid) then
    raise exception 'this organization type cannot be self-assigned' using errcode = '42501';
  end if;
  if p_draft_id is null then
    select d.id into v_id
    from public.business_creation_drafts d
    where d.user_id = v_uid and d.completed_at is null
    for update;
  else
    select d.id, d.completed_at into v_id, v_completed
    from public.business_creation_drafts d
    where d.id = p_draft_id and d.user_id = v_uid
    for update;
    if v_id is null then
      raise exception 'business draft not found' using errcode = '42501';
    end if;
    if v_completed is not null then
      raise exception 'this business has already been created' using errcode = '22023';
    end if;
  end if;

  if v_id is null then
    -- Opening a NEW draft is the point at which an entitlement is required.
    if app.can_create_or_complete_business(v_uid) is not true then
      raise exception 'adding a business is not available for this account' using errcode = '42501';
    end if;
    v_slot := app.application_slot(v_uid);
    if v_slot not in ('first_available', 'additional_available') then
      raise exception 'an organization application is not available right now' using errcode = '42501', hint = v_slot;
    end if;
  end if;

  -- FIRST-BUSINESS REGISTRATION: the registered type is the only type this caller may
  -- save, for a new draft and for an update of an open one alike.
  v_lock := app.mandatory_registration_business_type(v_uid);
  if v_lock is not null then
    if p_org_type is not null and p_org_type <> v_lock then
      raise exception 'the business type must match the type chosen at registration' using errcode = '22023';
    end if;
  end if;

  if char_length(btrim(p_description))>250 then raise exception 'description exceeds 250 characters' using errcode='22023'; end if;
  if p_contact_phone is not null and p_contact_phone !~ '^\+[1-9][0-9]{1,14}$' then raise exception 'invalid showroom phone' using errcode='22023'; end if;
  if v_email is not null and (char_length(v_email)>254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then raise exception 'invalid showroom email' using errcode='22023'; end if;
  if v_address is not null and (char_length(v_address)>16384 or app.business_address_word_count(v_address)>250) then raise exception 'address too long' using errcode='22023'; end if;
  -- The business activity comes from the list of the business type (owner lists 2026-10-29), any type that has one.
  if p_activity_type is not null and not exists(select 1 from public.activities a where a.organization_type=p_org_type and a.key=p_activity_type and a.is_active) then raise exception 'invalid business activity' using errcode='22023'; end if;
  -- Whatever location is supplied must be canonical; an unset location is fine while editing.
  select o_governorate, o_city, o_custom into v_gov, v_city, v_custom
  from app.normalize_business_location(p_governorate, p_city, p_city_custom_name, false);

  if v_id is null then
    insert into public.business_creation_drafts (
      user_id, legal_name, display_name, org_type, description,
      governorate, city, city_custom_name, primary_branch_name, contact_phone, contact_email, activity_type, detailed_address
    ) values (
      v_uid,
      nullif(left(btrim(coalesce(p_legal_name, '')), 120), ''),
      nullif(left(btrim(coalesce(p_display_name, '')), 120), ''),
      p_org_type,
      app.description_text(p_description),
      v_gov, v_city, v_custom,
      nullif(left(btrim(coalesce(p_primary_branch_name, '')), 120), ''), p_contact_phone, v_email, p_activity_type, v_address
    )
    returning id into v_id;
    return v_id;
  end if;

  update public.business_creation_drafts set
    contact_phone = coalesce(p_contact_phone, contact_phone),
    contact_email = case when p_contact_email is null then contact_email else v_email end,
    activity_type = coalesce(p_activity_type, activity_type),
    detailed_address = case when p_detailed_address is null then detailed_address else v_address end,
    legal_name          = nullif(left(btrim(coalesce(p_legal_name, '')), 120), ''),
    display_name        = nullif(left(btrim(coalesce(p_display_name, '')), 120), ''),
    org_type            = p_org_type,
    description         = app.description_text(p_description),
    governorate         = v_gov,
    city                = v_city,
    city_custom_name    = v_custom,
    primary_branch_name = nullif(left(btrim(coalesce(p_primary_branch_name, '')), 120), '')
  where id = v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.business_draft_submit_v2(p_draft_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid    uuid := app.require_verified_caller();
  v_d      public.business_creation_drafts;
  v_locale text;
  v_org_id uuid;
  v_lock   public.organization_type;
  v_legal  text;
  v_gov    text;
  v_city   text;
  v_custom text;
  v_slot   text;
begin
  perform pg_advisory_xact_lock(hashtextextended('org-application:' || v_uid::text, 0));
  if p_draft_id is null then
    select * into v_d from public.business_creation_drafts d
    where d.user_id = v_uid and d.completed_at is null
    for update;
    -- No OPEN draft: the caller has already completed this creation and is
    -- retrying without a handle (the no-arg registration wrapper). Return their
    -- most recent result rather than erroring — and, crucially, rather than
    -- treating "nothing open" as licence to create another business. A caller who
    -- genuinely wants a second business opens a new draft first.
    if v_d.id is null then
      select * into v_d from public.business_creation_drafts d
      where d.user_id = v_uid and d.organization_id is not null
      order by d.completed_at desc
      limit 1;
    end if;
  else
    select * into v_d from public.business_creation_drafts d
    where d.id = p_draft_id and d.user_id = v_uid
    for update;
  end if;

  if v_d.id is null then
    raise exception 'business draft not found' using errcode = '42501';
  end if;

  -- IDEMPOTENT: this draft already produced its organization.
  if v_d.organization_id is not null then
    return v_d.organization_id;
  end if;

  -- The entitlement is checked before anything is created. An open draft passes
  -- (path A), so a legitimately started business can always be finished.
  if app.can_create_or_complete_business(v_uid) is not true then
    raise exception 'adding a business is not available for this account' using errcode = '42501';
  end if;
  v_slot := app.application_slot(v_uid);
  if v_slot not in ('first_available', 'additional_available') then
    raise exception 'an organization application is not available right now' using errcode = '42501', hint = v_slot;
  end if;

  -- FIRST-BUSINESS REGISTRATION: a draft of any other type (for example one saved
  -- before this rule existed) cannot become the first organization.
  v_lock := app.mandatory_registration_business_type(v_uid);
  if v_lock is not null and v_d.org_type is distinct from v_lock then
    raise exception 'the business type must match the type chosen at registration' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(v_d.display_name, '')), '') is null then
    raise exception 'a business name is required' using errcode = '22023';
  end if;
  v_legal := nullif(btrim(coalesce(v_d.legal_name, '')), '');
  if v_legal is null then
    raise exception 'a legal business name is required' using errcode = '22023';
  end if;
  if char_length(v_legal) < 2 or char_length(v_legal) > 120 then
    raise exception 'the legal business name must be 2..120 characters' using errcode = '22023';
  end if;
  if v_d.org_type is null then
    raise exception 'a business type is required' using errcode = '22023';
  end if;

  if v_d.governorate is null or (v_d.city is null and v_d.city_custom_name is null) then raise exception 'business location is required' using errcode='22023'; end if;
  if v_d.org_type='showroom_dealer' and (v_d.contact_phone is null or v_d.activity_type is null) then raise exception 'showroom phone and activity are required' using errcode='22023'; end if;
  -- A location is optional, but a chosen governorate needs a valid city (historical draft keys are normalised).
  select o_governorate, o_city, o_custom into v_gov, v_city, v_custom
  from app.normalize_business_location(v_d.governorate, v_d.city, v_d.city_custom_name, true);

  select u.locale into v_locale from public.users u where u.id = v_uid;

  v_org_id := app.organization_create_owned(
    v_d.display_name, v_d.org_type, coalesce(v_locale, 'en'), v_d.primary_branch_name,
    v_legal, v_gov, v_city, v_custom);

  update public.organizations set description = app.description_text(v_d.description) where id = v_org_id;
  update public.organizations set contact_phone=v_d.contact_phone, contact_email=v_d.contact_email where id=v_org_id;
  if v_d.contact_phone is not null or v_d.contact_email is not null then
    insert into public.organization_contacts (organization_id, phone_e164, contact_email, updated_by)
    values (v_org_id, v_d.contact_phone,
            case when v_d.contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then v_d.contact_email end,
            v_uid)
    on conflict (organization_id) do nothing;
  end if;
  update public.branches set address_ar=v_d.detailed_address where organization_id=v_org_id;
  if v_d.activity_type is not null then
    insert into public.organization_activities(organization_id, activity_id)
    select v_org_id,a.id from public.activities a where a.organization_type=v_d.org_type and a.key=v_d.activity_type and a.is_active;
    if not found then raise exception 'invalid business activity' using errcode='22023'; end if;
  end if;
  update public.business_creation_drafts
     set organization_id = v_org_id, completed_at = now()
   where id = v_d.id;

  -- Keep the superseded per-user row consistent for anything still reading it.
  update public.business_onboarding
     set organization_id = v_org_id, completed_at = now()
   where user_id = v_uid and organization_id is null;

  perform app.record_audit_event('onboarding.organization_created', 'organization', v_org_id, v_org_id,
    jsonb_build_object('org_type', v_d.org_type, 'draft_id', v_d.id));
  return v_org_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Which personal specialty list an account answers.
-- ---------------------------------------------------------------------------
create or replace function app.account_specialty_kind(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case coalesce(u.primary_account_type::text, io.prof_concrete_type::text)
    when 'installer_technician' then 'trades'
    when 'engineer' then 'engineer'
    else 'none'
  end
  from public.users u
  left join public.individual_onboarding io on io.user_id = u.id
  where u.id = p_user_id;
$$;

comment on function app.account_specialty_kind(uuid) is
  'Which personal specialty list an account answers in account basics (ADR-0026): trades (Craftsman: public.trades), engineer (public.activities persona engineer) or none (business accounts answer their business activity in business setup; Sales Team, Contractor and Personal have no list yet). From the current persona only.';

revoke all on function app.account_specialty_kind(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The writer and the reader.
-- ---------------------------------------------------------------------------
create or replace function public.account_basics_set(
  p_governorate text,
  p_city        text,
  p_city_custom text,
  p_specialties text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_kind   text;
  v_gov    text;
  v_city   text;
  v_custom text;
  v_keys   text[];
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  perform 1 from public.profiles where user_id = v_uid for update;
  if not found then
    raise exception 'profile not found for the current user' using errcode = 'P0002';
  end if;

  if nullif(btrim(coalesce(p_governorate, '')), '') is not null then
    select l.o_governorate, l.o_city, l.o_custom into v_gov, v_city, v_custom
    from app.normalize_business_location(p_governorate, p_city, p_city_custom, true) l;
    update public.profiles
       set governorate_key  = v_gov,
           city_key         = v_city,
           city_custom_name = v_custom
     where user_id = v_uid;
    -- A professional works where they are based: the first location they give
    -- also becomes their service area (primary governorate, plus the town), so
    -- the profile never asks for it a second time. Areas they already declared
    -- are never replaced.
    if app.is_professional_persona(v_uid)
       and not exists (select 1 from public.user_service_areas a where a.user_id = v_uid) then
      perform public.user_service_areas_set(
        v_gov,
        case when v_city is null then '[]'::jsonb
             else jsonb_build_array(jsonb_build_object('governorate_key', v_gov, 'city_key', v_city)) end);
    end if;
  elsif nullif(btrim(coalesce(p_city, '')), '') is not null or nullif(btrim(coalesce(p_city_custom, '')), '') is not null then
    raise exception 'a city requires a governorate' using errcode = '22023';
  end if;

  if p_specialties is not null then
    v_kind := app.account_specialty_kind(v_uid);
    if v_kind = 'none' then
      raise exception 'this account has no specialties' using errcode = '22023';
    end if;

    select coalesce(array_agg(k order by first_pos), '{}') into v_keys
    from (
      select btrim(k) as k, min(pos) as first_pos
      from unnest(p_specialties) with ordinality as s(k, pos)
      where nullif(btrim(k), '') is not null
      group by btrim(k)
    ) d;
    if cardinality(v_keys) = 0 then
      raise exception 'choose at least one specialty' using errcode = '22023';
    end if;
    if cardinality(v_keys) > 30 then
      raise exception 'too many specialties' using errcode = '22023';
    end if;

    if v_kind = 'trades' then
      perform public.user_trades_set(v_keys, null);
    else
      if exists (
        select 1 from unnest(v_keys) k
        where not exists (select 1 from public.activities a where a.persona_type::text = v_kind and a.key = k and a.is_active)
      ) then
        raise exception 'unknown specialty' using errcode = '22023';
      end if;
      delete from public.user_activities ua
       using public.activities a
       where ua.user_id = v_uid and a.id = ua.activity_id and a.persona_type::text = v_kind;
      insert into public.user_activities (user_id, activity_id)
      select v_uid, a.id from public.activities a
      where a.persona_type::text = v_kind and a.key = any (v_keys) and a.is_active;
    end if;
  end if;
end;
$$;

comment on function public.account_basics_set(text, text, text, text[]) is
  'Onboarding writer (ADR-0026): sets the caller''s profile location (catalogue-normalized, governorate + town required once sent; a professional with no service areas gets it as their primary service area) and/or specialties (>= 1 active key of the list app.account_specialty_kind gives the account, first is primary): trades through public.user_trades_set, an Engineer''s list into public.user_activities. An account with no specialty list is refused. A null part is left unchanged.';

revoke execute on function public.account_basics_set(text, text, text, text[]) from public, anon, service_role;
grant  execute on function public.account_basics_set(text, text, text, text[]) to authenticated;

create or replace function public.my_account_basics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_kind   text;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  v_kind := coalesce(app.account_specialty_kind(v_uid), 'none');

  select jsonb_build_object(
    'phone', p.phone_e164,
    'governorate', coalesce(p.governorate_key, sa.governorate_key, b.governorate_key),
    'city', case when p.governorate_key is not null then p.city_key
                 when sa.governorate_key is not null then sa.city_key
                 else b.city_key end,
    'cityCustom', case when p.governorate_key is not null then p.city_custom_name
                       when sa.governorate_key is not null then null
                       else b.city_custom_name end,
    'specialtyKind', v_kind,
    'specialties', case v_kind
      when 'trades' then coalesce((
        select jsonb_agg(t.key order by ut.is_primary desc, t.sort_order, t.key)
        from public.user_trades ut
        join public.trades t on t.id = ut.trade_id and t.is_active
        where ut.user_id = v_uid
      ), '[]'::jsonb)
      when 'none' then '[]'::jsonb
      else coalesce((
        select jsonb_agg(a.key order by a.sort_order, a.key)
        from public.user_activities ua
        join public.activities a on a.id = ua.activity_id and a.is_active and a.persona_type::text = v_kind
        where ua.user_id = v_uid
      ), '[]'::jsonb)
    end
  )
  into v_result
  from public.profiles p
  left join lateral (
    -- A professional's declared base: the primary service-area governorate and
    -- the first town they listed inside it.
    select g.governorate_key, (
      select c.city_key from public.user_service_areas c
       where c.user_id = v_uid and c.governorate_key = g.governorate_key and c.city_key is not null
       order by c.created_at, c.id limit 1) as city_key
    from public.user_service_areas g
    where g.user_id = v_uid and g.is_primary
  ) sa on true
  left join lateral (
    -- OWNERS only: the assigned (primary) branch of the oldest organization the
    -- caller manages. An employee's employer branch never counts.
    select br.governorate_key, br.city_key, br.city_custom_name
    from public.memberships m
    join public.membership_capabilities c on c.membership_id = m.id and c.capability_key = 'org.manage'
    join public.branches br on br.id = m.primary_branch_id and br.deleted_at is null
    where m.user_id = v_uid and m.status = 'active' and br.governorate_key is not null
    order by m.created_at, m.id
    limit 1
  ) b on true
  where p.user_id = v_uid and p.deleted_at is null;

  return v_result;
end;
$$;

comment on function public.my_account_basics() is
  'The caller''s onboarding basics (ADR-0026): phone, location (profile, else the primary service area with a town in it, else the assigned branch of the oldest organization the caller owns via org.manage), specialtyKind (trades | engineer | none, app.account_specialty_kind) and the active keys of that list (primary first). Null when the caller has no profile.';

revoke execute on function public.my_account_basics() from public, anon, service_role;
grant  execute on function public.my_account_basics() to authenticated;

drop table public.user_specialties;
