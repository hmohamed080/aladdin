-- Forward-fix "marketplace-clarity": restore what 20261128090001_marketplace_test_round_clarity.sql and 20261128120001_marketplace_waybill_after_refund.sql changed.
-- NOT a down migration and NOT applied anywhere. Use only with the owner's explicit approval, on a hosted database, through the Supabase migration path
-- as a NEW migration (never the SQL Editor), and only if the two migrations must be undone. Roll the frontend back first.
--
-- Restores the 17 replaced functions to their previous definitions (pg_get_functiondef read on the scratch pre-state; same signatures, so grants are unchanged)
-- and the 3 CHECK constraints, drops the 2 new internal helpers, and deletes the 3 seeded notification templates.
-- NOT undone, because it is data: address lines and invoices written in the new format stay as they are.
-- SAFETY: RAISES (nothing is changed) once a row uses one of the new values or a new template was edited. Idempotent. Generated and proved by
-- scripts/hosted-db/marketplace-clarity-scratch-proof.mjs.
begin;

do $guard$
declare
  n bigint;
  v_new_events constant text[] := array['marketplace.return.shipped', 'marketplace.return.complaint_filed', 'marketplace.return.refund_confirm_reminder'];
begin
  select count(*) into n from public.marketplace_timers where kind = 'return_refund_confirm';
  if n <> 0 then raise exception 'marketplace-clarity forward-fix refused: % refund confirmation timer(s) exist', n; end if;
  select count(*) into n from public.marketplace_return_requests where escalated_reason = 'refund_unconfirmed';
  if n <> 0 then raise exception 'marketplace-clarity forward-fix refused: % return(s) are escalated as an unconfirmed refund', n; end if;
  select count(*) into n from public.notifications where event_type = any (v_new_events);
  if n <> 0 then raise exception 'marketplace-clarity forward-fix refused: % notification(s) of the new kinds were written', n; end if;
  select count(*) into n from public.notification_templates where event_type = any (v_new_events) and (version > 1 or updated_by is not null);
  if n <> 0 then raise exception 'marketplace-clarity forward-fix refused: % new notification template(s) were edited', n; end if;
end
$guard$;

-- app.marketplace_order_invoice_issue(uuid,text)
CREATE OR REPLACE FUNCTION app.marketplace_order_invoice_issue(p_order uuid, p_actor_role text)
 RETURNS public.marketplace_order_invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o public.marketplace_orders;
  v_inv public.marketplace_order_invoices;
begin
  select * into o from public.marketplace_orders where id = p_order for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  select * into v_inv from public.marketplace_order_invoices where order_id = o.id;
  if found then
    return v_inv;
  end if;
  if o.status not in ('ready', 'ready_for_pickup', 'shipped', 'delivered', 'delivery_failed', 'returned') then
    raise exception 'mp:invoice_not_available' using errcode = '23514';
  end if;
  insert into public.marketplace_order_invoices (order_id, seller_snapshot, buyer_snapshot, lines,
    subtotal_egp, delivery_fee_egp, total_egp, paid_now_egp, balance_due_egp, payment_method)
  values (
    o.id,
    jsonb_build_object(
      'name', (select org.name from public.organizations org where org.id = o.seller_organization_id),
      'address', (select coalesce(b.address_ar, b.address_en) from public.marketplace_stock_locations sl
                    join public.branches b on b.id = sl.branch_id
                   where sl.organization_id = o.seller_organization_id and sl.is_active
                   order by (sl.key = 'main') desc, sl.created_at limit 1)),
    jsonb_build_object('name', o.buyer_name, 'address', o.address_text),
    coalesce((select jsonb_agg(jsonb_build_object('sku', i.sku, 'name_ar', i.name_ar, 'name_en', i.name_en,
        'quantity', i.quantity, 'unit_price_egp', i.unit_price_egp, 'line_total_egp', i.line_total_egp) order by i.created_at, i.sku)
      from public.marketplace_order_items i where i.order_id = o.id), '[]'::jsonb),
    o.subtotal_egp, o.delivery_fee_egp, o.total_egp, o.paid_now_egp, o.balance_due_egp, o.payment_method)
  returning * into v_inv;
  insert into public.marketplace_order_events (order_id, action, from_status, to_status, from_payment, to_payment,
    actor_user_id, actor_role, note, payload)
  values (o.id, 'invoice_issued', o.status, o.status, o.payment_status, o.payment_status,
    (select auth.uid()), p_actor_role, null, jsonb_build_object('invoice_number', v_inv.invoice_number));
  return v_inv;
end;
$function$;

-- app.marketplace_order_notify(uuid,text,jsonb)
CREATE OR REPLACE FUNCTION app.marketplace_order_notify(p_order uuid, p_event text, p_vars jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o public.marketplace_orders;
  v_key text := 'marketplace.order.' || p_event;
  v_vars jsonb;
  v_ar jsonb;
  v_en jsonb;
begin
  -- an event without a template yet (timers and complaints belong to PR 14) is skipped, never an error
  if not exists (select 1 from public.notification_templates t where t.key = v_key) then
    return;
  end if;
  select * into o from public.marketplace_orders where id = p_order;
  v_vars := jsonb_build_object('order_number', o.order_number,
    'showroom_name', (select org.name from public.organizations org where org.id = o.seller_organization_id),
    'delivery_date', case when o.delivery_estimate_earliest is null then ''
                          when o.delivery_estimate_earliest = o.delivery_estimate_latest then to_char(o.delivery_estimate_latest, 'YYYY-MM-DD')
                          else to_char(o.delivery_estimate_earliest, 'YYYY-MM-DD') || ' - ' || to_char(o.delivery_estimate_latest, 'YYYY-MM-DD') end,
    'buyer_name', o.buyer_name,
    'tracking_number', coalesce((select sh.tracking_number from public.marketplace_order_shipments sh where sh.order_id = o.id), ''),
    'hours_left', case p_event when 'receipt_disputed' then '48' else '' end);
  v_ar := jsonb_build_object('message', coalesce(p_vars ->> 'message_ar', ''),
                             'total', trim(to_char(o.total_egp, 'FM999,999,990.00')) || ' ج.م');
  v_en := jsonb_build_object('message', coalesce(p_vars ->> 'message_en', ''),
                             'total', trim(to_char(o.total_egp, 'FM999,999,990.00')) || ' EGP');
  if p_event in ('placed', 'cancelled_by_buyer', 'receipt_resubmitted', 'reminder_seller_start') then
    perform app.marketplace_notify_order_managers(o.id, v_key, v_vars, v_ar, v_en);
  else
    perform app.notify_from_template(o.buyer_user_id, null, v_key, 'marketplace_order', o.id, '/market/orders/' || o.id, v_vars, v_ar, v_en);
  end if;
end;
$function$;

-- app.marketplace_return_actions(uuid,text)
CREATE OR REPLACE FUNCTION app.marketplace_return_actions(p_return uuid, p_for text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.marketplace_return_requests;
  v_refund public.marketplace_order_refunds;
  v_out text[] := '{}';
  v_complain boolean;
begin
  select * into r from public.marketplace_return_requests where id = p_return;
  if not found then
    return v_out;
  end if;
  select * into v_refund from public.marketplace_order_refunds where return_id = r.id;
  v_complain := not r.in_admin_queue and r.status in ('rejected', 'approved', 'in_transit', 'received');
  if p_for = 'buyer' then
    if r.status = 'requested' then v_out := array_append(v_out, 'cancel'); end if;
    if r.status = 'approved' then v_out := array_append(v_out, 'mark_shipped'); end if;
    if v_refund.state = 'sent' then v_out := array_append(v_out, 'confirm_refund'); end if;
    if v_complain then v_out := array_append(v_out, 'file_complaint'); end if;
  elsif p_for = 'seller' then
    if r.status = 'requested' then
      v_out := v_out || array['approve', 'reject'];
      if r.remedy = 'refund' then v_out := array_append(v_out, 'propose_partial'); end if;
    elsif r.status in ('approved', 'in_transit') then v_out := array_append(v_out, 'receive');
    elsif r.status = 'received' and r.remedy = 'refund' and v_refund.id is null then v_out := array_append(v_out, 'record_refund');
    elsif r.status = 'received' and r.remedy = 'exchange' then v_out := array_append(v_out, 'fulfil_exchange');
    end if;
    if v_complain then v_out := array_append(v_out, 'file_complaint'); end if;
  elsif p_for = 'admin' and r.in_admin_queue then
    if r.status in ('requested', 'approved', 'in_transit', 'received') then v_out := array_append(v_out, 'remind_seller'); end if;
    if r.status in ('requested', 'rejected')
       or (r.status = 'approved' and r.partial_refund_egp is not null and r.escalated_reason = 'complaint') then
      v_out := v_out || array['approve', 'reject'];
    end if;
  end if;
  return v_out;
end;
$function$;

-- app.marketplace_return_decide(uuid,text,text,uuid,text,text,numeric,text)
CREATE OR REPLACE FUNCTION app.marketplace_return_decide(p_return uuid, p_decision text, p_role text, p_preset uuid, p_message_ar text, p_message_en text, p_partial numeric, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.marketplace_return_requests;
  v_reason jsonb;
  v_to text;
  v_ar text;
  v_en text;
  v_partial_appeal boolean;
begin
  select * into r from public.marketplace_return_requests where id = p_return for update;
  if p_decision not in ('approve', 'reject', 'propose_partial') then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  -- a complaint about a partial proposal: "approve" grants the full value, "reject" upholds the proposed amount
  v_partial_appeal := p_role = 'admin' and r.status = 'approved' and r.partial_refund_egp is not null and r.in_admin_queue
    and r.escalated_reason = 'complaint';
  v_to := case when p_decision = 'reject' and not v_partial_appeal then 'rejected' else 'approved' end;
  -- replay: the same decision already took effect
  if r.status = v_to and r.decided_by_role = p_role and (p_decision <> 'propose_partial' or r.partial_refund_egp = p_partial) then
    return;
  end if;
  if not (r.status = 'requested' or (p_role = 'admin' and r.status = 'rejected') or v_partial_appeal) then
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  if p_decision = 'propose_partial' then
    if r.remedy <> 'refund' or p_partial is null or p_partial <= 0 or p_partial >= app.marketplace_return_value(r.id) then
      raise exception 'mp:invalid_payload' using errcode = '22023';
    end if;
  end if;
  -- reason: required for a rejection; optional message for an approval
  v_reason := app.marketplace_order_reason(jsonb_build_object('preset_id', p_preset, 'message_ar', p_message_ar, 'message_en', p_message_en),
    'return_reject', p_decision = 'reject' and p_role = 'seller');
  v_ar := v_reason ->> 'message_ar';
  v_en := v_reason ->> 'message_en';
  if p_role = 'admin' then
    if p_note is null or char_length(btrim(p_note)) not between 3 and 500 then
      raise exception 'mp:reason_required' using errcode = '22023';
    end if;
    -- the admin note is INTERNAL: never copied into the public message, the event log or a notification
    v_ar := coalesce(v_ar, 'قرار من فريق المنصة');
    v_en := coalesce(v_en, 'Decision by the platform team');
  end if;
  update public.marketplace_return_requests set status = v_to, decided_by_role = p_role, decision_message_ar = v_ar,
    decision_message_en = v_en, decision_internal_note = left(nullif(btrim(p_note), ''), 500),
    partial_refund_egp = case when p_decision = 'propose_partial' then p_partial
                              when v_partial_appeal and p_decision = 'reject' then r.partial_refund_egp else null end,
    in_admin_queue = false
   where id = r.id;
  perform app.marketplace_timer_close('return', r.id, 'return_seller_response', 'decided_by_' || p_role);
  perform app.marketplace_return_event(r.id, v_to, r.status, v_to, p_role,
    v_en);
  perform app.marketplace_return_notify(r.id, case when p_role = 'admin' then 'admin_decided' when p_decision = 'reject' then 'rejected' else 'approved' end,
    'buyer', v_ar, v_en);
  if p_role = 'admin' then
    perform app.marketplace_return_notify(r.id, 'admin_decided', 'sellers', v_ar, v_en);
  end if;
end;
$function$;

-- app.marketplace_return_doc(uuid,text)
CREATE OR REPLACE FUNCTION app.marketplace_return_doc(p_return uuid, p_for text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.marketplace_return_requests;
  o public.marketplace_orders;
  v_refund public.marketplace_order_refunds;
  v_seller boolean := p_for in ('seller', 'admin');
  v_evidence boolean;
begin
  select * into r from public.marketplace_return_requests where id = p_return;
  if not found then
    return null;
  end if;
  select * into o from public.marketplace_orders where id = r.order_id;
  select * into v_refund from public.marketplace_order_refunds where return_id = r.id;
  v_evidence := p_for <> 'admin' or r.in_admin_queue;
  return jsonb_build_object(
    'id', r.id, 'request_number', r.request_number, 'order_id', r.order_id, 'order_number', o.order_number,
    'kind', r.kind, 'claim_type', r.claim_type, 'status', r.status, 'remedy', r.remedy, 'viewer', p_for,
    'payment_method', o.payment_method,
    'seller', jsonb_build_object('name', (select org.name from public.organizations org where org.id = r.seller_organization_id)),
    'buyer', case when v_seller then jsonb_build_object('name', o.buyer_name) end,
    'reason', jsonb_build_object('label_ar', r.reason_label_ar, 'label_en', r.reason_label_en, 'transit_damage', r.transit_damage),
    'buyer_note', r.buyer_note,
    'partial_refund_egp', r.partial_refund_egp,
    'max_refund_egp', app.marketplace_return_refund_cap(r.id),
    'return_shipping_payer', r.return_shipping_payer, 'return_tracking', r.return_tracking,
    'in_admin_queue', r.in_admin_queue, 'escalated_reason', r.escalated_reason,
    'decision', case when r.decided_by_role is not null then jsonb_build_object('by', r.decided_by_role,
      'message_ar', r.decision_message_ar, 'message_en', r.decision_message_en,
      'internal_note', case when p_for = 'admin' or (p_for = 'seller' and r.decided_by_role = 'seller') then r.decision_internal_note end) end,
    'timestamps', jsonb_build_object('created_at', r.created_at, 'seller_due_at', r.seller_due_at, 'shipped_at', r.shipped_at,
      'received_at', r.received_at, 'refund_due_at', r.refund_due_at, 'closed_at', r.closed_at, 'escalated_at', r.escalated_at),
    'items', coalesce((select jsonb_agg(jsonb_build_object('item_id', i.id, 'name_ar', i.name_ar, 'name_en', i.name_en, 'sku', i.sku,
        'variant_label', i.variant_label, 'image_id', i.image_id, 'quantity', ri.quantity, 'unit_price_egp', i.unit_price_egp,
        'line_total_egp', i.unit_price_egp * ri.quantity, 'sellable', ri.sellable) order by i.created_at, i.sku)
      from public.marketplace_return_items ri join public.marketplace_order_items i on i.id = ri.order_item_id
      where ri.return_id = r.id), '[]'::jsonb),
    'refund', case when v_refund.id is not null then jsonb_build_object('amount_egp', v_refund.amount_egp, 'method', v_refund.method,
      'state', v_refund.state, 'sent_at', v_refund.sent_at, 'confirmed_at', v_refund.confirmed_at,
      'reference_note', v_refund.reference_note) end,
    'evidence', case when v_evidence then coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'object_key', e.object_key,
        'created_at', e.created_at) order by e.created_at)
      from public.marketplace_return_evidence e where e.return_id = r.id and e.upload_state = 'confirmed'), '[]'::jsonb) else '[]'::jsonb end,
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'action', e.action, 'to_status', e.to_status,
        'actor_role', e.actor_role, 'note', e.note, 'at', e.created_at) order by e.sequence)
      from public.marketplace_return_events e where e.return_id = r.id), '[]'::jsonb),
    'actions', to_jsonb(app.marketplace_return_actions(r.id, p_for)));
end;
$function$;

-- app.marketplace_return_timer_tick(public.marketplace_timers,timestamp with time zone)
CREATE OR REPLACE FUNCTION app.marketplace_return_timer_tick(p_timer public.marketplace_timers, p_now timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.marketplace_return_requests;
  v_expired boolean := p_now >= p_timer.expires_at;
  v_hours integer := greatest(ceil(extract(epoch from (p_timer.expires_at - p_now)) / 3600)::integer, 0);
begin
  select * into r from public.marketplace_return_requests where id = p_timer.subject_id;
  if not found then
    return 'noop';
  end if;
  if p_timer.kind = 'return_seller_response' then
    if r.status <> 'requested' then
      return 'noop';
    end if;
    if v_expired then
      perform app.marketplace_return_escalate(r.id, 'seller_silent', 'system');
      return 'escalated';
    end if;
    perform app.marketplace_return_notify(r.id, 'seller_reminder', 'sellers', null, null, v_hours);
    return 'reminded';
  elsif p_timer.kind = 'return_refund_due' then
    if r.status <> 'received' or r.remedy <> 'refund' or exists (select 1 from public.marketplace_order_refunds f where f.return_id = r.id) then
      return 'noop';
    end if;
    perform app.marketplace_return_notify(r.id, 'seller_reminder', 'sellers', null, null, v_hours);
    if v_expired then
      perform app.marketplace_return_escalate(r.id, 'seller_silent', 'system');
      return 'escalated';
    end if;
    return 'reminded';
  end if;
  return 'noop';
end;
$function$;

-- app.marketplace_timer_handle(public.marketplace_timers,timestamp with time zone)
CREATE OR REPLACE FUNCTION app.marketplace_timer_handle(p_timer public.marketplace_timers, p_now timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o         public.marketplace_orders;
  v_expired boolean := p_timer.expires_at <= p_now;
  v_hours_left integer := greatest(ceil(extract(epoch from (p_timer.expires_at - p_now)) / 3600)::integer, 0);
  v_hours_waiting integer := floor(extract(epoch from (p_now - p_timer.started_at)) / 3600)::integer;
  v_active  boolean;
  v_action  text;
  v_event   text;
  v_name    text;
begin
  if p_timer.kind in ('return_seller_response', 'return_refund_due') then
    perform app.marketplace_return_timer_tick(p_timer, p_now);
    return 'noop';
  end if;

  select * into o from public.marketplace_orders where id = p_timer.subject_id for update skip locked;
  if not found then
    if exists (select 1 from public.marketplace_orders x where x.id = p_timer.subject_id) then
      return 'skipped';                       -- locked by a concurrent action: next run
    end if;
    update public.marketplace_timers set state = 'cancelled', closed_at = p_now, closed_by_action = 'order_missing', next_remind_at = null
     where id = p_timer.id and state = 'active';
    return 'closed';
  end if;

  if p_timer.kind = 'order_seller_start' then
    v_active := o.source = 'v2' and o.status = 'new';
    v_action := 'cancel_timeout_seller';
    v_event  := 'reminder_seller_start';
  elsif p_timer.kind = 'order_receipt_resubmit' then
    v_active := o.source = 'v2' and o.status in ('preparing', 'ready') and o.payment_status = 'receipt_disputed';
    v_action := 'cancel_timeout_receipt';
    v_event  := 'reminder_receipt_resubmit';
  else
    return 'noop';
  end if;

  -- the order moved on (started, cancelled, payment settled): nothing to do but close the timer
  if not v_active then
    update public.marketplace_timers set state = 'done', closed_at = p_now, closed_by_action = 'order_moved', next_remind_at = null
     where id = p_timer.id and state = 'active';
    return 'closed';
  end if;

  -- A payment complaint under review pauses the buyer's receipt clock: the buyer must not lose the order while an admin is still
  -- deciding. Nothing is sent and nothing expires; when the complaint is decided the normal rules resume (contract 4.4: a
  -- `payment_not_received` decision does not restart the 48 h, so a timer already past its deadline expires at the next run).
  -- ASSUMED pending owner confirmation (the contract does not say the clock pauses).
  if p_timer.kind = 'order_receipt_resubmit' and exists (
       select 1 from public.marketplace_payment_complaints c where c.order_id = o.id and c.state in ('open', 'under_review')) then
    return 'skipped';
  end if;

  select org.name into v_name from public.organizations org where org.id = o.seller_organization_id;

  if v_expired then
    update public.marketplace_timers set state = 'expired', closed_at = p_now, closed_by_action = 'expire', next_remind_at = null
     where id = p_timer.id and state = 'active';
    begin
      perform app.marketplace_order_apply(o.id, v_action, 'system', null, '{}'::jsonb);
    exception when others then
      if sqlerrm <> 'mp:invalid_transition' then raise; end if;
      -- moved between our check and the call: the machine refused, so no stock moved and nothing was sent
      update public.marketplace_timers set state = 'done', closed_by_action = 'order_moved' where id = p_timer.id;
      return 'closed';
    end;
    -- the buyer is notified by the machine (event cancelled_timeout_*); the showroom side is notified here
    perform app.marketplace_notify_order_managers(o.id, 'marketplace.order.cancelled_timeout_' ||
      case p_timer.kind when 'order_seller_start' then 'seller' else 'receipt' end,
      jsonb_build_object('order_number', o.order_number, 'showroom_name', v_name), null, null);
    return 'cancelled';
  end if;

  -- reminder (one per run)
  if p_timer.kind = 'order_seller_start' then
    perform app.marketplace_notify_order_managers(o.id, 'marketplace.order.reminder_seller_start',
      jsonb_build_object('order_number', o.order_number, 'showroom_name', v_name,
                         'hours_waiting', v_hours_waiting, 'hours_left', v_hours_left), null, null);
  else
    perform app.notify_from_template(o.buyer_user_id, null, 'marketplace.order.reminder_receipt_resubmit', 'marketplace_order', o.id,
      '/market/orders/' || o.id::text,
      jsonb_build_object('order_number', o.order_number, 'showroom_name', v_name, 'hours_left', v_hours_left));
  end if;
  insert into public.marketplace_order_events (order_id, action, from_status, to_status, from_payment, to_payment, actor_role, payload)
  values (o.id, v_event, o.status, o.status, o.payment_status, o.payment_status, 'system',
          jsonb_build_object('reminder_number', p_timer.reminders_sent + 1, 'hours_left', v_hours_left));
  update public.marketplace_timers
     set reminders_sent = reminders_sent + 1, next_remind_at = app.marketplace_timer_next_remind(p_timer, p_now)
   where id = p_timer.id and state = 'active';
  return 'reminded';
end;
$function$;

-- app.marketplace_timer_open(text,uuid,text,timestamp with time zone)
CREATE OR REPLACE FUNCTION app.marketplace_timer_open(p_subject_type text, p_subject_id uuid, p_kind text, p_started timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_exp interval;
  v_every interval;
  v_offsets interval[];
begin
  select case p_kind when 'order_seller_start' then interval '72 hours' when 'order_receipt_resubmit' then interval '48 hours'
                     when 'return_seller_response' then interval '72 hours' when 'return_refund_due' then interval '7 days' end,
         case p_kind when 'order_seller_start' then interval '6 hours' end,
         case p_kind when 'order_receipt_resubmit' then array[interval '24 hours']
                     when 'return_seller_response' then array[interval '24 hours', interval '48 hours']
                     when 'return_refund_due' then array[interval '5 days'] end
    into v_exp, v_every, v_offsets;
  if v_exp is null then
    raise exception 'unknown timer kind' using errcode = '22023';
  end if;
  insert into public.marketplace_timers (subject_type, subject_id, kind, started_at, expires_at, remind_every, remind_offsets, next_remind_at)
  values (p_subject_type, p_subject_id, p_kind, p_started, p_started + v_exp, v_every, v_offsets,
          case when v_every is not null then p_started + v_every when v_offsets is not null then p_started + v_offsets[1] end)
  on conflict (subject_type, subject_id, kind) where state = 'active' do nothing
  returning id into v_id;
  if v_id is null then
    select t.id into v_id from public.marketplace_timers t
     where t.subject_type = p_subject_type and t.subject_id = p_subject_id and t.kind = p_kind and t.state = 'active';
  end if;
  return v_id;
end;
$function$;

-- app.marketplace_variant_label(uuid)
CREATE OR REPLACE FUNCTION app.marketplace_variant_label(p_variant uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'ar', coalesce(string_agg(case when vv.option_id is not null then o.name_ar when vv.value_number is not null then vv.value_number::text
                                   when vv.value_boolean is not null then null else vv.value_text end, ' / ' order by d.key), ''),
    'en', coalesce(string_agg(case when vv.option_id is not null then o.name_en when vv.value_number is not null then vv.value_number::text
                                   when vv.value_boolean is not null then null else vv.value_text end, ' / ' order by d.key), ''))
  from public.marketplace_variant_attribute_values vv
  join public.marketplace_attribute_definitions d on d.id = vv.attribute_id and d.is_active
  left join public.marketplace_attribute_options o on o.id = vv.option_id
  where vv.variant_id = p_variant;
$function$;

-- public.marketplace_buyer_refund_confirm(uuid)
CREATE OR REPLACE FUNCTION public.marketplace_buyer_refund_confirm(p_return_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.marketplace_return_requests;
  f public.marketplace_order_refunds;
  o public.marketplace_orders;
begin
  select * into r from public.marketplace_return_requests where id = p_return_id and buyer_user_id = (select auth.uid()) for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  select * into f from public.marketplace_order_refunds where return_id = r.id for update;
  if not found then
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  if f.state = 'confirmed' then
    return app.marketplace_return_doc(r.id, 'buyer');
  end if;
  if f.state <> 'sent' or r.status <> 'received' then
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  select * into o from public.marketplace_orders where id = r.order_id for update;
  update public.marketplace_order_refunds set state = 'confirmed', confirmed_by = (select auth.uid()), confirmed_at = now() where id = f.id;
  update public.marketplace_return_requests set status = 'refunded', closed_at = now(), in_admin_queue = false where id = r.id;
  perform app.marketplace_timer_close('return', r.id, 'return_refund_due', 'refund_confirmed');
  perform app.marketplace_return_event(r.id, 'refund_confirmed', r.status, 'refunded', 'buyer', null);
  if o.payment_status in ('collected', 'receipt_accepted', 'refund_due') then
    perform app.marketplace_return_order_payment(o.id,
      case when (select coalesce(sum(x.amount_egp), 0) from public.marketplace_order_refunds x
                  where x.order_id = o.id and x.state = 'confirmed')
                >= (select coalesce(sum(i.line_total_egp), 0) from public.marketplace_order_items i where i.order_id = o.id)
           then 'refunded' else 'collected' end);
  end if;
  perform app.marketplace_order_event(o.id, 'return_closed', o.status, o.status, o.payment_status,
    (select m.payment_status from public.marketplace_orders m where m.id = o.id), 'buyer', r.request_number);
  perform app.marketplace_return_notify(r.id, 'refund_confirmed', 'sellers');
  return app.marketplace_return_doc(r.id, 'buyer');
end;
$function$;

-- public.marketplace_buyer_return_mark_shipped(uuid,text)
CREATE OR REPLACE FUNCTION public.marketplace_buyer_return_mark_shipped(p_return_id uuid, p_tracking text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.marketplace_return_requests;
  v_track text := nullif(btrim(p_tracking), '');
begin
  select * into r from public.marketplace_return_requests where id = p_return_id and buyer_user_id = (select auth.uid()) for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  if r.status = 'in_transit' then
    return app.marketplace_return_doc(r.id, 'buyer');
  end if;
  if r.status <> 'approved' then
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  if v_track is not null and v_track !~ '^[A-Za-z0-9._/-]{3,64}$' then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  update public.marketplace_return_requests set status = 'in_transit', return_tracking = v_track, shipped_at = now() where id = r.id;
  perform app.marketplace_return_event(r.id, 'shipped', r.status, 'in_transit', 'buyer', v_track);
  return app.marketplace_return_doc(r.id, 'buyer');
end;
$function$;

-- public.marketplace_checkout_confirm(uuid,text,text,text)
CREATE OR REPLACE FUNCTION public.marketplace_checkout_confirm(p_session_id uuid, p_quote_hash text, p_idempotency_key text, p_buyer_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid     uuid := (select auth.uid());
  s         public.marketplace_checkout_sessions;
  o         public.marketplace_orders;
  q         jsonb;
  v_missing jsonb;
  v_code    text;
  v_note    text := nullif(btrim(p_buyer_note), '');
  a         public.marketplace_buyer_addresses;
  st        public.marketplace_seller_payment_settings;
  v_checkout uuid := gen_random_uuid();
  v_method  text;
  ln        jsonb;
  ql        jsonb;
  v_loc     uuid;
  v_text    text;
  v_snapshot jsonb;
  v_estimate jsonb;
  v_pay_now numeric(14,2);
  v_deposit_pct integer;
begin
  if v_uid is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  if not app.account_is_active(v_uid) then
    raise exception 'mp:account_inactive' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 128 or p_quote_hash is null
     or (v_note is not null and char_length(v_note) > 500) then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  select * into s from public.marketplace_checkout_sessions where id = p_session_id and buyer_user_id = v_uid for update;
  if not found then
    raise exception 'mp:session_not_found' using errcode = '42501';
  end if;
  if s.state = 'confirmed' then
    return (select jsonb_build_object('checkout_id', s.confirmed_checkout_id, 'replayed', true,
      'orders', coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'order_number', x.order_number, 'status', x.status,
        'total_egp', x.total_egp, 'paid_now_egp', x.paid_now_egp, 'payment_method', x.payment_method,
        'estimate', jsonb_build_object('earliest', to_char(x.delivery_estimate_earliest, 'YYYY-MM-DD'),
                                       'latest', to_char(x.delivery_estimate_latest, 'YYYY-MM-DD'))) order by x.order_number), '[]'::jsonb))
      from public.marketplace_orders x where x.checkout_session_id = s.id);
  end if;
  if exists (select 1 from public.marketplace_checkout_sessions z where z.buyer_user_id = v_uid and z.idempotency_key = p_idempotency_key and z.id <> s.id) then
    raise exception 'mp:idempotency_conflict' using errcode = '23505';
  end if;
  if s.state <> 'open' or s.expires_at < now() then
    raise exception 'mp:session_expired' using errcode = '23514';
  end if;
  if not app.marketplace_is_open() then
    raise exception 'mp:marketplace_closed' using errcode = '23514';
  end if;

  q := app.marketplace_checkout_quote(v_uid, s.lines, s.fulfilment, s.address_id, s.delivery_speed, s.payment_method);
  v_missing := q -> '_internal' -> 'missing';
  if (q ->> 'receipt_required')::boolean and not exists (select 1 from public.marketplace_payment_proofs pr
      where pr.checkout_session_id = s.id and pr.order_id is null and pr.upload_state = 'confirmed' and pr.status <> 'superseded') then
    v_missing := v_missing || '["receipt_required"]'::jsonb;
  end if;
  if jsonb_array_length(v_missing) > 0 then
    v_code := v_missing ->> 0;
    if v_code = 'insufficient_stock' then
      raise exception 'mp:insufficient_stock:%', (select l ->> 'sku' from jsonb_array_elements(q -> 'lines') l where l ->> 'status' = 'insufficient_stock' limit 1)
        using errcode = '23514';
    end if;
    raise exception 'mp:%', v_code using errcode = '23514';
  end if;
  if app.marketplace_checkout_quote_hash(q) <> p_quote_hash then
    raise exception 'mp:quote_changed' using errcode = '23514', detail = (q - '_internal')::text;
  end if;

  v_method := s.payment_method;
  select * into st from public.marketplace_seller_payment_settings where seller_organization_id = s.seller_organization_id;
  v_pay_now := (q -> 'payment' ->> 'pay_now_egp')::numeric;
  v_deposit_pct := case when v_method = 'instapay_deposit' then st.instapay_deposit_percent end;
  v_estimate := q -> 'delivery' -> 'estimate';
  if s.fulfilment = 'delivery' then
    select * into a from public.marketplace_buyer_addresses where id = s.address_id and user_id = v_uid;
    v_text := left(coalesce(nullif(concat_ws(' - ', a.street, a.building, a.floor, a.apartment, a.landmark, a.district), ''),
                            a.area_key || ', ' || a.governorate_key), 300);
    v_snapshot := jsonb_build_object('kind', a.kind, 'nickname', a.nickname, 'district', a.district, 'street', a.street,
      'building', a.building, 'floor', a.floor, 'apartment', a.apartment, 'landmark', a.landmark,
      'latitude', a.latitude, 'longitude', a.longitude, 'location_source', a.location_source);
  end if;

  insert into public.marketplace_orders
    (checkout_id, idempotency_key, buyer_user_id, seller_organization_id, status, payment_method, payment_status, fulfilment,
     governorate_key, area_key, address_text, buyer_name, buyer_phone, buyer_note, subtotal_egp, delivery_fee_egp, total_egp,
     deposit_percent, deposit_egp, instapay_address, instapay_account_name,
     checkout_session_id, address_id, address_snapshot, latitude, longitude, delivery_speed,
     delivery_estimate_earliest, delivery_estimate_latest, placed_at, paid_now_egp, balance_due_egp, stock_state, source)
  values
    (v_checkout, p_idempotency_key, v_uid, s.seller_organization_id, 'new', v_method,
     case v_method when 'cod' then 'pending' else 'receipt_submitted' end, s.fulfilment,
     case when s.fulfilment = 'delivery' then a.governorate_key end, case when s.fulfilment = 'delivery' then a.area_key end,
     case when s.fulfilment = 'delivery' then v_text end, q -> '_internal' ->> 'recipient_name', q -> '_internal' ->> 'recipient_phone', v_note,
     (q ->> 'subtotal_egp')::numeric, (q ->> 'delivery_fee_egp')::numeric, (q ->> 'total_egp')::numeric,
     v_deposit_pct, case when v_method = 'instapay_deposit' then v_pay_now end,
     case when v_method <> 'cod' then st.instapay_address end, case when v_method <> 'cod' then st.instapay_account_name end,
     s.id, a.id, v_snapshot, a.latitude, a.longitude, s.delivery_speed,
     nullif(v_estimate ->> 'earliest', '')::date, nullif(v_estimate ->> 'latest', '')::date, now(), v_pay_now,
     (q ->> 'total_egp')::numeric - v_pay_now, 'pending', 'v2')
  returning * into o;

  -- lock order: variants sorted, then the level rows (FOR UPDATE: a concurrent buyer of the last unit waits, then finds none)
  for ln in select x from jsonb_array_elements(q -> '_internal' -> 'lines') x order by x ->> 'variant_id' loop
    v_loc := null;
    select lv.location_id into v_loc
      from public.marketplace_inventory_levels lv
      join public.marketplace_stock_locations sl on sl.id = lv.location_id and sl.is_active
     where lv.variant_id = (ln ->> 'variant_id')::uuid and lv.available >= (ln ->> 'qty')::int
     order by (sl.key = 'main') desc, lv.available desc, lv.location_id
     limit 1
       for update of lv;
    if v_loc is null then
      raise exception 'mp:insufficient_stock:%', ln ->> 'sku' using errcode = '23514';
    end if;
    select l into ql from jsonb_array_elements(q -> 'lines') l where l ->> 'sku' = ln ->> 'sku' and l ->> 'slug' = ln ->> 'slug';
    insert into public.marketplace_order_items
      (order_id, product_id, variant_id, location_id, sku, name_ar, name_en, selling_unit, unit_price_egp, quantity,
       product_slug, variant_label, image_id, non_returnable, free_shipping)
    values (o.id, (ln ->> 'product_id')::uuid, (ln ->> 'variant_id')::uuid, v_loc, ln ->> 'sku', ql ->> 'name_ar', ql ->> 'name_en',
            ql ->> 'selling_unit', (ql ->> 'unit_price_egp')::numeric, (ln ->> 'qty')::int,
            ln ->> 'slug', ql -> 'variant_label', nullif(ql ->> 'image_id', '')::uuid, (ql ->> 'non_returnable')::boolean,
            (ql ->> 'free_shipping')::boolean);
  end loop;
  begin
    perform app.marketplace_order_stock(o.id, 'reserve');
  exception when sqlstate '23514' then
    raise exception 'mp:insufficient_stock' using errcode = '23514';
  end;
  perform app.marketplace_order_stock_alert(o.id);

  if v_method <> 'cod' then
    update public.marketplace_payment_proofs set order_id = o.id
     where checkout_session_id = s.id and order_id is null and upload_state = 'confirmed' and status = 'submitted';
    -- receipts that were removed or never finished are left to the central cleanup
  else
    update public.marketplace_payment_proofs set upload_state = 'deleting'
     where checkout_session_id = s.id and order_id is null and upload_state in ('awaiting_upload', 'confirmed');
  end if;

  insert into public.marketplace_order_events (order_id, action, from_status, to_status, from_payment, to_payment, actor_user_id, actor_role, payload)
  values (o.id, 'placed', null, o.status, null, o.payment_status, v_uid, 'buyer',
          jsonb_build_object('payment_method', v_method, 'fulfilment', s.fulfilment, 'delivery_speed', s.delivery_speed));
  perform app.marketplace_timer_open('order', o.id, 'order_seller_start', o.placed_at);
  perform app.marketplace_order_notify(o.id, 'placed');

  delete from public.marketplace_cart_items c
   where c.user_id = v_uid and c.variant_id in (select i.variant_id from public.marketplace_order_items i where i.order_id = o.id);
  update public.marketplace_checkout_sessions set state = 'confirmed', idempotency_key = p_idempotency_key,
    confirmed_checkout_id = v_checkout where id = s.id;

  return jsonb_build_object('checkout_id', v_checkout, 'replayed', false, 'orders', jsonb_build_array(jsonb_build_object(
    'id', o.id, 'order_number', o.order_number, 'status', o.status, 'total_egp', o.total_egp, 'paid_now_egp', o.paid_now_egp,
    'payment_method', o.payment_method, 'estimate', jsonb_build_object('earliest', to_char(o.delivery_estimate_earliest, 'YYYY-MM-DD'),
                                                                      'latest', to_char(o.delivery_estimate_latest, 'YYYY-MM-DD')))));
end;
$function$;

-- public.marketplace_order_reason_presets(text)
CREATE OR REPLACE FUNCTION public.marketplace_order_reason_presets(p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (select auth.uid()) is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('order_cancel_seller', 'order_cancel_buyer', 'payment_issue') then
    raise exception 'mp:invalid_action' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'label_ar', p.label_ar, 'label_en', p.label_en,
           'text_ar', p.text_ar, 'text_en', p.text_en) order by p.sort_order, p.created_at)
         from public.marketplace_seller_message_presets p where p.action = p_action and p.is_active), '[]'::jsonb);
end;
$function$;

-- public.marketplace_order_waybill_get(uuid)
CREATE OR REPLACE FUNCTION public.marketplace_order_waybill_get(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o public.marketplace_orders;
begin
  if (select auth.uid()) is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  select * into o from public.marketplace_orders where id = p_order_id;
  if not found or not app.marketplace_can_manage_orders(o.seller_organization_id) then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  if o.fulfilment <> 'delivery' then
    raise exception 'mp:not_a_delivery_order' using errcode = '23514';
  end if;
  if o.status in ('cancelled', 'returned') then
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  return jsonb_build_object(
    'order_number', o.order_number,
    'recipient', jsonb_build_object('name', o.buyer_name, 'phone', o.buyer_phone),
    'address_text', o.address_text, 'governorate_key', o.governorate_key, 'area_key', o.area_key,
    'latitude', o.latitude, 'longitude', o.longitude,
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(nullif(i.name_ar, ''), i.name_en), 'sku', i.sku,
        'quantity', i.quantity) order by i.created_at, i.sku)
      from public.marketplace_order_items i where i.order_id = o.id), '[]'::jsonb),
    'payment', jsonb_build_object('method', o.payment_method,
      'collect_on_delivery_egp', case when o.payment_status = 'collected' then 0 else greatest(coalesce(o.balance_due_egp, 0), 0) end),
    'tracking_number', (select sh.tracking_number from public.marketplace_order_shipments sh where sh.order_id = o.id),
    'notes', o.buyer_note);
end;
$function$;

-- public.marketplace_public_cart(jsonb,text,text)
CREATE OR REPLACE FUNCTION public.marketplace_public_cart(p_lines jsonb, p_governorate text DEFAULT NULL::text, p_area text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_media boolean := app.marketplace_media_verification_ready();
  v_gov   text := nullif(btrim(lower(p_governorate)), '');
  v_area  text := nullif(btrim(lower(p_area)), '');
  v_result jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'mp:invalid_lines' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 50 then
    raise exception 'mp:too_many_lines' using errcode = '22023';
  end if;
  if (v_gov is not null and v_gov !~ '^[a-z0-9][a-z0-9-]{0,63}$') or (v_area is not null and v_area !~ '^[a-z0-9][a-z0-9-]{0,63}$') then
    raise exception 'mp:invalid_location' using errcode = '22023';
  end if;

  with resolved as (
    select t.ord::int as ord, req.slug, req.sku, p.id as product_id, pv.id as variant_id, p.seller_organization_id as seller_id
    from jsonb_array_elements(p_lines) with ordinality as t(x, ord)
    cross join lateral (select btrim(t.x ->> 'slug') as slug, btrim(t.x ->> 'sku') as sku) req
    left join public.marketplace_products p
      on req.slug ~ '^[a-z0-9-]{1,120}$' and p.slug = req.slug and p.status = 'published'
     and app.marketplace_seller_is_public(p.seller_organization_id)
     and exists (select 1 from public.marketplace_product_types pt
                 join public.marketplace_categories pc on pc.id = pt.category_id
                 where pt.id = p.product_type_id and pt.is_active and pc.is_active)
    left join public.marketplace_product_variants pv
      on pv.product_id = p.id and req.sku ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$' and pv.sku = req.sku and pv.status = 'active'
  ), sellers as (
    select r.seller_id, row_number() over (order by min(r.ord))::int as idx
    from resolved r where r.variant_id is not null group by r.seller_id
  )
  select jsonb_build_object(
    'lines', coalesce((
      select jsonb_agg(
        case when r.variant_id is null
          then jsonb_build_object('slug', r.slug, 'sku', r.sku, 'status', 'unavailable')
          else jsonb_build_object(
            'slug', r.slug, 'sku', r.sku, 'status', 'ok',
            'name_ar', p.name_ar, 'name_en', p.name_en, 'brand', p.brand,
            'selling_unit', pv.selling_unit, 'price_egp', pv.price_egp,
            -- availability is capped: the cart needs "how many may I buy", not the showroom's stock
            'available', least(app.marketplace_variant_available(pv.id), 9999),
            'seller', s.idx,
            'image_id', case when v_media then app.marketplace_product_cover_image(p.id) end,
            'attributes', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'key', d.key, 'name_ar', d.name_ar, 'name_en', d.name_en, 'data_type', vv.data_type, 'unit_kind', d.unit_kind,
                       'unit_ar', d.display_unit_ar, 'unit_en', d.display_unit_en,
                       'value', case
                         when vv.option_id is not null then jsonb_build_object('key', o.key, 'name_ar', o.name_ar, 'name_en', o.name_en, 'swatch_hex', o.swatch_hex)
                         when vv.value_number is not null then to_jsonb(vv.value_number)
                         when vv.value_boolean is not null then to_jsonb(vv.value_boolean)
                         else to_jsonb(vv.value_text) end)
                     order by d.key)
              from public.marketplace_variant_attribute_values vv
              join public.marketplace_attribute_definitions d on d.id = vv.attribute_id and d.is_active
              left join public.marketplace_attribute_options o on o.id = vv.option_id
              where vv.variant_id = pv.id), '[]'::jsonb))
        end order by r.ord)
      from resolved r
      left join public.marketplace_products p on p.id = r.product_id
      left join public.marketplace_product_variants pv on pv.id = r.variant_id
      left join sellers s on s.seller_id = r.seller_id and r.variant_id is not null), '[]'::jsonb),
    'sellers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'index', s.idx,
               'name', o.name,
               'pickup_available', exists (select 1 from public.marketplace_stock_locations l
                                           where l.organization_id = s.seller_id and l.is_active and l.supports_pickup),
               'payment_methods', jsonb_build_object(
                 'cod', coalesce(ps.cod_enabled, false),
                 'instapay', case when coalesce(ps.instapay_enabled, false)
                   then jsonb_build_object('deposit_percent', ps.instapay_deposit_percent) end),
               'delivery', case
                 when v_gov is null then jsonb_build_object('status', 'needs_area')
                 else coalesce((
                   select jsonb_build_object('status', 'available', 'fee_egp', dr.fee_egp)
                   from public.marketplace_delivery_rates dr
                   where dr.seller_organization_id = s.seller_id and dr.governorate_key = v_gov and dr.fee_egp is not null
                     and (dr.area_key = v_area or dr.area_key is null)
                   order by (dr.area_key is null)
                   limit 1), jsonb_build_object('status', 'not_available'))
               end) order by s.idx)
      from sellers s join public.organizations o on o.id = s.seller_id
      left join public.marketplace_seller_payment_settings ps on ps.seller_organization_id = s.seller_id), '[]'::jsonb))
  into v_result;
  return v_result;
end;
$function$;

-- public.marketplace_return_complaint_file(uuid,text)
CREATE OR REPLACE FUNCTION public.marketplace_return_complaint_file(p_return_id uuid, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.marketplace_return_requests;
  v_role text := app.marketplace_return_role(p_return_id);
begin
  if v_role is null then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  if p_note is null or char_length(btrim(p_note)) not between 3 and 500 then
    raise exception 'mp:reason_required' using errcode = '22023';
  end if;
  select * into r from public.marketplace_return_requests where id = p_return_id for update;
  if r.in_admin_queue then
    return app.marketplace_return_doc(r.id, v_role);
  end if;
  if r.status not in ('rejected', 'approved', 'in_transit', 'received') then
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  perform app.marketplace_return_event(r.id, 'complaint_filed', r.status, r.status, v_role, p_note);
  perform app.marketplace_return_escalate(r.id, 'complaint', v_role);
  return app.marketplace_return_doc(r.id, v_role);
end;
$function$;

-- public.marketplace_seller_refund_record(uuid,numeric,text)
CREATE OR REPLACE FUNCTION public.marketplace_seller_refund_record(p_return_id uuid, p_amount_egp numeric, p_reference_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.marketplace_return_requests;
  o public.marketplace_orders;
  f public.marketplace_order_refunds;
  v_cap numeric;
begin
  select * into r from public.marketplace_return_requests where id = p_return_id for update;
  if not found or not app.marketplace_can_manage_orders(r.seller_organization_id) then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  v_cap := app.marketplace_return_refund_cap(r.id);
  select * into f from public.marketplace_order_refunds where return_id = r.id;
  if found then
    if f.amount_egp = p_amount_egp then
      return app.marketplace_return_doc(r.id, 'seller');
    end if;
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  if r.status <> 'received' or r.remedy <> 'refund' then
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  -- the refund is exactly what was agreed: the value of the returned units, or the partial amount the seller proposed
  if p_amount_egp is null or p_amount_egp <> v_cap or (p_reference_note is not null and char_length(p_reference_note) > 300) then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  select * into o from public.marketplace_orders where id = r.order_id;
  insert into public.marketplace_order_refunds (return_id, order_id, amount_egp, method, state, sent_by, sent_at, reference_note)
  values (r.id, r.order_id, p_amount_egp, o.payment_method, 'sent', (select auth.uid()), now(), nullif(btrim(p_reference_note), ''));
  perform app.marketplace_return_event(r.id, 'refund_sent', r.status, r.status, 'seller', p_reference_note);
  perform app.marketplace_return_notify(r.id, 'refund_sent', 'buyer');
  return app.marketplace_return_doc(r.id, 'seller');
end;
$function$;

drop function if exists app.marketplace_attribute_number(numeric,text,text,boolean);
drop function if exists app.marketplace_date_range(date,date,boolean);

alter table public.marketplace_return_requests drop constraint if exists ck_mp_returns_escalated;
alter table public.marketplace_return_requests add constraint ck_mp_returns_escalated CHECK (((escalated_reason IS NULL) OR (escalated_reason = ANY (ARRAY['seller_silent'::text, 'complaint'::text]))));
alter table public.marketplace_timers drop constraint if exists ck_mp_timers_kind;
alter table public.marketplace_timers add constraint ck_mp_timers_kind CHECK ((kind = ANY (ARRAY['order_seller_start'::text, 'order_receipt_resubmit'::text, 'return_seller_response'::text, 'return_refund_due'::text])));
alter table public.notifications drop constraint if exists ck_notifications_event_type_known;
alter table public.notifications add constraint ck_notifications_event_type_known CHECK ((event_type = ANY (ARRAY['job.application.accepted'::text, 'job.application.rejected'::text, 'job.assignment.cancelled'::text, 'job.assignment.completed'::text, 'job.assignment.ready'::text, 'job.review.received'::text, 'marketplace.order.cancelled_by_buyer'::text, 'marketplace.order.cancelled_by_seller'::text, 'marketplace.order.cancelled_timeout_receipt'::text, 'marketplace.order.cancelled_timeout_seller'::text, 'marketplace.order.delivered'::text, 'marketplace.order.payment_complaint_filed'::text, 'marketplace.order.payment_complaint_resolved'::text, 'marketplace.order.placed'::text, 'marketplace.order.preparing'::text, 'marketplace.order.ready_pickup'::text, 'marketplace.order.receipt_disputed'::text, 'marketplace.order.receipt_resubmitted'::text, 'marketplace.order.refund_check'::text, 'marketplace.order.refund_confirmed'::text, 'marketplace.order.refund_sent'::text, 'marketplace.order.reminder_receipt_resubmit'::text, 'marketplace.order.reminder_seller_start'::text, 'marketplace.order.shipped'::text, 'marketplace.product.rejected'::text, 'marketplace.return.admin_decided'::text, 'marketplace.return.admin_reminder'::text, 'marketplace.return.approved'::text, 'marketplace.return.escalated'::text, 'marketplace.return.received'::text, 'marketplace.return.refund_confirmed'::text, 'marketplace.return.refund_sent'::text, 'marketplace.return.rejected'::text, 'marketplace.return.requested'::text, 'marketplace.return.seller_reminder'::text, 'marketplace.seller.approved'::text, 'marketplace.seller.reinstated'::text, 'marketplace.seller.rejected'::text, 'marketplace.seller.revoked'::text, 'marketplace.seller.suspended'::text, 'marketplace.stock.low'::text, 'marketplace.stock.out'::text, 'message.sent'::text, 'order.cancelled'::text, 'order.completed'::text, 'order.created'::text, 'order.started'::text, 'project.activated'::text, 'project.completed'::text, 'project.created'::text, 'quotation.accepted'::text, 'quotation.rejected'::text, 'quotation.submitted'::text, 'rfq.cancelled'::text, 'rfq.submitted'::text, 'verification.approved'::text, 'verification.changes_requested'::text, 'verification.rejected'::text, 'whatsapp_otp.audit_unmatched'::text, 'whatsapp_otp.budget_critical'::text, 'whatsapp_otp.budget_exhausted'::text, 'whatsapp_otp.budget_warning'::text, 'whatsapp_otp.delivery_unmatched'::text, 'whatsapp_otp.failure_rate'::text])));

delete from public.notification_templates
 where key in ('marketplace.return.shipped', 'marketplace.return.complaint_filed', 'marketplace.return.refund_confirm_reminder');

commit;
