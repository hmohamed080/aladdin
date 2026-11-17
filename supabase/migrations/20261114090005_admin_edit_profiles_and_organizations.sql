-- Admin edit of users and organizations, OPTION A (owner decision, docs/admin/ADMIN_EDIT_DECISION_BRIEF.md):
-- moderation / presentation fields only, by Administrator and above, reason required, masked immutable audit, user notification.
--
-- Two RPCs, one per subject kind, each an explicit ALLOW-LIST (never "update any column"):
--   public.admin_user_edit_profile(user, changes jsonb, reason)      users.edit_profile
--   public.admin_organization_edit(organization, changes jsonb, reason) organizations.edit
-- Contact and legal fields are refused HERE (and again in the server action): phone, email, legal name, national id,
-- bank details, org type, verification state, slug, ownership, status, ids, points. Media is REMOVE-ONLY (null).
-- The change and its audit row are one transaction. No effective change writes nothing. Rank rule as for suspend:
-- never yourself, never Admin Staff at or above your own rank (a suspended peer stays protected) unless Super Admin.
-- View-As stays strictly read-only: nothing here is reachable from a view session and no view function calls these.

-- ---------------------------------------------------------------------------
-- 1. Permissions (Super Admin locked; Administrator; never Moderator / Support by default)
-- ---------------------------------------------------------------------------
insert into public.admin_permissions (key, resource, action, description, sort_order) values
  ('users.edit_profile', 'users', 'edit_profile',
   'Correct or remove a user''s presentation fields (names, headline, bio, languages, location, availability, avatar/cover removal) with a reason. Never contact or legal data.', 14),
  ('organizations.edit', 'organizations', 'edit',
   'Correct an organization''s presentation fields (names, description, social and website links, location, locale, timezone, logo removal) with a reason. Never contact or legal data.', 15)
on conflict (key) do nothing;

insert into public.admin_role_permissions (role_id, permission_key, is_locked)
select r.id, k.key, r.key = 'super_admin'
from public.admin_roles r
cross join (values ('users.edit_profile'), ('organizations.edit')) as k(key)
where r.is_system and r.key in ('super_admin', 'administrator')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Vocabularies: audit actions and notification event types (append-only)
-- ---------------------------------------------------------------------------
select app.audit_actions_add(array['admin.user.edited', 'admin.organization.edited']);

do $$
declare
  v_def text;
  v_missing text[];
  v_add text[] := array['admin.profile_edited', 'admin.organization_edited'];
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'ck_notifications_event_type_known' and c.conrelid = 'public.notifications'::regclass;
  if v_def is null or v_def !~ '\]\)\)\)( NOT VALID)?$' then
    raise exception 'ck_notifications_event_type_known has an unexpected shape: %', coalesce(v_def, '<missing>');
  end if;
  select coalesce(array_agg(a order by a), '{}') into v_missing
    from unnest(v_add) a where position('''' || a || '''::text' in v_def) = 0;
  if cardinality(v_missing) > 0 then
    alter table public.notifications drop constraint ck_notifications_event_type_known;
    execute 'alter table public.notifications add constraint ck_notifications_event_type_known '
      || regexp_replace(v_def, '\]\)\)\)( NOT VALID)?$',
           (select ', ' || string_agg('''' || a || '''::text', ', ') || '])))' from unnest(v_missing) a) || ' NOT VALID');
  end if;
end $$;
alter table public.notifications validate constraint ck_notifications_event_type_known;

-- ---------------------------------------------------------------------------
-- 3. Audit masking: an edited bio or description can contain a phone number or an email address. The audit row keeps the
--    shape of the change, never a contact identifier, and never more than 200 characters per value.
-- ---------------------------------------------------------------------------
create or replace function app.admin_edit_mask(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Mask FIRST, truncate after (a contact cut in half at the 200-character boundary must not survive as a fragment).
  -- Digits of every script (Latin, Arabic-Indic, Persian, fullwidth) and e-mail addresses with a non-ASCII local part count.
  select case when p_value is null then null else
    left(
      regexp_replace(
        regexp_replace(p_value, '[^[:space:]@<>"]+@([^[:space:]@<>"]+)', '***@\1', 'g'),
        '\+?[0-9\u0660-\u0669\u06F0-\u06F9\uFF10-\uFF19][0-9\u0660-\u0669\u06F0-\u06F9\uFF10-\uFF19 ()._-]{5,}[0-9\u0660-\u0669\u06F0-\u06F9\uFF10-\uFF19]', '[number]', 'g'),
      200)
  end;
$$;
revoke all on function app.admin_edit_mask(text) from public, anon, authenticated, service_role;

-- One changed field -> {"old": ..., "new": ...} with masked text. Booleans, uuids and arrays are shown as text.
create or replace function app.admin_edit_change(p_old jsonb, p_new jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'old', case when p_old is null or p_old = 'null'::jsonb then null else app.admin_edit_mask(p_old #>> '{}') end,
    'new', case when p_new is null or p_new = 'null'::jsonb then null else app.admin_edit_mask(p_new #>> '{}') end);
$$;
revoke all on function app.admin_edit_change(jsonb, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. User: presentation fields of profiles
-- ---------------------------------------------------------------------------
create or replace function public.admin_user_edit_profile(p_user_id uuid, p_changes jsonb, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a        record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_key    text;
  v_val    jsonb;
  v_prof   public.profiles;
  v_new    public.profiles;
  v_old    jsonb;
  v_chg    jsonb := '{}'::jsonb;
  v_keys   text[] := '{}';
  v_name_changed boolean := false;
  -- the ONLY keys this function accepts
  c_text   constant text[] := array['display_name', 'display_name_ar', 'display_name_en', 'headline', 'bio',
                                    'governorate_key', 'city_key', 'city_custom_name'];
  c_other  constant text[] := array['languages', 'locality_id', 'available_for_work'];
  c_media  constant text[] := array['avatar_media_id', 'cover_media_id'];
begin
  perform app.admin_require('users.edit_profile');
  select * into a from app.admin_actor();
  if v_reason is null then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'the reason is too long' using errcode = '22023';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'nothing to change' using errcode = '22023';
  end if;
  -- Allow-list FIRST, before anything about the subject is revealed.
  for v_key in select jsonb_object_keys(p_changes) loop
    if not (v_key = any (c_text) or v_key = any (c_other) or v_key = any (c_media)) then
      raise exception 'field not editable' using errcode = '42501';
    end if;
  end loop;

  select p.* into v_prof from public.profiles p
   join public.users u on u.id = p.user_id
   where p.user_id = p_user_id and p.deleted_at is null for update of p;
  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if p_user_id = a.user_id then
    raise exception 'you cannot edit your own account here' using errcode = '42501';
  end if;
  if not a.is_super and app.view_as_protected_rank(p_user_id) >= a.rank then
    raise exception 'you cannot edit Admin Staff at or above your own rank' using errcode = '42501';
  end if;

  v_old := to_jsonb(v_prof);
  v_new := v_prof;
  for v_key, v_val in select * from jsonb_each(p_changes) loop
    if v_key = any (c_media) then
      if v_val <> 'null'::jsonb then
        raise exception 'media can only be removed' using errcode = '42501';
      end if;
    elsif v_key = 'available_for_work' then
      if jsonb_typeof(v_val) <> 'boolean' then raise exception 'invalid value' using errcode = '22023'; end if;
    elsif v_key = 'languages' then
      if jsonb_typeof(v_val) <> 'array' or jsonb_array_length(v_val) > 8
         or exists (select 1 from jsonb_array_elements(v_val) e where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^[a-z]{2,3}$') then
        raise exception 'invalid value' using errcode = '22023';
      end if;
    elsif v_key = 'locality_id' then
      if v_val <> 'null'::jsonb and (jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
        raise exception 'invalid value' using errcode = '22023';
      end if;
    else  -- text columns
      if v_val <> 'null'::jsonb and jsonb_typeof(v_val) <> 'string' then raise exception 'invalid value' using errcode = '22023'; end if;
      if v_key = 'display_name' and (v_val = 'null'::jsonb or btrim(v_val #>> '{}') = '') then
        raise exception 'invalid value' using errcode = '22023';
      end if;
    end if;
  end loop;

  begin
    update public.profiles set
      display_name       = case when p_changes ? 'display_name'       then btrim(p_changes ->> 'display_name') else display_name end,
      display_name_ar    = case when p_changes ? 'display_name_ar'    then nullif(btrim(p_changes ->> 'display_name_ar'), '') else display_name_ar end,
      display_name_en    = case when p_changes ? 'display_name_en'    then nullif(btrim(p_changes ->> 'display_name_en'), '') else display_name_en end,
      headline           = case when p_changes ? 'headline'           then nullif(btrim(p_changes ->> 'headline'), '') else headline end,
      bio                = case when p_changes ? 'bio'                then nullif(btrim(p_changes ->> 'bio'), '') else bio end,
      governorate_key    = case when p_changes ? 'governorate_key'    then nullif(btrim(p_changes ->> 'governorate_key'), '') else governorate_key end,
      city_key           = case when p_changes ? 'city_key'           then nullif(btrim(p_changes ->> 'city_key'), '') else city_key end,
      city_custom_name   = case when p_changes ? 'city_custom_name'   then nullif(btrim(p_changes ->> 'city_custom_name'), '') else city_custom_name end,
      languages          = case when p_changes ? 'languages'          then array(select jsonb_array_elements_text(p_changes -> 'languages')) else languages end,
      locality_id        = case when p_changes ? 'locality_id'        then (p_changes ->> 'locality_id')::uuid else locality_id end,
      available_for_work = case when p_changes ? 'available_for_work' then (p_changes ->> 'available_for_work')::boolean else available_for_work end,
      avatar_media_id    = case when p_changes ? 'avatar_media_id'    then null else avatar_media_id end,
      cover_media_id     = case when p_changes ? 'cover_media_id'     then null else cover_media_id end
    where user_id = p_user_id
    returning * into v_new;
  exception when check_violation or foreign_key_violation or not_null_violation or string_data_right_truncation then
    raise exception 'invalid value' using errcode = '22023';
  end;

  -- Effective changes only.
  for v_key in select k from jsonb_object_keys(p_changes) k order by k loop
    if to_jsonb(v_new) -> v_key is distinct from v_old -> v_key then
      v_keys := v_keys || v_key;
      v_chg := v_chg || jsonb_build_object(v_key, case
        when v_key = any (c_media) then jsonb_build_object('old', case when v_old -> v_key = 'null'::jsonb then null else 'set' end, 'new', 'removed')
        else app.admin_edit_change(v_old -> v_key, to_jsonb(v_new) -> v_key) end);
    end if;
  end loop;
  if cardinality(v_keys) = 0 then
    -- nothing effective: roll the (identical) update's side effects forward as a no-op; no audit, no notification
    return jsonb_build_object('changed', false);
  end if;

  v_name_changed := v_keys && array['display_name', 'display_name_ar', 'display_name_en'];
  if v_name_changed then
    update public.profiles set display_name_confirmed_at = null where user_id = p_user_id;   -- re-confirmation trigger
  end if;

  perform app.record_audit_event('admin.user.edited', 'user', p_user_id, null, jsonb_build_object(
    'reason', v_reason, 'actor_rank', a.rank, 'fields', to_jsonb(v_keys), 'changes', v_chg,
    'reconfirm_name', v_name_changed));
  perform app.notify(p_user_id, null, 'admin.profile_edited', 'user', p_user_id, '/home/profile/edit',
    'notifications.admin.profile_edited.title', 'notifications.admin.profile_edited.body',
    jsonb_build_object('field_count', cardinality(v_keys), 'fields', array_to_string(v_keys, ', ')));   -- field names only, never the reason or values
  return jsonb_build_object('changed', true, 'fields', to_jsonb(v_keys));
end;
$$;
revoke all on function public.admin_user_edit_profile(uuid, jsonb, text) from public, anon, service_role;
grant execute on function public.admin_user_edit_profile(uuid, jsonb, text) to authenticated;
comment on function public.admin_user_edit_profile(uuid, jsonb, text) is 'Admin Option A: allow-listed presentation fields of a user profile, reason required, masked audit, user notified. Refuses contact and legal fields.';

-- ---------------------------------------------------------------------------
-- 5. Organization: presentation fields of organizations
-- ---------------------------------------------------------------------------
create or replace function public.admin_organization_edit(p_organization_id uuid, p_changes jsonb, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a        record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_key    text;
  v_val    jsonb;
  v_org    public.organizations;
  v_new    public.organizations;
  v_old    jsonb;
  v_chg    jsonb := '{}'::jsonb;
  v_keys   text[] := '{}';
  c_text   constant text[] := array['name', 'name_ar', 'name_en', 'description', 'facebook_url', 'instagram_url', 'tiktok_url',
                                    'website_url', 'primary_locale', 'timezone'];
  c_other  constant text[] := array['locality_id'];
  c_media  constant text[] := array['logo_media_id'];
begin
  perform app.admin_require('organizations.edit');
  select * into a from app.admin_actor();
  if v_reason is null then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'the reason is too long' using errcode = '22023';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'nothing to change' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if not (v_key = any (c_text) or v_key = any (c_other) or v_key = any (c_media)) then
      raise exception 'field not editable' using errcode = '42501';
    end if;
  end loop;

  select * into v_org from public.organizations where id = p_organization_id and deleted_at is null for update;
  if not found then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;

  v_old := to_jsonb(v_org);
  for v_key, v_val in select * from jsonb_each(p_changes) loop
    if v_key = any (c_media) then
      if v_val <> 'null'::jsonb then raise exception 'media can only be removed' using errcode = '42501'; end if;
    elsif v_key = 'locality_id' then
      if v_val <> 'null'::jsonb and (jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
        raise exception 'invalid value' using errcode = '22023';
      end if;
    else
      if v_val <> 'null'::jsonb and jsonb_typeof(v_val) <> 'string' then raise exception 'invalid value' using errcode = '22023'; end if;
      if v_key in ('name', 'primary_locale') and (v_val = 'null'::jsonb or btrim(v_val #>> '{}') = '') then
        raise exception 'invalid value' using errcode = '22023';
      end if;
    end if;
  end loop;

  begin
    update public.organizations set
      name           = case when p_changes ? 'name'           then btrim(p_changes ->> 'name') else name end,
      name_ar        = case when p_changes ? 'name_ar'        then nullif(btrim(p_changes ->> 'name_ar'), '') else name_ar end,
      name_en        = case when p_changes ? 'name_en'        then nullif(btrim(p_changes ->> 'name_en'), '') else name_en end,
      description    = case when p_changes ? 'description'    then nullif(btrim(p_changes ->> 'description'), '') else description end,
      facebook_url   = case when p_changes ? 'facebook_url'   then nullif(btrim(p_changes ->> 'facebook_url'), '') else facebook_url end,
      instagram_url  = case when p_changes ? 'instagram_url'  then nullif(btrim(p_changes ->> 'instagram_url'), '') else instagram_url end,
      tiktok_url     = case when p_changes ? 'tiktok_url'     then nullif(btrim(p_changes ->> 'tiktok_url'), '') else tiktok_url end,
      website_url    = case when p_changes ? 'website_url'    then nullif(btrim(p_changes ->> 'website_url'), '') else website_url end,
      primary_locale = case when p_changes ? 'primary_locale' then btrim(p_changes ->> 'primary_locale') else primary_locale end,
      timezone       = case when p_changes ? 'timezone'       then nullif(btrim(p_changes ->> 'timezone'), '') else timezone end,
      locality_id    = case when p_changes ? 'locality_id'    then (p_changes ->> 'locality_id')::uuid else locality_id end,
      logo_media_id  = case when p_changes ? 'logo_media_id'  then null else logo_media_id end
    where id = p_organization_id
    returning * into v_new;
  exception when check_violation or foreign_key_violation or not_null_violation or string_data_right_truncation
                 or invalid_parameter_value or raise_exception then
    raise exception 'invalid value' using errcode = '22023';
  end;

  for v_key in select k from jsonb_object_keys(p_changes) k order by k loop
    if to_jsonb(v_new) -> v_key is distinct from v_old -> v_key then
      v_keys := v_keys || v_key;
      v_chg := v_chg || jsonb_build_object(v_key, case
        when v_key = any (c_media) then jsonb_build_object('old', case when v_old -> v_key = 'null'::jsonb then null else 'set' end, 'new', 'removed')
        else app.admin_edit_change(v_old -> v_key, to_jsonb(v_new) -> v_key) end);
    end if;
  end loop;
  if cardinality(v_keys) = 0 then
    return jsonb_build_object('changed', false);
  end if;

  perform app.record_audit_event('admin.organization.edited', 'organization', p_organization_id, p_organization_id, jsonb_build_object(
    'reason', v_reason, 'actor_rank', a.rank, 'fields', to_jsonb(v_keys), 'changes', v_chg));
  perform app.notify_org(p_organization_id, 'org.manage', 'admin.organization_edited', 'organization', p_organization_id, '/b2b/organization',
    'notifications.admin.organization_edited.title', 'notifications.admin.organization_edited.body',
    jsonb_build_object('field_count', cardinality(v_keys), 'fields', array_to_string(v_keys, ', ')));
  return jsonb_build_object('changed', true, 'fields', to_jsonb(v_keys));
end;
$$;
revoke all on function public.admin_organization_edit(uuid, jsonb, text) from public, anon, service_role;
grant execute on function public.admin_organization_edit(uuid, jsonb, text) to authenticated;
comment on function public.admin_organization_edit(uuid, jsonb, text) is 'Admin Option A: allow-listed presentation fields of an organization, reason required, masked audit, owners notified. Refuses contact, legal and verification fields.';
