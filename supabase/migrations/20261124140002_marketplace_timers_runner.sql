-- Marketplace PR 14 (2/3): the timer runner, its handlers, admin fan-out, the complaint read hook and the timer templates.
--
-- WHAT THIS ADDS
--   * public.marketplace_timers_run(p_limit, p_now)   service role ONLY. One bounded, idempotent pass over due timers.
--     Scheduler: a Cloudflare cron Worker (edge/marketplace-timers-worker) or scripts/marketplace-timers.mjs. There is no pg_cron.
--   * app.marketplace_timer_handle(timer, now)         dispatch by kind. order_seller_start and order_receipt_resubmit live here;
--     return_* kinds call the hook app.marketplace_return_timer_tick (default no-op, PR 15 replaces it, same signature).
--   * app.marketplace_notify_admins(...)               one notification per admin holding a permission.
--   * app.marketplace_complaint_admin_can_read(key)    hook body: an admin holding the review permission reads the receipts of an
--     order that has a complaint, nothing else.
--   * notification templates 10-13 of the contract (reminders and automatic cancellations).
--
-- NEEDS: PR 12 (marketplace_timers, app.marketplace_order_apply, app.marketplace_timer_open/close, app.marketplace_notify_order_managers,
-- the notification event vocabulary). Nothing is dropped.
--
-- RUNNER RULES (contract section 5.3, owner decisions 4C: seller reminder every 6 h and cancel at 72 h; buyer reminder at 24 h and cancel at 48 h)
--   * due = active and (expires_at <= now or next_remind_at <= now); FOR UPDATE SKIP LOCKED, bounded by p_limit, so two overlapping runs
--     never process the same timer.
--   * expiry first: an expiring timer sends no reminder. The expiry goes through app.marketplace_order_apply, which re-checks the order
--     under its row lock (stock release/replenish and notifications therefore happen exactly once, by the machine's own rules).
--   * the order row is locked with SKIP LOCKED too: a timer whose order is being changed right now is left for the next run, so the
--     runner never waits on an order lock (no deadlock with a seller pressing a button).
--   * an order that already moved on closes the timer 'done' with no side effect.
--   * a payment complaint that is open or under review PAUSES the buyer's receipt timer (no reminder, no expiry): the buyer must not
--     lose the order while an admin decides. After the decision the normal rules resume; the 48 h are not restarted (contract 4.4).
--     ASSUMED pending owner confirmation (open question for the owner: should the buyer get a fresh grace period after a
--     "payment not received" decision?).
--   * low / out of stock notifications (contract matrix row 16) already exist since PR 7 (trigger marketplace_stock_notify on the
--     inventory levels, templates marketplace.stock.low / .out) and fire on the `reserve` an order causes, so the reserved hook
--     app.marketplace_order_stock_alert stays PR 12's no-op: replacing it would notify twice.
--   * one reminder per run per timer, however long the runner was down; the next reminder stays on the original schedule.
--   * every timer is its own sub-transaction: a failure is counted and never blocks the rest. Only counts are returned: no id, no name.

-- ---------------------------------------------------------------------------
-- 1. Hook for PR 15 (default no-op)
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_return_timer_tick(p_timer public.marketplace_timers, p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$ begin return; end; $$;
revoke all on function app.marketplace_return_timer_tick(public.marketplace_timers, timestamptz) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Admin fan-out. p_vars may carry per-language variables as vars_ar / vars_en objects.
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_notify_admins(p_permission text, p_template_key text, p_subject_type text,
  p_subject_id uuid, p_deep_link text, p_vars jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid;
  v_count integer := 0;
  v_vars  jsonb := coalesce(p_vars, '{}'::jsonb) - 'vars_ar' - 'vars_en';
begin
  -- active platform-scope assignments of an active role that holds the permission; suspended accounts are skipped.
  -- app.notify suppresses a notification to the acting user.
  for v_user in
    select distinct a.user_id
      from public.admin_role_assignments a
      join public.admin_roles r on r.id = a.role_id
      join public.admin_role_permissions rp on rp.role_id = r.id and rp.permission_key = p_permission
      join public.admin_permissions p on p.key = rp.permission_key
      join public.users u on u.id = a.user_id
     where a.is_active and r.status = 'active' and p.is_active and a.scope_type = 'platform'
       and u.status not in ('suspended', 'deactivated')
     order by a.user_id
  loop
    if app.notify_from_template(v_user, null, p_template_key, p_subject_type, p_subject_id, p_deep_link, v_vars,
         p_vars -> 'vars_ar', p_vars -> 'vars_en') is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function app.marketplace_notify_admins(text, text, text, uuid, text, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Complaint read hook: receipts of an order that has a complaint, for an admin holding the permission
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_complaint_admin_can_read(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_admin_permission('marketplace_payment_complaints.review')
     and exists (
       select 1 from public.marketplace_payment_proofs pr
        where pr.object_key = p_key and pr.upload_state = 'confirmed' and pr.order_id is not null
          and exists (select 1 from public.marketplace_payment_complaints c where c.order_id = pr.order_id));
$$;
revoke all on function app.marketplace_complaint_admin_can_read(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Templates 10-13 (in-app only; both languages; no phone, address or receipt link)
-- ---------------------------------------------------------------------------
insert into public.notification_templates
  (key, event_type, variables, default_title_ar, default_body_ar, default_title_en, default_body_en) values
  ('marketplace.order.reminder_seller_start', 'marketplace.order.reminder_seller_start',
   array['order_number', 'showroom_name', 'hours_waiting', 'hours_left'],
   'طلب ينتظر بدء التجهيز',
   'الطلب {order_number} ينتظر منذ {hours_waiting} ساعة. ابدأ التجهيز قبل أن يُلغى تلقائيًا بعد {hours_left} ساعة.',
   'An order is waiting to be prepared',
   'Order {order_number} has been waiting for {hours_waiting} hours. Start preparing it before it is cancelled automatically in {hours_left} hours.'),
  ('marketplace.order.cancelled_timeout_seller', 'marketplace.order.cancelled_timeout_seller',
   array['order_number', 'showroom_name'],
   'تم إلغاء الطلب تلقائيًا',
   'تم إلغاء الطلب {order_number} تلقائيًا لأن المعرض لم يبدأ التجهيز خلال 72 ساعة. أُعيدت الكمية إلى المخزون.',
   'The order was cancelled automatically',
   'Order {order_number} was cancelled automatically because the showroom did not start preparing it within 72 hours. The stock was released.'),
  ('marketplace.order.reminder_receipt_resubmit', 'marketplace.order.reminder_receipt_resubmit',
   array['order_number', 'showroom_name', 'hours_left'],
   'تذكير: أعد رفع إيصال التحويل',
   'لم نستلم إيصالًا جديدًا للطلب {order_number}. أعد رفعه خلال {hours_left} ساعة وإلا سيُلغى الطلب تلقائيًا.',
   'Reminder: upload your transfer receipt again',
   'We have not received a new receipt for order {order_number}. Upload it within {hours_left} hours or the order will be cancelled automatically.'),
  ('marketplace.order.cancelled_timeout_receipt', 'marketplace.order.cancelled_timeout_receipt',
   array['order_number', 'showroom_name'],
   'تم إلغاء الطلب تلقائيًا',
   'تم إلغاء الطلب {order_number} تلقائيًا لأن إيصال التحويل لم يُرفع من جديد خلال 48 ساعة.',
   'The order was cancelled automatically',
   'Order {order_number} was cancelled automatically because the transfer receipt was not uploaded again within 48 hours.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Handlers
-- ---------------------------------------------------------------------------
-- The next reminder after a reminder at p_now: the original schedule (every-interval or fixed offsets), strictly in the future and
-- strictly before the deadline; null when none is left.
create or replace function app.marketplace_timer_next_remind(p_timer public.marketplace_timers, p_now timestamptz)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_next timestamptz;
  v_steps bigint;
begin
  if p_timer.remind_every is not null then
    v_steps := floor(extract(epoch from (p_now - p_timer.started_at)) / extract(epoch from p_timer.remind_every))::bigint + 1;
    v_next := p_timer.started_at + p_timer.remind_every * v_steps;
  elsif p_timer.remind_offsets is not null then
    select min(p_timer.started_at + o) into v_next from unnest(p_timer.remind_offsets) o where p_timer.started_at + o > p_now;
  end if;
  if v_next is not null and v_next >= p_timer.expires_at then
    return null;
  end if;
  return v_next;
end;
$$;
revoke all on function app.marketplace_timer_next_remind(public.marketplace_timers, timestamptz) from public, anon, authenticated, service_role;

-- Returns 'reminded' | 'cancelled' | 'closed' | 'skipped' | 'noop'.
create or replace function app.marketplace_timer_handle(p_timer public.marketplace_timers, p_now timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
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
$$;
revoke all on function app.marketplace_timer_handle(public.marketplace_timers, timestamptz) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. The runner (service role only)
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_timers_run(p_limit integer default 200, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t           public.marketplace_timers;
  v_limit     integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_now       timestamptz := coalesce(p_now, now());
  v_result    text;
  v_processed integer := 0;
  v_reminders integer := 0;
  v_cancelled integer := 0;
  v_errors    integer := 0;
begin
  for t in
    select * from public.marketplace_timers x
     where x.state = 'active' and (x.expires_at <= v_now or (x.next_remind_at is not null and x.next_remind_at <= v_now))
       -- a receipt timer paused by an open complaint is not due: it must not occupy batch slots (queue starvation)
       and not (x.kind = 'order_receipt_resubmit' and exists (
             select 1 from public.marketplace_payment_complaints c
              where c.order_id = x.subject_id and c.state in ('open', 'under_review')))
     order by least(x.expires_at, coalesce(x.next_remind_at, x.expires_at)), x.id
     limit v_limit
       for update skip locked
  loop
    begin
      v_result := app.marketplace_timer_handle(t, v_now);
      if v_result in ('reminded', 'cancelled', 'closed') then v_processed := v_processed + 1; end if;
      if v_result = 'reminded' then v_reminders := v_reminders + 1; end if;
      if v_result = 'cancelled' then v_cancelled := v_cancelled + 1; end if;
    exception when others then
      v_errors := v_errors + 1;               -- this timer's sub-transaction is rolled back; the rest continue
    end;
  end loop;
  return jsonb_build_object('processed', v_processed, 'reminders', v_reminders, 'cancelled', v_cancelled, 'errors', v_errors);
end;
$$;
revoke all on function public.marketplace_timers_run(integer, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.marketplace_timers_run(integer, timestamptz) to service_role;
comment on function public.marketplace_timers_run(integer, timestamptz) is
  'Service role only. Processes due Marketplace timers (seller reminder every 6 h and cancel at 72 h; buyer receipt reminder at 24 h and cancel at 48 h). Bounded, idempotent, SKIP LOCKED; returns counts only. p_now exists so tests and Acceptance checks can simulate time.';
