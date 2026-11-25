-- ===========================================================================
-- Marketplace PR 13 (3/3) — order document: the `invoice` key
-- ===========================================================================
-- Contract section 4.3 / 4.6: PR 13 rebuilds app.marketplace_order_document_v2 on PR 12's body and ADDS ONE THING, the
-- `invoice` key ({ number, issued_at } once an invoice exists, else null). Everything else is PR 12's text, unchanged.
-- Same signature, same grants (internal function, no client grant). Nothing dropped. NEEDS: PR 12 and 130001.
-- PR 14 fills payment.dispute.complaint_id and PR 15 return_window / returns through PR 12's hooks
-- (app.marketplace_order_complaint_id, app.marketplace_order_extra_actions) or by rebuilding on this body.
-- ===========================================================================

create or replace function app.marketplace_order_document_v2(p_order uuid, p_for text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.marketplace_orders;
  v_seller boolean := p_for in ('seller', 'admin');
  v_dispute_event public.marketplace_order_events;
  v_cancel public.marketplace_order_cancellations;
  v_ship public.marketplace_order_shipments;
  v_start_due timestamptz;
  v_resub_due timestamptz;
begin
  select * into o from public.marketplace_orders where id = p_order;
  if not found then
    return null;
  end if;
  select * into v_cancel from public.marketplace_order_cancellations where order_id = o.id;
  select * into v_ship from public.marketplace_order_shipments where order_id = o.id;
  select t.expires_at into v_start_due from public.marketplace_timers t
   where t.subject_type = 'order' and t.subject_id = o.id and t.kind = 'order_seller_start' and t.state = 'active';
  select t.expires_at into v_resub_due from public.marketplace_timers t
   where t.subject_type = 'order' and t.subject_id = o.id and t.kind = 'order_receipt_resubmit' and t.state = 'active';
  if o.payment_status = 'receipt_disputed' then
    select e.* into v_dispute_event from public.marketplace_order_events e
     where e.order_id = o.id and e.action = 'receipt_disputed' order by e.sequence desc limit 1;
  end if;
  return jsonb_build_object(
    'id', o.id, 'order_number', o.order_number, 'checkout_id', o.checkout_id, 'status', o.status,
    'payment_method', o.payment_method, 'payment_status', o.payment_status, 'fulfilment', o.fulfilment,
    'delivery_speed', o.delivery_speed, 'viewer', p_for, 'source', o.source,
    'seller', jsonb_build_object('name', (select org.name from public.organizations org where org.id = o.seller_organization_id)),
    'recipient', jsonb_build_object('name', o.buyer_name, 'phone', case when p_for = 'admin' then null else o.buyer_phone end),
    'place', jsonb_build_object('governorate_key', o.governorate_key, 'area_key', o.area_key, 'address_text', o.address_text,
      'latitude', o.latitude, 'longitude', o.longitude, 'address_snapshot', o.address_snapshot),
    'pickup', case when o.fulfilment = 'pickup' then jsonb_build_object(
      'address', (select coalesce(b.address_ar, b.address_en) from public.marketplace_stock_locations sl
                    join public.branches b on b.id = sl.branch_id
                   where sl.organization_id = o.seller_organization_id and sl.is_active and sl.supports_pickup
                   order by (sl.key = 'main') desc limit 1),
      'instructions', (select s.pickup_instructions from public.marketplace_seller_delivery_settings s
                        where s.seller_organization_id = o.seller_organization_id)) end,
    'totals', jsonb_build_object('subtotal_egp', o.subtotal_egp, 'delivery_fee_egp', o.delivery_fee_egp, 'total_egp', o.total_egp,
      'paid_now_egp', o.paid_now_egp, 'balance_due_egp', o.balance_due_egp,
      'deposit_percent', o.deposit_percent, 'deposit_egp', o.deposit_egp),
    'payment', jsonb_build_object(
      'method', o.payment_method, 'status', o.payment_status,
      'instapay', case when o.instapay_address is not null
        then jsonb_build_object('address', o.instapay_address, 'account_name', o.instapay_account_name) end,
      'receipts', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'object_key', pr.object_key, 'status', pr.status,
          'purpose', pr.purpose, 'declared_amount_egp', pr.declared_amount_egp, 'review_note', pr.review_note,
          'created_at', pr.created_at) order by pr.created_at)
        from public.marketplace_payment_proofs pr where pr.order_id = o.id and pr.upload_state = 'confirmed'), '[]'::jsonb),
      'dispute', case when o.payment_status = 'receipt_disputed' then jsonb_build_object(
        'flagged_at', v_dispute_event.created_at, 'resubmit_due_at', v_resub_due,
        'message_ar', v_dispute_event.payload ->> 'message_ar', 'message_en', v_dispute_event.payload ->> 'message_en',
        'complaint_id', app.marketplace_order_complaint_id(o.id)) end),
    'delivery', jsonb_build_object(
      'estimate', case when o.delivery_estimate_earliest is not null then jsonb_build_object(
        'earliest', to_char(o.delivery_estimate_earliest, 'YYYY-MM-DD'), 'latest', to_char(o.delivery_estimate_latest, 'YYYY-MM-DD')) end,
      'shipment', case when v_ship.id is not null then jsonb_build_object(
        'carrier_name', v_ship.carrier_name, 'tracking_number', v_ship.tracking_number, 'shipped_at', v_ship.shipped_at) end),
    'timestamps', jsonb_build_object('placed_at', o.placed_at, 'preparing_at', o.preparing_at, 'ready_at', o.ready_at,
      'shipped_at', o.shipped_at, 'delivered_at', o.delivered_at, 'cancelled_at', o.cancelled_at),
    'cancellation', case when v_cancel.id is not null then jsonb_build_object(
      'by', v_cancel.cancelled_by_role, 'label_ar', v_cancel.label_ar, 'label_en', v_cancel.label_en,
      'message_ar', v_cancel.message_ar, 'message_en', v_cancel.message_en,
      'internal_note', case when v_seller then v_cancel.internal_note end) end,
    'timers', jsonb_build_object(
      'seller_start_due_at', case when v_seller then v_start_due end, 'receipt_resubmit_due_at', v_resub_due),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'slug', i.product_slug, 'sku', i.sku, 'name_ar', i.name_ar,
        'name_en', i.name_en, 'variant_label', i.variant_label, 'selling_unit', i.selling_unit, 'unit_price_egp', i.unit_price_egp,
        'quantity', i.quantity, 'line_total_egp', i.line_total_egp, 'image_id', i.image_id, 'non_returnable', i.non_returnable,
        'free_shipping', i.free_shipping, 'quantity_returned', i.quantity_returned) order by i.created_at, i.sku)
      from public.marketplace_order_items i where i.order_id = o.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'action', e.action, 'to_status', e.to_status,
        'to_payment', e.to_payment, 'actor_role', e.actor_role,
        'note', e.note, 'at', e.created_at) order by e.sequence)
      from public.marketplace_order_events e
      where e.order_id = o.id and (v_seller or e.action not in ('reminder_seller_start', 'reminder_receipt_resubmit', 'invoice_issued'))), '[]'::jsonb),
    'actions', to_jsonb(app.marketplace_order_actions(o.id, p_for)),
    'invoice', (select jsonb_build_object('number', inv.invoice_number, 'issued_at', inv.issued_at)
                  from public.marketplace_order_invoices inv where inv.order_id = o.id),
    'return_window', null,
    'returns', '[]'::jsonb);
end;
$$;

revoke all on function app.marketplace_order_document_v2(uuid, text) from public, anon, authenticated, service_role;
