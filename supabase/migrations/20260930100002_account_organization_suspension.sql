-- ===========================================================================
-- Admin Core Phase 1B-B (2/4) — user suspension (PD-010) and organization
-- suspension (PD-011). Design and the module-by-module effects:
-- docs/admin/ADMIN_USER_ORG_OPERATIONS.md §4–§5.
--
-- Suspension never deletes or anonymizes anything. users.status /
-- organizations.status carry the state; public.admin_suspensions keeps every
-- episode (reason, actor, time, the status to restore, and the restoration).
--
-- Enforcement is central, not per screen:
--   * a suspended ACCOUNT is refused on every Data API request by the PostgREST
--     pre-request hook (app.api_pre_request), and — defense in depth, and for
--     the paths that do not go through PostgREST (Storage, Realtime RLS) —
--     has_capability / is_org_member / require_verified_caller / the personal
--     storage helpers treat the caller as having no authority;
--   * a suspended ORGANIZATION loses every non-".read" capability (all new
--     organization activity) while its members, records and reads stay intact;
--     its products leave the public catalog; nobody can apply to its jobs or
--     place a new order with it. Members are never suspended with it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Suspension episodes
-- ---------------------------------------------------------------------------
create table public.admin_suspensions (
  id               uuid primary key default extensions.gen_random_uuid(),
  subject_type     text not null,
  user_id          uuid references public.users(id),
  organization_id  uuid references public.organizations(id),
  reason           text not null,
  previous_status  text not null,
  suspended_by     uuid not null references public.users(id),
  suspended_at     timestamptz not null default now(),
  restored_by      uuid references public.users(id),
  restored_at      timestamptz,
  restore_reason   text,
  constraint ck_admin_suspensions_subject check (
    (subject_type = 'user' and user_id is not null and organization_id is null)
    or (subject_type = 'organization' and organization_id is not null and user_id is null)),
  constraint ck_admin_suspensions_reason check (char_length(reason) between 1 and 500),
  constraint ck_admin_suspensions_restore check ((restored_at is null) = (restored_by is null))
);
comment on table public.admin_suspensions is
  'One row per suspension episode of a user (PD-010) or an organization (PD-011). Open episode = restored_at is null (at most one per subject). History is never deleted. Read/written only by the security-definer Admin RPCs.';
create unique index uq_admin_suspensions_open_user on public.admin_suspensions (user_id)
  where subject_type = 'user' and restored_at is null;
create unique index uq_admin_suspensions_open_org on public.admin_suspensions (organization_id)
  where subject_type = 'organization' and restored_at is null;
create index ix_admin_suspensions_user on public.admin_suspensions (user_id) where user_id is not null;
create index ix_admin_suspensions_org on public.admin_suspensions (organization_id) where organization_id is not null;

alter table public.admin_suspensions enable row level security;
revoke all on public.admin_suspensions from public, anon, authenticated;

-- Episodes are history: they may only be closed (restore), never rewritten or removed.
create or replace function app.admin_suspensions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'suspension history cannot be deleted' using errcode = '42501';
  end if;
  if old.restored_at is not null
     or new.id <> old.id or new.subject_type <> old.subject_type
     or new.user_id is distinct from old.user_id or new.organization_id is distinct from old.organization_id
     or new.reason <> old.reason or new.previous_status <> old.previous_status
     or new.suspended_by <> old.suspended_by or new.suspended_at <> old.suspended_at then
    raise exception 'a suspension episode can only be closed by a restore' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger trg_admin_suspensions_immutable
  before update or delete on public.admin_suspensions
  for each row execute function app.admin_suspensions_immutable();

-- ---------------------------------------------------------------------------
-- 2. State helpers
-- ---------------------------------------------------------------------------
create or replace function app.account_is_active(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users u
    where u.id = p_user_id and u.status not in ('suspended', 'deactivated'));
$$;
revoke execute on function app.account_is_active(uuid) from public, anon;
grant execute on function app.account_is_active(uuid) to authenticated;

create or replace function app.org_is_suspended(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizations o where o.id = p_org_id and o.status = 'suspended');
$$;
revoke execute on function app.org_is_suspended(uuid) from public, anon;
grant execute on function app.org_is_suspended(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Account enforcement
-- ---------------------------------------------------------------------------

-- 3a. Every Data API request. Runs as the request role before the request;
-- raising refuses it. Only the caller's own status read stays open, so the web
-- app can explain the suspension.
create or replace function app.api_pre_request()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims jsonb;
  v_sub    uuid;
begin
  v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  if v_claims is null or v_claims ->> 'role' is distinct from 'authenticated' then
    return;
  end if;
  begin
    v_sub := (v_claims ->> 'sub')::uuid;
  exception when others then
    return;
  end;
  if v_sub is null or coalesce(current_setting('request.path', true), '') = '/rpc/my_account_status' then
    return;
  end if;
  if exists (select 1 from public.users u where u.id = v_sub and u.status in ('suspended', 'deactivated')) then
    raise exception 'account suspended' using errcode = '42501', hint = 'account_suspended';
  end if;
end;
$$;
comment on function app.api_pre_request() is
  'PostgREST db_pre_request hook (Admin Core 1B-B, PD-010): refuses every Data API request made by a suspended or deactivated account, except my_account_status. No effect for anon/service_role.';
revoke execute on function app.api_pre_request() from public;
grant execute on function app.api_pre_request() to anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request to 'app.api_pre_request';
notify pgrst, 'reload config';

-- The one request a suspended account may make: its own status.
create or replace function public.my_account_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', u.status,
    'suspended', u.status in ('suspended', 'deactivated'))
  from public.users u where u.id = (select auth.uid());
$$;
revoke execute on function public.my_account_status() from public, anon;
grant execute on function public.my_account_status() to authenticated;

-- 3b. Tenant authority. An inactive account holds no membership authority;
-- a suspended organization keeps only its ".read" capabilities.
create or replace function app.has_capability(p_org_id uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.membership_capabilities c on c.membership_id = m.id
    join public.users u on u.id = m.user_id and u.status not in ('suspended', 'deactivated')
    where m.user_id = (select auth.uid())
      and m.organization_id = p_org_id
      and m.status = 'active'
      and c.capability_key = p_key
  )
  and (p_key like '%.read' or not exists (
    select 1 from public.organizations o where o.id = p_org_id and o.status = 'suspended'));
$$;

create or replace function app.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    join public.users u on u.id = m.user_id and u.status not in ('suspended', 'deactivated')
    where m.user_id = (select auth.uid())
      and m.organization_id = p_org_id
      and m.status = 'active'
  );
$$;

-- 3c. The gate of the personal RPCs (applications, referrals, reviews, portfolio …).
create or replace function app.require_verified_caller()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from auth.users au where au.id = v_uid and au.email_confirmed_at is not null
  ) then
    raise exception 'a verified email is required' using errcode = '42501';
  end if;
  if not app.account_is_active(v_uid) then
    raise exception 'account suspended' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- 3d. Storage uploads (the Storage API does not pass through PostgREST).
create or replace function app.can_create_professional_asset()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_professional_persona((select auth.uid()))
     and app.account_is_active((select auth.uid()));
$$;

create or replace function app.can_upload_avatar_object(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.account_is_active((select auth.uid())) and exists (
    select 1 from public.avatar_uploads
    where object_key = p_key and owner_user_id = (select auth.uid()) and state = 'pending'
  );
$$;

create or replace function app.can_upload_portfolio_object(p_object_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.account_is_active((select auth.uid())) and exists (
    select 1 from public.portfolio_items i
    where i.object_key = p_object_key
      and i.owner_user_id = (select auth.uid())
      and i.state = 'pending'::public.professional_asset_state
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Organization enforcement beyond capabilities
-- ---------------------------------------------------------------------------

-- 4a. A suspended organization's published products leave the public catalog
-- (hidden, not deleted — members still read them through products_select_own).
drop policy products_select_published on public.products;
create policy products_select_published on public.products
  for select to authenticated
  using (status = 'published'::public.product_status and deleted_at is null
         and not app.org_is_suspended(organization_id));

-- 4b. Nobody applies to a suspended organization's job (the board already hides it).
create or replace function app.job_applications_org_not_suspended()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.org_is_suspended((select j.poster_org_id from public.jobs j where j.id = new.job_id)) then
    raise exception 'this organization is currently suspended' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger trg_job_applications_org_not_suspended
  before insert on public.job_applications
  for each row execute function app.job_applications_org_not_suspended();

-- 4c. No new order with a suspended organization on either side (PD-011 §4 safe
-- default). Existing orders are untouched.
create or replace function app.orders_org_not_suspended()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.org_is_suspended(new.requester_org_id) or app.org_is_suspended(new.supplier_org_id) then
    raise exception 'this organization is currently suspended' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger trg_orders_org_not_suspended
  before insert on public.orders
  for each row execute function app.orders_org_not_suspended();

-- ---------------------------------------------------------------------------
-- 5. The last usable Super Admin cannot be suspended / deactivated — any path.
-- Same advisory lock as the assignment guard (20260929100001), so an account
-- change and an assignment change can never race past each other.
-- ---------------------------------------------------------------------------
create or replace function app.users_last_super_admin_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_super uuid;
begin
  if new.status is not distinct from old.status or new.status not in ('suspended', 'deactivated') then
    return new;
  end if;
  select r.id into v_super from public.admin_roles r where r.key = 'super_admin';
  if not exists (
    select 1 from public.admin_role_assignments a
    where a.user_id = new.id and a.role_id = v_super and a.is_active and a.scope_type = 'platform') then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('aladdin.admin_rbac.super_admin'));
  if not exists (
    select 1 from public.admin_role_assignments a
    join public.users u on u.id = a.user_id
    where a.role_id = v_super and a.is_active and a.scope_type = 'platform'
      and a.user_id <> new.id and u.status not in ('suspended', 'deactivated')) then
    raise exception 'the last active Super Admin cannot be suspended' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger trg_users_last_super_admin_guard
  before update of status on public.users
  for each row execute function app.users_last_super_admin_guard();

-- ---------------------------------------------------------------------------
-- 6. User suspend / restore (users.suspend, platform scope)
-- ---------------------------------------------------------------------------
create or replace function public.admin_user_suspend(p_user_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a        record;
  v_reason text := app.admin_clean_reason(p_reason);
  v_user   public.users;
  v_id     uuid;
begin
  perform app.admin_require('users.suspend');
  select * into a from app.admin_actor();
  if v_reason is null then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  select * into v_user from public.users where id = p_user_id for update;
  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if p_user_id = a.user_id then
    raise exception 'you cannot suspend your own account' using errcode = '42501';
  end if;
  if not a.is_super and app.admin_rank_of(p_user_id) >= a.rank then
    raise exception 'you cannot suspend Admin Staff at or above your own rank' using errcode = '42501';
  end if;
  if v_user.status = 'suspended' then
    return jsonb_build_object('status', 'suspended', 'changed', false);
  end if;
  if v_user.status = 'deactivated' then
    raise exception 'a deactivated account cannot be suspended' using errcode = '22023';
  end if;

  insert into public.admin_suspensions (subject_type, user_id, reason, previous_status, suspended_by)
  values ('user', p_user_id, v_reason, v_user.status::text, a.user_id)
  returning id into v_id;
  update public.users set status = 'suspended' where id = p_user_id;

  perform app.record_audit_event('account.suspended', 'user', p_user_id, null, jsonb_build_object(
    'suspension_id', v_id, 'reason', v_reason,
    'status_before', v_user.status, 'status_after', 'suspended'));
  return jsonb_build_object('status', 'suspended', 'changed', true, 'suspension_id', v_id);
end;
$$;
revoke execute on function public.admin_user_suspend(uuid, text) from public, anon;
grant execute on function public.admin_user_suspend(uuid, text) to authenticated;

create or replace function public.admin_user_restore(p_user_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a        record;
  v_reason text := app.admin_clean_reason(p_reason);
  v_user   public.users;
  v_open   public.admin_suspensions;
  v_to     public.user_status;
begin
  perform app.admin_require('users.suspend');
  select * into a from app.admin_actor();
  select * into v_user from public.users where id = p_user_id for update;
  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if v_user.status <> 'suspended' then
    return jsonb_build_object('status', v_user.status, 'changed', false);
  end if;
  select * into v_open from public.admin_suspensions
  where subject_type = 'user' and user_id = p_user_id and restored_at is null
  for update;
  -- A suspension made outside the RPC (DBA) has no episode: restore to active.
  v_to := coalesce(nullif(v_open.previous_status, 'suspended'), 'active')::public.user_status;

  if v_open.id is not null then
    update public.admin_suspensions
      set restored_by = a.user_id, restored_at = now(), restore_reason = v_reason
      where id = v_open.id;
  end if;
  update public.users set status = v_to where id = p_user_id;

  perform app.record_audit_event('account.restored', 'user', p_user_id, null, jsonb_build_object(
    'suspension_id', v_open.id, 'reason', v_reason,
    'status_before', 'suspended', 'status_after', v_to));
  return jsonb_build_object('status', v_to, 'changed', true, 'suspension_id', v_open.id);
end;
$$;
revoke execute on function public.admin_user_restore(uuid, text) from public, anon;
grant execute on function public.admin_user_restore(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Organization suspend / restore (organizations.suspend, platform scope).
-- Members are NOT touched.
-- ---------------------------------------------------------------------------
create or replace function public.admin_organization_suspend(p_organization_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a        record;
  v_reason text := app.admin_clean_reason(p_reason);
  v_org    public.organizations;
  v_id     uuid;
begin
  perform app.admin_require('organizations.suspend');
  select * into a from app.admin_actor();
  if v_reason is null then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  select * into v_org from public.organizations where id = p_organization_id and deleted_at is null for update;
  if not found then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  if v_org.status = 'suspended' then
    return jsonb_build_object('status', 'suspended', 'changed', false);
  end if;
  if v_org.status = 'archived' then
    raise exception 'an archived organization cannot be suspended' using errcode = '22023';
  end if;

  insert into public.admin_suspensions (subject_type, organization_id, reason, previous_status, suspended_by)
  values ('organization', p_organization_id, v_reason, v_org.status::text, a.user_id)
  returning id into v_id;
  update public.organizations set status = 'suspended' where id = p_organization_id;

  perform app.record_audit_event('organization.suspended', 'organization', p_organization_id, p_organization_id,
    jsonb_build_object('suspension_id', v_id, 'reason', v_reason,
      'status_before', v_org.status, 'status_after', 'suspended'));
  return jsonb_build_object('status', 'suspended', 'changed', true, 'suspension_id', v_id);
end;
$$;
revoke execute on function public.admin_organization_suspend(uuid, text) from public, anon;
grant execute on function public.admin_organization_suspend(uuid, text) to authenticated;

create or replace function public.admin_organization_restore(p_organization_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a        record;
  v_reason text := app.admin_clean_reason(p_reason);
  v_org    public.organizations;
  v_open   public.admin_suspensions;
  v_to     public.org_status;
begin
  perform app.admin_require('organizations.suspend');
  select * into a from app.admin_actor();
  select * into v_org from public.organizations where id = p_organization_id and deleted_at is null for update;
  if not found then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  if v_org.status <> 'suspended' then
    return jsonb_build_object('status', v_org.status, 'changed', false);
  end if;
  select * into v_open from public.admin_suspensions
  where subject_type = 'organization' and organization_id = p_organization_id and restored_at is null
  for update;
  v_to := coalesce(nullif(v_open.previous_status, 'suspended'), 'active')::public.org_status;

  if v_open.id is not null then
    update public.admin_suspensions
      set restored_by = a.user_id, restored_at = now(), restore_reason = v_reason
      where id = v_open.id;
  end if;
  update public.organizations set status = v_to where id = p_organization_id;

  perform app.record_audit_event('organization.restored', 'organization', p_organization_id, p_organization_id,
    jsonb_build_object('suspension_id', v_open.id, 'reason', v_reason,
      'status_before', 'suspended', 'status_after', v_to));
  return jsonb_build_object('status', v_to, 'changed', true, 'suspension_id', v_open.id);
end;
$$;
revoke execute on function public.admin_organization_restore(uuid, text) from public, anon;
grant execute on function public.admin_organization_restore(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Read: the open suspension episode of a subject (parent read permission).
-- ---------------------------------------------------------------------------
create or replace function public.admin_subject_suspension(p_subject_type text, p_subject_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if p_subject_type = 'user' then
    perform app.admin_require('users.read');
  elsif p_subject_type = 'organization' then
    perform app.admin_require('organizations.read');
  else
    raise exception 'unsupported subject type' using errcode = '22023';
  end if;
  select jsonb_build_object(
      'id', s.id, 'reason', s.reason, 'suspended_at', s.suspended_at,
      'suspended_by', jsonb_build_object('user_id', s.suspended_by, 'display_name', coalesce(p.display_name, '')))
    into v_result
  from public.admin_suspensions s
  left join public.profiles p on p.user_id = s.suspended_by
  where s.subject_type = p_subject_type and s.restored_at is null
    and (s.user_id = p_subject_id or s.organization_id = p_subject_id);
  return v_result;  -- NULL: not suspended through Admin
end;
$$;
revoke execute on function public.admin_subject_suspension(text, uuid) from public, anon;
grant execute on function public.admin_subject_suspension(text, uuid) to authenticated;
