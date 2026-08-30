-- Migration: wire the ONE approved Points earning event.
--
-- Authority: docs/database/points-core.md (approved 2026-08-30), Tier A, and
-- product decision D1 (2026-08-30): referral.organization_approved = 100 Points.
--
-- This migration adds a CALL SITE and nothing else. No table, no column, no
-- policy, no index, no new function and no schema change of any kind: the
-- foundation in 20260830090001_points_core.sql was built so this increment
-- could be exactly this small.
--
-- public.showroom_referral_approve is recreated FORWARD-ONLY (create or replace,
-- identical signature) rather than by editing its original migration. The only
-- difference from 20260815090002 is one declared local and one award block,
-- placed beside the existing app.record_audit_event('referral.approved', ...)
-- call and INSIDE THE SAME TRANSACTION -- the placement notifications-core.md
-- established and points-core.md requires.
--
-- Still true after this migration: referral.organization_approved is the ONLY
-- earning event; admin.adjustment remains a correction primitive, not an
-- earning rule; no Tier B commerce event is wired; Points are not money; and no
-- notification is emitted for an award.

create or replace function public.showroom_referral_approve(
  p_referral_id           uuid,
  p_link_organization_id  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  v_f      public.organization_referrals;
  v_org_id uuid;
  v_bid    uuid;
  v_locale text;
  v_linked boolean := false;
  v_rid    uuid;
  v_mid    uuid;
  v_points_user uuid;
begin
  if not app.is_platform('support') then
    raise exception 'platform authority required' using errcode = '42501';
  end if;

  select * into v_f from public.organization_referrals f
  where f.id = p_referral_id
  for update;
  if not found then
    raise exception 'referral not found' using errcode = '22023';
  end if;

  -- IDEMPOTENT, and the structural reason approval cannot duplicate a business:
  -- the referral already names its organization, so it is returned unchanged.
  if v_f.status = 'approved' then
    return v_f.organization_id;
  end if;
  if v_f.status <> 'submitted' then
    raise exception 'only a submitted referral can be approved (status=%)', v_f.status
      using errcode = '22023';
  end if;

  -- ---- Resolve the organization: prefer LINKING over creating. ----
  if p_link_organization_id is not null then
    -- The Admin decided this candidate IS an existing business.
    select o.id into v_org_id from public.organizations o
    where o.id = p_link_organization_id and o.deleted_at is null
      and o.org_type = v_f.org_type
    for update;
    if v_org_id is null then
      raise exception 'the organization to link is not an existing % ', v_f.org_type
        using errcode = '22023';
    end if;
    v_linked := true;
  else
    -- No explicit link: an EXACT (case/space-insensitive) name match of the same
    -- classification is treated as the same business rather than a second copy of
    -- it. Anything fuzzier is a judgement call and stays with the Admin, who is
    -- shown the shortlist by admin_showroom_referrals_list.
    select o.id into v_org_id from public.organizations o
    where o.deleted_at is null
      and o.org_type = v_f.org_type
      and lower(btrim(o.name)) = lower(btrim(v_f.display_name))
    order by o.created_at
    limit 1
    for update;
    v_linked := v_org_id is not null;
  end if;

  if v_org_id is null then
    -- ---- Materialise the business, WITHOUT an owner. ----
    select u.locale into v_locale from public.users u where u.id = v_f.referred_by;
    insert into public.organizations
      (name, org_type, status, is_verified, primary_locale, created_by,
       source, referred_by_user_id)
    values (btrim(v_f.display_name), v_f.org_type, 'pending_verification', false,
            case when v_locale in ('en', 'ar') then v_locale else 'en' end, v_actor,
            'salesperson_referral', v_f.referred_by)
    returning id into v_org_id;

    insert into public.branches (organization_id, name)
    values (v_org_id, coalesce(nullif(btrim(coalesce(v_f.primary_branch_name, '')), ''),
                               btrim(v_f.display_name)))
    returning id into v_bid;

    perform app.record_audit_event('organization.created', 'organization', v_org_id, v_org_id,
      jsonb_build_object('org_type', v_f.org_type, 'status', 'pending_verification',
                         'source', 'salesperson_referral',
                         'referred_by', v_f.referred_by, 'referral_id', v_f.id));
    perform app.record_audit_event('branch.created', 'branch', v_bid, v_org_id,
      jsonb_build_object('primary', true));
  else
    select b.id into v_bid from public.branches b
    where b.organization_id = v_org_id and b.is_active
    order by b.created_at
    limit 1;
  end if;

  -- ---- The salesperson's relationship: SALES MEMBER. Never Owner. ----
  -- Recorded as an approved join request too, so an affiliation looks the same
  -- whichever path produced it and the salesperson's home needs one read model.
  insert into public.organization_join_requests
    (user_id, organization_id, requested_branch_id, status, decided_by, decided_at, note)
  values (v_f.referred_by, v_org_id, v_bid, 'pending', null, null,
          'Referred this showroom to Aladdin')
  on conflict do nothing
  returning id into v_rid;

  if v_rid is null then
    select r.id into v_rid from public.organization_join_requests r
    where r.user_id = v_f.referred_by and r.organization_id = v_org_id
    order by r.created_at desc
    limit 1;
  end if;

  v_mid := app.membership_grant_sales(v_org_id, v_f.referred_by, v_bid);

  update public.organization_join_requests
     set status = 'approved', membership_id = v_mid,
         decided_by = v_actor, decided_at = now()
   where id = v_rid and status <> 'approved';

  update public.organization_referrals
     set status = 'approved', organization_id = v_org_id, join_request_id = v_rid,
         reviewed_by = v_actor, reviewed_at = now()
   where id = p_referral_id;

  perform app.record_audit_event('referral.approved', 'organization_referral',
    p_referral_id, v_org_id,
    jsonb_build_object('organization_id', v_org_id,
                       'resolution', case when v_linked then 'linked_existing' else 'created' end,
                       'referred_by', v_f.referred_by,
                       'membership_id', v_mid,
                       'relationship', 'sales_member'));

  -- ---- Points: the one approved earning event (D1 = 100, 2026-08-30). ----
  -- The recipient is read back from the CANONICAL, WRITE-ONCE provenance on the
  -- organization itself, never from the referral request and never from a
  -- parameter. app.organizations_provenance_immutable() makes that column
  -- unreassignable, which is precisely why Sprint 13 created it: "a reward paid
  -- on a mutable field is a reward paid to whoever wrote last."
  --
  -- This deliberately awards NOTHING on the LINKING path. An organization that
  -- already existed was not brought to Aladdin by this referral, so it carries
  -- no salesperson_referral provenance and there is no attributed recipient to
  -- credit. Crediting the referral request instead would pay a salesperson for
  -- "referring" a business that was already here.
  select o.referred_by_user_id into v_points_user
  from public.organizations o
  where o.id = v_org_id
    and o.source = 'salesperson_referral'
    and o.referred_by_user_id is not null;

  if v_points_user is not null then
    -- Same transaction as the approval: both commit or neither does. A duplicate
    -- canonical identity (user, event, 'organization', org id) is collapsed to a
    -- no-op by ux_points_ledger_event_identity, so a retry cannot pay twice.
    -- The amount is a literal on purpose: D1 approved 100 Points for the Pilot,
    -- and a configurable reward is a reward whoever can write the config decides.
    perform app.award_points(
      p_user_id         => v_points_user,
      p_organization_id => v_org_id,
      p_event_type      => 'referral.organization_approved',
      p_source_type     => 'organization',
      p_source_id       => v_org_id,
      p_points_delta    => 100
    );
  end if;

  return v_org_id;
end;
$$;

comment on function public.showroom_referral_approve(uuid, uuid) is
  'Platform approval of a referred showroom. Links the candidate to an existing organization of the same classification when one matches (preferred), otherwise materialises the organization + primary branch with NO owner membership. Always ends with the referring salesperson as a SALES MEMBER, never Owner. Idempotent: an approved referral returns its organization and can never create a second. Since 2026-08-30 it also awards 100 Points (referral.organization_approved) to the salesperson named by the organization''s write-once provenance, in the same transaction -- and awards nothing when the approval merely LINKED to a business that already existed.';

-- Signature unchanged, so privileges survive create-or-replace; restated to keep
-- the grant explicit at the call site's new definition.
revoke execute on function public.showroom_referral_approve(uuid, uuid) from public, anon, service_role;
grant execute on function public.showroom_referral_approve(uuid, uuid) to authenticated;
