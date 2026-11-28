-- Forward-fix "marketplace-retest": restore what 20261128150001_marketplace_retest_notes.sql changed.
-- NOT a down migration and NOT applied anywhere. Use only with the owner's explicit approval, on a hosted database, through the Supabase migration path
-- as a NEW migration (never the SQL Editor), and only if the migration must be undone. The deployed frontend works with and without it.
--
-- Restores the 6 replaced functions to their previous definitions (pg_get_functiondef read on the scratch pre-state at 266; same signatures, so grants are
-- unchanged) and drops the new internal helper app.marketplace_money.
-- NOT undone, because it is data: invoices and notifications written meanwhile keep their text.
-- SAFETY: RAISES (nothing is changed) if a later migration was applied or another function started using the helper. Idempotent. Generated and proved by
-- scripts/hosted-db/marketplace-retest-scratch-proof.mjs.
begin;

do $guard$
declare
  n bigint;
begin
  select count(*) into n from supabase_migrations.schema_migrations where version > '20261128150001';
  if n <> 0 then raise exception 'marketplace-retest forward-fix refused: % later migration(s) are applied', n; end if;
  select count(*) into n from pg_proc p where p.pronamespace in ('app'::regnamespace, 'public'::regnamespace)
    and p.proname not in ('marketplace_money', 'marketplace_order_notify', 'marketplace_return_notify', 'marketplace_seller_cancel_refund_record', 'marketplace_buyer_cancel_refund_confirm') and position('app.marketplace_money(' in p.prosrc) > 0;
  if n <> 0 then raise exception 'marketplace-retest forward-fix refused: % other function(s) use app.marketplace_money', n; end if;
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
    jsonb_build_object('name', o.buyer_name, 'address', o.address_text,
      'governorate_key', o.governorate_key, 'area_key', o.area_key, 'address_parts', o.address_snapshot),
    coalesce((select jsonb_agg(jsonb_build_object('sku', i.sku, 'name_ar', i.name_ar, 'name_en', i.name_en,
        'variant_label', i.variant_label,
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
  v_ar := jsonb_build_object('delivery_date', app.marketplace_date_range(o.delivery_estimate_earliest, o.delivery_estimate_latest, true), 'message', coalesce(p_vars ->> 'message_ar', ''),
                             'total', trim(to_char(o.total_egp, 'FM999,999,990.00')) || ' ج.م');
  v_en := jsonb_build_object('delivery_date', app.marketplace_date_range(o.delivery_estimate_earliest, o.delivery_estimate_latest, false), 'message', coalesce(p_vars ->> 'message_en', ''),
                             'total', trim(to_char(o.total_egp, 'FM999,999,990.00')) || ' EGP');
  if p_event in ('placed', 'cancelled_by_buyer', 'receipt_resubmitted', 'reminder_seller_start') then
    perform app.marketplace_notify_order_managers(o.id, v_key, v_vars, v_ar, v_en);
  else
    perform app.notify_from_template(o.buyer_user_id, null, v_key, 'marketplace_order', o.id, '/market/orders/' || o.id, v_vars, v_ar, v_en);
  end if;
end;
$function$;

-- app.marketplace_return_notify(uuid,text,text,text,text,integer)
CREATE OR REPLACE FUNCTION app.marketplace_return_notify(p_return uuid, p_event text, p_to text, p_msg_ar text DEFAULT NULL::text, p_msg_en text DEFAULT NULL::text, p_hours_left integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

-- public.marketplace_buyer_cancel_refund_confirm(uuid)
CREATE OR REPLACE FUNCTION public.marketplace_buyer_cancel_refund_confirm(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  o     public.marketplace_orders;
  v_amount numeric;
begin
  if v_uid is null then raise exception 'mp:auth_required' using errcode = '42501'; end if;
  select * into o from public.marketplace_orders where id = p_order_id and buyer_user_id = v_uid for update;
  if not found then raise exception 'mp:not_found' using errcode = '42501'; end if;
  if o.payment_status = 'refunded'
     and exists (select 1 from public.marketplace_order_events e where e.order_id = o.id and e.action = 'cancel_refund_confirmed') then
    return app.marketplace_order_document_v2(o.id, 'buyer');           -- replay
  end if;
  if o.source <> 'v2' or o.status <> 'cancelled' or o.payment_status <> 'refund_due'
     or not exists (select 1 from public.marketplace_order_events e where e.order_id = o.id and e.action = 'cancel_refund_sent')
     or exists (select 1 from public.marketplace_payment_complaints c where c.order_id = o.id and c.state in ('open', 'under_review')) then
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  v_amount := coalesce(o.paid_now_egp, o.total_egp);
  perform set_config('app.marketplace_order_apply', 'on', true);
  update public.marketplace_orders set payment_status = 'refunded' where id = o.id;
  perform set_config('app.marketplace_order_apply', 'off', true);
  insert into public.marketplace_order_events (order_id, action, from_status, to_status, from_payment, to_payment, actor_user_id, actor_role)
  values (o.id, 'cancel_refund_confirmed', o.status, o.status, o.payment_status, 'refunded', v_uid, 'buyer');
  perform app.marketplace_notify_order_managers(o.id, 'marketplace.order.refund_confirmed',
    jsonb_build_object('order_number', o.order_number),
    jsonb_build_object('amount', trim(to_char(v_amount, 'FM999,999,990.00')) || ' ج.م'),
    jsonb_build_object('amount', trim(to_char(v_amount, 'FM999,999,990.00')) || ' EGP'));
  return app.marketplace_order_document_v2(o.id, 'buyer');
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
    'latitude', o.latitude, 'longitude', o.longitude, 'address_parts', o.address_snapshot,
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(nullif(i.name_ar, ''), i.name_en), 'sku', i.sku,
        'quantity', i.quantity) order by i.created_at, i.sku)
      from public.marketplace_order_items i where i.order_id = o.id), '[]'::jsonb),
    'payment', jsonb_build_object('method', o.payment_method,
      'collect_on_delivery_egp', case when o.payment_status in ('collected', 'refund_due', 'refunded') then 0
        else greatest(coalesce(o.balance_due_egp, 0), 0) end),
    'tracking_number', (select sh.tracking_number from public.marketplace_order_shipments sh where sh.order_id = o.id),
    'notes', o.buyer_note);
end;
$function$;

-- public.marketplace_seller_cancel_refund_record(uuid,text)
CREATE OR REPLACE FUNCTION public.marketplace_seller_cancel_refund_record(p_order_id uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid  uuid := (select auth.uid());
  o      public.marketplace_orders;
  v_note text := nullif(btrim(p_note), '');
  v_amount numeric;
begin
  if v_uid is null then raise exception 'mp:auth_required' using errcode = '42501'; end if;
  select * into o from public.marketplace_orders where id = p_order_id for update;
  if not found or not app.marketplace_can_manage_orders(o.seller_organization_id) then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  if v_note is not null and char_length(v_note) > 300 then raise exception 'mp:invalid_payload' using errcode = '22023'; end if;
  if o.source <> 'v2' then raise exception 'mp:legacy_order' using errcode = '23514'; end if;
  if o.status <> 'cancelled' or o.payment_status <> 'refund_due' then
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  if exists (select 1 from public.marketplace_order_events e where e.order_id = o.id and e.action = 'cancel_refund_sent') then
    return app.marketplace_order_document_v2(o.id, 'seller');          -- replay
  end if;
  if exists (select 1 from public.marketplace_payment_complaints c where c.order_id = o.id and c.state in ('open', 'under_review')) then
    raise exception 'mp:invalid_transition' using errcode = '23514';   -- the admin rules on the complaint first
  end if;
  v_amount := coalesce(o.paid_now_egp, o.total_egp);
  insert into public.marketplace_order_events (order_id, action, from_status, to_status, from_payment, to_payment, actor_user_id, actor_role, note)
  values (o.id, 'cancel_refund_sent', o.status, o.status, o.payment_status, o.payment_status, v_uid, 'seller', v_note);
  perform app.notify_from_template(o.buyer_user_id, null, 'marketplace.order.refund_sent', 'marketplace_order', o.id,
    '/market/orders/' || o.id::text,
    jsonb_build_object('order_number', o.order_number,
      'showroom_name', (select org.name from public.organizations org where org.id = o.seller_organization_id)),
    jsonb_build_object('amount', trim(to_char(v_amount, 'FM999,999,990.00')) || ' ج.م'),
    jsonb_build_object('amount', trim(to_char(v_amount, 'FM999,999,990.00')) || ' EGP'));
  return app.marketplace_order_document_v2(o.id, 'seller');
end;
$function$;

drop function if exists app.marketplace_money(numeric, boolean);

commit;
