-- Forward-fix "marketplace-orders": remove what the 18 migrations 20261125090001 .. 20261126120002 added and restore what they re-created.
-- NOT a down migration and NOT applied anywhere. Use only with the owner's explicit approval, on a hosted database, through the Supabase migration path
-- as a NEW migration (never the SQL Editor), and only if the plan "marketplace-orders" must be undone. Roll the Worker (the application) back to the
-- version before these migrations first: the previous application never calls any of this, the new application calls all of it.
--
-- Provenance: generated from a measured catalog diff (catalog-fingerprint.sql; pre = a clean replay of the 246 migrations Acceptance has, post = pre + the 18).
-- The previous definitions below are the exact pg_get_functiondef / pg_get_constraintdef output of that pre-state. Proof:
-- scripts/hosted-db/marketplace-orders-scratch-proof.mjs (throwaway database) reports that this file returns the catalog, every row count and every
-- pre-existing row (updated_at aside) to the pre-state, from the full plan and from each partly applied state.
--
-- Removes 21 tables, 27 columns on existing tables, 136 added functions and the seeded rows (28 notification templates, 20 owner-message
-- presets, 2 permissions with their grants), restores 33 functions and 8 constraints, and maps the migrated legacy orders back to the old
-- payment values.
-- DATA GUARD: refuses (RAISE, nothing changed) as soon as any row written by the new application, or any admin edit of a seeded row, exists.
-- It never deletes user data. Rows written after the push are recoverable ONLY from the restore-tested backup.
-- NOT undone, because it cannot be: marketplace_orders.updated_at of the migrated legacy orders; run-time side effects of the replaced functions
-- (for example a stale backup run closed as failed).
begin;
set local check_function_bodies = off;

create or replace function pg_temp.mo_guard(p_what text, p_sql text) returns void language plpgsql as $g$
declare n bigint;
begin
  begin execute p_sql into n;
  exception when undefined_table or undefined_column then return; end;  -- the object is not there (partly applied plan): nothing to protect
  if n <> 0 then raise exception 'marketplace-orders forward-fix refused: % (% row(s)); the data would be lost', p_what, n; end if;
end $g$;

select pg_temp.mo_guard('marketplace_buyer_address_events holds data', $q$select count(*) from public.marketplace_buyer_address_events$q$);
select pg_temp.mo_guard('marketplace_buyer_addresses holds data', $q$select count(*) from public.marketplace_buyer_addresses$q$);
select pg_temp.mo_guard('marketplace_cart_items holds data', $q$select count(*) from public.marketplace_cart_items$q$);
select pg_temp.mo_guard('marketplace_cart_merges holds data', $q$select count(*) from public.marketplace_cart_merges$q$);
select pg_temp.mo_guard('marketplace_checkout_sessions holds data', $q$select count(*) from public.marketplace_checkout_sessions$q$);
select pg_temp.mo_guard('marketplace_order_cancellations holds data', $q$select count(*) from public.marketplace_order_cancellations$q$);
select pg_temp.mo_guard('marketplace_order_invoices holds data', $q$select count(*) from public.marketplace_order_invoices$q$);
select pg_temp.mo_guard('marketplace_order_refunds holds data', $q$select count(*) from public.marketplace_order_refunds$q$);
select pg_temp.mo_guard('marketplace_order_shipments holds data', $q$select count(*) from public.marketplace_order_shipments$q$);
select pg_temp.mo_guard('marketplace_payment_complaint_events holds data', $q$select count(*) from public.marketplace_payment_complaint_events$q$);
select pg_temp.mo_guard('marketplace_payment_complaints holds data', $q$select count(*) from public.marketplace_payment_complaints$q$);
select pg_temp.mo_guard('marketplace_return_events holds data', $q$select count(*) from public.marketplace_return_events$q$);
select pg_temp.mo_guard('marketplace_return_evidence holds data', $q$select count(*) from public.marketplace_return_evidence$q$);
select pg_temp.mo_guard('marketplace_return_items holds data', $q$select count(*) from public.marketplace_return_items$q$);
select pg_temp.mo_guard('marketplace_return_requests holds data', $q$select count(*) from public.marketplace_return_requests$q$);
select pg_temp.mo_guard('marketplace_seller_return_settings holds data', $q$select count(*) from public.marketplace_seller_return_settings$q$);
select pg_temp.mo_guard('marketplace_timers holds data', $q$select count(*) from public.marketplace_timers$q$);
select pg_temp.mo_guard('upload_limit_events holds data', $q$select count(*) from public.upload_limit_events$q$);
select pg_temp.mo_guard('upload_limit_exemptions holds data', $q$select count(*) from public.upload_limit_exemptions$q$);
select pg_temp.mo_guard('the upload limits were changed in Admin', $q$select count(*) from public.upload_limit_settings where hourly_uploads <> 50 or hourly_attempts <> 150 or storage_quota_mb <> 1024 or updated_by is not null$q$);
select pg_temp.mo_guard('the return reason rules differ from the seed of 6', $q$select count(*) from (select string_agg(claim_type || ':' || requires_evidence || ':' || shipping_payer || ':' || transit_damage, ',' order by claim_type, requires_evidence, shipping_payer, transit_damage) as s from public.marketplace_return_reason_rules) x where s <> 'defect:true:seller:false,defect:true:seller:false,defect:true:seller:false,defect:true:seller:true,general:false:buyer:false,general:false:buyer:false'$q$);
select pg_temp.mo_guard('the new owner-message presets differ from the seed of 20 or were edited', $q$select (select count(*) from (select action, count(*) as c from public.marketplace_seller_message_presets group by action) x join (values ('order_cancel_buyer', 3), ('order_cancel_seller', 4), ('payment_issue', 3), ('return_reason', 6), ('return_reject', 4)) s(action, n) using (action) where x.c <> s.n) + (select count(*) from public.marketplace_seller_message_presets where action in ('order_cancel_buyer', 'order_cancel_seller', 'payment_issue', 'return_reason', 'return_reject') and (updated_by is not null or updated_at <> created_at))$q$);
select pg_temp.mo_guard('a new owner-message preset has an edit event', $q$select count(*) from public.marketplace_seller_preset_events e join public.marketplace_seller_message_presets p on p.id = e.preset_id where p.action in ('order_cancel_buyer', 'order_cancel_seller', 'payment_issue', 'return_reason', 'return_reject')$q$);
select pg_temp.mo_guard('a new notification template was edited', $q$select count(*) from public.notification_templates where key in ('marketplace.order.cancelled_by_buyer', 'marketplace.order.cancelled_by_seller', 'marketplace.order.cancelled_timeout_receipt', 'marketplace.order.cancelled_timeout_seller', 'marketplace.order.delivered', 'marketplace.order.payment_complaint_filed', 'marketplace.order.payment_complaint_resolved', 'marketplace.order.placed', 'marketplace.order.preparing', 'marketplace.order.ready_pickup', 'marketplace.order.receipt_disputed', 'marketplace.order.receipt_resubmitted', 'marketplace.order.refund_check', 'marketplace.order.refund_confirmed', 'marketplace.order.refund_sent', 'marketplace.order.reminder_receipt_resubmit', 'marketplace.order.reminder_seller_start', 'marketplace.order.shipped', 'marketplace.return.admin_decided', 'marketplace.return.admin_reminder', 'marketplace.return.approved', 'marketplace.return.escalated', 'marketplace.return.received', 'marketplace.return.refund_confirmed', 'marketplace.return.refund_sent', 'marketplace.return.rejected', 'marketplace.return.requested', 'marketplace.return.seller_reminder') and (version <> 1 or updated_by is not null)$q$);
select pg_temp.mo_guard('the template history holds an event for a new template', $q$select count(*) from public.notification_template_events where template_key in ('marketplace.order.cancelled_by_buyer', 'marketplace.order.cancelled_by_seller', 'marketplace.order.cancelled_timeout_receipt', 'marketplace.order.cancelled_timeout_seller', 'marketplace.order.delivered', 'marketplace.order.payment_complaint_filed', 'marketplace.order.payment_complaint_resolved', 'marketplace.order.placed', 'marketplace.order.preparing', 'marketplace.order.ready_pickup', 'marketplace.order.receipt_disputed', 'marketplace.order.receipt_resubmitted', 'marketplace.order.refund_check', 'marketplace.order.refund_confirmed', 'marketplace.order.refund_sent', 'marketplace.order.reminder_receipt_resubmit', 'marketplace.order.reminder_seller_start', 'marketplace.order.shipped', 'marketplace.return.admin_decided', 'marketplace.return.admin_reminder', 'marketplace.return.approved', 'marketplace.return.escalated', 'marketplace.return.received', 'marketplace.return.refund_confirmed', 'marketplace.return.refund_sent', 'marketplace.return.rejected', 'marketplace.return.requested', 'marketplace.return.seller_reminder')$q$);
select pg_temp.mo_guard('a notification of a new type was written', $q$select count(*) from public.notifications where event_type in ('marketplace.order.cancelled_by_buyer', 'marketplace.order.cancelled_by_seller', 'marketplace.order.cancelled_timeout_receipt', 'marketplace.order.cancelled_timeout_seller', 'marketplace.order.delivered', 'marketplace.order.payment_complaint_filed', 'marketplace.order.payment_complaint_resolved', 'marketplace.order.placed', 'marketplace.order.preparing', 'marketplace.order.ready_pickup', 'marketplace.order.receipt_disputed', 'marketplace.order.receipt_resubmitted', 'marketplace.order.refund_check', 'marketplace.order.refund_confirmed', 'marketplace.order.refund_sent', 'marketplace.order.reminder_receipt_resubmit', 'marketplace.order.reminder_seller_start', 'marketplace.order.shipped', 'marketplace.return.admin_decided', 'marketplace.return.admin_reminder', 'marketplace.return.approved', 'marketplace.return.escalated', 'marketplace.return.received', 'marketplace.return.refund_confirmed', 'marketplace.return.refund_sent', 'marketplace.return.rejected', 'marketplace.return.requested', 'marketplace.return.seller_reminder')$q$);
select pg_temp.mo_guard('another role holds one of the new permissions', $q$select greatest(count(*) - 2, 0) from public.admin_role_permissions where permission_key in ('marketplace_payment_complaints.review', 'marketplace_returns.review')$q$);
select pg_temp.mo_guard('an order was placed through the new checkout', $q$select count(*) from public.marketplace_orders where source <> 'legacy'$q$);
select pg_temp.mo_guard('a legacy order is in a status the old model cannot be told apart from (new, preparing, ready)', $q$select count(*) from public.marketplace_orders where status in ('new', 'preparing', 'ready')$q$);
select pg_temp.mo_guard('a legacy order carries new-model data', $q$select count(*) from public.marketplace_orders where address_id is not null or checkout_session_id is not null or ready_at is not null or preparing_at is not null or shipped_at is not null$q$);
select pg_temp.mo_guard('an order item has a returned quantity', $q$select count(*) from public.marketplace_order_items where quantity_returned <> 0$q$);
select pg_temp.mo_guard('a product was marked not returnable', $q$select count(*) from public.marketplace_products where non_returnable$q$);
select pg_temp.mo_guard('a payment proof belongs to the new checkout', $q$select count(*) from public.marketplace_payment_proofs where order_id is null or checkout_session_id is not null or purpose <> 'initial' or declared_amount_egp is not null$q$);
select pg_temp.mo_guard('a payment proof has a status the old model does not know', $q$select count(*) from public.marketplace_payment_proofs where status not in ('submitted', 'accepted', 'rejected')$q$);
select pg_temp.mo_guard('an order event is new-style', $q$select count(*) from public.marketplace_order_events where payload is not null or actor_role not in ('buyer', 'seller', 'system')$q$);

-- 1. triggers, constraints and indexes the plan added on existing tables, and the constraints it re-created
drop trigger if exists marketplace_unchecked_receipt_cancelled on public.marketplace_order_events;
drop trigger if exists trg_marketplace_orders_own_showroom on public.marketplace_orders;
drop trigger if exists trg_marketplace_orders_state_guard on public.marketplace_orders;
alter table public.marketplace_orders drop constraint if exists marketplace_orders_address_id_fkey;
alter table public.marketplace_orders drop constraint if exists marketplace_orders_checkout_session_id_fkey;
alter table public.marketplace_payment_proofs drop constraint if exists marketplace_payment_proofs_checkout_session_id_fkey;
alter table public.marketplace_order_events drop constraint if exists ck_mp_order_events_payload;
alter table public.marketplace_order_items drop constraint if exists ck_mp_order_items_returned;
alter table public.marketplace_orders drop constraint if exists ck_mp_orders_estimate;
alter table public.marketplace_orders drop constraint if exists ck_mp_orders_paid;
alter table public.marketplace_orders drop constraint if exists ck_mp_orders_source;
alter table public.marketplace_orders drop constraint if exists ck_mp_orders_speed;
alter table public.marketplace_orders drop constraint if exists ck_mp_orders_stock_state;
alter table public.marketplace_orders drop constraint if exists ck_mp_orders_stock_v2;
alter table public.marketplace_payment_proofs drop constraint if exists ck_mp_proofs_declared;
alter table public.marketplace_payment_proofs drop constraint if exists ck_mp_proofs_owner;
alter table public.marketplace_payment_proofs drop constraint if exists ck_mp_proofs_purpose;
alter table public.marketplace_order_events drop constraint if exists ck_mp_order_events_role;
alter table public.marketplace_orders drop constraint if exists ck_mp_orders_deposit;
alter table public.marketplace_orders drop constraint if exists ck_mp_orders_payment_method;
alter table public.marketplace_orders drop constraint if exists ck_mp_orders_payment_status;
alter table public.marketplace_orders drop constraint if exists ck_mp_orders_status;
alter table public.marketplace_payment_proofs drop constraint if exists ck_mp_proofs_status;
alter table public.marketplace_seller_message_presets drop constraint if exists ck_marketplace_seller_presets_action;
alter table public.notifications drop constraint if exists ck_notifications_event_type_known;
drop index if exists public.ix_marketplace_cart_items_variant;
drop index if exists public.ix_mp_buyer_addr_events_user;
drop index if exists public.ix_mp_buyer_addresses_user;
drop index if exists public.ix_mp_complaint_events_complaint;
drop index if exists public.ix_mp_complaints_order;
drop index if exists public.ix_mp_complaints_state_created;
drop index if exists public.ix_mp_evidence_order;
drop index if exists public.ix_mp_evidence_return;
drop index if exists public.ix_mp_orders_buyer_placed;
drop index if exists public.ix_mp_orders_number_trgm;
drop index if exists public.ix_mp_orders_seller_placed;
drop index if exists public.ix_mp_proofs_session;
drop index if exists public.ix_mp_return_events_return;
drop index if exists public.ix_mp_return_items_item;
drop index if exists public.ix_mp_returns_buyer;
drop index if exists public.ix_mp_returns_queue;
drop index if exists public.ix_mp_returns_seller;
drop index if exists public.ix_mp_sessions_buyer;
drop index if exists public.ix_mp_sessions_expiry;
drop index if exists public.ix_mp_timers_expiry;
drop index if exists public.ix_mp_timers_remind;
drop index if exists public.uq_upload_exemption_org;
drop index if exists public.uq_upload_exemption_user;
drop index if exists public.ux_mp_buyer_addresses_default;
drop index if exists public.ux_mp_complaints_open_order;
drop index if exists public.ux_mp_orders_checkout_session;
drop index if exists public.ux_mp_returns_active_per_order;
drop index if exists public.ux_mp_timers_active;

-- 2. new tables (their policies, triggers, indexes and owned sequences go with them) and standalone sequences
drop table if exists public.marketplace_buyer_address_events cascade;
drop table if exists public.marketplace_buyer_addresses cascade;
drop table if exists public.marketplace_cart_items cascade;
drop table if exists public.marketplace_cart_merges cascade;
drop table if exists public.marketplace_checkout_sessions cascade;
drop table if exists public.marketplace_order_cancellations cascade;
drop table if exists public.marketplace_order_invoices cascade;
drop table if exists public.marketplace_order_refunds cascade;
drop table if exists public.marketplace_order_shipments cascade;
drop table if exists public.marketplace_payment_complaint_events cascade;
drop table if exists public.marketplace_payment_complaints cascade;
drop table if exists public.marketplace_return_events cascade;
drop table if exists public.marketplace_return_evidence cascade;
drop table if exists public.marketplace_return_items cascade;
drop table if exists public.marketplace_return_reason_rules cascade;
drop table if exists public.marketplace_return_requests cascade;
drop table if exists public.marketplace_seller_return_settings cascade;
drop table if exists public.marketplace_timers cascade;
drop table if exists public.upload_limit_events cascade;
drop table if exists public.upload_limit_exemptions cascade;
drop table if exists public.upload_limit_settings cascade;
drop sequence if exists public.marketplace_invoice_number_seq;
drop sequence if exists public.marketplace_return_number_seq;

-- 3. seeded rows (before the old constraints come back: the new preset actions would violate them)
delete from public.notification_templates where key in ('marketplace.order.cancelled_by_buyer', 'marketplace.order.cancelled_by_seller', 'marketplace.order.cancelled_timeout_receipt', 'marketplace.order.cancelled_timeout_seller', 'marketplace.order.delivered', 'marketplace.order.payment_complaint_filed', 'marketplace.order.payment_complaint_resolved', 'marketplace.order.placed', 'marketplace.order.preparing', 'marketplace.order.ready_pickup', 'marketplace.order.receipt_disputed', 'marketplace.order.receipt_resubmitted', 'marketplace.order.refund_check', 'marketplace.order.refund_confirmed', 'marketplace.order.refund_sent', 'marketplace.order.reminder_receipt_resubmit', 'marketplace.order.reminder_seller_start', 'marketplace.order.shipped', 'marketplace.return.admin_decided', 'marketplace.return.admin_reminder', 'marketplace.return.approved', 'marketplace.return.escalated', 'marketplace.return.received', 'marketplace.return.refund_confirmed', 'marketplace.return.refund_sent', 'marketplace.return.rejected', 'marketplace.return.requested', 'marketplace.return.seller_reminder');
delete from public.marketplace_seller_message_presets where action in ('order_cancel_buyer', 'order_cancel_seller', 'payment_issue', 'return_reason', 'return_reject');
-- locked core permissions refuse direct deletes (app.admin_role_permissions_guard); the guard is paused only for this statement, inside the transaction.
alter table public.admin_role_permissions disable trigger trg_admin_role_permissions_guard;
delete from public.admin_role_permissions where permission_key in ('marketplace_payment_complaints.review', 'marketplace_returns.review');
alter table public.admin_role_permissions enable trigger trg_admin_role_permissions_guard;
delete from public.admin_permissions where key in ('marketplace_payment_complaints.review', 'marketplace_returns.review');

-- 4. legacy orders back to the old payment values (only if migration 20261125100001 ran; the guard proved there is no new-model order)
do $d$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'marketplace_orders' and column_name = 'source') then
    update public.marketplace_orders set
      payment_method = 'instapay',
      deposit_percent = case when payment_method = 'instapay_full' then 100 else deposit_percent end,
      deposit_egp = case when payment_method = 'instapay_full' then total_egp else deposit_egp end,
      payment_status = case payment_status when 'receipt_submitted' then 'deposit_submitted' when 'receipt_accepted' then 'deposit_accepted'
                         when 'receipt_disputed' then 'deposit_rejected' else payment_status end
    where payment_method in ('instapay_full', 'instapay_deposit');
  end if;
end $d$;

alter table public.marketplace_order_events add constraint ck_mp_order_events_role CHECK ((actor_role = ANY (ARRAY['buyer'::text, 'seller'::text, 'system'::text])));
alter table public.marketplace_orders add constraint ck_mp_orders_deposit CHECK (((payment_method = 'instapay'::text) = ((deposit_percent IS NOT NULL) AND (deposit_egp IS NOT NULL) AND (instapay_address IS NOT NULL) AND (instapay_account_name IS NOT NULL))));
alter table public.marketplace_orders add constraint ck_mp_orders_payment_method CHECK ((payment_method = ANY (ARRAY['cod'::text, 'instapay'::text])));
alter table public.marketplace_orders add constraint ck_mp_orders_payment_status CHECK ((((payment_method = 'cod'::text) AND (payment_status = ANY (ARRAY['pending'::text, 'collected'::text, 'not_collected'::text]))) OR ((payment_method = 'instapay'::text) AND (payment_status = ANY (ARRAY['awaiting_deposit'::text, 'deposit_submitted'::text, 'deposit_accepted'::text, 'deposit_rejected'::text, 'collected'::text, 'not_collected'::text, 'refund_due'::text])))));
alter table public.marketplace_orders add constraint ck_mp_orders_status CHECK ((status = ANY (ARRAY['pending_confirmation'::text, 'confirmed'::text, 'processing'::text, 'shipped'::text, 'ready_for_pickup'::text, 'delivered'::text, 'cancelled'::text, 'delivery_failed'::text, 'returned'::text])));
alter table public.marketplace_payment_proofs add constraint ck_mp_proofs_status CHECK ((status = ANY (ARRAY['submitted'::text, 'accepted'::text, 'rejected'::text])));
alter table public.marketplace_seller_message_presets add constraint ck_marketplace_seller_presets_action CHECK ((action = ANY (ARRAY['approve'::text, 'reject'::text, 'suspend'::text, 'reinstate'::text, 'revoke'::text, 'image_reject'::text])));
alter table public.notifications add constraint ck_notifications_event_type_known CHECK ((event_type = ANY (ARRAY['job.application.accepted'::text, 'job.application.rejected'::text, 'job.assignment.cancelled'::text, 'job.assignment.completed'::text, 'job.assignment.ready'::text, 'job.review.received'::text, 'marketplace.product.rejected'::text, 'marketplace.seller.approved'::text, 'marketplace.seller.reinstated'::text, 'marketplace.seller.rejected'::text, 'marketplace.seller.revoked'::text, 'marketplace.seller.suspended'::text, 'marketplace.stock.low'::text, 'marketplace.stock.out'::text, 'message.sent'::text, 'order.cancelled'::text, 'order.completed'::text, 'order.created'::text, 'order.started'::text, 'project.activated'::text, 'project.completed'::text, 'project.created'::text, 'quotation.accepted'::text, 'quotation.rejected'::text, 'quotation.submitted'::text, 'rfq.cancelled'::text, 'rfq.submitted'::text, 'verification.approved'::text, 'verification.changes_requested'::text, 'verification.rejected'::text, 'whatsapp_otp.audit_unmatched'::text, 'whatsapp_otp.budget_critical'::text, 'whatsapp_otp.budget_exhausted'::text, 'whatsapp_otp.budget_warning'::text, 'whatsapp_otp.delivery_unmatched'::text, 'whatsapp_otp.failure_rate'::text])));

-- 5. columns on existing tables
alter table public.marketplace_payment_proofs alter column order_id set not null;
alter table public.marketplace_order_events drop column if exists payload;
alter table public.marketplace_order_items drop column if exists free_shipping, drop column if exists image_id, drop column if exists non_returnable, drop column if exists product_slug, drop column if exists quantity_returned, drop column if exists variant_label;
alter table public.marketplace_orders drop column if exists address_id, drop column if exists address_snapshot, drop column if exists balance_due_egp, drop column if exists checkout_session_id, drop column if exists delivery_estimate_earliest, drop column if exists delivery_estimate_latest, drop column if exists delivery_speed, drop column if exists latitude, drop column if exists longitude, drop column if exists paid_now_egp, drop column if exists placed_at, drop column if exists preparing_at, drop column if exists ready_at, drop column if exists shipped_at, drop column if exists source, drop column if exists stock_state;
alter table public.marketplace_payment_proofs drop column if exists checkout_session_id, drop column if exists declared_amount_egp, drop column if exists purpose;
alter table public.marketplace_products drop column if exists non_returnable;

-- 6. functions the plan replaced: the exact previous definitions (owner and grants are unchanged by create or replace)
CREATE OR REPLACE FUNCTION app.admin_follow_up_status(p_completed_at timestamp with time zone, p_due_at timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select case
    when p_completed_at is not null then 'done'
    when p_due_at is not null and p_due_at < now() then 'overdue'
    else 'open'
  end
$function$;

CREATE OR REPLACE FUNCTION app.admin_org_status_tab(p_status org_status)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case p_status
    when 'suspended' then 'suspended'
    when 'active' then 'verified'
    when 'pending_verification' then 'pending'
  end
$function$;

CREATE OR REPLACE FUNCTION app.admin_user_status_tab(p_status user_status, p_latest verification_status)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_status = 'suspended' then 'suspended'
    when p_latest = 'rejected' then 'rejected'
    when p_latest = 'approved' then 'verified'
    when p_latest in ('submitted', 'under_review', 'needs_more_info') then 'pending'
  end
$function$;

CREATE OR REPLACE FUNCTION app.admin_user_verification_state(p_is_verified boolean, p_latest verification_status)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_latest = 'rejected' then 'rejected'
    when p_latest = 'approved' or p_is_verified then 'verified'
    when p_latest in ('submitted', 'under_review') then 'pending'
    else 'unverified'
  end
$function$;

CREATE OR REPLACE FUNCTION app.limit_pending_media()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_count bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.owner_user_id::text,11));
  select (select count(*) from public.portfolio_items where owner_user_id=new.owner_user_id and state='pending' and created_at>now()-interval '24 hours')
       + (select count(*) from public.professional_certificates where owner_user_id=new.owner_user_id and state='pending' and created_at>now()-interval '24 hours')
       + (select count(*) from public.avatar_uploads where owner_user_id=new.owner_user_id and state='pending' and created_at>now()-interval '24 hours') + (select count(*) from public.product_images where created_by=new.owner_user_id and state='pending' and created_at>now()-interval '24 hours')
       + (select count(*) from public.organization_images where created_by=new.owner_user_id and state='pending' and created_at>now()-interval '24 hours') into v_count;
  if v_count>=10 then raise exception 'too many pending uploads' using errcode='54000'; end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app.limit_pending_organization_media()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pending bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.created_by::text,11));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.organization_id::text,13));
  select (select count(*) from public.product_images where organization_id=new.organization_id and state='pending' and created_at>now()-interval '24 hours')
       + (select count(*) from public.organization_images where organization_id=new.organization_id and state='pending' and created_at>now()-interval '24 hours') into pending;
  if pending>=10 then raise exception 'organization pending upload limit' using errcode='54000'; end if;
  select (select count(*) from public.product_images where created_by=new.created_by and state='pending' and created_at>now()-interval '24 hours')
       + (select count(*) from public.organization_images where created_by=new.created_by and state='pending' and created_at>now()-interval '24 hours')
       + (select count(*) from public.avatar_uploads where owner_user_id=new.created_by and state='pending' and created_at>now()-interval '24 hours')
       + (select count(*) from public.portfolio_items where owner_user_id=new.created_by and state='pending' and created_at>now()-interval '24 hours')
       + (select count(*) from public.professional_certificates where owner_user_id=new.created_by and state='pending' and created_at>now()-interval '24 hours') into pending;
  if pending>=10 then raise exception 'user pending upload limit' using errcode='54000'; end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app.marketplace_media_can_delete(p_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.marketplace_product_images i
    join public.marketplace_products p on p.id = i.product_id
    where i.object_key = p_key and i.upload_state in ('awaiting_upload', 'deleting')
      and app.marketplace_can_manage_catalog(p.seller_organization_id))
  or exists (
    select 1 from public.marketplace_payment_proofs pr
    where pr.object_key = p_key and pr.upload_state in ('awaiting_upload', 'deleting') and pr.created_by = (select auth.uid()));
$function$;

CREATE OR REPLACE FUNCTION app.marketplace_media_can_read(p_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.marketplace_product_images i
    join public.marketplace_products p on p.id = i.product_id
    where i.object_key = p_key and i.upload_state = 'confirmed'
      and (app.is_org_member(p.seller_organization_id) or app.has_admin_permission('marketplace_media.moderate')))
  or exists (
    select 1 from public.marketplace_payment_proofs pr join public.marketplace_orders o on o.id = pr.order_id
    where pr.object_key = p_key and pr.upload_state = 'confirmed'
      and (pr.created_by = (select auth.uid()) or app.marketplace_can_manage_orders(o.seller_organization_id)));
$function$;

CREATE OR REPLACE FUNCTION app.marketplace_media_can_upload(p_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION app.marketplace_media_cleanup_rows()
 RETURNS TABLE(key text, owner uuid, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select i.object_key, i.created_by, i.created_at from public.marketplace_product_images i
  where i.created_by is not null
    and (i.upload_state = 'deleting' or (i.upload_state = 'awaiting_upload' and i.created_at < now() - interval '24 hours'))
  union all
  select pr.object_key, pr.created_by, pr.created_at from public.marketplace_payment_proofs pr
  where pr.upload_state = 'deleting' or (pr.upload_state = 'awaiting_upload' and pr.created_at < now() - interval '24 hours');
$function$;

CREATE OR REPLACE FUNCTION app.marketplace_media_metadata(p_key text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object('owner', i.created_by, 'organization', p.seller_organization_id, 'contentType', i.mime_type,
    'state', case i.upload_state when 'awaiting_upload' then 'pending' when 'confirmed' then 'ready' else 'deleted' end,
    'createdAt', i.created_at)
  from public.marketplace_product_images i join public.marketplace_products p on p.id = i.product_id
  where i.object_key = p_key
  union all
  select jsonb_build_object('owner', pr.created_by, 'organization', o.seller_organization_id, 'contentType', pr.mime_type,
    'state', case pr.upload_state when 'awaiting_upload' then 'pending' when 'confirmed' then 'ready' else 'deleted' end,
    'createdAt', pr.created_at)
  from public.marketplace_payment_proofs pr join public.marketplace_orders o on o.id = pr.order_id
  where pr.object_key = p_key;
$function$;

CREATE OR REPLACE FUNCTION app.marketplace_media_retire(p_key text, p_owner uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.marketplace_product_images set upload_state = 'deleting', status = 'rejected', is_primary = false
   where object_key = p_key and created_by = p_owner
     and (upload_state = 'deleting' or (upload_state = 'awaiting_upload' and created_at < now() - interval '24 hours'));
  if found then return true; end if;
  update public.marketplace_payment_proofs set upload_state = 'deleting'
   where object_key = p_key and created_by = p_owner
     and (upload_state = 'deleting' or (upload_state = 'awaiting_upload' and created_at < now() - interval '24 hours'));
  return found;
end;
$function$;

CREATE OR REPLACE FUNCTION app.marketplace_media_storage_key(p_key text, p_owner uuid, p_org uuid)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  u constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  f text[];
begin
  f := regexp_match(p_key, '^proofs/' || u || '/(' || u || ')\.([a-z0-9]{2,5})$');
  if f is not null then
    if p_owner is null then raise exception 'unexpected media key' using errcode = '22023'; end if;
    return 'u/' || p_owner || '/certificates/' || f[1] || '/original.' || f[2];
  end if;
  f := regexp_match(p_key, '^' || u || '/(' || u || ')/(' || u || ')\.([a-z0-9]{2,5})$');
  if f is null or p_org is null then raise exception 'unexpected media key' using errcode = '22023'; end if;
  return 'o/' || p_org || '/products/' || f[1] || '/' || f[2] || '/original.' || f[3];
end;
$function$;

CREATE OR REPLACE FUNCTION app.marketplace_order_document(p_order uuid, p_for text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', o.id, 'order_number', o.order_number, 'checkout_id', o.checkout_id,
    'status', o.status, 'payment_method', o.payment_method, 'payment_status', o.payment_status,
    'fulfilment', o.fulfilment, 'governorate_key', o.governorate_key, 'area_key', o.area_key, 'address_text', o.address_text,
    'buyer_name', o.buyer_name, 'buyer_phone', o.buyer_phone, 'buyer_note', o.buyer_note,
    'subtotal_egp', o.subtotal_egp, 'delivery_fee_egp', o.delivery_fee_egp, 'total_egp', o.total_egp,
    'deposit_percent', o.deposit_percent, 'deposit_egp', o.deposit_egp,
    'instapay_address', o.instapay_address, 'instapay_account_name', o.instapay_account_name,
    'cancel_reason', o.cancel_reason, 'created_at', o.created_at, 'confirmed_at', o.confirmed_at,
    'delivered_at', o.delivered_at, 'cancelled_at', o.cancelled_at,
    'seller_name', org.name,
    'pickup_address', case when o.fulfilment = 'pickup' then (
      select coalesce(b.address_ar, b.address_en) from public.marketplace_stock_locations sl
      join public.branches b on b.id = sl.branch_id
      where sl.organization_id = o.seller_organization_id and sl.is_active and sl.supports_pickup
      order by (sl.key = 'main') desc limit 1) end,
    'viewer', p_for,
    'items', coalesce((select jsonb_agg(jsonb_build_object('sku', i.sku, 'name_ar', i.name_ar, 'name_en', i.name_en,
               'selling_unit', i.selling_unit, 'unit_price_egp', i.unit_price_egp, 'quantity', i.quantity,
               'line_total_egp', i.line_total_egp) order by i.created_at, i.sku)
             from public.marketplace_order_items i where i.order_id = o.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'to_status', e.to_status,
               'to_payment', e.to_payment, 'actor_role', e.actor_role, 'note', e.note, 'at', e.created_at) order by e.sequence)
             from public.marketplace_order_events e where e.order_id = o.id), '[]'::jsonb),
    'proofs', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'object_key', pr.object_key, 'status', pr.status,
               'review_note', pr.review_note, 'created_at', pr.created_at) order by pr.created_at)
             from public.marketplace_payment_proofs pr where pr.order_id = o.id and pr.upload_state = 'confirmed'), '[]'::jsonb))
  from public.marketplace_orders o join public.organizations org on org.id = o.seller_organization_id
  where o.id = p_order;
$function$;

CREATE OR REPLACE FUNCTION app.marketplace_order_stock(p_order uuid, p_movement text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o public.marketplace_orders;
  it record;
begin
  select * into o from public.marketplace_orders where id = p_order;
  for it in select * from public.marketplace_order_items where order_id = p_order order by sku loop
    perform 1 from public.marketplace_stock_apply(o.seller_organization_id, it.variant_id, it.location_id, p_movement,
      it.quantity, 'order:' || o.id || ':' || p_movement || ':' || it.variant_id, 'Marketplace order ' || o.order_number,
      'order', 'marketplace_order', o.id::text, (select auth.uid()));
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION app.normalize_org_name(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select nullif(btrim(regexp_replace(lower(coalesce(p_name, '')), '[[:space:][:punct:]،؛«»]+', ' ', 'g')), '')
$function$;

CREATE OR REPLACE FUNCTION app.resolve_city(p_governorate_key text, p_text text)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select c.key
  from app.place_cities c
  where c.governorate_key = p_governorate_key
    and c.name_norm = (select nullif(app.normalize_place(p_text), ''))
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION app.resolve_governorate(p_text text)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select g.key
  from app.place_governorates g
  where g.name_norm = (select nullif(app.normalize_place(p_text), ''))
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION app.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app.showroom_publish_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.status='published' and (tg_op='INSERT' or old.status is distinct from new.status)
 and not app.showroom_seller_ready(new.organization_id) then
 raise exception 'showroom must be active, approved and complete before product publishing' using errcode='42501'; end if;
 return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app.user_facing_email(p_email text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_email is null or btrim(p_email) = '' then null
    when lower(split_part(p_email, '@', 2)) = 'craftsman-login.aladdin.invalid' then null
    else btrim(p_email)
  end
$function$;

CREATE OR REPLACE FUNCTION public.admin_backup_request(p_actor uuid, p_kind text, p_reason text, p_receipt uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_env     text := app.backup_environment_value();
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_settings app.backup_settings;
  v_id      uuid;
begin
  if p_kind not in ('backup', 'restore_test') then
    raise exception 'invalid backup kind' using errcode = '22023';
  end if;
  perform app.backup_actor(p_actor, case when p_kind = 'backup' then 'backup.execute' else 'backup.restore_test' end);
  if char_length(v_reason) not between 10 and 500 then
    raise exception 'a reason of 10 to 500 characters is required' using errcode = '22023';
  end if;
  select * into v_settings from app.backup_settings where singleton;
  -- Production stays fail-closed until its separate activation.
  if v_env = 'production' and not v_settings.production_enabled then
    raise exception 'Production backups are not activated' using errcode = '55000';
  end if;
  perform app.backup_require_reauth(p_actor, p_receipt, case when p_kind = 'backup' then 'backup.execute' else 'backup.restore_test' end);

  insert into app.backup_runs (environment, kind, trigger, status, requested_by, reason)
  values (v_env, p_kind, 'manual', 'requested', p_actor, v_reason)
  returning id into v_id;
  perform app.backup_run_event(v_id, 'requested', jsonb_build_object('actor', p_actor, 'kind', p_kind));
  perform app.record_audit_event('backup.run_requested', 'backup_run', v_id, null,
    jsonb_build_object('environment', v_env, 'kind', p_kind, 'trigger', 'manual', 'reason', v_reason));
  return jsonb_build_object('id', v_id, 'environment', v_env, 'kind', p_kind, 'trigger', 'manual');
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_marketplace_seller_preset_save(p_id uuid, p_action text, p_label_ar text, p_label_en text, p_text_ar text, p_text_en text, p_is_active boolean, p_sort_order integer, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_old   public.marketplace_seller_message_presets;
  v_id    uuid;
  v_new   jsonb;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not app.has_admin_permission('notification_templates.manage') then
    raise exception 'permission notification_templates.manage is required' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'a reason of 3-500 characters is required' using errcode = '22023';
  end if;
  if p_action is null or p_action not in ('approve', 'reject', 'suspend', 'reinstate', 'revoke', 'image_reject') then
    raise exception 'unknown action' using errcode = '22023';
  end if;
  p_label_ar := btrim(p_label_ar); p_label_en := btrim(p_label_en);
  p_text_ar := btrim(p_text_ar);   p_text_en := btrim(p_text_en);
  if coalesce(char_length(p_label_ar), 0) not between 1 and 80 or coalesce(char_length(p_label_en), 0) not between 1 and 80
     or coalesce(char_length(p_text_ar), 0) not between 1 and 300 or coalesce(char_length(p_text_en), 0) not between 1 and 300 then
    raise exception 'labels must be 1-80 characters and texts 1-300 characters, in both languages' using errcode = '22023';
  end if;
  v_new := jsonb_build_object('action', p_action, 'label_ar', p_label_ar, 'label_en', p_label_en, 'text_ar', p_text_ar,
                              'text_en', p_text_en, 'is_active', coalesce(p_is_active, true), 'sort_order', coalesce(p_sort_order, 0));
  if p_id is null then
    insert into public.marketplace_seller_message_presets
      (action, label_ar, label_en, text_ar, text_en, is_active, sort_order, updated_by)
    values (p_action, p_label_ar, p_label_en, p_text_ar, p_text_en, coalesce(p_is_active, true), coalesce(p_sort_order, 0), v_actor)
    returning id into v_id;
    insert into public.marketplace_seller_preset_events (preset_id, action, old_content, new_content, actor_id, reason)
    values (v_id, 'created', null, v_new, v_actor, btrim(p_reason));
    return v_id;
  end if;
  select * into v_old from public.marketplace_seller_message_presets where id = p_id for update;
  if not found then
    raise exception 'unknown preset' using errcode = '22023';
  end if;
  update public.marketplace_seller_message_presets set
    action = p_action, label_ar = p_label_ar, label_en = p_label_en, text_ar = p_text_ar, text_en = p_text_en,
    is_active = coalesce(p_is_active, true), sort_order = coalesce(p_sort_order, 0), updated_by = v_actor
   where id = p_id;
  insert into public.marketplace_seller_preset_events (preset_id, action, old_content, new_content, actor_id, reason)
  values (p_id, 'updated',
          jsonb_build_object('action', v_old.action, 'label_ar', v_old.label_ar, 'label_en', v_old.label_en, 'text_ar', v_old.text_ar,
                             'text_en', v_old.text_en, 'is_active', v_old.is_active, 'sort_order', v_old.sort_order),
          v_new, v_actor, btrim(p_reason));
  return p_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.backup_report_run(p_environment text, p_kind text, p_github_run_id bigint, p_status text, p_conclusion text DEFAULT NULL::text, p_summary jsonb DEFAULT '{}'::jsonb, p_code text DEFAULT NULL::text, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_env  text := app.backup_environment_value();
  v_run  app.backup_runs;
  v_id   uuid;
  v_status text := p_status;
  v_terminal boolean := v_status in ('succeeded', 'failed', 'skipped', 'unknown');
begin
  if p_environment is distinct from v_env then
    raise exception 'environment mismatch' using errcode = '42501';
  end if;
  if p_kind not in ('backup', 'restore_test') or p_status not in ('running', 'succeeded', 'failed', 'skipped', 'unknown') then
    raise exception 'invalid backup report' using errcode = '22023';
  end if;
  if p_github_run_id is null or p_github_run_id <= 0 then
    raise exception 'invalid GitHub run id' using errcode = '22023';
  end if;
  if p_summary is null or jsonb_typeof(p_summary) <> 'object' then
    raise exception 'summary must be a JSON object' using errcode = '22023';
  end if;
  if p_code is not null and p_code !~ '^[a-z0-9_]{1,48}$' then
    raise exception 'invalid code' using errcode = '22023';
  end if;

  -- The trusted completion worker verifies GitHub job and coverage evidence.
  -- This RPC is never executable by a browser/user JWT.
  if p_status = 'succeeded' and (p_conclusion is distinct from 'success' or p_summary->>'coverage_verified' is distinct from 'true') then
    raise exception 'verified coverage required' using errcode = '42501';
  end if;
  select * into v_run from app.backup_runs where environment = v_env
    and (github_run_id = p_github_run_id or (p_request_id is not null and id = p_request_id)) for update;
  if p_request_id is not null and not found then
    raise exception 'request not found in this environment' using errcode = '42501';
  end if;
  if not found then
    insert into app.backup_runs (environment, kind, trigger, status, reason, github_run_id, summary, error_code,
                                 dispatched_at, started_at, finished_at, reported_at)
    values (v_env, p_kind, 'schedule', v_status, 'Scheduled run reported by GitHub.', p_github_run_id,
            p_summary, p_code, clock_timestamp(), case when v_status <> 'requested' then clock_timestamp() end,
            case when v_terminal then clock_timestamp() end, clock_timestamp())
    returning * into v_run;
  else
    if v_run.github_run_id is not null and v_run.github_run_id <> p_github_run_id then
      raise exception 'request already dispatched' using errcode = '42501';
    end if;
    if v_run.kind is distinct from p_kind then
      raise exception 'run kind mismatch' using errcode = '42501';
    end if;
    if v_run.status in ('succeeded','failed','skipped') then return v_run.id; end if;
    update app.backup_runs
       set status = v_status,
           github_run_id = p_github_run_id,
           dispatched_at = coalesce(dispatched_at, clock_timestamp()),
           github_conclusion = p_conclusion,
           summary = p_summary,
           error_code = p_code,
           started_at = coalesce(started_at, clock_timestamp()),
           finished_at = case when v_terminal then coalesce(finished_at, clock_timestamp()) else null end,
           reported_at = clock_timestamp()
     where id = v_run.id
     returning * into v_run;
  end if;
  v_id := v_run.id;
  perform app.backup_run_event(v_id, 'reported', jsonb_build_object('reported_status', p_status, 'stored_status', v_status, 'conclusion', p_conclusion, 'code', p_code));
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.marketplace_buyer_proof_request_upload(p_order_id uuid, p_content_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o     public.marketplace_orders;
  v_id  uuid := gen_random_uuid();
  v_ext text;
  v_key text;
begin
  select * into o from public.marketplace_orders where id = p_order_id and buyer_user_id = (select auth.uid()) for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  if o.payment_method <> 'instapay' or o.status <> 'pending_confirmation'
     or o.payment_status not in ('awaiting_deposit', 'deposit_rejected') then
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
  insert into public.marketplace_payment_proofs (id, order_id, object_key, mime_type, created_by)
  values (v_id, o.id, v_key, p_content_type, (select auth.uid()));
  return jsonb_build_object('proof_id', v_id, 'object_key', v_key);
end;
$function$;

CREATE OR REPLACE FUNCTION public.marketplace_public_product(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_p      public.marketplace_products;
  t        public.marketplace_product_types;
  c        public.marketplace_categories;
  o        public.organizations;
  v_media  boolean := app.marketplace_media_verification_ready();
  v_result jsonb;
begin
  if not app.marketplace_is_open() then
    return null;
  end if;
  select p.* into v_p
  from public.marketplace_products p
  join public.marketplace_product_types tt on tt.id = p.product_type_id and tt.is_active
  join public.marketplace_categories cc on cc.id = tt.category_id and cc.is_active
  where p.slug = p_slug and p.status = 'published'
    and app.marketplace_seller_is_public(p.seller_organization_id)
    and app.marketplace_product_is_listed(p.id);
  if not found then
    return null;
  end if;
  select * into t from public.marketplace_product_types where id = v_p.product_type_id;
  select * into c from public.marketplace_categories where id = t.category_id;
  select * into o from public.organizations where id = v_p.seller_organization_id;

  select jsonb_build_object(
    'slug', v_p.slug,
    'name_ar', v_p.name_ar, 'name_en', v_p.name_en,
    'description_ar', v_p.description_ar, 'description_en', v_p.description_en,
    'brand', v_p.brand,
    'product_type_key', t.key, 'product_type_name_ar', t.name_ar, 'product_type_name_en', t.name_en,
    'category_key', c.key, 'category_name_ar', c.name_ar, 'category_name_en', c.name_en,
    'seller_name', o.name,
    'seller_slug', o.slug,
    'seller_official', o.business_verified_at is not null,
    'published_at', v_p.published_at,
    'stock_left', app.marketplace_public_stock_left(v_p.id),
    'ships_free', app.marketplace_product_ships_free(v_p.id),
    'cover_image_id', case when v_media then app.marketplace_product_cover_image(v_p.id) end,
    'attributes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', d.key, 'name_ar', d.name_ar, 'name_en', d.name_en, 'data_type', av.data_type, 'unit_kind', d.unit_kind,
               'unit_ar', d.display_unit_ar, 'unit_en', d.display_unit_en,
               'value', case
                 when av.option_id is not null then jsonb_build_object('key', op.key, 'name_ar', op.name_ar, 'name_en', op.name_en, 'swatch_hex', op.swatch_hex)
                 when av.value_number is not null then to_jsonb(av.value_number)
                 when av.value_boolean is not null then to_jsonb(av.value_boolean)
                 else to_jsonb(av.value_text) end)
             order by d.key)
      from public.marketplace_product_attribute_values av
      join public.marketplace_attribute_definitions d on d.id = av.attribute_id and d.is_active
      left join public.marketplace_attribute_options op on op.id = av.option_id
      where av.product_id = v_p.id), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sku', pv.sku, 'selling_unit', pv.selling_unit, 'price_egp', pv.price_egp,
               'purchasable', app.marketplace_variant_available(pv.id) > 0,
               'stock_left', case when app.marketplace_variant_available(pv.id) between 1 and 3 then app.marketplace_variant_available(pv.id) end,
               'attributes', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'key', d.key, 'name_ar', d.name_ar, 'name_en', d.name_en, 'data_type', vv.data_type, 'unit_kind', d.unit_kind,
                          'unit_ar', d.display_unit_ar, 'unit_en', d.display_unit_en,
                          'value', case
                            when vv.option_id is not null then jsonb_build_object('key', op.key, 'name_ar', op.name_ar, 'name_en', op.name_en, 'swatch_hex', op.swatch_hex)
                            when vv.value_number is not null then to_jsonb(vv.value_number)
                            when vv.value_boolean is not null then to_jsonb(vv.value_boolean)
                            else to_jsonb(vv.value_text) end)
                        order by d.key)
                 from public.marketplace_variant_attribute_values vv
                 join public.marketplace_attribute_definitions d on d.id = vv.attribute_id and d.is_active
                 left join public.marketplace_attribute_options op on op.id = vv.option_id
                 where vv.variant_id = pv.id), '[]'::jsonb))
             order by pv.sku)
      from public.marketplace_product_variants pv
      where pv.product_id = v_p.id and pv.status = 'active'), '[]'::jsonb),
    'images', case when v_media then coalesce((
      select jsonb_agg(jsonb_build_object(
               'image_id', i.id, 'sort_order', i.sort_order, 'is_primary', i.is_primary,
               'alt_text_ar', i.alt_text_ar, 'alt_text_en', i.alt_text_en,
               'variant_sku', pv.sku)
             order by (i.variant_id is not null), (not i.is_primary), i.sort_order)
      from public.marketplace_product_images i
      left join public.marketplace_product_variants pv on pv.id = i.variant_id
      where i.product_id = v_p.id and i.status = 'verified' and i.upload_state = 'confirmed'
        and i.content_valid is true and (i.variant_id is null or pv.status = 'active')), '[]'::jsonb) else '[]'::jsonb end
  ) into v_result;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.marketplace_seller_image_request_upload(p_product_id uuid, p_content_type text, p_variant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org   uuid;
  v_uid   uuid;
  v_ext   text;
  v_id    uuid := gen_random_uuid();
  v_key   text;
  v_sort  integer;
  v_open  integer;
  v_fresh integer;
  v_hour  integer;
begin
  select seller_organization_id into v_org from public.marketplace_products where id = p_product_id;
  if v_org is null then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  v_uid := app.marketplace_assert_seller_writer(v_org);
  v_ext := case p_content_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  if v_ext is null then
    raise exception 'mp:image_type_invalid' using errcode = '22023';
  end if;
  if p_variant_id is not null and not exists (
       select 1 from public.marketplace_product_variants where id = p_variant_id and product_id = p_product_id) then
    raise exception 'mp:variant_not_found' using errcode = '42501';
  end if;

  -- keys that were issued but never uploaded to within their hour are withdrawn
  -- into the removal lifecycle (their rows are forgotten once the bytes are confirmed absent)
  update public.marketplace_product_images
     set upload_state = 'deleting', status = 'rejected', is_primary = false
   where product_id = p_product_id and upload_state = 'awaiting_upload'
     and created_at < now() - interval '1 hour';

  select count(*) into v_open from public.marketplace_product_images where product_id = p_product_id and status <> 'rejected';
  if v_open >= 5 then
    raise exception 'mp:too_many_images' using errcode = '23514';
  end if;
  select count(*) into v_fresh from public.marketplace_product_images
   where product_id = p_product_id and upload_state = 'awaiting_upload';
  if v_fresh >= 10 then
    raise exception 'mp:too_many_pending_uploads' using errcode = '23514';
  end if;
  -- NOT a serialization-failure SQLSTATE (PostgREST would retry it). P0001 is an immediate refusal.
  select count(*) into v_hour from public.marketplace_product_images i
    join public.marketplace_products p on p.id = i.product_id
   where p.seller_organization_id = v_org and i.created_at > now() - interval '1 hour';
  if v_hour >= 200 then
    raise exception 'mp:upload_rate_limited' using errcode = 'P0001';
  end if;

  v_key := v_org::text || '/' || p_product_id::text || '/' || v_id::text || '.' || v_ext;
  select coalesce(max(sort_order) + 1, 0) into v_sort from public.marketplace_product_images
   where product_id = p_product_id and variant_id is not distinct from p_variant_id;
  insert into public.marketplace_product_images
    (id, product_id, variant_id, object_key, sort_order, is_primary, status, mime_type, upload_state, created_by)
  values (v_id, p_product_id, p_variant_id, v_key, v_sort, false,
          'pending', p_content_type, 'awaiting_upload', v_uid);
  return jsonb_build_object('image_id', v_id, 'object_key', v_key);
end;
$function$;

CREATE OR REPLACE FUNCTION public.marketplace_seller_product_get(p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  p public.marketplace_products;
  v jsonb;
begin
  select * into p from public.marketplace_products where id = p_product_id;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  perform app.marketplace_assert_seller_reader(p.seller_organization_id);

  select jsonb_build_object(
    'id', p.id,
    'organization_id', p.seller_organization_id,
    'product_type_key', t.key,
    'category_key', c.key,
    'name_ar', p.name_ar, 'name_en', p.name_en,
    'description_ar', p.description_ar, 'description_en', p.description_en,
    'brand', p.brand, 'external_ref', p.external_ref, 'slug', p.slug,
    'status', p.status, 'published_at', p.published_at, 'updated_at', p.updated_at,
    'attributes', coalesce((
      select jsonb_object_agg(x.key, x.val) from (
        select d.key,
               case when d.data_type = 'multi_option'
                    then jsonb_agg(o.key order by o.sort_order)
                    else (array_agg(app.marketplace_attribute_json(d.data_type, o.key, av.value_number, av.value_boolean, av.value_text)))[1]
               end as val
        from public.marketplace_product_attribute_values av
        join public.marketplace_attribute_definitions d on d.id = av.attribute_id
        left join public.marketplace_attribute_options o on o.id = av.option_id
        where av.product_id = p.id
        group by d.key, d.data_type) x), '{}'::jsonb),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pv.id, 'sku', pv.sku, 'selling_unit', pv.selling_unit, 'price_egp', pv.price_egp,
               'status', pv.status,
               'attributes', coalesce((
                 select jsonb_object_agg(x.key, x.val) from (
                   select d.key,
                          case when d.data_type = 'multi_option'
                               then jsonb_agg(o.key order by o.sort_order)
                               else (array_agg(app.marketplace_attribute_json(d.data_type, o.key, vv.value_number, vv.value_boolean, vv.value_text)))[1]
                          end as val
                   from public.marketplace_variant_attribute_values vv
                   join public.marketplace_attribute_definitions d on d.id = vv.attribute_id
                   left join public.marketplace_attribute_options o on o.id = vv.option_id
                   where vv.variant_id = pv.id
                   group by d.key, d.data_type) x), '{}'::jsonb),
               'stock', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'location_id', l.id, 'location_name_ar', l.name_ar, 'location_name_en', l.name_en,
                          'location_active', l.is_active,
                          'on_hand', il.on_hand, 'reserved', il.reserved, 'available', il.available)
                        order by l.name_en)
                 from public.marketplace_inventory_levels il
                 join public.marketplace_stock_locations l on l.id = il.location_id
                 where il.variant_id = pv.id), '[]'::jsonb))
             order by pv.created_at, pv.sku)
      from public.marketplace_product_variants pv where pv.product_id = p.id), '[]'::jsonb),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'variant_id', i.variant_id, 'object_key', i.object_key,
               'sort_order', i.sort_order, 'is_primary', i.is_primary, 'status', i.status,
               'upload_state', i.upload_state, 'mime_type', i.mime_type, 'byte_size', i.byte_size,
               'alt_text_ar', i.alt_text_ar, 'alt_text_en', i.alt_text_en)
             order by (i.variant_id is not null), i.sort_order)
      from public.marketplace_product_images i where i.product_id = p.id and i.status <> 'rejected'), '[]'::jsonb),
    'blockers', to_jsonb(app.marketplace_publication_blockers(p.id))
  ) into v
  from public.marketplace_product_types t
  join public.marketplace_categories c on c.id = t.category_id
  where t.id = p.product_type_id;
  return v;
end;
$function$;

CREATE OR REPLACE FUNCTION public.media_storage_attest(p_namespace text, p_key text, p_owner uuid, p_provider text, p_size bigint, p_content_type text, p_sha256 text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m jsonb; v_limit bigint; v_existing public.media_storage_locations;
begin
  m := app.media_metadata(p_namespace,p_key);
  v_limit := coalesce(app.media_limit_bytes('image', p_namespace), 0);
  if m is null or p_owner is null or p_size is null or p_sha256 is null or p_content_type is null
    or (m->>'owner')::uuid<>p_owner or m->>'state'<>'pending'
    or m->>'contentType'<>p_content_type or p_size<=0 or p_size>v_limit
    or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid verification receipt' using errcode='42501';
  end if;
  select * into v_existing from public.media_storage_locations
    where namespace=p_namespace and object_key=p_key for update;
  if not found or v_existing.provider<>p_provider or v_existing.owner_user_id<>p_owner then
    raise exception 'missing provider reservation' using errcode='42501';
  end if;
  if v_existing.verified_at is not null and
    (v_existing.sha256<>p_sha256 or v_existing.size_bytes<>p_size) then
    raise exception 'immutable receipt conflict' using errcode='42501';
  end if;
  update public.media_storage_locations set size_bytes=p_size,sha256=p_sha256,verified_at=now()
    where namespace=p_namespace and object_key=p_key;
end;
$function$;

CREATE OR REPLACE FUNCTION public.media_storage_reserve(p_namespace text, p_key text, p_provider text, p_owner uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m jsonb; v_existing text; v_uid uuid; v_org uuid;
begin
  v_uid := case when auth.jwt()->>'role'='service_role' then p_owner else (select auth.uid()) end;
  m := app.media_metadata(p_namespace,p_key);
  v_org := (m->>'organization')::uuid;
  if v_org is not null and coalesce(auth.jwt()->>'role','')<>'service_role'
    and not (case p_namespace when 'product' then app.can_upload_product_image_object(p_key)
      when 'request' then app.can_upload_request_image_object(p_key)
      when 'verification' then app.can_upload_bv_object(p_key)
      when 'marketplace' then app.marketplace_media_can_upload(p_key)
      else app.can_upload_organization_image_object(p_key) end) then
    raise exception 'organization upload not authorized' using errcode='42501';
  end if;
  if m is null or v_uid is null or (m->>'owner')::uuid<>v_uid or m->>'state'<>'pending'
    or not app.account_is_active(v_uid) or (m->>'createdAt')::timestamptz <= now()-interval '24 hours' then
    raise exception 'upload not authorized' using errcode='42501';
  end if;
  if p_provider='r2' and coalesce(auth.jwt()->>'role','')<>'service_role' then
    raise exception 'R2 routing requires backend authorization' using errcode='42501';
  end if;
  if p_provider not in ('supabase','r2') then raise exception 'invalid provider' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text,11));
  if v_org is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_org::text,13));
    if not exists(select 1 from public.organizations where id=v_org and deleted_at is null) then
      raise exception 'organization unavailable' using errcode='42501';
    end if;
  end if;
  select provider into v_existing from public.media_storage_locations where namespace=p_namespace and object_key=p_key;
  if v_existing is not null then
    if v_existing<>p_provider then raise exception 'provider is immutable' using errcode='22023'; end if;
    return;
  end if;
  if (select count(*) from public.media_storage_locations where owner_user_id=v_uid
      and created_at>now()-interval '1 hour') >= 50 then
    raise exception 'upload rate limit' using errcode='54000';
  end if;
  if (select coalesce(sum(coalesce(size_bytes,10485760)),0) from public.media_storage_locations l
      where owner_user_id=v_uid and coalesce(app.media_metadata(l.namespace,l.object_key)->>'state','deleted')<>'deleted') + 10485760 > 1073741824 then
    raise exception 'upload quota exceeded' using errcode='54000';
  end if;
  if v_org is not null then
    if (select count(*) from public.media_storage_locations where organization_id=v_org and created_at>now()-interval '1 hour')>=50 then
      raise exception 'organization upload rate limit' using errcode='54000';
    end if;
    if (select coalesce(sum(coalesce(size_bytes,10485760)),0) from public.media_storage_locations l
       where organization_id=v_org and coalesce(app.media_metadata(l.namespace,l.object_key)->>'state','deleted')<>'deleted')+10485760>1073741824 then
      raise exception 'organization upload quota exceeded' using errcode='54000';
    end if;
  end if;
  insert into public.media_storage_locations(namespace,object_key,owner_user_id,provider,content_type,organization_id)
  values(p_namespace,p_key,v_uid,p_provider,m->>'contentType',v_org);
end;
$function$;

CREATE OR REPLACE FUNCTION public.organization_media_resolve(p_namespace text, p_key text, p_operation text, p_workspace uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m jsonb; allowed boolean := false; v_provider text; v_uid uuid := (select auth.uid());
begin
  if p_namespace not in ('product','organization','request','verification','marketplace') or v_uid is null
    or not app.account_is_active(v_uid) then return null; end if;
  m:=app.media_metadata(p_namespace,p_key);
  -- A personal purchase request has no organization; every other namespace needs a live one.
  if m is null or (p_namespace<>'request' and not exists(select 1 from public.organizations
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
$function$;

CREATE OR REPLACE FUNCTION public.portfolio_item_create(p_title text, p_description text, p_content_type text)
 RETURNS TABLE(item_id uuid, object_key text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid  uuid := (select auth.uid());
  v_ext  text;
  v_key  text;
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not app.can_create_professional_asset() then
    raise exception 'a professional persona is required to add portfolio work'
      using errcode = '42501';
  end if;
  v_ext := case p_content_type
             when 'image/jpeg' then 'jpg'
             when 'image/png'  then 'png'
             when 'image/webp' then 'webp'
           end;
  if v_ext is null then
    raise exception 'unsupported content type for portfolio work'
      using errcode = '22023';
  end if;
  v_key := extensions.gen_random_uuid()::text || '.' || v_ext;
  insert into public.portfolio_items
    (owner_user_id, object_key, content_type, title, description, sort_order)
  values
    (v_uid, v_key, p_content_type, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
     app.portfolio_next_position(v_uid))
  returning id into v_id;
  return query select v_id, v_key;
end;
$function$;

CREATE OR REPLACE FUNCTION public.video_upload_begin(p_scope text, p_product_id uuid, p_title text, p_content_type text, p_bytes bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_product public.products;
  v_mp public.marketplace_products;
  v_slot smallint;
  v_id uuid;
begin
  if v_uid is null or not app.account_is_active(v_uid) then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_content_type is null or p_content_type not in ('video/mp4', 'video/quicktime', 'video/webm') then
    raise exception 'unsupported video type' using errcode = '22023';
  end if;
  -- No product size cap: only R2's own 5 TiB object limit (the site-wide cap trigger refines it per place).
  if p_bytes is null or p_bytes <= 0 or p_bytes > 5497558138880 then
    raise exception 'video size is outside what storage accepts' using errcode = '22023';
  end if;
  if (select count(*) from public.media_videos
       where owner_user_id = v_uid and state = 'uploading') >= 10 then
    raise exception 'too many unfinished uploads' using errcode = '23514';
  end if;
  if p_scope = 'portfolio' then
    if p_product_id is not null then raise exception 'invalid scope' using errcode = '22023'; end if;
    if not app.can_create_professional_asset() then
      raise exception 'a professional persona is required to add portfolio work' using errcode = '42501';
    end if;
    insert into public.media_videos (owner_user_id, scope, title, content_type, declared_bytes, sort_order)
    values (v_uid, 'portfolio', btrim(p_title), p_content_type, p_bytes, app.portfolio_next_position(v_uid))
    returning id into v_id;
  elsif p_scope = 'product' then
    select * into v_product from public.products where id = p_product_id and deleted_at is null for update;
    if not found or not app.can_write_publisher(v_product.publisher_id) then
      raise exception 'catalog.write required' using errcode = '42501';
    end if;
    if v_product.archived_at is not null then
      raise exception 'an archived product must be restored before its media change' using errcode = '22023';
    end if;
    v_slot := app.product_media_free_slot(p_product_id);
    if v_slot is null then
      raise exception 'a product can have at most 3 photos and videos' using errcode = '23514';
    end if;
    insert into public.media_videos (owner_user_id, scope, product_id, publisher_id, title, content_type, declared_bytes, slot)
    values (v_uid, 'product', p_product_id, v_product.publisher_id, btrim(p_title), p_content_type, p_bytes, v_slot)
    returning id into v_id;
  elsif p_scope = 'marketplace' then
    -- Locking the product row serializes slot allocation, so concurrent requests cannot overfill the three slots.
    select * into v_mp from public.marketplace_products where id = p_product_id for update;
    if not found or not app.marketplace_video_manager(v_mp.seller_organization_id) then
      raise exception 'mp:not_permitted' using errcode = '42501';
    end if;
    if not app.marketplace_seller_is_enabled(v_mp.seller_organization_id) then
      raise exception 'mp:seller_not_enabled' using errcode = '42501';
    end if;
    if v_mp.status = 'archived' then
      raise exception 'mp:product_archived' using errcode = '22023';
    end if;
    v_slot := app.marketplace_video_free_slot(p_product_id);
    if v_slot is null then
      raise exception 'mp:too_many_videos' using errcode = '23514';
    end if;
    insert into public.media_videos (owner_user_id, scope, marketplace_product_id, seller_organization_id, title,
      content_type, declared_bytes, slot, review_status)
    values (v_uid, 'marketplace', p_product_id, v_mp.seller_organization_id, btrim(p_title), p_content_type, p_bytes,
      v_slot, 'pending')
    returning id into v_id;
    perform app.marketplace_video_event(v_id, p_product_id, v_mp.seller_organization_id, 'added',
      jsonb_build_object('content_type', p_content_type, 'bytes', p_bytes, 'slot', v_slot));
  else
    raise exception 'invalid scope' using errcode = '22023';
  end if;
  return v_id;
end;
$function$;

-- 7. functions the plan added
drop function if exists app.backup_expire_stale(p_environment text, p_keep_github_run_id bigint, p_keep_run uuid);
drop function if exists app.marketplace_buyer_address_event(p_user uuid, p_address uuid, p_kind text);
drop function if exists app.marketplace_buyer_address_events_append_only();
drop function if exists app.marketplace_buyer_address_json(a marketplace_buyer_addresses);
drop function if exists app.marketplace_buyer_address_lock(p_user uuid);
drop function if exists app.marketplace_buyer_phone_is_verified(p_user uuid, p_e164 text);
drop function if exists app.marketplace_cart_parse_line(p_line jsonb, p_index integer, OUT v_variant uuid, OUT v_qty integer);
drop function if exists app.marketplace_cart_variant_any(p_slug text, p_sku text);
drop function if exists app.marketplace_cart_variant_is_live(p_variant_id uuid);
drop function if exists app.marketplace_checkout_quote(p_buyer uuid, p_lines jsonb, p_fulfilment text, p_address_id uuid, p_delivery_speed text, p_payment_method text);
drop function if exists app.marketplace_checkout_quote_hash(p_quote jsonb);
drop function if exists app.marketplace_checkout_receipts(p_session uuid);
drop function if exists app.marketplace_complaint_admin_can_read(p_key text);
drop function if exists app.marketplace_escape_like(p_text text);
drop function if exists app.marketplace_evidence_require_verified_media();
drop function if exists app.marketplace_notify_admins(p_permission text, p_template_key text, p_subject_type text, p_subject_id uuid, p_deep_link text, p_vars jsonb);
drop function if exists app.marketplace_notify_order_managers(p_order uuid, p_template_key text, p_vars jsonb, p_vars_ar jsonb, p_vars_en jsonb);
drop function if exists app.marketplace_order_actions(p_order uuid, p_for text);
drop function if exists app.marketplace_order_apply(p_order uuid, p_action text, p_actor_role text, p_actor uuid, p_payload jsonb);
drop function if exists app.marketplace_order_complaint_id(p_order uuid);
drop function if exists app.marketplace_order_document_v2(p_order uuid, p_for text);
drop function if exists app.marketplace_order_extra_actions(p_order uuid, p_for text);
drop function if exists app.marketplace_order_extra_actions_base(p_order uuid, p_for text);
drop function if exists app.marketplace_order_extra_actions_returns(p_order uuid, p_for text);
drop function if exists app.marketplace_order_invoice_immutable();
drop function if exists app.marketplace_order_invoice_issue(p_order uuid, p_actor_role text);
drop function if exists app.marketplace_order_notify(p_order uuid, p_event text, p_vars jsonb);
drop function if exists app.marketplace_order_reason(p_payload jsonb, p_preset_action text, p_required boolean);
drop function if exists app.marketplace_order_return_window(p_order uuid);
drop function if exists app.marketplace_order_returns_json(p_order uuid, p_for text);
drop function if exists app.marketplace_order_search_match(p_order marketplace_orders, p_pattern text, p_include_buyer boolean);
drop function if exists app.marketplace_order_state_guard();
drop function if exists app.marketplace_order_stock_alert(p_order uuid);
drop function if exists app.marketplace_order_summary(p_order marketplace_orders, p_for text);
drop function if exists app.marketplace_order_tab_statuses(p_tab text);
drop function if exists app.marketplace_refuse_own_showroom();
drop function if exists app.marketplace_return_actions(p_return uuid, p_for text);
drop function if exists app.marketplace_return_can_start(p_order uuid);
drop function if exists app.marketplace_return_days(p_org uuid);
drop function if exists app.marketplace_return_decide(p_return uuid, p_decision text, p_role text, p_preset uuid, p_message_ar text, p_message_en text, p_partial numeric, p_note text);
drop function if exists app.marketplace_return_doc(p_return uuid, p_for text);
drop function if exists app.marketplace_return_escalate(p_return uuid, p_reason text, p_role text);
drop function if exists app.marketplace_return_event(p_return uuid, p_action text, p_from text, p_to text, p_role text, p_note text);
drop function if exists app.marketplace_return_evidence_can_read(p_key text);
drop function if exists app.marketplace_return_evidence_metadata(p_key text);
drop function if exists app.marketplace_return_items_sync_trg();
drop function if exists app.marketplace_return_notify(p_return uuid, p_event text, p_to text, p_msg_ar text, p_msg_en text, p_hours_left integer);
drop function if exists app.marketplace_return_order_payment(p_order uuid, p_status text);
drop function if exists app.marketplace_return_refund_cap(p_return uuid);
drop function if exists app.marketplace_return_role(p_return uuid);
drop function if exists app.marketplace_return_status_sync_trg();
drop function if exists app.marketplace_return_summary(p_return uuid, p_for text);
drop function if exists app.marketplace_return_sync_quantity(p_order_item uuid);
drop function if exists app.marketplace_return_timer_tick(p_timer marketplace_timers, p_now timestamp with time zone);
drop function if exists app.marketplace_return_value(p_return uuid);
drop function if exists app.marketplace_return_window_end(p_delivered timestamp with time zone, p_days integer);
drop function if exists app.marketplace_return_window_json(p_order uuid);
drop function if exists app.marketplace_timer_close(p_subject_type text, p_subject_id uuid, p_kind text, p_action text);
drop function if exists app.marketplace_timer_handle(p_timer marketplace_timers, p_now timestamp with time zone);
drop function if exists app.marketplace_timer_next_remind(p_timer marketplace_timers, p_now timestamp with time zone);
drop function if exists app.marketplace_timer_open(p_subject_type text, p_subject_id uuid, p_kind text, p_started timestamp with time zone);
drop function if exists app.marketplace_unchecked_receipt_cancelled();
drop function if exists app.marketplace_user_belongs_to_seller(p_user_id uuid, p_org_id uuid);
drop function if exists app.marketplace_variant_label(p_variant uuid);
drop function if exists app.upload_abandon_after();
drop function if exists app.upload_counts(p_namespace text, p_key text, p_reserved_at timestamp with time zone);
drop function if exists app.upload_exempt(p_user uuid, p_org uuid);
drop function if exists app.upload_limits_assert(p_manage boolean);
drop function if exists app.upload_used_bytes(p_user uuid, p_org uuid);
drop function if exists public.admin_marketplace_payment_complaint_decide(p_complaint_id uuid, p_decision text, p_note text);
drop function if exists public.admin_marketplace_payment_complaint_get(p_complaint_id uuid);
drop function if exists public.admin_marketplace_payment_complaint_take(p_complaint_id uuid);
drop function if exists public.admin_marketplace_payment_complaints(p_state text, p_limit integer, p_offset integer);
drop function if exists public.admin_marketplace_return_decide(p_return_id uuid, p_decision text, p_note text, p_message_ar text, p_message_en text);
drop function if exists public.admin_marketplace_return_get(p_return_id uuid);
drop function if exists public.admin_marketplace_return_remind_seller(p_return_id uuid);
drop function if exists public.admin_marketplace_returns(p_state text, p_queue text, p_limit integer, p_offset integer);
drop function if exists public.admin_upload_exemption_add(p_subject_type text, p_subject_id uuid, p_reason text);
drop function if exists public.admin_upload_exemption_remove(p_id uuid, p_reason text);
drop function if exists public.admin_upload_limits_get();
drop function if exists public.admin_upload_limits_set(p_hourly_uploads integer, p_hourly_attempts integer, p_storage_quota_mb integer, p_reason text);
drop function if exists public.admin_upload_subject_search(p_query text);
drop function if exists public.marketplace_buyer_address_delete(p_id uuid);
drop function if exists public.marketplace_buyer_address_save(p_address jsonb);
drop function if exists public.marketplace_buyer_address_set_default(p_id uuid);
drop function if exists public.marketplace_buyer_addresses();
drop function if exists public.marketplace_buyer_cancel_refund_confirm(p_order_id uuid);
drop function if exists public.marketplace_buyer_checkout_readiness(p_address_id uuid);
drop function if exists public.marketplace_buyer_order_cancel_v2(p_order_id uuid, p_preset_id uuid, p_note text);
drop function if exists public.marketplace_buyer_order_get_v2(p_order_id uuid);
drop function if exists public.marketplace_buyer_orders_v2(p_search text, p_period text, p_status text, p_limit integer, p_offset integer);
drop function if exists public.marketplace_buyer_phone_status();
drop function if exists public.marketplace_buyer_receipt_resubmit_confirm(p_proof_id uuid);
drop function if exists public.marketplace_buyer_receipt_resubmit_request_upload(p_order_id uuid, p_content_type text);
drop function if exists public.marketplace_buyer_refund_confirm(p_return_id uuid);
drop function if exists public.marketplace_buyer_return_cancel(p_return_id uuid);
drop function if exists public.marketplace_buyer_return_create(p_order_id uuid, p_kind text, p_lines jsonb, p_reason_preset_id uuid, p_note text, p_evidence_ids uuid[], p_remedy text, p_idempotency_key text);
drop function if exists public.marketplace_buyer_return_eligibility(p_order_id uuid);
drop function if exists public.marketplace_buyer_return_evidence_confirm(p_evidence_id uuid);
drop function if exists public.marketplace_buyer_return_evidence_remove(p_evidence_id uuid);
drop function if exists public.marketplace_buyer_return_get(p_return_id uuid);
drop function if exists public.marketplace_buyer_return_mark_shipped(p_return_id uuid, p_tracking text);
drop function if exists public.marketplace_buyer_return_request_upload(p_order_id uuid, p_content_type text);
drop function if exists public.marketplace_buyer_returns(p_limit integer, p_offset integer);
drop function if exists public.marketplace_cart_get();
drop function if exists public.marketplace_cart_merge(p_merge_key uuid, p_lines jsonb);
drop function if exists public.marketplace_cart_own_sellers();
drop function if exists public.marketplace_cart_replace(p_lines jsonb);
drop function if exists public.marketplace_checkout_confirm(p_session_id uuid, p_quote_hash text, p_idempotency_key text, p_buyer_note text);
drop function if exists public.marketplace_checkout_prepare(p_lines jsonb, p_fulfilment text, p_address_id uuid, p_delivery_speed text, p_payment_method text, p_session_id uuid);
drop function if exists public.marketplace_checkout_receipt_confirm(p_proof_id uuid);
drop function if exists public.marketplace_checkout_receipt_remove(p_proof_id uuid);
drop function if exists public.marketplace_checkout_receipt_request_upload(p_session_id uuid, p_content_type text);
drop function if exists public.marketplace_checkout_sessions_purge(p_retention interval, p_limit integer);
drop function if exists public.marketplace_order_invoice_get(p_order_id uuid);
drop function if exists public.marketplace_order_reason_presets(p_action text);
drop function if exists public.marketplace_order_waybill_get(p_order_id uuid);
drop function if exists public.marketplace_payment_complaint_file(p_order_id uuid, p_reason text, p_note text);
drop function if exists public.marketplace_return_complaint_file(p_return_id uuid, p_note text);
drop function if exists public.marketplace_seller_cancel_refund_record(p_order_id uuid, p_note text);
drop function if exists public.marketplace_seller_exchange_fulfil(p_return_id uuid, p_note text);
drop function if exists public.marketplace_seller_order_action(p_order_id uuid, p_action text, p_payload jsonb);
drop function if exists public.marketplace_seller_order_get_v2(p_order_id uuid);
drop function if exists public.marketplace_seller_order_shipment_update(p_order_id uuid, p_carrier_name text, p_tracking_number text);
drop function if exists public.marketplace_seller_orders_page_v2(p_organization_id uuid, p_tab text, p_search text, p_from date, p_to date, p_limit integer, p_offset integer);
drop function if exists public.marketplace_seller_product_returnability_set(p_organization_id uuid, p_product_id uuid, p_non_returnable boolean);
drop function if exists public.marketplace_seller_refund_record(p_return_id uuid, p_amount_egp numeric, p_reference_note text);
drop function if exists public.marketplace_seller_return_decide(p_return_id uuid, p_decision text, p_preset_id uuid, p_message_ar text, p_message_en text, p_partial_refund_egp numeric);
drop function if exists public.marketplace_seller_return_get(p_return_id uuid);
drop function if exists public.marketplace_seller_return_receive(p_return_id uuid, p_sellable jsonb);
drop function if exists public.marketplace_seller_return_settings_get(p_organization_id uuid);
drop function if exists public.marketplace_seller_return_settings_save(p_organization_id uuid, p_settings jsonb);
drop function if exists public.marketplace_seller_returns_page(p_organization_id uuid, p_state text, p_limit integer, p_offset integer);
drop function if exists public.marketplace_timers_run(p_limit integer, p_now timestamp with time zone);
drop function if exists public.media_upload_abandon(p_namespace text, p_key text);
drop function if exists public.my_upload_exempt(p_namespace text, p_key text);

commit;
