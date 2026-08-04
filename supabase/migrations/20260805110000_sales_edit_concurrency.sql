-- =============================================================================
-- Sprint 5.1 — edit-path optimistic concurrency + explicit optional-field
-- clearing for the customer/follow-up trusted write RPCs.
--
-- Findings addressed:
--  * update_customer had NO stale-write detection (a row lock serializes writes
--    but does not detect that the caller edited stale data). Customers have no
--    `version` column but a trigger-maintained `updated_at`, so we require an
--    OPTIONAL `p_expected_updated_at` precondition (Option B).
--  * update_follow_up only checked status='open'; two concurrent edits to the
--    same open follow-up could overwrite each other. follow_up_tasks already has
--    `version`, so we require an OPTIONAL `p_expected_version` precondition.
--  * reassign_follow_up had no concurrency guard; add the same optional version
--    precondition so a stale reassignment can't clobber a newer edit.
--  * `coalesce(p_x, x)` made it impossible to CLEAR an optional field: a blank
--    submission left the old value. Add explicit `p_clear_*` flags so the caller
--    can set a field to NULL (the correct domain value — e.g. primary_phone feeds
--    the generated primary_phone_e164, where '' is not a valid empty value).
--
-- Concurrency mismatch → SQLSTATE 40001 (the project's standardized concurrency
-- error, matching the lead transitions), raised BEFORE any UPDATE or audit, so no
-- partial write and no audit row occur on conflict. The preconditions are
-- OPTIONAL (null → skip) so idempotent/legacy callers (archive, seeded tests)
-- keep working; the edit UI always sends the precondition.
--
-- Forward-only. Drops and recreates the three functions (adding trailing
-- defaulted parameters), then re-applies the deny-by-default execute grants.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. update_customer — expected-updated_at precondition + explicit clearing
-- ---------------------------------------------------------------------------
drop function if exists public.update_customer(uuid, text, text, text, text, text, public.sales_source, boolean);

create function public.update_customer(
  p_customer_id         uuid,
  p_expected_updated_at timestamptz default null,
  p_display_name        text default null,
  p_primary_phone       text default null,
  p_email               text default null,
  p_preferred_language  text default null,
  p_location_summary    text default null,
  p_source              public.sales_source default null,
  p_archive             boolean default null,
  p_clear_phone         boolean default false,
  p_clear_email         boolean default false,
  p_clear_location      boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_c public.customers; v_caller_mem uuid;
begin
  select * into v_c from public.customers where id = p_customer_id for update;
  if not found then raise exception 'customer not found'; end if;
  if not (app.has_capability(v_c.organization_id, 'sales.write') or app.can_manage_sales(v_c.organization_id)) then
    raise exception 'sales.write required' using errcode = '42501';
  end if;
  v_caller_mem := app.active_membership_id(v_c.organization_id);
  if not (app.can_manage_sales(v_c.organization_id)
          or (v_c.assigned_membership_id is not null and v_c.assigned_membership_id = v_caller_mem)
          or (v_c.branch_id is not null and v_c.branch_id in (select app.current_branch_ids(v_c.organization_id)))) then
    raise exception 'customer not in caller scope' using errcode = '42501';
  end if;

  -- Optimistic concurrency: reject a stale edit (checked under the row lock, so
  -- a competing transaction has already committed its new updated_at by now).
  if p_expected_updated_at is not null and v_c.updated_at <> p_expected_updated_at then
    raise exception 'customer was modified concurrently (stale update rejected)' using errcode = '40001';
  end if;

  update public.customers set
    display_name       = coalesce(p_display_name, display_name),
    primary_phone      = case when p_clear_phone then null else coalesce(p_primary_phone, primary_phone) end,
    email              = case when p_clear_email then null else coalesce(p_email, email) end,
    preferred_language = coalesce(p_preferred_language, preferred_language),
    location_summary   = case when p_clear_location then null else coalesce(p_location_summary, location_summary) end,
    source             = coalesce(p_source, source),
    status             = case when p_archive is true then 'archived'::public.customer_status
                              when p_archive is false then 'active'::public.customer_status
                              else status end,
    archived_at        = case when p_archive is true then now()
                              when p_archive is false then null
                              else archived_at end
  where id = p_customer_id;

  perform app.record_audit_event('customer.updated', 'customer', p_customer_id, v_c.organization_id,
    jsonb_build_object('archived', p_archive));
exception when unique_violation then
  raise exception 'a customer with this phone already exists in this organization'
    using errcode = '23505';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. update_follow_up — expected-version precondition + clear description
-- ---------------------------------------------------------------------------
drop function if exists public.update_follow_up(uuid, text, text, timestamptz, public.sales_priority, boolean);

create function public.update_follow_up(
  p_follow_up_id      uuid,
  p_expected_version  integer default null,
  p_title             text default null,
  p_description       text default null,
  p_due_at            timestamptz default null,
  p_priority          public.sales_priority default null,
  p_clear_due         boolean default false,
  p_clear_description boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_t public.follow_up_tasks;
begin
  select * into v_t from public.follow_up_tasks where id = p_follow_up_id for update;
  if not found then raise exception 'follow-up not found'; end if;
  if not (app.has_capability(v_t.organization_id, 'sales.write') or app.can_manage_sales(v_t.organization_id)) then
    raise exception 'sales.write required' using errcode = '42501';
  end if;
  if not app.can_act_on_follow_up(v_t) then
    raise exception 'follow-up not in caller scope' using errcode = '42501';
  end if;
  if v_t.status <> 'open' then
    raise exception 'only an open follow-up can be edited' using errcode = '22023';
  end if;
  if p_expected_version is not null and v_t.version <> p_expected_version then
    raise exception 'follow-up was modified concurrently (stale update rejected)' using errcode = '40001';
  end if;

  update public.follow_up_tasks set
    title       = coalesce(p_title, title),
    description = case when p_clear_description then null else coalesce(p_description, description) end,
    priority    = coalesce(p_priority, priority),
    due_at      = case when p_clear_due then null else coalesce(p_due_at, due_at) end,
    version     = version + 1
  where id = p_follow_up_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. reassign_follow_up — optional expected-version precondition
-- ---------------------------------------------------------------------------
drop function if exists public.reassign_follow_up(uuid, uuid);

create function public.reassign_follow_up(
  p_follow_up_id           uuid,
  p_assignee_membership_id uuid,
  p_expected_version       integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_t public.follow_up_tasks;
begin
  select * into v_t from public.follow_up_tasks where id = p_follow_up_id for update;
  if not found then raise exception 'follow-up not found'; end if;
  if not (app.has_capability(v_t.organization_id, 'sales.assign') or app.can_manage_sales(v_t.organization_id)) then
    raise exception 'sales.assign required' using errcode = '42501';
  end if;
  if not (app.can_manage_sales(v_t.organization_id)
          or (v_t.branch_id is not null and v_t.branch_id in (select app.current_branch_ids(v_t.organization_id)))) then
    raise exception 'follow-up not in caller scope' using errcode = '42501';
  end if;
  if v_t.status <> 'open' then
    raise exception 'only an open follow-up can be reassigned' using errcode = '22023';
  end if;
  if p_expected_version is not null and v_t.version <> p_expected_version then
    raise exception 'follow-up was modified concurrently (stale update rejected)' using errcode = '40001';
  end if;
  if not app.membership_can_access_branch(p_assignee_membership_id, v_t.branch_id) then
    raise exception 'assignee cannot access this branch' using errcode = '22023';
  end if;
  update public.follow_up_tasks set assigned_membership_id = p_assignee_membership_id, version = version + 1
  where id = p_follow_up_id;
  perform app.record_audit_event('followup.reassigned', 'follow_up', p_follow_up_id, v_t.organization_id,
    jsonb_build_object('from', v_t.assigned_membership_id, 'to', p_assignee_membership_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Deny-by-default execute grants for the new signatures.
-- ---------------------------------------------------------------------------
revoke execute on function public.update_customer(uuid, timestamptz, text, text, text, text, text, public.sales_source, boolean, boolean, boolean, boolean) from public;
revoke execute on function public.update_follow_up(uuid, integer, text, text, timestamptz, public.sales_priority, boolean, boolean) from public;
revoke execute on function public.reassign_follow_up(uuid, uuid, integer) from public;

grant execute on function public.update_customer(uuid, timestamptz, text, text, text, text, text, public.sales_source, boolean, boolean, boolean, boolean) to authenticated;
grant execute on function public.update_follow_up(uuid, integer, text, text, timestamptz, public.sales_priority, boolean, boolean) to authenticated;
grant execute on function public.reassign_follow_up(uuid, uuid, integer) to authenticated;
