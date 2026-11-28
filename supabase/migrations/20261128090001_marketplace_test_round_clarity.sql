-- migration-policy: destructive-reviewed - only re-creates CHECK constraints with additional allowed values; no data is touched.
-- Marketplace: clarity fixes found in the Acceptance test round of 2026-11-28 (docs/operations/MARKETPLACE_ACCEPTANCE_TEST_LOG.md).
--   * returns: the showroom is told about a shipment back; the other side is told about a complaint; an admin decision says what was
--     decided; the buyer is reminded to confirm a recorded refund (3 days) and after 7 days it goes to the admin queue;
--   * returns: the return timers now advance and close (before, every runner pass would repeat a due reminder);
--   * returns: the showroom's return page carries the buyer's phone (it already sees it on the order); admins still see no phone;
--   * orders: variant labels carry units, new addresses label building / floor / apartment, notification dates are readable;
--   * invoices issued from now on carry the area, the address parts and the variant (still never a phone, contract 2.x). Issued invoices never change.
-- Every re-created function below is the previous definition plus the lines of this change only.

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

select pg_temp.extend_in_check('public.marketplace_timers'::regclass, 'ck_mp_timers_kind', 'kind', array['return_refund_confirm']);
select pg_temp.extend_in_check('public.marketplace_return_requests'::regclass, 'ck_mp_returns_escalated', 'escalated_reason', array['refund_unconfirmed']);
select pg_temp.extend_in_check('public.notifications'::regclass, 'ck_notifications_event_type_known', 'event_type',
  array['marketplace.return.shipped', 'marketplace.return.complaint_filed', 'marketplace.return.refund_confirm_reminder']);

insert into public.notification_templates
  (key, event_type, variables, default_title_ar, default_body_ar, default_title_en, default_body_en) values
  ('marketplace.return.shipped', 'marketplace.return.shipped', array['order_number', 'request_number'],
   'المنتج في الطريق إليك', 'شحن المشتري منتج طلب الإرجاع {request_number} (الطلب {order_number}). أكّد الاستلام عند وصوله.',
   'The return is on its way', 'The buyer shipped the items of return {request_number} (order {order_number}). Mark them received when they arrive.'),
  ('marketplace.return.complaint_filed', 'marketplace.return.complaint_filed', array['order_number', 'request_number'],
   'شكوى على طلب إرجاع', 'قُدمت شكوى على طلب الإرجاع {request_number} (الطلب {order_number}). الطلب الآن قيد مراجعة المنصة.',
   'Complaint on a return', 'A complaint was filed on return {request_number} (order {order_number}). The platform team is reviewing it.'),
  ('marketplace.return.refund_confirm_reminder', 'marketplace.return.refund_confirm_reminder', array['order_number', 'request_number', 'amount', 'hours_left'],
   'أكّد استلام المبلغ', 'سجّل المعرض رد {amount} لطلب الإرجاع {request_number}. أكّد استلامه من صفحة الطلب. بعد {hours_left} ساعة يُحال الطلب لإدارة المنصة.',
   'Confirm your refund', 'The showroom recorded a refund of {amount} for return {request_number}. Please confirm it; in {hours_left} hours the request goes to the platform team.');

-- ---------------------------------------------------------------------------
-- 1. Timers
-- ---------------------------------------------------------------------------
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
                     when 'return_seller_response' then interval '72 hours' when 'return_refund_due' then interval '7 days'
                     when 'return_refund_confirm' then interval '7 days' end,
         case p_kind when 'order_seller_start' then interval '6 hours' end,
         case p_kind when 'order_receipt_resubmit' then array[interval '24 hours']
                     when 'return_seller_response' then array[interval '24 hours', interval '48 hours']
                     when 'return_refund_due' then array[interval '5 days']
                     when 'return_refund_confirm' then array[interval '3 days'] end
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

do $do$
declare
  v_oid oid := 'app.marketplace_timer_handle(public.marketplace_timers, timestamptz)'::regprocedure;
  v_def text := pg_get_functiondef(v_oid);
  v_new text;
begin
  v_new := replace(v_def, '(''return_seller_response'', ''return_refund_due'')',
                          '(''return_seller_response'', ''return_refund_due'', ''return_refund_confirm'')');
  if v_new = v_def then raise exception 'timer dispatch patch failed'; end if;
  execute v_new;
end;
$do$;

create or replace function app.marketplace_return_timer_tick(p_timer public.marketplace_timers, p_now timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.marketplace_return_requests;
  v_expired boolean := p_now >= p_timer.expires_at;
  v_hours integer := greatest(ceil(extract(epoch from (p_timer.expires_at - p_now)) / 3600)::integer, 0);
  v_waiting boolean;
begin
  select * into r from public.marketplace_return_requests where id = p_timer.subject_id;
  if not found then
    return 'noop';
  end if;
  if p_timer.kind = 'return_seller_response' then
    v_waiting := r.status = 'requested';
  elsif p_timer.kind = 'return_refund_due' then
    v_waiting := r.status = 'received' and r.remedy = 'refund'
      and not exists (select 1 from public.marketplace_order_refunds f where f.return_id = r.id);
  elsif p_timer.kind = 'return_refund_confirm' then
    v_waiting := r.status = 'received'
      and exists (select 1 from public.marketplace_order_refunds f where f.return_id = r.id and f.state = 'sent');
  else
    return 'noop';
  end if;
  if not v_waiting then
    update public.marketplace_timers set state = 'done', closed_at = p_now, closed_by_action = 'return_moved', next_remind_at = null
     where id = p_timer.id and state = 'active';
    return 'noop';
  end if;
  if p_timer.kind = 'return_refund_due' then
    perform app.marketplace_return_notify(r.id, 'seller_reminder', 'sellers', null, null, v_hours);
  end if;
  if v_expired then
    perform app.marketplace_return_escalate(r.id,
      case p_timer.kind when 'return_refund_confirm' then 'refund_unconfirmed' else 'seller_silent' end, 'system');
    update public.marketplace_timers set state = 'expired', closed_at = p_now, closed_by_action = 'expire', next_remind_at = null
     where id = p_timer.id and state = 'active';
    return 'escalated';
  end if;
  if p_timer.kind = 'return_seller_response' then
    perform app.marketplace_return_notify(r.id, 'seller_reminder', 'sellers', null, null, v_hours);
  elsif p_timer.kind = 'return_refund_confirm' then
    perform app.marketplace_return_notify(r.id, 'refund_confirm_reminder', 'buyer', null, null, v_hours);
  end if;
  update public.marketplace_timers
     set reminders_sent = reminders_sent + 1, next_remind_at = app.marketplace_timer_next_remind(p_timer, p_now)
   where id = p_timer.id and state = 'active';
  return 'reminded';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Return notifications and the refund confirmation clock
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_buyer_return_mark_shipped(p_return_id uuid, p_tracking text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.marketplace_return_requests;
  v_track text := nullif(btrim(p_tracking), '');
begin
  select * into r from public.marketplace_return_requests where id = p_return_id and buyer_user_id = (select auth.uid()) for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  if r.status = 'in_transit' then
    return app.marketplace_return_doc(r.id, 'buyer');
  end if;
  if r.status <> 'approved' then
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  if v_track is not null and v_track !~ '^[A-Za-z0-9._/-]{3,64}$' then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  update public.marketplace_return_requests set status = 'in_transit', return_tracking = v_track, shipped_at = now() where id = r.id;
  perform app.marketplace_return_event(r.id, 'shipped', r.status, 'in_transit', 'buyer', v_track);
  perform app.marketplace_return_notify(r.id, 'shipped', 'sellers');
  return app.marketplace_return_doc(r.id, 'buyer');
end;
$$;

create or replace function public.marketplace_return_complaint_file(p_return_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.marketplace_return_requests;
  v_role text := app.marketplace_return_role(p_return_id);
begin
  if v_role is null then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  if p_note is null or char_length(btrim(p_note)) not between 3 and 500 then
    raise exception 'mp:reason_required' using errcode = '22023';
  end if;
  select * into r from public.marketplace_return_requests where id = p_return_id for update;
  if r.in_admin_queue then
    return app.marketplace_return_doc(r.id, v_role);
  end if;
  if r.status not in ('rejected', 'approved', 'in_transit', 'received') then
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  perform app.marketplace_return_event(r.id, 'complaint_filed', r.status, r.status, v_role, p_note);
  if app.marketplace_return_escalate(r.id, 'complaint', v_role) then
    -- the other side learns of it; the admins were told by the escalation
    perform app.marketplace_return_notify(r.id, 'complaint_filed', case v_role when 'buyer' then 'sellers' else 'buyer' end);
  end if;
  return app.marketplace_return_doc(r.id, v_role);
end;
$$;

create or replace function app.marketplace_return_decide(p_return uuid, p_decision text, p_role text, p_preset uuid,
  p_message_ar text, p_message_en text, p_partial numeric, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.marketplace_return_requests;
  v_reason jsonb;
  v_to text;
  v_ar text;
  v_en text;
  v_partial_appeal boolean;
  v_head_ar text := '';
  v_head_en text := '';
begin
  select * into r from public.marketplace_return_requests where id = p_return for update;
  if p_decision not in ('approve', 'reject', 'propose_partial') then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  -- a complaint about a partial proposal: "approve" grants the full value, "reject" upholds the proposed amount
  v_partial_appeal := p_role = 'admin' and r.status = 'approved' and r.partial_refund_egp is not null and r.in_admin_queue
    and r.escalated_reason = 'complaint';
  v_to := case when p_decision = 'reject' and not v_partial_appeal then 'rejected' else 'approved' end;
  -- replay: the same decision already took effect
  if r.status = v_to and r.decided_by_role = p_role and (p_decision <> 'propose_partial' or r.partial_refund_egp = p_partial) then
    return;
  end if;
  if not (r.status = 'requested' or (p_role = 'admin' and r.status = 'rejected') or v_partial_appeal) then
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  if p_decision = 'propose_partial' then
    if r.remedy <> 'refund' or p_partial is null or p_partial <= 0 or p_partial >= app.marketplace_return_value(r.id) then
      raise exception 'mp:invalid_payload' using errcode = '22023';
    end if;
  end if;
  -- reason: required for a rejection; optional message for an approval
  v_reason := app.marketplace_order_reason(jsonb_build_object('preset_id', p_preset, 'message_ar', p_message_ar, 'message_en', p_message_en),
    'return_reject', p_decision = 'reject' and p_role = 'seller');
  v_ar := v_reason ->> 'message_ar';
  v_en := v_reason ->> 'message_en';
  if p_role = 'admin' then
    if p_note is null or char_length(btrim(p_note)) not between 3 and 500 then
      raise exception 'mp:reason_required' using errcode = '22023';
    end if;
    -- the admin note is INTERNAL: never copied into the public message, the event log or a notification
    v_ar := coalesce(v_ar, 'قرار من فريق المنصة');
    v_en := coalesce(v_en, 'Decision by the platform team');
    -- the notification says what was decided, not only that something was
    v_head_ar := case when v_partial_appeal and p_decision = 'reject' then 'تم تثبيت الاسترداد الجزئي المقترح. '
                      when v_to = 'approved' then 'تمت الموافقة على طلب الإرجاع. ' else 'تم رفض طلب الإرجاع. ' end;
    v_head_en := case when v_partial_appeal and p_decision = 'reject' then 'The proposed partial refund was upheld. '
                      when v_to = 'approved' then 'The return was approved. ' else 'The return was rejected. ' end;
  end if;
  update public.marketplace_return_requests set status = v_to, decided_by_role = p_role, decision_message_ar = v_ar,
    decision_message_en = v_en, decision_internal_note = left(nullif(btrim(p_note), ''), 500),
    partial_refund_egp = case when p_decision = 'propose_partial' then p_partial
                              when v_partial_appeal and p_decision = 'reject' then r.partial_refund_egp else null end,
    in_admin_queue = false
   where id = r.id;
  perform app.marketplace_timer_close('return', r.id, 'return_seller_response', 'decided_by_' || p_role);
  perform app.marketplace_return_event(r.id, v_to, r.status, v_to, p_role,
    v_en);
  perform app.marketplace_return_notify(r.id, case when p_role = 'admin' then 'admin_decided' when p_decision = 'reject' then 'rejected' else 'approved' end,
    'buyer', v_head_ar || coalesce(v_ar, ''), v_head_en || coalesce(v_en, ''));
  if p_role = 'admin' then
    perform app.marketplace_return_notify(r.id, 'admin_decided', 'sellers', v_head_ar || v_ar, v_head_en || v_en);
  end if;
end;
$$;

create or replace function public.marketplace_seller_refund_record(p_return_id uuid, p_amount_egp numeric, p_reference_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.marketplace_return_requests;
  o public.marketplace_orders;
  f public.marketplace_order_refunds;
  v_cap numeric;
begin
  select * into r from public.marketplace_return_requests where id = p_return_id for update;
  if not found or not app.marketplace_can_manage_orders(r.seller_organization_id) then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  v_cap := app.marketplace_return_refund_cap(r.id);
  select * into f from public.marketplace_order_refunds where return_id = r.id;
  if found then
    if f.amount_egp = p_amount_egp then
      return app.marketplace_return_doc(r.id, 'seller');
    end if;
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  if r.status <> 'received' or r.remedy <> 'refund' then
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  -- the refund is exactly what was agreed: the value of the returned units, or the partial amount the seller proposed
  if p_amount_egp is null or p_amount_egp <> v_cap or (p_reference_note is not null and char_length(p_reference_note) > 300) then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  select * into o from public.marketplace_orders where id = r.order_id;
  insert into public.marketplace_order_refunds (return_id, order_id, amount_egp, method, state, sent_by, sent_at, reference_note)
  values (r.id, r.order_id, p_amount_egp, o.payment_method, 'sent', (select auth.uid()), now(), nullif(btrim(p_reference_note), ''));
  perform app.marketplace_timer_close('return', r.id, 'return_refund_due', 'refund_sent');
  perform app.marketplace_timer_open('return', r.id, 'return_refund_confirm', now());
  -- the showroom acted: a return queued only for its silence leaves the queue (a complaint stays for the platform)
  update public.marketplace_return_requests set in_admin_queue = false where id = r.id and escalated_reason = 'seller_silent';
  perform app.marketplace_return_event(r.id, 'refund_sent', r.status, r.status, 'seller', p_reference_note);
  perform app.marketplace_return_notify(r.id, 'refund_sent', 'buyer');
  return app.marketplace_return_doc(r.id, 'seller');
end;
$$;

create or replace function public.marketplace_buyer_refund_confirm(p_return_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.marketplace_return_requests;
  f public.marketplace_order_refunds;
  o public.marketplace_orders;
begin
  select * into r from public.marketplace_return_requests where id = p_return_id and buyer_user_id = (select auth.uid()) for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  select * into f from public.marketplace_order_refunds where return_id = r.id for update;
  if not found then
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  if f.state = 'confirmed' then
    return app.marketplace_return_doc(r.id, 'buyer');
  end if;
  if f.state <> 'sent' or r.status <> 'received' then
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  select * into o from public.marketplace_orders where id = r.order_id for update;
  update public.marketplace_order_refunds set state = 'confirmed', confirmed_by = (select auth.uid()), confirmed_at = now() where id = f.id;
  update public.marketplace_return_requests set status = 'refunded', closed_at = now(), in_admin_queue = false where id = r.id;
  perform app.marketplace_timer_close('return', r.id, 'return_refund_due', 'refund_confirmed');
  perform app.marketplace_timer_close('return', r.id, 'return_refund_confirm', 'refund_confirmed');
  perform app.marketplace_return_event(r.id, 'refund_confirmed', r.status, 'refunded', 'buyer', null);
  if o.payment_status in ('collected', 'receipt_accepted', 'refund_due') then
    perform app.marketplace_return_order_payment(o.id,
      case when (select coalesce(sum(x.amount_egp), 0) from public.marketplace_order_refunds x
                  where x.order_id = o.id and x.state = 'confirmed')
                >= (select coalesce(sum(i.line_total_egp), 0) from public.marketplace_order_items i where i.order_id = o.id)
           then 'refunded' else 'collected' end);
  end if;
  perform app.marketplace_order_event(o.id, 'return_closed', o.status, o.status, o.payment_status,
    (select m.payment_status from public.marketplace_orders m where m.id = o.id), 'buyer', r.request_number);
  perform app.marketplace_return_notify(r.id, 'refund_confirmed', 'sellers');
  return app.marketplace_return_doc(r.id, 'buyer');
end;
$$;

-- The showroom picks one of the admin-managed rejection reasons (both languages) instead of typing free text.
do $do$
declare
  v_oid oid := 'public.marketplace_order_reason_presets(text)'::regprocedure;
  v_def text := pg_get_functiondef(v_oid);
  v_new text;
begin
  v_new := replace(v_def, '''payment_issue'') then', '''payment_issue'', ''return_reject'') then');
  if v_new = v_def then raise exception 'reason preset patch failed'; end if;
  execute v_new;
end;
$do$;

-- ---------------------------------------------------------------------------
-- 3. Return documents
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_return_actions(p_return uuid, p_for text)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.marketplace_return_requests;
  v_refund public.marketplace_order_refunds;
  v_out text[] := '{}';
  v_complain boolean;
begin
  select * into r from public.marketplace_return_requests where id = p_return;
  if not found then
    return v_out;
  end if;
  select * into v_refund from public.marketplace_order_refunds where return_id = r.id;
  v_complain := not r.in_admin_queue and r.status in ('rejected', 'approved', 'in_transit', 'received');
  if p_for = 'buyer' then
    if r.status = 'requested' then v_out := array_append(v_out, 'cancel'); end if;
    if r.status = 'approved' then v_out := array_append(v_out, 'mark_shipped'); end if;
    if v_refund.state = 'sent' then v_out := array_append(v_out, 'confirm_refund'); end if;
    if v_complain then v_out := array_append(v_out, 'file_complaint'); end if;
  elsif p_for = 'seller' then
    if r.status = 'requested' then
      v_out := v_out || array['approve', 'reject'];
      if r.remedy = 'refund' then v_out := array_append(v_out, 'propose_partial'); end if;
    elsif r.status in ('approved', 'in_transit') then v_out := array_append(v_out, 'receive');
    elsif r.status = 'received' and r.remedy = 'refund' and v_refund.id is null then v_out := array_append(v_out, 'record_refund');
    elsif r.status = 'received' and r.remedy = 'exchange' then v_out := array_append(v_out, 'fulfil_exchange');
    end if;
    if v_complain then v_out := array_append(v_out, 'file_complaint'); end if;
  elsif p_for = 'admin' and r.in_admin_queue then
    if r.status in ('requested', 'approved', 'in_transit', 'received') and r.escalated_reason is distinct from 'refund_unconfirmed' then v_out := array_append(v_out, 'remind_seller'); end if;
    if r.status in ('requested', 'rejected')
       or (r.status = 'approved' and r.partial_refund_egp is not null and r.escalated_reason = 'complaint') then
      v_out := v_out || array['approve', 'reject'];
    end if;
  end if;
  return v_out;
end;
$$;

create or replace function app.marketplace_return_doc(p_return uuid, p_for text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.marketplace_return_requests;
  o public.marketplace_orders;
  v_refund public.marketplace_order_refunds;
  v_seller boolean := p_for in ('seller', 'admin');
  v_evidence boolean;
begin
  select * into r from public.marketplace_return_requests where id = p_return;
  if not found then
    return null;
  end if;
  select * into o from public.marketplace_orders where id = r.order_id;
  select * into v_refund from public.marketplace_order_refunds where return_id = r.id;
  v_evidence := p_for <> 'admin' or r.in_admin_queue;
  return jsonb_build_object(
    'id', r.id, 'request_number', r.request_number, 'order_id', r.order_id, 'order_number', o.order_number,
    'kind', r.kind, 'claim_type', r.claim_type, 'status', r.status, 'remedy', r.remedy, 'viewer', p_for,
    'payment_method', o.payment_method,
    -- phones: the showroom gets its buyer's number, a reviewing admin gets both sides; the buyer never gets the showroom's
    'seller', jsonb_build_object('name', (select org.name from public.organizations org where org.id = r.seller_organization_id),
      'phone', case when p_for = 'admin' then (select org.contact_phone from public.organizations org where org.id = r.seller_organization_id) end),
    'buyer', case when v_seller then jsonb_build_object('name', o.buyer_name, 'phone', o.buyer_phone) end,
    'reason', jsonb_build_object('label_ar', r.reason_label_ar, 'label_en', r.reason_label_en, 'transit_damage', r.transit_damage),
    'buyer_note', r.buyer_note,
    'partial_refund_egp', r.partial_refund_egp,
    'max_refund_egp', app.marketplace_return_refund_cap(r.id),
    'return_shipping_payer', r.return_shipping_payer, 'return_tracking', r.return_tracking,
    'in_admin_queue', r.in_admin_queue, 'escalated_reason', r.escalated_reason,
    'decision', case when r.decided_by_role is not null then jsonb_build_object('by', r.decided_by_role,
      'message_ar', r.decision_message_ar, 'message_en', r.decision_message_en,
      'internal_note', case when p_for = 'admin' or (p_for = 'seller' and r.decided_by_role = 'seller') then r.decision_internal_note end) end,
    'timestamps', jsonb_build_object('created_at', r.created_at, 'seller_due_at', r.seller_due_at, 'shipped_at', r.shipped_at,
      'received_at', r.received_at, 'refund_due_at', r.refund_due_at, 'closed_at', r.closed_at, 'escalated_at', r.escalated_at),
    'items', coalesce((select jsonb_agg(jsonb_build_object('item_id', i.id, 'name_ar', i.name_ar, 'name_en', i.name_en, 'sku', i.sku,
        'variant_label', i.variant_label, 'image_id', i.image_id, 'quantity', ri.quantity, 'unit_price_egp', i.unit_price_egp,
        'line_total_egp', i.unit_price_egp * ri.quantity, 'sellable', ri.sellable) order by i.created_at, i.sku)
      from public.marketplace_return_items ri join public.marketplace_order_items i on i.id = ri.order_item_id
      where ri.return_id = r.id), '[]'::jsonb),
    'refund', case when v_refund.id is not null then jsonb_build_object('amount_egp', v_refund.amount_egp, 'method', v_refund.method,
      'state', v_refund.state, 'sent_at', v_refund.sent_at, 'confirmed_at', v_refund.confirmed_at,
      'reference_note', v_refund.reference_note) end,
    'evidence', case when v_evidence then coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'object_key', e.object_key,
        'created_at', e.created_at) order by e.created_at)
      from public.marketplace_return_evidence e where e.return_id = r.id and e.upload_state = 'confirmed'), '[]'::jsonb) else '[]'::jsonb end,
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'action', e.action, 'to_status', e.to_status,
        'actor_role', e.actor_role, 'note', e.note, 'at', e.created_at) order by e.sequence)
      from public.marketplace_return_events e where e.return_id = r.id), '[]'::jsonb),
    'actions', to_jsonb(app.marketplace_return_actions(r.id, p_for)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Orders: readable variant labels, addresses and notification dates
-- ---------------------------------------------------------------------------
-- A stored number with the unit a person reads (measurements are stored in mm, g and ml).
create or replace function app.marketplace_attribute_number(p_value numeric, p_unit_kind text, p_display_unit text, p_ar boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_unit_kind = 'length' then trim_scale(p_value / 10)::text || case when p_ar then ' سم' else ' cm' end
    when p_unit_kind = 'weight' and p_value >= 1000 then trim_scale(round(p_value / 1000, 3))::text || case when p_ar then ' كجم' else ' kg' end
    when p_unit_kind = 'weight' then trim_scale(p_value)::text || case when p_ar then ' جم' else ' g' end
    when p_unit_kind = 'volume' and p_value >= 1000 then trim_scale(round(p_value / 1000, 3))::text || case when p_ar then ' لتر' else ' L' end
    when p_unit_kind = 'volume' then trim_scale(p_value)::text || case when p_ar then ' مل' else ' ml' end
    else trim_scale(p_value)::text || coalesce(' ' || nullif(p_display_unit, ''), '')
  end;
$$;
revoke all on function app.marketplace_attribute_number(numeric, text, text, boolean) from public, anon, authenticated, service_role;

create or replace function app.marketplace_variant_label(p_variant uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'ar', coalesce(string_agg(case when vv.option_id is not null then o.name_ar when vv.value_number is not null then app.marketplace_attribute_number(vv.value_number, d.unit_kind, d.display_unit_ar, true)
                                   when vv.value_boolean is not null then null else vv.value_text end, ' / ' order by d.key), ''),
    'en', coalesce(string_agg(case when vv.option_id is not null then o.name_en when vv.value_number is not null then app.marketplace_attribute_number(vv.value_number, d.unit_kind, d.display_unit_en, false)
                                   when vv.value_boolean is not null then null else vv.value_text end, ' / ' order by d.key), ''))
  from public.marketplace_variant_attribute_values vv
  join public.marketplace_attribute_definitions d on d.id = vv.attribute_id and d.is_active
  left join public.marketplace_attribute_options o on o.id = vv.option_id
  where vv.variant_id = p_variant;
$$;

-- New orders only: the stored address line says which number is the building, the floor and the apartment.
do $do$
declare
  v_oid oid;
  v_def text;
  v_new text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app', 'public') and p.prosrc like '%a.street, a.building, a.floor, a.apartment, a.landmark, a.district%';
  v_def := pg_get_functiondef(v_oid);
  v_new := replace(v_def, 'a.street, a.building, a.floor, a.apartment, a.landmark, a.district',
    'a.street, ''عمارة '' || nullif(a.building, ''''), ''دور '' || nullif(a.floor, ''''), ''شقة '' || nullif(a.apartment, ''''), a.landmark, a.district');
  if v_new = v_def then raise exception 'address line patch failed'; end if;
  execute v_new;
end;
$do$;

-- "1–2 Dec" instead of two ISO dates.
create or replace function app.marketplace_date_range(p_from date, p_to date, p_ar boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  with n as (
    select array['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'] as ar,
           array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] as en
  ), m as (
    select (case when p_ar then ar else en end)[extract(month from p_from)::int] as m_from,
           (case when p_ar then ar else en end)[extract(month from p_to)::int] as m_to from n
  )
  select case
    when p_to is null then ''
    when p_from is null or p_from = p_to then extract(day from p_to)::int || ' ' || m_to
    when date_trunc('month', p_from) = date_trunc('month', p_to) then extract(day from p_from)::int || '–' || extract(day from p_to)::int || ' ' || m_to
    else extract(day from p_from)::int || ' ' || m_from || ' – ' || extract(day from p_to)::int || ' ' || m_to
  end from m;
$$;
revoke all on function app.marketplace_date_range(date, date, boolean) from public, anon, authenticated, service_role;

do $do$
declare
  v_oid oid := 'app.marketplace_order_notify(uuid, text, jsonb)'::regprocedure;
  v_def text := pg_get_functiondef(v_oid);
  v_new text;
begin
  v_new := replace(v_def, 'v_ar := jsonb_build_object(''message'',',
    'v_ar := jsonb_build_object(''delivery_date'', app.marketplace_date_range(o.delivery_estimate_earliest, o.delivery_estimate_latest, true), ''message'',');
  v_new := replace(v_new, 'v_en := jsonb_build_object(''message'',',
    'v_en := jsonb_build_object(''delivery_date'', app.marketplace_date_range(o.delivery_estimate_earliest, o.delivery_estimate_latest, false), ''message'',');
  if v_new = v_def then raise exception 'notification date patch failed'; end if;
  execute v_new;
end;
$do$;

-- ---------------------------------------------------------------------------
-- 5. Invoices issued from now on
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
$$;

-- ---------------------------------------------------------------------------
-- 6. Cart quote: what the free-delivery rule needs, so the cart shows the fee checkout will charge
-- ---------------------------------------------------------------------------
do $do$
declare
  v_oid oid := 'public.marketplace_public_cart(jsonb, text, text)'::regprocedure;
  v_def text := pg_get_functiondef(v_oid);
  v_line text;
  v_new text;
begin
  v_line := replace(v_def, '''selling_unit'', pv.selling_unit,',
    '''free_shipping'', app.marketplace_product_ships_free(p.id), ''selling_unit'', pv.selling_unit,');
  v_new := replace(v_line, '''fee_egp'', dr.fee_egp)',
    '''fee_egp'', dr.fee_egp, ''free_min_egp'', app.marketplace_delivery_terms(s.seller_id, v_gov, v_area) -> ''free_min_egp'')');
  if v_line = v_def or v_new = v_line then raise exception 'cart quote patch failed'; end if;
  execute v_new;
end;
$do$;
