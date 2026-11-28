-- ===========================================================================
-- Owner Sales delegation capabilities (Stage 6 acceptance finding, 2026-10-26).
--
-- PROBLEM. app.organization_create_owned() gives a new business owner org.manage
-- and the pilot Sales keys (sales.opportunity.*, sales.task.write, ...), but not
-- the four Sprint 3 Sales keys: sales.read, sales.write, sales.assign,
-- sales.manage. Those four are exactly the People-screen presets
-- (frontend/src/lib/org/roles.ts: sales_rep = read+write; sales_manager adds
-- assign+manage). public.membership_set_capabilities() refuses to grant a key the
-- caller does not hold, so a newly registered owner cannot delegate either preset
-- ("cannot grant a capability you do not hold: sales.manage", 42501).
--
-- FIX (forward-only, additive):
--   1. Two small immutable helpers name the four keys and the eligible business
--      types, so the creation path and the backfill cannot drift.
--   2. Both live overloads of app.organization_create_owned() are re-created
--      verbatim from the current definition (pg_get_functiondef at
--      20261024090011) plus ONE block that adds the four keys for eligible types.
--      Signatures, SECURITY DEFINER, search_path and grants are unchanged.
--   3. app.owner_sales_delegation_backfill() (DB-owner only, idempotent) adds the
--      four keys to existing ACTIVE owner memberships (membership holds
--      org.manage) of non-deleted organizations of an eligible type, and this
--      migration runs it once. Existing capabilities are never removed. Each
--      membership actually changed gets one audit row (membership.role_changed,
--      source = migration_20261026090001_owner_sales_delegation).
--
-- ELIGIBLE TYPES: showroom_dealer, supplier, manufacturer, importer - the four
-- launched business registrations (PRODUCT_DIRECTION_GUIDE: "Business choices
-- (Showroom, Supplier, Manufacturer, Importer)"). design_office and
-- contractor_company are excluded: their Engineer / Contractor accounts are still
-- Coming Soon (app.coming_soon_account_types), so there is no Sales team to
-- delegate to yet; extending them later is one array element plus a backfill.
--
-- WHY THIS IS NOT AN ESCALATION. Every eligible owner already holds org.manage,
-- and app.can_manage_sales(org) = has_capability(sales.manage) OR
-- has_capability(org.manage). The new keys only make existing authority
-- DELEGABLE through the unchanged no-escalation rule.
--
-- UNCHANGED: membership_set_capabilities (no-escalation and last-owner guards),
-- app.membership_grant_sales (affiliation path), app.can_manage_sales, every RLS
-- policy, branch access, tenant isolation, invited/affiliated members, members
-- without org.manage, suspended/revoked memberships, deleted organizations, and
-- the Consumer Coming Soon rule.
-- ===========================================================================

create or replace function app.owner_sales_delegation_capabilities()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['sales.read', 'sales.write', 'sales.assign', 'sales.manage']::text[];
$$;
revoke all on function app.owner_sales_delegation_capabilities() from public, anon, authenticated, service_role;
comment on function app.owner_sales_delegation_capabilities() is
  'The four Sprint 3 Sales keys an eligible business owner holds so the Sales Rep / Sales Manager presets are delegable (20261026090001).';

create or replace function app.owner_sales_delegation_org_types()
returns public.organization_type[]
language sql
immutable
set search_path = ''
as $$
  select array['showroom_dealer', 'supplier', 'manufacturer', 'importer']::public.organization_type[];
$$;
revoke all on function app.owner_sales_delegation_org_types() from public, anon, authenticated, service_role;
comment on function app.owner_sales_delegation_org_types() is
  'Business types whose owners receive app.owner_sales_delegation_capabilities(): the four launched business registrations (20261026090001).';

-- ---------------------------------------------------------------------------
-- 1. Creation path (both live overloads; bodies otherwise unchanged)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.organization_create_owned(p_name text, p_org_type organization_type, p_locale text, p_branch_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid    uuid := (select auth.uid());
  v_name   text := btrim(coalesce(p_name, ''));
  v_locale text := case when p_locale in ('en', 'ar') then p_locale else 'en' end;
  v_branch text := nullif(btrim(coalesce(p_branch_name, '')), '');
  v_org_id uuid;
  v_mid    uuid;
  v_bid    uuid;
  v_cap    text;
  v_caps   text[] := array[
    'org.manage', 'org.members.manage', 'branch.manage',
    'verification.submit', 'verification.read',
    'catalog.read', 'catalog.write', 'catalog.publish', 'inventory.write',
    'sales.opportunity.read', 'sales.opportunity.write', 'sales.match.share',
    'sales.task.write', 'sales.followup.send',
    'rfq.create', 'rfq.respond', 'quote.submit', 'quote.decide',
    'project.read', 'project.write', 'conversation.participate', 'ad.manage',
    'subscription.read', 'subscription.manage', 'analytics.view', 'export.data',
    'activity.read'
  ];
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'organization name must be 2..120 characters' using errcode = '22023';
  end if;
  if p_org_type is null then
    raise exception 'a business organization type is required' using errcode = '22023';
  end if;
  if p_org_type = 'contractor_company' and not app.may_hold_contractor_company(v_uid) then
    raise exception 'this organization type cannot be self-assigned' using errcode = '42501';
  end if;

  -- ALWAYS pending_verification / unverified: provisional and non-operational
  -- (see app.org_is_approved) until an Admin approves the application.
  insert into public.organizations (name, org_type, status, is_verified, primary_locale, created_by)
  values (v_name, p_org_type, 'pending_verification', false, v_locale, v_uid)
  returning id into v_org_id;

  insert into public.branches (organization_id, name)
  values (v_org_id, coalesce(v_branch, v_name))
  returning id into v_bid;

  insert into public.memberships (user_id, organization_id, primary_branch_id, status, invited_by, accepted_at)
  values (v_uid, v_org_id, v_bid, 'active', v_uid, now())
  returning id into v_mid;

  foreach v_cap in array v_caps loop
    insert into public.membership_capabilities (membership_id, capability_key)
    values (v_mid, v_cap)
    on conflict (membership_id, capability_key) do nothing;
  end loop;

  -- Owner Sales delegation (20261026090001): an owner of a launched business type
  -- also holds the four Sprint 3 Sales keys, so the Sales Rep / Sales Manager
  -- presets can be delegated through membership_set_capabilities, whose
  -- no-escalation rule is unchanged. Effective owner authority does not grow:
  -- org.manage already satisfies app.can_manage_sales.
  if p_org_type = any (app.owner_sales_delegation_org_types()) then
    foreach v_cap in array app.owner_sales_delegation_capabilities() loop
      insert into public.membership_capabilities (membership_id, capability_key)
      values (v_mid, v_cap)
      on conflict (membership_id, capability_key) do nothing;
    end loop;
  end if;

  perform app.record_audit_event('organization.created', 'organization', v_org_id, v_org_id,
    jsonb_build_object('org_type', p_org_type, 'status', 'pending_verification'));
  perform app.record_audit_event('branch.created', 'branch', v_bid, v_org_id,
    jsonb_build_object('primary', true));
  perform app.record_audit_event('membership.granted', 'membership', v_mid, v_org_id,
    jsonb_build_object('user_id', v_uid, 'status', 'active', 'via', 'owner_setup'));
  perform app.record_audit_event('membership.activated', 'membership', v_mid, v_org_id,
    jsonb_build_object('via', 'owner_setup'));

  return v_org_id;
end;
$function$;

CREATE OR REPLACE FUNCTION app.organization_create_owned(p_name text, p_org_type organization_type, p_locale text, p_branch_name text, p_legal_name text, p_governorate_key text DEFAULT NULL::text, p_city_key text DEFAULT NULL::text, p_city_custom_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid    uuid := (select auth.uid());
  v_name   text := btrim(coalesce(p_name, ''));
  v_legal  text := btrim(coalesce(p_legal_name, ''));
  v_locale text := case when p_locale in ('en', 'ar') then p_locale else 'en' end;
  v_branch text := nullif(btrim(coalesce(p_branch_name, '')), '');
  v_gov    text;
  v_city   text;
  v_custom text;
  v_org_id uuid;
  v_mid    uuid;
  v_bid    uuid;
  v_cap    text;
  v_caps   text[] := array[
    'org.manage', 'org.members.manage', 'branch.manage',
    'verification.submit', 'verification.read',
    'catalog.read', 'catalog.write', 'catalog.publish', 'inventory.write',
    'sales.opportunity.read', 'sales.opportunity.write', 'sales.match.share',
    'sales.task.write', 'sales.followup.send',
    'rfq.create', 'rfq.respond', 'quote.submit', 'quote.decide',
    'project.read', 'project.write', 'conversation.participate', 'ad.manage',
    'subscription.read', 'subscription.manage', 'analytics.view', 'export.data',
    'activity.read'
  ];
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'organization name must be 2..120 characters' using errcode = '22023';
  end if;
  if char_length(v_legal) < 2 or char_length(v_legal) > 120 then
    raise exception 'a legal business name of 2..120 characters is required' using errcode = '22023';
  end if;
  if p_org_type is null then
    raise exception 'a business organization type is required' using errcode = '22023';
  end if;

  select o_governorate, o_city, o_custom into v_gov, v_city, v_custom
  from app.normalize_business_location(p_governorate_key, p_city_key, p_city_custom_name, true);

  insert into public.organizations (name, legal_name, org_type, status, is_verified, primary_locale, created_by)
  values (v_name, v_legal, p_org_type, 'pending_verification', false, v_locale, v_uid)
  returning id into v_org_id;

  insert into public.branches (organization_id, name, governorate_key, city_key, city_custom_name)
  values (v_org_id, coalesce(v_branch, v_name), v_gov, v_city, v_custom)
  returning id into v_bid;

  insert into public.memberships (user_id, organization_id, primary_branch_id, status, invited_by, accepted_at)
  values (v_uid, v_org_id, v_bid, 'active', v_uid, now())
  returning id into v_mid;

  foreach v_cap in array v_caps loop
    insert into public.membership_capabilities (membership_id, capability_key)
    values (v_mid, v_cap)
    on conflict (membership_id, capability_key) do nothing;
  end loop;

  -- Owner Sales delegation (20261026090001): an owner of a launched business type
  -- also holds the four Sprint 3 Sales keys, so the Sales Rep / Sales Manager
  -- presets can be delegated through membership_set_capabilities, whose
  -- no-escalation rule is unchanged. Effective owner authority does not grow:
  -- org.manage already satisfies app.can_manage_sales.
  if p_org_type = any (app.owner_sales_delegation_org_types()) then
    foreach v_cap in array app.owner_sales_delegation_capabilities() loop
      insert into public.membership_capabilities (membership_id, capability_key)
      values (v_mid, v_cap)
      on conflict (membership_id, capability_key) do nothing;
    end loop;
  end if;

  perform app.record_audit_event('organization.created', 'organization', v_org_id, v_org_id,
    jsonb_build_object('org_type', p_org_type, 'status', 'pending_verification'));
  perform app.record_audit_event('branch.created', 'branch', v_bid, v_org_id,
    jsonb_build_object('primary', true));
  perform app.record_audit_event('membership.granted', 'membership', v_mid, v_org_id,
    jsonb_build_object('user_id', v_uid, 'status', 'active', 'via', 'owner_setup'));
  perform app.record_audit_event('membership.activated', 'membership', v_mid, v_org_id,
    jsonb_build_object('via', 'owner_setup'));

  return v_org_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Backfill of existing eligible owner memberships
-- ---------------------------------------------------------------------------
-- A function (DB-owner only) so the same, idempotent logic runs here and is
-- exercised by pgTAP. Scope: ACTIVE memberships that hold org.manage, in
-- non-deleted organizations of an eligible type. It only INSERTS the missing
-- keys (on conflict do nothing); nothing is removed or rewritten. Each membership
-- actually changed gets one audit row. Returns the number of memberships changed.
create or replace function app.owner_sales_delegation_backfill()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m       record;
  v_before  text[];
  v_after   text[];
  v_added   int;
  v_changed int := 0;
begin
  for v_m in
    select m.id, m.organization_id
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.status = 'active'
      and o.deleted_at is null
      and o.org_type = any (app.owner_sales_delegation_org_types())
      and exists (select 1 from public.membership_capabilities c
                  where c.membership_id = m.id and c.capability_key = 'org.manage')
    order by m.id
    for update of m
  loop
    select coalesce(array_agg(c.capability_key order by c.capability_key), array[]::text[])
      into v_before
      from public.membership_capabilities c where c.membership_id = v_m.id;

    insert into public.membership_capabilities (membership_id, capability_key)
    select v_m.id, k from unnest(app.owner_sales_delegation_capabilities()) k
    on conflict (membership_id, capability_key) do nothing;
    get diagnostics v_added = row_count;

    if v_added > 0 then
      select coalesce(array_agg(c.capability_key order by c.capability_key), array[]::text[])
        into v_after
        from public.membership_capabilities c where c.membership_id = v_m.id;
      perform app.record_audit_event('membership.role_changed', 'membership', v_m.id, v_m.organization_id,
        jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after),
                           'source', 'migration_20261026090001_owner_sales_delegation'));
      v_changed := v_changed + 1;
    end if;
  end loop;
  return v_changed;
end;
$$;
revoke all on function app.owner_sales_delegation_backfill() from public, anon, authenticated, service_role;
comment on function app.owner_sales_delegation_backfill() is
  'DB-owner only, idempotent: adds app.owner_sales_delegation_capabilities() to every ACTIVE org.manage membership of a non-deleted organization whose type is in app.owner_sales_delegation_org_types(). Insert-only; one membership.role_changed audit row per membership changed (20261026090001).';

do $backfill$
declare
  v_changed int;
begin
  v_changed := app.owner_sales_delegation_backfill();
  raise notice 'owner sales delegation backfill: % owner membership(s) updated', v_changed;

  -- Post-condition: no eligible active owner is left without the four keys.
  if exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    cross join unnest(app.owner_sales_delegation_capabilities()) k
    where m.status = 'active' and o.deleted_at is null
      and o.org_type = any (app.owner_sales_delegation_org_types())
      and exists (select 1 from public.membership_capabilities c
                  where c.membership_id = m.id and c.capability_key = 'org.manage')
      and not exists (select 1 from public.membership_capabilities c
                      where c.membership_id = m.id and c.capability_key = k)
  ) then
    raise exception 'owner sales delegation backfill incomplete';
  end if;
end
$backfill$;
