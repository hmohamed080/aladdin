-- Migration: membership & branch write-path RPCs (Phase 1 — Sprint 2).
--
-- Trusted, transactional, auditable functions for the organization membership and
-- branch-assignment lifecycle. All are security-definer, pinned search_path,
-- schema-qualified, and derive authority from auth.uid() via app.has_capability /
-- app.is_platform — never from a spoofable parameter. Every sensitive change emits
-- an audit event via app.record_audit_event. Direct client DML on the membership
-- tables stays governed by the Sprint 1 RLS policies; these RPCs are the ergonomic,
-- invariant-enforcing path (no-escalation, last-owner protection, tenant matching).
-- Design: ADR-0007 amendments (Sprint 2).

-- 7a. Invite/create a membership (status=invited). Requires org.members.manage.
create or replace function public.membership_invite(
  p_org_id uuid,
  p_user_id uuid,
  p_primary_branch_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if not app.has_capability(p_org_id, 'org.members.manage') then
    raise exception 'org.members.manage required' using errcode = '42501';
  end if;
  -- A descriptive primary branch, if given, must belong to the same org.
  if p_primary_branch_id is not null and not exists (
      select 1 from public.branches b where b.id = p_primary_branch_id and b.organization_id = p_org_id) then
    raise exception 'primary branch belongs to a different organization' using errcode = '42501';
  end if;
  insert into public.memberships (user_id, organization_id, primary_branch_id, status, invited_by)
  values (p_user_id, p_org_id, p_primary_branch_id, 'invited', (select auth.uid()))
  returning id into v_id;  -- uq_memberships_user_org rejects a duplicate (23505)
  perform app.record_audit_event('membership.granted', 'membership', v_id, p_org_id,
    jsonb_build_object('user_id', p_user_id, 'status', 'invited'));
  return v_id;
end;
$$;

-- 7b. Activate a membership (invited -> active). The invited user accepts their
-- OWN membership, or a member-manager activates it.
create or replace function public.membership_activate(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership_id for update;
  if not found then raise exception 'membership not found'; end if;
  if not (v_m.user_id = (select auth.uid())
          or app.has_capability(v_m.organization_id, 'org.members.manage')) then
    raise exception 'not authorized to activate this membership' using errcode = '42501';
  end if;
  if v_m.status = 'active' then return; end if;  -- idempotent
  if v_m.status <> 'invited' then
    raise exception 'invalid transition to active from %', v_m.status using errcode = '22023';
  end if;
  update public.memberships set status = 'active', accepted_at = now() where id = p_membership_id;
  perform app.record_audit_event('membership.activated', 'membership', p_membership_id,
    v_m.organization_id, '{}'::jsonb);
end;
$$;

-- 7c. Set a membership's capabilities (role change). NO ESCALATION: the caller may
-- only grant capabilities they themselves hold in that org, and must hold
-- org.members.manage. Replaces the capability set transactionally.
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
  v_m   public.memberships;
  v_cap text;
begin
  select * into v_m from public.memberships where id = p_membership_id for update;
  if not found then raise exception 'membership not found'; end if;
  if not app.has_capability(v_m.organization_id, 'org.members.manage') then
    raise exception 'org.members.manage required' using errcode = '42501';
  end if;
  -- No-escalation: every requested capability must be held by the caller.
  if p_capabilities is not null then
    foreach v_cap in array p_capabilities loop
      if not app.has_capability(v_m.organization_id, v_cap) then
        raise exception 'cannot grant a capability you do not hold: %', v_cap using errcode = '42501';
      end if;
    end loop;
  end if;
  delete from public.membership_capabilities where membership_id = p_membership_id;
  if p_capabilities is not null then
    insert into public.membership_capabilities (membership_id, capability_key)
    select p_membership_id, c from unnest(p_capabilities) as c
    on conflict do nothing;
  end if;
  perform app.record_audit_event('membership.role_changed', 'membership', p_membership_id,
    v_m.organization_id, jsonb_build_object('capabilities', to_jsonb(coalesce(p_capabilities, array[]::text[]))));
end;
$$;

-- Shared guard: raise if changing this membership's active state would orphan the
-- organization (remove its last active org.manage holder). Locks the org's owner
-- rows so concurrent removals cannot both pass.
create or replace function app.assert_not_last_owner(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_m public.memberships; v_others int;
begin
  select * into v_m from public.memberships where id = p_membership_id;
  -- Only relevant if THIS membership is an active org.manage holder.
  if not exists (
      select 1 from public.membership_capabilities c
      where c.membership_id = p_membership_id and c.capability_key = 'org.manage')
     or v_m.status <> 'active' then
    return;
  end if;
  -- Lock every active org.manage owner row of the org (consistent order) so two
  -- concurrent removals serialize; then count OTHERS without an aggregate+FOR UPDATE.
  perform 1
  from public.memberships m
  join public.membership_capabilities c on c.membership_id = m.id
  where m.organization_id = v_m.organization_id
    and m.status = 'active'
    and c.capability_key = 'org.manage'
  order by m.id
  for update;

  select count(*) into v_others
  from public.memberships m
  join public.membership_capabilities c on c.membership_id = m.id
  where m.organization_id = v_m.organization_id
    and m.id <> p_membership_id
    and m.status = 'active'
    and c.capability_key = 'org.manage';
  if v_others = 0 then
    raise exception 'cannot suspend/revoke the last active org.manage owner' using errcode = '23514';
  end if;
end;
$$;

-- 7d. Suspend a membership (active -> suspended). Last-owner protected.
create or replace function public.membership_suspend(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership_id for update;
  if not found then raise exception 'membership not found'; end if;
  if not app.has_capability(v_m.organization_id, 'org.members.manage') then
    raise exception 'org.members.manage required' using errcode = '42501';
  end if;
  if v_m.status = 'suspended' then return; end if;  -- idempotent
  if v_m.status <> 'active' then
    raise exception 'invalid transition to suspended from %', v_m.status using errcode = '22023';
  end if;
  perform app.assert_not_last_owner(p_membership_id);
  update public.memberships set status = 'suspended' where id = p_membership_id;
  perform app.record_audit_event('membership.suspended', 'membership', p_membership_id,
    v_m.organization_id, '{}'::jsonb);
end;
$$;

-- 7e. Revoke a membership (-> revoked; access lost immediately). Last-owner protected.
create or replace function public.membership_revoke(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership_id for update;
  if not found then raise exception 'membership not found'; end if;
  if not app.has_capability(v_m.organization_id, 'org.members.manage') then
    raise exception 'org.members.manage required' using errcode = '42501';
  end if;
  if v_m.status = 'revoked' then return; end if;  -- idempotent
  perform app.assert_not_last_owner(p_membership_id);
  update public.memberships set status = 'revoked' where id = p_membership_id;
  perform app.record_audit_event('membership.revoked', 'membership', p_membership_id,
    v_m.organization_id, '{}'::jsonb);
end;
$$;

-- 7f. Assign a branch to a membership (explicit branch access). Requires
-- branch.manage; the membership and branch must be the same tenant.
create or replace function public.branch_assign(p_membership_id uuid, p_branch_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_m public.memberships; v_branch_org uuid; v_id uuid;
begin
  select * into v_m from public.memberships where id = p_membership_id;
  if not found then raise exception 'membership not found'; end if;
  if not app.has_capability(v_m.organization_id, 'branch.manage') then
    raise exception 'branch.manage required' using errcode = '42501';
  end if;
  select b.organization_id into v_branch_org from public.branches b where b.id = p_branch_id;
  if v_branch_org is null then raise exception 'branch not found'; end if;
  -- Cross-tenant assignment is impossible: branch org must equal membership org.
  if v_branch_org <> v_m.organization_id then
    raise exception 'cannot assign a membership to another tenant''s branch' using errcode = '42501';
  end if;
  insert into public.membership_branch_access (membership_id, branch_id)
  values (p_membership_id, p_branch_id)
  on conflict (membership_id, branch_id) do nothing
  returning id into v_id;  -- duplicate is a no-op (idempotent)
  perform app.record_audit_event('branch.assignment_changed', 'membership', p_membership_id,
    v_m.organization_id, jsonb_build_object('branch_id', p_branch_id, 'op', 'assign'));
  return v_id;
end;
$$;

-- 7g. Remove a branch assignment. Requires branch.manage in the same tenant.
create or replace function public.branch_unassign(p_membership_id uuid, p_branch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership_id;
  if not found then raise exception 'membership not found'; end if;
  if not app.has_capability(v_m.organization_id, 'branch.manage') then
    raise exception 'branch.manage required' using errcode = '42501';
  end if;
  delete from public.membership_branch_access
    where membership_id = p_membership_id and branch_id = p_branch_id;
  perform app.record_audit_event('branch.assignment_changed', 'membership', p_membership_id,
    v_m.organization_id, jsonb_build_object('branch_id', p_branch_id, 'op', 'unassign'));
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Grants — internal guard revoked; workflow RPCs callable by authenticated
--    (each rejects unauthorized callers internally via auth.uid()-derived checks).
-- ---------------------------------------------------------------------------
revoke execute on function app.assert_not_last_owner(uuid) from public;

revoke execute on function public.membership_invite(uuid, uuid, uuid) from public;
revoke execute on function public.membership_activate(uuid) from public;
revoke execute on function public.membership_set_capabilities(uuid, text[]) from public;
revoke execute on function public.membership_suspend(uuid) from public;
revoke execute on function public.membership_revoke(uuid) from public;
revoke execute on function public.branch_assign(uuid, uuid) from public;
revoke execute on function public.branch_unassign(uuid, uuid) from public;

grant execute on function public.membership_invite(uuid, uuid, uuid) to authenticated;
grant execute on function public.membership_activate(uuid) to authenticated;
grant execute on function public.membership_set_capabilities(uuid, text[]) to authenticated;
grant execute on function public.membership_suspend(uuid) to authenticated;
grant execute on function public.membership_revoke(uuid) to authenticated;
grant execute on function public.branch_assign(uuid, uuid) to authenticated;
grant execute on function public.branch_unassign(uuid, uuid) to authenticated;
