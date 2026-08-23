-- Migration: Notifications Core — MVP event emission wiring.
--
-- Authority: docs/database/notifications-core.md, "MVP event-to-recipient mapping".
-- Foundation: 20260822090001_notifications_core.sql (table, RLS, app.notify*).
--
-- Adds NO new call sites. Every RPC below already calls app.record_audit_event
-- from inside a security-definer transaction; this migration adds a second write
-- beside that existing one, in the same transaction. If the business transition
-- rolls back, its notification rolls back with it — the notify call is an
-- ordinary statement in the same transaction, not a deferred or background write,
-- and its failures propagate rather than being swallowed.
--
-- Each function below is reproduced verbatim from its current definition, with
-- ONLY the app.notify_org(...) emission added. Signatures, return contracts,
-- authorization checks, validation, error codes, state transitions, concurrency
-- guards and every existing app.record_audit_event call are unchanged.
--
-- Replaced here (13 functions, latest definition of each):
--   from 20260810090001_catalog_rfq_quotation.sql
--     submit_rfq, cancel_rfq, submit_quotation, decide_quotation
--   from 20260811090001_orders_projects.sql
--     create_order_from_quotation, start_order, cancel_order,
--     create_project_from_order, activate_project, complete_project
--   from 20260804090001_write_path_security_hardening.sql
--     review_approve, review_reject, review_request_changes
--
-- Recipient rule, without exception: the notice goes to the COUNTERPARTY — the
-- side that must act or be informed — never to the organization that acted.
-- app.notify additionally suppresses the individual actor, which matters when
-- one person holds memberships in both parties.
--
-- Translation keys follow one derived convention, since the specification fixes
-- the contract ("keys, not rendered text") rather than the literal strings:
--   title_key = 'notifications.<event_type>.title'
--   body_key  = 'notifications.<event_type>.body'
-- params carries only bounded, PII-minimised interpolation values. Free-text
-- fields (a rejection reason, a note) are deliberately NOT copied into params:
-- they live on the record the deep link points at.
--
-- Out of scope, unchanged: notification UI, Chat, Points, Realtime publication,
-- outbound delivery, preferences. No schema, RLS, grant or helper is modified.

-- ===========================================================================
-- 1. RFQ transitions — the supplier side is told there is demand to answer.
-- ===========================================================================
-- rfq.submitted -> rfqs.supplier_org_id / rfq.respond / /b2b/rfqs/{rfq_id}
create or replace function public.submit_rfq(
  p_rfq_id           uuid,
  p_expected_version integer
) returns integer language plpgsql security definer set search_path = '' as $fn$
declare v_r public.rfqs; v_count integer;
begin
  select * into v_r from public.rfqs where id = p_rfq_id for update;
  if not found then raise exception 'RFQ not found'; end if;
  if not app.can_create_rfq(v_r.requester_org_id) then
    raise exception 'rfq.create required' using errcode = '42501';
  end if;
  if v_r.status <> 'draft' then
    raise exception 'only a draft RFQ can be submitted' using errcode = '22023';
  end if;
  if v_r.version <> p_expected_version then
    raise exception 'RFQ was modified concurrently' using errcode = '40001';
  end if;
  select count(*) into v_count from public.rfq_items where rfq_id = p_rfq_id;
  if v_count = 0 then
    raise exception 'an RFQ needs at least one item before it can be submitted' using errcode = '22023';
  end if;
  update public.rfqs set status = 'submitted', submitted_at = now(), version = version + 1
  where id = p_rfq_id;
  perform app.record_audit_event('rfq.submitted', 'rfq', p_rfq_id, v_r.requester_org_id,
    jsonb_build_object('supplier_org_id', v_r.supplier_org_id, 'item_count', v_count));
  -- Notify the SUPPLIER side (the counterparty), which holds rfq.respond.
  perform app.notify_org(
    v_r.supplier_org_id, 'rfq.respond',
    'rfq.submitted', 'rfq', p_rfq_id,
    '/b2b/rfqs/' || p_rfq_id::text,
    'notifications.rfq.submitted.title', 'notifications.rfq.submitted.body',
    jsonb_build_object(
      'requester_name', app.org_display_name(v_r.requester_org_id),
      'item_count',     v_count));
  return v_r.version + 1;
end;
$fn$;

-- rfq.cancelled -> rfqs.supplier_org_id / rfq.respond / /b2b/rfqs/{rfq_id}
create or replace function public.cancel_rfq(p_rfq_id uuid)
returns void language plpgsql security definer set search_path = '' as $fn$
declare v_r public.rfqs;
begin
  select * into v_r from public.rfqs where id = p_rfq_id for update;
  if not found then raise exception 'RFQ not found'; end if;
  if not app.can_create_rfq(v_r.requester_org_id) then
    raise exception 'rfq.create required' using errcode = '42501';
  end if;
  if v_r.status in ('closed', 'cancelled') then
    raise exception 'this RFQ is already finalized' using errcode = '22023';
  end if;
  update public.quotations set status = 'rejected', decided_at = now(), decided_by = (select auth.uid()),
    version = version + 1
  where rfq_id = p_rfq_id and status in ('draft', 'submitted');
  update public.rfqs set status = 'cancelled', version = version + 1 where id = p_rfq_id;
  perform app.record_audit_event('rfq.cancelled', 'rfq', p_rfq_id, v_r.requester_org_id, '{}'::jsonb);
  -- Notify the SUPPLIER side: work they may have started is now moot.
  perform app.notify_org(
    v_r.supplier_org_id, 'rfq.respond',
    'rfq.cancelled', 'rfq', p_rfq_id,
    '/b2b/rfqs/' || p_rfq_id::text,
    'notifications.rfq.cancelled.title', 'notifications.rfq.cancelled.body',
    jsonb_build_object('requester_name', app.org_display_name(v_r.requester_org_id)));
end;
$fn$;

-- ===========================================================================
-- 2. Quotation transitions
-- ===========================================================================
-- quotation.submitted -> quotations.requester_org_id / quote.decide
create or replace function public.submit_quotation(
  p_quotation_id     uuid,
  p_expected_version integer
) returns integer language plpgsql security definer set search_path = '' as $fn$
declare v_q public.quotations; v_zero integer; v_total numeric;
begin
  select * into v_q from public.quotations where id = p_quotation_id for update;
  if not found then raise exception 'quotation not found'; end if;
  if not app.can_respond_rfq(v_q.supplier_org_id) then
    raise exception 'rfq.respond required' using errcode = '42501';
  end if;
  if v_q.status <> 'draft' then
    raise exception 'only a draft quotation can be submitted' using errcode = '22023';
  end if;
  if v_q.version <> p_expected_version then
    raise exception 'quotation was modified concurrently' using errcode = '40001';
  end if;
  perform app.recompute_quotation_totals(p_quotation_id);
  select subtotal into v_q.subtotal from public.quotations where id = p_quotation_id;
  if v_q.subtotal <= 0 then
    raise exception 'price every line before submitting the quotation' using errcode = '22023';
  end if;
  select count(*) into v_zero from public.quotation_items where quotation_id = p_quotation_id and unit_price <= 0;
  if v_zero > 0 then
    raise exception 'every line must have a price before the quotation can be submitted' using errcode = '22023';
  end if;
  update public.quotations set status = 'submitted', submitted_at = now(), version = version + 1
  where id = p_quotation_id;
  -- Reflect on the RFQ (only if still open — do not disturb a cancelled RFQ).
  update public.rfqs set status = 'quoted', version = version + 1
  where id = v_q.rfq_id and status in ('submitted', 'quoted');
  perform app.record_audit_event('quotation.submitted', 'quotation', p_quotation_id, v_q.supplier_org_id,
    jsonb_build_object('rfq_id', v_q.rfq_id, 'total', v_q.total));
  -- Notify the REQUESTER side (the counterparty), which holds quote.decide.
  -- The total is re-read post-recompute: a notice the buyer reads must not carry
  -- a pre-pricing figure. The audit metadata above is left exactly as it was.
  select total into v_total from public.quotations where id = p_quotation_id;
  perform app.notify_org(
    v_q.requester_org_id, 'quote.decide',
    'quotation.submitted', 'quotation', p_quotation_id,
    '/b2b/quotations/' || p_quotation_id::text,
    'notifications.quotation.submitted.title', 'notifications.quotation.submitted.body',
    jsonb_build_object(
      'supplier_name', app.org_display_name(v_q.supplier_org_id),
      'total',         v_total));
  return v_q.version + 1;
end;
$fn$;

-- quotation.accepted / quotation.rejected
--   -> quotations.supplier_org_id / quote.submit / /b2b/quotations/{quotation_id}
create or replace function public.decide_quotation(
  p_quotation_id     uuid,
  p_accept           boolean,
  p_expected_version integer
) returns integer language plpgsql security definer set search_path = '' as $fn$
declare v_q public.quotations;
begin
  select * into v_q from public.quotations where id = p_quotation_id for update;
  if not found then raise exception 'quotation not found'; end if;
  if not app.is_org_member(v_q.requester_org_id) then
    raise exception 'not a member of the requester organization' using errcode = '42501';
  end if;
  if not app.can_decide_quote(v_q.requester_org_id) then
    raise exception 'quote.decide required' using errcode = '42501';
  end if;
  if v_q.status <> 'submitted' then
    raise exception 'only a submitted quotation can be decided' using errcode = '22023';
  end if;
  if v_q.version <> p_expected_version then
    raise exception 'quotation was modified concurrently' using errcode = '40001';
  end if;
  update public.quotations set
    status = case when p_accept then 'accepted'::public.quotation_status else 'rejected'::public.quotation_status end,
    decided_at = now(), decided_by = (select auth.uid()), version = version + 1
  where id = p_quotation_id;
  if p_accept then
    -- READY FOR ORDER: close the RFQ (terminal). No order created (Sprint 10).
    update public.rfqs set status = 'closed', closed_at = now(), version = version + 1
    where id = v_q.rfq_id;
    perform app.record_audit_event('quotation.accepted', 'quotation', p_quotation_id, v_q.requester_org_id,
      jsonb_build_object('rfq_id', v_q.rfq_id, 'total', v_q.total));
    perform app.record_audit_event('rfq.closed', 'rfq', v_q.rfq_id, v_q.requester_org_id,
      jsonb_build_object('quotation_id', p_quotation_id));
    -- The decision travels back to the SUPPLIER side, which holds quote.submit.
    perform app.notify_org(
      v_q.supplier_org_id, 'quote.submit',
      'quotation.accepted', 'quotation', p_quotation_id,
      '/b2b/quotations/' || p_quotation_id::text,
      'notifications.quotation.accepted.title', 'notifications.quotation.accepted.body',
      jsonb_build_object(
        'requester_name', app.org_display_name(v_q.requester_org_id),
        'total',          v_q.total));
  else
    -- Reopen the RFQ for revision (supplier may create a fresh quotation).
    update public.rfqs set status = 'quoted', version = version + 1
    where id = v_q.rfq_id and status not in ('closed', 'cancelled');
    perform app.record_audit_event('quotation.rejected', 'quotation', p_quotation_id, v_q.requester_org_id,
      jsonb_build_object('rfq_id', v_q.rfq_id));
    perform app.notify_org(
      v_q.supplier_org_id, 'quote.submit',
      'quotation.rejected', 'quotation', p_quotation_id,
      '/b2b/quotations/' || p_quotation_id::text,
      'notifications.quotation.rejected.title', 'notifications.quotation.rejected.body',
      jsonb_build_object('requester_name', app.org_display_name(v_q.requester_org_id)));
  end if;
  return v_q.version + 1;
end;
$fn$;

-- ===========================================================================
-- 3. Order transitions
-- ===========================================================================
-- order.created -> orders.supplier_org_id / order.manage / /b2b/orders/{order_id}
create or replace function public.create_order_from_quotation(p_quotation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare v_q public.quotations; v_r public.rfqs; v_id uuid;
begin
  select * into v_q from public.quotations where id = p_quotation_id for update;
  if not found then raise exception 'quotation not found'; end if;
  -- Only the requester (buyer) commits an accepted quotation into an order.
  if not app.is_org_member(v_q.requester_org_id) then
    raise exception 'not a member of the requester organization' using errcode = '42501';
  end if;
  if not app.can_create_order(v_q.requester_org_id) then
    raise exception 'order.create required' using errcode = '42501';
  end if;
  if v_q.status <> 'accepted' then
    raise exception 'an order can only be created from an accepted quotation' using errcode = '22023';
  end if;
  if exists (select 1 from public.orders where quotation_id = p_quotation_id) then
    raise exception 'an order already exists for this quotation' using errcode = '23505';
  end if;
  select * into v_r from public.rfqs where id = v_q.rfq_id;
  insert into public.orders (
    quotation_id, rfq_id, requester_org_id, supplier_org_id, requester_branch_id,
    title, note, subtotal, total, created_by)
  values (
    p_quotation_id, v_q.rfq_id, v_q.requester_org_id, v_q.supplier_org_id, v_r.requester_branch_id,
    v_r.title, v_q.note, v_q.subtotal, v_q.total, (select auth.uid()))
  returning id into v_id;
  -- Freeze the priced lines from the quotation.
  insert into public.order_items (order_id, product_name, unit, quantity, unit_price)
  select v_id, qi.product_name, qi.unit, qi.quantity, qi.unit_price
  from public.quotation_items qi where qi.quotation_id = p_quotation_id;
  perform app.record_audit_event('order.created', 'order', v_id, v_q.requester_org_id,
    jsonb_build_object('quotation_id', p_quotation_id, 'supplier_org_id', v_q.supplier_org_id, 'total', v_q.total));
  -- The buyer committed; the SUPPLIER side has work to accept and manage.
  perform app.notify_org(
    v_q.supplier_org_id, 'order.manage',
    'order.created', 'order', v_id,
    '/b2b/orders/' || v_id::text,
    'notifications.order.created.title', 'notifications.order.created.body',
    jsonb_build_object(
      'requester_name', app.org_display_name(v_q.requester_org_id),
      'total',          v_q.total));
  return v_id;
end;
$fn$;

-- order.started -> orders.requester_org_id / order.create / /b2b/orders/{order_id}
create or replace function public.start_order(
  p_order_id         uuid,
  p_expected_version integer
) returns integer language plpgsql security definer set search_path = '' as $fn$
declare v_o public.orders;
begin
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if not app.is_org_member(v_o.supplier_org_id) then
    raise exception 'not a member of the supplier organization' using errcode = '42501';
  end if;
  if not app.can_manage_order(v_o.supplier_org_id) then
    raise exception 'order.manage required' using errcode = '42501';
  end if;
  if v_o.status <> 'confirmed' then
    raise exception 'only a confirmed order can be started' using errcode = '22023';
  end if;
  if v_o.version <> p_expected_version then
    raise exception 'order was modified concurrently' using errcode = '40001';
  end if;
  update public.orders set status = 'in_progress', started_at = now(), version = version + 1
  where id = p_order_id;
  perform app.record_audit_event('order.started', 'order', p_order_id, v_o.supplier_org_id, '{}'::jsonb);
  -- The supplier started work; the REQUESTER side (buyer) is informed.
  perform app.notify_org(
    v_o.requester_org_id, 'order.create',
    'order.started', 'order', p_order_id,
    '/b2b/orders/' || p_order_id::text,
    'notifications.order.started.title', 'notifications.order.started.body',
    jsonb_build_object('supplier_name', app.org_display_name(v_o.supplier_org_id)));
  return v_o.version + 1;
end;
$fn$;

-- order.cancelled -> the COUNTERPARTY OF THE ACTOR / order.manage
-- Either party may cancel, so the recipient is resolved dynamically: whichever
-- side the actor is NOT. v_actor_org is already established above as part of the
-- authorization check, so the routing decision reuses a proven fact rather than
-- probing membership a second time.
create or replace function public.cancel_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $fn$
declare v_o public.orders; v_actor_org uuid; v_counterparty_org uuid;
begin
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  -- The caller must be a manager on EITHER party org.
  if app.is_org_member(v_o.requester_org_id) and app.can_manage_order(v_o.requester_org_id) then
    v_actor_org := v_o.requester_org_id;
  elsif app.is_org_member(v_o.supplier_org_id) and app.can_manage_order(v_o.supplier_org_id) then
    v_actor_org := v_o.supplier_org_id;
  else
    raise exception 'order.manage required' using errcode = '42501';
  end if;
  if v_o.status <> 'confirmed' then
    raise exception 'only a confirmed order can be cancelled' using errcode = '22023';
  end if;
  update public.orders set status = 'cancelled', cancelled_at = now(), version = version + 1
  where id = p_order_id;
  perform app.record_audit_event('order.cancelled', 'order', p_order_id, v_actor_org, '{}'::jsonb);
  -- The side that did NOT cancel is the side that needs to know.
  v_counterparty_org := case
    when v_actor_org = v_o.requester_org_id then v_o.supplier_org_id
    else v_o.requester_org_id
  end;
  perform app.notify_org(
    v_counterparty_org, 'order.manage',
    'order.cancelled', 'order', p_order_id,
    '/b2b/orders/' || p_order_id::text,
    'notifications.order.cancelled.title', 'notifications.order.cancelled.body',
    jsonb_build_object('actor_name', app.org_display_name(v_actor_org)));
end;
$fn$;

-- ===========================================================================
-- 4. Project transitions — the executing (supplier) org acts, the requester
--    (buyer) org is informed. project.write on the requester side commonly has
--    no holder, in which case app.notify_org's approved owner fallback delivers
--    to the org.manage holder rather than dropping the notice.
-- ===========================================================================
-- project.created -> projects.requester_org_id / project.write / /b2b/projects/{id}
create or replace function public.create_project_from_order(
  p_order_id    uuid,
  p_title       text,
  p_location    text default null,
  p_description text default null,
  p_start_date  date default null,
  p_target_date date default null
) returns uuid language plpgsql security definer set search_path = '' as $fn$
declare v_o public.orders; v_id uuid;
begin
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  -- The executing (supplier) org runs the project.
  if not app.is_org_member(v_o.supplier_org_id) then
    raise exception 'not a member of the executing organization' using errcode = '42501';
  end if;
  if not app.can_write_project(v_o.supplier_org_id) then
    raise exception 'project.write required' using errcode = '42501';
  end if;
  if v_o.status <> 'in_progress' then
    raise exception 'only an in-progress order can start a project' using errcode = '22023';
  end if;
  if exists (select 1 from public.projects where order_id = p_order_id) then
    raise exception 'a project already exists for this order' using errcode = '23505';
  end if;
  insert into public.projects (
    order_id, requester_org_id, executing_org_id, branch_id,
    title, location, description, start_date, target_date, created_by)
  values (
    p_order_id, v_o.requester_org_id, v_o.supplier_org_id, v_o.requester_branch_id,
    coalesce(nullif(btrim(p_title), ''), v_o.title), p_location, p_description,
    p_start_date, p_target_date, (select auth.uid()))
  returning id into v_id;
  perform app.record_audit_event('project.created', 'project', v_id, v_o.supplier_org_id,
    jsonb_build_object('order_id', p_order_id, 'requester_org_id', v_o.requester_org_id));
  perform app.notify_org(
    v_o.requester_org_id, 'project.write',
    'project.created', 'project', v_id,
    '/b2b/projects/' || v_id::text,
    'notifications.project.created.title', 'notifications.project.created.body',
    jsonb_build_object('executing_name', app.org_display_name(v_o.supplier_org_id)));
  return v_id;
end;
$fn$;

-- project.activated -> projects.requester_org_id / project.write / /b2b/projects/{id}
create or replace function public.activate_project(
  p_project_id       uuid,
  p_expected_version integer
) returns integer language plpgsql security definer set search_path = '' as $fn$
declare v_p public.projects;
begin
  select * into v_p from public.projects where id = p_project_id for update;
  if not found then raise exception 'project not found'; end if;
  if not app.can_write_project(v_p.executing_org_id) then
    raise exception 'project.write required' using errcode = '42501';
  end if;
  if v_p.status <> 'planned' then
    raise exception 'only a planned project can be activated' using errcode = '22023';
  end if;
  if v_p.version <> p_expected_version then
    raise exception 'project was modified concurrently' using errcode = '40001';
  end if;
  update public.projects set status = 'active', activated_at = now(), version = version + 1
  where id = p_project_id;
  perform app.record_audit_event('project.activated', 'project', p_project_id, v_p.executing_org_id, '{}'::jsonb);
  perform app.notify_org(
    v_p.requester_org_id, 'project.write',
    'project.activated', 'project', p_project_id,
    '/b2b/projects/' || p_project_id::text,
    'notifications.project.activated.title', 'notifications.project.activated.body',
    jsonb_build_object('executing_name', app.org_display_name(v_p.executing_org_id)));
  return v_p.version + 1;
end;
$fn$;

-- project.completed AND order.completed both originate here. There is no
-- complete_order RPC: execution is delivered THROUGH the project, so completing
-- the project completes its parent order in the same transaction. Both notices
-- go to the requester side, mirroring the two audit events already emitted, and
-- each points at its own subject with its own deep link.
create or replace function public.complete_project(
  p_project_id       uuid,
  p_expected_version integer
) returns integer language plpgsql security definer set search_path = '' as $fn$
declare v_p public.projects;
begin
  select * into v_p from public.projects where id = p_project_id for update;
  if not found then raise exception 'project not found'; end if;
  if not app.can_write_project(v_p.executing_org_id) then
    raise exception 'project.write required' using errcode = '42501';
  end if;
  if v_p.status <> 'active' then
    raise exception 'only an active project can be completed' using errcode = '22023';
  end if;
  if v_p.version <> p_expected_version then
    raise exception 'project was modified concurrently' using errcode = '40001';
  end if;
  update public.projects set status = 'completed', completed_at = now(), version = version + 1
  where id = p_project_id;
  -- Complete the parent order too (only if still in progress).
  update public.orders set status = 'completed', completed_at = now(), version = version + 1
  where id = v_p.order_id and status = 'in_progress';
  perform app.record_audit_event('project.completed', 'project', p_project_id, v_p.executing_org_id,
    jsonb_build_object('order_id', v_p.order_id));
  perform app.record_audit_event('order.completed', 'order', v_p.order_id, v_p.executing_org_id,
    jsonb_build_object('project_id', p_project_id));
  -- project.completed -> requester side / project.write
  perform app.notify_org(
    v_p.requester_org_id, 'project.write',
    'project.completed', 'project', p_project_id,
    '/b2b/projects/' || p_project_id::text,
    'notifications.project.completed.title', 'notifications.project.completed.body',
    jsonb_build_object('executing_name', app.org_display_name(v_p.executing_org_id)));
  -- order.completed -> requester side / order.create, pointing at the ORDER.
  perform app.notify_org(
    v_p.requester_org_id, 'order.create',
    'order.completed', 'order', v_p.order_id,
    '/b2b/orders/' || v_p.order_id::text,
    'notifications.order.completed.title', 'notifications.order.completed.body',
    jsonb_build_object('executing_name', app.org_display_name(v_p.executing_org_id)));
  return v_p.version + 1;
end;
$fn$;

-- ===========================================================================
-- 5. Organization verification decisions
--    The actor is a PLATFORM reviewer, never a member of the organization under
--    review (the RPCs enforce that above). The notice therefore addresses the
--    organization being verified, via org.manage.
--    verifications may carry organization_id OR user_id; the personal-
--    verification case is deferred with the rest of the B2C surface, so emission
--    is guarded on organization_id being present.
--    The free-text reason is deliberately NOT copied into params (PII-minimised);
--    it remains on the verification record the deep link points at, and in audit.
-- ===========================================================================
-- verification.changes_requested -> verifications.organization_id / org.manage / /b2b/organization
create or replace function public.review_request_changes(p_verification_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_v public.verifications;
begin
  if not app.is_platform('support') then
    raise exception 'platform reviewer authority required' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 or length(btrim(p_reason)) > 2000 then
    raise exception 'a reason of 1 to 2000 characters is required when requesting changes'
      using errcode = '22023';
  end if;
  select * into v_v from public.verifications where id = p_verification_id for update;
  if not found then raise exception 'verification not found'; end if;
  if v_v.user_id = v_uid
     or (v_v.organization_id is not null and app.is_org_member(v_v.organization_id)) then
    raise exception 'a reviewer may not review their own verification' using errcode = '42501';
  end if;
  if v_v.status <> 'under_review' then
    raise exception 'invalid transition to needs_more_info from %', v_v.status using errcode = '22023';
  end if;
  if v_v.reviewer_id is distinct from v_uid then
    raise exception 'only the assigned reviewer may request changes' using errcode = '42501';
  end if;
  update public.verifications
    set status = 'needs_more_info', reason = btrim(p_reason)
    where id = p_verification_id;
  perform app.record_audit_event('verification.changes_requested', 'verification', p_verification_id,
    v_v.organization_id, jsonb_build_object('reason', btrim(p_reason)));
  if v_v.organization_id is not null then
    perform app.notify_org(
      v_v.organization_id, 'org.manage',
      'verification.changes_requested', 'verification', p_verification_id,
      '/b2b/organization',
      'notifications.verification.changes_requested.title',
      'notifications.verification.changes_requested.body',
      '{}'::jsonb);
  end if;
end;
$fn$;

-- verification.rejected -> verifications.organization_id / org.manage / /b2b/organization
create or replace function public.review_reject(p_verification_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_v public.verifications;
begin
  if not app.is_platform('support') then
    raise exception 'platform reviewer authority required' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 or length(btrim(p_reason)) > 2000 then
    raise exception 'a reason of 1 to 2000 characters is required when rejecting'
      using errcode = '22023';
  end if;
  select * into v_v from public.verifications where id = p_verification_id for update;
  if not found then raise exception 'verification not found'; end if;
  if v_v.user_id = v_uid
     or (v_v.organization_id is not null and app.is_org_member(v_v.organization_id)) then
    raise exception 'a reviewer may not decide their own verification' using errcode = '42501';
  end if;
  if v_v.status = 'rejected' then
    if v_v.reviewer_id is distinct from v_uid then
      raise exception 'only the assigned reviewer may confirm rejection' using errcode = '42501';
    end if;
    return;
  end if;
  if v_v.status <> 'under_review' then
    raise exception 'invalid transition to rejected from %', v_v.status using errcode = '22023';
  end if;
  if v_v.reviewer_id is distinct from v_uid then
    raise exception 'only the assigned reviewer may reject' using errcode = '42501';
  end if;
  update public.verifications
    set status = 'rejected', reason = btrim(p_reason), decided_at = now()
    where id = p_verification_id;
  perform app.record_audit_event('verification.rejected', 'verification', p_verification_id,
    v_v.organization_id, jsonb_build_object('reason', btrim(p_reason)));
  if v_v.organization_id is not null then
    perform app.notify_org(
      v_v.organization_id, 'org.manage',
      'verification.rejected', 'verification', p_verification_id,
      '/b2b/organization',
      'notifications.verification.rejected.title', 'notifications.verification.rejected.body',
      '{}'::jsonb);
  end if;
end;
$fn$;

-- verification.approved -> verifications.organization_id / org.manage / /b2b/organization
create or replace function public.review_approve(
  p_verification_id uuid,
  p_grant_public_listing boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_v public.verifications;
begin
  if not app.is_platform('support') then
    raise exception 'platform reviewer authority required' using errcode = '42501';
  end if;
  select * into v_v from public.verifications where id = p_verification_id for update;
  if not found then raise exception 'verification not found'; end if;
  if v_v.user_id = v_uid
     or (v_v.organization_id is not null and app.is_org_member(v_v.organization_id)) then
    raise exception 'a reviewer may not approve their own verification' using errcode = '42501';
  end if;
  if v_v.status = 'approved' then
    if v_v.reviewer_id is distinct from v_uid then
      raise exception 'only the assigned reviewer may confirm approval' using errcode = '42501';
    end if;
    return;
  end if;
  if v_v.status <> 'under_review' then
    raise exception 'invalid transition to approved from %', v_v.status using errcode = '22023';
  end if;
  if v_v.reviewer_id is distinct from v_uid then
    raise exception 'only the assigned reviewer may approve' using errcode = '42501';
  end if;
  update public.verifications
    set status = 'approved', decided_at = now(),
        grants_public_listing = coalesce(p_grant_public_listing, false)
    where id = p_verification_id;
  perform app.record_audit_event('verification.approved', 'verification', p_verification_id,
    v_v.organization_id, jsonb_build_object('grants_public_listing', coalesce(p_grant_public_listing, false)));
  if v_v.organization_id is not null then
    perform app.notify_org(
      v_v.organization_id, 'org.manage',
      'verification.approved', 'verification', p_verification_id,
      '/b2b/organization',
      'notifications.verification.approved.title', 'notifications.verification.approved.body',
      '{}'::jsonb);
  end if;
end;
$fn$;
