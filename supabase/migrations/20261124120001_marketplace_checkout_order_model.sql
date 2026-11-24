-- ===========================================================================
-- Marketplace PR 12 — new checkout and order model
-- ===========================================================================
-- Contract: docs/product/marketplace-order-model-contract-20261124.md (sections 1-4). This migration is the
-- PR 12 block of that contract; PRs 13, 14 and 15 build on the objects it creates.
--
-- WHAT CHANGES FOR THE BUYER AND THE SHOWROOM (owner decisions, walkthrough Parts 4B and 4C)
--   * the showroom no longer confirms or rejects an order: a confirmed checkout is an order in status `new`;
--     the showroom PREPARES it (start_preparing -> mark_ready -> mark_shipped -> mark_delivered) or cancels it
--     with a preset reason;
--   * delivery to a saved address or pickup at the showroom's branch; cash on delivery, InstaPay (full) or
--     InstaPay deposit; for both InstaPay methods the receipt is uploaded BEFORE the order is confirmed,
--     bound to a checkout session, and attached to the order at confirm;
--   * units are PENDING (reserved: nobody else can order them, no last-unit race) from the moment the order
--     exists and are DEDUCTED when preparation finishes (mark_ready); cancelling releases / restocks them;
--   * checkout is server-side: marketplace_checkout_prepare reprices from the database (the browser sends only
--     slug, sku, quantity), marketplace_checkout_confirm re-quotes, compares the quote hash and is idempotent.
--
-- ONE STATE MACHINE. app.marketplace_order_apply implements every transition of contract section 3.2. Public
-- RPCs only authorize the caller and call it. A BEFORE UPDATE trigger refuses any change of status or
-- payment_status on a v2 order that does not come through app.marketplace_order_apply.
--
-- EXPAND / CONTRACT. Nothing is dropped. The promoted application keeps its functions (marketplace_checkout_place,
-- marketplace_seller_order_transition, ...) for rows with source = 'legacy'; they cannot touch a v2 order because
-- of the trigger above. DEVIATION FROM CONTRACT 2.2 (reported to the contract owner): marketplace_orders.source
-- defaults to 'legacy' (the contract says 'v2'): the promoted v1 checkout does not set the column and its rows must
-- stay legacy; every v2 insert sets source = 'v2' explicitly. Release N+1 flips the default when v1 is dropped.
--
-- BACKFILL (mechanical; ordering is hidden on Acceptance and Production, so these tables hold test data at most):
--   pending_confirmation -> new; confirmed, processing -> preparing; ready_for_pickup -> ready;
--   payment instapay -> instapay_full (deposit 100) or instapay_deposit; deposit_submitted / _accepted / _rejected
--   -> receipt_submitted / _accepted / _disputed; placed_at = created_at; source stays 'legacy'; stock_state derived.
--   If a hosted database turns out to hold real orders, STOP and ask the owner before applying.
--
-- SECURITY. Every new table has RLS on, no policy and no client grant. Reads and writes are SECURITY DEFINER
-- RPCs that re-check the caller. Receipts, addresses and phones are personal data: no event, notification or
-- log line carries them (events keep ids and short reasons only). Receipts are private media (namespace
-- marketplace), verified bytes required before confirm, image-only, size-capped by the central media limits.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Helper: add values to an `x in (...)` CHECK without forgetting what other migrations added
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 1. Checkout sessions (new)
-- ---------------------------------------------------------------------------
create table public.marketplace_checkout_sessions (
  id                      uuid        primary key default gen_random_uuid(),
  buyer_user_id           uuid        not null references public.users (id) on delete cascade,
  state                   text        not null default 'open',
  seller_organization_id  uuid        not null references public.organizations (id) on delete restrict,
  lines                   jsonb       not null,
  fulfilment              text        not null,
  address_id              uuid,
  delivery_speed          text        not null default 'standard',
  payment_method          text        not null,
  quote                   jsonb       not null,
  quote_hash              text        not null,
  idempotency_key         text,
  confirmed_checkout_id   uuid,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  expires_at              timestamptz not null default now() + interval '2 hours',
  constraint ck_mp_sessions_state check (state in ('open', 'confirmed', 'expired', 'abandoned')),
  constraint ck_mp_sessions_fulfilment check (fulfilment in ('delivery', 'pickup')),
  constraint ck_mp_sessions_speed check (delivery_speed in ('standard', 'next_day')),
  constraint ck_mp_sessions_payment check (payment_method in ('cod', 'instapay_full', 'instapay_deposit')),
  constraint ck_mp_sessions_key check (idempotency_key is null or char_length(idempotency_key) between 8 and 128),
  constraint ck_mp_sessions_lines check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 50),
  constraint uq_mp_sessions_buyer_key unique (buyer_user_id, idempotency_key)
);
comment on table public.marketplace_checkout_sessions is
  'One checkout attempt: the repriced quote, the chosen address / delivery / payment and the receipts uploaded before the order exists. Holds NO stock (stock becomes pending only when the order is created at confirm). No client grant; written only by marketplace_checkout_* RPCs.';
create index ix_mp_sessions_buyer on public.marketplace_checkout_sessions (buyer_user_id, state, created_at desc);
create index ix_mp_sessions_expiry on public.marketplace_checkout_sessions (expires_at) where state = 'open';
create trigger set_mp_sessions_updated_at before update on public.marketplace_checkout_sessions
  for each row execute function app.set_updated_at();
alter table public.marketplace_checkout_sessions enable row level security;
revoke all on public.marketplace_checkout_sessions from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Orders: new columns, widened constraints, backfill
-- ---------------------------------------------------------------------------
alter table public.marketplace_orders
  add column checkout_session_id        uuid references public.marketplace_checkout_sessions (id) on delete set null,
  add column address_id                 uuid references public.marketplace_buyer_addresses (id) on delete set null,
  add column address_snapshot           jsonb,
  add column latitude                   numeric(9,6),
  add column longitude                  numeric(9,6),
  add column delivery_speed             text          not null default 'standard',
  add column delivery_estimate_earliest date,
  add column delivery_estimate_latest   date,
  add column placed_at                  timestamptz   not null default now(),
  add column preparing_at               timestamptz,
  add column ready_at                   timestamptz,
  add column shipped_at                 timestamptz,
  add column paid_now_egp               numeric(14,2),
  add column balance_due_egp            numeric(14,2),
  add column stock_state                text          not null default 'none',
  add column source                     text          not null default 'legacy';
create unique index ux_mp_orders_checkout_session on public.marketplace_orders (checkout_session_id) where checkout_session_id is not null;
create index ix_mp_orders_seller_placed on public.marketplace_orders (seller_organization_id, status, placed_at desc);
create index ix_mp_orders_buyer_placed on public.marketplace_orders (buyer_user_id, placed_at desc);
create index ix_mp_orders_number_trgm on public.marketplace_orders using gin (order_number extensions.gin_trgm_ops);

-- widen the CHECKs first (legacy values stay allowed), then backfill
alter table public.marketplace_orders drop constraint ck_mp_orders_status;
alter table public.marketplace_orders add constraint ck_mp_orders_status check (status in
  ('new', 'preparing', 'ready', 'shipped', 'delivered', 'cancelled', 'delivery_failed', 'returned',
   'pending_confirmation', 'confirmed', 'processing', 'ready_for_pickup'));
alter table public.marketplace_orders drop constraint ck_mp_orders_payment_method;
alter table public.marketplace_orders add constraint ck_mp_orders_payment_method check (payment_method in
  ('cod', 'instapay_full', 'instapay_deposit', 'instapay'));
alter table public.marketplace_orders drop constraint ck_mp_orders_payment_status;
alter table public.marketplace_orders add constraint ck_mp_orders_payment_status check (
  (payment_method = 'cod' and payment_status in ('pending', 'collected', 'not_collected', 'refund_due', 'refunded'))
  or (payment_method in ('instapay', 'instapay_full', 'instapay_deposit') and payment_status in
      ('awaiting_deposit', 'deposit_submitted', 'deposit_accepted', 'deposit_rejected',
       'receipt_submitted', 'receipt_accepted', 'receipt_disputed', 'collected', 'not_collected', 'refund_due', 'refunded')));
alter table public.marketplace_orders drop constraint ck_mp_orders_deposit;
alter table public.marketplace_orders add constraint ck_mp_orders_deposit check (
  (payment_method in ('instapay', 'instapay_deposit') and deposit_percent is not null and deposit_egp is not null
     and instapay_address is not null and instapay_account_name is not null)
  or (payment_method = 'instapay_full' and deposit_percent is null and deposit_egp is null
     and instapay_address is not null and instapay_account_name is not null)
  or (payment_method = 'cod' and deposit_percent is null and deposit_egp is null));

update public.marketplace_orders set
  status = case status when 'pending_confirmation' then 'new' when 'confirmed' then 'preparing'
                       when 'processing' then 'preparing' when 'ready_for_pickup' then 'ready' else status end,
  payment_method = case when payment_method = 'instapay' and deposit_percent = 100 then 'instapay_full'
                        when payment_method = 'instapay' then 'instapay_deposit' else payment_method end,
  payment_status = case payment_status when 'deposit_submitted' then 'receipt_submitted'
                         when 'deposit_accepted' then 'receipt_accepted' when 'deposit_rejected' then 'receipt_disputed'
                         else payment_status end,
  stock_state = case status when 'pending_confirmation' then 'pending'
                  when 'cancelled' then case when confirmed_at is null then 'released' else 'restocked' end
                  when 'returned' then 'restocked' else 'deducted' end,
  placed_at = created_at
where true;
update public.marketplace_orders set deposit_percent = null, deposit_egp = null
 where payment_method = 'instapay_full' and deposit_percent is not null;
update public.marketplace_orders set
  paid_now_egp = case payment_method when 'cod' then 0 when 'instapay_full' then total_egp else deposit_egp end,
  balance_due_egp = total_egp - case payment_method when 'cod' then 0 when 'instapay_full' then total_egp else deposit_egp end
where paid_now_egp is null;

alter table public.marketplace_orders
  add constraint ck_mp_orders_speed check (delivery_speed in ('standard', 'next_day')),
  add constraint ck_mp_orders_source check (source in ('legacy', 'v2')),
  add constraint ck_mp_orders_stock_state check (stock_state in ('none', 'pending', 'deducted', 'released', 'restocked')),
  add constraint ck_mp_orders_estimate check (delivery_estimate_earliest is null or delivery_estimate_latest >= delivery_estimate_earliest),
  add constraint ck_mp_orders_paid check (paid_now_egp is null or (paid_now_egp >= 0 and paid_now_egp <= total_egp
     and balance_due_egp = total_egp - paid_now_egp)),
  -- the single truth about stock, for v2 orders: pending while the order waits or is prepared, deducted from mark_ready on
  add constraint ck_mp_orders_stock_v2 check (source <> 'v2' or
     (status in ('new', 'preparing') and stock_state = 'pending')
     or (status in ('ready', 'shipped', 'delivered', 'delivery_failed') and stock_state = 'deducted')
     or (status = 'cancelled' and stock_state in ('released', 'restocked'))
     or (status = 'returned' and stock_state = 'restocked'));

-- order items: the price snapshot taken at confirm
alter table public.marketplace_order_items
  add column product_slug       text,
  add column variant_label      jsonb,
  add column image_id           uuid,
  add column non_returnable     boolean not null default false,
  add column free_shipping      boolean not null default false,
  add column quantity_returned  integer not null default 0,
  add constraint ck_mp_order_items_returned check (quantity_returned between 0 and quantity);

-- events: admin actor, small payload
alter table public.marketplace_order_events drop constraint ck_mp_order_events_role;
alter table public.marketplace_order_events add constraint ck_mp_order_events_role check (actor_role in ('buyer', 'seller', 'system', 'admin'));
alter table public.marketplace_order_events add column payload jsonb;
alter table public.marketplace_order_events add constraint ck_mp_order_events_payload check (payload is null or jsonb_typeof(payload) = 'object');

-- products: non-returnable flag (PR 15 owns the setter RPC and the form field)
alter table public.marketplace_products add column non_returnable boolean not null default false;
comment on column public.marketplace_products.non_returnable is
  'Made to order / not returnable (disclosed before payment, copied onto order items). Setter RPC: PR 15.';

-- receipts: bound to a checkout session before the order exists
alter table public.marketplace_payment_proofs alter column order_id drop not null;
alter table public.marketplace_payment_proofs
  add column checkout_session_id uuid references public.marketplace_checkout_sessions (id) on delete cascade,
  add column purpose text not null default 'initial',
  add column declared_amount_egp numeric(14,2),
  add constraint ck_mp_proofs_owner check (order_id is not null or checkout_session_id is not null),
  add constraint ck_mp_proofs_purpose check (purpose in ('initial', 'resubmission')),
  add constraint ck_mp_proofs_declared check (declared_amount_egp is null or declared_amount_egp > 0);
alter table public.marketplace_payment_proofs drop constraint ck_mp_proofs_status;
alter table public.marketplace_payment_proofs add constraint ck_mp_proofs_status check (status in ('submitted', 'accepted', 'rejected', 'superseded'));
create index ix_mp_proofs_session on public.marketplace_payment_proofs (checkout_session_id, created_at) where checkout_session_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Cancellations, shipments, timers (new)
-- ---------------------------------------------------------------------------
create table public.marketplace_order_cancellations (
  id                    uuid        primary key default gen_random_uuid(),
  order_id              uuid        not null unique references public.marketplace_orders (id) on delete cascade,
  cancelled_by_role     text        not null,
  cancelled_by_user_id  uuid,
  reason_code           text        not null,
  preset_id             uuid        references public.marketplace_seller_message_presets (id) on delete set null,
  label_ar              text,
  label_en              text,
  message_ar            text,
  message_en            text,
  internal_note         text,
  stock_effect          text        not null,
  created_at            timestamptz not null default now(),
  constraint ck_mp_cancel_role check (cancelled_by_role in ('buyer', 'seller', 'system', 'admin')),
  constraint ck_mp_cancel_reason check (reason_code in ('preset', 'custom', 'timeout_seller_start', 'timeout_receipt_resubmit', 'legacy', 'none')),
  constraint ck_mp_cancel_stock check (stock_effect in ('released', 'restocked')),
  constraint ck_mp_cancel_text check (char_length(coalesce(message_ar, '')) <= 300 and char_length(coalesce(message_en, '')) <= 300
                                      and char_length(coalesce(internal_note, '')) <= 300)
);
comment on table public.marketplace_order_cancellations is
  'The structured reason of an order cancellation (one per order). internal_note is for the seller / admin only and is never returned to the buyer.';
alter table public.marketplace_order_cancellations enable row level security;
revoke all on public.marketplace_order_cancellations from public, anon, authenticated, service_role;

create table public.marketplace_order_shipments (
  id               uuid        primary key default gen_random_uuid(),
  order_id         uuid        not null unique references public.marketplace_orders (id) on delete cascade,
  carrier_name     text,
  tracking_number  text,
  shipped_by       uuid,
  shipped_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ck_mp_shipments_carrier check (carrier_name is null or char_length(carrier_name) between 2 and 80),
  constraint ck_mp_shipments_tracking check (tracking_number is null or tracking_number ~ '^[A-Za-z0-9._/-]{3,64}$')
);
comment on table public.marketplace_order_shipments is 'One shipment per delivery order (carrier and tracking number optional). Pickup orders have none.';
alter table public.marketplace_order_shipments enable row level security;
revoke all on public.marketplace_order_shipments from public, anon, authenticated, service_role;

create table public.marketplace_timers (
  id               uuid        primary key default gen_random_uuid(),
  subject_type     text        not null,
  subject_id       uuid        not null,
  kind             text        not null,
  state            text        not null default 'active',
  started_at       timestamptz not null,
  expires_at       timestamptz not null,
  remind_every     interval,
  remind_offsets   interval[],
  next_remind_at   timestamptz,
  reminders_sent   integer     not null default 0,
  closed_at        timestamptz,
  closed_by_action text,
  constraint ck_mp_timers_subject check (subject_type in ('order', 'return')),
  constraint ck_mp_timers_kind check (kind in ('order_seller_start', 'order_receipt_resubmit', 'return_seller_response', 'return_refund_due')),
  constraint ck_mp_timers_state check (state in ('active', 'done', 'cancelled', 'expired')),
  constraint ck_mp_timers_window check (expires_at > started_at)
);
comment on table public.marketplace_timers is
  'Generic deadlines for orders and returns (runner: PR 14). At most one active timer per subject and kind.';
create unique index ux_mp_timers_active on public.marketplace_timers (subject_type, subject_id, kind) where state = 'active';
create index ix_mp_timers_expiry on public.marketplace_timers (expires_at) where state = 'active';
create index ix_mp_timers_remind on public.marketplace_timers (next_remind_at) where state = 'active' and next_remind_at is not null;
alter table public.marketplace_timers enable row level security;
revoke all on public.marketplace_timers from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Presets: ONE preset system (PR 5). All new actions are added here, once, for PRs 12-15.
-- ---------------------------------------------------------------------------
select pg_temp.extend_in_check('public.marketplace_seller_message_presets'::regclass, 'ck_marketplace_seller_presets_action', 'action',
  array['order_cancel_seller', 'order_cancel_buyer', 'payment_issue', 'return_reason', 'return_reject']);

do $do$
declare
  v_def text;
  v_new text;
  v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_marketplace_seller_preset_save';
  v_def := pg_get_functiondef(v_oid);
  v_new := replace(v_def, '''image_reject'')', '''image_reject'', ''order_cancel_seller'', ''order_cancel_buyer'', ''payment_issue'', ''return_reason'', ''return_reject'')');
  if v_new = v_def or v_new not like '%order_cancel_seller%' then raise exception 'preset action list patch failed'; end if;
  execute v_new;
end;
$do$;

insert into public.marketplace_seller_message_presets (action, label_ar, label_en, text_ar, text_en, sort_order) values
  ('order_cancel_seller', 'المنتج غير متوفر', 'Product out of stock',
   'نعتذر، المنتج لم يعد متوفرًا لدى المعرض. تم إلغاء الطلب.',
   'Sorry, the product is no longer available at the showroom. The order was cancelled.', 10),
  ('order_cancel_seller', 'تعذّر التجهيز', 'Unable to prepare the order',
   'نعتذر، تعذّر على المعرض تجهيز الطلب. تم إلغاء الطلب.',
   'Sorry, the showroom could not prepare the order. The order was cancelled.', 20),
  ('order_cancel_seller', 'لا يمكن التوصيل لعنوانك', 'Cannot deliver to your address',
   'نعتذر، لا يمكن للمعرض التوصيل إلى عنوانك حاليًا. تم إلغاء الطلب.',
   'Sorry, the showroom cannot deliver to your address right now. The order was cancelled.', 30),
  ('order_cancel_seller', 'خطأ في السعر أو البيانات', 'Price or product data error',
   'تم إلغاء الطلب بسبب خطأ في بيانات المنتج أو سعره لدى المعرض.',
   'The order was cancelled because of an error in the product data or price at the showroom.', 40),
  ('order_cancel_buyer', 'غيّرت رأيي', 'Changed my mind',
   'ألغى المشتري الطلب لأنه غيّر رأيه.', 'The buyer cancelled the order because they changed their mind.', 10),
  ('order_cancel_buyer', 'وجدت سعرًا أفضل', 'Found a better price',
   'ألغى المشتري الطلب لأنه وجد سعرًا أفضل.', 'The buyer cancelled the order because they found a better price.', 20),
  ('order_cancel_buyer', 'طلبت بالخطأ', 'Ordered by mistake',
   'ألغى المشتري الطلب لأنه طلبه بالخطأ.', 'The buyer cancelled the order because it was placed by mistake.', 30),
  ('payment_issue', 'لم يصل التحويل', 'The transfer did not arrive',
   'لم يصل التحويل إلى حساب المعرض. راجع التحويل وأعد رفع الإيصال إن لزم.',
   'The transfer did not reach the showroom account. Please check the transfer and upload the receipt again if needed.', 10),
  ('payment_issue', 'المبلغ غير مطابق', 'The amount does not match',
   'المبلغ المحوَّل لا يطابق قيمة الطلب. راجع المبلغ وأعد رفع الإيصال.',
   'The transferred amount does not match the order. Please check it and upload the receipt again.', 20),
  ('payment_issue', 'الإيصال غير واضح', 'The receipt is not readable',
   'الإيصال غير واضح. أعد رفع صورة أوضح للإيصال.',
   'The receipt is not readable. Please upload a clearer photo of it.', 30);

-- ---------------------------------------------------------------------------
-- 5. Notification vocabulary (all order, payment-complaint and return events, once) + the PR 12 templates
-- ---------------------------------------------------------------------------
select pg_temp.extend_in_check('public.notifications'::regclass, 'ck_notifications_event_type_known', 'event_type', array[
  'marketplace.order.placed', 'marketplace.order.preparing', 'marketplace.order.ready_pickup', 'marketplace.order.shipped',
  'marketplace.order.delivered', 'marketplace.order.cancelled_by_buyer', 'marketplace.order.cancelled_by_seller',
  'marketplace.order.cancelled_timeout_seller', 'marketplace.order.cancelled_timeout_receipt',
  'marketplace.order.reminder_seller_start', 'marketplace.order.reminder_receipt_resubmit',
  'marketplace.order.receipt_disputed', 'marketplace.order.receipt_resubmitted',
  'marketplace.order.payment_complaint_filed', 'marketplace.order.payment_complaint_resolved',
  'marketplace.return.requested', 'marketplace.return.approved', 'marketplace.return.rejected',
  'marketplace.return.received', 'marketplace.return.refund_sent', 'marketplace.return.refund_confirmed',
  'marketplace.return.seller_reminder', 'marketplace.return.escalated', 'marketplace.return.admin_reminder',
  'marketplace.return.admin_decided']);

insert into public.notification_templates
  (key, event_type, variables, default_title_ar, default_body_ar, default_title_en, default_body_en) values
  ('marketplace.order.placed', 'marketplace.order.placed', array['order_number', 'showroom_name', 'buyer_name', 'total'],
   'طلب جديد', 'وصلك الطلب {order_number} بقيمة {total}. ابدأ التجهيز من صفحة الطلبات.',
   'New order', 'Order {order_number} worth {total} has arrived. Start preparing it from the orders page.'),
  ('marketplace.order.preparing', 'marketplace.order.preparing', array['order_number', 'showroom_name'],
   'جارٍ تجهيز طلبك', 'بدأ {showroom_name} تجهيز طلبك {order_number}.',
   'Your order is being prepared', '{showroom_name} started preparing your order {order_number}.'),
  ('marketplace.order.ready_pickup', 'marketplace.order.ready_pickup', array['order_number', 'showroom_name'],
   'طلبك جاهز للاستلام', 'طلبك {order_number} جاهز للاستلام من {showroom_name}.',
   'Your order is ready for pickup', 'Your order {order_number} is ready for pickup at {showroom_name}.'),
  ('marketplace.order.shipped', 'marketplace.order.shipped', array['order_number', 'showroom_name', 'delivery_date', 'tracking_number'],
   'تم شحن طلبك', 'تم شحن طلبك {order_number} من {showroom_name}. موعد الوصول المتوقع: {delivery_date}. {tracking_number}',
   'Your order was shipped', 'Your order {order_number} from {showroom_name} was shipped. Expected arrival: {delivery_date}. {tracking_number}'),
  ('marketplace.order.delivered', 'marketplace.order.delivered', array['order_number', 'showroom_name'],
   'تم تسليم طلبك', 'تم تسليم طلبك {order_number}.',
   'Your order was delivered', 'Your order {order_number} was delivered.'),
  ('marketplace.order.cancelled_by_buyer', 'marketplace.order.cancelled_by_buyer', array['order_number', 'message'],
   'ألغى المشتري الطلب', 'تم إلغاء الطلب {order_number} من المشتري. {message}',
   'The buyer cancelled the order', 'Order {order_number} was cancelled by the buyer. {message}'),
  ('marketplace.order.cancelled_by_seller', 'marketplace.order.cancelled_by_seller', array['order_number', 'showroom_name', 'message'],
   'تم إلغاء طلبك', 'ألغى {showroom_name} طلبك {order_number}. {message}',
   'Your order was cancelled', '{showroom_name} cancelled your order {order_number}. {message}'),
  ('marketplace.order.receipt_disputed', 'marketplace.order.receipt_disputed', array['order_number', 'showroom_name', 'message', 'hours_left'],
   'تحقق من التحويل', 'لم يصل تحويل الطلب {order_number} إلى {showroom_name}. {message} أعد رفع الإيصال خلال {hours_left} ساعة.',
   'Please check your transfer', 'The transfer for order {order_number} did not reach {showroom_name}. {message} Please upload the receipt again within {hours_left} hours.'),
  ('marketplace.order.receipt_resubmitted', 'marketplace.order.receipt_resubmitted', array['order_number'],
   'إيصال جديد للطلب', 'رفع المشتري إيصالًا جديدًا للطلب {order_number}. راجعه الآن.',
   'New receipt uploaded', 'The buyer uploaded a new receipt for order {order_number}. Please review it.');

-- ---------------------------------------------------------------------------
-- 6. Hooks (safe default bodies; PR 14 and PR 15 replace them, same signatures)
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_complaint_admin_can_read(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$ select false; $$;
create or replace function app.marketplace_return_evidence_can_read(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$ select false; $$;
create or replace function app.marketplace_return_evidence_metadata(p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$ select null::jsonb; $$;

-- ---------------------------------------------------------------------------
-- 7. Guard: a v2 order's status and payment status change only through app.marketplace_order_apply
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_order_state_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.source = 'v2' and (new.status is distinct from old.status or new.payment_status is distinct from old.payment_status)
     and coalesce(current_setting('app.marketplace_order_apply', true), 'off') <> 'on' then
    raise exception 'mp:legacy_order' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger trg_marketplace_orders_state_guard
  before update of status, payment_status on public.marketplace_orders
  for each row execute function app.marketplace_order_state_guard();

-- ---------------------------------------------------------------------------
-- 8. Stock (the existing wrapper, now in a fixed lock order) and timers
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_order_stock(p_order uuid, p_movement text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.marketplace_orders;
  it record;
begin
  select * into o from public.marketplace_orders where id = p_order;
  for it in select * from public.marketplace_order_items where order_id = p_order order by variant_id, location_id loop
    perform 1 from public.marketplace_stock_apply(o.seller_organization_id, it.variant_id, it.location_id, p_movement,
      it.quantity, 'order:' || o.id || ':' || p_movement || ':' || it.variant_id, 'Marketplace order ' || o.order_number,
      'order', 'marketplace_order', o.id::text, (select auth.uid()));
  end loop;
end;
$$;

create or replace function app.marketplace_timer_open(p_subject_type text, p_subject_id uuid, p_kind text, p_started timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function app.marketplace_timer_close(p_subject_type text, p_subject_id uuid, p_kind text, p_action text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.marketplace_timers set state = case when p_action like 'cancel%' then 'cancelled' else 'done' end,
         closed_at = now(), closed_by_action = left(p_action, 60), next_remind_at = null
   where subject_type = p_subject_type and subject_id = p_subject_id and kind = p_kind and state = 'active';
$$;

-- ---------------------------------------------------------------------------
-- 9. Notifications (in-app only; never carries a phone, an address or a receipt)
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_notify_order_managers(p_order uuid, p_template_key text, p_vars jsonb,
  p_vars_ar jsonb, p_vars_en jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.marketplace_orders;
  v_user uuid;
begin
  select * into o from public.marketplace_orders where id = p_order;
  for v_user in
    select distinct m.user_id from public.memberships m
      join public.membership_capabilities c on c.membership_id = m.id
     where m.organization_id = o.seller_organization_id and m.status = 'active' and c.capability_key in ('order.manage', 'org.manage')
  loop
    perform app.notify_from_template(v_user, o.seller_organization_id, p_template_key, 'marketplace_order', o.id,
      '/showroom/marketplace/orders/' || o.id, p_vars, p_vars_ar, p_vars_en);
  end loop;
end;
$$;

create or replace function app.marketplace_order_notify(p_order uuid, p_event text, p_vars jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- ---------------------------------------------------------------------------
-- 10. Reasons (presets or custom text) and the readable variant label
-- ---------------------------------------------------------------------------
-- Returns { code, preset_id, label_ar, label_en, message_ar, message_en } or null when none was given and none is required.
create or replace function app.marketplace_order_reason(p_payload jsonb, p_preset_action text, p_required boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_preset public.marketplace_seller_message_presets;
  v_ar text := nullif(btrim(p_payload ->> 'message_ar'), '');
  v_en text := nullif(btrim(p_payload ->> 'message_en'), '');
  v_text text := nullif(btrim(p_payload ->> 'message'), '');
begin
  if nullif(p_payload ->> 'preset_id', '') is not null then
    if (p_payload ->> 'preset_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'mp:preset_invalid' using errcode = '22023';
    end if;
    select * into v_preset from public.marketplace_seller_message_presets
     where id = (p_payload ->> 'preset_id')::uuid and action = p_preset_action and is_active;
    if not found then
      raise exception 'mp:preset_invalid' using errcode = '22023';
    end if;
    return jsonb_build_object('code', 'preset', 'preset_id', v_preset.id, 'label_ar', v_preset.label_ar, 'label_en', v_preset.label_en,
                              'message_ar', v_preset.text_ar, 'message_en', v_preset.text_en);
  end if;
  v_ar := coalesce(v_ar, v_text, v_en);
  v_en := coalesce(v_en, v_text, v_ar);
  if v_ar is null then
    if p_required then
      raise exception 'mp:reason_required' using errcode = '22023';
    end if;
    return null;
  end if;
  if char_length(v_ar) not between 3 and 300 or char_length(v_en) not between 3 and 300 then
    raise exception 'mp:reason_required' using errcode = '22023';
  end if;
  return jsonb_build_object('code', 'custom', 'preset_id', null, 'label_ar', null, 'label_en', null, 'message_ar', v_ar, 'message_en', v_en);
end;
$$;

create or replace function app.marketplace_variant_label(p_variant uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'ar', coalesce(string_agg(case when vv.option_id is not null then o.name_ar when vv.value_number is not null then vv.value_number::text
                                   when vv.value_boolean is not null then null else vv.value_text end, ' / ' order by d.key), ''),
    'en', coalesce(string_agg(case when vv.option_id is not null then o.name_en when vv.value_number is not null then vv.value_number::text
                                   when vv.value_boolean is not null then null else vv.value_text end, ' / ' order by d.key), ''))
  from public.marketplace_variant_attribute_values vv
  join public.marketplace_attribute_definitions d on d.id = vv.attribute_id and d.is_active
  left join public.marketplace_attribute_options o on o.id = vv.option_id
  where vv.variant_id = p_variant;
$$;

-- ---------------------------------------------------------------------------
-- 11. What the viewer may press now (contract 3.3, the predicates of 3.2)
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_order_actions(p_order uuid, p_for text)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.marketplace_orders;
  v_ip boolean;
  v_dispute boolean;
  v_out text[] := '{}';
begin
  select * into o from public.marketplace_orders where id = p_order;
  if not found or o.source <> 'v2' then
    return v_out;
  end if;
  v_ip := o.payment_method in ('instapay_full', 'instapay_deposit');
  v_dispute := o.payment_status = 'receipt_disputed';
  if p_for = 'buyer' then
    if o.status = 'new' then v_out := array_append(v_out, 'cancel'); end if;
    if v_ip and v_dispute and o.status in ('preparing', 'ready') then v_out := array_append(v_out, 'resubmit_receipt'); end if;
  elsif p_for = 'seller' then
    if o.status = 'new' then v_out := v_out || array['start_preparing', 'cancel'];
    elsif o.status = 'preparing' then
      if not v_dispute then v_out := array_append(v_out, 'mark_ready'); end if;
      v_out := array_append(v_out, 'cancel');
    elsif o.status = 'ready' then
      if not v_dispute then v_out := array_append(v_out, case when o.fulfilment = 'delivery' then 'mark_shipped' else 'mark_delivered' end); end if;
      v_out := array_append(v_out, 'cancel');
      if o.fulfilment = 'pickup' then v_out := array_append(v_out, 'mark_delivery_failed'); end if;
    elsif o.status = 'shipped' then
      if not v_dispute then v_out := array_append(v_out, 'mark_delivered'); end if;
      v_out := array_append(v_out, 'mark_delivery_failed');
    elsif o.status = 'delivered' then
      if (o.payment_method = 'cod' and o.payment_status = 'pending')
         or (o.payment_method = 'instapay_deposit' and o.payment_status = 'receipt_accepted' and coalesce(o.balance_due_egp, 0) > 0) then
        v_out := array_append(v_out, 'collect_payment');
      end if;
    elsif o.status = 'delivery_failed' then v_out := array_append(v_out, 'mark_returned_to_stock');
    end if;
    if v_ip and o.status in ('new', 'preparing', 'ready') and o.payment_status in ('receipt_submitted', 'receipt_disputed') then
      v_out := array_append(v_out, 'accept_receipt');
    end if;
    if v_ip and o.status in ('preparing', 'ready') and o.payment_status = 'receipt_submitted' then
      v_out := array_append(v_out, 'flag_receipt_not_received');
    end if;
  end if;
  return v_out || app.marketplace_order_extra_actions(p_order, p_for);
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. The order document, v2 shape (contract 4.1). Later PRs fill invoice, return_window, returns, complaint_id.
-- ---------------------------------------------------------------------------
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
    'invoice', null,
    'return_window', null,
    'returns', '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. THE state machine (contract 3.2). Every status or payment-status change of a v2 order goes through here.
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_order_apply(p_order uuid, p_action text, p_actor_role text, p_actor uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o         public.marketplace_orders;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_for     text := case when p_actor_role in ('buyer', 'admin') then p_actor_role else 'seller' end;
  v_status  text;
  v_pay     text;
  v_event   text;
  v_replay  boolean := false;
  v_stock   text;
  v_reason  jsonb;
  v_proof   uuid;
  v_carrier text;
  v_track   text;
  v_notify  text;
  v_event_payload jsonb;
begin
  if p_actor_role not in ('buyer', 'seller', 'system', 'admin') then
    raise exception 'mp:invalid_action' using errcode = '22023';
  end if;
  select * into o from public.marketplace_orders where id = p_order for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  if o.source <> 'v2' then
    raise exception 'mp:legacy_order' using errcode = '23514';
  end if;
  v_status := o.status;
  v_pay := o.payment_status;

  case p_action
    when 'start_preparing' then
      if o.status = 'preparing' then v_replay := true;
      elsif o.status = 'new' then v_status := 'preparing'; v_event := 'preparing'; v_notify := 'preparing';
      else raise exception 'mp:invalid_transition' using errcode = '23514'; end if;

    when 'mark_ready' then
      if o.status = 'ready' then v_replay := true;
      elsif o.status = 'preparing' then
        if o.payment_status = 'receipt_disputed' then raise exception 'mp:payment_dispute_open' using errcode = '23514'; end if;
        v_status := 'ready'; v_event := 'ready'; v_stock := 'deduct';
        v_notify := case when o.fulfilment = 'pickup' then 'ready_pickup' end;
      else raise exception 'mp:invalid_transition' using errcode = '23514'; end if;

    when 'mark_shipped' then
      if o.status = 'shipped' then v_replay := true;
      elsif o.status = 'ready' and o.fulfilment = 'delivery' then
        if o.payment_status = 'receipt_disputed' then raise exception 'mp:payment_dispute_open' using errcode = '23514'; end if;
        v_carrier := nullif(btrim(v_payload ->> 'carrier_name'), '');
        v_track := nullif(btrim(v_payload ->> 'tracking_number'), '');
        if (v_carrier is not null and char_length(v_carrier) not between 2 and 80)
           or (v_track is not null and v_track !~ '^[A-Za-z0-9._/-]{3,64}$') then
          raise exception 'mp:invalid_payload' using errcode = '22023';
        end if;
        v_status := 'shipped'; v_event := 'shipped'; v_notify := 'shipped';
      else raise exception 'mp:invalid_transition' using errcode = '23514'; end if;

    when 'mark_delivered' then
      if o.status = 'delivered' then v_replay := true;
      elsif (o.status = 'shipped' and o.fulfilment = 'delivery') or (o.status = 'ready' and o.fulfilment = 'pickup') then
        if o.payment_status = 'receipt_disputed' then raise exception 'mp:payment_dispute_open' using errcode = '23514'; end if;
        v_status := 'delivered'; v_event := 'delivered'; v_notify := 'delivered';
      else raise exception 'mp:invalid_transition' using errcode = '23514'; end if;

    when 'collect_payment' then
      if o.status = 'delivered' and o.payment_status = 'collected' then v_replay := true;
      elsif o.status = 'delivered' and ((o.payment_method = 'cod' and o.payment_status = 'pending')
            or (o.payment_method = 'instapay_deposit' and o.payment_status = 'receipt_accepted' and coalesce(o.balance_due_egp, 0) > 0)) then
        v_pay := 'collected'; v_event := 'payment_collected';
      else raise exception 'mp:invalid_transition' using errcode = '23514'; end if;

    when 'accept_receipt' then
      if o.payment_method not in ('instapay_full', 'instapay_deposit') or o.status not in ('new', 'preparing', 'ready') then
        if o.payment_status in ('receipt_accepted', 'collected') and o.payment_method <> 'cod' then v_replay := true;
        else raise exception 'mp:invalid_transition' using errcode = '23514'; end if;
      elsif o.payment_status in ('receipt_accepted', 'collected') then v_replay := true;
      elsif o.payment_status in ('receipt_submitted', 'receipt_disputed') then
        if nullif(v_payload ->> 'proof_id', '') is not null then
          select pr.id into v_proof from public.marketplace_payment_proofs pr
           where pr.id = (v_payload ->> 'proof_id')::uuid and pr.order_id = o.id and pr.upload_state = 'confirmed' and pr.status <> 'superseded';
        else
          select pr.id into v_proof from public.marketplace_payment_proofs pr
           where pr.order_id = o.id and pr.upload_state = 'confirmed' and pr.status <> 'superseded'
           order by pr.created_at desc limit 1;
        end if;
        if v_proof is null then raise exception 'mp:proof_not_reviewable' using errcode = '23514'; end if;
        update public.marketplace_payment_proofs set status = 'accepted', reviewed_by = p_actor, reviewed_at = now() where id = v_proof;
        v_pay := case when o.payment_method = 'instapay_full' then 'collected' else 'receipt_accepted' end;
        v_event := 'receipt_accepted';
      else raise exception 'mp:invalid_transition' using errcode = '23514'; end if;

    when 'flag_receipt_not_received' then
      if o.payment_status = 'receipt_disputed' then v_replay := true;
      elsif o.payment_method in ('instapay_full', 'instapay_deposit') and o.status in ('preparing', 'ready')
            and o.payment_status = 'receipt_submitted' then
        v_reason := app.marketplace_order_reason(v_payload, 'payment_issue', true);
        select pr.id into v_proof from public.marketplace_payment_proofs pr
         where pr.order_id = o.id and pr.upload_state = 'confirmed' and pr.status = 'submitted' order by pr.created_at desc limit 1;
        if v_proof is not null then
          update public.marketplace_payment_proofs set status = 'rejected', reviewed_by = p_actor, reviewed_at = now(),
                 review_note = left(v_reason ->> 'message_en', 300) where id = v_proof;
        end if;
        v_pay := 'receipt_disputed'; v_event := 'receipt_disputed'; v_notify := 'receipt_disputed';
        v_event_payload := jsonb_build_object('message_ar', v_reason ->> 'message_ar', 'message_en', v_reason ->> 'message_en',
                                              'preset_id', v_reason -> 'preset_id');
      else raise exception 'mp:invalid_transition' using errcode = '23514'; end if;

    when 'resubmit_receipt' then
      if o.payment_method in ('instapay_full', 'instapay_deposit') and o.status in ('preparing', 'ready')
         and o.payment_status = 'receipt_disputed' then
        v_proof := nullif(v_payload ->> 'proof_id', '')::uuid;
        update public.marketplace_payment_proofs set status = 'superseded'
         where order_id = o.id and upload_state = 'confirmed' and status in ('submitted', 'rejected') and id is distinct from v_proof;
        v_pay := 'receipt_submitted'; v_event := 'receipt_resubmitted'; v_notify := 'receipt_resubmitted';
      else raise exception 'mp:invalid_transition' using errcode = '23514'; end if;

    when 'cancel_by_buyer', 'cancel_by_seller', 'cancel_timeout_seller', 'cancel_timeout_receipt' then
      if o.status = 'cancelled' then v_replay := true;
      else
        if not ((p_action = 'cancel_by_buyer' and o.status = 'new')
             or (p_action = 'cancel_by_seller' and o.status in ('new', 'preparing', 'ready'))
             or (p_action = 'cancel_timeout_seller' and o.status = 'new')
             or (p_action = 'cancel_timeout_receipt' and o.status in ('preparing', 'ready') and o.payment_status = 'receipt_disputed')) then
          raise exception 'mp:invalid_transition' using errcode = '23514';
        end if;
        if p_action = 'cancel_by_seller' then
          v_reason := app.marketplace_order_reason(v_payload, 'order_cancel_seller', true);
        elsif p_action = 'cancel_by_buyer' then
          v_reason := app.marketplace_order_reason(v_payload, 'order_cancel_buyer', false);
        end if;
        v_status := 'cancelled';
        v_stock := case o.stock_state when 'pending' then 'release' when 'deducted' then 'replenish' end;
        v_pay := case when o.payment_method = 'cod' then 'not_collected'
                      when p_action = 'cancel_timeout_receipt' then 'not_collected'
                      when o.payment_status in ('receipt_accepted', 'collected') then 'refund_due'
                      else 'not_collected' end;
        v_event := case p_action when 'cancel_by_buyer' then 'cancelled_by_buyer' when 'cancel_by_seller' then 'cancelled_by_seller'
                                 when 'cancel_timeout_seller' then 'cancelled_timeout_seller' else 'cancelled_timeout_receipt' end;
        v_notify := v_event;
        v_event_payload := jsonb_build_object('message_ar', v_reason ->> 'message_ar', 'message_en', v_reason ->> 'message_en');
      end if;

    when 'mark_delivery_failed' then
      if o.status = 'delivery_failed' then v_replay := true;
      elsif o.status = 'shipped' or (o.status = 'ready' and o.fulfilment = 'pickup') then
        v_status := 'delivery_failed'; v_event := 'delivery_failed';
        if o.payment_method = 'cod' and o.payment_status = 'pending' then v_pay := 'not_collected'; end if;
      else raise exception 'mp:invalid_transition' using errcode = '23514'; end if;

    when 'mark_returned_to_stock' then
      if o.status = 'returned' then v_replay := true;
      elsif o.status = 'delivery_failed' then
        v_status := 'returned'; v_event := 'returned_to_stock'; v_stock := 'replenish';
      else raise exception 'mp:invalid_transition' using errcode = '23514'; end if;

    else
      raise exception 'mp:invalid_action' using errcode = '22023';
  end case;

  if v_replay then
    return jsonb_set(app.marketplace_order_document_v2(o.id, v_for), '{replayed}', 'true'::jsonb, true);
  end if;

  -- stock: moves carry the idempotency keys of app.marketplace_order_stock, so a replay can never double-move
  if v_stock is not null then
    perform app.marketplace_order_stock(o.id, v_stock);
  end if;

  perform set_config('app.marketplace_order_apply', 'on', true);
  update public.marketplace_orders set
    status = v_status, payment_status = v_pay,
    stock_state = case v_stock when 'deduct' then 'deducted' when 'release' then 'released' when 'replenish'
                    then case when v_status = 'returned' then 'restocked' else 'restocked' end else stock_state end,
    preparing_at = case when v_status = 'preparing' and o.status <> 'preparing' then now() else preparing_at end,
    ready_at = case when v_status = 'ready' and o.status <> 'ready' then now() else ready_at end,
    shipped_at = case when v_status = 'shipped' and o.status <> 'shipped' then now() else shipped_at end,
    delivered_at = case when v_status = 'delivered' and o.status <> 'delivered' then now() else delivered_at end,
    cancelled_at = case when v_status = 'cancelled' and o.status <> 'cancelled' then now() else cancelled_at end,
    cancel_reason = case when v_status = 'cancelled' then left(coalesce(v_reason ->> 'message_en',
      case p_action when 'cancel_timeout_seller' then 'No preparation started in time' when 'cancel_timeout_receipt' then 'Receipt not re-uploaded in time' end), 300) else cancel_reason end
   where id = o.id;
  perform set_config('app.marketplace_order_apply', 'off', true);

  if p_action = 'mark_shipped' then
    insert into public.marketplace_order_shipments (order_id, carrier_name, tracking_number, shipped_by)
    values (o.id, v_carrier, v_track, p_actor)
    on conflict (order_id) do nothing;
  end if;
  if v_status = 'cancelled' then
    insert into public.marketplace_order_cancellations (order_id, cancelled_by_role, cancelled_by_user_id, reason_code, preset_id,
      label_ar, label_en, message_ar, message_en, internal_note, stock_effect)
    values (o.id, p_actor_role, p_actor,
      case p_action when 'cancel_timeout_seller' then 'timeout_seller_start' when 'cancel_timeout_receipt' then 'timeout_receipt_resubmit'
                    else coalesce(v_reason ->> 'code', 'none') end,
      nullif(v_reason ->> 'preset_id', '')::uuid, v_reason ->> 'label_ar', v_reason ->> 'label_en',
      v_reason ->> 'message_ar', v_reason ->> 'message_en',
      case when p_actor_role in ('seller', 'admin') then left(nullif(btrim(v_payload ->> 'internal_note'), ''), 300) end,
      case when v_stock = 'release' then 'released' else 'restocked' end);
  end if;

  if p_action = 'start_preparing' then perform app.marketplace_timer_close('order', o.id, 'order_seller_start', p_action); end if;
  if v_status = 'cancelled' then
    perform app.marketplace_timer_close('order', o.id, 'order_seller_start', 'cancel');
    perform app.marketplace_timer_close('order', o.id, 'order_receipt_resubmit', 'cancel');
  end if;
  if p_action = 'flag_receipt_not_received' then perform app.marketplace_timer_open('order', o.id, 'order_receipt_resubmit', now()); end if;
  if p_action in ('accept_receipt', 'resubmit_receipt') then perform app.marketplace_timer_close('order', o.id, 'order_receipt_resubmit', p_action); end if;

  insert into public.marketplace_order_events (order_id, action, from_status, to_status, from_payment, to_payment, actor_user_id, actor_role, note, payload)
  values (o.id, v_event, o.status, v_status, o.payment_status, v_pay, p_actor, p_actor_role, null, v_event_payload);

  if v_notify is not null then
    perform app.marketplace_order_notify(o.id, v_notify, coalesce(v_event_payload, '{}'::jsonb));
  end if;
  return app.marketplace_order_document_v2(o.id, v_for);
end;
$$;

-- ---------------------------------------------------------------------------
-- 14. Checkout: the single repricing function (called by prepare and again inside confirm)
-- ---------------------------------------------------------------------------
-- Returns the quote of contract 4.1 plus an `_internal` object (seller, address, missing codes, per-line ids) that
-- callers strip before it leaves the database. The browser contributes only { slug, sku, qty }.
create or replace function app.marketplace_checkout_quote(p_buyer uuid, p_lines jsonb, p_fulfilment text, p_address_id uuid,
  p_delivery_speed text, p_payment_method text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows     jsonb;
  r          jsonb;
  v_seller   uuid;
  v_sellers  uuid[];
  v_lines    jsonb := '[]'::jsonb;
  v_internal jsonb := '[]'::jsonb;
  v_subtotal numeric(14,2) := 0;
  v_missing  text[] := '{}';
  v_avail    integer;
  v_flagged  integer := 0;
  v_count    integer;
  v_nonret   jsonb := '[]'::jsonb;
  a          public.marketplace_buyer_addresses;
  prof       public.profiles;
  v_terms    jsonb;
  v_base     numeric(14,2) := 0;
  v_extra    numeric(14,2) := 0;
  v_free     boolean := false;
  v_fee      numeric(14,2) := 0;
  v_dstatus  text;
  v_estimate jsonb;
  v_nd       jsonb;
  v_pickup   boolean;
  s          public.marketplace_seller_payment_settings;
  v_methods  jsonb;
  v_total    numeric(14,2);
  v_pay_now  numeric(14,2);
  v_recip_name text;
  v_recip_phone text;
  v_seller_name text;
begin
  if p_fulfilment is null or p_fulfilment not in ('delivery', 'pickup') then
    raise exception 'mp:invalid_fulfilment' using errcode = '22023';
  end if;
  if p_delivery_speed is null or p_delivery_speed not in ('standard', 'next_day') then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  if p_payment_method is not null and p_payment_method not in ('cod', 'instapay_full', 'instapay_deposit') then
    raise exception 'mp:invalid_payment' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception 'mp:invalid_lines' using errcode = '22023';
  end if;

  with req as (
    select t.ord::int as ord, btrim(t.x ->> 'slug') as slug, btrim(t.x ->> 'sku') as sku,
           case when coalesce(t.x ->> 'qty', '') ~ '^[0-9]{1,4}$' then (t.x ->> 'qty')::int end as qty
    from jsonb_array_elements(p_lines) with ordinality as t(x, ord)
  ), res as (
    select req.ord, req.slug, req.sku, req.qty, p.id as product_id, p.seller_organization_id as seller,
           p.name_ar, p.name_en, p.non_returnable, pv.id as variant_id, pv.selling_unit, pv.price_egp
    from req
    left join public.marketplace_products p
      on req.slug ~ '^[a-z0-9-]{1,120}$' and p.slug = req.slug and p.status = 'published'
     and app.marketplace_seller_is_public(p.seller_organization_id)
     and exists (select 1 from public.marketplace_product_types pt join public.marketplace_categories pc on pc.id = pt.category_id
                 where pt.id = p.product_type_id and pt.is_active and pc.is_active)
    left join public.marketplace_product_variants pv
      on pv.product_id = p.id and req.sku ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$' and pv.sku = req.sku and pv.status = 'active'
  )
  select jsonb_agg(to_jsonb(res) order by ord) into v_rows from res;

  if exists (select 1 from jsonb_array_elements(v_rows) x where (x ->> 'variant_id') is null) then
    raise exception 'mp:cart_changed' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(v_rows) x where (x ->> 'qty') is null or (x ->> 'qty')::int < 1) then
    raise exception 'mp:invalid_quantity' using errcode = '22023';
  end if;
  if (select count(distinct x ->> 'variant_id') from jsonb_array_elements(v_rows) x) <> jsonb_array_length(v_rows) then
    raise exception 'mp:duplicate_line' using errcode = '22023';
  end if;
  select array_agg(distinct (x ->> 'seller')::uuid) into v_sellers from jsonb_array_elements(v_rows) x;
  if cardinality(v_sellers) <> 1 then
    raise exception 'mp:multi_seller_unsupported' using errcode = '23514';
  end if;
  v_seller := v_sellers[1];
  if app.marketplace_user_belongs_to_seller(p_buyer, v_seller) then
    raise exception 'mp:own_showroom' using errcode = '23514';
  end if;
  if cardinality(app.marketplace_seller_commerce_missing(v_seller)) > 0 then
    raise exception 'mp:seller_not_ready' using errcode = '23514';
  end if;
  select org.name into v_seller_name from public.organizations org where org.id = v_seller;

  for r in select x from jsonb_array_elements(v_rows) x loop
    v_avail := app.marketplace_variant_available((r ->> 'variant_id')::uuid);
    v_subtotal := v_subtotal + round((r ->> 'price_egp')::numeric * (r ->> 'qty')::int, 2);
    if app.marketplace_product_ships_free((r ->> 'product_id')::uuid) then v_flagged := v_flagged + 1; end if;
    if v_avail < (r ->> 'qty')::int then v_missing := array_append(v_missing, 'insufficient_stock'); end if;
    if (r ->> 'non_returnable')::boolean then v_nonret := v_nonret || to_jsonb(r ->> 'sku'); end if;
    v_lines := v_lines || jsonb_build_object(
      'slug', r ->> 'slug', 'sku', r ->> 'sku', 'name_ar', r ->> 'name_ar', 'name_en', r ->> 'name_en',
      'variant_label', app.marketplace_variant_label((r ->> 'variant_id')::uuid), 'selling_unit', r ->> 'selling_unit',
      'unit_price_egp', (r ->> 'price_egp')::numeric, 'quantity', (r ->> 'qty')::int,
      'line_total_egp', round((r ->> 'price_egp')::numeric * (r ->> 'qty')::int, 2),
      'image_id', app.marketplace_product_cover_image((r ->> 'product_id')::uuid), 'available', least(v_avail, 9999),
      'status', case when v_avail < (r ->> 'qty')::int then 'insufficient_stock' else 'ok' end,
      'non_returnable', (r ->> 'non_returnable')::boolean,
      'free_shipping', app.marketplace_product_ships_free((r ->> 'product_id')::uuid));
    v_internal := v_internal || jsonb_build_object('variant_id', r ->> 'variant_id', 'product_id', r ->> 'product_id',
      'slug', r ->> 'slug', 'sku', r ->> 'sku', 'qty', (r ->> 'qty')::int);
  end loop;
  v_count := jsonb_array_length(v_rows);

  v_pickup := exists (select 1 from public.marketplace_stock_locations l
                      where l.organization_id = v_seller and l.is_active and l.supports_pickup);
  select * into prof from public.profiles where user_id = p_buyer and deleted_at is null;

  if p_fulfilment = 'delivery' then
    if p_address_id is not null then
      select * into a from public.marketplace_buyer_addresses where id = p_address_id and user_id = p_buyer;
    end if;
    if a.id is null then
      v_missing := array_append(v_missing, 'address_missing');
      v_dstatus := 'not_available';
    else
      v_recip_name := left(btrim(a.recipient_first_name || ' ' || a.recipient_last_name), 100);
      v_recip_phone := a.recipient_phone_e164;
      if not app.marketplace_buyer_phone_is_verified(p_buyer, a.recipient_phone_e164) then
        v_missing := array_append(v_missing, 'phone_unverified');
      end if;
      v_terms := app.marketplace_delivery_terms(v_seller, a.governorate_key, a.area_key);
      if v_terms ->> 'status' <> 'available' or not coalesce((v_terms ->> 'configured')::boolean, false) then
        v_missing := array_append(v_missing, 'delivery_not_available');
        v_dstatus := 'not_available';
      else
        v_dstatus := 'available';
        v_base := (v_terms ->> 'fee_egp')::numeric;
        v_free := v_base = 0 or v_flagged = v_count
               or (v_terms ->> 'free_min_egp' is not null and v_subtotal >= (v_terms ->> 'free_min_egp')::numeric);
        v_nd := v_terms -> 'next_day';
        if p_delivery_speed = 'next_day' then
          if v_nd is null or v_nd = 'null'::jsonb then
            v_missing := array_append(v_missing, 'next_day_not_available');
          else
            v_extra := (v_nd ->> 'fee_egp')::numeric;
            v_estimate := jsonb_build_object('earliest', v_nd ->> 'arrival', 'latest', v_nd ->> 'arrival');
          end if;
        end if;
        if v_estimate is null then
          v_estimate := jsonb_build_object('earliest', v_terms ->> 'earliest', 'latest', v_terms ->> 'latest');
        end if;
      end if;
    end if;
  else
    if p_delivery_speed <> 'standard' then
      raise exception 'mp:invalid_payload' using errcode = '22023';
    end if;
    v_dstatus := 'pickup';
    v_recip_name := left(prof.display_name, 100);
    v_recip_phone := prof.phone_e164;
    if not v_pickup then v_missing := array_append(v_missing, 'pickup_not_available'); end if;
    if prof.phone_e164 is null or prof.phone_verified_at is null then v_missing := array_append(v_missing, 'phone_unverified'); end if;
  end if;
  v_fee := case when v_free then 0 else v_base end + v_extra;
  v_total := v_subtotal + v_fee;

  select * into s from public.marketplace_seller_payment_settings where seller_organization_id = v_seller;
  v_methods := jsonb_build_object('cod', coalesce(s.cod_enabled, false), 'instapay_full', coalesce(s.instapay_full_enabled, false),
    'instapay_deposit', case when coalesce(s.instapay_enabled, false) then jsonb_build_object('deposit_percent', s.instapay_deposit_percent) end);
  if p_payment_method is not null then
    if (p_payment_method = 'cod' and not coalesce(s.cod_enabled, false))
       or (p_payment_method = 'instapay_full' and not coalesce(s.instapay_full_enabled, false))
       or (p_payment_method = 'instapay_deposit' and not coalesce(s.instapay_enabled, false)) then
      v_missing := array_append(v_missing, 'payment_not_available');
    end if;
    v_pay_now := case p_payment_method when 'cod' then 0 when 'instapay_full' then v_total
                   else round(v_total * coalesce(s.instapay_deposit_percent, 0) / 100.0, 2) end;
  end if;

  return jsonb_build_object(
    'lines', v_lines,
    'seller', jsonb_build_object('name', v_seller_name, 'pickup_available', v_pickup),
    'fulfilment', p_fulfilment, 'delivery_speed', p_delivery_speed,
    'delivery', jsonb_build_object('status', v_dstatus, 'fee_egp', v_fee, 'free', v_free and v_fee = 0,
      'estimate', v_estimate,
      'next_day', case when v_nd is not null and v_nd <> 'null'::jsonb then v_nd end),
    'subtotal_egp', v_subtotal, 'delivery_fee_egp', v_fee, 'total_egp', v_total,
    'payment', jsonb_build_object('method', p_payment_method, 'methods_enabled', v_methods,
      'pay_now_egp', v_pay_now, 'balance_due_egp', case when v_pay_now is not null then v_total - v_pay_now end,
      'instapay', case when p_payment_method in ('instapay_full', 'instapay_deposit')
        then jsonb_build_object('address', s.instapay_address, 'account_name', s.instapay_account_name) end),
    'receipt_required', coalesce(p_payment_method in ('instapay_full', 'instapay_deposit'), false),
    'non_returnable_lines', v_nonret,
    'warnings', '[]'::jsonb,
    '_internal', jsonb_build_object('seller_id', v_seller, 'address_id', a.id, 'missing', to_jsonb(v_missing),
      'recipient_name', v_recip_name, 'recipient_phone', v_recip_phone, 'lines', v_internal));
end;
$$;

-- What the buyer agrees to: everything that is a price, a fee, a date, a method or a quantity; not the live stock figure.
create or replace function app.marketplace_checkout_quote_hash(p_quote jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('slug', l ->> 'slug', 'sku', l ->> 'sku', 'q', l -> 'quantity',
              'p', l -> 'unit_price_egp') order by ord), '[]'::jsonb) from jsonb_array_elements(p_quote -> 'lines') with ordinality t(l, ord)),
    'fulfilment', p_quote -> 'fulfilment', 'speed', p_quote -> 'delivery_speed', 'fee', p_quote -> 'delivery_fee_egp',
    'subtotal', p_quote -> 'subtotal_egp', 'total', p_quote -> 'total_egp', 'estimate', p_quote -> 'delivery' -> 'estimate',
    'method', p_quote -> 'payment' -> 'method', 'now', p_quote -> 'payment' -> 'pay_now_egp',
    'address', p_quote -> '_internal' -> 'address_id')::text, 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function app.marketplace_checkout_receipts(p_session uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'status', pr.status, 'created_at', pr.created_at) order by pr.created_at), '[]'::jsonb)
  from public.marketplace_payment_proofs pr
  where pr.checkout_session_id = p_session and pr.order_id is null and pr.upload_state = 'confirmed' and pr.status <> 'superseded';
$$;

-- ---------------------------------------------------------------------------
-- 15. Checkout RPCs
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_checkout_prepare(p_lines jsonb, p_fulfilment text, p_address_id uuid,
  p_delivery_speed text, p_payment_method text, p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_payment text := p_payment_method;
  v_quote   jsonb;
  v_seller  uuid;
  v_methods jsonb;
  s         public.marketplace_checkout_sessions;
  v_missing jsonb;
  v_hash    text;
  v_has_receipt boolean;
begin
  if v_uid is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  if not app.account_is_active(v_uid) then
    raise exception 'mp:account_inactive' using errcode = '42501';
  end if;
  if not app.marketplace_is_open() then
    raise exception 'mp:marketplace_closed' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('aladdin.marketplace_checkout:' || v_uid::text, 0));

  -- no payment chosen yet: the first method the showroom offers (the page shows it selected)
  v_quote := app.marketplace_checkout_quote(v_uid, p_lines, p_fulfilment, p_address_id, coalesce(p_delivery_speed, 'standard'), null);
  if v_payment is null then
    v_methods := v_quote -> 'payment' -> 'methods_enabled';
    v_payment := case when (v_methods ->> 'cod')::boolean then 'cod' when (v_methods ->> 'instapay_full')::boolean then 'instapay_full'
                      when v_methods -> 'instapay_deposit' is not null and v_methods -> 'instapay_deposit' <> 'null'::jsonb then 'instapay_deposit' end;
    if v_payment is null then
      raise exception 'mp:seller_not_ready' using errcode = '23514';
    end if;
  end if;
  v_quote := app.marketplace_checkout_quote(v_uid, p_lines, p_fulfilment, p_address_id, coalesce(p_delivery_speed, 'standard'), v_payment);
  v_seller := (v_quote -> '_internal' ->> 'seller_id')::uuid;

  if p_session_id is not null then
    select * into s from public.marketplace_checkout_sessions where id = p_session_id and buyer_user_id = v_uid for update;
    if not found then
      raise exception 'mp:session_not_found' using errcode = '42501';
    end if;
    if s.state = 'confirmed' then
      raise exception 'mp:session_not_found' using errcode = '23514';
    end if;
    if s.state <> 'open' or s.expires_at < now() then
      raise exception 'mp:session_expired' using errcode = '23514';
    end if;
  else
    if (select count(*) from public.marketplace_checkout_sessions where buyer_user_id = v_uid and created_at > now() - interval '1 hour') >= 30 then
      raise exception 'mp:upload_rate_limited' using errcode = 'P0001';
    end if;
    update public.marketplace_checkout_sessions set state = 'abandoned' where buyer_user_id = v_uid and state = 'open';
    insert into public.marketplace_checkout_sessions (buyer_user_id, seller_organization_id, lines, fulfilment, address_id, delivery_speed,
      payment_method, quote, quote_hash)
    values (v_uid, v_seller, p_lines, p_fulfilment, p_address_id, coalesce(p_delivery_speed, 'standard'), v_payment, '{}'::jsonb, '-')
    returning * into s;
  end if;

  v_hash := app.marketplace_checkout_quote_hash(v_quote);
  update public.marketplace_checkout_sessions set
    seller_organization_id = v_seller, lines = p_lines, fulfilment = p_fulfilment, address_id = p_address_id,
    delivery_speed = coalesce(p_delivery_speed, 'standard'), payment_method = v_payment,
    quote = v_quote - '_internal', quote_hash = v_hash,
    expires_at = least(s.created_at + interval '24 hours', now() + interval '2 hours')
   where id = s.id returning * into s;

  v_has_receipt := exists (select 1 from public.marketplace_payment_proofs pr where pr.checkout_session_id = s.id
                           and pr.order_id is null and pr.upload_state = 'confirmed' and pr.status <> 'superseded');
  v_missing := (v_quote -> '_internal' -> 'missing')
    || case when (v_quote ->> 'receipt_required')::boolean and not v_has_receipt then '["receipt_required"]'::jsonb else '[]'::jsonb end;
  return jsonb_build_object('session_id', s.id, 'expires_at', s.expires_at, 'quote', v_quote - '_internal', 'quote_hash', v_hash,
    'ready', jsonb_array_length(v_missing) = 0, 'missing', v_missing);
end;
$$;

create or replace function public.marketplace_checkout_receipt_request_upload(p_session_id uuid, p_content_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  s     public.marketplace_checkout_sessions;
  v_id  uuid := gen_random_uuid();
  v_ext text;
  v_key text;
begin
  if v_uid is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  select * into s from public.marketplace_checkout_sessions where id = p_session_id and buyer_user_id = v_uid for update;
  if not found then
    raise exception 'mp:session_not_found' using errcode = '42501';
  end if;
  if s.state <> 'open' or s.expires_at < now() then
    raise exception 'mp:session_expired' using errcode = '23514';
  end if;
  if s.payment_method not in ('instapay_full', 'instapay_deposit') then
    raise exception 'mp:proof_not_expected' using errcode = '23514';
  end if;
  v_ext := case p_content_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  if v_ext is null then
    raise exception 'mp:image_type_invalid' using errcode = '22023';
  end if;
  if (select count(*) from public.marketplace_payment_proofs where checkout_session_id = s.id and order_id is null
        and upload_state = 'confirmed' and status <> 'superseded') >= 3 then
    raise exception 'mp:receipt_limit' using errcode = '23514';
  end if;
  if (select count(*) from public.marketplace_payment_proofs where checkout_session_id = s.id and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'mp:upload_rate_limited' using errcode = 'P0001';
  end if;
  v_key := 'proofs/' || s.id || '/' || v_id || '.' || v_ext;
  insert into public.marketplace_payment_proofs (id, order_id, checkout_session_id, object_key, mime_type, created_by, purpose)
  values (v_id, null, s.id, v_key, p_content_type, v_uid, 'initial');
  return jsonb_build_object('proof_id', v_id, 'object_key', v_key);
end;
$$;

create or replace function public.marketplace_checkout_receipt_confirm(p_proof_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  pr    public.marketplace_payment_proofs;
  s     public.marketplace_checkout_sessions;
  l     public.media_storage_locations;
begin
  if v_uid is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  select * into pr from public.marketplace_payment_proofs
   where id = p_proof_id and created_by = v_uid and checkout_session_id is not null and order_id is null for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  select * into s from public.marketplace_checkout_sessions where id = pr.checkout_session_id for update;
  if pr.upload_state = 'confirmed' then
    return jsonb_build_object('session_id', s.id, 'receipts', app.marketplace_checkout_receipts(s.id), 'receipt_ok', true);
  end if;
  if pr.upload_state <> 'awaiting_upload' or s.state <> 'open' or s.expires_at < now() then
    raise exception 'mp:session_expired' using errcode = '23514';
  end if;
  select * into l from public.media_storage_locations
   where namespace = 'marketplace' and object_key = pr.object_key and verified_at is not null;
  if not found then
    raise exception 'mp:upload_not_found' using errcode = '23514';
  end if;
  update public.marketplace_payment_proofs set upload_state = 'confirmed', status = 'submitted',
    byte_size = l.size_bytes, checksum_sha256 = l.sha256 where id = pr.id;
  return jsonb_build_object('session_id', s.id, 'receipts', app.marketplace_checkout_receipts(s.id), 'receipt_ok', true);
end;
$$;

create or replace function public.marketplace_checkout_receipt_remove(p_proof_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  pr    public.marketplace_payment_proofs;
  s     public.marketplace_checkout_sessions;
begin
  if v_uid is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  select * into pr from public.marketplace_payment_proofs
   where id = p_proof_id and created_by = v_uid and checkout_session_id is not null and order_id is null for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  select * into s from public.marketplace_checkout_sessions where id = pr.checkout_session_id for update;
  if s.state <> 'open' then
    raise exception 'mp:session_expired' using errcode = '23514';
  end if;
  -- the central cleanup removes the bytes (state 'deleting' is what app.marketplace_media_cleanup_rows lists)
  update public.marketplace_payment_proofs set upload_state = 'deleting' where id = pr.id and upload_state <> 'deleting';
  return jsonb_build_object('session_id', s.id, 'receipts', app.marketplace_checkout_receipts(s.id));
end;
$$;

create or replace function public.marketplace_checkout_confirm(p_session_id uuid, p_quote_hash text, p_idempotency_key text, p_buyer_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- Service role only: expires old sessions and hands their unattached receipts to the central media cleanup.
create or replace function public.marketplace_checkout_sessions_purge(p_retention interval default '7 days', p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  with due as (
    select id from public.marketplace_checkout_sessions
     where (state = 'open' and expires_at < now()) or (state = 'abandoned' and created_at < now() - p_retention)
     order by created_at limit greatest(coalesce(p_limit, 200), 1)
  ), expired as (
    update public.marketplace_checkout_sessions x set state = case when x.state = 'open' then 'expired' else x.state end
      from due where x.id = due.id returning x.id
  )
  update public.marketplace_payment_proofs pr set upload_state = 'deleting'
   where pr.order_id is null and pr.upload_state in ('awaiting_upload', 'confirmed')
     and pr.checkout_session_id in (select id from expired);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 16. Stock-alert hook (PR 14 replaces the body; PR 12 calls it after `reserve`)
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_order_stock_alert(p_order uuid)
returns void language plpgsql security definer set search_path = '' as $$ begin null; end; $$;

-- ---------------------------------------------------------------------------
-- 17. Public wrappers: authorize, then call the machine
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_seller_order_action(p_order_id uuid, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.marketplace_orders;
  v_action text;
begin
  if (select auth.uid()) is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  select * into o from public.marketplace_orders where id = p_order_id;
  if not found or not app.marketplace_can_manage_orders(o.seller_organization_id) then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  if o.source <> 'v2' then
    raise exception 'mp:legacy_order' using errcode = '23514';
  end if;
  if p_payload is not null and jsonb_typeof(p_payload) <> 'object' then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  v_action := case p_action when 'cancel' then 'cancel_by_seller' else p_action end;
  if v_action is null or v_action not in ('start_preparing', 'mark_ready', 'mark_shipped', 'mark_delivered', 'collect_payment',
       'accept_receipt', 'flag_receipt_not_received', 'cancel_by_seller', 'mark_delivery_failed', 'mark_returned_to_stock') then
    raise exception 'mp:invalid_action' using errcode = '22023';
  end if;
  return app.marketplace_order_apply(o.id, v_action, 'seller', (select auth.uid()), p_payload);
end;
$$;

create or replace function public.marketplace_buyer_order_cancel_v2(p_order_id uuid, p_preset_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  o public.marketplace_orders;
begin
  if v_uid is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  select * into o from public.marketplace_orders where id = p_order_id and buyer_user_id = v_uid;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  return app.marketplace_order_apply(o.id, 'cancel_by_buyer', 'buyer', v_uid,
    jsonb_build_object('preset_id', p_preset_id, 'message', nullif(btrim(p_note), '')));
end;
$$;

create or replace function public.marketplace_buyer_receipt_resubmit_request_upload(p_order_id uuid, p_content_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  o     public.marketplace_orders;
  v_id  uuid := gen_random_uuid();
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
  if o.source <> 'v2' then
    raise exception 'mp:legacy_order' using errcode = '23514';
  end if;
  if o.payment_method not in ('instapay_full', 'instapay_deposit') or o.status not in ('preparing', 'ready')
     or o.payment_status <> 'receipt_disputed' then
    raise exception 'mp:proof_not_expected' using errcode = '23514';
  end if;
  v_ext := case p_content_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  if v_ext is null then
    raise exception 'mp:image_type_invalid' using errcode = '22023';
  end if;
  if (select count(*) from public.marketplace_payment_proofs where order_id = o.id and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'mp:upload_rate_limited' using errcode = 'P0001';
  end if;
  v_key := 'proofs/' || o.id || '/' || v_id || '.' || v_ext;
  insert into public.marketplace_payment_proofs (id, order_id, object_key, mime_type, created_by, purpose)
  values (v_id, o.id, v_key, p_content_type, v_uid, 'resubmission');
  return jsonb_build_object('proof_id', v_id, 'object_key', v_key);
end;
$$;

create or replace function public.marketplace_buyer_receipt_resubmit_confirm(p_proof_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  pr    public.marketplace_payment_proofs;
  o     public.marketplace_orders;
  l     public.media_storage_locations;
begin
  if v_uid is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  select * into pr from public.marketplace_payment_proofs
   where id = p_proof_id and created_by = v_uid and purpose = 'resubmission' and order_id is not null for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  select * into o from public.marketplace_orders where id = pr.order_id for update;
  if pr.upload_state = 'confirmed' then
    return app.marketplace_order_document_v2(o.id, 'buyer');
  end if;
  if pr.upload_state <> 'awaiting_upload' then
    raise exception 'mp:proof_not_expected' using errcode = '23514';
  end if;
  select * into l from public.media_storage_locations
   where namespace = 'marketplace' and object_key = pr.object_key and verified_at is not null;
  if not found then
    raise exception 'mp:upload_not_found' using errcode = '23514';
  end if;
  update public.marketplace_payment_proofs set upload_state = 'confirmed', status = 'submitted',
    byte_size = l.size_bytes, checksum_sha256 = l.sha256 where id = pr.id;
  return app.marketplace_order_apply(o.id, 'resubmit_receipt', 'buyer', v_uid, jsonb_build_object('proof_id', pr.id));
end;
$$;

create or replace function public.marketplace_order_reason_presets(p_action text)
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
  if p_action is null or p_action not in ('order_cancel_seller', 'order_cancel_buyer', 'payment_issue') then
    raise exception 'mp:invalid_action' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'label_ar', p.label_ar, 'label_en', p.label_en,
           'text_ar', p.text_ar, 'text_en', p.text_en) order by p.sort_order, p.created_at)
         from public.marketplace_seller_message_presets p where p.action = p_action and p.is_active), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 18. The legacy order document gains the new keys (additive; the promoted app ignores them). The thank-you page
--     reads it until PR 13 ships marketplace_buyer_order_get_v2.
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text;
  v_new text;
  v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'marketplace_order_document';
  v_def := pg_get_functiondef(v_oid);
  v_new := replace(v_def, '''cancel_reason'', o.cancel_reason,',
    '''cancel_reason'', o.cancel_reason, ''source'', o.source, ''delivery_speed'', o.delivery_speed, ''placed_at'', o.placed_at, '
    || '''estimate_earliest'', o.delivery_estimate_earliest, ''estimate_latest'', o.delivery_estimate_latest, '
    || '''paid_now_egp'', o.paid_now_egp, ''balance_due_egp'', o.balance_due_egp,');
  if v_new = v_def then raise exception 'legacy order document patch failed'; end if;
  execute v_new;
end;
$do$;

-- ---------------------------------------------------------------------------
-- 19. The seven media functions, rebuilt once (receipts bound to a session; hook branches; returns/<id>/<evidence> keys)
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_media_metadata(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('owner', i.created_by, 'organization', p.seller_organization_id, 'contentType', i.mime_type,
    'state', case i.upload_state when 'awaiting_upload' then 'pending' when 'confirmed' then 'ready' else 'deleted' end,
    'createdAt', i.created_at)
  from public.marketplace_product_images i join public.marketplace_products p on p.id = i.product_id
  where i.object_key = p_key
  union all
  select jsonb_build_object('owner', pr.created_by, 'organization', null, 'contentType', pr.mime_type,
    'state', case pr.upload_state when 'awaiting_upload' then 'pending' when 'confirmed' then 'ready' else 'deleted' end,
    'createdAt', pr.created_at)
  from public.marketplace_payment_proofs pr
  where pr.object_key = p_key
  union all
  select app.marketplace_return_evidence_metadata(p_key) where app.marketplace_return_evidence_metadata(p_key) is not null;
$$;

create or replace function app.marketplace_media_storage_key(p_key text, p_owner uuid, p_org uuid)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  u constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  f text[];
begin
  -- receipts: proofs/<checkout session or order>/<proof>.<ext>; return evidence: returns/<order>/<evidence>.<ext>
  f := regexp_match(p_key, '^(?:proofs|returns)/' || u || '/(' || u || ')\.([a-z0-9]{2,5})$');
  if f is not null then
    if p_owner is null then raise exception 'unexpected media key' using errcode = '22023'; end if;
    return 'u/' || p_owner || '/certificates/' || f[1] || '/original.' || f[2];
  end if;
  f := regexp_match(p_key, '^' || u || '/(' || u || ')/(' || u || ')\.([a-z0-9]{2,5})$');
  if f is null or p_org is null then raise exception 'unexpected media key' using errcode = '22023'; end if;
  return 'o/' || p_org || '/products/' || f[1] || '/' || f[2] || '/original.' || f[3];
end;
$$;

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
     -- a receipt that never reached an order (abandoned checkout) is not kept
     or (pr.order_id is null and pr.created_at < now() - interval '24 hours');
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
  return found;
end;
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
      and pr.created_at > now() - interval '1 hour' and pr.created_by = (select auth.uid()));
$$;

create or replace function app.marketplace_media_can_read(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.marketplace_product_images i
    join public.marketplace_products p on p.id = i.product_id
    where i.object_key = p_key and i.upload_state = 'confirmed'
      and (app.is_org_member(p.seller_organization_id) or app.has_admin_permission('marketplace_media.moderate')))
  or exists (
    -- a receipt: the buyer who uploaded it, and (once it is attached to an order) the showroom's order managers
    select 1 from public.marketplace_payment_proofs pr left join public.marketplace_orders o on o.id = pr.order_id
    where pr.object_key = p_key and pr.upload_state = 'confirmed'
      and (pr.created_by = (select auth.uid()) or (o.id is not null and app.marketplace_can_manage_orders(o.seller_organization_id))))
  or app.marketplace_complaint_admin_can_read(p_key)
  or app.marketplace_return_evidence_can_read(p_key);
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
    where pr.object_key = p_key and pr.upload_state in ('awaiting_upload', 'deleting') and pr.created_by = (select auth.uid()));
$$;

-- A buyer's receipt is buyer-owned: its metadata carries NO organization, so reserve's per-organization rate/quota is never charged
-- to the showroom (cross-tenant quota exhaustion). Read access still goes through app.marketplace_media_can_read.
create or replace function public.organization_media_resolve(p_namespace text,p_key text,p_operation text,p_workspace uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m jsonb; allowed boolean := false; v_provider text; v_uid uuid := (select auth.uid());
begin
  if p_namespace not in ('product','organization','request','verification','marketplace') or v_uid is null
    or not app.account_is_active(v_uid) then return null; end if;
  m:=app.media_metadata(p_namespace,p_key);
  -- A personal purchase request and a buyer's marketplace receipt have no organization (buyer-owned; their limits are per user,
  -- never charged to the showroom); every other namespace needs a live one.
  if m is null or (p_namespace<>'request' and not (p_namespace='marketplace' and m->>'organization' is null) and not exists(select 1 from public.organizations
      where id=(m->>'organization')::uuid and deleted_at is null)) then return null; end if;
  if p_operation='upload' then
    allowed:=m->>'state'='pending' and (m->>'createdAt')::timestamptz>now()-interval '24 hours'
      and case p_namespace when 'product' then app.can_upload_product_image_object(p_key)
          when 'request' then app.can_upload_request_image_object(p_key)
          when 'verification' then app.can_upload_bv_object(p_key)
          when 'marketplace' then app.marketplace_media_can_upload(p_key)
          else app.can_upload_organization_image_object(p_key) end;
  elsif p_operation='read' then
    if p_namespace='product' then
      allowed:=m->>'state'='ready' and (app.is_org_member((m->>'organization')::uuid)
        or exists(select 1 from public.product_images i where i.object_key=p_key
          and app.product_is_public(i.product_id) and app.product_image_viewable(i.product_id,p_workspace)));
    elsif p_namespace='request' then
      -- The requester side, or another workspace that may read the request RIGHT NOW (re-checked per use).
      allowed:=m->>'state'='ready' and exists(select 1 from public.purchase_request_images i
        where i.object_key=p_key and (app.is_request_owner_side(i.request_id)
          or (p_workspace is not null and app.request_image_viewable(i.request_id,p_workspace))));
    elsif p_namespace='verification' then
      allowed:=m->>'state'='ready' and app.can_read_bv_object(p_key);
    elsif p_namespace='marketplace' then
      -- Signed-in reads: the seller's members and media moderators. The public shop uses marketplace_public_image_ref.
      allowed:=m->>'state'='ready' and app.marketplace_media_can_read(p_key);
    else
      allowed:=m->>'state'='ready' and exists(select 1 from public.organization_images i
        join public.organizations o on o.logo_media_id=i.id where i.object_key=p_key and app.is_org_member(o.id));
    end if;
  elsif p_operation='delete' then
    allowed:=m->>'state'='deleted' and case p_namespace
      when 'product' then app.can_write_catalog((m->>'organization')::uuid)
      when 'request' then app.can_delete_request_image_object(p_key)
      when 'verification' then app.can_delete_bv_object(p_key)
      when 'marketplace' then app.marketplace_media_can_delete(p_key)
      else app.has_capability((m->>'organization')::uuid,'org.manage') end;
  end if;
  if not coalesce(allowed,false) then return null; end if;
  select provider into v_provider from public.media_storage_locations where namespace=p_namespace and object_key=p_key;
  return jsonb_build_object('provider',coalesce(v_provider,'supabase'),'reserved',v_provider is not null,
    'contentType',m->>'contentType','state',m->>'state',
    'owner',case when p_operation='upload' or (m->>'owner')::uuid=v_uid then m->>'owner' else null end);
end;
$$;

-- ---------------------------------------------------------------------------
-- 20. Grants. Internal functions have none; public functions are authenticated-only (the purge: service role only).
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname in ('marketplace_order_state_guard', 'marketplace_order_stock', 'marketplace_timer_open',
      'marketplace_timer_close', 'marketplace_notify_order_managers', 'marketplace_order_notify', 'marketplace_order_reason',
      'marketplace_variant_label', 'marketplace_order_actions', 'marketplace_order_document_v2', 'marketplace_order_apply',
      'marketplace_checkout_quote', 'marketplace_checkout_quote_hash', 'marketplace_checkout_receipts',
      'marketplace_order_stock_alert', 'marketplace_order_complaint_id', 'marketplace_order_extra_actions', 'marketplace_complaint_admin_can_read', 'marketplace_return_evidence_can_read',
      'marketplace_return_evidence_metadata', 'marketplace_order_document', 'marketplace_media_metadata',
      'marketplace_media_storage_key', 'marketplace_media_cleanup_rows', 'marketplace_media_retire',
      'marketplace_media_can_upload', 'marketplace_media_can_read', 'marketplace_media_can_delete')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
  end loop;
end;
$$;

revoke all on function
  public.marketplace_checkout_prepare(jsonb, text, uuid, text, text, uuid),
  public.marketplace_checkout_receipt_request_upload(uuid, text),
  public.marketplace_checkout_receipt_confirm(uuid),
  public.marketplace_checkout_receipt_remove(uuid),
  public.marketplace_checkout_confirm(uuid, text, text, text),
  public.marketplace_checkout_sessions_purge(interval, integer),
  public.marketplace_seller_order_action(uuid, text, jsonb),
  public.marketplace_buyer_order_cancel_v2(uuid, uuid, text),
  public.marketplace_buyer_receipt_resubmit_request_upload(uuid, text),
  public.marketplace_buyer_receipt_resubmit_confirm(uuid),
  public.marketplace_order_reason_presets(text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.marketplace_checkout_prepare(jsonb, text, uuid, text, text, uuid),
  public.marketplace_checkout_receipt_request_upload(uuid, text),
  public.marketplace_checkout_receipt_confirm(uuid),
  public.marketplace_checkout_receipt_remove(uuid),
  public.marketplace_checkout_confirm(uuid, text, text, text),
  public.marketplace_seller_order_action(uuid, text, jsonb),
  public.marketplace_buyer_order_cancel_v2(uuid, uuid, text),
  public.marketplace_buyer_receipt_resubmit_request_upload(uuid, text),
  public.marketplace_buyer_receipt_resubmit_confirm(uuid),
  public.marketplace_order_reason_presets(text)
  to authenticated;
grant execute on function public.marketplace_checkout_sessions_purge(interval, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 21. Two more hooks for PR 14 (default bodies; PR 14 replaces them): the complaint of a disputed receipt, extra buyer/seller actions
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_order_complaint_id(p_order uuid)
returns uuid language sql stable security definer set search_path = '' as $$ select null::uuid; $$;
create or replace function app.marketplace_order_extra_actions(p_order uuid, p_for text)
returns text[] language sql stable security definer set search_path = '' as $$ select '{}'::text[]; $$;
revoke all on function app.marketplace_order_complaint_id(uuid), app.marketplace_order_extra_actions(uuid, text)
  from public, anon, authenticated, service_role;
