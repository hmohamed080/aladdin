-- ===========================================================================
-- Marketplace — Migration 07: safe product-image removal lifecycle
-- ===========================================================================
-- THE DEFECT THIS FIXES (found by the Migration 06 audit, reproduced over the
-- real Storage HTTP API). `marketplace_seller_image_remove` deleted the image
-- row IMMEDIATELY and returned the object key so the caller could delete the
-- bytes. But Supabase Storage reads an object before it deletes it, as the
-- caller, and the read is authorised by `marketplace_images_select_member` —
-- which needs the very row that had just been deleted. So the bytes were
-- refused ("Access denied"), stayed in the private bucket forever, and the app
-- ignored the failure: orphaned objects, silently.
--
-- THE FIX — a TWO-PHASE removal, with the authorising row kept until the bytes
-- are really gone:
--
--   phase 1  marketplace_seller_image_remove(image)       MARK for removal
--            The row stays (so Storage can still authorise the caller) but moves
--            to upload_state = 'deleting' and status = 'rejected', is_primary =
--            false: it disappears from every product, readiness and public read
--            at once. If it was the primary image the next confirmed product
--            image is promoted; a published product left without a publishable
--            state is unpublished. Idempotent: repeating it changes nothing.
--   phase 2  Storage API DELETE of the object (the caller's own session)
--            Allowed by the delete policy ONLY for a row in 'awaiting_upload' or
--            'deleting', and ONLY to a catalogue manager of the row's product
--            organization. A confirmed (live) image can never be deleted here.
--   phase 3  marketplace_seller_image_remove_finalize(image)   FORGET the row
--            Succeeds only if the row is 'deleting' AND the object is truly
--            absent from storage. If the bytes are still there it refuses and
--            the row stays, so a failed phase 2 is retried, never forgotten.
--
-- Nothing is ever reported as removed unless the bytes are gone.
--
-- ALSO HARDENED HERE
--   * The delete predicate no longer derives the organization from the object
--     PATH (a text -> uuid cast that raised an exception on a malformed key).
--     Authorisation now comes only from the server-issued row; a malformed or
--     unknown key simply matches nothing and is refused cleanly.
--   * Upload authorisation is short-lived: a server-issued key accepts bytes for
--     one hour, then the seller must request a new one.
--   * Upload abuse limits: at most 10 un-uploaded keys per product at once, at
--     most 200 new keys per organization per hour. Expired un-uploaded keys of
--     a product are swept into the removal lifecycle on its next request.
--   * A removed image can never be re-confirmed or re-arranged.
--
-- WHAT STAYS CLOSED. media_verification_ready is untouched (false); nothing here
-- publishes, verifies or exposes a file; no client gains a table write grant; no
-- storage SELECT/DELETE policy is widened — the delete policy is, if anything,
-- narrower than before (it no longer admits row-less keys by path).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. One more upload state
-- ---------------------------------------------------------------------------
alter table public.marketplace_product_images drop constraint ck_marketplace_images_upload_state;
alter table public.marketplace_product_images
  add constraint ck_marketplace_images_upload_state
  check (upload_state in ('awaiting_upload', 'confirmed', 'deleting'));
comment on column public.marketplace_product_images.upload_state is
  'awaiting_upload: a server-issued key the seller may upload to (valid for one hour), bytes not yet confirmed. confirmed: the object was found in storage by marketplace_seller_image_confirm_upload. deleting: withdrawn by the seller; the row is kept ONLY so Storage can still authorise deleting the bytes, and is forgotten by marketplace_seller_image_remove_finalize once the object is gone (always together with status = rejected). Independent of `status` (the CONTENT review), which an upload never sets.';

-- ---------------------------------------------------------------------------
-- 2. Storage predicates (same names / signatures / grants as Migration 06)
-- ---------------------------------------------------------------------------
-- Upload: a server-issued, still-fresh key for a catalogue manager of an enabled seller.
create or replace function app.marketplace_storage_can_upload_image(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.marketplace_product_images i
    join public.marketplace_products p on p.id = i.product_id
    where i.storage_bucket = 'marketplace-product-images' and i.object_key = p_key
      and i.upload_state = 'awaiting_upload'
      and i.created_at > now() - interval '1 hour'
      and app.marketplace_can_manage_catalog(p.seller_organization_id)
      and app.marketplace_seller_is_enabled(p.seller_organization_id));
$$;

-- Delete: ONLY the bytes of a row that is awaiting upload or marked for removal,
-- and ONLY for a catalogue manager of that row's organization. The organization
-- comes from the row, never from the object path; a malformed / unknown key
-- matches no row and is refused without raising.
create or replace function app.marketplace_storage_can_delete_image(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1 from public.marketplace_product_images i
       join public.marketplace_products p on p.id = i.product_id
       where i.storage_bucket = 'marketplace-product-images' and i.object_key = p_key
         and i.upload_state in ('awaiting_upload', 'deleting')
         and app.marketplace_can_manage_catalog(p.seller_organization_id));
$$;

-- ---------------------------------------------------------------------------
-- 3. Upload request: abuse limits + expiry sweep
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_seller_image_request_upload(
  p_product_id uuid, p_content_type text, p_variant_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
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
  perform app.marketplace_assert_seller_writer(v_org);
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
    (id, product_id, variant_id, storage_provider, storage_bucket, object_key, sort_order, is_primary, status, mime_type, upload_state)
  values (v_id, p_product_id, p_variant_id, 'supabase_storage', 'marketplace-product-images', v_key, v_sort, false,
          'pending', p_content_type, 'awaiting_upload');
  return jsonb_build_object('image_id', v_id, 'bucket', 'marketplace-product-images', 'object_key', v_key);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Confirm / arrange: a removed image can never come back
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_seller_image_confirm_upload(p_image_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i      public.marketplace_product_images;
  v_org  uuid;
  o      record;
  v_primary boolean;
begin
  select * into i from public.marketplace_product_images where id = p_image_id for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  select seller_organization_id into v_org from public.marketplace_products where id = i.product_id;
  perform app.marketplace_assert_seller_writer(v_org);
  if i.upload_state = 'deleting' then
    raise exception 'mp:image_removed' using errcode = '23514';
  end if;
  if i.upload_state = 'confirmed' then
    return jsonb_build_object('image_id', i.id, 'upload_state', 'confirmed', 'status', i.status);
  end if;

  select so.metadata into o from storage.objects so
   where so.bucket_id = i.storage_bucket and so.name = i.object_key;
  if not found then
    raise exception 'mp:upload_not_found' using errcode = '23514';
  end if;

  -- the first confirmed product-level image becomes the primary one
  v_primary := i.variant_id is null and not exists (
    select 1 from public.marketplace_product_images x
    where x.product_id = i.product_id and x.variant_id is null and x.is_primary and x.status <> 'rejected');
  update public.marketplace_product_images set
    upload_state = 'confirmed',
    is_primary = v_primary,
    byte_size = nullif(o.metadata ->> 'size', '')::bigint,
    mime_type = coalesce(nullif(o.metadata ->> 'mimetype', ''), i.mime_type)
  where id = i.id;
  return jsonb_build_object('image_id', i.id, 'upload_state', 'confirmed', 'status', 'pending', 'is_primary', v_primary);
end;
$$;

create or replace function public.marketplace_seller_images_update(p_product_id uuid, p_images jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- ---------------------------------------------------------------------------
-- 5. Removal, phase 1: mark (idempotent) — returns the object key to delete
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_seller_image_remove(p_image_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  i          public.marketplace_product_images;
  v_org      uuid;
  v_uid      uuid;
  v_was_primary boolean;
  v_status   text;
  v_blockers text[];
begin
  select * into i from public.marketplace_product_images where id = p_image_id for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  select seller_organization_id into v_org from public.marketplace_products where id = i.product_id;
  v_uid := app.marketplace_assert_seller_writer(v_org);

  -- a retry of an already-marked removal is not an error and changes nothing
  if i.upload_state = 'deleting' then
    return i.object_key;
  end if;

  v_was_primary := i.is_primary and i.variant_id is null;
  update public.marketplace_product_images
     set upload_state = 'deleting', status = 'rejected', is_primary = false
   where id = i.id;

  -- the primary image is replaced by the next confirmed product-level image
  if v_was_primary then
    update public.marketplace_product_images set is_primary = true
     where id = (select x.id from public.marketplace_product_images x
                 where x.product_id = i.product_id and x.variant_id is null
                   and x.upload_state = 'confirmed' and x.status <> 'rejected'
                 order by x.sort_order, x.created_at limit 1);
  end if;

  -- a published product that is no longer publishable leaves the shelf
  select status into v_status from public.marketplace_products where id = i.product_id for update;
  if v_status = 'published' then
    v_blockers := app.marketplace_publication_blockers(i.product_id);
    if cardinality(v_blockers) > 0 then
      update public.marketplace_products set status = 'unpublished' where id = i.product_id;
      insert into public.marketplace_product_status_events (product_id, organization_id, action, from_status, to_status, actor_user_id)
      values (i.product_id, v_org, 'unpublished', 'published', 'unpublished', v_uid);
    end if;
  end if;
  return i.object_key;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Removal, phase 3: forget the row — only when the bytes are really gone
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_seller_image_remove_finalize(p_image_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i     public.marketplace_product_images;
  v_org uuid;
begin
  select * into i from public.marketplace_product_images where id = p_image_id for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  select seller_organization_id into v_org from public.marketplace_products where id = i.product_id;
  perform app.marketplace_assert_seller_writer(v_org);
  -- a live image can only leave through phase 1
  if i.upload_state <> 'deleting' then
    raise exception 'mp:image_not_marked_for_removal' using errcode = '23514';
  end if;
  if exists (select 1 from storage.objects so where so.bucket_id = i.storage_bucket and so.name = i.object_key) then
    raise exception 'mp:object_still_present' using errcode = '23514';
  end if;
  delete from public.marketplace_product_images where id = i.id;
  return jsonb_build_object('removed', true, 'image_id', i.id, 'object_key', i.object_key);
end;
$$;

-- Images of a product whose removal was marked but not finished (so a failed
-- delete is visible and can be retried instead of forgotten).
create or replace function public.marketplace_seller_images_pending_removal(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select seller_organization_id into v_org from public.marketplace_products where id = p_product_id;
  if v_org is null then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  perform app.marketplace_assert_seller_reader(v_org);
  return coalesce((select jsonb_agg(jsonb_build_object('image_id', i.id, 'variant_id', i.variant_id) order by i.created_at)
                   from public.marketplace_product_images i
                   where i.product_id = p_product_id and i.upload_state = 'deleting'), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants (new functions only; replaced ones keep their Migration 06 grants)
-- ---------------------------------------------------------------------------
revoke all on function
  public.marketplace_seller_image_remove_finalize(uuid),
  public.marketplace_seller_images_pending_removal(uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.marketplace_seller_image_remove_finalize(uuid),
  public.marketplace_seller_images_pending_removal(uuid)
  to authenticated;
