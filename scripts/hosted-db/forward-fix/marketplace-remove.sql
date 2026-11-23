-- Forward-fix "marketplace": remove everything 20261116100001..014 added and restore what they re-created.
-- NOT a down migration and NOT applied anywhere. Use only with the owner's explicit approval, on a hosted database, through the Supabase
-- migration path as a NEW migration (never the SQL Editor), and only if the plan "marketplace" must be undone.
-- Removes 39 relations (tables and sequences), 126 functions and the 3 marketplace admin permissions, and restores 10 central media functions
-- and media_storage_locations_namespace_check to their definitions after 20261115090001.
-- DATA GUARD: refuses (RAISE) as soon as any seller/product/order/import/stock row exists, if any media object is registered in the
-- 'marketplace' namespace, or if the seeded taxonomy tables differ from their migration seed counts. It never deletes user data.
-- Run BEFORE the "verification" forward-fix. If the NEW application is live, roll the Worker back to the previous version first.
-- Generated from catalog facts measured on disposable databases: a clean replay of the 212 migrations up to 20261115090001 (before),
-- then the 19 plan migrations (after) and scripts/hosted-db/catalog-diff.mjs. Proven by replaying: after the plan + this script
-- (both files, marketplace first) the catalog fingerprint equals the pre-plan fingerprint (catalog-diff.mjs: no catalog differences).
begin;

do $guard$
declare r record; n bigint; seeded jsonb := '{"marketplace_attribute_definitions":61,"marketplace_attribute_options":209,"marketplace_categories":7,"marketplace_platform_settings":1,"marketplace_product_type_attributes":152,"marketplace_product_types":16}'::jsonb;
begin
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind in ('r', 'p') and c.relname like 'marketplace_%' loop
    execute format('select count(*) from public.%I', r.relname) into n;
    if n <> coalesce((seeded ->> r.relname)::bigint, 0) then
      raise exception 'marketplace forward-fix refused: % holds % rows (migration seed: %)', r.relname, n, coalesce(seeded ->> r.relname, '0');
    end if;
  end loop;
  if exists (select 1 from public.media_storage_locations where namespace = 'marketplace') then
    raise exception 'marketplace forward-fix refused: media objects are registered in the marketplace namespace';
  end if;
end
$guard$;

-- locked core permissions refuse direct deletes (app.admin_role_permissions_guard); the guard is paused only for this statement, inside the transaction.
ALTER TABLE public.admin_role_permissions DISABLE TRIGGER trg_admin_role_permissions_guard;
delete from public.admin_role_permissions where permission_key in ('marketplace_sellers.read', 'marketplace_sellers.manage', 'marketplace_media.moderate');
ALTER TABLE public.admin_role_permissions ENABLE TRIGGER trg_admin_role_permissions_guard;
delete from public.admin_permissions where key in ('marketplace_sellers.read', 'marketplace_sellers.manage', 'marketplace_media.moderate');

DROP TABLE IF EXISTS public.marketplace_attribute_definitions CASCADE;
DROP TABLE IF EXISTS public.marketplace_attribute_options CASCADE;
DROP TABLE IF EXISTS public.marketplace_categories CASCADE;
DROP TABLE IF EXISTS public.marketplace_delivery_rates CASCADE;
DROP TABLE IF EXISTS public.marketplace_image_moderation_events CASCADE;
DROP TABLE IF EXISTS public.marketplace_import_assets CASCADE;
DROP TABLE IF EXISTS public.marketplace_import_errors CASCADE;
DROP TABLE IF EXISTS public.marketplace_import_job_events CASCADE;
DROP TABLE IF EXISTS public.marketplace_import_jobs CASCADE;
DROP TABLE IF EXISTS public.marketplace_import_rows CASCADE;
DROP TABLE IF EXISTS public.marketplace_inventory_levels CASCADE;
DROP TABLE IF EXISTS public.marketplace_order_events CASCADE;
DROP TABLE IF EXISTS public.marketplace_order_items CASCADE;
DROP TABLE IF EXISTS public.marketplace_orders CASCADE;
DROP TABLE IF EXISTS public.marketplace_payment_proofs CASCADE;
DROP TABLE IF EXISTS public.marketplace_platform_events CASCADE;
DROP TABLE IF EXISTS public.marketplace_platform_settings CASCADE;
DROP TABLE IF EXISTS public.marketplace_product_attribute_values CASCADE;
DROP TABLE IF EXISTS public.marketplace_product_images CASCADE;
DROP TABLE IF EXISTS public.marketplace_product_status_events CASCADE;
DROP TABLE IF EXISTS public.marketplace_product_type_attributes CASCADE;
DROP TABLE IF EXISTS public.marketplace_product_types CASCADE;
DROP TABLE IF EXISTS public.marketplace_product_variants CASCADE;
DROP TABLE IF EXISTS public.marketplace_products CASCADE;
DROP TABLE IF EXISTS public.marketplace_seller_account_events CASCADE;
DROP TABLE IF EXISTS public.marketplace_seller_accounts CASCADE;
DROP TABLE IF EXISTS public.marketplace_seller_payment_settings CASCADE;
DROP TABLE IF EXISTS public.marketplace_stock_locations CASCADE;
DROP TABLE IF EXISTS public.marketplace_stock_movements CASCADE;
DROP TABLE IF EXISTS public.marketplace_variant_attribute_values CASCADE;
DROP SEQUENCE IF EXISTS public.marketplace_image_moderation_events_sequence_seq;
DROP SEQUENCE IF EXISTS public.marketplace_import_errors_sequence_seq;
DROP SEQUENCE IF EXISTS public.marketplace_import_job_events_sequence_seq;
DROP SEQUENCE IF EXISTS public.marketplace_order_events_sequence_seq;
DROP SEQUENCE IF EXISTS public.marketplace_order_number_seq;
DROP SEQUENCE IF EXISTS public.marketplace_platform_events_sequence_seq;
DROP SEQUENCE IF EXISTS public.marketplace_product_status_events_sequence_seq;
DROP SEQUENCE IF EXISTS public.marketplace_seller_account_events_sequence_seq;
DROP SEQUENCE IF EXISTS public.marketplace_stock_movements_sequence_seq;

DROP FUNCTION IF EXISTS app.marketplace_append_only();
DROP FUNCTION IF EXISTS app.marketplace_assert_admin_permission(p_permission text);
DROP FUNCTION IF EXISTS app.marketplace_assert_seller_admin(p_manage boolean);
DROP FUNCTION IF EXISTS app.marketplace_assert_seller_reader(p_org uuid);
DROP FUNCTION IF EXISTS app.marketplace_assert_seller_writer(p_org uuid);
DROP FUNCTION IF EXISTS app.marketplace_attribute_definition_guard();
DROP FUNCTION IF EXISTS app.marketplace_attribute_json(p_data_type text, p_option_key text, p_num numeric, p_bool boolean, p_text text);
DROP FUNCTION IF EXISTS app.marketplace_attribute_option_guard();
DROP FUNCTION IF EXISTS app.marketplace_attribute_value_guard();
DROP FUNCTION IF EXISTS app.marketplace_attribute_value_ok(p_attribute_id uuid, p_data_type text, p_value jsonb);
DROP FUNCTION IF EXISTS app.marketplace_can_manage_catalog(p_org uuid);
DROP FUNCTION IF EXISTS app.marketplace_can_manage_orders(p_org uuid);
DROP FUNCTION IF EXISTS app.marketplace_import_apply_attribute(p_level text, p_owner uuid, p_attribute_id uuid, p_data_type text, p_value jsonb);
DROP FUNCTION IF EXISTS app.marketplace_import_apply_row(p_row_id uuid);
DROP FUNCTION IF EXISTS app.marketplace_import_assert_lease(p_job uuid, p_worker text);
DROP FUNCTION IF EXISTS app.marketplace_import_cancel_impl(p_job uuid, p_actor text);
DROP FUNCTION IF EXISTS app.marketplace_import_create_impl(p_organization_id uuid, p_actor uuid, p_format text, p_file_name text, p_checksum text, p_mode text, p_chunk_size integer, p_idempotency_key text);
DROP FUNCTION IF EXISTS app.marketplace_import_flag(p_on boolean);
DROP FUNCTION IF EXISTS app.marketplace_import_job_guard();
DROP FUNCTION IF EXISTS app.marketplace_import_parse_asset_name(p_file_name text);
DROP FUNCTION IF EXISTS app.marketplace_import_record_finding(p_job uuid, p_org uuid, p_row_id uuid, p_asset_id uuid, p_row_number integer, p_severity text, p_code text, p_field text, p_message text);
DROP FUNCTION IF EXISTS app.marketplace_import_row_findings(p_row_id uuid);
DROP FUNCTION IF EXISTS app.marketplace_import_set_status(p_job uuid, p_to text, p_actor text, p_note text);
DROP FUNCTION IF EXISTS app.marketplace_import_slug(p_name text, p_org uuid, p_ref text);
DROP FUNCTION IF EXISTS app.marketplace_import_write_guard();
DROP FUNCTION IF EXISTS app.marketplace_inventory_level_guard();
DROP FUNCTION IF EXISTS app.marketplace_media_can_delete(p_key text);
DROP FUNCTION IF EXISTS app.marketplace_media_can_read(p_key text);
DROP FUNCTION IF EXISTS app.marketplace_media_can_upload(p_key text);
DROP FUNCTION IF EXISTS app.marketplace_media_cleanup_rows();
DROP FUNCTION IF EXISTS app.marketplace_media_metadata(p_key text);
DROP FUNCTION IF EXISTS app.marketplace_media_retire(p_key text, p_owner uuid);
DROP FUNCTION IF EXISTS app.marketplace_media_storage_key(p_key text, p_owner uuid, p_org uuid);
DROP FUNCTION IF EXISTS app.marketplace_media_verification_ready();
DROP FUNCTION IF EXISTS app.marketplace_movement_seller_guard();
DROP FUNCTION IF EXISTS app.marketplace_order_document(p_order uuid, p_for text);
DROP FUNCTION IF EXISTS app.marketplace_order_event(p_order uuid, p_action text, p_from_status text, p_to_status text, p_from_payment text, p_to_payment text, p_role text, p_note text);
DROP FUNCTION IF EXISTS app.marketplace_order_stock(p_order uuid, p_movement text);
DROP FUNCTION IF EXISTS app.marketplace_product_cover_image(p_product_id uuid);
DROP FUNCTION IF EXISTS app.marketplace_product_guard();
DROP FUNCTION IF EXISTS app.marketplace_product_has_publishable_image(p_product_id uuid);
DROP FUNCTION IF EXISTS app.marketplace_proof_require_verified_media();
DROP FUNCTION IF EXISTS app.marketplace_pta_guard();
DROP FUNCTION IF EXISTS app.marketplace_public_image_key(p_image_id uuid);
DROP FUNCTION IF EXISTS app.marketplace_publication_blockers(p_product_id uuid);
DROP FUNCTION IF EXISTS app.marketplace_refresh_variant_signature();
DROP FUNCTION IF EXISTS app.marketplace_require_verified_media();
DROP FUNCTION IF EXISTS app.marketplace_seller_account_guard();
DROP FUNCTION IF EXISTS app.marketplace_seller_apply_attributes(p_level text, p_owner uuid, p_type_id uuid, p_attributes jsonb, p_label text);
DROP FUNCTION IF EXISTS app.marketplace_seller_is_eligible(p_organization_id uuid);
DROP FUNCTION IF EXISTS app.marketplace_seller_is_enabled(p_organization_id uuid);
DROP FUNCTION IF EXISTS app.marketplace_seller_stage_import_assets(p_job uuid, p_org uuid, p_assets jsonb);
DROP FUNCTION IF EXISTS app.marketplace_seller_transition(p_organization_id uuid, p_action text, p_reason text, p_actor uuid);
DROP FUNCTION IF EXISTS app.marketplace_stock_location_guard();
DROP FUNCTION IF EXISTS app.marketplace_stock_movement_append_only();
DROP FUNCTION IF EXISTS app.marketplace_type_attribute_in_use_guard();
DROP FUNCTION IF EXISTS app.marketplace_variant_available(p_variant_id uuid);
DROP FUNCTION IF EXISTS app.marketplace_variant_guard();
DROP FUNCTION IF EXISTS app.marketplace_variant_signature(p_variant_id uuid);
DROP FUNCTION IF EXISTS public.admin_marketplace_media_approve(p_image_ids uuid[]);
DROP FUNCTION IF EXISTS public.admin_marketplace_media_queue(p_status text, p_limit integer, p_offset integer);
DROP FUNCTION IF EXISTS public.admin_marketplace_media_record_validation(p_image_id uuid, p_valid boolean, p_format text, p_width integer, p_height integer, p_byte_size bigint, p_sha256 text, p_note text);
DROP FUNCTION IF EXISTS public.admin_marketplace_media_reject(p_image_ids uuid[], p_reason text);
DROP FUNCTION IF EXISTS public.admin_marketplace_media_settings();
DROP FUNCTION IF EXISTS public.admin_marketplace_seller_approve(p_organization_id uuid, p_reason text);
DROP FUNCTION IF EXISTS public.admin_marketplace_seller_history(p_organization_id uuid);
DROP FUNCTION IF EXISTS public.admin_marketplace_seller_overview();
DROP FUNCTION IF EXISTS public.admin_marketplace_seller_reinstate(p_organization_id uuid, p_reason text);
DROP FUNCTION IF EXISTS public.admin_marketplace_seller_revoke(p_organization_id uuid, p_reason text);
DROP FUNCTION IF EXISTS public.admin_marketplace_seller_suspend(p_organization_id uuid, p_reason text);
DROP FUNCTION IF EXISTS public.admin_marketplace_sellers();
DROP FUNCTION IF EXISTS public.admin_marketplace_set_media_verification_ready(p_ready boolean, p_reason text);
DROP FUNCTION IF EXISTS public.marketplace_buyer_order_cancel(p_order_id uuid, p_reason text);
DROP FUNCTION IF EXISTS public.marketplace_buyer_order_get(p_order_id uuid);
DROP FUNCTION IF EXISTS public.marketplace_buyer_orders(p_limit integer, p_offset integer);
DROP FUNCTION IF EXISTS public.marketplace_buyer_proof_confirm(p_proof_id uuid);
DROP FUNCTION IF EXISTS public.marketplace_buyer_proof_request_upload(p_order_id uuid, p_content_type text);
DROP FUNCTION IF EXISTS public.marketplace_checkout_place(p_lines jsonb, p_contact jsonb, p_sellers jsonb, p_idempotency_key text);
DROP FUNCTION IF EXISTS public.marketplace_import_apply_next(p_job uuid, p_worker text);
DROP FUNCTION IF EXISTS public.marketplace_import_cancel(p_job uuid, p_actor uuid);
DROP FUNCTION IF EXISTS public.marketplace_import_claim(p_job uuid, p_worker text, p_lease_seconds integer);
DROP FUNCTION IF EXISTS public.marketplace_import_complete_dry_run(p_job uuid);
DROP FUNCTION IF EXISTS public.marketplace_import_create(p_organization_id uuid, p_actor uuid, p_format text, p_file_name text, p_checksum text, p_mode text, p_chunk_size integer, p_idempotency_key text);
DROP FUNCTION IF EXISTS public.marketplace_import_job_cancel(p_job uuid);
DROP FUNCTION IF EXISTS public.marketplace_import_job_create(p_organization_id uuid, p_format text, p_file_name text, p_checksum text, p_mode text, p_chunk_size integer, p_idempotency_key text);
DROP FUNCTION IF EXISTS public.marketplace_import_job_report(p_job uuid);
DROP FUNCTION IF EXISTS public.marketplace_import_purge_staging(p_job uuid);
DROP FUNCTION IF EXISTS public.marketplace_import_release(p_job uuid, p_worker text);
DROP FUNCTION IF EXISTS public.marketplace_import_retry_failed(p_job uuid);
DROP FUNCTION IF EXISTS public.marketplace_import_seal(p_job uuid);
DROP FUNCTION IF EXISTS public.marketplace_import_stage_assets(p_job uuid, p_assets jsonb);
DROP FUNCTION IF EXISTS public.marketplace_import_stage_rows(p_job uuid, p_rows jsonb);
DROP FUNCTION IF EXISTS public.marketplace_import_validate_next(p_job uuid, p_worker text);
DROP FUNCTION IF EXISTS public.marketplace_product_publish(p_product_id uuid);
DROP FUNCTION IF EXISTS public.marketplace_product_unpublish(p_product_id uuid, p_archive boolean);
DROP FUNCTION IF EXISTS public.marketplace_public_cart(p_lines jsonb, p_governorate text, p_area text);
DROP FUNCTION IF EXISTS public.marketplace_public_catalog(p_type_key text, p_query text, p_limit integer, p_offset integer);
DROP FUNCTION IF EXISTS public.marketplace_public_catalog_page(p_category text, p_type text, p_query text, p_sort text, p_limit integer, p_offset integer, p_price_min numeric, p_price_max numeric, p_in_stock boolean, p_attrs jsonb);
DROP FUNCTION IF EXISTS public.marketplace_public_facets(p_type text);
DROP FUNCTION IF EXISTS public.marketplace_public_image_ref(p_image_id uuid);
DROP FUNCTION IF EXISTS public.marketplace_public_product(p_slug text);
DROP FUNCTION IF EXISTS public.marketplace_seller_default_location(p_organization_id uuid);
DROP FUNCTION IF EXISTS public.marketplace_seller_delivery_areas_save(p_organization_id uuid, p_areas jsonb);
DROP FUNCTION IF EXISTS public.marketplace_seller_delivery_get(p_organization_id uuid);
DROP FUNCTION IF EXISTS public.marketplace_seller_delivery_prices_save(p_organization_id uuid, p_prices jsonb);
DROP FUNCTION IF EXISTS public.marketplace_seller_image_confirm_upload(p_image_id uuid);
DROP FUNCTION IF EXISTS public.marketplace_seller_image_remove(p_image_id uuid);
DROP FUNCTION IF EXISTS public.marketplace_seller_image_remove_finalize(p_image_id uuid);
DROP FUNCTION IF EXISTS public.marketplace_seller_image_request_upload(p_product_id uuid, p_content_type text, p_variant_id uuid);
DROP FUNCTION IF EXISTS public.marketplace_seller_images_pending_removal(p_product_id uuid);
DROP FUNCTION IF EXISTS public.marketplace_seller_images_update(p_product_id uuid, p_images jsonb);
DROP FUNCTION IF EXISTS public.marketplace_seller_import_step(p_job uuid, p_step text, p_payload jsonb);
DROP FUNCTION IF EXISTS public.marketplace_seller_order_get(p_order_id uuid);
DROP FUNCTION IF EXISTS public.marketplace_seller_order_transition(p_order_id uuid, p_action text, p_note text);
DROP FUNCTION IF EXISTS public.marketplace_seller_orders_page(p_organization_id uuid, p_status text, p_limit integer, p_offset integer);
DROP FUNCTION IF EXISTS public.marketplace_seller_payment_settings_get(p_organization_id uuid);
DROP FUNCTION IF EXISTS public.marketplace_seller_payment_settings_save(p_organization_id uuid, p_settings jsonb);
DROP FUNCTION IF EXISTS public.marketplace_seller_pickup_set(p_organization_id uuid, p_enabled boolean);
DROP FUNCTION IF EXISTS public.marketplace_seller_product_get(p_product_id uuid);
DROP FUNCTION IF EXISTS public.marketplace_seller_product_readiness(p_product_id uuid);
DROP FUNCTION IF EXISTS public.marketplace_seller_product_save(p_payload jsonb);
DROP FUNCTION IF EXISTS public.marketplace_seller_products_page(p_organization_id uuid, p_query text, p_type text, p_status text, p_stock text, p_limit integer, p_offset integer);
DROP FUNCTION IF EXISTS public.marketplace_seller_proof_review(p_proof_id uuid, p_accept boolean, p_note text);
DROP FUNCTION IF EXISTS public.marketplace_seller_publish_ready(p_organization_id uuid, p_limit integer);
DROP FUNCTION IF EXISTS public.marketplace_seller_stock_adjust(p_variant_id uuid, p_location_id uuid, p_delta integer, p_idempotency_key text, p_reason text, p_expected_on_hand integer);
DROP FUNCTION IF EXISTS public.marketplace_stock_apply(p_seller_organization_id uuid, p_variant_id uuid, p_location_id uuid, p_movement_type text, p_quantity integer, p_idempotency_key text, p_reason text, p_source text, p_reference_type text, p_reference_id text, p_actor_user_id uuid);

ALTER TABLE public.media_storage_locations DROP CONSTRAINT media_storage_locations_namespace_check;
ALTER TABLE public.media_storage_locations ADD CONSTRAINT media_storage_locations_namespace_check CHECK ((namespace = ANY (ARRAY['avatar'::text, 'portfolio'::text, 'certificate'::text, 'product'::text, 'organization'::text, 'request'::text, 'verification'::text])));

CREATE OR REPLACE FUNCTION app.media_metadata(p_namespace text, p_key text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object('owner',owner_user_id,'contentType',content_type,'state',state,'createdAt',created_at)
  from public.portfolio_items where p_namespace='portfolio' and object_key=p_key
  union all
  select jsonb_build_object('owner',owner_user_id,'contentType',content_type,'state',state,'createdAt',created_at)
  from public.professional_certificates where p_namespace='certificate' and object_path=p_key
  union all
  select jsonb_build_object('owner',owner_user_id,'contentType',content_type,'state',state,'createdAt',created_at)
  from public.avatar_uploads where p_namespace='avatar' and object_key=p_key
  union all
  select jsonb_build_object('owner',created_by,'organization',organization_id,'contentType',content_type,'state',state,'createdAt',created_at)
  from public.product_images where p_namespace='product' and object_key=p_key
  union all
  select jsonb_build_object('owner',created_by,'organization',organization_id,'contentType',content_type,'state',state,'createdAt',created_at)
  from public.organization_images where p_namespace='organization' and object_key=p_key
  union all
  select jsonb_build_object('owner',i.created_by,'organization',r.requester_org_id,'contentType',i.content_type,'state',i.state,'createdAt',i.created_at)
  from public.purchase_request_images i join public.purchase_requests r on r.id=i.request_id
  where p_namespace='request' and i.object_key=p_key
  union all
  select jsonb_build_object('owner',created_by,'organization',organization_id,'contentType',content_type,'state',state,'createdAt',created_at)
  from public.business_verification_documents where p_namespace='verification' and object_key=p_key;
$function$;

CREATE OR REPLACE FUNCTION public.media_cleanup_candidates(p_limit integer DEFAULT 25)
 RETURNS TABLE(namespace text, object_key text, owner_user_id uuid, provider text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with candidates as (
    select 'portfolio'::text ns,object_key key,owner_user_id owner,created_at from public.portfolio_items
      where state='deleted' or (state='pending' and created_at<now()-interval '24 hours')
    union all select 'certificate',object_path,owner_user_id,created_at from public.professional_certificates
      where state='deleted' or (state='pending' and created_at<now()-interval '24 hours')
    union all select 'avatar',object_key,owner_user_id,created_at from public.avatar_uploads
      where state='deleted' or (state='pending' and created_at<now()-interval '24 hours')
    union all select 'product',object_key,created_by,created_at from public.product_images
      where state='deleted' or (state='pending' and created_at<now()-interval '24 hours')
    union all select 'organization',object_key,created_by,created_at from public.organization_images
      where state='deleted' or (state='pending' and created_at<now()-interval '24 hours')
    union all select 'request',object_key,created_by,created_at from public.purchase_request_images
      where state='deleted' or (state='pending' and created_at<now()-interval '24 hours')
    union all select 'verification',object_key,created_by,created_at from public.business_verification_documents
      where submission_id is null and (state='deleted' or (state='pending' and created_at<now()-interval '24 hours'))
  ) select c.ns,c.key,c.owner,coalesce(l.provider,'supabase') from candidates c
    join public.media_storage_locations l on l.namespace=c.ns and l.object_key=c.key
    where l.provider='r2' and l.cleaned_at is null
    order by c.created_at limit least(greatest(p_limit,1),100);
$function$;

CREATE OR REPLACE FUNCTION public.media_edge_public(p_namespace text, p_id uuid, p_variant text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claims text := current_setting('request.jwt.claims',true);
  v_sub text := current_setting('request.jwt.claim.sub',true);
  v_role text := current_setting('request.jwt.claim.role',true);
  v_key text;
begin
  if p_id is null or p_variant is null or p_namespace is null or p_namespace not in ('portfolio','avatar') then return null; end if;
  perform set_config('request.jwt.claims','',true);
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claim.role','anon',true);
  if p_namespace='portfolio' then
    v_key := public.public_portfolio_media_key(p_id);
    if v_key is not null and not app.is_published_portfolio_object(v_key) then v_key := null; end if;
  else
    -- Current avatar only while its profile is listed (active, not deleted, professional).
    select au.object_key into v_key from public.profile_public_directory d
      join public.avatar_uploads au on au.id=d.avatar_media_id
      where d.id=p_id and au.state='ready' and app.is_current_avatar_object(au.object_key);
  end if;
  perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
  perform set_config('request.jwt.claim.sub',coalesce(v_sub,''),true);
  perform set_config('request.jwt.claim.role',coalesce(v_role,''),true);
  if v_key is null then return null; end if;
  return app.media_edge_grant(p_namespace,v_key,p_variant);
end;
$function$;

CREATE OR REPLACE FUNCTION public.media_cleanup_retire(p_namespace text, p_key text, p_owner uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_namespace='portfolio' then
    update public.portfolio_items set visibility='private',state='deleted'
      where object_key=p_key and owner_user_id=p_owner and (state='deleted' or (state='pending' and created_at<now()-interval '24 hours'));
  elsif p_namespace='certificate' then
    update public.professional_certificates set state='deleted'
      where object_path=p_key and owner_user_id=p_owner and (state='deleted' or (state='pending' and created_at<now()-interval '24 hours'));
  elsif p_namespace='avatar' then
    update public.avatar_uploads set state='deleted'
      where object_key=p_key and owner_user_id=p_owner and (state='deleted' or (state='pending' and created_at<now()-interval '24 hours'));
  elsif p_namespace='product' then
    update public.product_images set state='deleted' where object_key=p_key and created_by=p_owner
      and (state='deleted' or (state='pending' and created_at<now()-interval '24 hours'));
  elsif p_namespace='organization' then
    update public.organization_images set state='deleted' where object_key=p_key and created_by=p_owner
      and (state='deleted' or (state='pending' and created_at<now()-interval '24 hours'));
  elsif p_namespace='request' then
    update public.purchase_request_images set state='deleted' where object_key=p_key and created_by=p_owner
      and (state='deleted' or (state='pending' and created_at<now()-interval '24 hours'));
  elsif p_namespace='verification' then
    update public.business_verification_documents set state='deleted' where object_key=p_key and created_by=p_owner
      and submission_id is null and (state='deleted' or (state='pending' and created_at<now()-interval '24 hours'));
  else raise exception 'invalid namespace' using errcode='22023'; end if;
  if not found then raise exception 'cleanup snapshot is stale' using errcode='42501'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.media_storage_resolve(p_namespace text, p_key text, p_operation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m jsonb; v_provider text; v_owner boolean; v_allowed boolean := false;
begin
  if p_namespace in ('product','organization','request','verification') then
    return public.organization_media_resolve(p_namespace,p_key,p_operation,null);
  end if;
  m := app.media_metadata(p_namespace,p_key);
  if m is null then return null; end if;
  v_owner := (m->>'owner')::uuid = (select auth.uid());
  if p_operation='upload' then
    v_allowed := v_owner and m->>'state'='pending' and app.account_is_active((select auth.uid()))
      and (m->>'createdAt')::timestamptz > now()-interval '24 hours';
  elsif p_operation='delete' then
    v_allowed := v_owner and m->>'state'='deleted';
  elsif p_operation='read' then
    v_allowed := (v_owner and m->>'state'<>'deleted')
      or (p_namespace='portfolio' and app.is_published_portfolio_object(p_key))
      or (p_namespace='avatar' and app.is_current_avatar_object(p_key));
  end if;
  if not coalesce(v_allowed,false) then return null; end if;
  select provider into v_provider from public.media_storage_locations
    where namespace=p_namespace and object_key=p_key;
  return jsonb_build_object('provider',coalesce(v_provider,'supabase'),'reserved',v_provider is not null,
    'contentType',m->>'contentType','state',m->>'state','owner',case when v_owner then m->>'owner' else null end);
end;
$function$;

CREATE OR REPLACE FUNCTION app.media_storage_key_for(p_namespace text, p_key text, p_owner uuid, p_org uuid)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  u constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  f text[]; v_product text; v_request text;
begin
  f := regexp_match(p_key,'(?:^|/)('||u||')\.([a-z0-9]{2,5})$');
  if f is null or p_owner is null then raise exception 'unexpected media key' using errcode='22023'; end if;
  case p_namespace
    when 'avatar' then return 'u/'||p_owner||'/profile/'||f[1]||'/original.'||f[2];
    when 'portfolio' then return 'u/'||p_owner||'/portfolio/'||f[1]||'/original.'||f[2];
    when 'certificate' then return 'u/'||p_owner||'/certificates/'||f[1]||'/original.'||f[2];
    when 'product' then
      v_product := (regexp_match(p_key,'^'||u||'/('||u||')/'||u||'\.[a-z0-9]{2,5}$'))[1];
      if v_product is null then raise exception 'unexpected media key' using errcode='22023'; end if;
      return case when p_org is not null then 'o/'||p_org else 'u/'||p_owner end
        ||'/products/'||v_product||'/'||f[1]||'/original.'||f[2];
    when 'organization' then
      if p_org is null then raise exception 'unexpected media key' using errcode='22023'; end if;
      return 'o/'||p_org||'/profile/'||f[1]||'/original.'||f[2];
    when 'request' then
      v_request := (regexp_match(p_key,'^'||u||'/('||u||')/'||u||'\.[a-z0-9]{2,5}$'))[1];
      if v_request is null then raise exception 'unexpected media key' using errcode='22023'; end if;
      return case when p_org is not null then 'o/'||p_org else 'u/'||p_owner end
        ||'/requests/'||v_request||'/'||f[1]||'/original.'||f[2];
    when 'verification' then
      if p_org is null then raise exception 'unexpected media key' using errcode='22023'; end if;
      return 'o/'||p_org||'/verification/'||f[1]||'/original.'||f[2];
    else raise exception 'invalid namespace' using errcode='22023';
  end case;
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
  if p_namespace not in ('product','organization','request','verification') or v_uid is null
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
    else
      allowed:=m->>'state'='ready' and exists(select 1 from public.organization_images i
        join public.organizations o on o.logo_media_id=i.id where i.object_key=p_key and app.is_org_member(o.id));
    end if;
  elsif p_operation='delete' then
    allowed:=m->>'state'='deleted' and case p_namespace
      when 'product' then app.can_write_catalog((m->>'organization')::uuid)
      when 'request' then app.can_delete_request_image_object(p_key)
      when 'verification' then app.can_delete_bv_object(p_key)
      else app.has_capability((m->>'organization')::uuid,'org.manage') end;
  end if;
  if not coalesce(allowed,false) then return null; end if;
  select provider into v_provider from public.media_storage_locations where namespace=p_namespace and object_key=p_key;
  return jsonb_build_object('provider',coalesce(v_provider,'supabase'),'reserved',v_provider is not null,
    'contentType',m->>'contentType','state',m->>'state',
    'owner',case when p_operation='upload' or (m->>'owner')::uuid=v_uid then m->>'owner' else null end);
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
  v_limit := case p_namespace when 'avatar' then 3145728 when 'portfolio' then 5242880 when 'certificate' then 10485760
    when 'product' then 5242880 when 'organization' then 3145728 when 'request' then 5242880 when 'verification' then 10485760 end;
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

CREATE OR REPLACE FUNCTION public.media_edge_authorize(p_namespace text, p_key text, p_variant text, p_viewer uuid, p_session uuid, p_workspace uuid, p_expires_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claims text := current_setting('request.jwt.claims',true);
  v_sub text := current_setting('request.jwt.claim.sub',true);
  v_role text := current_setting('request.jwt.claim.role',true);
  m jsonb;
begin
  if p_namespace is null or p_namespace not in ('avatar','portfolio','certificate','product','organization','request','verification')
    or p_key is null or length(p_key)>256 or p_variant is null or p_viewer is null or p_session is null
    -- The ticket expiry is enforced here too, independent of the Worker clock:
    -- at most 120 s lifetime, 5 s skew.
    or p_expires_at is null or p_expires_at < now()-interval '5 seconds'
    or p_expires_at > now()+interval '125 seconds' then
    return null;
  end if;
  if not app.account_is_active(p_viewer) then return null; end if;
  -- Sign-out (any scope) deletes the session row; bans and deletion end it too.
  if not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
      where s.id=p_session and s.user_id=p_viewer and (s.not_after is null or s.not_after>now())
        and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())) then
    return null;
  end if;
  perform set_config('request.jwt.claim.sub',p_viewer::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_viewer,'role','authenticated',
    'session_id',p_session)::text,true);
  if p_namespace in ('product','organization','request','verification') then
    m := public.organization_media_resolve(p_namespace,p_key,'read',p_workspace);
  else
    m := public.media_storage_resolve(p_namespace,p_key,'read');
    -- Parity with /api/media: personal media is owner-only; public reads use Mode C.
    if (m->>'owner')::uuid is distinct from p_viewer then m := null; end if;
  end if;
  perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
  perform set_config('request.jwt.claim.sub',coalesce(v_sub,''),true);
  perform set_config('request.jwt.claim.role',coalesce(v_role,''),true);
  if m is null or m->>'state'<>'ready' or m->>'provider'<>'r2' then return null; end if;
  return app.media_edge_grant(p_namespace,p_key,p_variant);
end;
$function$;

commit;
