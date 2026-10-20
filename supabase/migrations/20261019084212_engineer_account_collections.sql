-- Product audience is a buying preference, not professional verification.
-- Preserve canonical personas; allow registered, declared engineers to buy while
-- verification is pending. Never write the canonical persona or verification state.
create or replace function app.viewer_product_audience(p_org_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  if (select auth.uid()) is null then return null; end if;
  if p_org_id is not null then
    if not app.is_org_member(p_org_id) then
      raise exception 'not a member of this organization' using errcode = '42501';
    end if;
    return app.org_product_audience(p_org_id);
  end if;
  select app.persona_product_audience(u.primary_account_type::text) into v
    from public.users u where u.id = (select auth.uid());
  if v is null and public.my_registration_state() in ('active_personal', 'access_ready')
    and exists(select 1 from public.individual_onboarding io
      join public.onboarding_progress op on op.user_id = io.user_id and op.selected_track = 'professional'
      where io.user_id = (select auth.uid()) and io.prof_concrete_type = 'engineer') then
    v := 'engineer';
  end if;
  return v;
end; $$;

-- Personal collections are not organization memberships or authorization grants.
create table public.engineer_collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('saved', 'team')),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);
create index engineer_collections_owner on public.engineer_collections(owner_id, created_at desc);
create unique index engineer_one_saved_collection on public.engineer_collections(owner_id) where kind = 'saved';
create table public.engineer_collection_entries (
  collection_id uuid not null references public.engineer_collections(id) on delete cascade,
  entity_type text not null check (entity_type in ('profile', 'organization', 'product', 'portfolio')),
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (collection_id, entity_type, entity_id)
);
alter table public.engineer_collections enable row level security;
alter table public.engineer_collection_entries enable row level security;
create policy engineer_collections_owner_read on public.engineer_collections for select to authenticated
  using (owner_id = (select auth.uid()));
create policy engineer_entries_owner_read on public.engineer_collection_entries for select to authenticated
  using (exists (select 1 from public.engineer_collections c where c.id = collection_id and c.owner_id = (select auth.uid())));
revoke all on public.engineer_collections, public.engineer_collection_entries from anon, authenticated;
grant select on public.engineer_collections, public.engineer_collection_entries to authenticated;

create function app.require_engineer() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := app.require_verified_caller();
begin
  if public.my_registration_state() not in ('active_personal', 'access_ready') then
    raise exception 'complete account registration' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.users u
    left join public.individual_onboarding io on io.user_id = u.id
    left join public.onboarding_progress op on op.user_id = u.id
    where u.id = v_uid and coalesce(io.prof_concrete_type::text, u.primary_account_type::text) = 'engineer'
      and (op.selected_track = 'professional' or op.selected_track is null)
  ) then raise exception 'engineer account required' using errcode = '42501'; end if;
  return v_uid;
end; $$;
revoke all on function app.require_engineer() from public;

create function public.engineer_collection_change(
  p_action text, p_collection_id uuid default null, p_name text default null,
  p_entity_type text default null, p_entity_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_engineer(); v_collection public.engineer_collections; v_id uuid;
begin
  -- Per-owner lock bounds team creation and removes duplicate-save races.
  perform 1 from public.users where id = v_uid for update;
  if p_action = 'create_team' then
    if char_length(btrim(coalesce(p_name, ''))) not between 1 and 100 then
      raise exception 'invalid team name' using errcode = '22023'; end if;
    if (select count(*) from public.engineer_collections where owner_id = v_uid and kind = 'team') >= 30 then
      raise exception 'team limit reached' using errcode = '22023'; end if;
    insert into public.engineer_collections(owner_id, kind, name) values(v_uid, 'team', btrim(p_name)) returning id into v_id;
    return v_id;
  end if;
  if p_action in ('save', 'unsave') then
    insert into public.engineer_collections(owner_id, kind, name) values(v_uid, 'saved', 'Saved') on conflict do nothing;
    select * into v_collection from public.engineer_collections where owner_id = v_uid and kind = 'saved';
  else
    select * into v_collection from public.engineer_collections where id = p_collection_id and owner_id = v_uid for update;
    if not found then raise exception 'collection not found' using errcode = '42501'; end if;
  end if;
  if p_action = 'delete_team' and v_collection.kind = 'team' then
    delete from public.engineer_collections where id = v_collection.id; return v_collection.id;
  end if;
  if p_action in ('unsave', 'remove') then
    delete from public.engineer_collection_entries where collection_id = v_collection.id and entity_type = p_entity_type and entity_id = p_entity_id;
    return v_collection.id;
  end if;
  if p_action not in ('save', 'add') or p_entity_id is null then raise exception 'invalid action' using errcode = '22023'; end if;
  if v_collection.kind = 'team' and p_entity_type <> 'profile' then raise exception 'teams contain professionals' using errcode = '22023'; end if;
  if not (
    (p_entity_type = 'profile' and exists(select 1 from public.profile_public_directory where id = p_entity_id)) or
    (p_entity_type = 'organization' and exists(select 1 from public.organization_public_directory where id = p_entity_id)) or
    (p_entity_type = 'product' and exists(select 1 from public.catalog_products(null) where id = p_entity_id)) or
    (p_entity_type = 'portfolio' and exists(select 1 from public.public_portfolio_items where id = p_entity_id))
  ) then raise exception 'record is not available' using errcode = '42501'; end if;
  if not exists(select 1 from public.engineer_collection_entries where collection_id = v_collection.id and entity_type = p_entity_type and entity_id = p_entity_id)
    and (select count(*) from public.engineer_collection_entries where collection_id = v_collection.id) >= 500 then
    raise exception 'collection limit reached' using errcode = '22023'; end if;
  insert into public.engineer_collection_entries(collection_id, entity_type, entity_id) values(v_collection.id, p_entity_type, p_entity_id) on conflict do nothing;
  return v_collection.id;
end; $$;
revoke all on function public.engineer_collection_change(text, uuid, text, text, uuid) from public, anon;
grant execute on function public.engineer_collection_change(text, uuid, text, text, uuid) to authenticated;

create function public.engineer_collections_read() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'kind', c.kind,
    'entries', coalesce((select jsonb_agg(jsonb_build_object('type', e.entity_type, 'id', e.entity_id) order by e.created_at desc)
      from public.engineer_collection_entries e where e.collection_id = c.id), '[]'::jsonb)
  ) order by c.created_at desc) from public.engineer_collections c), '[]'::jsonb);
end; $$;
revoke all on function public.engineer_collections_read() from public, anon;
grant execute on function public.engineer_collections_read() to authenticated;

-- Optional targeting narrows the existing request visibility matrix; it never broadens it.
create table public.engineer_request_context (
  request_id uuid primary key references public.purchase_requests(id) on delete cascade,
  location text not null default '' check (char_length(location) <= 200),
  showroom_ids uuid[] not null default '{}' check (cardinality(showroom_ids) <= 30)
);
alter table public.engineer_request_context enable row level security;
create policy engineer_request_context_owner_read on public.engineer_request_context for select to authenticated
  using (app.is_request_owner_side(request_id));
revoke all on public.engineer_request_context from anon, authenticated;
grant select on public.engineer_request_context to authenticated;

create function public.engineer_request_save(
  p_request_id uuid, p_expected_version integer, p_title text, p_notes text,
  p_needed_by date, p_items jsonb, p_location text, p_showroom_ids uuid[]
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_engineer(); v_id uuid;
begin
  if p_request_id is not null and not exists(select 1 from public.purchase_requests
    where id = p_request_id and requester_user_id = v_uid and requester_org_id is null) then
    raise exception 'personal request not found' using errcode = '42501'; end if;
  if char_length(coalesce(p_location, '')) > 200 or cardinality(p_showroom_ids) > 30 then
    raise exception 'invalid request context' using errcode = '22023'; end if;
  if exists(select 1 from unnest(p_showroom_ids) target
    where not exists(select 1 from public.organization_public_directory o where o.id = target and o.org_type = 'showroom_dealer')) then
    raise exception 'showroom is no longer available' using errcode = '22023'; end if;
  v_id := public.purchase_request_save(null, p_request_id, p_expected_version, p_title, p_notes, p_needed_by, false, p_items);
  insert into public.engineer_request_context(request_id, location, showroom_ids)
    values(v_id, btrim(coalesce(p_location, '')), coalesce(p_showroom_ids, '{}'))
    on conflict(request_id) do update set location = excluded.location, showroom_ids = excluded.showroom_ids;
  return v_id;
end; $$;
revoke all on function public.engineer_request_save(uuid, integer, text, text, date, jsonb, text, uuid[]) from public, anon;
grant execute on function public.engineer_request_save(uuid, integer, text, text, date, jsonb, text, uuid[]) to authenticated;

create function public.engineer_request_context_read(p_request_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce((select jsonb_build_object('location', location, 'showroomIds', showroom_ids)
    from public.engineer_request_context where request_id = p_request_id), '{"location":"","showroomIds":[]}'::jsonb);
$$;
revoke all on function public.engineer_request_context_read(uuid) from public, anon;
grant execute on function public.engineer_request_context_read(uuid) to authenticated;

-- Respondents receive location only, never the requester's other targeted showrooms.
create function public.engineer_request_location(p_request_id uuid, p_org_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_audience text;
begin
  perform app.require_verified_caller();
  v_audience := app.viewer_request_audience(p_org_id);
  if p_org_id is null or not app.request_readable_by_workspace(p_request_id, p_org_id, v_audience) then
    raise exception 'request not found' using errcode = '42501';
  end if;
  return (select location from public.engineer_request_context where request_id = p_request_id);
end; $$;
revoke all on function public.engineer_request_location(uuid, uuid) from public, anon;
grant execute on function public.engineer_request_location(uuid, uuid) to authenticated;

-- Release failed upload reservations through the same owner/draft checks as removal.
create function public.purchase_request_image_abort_upload(p_object_key text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.purchase_request_images where object_key = p_object_key and state = 'pending' for update;
  if v_id is null then return null; end if;
  return public.purchase_request_image_remove(v_id);
end; $$;
revoke all on function public.purchase_request_image_abort_upload(text) from public, anon;
grant execute on function public.purchase_request_image_abort_upload(text) to authenticated;

create or replace function app.request_visible_to(p_request_id uuid, p_viewer_org_id uuid, p_viewer_audience text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_viewer_audience is not null
     and exists (
       select 1
         from public.purchase_requests r
        where r.id = p_request_id
          and r.status = 'published'
          and not exists(select 1 from public.engineer_request_context ec where ec.request_id = r.id
            and cardinality(ec.showroom_ids) > 0 and not coalesce(p_viewer_org_id = any(ec.showroom_ids), false))
          and r.requester_user_id <> coalesce((select auth.uid()), '00000000-0000-0000-0000-000000000000'::uuid)
          and r.requester_org_id is distinct from p_viewer_org_id
          -- The requester organization must be live ONLY when an organization owns the request.
          and (r.requester_org_id is null
               or exists (select 1 from public.organizations o where o.id = r.requester_org_id and o.deleted_at is null))
          and case r.requester_audience
                when 'installer_technician' then p_viewer_audience = 'showroom_dealer'
                when 'contractor'           then p_viewer_audience = 'showroom_dealer'
                when 'engineer'             then p_viewer_audience = 'showroom_dealer'
                when 'end_consumer'         then p_viewer_audience = 'showroom_dealer'
                when 'showroom_dealer'      then p_viewer_audience in ('supplier', 'manufacturer', 'importer')
                                                 or (r.share_with_showrooms and p_viewer_audience = 'showroom_dealer')
                when 'supplier'             then p_viewer_audience = 'supplier'
                when 'manufacturer'         then p_viewer_audience = 'manufacturer'
                when 'importer'             then p_viewer_audience = 'importer'
                else false end);
$$;

-- Keep the shared draft writer and its validation/version/audit behavior; resolve the personal buying audience consistently.
create or replace function public.purchase_request_save(
  p_org_id               uuid,
  p_request_id           uuid,
  p_expected_version     integer,
  p_title                text,
  p_notes                text,
  p_needed_by            date,
  p_share_with_showrooms boolean,
  p_items                jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := app.require_verified_caller();
  v_r     public.purchase_requests;
  v_aud   text;
  v_title text := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_share boolean := coalesce(p_share_with_showrooms, false);
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_item  jsonb;
  v_norm  jsonb;
  v_ids   uuid[] := '{}';
  v_id    uuid;
  v_pos   smallint := 0;
begin
  if char_length(v_title) not between 2 and 160 then
    raise exception 'a request title is required (2 to 160 characters)' using errcode = '22023';
  end if;
  if v_notes is not null and char_length(v_notes) > 500 then
    raise exception 'notes are limited to 500 characters' using errcode = '22023';
  end if;
  if p_needed_by is not null and p_needed_by < current_date then
    raise exception 'the needed-by date cannot be in the past' using errcode = '22023';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) > 30 then
    raise exception 'a request holds at most 30 items' using errcode = '22023';
  end if;

  if p_request_id is null then
    if p_org_id is not null then
      if not app.is_org_member(p_org_id) then
        raise exception 'not a member of this organization' using errcode = '42501';
      end if;
      if not app.can_create_rfq(p_org_id) then
        raise exception 'rfq.create required' using errcode = '42501';
      end if;
      if not exists (select 1 from public.organizations o where o.id = p_org_id and o.deleted_at is null) then
        raise exception 'organization is not active' using errcode = '22023';
      end if;
      v_aud := app.org_product_audience(p_org_id);
      if v_aud is null then
        raise exception 'this organization type cannot publish purchase requests' using errcode = '22023';
      end if;
    else
      -- Individual: the author's own personal persona; Sales Team and legacy personas must act
      -- through a workspace.
      v_aud := app.viewer_product_audience(null);
      if v_aud is null then
        raise exception 'your account type cannot publish an individual purchase request' using errcode = '22023';
      end if;
    end if;
    if v_share and v_aud <> 'showroom_dealer' then
      raise exception 'only a showroom can share a request with other showrooms' using errcode = '22023';
    end if;
    insert into public.purchase_requests (requester_user_id, requester_org_id, requester_audience, title, notes,
                                          needed_by, share_with_showrooms)
    values (v_uid, p_org_id, v_aud, v_title, v_notes, p_needed_by, v_share)
    returning * into v_r;
  else
    select * into v_r from public.purchase_requests where id = p_request_id for update;
    if not found or not app.is_request_owner_side(p_request_id) then
      raise exception 'purchase request not found' using errcode = 'P0002';
    end if;
    if not app.can_manage_request(p_request_id) then
      raise exception 'rfq.create required' using errcode = '42501';
    end if;
    if v_r.status <> 'draft' then
      raise exception 'only a draft request can be edited' using errcode = '22023';
    end if;
    if v_r.version <> p_expected_version then
      raise exception 'purchase request was modified concurrently' using errcode = 'VC001';
    end if;
    if v_share and v_r.requester_audience <> 'showroom_dealer' then
      raise exception 'only a showroom can share a request with other showrooms' using errcode = '22023';
    end if;
    update public.purchase_requests
       set title = v_title, notes = v_notes, needed_by = p_needed_by, share_with_showrooms = v_share,
           version = version + 1
     where id = p_request_id
    returning * into v_r;
  end if;

  -- Items: validate everything first, then merge.
  for v_item in select * from jsonb_array_elements(v_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'each item must be an object' using errcode = '22023';
    end if;
    v_norm := app.request_item_normalize(v_item);
    v_pos := v_pos + 1;
    v_id := nullif(v_item ->> 'id', '')::uuid;
    if v_id is not null then
      if v_id = any (v_ids) then
        raise exception 'an item appears twice' using errcode = '22023';
      end if;
      update public.purchase_request_items
         set position = -v_pos,  -- park, then place (the unique position is deferred anyway)
             name = v_norm ->> 'name', code = v_norm ->> 'code', category_code = v_norm ->> 'category_code',
             color_items = v_norm -> 'color_items', quantity = (v_norm ->> 'quantity')::numeric,
             unit = (v_norm ->> 'unit')::public.product_unit, specs = v_norm ->> 'specs'
       where id = v_id and request_id = v_r.id;
      if not found then
        raise exception 'item does not belong to this request' using errcode = '22023';
      end if;
    else
      insert into public.purchase_request_items (request_id, position, name, code, category_code, color_items, quantity, unit, specs)
      values (v_r.id, -v_pos, v_norm ->> 'name', v_norm ->> 'code', v_norm ->> 'category_code', v_norm -> 'color_items',
              (v_norm ->> 'quantity')::numeric, (v_norm ->> 'unit')::public.product_unit, v_norm ->> 'specs')
      returning id into v_id;
    end if;
    v_ids := v_ids || v_id;
  end loop;
  delete from public.purchase_request_items where request_id = v_r.id and id <> all (v_ids);
  update public.purchase_request_items set position = -position where request_id = v_r.id and position < 0;

  perform app.record_audit_event(
    case when p_request_id is null then 'purchase_request.created' else 'purchase_request.updated' end,
    'purchase_request', v_r.id, v_r.requester_org_id,
    jsonb_build_object('audience', v_r.requester_audience, 'items', jsonb_array_length(v_items)));
  return v_r.id;
end;
$$;
