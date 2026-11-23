-- Marketplace product review (plan PR 6; owner decisions 2026-11-19 / 2026-11-23, walkthrough Part 2).
--
-- WHAT: the admin "Product review" page reviews a PRODUCT with its images inside, instead of a flat queue of
-- images. One tick approves every pending image of the product; one cross rejects them (or only chosen ones)
-- with ONE reason, and tells the showroom owner in-app. This migration adds the database half:
--
--   1. Image verification is ALWAYS mandatory. app.marketplace_media_verification_ready() is now unconditional
--      (true), so every caller (publication blockers, public catalogue, cart, orders) keeps working without a
--      change. The platform flag column and the two old RPCs stay for compatibility with the application that is
--      still promoted (expand-contract): the setter now refuses, the settings RPC keeps answering. A later
--      release removes them.
--   2. No final rejection. A rejected image (still stored: the media policy purges it two days later) can be
--      approved again; approval accepts status 'rejected' as well as 'pending'.
--   3. Replacing an image. The seller asks for a replacement of a live (approved) image; the new image is a
--      separate pending row pointing at the old one (replaces_image_id). The old image stays live while the new
--      one is pending or rejected. When the new one is approved it takes over the old one's place (order and
--      primary slot) and the old one enters the existing removal lifecycle (upload_state 'deleting'), which the
--      central cleanup turns into a deleted R2 object and marketplace_rejected_images_purge then forgets.
--   4. Product-level review RPCs: queue (per product, images inside), summary counts, approve a product's pending
--      images, reject all pending / chosen images with an internal reason + an owner-facing message.
--   5. STACKED ON PR 5 (#239, migration 20261123090001): merge #239 first. Rejection reasons use PR 5's single preset
--      system (marketplace_seller_message_presets, new action 'image_reject', managed under
--      notification_templates.manage); this migration creates no preset table. The owner message is a preset OR
--      custom text in two fields (Arabic and English). The internal decision reason is a separate field that stays in
--      the audit trail, with snapshots of the message, whatever happens to presets or templates later.
--   6. The owner is notified ONLY on rejection, in-app, through PR 5's app.notify_from_template (9-argument form with
--      per-language variables; template marketplace.product.rejected, organization id passed), to the active
--      organization managers (org.manage) of the seller.
--
-- Every decision lands in the append-only marketplace_image_moderation_events trail (internal reason, owner message
-- snapshots, preset id and label); every preset change in PR 5's append-only marketplace_seller_preset_events trail.

-- ---------------------------------------------------------------------------
-- 1. Image verification is always mandatory
-- ---------------------------------------------------------------------------
update public.marketplace_platform_settings set media_verification_ready = true where singleton;

create or replace function app.marketplace_media_verification_ready()
returns boolean
language sql
stable
set search_path = ''
as $$
  select true;
$$;
comment on function app.marketplace_media_verification_ready() is
  'Always true: image verification is mandatory (owner decision 2026-11-23). Kept so the callers and the still-promoted application keep working; removed in a later release together with the platform flag column.';

create or replace function public.admin_marketplace_set_media_verification_ready(p_ready boolean, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.marketplace_assert_admin_permission('marketplace_media.moderate');
  raise exception 'mp:media_verification_mandatory' using errcode = '23514';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Image columns, trail vocabulary
-- ---------------------------------------------------------------------------
alter table public.marketplace_product_images
  add column replaces_image_id uuid references public.marketplace_product_images (id) on delete set null;
comment on column public.marketplace_product_images.replaces_image_id is
  'The live (approved) image this pending image will replace once approved. The old image stays live until then.';
create index ix_marketplace_images_replaces on public.marketplace_product_images (replaces_image_id)
  where replaces_image_id is not null;
-- one open replacement per image
create unique index ux_marketplace_images_one_open_replacement on public.marketplace_product_images (replaces_image_id)
  where replaces_image_id is not null and status <> 'rejected' and upload_state <> 'deleting';

alter table public.marketplace_image_moderation_events drop constraint ck_marketplace_moderation_action;
alter table public.marketplace_image_moderation_events add constraint ck_marketplace_moderation_action
  check (action in ('validated', 'approved', 'rejected', 'replaced'));

-- ---------------------------------------------------------------------------
-- 3. Rejection reasons: PR 5's preset system (stacked on PR 5 / #239)
-- ---------------------------------------------------------------------------
-- ONE preset system (owner decision 2026-11-23): public.marketplace_seller_message_presets from PR 5, managed under
-- notification_templates.manage (Super Admin by default, grantable by the owner). Image rejection reasons are presets
-- with the new action 'image_reject' (structured Arabic + English texts, the same table, events and editor). This
-- migration therefore creates NO preset table of its own. It needs migration 20261123090001 (PR 5) applied first.
alter table public.marketplace_seller_message_presets drop constraint ck_marketplace_seller_presets_action;
alter table public.marketplace_seller_message_presets add constraint ck_marketplace_seller_presets_action
  check (action in ('approve', 'reject', 'suspend', 'reinstate', 'revoke', 'image_reject'));

insert into public.marketplace_seller_message_presets (action, label_ar, label_en, text_ar, text_en, sort_order) values
  ('image_reject', 'صورة غير واضحة', 'Blurry or low quality',
   'الصورة غير واضحة أو منخفضة الجودة. ارفع صورة أوضح للمنتج.',
   'The image is blurry or low quality. Please upload a clearer photo of the product.', 10),
  ('image_reject', 'لا تُظهر المنتج', 'Does not show the product',
   'الصورة لا تُظهر المنتج بوضوح. ارفع صورة تعرض المنتج نفسه.',
   'The image does not clearly show the product. Please upload a photo of the product itself.', 20),
  ('image_reject', 'نصوص أو علامة مائية', 'Text, watermark or contact details',
   'الصورة تحتوي على نصوص أو علامة مائية أو بيانات تواصل. ارفع صورة بدونها.',
   'The image contains text, a watermark or contact details. Please upload one without them.', 30),
  ('image_reject', 'لا تخص هذا المنتج', 'Not this product',
   'الصورة لا تخص هذا المنتج. ارفع صورة المنتج الصحيح.',
   'The image does not belong to this product. Please upload the right product photo.', 40),
  ('image_reject', 'محتوى غير مناسب', 'Inappropriate content',
   'الصورة تحتوي على محتوى غير مناسب للمتجر.',
   'The image contains content that is not suitable for the Marketplace.', 50);

-- PR 5's two preset functions are re-declared here (same signatures) for the new action only:
--  * the list is also readable by the product reviewers (marketplace_media.moderate), who see only the image_reject rows;
--  * the editor accepts 'image_reject'. Editing stays notification_templates.manage; every edit is an event.
create or replace function public.admin_marketplace_seller_presets()
returns table (id uuid, action text, label_ar text, label_en text, text_ar text, text_en text, is_active boolean, sort_order integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_all boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  v_all := app.has_admin_permission('marketplace_sellers.read') or app.has_admin_permission('marketplace_sellers.manage')
        or app.has_admin_permission('notification_templates.view') or app.has_admin_permission('notification_templates.manage');
  if not (v_all or app.has_admin_permission('marketplace_media.moderate')) then
    raise exception 'permission marketplace_sellers.read is required' using errcode = '42501';
  end if;
  return query
    select p.id, p.action, p.label_ar, p.label_en, p.text_ar, p.text_en, p.is_active, p.sort_order
      from public.marketplace_seller_message_presets p
     where v_all or p.action = 'image_reject'
     order by p.action, p.sort_order, p.created_at;
end;
$$;

create or replace function public.admin_marketplace_seller_preset_save(
  p_id uuid, p_action text, p_label_ar text, p_label_en text, p_text_ar text, p_text_en text,
  p_is_active boolean, p_sort_order integer, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
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
$$;

-- ---------------------------------------------------------------------------
-- 4. The one approval step (internal)
-- ---------------------------------------------------------------------------
-- Approves ONE image: pending or previously rejected ("no final rejection"), confirmed, with a successful
-- byte validation recorded in the last 15 minutes. A replacement takes over the old image's order and primary
-- slot, and the old image enters the removal lifecycle.
create or replace function app.marketplace_review_approve_image(p_image_id uuid, p_actor uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  i          public.marketplace_product_images;
  o          public.marketplace_product_images;
  v_org      uuid;
  v_primary  boolean;
  v_sort     integer;
  v_swap     boolean := false;
  v_old_id   uuid;
  v_was_rejected boolean;
begin
  select * into i from public.marketplace_product_images where id = p_image_id for update;
  if not found or i.upload_state <> 'confirmed' then
    return 'not_found';
  end if;
  if i.status = 'verified' then
    return 'not_pending';
  end if;
  if i.content_valid is not true or i.content_checked_at is null or i.content_checked_at < now() - interval '15 minutes' then
    return 'validation_required';
  end if;
  v_was_rejected := i.status = 'rejected';
  select seller_organization_id into v_org from public.marketplace_products where id = i.product_id;

  v_sort := i.sort_order;
  v_primary := false;
  if i.replaces_image_id is not null then
    select * into o from public.marketplace_product_images where id = i.replaces_image_id and product_id = i.product_id for update;
    if found and o.upload_state = 'confirmed' and o.status = 'verified' then
      v_swap := true;
      v_old_id := o.id;
      v_sort := o.sort_order;
      v_primary := o.is_primary;
      -- the old image leaves: out of its slot first (unique order / primary indexes), then into the removal lifecycle
      update public.marketplace_product_images
         set is_primary = false, status = 'rejected', upload_state = 'deleting', sort_order = o.sort_order + 200000,
             moderated_at = now(), moderated_by = p_actor, moderation_reason = 'replaced'
       where id = o.id;
      insert into public.marketplace_image_moderation_events (image_id, product_id, organization_id, action, detail, actor_user_id)
      values (o.id, o.product_id, v_org, 'replaced', jsonb_build_object('replaced_by', i.id), p_actor);
    end if;
  end if;
  if not v_swap and i.variant_id is null and not exists (
       select 1 from public.marketplace_product_images x
       where x.product_id = i.product_id and x.variant_id is null and x.is_primary and x.status <> 'rejected' and x.id <> i.id) then
    v_primary := true;   -- the product has no primary image: the first approved one becomes it
  end if;

  update public.marketplace_product_images
     set status = 'verified', moderated_at = now(), moderated_by = p_actor, moderation_reason = null,
         sort_order = v_sort, is_primary = v_primary and i.variant_id is null, replaces_image_id = null
   where id = i.id;
  insert into public.marketplace_image_moderation_events (image_id, product_id, organization_id, action, detail, actor_user_id)
  values (i.id, i.product_id, v_org, 'approved',
          jsonb_build_object('format', i.content_format, 'reconsidered', v_was_rejected,
                             'replaced_image_id', v_old_id), p_actor);
  return 'approved';
end;
$$;

-- The existing batch approval keeps its signature and now runs the same step.
create or replace function public.admin_marketplace_media_approve(p_image_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_id  uuid;
  v_out jsonb := '[]'::jsonb;
begin
  v_uid := app.marketplace_assert_admin_permission('marketplace_media.moderate');
  if p_image_ids is null or cardinality(p_image_ids) not between 1 and 100 then
    raise exception 'mp:images_invalid' using errcode = '22023';
  end if;
  foreach v_id in array p_image_ids loop
    v_out := v_out || jsonb_build_object('id', v_id, 'result', app.marketplace_review_approve_image(v_id, v_uid));
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Product review: summary, queue, approve, reject
-- ---------------------------------------------------------------------------
-- Product state from its confirmed images: pending (any pending image), approved (nothing pending, something approved),
-- rejected (nothing pending, nothing approved, something rejected).
create or replace function public.admin_marketplace_product_review_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform app.marketplace_assert_admin_permission('marketplace_media.moderate');
  select jsonb_build_object(
           'pending',  count(*) filter (where n_pending > 0),
           'approved', count(*) filter (where n_pending = 0 and n_verified > 0),
           'rejected', count(*) filter (where n_pending = 0 and n_verified = 0 and n_rejected > 0))
    into v
    from (select i.product_id,
                 count(*) filter (where i.status = 'pending')  as n_pending,
                 count(*) filter (where i.status = 'verified') as n_verified,
                 count(*) filter (where i.status = 'rejected') as n_rejected
          from public.marketplace_product_images i where i.upload_state = 'confirmed'
          group by i.product_id) s;
  return v;
end;
$$;

-- The products of one tab with their sort key (internal helper shared by the queue and its count).
create or replace function app.marketplace_review_products(p_tab text)
returns table (product_id uuid, sort_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.product_id, s.sort_at from (
    select i.product_id,
           count(*) filter (where i.status = 'pending')  as n_pending,
           count(*) filter (where i.status = 'verified') as n_verified,
           count(*) filter (where i.status = 'rejected') as n_rejected,
           case when p_tab = 'pending' then min(i.created_at) filter (where i.status = 'pending')
                else max(coalesce(i.moderated_at, i.created_at)) end as sort_at
    from public.marketplace_product_images i where i.upload_state = 'confirmed'
    group by i.product_id) s
  where case p_tab when 'pending' then s.n_pending > 0
                   when 'approved' then s.n_pending = 0 and s.n_verified > 0
                   else s.n_pending = 0 and s.n_verified = 0 and s.n_rejected > 0 end;
$$;

create or replace function public.admin_marketplace_product_review_queue(
  p_tab text default 'pending', p_limit integer default 12, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tab    text := coalesce(nullif(p_tab, ''), 'pending');
  v_limit  integer := least(greatest(coalesce(p_limit, 12), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total  bigint;
  v_items  jsonb;
begin
  perform app.marketplace_assert_admin_permission('marketplace_media.moderate');
  if v_tab not in ('pending', 'approved', 'rejected') then
    raise exception 'mp:invalid_status' using errcode = '22023';
  end if;
  select count(*) into v_total from app.marketplace_review_products(v_tab);

  select coalesce(jsonb_agg(x.item order by x.rn), '[]'::jsonb) into v_items from (
    select r.rn, jsonb_build_object(
      'id', p.id, 'name_ar', p.name_ar, 'name_en', p.name_en, 'brand', p.brand, 'status', p.status,
      'organization_id', p.seller_organization_id, 'organization_name', o.name,
      'pending', (select count(*) from public.marketplace_product_images c where c.product_id = p.id and c.upload_state = 'confirmed' and c.status = 'pending'),
      'verified', (select count(*) from public.marketplace_product_images c where c.product_id = p.id and c.upload_state = 'confirmed' and c.status = 'verified'),
      'rejected', (select count(*) from public.marketplace_product_images c where c.product_id = p.id and c.upload_state = 'confirmed' and c.status = 'rejected'),
      'images', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', i.id, 'variant_id', i.variant_id, 'sku', v.sku, 'object_key', i.object_key,
                 'mime_type', i.mime_type, 'byte_size', i.byte_size, 'is_primary', i.is_primary,
                 'sort_order', i.sort_order, 'status', i.status, 'content_valid', i.content_valid,
                 'content_format', i.content_format, 'width_px', i.width_px, 'height_px', i.height_px,
                 'moderated_at', i.moderated_at, 'moderation_reason', i.moderation_reason,
                 'replaces_image_id', i.replaces_image_id, 'created_at', i.created_at)
               order by (i.variant_id is not null), i.sort_order, i.id)
        from public.marketplace_product_images i
        left join public.marketplace_product_variants v on v.id = i.variant_id
        where i.product_id = p.id and i.upload_state = 'confirmed'), '[]'::jsonb)) as item
    from (select q.product_id,
                 row_number() over (order by case when v_tab = 'pending' then q.sort_at end asc,
                                             case when v_tab <> 'pending' then q.sort_at end desc, q.product_id) as rn
          from app.marketplace_review_products(v_tab) q
          order by rn limit v_limit offset v_offset) r
    join public.marketplace_products p on p.id = r.product_id
    join public.organizations o on o.id = p.seller_organization_id) x;
  return jsonb_build_object('total', v_total, 'items', v_items);
end;
$$;

-- The tick: approve every pending image of the product (each needs its fresh validation; one that lacks it is
-- reported, not approved, and the others still go through).
create or replace function public.admin_marketplace_product_review_approve(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_id  uuid;
  v_out jsonb := '[]'::jsonb;
begin
  v_uid := app.marketplace_assert_admin_permission('marketplace_media.moderate');
  if not exists (select 1 from public.marketplace_products where id = p_product_id) then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  for v_id in
    select i.id from public.marketplace_product_images i
     where i.product_id = p_product_id and i.upload_state = 'confirmed' and i.status = 'pending'
     order by i.sort_order, i.id
  loop
    v_out := v_out || jsonb_build_object('id', v_id, 'result', app.marketplace_review_approve_image(v_id, v_uid));
  end loop;
  if jsonb_array_length(v_out) = 0 then
    raise exception 'mp:no_pending_images' using errcode = '23514';
  end if;
  return v_out;
end;
$$;

-- The cross: reject all pending images of the product (p_image_ids null) or the chosen ones (a pending image, or an
-- approved one the admin excludes). Two separate things are recorded (owner decision 2026-11-23):
--   * the INTERNAL decision reason (p_reason, admins only): stored on each image and in the append-only moderation event,
--     together with SNAPSHOTS of the owner message and the preset label, so editing a preset or a notification
--     template later never rewrites why an image was rejected;
--   * the OWNER-FACING message: a preset of action 'image_reject' (PR 5's preset system) OR custom text in TWO fields,
--     Arabic and English, never one text for both languages. It only fills {message} of the notification.
-- The owner is told in-app, once per call.
create or replace function public.admin_marketplace_product_review_reject(
  p_product_id uuid, p_image_ids uuid[], p_reason text, p_preset_id uuid, p_message_ar text, p_message_en text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid;
  p        public.marketplace_products;
  v_org    text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_msg_ar text;
  v_msg_en text;
  v_pre    public.marketplace_seller_message_presets;
  v_cust_ar text := nullif(btrim(coalesce(p_message_ar, '')), '');
  v_cust_en text := nullif(btrim(coalesce(p_message_en, '')), '');
  v_ids    uuid[];
  v_id     uuid;
  i        public.marketplace_product_images;
  v_next   uuid;
  v_res    text;
  v_done   integer := 0;
  v_out    jsonb := '[]'::jsonb;
  v_owner  uuid;
begin
  v_uid := app.marketplace_assert_admin_permission('marketplace_media.moderate');
  if char_length(v_reason) not between 3 and 300 then
    raise exception 'mp:reason_required' using errcode = '22023';
  end if;
  if p_preset_id is not null and (v_cust_ar is not null or v_cust_en is not null) then
    raise exception 'mp:owner_message_conflict' using errcode = '22023';
  end if;
  if p_preset_id is not null then
    select * into v_pre from public.marketplace_seller_message_presets
     where id = p_preset_id and is_active and action = 'image_reject';
    if not found then
      raise exception 'mp:preset_not_found' using errcode = '22023';
    end if;
    v_msg_ar := btrim(v_pre.text_ar);
    v_msg_en := btrim(v_pre.text_en);
  else
    if v_cust_ar is null or v_cust_en is null
       or char_length(v_cust_ar) not between 3 and 300 or char_length(v_cust_en) not between 3 and 300 then
      raise exception 'mp:owner_message_required' using errcode = '22023';
    end if;
    v_msg_ar := v_cust_ar;
    v_msg_en := v_cust_en;
  end if;

  select * into p from public.marketplace_products where id = p_product_id for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  if p_image_ids is null then
    select coalesce(array_agg(x.id order by x.sort_order, x.id), '{}') into v_ids from public.marketplace_product_images x
     where x.product_id = p.id and x.upload_state = 'confirmed' and x.status = 'pending';
    if cardinality(v_ids) = 0 then
      raise exception 'mp:no_pending_images' using errcode = '23514';
    end if;
  else
    select coalesce(array_agg(distinct u), '{}') into v_ids from unnest(p_image_ids) u;
    if cardinality(v_ids) not between 1 and 100 then
      raise exception 'mp:images_invalid' using errcode = '22023';
    end if;
  end if;

  foreach v_id in array v_ids loop
    select * into i from public.marketplace_product_images where id = v_id and product_id = p.id for update;
    if not found or i.upload_state <> 'confirmed' then
      v_res := 'not_found';
    elsif i.status = 'rejected' then
      v_res := 'already_rejected';
    else
      update public.marketplace_product_images
         set status = 'rejected', is_primary = false, moderated_at = now(), moderated_by = v_uid, moderation_reason = v_reason
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
      values (i.id, i.product_id, p.seller_organization_id, 'rejected',
              jsonb_build_object('reason', v_reason, 'owner_message_ar', v_msg_ar, 'owner_message_en', v_msg_en,
                                 'preset_id', p_preset_id, 'preset_label_ar', v_pre.label_ar, 'preset_label_en', v_pre.label_en,
                                 'was', i.status), v_uid);
      v_done := v_done + 1;
      v_res := 'rejected';
    end if;
    v_out := v_out || jsonb_build_object('id', v_id, 'result', v_res);
  end loop;

  if v_done = 0 then
    return v_out;
  end if;

  -- a published product that no longer qualifies leaves the shelf
  if p.status = 'published' and cardinality(app.marketplace_publication_blockers(p.id)) > 0 then
    update public.marketplace_products set status = 'unpublished' where id = p.id;
    insert into public.marketplace_product_status_events (product_id, organization_id, action, from_status, to_status, actor_user_id)
    values (p.id, p.seller_organization_id, 'unpublished', 'published', 'unpublished', v_uid);
  end if;

  -- the owner (active organization managers) hears about the rejection, in-app; never about an approval
  select o.name into v_org from public.organizations o where o.id = p.seller_organization_id;
  for v_owner in
    select distinct m.user_id from public.memberships m
      join public.membership_capabilities c on c.membership_id = m.id and c.capability_key = 'org.manage'
     where m.organization_id = p.seller_organization_id and m.status = 'active'
  loop
    perform app.notify_from_template(
      v_owner, p.seller_organization_id, 'marketplace.product.rejected', 'marketplace_product', p.id,
      '/showroom/marketplace/products',
      jsonb_build_object('showroom_name', coalesce(v_org, '')),
      jsonb_build_object('product_name', coalesce(p.name_ar, p.name_en), 'message', v_msg_ar),
      jsonb_build_object('product_name', coalesce(p.name_en, p.name_ar), 'message', v_msg_en));
  end loop;
  return v_out;
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. Seller: ask to replace a live image
-- ---------------------------------------------------------------------------
-- Same upload ticket as a new image (limits, key, confirm and verification are unchanged), but the new row points at
-- the image it replaces. The old image stays live until the new one is approved.
create or replace function public.marketplace_seller_image_replace_request_upload(p_image_id uuid, p_content_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o     public.marketplace_product_images;
  v_org uuid;
  r     jsonb;
begin
  select * into o from public.marketplace_product_images where id = p_image_id for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  select seller_organization_id into v_org from public.marketplace_products where id = o.product_id;
  perform app.marketplace_assert_seller_writer(v_org);
  if o.upload_state <> 'confirmed' or o.status <> 'verified' then
    raise exception 'mp:image_not_replaceable' using errcode = '23514';
  end if;
  if exists (select 1 from public.marketplace_product_images x
             where x.replaces_image_id = o.id and x.status <> 'rejected' and x.upload_state <> 'deleting') then
    raise exception 'mp:replacement_pending' using errcode = '23514';
  end if;
  r := public.marketplace_seller_image_request_upload(o.product_id, p_content_type, o.variant_id);
  update public.marketplace_product_images set replaces_image_id = o.id where id = (r ->> 'image_id')::uuid;
  return r || jsonb_build_object('replaces_image_id', o.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
revoke all on function app.marketplace_review_approve_image(uuid, uuid), app.marketplace_review_products(text)
  from public, anon, authenticated, service_role;
revoke all on function
  public.admin_marketplace_product_review_summary(),
  public.admin_marketplace_product_review_queue(text, integer, integer),
  public.admin_marketplace_product_review_approve(uuid),
  public.admin_marketplace_product_review_reject(uuid, uuid[], text, uuid, text, text),
  public.admin_marketplace_seller_presets(),
  public.admin_marketplace_seller_preset_save(uuid, text, text, text, text, text, boolean, integer, text),
  public.marketplace_seller_image_replace_request_upload(uuid, text),
  public.admin_marketplace_media_approve(uuid[]),
  public.admin_marketplace_set_media_verification_ready(boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.admin_marketplace_product_review_summary(),
  public.admin_marketplace_product_review_queue(text, integer, integer),
  public.admin_marketplace_product_review_approve(uuid),
  public.admin_marketplace_product_review_reject(uuid, uuid[], text, uuid, text, text),
  public.admin_marketplace_seller_presets(),
  public.admin_marketplace_seller_preset_save(uuid, text, text, text, text, text, boolean, integer, text),
  public.marketplace_seller_image_replace_request_upload(uuid, text),
  public.admin_marketplace_media_approve(uuid[]),
  public.admin_marketplace_set_media_verification_ready(boolean, text)
  to authenticated;
