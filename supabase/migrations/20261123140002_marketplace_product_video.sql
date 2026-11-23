-- Marketplace product video (owner decision 2026-11-23).
--
-- WHAT: Marketplace listings (public.marketplace_products) get videos on the SAME pipeline as every other video
-- (R2 multipart upload -> HLS transcode worker -> media Worker delivery, ADR-0020). Nothing is copied: the existing
-- media_videos table, upload API, worker, purge and edge decision function are extended with a third scope,
-- 'marketplace', so the B2B scope ('product', which authorizes against public.products / publishers) is untouched.
--
--   * Authorization: the seller organization of the marketplace product. Upload needs org.manage in that
--     organization and an enabled seller (app.marketplace_video_manager); delete/rename need org.manage only, so a
--     suspended seller can still remove its own video. Nothing is decided by the browser.
--   * Storage: R2 only (bytes are never in Supabase). Size/type: the site-wide media policy; the cap is the
--     admin-configurable 'product' video limit (the media_limits place that already "also serves Marketplace
--     listings"), enforced by the existing cap trigger on every new row.
--   * Count: at most 3 videos per product (slots 1..3), separate from the photo limit.
--   * Review: every marketplace video starts review_status 'pending' and plays for the seller's managers and the
--     product reviewers (marketplace_media.moderate) only. An admin approves or rejects it with an internal reason
--     and an owner-facing AR/EN message; both land in the append-only marketplace_video_events trail. Buyer delivery
--     is NOT enabled here: the public product page ships later and will add the buyer rule to media_edge_video.
--
-- Expand/contract: only additions plus create-or-replace of existing functions with the SAME signatures and
-- unchanged behaviour for the 'portfolio' and 'product' scopes. The scope CHECK is widened (the old rule is a strict
-- subset of the new one, so every existing row stays valid and the still-promoted application keeps working).
-- migration-policy: destructive-reviewed - drops only the CHECK ck_media_videos_scope and re-adds it widened in the same transaction (every existing row satisfies the new rule); no table, column, function or type is dropped

-- ---------------------------------------------------------------------------
-- 1. Columns, constraint, indexes
-- ---------------------------------------------------------------------------
alter table public.media_videos
  -- No foreign key on purpose: no existing table may reference a marketplace table (guard in test 122, K3); the
  -- upload RPC checks the product, and marketplace products are archived, never hard-deleted.
  add column marketplace_product_id uuid,
  add column seller_organization_id uuid references public.organizations (id) on delete cascade,
  add column review_status          text,
  add column reviewed_at            timestamptz,
  add column reviewed_by            uuid references public.users (id) on delete set null,
  -- internal reason: never granted to the seller
  add column review_reason          text,
  add column review_message_ar      text,
  add column review_message_en      text;

alter table public.media_videos drop constraint ck_media_videos_scope;
alter table public.media_videos add constraint ck_media_videos_scope check (
  (scope = 'portfolio' and product_id is null and publisher_id is null and marketplace_product_id is null
     and seller_organization_id is null and sort_order is not null and slot is null)
  or (scope = 'product' and product_id is not null and publisher_id is not null and visibility = 'private'
     and marketplace_product_id is null and seller_organization_id is null
     and sort_order is null and slot between 1 and 6)
  or (scope = 'marketplace' and marketplace_product_id is not null and seller_organization_id is not null
     and product_id is null and publisher_id is null and visibility = 'private'
     and sort_order is null and slot between 1 and 3));

alter table public.media_videos add constraint ck_media_videos_review check (
  (scope = 'marketplace' and review_status in ('pending', 'approved', 'rejected'))
  or (scope <> 'marketplace' and review_status is null and reviewed_at is null and reviewed_by is null
      and review_reason is null and review_message_ar is null and review_message_en is null));
alter table public.media_videos add constraint ck_media_videos_review_text check (
  (review_reason is null or char_length(review_reason) <= 1000)
  and (review_message_ar is null or char_length(review_message_ar) <= 1000)
  and (review_message_en is null or char_length(review_message_en) <= 1000));

create unique index uq_media_videos_marketplace_slot on public.media_videos (marketplace_product_id, slot)
  where scope = 'marketplace' and state <> 'deleted';
create index ix_media_videos_marketplace_product on public.media_videos (marketplace_product_id)
  where scope = 'marketplace' and state <> 'deleted';
create index ix_media_videos_marketplace_seller on public.media_videos (seller_organization_id)
  where scope = 'marketplace';
create index ix_media_videos_marketplace_review on public.media_videos (uploaded_at)
  where scope = 'marketplace' and state = 'ready' and review_status = 'pending';
create index ix_media_videos_reviewed_by on public.media_videos (reviewed_by) where reviewed_by is not null;

-- ---------------------------------------------------------------------------
-- 2. Append-only trail
-- ---------------------------------------------------------------------------
create table public.marketplace_video_events (
  id              uuid        primary key default gen_random_uuid(),
  sequence        bigint      generated always as identity,
  video_id        uuid        not null,
  product_id      uuid        not null,
  organization_id uuid        not null,
  action          text        not null,
  detail          jsonb       not null default '{}'::jsonb,
  actor_user_id   uuid,
  created_at      timestamptz not null default now(),
  constraint ck_marketplace_video_events_action check (action in ('added', 'approved', 'rejected', 'renamed', 'deleted')),
  constraint ck_marketplace_video_events_detail check (jsonb_typeof(detail) = 'object' and length(detail::text) <= 4096)
);
comment on table public.marketplace_video_events is
  'Append-only trail of Marketplace product video actions (no FK: the trail outlives a deleted video). Internal review reasons live here and in media_videos.review_reason, never in a seller-facing column.';
create index ix_marketplace_video_events_video on public.marketplace_video_events (video_id, sequence);
create index ix_marketplace_video_events_product on public.marketplace_video_events (product_id, sequence);
create trigger marketplace_video_events_append_only before update or delete on public.marketplace_video_events
  for each row execute function app.marketplace_append_only();
alter table public.marketplace_video_events enable row level security;
revoke all on public.marketplace_video_events from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Authorization helpers (internal)
-- ---------------------------------------------------------------------------
-- The ONE rule for "may manage Marketplace videos of this seller organization": an active member with org.manage.
create function app.marketplace_video_manager(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and p_org is not null
     and app.is_org_member(p_org) and app.has_capability(p_org, 'org.manage');
$$;
revoke all on function app.marketplace_video_manager(uuid) from public, anon, authenticated, service_role;

-- The lowest of the three video slots no live marketplace video holds. Callers lock the product row.
create function app.marketplace_video_free_slot(p_product_id uuid)
returns smallint language sql stable security definer set search_path = '' as $$
  select s::smallint from generate_series(1, 3) s
   where not exists (select 1 from public.media_videos v
                      where v.marketplace_product_id = p_product_id and v.scope = 'marketplace'
                        and v.state <> 'deleted' and v.slot = s)
   order by s limit 1;
$$;
revoke all on function app.marketplace_video_free_slot(uuid) from public, anon, authenticated, service_role;

create function app.marketplace_video_event(p_video uuid, p_product uuid, p_org uuid, p_action text, p_detail jsonb)
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.marketplace_video_events (video_id, product_id, organization_id, action, detail, actor_user_id)
  values (p_video, p_product, p_org, p_action, coalesce(p_detail, '{}'::jsonb), (select auth.uid()));
$$;
revoke all on function app.marketplace_video_event(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The site-wide cap: a marketplace video follows the 'product' limit
-- ---------------------------------------------------------------------------
create or replace function app.media_videos_enforce_cap()
returns trigger language plpgsql set search_path = '' as $$
declare v_limit bigint := coalesce(app.media_limit_bytes('video',
  case when new.scope::text = 'marketplace' then 'product' else new.scope::text end), 0);
begin
  if new.declared_bytes > v_limit then
    raise exception 'video is larger than the limit for this place' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function app.media_videos_enforce_cap() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Reads for the seller's managers (a definer RPC: the marketplace helpers are not executable by clients,
--    so no RLS policy calls them; the internal reason is not returned)
-- ---------------------------------------------------------------------------
create function public.marketplace_product_video_list(p_product_id uuid)
returns table (id uuid, title text, state public.media_video_state, review_status text, review_message_ar text,
  review_message_en text, slot smallint, duration_seconds numeric, width integer, height integer, has_poster boolean,
  failure_code text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  select seller_organization_id into v_org from public.marketplace_products where marketplace_products.id = p_product_id;
  if v_org is null or not app.marketplace_video_manager(v_org) then
    raise exception 'mp:not_permitted' using errcode = '42501';
  end if;
  return query
    select v.id, v.title, v.state, v.review_status, v.review_message_ar, v.review_message_en, v.slot,
           v.duration_seconds, v.width, v.height, v.has_poster, v.failure_code, v.created_at
      from public.media_videos v
     where v.scope = 'marketplace' and v.marketplace_product_id = p_product_id and v.state <> 'deleted'
     order by v.slot, v.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Authoring: same signatures as before, one more branch
-- ---------------------------------------------------------------------------
create or replace function app.video_writable(p_id uuid)
returns public.media_videos language plpgsql volatile security definer set search_path = '' as $$
declare v public.media_videos; v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not app.account_is_active(v_uid) then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into v from public.media_videos where id = p_id and state <> 'deleted' for update;
  if not found or not (case v.scope
      when 'portfolio' then v.owner_user_id = v_uid
      when 'marketplace' then app.marketplace_video_manager(v.seller_organization_id)
      else app.can_write_publisher(v.publisher_id) end) then
    raise exception 'video not found' using errcode = '42501';
  end if;
  return v;
end;
$$;
revoke all on function app.video_writable(uuid) from public, anon, authenticated, service_role;

create or replace function public.video_upload_begin(p_scope text, p_product_id uuid, p_title text,
  p_content_type text, p_bytes bigint)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
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
$$;

create or replace function public.video_update(p_id uuid, p_title text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v public.media_videos; v_title text := btrim(p_title);
begin
  v := app.video_writable(p_id);
  update public.media_videos set title = v_title where id = p_id;
  if v.scope = 'marketplace' and v.title is distinct from v_title then
    -- A changed title is new public text: an approved video goes back to review.
    if v.review_status = 'approved' then
      update public.media_videos set review_status = 'pending', reviewed_at = null, reviewed_by = null,
             review_reason = null, review_message_ar = null, review_message_en = null where id = p_id;
    end if;
    perform app.marketplace_video_event(p_id, v.marketplace_product_id, v.seller_organization_id, 'renamed',
      jsonb_build_object('was_approved', v.review_status = 'approved'));
  end if;
end;
$$;

create or replace function public.video_delete(p_id uuid)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare v public.media_videos;
begin
  v := app.video_writable(p_id);
  update public.media_videos
     set state = 'deleted', visibility = 'private', deleted_at = now(), lease_until = null
   where id = p_id;
  if v.scope = 'marketplace' then
    perform app.marketplace_video_event(p_id, v.marketplace_product_id, v.seller_organization_id, 'deleted',
      jsonb_build_object('state', v.state, 'review_status', v.review_status));
  end if;
  return case when v.state = 'uploading' then v.upload_id end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Admin review (marketplace_media.moderate)
-- ---------------------------------------------------------------------------
create function public.admin_marketplace_product_videos(p_product_id uuid)
returns table (id uuid, title text, state public.media_video_state, review_status text, slot smallint,
  duration_seconds numeric, width integer, height integer, has_poster boolean, created_at timestamptz,
  reviewed_at timestamptz, review_reason text, review_message_ar text, review_message_en text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not app.has_admin_permission('marketplace_media.moderate') then
    raise exception 'mp:not_permitted' using errcode = '42501';
  end if;
  return query
    select v.id, v.title, v.state, v.review_status, v.slot, v.duration_seconds, v.width, v.height, v.has_poster,
           v.created_at, v.reviewed_at, v.review_reason, v.review_message_ar, v.review_message_en
      from public.media_videos v
     where v.scope = 'marketplace' and v.marketplace_product_id = p_product_id and v.state <> 'deleted'
     order by v.slot, v.id;
end;
$$;

-- Products with at least one finished video still waiting for review, oldest first.
create function public.admin_marketplace_pending_videos(p_limit integer default 50)
returns table (product_id uuid, organization_id uuid, name_ar text, name_en text, pending_count bigint,
  oldest_uploaded_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not app.has_admin_permission('marketplace_media.moderate') then
    raise exception 'mp:not_permitted' using errcode = '42501';
  end if;
  return query
    select p.id, p.seller_organization_id, p.name_ar, p.name_en, count(*), min(v.uploaded_at)
      from public.media_videos v
      join public.marketplace_products p on p.id = v.marketplace_product_id
     where v.scope = 'marketplace' and v.state = 'ready' and v.review_status = 'pending'
     group by p.id, p.seller_organization_id, p.name_ar, p.name_en
     order by min(v.uploaded_at), p.id
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

create function public.admin_marketplace_video_review(p_video_id uuid, p_decision text, p_reason text,
  p_message_ar text, p_message_en text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.media_videos;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ar text := nullif(btrim(coalesce(p_message_ar, '')), '');
  v_en text := nullif(btrim(coalesce(p_message_en, '')), '');
  v_owner uuid;
  v_org text;
  v_prod public.marketplace_products;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not app.has_admin_permission('marketplace_media.moderate') then
    raise exception 'mp:not_permitted' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'mp:decision_invalid' using errcode = '22023';
  end if;
  select * into v from public.media_videos
   where id = p_video_id and scope = 'marketplace' and state <> 'deleted' for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  -- Only a finished video can be judged: the reviewer must be able to watch it.
  if v.state <> 'ready' then
    raise exception 'mp:video_not_ready' using errcode = '22023';
  end if;
  if p_decision = 'reject' then
    if v_reason is null then
      raise exception 'mp:reason_required' using errcode = '22023';
    end if;
    if v_ar is null or v_en is null then
      raise exception 'mp:message_required' using errcode = '22023';
    end if;
    if char_length(v_reason) > 1000 or char_length(v_ar) > 1000 or char_length(v_en) > 1000 then
      raise exception 'mp:text_too_long' using errcode = '22023';
    end if;
  end if;
  update public.media_videos
     set review_status = case p_decision when 'approve' then 'approved' else 'rejected' end,
         reviewed_at = now(), reviewed_by = (select auth.uid()),
         review_reason = case when p_decision = 'reject' then v_reason end,
         review_message_ar = case when p_decision = 'reject' then v_ar end,
         review_message_en = case when p_decision = 'reject' then v_en end
   where id = p_video_id;
  perform app.marketplace_video_event(p_video_id, v.marketplace_product_id, v.seller_organization_id,
    case p_decision when 'approve' then 'approved' else 'rejected' end,
    case when p_decision = 'reject'
      then jsonb_build_object('reason', v_reason, 'message_ar', v_ar, 'message_en', v_en, 'was', v.review_status)
      else jsonb_build_object('was', v.review_status) end);

  -- The seller's managers hear about a rejection, in-app (never about an approval), through the same template and
  -- recipients as the product image review (PR 6): active members with org.manage of the seller organization.
  if p_decision = 'reject' then
    select * into v_prod from public.marketplace_products where id = v.marketplace_product_id;
    select o.name into v_org from public.organizations o where o.id = v.seller_organization_id;
    for v_owner in
      select distinct m.user_id from public.memberships m
        join public.membership_capabilities c on c.membership_id = m.id and c.capability_key = 'org.manage'
       where m.organization_id = v.seller_organization_id and m.status = 'active'
    loop
      perform app.notify_from_template(
        v_owner, v.seller_organization_id, 'marketplace.product.rejected', 'marketplace_product', v.marketplace_product_id,
        '/showroom/marketplace/products/' || v.marketplace_product_id::text || '/edit',
        jsonb_build_object('showroom_name', coalesce(v_org, '')),
        jsonb_build_object('product_name', coalesce(v_prod.name_ar, v_prod.name_en), 'message', v_ar),
        jsonb_build_object('product_name', coalesce(v_prod.name_en, v_prod.name_ar), 'message', v_en));
    end loop;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Edge decision: seller managers and product reviewers may play; buyers not yet
-- ---------------------------------------------------------------------------
create or replace function public.media_edge_video(p_video uuid, p_viewer uuid, p_session uuid,
  p_workspace uuid, p_expires_at timestamptz)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_role text := current_setting('request.jwt.claim.role', true);
  v public.media_videos;
  v_public boolean;
  v_allowed boolean := false;
begin
  if p_video is null then return null; end if;
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
        when 'marketplace' then app.marketplace_video_manager(v.seller_organization_id)
          or app.has_admin_permission('marketplace_media.moderate')
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
$$;

-- ---------------------------------------------------------------------------
-- 9. Privileges
-- ---------------------------------------------------------------------------
revoke all on function public.marketplace_product_video_list(uuid) from public, anon, authenticated, service_role;
grant execute on function public.marketplace_product_video_list(uuid) to authenticated;
revoke all on function public.admin_marketplace_product_videos(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_marketplace_pending_videos(integer) from public, anon, authenticated, service_role;
revoke all on function public.admin_marketplace_video_review(uuid, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_marketplace_product_videos(uuid) to authenticated;
grant execute on function public.admin_marketplace_pending_videos(integer) to authenticated;
grant execute on function public.admin_marketplace_video_review(uuid, text, text, text, text) to authenticated;
