-- ===========================================================================
-- Marketplace — Migration 09: catalog launch (admin, moderation, delivery, scale)
-- ===========================================================================
-- WHAT THIS ADDS, for the first real seller's catalog launch:
--
--   ADMIN SELLERS    admin_marketplace_seller_overview(): every live showroom with
--                    its seller standing and Marketplace product counts (read perm).
--   MEDIA MODERATION a new permission `marketplace_media.moderate`; image columns
--                    for byte-level validation and the moderation decision; an
--                    append-only moderation trail; a moderator-only storage READ
--                    policy (preview + server-side decoding under the admin's own
--                    session); validate / approve / reject RPCs. Approval REQUIRES
--                    a recent successful validation whose byte size matches the
--                    stored object — an approved seller never makes an image
--                    verified, and a batch cannot skip validation.
--   MEDIA SWITCH     admin_marketplace_set_media_verification_ready(): the platform
--                    flag is changed only by a moderator, with a reason, audited.
--   PUBLIC DELIVERY  marketplace_public_image_ref(): SERVICE-ROLE ONLY. It returns a
--                    storage reference only for a verified, confirmed image of a
--                    published product of an enabled seller while the media flag is
--                    on. The public image route streams bytes server-side, so no
--                    storage key or signed URL ever reaches a browser.
--   PUBLIC CATALOG   marketplace_public_catalog_page() / _facets(): server-side
--                    paging, search, category / type filters, totals, seller name.
--                    marketplace_public_product() gains seller and taxonomy names.
--   SELLER AT SCALE  marketplace_seller_products_page(): paged, filtered, counted in
--                    SQL — never the whole catalogue in one response.
--   IMPORT (seller)  marketplace_seller_import_step(): ONE authenticated dispatcher
--                    over the Migration 05 worker steps, re-checking the seller on
--                    every call, so the import runs under the seller's own session
--                    with no service credential. Import images go to a per-job
--                    storage prefix that only a catalogue manager of that job's
--                    organization may write; staging an asset now requires the bytes
--                    to EXIST under that job's prefix (no attaching another seller's
--                    object). Import rows may carry an initial `quantity`, entered
--                    once through the stock ledger.
--   PUBLISH READY    marketplace_seller_publish_ready(): publishes, through the
--                    existing per-product publish rule, every product of the seller
--                    whose blocker list is empty; reports the rest by reason.
--   PRIMARY IMAGE    a product with NO product-level image may satisfy the image
--                    rule with a verified image of one of its active variants (an
--                    import of `SKU_01.jpg` files names variants, not products).
--
-- UNCHANGED: media_verification_ready stays FALSE here; no seller is approved;
-- B2B tables are not touched.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Permission (Super Admin locked + Administrator)
-- ---------------------------------------------------------------------------
insert into public.admin_permissions (key, resource, action, description, sort_order) values
  ('marketplace_media.moderate', 'marketplace_media', 'moderate',
   'Review, validate, approve and reject Marketplace product images; switch public media delivery.', 112)
on conflict (key) do nothing;
insert into public.admin_role_permissions (role_id, permission_key, is_locked)
select r.id, 'marketplace_media.moderate', r.key = 'super_admin'
from public.admin_roles r
where r.is_system and r.key in ('super_admin', 'administrator')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Moderation columns + trails
-- ---------------------------------------------------------------------------
alter table public.marketplace_product_images
  add column content_valid      boolean,
  add column content_format     text,
  add column content_checked_at timestamptz,
  add column moderated_at       timestamptz,
  add column moderated_by       uuid,
  add column moderation_reason  text,
  add constraint ck_marketplace_images_content_format check (content_format is null or content_format in ('jpeg', 'png', 'webp')),
  add constraint ck_marketplace_images_moderation_reason check (moderation_reason is null or char_length(moderation_reason) <= 300);
comment on column public.marketplace_product_images.content_valid is
  'Result of the server-side byte-level validation (format signature + full decode + dimensions). Approval requires TRUE, recorded recently, with a byte size equal to the stored object.';

create table public.marketplace_image_moderation_events (
  id              uuid        primary key default gen_random_uuid(),
  sequence        bigint      generated always as identity,
  image_id        uuid        not null,
  product_id      uuid        not null,
  organization_id uuid        not null,
  action          text        not null,
  detail          jsonb       not null default '{}'::jsonb,
  actor_user_id   uuid,
  created_at      timestamptz not null default now(),
  constraint ck_marketplace_moderation_action check (action in ('validated', 'approved', 'rejected'))
);
comment on table public.marketplace_image_moderation_events is
  'Append-only trail of image validation and moderation decisions (no FK: the trail outlives a removed image).';
create index ix_marketplace_moderation_events_image on public.marketplace_image_moderation_events (image_id, sequence);

create table public.marketplace_platform_events (
  id            uuid        primary key default gen_random_uuid(),
  sequence      bigint      generated always as identity,
  action        text        not null,
  detail        jsonb       not null default '{}'::jsonb,
  actor_user_id uuid,
  created_at    timestamptz not null default now(),
  constraint ck_marketplace_platform_action check (action in ('media_verification_enabled', 'media_verification_disabled'))
);
comment on table public.marketplace_platform_events is 'Append-only trail of Marketplace platform switches.';

create trigger marketplace_moderation_events_append_only before update or delete on public.marketplace_image_moderation_events
  for each row execute function app.marketplace_append_only();
create trigger marketplace_platform_events_append_only before update or delete on public.marketplace_platform_events
  for each row execute function app.marketplace_append_only();
alter table public.marketplace_image_moderation_events enable row level security;
alter table public.marketplace_platform_events enable row level security;
revoke all on public.marketplace_image_moderation_events, public.marketplace_platform_events
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_assert_admin_permission(p_permission text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  if not app.has_admin_permission(p_permission) then
    raise exception 'mp:not_permitted' using errcode = '42501';
  end if;
  return (select auth.uid());
end;
$$;

-- The product image rule: a verified product-level primary image, or — for a
-- product with NO live product-level image — a verified image of an active variant.
create or replace function app.marketplace_product_has_publishable_image(p_product_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.marketplace_product_images i
                 where i.product_id = p_product_id and i.variant_id is null and i.is_primary
                   and i.status = 'verified' and i.upload_state = 'confirmed')
      or (not exists (select 1 from public.marketplace_product_images i
                      where i.product_id = p_product_id and i.variant_id is null
                        and i.status <> 'rejected' and i.upload_state = 'confirmed')
          and exists (select 1 from public.marketplace_product_images i
                      join public.marketplace_product_variants v on v.id = i.variant_id and v.status = 'active'
                      where i.product_id = p_product_id and i.status = 'verified' and i.upload_state = 'confirmed'));
$$;

-- The image a customer sees first: the verified product primary, else the first verified variant image.
create or replace function app.marketplace_product_cover_image(p_product_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select i.id from public.marketplace_product_images i
  left join public.marketplace_product_variants v on v.id = i.variant_id
  where i.product_id = p_product_id and i.status = 'verified' and i.upload_state = 'confirmed'
    and (i.variant_id is null or v.status = 'active')
  order by (i.variant_id is not null), (not i.is_primary), i.sort_order, i.created_at
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 4. Admin: sellers overview
-- ---------------------------------------------------------------------------
create or replace function public.admin_marketplace_seller_overview()
returns table (
  organization_id uuid, organization_name text, org_status text, eligible boolean,
  seller_status text, status_reason text, status_changed_at timestamptz,
  approved_at timestamptz, approved_by_name text,
  products_total bigint, products_published bigint, products_draft bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (app.has_admin_permission('marketplace_sellers.read') or app.has_admin_permission('marketplace_sellers.manage')) then
    raise exception 'mp:not_permitted' using errcode = '42501';
  end if;
  return query
    select o.id, o.name, o.status::text, app.marketplace_seller_is_eligible(o.id),
           a.status, a.status_reason, a.status_changed_at, a.approved_at,
           (select p.display_name from public.profiles p where p.user_id = a.approved_by),
           (select count(*) from public.marketplace_products mp where mp.seller_organization_id = o.id),
           (select count(*) from public.marketplace_products mp where mp.seller_organization_id = o.id and mp.status = 'published'),
           (select count(*) from public.marketplace_products mp where mp.seller_organization_id = o.id and mp.status = 'draft')
    from public.organizations o
    left join public.marketplace_seller_accounts a on a.organization_id = o.id
    where o.deleted_at is null and (o.org_type::text = 'showroom_dealer' or a.organization_id is not null)
    order by (a.status = 'approved') desc nulls last, a.status_changed_at desc nulls last, o.name;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Storage predicates + policies (moderator read, import upload)
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_storage_moderator_can_read(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_admin_permission('marketplace_media.moderate')
     and exists (select 1 from public.marketplace_product_images i
                 where i.storage_bucket = 'marketplace-product-images' and i.object_key = p_key
                   and i.upload_state = 'confirmed');
$$;

-- imports/<organization uuid>/<job uuid>/<file name>: only a catalogue manager of
-- that organization, an enabled seller, while the job is still accepting files.
create or replace function app.marketplace_storage_can_upload_import(p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org text := split_part(p_key, '/', 2);
  v_job text := split_part(p_key, '/', 3);
begin
  if split_part(p_key, '/', 1) <> 'imports' or split_part(p_key, '/', 4) = '' or split_part(p_key, '/', 5) <> ''
     or v_org !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_job !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (select 1 from public.marketplace_import_jobs j
                 where j.id = v_job::uuid and j.organization_id = v_org::uuid
                   and j.status in ('created', 'staging'))
     and app.marketplace_can_manage_catalog(v_org::uuid)
     and app.marketplace_seller_is_enabled(v_org::uuid);
end;
$$;

create policy marketplace_images_select_moderator on storage.objects
  for select to authenticated
  using (bucket_id = 'marketplace-product-images' and app.marketplace_storage_moderator_can_read(name));
create policy marketplace_import_assets_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'marketplace-product-images' and app.marketplace_storage_can_upload_import(name));

-- ---------------------------------------------------------------------------
-- 6. Admin: media moderation
-- ---------------------------------------------------------------------------
create or replace function public.admin_marketplace_media_queue(
  p_status text default 'pending', p_limit integer default 48, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text := coalesce(nullif(p_status, ''), 'pending');
  v_limit  integer := least(greatest(coalesce(p_limit, 48), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total  bigint;
  v_items  jsonb;
begin
  perform app.marketplace_assert_admin_permission('marketplace_media.moderate');
  if v_status not in ('pending', 'verified', 'rejected') then
    raise exception 'mp:invalid_status' using errcode = '22023';
  end if;
  select count(*) into v_total from public.marketplace_product_images i
   where i.status = v_status and i.upload_state = 'confirmed';
  select coalesce(jsonb_agg(x order by x ->> 'created_at', x ->> 'id'), '[]'::jsonb) into v_items from (
    select jsonb_build_object(
      'id', i.id, 'product_id', i.product_id, 'variant_id', i.variant_id,
      'object_key', i.object_key, 'mime_type', i.mime_type, 'byte_size', i.byte_size,
      'is_primary', i.is_primary, 'sort_order', i.sort_order, 'status', i.status,
      'content_valid', i.content_valid, 'content_format', i.content_format,
      'content_checked_at', i.content_checked_at, 'width_px', i.width_px, 'height_px', i.height_px,
      'moderated_at', i.moderated_at, 'moderation_reason', i.moderation_reason, 'created_at', i.created_at,
      'product_name_ar', p.name_ar, 'product_name_en', p.name_en, 'product_status', p.status,
      'sku', v.sku, 'organization_id', p.seller_organization_id, 'organization_name', o.name) as x
    from public.marketplace_product_images i
    join public.marketplace_products p on p.id = i.product_id
    join public.organizations o on o.id = p.seller_organization_id
    left join public.marketplace_product_variants v on v.id = i.variant_id
    where i.status = v_status and i.upload_state = 'confirmed'
    order by i.created_at, i.id
    limit v_limit offset v_offset) q;
  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

-- Records the server's byte-level validation. A VALID result must carry the exact
-- byte size of the stored object (read from storage metadata here), so a verdict
-- cannot be recorded for bytes that are not the ones in storage.
create or replace function public.admin_marketplace_media_record_validation(
  p_image_id uuid, p_valid boolean, p_format text, p_width integer, p_height integer,
  p_byte_size bigint, p_sha256 text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid;
  i      public.marketplace_product_images;
  v_size bigint;
  v_org  uuid;
begin
  v_uid := app.marketplace_assert_admin_permission('marketplace_media.moderate');
  select * into i from public.marketplace_product_images where id = p_image_id for update;
  if not found or i.upload_state <> 'confirmed' then
    raise exception 'mp:image_not_found' using errcode = '42501';
  end if;
  select nullif(so.metadata ->> 'size', '')::bigint into v_size from storage.objects so
   where so.bucket_id = i.storage_bucket and so.name = i.object_key;
  if v_size is null then
    raise exception 'mp:upload_not_found' using errcode = '23514';
  end if;
  if p_valid and (p_byte_size is distinct from v_size
                  or p_format not in ('jpeg', 'png', 'webp')
                  or coalesce(p_width, 0) < 1 or coalesce(p_height, 0) < 1
                  or p_sha256 !~ '^[0-9a-f]{64}$') then
    raise exception 'mp:validation_mismatch' using errcode = '23514';
  end if;
  select seller_organization_id into v_org from public.marketplace_products where id = i.product_id;
  update public.marketplace_product_images set
    content_valid = p_valid,
    content_format = case when p_valid then p_format else null end,
    content_checked_at = now(),
    width_px = case when p_valid then p_width else width_px end,
    height_px = case when p_valid then p_height else height_px end,
    byte_size = v_size,
    checksum_sha256 = case when p_valid then p_sha256 else checksum_sha256 end
  where id = i.id;
  insert into public.marketplace_image_moderation_events (image_id, product_id, organization_id, action, detail, actor_user_id)
  values (i.id, i.product_id, v_org, 'validated',
          jsonb_build_object('valid', p_valid, 'format', p_format, 'width', p_width, 'height', p_height,
                             'byte_size', v_size, 'note', left(p_note, 200)), v_uid);
  return jsonb_build_object('image_id', i.id, 'valid', p_valid);
end;
$$;

-- Approves explicitly selected images. Each one must be confirmed, pending, and
-- carry a SUCCESSFUL validation recorded in the last 15 minutes (the approve
-- action re-validates the bytes immediately before calling this).
create or replace function public.admin_marketplace_media_approve(p_image_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.admin_marketplace_media_reject(p_image_ids uuid[], p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid;
  v_id   uuid;
  i      public.marketplace_product_images;
  p      public.marketplace_products;
  v_out  jsonb := '[]'::jsonb;
  v_res  text;
  v_next uuid;
begin
  v_uid := app.marketplace_assert_admin_permission('marketplace_media.moderate');
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 300 then
    raise exception 'mp:reason_required' using errcode = '22023';
  end if;
  if p_image_ids is null or cardinality(p_image_ids) not between 1 and 100 then
    raise exception 'mp:images_invalid' using errcode = '22023';
  end if;
  foreach v_id in array p_image_ids loop
    select * into i from public.marketplace_product_images where id = v_id for update;
    if not found or i.upload_state <> 'confirmed' then
      v_res := 'not_found';
    elsif i.status = 'rejected' then
      v_res := 'already_rejected';
    else
      select * into p from public.marketplace_products where id = i.product_id for update;
      update public.marketplace_product_images
         set status = 'rejected', is_primary = false, moderated_at = now(), moderated_by = v_uid,
             moderation_reason = btrim(p_reason)
       where id = i.id;
      -- a rejected primary hands the slot to the next live product-level image
      if i.is_primary and i.variant_id is null then
        select x.id into v_next from public.marketplace_product_images x
         where x.product_id = i.product_id and x.variant_id is null and x.status <> 'rejected'
           and x.upload_state = 'confirmed' and x.id <> i.id
         order by x.sort_order limit 1;
        if v_next is not null then
          update public.marketplace_product_images set is_primary = true where id = v_next;
        end if;
      end if;
      insert into public.marketplace_image_moderation_events (image_id, product_id, organization_id, action, detail, actor_user_id)
      values (i.id, i.product_id, p.seller_organization_id, 'rejected', jsonb_build_object('reason', btrim(p_reason)), v_uid);
      -- a published product that no longer qualifies leaves the shelf
      if p.status = 'published' and cardinality(app.marketplace_publication_blockers(p.id)) > 0 then
        update public.marketplace_products set status = 'unpublished' where id = p.id;
        insert into public.marketplace_product_status_events (product_id, organization_id, action, from_status, to_status, actor_user_id)
        values (p.id, p.seller_organization_id, 'unpublished', 'published', 'unpublished', v_uid);
      end if;
      v_res := 'rejected';
    end if;
    v_out := v_out || jsonb_build_object('id', v_id, 'result', v_res);
  end loop;
  return v_out;
end;
$$;

create or replace function public.admin_marketplace_media_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.marketplace_assert_admin_permission('marketplace_media.moderate');
  return jsonb_build_object(
    'media_verification_ready', app.marketplace_media_verification_ready(),
    'pending', (select count(*) from public.marketplace_product_images where status = 'pending' and upload_state = 'confirmed'),
    'verified', (select count(*) from public.marketplace_product_images where status = 'verified' and upload_state = 'confirmed'),
    'rejected', (select count(*) from public.marketplace_product_images where status = 'rejected' and upload_state = 'confirmed'),
    'last_change', (select jsonb_build_object('action', e.action, 'at', e.created_at, 'reason', e.detail ->> 'reason')
                    from public.marketplace_platform_events e order by e.sequence desc limit 1));
end;
$$;

create or replace function public.admin_marketplace_set_media_verification_ready(p_ready boolean, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- ---------------------------------------------------------------------------
-- 7. Public delivery reference (SERVICE ROLE ONLY)
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_public_image_ref(p_image_id uuid)
returns table (storage_bucket text, object_key text, mime_type text, checksum_sha256 text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.storage_bucket, i.object_key, i.mime_type, i.checksum_sha256
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
$$;

-- ---------------------------------------------------------------------------
-- 8. Public catalog: paged list, facets, detail
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_public_catalog_page(
  p_category text default null, p_type text default null, p_query text default null,
  p_sort text default 'newest', p_limit integer default 24, p_offset integer default 0)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with params as (
    select least(greatest(coalesce(p_limit, 24), 1), 60) as lim,
           greatest(coalesce(p_offset, 0), 0) as off,
           nullif(lower(btrim(coalesce(p_query, ''))), '') as q,
           app.marketplace_media_verification_ready() as media
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
               'published_at', x.published_at,
               'image_id', case when (select media from params) then app.marketplace_product_cover_image(x.id) end)
             order by x.ord)
      from page x), '[]'::jsonb));
$$;

create or replace function public.marketplace_public_facets()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('categories', coalesce(jsonb_agg(jsonb_build_object(
           'key', c.key, 'name_ar', c.name_ar, 'name_en', c.name_en, 'count', c.n,
           'types', c.types) order by c.sort_order), '[]'::jsonb))
  from (
    select c.key, c.name_ar, c.name_en, c.sort_order,
           count(p.id) as n,
           coalesce((select jsonb_agg(jsonb_build_object('key', t2.key, 'name_ar', t2.name_ar, 'name_en', t2.name_en,
                                                         'count', (select count(*) from public.marketplace_products p2
                                                                   where p2.product_type_id = t2.id and p2.status = 'published'
                                                                     and app.marketplace_seller_is_enabled(p2.seller_organization_id)))
                                      order by t2.sort_order)
                     from public.marketplace_product_types t2 where t2.category_id = c.id and t2.is_active), '[]'::jsonb) as types
    from public.marketplace_categories c
    join public.marketplace_product_types t on t.category_id = c.id and t.is_active
    left join public.marketplace_products p on p.product_type_id = t.id and p.status = 'published'
         and app.marketplace_seller_is_enabled(p.seller_organization_id)
    where c.is_active
    group by c.id, c.key, c.name_ar, c.name_en, c.sort_order) c;
$$;

create or replace function public.marketplace_public_product(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
$$;

-- ---------------------------------------------------------------------------
-- 9. Seller: paged product list
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_seller_products_page(
  p_organization_id uuid, p_query text default null, p_type text default null, p_status text default null,
  p_stock text default null, p_limit integer default 20, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
$$;

-- ---------------------------------------------------------------------------
-- 10. Seller: import dispatcher + publish-ready
-- ---------------------------------------------------------------------------
-- One authenticated entry to the Migration 05 worker steps. Every call re-checks
-- that the caller may WRITE for the job's organization (member, catalogue
-- authority, enabled seller) and leases the job to this seller session.
create or replace function public.marketplace_seller_import_step(p_job uuid, p_step text, p_payload jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid;
  v_org    uuid;
  v_worker text;
  r        record;
  v_n      integer;
  v_res    jsonb;
begin
  select organization_id into v_org from public.marketplace_import_jobs where id = p_job;
  if v_org is null then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  v_uid := app.marketplace_assert_seller_writer(v_org);
  v_worker := 'seller:' || v_uid::text;

  case p_step
    when 'stage_rows' then
      v_n := public.marketplace_import_stage_rows(p_job, p_payload);
      return jsonb_build_object('added', v_n);
    when 'stage_assets' then
      v_n := app.marketplace_seller_stage_import_assets(p_job, v_org, p_payload);
      return jsonb_build_object('added', v_n);
    when 'seal' then
      return public.marketplace_import_seal(p_job);
    when 'validate', 'apply' then
      if not public.marketplace_import_claim(p_job, v_worker, 300) then
        raise exception 'mp:import_busy' using errcode = '55P03';
      end if;
      if p_step = 'validate' then
        select * into r from public.marketplace_import_validate_next(p_job, v_worker);
      else
        select * into r from public.marketplace_import_apply_next(p_job, v_worker);
      end if;
      return jsonb_build_object('processed', r.processed, 'remaining', r.remaining, 'status', r.job_status);
    when 'complete_dry_run' then
      return jsonb_build_object('status', public.marketplace_import_complete_dry_run(p_job));
    when 'retry_failed' then
      return jsonb_build_object('requeued', public.marketplace_import_retry_failed(p_job));
    else
      raise exception 'mp:invalid_step' using errcode = '22023';
  end case;
end;
$$;

-- Publishes, through the existing per-product rule, every draft / unpublished
-- product of the organization whose blocker list is empty (bounded per call).
create or replace function public.marketplace_seller_publish_ready(p_organization_id uuid, p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid;
  p           record;
  v_blockers  text[];
  v_published integer := 0;
  v_checked   integer := 0;
  v_reasons   jsonb := '{}'::jsonb;
  b           text;
  k           text;
begin
  v_uid := app.marketplace_assert_seller_writer(p_organization_id);
  if not app.can_publish_catalog(p_organization_id) then
    raise exception 'mp:not_permitted' using errcode = '42501';
  end if;
  for p in
    select id from public.marketplace_products
    where seller_organization_id = p_organization_id and status in ('draft', 'unpublished')
    order by created_at
    limit least(greatest(coalesce(p_limit, 200), 1), 1000)
  loop
    v_checked := v_checked + 1;
    v_blockers := app.marketplace_publication_blockers(p.id);
    if cardinality(v_blockers) = 0 then
      perform public.marketplace_product_publish(p.id);
      v_published := v_published + 1;
    else
      foreach b in array v_blockers loop
        k := split_part(b, ':', 1) || case when b like 'missing_%' then ':' || split_part(b, ':', array_length(string_to_array(b, ':'), 1)) else '' end;
        v_reasons := jsonb_set(v_reasons, array[k], to_jsonb(coalesce((v_reasons ->> k)::integer, 0) + 1));
      end loop;
    end if;
  end loop;
  return jsonb_build_object('checked', v_checked, 'published', v_published, 'blocked_by_reason', v_reasons);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10b. Updated definitions (publication image rule, import stock, quantity check)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.marketplace_publication_blockers(p_product_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $$
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
$$;

CREATE OR REPLACE FUNCTION app.marketplace_import_apply_row(p_row_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $$
declare
  v_loc     uuid;
  v_qty     integer;
  r         public.marketplace_import_rows;
  m         public.marketplace_import_rows;
  v_type_id uuid;
  v_master  boolean;
  v_product uuid;
  v_ptype   uuid;
  v_variant uuid;
  v_vprod   uuid;
  v_unit    text;
  v_price   numeric;
  v_created boolean := false;
  v_changed boolean := false;
  v_n       integer;
  a         record;
  img       record;
  v_img     record;
  v_sort    integer;
  v_var_for_img uuid;
  v_primary boolean;
begin
  select * into r from public.marketplace_import_rows where id = p_row_id;
  select t.id into v_type_id
  from public.marketplace_product_types t join public.marketplace_categories c on c.id = t.category_id
  where t.key = r.product_type_key and t.is_active and c.is_active;
  if v_type_id is null then
    raise exception 'product type is not available' using errcode = '23514';
  end if;
  if not app.marketplace_seller_is_enabled(r.organization_id) then
    raise exception 'the seller is not enabled for the Marketplace' using errcode = '23514';
  end if;

  select * into m from public.marketplace_import_rows
   where job_id = r.job_id and external_ref = r.external_ref order by row_number limit 1;
  v_master := m.id = r.id;

  -- product (identified by seller + external_ref)
  select p.id, p.product_type_id into v_product, v_ptype from public.marketplace_products p
   where p.seller_organization_id = r.organization_id and p.external_ref = r.external_ref for update;
  if v_product is null then
    insert into public.marketplace_products
      (seller_organization_id, product_type_id, slug, name_ar, name_en, description_ar, description_en, brand, external_ref, status)
    values (r.organization_id, v_type_id, app.marketplace_import_slug(m.name_en, r.organization_id, r.external_ref),
            m.name_ar, m.name_en, m.description_ar, m.description_en, m.brand, r.external_ref, 'draft')
    returning id into v_product;
    v_created := true;
  else
    if v_ptype is distinct from v_type_id then
      raise exception 'an existing product''s type cannot be changed by import' using errcode = '23514';
    end if;
    if v_master then
      update public.marketplace_products p set
        name_ar = m.name_ar, name_en = m.name_en, description_ar = m.description_ar,
        description_en = m.description_en, brand = m.brand
      where p.id = v_product
        and (p.name_ar, p.name_en, p.description_ar, p.description_en, p.brand)
            is distinct from (m.name_ar, m.name_en, m.description_ar, m.description_en, m.brand);
      get diagnostics v_n = row_count;
      v_changed := v_changed or v_n > 0;      -- status / seller / type are never touched
    end if;
  end if;

  -- variant (identified by seller + sku)
  select v.id, v.product_id, v.selling_unit, v.price_egp into v_variant, v_vprod, v_unit, v_price
  from public.marketplace_product_variants v
  where v.seller_organization_id = r.organization_id and v.sku = r.sku for update;
  if v_variant is null then
    insert into public.marketplace_product_variants (product_id, seller_organization_id, sku, selling_unit, price_egp)
    values (v_product, r.organization_id, r.sku, r.selling_unit, r.price_egp)
    returning id into v_variant;
    v_created := true;
  else
    if v_vprod <> v_product then
      raise exception 'this SKU belongs to a different product' using errcode = '23514';
    end if;
    if v_unit <> r.selling_unit then
      raise exception 'the selling unit of an existing variant cannot be changed by import' using errcode = '23514';
    end if;
    if v_price is distinct from r.price_egp then
      update public.marketplace_product_variants set price_egp = r.price_egp where id = v_variant;
      v_changed := true;
    end if;
  end if;

  -- attribute values (product-level ones come from the product's first row only)
  for a in
    select d.id as def_id, d.key, d.data_type, ta.level
    from public.marketplace_product_type_attributes ta
    join public.marketplace_attribute_definitions d on d.id = ta.attribute_id
    where ta.product_type_id = v_type_id and ta.is_active and d.is_active and r.attributes ? d.key
  loop
    if a.level = 'product' then
      continue when not v_master;
      v_changed := app.marketplace_import_apply_attribute('product', v_product, a.def_id, a.data_type, r.attributes -> a.key) or v_changed;
    else
      v_changed := app.marketplace_import_apply_attribute('variant', v_variant, a.def_id, a.data_type, r.attributes -> a.key) or v_changed;
    end if;
  end loop;

  -- images: stable object references, status pending, deterministic order
  for img in
    select s.*, 0 as ord
    from public.marketplace_import_assets s
    where s.matched_row_id = r.id and s.status in ('matched', 'applied')
    order by s.sequence, s.file_name
  loop
    v_var_for_img := case when img.matched_by = 'sku' then v_variant else null end;
    select i.id, i.product_id into v_img from public.marketplace_product_images i
     where i.storage_provider = img.storage_provider and i.storage_bucket = img.storage_bucket and i.object_key = img.object_key;
    if found then
      if v_img.product_id <> v_product then
        raise exception 'image object % already belongs to another product', img.object_key using errcode = '23505';
      end if;
    else
      select coalesce(max(i.sort_order) + 1, 0) into v_sort from public.marketplace_product_images i
       where i.product_id = v_product and i.variant_id is not distinct from v_var_for_img;
      v_primary := v_var_for_img is null
                   and not exists (select 1 from public.marketplace_product_images i
                                   where i.product_id = v_product and i.variant_id is null and i.is_primary and i.status <> 'rejected');
      insert into public.marketplace_product_images
        (product_id, variant_id, storage_provider, storage_bucket, object_key, sort_order, is_primary, status,
         mime_type, byte_size, checksum_sha256)
      values (v_product, v_var_for_img, img.storage_provider, img.storage_bucket, img.object_key,
              v_sort, v_primary, 'pending', img.mime_type, img.byte_size, img.checksum_sha256)
      returning id, product_id into v_img;
      v_changed := true;
    end if;
    update public.marketplace_import_assets set status = 'applied', image_id = v_img.id where id = img.id;
  end loop;

  -- initial stock (Migration 09): an import row may carry a quantity. It is entered
  -- ONCE, through the ledger, and only for a variant that has no stock row yet —
  -- re-importing never overwrites stock the seller has since changed.
  if coalesce(r.raw ->> 'quantity', '') ~ '^[0-9]{1,6}$' then
    v_qty := (r.raw ->> 'quantity')::integer;
    if v_qty > 0 and not exists (select 1 from public.marketplace_inventory_levels l where l.variant_id = v_variant) then
      select id into v_loc from public.marketplace_stock_locations
       where organization_id = r.organization_id and is_active order by (key = 'main') desc, created_at limit 1;
      if v_loc is null then
        insert into public.marketplace_stock_locations (organization_id, key, name_ar, name_en, kind, supports_pickup)
        values (r.organization_id, 'main', 'المخزن الرئيسي', 'Main stock', 'warehouse', false)
        on conflict (organization_id, key) do update set is_active = true
        returning id into v_loc;
      end if;
      perform * from public.marketplace_stock_apply(
        r.organization_id, v_variant, v_loc, 'initial', v_qty,
        'import:' || r.job_id::text || ':' || r.row_number::text, 'bulk import opening stock', 'import',
        'import_job', r.job_id::text,
        (select j.created_by from public.marketplace_import_jobs j where j.id = r.job_id));
      v_changed := true;
    end if;
  end if;

  update public.marketplace_import_rows set product_id = v_product, variant_id = v_variant where id = r.id;
  return case when v_created then 'create' when v_changed then 'update' else 'unchanged' end;
end;
$$;

CREATE OR REPLACE FUNCTION app.marketplace_import_row_findings(p_row_id uuid)
 RETURNS TABLE(severity text, code text, field text, message text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $$
declare
  r         public.marketplace_import_rows;
  v_type_id uuid;
  v_master  boolean;
  v_other   text;
  v_ptype   uuid;
  a         record;
  v_key     text;
  v_val     jsonb;
  v_text    text;
  v_num     numeric;
  v_ok      boolean;
  v_opt     text;
begin
  select * into r from public.marketplace_import_rows where id = p_row_id;
  if not found then
    return;
  end if;

  -- identifiers
  if r.sku is null then
    return query select 'error', 'sku_required', 'sku', 'SKU is required';
  elsif char_length(r.sku) > 64 or r.sku !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$' then
    return query select 'error', 'sku_invalid', 'sku', 'SKU must be 1-64 characters: letters, digits, . _ / -';
  end if;
  if r.external_ref is null then
    return query select 'error', 'external_ref_required', 'external_ref', 'Product reference (external_ref) is required';
  elsif char_length(r.external_ref) > 80 then
    return query select 'error', 'external_ref_invalid', 'external_ref', 'Product reference is longer than 80 characters';
  end if;

  -- product data
  if r.name_ar is null or char_length(r.name_ar) > 200 then
    return query select 'error', 'name_ar_invalid', 'name_ar', 'Arabic name is required (max 200 characters)';
  end if;
  if r.name_en is null or char_length(r.name_en) > 200 then
    return query select 'error', 'name_en_invalid', 'name_en', 'English name is required (max 200 characters)';
  end if;
  if char_length(coalesce(r.description_ar, '')) > 5000 or char_length(coalesce(r.description_en, '')) > 5000 then
    return query select 'error', 'description_too_long', 'description', 'Descriptions are limited to 5000 characters';
  end if;
  if char_length(coalesce(r.brand, '')) > 80 then
    return query select 'error', 'brand_too_long', 'brand', 'Brand is limited to 80 characters';
  end if;

  -- product type
  if r.product_type_key is null then
    return query select 'error', 'product_type_required', 'product_type', 'Product type is required';
  else
    select t.id into v_type_id
    from public.marketplace_product_types t join public.marketplace_categories c on c.id = t.category_id
    where t.key = r.product_type_key and t.is_active and c.is_active;
    if v_type_id is null then
      return query select 'error', 'product_type_unknown', 'product_type', 'Unknown or inactive product type';
    end if;
  end if;

  -- variant data
  if r.selling_unit is null then
    return query select 'error', 'selling_unit_required', 'selling_unit', 'Selling unit is required';
  elsif r.selling_unit not in ('piece', 'roll', 'board', 'bar', 'linear_meter', 'square_meter', 'pack') then
    return query select 'error', 'selling_unit_invalid', 'selling_unit', 'Unknown selling unit';
  end if;
  if r.price_egp is null then
    if nullif(btrim(coalesce(r.raw ->> 'price', '')), '') is null then
      return query select 'error', 'price_required', 'price', 'Price (EGP, excluding VAT) is required';
    else
      return query select 'error', 'price_invalid', 'price', 'Price is not a valid number';
    end if;
  elsif r.price_egp <= 0 or r.price_egp > 9999999999.99 then
    return query select 'error', 'price_out_of_range', 'price', 'Price must be greater than 0';
  elsif scale(r.price_egp) > 2 then
    return query select 'error', 'price_precision', 'price', 'Price has more than 2 decimal places';
  end if;

  -- opening stock (optional): a whole number 0..999999
  if nullif(btrim(coalesce(r.raw ->> 'quantity', '')), '') is not null
     and (r.raw ->> 'quantity') !~ '^[0-9]{1,6}$' then
    return query select 'error', 'quantity_invalid', 'quantity', 'Quantity must be a whole number from 0 to 999999';
  end if;

  -- duplicates inside the file
  if r.sku is not null and exists (
       select 1 from public.marketplace_import_rows x
       where x.job_id = r.job_id and x.sku = r.sku and x.row_number < r.row_number) then
    return query select 'error', 'duplicate_sku_in_file', 'sku', 'This SKU already appears on an earlier row of the file';
  end if;

  -- conflicts with the seller's existing catalogue
  if r.sku is not null and r.external_ref is not null then
    select p.external_ref into v_other
    from public.marketplace_product_variants v join public.marketplace_products p on p.id = v.product_id
    where v.seller_organization_id = r.organization_id and v.sku = r.sku;
    if found and v_other is distinct from r.external_ref then
      return query select 'error', 'sku_belongs_to_other_product', 'sku',
        'This SKU already belongs to a different product of your catalogue';
    end if;
  end if;
  if r.external_ref is not null and v_type_id is not null then
    select p.product_type_id into v_ptype from public.marketplace_products p
    where p.seller_organization_id = r.organization_id and p.external_ref = r.external_ref;
    if found and v_ptype is distinct from v_type_id then
      return query select 'error', 'product_type_change_not_allowed', 'product_type',
        'An existing product''s type cannot be changed by import';
    end if;
  end if;

  if r.sku is not null and r.selling_unit is not null and exists (
       select 1 from public.marketplace_product_variants v
       where v.seller_organization_id = r.organization_id and v.sku = r.sku and v.selling_unit <> r.selling_unit) then
    return query select 'error', 'selling_unit_change_not_allowed', 'selling_unit',
      'The selling unit of an existing variant cannot be changed by import';
  end if;

  -- consistency between the rows of one product
  v_master := r.external_ref is null or not exists (
    select 1 from public.marketplace_import_rows x
    where x.job_id = r.job_id and x.external_ref = r.external_ref and x.row_number < r.row_number);
  if not v_master then
    if exists (select 1 from public.marketplace_import_rows x
               where x.job_id = r.job_id and x.external_ref = r.external_ref and x.row_number < r.row_number
                 and x.product_type_key is distinct from r.product_type_key) then
      return query select 'error', 'product_type_conflict', 'product_type',
        'Rows of the same product reference have different product types';
    end if;
    if exists (select 1 from public.marketplace_import_rows x
               where x.job_id = r.job_id and x.external_ref = r.external_ref
                 and x.row_number = (select min(y.row_number) from public.marketplace_import_rows y
                                     where y.job_id = r.job_id and y.external_ref = r.external_ref)
                 and (x.name_en is distinct from r.name_en or x.name_ar is distinct from r.name_ar)) then
      return query select 'warning', 'product_field_conflict', 'name',
        'Product name differs from the first row of this product; the first row wins';
    end if;
  end if;

  -- attributes
  if v_type_id is not null then
    for v_key, v_val in select * from jsonb_each(r.attributes) loop
      select d.id as def_id, d.data_type, ta.level into a
      from public.marketplace_attribute_definitions d
      join public.marketplace_product_type_attributes ta on ta.attribute_id = d.id
        and ta.product_type_id = v_type_id and ta.is_active
      where d.key = v_key and d.is_active;
      if not found then
        return query select 'error', 'attribute_unknown', v_key, 'Not an active field of this product type';
        continue;
      end if;
      v_ok := false;
      if a.data_type = 'option' then
        v_ok := jsonb_typeof(v_val) = 'string' and exists (
          select 1 from public.marketplace_attribute_options o
          where o.attribute_id = a.def_id and o.key = (v_val #>> '{}') and o.is_active);
      elsif a.data_type = 'multi_option' then
        v_ok := jsonb_typeof(v_val) = 'array' and jsonb_array_length(v_val) between 1 and 20 and not exists (
          select 1 from jsonb_array_elements(v_val) e
          where jsonb_typeof(e) <> 'string' or not exists (
            select 1 from public.marketplace_attribute_options o
            where o.attribute_id = a.def_id and o.key = (e #>> '{}') and o.is_active));
      elsif a.data_type in ('number', 'measurement') then
        v_ok := jsonb_typeof(v_val) = 'number' or (jsonb_typeof(v_val) = 'string' and (v_val #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$');
        if v_ok then
          v_num := (v_val #>> '{}')::numeric;
          v_ok := a.data_type = 'number' or v_num > 0;
        end if;
      elsif a.data_type = 'boolean' then
        v_ok := jsonb_typeof(v_val) = 'boolean';
      elsif a.data_type = 'text' then
        v_text := v_val #>> '{}';
        v_ok := jsonb_typeof(v_val) = 'string' and char_length(btrim(v_text)) between 1 and 500;
      end if;
      if not v_ok then
        return query select 'error', 'attribute_value_invalid', v_key, 'The value is not valid for this field';
      end if;
    end loop;

    -- required fields are a PUBLICATION prerequisite, not an import prerequisite
    for a in
      select d.key, ta.level
      from public.marketplace_product_type_attributes ta
      join public.marketplace_attribute_definitions d on d.id = ta.attribute_id
      where ta.product_type_id = v_type_id and ta.is_required and ta.is_active and d.is_active
        and not (r.attributes ? d.key)
        and (ta.level = 'variant' or v_master)
      order by ta.sort_order
    loop
      return query select 'warning', 'required_attribute_missing', a.key,
        'Required before this product can be published';
    end loop;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Import assets staged by a SELLER: own job prefix + bytes must exist
-- ---------------------------------------------------------------------------
-- Replaces the dispatcher's 'stage_assets' step with ownership and existence
-- checks. The Migration 05 worker function is unchanged (service-side callers and
-- its tests keep their contract); a SELLER can only register objects under
-- imports/<their organization>/<this job>/ that really exist in storage.
create or replace function app.marketplace_seller_stage_import_assets(p_job uuid, p_org uuid, p_assets jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  e        jsonb;
  v_prefix text := 'imports/' || p_org::text || '/' || p_job::text || '/';
  v_n      integer;
  a        record;
  v_meta   jsonb;
begin
  if jsonb_typeof(p_assets) is distinct from 'array' then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  for e in select * from jsonb_array_elements(p_assets) loop
    if coalesce(e ->> 'storage_bucket', '') <> 'marketplace-product-images'
       or coalesce(e ->> 'object_key', '') not like v_prefix || '%'
       or position('..' in coalesce(e ->> 'object_key', '')) > 0 then
      raise exception 'mp:asset_outside_job' using errcode = '42501';
    end if;
  end loop;
  v_n := public.marketplace_import_stage_assets(p_job, p_assets);
  -- every pending asset of this job must have real bytes; record their true size / type
  for a in select ia.id, ia.storage_bucket, ia.object_key from public.marketplace_import_assets ia
           where ia.job_id = p_job and ia.status = 'pending' loop
    select so.metadata into v_meta from storage.objects so where so.bucket_id = a.storage_bucket and so.name = a.object_key;
    perform app.marketplace_import_flag(true);
    if v_meta is null then
      update public.marketplace_import_assets set status = 'rejected' where id = a.id;
      perform app.marketplace_import_record_finding(p_job, p_org, null, a.id, null, 'error',
        'asset_not_uploaded', 'file_name', 'The image file was not found in storage');
    else
      update public.marketplace_import_assets set
        byte_size = nullif(v_meta ->> 'size', '')::bigint,
        mime_type = case when v_meta ->> 'mimetype' in ('image/jpeg', 'image/png', 'image/webp') then v_meta ->> 'mimetype' else mime_type end
      where id = a.id;
    end if;
    perform app.marketplace_import_flag(false);
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Grants & hardening
-- ---------------------------------------------------------------------------
revoke all on function
  public.admin_marketplace_seller_overview(),
  public.admin_marketplace_media_queue(text, integer, integer),
  public.admin_marketplace_media_record_validation(uuid, boolean, text, integer, integer, bigint, text, text),
  public.admin_marketplace_media_approve(uuid[]),
  public.admin_marketplace_media_reject(uuid[], text),
  public.admin_marketplace_media_settings(),
  public.admin_marketplace_set_media_verification_ready(boolean, text),
  public.marketplace_public_image_ref(uuid),
  public.marketplace_public_catalog_page(text, text, text, text, integer, integer),
  public.marketplace_public_facets(),
  public.marketplace_seller_products_page(uuid, text, text, text, text, integer, integer),
  public.marketplace_seller_import_step(uuid, text, jsonb),
  public.marketplace_seller_publish_ready(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function
  public.admin_marketplace_seller_overview(),
  public.admin_marketplace_media_queue(text, integer, integer),
  public.admin_marketplace_media_record_validation(uuid, boolean, text, integer, integer, bigint, text, text),
  public.admin_marketplace_media_approve(uuid[]),
  public.admin_marketplace_media_reject(uuid[], text),
  public.admin_marketplace_media_settings(),
  public.admin_marketplace_set_media_verification_ready(boolean, text),
  public.marketplace_seller_products_page(uuid, text, text, text, text, integer, integer),
  public.marketplace_seller_import_step(uuid, text, jsonb),
  public.marketplace_seller_publish_ready(uuid, integer)
  to authenticated;
grant execute on function
  public.marketplace_public_catalog_page(text, text, text, text, integer, integer),
  public.marketplace_public_facets()
  to anon, authenticated;
-- public image bytes are read by ONE server route with the service credential
grant execute on function public.marketplace_public_image_ref(uuid) to service_role;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname like 'marketplace\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
  end loop;
end;
$$;
-- storage-policy predicates run as the querying role
grant execute on function app.marketplace_storage_can_upload_image(text) to authenticated;
grant execute on function app.marketplace_storage_owns_image(text) to authenticated;
grant execute on function app.marketplace_storage_can_delete_image(text) to authenticated;
grant execute on function app.marketplace_storage_moderator_can_read(text) to authenticated;
grant execute on function app.marketplace_storage_can_upload_import(text) to authenticated;
