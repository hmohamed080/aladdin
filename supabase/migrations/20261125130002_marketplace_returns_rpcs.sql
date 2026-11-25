-- ===========================================================================
-- Marketplace PR 15 - Migration 150002: returns and exchanges, rules, RPCs, hooks, templates
-- ===========================================================================
-- WHAT THIS ADDS (contract sections 4.5, 4.6, 5.2, 6; owner decisions 2026-11-21)
--   * Pure rules in SQL: the return window (14 days general / 30 days defect, per showroom never lower, counted in calendar
--     days from delivery in Africa/Cairo, ending 23:59:59 of the last day; 48 hours for visible transit damage), eligibility,
--     the refund cap.
--   * Buyer RPCs: eligibility, evidence upload (photos only, at most 6, 10 MB, private R2), create, cancel, mark shipped,
--     confirm the refund, list, get. Seller RPCs: list, get, decide (approve / reject / propose a partial refund),
--     receive (stock goes back only for units the seller marks sellable), record the refund the seller paid through the
--     buyer's ORIGINAL method, fulfil an exchange, return settings, per-product non-returnable flag.
--   * Admin RPCs (permission marketplace_returns.review): queue, get, remind the seller, decide with the seller.
--   * Escalation: the seller has 72 hours; reminders at 24 h and 48 h; on silence the return goes to the admin queue. NEVER an
--     automatic approval. A complaint from the buyer or the seller escalates too. The refund has a 7 day deadline after the
--     seller received the goods (reminder at 5 days, then the admin queue).
--   * Hooks of PR 12 filled: return evidence read and metadata, upload and delete branches of the media functions (and the
--     cleanup of unattached evidence), the timer tick of PR 14's runner, extra order actions (request_return /
--     request_exchange; composes with PR 14's body), the order document keys return_window and returns (migration 150003).
--   * Ten notification templates (in-app only), both languages.
-- MONEY IS NEVER MOVED HERE. A refund is a record: the showroom pays outside the platform and records it, the buyer confirms.
-- ASSUMED pending owner confirmation: exchange only for the same product or a same-price variant (the showroom hands over the
-- replacement; stock is taken for it); a "partial refund proposal" approves the return with a capped refund amount and the
-- buyer may escalate with a complaint; photos only (no video).
-- NEEDS: PR 12 (20261124120001). The admin fan-out app.marketplace_notify_admins is PR 14's; this migration only calls it.
-- NOTHING IS DROPPED. SECURITY: SECURITY DEFINER, search_path = '', every caller re-checked; no table grant.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Pure rules
-- ---------------------------------------------------------------------------
-- Last instant of the return window: 23:59:59 (Africa/Cairo) of the day that is p_days calendar days after delivery.
create or replace function app.marketplace_return_window_end(p_delivered timestamptz, p_days integer)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select ((((p_delivered at time zone 'Africa/Cairo')::date + p_days + 1)::timestamp) at time zone 'Africa/Cairo') - interval '1 second';
$$;

create or replace function app.marketplace_return_days(p_org uuid)
returns table (general_days integer, defect_days integer)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.general_days::integer from public.marketplace_seller_return_settings s where s.seller_organization_id = p_org), 14),
         coalesce((select s.defect_days::integer from public.marketplace_seller_return_settings s where s.seller_organization_id = p_org), 30);
$$;

-- { general_ends_at, defect_ends_at, transit_ends_at, general_days, defect_days } or null until the order is delivered
create or replace function app.marketplace_return_window_json(p_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.marketplace_orders;
  d record;
begin
  select * into o from public.marketplace_orders where id = p_order;
  if not found or o.delivered_at is null then
    return null;
  end if;
  select * into d from app.marketplace_return_days(o.seller_organization_id);
  return jsonb_build_object(
    'general_ends_at', app.marketplace_return_window_end(o.delivered_at, d.general_days),
    'defect_ends_at', app.marketplace_return_window_end(o.delivered_at, d.defect_days),
    'transit_ends_at', o.delivered_at + interval '48 hours',
    'general_days', d.general_days, 'defect_days', d.defect_days);
end;
$$;

-- An order can start a return: a delivered v2 order, inside the (longest) window, nothing active, something left to return.
create or replace function app.marketplace_return_can_start(p_order uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.marketplace_orders;
  w jsonb;
begin
  select * into o from public.marketplace_orders where id = p_order;
  if not found or o.source <> 'v2' or o.status <> 'delivered' or o.delivered_at is null then
    return false;
  end if;
  w := app.marketplace_return_window_json(o.id);
  return now() <= (w ->> 'defect_ends_at')::timestamptz
    and not exists (select 1 from public.marketplace_return_requests r where r.order_id = o.id
                     and r.status in ('requested', 'approved', 'in_transit', 'received'))
    and exists (select 1 from public.marketplace_order_items i where i.order_id = o.id and i.quantity_returned < i.quantity);
end;
$$;

-- What a return is worth: the price of the returned units, capped by a partial proposal. Owner decision 2026-11-25: the delivery fee is
-- added only when ONE return takes back the WHOLE order for a fault of the showroom (the reason makes the showroom pay the return
-- shipping: defect, wrong item, transit damage). A partial return, or a change of mind, never includes it.
create or replace function app.marketplace_return_value(p_return uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(i.unit_price_egp * ri.quantity)
                     from public.marketplace_return_items ri join public.marketplace_order_items i on i.id = ri.order_item_id
                    where ri.return_id = p_return), 0)
       + coalesce((select o.delivery_fee_egp
                     from public.marketplace_return_requests r join public.marketplace_orders o on o.id = r.order_id
                    where r.id = p_return and r.return_shipping_payer = 'seller'
                      and not exists (
                        select 1 from public.marketplace_order_items oi
                         where oi.order_id = o.id
                           and oi.quantity > coalesce((select x.quantity from public.marketplace_return_items x
                                                        where x.return_id = r.id and x.order_item_id = oi.id), 0))), 0);
$$;

create or replace function app.marketplace_return_refund_cap(p_return uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select least(app.marketplace_return_value(r.id), coalesce(r.partial_refund_egp, app.marketplace_return_value(r.id)))
    from public.marketplace_return_requests r where r.id = p_return;
$$;

-- ---------------------------------------------------------------------------
-- 2. Events, authorization and the order payment mirror
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_return_event(p_return uuid, p_action text, p_from text, p_to text, p_role text, p_note text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.marketplace_return_events (return_id, action, from_status, to_status, actor_user_id, actor_role, note)
  values (p_return, p_action, p_from, p_to, (select auth.uid()), p_role, left(nullif(btrim(p_note), ''), 500));
$$;

-- The caller's relation to a return: 'buyer', 'seller' or null (the RPCs then answer not_found, never "forbidden").
create or replace function app.marketplace_return_role(p_return uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when r.buyer_user_id = (select auth.uid()) then 'buyer'
              when app.marketplace_can_manage_orders(r.seller_organization_id) then 'seller' end
    from public.marketplace_return_requests r where r.id = p_return;
$$;

-- The order's payment status mirrors the refund (refund_due while a refund is owed, refunded when the order is settled).
-- v2 orders may change status and payment status only inside the order machine, so the machine's own switch is flipped for this
-- one statement and restored.
create or replace function app.marketplace_return_order_payment(p_order uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text := coalesce(current_setting('app.marketplace_order_apply', true), 'off');
begin
  perform set_config('app.marketplace_order_apply', 'on', true);
  update public.marketplace_orders set payment_status = p_status where id = p_order and payment_status <> p_status;
  perform set_config('app.marketplace_order_apply', v_old, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Notifications (in-app only; no phone, address or receipt in any text)
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_return_notify(p_return uuid, p_event text, p_to text, p_msg_ar text default null,
  p_msg_en text default null, p_hours_left integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.marketplace_return_requests;
  o public.marketplace_orders;
  v_key text := 'marketplace.return.' || p_event;
  v_vars jsonb;
  v_ar jsonb;
  v_en jsonb;
  v_amount numeric;
  v_user uuid;
begin
  select * into r from public.marketplace_return_requests where id = p_return;
  select * into o from public.marketplace_orders where id = r.order_id;
  select coalesce(rf.amount_egp, app.marketplace_return_refund_cap(r.id)) into v_amount
    from (select 1) x left join public.marketplace_order_refunds rf on rf.return_id = r.id;
  v_vars := jsonb_build_object('order_number', o.order_number, 'request_number', r.request_number,
    'showroom_name', (select org.name from public.organizations org where org.id = r.seller_organization_id),
    'hours_left', coalesce(p_hours_left::text, ''));
  v_ar := jsonb_build_object('message', coalesce(p_msg_ar, ''), 'amount', trim(to_char(v_amount, 'FM999,999,990.00')) || ' ج.م');
  v_en := jsonb_build_object('message', coalesce(p_msg_en, ''), 'amount', trim(to_char(v_amount, 'FM999,999,990.00')) || ' EGP');
  if p_to = 'buyer' then
    perform app.notify_from_template(r.buyer_user_id, null, v_key, 'marketplace_return', r.id, '/market/returns/' || r.id, v_vars, v_ar, v_en);
  elsif p_to = 'sellers' then
    for v_user in
      select distinct m.user_id from public.memberships m
        join public.membership_capabilities c on c.membership_id = m.id
       where m.organization_id = r.seller_organization_id and m.status = 'active' and c.capability_key in ('order.manage', 'org.manage')
    loop
      perform app.notify_from_template(v_user, r.seller_organization_id, v_key, 'marketplace_return', r.id,
        '/showroom/marketplace/returns/' || r.id, v_vars, v_ar, v_en);
    end loop;
  elsif p_to = 'admins' then
    perform app.marketplace_notify_admins('marketplace_returns.review', v_key, 'marketplace_return', r.id,
      '/admin/marketplace/returns', v_vars);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Escalation to the admin queue (idempotent)
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_return_escalate(p_return uuid, p_reason text, p_role text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.marketplace_return_requests;
begin
  select * into r from public.marketplace_return_requests where id = p_return for update;
  if not found or r.in_admin_queue or r.status in ('refunded', 'exchanged', 'closed', 'cancelled') then
    return false;
  end if;
  update public.marketplace_return_requests set in_admin_queue = true, escalated_reason = p_reason, escalated_at = now()
   where id = r.id;
  perform app.marketplace_return_event(r.id, 'escalated', r.status, r.status, p_role, p_reason);
  perform app.marketplace_return_notify(r.id, 'escalated', 'admins');
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Documents
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_return_actions(p_return uuid, p_for text)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    if r.status in ('requested', 'rejected') then v_out := v_out || array['approve', 'reject']; end if;
  end if;
  return v_out;
end;
$$;

create or replace function app.marketplace_return_doc(p_return uuid, p_for text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
$$;

create or replace function app.marketplace_return_summary(p_return uuid, p_for text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', r.id, 'request_number', r.request_number, 'order_id', r.order_id, 'order_number', o.order_number,
    'status', r.status, 'kind', r.kind, 'claim_type', r.claim_type, 'remedy', r.remedy, 'created_at', r.created_at,
    'seller_due_at', r.seller_due_at, 'in_admin_queue', r.in_admin_queue, 'escalated_reason', r.escalated_reason,
    'seller_name', (select org.name from public.organizations org where org.id = r.seller_organization_id),
    'buyer_name', case when p_for in ('seller', 'admin') then o.buyer_name end,
    'item_count', (select coalesce(sum(ri.quantity), 0) from public.marketplace_return_items ri where ri.return_id = r.id),
    'value_egp', app.marketplace_return_value(r.id),
    'action_needed', case p_for
        when 'seller' then r.status in ('requested', 'approved', 'in_transit') or (r.status = 'received')
        when 'buyer' then r.status = 'approved' or exists (select 1 from public.marketplace_order_refunds rf where rf.return_id = r.id and rf.state = 'sent')
        else r.in_admin_queue and r.status in ('requested', 'rejected', 'approved', 'in_transit', 'received') end)
    from public.marketplace_return_requests r join public.marketplace_orders o on o.id = r.order_id
   where r.id = p_return;
$$;

-- the order document key `returns`
create or replace function app.marketplace_order_returns_json(p_order uuid, p_for text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'request_number', r.request_number, 'status', r.status, 'kind', r.kind)
                            order by r.created_at), '[]'::jsonb)
    from public.marketplace_return_requests r where r.order_id = p_order;
$$;

-- the order document key `return_window`
create or replace function app.marketplace_order_return_window(p_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w jsonb := app.marketplace_return_window_json(p_order);
begin
  if w is null then
    return null;
  end if;
  return jsonb_build_object('general_ends_at', w -> 'general_ends_at', 'defect_ends_at', w -> 'defect_ends_at',
    'returnable', app.marketplace_return_can_start(p_order));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Buyer: eligibility, evidence, create, cancel, ship, confirm refund, read
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_buyer_return_eligibility(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.marketplace_orders;
  w jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  select * into o from public.marketplace_orders where id = p_order_id and buyer_user_id = (select auth.uid());
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  w := app.marketplace_return_window_json(o.id);
  return jsonb_build_object(
    'eligible', app.marketplace_return_can_start(o.id),
    'window', case when w is null then null else jsonb_build_object('general_ends_at', w -> 'general_ends_at',
      'defect_ends_at', w -> 'defect_ends_at', 'transit_ends_at', w -> 'transit_ends_at') end,
    'active_return_id', (select r.id from public.marketplace_return_requests r where r.order_id = o.id
                          and r.status in ('requested', 'approved', 'in_transit', 'received')),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('item_id', i.id, 'name_ar', i.name_ar, 'name_en', i.name_en,
        'sku', i.sku, 'variant_label', i.variant_label, 'image_id', i.image_id, 'unit_price_egp', i.unit_price_egp,
        'quantity', i.quantity, 'returnable_quantity', greatest(i.quantity - i.quantity_returned, 0),
        'non_returnable', i.non_returnable) order by i.created_at, i.sku)
      from public.marketplace_order_items i where i.order_id = o.id), '[]'::jsonb),
    'reasons', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'label_ar', p.label_ar, 'label_en', p.label_en,
        'claim_type', coalesce(ru.claim_type, 'general'), 'requires_evidence', coalesce(ru.requires_evidence, false),
        'transit_damage', coalesce(ru.transit_damage, false), 'shipping_payer', coalesce(ru.shipping_payer, 'buyer'))
        order by p.sort_order, p.label_en)
      from public.marketplace_seller_message_presets p
      left join public.marketplace_return_reason_rules ru on ru.preset_id = p.id
      where p.action = 'return_reason' and p.is_active), '[]'::jsonb));
end;
$$;

create or replace function public.marketplace_buyer_return_request_upload(p_order_id uuid, p_content_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  o public.marketplace_orders;
  v_id uuid := gen_random_uuid();
  v_ext text;
  v_key text;
begin
  if v_uid is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  select * into o from public.marketplace_orders where id = p_order_id and buyer_user_id = v_uid for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  if o.source <> 'v2' or o.status <> 'delivered' then
    raise exception 'mp:return_not_eligible' using errcode = '23514';
  end if;
  v_ext := case p_content_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  if v_ext is null then
    raise exception 'mp:image_type_invalid' using errcode = '22023';
  end if;
  -- at most 6 photos waiting to be attached to a request
  if (select count(*) from public.marketplace_return_evidence e where e.order_id = o.id and e.created_by = v_uid
        and e.return_id is null and e.upload_state <> 'deleting') >= 6 then
    raise exception 'mp:too_many_images' using errcode = '23514';
  end if;
  if (select count(*) from public.marketplace_return_evidence e where e.order_id = o.id and e.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'mp:upload_rate_limited' using errcode = 'P0001';
  end if;
  v_key := 'returns/' || o.id || '/' || v_id || '.' || v_ext;
  insert into public.marketplace_return_evidence (id, order_id, object_key, mime_type, created_by)
  values (v_id, o.id, v_key, p_content_type, v_uid);
  return jsonb_build_object('evidence_id', v_id, 'object_key', v_key);
end;
$$;

-- A stored object counts as evidence only after the central verifier attested the bytes (same rule as a receipt).
create or replace function app.marketplace_evidence_require_verified_media()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.upload_state = 'awaiting_upload' and new.upload_state = 'confirmed'
     and not exists (select 1 from public.media_storage_locations l
       where l.namespace = 'marketplace' and l.object_key = new.object_key
         and l.owner_user_id = new.created_by and l.content_type = new.mime_type
         and l.verified_at > now() - interval '10 minutes' and l.size_bytes > 0 and l.sha256 is not null) then
    raise exception 'stored object has not been verified' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger marketplace_evidence_verified_before_confirmed before update on public.marketplace_return_evidence
  for each row execute function app.marketplace_evidence_require_verified_media();

create or replace function public.marketplace_buyer_return_evidence_confirm(p_evidence_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  e public.marketplace_return_evidence;
  l public.media_storage_locations;
begin
  if v_uid is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  select * into e from public.marketplace_return_evidence where id = p_evidence_id and created_by = v_uid for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  if e.upload_state = 'awaiting_upload' then
    select * into l from public.media_storage_locations
     where namespace = 'marketplace' and object_key = e.object_key and verified_at is not null;
    if not found then
      raise exception 'mp:upload_not_found' using errcode = '23514';
    end if;
    update public.marketplace_return_evidence set upload_state = 'confirmed', byte_size = l.size_bytes, checksum_sha256 = l.sha256
     where id = e.id;
  elsif e.upload_state <> 'confirmed' then
    raise exception 'mp:upload_not_found' using errcode = '23514';
  end if;
  return jsonb_build_object('evidence', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'object_key', x.object_key,
      'attached', x.return_id is not null, 'created_at', x.created_at) order by x.created_at)
    from public.marketplace_return_evidence x where x.order_id = e.order_id and x.created_by = v_uid
     and x.upload_state = 'confirmed' and x.return_id is null), '[]'::jsonb));
end;
$$;

create or replace function public.marketplace_buyer_return_create(p_order_id uuid, p_kind text, p_lines jsonb, p_reason_preset_id uuid,
  p_note text, p_evidence_ids uuid[], p_remedy text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  o public.marketplace_orders;
  r public.marketplace_return_requests;
  v_preset public.marketplace_seller_message_presets;
  v_rule public.marketplace_return_reason_rules;
  v_claim text;
  v_remedy text;
  v_payer text;
  v_w jsonb;
  v_el jsonb;
  v_item public.marketplace_order_items;
  v_qty integer;
  v_seen uuid[] := '{}';
  v_ids uuid[];
  v_attached integer;
  v_rid uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  if not app.account_is_active(v_uid) then
    raise exception 'mp:account_inactive' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 128 or p_kind not in ('return', 'exchange')
     or (p_note is not null and char_length(p_note) > 500) then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  select * into o from public.marketplace_orders where id = p_order_id and buyer_user_id = v_uid for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  -- replay of the same request
  select * into r from public.marketplace_return_requests where buyer_user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    if r.order_id <> o.id then
      raise exception 'mp:idempotency_conflict' using errcode = '23505';
    end if;
    return app.marketplace_return_doc(r.id, 'buyer');
  end if;
  if o.source <> 'v2' then
    raise exception 'mp:legacy_order' using errcode = '23514';
  end if;
  if o.status <> 'delivered' or o.delivered_at is null then
    raise exception 'mp:return_not_eligible' using errcode = '23514';
  end if;
  v_remedy := coalesce(p_remedy, case p_kind when 'return' then 'refund' else 'exchange' end);
  if (p_kind = 'return') <> (v_remedy = 'refund') or v_remedy not in ('refund', 'exchange') then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  select * into v_preset from public.marketplace_seller_message_presets where id = p_reason_preset_id and action = 'return_reason' and is_active;
  if not found then
    raise exception 'mp:preset_invalid' using errcode = '22023';
  end if;
  select * into v_rule from public.marketplace_return_reason_rules where preset_id = v_preset.id;
  v_claim := coalesce(v_rule.claim_type, 'general');
  v_payer := coalesce(v_rule.shipping_payer, 'buyer');
  if exists (select 1 from public.marketplace_return_requests x where x.order_id = o.id and x.status in ('requested', 'approved', 'in_transit', 'received')) then
    raise exception 'mp:return_exists' using errcode = '23505';
  end if;
  -- the windows
  v_w := app.marketplace_return_window_json(o.id);
  if now() > (v_w ->> (case v_claim when 'defect' then 'defect_ends_at' else 'general_ends_at' end))::timestamptz
     or (coalesce(v_rule.transit_damage, false) and now() > (v_w ->> 'transit_ends_at')::timestamptz) then
    raise exception 'mp:return_window_closed' using errcode = '23514';
  end if;
  -- the lines
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  insert into public.marketplace_return_requests (id, order_id, buyer_user_id, seller_organization_id, kind, claim_type, reason_preset_id,
    reason_label_ar, reason_label_en, transit_damage, buyer_note, remedy, return_shipping_payer, idempotency_key, seller_due_at)
  values (v_rid, o.id, v_uid, o.seller_organization_id, p_kind, v_claim, v_preset.id, v_preset.label_ar, v_preset.label_en,
    coalesce(v_rule.transit_damage, false), nullif(btrim(p_note), ''), v_remedy, v_payer, p_idempotency_key, now() + interval '72 hours')
  returning * into r;
  for v_el in select * from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_el) <> 'object' or coalesce(v_el ->> 'item_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(v_el ->> 'quantity', '') !~ '^[0-9]{1,4}$' then
      raise exception 'mp:invalid_payload' using errcode = '22023';
    end if;
    if (v_el ->> 'item_id')::uuid = any (v_seen) then
      raise exception 'mp:invalid_payload' using errcode = '22023';
    end if;
    v_seen := v_seen || (v_el ->> 'item_id')::uuid;
    v_qty := (v_el ->> 'quantity')::integer;
    select * into v_item from public.marketplace_order_items where id = (v_el ->> 'item_id')::uuid and order_id = o.id for update;
    if not found or v_qty < 1 then
      raise exception 'mp:invalid_payload' using errcode = '22023';
    end if;
    if v_qty > v_item.quantity - v_item.quantity_returned then
      raise exception 'mp:quantity_exceeds_order' using errcode = '23514';
    end if;
    -- a made-to-order product accepts only a defect claim
    if v_item.non_returnable and v_claim <> 'defect' then
      raise exception 'mp:return_not_eligible' using errcode = '23514';
    end if;
    insert into public.marketplace_return_items (return_id, order_item_id, quantity) values (r.id, v_item.id, v_qty);
  end loop;
  -- the evidence
  v_ids := coalesce((select array_agg(distinct x) from unnest(p_evidence_ids) x), '{}');
  if cardinality(v_ids) > 6 then
    raise exception 'mp:too_many_images' using errcode = '23514';
  end if;
  update public.marketplace_return_evidence set return_id = r.id
   where id = any (v_ids) and created_by = v_uid and order_id = o.id and return_id is null and upload_state = 'confirmed';
  get diagnostics v_attached = row_count;
  if v_attached <> cardinality(v_ids) then
    raise exception 'mp:upload_not_found' using errcode = '23514';
  end if;
  if coalesce(v_rule.requires_evidence, false) and v_attached = 0 then
    raise exception 'mp:evidence_required' using errcode = '23514';
  end if;
  perform app.marketplace_timer_open('return', r.id, 'return_seller_response', now());
  perform app.marketplace_return_event(r.id, 'requested', null, 'requested', 'buyer', p_note);
  perform app.marketplace_order_event(o.id, 'return_requested', o.status, o.status, o.payment_status, o.payment_status, 'buyer', r.request_number);
  perform app.marketplace_return_notify(r.id, 'requested', 'sellers');
  return app.marketplace_return_doc(r.id, 'buyer');
end;
$$;

create or replace function public.marketplace_buyer_return_cancel(p_return_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.marketplace_return_requests;
begin
  select * into r from public.marketplace_return_requests where id = p_return_id and buyer_user_id = (select auth.uid()) for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  if r.status = 'cancelled' then
    return app.marketplace_return_doc(r.id, 'buyer');
  end if;
  if r.status <> 'requested' then
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  update public.marketplace_return_requests set status = 'cancelled', closed_at = now(), in_admin_queue = false where id = r.id;
  perform app.marketplace_timer_close('return', r.id, 'return_seller_response', 'cancel_by_buyer');
  perform app.marketplace_return_event(r.id, 'cancelled', r.status, 'cancelled', 'buyer', null);
  return app.marketplace_return_doc(r.id, 'buyer');
end;
$$;

create or replace function public.marketplace_buyer_return_mark_shipped(p_return_id uuid, p_tracking text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- The buyer confirms he received the refund. The order is settled when the confirmed refunds cover all its lines.
create or replace function public.marketplace_buyer_refund_confirm(p_return_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.marketplace_buyer_returns(p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.marketplace_return_requests r where r.buyer_user_id = v_uid),
    'items', coalesce((select jsonb_agg(app.marketplace_return_summary(x.id, 'buyer') order by x.created_at desc) from (
      select r.id, r.created_at from public.marketplace_return_requests r where r.buyer_user_id = v_uid
       order by r.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb));
end;
$$;

create or replace function public.marketplace_buyer_return_get(p_return_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.marketplace_return_requests r where r.id = p_return_id and r.buyer_user_id = (select auth.uid())) then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  return app.marketplace_return_doc(p_return_id, 'buyer');
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. The decision (seller or admin) and the complaint
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_return_decide(p_return uuid, p_decision text, p_role text, p_preset uuid,
  p_message_ar text, p_message_en text, p_partial numeric, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.marketplace_return_requests;
  v_reason jsonb;
  v_to text;
  v_ar text;
  v_en text;
begin
  select * into r from public.marketplace_return_requests where id = p_return for update;
  if p_decision not in ('approve', 'reject', 'propose_partial') then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  v_to := case p_decision when 'reject' then 'rejected' else 'approved' end;
  -- replay: the same decision already took effect
  if r.status = v_to and r.decided_by_role = p_role and (p_decision <> 'propose_partial' or r.partial_refund_egp = p_partial) then
    return;
  end if;
  if not (r.status = 'requested' or (p_role = 'admin' and r.status = 'rejected')) then
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
    partial_refund_egp = case when p_decision = 'propose_partial' then p_partial else null end,
    in_admin_queue = false
   where id = r.id;
  perform app.marketplace_timer_close('return', r.id, 'return_seller_response', 'decided_by_' || p_role);
  perform app.marketplace_return_event(r.id, case p_decision when 'reject' then 'rejected' else 'approved' end, r.status, v_to, p_role,
    v_en);
  perform app.marketplace_return_notify(r.id, case when p_role = 'admin' then 'admin_decided' when p_decision = 'reject' then 'rejected' else 'approved' end,
    'buyer', v_ar, v_en);
  if p_role = 'admin' then
    perform app.marketplace_return_notify(r.id, 'admin_decided', 'sellers', v_ar, v_en);
  end if;
end;
$$;

create or replace function public.marketplace_seller_return_decide(p_return_id uuid, p_decision text, p_preset_id uuid default null,
  p_message_ar text default null, p_message_en text default null, p_partial_refund_egp numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.marketplace_return_requests;
begin
  select * into r from public.marketplace_return_requests where id = p_return_id;
  if not found or not app.marketplace_can_manage_orders(r.seller_organization_id) then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  perform app.marketplace_return_decide(r.id, p_decision, 'seller', p_preset_id, p_message_ar, p_message_en, p_partial_refund_egp, null);
  return app.marketplace_return_doc(r.id, 'seller');
end;
$$;

create or replace function public.marketplace_return_complaint_file(p_return_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- ---------------------------------------------------------------------------
-- 8. Seller: receive, refund record, exchange, list, get, settings, flag
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_seller_return_receive(p_return_id uuid, p_sellable jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.marketplace_return_requests;
  o public.marketplace_orders;
  v_el jsonb;
  v_it record;
begin
  select * into r from public.marketplace_return_requests where id = p_return_id for update;
  if not found or not app.marketplace_can_manage_orders(r.seller_organization_id) then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  if r.status = 'received' then
    return app.marketplace_return_doc(r.id, 'seller');
  end if;
  if r.status not in ('approved', 'in_transit') then
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  if p_sellable is null or jsonb_typeof(p_sellable) <> 'array' then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  select * into o from public.marketplace_orders where id = r.order_id for update;
  for v_el in select * from jsonb_array_elements(p_sellable) loop
    if jsonb_typeof(v_el) <> 'object' or coalesce(v_el ->> 'item_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(v_el -> 'sellable') <> 'boolean' then
      raise exception 'mp:invalid_payload' using errcode = '22023';
    end if;
    update public.marketplace_return_items set sellable = (v_el ->> 'sellable')::boolean
     where return_id = r.id and order_item_id = (v_el ->> 'item_id')::uuid;
    if not found then
      raise exception 'mp:invalid_payload' using errcode = '22023';
    end if;
  end loop;
  update public.marketplace_return_items set sellable = coalesce(sellable, false) where return_id = r.id;
  -- a returned unit goes back to stock only when the seller says it is sellable (idempotent key per return and line)
  for v_it in
    select ri.quantity, i.id as item_id, i.variant_id, i.location_id from public.marketplace_return_items ri
      join public.marketplace_order_items i on i.id = ri.order_item_id
     where ri.return_id = r.id and ri.sellable order by i.variant_id, i.location_id
  loop
    perform 1 from public.marketplace_stock_apply(r.seller_organization_id, v_it.variant_id, v_it.location_id, 'replenish', v_it.quantity,
      'return:' || r.id || ':' || v_it.item_id, 'Marketplace return ' || r.request_number, 'order', 'marketplace_return', r.id::text,
      (select auth.uid()));
  end loop;
  update public.marketplace_return_requests set status = 'received', received_at = now(),
    refund_due_at = case when remedy = 'refund' then now() + interval '7 days' end, in_admin_queue = false
   where id = r.id;
  if r.remedy = 'refund' then
    perform app.marketplace_timer_open('return', r.id, 'return_refund_due', now());
    if o.payment_status in ('collected', 'receipt_accepted') then
      perform app.marketplace_return_order_payment(o.id, 'refund_due');
    end if;
  end if;
  perform app.marketplace_return_event(r.id, 'received', r.status, 'received', 'seller', null);
  perform app.marketplace_return_notify(r.id, 'received', 'buyer');
  return app.marketplace_return_doc(r.id, 'seller');
end;
$$;

create or replace function public.marketplace_seller_refund_record(p_return_id uuid, p_amount_egp numeric, p_reference_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- The replacement of an exchange leaves stock (same product or same-price variant, ASSUMED pending owner).
create or replace function public.marketplace_seller_exchange_fulfil(p_return_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.marketplace_return_requests;
  o public.marketplace_orders;
  v_it record;
begin
  select * into r from public.marketplace_return_requests where id = p_return_id for update;
  if not found or not app.marketplace_can_manage_orders(r.seller_organization_id) then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  if r.status = 'exchanged' then
    return app.marketplace_return_doc(r.id, 'seller');
  end if;
  if r.status <> 'received' or r.remedy <> 'exchange' then
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  if p_note is not null and char_length(p_note) > 300 then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  select * into o from public.marketplace_orders where id = r.order_id for update;
  for v_it in
    select ri.quantity, i.id as item_id, i.variant_id, i.location_id from public.marketplace_return_items ri
      join public.marketplace_order_items i on i.id = ri.order_item_id
     where ri.return_id = r.id order by i.variant_id, i.location_id
  loop
    if coalesce((select l.available from public.marketplace_inventory_levels l
                  where l.variant_id = v_it.variant_id and l.location_id = v_it.location_id), 0) < v_it.quantity then
      raise exception 'mp:insufficient_stock' using errcode = '23514';
    end if;
    perform 1 from public.marketplace_stock_apply(r.seller_organization_id, v_it.variant_id, v_it.location_id, 'reserve', v_it.quantity,
      'return:' || r.id || ':xr:' || v_it.item_id, 'Marketplace exchange ' || r.request_number, 'order', 'marketplace_return', r.id::text,
      (select auth.uid()));
    perform 1 from public.marketplace_stock_apply(r.seller_organization_id, v_it.variant_id, v_it.location_id, 'deduct', v_it.quantity,
      'return:' || r.id || ':xd:' || v_it.item_id, 'Marketplace exchange ' || r.request_number, 'order', 'marketplace_return', r.id::text,
      (select auth.uid()));
  end loop;
  update public.marketplace_return_requests set status = 'exchanged', closed_at = now(), in_admin_queue = false where id = r.id;
  perform app.marketplace_return_event(r.id, 'exchanged', r.status, 'exchanged', 'seller', p_note);
  perform app.marketplace_order_event(o.id, 'return_closed', o.status, o.status, o.payment_status, o.payment_status, 'seller', r.request_number);
  return app.marketplace_return_doc(r.id, 'seller');
end;
$$;

create or replace function public.marketplace_seller_returns_page(p_organization_id uuid, p_state text default null,
  p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_states text[];
begin
  if not app.marketplace_can_manage_orders(p_organization_id) then
    raise exception 'mp:not_permitted' using errcode = '42501';
  end if;
  v_states := case
    when p_state is null then null
    when p_state = 'open' then array['requested', 'approved', 'in_transit', 'received']
    when p_state in ('requested', 'approved', 'rejected', 'in_transit', 'received', 'refunded', 'exchanged', 'closed', 'cancelled') then array[p_state]
    else null end;
  if p_state is not null and v_states is null then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.marketplace_return_requests r where r.seller_organization_id = p_organization_id
               and (v_states is null or r.status = any (v_states))),
    'counts', coalesce((select jsonb_object_agg(s.status, s.n) from (
        select r.status, count(*) as n from public.marketplace_return_requests r
         where r.seller_organization_id = p_organization_id group by r.status) s), '{}'::jsonb),
    'items', coalesce((select jsonb_agg(app.marketplace_return_summary(x.id, 'seller') order by x.created_at desc) from (
      select r.id, r.created_at from public.marketplace_return_requests r
       where r.seller_organization_id = p_organization_id and (v_states is null or r.status = any (v_states))
       order by r.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb));
end;
$$;

create or replace function public.marketplace_seller_return_get(p_return_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.marketplace_return_requests r where r.id = p_return_id
                  and app.marketplace_can_manage_orders(r.seller_organization_id)) then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  return app.marketplace_return_doc(p_return_id, 'seller');
end;
$$;

create or replace function public.marketplace_seller_return_settings_get(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d record;
begin
  if not app.marketplace_can_manage_orders(p_organization_id) then
    raise exception 'mp:not_permitted' using errcode = '42501';
  end if;
  select * into d from app.marketplace_return_days(p_organization_id);
  return jsonb_build_object('general_days', d.general_days, 'defect_days', d.defect_days, 'min_general_days', 14, 'min_defect_days', 30);
end;
$$;

create or replace function public.marketplace_seller_return_settings_save(p_organization_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g integer;
  v_d integer;
begin
  if not app.marketplace_can_manage_orders(p_organization_id) then
    raise exception 'mp:not_permitted' using errcode = '42501';
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' or coalesce(p_settings ->> 'general_days', '') !~ '^[0-9]{1,3}$'
     or coalesce(p_settings ->> 'defect_days', '') !~ '^[0-9]{1,3}$' then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  v_g := (p_settings ->> 'general_days')::integer;
  v_d := (p_settings ->> 'defect_days')::integer;
  -- the legal floor: a showroom may offer more days, never fewer
  if v_g not between 14 and 365 or v_d not between 30 and 365 then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  insert into public.marketplace_seller_return_settings (seller_organization_id, general_days, defect_days, updated_by)
  values (p_organization_id, v_g, v_d, (select auth.uid()))
  on conflict (seller_organization_id) do update set general_days = excluded.general_days, defect_days = excluded.defect_days,
    updated_by = excluded.updated_by;
  return jsonb_build_object('general_days', v_g, 'defect_days', v_d, 'min_general_days', 14, 'min_defect_days', 30);
end;
$$;

-- The per-product "made to order, not returnable" flag (disclosed before payment, copied onto order items at confirm).
create or replace function public.marketplace_seller_product_returnability_set(p_organization_id uuid, p_product_id uuid,
  p_non_returnable boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_non_returnable is null then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  if not app.marketplace_can_manage_catalog(p_organization_id) then
    raise exception 'mp:not_permitted' using errcode = '42501';
  end if;
  update public.marketplace_products set non_returnable = p_non_returnable
   where id = p_product_id and seller_organization_id = p_organization_id;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  return p_non_returnable;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Admin queue (permission marketplace_returns.review)
-- ---------------------------------------------------------------------------
create or replace function public.admin_marketplace_returns(p_state text default null, p_queue text default 'escalated',
  p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_states text[];
  v_all boolean := p_queue = 'all';
begin
  perform app.marketplace_assert_admin_permission('marketplace_returns.review');
  if p_queue not in ('escalated', 'all') then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  v_states := case
    when p_state is null then null
    when p_state = 'open' then array['requested', 'approved', 'in_transit', 'received']
    when p_state in ('requested', 'approved', 'rejected', 'in_transit', 'received', 'refunded', 'exchanged', 'closed', 'cancelled') then array[p_state]
    else null end;
  if p_state is not null and v_states is null then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.marketplace_return_requests r where (v_all or r.in_admin_queue) and (v_states is null or r.status = any (v_states))),
    'counts', jsonb_build_object(
      'escalated', (select count(*) from public.marketplace_return_requests r where r.in_admin_queue),
      'all', (select count(*) from public.marketplace_return_requests)),
    'items', coalesce((select jsonb_agg(app.marketplace_return_summary(x.id, 'admin') order by x.created_at desc) from (
      select r.id, coalesce(r.escalated_at, r.created_at) as created_at from public.marketplace_return_requests r
       where (v_all or r.in_admin_queue) and (v_states is null or r.status = any (v_states))
       order by coalesce(r.escalated_at, r.created_at) desc
       limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb));
end;
$$;

create or replace function public.admin_marketplace_return_get(p_return_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.marketplace_assert_admin_permission('marketplace_returns.review');
  if not exists (select 1 from public.marketplace_return_requests where id = p_return_id) then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  return app.marketplace_return_doc(p_return_id, 'admin');
end;
$$;

create or replace function public.admin_marketplace_return_remind_seller(p_return_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.marketplace_return_requests;
begin
  perform app.marketplace_assert_admin_permission('marketplace_returns.review');
  select * into r from public.marketplace_return_requests where id = p_return_id for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  if r.status not in ('requested', 'approved', 'in_transit', 'received') then
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  perform app.marketplace_return_event(r.id, 'admin_reminded', r.status, r.status, 'admin', null);
  perform app.marketplace_return_notify(r.id, 'admin_reminder', 'sellers');
  return app.marketplace_return_doc(r.id, 'admin');
end;
$$;

create or replace function public.admin_marketplace_return_decide(p_return_id uuid, p_decision text, p_note text,
  p_message_ar text default null, p_message_en text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.marketplace_assert_admin_permission('marketplace_returns.review');
  if p_decision not in ('approve', 'reject') then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  if not exists (select 1 from public.marketplace_return_requests where id = p_return_id) then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  perform app.marketplace_return_decide(p_return_id, p_decision, 'admin', null, p_message_ar, p_message_en, null, p_note);
  return app.marketplace_return_doc(p_return_id, 'admin');
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Timer hook (PR 14's runner calls it; no auto-approval, ever)
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_return_timer_tick(p_timer public.marketplace_timers, p_now timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- ---------------------------------------------------------------------------
-- 11. Evidence in the media layer (hooks of PR 12, plus upload / delete / cleanup of the media functions)
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_return_evidence_metadata(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('owner', e.created_by, 'organization', null, 'contentType', e.mime_type,
    'state', case e.upload_state when 'awaiting_upload' then 'pending' when 'confirmed' then 'ready' else 'deleted' end,
    'createdAt', e.created_at)
  from public.marketplace_return_evidence e where e.object_key = p_key;
$$;

-- the buyer who uploaded it, the showroom's order managers once it is attached to a request, and admins holding the permission
-- for an ESCALATED return only
create or replace function app.marketplace_return_evidence_can_read(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.marketplace_return_evidence e
      left join public.marketplace_return_requests r on r.id = e.return_id
     where e.object_key = p_key and e.upload_state = 'confirmed'
       and (e.created_by = (select auth.uid())
            or (r.id is not null and app.marketplace_can_manage_orders(r.seller_organization_id)
                and exists (select 1 from public.organizations so where so.id = r.seller_organization_id and so.deleted_at is null))
            or (r.id is not null and r.in_admin_queue and app.has_admin_permission('marketplace_returns.review'))));
$$;

create or replace function app.marketplace_media_can_upload(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.marketplace_product_images i
    join public.marketplace_products p on p.id = i.product_id
    where i.object_key = p_key
      and i.upload_state = 'awaiting_upload'
      and i.created_at > now() - interval '1 hour'
      and app.marketplace_can_manage_catalog(p.seller_organization_id)
      and app.marketplace_seller_is_enabled(p.seller_organization_id))
  or exists (
    select 1 from public.marketplace_payment_proofs pr
    where pr.object_key = p_key and pr.upload_state = 'awaiting_upload'
      and pr.created_at > now() - interval '1 hour' and pr.created_by = (select auth.uid()))
  or exists (
    select 1 from public.marketplace_return_evidence e
    where e.object_key = p_key and e.upload_state = 'awaiting_upload'
      and e.created_at > now() - interval '1 hour' and e.created_by = (select auth.uid()));
$$;

create or replace function app.marketplace_media_can_delete(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.marketplace_product_images i
    join public.marketplace_products p on p.id = i.product_id
    where i.object_key = p_key and i.upload_state in ('awaiting_upload', 'deleting')
      and app.marketplace_can_manage_catalog(p.seller_organization_id))
  or exists (
    select 1 from public.marketplace_payment_proofs pr
    where pr.object_key = p_key and pr.upload_state in ('awaiting_upload', 'deleting') and pr.created_by = (select auth.uid()))
  or exists (
    select 1 from public.marketplace_return_evidence e
    where e.object_key = p_key and e.upload_state in ('awaiting_upload', 'deleting') and e.created_by = (select auth.uid()));
$$;

-- Evidence that never reached a request is not kept (same lifecycle as an abandoned receipt).
create or replace function app.marketplace_media_cleanup_rows()
returns table (key text, owner uuid, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select i.object_key, i.created_by, i.created_at from public.marketplace_product_images i
  where i.created_by is not null
    and (i.upload_state = 'deleting' or (i.upload_state = 'awaiting_upload' and i.created_at < now() - interval '24 hours'))
  union all
  select pr.object_key, pr.created_by, pr.created_at from public.marketplace_payment_proofs pr
  where pr.upload_state = 'deleting'
     or (pr.upload_state = 'awaiting_upload' and pr.created_at < now() - interval '24 hours')
     or (pr.order_id is null and pr.created_at < now() - interval '24 hours')
  union all
  select e.object_key, e.created_by, e.created_at from public.marketplace_return_evidence e
  where e.upload_state = 'deleting'
     or (e.upload_state = 'awaiting_upload' and e.created_at < now() - interval '24 hours')
     or (e.return_id is null and e.created_at < now() - interval '24 hours');
$$;

create or replace function app.marketplace_media_retire(p_key text, p_owner uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.marketplace_product_images set upload_state = 'deleting', status = 'rejected', is_primary = false
   where object_key = p_key and created_by = p_owner
     and (upload_state = 'deleting' or (upload_state = 'awaiting_upload' and created_at < now() - interval '24 hours'));
  if found then return true; end if;
  update public.marketplace_payment_proofs set upload_state = 'deleting'
   where object_key = p_key and created_by = p_owner
     and (upload_state = 'deleting' or (upload_state = 'awaiting_upload' and created_at < now() - interval '24 hours')
          or (order_id is null and created_at < now() - interval '24 hours'));
  if found then return true; end if;
  update public.marketplace_return_evidence set upload_state = 'deleting'
   where object_key = p_key and created_by = p_owner
     and (upload_state = 'deleting' or (upload_state = 'awaiting_upload' and created_at < now() - interval '24 hours')
          or (return_id is null and created_at < now() - interval '24 hours'));
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Seeds: return reasons and their rules, rejection reasons (the ONE preset system, PR 5)
-- ---------------------------------------------------------------------------
with ins as (
  insert into public.marketplace_seller_message_presets (action, label_ar, label_en, text_ar, text_en, sort_order) values
    ('return_reason', 'غيّرت رأيي', 'I changed my mind',
     'المشتري غيّر رأيه ويريد إرجاع المنتج غير المستخدم.', 'The buyer changed their mind and wants to return the unused product.', 10),
    ('return_reason', 'طلبت منتجًا غير مناسب', 'I ordered the wrong product',
     'المشتري طلب منتجًا غير مناسب ويريد إرجاعه غير مستخدم.', 'The buyer ordered the wrong product and wants to return it unused.', 20),
    ('return_reason', 'المنتج به عيب', 'The product is defective',
     'المنتج به عيب مرفق بصور توضح العيب.', 'The product is defective; photos of the defect are attached.', 30),
    ('return_reason', 'استلمت منتجًا مختلفًا', 'I received a different product',
     'المنتج المستلم يختلف عن المنتج المطلوب.', 'The product received is different from the one ordered.', 40),
    ('return_reason', 'المنتج لا يطابق الوصف', 'The product is not as described',
     'المنتج لا يطابق وصفه في المتجر.', 'The product does not match its description in the store.', 50),
    ('return_reason', 'تضرر أثناء الشحن', 'Damaged in transit',
     'المنتج وصل متضررًا من الشحن مرفقًا بصور واضحة.', 'The product arrived damaged from shipping; clear photos are attached.', 60),
    ('return_reject', 'المنتج مستخدم', 'The product was used',
     'تم رفض الطلب لأن المنتج مستخدم ولا يستوفي شرط الإرجاع.', 'The request was rejected because the product was used and does not meet the return condition.', 10),
    ('return_reject', 'خارج مدة الإرجاع', 'Outside the return period',
     'تم رفض الطلب لأنه خارج مدة الإرجاع.', 'The request was rejected because it is outside the return period.', 20),
    ('return_reject', 'الصور لا تثبت العيب', 'Photos do not show a defect',
     'تم رفض الطلب لأن الصور المرفقة لا توضح العيب.', 'The request was rejected because the attached photos do not show a defect.', 30),
    ('return_reject', 'منتج مصنوع حسب الطلب', 'Made-to-order product',
     'تم رفض الطلب لأن المنتج مصنوع حسب الطلب ولا يقبل الإرجاع دون عيب.', 'The request was rejected because the product is made to order and cannot be returned without a defect.', 40)
  returning id, label_en
)
insert into public.marketplace_return_reason_rules (preset_id, claim_type, requires_evidence, shipping_payer, transit_damage)
select ins.id, v.claim, v.evidence, v.payer, v.transit
  from ins join (values
    ('I changed my mind', 'general', false, 'buyer', false),
    ('I ordered the wrong product', 'general', false, 'buyer', false),
    ('The product is defective', 'defect', true, 'seller', false),
    ('I received a different product', 'defect', true, 'seller', false),
    ('The product is not as described', 'defect', true, 'seller', false),
    ('Damaged in transit', 'defect', true, 'seller', true)) as v(label_en, claim, evidence, payer, transit)
    on v.label_en = ins.label_en;

insert into public.notification_templates
  (key, event_type, variables, default_title_ar, default_body_ar, default_title_en, default_body_en) values
  ('marketplace.return.requested', 'marketplace.return.requested', array['order_number', 'request_number', 'showroom_name'],
   'طلب إرجاع جديد', 'وصلك طلب إرجاع أو استبدال {request_number} للطلب {order_number}. لديك 72 ساعة للرد.',
   'New return request', 'A return or exchange request {request_number} arrived for order {order_number}. You have 72 hours to respond.'),
  ('marketplace.return.approved', 'marketplace.return.approved', array['order_number', 'request_number', 'showroom_name', 'message'],
   'تمت الموافقة على طلبك', 'وافق {showroom_name} على طلب الإرجاع {request_number}. {message}',
   'Your request was approved', '{showroom_name} approved your return request {request_number}. {message}'),
  ('marketplace.return.rejected', 'marketplace.return.rejected', array['order_number', 'request_number', 'showroom_name', 'message'],
   'تم رفض طلبك', 'رفض {showroom_name} طلب الإرجاع {request_number}. {message}',
   'Your request was rejected', '{showroom_name} rejected your return request {request_number}. {message}'),
  ('marketplace.return.received', 'marketplace.return.received', array['order_number', 'request_number', 'showroom_name'],
   'تم استلام المرتجع', 'استلم {showroom_name} المرتجع الخاص بالطلب {request_number}.',
   'Your return was received', '{showroom_name} received the items of your return {request_number}.'),
  ('marketplace.return.refund_sent', 'marketplace.return.refund_sent', array['order_number', 'request_number', 'showroom_name', 'amount'],
   'تم إرسال المبلغ المسترد', 'أرسل {showroom_name} مبلغ {amount} للطلب {request_number}. أكّد استلامك للمبلغ.',
   'Your refund was sent', '{showroom_name} sent a refund of {amount} for {request_number}. Please confirm that you received it.'),
  ('marketplace.return.refund_confirmed', 'marketplace.return.refund_confirmed', array['order_number', 'request_number', 'amount'],
   'أكّد المشتري استلام المبلغ', 'أكّد المشتري استلام المبلغ المسترد للطلب {request_number}.',
   'The buyer confirmed the refund', 'The buyer confirmed receiving the refund for {request_number}.'),
  ('marketplace.return.seller_reminder', 'marketplace.return.seller_reminder', array['order_number', 'request_number', 'hours_left'],
   'تذكير بطلب إرجاع', 'طلب الإرجاع {request_number} ينتظر ردك. المتبقي {hours_left} ساعة.',
   'Reminder: return request', 'Return request {request_number} is waiting for you. {hours_left} hours left.'),
  ('marketplace.return.escalated', 'marketplace.return.escalated', array['order_number', 'request_number'],
   'مرتجع يحتاج مراجعة', 'تم تحويل المرتجع {request_number} إلى قائمة مراجعة المرتجعات.',
   'A return needs review', 'Return {request_number} was moved to the returns review queue.'),
  ('marketplace.return.admin_reminder', 'marketplace.return.admin_reminder', array['order_number', 'request_number'],
   'تذكير من الإدارة', 'تذكير من الإدارة: المرتجع {request_number} ينتظر إجراءك.',
   'Reminder from the administration', 'Reminder from the administration: return {request_number} is waiting for your action.'),
  ('marketplace.return.admin_decided', 'marketplace.return.admin_decided', array['order_number', 'request_number', 'message'],
   'قرار الإدارة في المرتجع', 'أصدرت الإدارة قرارًا في المرتجع {request_number}. {message}',
   'Administration decision on a return', 'The administration decided on return {request_number}. {message}');

-- ---------------------------------------------------------------------------
-- 13. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and (p.proname like 'marketplace\_return\_%' or p.proname in ('marketplace_evidence_require_verified_media',
      'marketplace_order_returns_json', 'marketplace_order_return_window', 'marketplace_media_can_upload', 'marketplace_media_can_delete',
      'marketplace_media_cleanup_rows', 'marketplace_media_retire'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
  end loop;
end;
$$;

revoke all on function
  public.marketplace_buyer_return_eligibility(uuid),
  public.marketplace_buyer_return_request_upload(uuid, text),
  public.marketplace_buyer_return_evidence_confirm(uuid),
  public.marketplace_buyer_return_create(uuid, text, jsonb, uuid, text, uuid[], text, text),
  public.marketplace_buyer_return_cancel(uuid),
  public.marketplace_buyer_return_mark_shipped(uuid, text),
  public.marketplace_buyer_refund_confirm(uuid),
  public.marketplace_buyer_returns(integer, integer),
  public.marketplace_buyer_return_get(uuid),
  public.marketplace_seller_returns_page(uuid, text, integer, integer),
  public.marketplace_seller_return_get(uuid),
  public.marketplace_seller_return_decide(uuid, text, uuid, text, text, numeric),
  public.marketplace_seller_return_receive(uuid, jsonb),
  public.marketplace_seller_refund_record(uuid, numeric, text),
  public.marketplace_seller_exchange_fulfil(uuid, text),
  public.marketplace_seller_return_settings_get(uuid),
  public.marketplace_seller_return_settings_save(uuid, jsonb),
  public.marketplace_seller_product_returnability_set(uuid, uuid, boolean),
  public.marketplace_return_complaint_file(uuid, text),
  public.admin_marketplace_returns(text, text, integer, integer),
  public.admin_marketplace_return_get(uuid),
  public.admin_marketplace_return_remind_seller(uuid),
  public.admin_marketplace_return_decide(uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.marketplace_buyer_return_eligibility(uuid),
  public.marketplace_buyer_return_request_upload(uuid, text),
  public.marketplace_buyer_return_evidence_confirm(uuid),
  public.marketplace_buyer_return_create(uuid, text, jsonb, uuid, text, uuid[], text, text),
  public.marketplace_buyer_return_cancel(uuid),
  public.marketplace_buyer_return_mark_shipped(uuid, text),
  public.marketplace_buyer_refund_confirm(uuid),
  public.marketplace_buyer_returns(integer, integer),
  public.marketplace_buyer_return_get(uuid),
  public.marketplace_seller_returns_page(uuid, text, integer, integer),
  public.marketplace_seller_return_get(uuid),
  public.marketplace_seller_return_decide(uuid, text, uuid, text, text, numeric),
  public.marketplace_seller_return_receive(uuid, jsonb),
  public.marketplace_seller_refund_record(uuid, numeric, text),
  public.marketplace_seller_exchange_fulfil(uuid, text),
  public.marketplace_seller_return_settings_get(uuid),
  public.marketplace_seller_return_settings_save(uuid, jsonb),
  public.marketplace_seller_product_returnability_set(uuid, uuid, boolean),
  public.marketplace_return_complaint_file(uuid, text),
  public.admin_marketplace_returns(text, text, integer, integer),
  public.admin_marketplace_return_get(uuid),
  public.admin_marketplace_return_remind_seller(uuid),
  public.admin_marketplace_return_decide(uuid, text, text, text, text)
  to authenticated;
