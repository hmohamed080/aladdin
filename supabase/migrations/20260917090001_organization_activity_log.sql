-- ===========================================================================
-- Organization Activity Log (GitHub #50)
--
-- A tenant-readable, PII-minimised business feed. This is deliberately NOT a
-- view over public.audit_log: the security trail remains platform-admin-only,
-- while this table holds only a closed action set and explicitly projected
-- scalar parameters. See ADR-0010.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Capability catalog
-- ---------------------------------------------------------------------------
alter table public.membership_capabilities drop constraint ck_membership_capability_key;
alter table public.membership_capabilities add constraint ck_membership_capability_key check (capability_key in (
  'org.manage', 'org.members.manage', 'branch.manage',
  'verification.submit', 'verification.read',
  'catalog.read', 'catalog.write', 'catalog.publish',
  'inventory.write',
  'sales.opportunity.read', 'sales.opportunity.write', 'sales.match.share',
  'sales.task.write', 'sales.followup.send',
  'sales.read', 'sales.write', 'sales.assign', 'sales.manage',
  'rfq.create', 'rfq.respond',
  'quote.submit', 'quote.decide',
  'order.create', 'order.manage',
  'project.read', 'project.write',
  'conversation.participate',
  'job.post', 'job.manage',
  'ad.manage',
  'subscription.read', 'subscription.manage',
  'analytics.view',
  'export.data',
  'activity.read'
));

-- Existing owners are the safe backfill population: they already hold the
-- blanket in-org authority and must be able to delegate this exact key through
-- the existing no-escalation RPC after the migration lands.
-- Scoped to ACTIVE memberships: app.has_capability already requires
-- m.status = 'active', so a row on an invited/suspended/revoked membership would
-- grant nothing while still writing state the organization never chose.
insert into public.membership_capabilities (membership_id, capability_key)
select capability.membership_id, 'activity.read'
from public.membership_capabilities capability
join public.memberships m on m.id = capability.membership_id
where capability.capability_key = 'org.manage'
  and m.status = 'active'
on conflict (membership_id, capability_key) do nothing;

-- The writer and every caller share one closed projection vocabulary. The
-- table CHECK below stays literal so replacing this helper cannot silently
-- change the validity of rows without replacing/revalidating the constraint.
create or replace function app.activity_event_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'rfq.created', 'rfq.submitted', 'rfq.updated', 'rfq.cancelled', 'rfq.closed',
    'quotation.created', 'quotation.submitted', 'quotation.updated',
    'quotation.accepted', 'quotation.rejected',
    'order.created', 'order.started', 'order.completed', 'order.cancelled',
    'project.created', 'project.activated', 'project.completed',
    'lead.created', 'lead.details_changed',
    'customer.created', 'customer.updated', 'customer.reassigned',
    'followup.created', 'followup.completed', 'followup.reopened', 'followup.reassigned',
    'affiliation.requested', 'affiliation.approved', 'affiliation.rejected', 'affiliation.cancelled',
    'product.created', 'product.updated'
  ]::text[];
$$;

revoke all on function app.activity_event_types()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Purpose-built append-only activity projection
-- ---------------------------------------------------------------------------
create table public.organization_activity_events (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  audit_log_id     uuid not null references public.audit_log (id),
  actor_user_id    uuid references public.users (id) on delete set null,
  event_type       text not null check (event_type in (
    'rfq.created', 'rfq.submitted', 'rfq.updated', 'rfq.cancelled', 'rfq.closed',
    'quotation.created', 'quotation.submitted', 'quotation.updated',
    'quotation.accepted', 'quotation.rejected',
    'order.created', 'order.started', 'order.completed', 'order.cancelled',
    'project.created', 'project.activated', 'project.completed',
    'lead.created', 'lead.details_changed',
    'customer.created', 'customer.updated', 'customer.reassigned',
    'followup.created', 'followup.completed', 'followup.reopened', 'followup.reassigned',
    'affiliation.requested', 'affiliation.approved', 'affiliation.rejected', 'affiliation.cancelled',
    'product.created', 'product.updated'
  )),
  subject_type     text not null check (char_length(subject_type) between 1 and 64),
  subject_id       uuid,
  params           jsonb not null default '{}'::jsonb
                   check (jsonb_typeof(params) = 'object')
                   check (length(params::text) <= 2048),
  created_at       timestamptz not null default now()
);

comment on table public.organization_activity_events is
  'Organization-readable, append-only projection of allow-listed business actions. NOT the public.audit_log security trail; contains no raw payloads, secrets, tokens, free-text notes/reasons, private metadata, or cross-organization events.';
comment on column public.organization_activity_events.id is
  'Opaque activity-row identifier.';
comment on column public.organization_activity_events.organization_id is
  'The one organization allowed to read this event through capability-gated RLS.';
comment on column public.organization_activity_events.audit_log_id is
  'Internal provenance link to the platform-admin-only security audit row; never joined into the organization read surface.';
comment on column public.organization_activity_events.actor_user_id is
  'Canonical actor copied from the audit writer; nullable for system activity and cleared if the user is deleted.';
comment on column public.organization_activity_events.event_type is
  'Closed organization-visible business action vocabulary; intentionally excludes security/admin and permission-internal actions.';
comment on column public.organization_activity_events.subject_type is
  'Bounded business subject kind copied from the audit event.';
comment on column public.organization_activity_events.subject_id is
  'Identifier of the acted-on subject, used only as event provenance and never as a cross-tenant join authority.';
comment on column public.organization_activity_events.params is
  'PII-minimised, default-deny projection of explicitly named bounded scalar display parameters; never raw audit metadata.';
comment on column public.organization_activity_events.created_at is
  'Immutable event time shared transactionally with the originating business action.';

create index ix_organization_activity_events_org_created
  on public.organization_activity_events (organization_id, created_at desc);

create trigger organization_activity_events_no_update
  before update on public.organization_activity_events
  for each row execute function app.forbid_mutation();

create trigger organization_activity_events_no_delete
  before delete on public.organization_activity_events
  for each row execute function app.forbid_mutation();

alter table public.organization_activity_events enable row level security;

-- `activity.read` is the SINGLE authority for this feed, deliberately WITHOUT the
-- `org.manage` blanket arm that most in-org checks carry. A capability an owner
-- can override is one nobody can withhold, which would make this key decorative
-- rather than real. Owners are not locked out: they hold `activity.read` itself --
-- existing memberships through the backfill above, new ones through
-- `app.organization_create_owned` -- and delegate it onward through
-- `public.membership_set_capabilities`. Do not re-add an `org.manage` arm here.
create policy organization_activity_events_select on public.organization_activity_events
  for select to authenticated
  using (app.has_capability(organization_id, 'activity.read'));

revoke all on table public.organization_activity_events from anon, authenticated, service_role;
grant select on table public.organization_activity_events to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Default-deny parameter projection
--
-- Every retained value is both explicitly named and JSON-type checked. IDs,
-- notes, reasons and opaque metadata never enter the result. Actions with no
-- approved display parameter produces {} through the default branch.
-- ---------------------------------------------------------------------------
create or replace function app.activity_event_params(
  p_action   text,
  p_metadata jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when not (p_action = any(app.activity_event_types())) then '{}'::jsonb

    when p_action = 'rfq.submitted' then
      jsonb_strip_nulls(jsonb_build_object(
        'item_count', case when jsonb_typeof(p_metadata -> 'item_count') = 'number'
                           then p_metadata -> 'item_count' end))

    when p_action in ('quotation.submitted', 'quotation.accepted') then
      jsonb_strip_nulls(jsonb_build_object(
        'total', case when jsonb_typeof(p_metadata -> 'total') = 'number'
                      then p_metadata -> 'total' end))

    when p_action = 'order.created' then
      jsonb_strip_nulls(jsonb_build_object(
        'total', case when jsonb_typeof(p_metadata -> 'total') = 'number'
                      then p_metadata -> 'total' end))

    when p_action = 'lead.details_changed' then
      jsonb_strip_nulls(jsonb_build_object(
        'from_source', case when jsonb_typeof(p_metadata -> 'from_source') = 'string'
                            then p_metadata -> 'from_source' end,
        'to_source', case when jsonb_typeof(p_metadata -> 'to_source') = 'string'
                          then p_metadata -> 'to_source' end))

    when p_action = 'customer.created' then
      jsonb_strip_nulls(jsonb_build_object(
        'customer_type', case when jsonb_typeof(p_metadata -> 'customer_type') = 'string'
                              then p_metadata -> 'customer_type' end))

    when p_action = 'customer.updated' then
      jsonb_strip_nulls(jsonb_build_object(
        'archived', case when jsonb_typeof(p_metadata -> 'archived') = 'boolean'
                         then p_metadata -> 'archived' end))

    when p_action = 'followup.created' then
      jsonb_strip_nulls(jsonb_build_object(
        'due_at', case when jsonb_typeof(p_metadata -> 'due_at') = 'string'
                       then p_metadata -> 'due_at' end))

    when p_action = 'affiliation.approved' then
      jsonb_strip_nulls(jsonb_build_object(
        'relationship', case when jsonb_typeof(p_metadata -> 'relationship') = 'string'
                             then p_metadata -> 'relationship' end))

    when p_action = 'affiliation.cancelled' then
      jsonb_strip_nulls(jsonb_build_object(
        'by', case when jsonb_typeof(p_metadata -> 'by') = 'string'
                   then p_metadata -> 'by' end))

    when p_action = 'product.created' then
      jsonb_strip_nulls(jsonb_build_object(
        'category', case when jsonb_typeof(p_metadata -> 'category') = 'string'
                         then p_metadata -> 'category' end,
        'unit', case when jsonb_typeof(p_metadata -> 'unit') = 'string'
                     then p_metadata -> 'unit' end))

    else '{}'::jsonb
  end;
$$;

revoke all on function app.activity_event_params(text, jsonb)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Single audit writer: add the same-transaction safe projection
-- ---------------------------------------------------------------------------
create or replace function app.record_audit_event(
  p_action          text,
  p_subject_type    text,
  p_subject_id      uuid,
  p_organization_id uuid,
  p_metadata        jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role  public.platform_role;
  v_id    uuid;
begin
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'audit metadata must be a JSON object';
  end if;
  -- Highest platform role of the actor (null for ordinary users) — recorded, not trusted for authz.
  select g.role into v_role
  from public.platform_role_grants g
  where g.user_id = v_actor
  order by case g.role when 'administrator' then 1 when 'moderator' then 2 when 'support' then 3 end
  limit 1;

  insert into public.audit_log (actor_user_id, actor_role, action, subject_type, subject_id, organization_id, metadata)
  values (v_actor, v_role, p_action, p_subject_type, p_subject_id, p_organization_id, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;

  if p_organization_id is not null and p_action = any(app.activity_event_types()) then
    insert into public.organization_activity_events (
      organization_id, audit_log_id, actor_user_id, event_type,
      subject_type, subject_id, params)
    values (
      p_organization_id, v_id, v_actor, p_action,
      p_subject_type, p_subject_id, app.activity_event_params(p_action, p_metadata));
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Founder defaults: body reproduced from the latest definition; only the
--    activity.read array entry is new.
-- ---------------------------------------------------------------------------
create or replace function app.organization_create_owned(
  p_name        text,
  p_org_type    public.organization_type,
  p_locale      text,
  p_branch_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
$$;
revoke execute on function app.organization_create_owned(
  text, public.organization_type, text, text) from public;
grant execute on function app.organization_create_owned(
  text, public.organization_type, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Delegation allow-list: body reproduced from the latest definition; only
--    activity.read is added. The exact-key no-escalation rule remains intact.
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
      'analytics.view', 'export.data', 'activity.read'
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

revoke execute on function public.membership_set_capabilities(uuid, text[]) from public;
grant execute on function public.membership_set_capabilities(uuid, text[]) to authenticated;
