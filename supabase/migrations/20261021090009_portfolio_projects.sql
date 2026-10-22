-- Portfolio projects (the approved "Work history" design): an Installer groups
-- portfolio photos and videos into projects, at most 15 projects per person and
-- at most 6 photos and videos per project. Each project has a title, an optional
-- location and description, a chosen cover (thumbnail), its own media order and
-- one publish switch.
--
-- Built ON the existing media model, never beside it:
--   * photos stay in public.portfolio_items and videos in public.media_videos
--     (scope 'portfolio'); a project only groups them through a nullable
--     project_id. Upload, verification, R2/HLS processing, delivery and the
--     convergent delete/purge sequences are unchanged.
--   * the media order stays the shared photo-and-video sort_order space of
--     20261019170000_media_videos.sql; reordering a project permutes the
--     positions its own items already hold, so the owner's whole order stays dense
--     and ungrouped items keep their places.
--   * per-item visibility stays the authority for delivery (/p/media/<id>, the
--     media Worker). Publishing a project publishes its ready items; an item that
--     becomes ready inside a public project is published with it.
-- Items uploaded before projects existed keep project_id null and behave exactly
-- as before; the caps apply to projects only (the flat portfolio has none, as
-- ADR-0020 Revision 2 states).
--
-- Rollback: drop the functions and triggers below, the two project_id columns,
-- then public.portfolio_projects.

create table public.portfolio_projects (
  id            uuid primary key default extensions.gen_random_uuid(),
  owner_user_id uuid not null references public.users (id) on delete cascade,
  title         text not null,
  location      text,
  description   text,
  visibility    public.portfolio_visibility not null default 'private',
  -- The chosen thumbnail. Null (or an item no longer in the project) means the
  -- first item in the project's order.
  cover_kind    text,
  cover_id      uuid,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint ck_portfolio_projects_title check (char_length(btrim(title)) between 1 and 120),
  constraint ck_portfolio_projects_location check (location is null or char_length(location) <= 120),
  constraint ck_portfolio_projects_description check (description is null or char_length(description) <= 600),
  constraint ck_portfolio_projects_cover check (
    (cover_kind is null and cover_id is null) or (cover_kind in ('image', 'video') and cover_id is not null))
);

comment on table public.portfolio_projects is
  'Portfolio projects: a titled group of at most 6 portfolio photos and videos, at most 15 per person. Groups existing portfolio_items / media_videos rows through their project_id; it stores no media itself. Written only through the portfolio_project_* functions.';

create index ix_portfolio_projects_owner on public.portfolio_projects (owner_user_id, sort_order, created_at, id);

create trigger trg_portfolio_projects_updated_at before update on public.portfolio_projects
  for each row execute function app.set_updated_at();

alter table public.portfolio_projects enable row level security;

create policy portfolio_projects_select_own on public.portfolio_projects
  for select to authenticated
  using (owner_user_id = (select auth.uid()));

revoke all on public.portfolio_projects from anon, authenticated, service_role;
grant select on public.portfolio_projects to authenticated;
grant select, insert, update, delete on public.portfolio_projects to service_role;

alter table public.portfolio_items
  add column project_id uuid references public.portfolio_projects (id) on delete set null;
alter table public.media_videos
  add column project_id uuid references public.portfolio_projects (id) on delete set null;

-- Only portfolio videos belong to a project; product videos follow their product.
alter table public.media_videos
  add constraint ck_media_videos_project check (project_id is null or scope = 'portfolio');

create index ix_portfolio_items_project on public.portfolio_items (project_id) where project_id is not null;
create index ix_media_videos_project on public.media_videos (project_id) where project_id is not null;

-- media_videos grants SELECT per column; the new column is readable like the rest.
grant select (project_id) on public.media_videos to authenticated;

comment on column public.portfolio_items.project_id is
  'The portfolio project this photo belongs to, or null for work uploaded outside a project. Set once, by portfolio_project_attach.';
comment on column public.media_videos.project_id is
  'The portfolio project this video belongs to (portfolio scope only), or null. Set once, by portfolio_project_attach.';

-- ---------------------------------------------------------------------------
-- Limits, enforced for every writer
-- ---------------------------------------------------------------------------
create function app.portfolio_project_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Serializes project creation per owner so two parallel creates cannot both pass.
  perform pg_advisory_xact_lock(hashtext('portfolio_projects'), hashtext(new.owner_user_id::text));
  if (select count(*) from public.portfolio_projects where owner_user_id = new.owner_user_id) >= 15 then
    raise exception 'a portfolio can have at most 15 projects' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.portfolio_project_limit() from public, anon, authenticated, service_role;

create trigger trg_portfolio_projects_limit before insert on public.portfolio_projects
  for each row execute function app.portfolio_project_limit();

-- At most 6 live photos and videos per project, counted across both tables. The
-- project row lock serializes concurrent attaches to the same project.
create function app.portfolio_project_media_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
begin
  if new.project_id is null or new.project_id is not distinct from old.project_id then
    return new;
  end if;
  select owner_user_id into v_owner from public.portfolio_projects where id = new.project_id for update;
  if v_owner is distinct from new.owner_user_id then
    raise exception 'portfolio project not found' using errcode = '42501';
  end if;
  if (select count(*) from public.portfolio_items
       where project_id = new.project_id and state <> 'deleted'::public.professional_asset_state)
     + (select count(*) from public.media_videos
       where project_id = new.project_id and state <> 'deleted') >= 6 then
    raise exception 'a portfolio project can have at most 6 photos and videos' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.portfolio_project_media_limit() from public, anon, authenticated, service_role;

create trigger trg_portfolio_items_project_limit before update of project_id on public.portfolio_items
  for each row execute function app.portfolio_project_media_limit();
create trigger trg_media_videos_project_limit before update of project_id on public.media_videos
  for each row execute function app.portfolio_project_media_limit();

-- An item that becomes ready inside a public project is published with it, so a
-- photo or video added to a published project does not need a second decision.
create function app.portfolio_project_publish_ready()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.project_id is not null and new.state::text = 'ready' and old.state::text <> 'ready'
     and exists (select 1 from public.portfolio_projects p
                  where p.id = new.project_id and p.visibility = 'public'::public.portfolio_visibility) then
    new.visibility := 'public'::public.portfolio_visibility;
  end if;
  return new;
end;
$$;
revoke all on function app.portfolio_project_publish_ready() from public, anon, authenticated, service_role;

create trigger trg_portfolio_items_project_publish before update of state on public.portfolio_items
  for each row execute function app.portfolio_project_publish_ready();
create trigger trg_media_videos_project_publish before update of state on public.media_videos
  for each row execute function app.portfolio_project_publish_ready();

-- ---------------------------------------------------------------------------
-- Owner writers
-- ---------------------------------------------------------------------------
create function app.portfolio_project_owned(p_project_id uuid)
returns public.portfolio_projects language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v public.portfolio_projects;
begin
  if v_uid is null or not app.account_is_active(v_uid) then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into v from public.portfolio_projects where id = p_project_id and owner_user_id = v_uid for update;
  if not found then
    raise exception 'portfolio project not found' using errcode = '42501';
  end if;
  return v;
end;
$$;
revoke all on function app.portfolio_project_owned(uuid) from public, anon, authenticated, service_role;

create function public.portfolio_project_create(p_title text, p_location text, p_description text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_id  uuid;
begin
  if v_uid is null or not app.account_is_active(v_uid) then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  -- The same persona gate as adding a photo; editing and deleting never consult it.
  if not app.can_create_professional_asset() then
    raise exception 'a professional persona is required to add portfolio work' using errcode = '42501';
  end if;
  insert into public.portfolio_projects (owner_user_id, title, location, description, sort_order)
  values (v_uid, btrim(coalesce(p_title, '')), nullif(btrim(coalesce(p_location, '')), ''),
          nullif(btrim(coalesce(p_description, '')), ''),
          (select coalesce(max(sort_order), -1) + 1 from public.portfolio_projects where owner_user_id = v_uid))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.portfolio_project_update(p_project_id uuid, p_title text, p_location text, p_description text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.portfolio_project_owned(p_project_id);
  update public.portfolio_projects
     set title = btrim(coalesce(p_title, '')),
         location = nullif(btrim(coalesce(p_location, '')), ''),
         description = nullif(btrim(coalesce(p_description, '')), '')
   where id = p_project_id;
end;
$$;

-- Puts a just-created photo or video into a project. Only an item of the
-- caller's own that is in no project yet; the limit trigger counts the project.
create function public.portfolio_project_attach(p_project_id uuid, p_kind text, p_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  perform app.portfolio_project_owned(p_project_id);
  if p_kind = 'image' then
    update public.portfolio_items set project_id = p_project_id
     where id = p_id and owner_user_id = v_uid and project_id is null
       and state <> 'deleted'::public.professional_asset_state;
  elsif p_kind = 'video' then
    update public.media_videos set project_id = p_project_id
     where id = p_id and owner_user_id = v_uid and scope = 'portfolio' and project_id is null
       and state <> 'deleted';
  else
    raise exception 'unknown media kind' using errcode = '22023';
  end if;
  if not found then
    raise exception 'portfolio item not found' using errcode = '42501';
  end if;
end;
$$;

create function public.portfolio_project_set_cover(p_project_id uuid, p_kind text, p_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.portfolio_project_owned(p_project_id);
  if p_kind is null and p_id is null then
    update public.portfolio_projects set cover_kind = null, cover_id = null where id = p_project_id;
    return;
  end if;
  if not (case p_kind
      when 'image' then exists (select 1 from public.portfolio_items
        where id = p_id and project_id = p_project_id and state <> 'deleted'::public.professional_asset_state)
      when 'video' then exists (select 1 from public.media_videos
        where id = p_id and project_id = p_project_id and state <> 'deleted')
      else false end) then
    raise exception 'portfolio item not found' using errcode = '42501';
  end if;
  update public.portfolio_projects set cover_kind = p_kind, cover_id = p_id where id = p_project_id;
end;
$$;

-- Drag-and-drop order inside one project. p_items is the project's complete list
-- of live items, [{"kind":"image"|"video","id":"..."}], in the new order. The
-- items are given the positions they already hold, in the new order, so nothing
-- outside the project moves.
create function public.portfolio_project_reorder(p_project_id uuid, p_items jsonb)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_given integer;
  v_live  integer;
begin
  perform app.portfolio_project_owned(p_project_id);
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid order' using errcode = '22023';
  end if;
  -- The same per-owner lock as portfolio_media_move: one reorder at a time.
  perform pg_advisory_xact_lock(hashtext('portfolio_media_order'), hashtext(v_uid::text));

  with given as (
    select e->>'kind' as kind, (e->>'id')::uuid as id, ord
      from jsonb_array_elements(p_items) with ordinality as t(e, ord)
  ), live as (
    select 'image'::text as kind, i.id from public.portfolio_items i
     where i.project_id = p_project_id and i.state <> 'deleted'::public.professional_asset_state
    union all
    select 'video', v.id from public.media_videos v
     where v.project_id = p_project_id and v.state <> 'deleted'
  )
  select (select count(distinct (kind, id)) from given),
         (select count(*) from live l where exists (select 1 from given g where g.kind = l.kind and g.id = l.id))
    into v_given, v_live;
  if v_given <> jsonb_array_length(p_items) or v_live <> v_given
     or v_live <> ((select count(*) from public.portfolio_items
                     where project_id = p_project_id and state <> 'deleted'::public.professional_asset_state)
                   + (select count(*) from public.media_videos
                     where project_id = p_project_id and state <> 'deleted')) then
    raise exception 'the order must list every item of the project once' using errcode = '22023';
  end if;

  with given as (
    select e->>'kind' as kind, (e->>'id')::uuid as id, ord
      from jsonb_array_elements(p_items) with ordinality as t(e, ord)
  ), slots as (
    select pos, row_number() over (order by pos) as ord from (
      select i.sort_order as pos from public.portfolio_items i
       where i.project_id = p_project_id and i.state <> 'deleted'::public.professional_asset_state
      union all
      select v.sort_order from public.media_videos v
       where v.project_id = p_project_id and v.state <> 'deleted') s
  ), target as (
    select g.kind, g.id, s.pos from given g join slots s using (ord)
  ), images as (
    update public.portfolio_items i set sort_order = t.pos
      from target t where t.kind = 'image' and i.id = t.id and i.sort_order is distinct from t.pos
    returning 1
  )
  update public.media_videos v set sort_order = t.pos
    from target t where t.kind = 'video' and v.id = t.id and v.sort_order is distinct from t.pos;
end;
$$;

-- The order of the projects themselves. p_ids lists every project of the caller once.
create function public.portfolio_projects_reorder(p_ids uuid[])
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not app.account_is_active(v_uid) then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('portfolio_projects'), hashtext(v_uid::text));
  if p_ids is null
     or cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
     or cardinality(p_ids) <> (select count(*) from public.portfolio_projects where owner_user_id = v_uid)
     or exists (select 1 from unnest(p_ids) x
                 where not exists (select 1 from public.portfolio_projects p where p.id = x and p.owner_user_id = v_uid)) then
    raise exception 'the order must list every project once' using errcode = '22023';
  end if;
  update public.portfolio_projects p set sort_order = (t.ord - 1)::integer
    from unnest(p_ids) with ordinality as t(id, ord)
   where p.id = t.id and p.sort_order is distinct from (t.ord - 1)::integer;
end;
$$;

-- Publish/unpublish a project and, with it, its ready photos and videos. An
-- unfinished item is published later, when it becomes ready (trigger above).
create function public.portfolio_project_set_visibility(p_project_id uuid, p_public boolean)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_vis public.portfolio_visibility := case when p_public then 'public' else 'private' end::public.portfolio_visibility;
begin
  perform app.portfolio_project_owned(p_project_id);
  update public.portfolio_projects set visibility = v_vis where id = p_project_id;
  update public.portfolio_items set visibility = v_vis
   where project_id = p_project_id and state = 'ready'::public.professional_asset_state and visibility <> v_vis;
  update public.media_videos set visibility = v_vis
   where project_id = p_project_id and state = 'ready' and visibility <> v_vis;
end;
$$;

-- Removes an empty project. Its photos and videos are removed first through their
-- own convergent delete sequences (object cleanup and purge), never here.
create function public.portfolio_project_delete(p_project_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.portfolio_project_owned(p_project_id);
  if exists (select 1 from public.portfolio_items
              where project_id = p_project_id and state <> 'deleted'::public.professional_asset_state)
     or exists (select 1 from public.media_videos where project_id = p_project_id and state <> 'deleted') then
    raise exception 'remove the project''s photos and videos first' using errcode = '55000';
  end if;
  delete from public.portfolio_projects where id = p_project_id;
end;
$$;

revoke all on function public.portfolio_project_create(text, text, text) from public, anon;
revoke all on function public.portfolio_project_update(uuid, text, text, text) from public, anon;
revoke all on function public.portfolio_project_attach(uuid, text, uuid) from public, anon;
revoke all on function public.portfolio_project_set_cover(uuid, text, uuid) from public, anon;
revoke all on function public.portfolio_project_reorder(uuid, jsonb) from public, anon;
revoke all on function public.portfolio_projects_reorder(uuid[]) from public, anon;
revoke all on function public.portfolio_project_set_visibility(uuid, boolean) from public, anon;
revoke all on function public.portfolio_project_delete(uuid) from public, anon;
grant execute on function public.portfolio_project_create(text, text, text) to authenticated;
grant execute on function public.portfolio_project_update(uuid, text, text, text) to authenticated;
grant execute on function public.portfolio_project_attach(uuid, text, uuid) to authenticated;
grant execute on function public.portfolio_project_set_cover(uuid, text, uuid) to authenticated;
grant execute on function public.portfolio_project_reorder(uuid, jsonb) to authenticated;
grant execute on function public.portfolio_projects_reorder(uuid[]) to authenticated;
grant execute on function public.portfolio_project_set_visibility(uuid, boolean) to authenticated;
grant execute on function public.portfolio_project_delete(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Public projection
-- ---------------------------------------------------------------------------
-- Published projects of a listed profile, with what a page draws. No owner id,
-- no storage key. The cover is the chosen item when it is itself published,
-- otherwise the first published item in the project's order.
create function public.public_portfolio_projects(p_profile_id uuid)
returns table (id uuid, title text, location text, description text, sort_order integer,
  cover_kind text, cover_id uuid, media_count integer)
language sql stable security definer set search_path = '' as $$
  with listed as (
    select p.user_id from public.profile_public_directory d
      join public.profiles p on p.id = d.id
     where d.id = p_profile_id
  ), media as (
    select i.project_id, 'image'::text as kind, i.id, i.sort_order, i.created_at
      from public.portfolio_items i join listed l on l.user_id = i.owner_user_id
     where i.project_id is not null and i.visibility = 'public'::public.portfolio_visibility
       and i.state = 'ready'::public.professional_asset_state
    union all
    select v.project_id, 'video', v.id, v.sort_order, v.created_at
      from public.media_videos v join listed l on l.user_id = v.owner_user_id
     where v.project_id is not null and v.scope = 'portfolio' and v.provider = 'r2_hls'
       and v.visibility = 'public' and v.state = 'ready'
  )
  select pr.id, pr.title, pr.location, pr.description, pr.sort_order,
         coalesce(chosen.kind, fb.kind), coalesce(chosen.id, fb.id),
         (select count(*)::integer from media m where m.project_id = pr.id)
    from public.portfolio_projects pr
    join listed l on l.user_id = pr.owner_user_id
    left join media chosen on chosen.project_id = pr.id and chosen.kind = pr.cover_kind and chosen.id = pr.cover_id
    left join lateral (select m.kind, m.id from media m where m.project_id = pr.id
                        order by m.sort_order, m.created_at, m.id limit 1) fb on true
   where pr.visibility = 'public'::public.portfolio_visibility
     and exists (select 1 from media m where m.project_id = pr.id)
   order by pr.sort_order, pr.created_at, pr.id;
$$;

-- The published photos and videos of those projects, in each project's order.
create function public.public_portfolio_project_media(p_profile_id uuid)
returns table (project_id uuid, kind text, id uuid, title text, sort_order integer)
language sql stable security definer set search_path = '' as $$
  with listed as (
    select p.user_id from public.profile_public_directory d
      join public.profiles p on p.id = d.id
     where d.id = p_profile_id
  )
  select x.project_id, x.kind, x.id, x.title, x.sort_order from (
    select i.project_id, 'image'::text as kind, i.id, i.title, i.sort_order, i.created_at
      from public.portfolio_items i join listed l on l.user_id = i.owner_user_id
      join public.portfolio_projects pr on pr.id = i.project_id and pr.visibility = 'public'::public.portfolio_visibility
     where i.visibility = 'public'::public.portfolio_visibility and i.state = 'ready'::public.professional_asset_state
    union all
    select v.project_id, 'video', v.id, v.title, v.sort_order, v.created_at
      from public.media_videos v join listed l on l.user_id = v.owner_user_id
      join public.portfolio_projects pr on pr.id = v.project_id and pr.visibility = 'public'::public.portfolio_visibility
     where v.scope = 'portfolio' and v.provider = 'r2_hls' and v.visibility = 'public' and v.state = 'ready'
  ) x
  order by x.project_id, x.sort_order, x.created_at, x.id;
$$;

revoke all on function public.public_portfolio_projects(uuid) from public;
revoke all on function public.public_portfolio_project_media(uuid) from public;
grant execute on function public.public_portfolio_projects(uuid) to anon, authenticated, service_role;
grant execute on function public.public_portfolio_project_media(uuid) to anon, authenticated, service_role;
