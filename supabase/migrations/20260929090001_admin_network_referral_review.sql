-- ===========================================================================
-- Admin review queue for Network referrals (Installer Pilot Increment 13
-- continued) — the ADMIN-FACING half of 20260911090001_network_referrals.sql.
--
-- WHY THIS WAS MISSING: that migration built the full installer-facing
-- lifecycle (submit, cancel, read-back) and the platform-facing DECISION RPCs
-- (network_referral_approve / network_referral_reject), but never a LIST RPC
-- for a reviewer to find what needs deciding — the same gap
-- admin_showroom_referrals_list already closed for the Sales referral family
-- (20260815090002_showroom_affiliation.sql §11a). This migration closes it
-- for Network referrals the identical way: one read-only, platform-gated RPC.
-- No new table, no column, no policy, no index, no audit vocabulary (the base
-- migration already added network_referral.submitted/joined/approved/
-- rejected/cancelled) — approval and rejection already exist unchanged
-- (public.network_referral_approve / public.network_referral_reject).
--
-- Only origin = 'new_showroom' rows are ever listed: a 'known_organization'
-- (case A) referral resolves to joined the instant it is created and carries
-- nothing to review, exactly as the base migration's own comments state.
-- ===========================================================================

create or replace function public.admin_network_referrals_list(
  p_pending_only boolean default true
)
returns table (
  id                uuid,
  organization_id   uuid,
  organization_name text,
  display_name      text,
  governorate       text,
  city              text,
  phone             text,
  note              text,
  status            public.network_referral_status,
  decision_reason   text,
  referred_by       uuid,
  referrer_name     text,
  referrer_email    text,
  referrer_persona  public.persona_type,
  created_at        timestamptz,
  decided_at        timestamptz,
  match_count       int,
  match_id          uuid,
  match_name        text
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if not app.is_platform('support') then
    raise exception 'platform authority required' using errcode = '42501';
  end if;

  return query
    with matches as (
      -- Candidate duplicates: same classification network referrals always
      -- produce (showroom_dealer), similar name. A HINT for a human, exactly
      -- like admin_showroom_referrals_list's own — never an automatic merge.
      select r.id as referral_id, o.id as org_id, o.name as org_name,
             row_number() over (partition by r.id
                                order by extensions.similarity(o.name, r.display_name) desc, o.name) as rn,
             count(*) over (partition by r.id) as n
      from public.network_referrals r
      join public.organizations o
        on o.deleted_at is null
       and o.org_type = 'showroom_dealer'
       and r.display_name is not null
       and (o.name ilike r.display_name
            or extensions.similarity(o.name, r.display_name) > 0.4)
      where r.origin = 'new_showroom'
    )
    select r.id, r.organization_id, o.name,
           r.display_name, r.governorate, r.city, r.phone, r.note,
           r.status, r.decision_reason,
           r.referred_by, coalesce(p.display_name, ''), app.mask_email(au.email),
           u.primary_account_type,
           r.created_at, r.decided_at,
           coalesce(mt.n, 0)::int, mt.org_id, mt.org_name
    from public.network_referrals r
    join public.users u on u.id = r.referred_by
    left join public.profiles p on p.user_id = r.referred_by
    left join auth.users au on au.id = r.referred_by
    left join public.organizations o on o.id = r.organization_id
    left join matches mt on mt.referral_id = r.id and mt.rn = 1
    where r.origin = 'new_showroom'
      and (not p_pending_only or r.status = 'pending')
    order by case r.status when 'pending' then 0 else 1 end, r.created_at;
end;
$$;
comment on function public.admin_network_referrals_list(boolean) is
  'Platform review queue for Network referrals (installer-submitted showrooms), mirroring admin_showroom_referrals_list for the Sales referral family. Only origin = new_showroom rows are ever listed — a known_organization referral resolves to joined the instant it is created and has nothing to review. Includes the referring professional (masked email) and the closest existing showroom_dealer organization as a de-duplication hint. Approval/rejection are unchanged: public.network_referral_approve / public.network_referral_reject.';
revoke execute on function public.admin_network_referrals_list(boolean) from public;
grant execute on function public.admin_network_referrals_list(boolean) to authenticated;
