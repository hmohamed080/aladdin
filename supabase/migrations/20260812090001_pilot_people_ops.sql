-- Sprint 11 — Pilot people operations.
--
-- Two forward-only changes that let an org owner/manager run the minimum people
-- management the Pilot needs, reusing the existing invitation/capability engine
-- (invitation_create / invitation_accept / membership_set_capabilities /
-- branch_assign — all unchanged in contract):
--
--   1. org_members_list(): a trusted, manager-gated read-model for the members
--      screen. `memberships`, `membership_capabilities` and `membership_branch_access`
--      are already manager-readable under RLS, but a co-member's identity
--      (`profiles`, `users`, `auth.users`) is NOT — a manager may not read a
--      stranger's identity rows. This security-definer read-model returns exactly
--      the columns the roster needs (display name, MASKED email, account type,
--      status, branch + capability scope), gated on `org.members.manage`. It
--      never exposes a raw email or any cross-org row.
--
--   2. membership_set_capabilities(): the grantable allow-list predates the sales
--      (Sprint 3) and orders (Sprint 10) domains, so a manager could not delegate
--      `sales.write` / `order.manage` etc. — the keys the live RPCs actually check.
--      This recreates the function with those keys added; every other guard
--      (unique/non-null, "cannot grant a capability you do not hold", last-owner)
--      is byte-for-byte unchanged.

-- ---------------------------------------------------------------------------
-- 1. Members read-model (manager-gated; masked identity)
-- ---------------------------------------------------------------------------
create or replace function public.org_members_list(p_org_id uuid)
returns table (
  membership_id        uuid,
  user_id              uuid,
  display_name         text,
  email_masked         text,
  primary_account_type public.account_type,
  status               public.membership_status,
  primary_branch_id    uuid,
  branch_ids           uuid[],
  capabilities         text[],
  invited_at           timestamptz,
  accepted_at          timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if not app.has_capability(p_org_id, 'org.members.manage') then
    raise exception 'org.members.manage required' using errcode = '42501';
  end if;

  return query
    select
      m.id,
      m.user_id,
      coalesce(p.display_name, ''),
      app.mask_email(au.email),
      u.primary_account_type,
      m.status,
      m.primary_branch_id,
      coalesce(
        (select array_agg(ba.branch_id order by ba.branch_id)
         from public.membership_branch_access ba where ba.membership_id = m.id),
        array[]::uuid[]),
      coalesce(
        (select array_agg(c.capability_key order by c.capability_key)
         from public.membership_capabilities c where c.membership_id = m.id),
        array[]::text[]),
      m.created_at,
      m.accepted_at
    from public.memberships m
    join public.users u on u.id = m.user_id
    left join public.profiles p on p.user_id = m.user_id
    left join auth.users au on au.id = m.user_id
    where m.organization_id = p_org_id
    order by
      case m.status when 'active' then 0 when 'invited' then 1 when 'suspended' then 2 else 3 end,
      coalesce(p.display_name, '');
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Refresh the grantable capability allow-list (adds sales/orders keys)
-- ---------------------------------------------------------------------------
create or replace function public.membership_set_capabilities(
  p_membership_id uuid,
  p_capabilities text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_m public.memberships;
  v_cap text;
  v_before text[];
  v_after text[];
begin
  if p_capabilities is null then
    raise exception 'capabilities must be an array (empty means remove all)'
      using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_capabilities) c where c is null)
     or cardinality(p_capabilities) <> (select count(distinct c) from unnest(p_capabilities) c) then
    raise exception 'capabilities must contain unique, non-null keys'
      using errcode = '22023';
  end if;

  select organization_id into v_org_id from public.memberships where id = p_membership_id;
  if not found then raise exception 'membership not found'; end if;
  perform 1 from public.organizations where id = v_org_id for update;
  select * into v_m from public.memberships where id = p_membership_id for update;
  if not app.has_capability(v_m.organization_id, 'org.members.manage') then
    raise exception 'org.members.manage required' using errcode = '42501';
  end if;

  select coalesce(array_agg(c.capability_key order by c.capability_key), array[]::text[])
    into v_before
    from public.membership_capabilities c where c.membership_id = p_membership_id;

  foreach v_cap in array p_capabilities loop
    if v_cap not in (
      'org.manage', 'org.members.manage', 'branch.manage',
      'verification.submit', 'verification.read',
      'catalog.read', 'catalog.write', 'catalog.publish',
      'inventory.write',
      -- Sprint 3 sales domain (the keys the live sales RPCs enforce).
      'sales.read', 'sales.write', 'sales.assign', 'sales.manage',
      'sales.opportunity.read', 'sales.opportunity.write', 'sales.match.share',
      'sales.task.write', 'sales.followup.send',
      -- Sprint 9/10 commerce + execution domains.
      'rfq.create', 'rfq.respond', 'quote.submit', 'quote.decide',
      'order.create', 'order.manage',
      'project.read', 'project.write', 'conversation.participate',
      'ad.manage', 'subscription.read', 'subscription.manage',
      'analytics.view', 'export.data'
    ) then
      raise exception 'invalid capability key: %', v_cap using errcode = '22023';
    end if;
    if not app.has_capability(v_m.organization_id, v_cap) then
      raise exception 'cannot grant a capability you do not hold: %', v_cap using errcode = '42501';
    end if;
  end loop;

  if 'org.manage' = any(v_before) and not ('org.manage' = any(p_capabilities)) then
    perform app.assert_not_last_owner(p_membership_id);
  end if;

  delete from public.membership_capabilities where membership_id = p_membership_id;
  insert into public.membership_capabilities (membership_id, capability_key)
    select p_membership_id, c from unnest(p_capabilities) c;

  select coalesce(array_agg(c.capability_key order by c.capability_key), array[]::text[])
    into v_after
    from public.membership_capabilities c where c.membership_id = p_membership_id;
  perform app.record_audit_event('membership.role_changed', 'membership', p_membership_id,
    v_m.organization_id, jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Grants (deny-by-default; authenticated callers only)
-- ---------------------------------------------------------------------------
revoke execute on function public.org_members_list(uuid) from public;
grant execute on function public.org_members_list(uuid) to authenticated;
