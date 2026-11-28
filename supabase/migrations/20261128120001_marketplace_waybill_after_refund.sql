-- Waybill: nothing is collected once a refund is owed or done, and the labelled address parts are returned.
--
-- Found in the Acceptance test round: a delivered order whose money was collected and then refunded still printed
-- "Collect on delivery". balance_due_egp keeps the original amount, and the read zeroed it for 'collected' only.
-- Read-only function replaced in place: same signature, grants and settings; no table or data change.

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
    'payment', jsonb_build_object('method', o.payment_method,
      'collect_on_delivery_egp', case when o.payment_status in ('collected', 'refund_due', 'refunded') then 0
        else greatest(coalesce(o.balance_due_egp, 0), 0) end),
    'tracking_number', (select sh.tracking_number from public.marketplace_order_shipments sh where sh.order_id = o.id),
    'notes', o.buyer_note);
end;
$$;
