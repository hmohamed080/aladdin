-- Acceptance retest notes (test log F07, F09, F27). Functions only: no table, column or row changes.
--
-- F07: an invoice printed no seller address. The address came only from the branch linked to the stock location,
--      and the location created automatically ('main') has no branch. The invoice now falls back to the oldest
--      active branch of the showroom that has an address. Issued invoices never change.
-- F09: notifications wrote money as "150.00 EGP" while the pages write "EGP 150".
-- F27: the waybill of a refunded order said "paid in full". The read now returns the payment status.

-- ---------------------------------------------------------------------------
-- 1. Money as the pages write it
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_money(p_amount numeric, p_ar boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_ar then n || ' ج.م' else 'EGP ' || n end
  from (select case when p_amount = trunc(p_amount) then trim(to_char(p_amount, 'FM999,999,990'))
                    else trim(to_char(p_amount, 'FM999,999,990.00')) end as n) f;
$$;
revoke all on function app.marketplace_money(numeric, boolean) from public, anon, authenticated, service_role;

do $do$
declare
  v_oid oid;
  v_def text;
  v_new text;
begin
  foreach v_oid in array array[
    'app.marketplace_order_notify(uuid, text, jsonb)'::regprocedure,
    'app.marketplace_return_notify(uuid, text, text, text, text, integer)'::regprocedure,
    'public.marketplace_seller_cancel_refund_record(uuid, text)'::regprocedure,
    'public.marketplace_buyer_cancel_refund_confirm(uuid)'::regprocedure
  ]::oid[]
  loop
    v_def := pg_get_functiondef(v_oid);
    v_new := regexp_replace(v_def,
      $re$trim\(to_char\(([a-z_.]+), 'FM999,999,990\.00'\)\) \|\| ' ج\.م'$re$, $to$app.marketplace_money(\1, true)$to$, 'g');
    v_new := regexp_replace(v_new,
      $re$trim\(to_char\(([a-z_.]+), 'FM999,999,990\.00'\)\) \|\| ' EGP'$re$, $to$app.marketplace_money(\1, false)$to$, 'g');
    if v_new = v_def or position('FM999,999,990.00' in v_new) > 0 then
      raise exception 'money format patch failed for %', v_oid::regprocedure;
    end if;
    execute v_new;
  end loop;
end;
$do$;

-- ---------------------------------------------------------------------------
-- 2. Invoices issued from now on: the seller address
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_order_invoice_issue(p_order uuid, p_actor_role text)
returns public.marketplace_order_invoices
language plpgsql
security definer
set search_path = ''
as $$
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
      'address', coalesce(
        -- the branch behind a stock location (the main location first)
        (select coalesce(nullif(btrim(b.address_ar), ''), nullif(btrim(b.address_en), ''))
           from public.marketplace_stock_locations sl
           join public.branches b on b.id = sl.branch_id
          where sl.organization_id = o.seller_organization_id and sl.is_active
          order by (sl.key = 'main') desc, sl.created_at limit 1),
        -- otherwise the showroom's oldest active branch that has an address
        (select coalesce(nullif(btrim(b.address_ar), ''), nullif(btrim(b.address_en), ''))
           from public.branches b
          where b.organization_id = o.seller_organization_id and b.is_active and b.deleted_at is null
            and coalesce(nullif(btrim(b.address_ar), ''), nullif(btrim(b.address_en), '')) is not null
          order by b.created_at, b.id limit 1))),
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
$$;

-- ---------------------------------------------------------------------------
-- 3. Waybill: say why nothing is collected
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_order_waybill_get(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    'payment', jsonb_build_object('method', o.payment_method, 'status', o.payment_status,
      'collect_on_delivery_egp', case when o.payment_status in ('collected', 'refund_due', 'refunded') then 0
        else greatest(coalesce(o.balance_due_egp, 0), 0) end),
    'tracking_number', (select sh.tracking_number from public.marketplace_order_shipments sh where sh.order_id = o.id),
    'notes', o.buyer_note);
end;
$$;
