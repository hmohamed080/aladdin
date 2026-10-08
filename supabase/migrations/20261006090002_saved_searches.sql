-- ===========================================================================
-- Saved searches — a user's named, reusable filter state
--
-- Scope today: `work` (the installer's My Work page). `jobs` is reserved so the
-- Jobs board can reuse the same table later; nothing here is specific to either
-- page beyond the key allow-list below.
--
-- WHAT IS STORED IS DATA, NEVER A QUERY. `filters` is a flat object of short
-- STRINGS under keys this migration names. It is never interpolated into SQL and
-- never executed: the page reads it back and re-applies it through its own,
-- already-validated filter controls. There is deliberately no generic "run this
-- JSON" path, and unknown keys, nested values, numbers, booleans and oversize
-- payloads are refused by a CHECK constraint, so no writer (including a future
-- one) can store them.
--
-- Same security shape as saved_jobs / saved_products: the table is SELECT-only
-- for client roles and scoped to its owner; every write is a SECURITY DEFINER RPC
-- that derives the owner from auth.uid(). No function takes a user id.
--
-- Not audited (a private preference, not a business-consequential event).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The one validator both the table and the RPCs rely on
-- ---------------------------------------------------------------------------
create function app.saved_search_filters_valid(p_scope text, p_filters jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_filters is not null
     and jsonb_typeof(p_filters) = 'object'
     and octet_length(p_filters::text) <= 2000
     and not exists (
       select 1
       from jsonb_each(p_filters) e
       where jsonb_typeof(e.value) <> 'string'
          or char_length(e.value #>> '{}') > 200
          or e.key <> all (
               case p_scope
                 -- My Work: status tab, free-text query, company, planned-window
                 -- range, contact state, ordering.
                 when 'work' then array['tab','q','company','from','to','contact','sort']
                 -- Jobs board (reserved): the URL-driven board state.
                 when 'jobs' then array['q','trade','gov','city','cityText','applied','min','max','duration','sort','saved']
                 else array[]::text[]
               end)
     );
$$;

comment on function app.saved_search_filters_valid(text, jsonb) is
  'True when p_filters is a flat object of short strings under keys allowed for p_scope (work | jobs). Everything else — nesting, numbers, unknown keys, more than 2000 bytes — is refused.';

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table public.saved_searches (
  id         uuid        primary key default extensions.gen_random_uuid(),
  user_id    uuid        not null references public.users (id) on delete cascade,
  scope      text        not null,
  name       text        not null,
  filters    jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_saved_searches_scope check (scope in ('work', 'jobs')),
  constraint ck_saved_searches_name  check (name = btrim(name) and char_length(name) between 1 and 60),
  constraint ck_saved_searches_filters check (app.saved_search_filters_valid(scope, filters))
);

comment on table public.saved_searches is
  'A user''s private, named filter state for a page (scope work | jobs). filters is a flat object of short strings under allow-listed keys (ck_saved_searches_filters) — data re-applied by the page, never executed. Owner-readable only; written through saved_search_create / _update / _delete.';

-- A name is unique per owner and scope, case-insensitively.
create unique index uq_saved_searches_user_scope_name
  on public.saved_searches (user_id, scope, lower(name));
create index ix_saved_searches_user_scope on public.saved_searches (user_id, scope, created_at);

create trigger set_saved_searches_updated_at
  before update on public.saved_searches
  for each row execute function app.set_updated_at();

alter table public.saved_searches enable row level security;

create policy saved_searches_select_own on public.saved_searches
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.saved_searches from anon, authenticated, service_role;
grant select on public.saved_searches to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Write paths
-- ---------------------------------------------------------------------------
create function public.saved_search_create(p_scope text, p_name text, p_filters jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_scope is null or p_scope not in ('work', 'jobs') then
    raise exception 'invalid scope' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 60 then
    raise exception 'name must be 1-60 characters' using errcode = '22023';
  end if;
  if not app.saved_search_filters_valid(p_scope, p_filters) then
    raise exception 'invalid filters' using errcode = '22023';
  end if;
  -- A small ceiling so a bug or a script cannot grow the list without bound.
  if (select count(*) from public.saved_searches s where s.user_id = v_uid and s.scope = p_scope) >= 25 then
    raise exception 'too many saved searches' using errcode = '54000';
  end if;

  insert into public.saved_searches (user_id, scope, name, filters)
  values (v_uid, p_scope, v_name, p_filters)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.saved_search_create(text, text, jsonb) is
  'Creates a saved search owned by the CALLER (auth.uid()). Scope must be work or jobs; filters are validated by app.saved_search_filters_valid; at most 25 per scope; a duplicate name (case-insensitive) raises 23505.';

create function public.saved_search_update(p_id uuid, p_name text default null, p_filters jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_scope text;
  v_name  text;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Somebody else's row and a missing row are the same answer.
  select s.scope into v_scope
  from public.saved_searches s
  where s.id = p_id and s.user_id = v_uid;
  if not found then
    raise exception 'saved search not found' using errcode = 'P0002';
  end if;

  if p_name is not null then
    v_name := btrim(p_name);
    if char_length(v_name) not between 1 and 60 then
      raise exception 'name must be 1-60 characters' using errcode = '22023';
    end if;
  end if;
  if p_filters is not null and not app.saved_search_filters_valid(v_scope, p_filters) then
    raise exception 'invalid filters' using errcode = '22023';
  end if;

  update public.saved_searches
     set name    = coalesce(v_name, name),
         filters = coalesce(p_filters, filters)
   where id = p_id and user_id = v_uid;
end;
$$;

comment on function public.saved_search_update(uuid, text, jsonb) is
  'Renames and/or replaces the filters of the CALLER''s own saved search. The scope never changes. Another user''s id is indistinguishable from a missing one (P0002).';

create function public.saved_search_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  delete from public.saved_searches where id = p_id and user_id = v_uid;
  if not found then
    raise exception 'saved search not found' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.saved_search_delete(uuid) is
  'Deletes the CALLER''s own saved search. Another user''s id is indistinguishable from a missing one (P0002).';

revoke execute on function public.saved_search_create(text, text, jsonb)       from public, anon;
revoke execute on function public.saved_search_update(uuid, text, jsonb)       from public, anon;
revoke execute on function public.saved_search_delete(uuid)                    from public, anon;
grant  execute on function public.saved_search_create(text, text, jsonb)       to authenticated;
grant  execute on function public.saved_search_update(uuid, text, jsonb)       to authenticated;
grant  execute on function public.saved_search_delete(uuid)                    to authenticated;
