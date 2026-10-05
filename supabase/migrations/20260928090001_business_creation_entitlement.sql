-- Business creation entitlement, enforced at the database boundary.
--
-- WHY THIS EXISTS
-- The application layer (Next.js `/business/new` page and the `saveBusiness` /
-- `submitBusiness` actions) already refuses callers who may not create a business,
-- but `public.business_draft_save` / `public.business_draft_submit` (and the
-- `business_save` / `business_submit` wrappers over them) are SECURITY DEFINER
-- functions that `authenticated` may EXECUTE. A signed-in caller could therefore
-- call the RPC directly with their own access token and skip the application
-- check entirely. This migration moves the SAME rule into the database so it is
-- the final authority; the application check stays only as early UX rejection.
--
-- THE RULE (one canonical helper: app.can_create_or_complete_business)
--   ALLOWED
--     A. the caller already has an OPEN business draft (finish what was started);
--     B. FIRST-BUSINESS REGISTRATION: onboarding_progress says track = 'business'
--        with an approved organization type (showroom_dealer, supplier,
--        manufacturer, importer) AND the caller holds no personal persona
--        (see "intent cannot be spoofed" below);
--     C. ENTITLEMENT: the caller's effective persona (app.effective_persona) is
--        'engineer', or they actively OWN
--        (org.manage) an organization of an approved business type
--        (showroom_dealer, supplier, manufacturer, importer).
--   DENIED, whatever else is true (for B and C)
--     installer_technician and sales — by users.primary_account_type OR by a
--     declared professional persona (individual_onboarding.prof_concrete_type).
--   NEVER A GRANT: a membership alone (member / manager), and any membership that
--     is not ACTIVE (invited / suspended / revoked).
--
-- INTENT CANNOT BE SPOKEN INTO EXISTENCE. `onboarding_select_account_type` is
-- callable by any verified user and freely rewrites onboarding_progress, so
-- "selected_track = business" alone is attacker-controlled state. Path B therefore
-- also requires `not app.has_personal_persona(uid)`: a person who already holds a
-- persona (an installer, a salesperson, a contractor, a completed consumer or
-- professional onboarding, ...) cannot talk themselves into the registration path.
-- A genuine business registrant has none.
--
-- All inputs are trusted database state keyed by auth.uid(); nothing is taken from
-- the client. Idempotent retry of an already-created draft is untouched: the
-- "this draft already produced its organization" branch returns before the check.
-- RLS is unchanged.

create or replace function app.can_create_or_complete_business(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- coalesce: the rule must be a strict true/false. A NULL (for example from a caller
  -- with no persona at all) must never read as "not denied".
  select coalesce(
    p_uid is not null
    and (
      -- A. an OPEN draft the caller already owns can always be finished.
      exists (
        select 1 from public.business_creation_drafts d
        where d.user_id = p_uid and d.completed_at is null
      )
      or (
        -- Never for a craftsman or a salesperson, by persona or declared persona.
        not exists (
          select 1 from public.users u
          where u.id = p_uid and u.primary_account_type in ('sales', 'installer_technician')
        )
        and not exists (
          select 1 from public.individual_onboarding io
          where io.user_id = p_uid and io.prof_concrete_type in ('sales', 'installer_technician')
        )
        and (
          -- B. first-business registration (no persona held, so not spoofable).
          (
            not app.has_personal_persona(p_uid)
            and exists (
              select 1 from public.onboarding_progress op
              where op.user_id = p_uid
                and op.selected_track = 'business'
                and op.selected_org_type in ('showroom_dealer', 'supplier', 'manufacturer', 'importer')
            )
          )
          -- C. an Engineer ...
          or coalesce(app.effective_persona(p_uid) = 'engineer', false)
          -- ... or the active OWNER of an organization of an approved type.
          or exists (
            select 1
            from public.memberships m
            join public.organizations o on o.id = m.organization_id and o.deleted_at is null
            join public.membership_capabilities c
              on c.membership_id = m.id and c.capability_key = 'org.manage'
            where m.user_id = p_uid
              and m.status = 'active'
              and o.org_type in ('showroom_dealer', 'supplier', 'manufacturer', 'importer')
          )
        )
      )
    ),
    false
  );
$$;

comment on function app.can_create_or_complete_business(uuid) is
  'Canonical database rule for who may start or finish a business (see migration 20260928090001). Callers pass auth.uid(); the helper is internal and not granted to clients.';

revoke execute on function app.can_create_or_complete_business(uuid) from public, anon, authenticated;

-- =====================================================================
-- business_draft_save — gate NEW drafts (updating an open draft is path A).
-- =====================================================================
create or replace function public.business_draft_save(
  p_draft_id uuid default null,
  p_legal_name text default null,
  p_display_name text default null,
  p_org_type public.organization_type default null,
  p_description text default null,
  p_governorate text default null,
  p_city text default null,
  p_primary_branch_name text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_verified_caller();
  v_id  uuid;
  v_completed timestamptz;
begin
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

    insert into public.business_creation_drafts (
      user_id, legal_name, display_name, org_type, description,
      governorate, city, primary_branch_name
    ) values (
      v_uid,
      nullif(left(btrim(coalesce(p_legal_name, '')), 120), ''),
      nullif(left(btrim(coalesce(p_display_name, '')), 120), ''),
      p_org_type,
      nullif(left(btrim(coalesce(p_description, '')), 1000), ''),
      nullif(left(btrim(coalesce(p_governorate, '')), 80), ''),
      nullif(left(btrim(coalesce(p_city, '')), 80), ''),
      nullif(left(btrim(coalesce(p_primary_branch_name, '')), 120), '')
    )
    returning id into v_id;
    return v_id;
  end if;

  update public.business_creation_drafts set
    legal_name          = nullif(left(btrim(coalesce(p_legal_name, '')), 120), ''),
    display_name        = nullif(left(btrim(coalesce(p_display_name, '')), 120), ''),
    org_type            = p_org_type,
    description         = nullif(left(btrim(coalesce(p_description, '')), 1000), ''),
    governorate         = nullif(left(btrim(coalesce(p_governorate, '')), 80), ''),
    city                = nullif(left(btrim(coalesce(p_city, '')), 80), ''),
    primary_branch_name = nullif(left(btrim(coalesce(p_primary_branch_name, '')), 120), '')
  where id = v_id;

  return v_id;
end;
$$;

-- =====================================================================
-- business_draft_submit — gate the CREATION; the idempotent branch is untouched.
-- =====================================================================
create or replace function public.business_draft_submit(p_draft_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.require_verified_caller();
  v_d      public.business_creation_drafts;
  v_locale text;
  v_org_id uuid;
begin
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

  if nullif(btrim(coalesce(v_d.display_name, '')), '') is null then
    raise exception 'a business name is required' using errcode = '22023';
  end if;
  if v_d.org_type is null then
    raise exception 'a business type is required' using errcode = '22023';
  end if;

  select u.locale into v_locale from public.users u where u.id = v_uid;

  v_org_id := app.organization_create_owned(
    v_d.display_name, v_d.org_type, coalesce(v_locale, 'en'), v_d.primary_branch_name);

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
$$;

-- Grants are unchanged: both functions stay callable by `authenticated` (the
-- normal Supabase architecture) — the authority is now INSIDE them. Re-state them
-- so a replay of this migration cannot widen or narrow access.
revoke execute on function public.business_draft_save(uuid, text, text, public.organization_type, text, text, text, text) from public, anon;
grant  execute on function public.business_draft_save(uuid, text, text, public.organization_type, text, text, text, text) to authenticated;
revoke execute on function public.business_draft_submit(uuid) from public, anon;
grant  execute on function public.business_draft_submit(uuid) to authenticated;
