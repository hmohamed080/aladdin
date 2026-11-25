-- Marketplace PR 14 (3/3): payment-complaint RPCs, the two hook bodies PR 12 reserved, and templates 14-15.
--
-- WHAT THIS ADDS
--   * public.marketplace_payment_complaint_file       buyer or the showroom's order managers, only while the receipt is disputed
--   * public.admin_marketplace_payment_complaints / _get / _take / _decide     permission marketplace_payment_complaints.review
--   * hook bodies app.marketplace_order_complaint_id (fills payment.dispute.complaint_id of the order document) and
--     app.marketplace_order_extra_actions (adds the `file_complaint` action to the order's `actions`)
--   * templates marketplace.order.payment_complaint_filed (to authorised admins) and .payment_complaint_resolved (to buyer and showroom)
--
-- NEEDS: PR 12 (orders v2, app.marketplace_order_apply, the two hooks), migrations 140001 and 140002 of this PR. Nothing is dropped.
-- Public functions: SECURITY DEFINER, search_path = '', authenticated only; each re-checks the caller. Errors: mp:<code>.
--
-- DECISIONS (contract section 4.4 + owner questions 2 and 3, ASSUMED pending owner confirmation)
--   * decision payment_valid     -> app.marketplace_order_apply(accept_receipt, actor_role 'admin'): the payment counts as received,
--                                   the dispute timer closes, the seller carries on. The complaint becomes 'resolved'.
--   * decision payment_not_received -> the order does not change; the buyer's receipt timer ends no sooner than 24 h after the ruling.
--   * decision dismissed         -> no action on the order; the complaint becomes 'dismissed'.
--   * an admin never moves money; every decision keeps a written note (3-500 characters).
--   * a complaint pauses the buyer's 48 h only if it is filed BEFORE the deadline (mp:complaint_not_allowed afterwards), so it cannot be used to dodge the cancellation.
--   * one complaint per dispute episode: a new complaint is refused (mp:complaint_exists) while one is open or under review, and also
--     when one was already filed after the receipt was last flagged, so a decided complaint cannot be re-filed in a loop.

-- ---------------------------------------------------------------------------
-- 1. Hooks (bodies replace PR 12's defaults; same signatures)
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_order_complaint_id(p_order uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.marketplace_payment_complaints c
   where c.order_id = p_order and c.state in ('open', 'under_review')
   order by c.created_at desc limit 1;
$$;

-- file_complaint: while the receipt is disputed (v2 InstaPay order, not yet cancelled) and no complaint is filed for this dispute
create or replace function app.marketplace_order_extra_actions(p_order uuid, p_for text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_for in ('buyer', 'seller') and (exists (
      select 1 from public.marketplace_orders o
       where o.id = p_order and o.source = 'v2' and o.status = 'cancelled' and o.payment_status = 'refund_due'
         and exists (select 1 from public.marketplace_order_cancellations x where x.order_id = o.id and x.reason_code = 'timeout_seller_start')
         and not exists (select 1 from public.marketplace_payment_complaints c where c.order_id = o.id)
    ) or exists (
      select 1 from public.marketplace_orders o
       where o.id = p_order and o.source = 'v2' and o.payment_status = 'receipt_disputed' and o.status in ('preparing', 'ready')
         and not exists (select 1 from public.marketplace_timers t where t.subject_type = 'order' and t.subject_id = o.id
                           and t.kind = 'order_receipt_resubmit' and t.state = 'active' and t.expires_at <= now())
         and not exists (
           select 1 from public.marketplace_payment_complaints c
            where c.order_id = o.id
              and (c.state in ('open', 'under_review')
                   or c.created_at >= coalesce((select max(e.created_at) from public.marketplace_order_events e
                                                 where e.order_id = o.id and e.action = 'receipt_disputed'), 'infinity'::timestamptz)))))
    then array['file_complaint'] else '{}'::text[] end;
$$;
revoke all on function app.marketplace_order_complaint_id(uuid), app.marketplace_order_extra_actions(uuid, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Templates 14 and 15
-- ---------------------------------------------------------------------------
insert into public.notification_templates
  (key, event_type, variables, default_title_ar, default_body_ar, default_title_en, default_body_en) values
  ('marketplace.order.payment_complaint_filed', 'marketplace.order.payment_complaint_filed',
   array['order_number', 'filed_by', 'reason'],
   'شكوى دفع جديدة',
   'قدّم {filed_by} شكوى دفع للطلب {order_number}. السبب: {reason}. راجعها من قائمة شكاوى الدفع.',
   'New payment complaint',
   'The {filed_by} filed a payment complaint for order {order_number}. Reason: {reason}. Review it in the payment complaints queue.'),
  ('marketplace.order.payment_complaint_resolved', 'marketplace.order.payment_complaint_resolved',
   array['order_number', 'showroom_name', 'outcome'],
   'تم البتّ في شكوى الدفع',
   'تم البتّ في شكوى الدفع للطلب {order_number}. النتيجة: {outcome}.',
   'The payment complaint was decided',
   'The payment complaint for order {order_number} was decided. Outcome: {outcome}.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. File a complaint (buyer or the showroom's order managers)
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_payment_complaint_file(p_order_id uuid, p_reason text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  o        public.marketplace_orders;
  v_role   text;
  v_note   text := nullif(btrim(p_note), '');
  v_id     uuid;
  v_label  jsonb;
  v_flagged timestamptz;
  v_unanswered boolean;
begin
  if v_uid is null then raise exception 'mp:auth_required' using errcode = '42501'; end if;
  if p_reason is null or p_reason not in ('transfer_made', 'amount_mismatch', 'receipt_unreadable', 'other') then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) not between 3 and 500 then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  if p_reason = 'other' and v_note is null then raise exception 'mp:reason_required' using errcode = '22023'; end if;

  select * into o from public.marketplace_orders where id = p_order_id for update;
  if not found then raise exception 'mp:not_found' using errcode = '42501'; end if;
  v_role := case when o.buyer_user_id = v_uid then 'buyer'
                 when app.marketplace_can_manage_orders(o.seller_organization_id) then 'seller' end;
  if v_role is null then raise exception 'mp:not_found' using errcode = '42501'; end if;
  if o.source <> 'v2' then raise exception 'mp:legacy_order' using errcode = '23514'; end if;
  -- also open to an order cancelled because the showroom never answered an uploaded receipt (owner decision 2026-11-25)
  v_unanswered := o.status = 'cancelled' and o.payment_status = 'refund_due'
         and exists (select 1 from public.marketplace_order_cancellations x where x.order_id = o.id and x.reason_code = 'timeout_seller_start');
  if not v_unanswered and (o.payment_status <> 'receipt_disputed' or o.status not in ('preparing', 'ready')) then
    raise exception 'mp:complaint_not_allowed' using errcode = '23514';
  end if;

  -- Deadline evasion: once the buyer's 48 h are over, a complaint cannot be used to dodge the cancellation. Only a complaint filed
  -- BEFORE the deadline pauses the clock (the runner may lag a few minutes, so the deadline itself decides, not the runner).
  if exists (select 1 from public.marketplace_timers t where t.subject_type = 'order' and t.subject_id = o.id
              and t.kind = 'order_receipt_resubmit' and t.state = 'active' and t.expires_at <= now()) then
    raise exception 'mp:complaint_not_allowed' using errcode = '23514';
  end if;

  select max(e.created_at) into v_flagged from public.marketplace_order_events e where e.order_id = o.id and e.action = 'receipt_disputed';
  if exists (select 1 from public.marketplace_payment_complaints c
              where c.order_id = o.id and (v_unanswered or c.state in ('open', 'under_review')
                                            or c.created_at >= coalesce(v_flagged, 'infinity'::timestamptz))) then
    raise exception 'mp:complaint_exists' using errcode = '23505';
  end if;

  insert into public.marketplace_payment_complaints (order_id, filed_by_user_id, filed_by_role, reason, note)
  values (o.id, v_uid, v_role, p_reason, v_note) returning id into v_id;
  insert into public.marketplace_payment_complaint_events (complaint_id, action, actor_id, actor_role, note)
  values (v_id, 'filed', v_uid, v_role, v_note);
  insert into public.marketplace_order_events (order_id, action, from_status, to_status, from_payment, to_payment, actor_user_id, actor_role, payload)
  values (o.id, 'complaint_filed', o.status, o.status, o.payment_status, o.payment_status, v_uid, v_role,
          jsonb_build_object('complaint_id', v_id, 'reason', p_reason));

  perform app.marketplace_notify_admins('marketplace_payment_complaints.review', 'marketplace.order.payment_complaint_filed',
    'marketplace_payment_complaint', v_id, '/admin/marketplace/payment-complaints',
    jsonb_build_object('order_number', o.order_number,
      'vars_ar', jsonb_build_object('filed_by', case v_role when 'buyer' then 'المشتري' else 'المعرض' end,
        'reason', case p_reason when 'transfer_made' then 'تم التحويل' when 'amount_mismatch' then 'المبلغ غير مطابق'
                                when 'receipt_unreadable' then 'الإيصال غير واضح' else 'سبب آخر' end),
      'vars_en', jsonb_build_object('filed_by', v_role,
        'reason', case p_reason when 'transfer_made' then 'transfer was made' when 'amount_mismatch' then 'amount does not match'
                                when 'receipt_unreadable' then 'receipt not readable' else 'other' end)));
  return jsonb_build_object('complaint_id', v_id, 'state', 'open');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Admin: queue, detail, take, decide
-- ---------------------------------------------------------------------------
create or replace function public.admin_marketplace_payment_complaints(p_state text default null, p_limit integer default 30, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state  text := nullif(btrim(p_state), '');
  v_limit  integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total  bigint;
  v_items  jsonb;
  v_counts jsonb;
begin
  perform app.marketplace_assert_admin_permission('marketplace_payment_complaints.review');
  if v_state is not null and v_state not in ('open', 'under_review', 'resolved', 'dismissed') then
    raise exception 'mp:invalid_status' using errcode = '22023';
  end if;
  select count(*) into v_total from public.marketplace_payment_complaints c where v_state is null or c.state = v_state;
  select jsonb_build_object(
    'open', count(*) filter (where state = 'open'), 'under_review', count(*) filter (where state = 'under_review'),
    'resolved', count(*) filter (where state = 'resolved'), 'dismissed', count(*) filter (where state = 'dismissed'))
    into v_counts from public.marketplace_payment_complaints;
  select coalesce(jsonb_agg(x.j order by x.created_at, x.id), '[]'::jsonb) into v_items from (
    select c.created_at, c.id, jsonb_build_object(
      'id', c.id, 'order_id', o.id, 'order_number', o.order_number, 'state', c.state, 'reason', c.reason,
      'filed_by_role', c.filed_by_role,
      'seller_name', (select org.name from public.organizations org where org.id = o.seller_organization_id),
      'buyer_name', o.buyer_name, 'total_egp', o.total_egp, 'paid_now_egp', o.paid_now_egp, 'filed_at', c.created_at,
      'receipts_count', (select count(*) from public.marketplace_payment_proofs pr where pr.order_id = o.id and pr.upload_state = 'confirmed')) as j
    from public.marketplace_payment_complaints c join public.marketplace_orders o on o.id = c.order_id
    where v_state is null or c.state = v_state
    order by c.created_at, c.id limit v_limit offset v_offset) x;
  return jsonb_build_object('total', v_total, 'counts', v_counts, 'items', v_items);
end;
$$;

create or replace function public.admin_marketplace_payment_complaint_get(p_complaint_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.marketplace_payment_complaints;
begin
  perform app.marketplace_assert_admin_permission('marketplace_payment_complaints.review');
  select * into c from public.marketplace_payment_complaints where id = p_complaint_id;
  if not found then raise exception 'mp:not_found' using errcode = '42501'; end if;
  return jsonb_build_object(
    'complaint', jsonb_build_object('id', c.id, 'order_id', c.order_id, 'state', c.state, 'reason', c.reason, 'note', c.note,
      'filed_by_role', c.filed_by_role, 'decision', c.decision, 'decision_note', c.decision_note, 'decided_at', c.decided_at,
      'taken', c.taken_by is not null, 'taken_by_me', c.taken_by = (select auth.uid()), 'created_at', c.created_at),
    'order', app.marketplace_order_document_v2(c.order_id, 'admin'),
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'actor_role', e.actor_role, 'note', e.note, 'at', e.at)
                                         order by e.sequence)
                          from public.marketplace_payment_complaint_events e where e.complaint_id = c.id), '[]'::jsonb));
end;
$$;

create or replace function public.admin_marketplace_payment_complaint_take(p_complaint_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.marketplace_assert_admin_permission('marketplace_payment_complaints.review');
  c public.marketplace_payment_complaints;
begin
  select * into c from public.marketplace_payment_complaints where id = p_complaint_id for update;
  if not found then raise exception 'mp:not_found' using errcode = '42501'; end if;
  if c.state = 'under_review' and c.taken_by = v_uid then
    return to_jsonb(c) - 'filed_by_user_id' - 'decided_by' - 'taken_by';          -- replay
  end if;
  if c.state <> 'open' then raise exception 'mp:invalid_transition' using errcode = '23514'; end if;
  update public.marketplace_payment_complaints set state = 'under_review', taken_by = v_uid where id = c.id returning * into c;
  insert into public.marketplace_payment_complaint_events (complaint_id, action, actor_id, actor_role) values (c.id, 'taken', v_uid, 'admin');
  return to_jsonb(c) - 'filed_by_user_id' - 'decided_by' - 'taken_by';
end;
$$;

create or replace function public.admin_marketplace_payment_complaint_decide(p_complaint_id uuid, p_decision text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := app.marketplace_assert_admin_permission('marketplace_payment_complaints.review');
  c      public.marketplace_payment_complaints;
  o      public.marketplace_orders;
  v_note text := nullif(btrim(p_note), '');
  v_state text;
  v_out_ar text;
  v_out_en text;
  v_vars jsonb;
  v_unanswered boolean;
begin
  if p_decision is null or p_decision not in ('payment_valid', 'payment_not_received', 'dismissed') then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  if v_note is null or char_length(v_note) not between 3 and 500 then
    raise exception 'mp:reason_required' using errcode = '22023';
  end if;
  select * into c from public.marketplace_payment_complaints where id = p_complaint_id for update;
  if not found then raise exception 'mp:not_found' using errcode = '42501'; end if;
  if c.state in ('resolved', 'dismissed') then
    if c.decision = p_decision then return to_jsonb(c) - 'filed_by_user_id' - 'decided_by' - 'taken_by'; end if;   -- replay
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  if c.state = 'under_review' and c.taken_by is distinct from v_uid then
    raise exception 'mp:invalid_transition' using errcode = '23514';       -- another admin took it
  end if;

  select * into o from public.marketplace_orders where id = c.order_id for update;
  v_unanswered := o.status = 'cancelled' and o.payment_status = 'refund_due'
         and exists (select 1 from public.marketplace_order_cancellations x where x.order_id = o.id and x.reason_code = 'timeout_seller_start');

  if p_decision = 'payment_valid' and not v_unanswered then
    -- the machine re-checks the order under its lock; a cancelled or moved order raises mp:invalid_transition and nothing is saved
    perform app.marketplace_order_apply(c.order_id, 'accept_receipt', 'admin', v_uid, '{}'::jsonb);
  end if;

  -- Owner decision 2026-11-25: after "money not received" the buyer gets at least 24 hours from the ruling to send a new receipt, even
  -- when the 48 hours ran out while the complaint paused the clock. A later deadline is never shortened.
  if p_decision = 'payment_not_received' then
    update public.marketplace_timers
       set expires_at = greatest(expires_at, now() + interval '24 hours')
     where subject_type = 'order' and subject_id = c.order_id and kind = 'order_receipt_resubmit' and state = 'active';
  end if;
  -- cancelled order: "money not received" ends the refund claim; "payment valid" leaves it owed back (nothing to change)
  if p_decision = 'payment_not_received' and v_unanswered then
    perform set_config('app.marketplace_order_apply', 'on', true);
    update public.marketplace_orders set payment_status = 'not_collected' where id = c.order_id;
    perform set_config('app.marketplace_order_apply', 'off', true);
  end if;

  v_state := case p_decision when 'dismissed' then 'dismissed' else 'resolved' end;
  update public.marketplace_payment_complaints
     set state = v_state, decision = p_decision, decision_note = v_note, decided_by = v_uid, decided_at = now(),
         taken_by = coalesce(taken_by, v_uid)
   where id = c.id returning * into c;
  insert into public.marketplace_payment_complaint_events (complaint_id, action, actor_id, actor_role, note)
  values (c.id, case v_state when 'dismissed' then 'dismissed' else 'resolved' end, v_uid, 'admin', v_note);

  select * into o from public.marketplace_orders where id = c.order_id;
  insert into public.marketplace_order_events (order_id, action, from_status, to_status, from_payment, to_payment, actor_user_id, actor_role, payload)
  values (o.id, 'complaint_resolved', o.status, o.status, o.payment_status, o.payment_status, v_uid, 'admin',
          jsonb_build_object('complaint_id', c.id, 'decision', p_decision));

  v_out_ar := case p_decision when 'payment_valid' then case when v_unanswered then 'تأكد وصول المبلغ وهو مستحق الاسترداد' else 'تم اعتماد الدفع' end
                              when 'payment_not_received' then 'لم يتأكد وصول المبلغ' else 'تم إغلاق الشكوى بدون إجراء' end;
  v_out_en := case p_decision when 'payment_valid' then case when v_unanswered then 'the transfer was confirmed and is owed back' else 'the payment was confirmed' end
                              when 'payment_not_received' then 'the transfer could not be confirmed' else 'the complaint was closed without action' end;
  v_vars := jsonb_build_object('order_number', o.order_number,
    'showroom_name', (select org.name from public.organizations org where org.id = o.seller_organization_id));
  perform app.notify_from_template(o.buyer_user_id, null, 'marketplace.order.payment_complaint_resolved', 'marketplace_order', o.id,
    '/market/orders/' || o.id::text, v_vars, jsonb_build_object('outcome', v_out_ar), jsonb_build_object('outcome', v_out_en));
  perform app.marketplace_notify_order_managers(o.id, 'marketplace.order.payment_complaint_resolved', v_vars,
    jsonb_build_object('outcome', v_out_ar), jsonb_build_object('outcome', v_out_en));
  return to_jsonb(c) - 'filed_by_user_id' - 'decided_by' - 'taken_by';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
revoke all on function
  public.marketplace_payment_complaint_file(uuid, text, text),
  public.admin_marketplace_payment_complaints(text, integer, integer),
  public.admin_marketplace_payment_complaint_get(uuid),
  public.admin_marketplace_payment_complaint_take(uuid),
  public.admin_marketplace_payment_complaint_decide(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.marketplace_payment_complaint_file(uuid, text, text),
  public.admin_marketplace_payment_complaints(text, integer, integer),
  public.admin_marketplace_payment_complaint_get(uuid),
  public.admin_marketplace_payment_complaint_take(uuid),
  public.admin_marketplace_payment_complaint_decide(uuid, text, text)
  to authenticated;
