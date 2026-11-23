-- Forward-fix "mkt-later": remove everything the Marketplace migrations that came AFTER the first 27 of plan prod-catchup added, and restore what they changed on tables and functions
-- that ALREADY EXIST on Production. Covers 20261123090001 (seller approval v2), 20261123100001 (product review), 20261123120001 (delivery and payment settings),
-- 20261123130001 (publication gate v2), 20261123150001 (public catalog v2), 20261123160001 (video scope value) and 20261123160002 (product video).
-- NOT a down migration and NOT applied anywhere. Use only with the owner's explicit approval, on a hosted database, through the Supabase migration path as a NEW migration
-- (never the SQL Editor). Undo order of plan prod-catchup: THIS file first, then media-notify-remove.sql, marketplace-remove.sql, prod-catchup-restore-previous.sql.
-- It is only meaningful as part of that full undo: the migrations also re-create functions and constraints that exist only inside the plan (Marketplace tables and functions),
-- which marketplace-remove.sql drops afterwards, so those are not restored to their intermediate versions.
-- Removes: 52 functions (new signatures), the Marketplace tables the later migrations created (presets and their events, seller delivery settings, free-shipping products,
-- seller settings events, video events), 3 triggers on plan tables, the 8 review/Marketplace columns, 2 constraints, 5 indexes and the grants of media_videos, 2 seeded notification templates and
-- the permission marketplace_platform.manage. Restores, with the exact PRODUCTION definitions (md5 of pg_get_functiondef, ACL and comment read live on Production 2026-11-23): the 5 video
-- functions (app.video_writable, public.media_edge_video, public.video_delete, public.video_update, public.video_upload_begin) and constraint ck_media_videos_scope on public.media_videos.
-- NOT undone, because Postgres cannot: the enum value 'marketplace' of public.media_video_scope (20261123160001). An unused extra value is harmless; only the backup removes it.
-- DATA GUARD: refuses (RAISE) when any user-written row exists: a seller rejection or owner message, an edited or extra preset, a settings, free-shipping, delivery-settings or video event row,
-- a Marketplace video, an edited stock template, or a notification of a marketplace event type. It never deletes user data; it deletes only seeded, unedited rows.
begin;

do $guard$
declare n bigint; t text;
begin
  foreach t in array array['marketplace_seller_preset_events', 'marketplace_seller_settings_events', 'marketplace_video_events', 'marketplace_free_shipping_products', 'marketplace_seller_delivery_settings'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      if n <> 0 then raise exception 'mkt-later forward-fix refused: % holds % rows', t, n; end if;
    end if;
  end loop;
  if to_regclass('public.marketplace_seller_message_presets') is not null then
    execute 'select count(*) from public.marketplace_seller_message_presets' into n;
    if n <> 15 then raise exception 'mkt-later forward-fix refused: marketplace_seller_message_presets holds % rows (migration seed: 15)', n; end if;
    if exists (select 1 from public.marketplace_seller_message_presets where updated_by is not null) then raise exception 'mkt-later forward-fix refused: a preset was changed'; end if;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'marketplace_seller_accounts' and column_name = 'owner_message_ar') then
    execute 'select count(*) from public.marketplace_seller_accounts where status = ''rejected'' or owner_message_ar is not null or owner_message_en is not null or rejected_at is not null' into n;
    if n <> 0 then raise exception 'mkt-later forward-fix refused: % seller account(s) hold a rejection or an owner message', n; end if;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'media_videos' and column_name = 'marketplace_product_id') then
    execute 'select count(*) from public.media_videos where marketplace_product_id is not null or seller_organization_id is not null or review_status is not null' into n;
    if n <> 0 then raise exception 'mkt-later forward-fix refused: % Marketplace video row(s) exist', n; end if;
  end if;
  if to_regclass('public.notification_templates') is not null then
    if exists (select 1 from public.notification_templates where key in ('marketplace.stock.low', 'marketplace.stock.out') and (title_ar is not null or body_ar is not null or title_en is not null or body_en is not null)) then
      raise exception 'mkt-later forward-fix refused: a stock notification template holds an edit';
    end if;
  end if;
  select count(*) into n from public.notifications where event_type like 'marketplace.%';
  if n <> 0 then raise exception 'mkt-later forward-fix refused: % notification(s) use a marketplace event type', n; end if;
end
$guard$;

DROP TRIGGER IF EXISTS marketplace_stock_notify ON public.marketplace_inventory_levels;
DROP TRIGGER IF EXISTS marketplace_seller_unpublish_all ON public.marketplace_seller_accounts;

-- seeded, unedited rows only (the guard refused otherwise); media-notify-remove.sql then finds its 6 seeded templates
DELETE FROM public.notification_templates WHERE key IN ('marketplace.stock.low', 'marketplace.stock.out');
-- locked core permissions refuse direct deletes (app.admin_role_permissions_guard); the guard is paused only for this statement, inside the transaction.
ALTER TABLE public.admin_role_permissions DISABLE TRIGGER trg_admin_role_permissions_guard;
DELETE FROM public.admin_role_permissions WHERE permission_key = 'marketplace_platform.manage';
ALTER TABLE public.admin_role_permissions ENABLE TRIGGER trg_admin_role_permissions_guard;
DELETE FROM public.admin_permissions WHERE key = 'marketplace_platform.manage';

DROP TABLE IF EXISTS public.marketplace_video_events CASCADE;
DROP TABLE IF EXISTS public.marketplace_seller_settings_events CASCADE;
DROP TABLE IF EXISTS public.marketplace_free_shipping_products CASCADE;
DROP TABLE IF EXISTS public.marketplace_seller_delivery_settings CASCADE;
DROP TABLE IF EXISTS public.marketplace_seller_preset_events CASCADE;
DROP TABLE IF EXISTS public.marketplace_seller_message_presets CASCADE;

-- public.media_videos exists on Production (0 rows, 33 columns): put its shape back
ALTER TABLE public.media_videos DROP CONSTRAINT IF EXISTS ck_media_videos_scope;
ALTER TABLE public.media_videos DROP CONSTRAINT IF EXISTS ck_media_videos_review;
ALTER TABLE public.media_videos DROP CONSTRAINT IF EXISTS ck_media_videos_review_text;
ALTER TABLE public.media_videos
  DROP COLUMN IF EXISTS reviewed_at, DROP COLUMN IF EXISTS reviewed_by, DROP COLUMN IF EXISTS review_reason, DROP COLUMN IF EXISTS review_status,
  DROP COLUMN IF EXISTS review_message_ar, DROP COLUMN IF EXISTS review_message_en, DROP COLUMN IF EXISTS marketplace_product_id, DROP COLUMN IF EXISTS seller_organization_id;
ALTER TABLE public.media_videos ADD CONSTRAINT ck_media_videos_scope CHECK ((((scope = 'portfolio'::media_video_scope) AND (product_id IS NULL) AND (publisher_id IS NULL) AND (sort_order IS NOT NULL) AND (slot IS NULL)) OR ((scope = 'product'::media_video_scope) AND (product_id IS NOT NULL) AND (publisher_id IS NOT NULL) AND (visibility = 'private'::portfolio_visibility) AND (sort_order IS NULL) AND ((slot >= 1) AND (slot <= 6)))));

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

DROP FUNCTION IF EXISTS app.marketplace_delivery_terms(p_seller uuid, p_governorate text, p_area text);
DROP FUNCTION IF EXISTS app.marketplace_free_shipping(p_product_id uuid, p_terms jsonb, p_value numeric);
DROP FUNCTION IF EXISTS app.marketplace_is_open();
DROP FUNCTION IF EXISTS app.marketplace_product_is_listed(p_product_id uuid);
DROP FUNCTION IF EXISTS app.marketplace_product_review_state(p_product_id uuid);
DROP FUNCTION IF EXISTS app.marketplace_product_ships_free(p_product_id uuid);
DROP FUNCTION IF EXISTS app.marketplace_public_stock_left(p_product_id uuid);
DROP FUNCTION IF EXISTS app.marketplace_review_approve_image(p_image_id uuid, p_actor uuid);
DROP FUNCTION IF EXISTS app.marketplace_review_products(p_tab text);
DROP FUNCTION IF EXISTS app.marketplace_seller_commerce_missing(p_org uuid);
DROP FUNCTION IF EXISTS app.marketplace_seller_delivery_ready(p_organization_id uuid);
DROP FUNCTION IF EXISTS app.marketplace_seller_is_public(p_organization_id uuid);
DROP FUNCTION IF EXISTS app.marketplace_seller_payment_ready(p_organization_id uuid);
DROP FUNCTION IF EXISTS app.marketplace_seller_transition(p_organization_id uuid, p_action text, p_reason text, p_actor uuid, p_preset_id uuid, p_message_ar text, p_message_en text);
DROP FUNCTION IF EXISTS app.marketplace_seller_unpublish_all();
DROP FUNCTION IF EXISTS app.marketplace_settings_event(p_org uuid, p_kind text, p_summary jsonb);
DROP FUNCTION IF EXISTS app.marketplace_settings_events_append_only();
DROP FUNCTION IF EXISTS app.marketplace_stock_notify();
DROP FUNCTION IF EXISTS app.marketplace_video_event(p_video uuid, p_product uuid, p_org uuid, p_action text, p_detail jsonb);
DROP FUNCTION IF EXISTS app.marketplace_video_free_slot(p_product_id uuid);
DROP FUNCTION IF EXISTS app.marketplace_video_manager(p_org uuid);
DROP FUNCTION IF EXISTS app.notify_from_template(p_recipient_user_id uuid, p_organization_id uuid, p_template_key text, p_subject_type text, p_subject_id uuid, p_deep_link text, p_vars jsonb, p_vars_ar jsonb, p_vars_en jsonb);
DROP FUNCTION IF EXISTS public.admin_marketplace_pending_videos(p_limit integer);
DROP FUNCTION IF EXISTS public.admin_marketplace_platform_status();
DROP FUNCTION IF EXISTS public.admin_marketplace_product_review_approve(p_product_id uuid);
DROP FUNCTION IF EXISTS public.admin_marketplace_product_review_queue(p_tab text, p_limit integer, p_offset integer);
DROP FUNCTION IF EXISTS public.admin_marketplace_product_review_reject(p_product_id uuid, p_image_ids uuid[], p_reason text, p_preset_id uuid, p_message_ar text, p_message_en text);
DROP FUNCTION IF EXISTS public.admin_marketplace_product_review_summary();
DROP FUNCTION IF EXISTS public.admin_marketplace_product_videos(p_product_id uuid);
DROP FUNCTION IF EXISTS public.admin_marketplace_seller_approve(p_organization_id uuid, p_reason text, p_preset_id uuid, p_message_ar text, p_message_en text);
DROP FUNCTION IF EXISTS public.admin_marketplace_seller_history_v2(p_organization_id uuid);
DROP FUNCTION IF EXISTS public.admin_marketplace_seller_overview_v2();
DROP FUNCTION IF EXISTS public.admin_marketplace_seller_preset_save(p_id uuid, p_action text, p_label_ar text, p_label_en text, p_text_ar text, p_text_en text, p_is_active boolean, p_sort_order integer, p_reason text);
DROP FUNCTION IF EXISTS public.admin_marketplace_seller_presets();
DROP FUNCTION IF EXISTS public.admin_marketplace_seller_reinstate(p_organization_id uuid, p_reason text, p_preset_id uuid, p_message_ar text, p_message_en text);
DROP FUNCTION IF EXISTS public.admin_marketplace_seller_reject(p_organization_id uuid, p_reason text, p_preset_id uuid, p_message_ar text, p_message_en text);
DROP FUNCTION IF EXISTS public.admin_marketplace_seller_revoke(p_organization_id uuid, p_reason text, p_preset_id uuid, p_message_ar text, p_message_en text);
DROP FUNCTION IF EXISTS public.admin_marketplace_seller_suspend(p_organization_id uuid, p_reason text, p_preset_id uuid, p_message_ar text, p_message_en text);
DROP FUNCTION IF EXISTS public.admin_marketplace_set_open(p_open boolean, p_reason text);
DROP FUNCTION IF EXISTS public.admin_marketplace_video_review(p_video_id uuid, p_decision text, p_reason text, p_message_ar text, p_message_en text);
DROP FUNCTION IF EXISTS public.marketplace_product_video_list(p_product_id uuid);
DROP FUNCTION IF EXISTS public.marketplace_public_browse(p_category text, p_type text, p_query text, p_sort text, p_limit integer, p_offset integer, p_price_min numeric, p_price_max numeric, p_attrs jsonb, p_free_shipping boolean, p_max_days integer, p_governorate text, p_area text, p_seller text);
DROP FUNCTION IF EXISTS public.marketplace_public_delivery(p_slug text, p_governorate text, p_area text, p_sku text);
DROP FUNCTION IF EXISTS public.marketplace_public_seller(p_slug text);
DROP FUNCTION IF EXISTS public.marketplace_public_status();
DROP FUNCTION IF EXISTS public.marketplace_seller_commerce_readiness(p_organization_id uuid);
DROP FUNCTION IF EXISTS public.marketplace_seller_delivery_terms_save(p_organization_id uuid, p_settings jsonb, p_areas jsonb);
DROP FUNCTION IF EXISTS public.marketplace_seller_free_shipping_products_get(p_organization_id uuid, p_search text, p_limit integer);
DROP FUNCTION IF EXISTS public.marketplace_seller_image_replace_request_upload(p_image_id uuid, p_content_type text);
DROP FUNCTION IF EXISTS public.marketplace_seller_product_free_shipping_set(p_organization_id uuid, p_product_id uuid, p_enabled boolean);
DROP FUNCTION IF EXISTS public.marketplace_seller_product_publication_state(p_product_id uuid);
DROP FUNCTION IF EXISTS public.marketplace_seller_request_approval(p_organization_id uuid);

commit;
