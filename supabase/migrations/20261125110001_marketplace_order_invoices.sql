-- ===========================================================================
-- Marketplace PR 13 (1/3) — order invoices
-- ===========================================================================
-- Contract: docs/product/marketplace-order-model-contract-20261124.md section 2.9 and 4.3. PR 13 block 20261125110001-139999.
-- ADDS: sequence marketplace_invoice_number_seq, table marketplace_order_invoices, and the internal issuer
--       app.marketplace_order_invoice_issue (idempotent). NEEDS: PR 12 (marketplace_orders v2 columns, order events).
-- DROPS: nothing. EXPAND ONLY.
--
-- WHAT IT IS. An ORDER invoice for the buyer and the showroom: the showroom's and the buyer's details, the lines
-- and the totals as they were at checkout (prices exclude VAT). It is NOT a tax invoice and does not connect to
-- any e-invoicing system (ASSUMED pending owner confirmation, contract open question 9).
--
-- SECURITY. RLS on, no policy, no client grant: the only way in is marketplace_order_invoice_get (migration 2).
-- The snapshot holds the recipient NAME and delivery address text but never the phone. Rows are never changed
-- after issue (trigger), and the actor ids of the events carry no foreign key.
-- ===========================================================================

create sequence if not exists public.marketplace_invoice_number_seq;
revoke all on sequence public.marketplace_invoice_number_seq from public, anon, authenticated, service_role;

create table public.marketplace_order_invoices (
  id               uuid          primary key default gen_random_uuid(),
  order_id         uuid          not null unique references public.marketplace_orders (id) on delete cascade,
  invoice_number   text          not null unique
                   default ('INV-' || lpad(nextval('public.marketplace_invoice_number_seq')::text, 6, '0')),
  issued_at        timestamptz   not null default now(),
  seller_snapshot  jsonb         not null,
  buyer_snapshot   jsonb         not null,
  lines            jsonb         not null,
  subtotal_egp     numeric(14,2) not null,
  delivery_fee_egp numeric(14,2) not null,
  total_egp        numeric(14,2) not null,
  paid_now_egp     numeric(14,2),
  balance_due_egp  numeric(14,2),
  payment_method   text          not null,
  note             text,
  constraint ck_mp_invoices_snapshots check (jsonb_typeof(seller_snapshot) = 'object' and jsonb_typeof(buyer_snapshot) = 'object'
                                              and jsonb_typeof(lines) = 'array'),
  constraint ck_mp_invoices_money check (total_egp = subtotal_egp + delivery_fee_egp),
  constraint ck_mp_invoices_note check (note is null or char_length(note) <= 300)
);
comment on table public.marketplace_order_invoices is
  'One order invoice per order, issued lazily by the first marketplace_order_invoice_get once the order is ready; never changes afterwards. Not a tax invoice.';
alter table public.marketplace_order_invoices enable row level security;
revoke all on public.marketplace_order_invoices from public, anon, authenticated, service_role;

create or replace function app.marketplace_order_invoice_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'mp:invoice_immutable' using errcode = '23514';
end;
$$;
create trigger marketplace_order_invoices_immutable before update on public.marketplace_order_invoices
  for each row execute function app.marketplace_order_invoice_immutable();
revoke all on function app.marketplace_order_invoice_immutable() from public, anon, authenticated, service_role;

-- Issues the invoice of an order when none exists (idempotent): the first call writes it and one internal event,
-- later calls return the stored row. The order row is locked so two callers cannot burn two numbers.
-- An order that left the line before it was ever ready (cancelled while new or preparing) has no invoice.
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
$$;
revoke all on function app.marketplace_order_invoice_issue(uuid, text) from public, anon, authenticated, service_role;
