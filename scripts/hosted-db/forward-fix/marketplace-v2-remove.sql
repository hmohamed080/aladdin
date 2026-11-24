-- Forward-fix "marketplace-v2": remove what 20261123090001, 100001, 120001, 130001, 150001, 160001 and 160002 added and restore what they re-created.
-- NOT a down migration and NOT applied anywhere. Use only with the owner's explicit approval, on a hosted database, through the Supabase migration path
-- as a NEW migration (never the SQL Editor), and only if the plan "marketplace-v2" must be undone. Roll the Worker (the application) back to the version before
-- these migrations first: the previous application never calls any of this, the new application calls all of it.
--
-- Provenance: generated from a measured catalog diff (catalog-fingerprint.sql; pre = a clean replay of the 237 migrations Acceptance has, post = pre + the 7). The previous
-- definitions below are the exact pg_get_functiondef / pg_get_constraintdef output of that pre-state. Proof: scripts/hosted-db/marketplace-v2-scratch-proof.mjs (throwaway
-- database) reports pre -> post = exactly the plan's "changed" list, and pre -> after this file = no catalog difference except the enum value (below).
--
-- Removes 6 tables (marketplace_free_shipping_products, marketplace_seller_delivery_settings, marketplace_seller_message_presets, marketplace_seller_preset_events, marketplace_seller_settings_events, marketplace_video_events), 24 columns, 13 constraints and 9 indexes on existing tables, 2 triggers,
-- 52 added functions and the seeded rows (2 notification templates, 1 permission with its Super Admin grant; the 15 owner-message presets go with their table),
-- and restores 28 functions and 7 constraints (plus the NOT NULL of marketplace_seller_account_events.reason) to their pre-plan definitions.
-- Safe from a partly applied plan (each migration commits separately): the guards inspect only what exists and every drop is IF EXISTS.
-- DATA GUARD: refuses (RAISE) as soon as any seller rejection, owner message, preset edit, delivery or payment setting, free-shipping choice, replacement image, product video,
-- stock threshold, Marketplace close or stock notification exists; it never deletes user data. Rows written after the push are recoverable ONLY from the restore-tested backup.
-- NOT undone, because it cannot be: (1) the enum value public.media_video_scope 'marketplace' (PostgreSQL cannot drop an enum value; it is inert once the columns and
-- constraint are gone). (2) marketplace_platform_settings.media_verification_ready was set to true by 20261123100001 and is left as is: read its previous value from
-- Acceptance before the apply (smoke script, "before" run); if it must be false again the owner sets it. (3) Run-time side effects of the new functions (for example
-- products set to 'unpublished' by the publication gate) are data; only the backup restores them.
begin;

create or replace function pg_temp.mv2_guard(p_what text, p_sql text) returns void language plpgsql as $g$
declare n bigint;
begin
  begin execute p_sql into n;
  exception when undefined_table or undefined_column then return; end;  -- the object is not there (partly applied plan): nothing to protect
  if n <> 0 then raise exception 'marketplace-v2 forward-fix refused: % (% row(s)); the data would be lost', p_what, n; end if;
end $g$;

-- the seeded tables must equal their migration seed and every table that only the application fills must be empty
select pg_temp.mv2_guard('owner-message presets were edited (preset events exist)', $q$select count(*) from public.marketplace_seller_preset_events$q$);
select pg_temp.mv2_guard('owner-message presets differ from the seed of 15', $q$select abs(count(*) - 15) from public.marketplace_seller_message_presets$q$);
select pg_temp.mv2_guard('marketplace_seller_delivery_settings holds data', $q$select count(*) from public.marketplace_seller_delivery_settings$q$);
select pg_temp.mv2_guard('marketplace_free_shipping_products holds data', $q$select count(*) from public.marketplace_free_shipping_products$q$);
select pg_temp.mv2_guard('marketplace_seller_settings_events holds data', $q$select count(*) from public.marketplace_seller_settings_events$q$);
select pg_temp.mv2_guard('marketplace_video_events holds data', $q$select count(*) from public.marketplace_video_events$q$);
select pg_temp.mv2_guard('a seller was rejected or holds an owner message', $q$select count(*) from public.marketplace_seller_accounts where status = 'rejected' or rejected_at is not null or rejected_by is not null or owner_message_ar is not null or owner_message_en is not null$q$);
select pg_temp.mv2_guard('a seller event is new-style (owner message, preset, no reason or a new action)', $q$select count(*) from public.marketplace_seller_account_events where owner_message_ar is not null or owner_message_en is not null or preset_id is not null or reason is null or action not in ('requested', 'approved', 'suspended', 'revoked', 'reinstated')$q$);
select pg_temp.mv2_guard('an image moderation event uses a new action', $q$select count(*) from public.marketplace_image_moderation_events where action not in ('validated', 'approved', 'rejected')$q$);
select pg_temp.mv2_guard('the Marketplace was opened or closed (platform events)', $q$select count(*) from public.marketplace_platform_events where action not in ('media_verification_enabled', 'media_verification_disabled')$q$);
select pg_temp.mv2_guard('the Marketplace is closed', $q$select count(*) from public.marketplace_platform_settings where not marketplace_open$q$);
select pg_temp.mv2_guard('a product has a custom low-stock threshold', $q$select count(*) from public.marketplace_products where low_stock_threshold <> 5$q$);
select pg_temp.mv2_guard('a replacement image exists', $q$select count(*) from public.marketplace_product_images where replaces_image_id is not null$q$);
select pg_temp.mv2_guard('a delivery rate holds duration, next-day or free-shipping settings', $q$select count(*) from public.marketplace_delivery_rates where duration_min_days is not null or duration_max_days is not null or next_day_available or next_day_fee_egp is not null or free_shipping_min_egp is not null$q$);
select pg_temp.mv2_guard('a seller enabled InstaPay full payment', $q$select count(*) from public.marketplace_seller_payment_settings where instapay_full_enabled$q$);
select pg_temp.mv2_guard('a Marketplace product video exists', $q$select count(*) from public.media_videos where scope::text = 'marketplace' or marketplace_product_id is not null or seller_organization_id is not null or review_status is not null or reviewed_at is not null or reviewed_by is not null or review_reason is not null or review_message_ar is not null or review_message_en is not null$q$);
select pg_temp.mv2_guard('a stock notification was sent', $q$select count(*) from public.notifications where event_type in ('marketplace.stock.low', 'marketplace.stock.out')$q$);
select pg_temp.mv2_guard('a stock notification template was edited', $q$select count(*) from public.notification_templates where key in ('marketplace.stock.low', 'marketplace.stock.out') and (title_ar is not null or body_ar is not null or title_en is not null or body_en is not null)$q$);
select pg_temp.mv2_guard('the template history holds a stock template event', $q$select count(*) from public.notification_template_events where template_key in ('marketplace.stock.low', 'marketplace.stock.out')$q$);
select pg_temp.mv2_guard('another role holds marketplace_platform.manage', $q$select count(*) from public.admin_role_permissions where permission_key = 'marketplace_platform.manage' and role_id not in (select id from public.admin_roles where is_system and key = 'super_admin')$q$);

-- 1. triggers, constraints and indexes on existing tables that the plan added
drop trigger if exists marketplace_stock_notify on public.marketplace_inventory_levels;
drop trigger if exists marketplace_seller_unpublish_all on public.marketplace_seller_accounts;
alter table public.media_videos drop constraint if exists ck_media_videos_review;
alter table public.media_videos drop constraint if exists ck_media_videos_review_text;
alter table public.media_videos drop constraint if exists media_videos_reviewed_by_fkey;
alter table public.marketplace_delivery_rates drop constraint if exists ck_mp_delivery_rates_free;
alter table public.media_videos drop constraint if exists media_videos_seller_organization_id_fkey;
alter table public.marketplace_products drop constraint if exists ck_marketplace_products_low_stock;
alter table public.marketplace_delivery_rates drop constraint if exists ck_mp_delivery_rates_duration;
alter table public.marketplace_delivery_rates drop constraint if exists ck_mp_delivery_rates_next_day;
alter table public.marketplace_seller_payment_settings drop constraint if exists ck_mp_pay_full_complete;
alter table public.marketplace_seller_accounts drop constraint if exists ck_marketplace_sellers_owner_message;
alter table public.marketplace_product_images drop constraint if exists marketplace_product_images_replaces_image_id_fkey;
alter table public.marketplace_seller_account_events drop constraint if exists ck_marketplace_seller_events_owner_message;
alter table public.marketplace_seller_account_events drop constraint if exists ck_marketplace_seller_events_reason_required;
drop index if exists public.ix_media_videos_reviewed_by;
drop index if exists public.ix_mp_settings_events_seller;
drop index if exists public.ix_marketplace_images_replaces;
drop index if exists public.uq_media_videos_marketplace_slot;
drop index if exists public.ix_media_videos_marketplace_review;
drop index if exists public.ix_media_videos_marketplace_seller;
drop index if exists public.ix_media_videos_marketplace_product;
drop index if exists public.ix_mp_free_shipping_products_seller;
drop index if exists public.ux_marketplace_images_one_open_replacement;

-- 2. columns on existing tables
alter table public.media_videos drop column if exists reviewed_at, drop column if exists reviewed_by, drop column if exists review_reason, drop column if exists review_status, drop column if exists review_message_ar, drop column if exists review_message_en, drop column if exists marketplace_product_id, drop column if exists seller_organization_id;
alter table public.marketplace_seller_accounts drop column if exists rejected_at, drop column if exists rejected_by, drop column if exists owner_message_ar, drop column if exists owner_message_en;
alter table public.marketplace_products drop column if exists low_stock_threshold;
alter table public.marketplace_delivery_rates drop column if exists next_day_fee_egp, drop column if exists duration_max_days, drop column if exists duration_min_days, drop column if exists next_day_available, drop column if exists free_shipping_min_egp;
alter table public.marketplace_seller_account_events drop column if exists preset_id, drop column if exists owner_message_ar, drop column if exists owner_message_en;
alter table public.marketplace_product_images drop column if exists replaces_image_id;
alter table public.marketplace_platform_settings drop column if exists marketplace_open;
alter table public.marketplace_seller_payment_settings drop column if exists instapay_full_enabled;

-- 3. new tables (their policies, triggers, indexes and sequences go with them)
drop table if exists public.marketplace_free_shipping_products cascade;
drop table if exists public.marketplace_seller_delivery_settings cascade;
drop table if exists public.marketplace_seller_message_presets cascade;
drop table if exists public.marketplace_seller_preset_events cascade;
drop table if exists public.marketplace_seller_settings_events cascade;
drop table if exists public.marketplace_video_events cascade;

-- 4. rows the migrations seeded into existing tables
delete from public.notification_templates where key in ('marketplace.stock.low', 'marketplace.stock.out');
-- locked core permissions refuse direct deletes (app.admin_role_permissions_guard); the guard is paused only for this statement, inside the transaction.
alter table public.admin_role_permissions disable trigger trg_admin_role_permissions_guard;
delete from public.admin_role_permissions where permission_key = 'marketplace_platform.manage';
alter table public.admin_role_permissions enable trigger trg_admin_role_permissions_guard;
delete from public.admin_permissions where key = 'marketplace_platform.manage';

-- 5. restore the constraints that were re-created (definitions read from the pre-plan state)
alter table public.media_videos drop constraint if exists ck_media_videos_scope;
alter table public.media_videos add constraint ck_media_videos_scope CHECK ((((scope = 'portfolio'::media_video_scope) AND (product_id IS NULL) AND (publisher_id IS NULL) AND (sort_order IS NOT NULL) AND (slot IS NULL)) OR ((scope = 'product'::media_video_scope) AND (product_id IS NOT NULL) AND (publisher_id IS NOT NULL) AND (visibility = 'private'::portfolio_visibility) AND (sort_order IS NULL) AND ((slot >= 1) AND (slot <= 6)))));
alter table public.notifications drop constraint if exists ck_notifications_event_type_known;
alter table public.notifications add constraint ck_notifications_event_type_known CHECK ((event_type = ANY (ARRAY['rfq.submitted'::text, 'rfq.cancelled'::text, 'quotation.submitted'::text, 'quotation.accepted'::text, 'quotation.rejected'::text, 'order.created'::text, 'order.started'::text, 'order.completed'::text, 'order.cancelled'::text, 'project.created'::text, 'project.activated'::text, 'project.completed'::text, 'verification.approved'::text, 'verification.rejected'::text, 'verification.changes_requested'::text, 'message.sent'::text, 'job.application.accepted'::text, 'job.application.rejected'::text, 'job.assignment.ready'::text, 'job.assignment.completed'::text, 'job.assignment.cancelled'::text, 'job.review.received'::text, 'whatsapp_otp.audit_unmatched'::text, 'whatsapp_otp.budget_critical'::text, 'whatsapp_otp.budget_exhausted'::text, 'whatsapp_otp.budget_warning'::text, 'whatsapp_otp.failure_rate'::text, 'whatsapp_otp.delivery_unmatched'::text, 'marketplace.seller.approved'::text, 'marketplace.seller.rejected'::text, 'marketplace.seller.suspended'::text, 'marketplace.seller.reinstated'::text, 'marketplace.seller.revoked'::text, 'marketplace.product.rejected'::text])));
alter table public.marketplace_seller_accounts drop constraint if exists ck_marketplace_sellers_status;
alter table public.marketplace_seller_accounts add constraint ck_marketplace_sellers_status CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'suspended'::text, 'revoked'::text])));
alter table public.marketplace_platform_events drop constraint if exists ck_marketplace_platform_action;
alter table public.marketplace_platform_events add constraint ck_marketplace_platform_action CHECK ((action = ANY (ARRAY['media_verification_enabled'::text, 'media_verification_disabled'::text])));
alter table public.marketplace_image_moderation_events drop constraint if exists ck_marketplace_moderation_action;
alter table public.marketplace_image_moderation_events add constraint ck_marketplace_moderation_action CHECK ((action = ANY (ARRAY['validated'::text, 'approved'::text, 'rejected'::text])));
alter table public.marketplace_seller_account_events drop constraint if exists ck_marketplace_seller_events_action;
alter table public.marketplace_seller_account_events add constraint ck_marketplace_seller_events_action CHECK ((action = ANY (ARRAY['requested'::text, 'approved'::text, 'suspended'::text, 'revoked'::text, 'reinstated'::text])));
alter table public.marketplace_seller_account_events drop constraint if exists ck_marketplace_seller_events_reason;
alter table public.marketplace_seller_account_events add constraint ck_marketplace_seller_events_reason CHECK (((char_length(btrim(reason)) >= 3) AND (char_length(btrim(reason)) <= 500)));
alter table public.marketplace_seller_account_events alter column reason set not null;

-- 6. restore the 28 functions the plan replaced (CREATE OR REPLACE keeps their grants; the plan changed no existing function's grants)
-- app.video_writable(p_id uuid)
CREATE OR REPLACE FUNCTION app.video_writable(p_id uuid)
 RETURNS media_videos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.media_videos; v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not app.account_is_active(v_uid) then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into v from public.media_videos where id = p_id and state <> 'deleted' for update;
  if not found or not (case v.scope when 'portfolio' then v.owner_user_id = v_uid
      else app.can_write_publisher(v.publisher_id) end) then
    raise exception 'video not found' using errcode = '42501';
  end if;
  return v;
end;
$function$;

-- app.media_videos_enforce_cap()
CREATE OR REPLACE FUNCTION app.media_videos_enforce_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_limit bigint := coalesce(app.media_limit_bytes('video', new.scope::text), 0);
begin
  if new.declared_bytes > v_limit then
    raise exception 'video is larger than the limit for this place' using errcode = '22023';
  end if;
  return new;
end;
$function$;

-- public.video_delete(p_id uuid)
CREATE OR REPLACE FUNCTION public.video_delete(p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.media_videos;
begin
  v := app.video_writable(p_id);
  update public.media_videos
     set state = 'deleted', visibility = 'private', deleted_at = now(), lease_until = null
   where id = p_id;
  return case when v.state = 'uploading' then v.upload_id end;
end;
$function$;

-- app.marketplace_product_guard()
CREATE OR REPLACE FUNCTION app.marketplace_product_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_type    text;
  v_deleted timestamptz;
begin
  if tg_op = 'UPDATE' then
    if new.seller_organization_id is distinct from old.seller_organization_id
       or new.product_type_id is distinct from old.product_type_id then
      raise exception 'marketplace product seller and product type are immutable' using errcode = '23514';
    end if;
  else
    select o.org_type::text, o.deleted_at into v_type, v_deleted
    from public.organizations o where o.id = new.seller_organization_id;
    if v_type is distinct from 'showroom_dealer' or v_deleted is not null then
      raise exception 'a marketplace seller must be a live showroom organization' using errcode = '23514';
    end if;
  end if;

  -- Publication is only ever granted through the blockers function (fail closed).
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    if tg_op = 'INSERT' then
      -- a brand-new row has no values yet, so it can never satisfy publication
      raise exception 'a marketplace product cannot be created as published'
        using errcode = '23514', hint = 'Create it as draft; publication is gated.';
    end if;
    if cardinality(app.marketplace_publication_blockers(new.id)) > 0 then
      raise exception 'marketplace publication is blocked: %',
        array_to_string(app.marketplace_publication_blockers(new.id), ', ')
        using errcode = '23514';
    end if;
    new.published_at := coalesce(new.published_at, now());
  end if;
  return new;
end;
$function$;

-- app.marketplace_media_verification_ready()
CREATE OR REPLACE FUNCTION app.marketplace_media_verification_ready()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce((select s.media_verification_ready from public.marketplace_platform_settings s where s.singleton), false);
$function$;

-- public.video_update(p_id uuid, p_title text)
CREATE OR REPLACE FUNCTION public.video_update(p_id uuid, p_title text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.video_writable(p_id);
  update public.media_videos set title = btrim(p_title) where id = p_id;
end;
$function$;

-- public.marketplace_public_facets(p_type text)
CREATE OR REPLACE FUNCTION public.marketplace_public_facets(p_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with visible as (
    select p.id, t.id as type_id, t.key as type_key
    from public.marketplace_products p
    join public.marketplace_product_types t on t.id = p.product_type_id and t.is_active
    join public.marketplace_categories c on c.id = t.category_id and c.is_active
    where p.status = 'published'
      and app.marketplace_seller_is_enabled(p.seller_organization_id)
      and exists (select 1 from public.marketplace_product_variants v where v.product_id = p.id and v.status = 'active')
  ),
  scoped as (
    select * from visible where coalesce(p_type, '') = '' or type_key = p_type
  ),
  -- (product, attribute, option) triples from product AND active-variant values
  vals as (
    select s.id as product_id, av.attribute_id, av.option_id
    from scoped s join public.marketplace_product_attribute_values av on av.product_id = s.id
    where av.option_id is not null
    union
    select s.id, vv.attribute_id, vv.option_id
    from scoped s
    join public.marketplace_product_variants v on v.product_id = s.id and v.status = 'active'
    join public.marketplace_variant_attribute_values vv on vv.variant_id = v.id
    where vv.option_id is not null
  ),
  filter_attrs as (
    select d.id, d.key, coalesce(ta.name_ar_override, d.name_ar) as name_ar, coalesce(ta.name_en_override, d.name_en) as name_en,
           ta.sort_order
    from public.marketplace_product_types t
    join public.marketplace_product_type_attributes ta on ta.product_type_id = t.id and ta.is_active and ta.is_filterable
    join public.marketplace_attribute_definitions d on d.id = ta.attribute_id and d.is_active
      and d.data_type in ('option', 'multi_option')
    where coalesce(p_type, '') <> '' and t.key = p_type and t.is_active
    union all
    select d.id, d.key, d.name_ar, d.name_en, 0
    from public.marketplace_attribute_definitions d
    where coalesce(p_type, '') = '' and d.key = 'color' and d.is_active
  )
  select jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', c.key, 'name_ar', c.name_ar, 'name_en', c.name_en,
               'count', (select count(*) from visible vi join public.marketplace_product_types t2 on t2.id = vi.type_id where t2.category_id = c.id),
               'types', coalesce((select jsonb_agg(jsonb_build_object('key', t2.key, 'name_ar', t2.name_ar, 'name_en', t2.name_en,
                                                                     'count', (select count(*) from visible vi where vi.type_id = t2.id))
                                                  order by t2.sort_order)
                                  from public.marketplace_product_types t2 where t2.category_id = c.id and t2.is_active), '[]'::jsonb))
             order by c.sort_order)
      from public.marketplace_categories c
      where c.is_active and exists (select 1 from public.marketplace_product_types t where t.category_id = c.id and t.is_active)), '[]'::jsonb),
    'price', (select jsonb_build_object('min', min(v.price_egp), 'max', max(v.price_egp))
              from scoped s join public.marketplace_product_variants v on v.product_id = s.id and v.status = 'active'),
    'filters', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', fa.key, 'name_ar', fa.name_ar, 'name_en', fa.name_en,
               'options', (select jsonb_agg(jsonb_build_object('key', op.key, 'name_ar', op.name_ar, 'name_en', op.name_en,
                                                               'swatch_hex', op.swatch_hex, 'count', n.cnt)
                                            order by op.sort_order, op.key)
                           from (select vals.option_id, count(distinct vals.product_id) as cnt from vals
                                 where vals.attribute_id = fa.id group by vals.option_id) n
                           join public.marketplace_attribute_options op on op.id = n.option_id and op.is_active))
             order by fa.sort_order, fa.key)
      from filter_attrs fa
      where exists (select 1 from vals where vals.attribute_id = fa.id)), '[]'::jsonb));
$function$;

-- public.marketplace_public_product(p_slug text)
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
  v_seller text;
  v_media  boolean := app.marketplace_media_verification_ready();
  v_result jsonb;
begin
  select p.* into v_p
  from public.marketplace_products p
  join public.marketplace_product_types tt on tt.id = p.product_type_id and tt.is_active
  join public.marketplace_categories cc on cc.id = tt.category_id and cc.is_active
  where p.slug = p_slug and p.status = 'published'
    and app.marketplace_seller_is_enabled(p.seller_organization_id);
  if not found then
    return null;
  end if;
  select * into t from public.marketplace_product_types where id = v_p.product_type_id;
  select * into c from public.marketplace_categories where id = t.category_id;
  select o.name into v_seller from public.organizations o where o.id = v_p.seller_organization_id;

  select jsonb_build_object(
    'slug', v_p.slug,
    'name_ar', v_p.name_ar, 'name_en', v_p.name_en,
    'description_ar', v_p.description_ar, 'description_en', v_p.description_en,
    'brand', v_p.brand,
    'product_type_key', t.key, 'product_type_name_ar', t.name_ar, 'product_type_name_en', t.name_en,
    'category_key', c.key, 'category_name_ar', c.name_ar, 'category_name_en', c.name_en,
    'seller_name', v_seller,
    'published_at', v_p.published_at,
    'cover_image_id', case when v_media then app.marketplace_product_cover_image(v_p.id) end,
    'attributes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', d.key, 'name_ar', d.name_ar, 'name_en', d.name_en, 'data_type', av.data_type, 'unit_kind', d.unit_kind,
               'unit_ar', d.display_unit_ar, 'unit_en', d.display_unit_en,
               'value', case
                 when av.option_id is not null then jsonb_build_object('key', o.key, 'name_ar', o.name_ar, 'name_en', o.name_en, 'swatch_hex', o.swatch_hex)
                 when av.value_number is not null then to_jsonb(av.value_number)
                 when av.value_boolean is not null then to_jsonb(av.value_boolean)
                 else to_jsonb(av.value_text) end)
             order by d.key)
      from public.marketplace_product_attribute_values av
      join public.marketplace_attribute_definitions d on d.id = av.attribute_id and d.is_active
      left join public.marketplace_attribute_options o on o.id = av.option_id
      where av.product_id = v_p.id), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sku', pv.sku, 'selling_unit', pv.selling_unit, 'price_egp', pv.price_egp,
               'purchasable', app.marketplace_variant_available(pv.id) > 0,
               'attributes', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'key', d.key, 'name_ar', d.name_ar, 'name_en', d.name_en, 'data_type', vv.data_type, 'unit_kind', d.unit_kind,
                          'unit_ar', d.display_unit_ar, 'unit_en', d.display_unit_en,
                          'value', case
                            when vv.option_id is not null then jsonb_build_object('key', o.key, 'name_ar', o.name_ar, 'name_en', o.name_en, 'swatch_hex', o.swatch_hex)
                            when vv.value_number is not null then to_jsonb(vv.value_number)
                            when vv.value_boolean is not null then to_jsonb(vv.value_boolean)
                            else to_jsonb(vv.value_text) end)
                        order by d.key)
                 from public.marketplace_variant_attribute_values vv
                 join public.marketplace_attribute_definitions d on d.id = vv.attribute_id and d.is_active
                 left join public.marketplace_attribute_options o on o.id = vv.option_id
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

-- app.marketplace_public_image_key(p_image_id uuid)
CREATE OR REPLACE FUNCTION app.marketplace_public_image_key(p_image_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select i.object_key
  from public.marketplace_product_images i
  join public.marketplace_products p on p.id = i.product_id
  join public.marketplace_product_types t on t.id = p.product_type_id and t.is_active
  join public.marketplace_categories c on c.id = t.category_id and c.is_active
  left join public.marketplace_product_variants v on v.id = i.variant_id
  where i.id = p_image_id
    and app.marketplace_media_verification_ready()
    and i.status = 'verified' and i.upload_state = 'confirmed' and i.content_valid is true
    and (i.variant_id is null or v.status = 'active')
    and p.status = 'published'
    and app.marketplace_seller_is_enabled(p.seller_organization_id);
$function$;

-- app.marketplace_publication_blockers(p_product_id uuid)
CREATE OR REPLACE FUNCTION app.marketplace_publication_blockers(p_product_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_blockers text[] := '{}';
  v_type_id  uuid;
  v_seller   uuid;
  v_count    integer;
  r          record;
begin
  select p.product_type_id, p.seller_organization_id into v_type_id, v_seller
  from public.marketplace_products p where p.id = p_product_id;
  if v_type_id is null then
    return array['product_not_found'];
  end if;

  -- seller: still an eligible live Showroom, AND explicitly approved
  if not app.marketplace_seller_is_eligible(v_seller) then
    v_blockers := array_append(v_blockers, 'seller_organization_not_eligible'::text);
  end if;
  if not exists (select 1 from public.marketplace_seller_accounts a where a.organization_id = v_seller and a.status = 'approved') then
    v_blockers := array_append(v_blockers, 'seller_not_approved'::text);
  end if;

  -- the product type itself must still be offered
  if not exists (select 1 from public.marketplace_product_types t
                 join public.marketplace_categories c on c.id = t.category_id
                 where t.id = v_type_id and t.is_active and c.is_active) then
    v_blockers := array_append(v_blockers, 'product_type_inactive'::text);
  end if;

  for r in
    select d.key
    from public.marketplace_product_type_attributes a
    join public.marketplace_attribute_definitions d on d.id = a.attribute_id
    where a.product_type_id = v_type_id and a.level = 'product' and a.is_required and a.is_active and d.is_active
      and not exists (select 1 from public.marketplace_product_attribute_values v
                      where v.product_id = p_product_id and v.attribute_id = a.attribute_id)
    order by a.sort_order
  loop
    v_blockers := v_blockers || ('missing_product_attribute:' || r.key);
  end loop;

  select count(*) into v_count from public.marketplace_product_variants
   where product_id = p_product_id and status = 'active';
  if v_count = 0 then
    v_blockers := array_append(v_blockers, 'no_active_variant'::text);
  end if;

  for r in
    select pv.sku, d.key
    from public.marketplace_product_variants pv
    cross join public.marketplace_product_type_attributes a
    join public.marketplace_attribute_definitions d on d.id = a.attribute_id
    where pv.product_id = p_product_id and pv.status = 'active'
      and a.product_type_id = v_type_id and a.level = 'variant' and a.is_required and a.is_active and d.is_active
      and not exists (select 1 from public.marketplace_variant_attribute_values v
                      where v.variant_id = pv.id and v.attribute_id = a.attribute_id)
    order by pv.sku, a.sort_order
  loop
    v_blockers := v_blockers || ('missing_variant_attribute:' || r.sku || ':' || r.key);
  end loop;

  if v_count > 1 and exists (
       select 1 from public.marketplace_product_variants
       where product_id = p_product_id and status = 'active' and option_signature is null) then
    v_blockers := array_append(v_blockers, 'variant_without_option_combination'::text);
  end if;

  -- an active variant must have a usable price (the CHECK already forbids <= 0;
  -- this guards a future relaxation of that constraint)
  if exists (select 1 from public.marketplace_product_variants
             where product_id = p_product_id and status = 'active' and (price_egp is null or price_egp <= 0)) then
    v_blockers := array_append(v_blockers, 'invalid_variant_price'::text);
  end if;

  -- stock: some active variant is sellable now, at an active location
  if v_count > 0 and not exists (
       select 1 from public.marketplace_product_variants pv
       where pv.product_id = p_product_id and pv.status = 'active'
         and app.marketplace_variant_available(pv.id) > 0) then
    v_blockers := array_append(v_blockers, 'no_available_stock'::text);
  end if;

  -- media: a verified primary image AND a verification / delivery pipeline.
  if not app.marketplace_product_has_publishable_image(p_product_id) then
    v_blockers := array_append(v_blockers, 'no_verified_primary_image'::text);
  end if;
  if not app.marketplace_media_verification_ready() then
    v_blockers := array_append(v_blockers, 'media_verification_not_available'::text);
  end if;

  return v_blockers;
end;
$function$;

-- public.marketplace_seller_product_save(p_payload jsonb)
CREATE OR REPLACE FUNCTION public.marketplace_seller_product_save(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid      uuid;
  v_id       uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_org      uuid;
  v_type_id  uuid;
  v_status   text;
  v_name_ar  text := nullif(btrim(p_payload ->> 'name_ar'), '');
  v_name_en  text := nullif(btrim(p_payload ->> 'name_en'), '');
  v_desc_ar  text := nullif(btrim(p_payload ->> 'description_ar'), '');
  v_desc_en  text := nullif(btrim(p_payload ->> 'description_en'), '');
  v_brand    text := nullif(btrim(p_payload ->> 'brand'), '');
  v_ref      text := nullif(btrim(p_payload ->> 'external_ref'), '');
  v_slug     text := nullif(lower(btrim(p_payload ->> 'slug')), '');
  v_variants jsonb := coalesce(p_payload -> 'variants', '[]'::jsonb);
  e          jsonb;
  v_vid      uuid;
  v_sku      text;
  v_unit     text;
  v_price    numeric;
  v_vstatus  text;
  v_keep     uuid[] := '{}';
  v_constraint text;
  v_msg      text;
  v_blockers text[];
  v_created  boolean := false;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;

  -- ownership: an existing product decides its own organization; a payload
  -- organization id is only consulted on create.
  if v_id is not null then
    select seller_organization_id, product_type_id, status into v_org, v_type_id, v_status
    from public.marketplace_products where id = v_id for update;
    if v_org is null then
      raise exception 'mp:not_found' using errcode = '42501';
    end if;
    if v_status = 'archived' then
      raise exception 'mp:archived' using errcode = '23514';
    end if;
  else
    v_org := nullif(p_payload ->> 'organization_id', '')::uuid;
  end if;
  v_uid := app.marketplace_assert_seller_writer(v_org);

  -- product type: chosen on create, immutable afterwards
  if v_id is null then
    select t.id into v_type_id
    from public.marketplace_product_types t join public.marketplace_categories c on c.id = t.category_id
    where t.key = p_payload ->> 'product_type_key' and t.is_active and c.is_active;
    if v_type_id is null then
      raise exception 'mp:product_type_invalid' using errcode = '22023';
    end if;
  elsif p_payload ? 'product_type_key' and nullif(p_payload ->> 'product_type_key', '') is not null
        and not exists (select 1 from public.marketplace_product_types t
                        where t.id = v_type_id and t.key = p_payload ->> 'product_type_key') then
    raise exception 'mp:product_type_immutable' using errcode = '23514';
  end if;

  -- basic fields (the table CHECKs are the backstop; these give precise reasons)
  if v_name_ar is null or char_length(v_name_ar) > 200 then
    raise exception 'mp:name_ar_invalid' using errcode = '22023';
  end if;
  if v_name_en is null or char_length(v_name_en) > 200 then
    raise exception 'mp:name_en_invalid' using errcode = '22023';
  end if;
  if char_length(coalesce(v_desc_ar, '')) > 5000 or char_length(coalesce(v_desc_en, '')) > 5000 then
    raise exception 'mp:description_too_long' using errcode = '22023';
  end if;
  if char_length(coalesce(v_brand, '')) > 80 then
    raise exception 'mp:brand_too_long' using errcode = '22023';
  end if;
  if char_length(coalesce(v_ref, '')) > 80 then
    raise exception 'mp:external_ref_too_long' using errcode = '22023';
  end if;
  if v_slug is not null and (char_length(v_slug) not between 3 and 120 or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$') then
    raise exception 'mp:slug_invalid' using errcode = '22023';
  end if;

  if jsonb_typeof(v_variants) <> 'array' or jsonb_array_length(v_variants) > 50 then
    raise exception 'mp:variants_invalid' using errcode = '22023';
  end if;
  -- the same SKU twice in one form
  if exists (select 1 from jsonb_array_elements(v_variants) x
             group by upper(btrim(x ->> 'sku')) having count(*) > 1) then
    raise exception 'mp:duplicate_sku_in_form' using errcode = '23505';
  end if;

  begin
    if v_id is null then
      v_id := gen_random_uuid();
      insert into public.marketplace_products
        (id, seller_organization_id, product_type_id, slug, name_ar, name_en, description_ar, description_en, brand, external_ref, status)
      values (v_id, v_org, v_type_id,
              coalesce(v_slug, app.marketplace_import_slug(v_name_en, v_org, coalesce(v_ref, v_id::text))),
              v_name_ar, v_name_en, v_desc_ar, v_desc_en, v_brand, v_ref, 'draft');
      v_created := true;
    else
      update public.marketplace_products set
        name_ar = v_name_ar, name_en = v_name_en, description_ar = v_desc_ar, description_en = v_desc_en,
        brand = v_brand, external_ref = v_ref, slug = coalesce(v_slug, slug)
      where id = v_id;
    end if;

    perform app.marketplace_seller_apply_attributes('product', v_id, v_type_id, p_payload -> 'attributes', 'product');

    for e in select * from jsonb_array_elements(v_variants) loop
      v_vid := nullif(e ->> 'id', '')::uuid;
      v_sku := nullif(btrim(e ->> 'sku'), '');
      v_unit := nullif(lower(btrim(e ->> 'selling_unit')), '');
      v_vstatus := coalesce(nullif(e ->> 'status', ''), 'active');
      if v_sku is null or char_length(v_sku) > 64 or v_sku !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$' then
        raise exception 'mp:sku_invalid:%', coalesce(v_sku, '') using errcode = '22023';
      end if;
      if v_unit is null or v_unit not in ('piece', 'roll', 'board', 'bar', 'linear_meter', 'square_meter', 'pack') then
        raise exception 'mp:selling_unit_invalid:%', v_sku using errcode = '22023';
      end if;
      if (e ->> 'price_egp') is null or (e ->> 'price_egp') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' then
        raise exception 'mp:price_invalid:%', v_sku using errcode = '22023';
      end if;
      v_price := (e ->> 'price_egp')::numeric;
      if v_price <= 0 then
        raise exception 'mp:price_invalid:%', v_sku using errcode = '22023';
      end if;
      if v_vstatus not in ('active', 'inactive') then
        raise exception 'mp:variant_status_invalid:%', v_sku using errcode = '22023';
      end if;

      if v_vid is null then
        -- a SKU already owned by ANOTHER product of the seller is a conflict
        if exists (select 1 from public.marketplace_product_variants
                   where seller_organization_id = v_org and sku = v_sku and product_id <> v_id) then
          raise exception 'mp:sku_taken:%', v_sku using errcode = '23505';
        end if;
        select id into v_vid from public.marketplace_product_variants where product_id = v_id and sku = v_sku;
        if v_vid is null then
          insert into public.marketplace_product_variants (product_id, seller_organization_id, sku, selling_unit, price_egp, status)
          values (v_id, v_org, v_sku, v_unit, v_price, v_vstatus)
          returning id into v_vid;
        end if;
      end if;
      if not exists (select 1 from public.marketplace_product_variants where id = v_vid and product_id = v_id) then
        raise exception 'mp:variant_not_found' using errcode = '42501';
      end if;
      update public.marketplace_product_variants
         set sku = v_sku, selling_unit = v_unit, price_egp = v_price, status = v_vstatus
       where id = v_vid;
      perform app.marketplace_seller_apply_attributes('variant', v_vid, v_type_id, e -> 'attributes', v_sku);
      v_keep := array_append(v_keep, v_vid);
    end loop;

    -- variants no longer in the form are deactivated, never deleted
    update public.marketplace_product_variants set status = 'inactive'
     where product_id = v_id and status = 'active' and not (id = any (v_keep));
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name, v_msg = message_text;
      -- our own precise conflicts (mp:sku_taken:..., mp:duplicate_sku_in_form) pass through unchanged
      if v_msg like 'mp:%' then
        raise exception '%', v_msg using errcode = '23505';
      end if;
      raise exception '%', case
        when v_constraint = 'ux_marketplace_products_slug' then 'mp:slug_taken'
        when v_constraint = 'ux_marketplace_products_seller_external_ref' then 'mp:external_ref_taken'
        when v_constraint = 'ux_marketplace_variants_seller_sku' then 'mp:sku_taken'
        when v_constraint = 'ux_marketplace_variants_product_signature' then 'mp:duplicate_variant_combination'
        else 'mp:duplicate' end using errcode = '23505';
  end;

  -- a published product edited into an unpublishable state leaves the shelf
  select status into v_status from public.marketplace_products where id = v_id;
  v_blockers := app.marketplace_publication_blockers(v_id);
  if v_status = 'published' and cardinality(v_blockers) > 0 then
    update public.marketplace_products set status = 'unpublished' where id = v_id;
    insert into public.marketplace_product_status_events (product_id, organization_id, action, from_status, to_status, actor_user_id)
    values (v_id, v_org, 'unpublished', 'published', 'unpublished', v_uid);
    v_status := 'unpublished';
  end if;

  return jsonb_build_object('id', v_id, 'created', v_created, 'status', v_status, 'blockers', to_jsonb(v_blockers),
    'variants', coalesce((select jsonb_agg(jsonb_build_object('id', pv.id, 'sku', pv.sku, 'status', pv.status) order by pv.created_at, pv.sku)
                         from public.marketplace_product_variants pv where pv.product_id = v_id), '[]'::jsonb));
end;
$function$;

-- public.admin_marketplace_media_approve(p_image_ids uuid[])
CREATE OR REPLACE FUNCTION public.admin_marketplace_media_approve(p_image_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid  uuid;
  v_id   uuid;
  i      public.marketplace_product_images;
  v_org  uuid;
  v_out  jsonb := '[]'::jsonb;
  v_res  text;
begin
  v_uid := app.marketplace_assert_admin_permission('marketplace_media.moderate');
  if p_image_ids is null or cardinality(p_image_ids) not between 1 and 100 then
    raise exception 'mp:images_invalid' using errcode = '22023';
  end if;
  foreach v_id in array p_image_ids loop
    select * into i from public.marketplace_product_images where id = v_id for update;
    if not found or i.upload_state <> 'confirmed' then
      v_res := 'not_found';
    elsif i.status <> 'pending' then
      v_res := 'not_pending';
    elsif i.content_valid is not true or i.content_checked_at is null or i.content_checked_at < now() - interval '15 minutes' then
      v_res := 'validation_required';
    else
      select seller_organization_id into v_org from public.marketplace_products where id = i.product_id;
      update public.marketplace_product_images
         set status = 'verified', moderated_at = now(), moderated_by = v_uid, moderation_reason = null
       where id = i.id;
      insert into public.marketplace_image_moderation_events (image_id, product_id, organization_id, action, detail, actor_user_id)
      values (i.id, i.product_id, v_org, 'approved', jsonb_build_object('format', i.content_format), v_uid);
      v_res := 'approved';
    end if;
    v_out := v_out || jsonb_build_object('id', v_id, 'result', v_res);
  end loop;
  return v_out;
end;
$function$;

-- public.marketplace_seller_delivery_get(p_organization_id uuid)
CREATE OR REPLACE FUNCTION public.marketplace_seller_delivery_get(p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.marketplace_assert_seller_reader(p_organization_id);
  return jsonb_build_object(
    'rates', coalesce((
      select jsonb_agg(jsonb_build_object('governorate_key', r.governorate_key, 'area_key', r.area_key, 'fee_egp', r.fee_egp)
                       order by r.governorate_key, (r.area_key is not null), r.area_key)
      from public.marketplace_delivery_rates r where r.seller_organization_id = p_organization_id), '[]'::jsonb),
    'pickup_available', exists (
      select 1 from public.marketplace_stock_locations l
      where l.organization_id = p_organization_id and l.is_active and l.supports_pickup));
end;
$function$;

-- public.marketplace_seller_payment_settings_get(p_organization_id uuid)
CREATE OR REPLACE FUNCTION public.marketplace_seller_payment_settings_get(p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.marketplace_seller_payment_settings;
begin
  perform app.marketplace_assert_seller_reader(p_organization_id);
  select * into s from public.marketplace_seller_payment_settings where seller_organization_id = p_organization_id;
  return jsonb_build_object(
    'cod_enabled', coalesce(s.cod_enabled, false),
    'instapay_enabled', coalesce(s.instapay_enabled, false),
    'instapay_address', s.instapay_address,
    'instapay_account_name', s.instapay_account_name,
    'instapay_deposit_percent', s.instapay_deposit_percent,
    'can_edit', app.has_capability(p_organization_id, 'org.manage'));
end;
$function$;

-- public.marketplace_seller_images_update(p_product_id uuid, p_images jsonb)
CREATE OR REPLACE FUNCTION public.marketplace_seller_images_update(p_product_id uuid, p_images jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid;
  e     jsonb;
  v_primaries integer;
begin
  select seller_organization_id into v_org from public.marketplace_products where id = p_product_id;
  if v_org is null then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  perform app.marketplace_assert_seller_writer(v_org);
  if p_images is null or jsonb_typeof(p_images) <> 'array' or jsonb_array_length(p_images) > 30 then
    raise exception 'mp:images_invalid' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_images) x
             where not exists (select 1 from public.marketplace_product_images i
                               where i.id = (x ->> 'id')::uuid and i.product_id = p_product_id)) then
    raise exception 'mp:image_not_found' using errcode = '42501';
  end if;
  if exists (select 1 from jsonb_array_elements(p_images) x
             join public.marketplace_product_images i on i.id = (x ->> 'id')::uuid
             where i.upload_state = 'deleting') then
    raise exception 'mp:image_removed' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(p_images) x
             where nullif(x ->> 'variant_id', '') is not null and not exists (
               select 1 from public.marketplace_product_variants v
               where v.id = (x ->> 'variant_id')::uuid and v.product_id = p_product_id)) then
    raise exception 'mp:variant_not_found' using errcode = '42501';
  end if;
  select count(*) into v_primaries from jsonb_array_elements(p_images) x
   where coalesce((x ->> 'is_primary')::boolean, false) and nullif(x ->> 'variant_id', '') is null;
  if v_primaries > 1 then
    raise exception 'mp:one_primary_image' using errcode = '23514';
  end if;

  -- two phases so a reorder never collides with the unique (product, order) index
  update public.marketplace_product_images i set sort_order = i.sort_order + 100000, is_primary = false
   where i.product_id = p_product_id and i.id in (select (x ->> 'id')::uuid from jsonb_array_elements(p_images) x);
  for e in select * from jsonb_array_elements(p_images) loop
    update public.marketplace_product_images set
      variant_id = nullif(e ->> 'variant_id', '')::uuid,
      sort_order = greatest(coalesce((e ->> 'sort_order')::integer, 0), 0),
      is_primary = coalesce((e ->> 'is_primary')::boolean, false) and nullif(e ->> 'variant_id', '') is null
                   and upload_state = 'confirmed',
      alt_text_ar = left(nullif(btrim(e ->> 'alt_text_ar'), ''), 300),
      alt_text_en = left(nullif(btrim(e ->> 'alt_text_en'), ''), 300)
    where id = (e ->> 'id')::uuid;
  end loop;
end;
$function$;

-- public.marketplace_public_cart(p_lines jsonb, p_governorate text, p_area text)
CREATE OR REPLACE FUNCTION public.marketplace_public_cart(p_lines jsonb, p_governorate text DEFAULT NULL::text, p_area text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_media boolean := app.marketplace_media_verification_ready();
  v_gov   text := nullif(btrim(lower(p_governorate)), '');
  v_area  text := nullif(btrim(lower(p_area)), '');
  v_result jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'mp:invalid_lines' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 50 then
    raise exception 'mp:too_many_lines' using errcode = '22023';
  end if;
  if (v_gov is not null and v_gov !~ '^[a-z0-9][a-z0-9-]{0,63}$') or (v_area is not null and v_area !~ '^[a-z0-9][a-z0-9-]{0,63}$') then
    raise exception 'mp:invalid_location' using errcode = '22023';
  end if;

  with resolved as (
    select t.ord::int as ord, req.slug, req.sku, p.id as product_id, pv.id as variant_id, p.seller_organization_id as seller_id
    from jsonb_array_elements(p_lines) with ordinality as t(x, ord)
    cross join lateral (select btrim(t.x ->> 'slug') as slug, btrim(t.x ->> 'sku') as sku) req
    left join public.marketplace_products p
      on req.slug ~ '^[a-z0-9-]{1,120}$' and p.slug = req.slug and p.status = 'published'
     and app.marketplace_seller_is_enabled(p.seller_organization_id)
     and exists (select 1 from public.marketplace_product_types pt
                 join public.marketplace_categories pc on pc.id = pt.category_id
                 where pt.id = p.product_type_id and pt.is_active and pc.is_active)
    left join public.marketplace_product_variants pv
      on pv.product_id = p.id and req.sku ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$' and pv.sku = req.sku and pv.status = 'active'
  ), sellers as (
    select r.seller_id, row_number() over (order by min(r.ord))::int as idx
    from resolved r where r.variant_id is not null group by r.seller_id
  )
  select jsonb_build_object(
    'lines', coalesce((
      select jsonb_agg(
        case when r.variant_id is null
          then jsonb_build_object('slug', r.slug, 'sku', r.sku, 'status', 'unavailable')
          else jsonb_build_object(
            'slug', r.slug, 'sku', r.sku, 'status', 'ok',
            'name_ar', p.name_ar, 'name_en', p.name_en, 'brand', p.brand,
            'selling_unit', pv.selling_unit, 'price_egp', pv.price_egp,
            -- availability is capped: the cart needs "how many may I buy", not the showroom's stock
            'available', least(app.marketplace_variant_available(pv.id), 9999),
            'seller', s.idx,
            'image_id', case when v_media then app.marketplace_product_cover_image(p.id) end,
            'attributes', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'key', d.key, 'name_ar', d.name_ar, 'name_en', d.name_en, 'data_type', vv.data_type, 'unit_kind', d.unit_kind,
                       'unit_ar', d.display_unit_ar, 'unit_en', d.display_unit_en,
                       'value', case
                         when vv.option_id is not null then jsonb_build_object('key', o.key, 'name_ar', o.name_ar, 'name_en', o.name_en, 'swatch_hex', o.swatch_hex)
                         when vv.value_number is not null then to_jsonb(vv.value_number)
                         when vv.value_boolean is not null then to_jsonb(vv.value_boolean)
                         else to_jsonb(vv.value_text) end)
                     order by d.key)
              from public.marketplace_variant_attribute_values vv
              join public.marketplace_attribute_definitions d on d.id = vv.attribute_id and d.is_active
              left join public.marketplace_attribute_options o on o.id = vv.option_id
              where vv.variant_id = pv.id), '[]'::jsonb))
        end order by r.ord)
      from resolved r
      left join public.marketplace_products p on p.id = r.product_id
      left join public.marketplace_product_variants pv on pv.id = r.variant_id
      left join sellers s on s.seller_id = r.seller_id and r.variant_id is not null), '[]'::jsonb),
    'sellers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'index', s.idx,
               'name', o.name,
               'pickup_available', exists (select 1 from public.marketplace_stock_locations l
                                           where l.organization_id = s.seller_id and l.is_active and l.supports_pickup),
               'payment_methods', jsonb_build_object(
                 'cod', coalesce(ps.cod_enabled, false),
                 'instapay', case when coalesce(ps.instapay_enabled, false)
                   then jsonb_build_object('deposit_percent', ps.instapay_deposit_percent) end),
               'delivery', case
                 when v_gov is null then jsonb_build_object('status', 'needs_area')
                 else coalesce((
                   select jsonb_build_object('status', 'available', 'fee_egp', dr.fee_egp)
                   from public.marketplace_delivery_rates dr
                   where dr.seller_organization_id = s.seller_id and dr.governorate_key = v_gov and dr.fee_egp is not null
                     and (dr.area_key = v_area or dr.area_key is null)
                   order by (dr.area_key is null)
                   limit 1), jsonb_build_object('status', 'not_available'))
               end) order by s.idx)
      from sellers s join public.organizations o on o.id = s.seller_id
      left join public.marketplace_seller_payment_settings ps on ps.seller_organization_id = s.seller_id), '[]'::jsonb))
  into v_result;
  return v_result;
end;
$function$;

-- public.marketplace_seller_pickup_set(p_organization_id uuid, p_enabled boolean)
CREATE OR REPLACE FUNCTION public.marketplace_seller_pickup_set(p_organization_id uuid, p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_location uuid;
begin
  perform app.marketplace_assert_seller_writer(p_organization_id);
  if p_enabled is null then
    raise exception 'mp:pickup_invalid' using errcode = '22023';
  end if;
  if p_enabled then
    v_location := public.marketplace_seller_default_location(p_organization_id);
    update public.marketplace_stock_locations set supports_pickup = true where id = v_location;
  else
    update public.marketplace_stock_locations set supports_pickup = false
     where organization_id = p_organization_id and supports_pickup;
  end if;
  return jsonb_build_object('pickup_available', p_enabled);
end;
$function$;

-- public.marketplace_seller_delivery_areas_save(p_organization_id uuid, p_areas jsonb)
CREATE OR REPLACE FUNCTION public.marketplace_seller_delivery_areas_save(p_organization_id uuid, p_areas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  e      jsonb;
  i      integer := 0;
  v_gov  text;
  v_area text;
  v_seen text[] := '{}';
  v_key  text;
begin
  perform app.marketplace_assert_seller_writer(p_organization_id);
  if p_areas is null or jsonb_typeof(p_areas) <> 'array' then
    raise exception 'mp:delivery_invalid' using errcode = '22023';
  end if;
  if jsonb_array_length(p_areas) > 2000 then
    raise exception 'mp:delivery_too_many' using errcode = '22023';
  end if;

  for e in select * from jsonb_array_elements(p_areas) loop
    i := i + 1;
    if jsonb_typeof(e) <> 'object' then
      raise exception 'mp:delivery_invalid:%', i using errcode = '22023';
    end if;
    v_gov := nullif(btrim(lower(e ->> 'governorate_key')), '');
    v_area := nullif(btrim(lower(e ->> 'area_key')), '');
    if v_gov is null or not exists (select 1 from app.place_governorates g where g.key = v_gov) then
      raise exception 'mp:delivery_location_invalid:%', coalesce(v_gov, '') using errcode = '22023';
    end if;
    if v_area is not null and not exists (select 1 from app.place_cities c where c.governorate_key = v_gov and c.key = v_area) then
      raise exception 'mp:delivery_location_invalid:%/%', v_gov, v_area using errcode = '22023';
    end if;
    v_key := v_gov || '/' || coalesce(v_area, '');
    if v_key = any (v_seen) then
      raise exception 'mp:delivery_duplicate:%', v_key using errcode = '23505';
    end if;
    v_seen := array_append(v_seen, v_key);
  end loop;

  delete from public.marketplace_delivery_rates r
   where r.seller_organization_id = p_organization_id
     and (r.governorate_key || '/' || coalesce(r.area_key, '')) <> all (v_seen);
  insert into public.marketplace_delivery_rates (seller_organization_id, governorate_key, area_key, fee_egp)
  select p_organization_id, lower(btrim(x ->> 'governorate_key')), nullif(lower(btrim(x ->> 'area_key')), ''), null
  from jsonb_array_elements(p_areas) x
  on conflict (seller_organization_id, governorate_key, (coalesce(area_key, ''))) do nothing;
  return jsonb_build_object('saved', jsonb_array_length(p_areas));
end;
$function$;

-- public.admin_marketplace_set_media_verification_ready(p_ready boolean, p_reason text)
CREATE OR REPLACE FUNCTION public.admin_marketplace_set_media_verification_ready(p_ready boolean, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid;
begin
  v_uid := app.marketplace_assert_admin_permission('marketplace_media.moderate');
  if p_ready is null or p_reason is null or char_length(btrim(p_reason)) not between 3 and 300 then
    raise exception 'mp:reason_required' using errcode = '22023';
  end if;
  if app.marketplace_media_verification_ready() = p_ready then
    return p_ready;
  end if;
  update public.marketplace_platform_settings set media_verification_ready = p_ready where singleton;
  insert into public.marketplace_platform_events (action, detail, actor_user_id)
  values (case when p_ready then 'media_verification_enabled' else 'media_verification_disabled' end,
          jsonb_build_object('reason', btrim(p_reason)), v_uid);
  return p_ready;
end;
$function$;

-- public.marketplace_seller_delivery_prices_save(p_organization_id uuid, p_prices jsonb)
CREATE OR REPLACE FUNCTION public.marketplace_seller_delivery_prices_save(p_organization_id uuid, p_prices jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  e      jsonb;
  i      integer := 0;
  v_gov  text;
  v_area text;
  v_fee  text;
  v_seen text[] := '{}';
  v_key  text;
begin
  perform app.marketplace_assert_seller_writer(p_organization_id);
  if p_prices is null or jsonb_typeof(p_prices) <> 'array' then
    raise exception 'mp:delivery_invalid' using errcode = '22023';
  end if;
  if jsonb_array_length(p_prices) > 2000 then
    raise exception 'mp:delivery_too_many' using errcode = '22023';
  end if;

  -- one transaction: a refusal anywhere rolls back every price set before it
  for e in select * from jsonb_array_elements(p_prices) loop
    i := i + 1;
    if jsonb_typeof(e) <> 'object' then
      raise exception 'mp:delivery_invalid:%', i using errcode = '22023';
    end if;
    v_gov := nullif(btrim(lower(e ->> 'governorate_key')), '');
    v_area := nullif(btrim(lower(e ->> 'area_key')), '');
    v_fee := e ->> 'fee_egp';
    if v_fee is not null and (v_fee !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$' or v_fee::numeric > 100000) then
      raise exception 'mp:delivery_fee_invalid:%', i using errcode = '22023';
    end if;
    if v_gov is null or not exists (select 1 from app.place_governorates g where g.key = v_gov) then
      raise exception 'mp:delivery_location_invalid:%', coalesce(v_gov, '') using errcode = '22023';
    end if;
    if v_area is not null and not exists (select 1 from app.place_cities c where c.governorate_key = v_gov and c.key = v_area) then
      raise exception 'mp:delivery_location_invalid:%/%', v_gov, v_area using errcode = '22023';
    end if;
    v_key := v_gov || '/' || coalesce(v_area, '');
    if v_key = any (v_seen) then
      raise exception 'mp:delivery_duplicate:%', v_key using errcode = '23505';
    end if;
    v_seen := array_append(v_seen, v_key);
    update public.marketplace_delivery_rates r set fee_egp = v_fee::numeric
     where r.seller_organization_id = p_organization_id and r.governorate_key = v_gov and coalesce(r.area_key, '') = coalesce(v_area, '');
    if not found then
      raise exception 'mp:delivery_area_unknown:%', v_key using errcode = '22023';
    end if;
  end loop;
  return jsonb_build_object('saved', jsonb_array_length(p_prices));
end;
$function$;

-- public.marketplace_seller_payment_settings_save(p_organization_id uuid, p_settings jsonb)
CREATE OR REPLACE FUNCTION public.marketplace_seller_payment_settings_save(p_organization_id uuid, p_settings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid  uuid;
  v_ip   boolean := coalesce((p_settings ->> 'instapay_enabled')::boolean, false);
  v_addr text := nullif(btrim(p_settings ->> 'instapay_address'), '');
  v_name text := nullif(btrim(p_settings ->> 'instapay_account_name'), '');
  v_pct  integer;
begin
  v_uid := app.marketplace_assert_seller_writer(p_organization_id);
  if not app.has_capability(p_organization_id, 'org.manage') then
    raise exception 'mp:not_permitted' using errcode = '42501';
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  if coalesce(p_settings ->> 'instapay_deposit_percent', '') ~ '^[0-9]{1,3}$' then
    v_pct := (p_settings ->> 'instapay_deposit_percent')::integer;
  end if;
  if v_ip and (v_addr is null or char_length(v_addr) not between 3 and 100) then
    raise exception 'mp:instapay_address_required' using errcode = '23514';
  end if;
  if v_ip and (v_name is null or char_length(v_name) not between 2 and 100) then
    raise exception 'mp:instapay_name_required' using errcode = '23514';
  end if;
  if v_ip and (v_pct is null or v_pct not between 1 and 100) then
    raise exception 'mp:deposit_percent_invalid' using errcode = '23514';
  end if;
  insert into public.marketplace_seller_payment_settings as s
    (seller_organization_id, cod_enabled, instapay_enabled, instapay_address, instapay_account_name, instapay_deposit_percent, updated_by)
  values (p_organization_id, coalesce((p_settings ->> 'cod_enabled')::boolean, false), v_ip, v_addr, v_name, v_pct, v_uid)
  on conflict (seller_organization_id) do update set
    cod_enabled = excluded.cod_enabled, instapay_enabled = excluded.instapay_enabled,
    instapay_address = excluded.instapay_address, instapay_account_name = excluded.instapay_account_name,
    instapay_deposit_percent = excluded.instapay_deposit_percent, updated_by = excluded.updated_by;
  return public.marketplace_seller_payment_settings_get(p_organization_id);
end;
$function$;

-- public.marketplace_public_catalog(p_type_key text, p_query text, p_limit integer, p_offset integer)
CREATE OR REPLACE FUNCTION public.marketplace_public_catalog(p_type_key text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 24, p_offset integer DEFAULT 0)
 RETURNS TABLE(slug text, name_ar text, name_en text, description_ar text, description_en text, brand text, product_type_key text, category_key text, from_price_egp numeric, in_stock boolean, primary_image_id uuid, published_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p.slug, p.name_ar, p.name_en, p.description_ar, p.description_en, p.brand,
         t.key, c.key,
         (select min(v.price_egp) from public.marketplace_product_variants v
           where v.product_id = p.id and v.status = 'active'),
         exists (select 1 from public.marketplace_product_variants v
                  where v.product_id = p.id and v.status = 'active'
                    and app.marketplace_variant_available(v.id) > 0),
         case when app.marketplace_media_verification_ready() then
           (select i.id from public.marketplace_product_images i
             where i.product_id = p.id and i.variant_id is null and i.is_primary and i.status = 'verified' limit 1)
         end,
         p.published_at
  from public.marketplace_products p
  join public.marketplace_product_types t on t.id = p.product_type_id and t.is_active
  join public.marketplace_categories c on c.id = t.category_id and c.is_active
  where p.status = 'published'
    and app.marketplace_seller_is_enabled(p.seller_organization_id)
    and exists (select 1 from public.marketplace_product_variants v where v.product_id = p.id and v.status = 'active')
    and (p_type_key is null or t.key = p_type_key)
    and (p_query is null or btrim(p_query) = ''
         or position(lower(btrim(p_query)) in lower(p.name_en)) > 0
         or position(lower(btrim(p_query)) in lower(p.name_ar)) > 0
         or position(lower(btrim(p_query)) in lower(coalesce(p.brand, ''))) > 0)
  order by p.published_at desc, p.slug
  limit least(greatest(coalesce(p_limit, 24), 1), 60)
  offset greatest(coalesce(p_offset, 0), 0);
$function$;

-- public.marketplace_seller_image_request_upload(p_product_id uuid, p_content_type text, p_variant_id uuid)
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
  if v_open >= 30 then
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

-- public.marketplace_checkout_place(p_lines jsonb, p_contact jsonb, p_sellers jsonb, p_idempotency_key text)
CREATE OR REPLACE FUNCTION public.marketplace_checkout_place(p_lines jsonb, p_contact jsonb, p_sellers jsonb, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid      uuid := (select auth.uid());
  v_checkout uuid := gen_random_uuid();
  v_name     text := nullif(btrim(p_contact ->> 'name'), '');
  v_phone    text := regexp_replace(coalesce(p_contact ->> 'phone', ''), '[\s-]', '', 'g');
  v_note     text := nullif(btrim(p_contact ->> 'note'), '');
  v_gov      text := nullif(btrim(lower(p_contact ->> 'governorate')), '');
  v_area     text := nullif(btrim(lower(p_contact ->> 'area')), '');
  v_address  text := nullif(btrim(p_contact ->> 'address'), '');
  s          record;
  ln         record;
  v_choice   jsonb;
  v_fulfil   text;
  v_payment  text;
  v_fee      numeric(14,2);
  v_subtotal numeric(14,2);
  v_total    numeric(14,2);
  v_settings public.marketplace_seller_payment_settings;
  v_order    public.marketplace_orders;
  v_loc      uuid;
  v_out      jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  if not app.account_is_active(v_uid) then
    raise exception 'mp:account_inactive' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 128 then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  -- a replay returns what was placed the first time
  if exists (select 1 from public.marketplace_orders where buyer_user_id = v_uid and idempotency_key = p_idempotency_key) then
    return (select jsonb_build_object('checkout_id', min(o.checkout_id::text), 'replayed', true,
              'orders', jsonb_agg(jsonb_build_object('id', o.id, 'order_number', o.order_number, 'total_egp', o.total_egp,
                'payment_method', o.payment_method, 'deposit_egp', o.deposit_egp) order by o.order_number))
            from public.marketplace_orders o where o.buyer_user_id = v_uid and o.idempotency_key = p_idempotency_key);
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception 'mp:invalid_lines' using errcode = '22023';
  end if;
  if p_sellers is null or jsonb_typeof(p_sellers) <> 'array' then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  if v_name is null or char_length(v_name) not between 2 and 100 then
    raise exception 'mp:buyer_name_required' using errcode = '23514';
  end if;
  if v_phone !~ '^\+?[0-9]{8,15}$' then
    raise exception 'mp:buyer_phone_invalid' using errcode = '23514';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'mp:note_too_long' using errcode = '23514';
  end if;

  -- resolve every line now (published, enabled seller, active variant), quantities validated
  create temporary table if not exists pg_temp.mp_checkout_lines (
    ord int, seller_id uuid, product_id uuid, variant_id uuid, sku text, name_ar text, name_en text,
    selling_unit text, price numeric(14,2), qty int) on commit drop;
  delete from pg_temp.mp_checkout_lines where true;  -- PostgREST safeupdate refuses an unqualified DELETE
  insert into pg_temp.mp_checkout_lines
  select t.ord::int, p.seller_organization_id, p.id, pv.id, pv.sku, p.name_ar, p.name_en, pv.selling_unit, pv.price_egp,
         (t.x ->> 'qty')::int
  from jsonb_array_elements(p_lines) with ordinality as t(x, ord)
  left join public.marketplace_products p
    on p.slug = btrim(t.x ->> 'slug') and p.status = 'published' and app.marketplace_seller_is_enabled(p.seller_organization_id)
   and exists (select 1 from public.marketplace_product_types pt join public.marketplace_categories pc on pc.id = pt.category_id
               where pt.id = p.product_type_id and pt.is_active and pc.is_active)
  left join public.marketplace_product_variants pv
    on pv.product_id = p.id and pv.sku = btrim(t.x ->> 'sku') and pv.status = 'active'
  where coalesce(t.x ->> 'qty', '') ~ '^[0-9]{1,4}$';
  if (select count(*) from pg_temp.mp_checkout_lines) <> jsonb_array_length(p_lines)
     or exists (select 1 from pg_temp.mp_checkout_lines where variant_id is null) then
    raise exception 'mp:cart_changed' using errcode = '23514';
  end if;
  if exists (select 1 from pg_temp.mp_checkout_lines where qty < 1) then
    raise exception 'mp:invalid_quantity' using errcode = '22023';
  end if;
  if exists (select 1 from pg_temp.mp_checkout_lines group by variant_id having count(*) > 1) then
    raise exception 'mp:duplicate_line' using errcode = '22023';
  end if;

  for s in
    select l.seller_id, row_number() over (order by min(l.ord))::int as idx
    from pg_temp.mp_checkout_lines l group by l.seller_id order by idx
  loop
    select x into v_choice from jsonb_array_elements(p_sellers) x where (x ->> 'index') = s.idx::text limit 1;
    if v_choice is null then
      raise exception 'mp:choice_missing:%', s.idx using errcode = '22023';
    end if;
    v_fulfil := v_choice ->> 'fulfilment';
    v_payment := v_choice ->> 'payment';
    select * into v_settings from public.marketplace_seller_payment_settings where seller_organization_id = s.seller_id;

    if v_fulfil = 'pickup' then
      if not exists (select 1 from public.marketplace_stock_locations l
                     where l.organization_id = s.seller_id and l.is_active and l.supports_pickup) then
        raise exception 'mp:pickup_not_available:%', s.idx using errcode = '23514';
      end if;
      v_fee := 0;
    elsif v_fulfil = 'delivery' then
      if v_gov is null or v_address is null or char_length(v_address) not between 5 and 300 then
        raise exception 'mp:address_required' using errcode = '23514';
      end if;
      select dr.fee_egp into v_fee from public.marketplace_delivery_rates dr
       where dr.seller_organization_id = s.seller_id and dr.governorate_key = v_gov and dr.fee_egp is not null
         and (dr.area_key = v_area or dr.area_key is null)
       order by (dr.area_key is null) limit 1;
      if v_fee is null then
        raise exception 'mp:delivery_not_available:%', s.idx using errcode = '23514';
      end if;
    else
      raise exception 'mp:invalid_fulfilment' using errcode = '22023';
    end if;

    if v_payment = 'cod' then
      if not coalesce(v_settings.cod_enabled, false) then
        raise exception 'mp:payment_not_available:%', s.idx using errcode = '23514';
      end if;
    elsif v_payment = 'instapay' then
      if not coalesce(v_settings.instapay_enabled, false) then
        raise exception 'mp:payment_not_available:%', s.idx using errcode = '23514';
      end if;
    else
      raise exception 'mp:invalid_payment' using errcode = '22023';
    end if;

    select sum(round(l.price * l.qty, 2)) into v_subtotal from pg_temp.mp_checkout_lines l where l.seller_id = s.seller_id;
    v_total := v_subtotal + v_fee;

    insert into public.marketplace_orders
      (checkout_id, idempotency_key, buyer_user_id, seller_organization_id, status, payment_method, payment_status,
       fulfilment, governorate_key, area_key, address_text, buyer_name, buyer_phone, buyer_note,
       subtotal_egp, delivery_fee_egp, total_egp, deposit_percent, deposit_egp, instapay_address, instapay_account_name)
    values
      (v_checkout, p_idempotency_key, v_uid, s.seller_id, 'pending_confirmation', v_payment,
       case v_payment when 'cod' then 'pending' else 'awaiting_deposit' end,
       v_fulfil, case when v_fulfil = 'delivery' then v_gov end, case when v_fulfil = 'delivery' then v_area end,
       case when v_fulfil = 'delivery' then v_address end, v_name, v_phone, v_note,
       v_subtotal, v_fee, v_total,
       case when v_payment = 'instapay' then v_settings.instapay_deposit_percent end,
       case when v_payment = 'instapay' then round(v_total * v_settings.instapay_deposit_percent / 100.0, 2) end,
       case when v_payment = 'instapay' then v_settings.instapay_address end,
       case when v_payment = 'instapay' then v_settings.instapay_account_name end)
    returning * into v_order;

    for ln in select * from pg_temp.mp_checkout_lines l where l.seller_id = s.seller_id order by l.ord loop
      -- reserve at the showroom's location that has the units (the main location first)
      select lv.location_id into v_loc
      from public.marketplace_inventory_levels lv
      join public.marketplace_stock_locations sl on sl.id = lv.location_id and sl.is_active
      where lv.variant_id = ln.variant_id and lv.available >= ln.qty
      order by (sl.key = 'main') desc, lv.available desc
      limit 1;
      if v_loc is null then
        raise exception 'mp:insufficient_stock:%', ln.sku using errcode = '23514';
      end if;
      insert into public.marketplace_order_items
        (order_id, product_id, variant_id, location_id, sku, name_ar, name_en, selling_unit, unit_price_egp, quantity)
      values (v_order.id, ln.product_id, ln.variant_id, v_loc, ln.sku, ln.name_ar, ln.name_en, ln.selling_unit, ln.price, ln.qty);
    end loop;

    perform app.marketplace_order_stock(v_order.id, 'reserve');
    perform app.marketplace_order_event(v_order.id, 'placed', null, v_order.status, null, v_order.payment_status, 'buyer', null);
    v_out := v_out || jsonb_build_object('id', v_order.id, 'order_number', v_order.order_number, 'total_egp', v_order.total_egp,
      'payment_method', v_order.payment_method, 'deposit_egp', v_order.deposit_egp);
  end loop;

  return jsonb_build_object('checkout_id', v_checkout, 'replayed', false, 'orders', v_out);
end;
$function$;

-- public.video_upload_begin(p_scope text, p_product_id uuid, p_title text, p_content_type text, p_bytes bigint)
CREATE OR REPLACE FUNCTION public.video_upload_begin(p_scope text, p_product_id uuid, p_title text, p_content_type text, p_bytes bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_product public.products;
  v_slot smallint;
  v_id uuid;
begin
  if v_uid is null or not app.account_is_active(v_uid) then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_content_type is null or p_content_type not in ('video/mp4', 'video/quicktime', 'video/webm') then
    raise exception 'unsupported video type' using errcode = '22023';
  end if;
  -- No product size cap: only R2's own 5 TiB object limit.
  if p_bytes is null or p_bytes <= 0 or p_bytes > 5497558138880 then
    raise exception 'video size is outside what storage accepts' using errcode = '22023';
  end if;
  -- Resource protection, not a media quota: the same ten in-flight uploads per
  -- person that app.limit_pending_media allows for images.
  if (select count(*) from public.media_videos
       where owner_user_id = v_uid and state = 'uploading') >= 10 then
    raise exception 'too many unfinished uploads' using errcode = '23514';
  end if;
  if p_scope = 'portfolio' then
    if p_product_id is not null then raise exception 'invalid scope' using errcode = '22023'; end if;
    if not app.can_create_professional_asset() then
      raise exception 'a professional persona is required to add portfolio work' using errcode = '42501';
    end if;
    -- Portfolios have no count limit for photos, so none for videos either.
    insert into public.media_videos (owner_user_id, scope, title, content_type, declared_bytes, sort_order)
    values (v_uid, 'portfolio', btrim(p_title), p_content_type, p_bytes, app.portfolio_next_position(v_uid))
    returning id into v_id;
  elsif p_scope = 'product' then
    -- Locking the product serializes slot allocation with product_image_request_upload.
    select * into v_product from public.products where id = p_product_id and deleted_at is null for update;
    if not found or not app.can_write_publisher(v_product.publisher_id) then
      raise exception 'catalog.write required' using errcode = '42501';
    end if;
    if v_product.archived_at is not null then
      raise exception 'an archived product must be restored before its media change' using errcode = '22023';
    end if;
    -- The product gallery's existing limit (three items) covers images and videos together.
    v_slot := app.product_media_free_slot(p_product_id);
    if v_slot is null then
      raise exception 'a product can have at most 3 photos and videos' using errcode = '23514';
    end if;
    insert into public.media_videos (owner_user_id, scope, product_id, publisher_id, title, content_type, declared_bytes, slot)
    values (v_uid, 'product', p_product_id, v_product.publisher_id, btrim(p_title), p_content_type, p_bytes, v_slot)
    returning id into v_id;
  else
    raise exception 'invalid scope' using errcode = '22023';
  end if;
  return v_id;
end;
$function$;

-- public.media_edge_video(p_video uuid, p_viewer uuid, p_session uuid, p_workspace uuid, p_expires_at timestamp with time zone)
CREATE OR REPLACE FUNCTION public.media_edge_video(p_video uuid, p_viewer uuid, p_session uuid, p_workspace uuid, p_expires_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_role text := current_setting('request.jwt.claim.role', true);
  v public.media_videos;
  v_public boolean;
  v_allowed boolean := false;
begin
  if p_video is null then return null; end if;
  -- Only R2 + HLS videos are delivered by the Worker; another provider serves its own.
  select * into v from public.media_videos where id = p_video and state = 'ready' and provider = 'r2_hls';
  if not found then return null; end if;
  v_public := v.scope = 'portfolio' and v.visibility = 'public' and exists (
    select 1 from public.profiles p join public.profile_public_directory d on d.id = p.id
     where p.user_id = v.owner_user_id);
  if p_viewer is null then
    v_allowed := v_public;
  else
    if p_session is null or p_expires_at is null or p_expires_at < now() - interval '5 seconds'
      or p_expires_at > now() + interval '4 hours 5 seconds' then
      return null;
    end if;
    if not app.account_is_active(p_viewer) then return null; end if;
    perform set_config('request.jwt.claim.sub', p_viewer::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_viewer, 'role', 'authenticated',
      'session_id', p_session)::text, true);
    if app.jwt_session_is_live() then
      v_allowed := v_public or case v.scope
        when 'portfolio' then v.owner_user_id = p_viewer
        else app.is_publisher_member(v.publisher_id)
          or (app.product_is_public(v.product_id) and app.product_image_viewable(v.product_id, p_workspace)) end;
    end if;
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
    perform set_config('request.jwt.claim.role', coalesce(v_role, ''), true);
  end if;
  if not coalesce(v_allowed, false) then return null; end if;
  return jsonb_build_object('prefix', 'video/' || v.id || '/' || v.revision || '/',
    'revision', v.revision, 'renditions', to_jsonb(v.renditions), 'poster', v.has_poster,
    'public', v_public);
end;
$function$;

-- public.marketplace_seller_products_page(p_organization_id uuid, p_query text, p_type text, p_status text, p_stock text, p_limit integer, p_offset integer)
CREATE OR REPLACE FUNCTION public.marketplace_seller_products_page(p_organization_id uuid, p_query text DEFAULT NULL::text, p_type text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_stock text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_q      text := nullif(lower(btrim(coalesce(p_query, ''))), '');
  v_result jsonb;
begin
  perform app.marketplace_assert_seller_reader(p_organization_id);
  with base as (
    select p.id, p.slug, p.name_ar, p.name_en, p.description_ar, p.description_en, p.status, p.created_at,
           t.key as type_key, t.name_ar as type_name_ar, t.name_en as type_name_en,
           coalesce((select array_agg(v.sku order by v.created_at, v.sku) from public.marketplace_product_variants v
                     where v.product_id = p.id and v.status = 'active'), '{}') as skus,
           coalesce((select array_agg(v.id order by v.created_at, v.sku) from public.marketplace_product_variants v
                     where v.product_id = p.id and v.status = 'active'), '{}') as variant_ids,
           (select min(v.price_egp) from public.marketplace_product_variants v where v.product_id = p.id and v.status = 'active') as from_price,
           coalesce((select sum(greatest(l.available, 0)) from public.marketplace_inventory_levels l
                     join public.marketplace_product_variants v on v.id = l.variant_id and v.status = 'active'
                     join public.marketplace_stock_locations sl on sl.id = l.location_id and sl.is_active
                     where v.product_id = p.id), 0) as quantity
    from public.marketplace_products p
    join public.marketplace_product_types t on t.id = p.product_type_id
    where p.seller_organization_id = p_organization_id
  ),
  filtered as (
    select b.* from base b
    where (coalesce(p_type, '') = '' or b.type_key = p_type)
      and (coalesce(p_status, '') = '' or b.status = p_status)
      and (coalesce(p_stock, '') = ''
           or (p_stock = 'out' and b.quantity <= 0)
           or (p_stock = 'low' and b.quantity > 0 and b.quantity < 10)
           or (p_stock = 'in' and b.quantity >= 10))
      and (v_q is null or position(v_q in lower(b.name_ar)) > 0 or position(v_q in lower(b.name_en)) > 0
           or exists (select 1 from unnest(b.skus) k where position(v_q in lower(k)) > 0))
  ),
  page as (
    select f.* from filtered f order by f.created_at desc, f.id limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'limit', v_limit, 'offset', v_offset,
    'stats', (select jsonb_build_object(
                'total', count(*),
                'published', count(*) filter (where status = 'published'),
                'draft', count(*) filter (where status = 'draft'),
                'low_stock', count(*) filter (where status <> 'archived' and quantity > 0 and quantity < 10),
                'out_of_stock', count(*) filter (where status <> 'archived' and quantity <= 0),
                'variants', coalesce(sum(cardinality(skus)), 0)) from base),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'slug', s.slug, 'name_ar', s.name_ar, 'name_en', s.name_en,
               'description_ar', s.description_ar, 'description_en', s.description_en, 'status', s.status,
               'type_key', s.type_key, 'type_name_ar', s.type_name_ar, 'type_name_en', s.type_name_en,
               'skus', to_jsonb(s.skus[1:3]), 'variant_count', cardinality(s.skus),
               'from_price', s.from_price, 'quantity', s.quantity,
               'inline_stock', case when cardinality(s.variant_ids) = 1 then (
                  select case
                    when count(*) = 0 then jsonb_build_object('variant_id', s.variant_ids[1], 'location_id', null,
                                                              'on_hand', 0, 'reserved', 0, 'available', 0)
                    when count(*) = 1 then jsonb_build_object('variant_id', s.variant_ids[1], 'location_id', min(l.location_id::text),
                                                              'on_hand', min(l.on_hand), 'reserved', min(l.reserved), 'available', min(l.available))
                  end
                  from public.marketplace_inventory_levels l
                  join public.marketplace_stock_locations sl on sl.id = l.location_id and sl.is_active
                  where l.variant_id = s.variant_ids[1]) end,
               'cover_key', (select x.object_key from public.marketplace_product_images x
                             where x.product_id = s.id and x.upload_state = 'confirmed' and x.status <> 'rejected'
                             order by (x.variant_id is not null), (not x.is_primary), x.sort_order limit 1))
             order by s.created_at desc, s.id)
      from page s), '[]'::jsonb))
  into v_result;
  return v_result;
end;
$function$;

-- public.marketplace_public_catalog_page(p_category text, p_type text, p_query text, p_sort text, p_limit integer, p_offset integer, p_price_min numeric, p_price_max numeric, p_in_stock boolean, p_attrs jsonb)
CREATE OR REPLACE FUNCTION public.marketplace_public_catalog_page(p_category text DEFAULT NULL::text, p_type text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_sort text DEFAULT 'newest'::text, p_limit integer DEFAULT 24, p_offset integer DEFAULT 0, p_price_min numeric DEFAULT NULL::numeric, p_price_max numeric DEFAULT NULL::numeric, p_in_stock boolean DEFAULT false, p_attrs jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with params as (
    select least(greatest(coalesce(p_limit, 24), 1), 60) as lim,
           greatest(coalesce(p_offset, 0), 0) as off,
           nullif(lower(btrim(coalesce(p_query, ''))), '') as q,
           app.marketplace_media_verification_ready() as media,
           case when jsonb_typeof(p_attrs) = 'object' then p_attrs else '{}'::jsonb end as attrs
  ),
  base as (
    select p.id, p.slug, p.name_ar, p.name_en, p.brand, p.published_at,
           t.key as type_key, t.name_ar as type_name_ar, t.name_en as type_name_en,
           c.key as category_key, c.name_ar as category_name_ar, c.name_en as category_name_en, o.name as seller_name,
           (select min(v.price_egp) from public.marketplace_product_variants v where v.product_id = p.id and v.status = 'active') as from_price
    from public.marketplace_products p
    join public.marketplace_product_types t on t.id = p.product_type_id and t.is_active
    join public.marketplace_categories c on c.id = t.category_id and c.is_active
    join public.organizations o on o.id = p.seller_organization_id
    cross join params pr
    where p.status = 'published'
      and app.marketplace_seller_is_enabled(p.seller_organization_id)
      and exists (select 1 from public.marketplace_product_variants v where v.product_id = p.id and v.status = 'active')
      and (coalesce(p_category, '') = '' or c.key = p_category)
      and (coalesce(p_type, '') = '' or t.key = p_type)
      and (pr.q is null
           or position(pr.q in lower(p.name_en)) > 0 or position(pr.q in lower(p.name_ar)) > 0
           or position(pr.q in lower(coalesce(p.brand, ''))) > 0
           or exists (select 1 from public.marketplace_product_variants v
                      where v.product_id = p.id and v.status = 'active' and position(pr.q in lower(v.sku)) > 0))
      -- price: some active variant inside the range
      and (p_price_min is null and p_price_max is null
           or exists (select 1 from public.marketplace_product_variants v
                      where v.product_id = p.id and v.status = 'active'
                        and (p_price_min is null or v.price_egp >= p_price_min)
                        and (p_price_max is null or v.price_egp <= p_price_max)))
      and (not coalesce(p_in_stock, false)
           or exists (select 1 from public.marketplace_product_variants v
                      where v.product_id = p.id and v.status = 'active' and app.marketplace_variant_available(v.id) > 0))
      -- every requested attribute key must match (product level or an active variant)
      and not exists (
        select 1 from jsonb_each(pr.attrs) f
        where jsonb_typeof(f.value) = 'array' and jsonb_array_length(f.value) > 0
          and not exists (
            select 1 from public.marketplace_product_attribute_values av
            join public.marketplace_attribute_definitions d on d.id = av.attribute_id and d.key = f.key
            join public.marketplace_attribute_options op on op.id = av.option_id
            where av.product_id = p.id and f.value ? op.key)
          and not exists (
            select 1 from public.marketplace_product_variants v
            join public.marketplace_variant_attribute_values vv on vv.variant_id = v.id
            join public.marketplace_attribute_definitions d on d.id = vv.attribute_id and d.key = f.key
            join public.marketplace_attribute_options op on op.id = vv.option_id
            where v.product_id = p.id and v.status = 'active' and f.value ? op.key))
  ),
  page as (
    select b.*,
           row_number() over (order by
             case when p_sort = 'price_asc' then b.from_price end asc nulls last,
             case when p_sort = 'price_desc' then b.from_price end desc nulls last,
             b.published_at desc, b.slug) as ord
    from base b
    order by ord
    limit (select lim from params) offset (select off from params)
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'limit', (select lim from params), 'offset', (select off from params),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'slug', x.slug, 'name_ar', x.name_ar, 'name_en', x.name_en, 'brand', x.brand,
               'product_type_key', x.type_key, 'product_type_name_ar', x.type_name_ar, 'product_type_name_en', x.type_name_en,
               'category_key', x.category_key, 'category_name_ar', x.category_name_ar, 'category_name_en', x.category_name_en,
               'seller_name', x.seller_name, 'from_price_egp', x.from_price,
               'in_stock', exists (select 1 from public.marketplace_product_variants v
                                   where v.product_id = x.id and v.status = 'active' and app.marketplace_variant_available(v.id) > 0),
               'variant_count', (select count(*) from public.marketplace_product_variants v where v.product_id = x.id and v.status = 'active'),
               -- a single active variant can go straight to the cart from a card; several need the product page
               'cart_sku', (select min(v.sku) from public.marketplace_product_variants v
                            where v.product_id = x.id and v.status = 'active' having count(*) = 1),
               'colors', coalesce((select jsonb_agg(distinct op.swatch_hex)
                                   from public.marketplace_product_variants v
                                   join public.marketplace_variant_attribute_values vv on vv.variant_id = v.id
                                   join public.marketplace_attribute_definitions d on d.id = vv.attribute_id and d.key = 'color'
                                   join public.marketplace_attribute_options op on op.id = vv.option_id
                                   where v.product_id = x.id and v.status = 'active' and op.swatch_hex is not null), '[]'::jsonb),
               'published_at', x.published_at,
               'image_id', case when (select media from params) then app.marketplace_product_cover_image(x.id) end)
             order by x.ord)
      from page x), '[]'::jsonb));
$function$;

-- 7. drop the 52 functions the plan added (exact signatures)
drop function if exists app.marketplace_delivery_terms(uuid, text, text);
drop function if exists app.marketplace_free_shipping(uuid, jsonb, numeric);
drop function if exists app.marketplace_is_open();
drop function if exists app.marketplace_product_is_listed(uuid);
drop function if exists app.marketplace_product_review_state(uuid);
drop function if exists app.marketplace_product_ships_free(uuid);
drop function if exists app.marketplace_public_stock_left(uuid);
drop function if exists app.marketplace_review_approve_image(uuid, uuid);
drop function if exists app.marketplace_review_products(text);
drop function if exists app.marketplace_seller_commerce_missing(uuid);
drop function if exists app.marketplace_seller_delivery_ready(uuid);
drop function if exists app.marketplace_seller_is_public(uuid);
drop function if exists app.marketplace_seller_payment_ready(uuid);
drop function if exists app.marketplace_seller_transition(uuid, text, text, uuid, uuid, text, text);
drop function if exists app.marketplace_seller_unpublish_all();
drop function if exists app.marketplace_settings_event(uuid, text, jsonb);
drop function if exists app.marketplace_settings_events_append_only();
drop function if exists app.marketplace_stock_notify();
drop function if exists app.marketplace_video_event(uuid, uuid, uuid, text, jsonb);
drop function if exists app.marketplace_video_free_slot(uuid);
drop function if exists app.marketplace_video_manager(uuid);
drop function if exists app.notify_from_template(uuid, uuid, text, text, uuid, text, jsonb, jsonb, jsonb);
drop function if exists public.admin_marketplace_pending_videos(integer);
drop function if exists public.admin_marketplace_platform_status();
drop function if exists public.admin_marketplace_product_review_approve(uuid);
drop function if exists public.admin_marketplace_product_review_queue(text, integer, integer);
drop function if exists public.admin_marketplace_product_review_reject(uuid, uuid[], text, uuid, text, text);
drop function if exists public.admin_marketplace_product_review_summary();
drop function if exists public.admin_marketplace_product_videos(uuid);
drop function if exists public.admin_marketplace_seller_approve(uuid, text, uuid, text, text);
drop function if exists public.admin_marketplace_seller_history_v2(uuid);
drop function if exists public.admin_marketplace_seller_overview_v2();
drop function if exists public.admin_marketplace_seller_preset_save(uuid, text, text, text, text, text, boolean, integer, text);
drop function if exists public.admin_marketplace_seller_presets();
drop function if exists public.admin_marketplace_seller_reinstate(uuid, text, uuid, text, text);
drop function if exists public.admin_marketplace_seller_reject(uuid, text, uuid, text, text);
drop function if exists public.admin_marketplace_seller_revoke(uuid, text, uuid, text, text);
drop function if exists public.admin_marketplace_seller_suspend(uuid, text, uuid, text, text);
drop function if exists public.admin_marketplace_set_open(boolean, text);
drop function if exists public.admin_marketplace_video_review(uuid, text, text, text, text);
drop function if exists public.marketplace_product_video_list(uuid);
drop function if exists public.marketplace_public_browse(text, text, text, text, integer, integer, numeric, numeric, jsonb, boolean, integer, text, text, text);
drop function if exists public.marketplace_public_delivery(text, text, text, text);
drop function if exists public.marketplace_public_seller(text);
drop function if exists public.marketplace_public_status();
drop function if exists public.marketplace_seller_commerce_readiness(uuid);
drop function if exists public.marketplace_seller_delivery_terms_save(uuid, jsonb, jsonb);
drop function if exists public.marketplace_seller_free_shipping_products_get(uuid, text, integer);
drop function if exists public.marketplace_seller_image_replace_request_upload(uuid, text);
drop function if exists public.marketplace_seller_product_free_shipping_set(uuid, uuid, boolean);
drop function if exists public.marketplace_seller_product_publication_state(uuid);
drop function if exists public.marketplace_seller_request_approval(uuid);

commit;
