-- ===========================================================================
-- Marketplace - Migration 20261125140001: recording the refund of a cancelled order (owner decision 2026-11-25)
-- ===========================================================================
-- WHY
--   A cancelled order whose money may have been received is `refund_due` (an InstaPay receipt that was accepted, never checked,
--   or rejected before the showroom cancelled). Until now nothing could ever record that it was paid back: returns (PR 15)
--   only cover delivered orders.
-- WHAT THIS DOES
--   * public.marketplace_seller_cancel_refund_record(order, note): the showroom records that it paid the amount back.
--     The order stays `refund_due`.
--   * public.marketplace_buyer_cancel_refund_confirm(order): the buyer confirms receiving it; only then it is `refunded`.
--   * Order actions `record_cancel_refund` (showroom) and `confirm_cancel_refund` (buyer) through the PR 12 hook.
--   * Order events cancel_refund_sent / cancel_refund_confirmed and two in-app notifications.
-- MONEY IS NEVER MOVED HERE: the platform only records what the two sides say.
-- NOTHING IS DROPPED. EXPAND only. SECURITY DEFINER, search_path = '', every caller re-checked, no table grant.
-- ===========================================================================

create or replace function pg_temp.extend_in_check(p_table regclass, p_constraint text, p_column text, p_new text[])
returns void language plpgsql as $f$
declare
  v_def  text;
  v_vals text[];
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conrelid = p_table and c.conname = p_constraint;
  if v_def is null then raise exception 'constraint % not found', p_constraint; end if;
  select coalesce(array_agg(distinct m[1]), '{}') into v_vals from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m;
  v_vals := (select array_agg(distinct x order by x) from unnest(v_vals || p_new) x);
  execute format('alter table %s drop constraint %I', p_table, p_constraint);
  execute format('alter table %s add constraint %I check (%I in (%s))', p_table, p_constraint, p_column,
                 (select string_agg(quote_literal(x), ', ' order by x) from unnest(v_vals) x));
end;
$f$;

select pg_temp.extend_in_check('public.notifications'::regclass, 'ck_notifications_event_type_known', 'event_type',
  array['marketplace.order.refund_sent', 'marketplace.order.refund_confirmed']);

insert into public.notification_templates
  (key, event_type, variables, default_title_ar, default_body_ar, default_title_en, default_body_en) values
  ('marketplace.order.refund_sent', 'marketplace.order.refund_sent', array['order_number', 'showroom_name', 'amount'],
   'سجّل المعرض رد المبلغ',
   'سجّل {showroom_name} أنه ردّ {amount} عن الطلب الملغي {order_number}. أكّد الاستلام من صفحة الطلب.',
   'The showroom recorded your refund',
   '{showroom_name} recorded that it paid back {amount} for the cancelled order {order_number}. Confirm it from the order page.'),
  ('marketplace.order.refund_confirmed', 'marketplace.order.refund_confirmed', array['order_number', 'amount'],
   'أكّد المشتري استلام المبلغ',
   'أكّد المشتري استلام {amount} عن الطلب الملغي {order_number}.',
   'The buyer confirmed the refund',
   'The buyer confirmed receiving {amount} for the cancelled order {order_number}.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Order actions: keep the installed hook body (PR 14 complaint, PR 15 returns) and add ours
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('app.marketplace_order_extra_actions(uuid, text)'::regprocedure);
  v_new := replace(v_def, 'app.marketplace_order_extra_actions(', 'app.marketplace_order_extra_actions_returns(');
  if v_new = v_def then
    raise exception 'extra actions hook not found';
  end if;
  execute v_new;
end;
$do$;

create or replace function app.marketplace_order_extra_actions(p_order uuid, p_for text)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out  text[] := app.marketplace_order_extra_actions_returns(p_order, p_for);
  v_sent boolean;
begin
  if exists (select 1 from public.marketplace_orders o
              where o.id = p_order and o.source = 'v2' and o.status = 'cancelled' and o.payment_status = 'refund_due') then
    v_sent := exists (select 1 from public.marketplace_order_events e where e.order_id = p_order and e.action = 'cancel_refund_sent');
    if p_for = 'seller' and not v_sent then
      v_out := v_out || array['record_cancel_refund'];
    elsif p_for = 'buyer' and v_sent then
      v_out := v_out || array['confirm_cancel_refund'];
    end if;
  end if;
  return v_out;
end;
$$;

revoke all on function app.marketplace_order_extra_actions_returns(uuid, text), app.marketplace_order_extra_actions(uuid, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The showroom records the refund
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_seller_cancel_refund_record(p_order_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- ---------------------------------------------------------------------------
-- 3. The buyer confirms receiving it
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_buyer_cancel_refund_confirm(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
     or not exists (select 1 from public.marketplace_order_events e where e.order_id = o.id and e.action = 'cancel_refund_sent') then
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
$$;

revoke all on function public.marketplace_seller_cancel_refund_record(uuid, text), public.marketplace_buyer_cancel_refund_confirm(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.marketplace_seller_cancel_refund_record(uuid, text), public.marketplace_buyer_cancel_refund_confirm(uuid)
  to authenticated;
