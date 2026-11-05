-- Showroom social and website links (docs/frontend/showroom-social-links-onboarding.md).
--
-- Purpose: four nullable link columns (facebook_url, instagram_url, tiktok_url,
-- website_url) on business_creation_drafts and organizations, an authoritative
-- shape check (app.social_link_valid) used by CHECK constraints and the new RPCs,
-- and versioned RPCs that carry the links:
--   * business_draft_save_v3   = business_draft_save_v2 + replace the four links (null clears)
--   * business_draft_submit_v3 = "at least one link" for a new showroom, then
--     business_draft_submit_v2, then copy the links to the organization it created.
--
-- Expand-only: business_draft_save_v2 / business_draft_submit_v2 are NOT modified,
-- so an old client still creates a showroom without links (the profile checklist
-- reports the gap). No backfill; existing rows stay null. No new table, so no new
-- RLS policy: the columns inherit the existing row policies and table-level
-- SELECT grants of their sibling contact_email column, and no client UPDATE/INSERT
-- column grant is added (writes go through the definer RPCs only).
--
-- The validator accepts exactly the canonical forms produced by
-- frontend/src/lib/onboarding/social-links.ts (plus the bare platform host aliases):
--   https://www.facebook.com/<path>   (also facebook.com, fb.com, fb.me, optional www.)
--   https://www.instagram.com/<name>  (www. optional)
--   https://www.tiktok.com/@<name>    (www. optional)
--   https://<host><path>              (website)
-- https only, <= 300 characters, ASCII only, no whitespace/control characters, no
-- userinfo, port, query or fragment, valid %XX escapes only, no IP / xn-- / local hosts.

create or replace function app.social_link_valid(p_platform text, p_url text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_path text;
  v_host text;
begin
  if p_url is null then
    return true;
  end if;
  -- Length, then one ASCII-only, separator-free shape shared by every platform.
  if char_length(p_url) > 300 or p_url !~ '^https://[A-Za-z0-9.-]+(/[]A-Za-z0-9!$%&''()*+,./:;=@^_|~[-]*)?$' then
    return false;
  end if;
  -- Every percent sign starts a valid %XX escape.
  if position('%' in regexp_replace(p_url, '%[0-9A-Fa-f]{2}', '', 'g')) > 0 then
    return false;
  end if;

  if p_platform = 'facebook' then
    v_path := substring(p_url from '^https://(?:www[.])?(?:facebook[.]com|fb[.]com|fb[.]me)/([A-Za-z0-9._%-]+(?:/[A-Za-z0-9._%-]+)*)$');
    return v_path is not null
      and v_path ~ '[A-Za-z0-9]'
      and ('/' || v_path || '/') !~ '/[.]{1,2}/'
      and (position('/' in v_path) > 0 or v_path ~ '^[A-Za-z0-9.]{5,50}$');
  elsif p_platform = 'instagram' then
    return p_url ~ '^https://(?:www[.])?instagram[.]com/[A-Za-z0-9._]{1,30}$'
      and substring(p_url from '/([^/]*)$') ~ '[A-Za-z0-9]';
  elsif p_platform = 'tiktok' then
    return p_url ~ '^https://(?:www[.])?tiktok[.]com/@[A-Za-z0-9._]{2,24}$'
      and substring(p_url from '/@([^/]*)$') ~ '[A-Za-z0-9]';
  elsif p_platform = 'website' then
    v_host := substring(p_url from '^https://([^/]+)');
    return v_host ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$'
      and v_host !~ '(?:^|[.])xn--'
      and v_host !~ '[.](?:local|internal|localhost|localdomain)$';
  end if;
  return false;
end;
$$;

-- PostgreSQL checks EXECUTE on a function used in a CHECK constraint with the
-- privileges of the role writing the row, even when the link column is untouched or
-- null. authenticated keeps column-granted writes on organizations (e.g. name), so
-- it needs EXECUTE or those existing writes would start failing (same pattern as
-- app.description_text). The function is pure, immutable and in the unexposed app
-- schema, so this adds no RPC endpoint. anon writes neither table; service_role
-- cannot write organizations and its draft writes already depend on
-- app.business_address_word_count, which it cannot execute either.
revoke all on function app.social_link_valid(text, text) from public, anon;
grant execute on function app.social_link_valid(text, text) to authenticated;

alter table public.business_creation_drafts
  add column facebook_url  text,
  add column instagram_url text,
  add column tiktok_url    text,
  add column website_url   text,
  add constraint ck_business_creation_drafts_facebook_url  check (facebook_url  is null or app.social_link_valid('facebook',  facebook_url)),
  add constraint ck_business_creation_drafts_instagram_url check (instagram_url is null or app.social_link_valid('instagram', instagram_url)),
  add constraint ck_business_creation_drafts_tiktok_url    check (tiktok_url    is null or app.social_link_valid('tiktok',    tiktok_url)),
  add constraint ck_business_creation_drafts_website_url   check (website_url   is null or app.social_link_valid('website',   website_url));

alter table public.organizations
  add column facebook_url  text,
  add column instagram_url text,
  add column tiktok_url    text,
  add column website_url   text,
  add constraint ck_organizations_facebook_url  check (facebook_url  is null or app.social_link_valid('facebook',  facebook_url)),
  add constraint ck_organizations_instagram_url check (instagram_url is null or app.social_link_valid('instagram', instagram_url)),
  add constraint ck_organizations_tiktok_url    check (tiktok_url    is null or app.social_link_valid('tiktok',    tiktok_url)),
  add constraint ck_organizations_website_url   check (website_url   is null or app.social_link_valid('website',   website_url));

create or replace function public.business_draft_save_v3(
  p_draft_id uuid default null,
  p_legal_name text default null,
  p_display_name text default null,
  p_org_type public.organization_type default null,
  p_description text default null,
  p_governorate text default null,
  p_city text default null,
  p_primary_branch_name text default null,
  p_city_custom_name text default null,
  p_contact_phone text default null, p_contact_email text default null,
  p_activity_type text default null, p_detailed_address text default null,
  p_facebook_url text default null, p_instagram_url text default null,
  p_tiktok_url text default null, p_website_url text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_facebook  text := nullif(btrim(p_facebook_url), '');
  v_instagram text := nullif(btrim(p_instagram_url), '');
  v_tiktok    text := nullif(btrim(p_tiktok_url), '');
  v_website   text := nullif(btrim(p_website_url), '');
  v_id uuid;
begin
  if not app.social_link_valid('facebook', v_facebook) then
    raise exception 'invalid facebook social link' using errcode = '22023';
  end if;
  if not app.social_link_valid('instagram', v_instagram) then
    raise exception 'invalid instagram social link' using errcode = '22023';
  end if;
  if not app.social_link_valid('tiktok', v_tiktok) then
    raise exception 'invalid tiktok social link' using errcode = '22023';
  end if;
  if not app.social_link_valid('website', v_website) then
    raise exception 'invalid website social link' using errcode = '22023';
  end if;

  -- Caller verification, ownership, entitlement, type lock and every _v2 field rule.
  v_id := public.business_draft_save_v2(
    p_draft_id, p_legal_name, p_display_name, p_org_type, p_description,
    p_governorate, p_city, p_primary_branch_name, p_city_custom_name,
    p_contact_phone, p_contact_email, p_activity_type, p_detailed_address);

  -- Links are replaced wholesale: a null clears that link. Only a showroom keeps links: any other saved type
  -- (including one switched to after links were typed) stores none.
  update public.business_creation_drafts set
    facebook_url  = case when org_type = 'showroom_dealer' then v_facebook end,
    instagram_url = case when org_type = 'showroom_dealer' then v_instagram end,
    tiktok_url    = case when org_type = 'showroom_dealer' then v_tiktok end,
    website_url   = case when org_type = 'showroom_dealer' then v_website end
  where id = v_id;

  return v_id;
end;
$$;

revoke execute on function public.business_draft_save_v3(uuid, text, text, public.organization_type, text, text, text, text, text, text, text, text, text, text, text, text, text) from public, anon;
grant  execute on function public.business_draft_save_v3(uuid, text, text, public.organization_type, text, text, text, text, text, text, text, text, text, text, text, text, text) to authenticated;

create or replace function public.business_draft_submit_v3(p_draft_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.require_verified_caller();
  v_d      public.business_creation_drafts;
  v_org_id uuid;
begin
  -- Load the draft exactly as business_draft_submit_v2 does (and lock an open one,
  -- so a concurrent retry waits and then sees the organization).
  if p_draft_id is null then
    select * into v_d from public.business_creation_drafts d
    where d.user_id = v_uid and d.completed_at is null
    for update;
    if v_d.id is null then
      select * into v_d from public.business_creation_drafts d
      where d.user_id = v_uid and d.organization_id is not null
      order by d.completed_at desc
      limit 1;
    end if;
  else
    select * into v_d from public.business_creation_drafts d
    where d.id = p_draft_id and d.user_id = v_uid
    for update;
  end if;

  if v_d.id is null then
    raise exception 'business draft not found' using errcode = '42501';
  end if;

  -- Already created: return it and never touch links edited since.
  if v_d.organization_id is not null then
    return v_d.organization_id;
  end if;

  if v_d.org_type = 'showroom_dealer' and v_d.completed_at is null
     and v_d.facebook_url is null and v_d.instagram_url is null
     and v_d.tiktok_url is null and v_d.website_url is null then
    raise exception 'at least one showroom link is required' using errcode = '22023';
  end if;

  v_org_id := public.business_draft_submit_v2(v_d.id);

  -- Links belong to a showroom only; a draft of any other type never copies them.
  if v_d.org_type = 'showroom_dealer' then
    update public.organizations set
      facebook_url  = v_d.facebook_url,
      instagram_url = v_d.instagram_url,
      tiktok_url    = v_d.tiktok_url,
      website_url   = v_d.website_url
    where id = v_org_id;
  end if;

  return v_org_id;
end;
$$;

revoke execute on function public.business_draft_submit_v3(uuid) from public, anon;
grant  execute on function public.business_draft_submit_v3(uuid) to authenticated;

notify pgrst, 'reload schema';
