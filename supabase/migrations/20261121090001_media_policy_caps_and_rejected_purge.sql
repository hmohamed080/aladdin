-- Site-wide media policy (marketplace plan PR 2, owner decisions 2026-11-19 / 2026-11-21).
--
-- 1. Image cap 10 MiB per file for site content (portfolio, product, request, marketplace); the
--    verification receipt (media_storage_attest) compared the stored size with the old 5 MiB limit.
--    Avatars and organization images stay at 3 MiB (fixed-size crops), certificates and
--    verification documents at 10 MiB, exactly as before.
-- 2. Video cap 100 MiB per file, enforced on every NEW upload row. Existing rows are not touched,
--    and the table CHECK (5 TiB) is left alone so a legacy row can still be updated.
-- 3. Rejected Marketplace images are purged from storage two days after the rejection.
--    `marketplace_rejected_images_purge()` (service role only, run by the media cleanup job) moves
--    rejected images older than the retention into the existing removal lifecycle
--    (upload_state = 'deleting'), which the central cleanup already turns into a deleted object,
--    and forgets the row once the object is confirmed gone. The append-only moderation trail
--    (marketplace_image_moderation_events) keeps the decision.

-- ---------------------------------------------------------------------------
-- 1. Verification receipt with the new image cap
-- ---------------------------------------------------------------------------
create or replace function public.media_storage_attest(p_namespace text,p_key text,p_owner uuid,
  p_provider text,p_size bigint,p_content_type text,p_sha256 text)
returns void language plpgsql security definer set search_path='' as $$
declare m jsonb; v_limit bigint; v_existing public.media_storage_locations;
begin
  m := app.media_metadata(p_namespace,p_key);
  v_limit := case p_namespace when 'avatar' then 3145728 when 'portfolio' then 10485760 when 'certificate' then 10485760
    when 'product' then 10485760 when 'organization' then 3145728 when 'request' then 10485760 when 'verification' then 10485760
    when 'marketplace' then 10485760 end;
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
$$;

-- ---------------------------------------------------------------------------
-- 2. Video cap on new uploads
-- ---------------------------------------------------------------------------
create or replace function app.media_videos_enforce_cap()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.declared_bytes > 104857600 then
    raise exception 'video is larger than 100 MB' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function app.media_videos_enforce_cap() from public, anon, authenticated, service_role;

create trigger media_videos_cap_on_insert before insert on public.media_videos
  for each row execute function app.media_videos_enforce_cap();

-- ---------------------------------------------------------------------------
-- 3. Rejected-image purge after two days
-- ---------------------------------------------------------------------------
-- Returns how many images entered the removal lifecycle and how many rows were forgotten.
create or replace function public.marketplace_rejected_images_purge(p_retention interval default interval '2 days',
  p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_expired integer; v_forgotten integer;
begin
  if p_retention < interval '1 day' then
    raise exception 'retention below one day' using errcode = '22023';
  end if;
  -- (a) rejected and past retention: withdraw into the removal lifecycle; central cleanup deletes the bytes
  with due as (
    select i.id from public.marketplace_product_images i
     where i.status = 'rejected' and i.upload_state = 'confirmed'
       and i.moderated_at is not null and i.moderated_at < now() - p_retention
     order by i.moderated_at limit least(greatest(p_limit, 1), 1000) for update skip locked)
  update public.marketplace_product_images i
     set upload_state = 'deleting', is_primary = false
    from due where i.id = due.id;
  get diagnostics v_expired = row_count;
  -- (b) the object is confirmed deleted (cleanup recorded it): forget the row
  with gone as (
    select i.id from public.marketplace_product_images i
      join public.media_storage_locations l on l.namespace = 'marketplace' and l.object_key = i.object_key
     where i.status = 'rejected' and i.upload_state = 'deleting' and i.moderated_at is not null
       and l.cleaned_at is not null
     limit least(greatest(p_limit, 1), 1000) for update of i skip locked)
  delete from public.marketplace_product_images i using gone where i.id = gone.id;
  get diagnostics v_forgotten = row_count;
  return jsonb_build_object('expired', v_expired, 'forgotten', v_forgotten);
end;
$$;
revoke all on function public.marketplace_rejected_images_purge(interval, integer) from public, anon, authenticated;
grant execute on function public.marketplace_rejected_images_purge(interval, integer) to service_role;
comment on function public.marketplace_rejected_images_purge(interval, integer) is
  'Marketplace media policy: rejected images are removed from storage two days after the rejection. Service role, run by the media cleanup job; idempotent.';

-- ---------------------------------------------------------------------------
-- 4. Legacy Supabase buckets follow the 10 MiB image cap
-- ---------------------------------------------------------------------------
-- While legacy Supabase writes are open, images between 5 and 10 MiB pass the browser and the receipt but the
-- bucket itself still refused them at 5 MiB. Only the three site-content buckets move; the 3 MiB (avatar,
-- organization) and the 10 MiB (certificate, verification) buckets are already right. A bucket already above
-- 10 MiB is never lowered.
update storage.buckets
   set file_size_limit = 10485760
 where id in ('professional-portfolio', 'product-images', 'purchase-request-images')
   and coalesce(file_size_limit, 0) < 10485760;
