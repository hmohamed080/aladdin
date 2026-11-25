-- ===========================================================================
-- Marketplace PR 13 (2/3) — order reads, invoice, waybill and shipment correction
-- ===========================================================================
-- Contract: docs/product/marketplace-order-model-contract-20261124.md section 4.3. NEEDS: PR 12 (order model, document v2,
-- actions) and migration 130001 (invoices). DROPS nothing, changes no signature of a promoted function.
--
-- ADDS (public): marketplace_buyer_orders_v2, marketplace_buyer_order_get_v2, marketplace_seller_orders_page_v2,
--   marketplace_seller_order_get_v2, marketplace_order_invoice_get, marketplace_order_waybill_get,
--   marketplace_seller_order_shipment_update.
-- ADDS (internal): app.marketplace_order_summary, app.marketplace_order_search_match, app.marketplace_order_tab_statuses.
-- PR 13 adds NO transition: the shipment correction edits carrier and tracking only and writes the `shipment_updated`
-- event; every status or payment change stays in PR 12's app.marketplace_order_apply.
--
-- DEVIATIONS FROM THE CONTRACT (small, recorded in the PR body):
--   * shipment_update is allowed in `shipped` only. Pre-filling in `ready` is not needed: marketplace_seller_order_action
--     `mark_shipped` already takes carrier and tracking in its payload, and a shipment row before shipping would show
--     the buyer a shipped_at that is not true.
--   * a new error code `mp:invoice_not_available` (an order that was cancelled before it was ready has no invoice);
--     `mp:not_a_delivery_order` is the contract's.
--
-- SECURITY. SECURITY DEFINER with search_path = '', every function re-checks the caller: a buyer reads only his own
-- orders; the seller functions need app.marketplace_can_manage_orders of the order's showroom; anyone else gets
-- mp:not_found (errcode 42501), which does not reveal that the order exists. The buyer's documents never carry the
-- seller's contact details or the internal cancellation note. The waybill carries the recipient phone for the
-- courier, for the seller only. Invoice and waybill are built from the order snapshot (never from the live
-- address book, catalogue or prices). Receipts are not read here: a document lists their keys and the media
-- resolver (unchanged) decides who may open one.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------
-- The statuses behind one seller tab (legacy values map to their v2 equivalent, delivery_failed / returned sit under "shipped").
create or replace function app.marketplace_order_tab_statuses(p_tab text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_tab
    when 'new' then array['new', 'pending_confirmation']
    when 'in_preparation' then array['preparing', 'ready', 'confirmed', 'processing', 'ready_for_pickup']
    when 'shipped' then array['shipped', 'delivery_failed', 'returned']
    when 'delivered' then array['delivered']
    when 'cancelled' then array['cancelled']
  end;
$$;

create or replace function app.marketplace_escape_like(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(p_text, '\', '\\'), '%', '\%'), '_', '\_');
$$;

-- Does an order match a typed search: order number, product name (either language), SKU; the seller view also matches the buyer name.
create or replace function app.marketplace_order_search_match(p_order public.marketplace_orders, p_pattern text, p_include_buyer boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_pattern is null
     or p_order.order_number ilike p_pattern
     or (p_include_buyer and p_order.buyer_name ilike p_pattern)
     or exists (select 1 from public.marketplace_order_items i
                 where i.order_id = p_order.id
                   and (i.name_ar ilike p_pattern or i.name_en ilike p_pattern or i.sku ilike p_pattern));
$$;

-- One row of an order list (contract 4.1 "Order summary"). Buyer name and governorate are filled for the seller only.
create or replace function app.marketplace_order_summary(p_order public.marketplace_orders, p_for text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_order.id, 'order_number', p_order.order_number, 'status', p_order.status,
    'payment_method', p_order.payment_method, 'payment_status', p_order.payment_status, 'fulfilment', p_order.fulfilment,
    'total_egp', p_order.total_egp, 'placed_at', p_order.placed_at, 'delivered_at', p_order.delivered_at,
    'estimate', case when p_order.delivery_estimate_earliest is not null then jsonb_build_object(
        'earliest', to_char(p_order.delivery_estimate_earliest, 'YYYY-MM-DD'),
        'latest', to_char(p_order.delivery_estimate_latest, 'YYYY-MM-DD')) end,
    'item_count', (select coalesce(sum(i.quantity), 0) from public.marketplace_order_items i where i.order_id = p_order.id),
    'first_items', coalesce((select jsonb_agg(jsonb_build_object('name_ar', f.name_ar, 'name_en', f.name_en,
          'image_id', f.image_id, 'quantity', f.quantity) order by f.created_at, f.sku)
        from (select i.* from public.marketplace_order_items i where i.order_id = p_order.id
               order by i.created_at, i.sku limit 4) f), '[]'::jsonb),
    'seller_name', (select org.name from public.organizations org where org.id = p_order.seller_organization_id),
    'buyer_name', case when p_for = 'seller' then p_order.buyer_name end,
    'governorate_key', case when p_for = 'seller' then p_order.governorate_key end,
    'has_dispute', p_order.payment_status = 'receipt_disputed',
    'action_needed', case when p_for = 'seller'
        then p_order.source = 'v2' and p_order.status in ('new', 'preparing', 'ready')
             and p_order.payment_status in ('receipt_submitted', 'receipt_disputed')
        else p_order.source = 'v2' and p_order.status in ('preparing', 'ready') and p_order.payment_status = 'receipt_disputed' end);
$$;

-- ---------------------------------------------------------------------------
-- 2. Buyer: list and one order
-- ---------------------------------------------------------------------------
-- p_period 3m | 6m | 1y | all (null = 3m); p_status is a buyer group: active | delivered | cancelled (null = all).
create or replace function public.marketplace_buyer_orders_v2(p_search text default null, p_period text default '3m',
  p_status text default null, p_limit integer default 20, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_since timestamptz;
  v_statuses text[];
  v_pattern text := case when nullif(btrim(p_search), '') is null then null
                         else '%' || app.marketplace_escape_like(left(btrim(p_search), 80)) || '%' end;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
begin
  if v_uid is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  if coalesce(p_period, '3m') not in ('3m', '6m', '1y', 'all') or coalesce(p_status, 'all') not in ('all', 'active', 'delivered', 'cancelled') then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  v_since := case coalesce(p_period, '3m')
    when '3m' then now() - interval '3 months'
    when '6m' then now() - interval '6 months'
    when '1y' then now() - interval '1 year'
    else null end;
  v_statuses := case coalesce(p_status, 'all')
    when 'active' then array['new', 'preparing', 'ready', 'shipped', 'delivery_failed',
                             'pending_confirmation', 'confirmed', 'processing', 'ready_for_pickup']
    when 'delivered' then array['delivered']
    when 'cancelled' then array['cancelled', 'returned']
    else null end;

  select count(*) into v_total from public.marketplace_orders o
   where o.buyer_user_id = v_uid and (v_since is null or o.placed_at >= v_since)
     and (v_statuses is null or o.status = any (v_statuses))
     and app.marketplace_order_search_match(o, v_pattern, false);
  select coalesce(jsonb_agg(app.marketplace_order_summary(q, 'buyer') order by q.placed_at desc, q.id), '[]'::jsonb) into v_items
    from (select o.* from public.marketplace_orders o
           where o.buyer_user_id = v_uid and (v_since is null or o.placed_at >= v_since)
             and (v_statuses is null or o.status = any (v_statuses))
             and app.marketplace_order_search_match(o, v_pattern, false)
           order by o.placed_at desc, o.id limit v_limit offset v_offset) q;
  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

create or replace function public.marketplace_buyer_order_get_v2(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.marketplace_orders where id = p_order_id and buyer_user_id = (select auth.uid())) then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  return app.marketplace_order_document_v2(p_order_id, 'buyer');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Seller: tabs and one order
-- ---------------------------------------------------------------------------
-- Dates are calendar days in Africa/Cairo (same rule as the delivery estimate).
create or replace function public.marketplace_seller_orders_page_v2(p_organization_id uuid, p_tab text default null,
  p_search text default null, p_from date default null, p_to date default null,
  p_limit integer default 25, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pattern text := case when nullif(btrim(p_search), '') is null then null
                         else '%' || app.marketplace_escape_like(left(btrim(p_search), 80)) || '%' end;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_statuses text[];
  v_counts jsonb;
  v_total bigint;
  v_items jsonb;
  v_attention bigint;
begin
  if not app.marketplace_can_manage_orders(p_organization_id) then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  if p_tab is not null then
    v_statuses := app.marketplace_order_tab_statuses(p_tab);
    if v_statuses is null then
      raise exception 'mp:invalid_payload' using errcode = '22023';
    end if;
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;

  -- counts follow the search and the dates but not the tab, so every tab shows what it would list
  select jsonb_build_object(
      'new', count(*) filter (where o.status = any (app.marketplace_order_tab_statuses('new'))),
      'in_preparation', count(*) filter (where o.status = any (app.marketplace_order_tab_statuses('in_preparation'))),
      'shipped', count(*) filter (where o.status = any (app.marketplace_order_tab_statuses('shipped'))),
      'delivered', count(*) filter (where o.status = any (app.marketplace_order_tab_statuses('delivered'))),
      'cancelled', count(*) filter (where o.status = any (app.marketplace_order_tab_statuses('cancelled'))))
    into v_counts
    from public.marketplace_orders o
   where o.seller_organization_id = p_organization_id
     and (p_from is null or (o.placed_at at time zone 'Africa/Cairo')::date >= p_from)
     and (p_to is null or (o.placed_at at time zone 'Africa/Cairo')::date <= p_to)
     and app.marketplace_order_search_match(o, v_pattern, true);
  select count(*) into v_total from public.marketplace_orders o
   where o.seller_organization_id = p_organization_id and (v_statuses is null or o.status = any (v_statuses))
     and (p_from is null or (o.placed_at at time zone 'Africa/Cairo')::date >= p_from)
     and (p_to is null or (o.placed_at at time zone 'Africa/Cairo')::date <= p_to)
     and app.marketplace_order_search_match(o, v_pattern, true);
  select count(*) into v_attention from public.marketplace_orders o
   where o.seller_organization_id = p_organization_id and o.source = 'v2' and o.status in ('new', 'preparing', 'ready')
     and o.payment_status in ('receipt_submitted', 'receipt_disputed');
  select coalesce(jsonb_agg(app.marketplace_order_summary(q, 'seller') order by q.placed_at desc, q.id), '[]'::jsonb) into v_items
    from (select o.* from public.marketplace_orders o
           where o.seller_organization_id = p_organization_id and (v_statuses is null or o.status = any (v_statuses))
             and (p_from is null or (o.placed_at at time zone 'Africa/Cairo')::date >= p_from)
             and (p_to is null or (o.placed_at at time zone 'Africa/Cairo')::date <= p_to)
             and app.marketplace_order_search_match(o, v_pattern, true)
           order by o.placed_at desc, o.id limit v_limit offset v_offset) q;
  return jsonb_build_object('total', v_total, 'counts', v_counts, 'needs_attention', v_attention, 'items', v_items);
end;
$$;

create or replace function public.marketplace_seller_order_get_v2(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select seller_organization_id into v_org from public.marketplace_orders where id = p_order_id;
  if v_org is null or not app.marketplace_can_manage_orders(v_org) then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  return app.marketplace_order_document_v2(p_order_id, 'seller');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Invoice (buyer or seller of the order) — issued lazily and idempotently once the order is ready
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_order_invoice_get(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  o public.marketplace_orders;
  v_role text;
  v_inv public.marketplace_order_invoices;
begin
  if v_uid is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  select * into o from public.marketplace_orders where id = p_order_id;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  if o.buyer_user_id = v_uid then
    v_role := 'buyer';
  elsif app.marketplace_can_manage_orders(o.seller_organization_id) then
    v_role := 'seller';
  else
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  v_inv := app.marketplace_order_invoice_issue(o.id, v_role);
  return jsonb_build_object('invoice_number', v_inv.invoice_number, 'issued_at', v_inv.issued_at,
    'seller', v_inv.seller_snapshot, 'buyer', v_inv.buyer_snapshot, 'lines', v_inv.lines,
    'subtotal_egp', v_inv.subtotal_egp, 'delivery_fee_egp', v_inv.delivery_fee_egp, 'total_egp', v_inv.total_egp,
    'payment_method', v_inv.payment_method, 'paid_now_egp', v_inv.paid_now_egp, 'balance_due_egp', v_inv.balance_due_egp);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Waybill (seller only, delivery orders) — straight from the order snapshot
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
    'latitude', o.latitude, 'longitude', o.longitude,
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(nullif(i.name_ar, ''), i.name_en), 'sku', i.sku,
        'quantity', i.quantity) order by i.created_at, i.sku)
      from public.marketplace_order_items i where i.order_id = o.id), '[]'::jsonb),
    'payment', jsonb_build_object('method', o.payment_method,
      'collect_on_delivery_egp', case when o.payment_status = 'collected' then 0 else greatest(coalesce(o.balance_due_egp, 0), 0) end),
    'tracking_number', (select sh.tracking_number from public.marketplace_order_shipments sh where sh.order_id = o.id),
    'notes', o.buyer_note);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Shipment correction (carrier and tracking only; the status machine is PR 12's)
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_seller_order_shipment_update(p_order_id uuid, p_carrier_name text default null,
  p_tracking_number text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.marketplace_orders;
  v_carrier text := nullif(btrim(p_carrier_name), '');
  v_track text := nullif(btrim(p_tracking_number), '');
  v_ship public.marketplace_order_shipments;
begin
  if (select auth.uid()) is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  select * into o from public.marketplace_orders where id = p_order_id for update;
  if not found or not app.marketplace_can_manage_orders(o.seller_organization_id) then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  if o.source <> 'v2' then
    raise exception 'mp:legacy_order' using errcode = '23514';
  end if;
  if v_carrier is not null and char_length(v_carrier) not between 2 and 80 then
    raise exception 'mp:carrier_invalid' using errcode = '22023';
  end if;
  if v_track is not null and v_track !~ '^[A-Za-z0-9._/-]{3,64}$' then
    raise exception 'mp:tracking_invalid' using errcode = '22023';
  end if;
  if o.status <> 'shipped' then
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  select * into v_ship from public.marketplace_order_shipments where order_id = o.id for update;
  if not found then
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  -- a repeat with the same values already took effect: no second event
  if v_ship.carrier_name is not distinct from v_carrier and v_ship.tracking_number is not distinct from v_track then
    return app.marketplace_order_document_v2(o.id, 'seller');
  end if;
  update public.marketplace_order_shipments set carrier_name = v_carrier, tracking_number = v_track, updated_at = now()
   where id = v_ship.id;
  insert into public.marketplace_order_events (order_id, action, from_status, to_status, from_payment, to_payment,
    actor_user_id, actor_role, note, payload)
  values (o.id, 'shipment_updated', o.status, o.status, o.payment_status, o.payment_status,
    (select auth.uid()), 'seller', null, '{}'::jsonb);
  return app.marketplace_order_document_v2(o.id, 'seller');
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
revoke all on function
  app.marketplace_order_tab_statuses(text),
  app.marketplace_escape_like(text),
  app.marketplace_order_search_match(public.marketplace_orders, text, boolean),
  app.marketplace_order_summary(public.marketplace_orders, text)
  from public, anon, authenticated, service_role;
revoke all on function
  public.marketplace_buyer_orders_v2(text, text, text, integer, integer),
  public.marketplace_buyer_order_get_v2(uuid),
  public.marketplace_seller_orders_page_v2(uuid, text, text, date, date, integer, integer),
  public.marketplace_seller_order_get_v2(uuid),
  public.marketplace_order_invoice_get(uuid),
  public.marketplace_order_waybill_get(uuid),
  public.marketplace_seller_order_shipment_update(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.marketplace_buyer_orders_v2(text, text, text, integer, integer),
  public.marketplace_buyer_order_get_v2(uuid),
  public.marketplace_seller_orders_page_v2(uuid, text, text, date, date, integer, integer),
  public.marketplace_seller_order_get_v2(uuid),
  public.marketplace_order_invoice_get(uuid),
  public.marketplace_order_waybill_get(uuid),
  public.marketplace_seller_order_shipment_update(uuid, text, text)
  to authenticated;
