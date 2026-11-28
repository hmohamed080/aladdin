-- Synthetic receipt for metadata/lifecycle fixtures, not evidence of real bytes.
-- Actual content verification is exercised by the backend/local HTTP suites.
create function pg_temp.attest_organization_fixture(ns text,key text) returns void
language sql security definer set search_path='' as $$
  insert into public.media_storage_locations(namespace,object_key,owner_user_id,organization_id,provider,content_type,size_bytes,sha256,verified_at)
  select 'product',object_key,created_by,organization_id,'supabase',content_type,100,repeat('a',64),now()
    from public.product_images where ns='product' and object_key=key and state='pending' and app.can_upload_product_image_object(key)
  union all
  select 'organization',object_key,created_by,organization_id,'supabase',content_type,100,repeat('a',64),now()
    from public.organization_images where ns='organization' and object_key=key and state='pending' and app.can_upload_organization_image_object(key)
  on conflict(namespace,object_key) do nothing;
$$;
