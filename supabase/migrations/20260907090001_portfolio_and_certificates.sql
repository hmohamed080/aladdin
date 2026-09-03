-- ===========================================================================
-- Installer Pilot Increment 11 — Portfolio and Certificates
--
-- Foundation: 20260906090001_professional_asset_storage.sql (the buckets)
--             20260831090002_public_profile_professional_fields.sql
--             (profile_public_directory — the one definition of "listed")
--
-- Increment 10 stored bytes and asked one question: may this person put this
-- object here. This migration adds the other half — what an object MEANS — and
-- in doing so it has to change one thing Increment 10 got wrong for Portfolio.
--
-- ---------------------------------------------------------------------------
-- WHY THE PORTFOLIO OBJECT KEY CHANGES (superseding Increment 10 for ONE bucket)
-- ---------------------------------------------------------------------------
-- Increment 10 made ownership mechanically inspectable by putting it IN the key:
-- `<owner-uuid>/<object-uuid>.<ext>`, with every policy reading
-- `split_part(name,'/',1) = auth.uid()`. For a file only its owner ever reads,
-- that is exactly right, and Certificates keep it unchanged.
--
-- Portfolio is the case it does not survive. A published item must be readable by
-- a signed-out stranger, and in this stack the Next server IS that stranger: with
-- no session it holds the anon key, the same credential the browser has. So any
-- function that turns a public item id into a storage key is callable by the
-- browser too — and an owner-prefixed key hands out `users.id`.
--
-- That is not a small leak here. `profiles.id` and `users.id` are deliberately
-- different values (the public route is keyed on the former), and
-- `17_public_directory_hardening_test` asserts by name that `user_id` stays out
-- of every public projection. Publishing a photo must not be the one thing that
-- undoes it.
--
-- So Portfolio keys become OPAQUE — `<object-uuid>.<ext>`, no owner segment, no
-- filename, nothing derivable — and ownership moves to where it can be asked
-- privately: the metadata row. The storage policies below resolve ownership
-- through narrow `security definer` booleans over `public.portfolio_items` and
-- `auth.uid()`, and NO helper reachable by `anon` returns an owner id.
--
-- This is strictly stronger than the path check it replaces. Under Increment 10
-- a well-formed key was sufficient to write; here a metadata row must already
-- exist, owned by the caller, in `pending` state — so bytes cannot be uploaded at
-- all until the product has authorized that exact object.
--
-- Forward-only: the three Increment 10 portfolio policies are dropped and
-- replaced here. Nothing in the pushed migration is edited, and the certificates
-- policies, `app.is_professional_asset_key` and both buckets are untouched.
--
-- ---------------------------------------------------------------------------
-- THE TWO SYSTEMS, AND THE ORDER THAT MAKES THEM CONVERGE (S3)
-- ---------------------------------------------------------------------------
-- Postgres and Storage are separate systems and no transaction spans them. So
-- the metadata row is the product authority and every sequence is ordered so that
-- a failure at any step leaves a state that is safe and retryable:
--
--   CREATE   row(pending) -> upload bytes -> row(ready)
--            A pending row is invisible to the public and carries no bytes yet.
--            An abandoned one is a visible "unfinished upload" the owner can
--            discard; bytes with no row are unreachable by every policy here.
--   DELETE   row(deleted) -> remove object -> purge row
--            Visibility stops FIRST, atomically, in Postgres. If either later
--            step fails the row sits in `deleted`, invisible to owner and public
--            alike, and the same sequence run again completes it.
--
-- No scheduler, and no pretence that the two systems commit together.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Types
-- ---------------------------------------------------------------------------
create type public.portfolio_visibility as enum ('private', 'public');

comment on type public.portfolio_visibility is
  'Owner-controlled publication of ONE portfolio item. `private` is the default and the only value a new item can be created with (S1). It is not the whole public test: an item is public only when it is also `ready` and its profile is currently listed.';

-- One lifecycle for both domains, because both have it for the same reason: two
-- systems, no shared transaction. It is deliberately NOT a product status —
-- nothing about it is shown as a state a person manages.
create type public.professional_asset_state as enum ('pending', 'ready', 'deleted');

comment on type public.professional_asset_state is
  'Upload/cleanup convergence state, not a product status. `pending` = metadata exists and bytes may not; `ready` = both exist; `deleted` = visibility has been withdrawn and object cleanup is owed. Only `ready` is ever publicly visible, and `deleted` is excluded by the owner''s own RLS policy so it cannot appear in an ordinary query.';

-- ---------------------------------------------------------------------------
-- 2. public.portfolio_items
-- ---------------------------------------------------------------------------
create table public.portfolio_items (
  id             uuid primary key default extensions.gen_random_uuid(),

  -- The owner, and the ONLY thing ownership is ever read from. Never supplied by
  -- a caller: every writer below derives it from auth.uid().
  owner_user_id  uuid not null references public.users (id) on delete cascade,

  -- OPAQUE. `<object-uuid>.<ext>` inside the private portfolio bucket, carrying
  -- no owner id and no display filename, so it can be resolved for an anonymous
  -- visitor without disclosing who owns it.
  object_key     text not null,

  content_type   text not null,

  title          text not null,
  description    text,

  visibility     public.portfolio_visibility     not null default 'private',
  state          public.professional_asset_state not null default 'pending',

  -- Dense, owner-controlled, server-authoritative. Ties break on created_at then
  -- id so the order is total even mid-reorder.
  sort_order     integer not null default 0,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint uq_portfolio_object_key unique (object_key),

  -- The opaque key contract, stated where it cannot be bypassed. Anchored, so it
  -- admits exactly one lowercase uuid and one extension: no separator, hence no
  -- folder, no traversal, no owner segment and no filename.
  constraint ck_portfolio_object_key check (
    object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'),

  -- S4: the public portfolio is JPEG/PNG/WebP. Same list the bucket enforces,
  -- repeated here because this table is what decides an object is publishable.
  constraint ck_portfolio_content_type check (
    content_type in ('image/jpeg', 'image/png', 'image/webp')),

  constraint ck_portfolio_title check (char_length(btrim(title)) between 1 and 120),
  constraint ck_portfolio_description check (
    description is null or char_length(description) <= 600),

  -- Bytes alone never make an item public, and neither does a title (§7). An
  -- item that is not `ready` cannot hold `public`, at the table level, so no
  -- writer can produce that row even by accident.
  constraint ck_portfolio_public_is_ready check (
    visibility = 'private' or state = 'ready')
);

comment on table public.portfolio_items is
  'Professional work samples. The product authority for one stored object (S3): the row decides what an object means, whether it is published, and where it sits in the owner''s order. Ownership is this table''s column, never the object key — Portfolio keys are opaque precisely so a public reader can resolve one without learning who owns it. Written ONLY through the portfolio_item_* RPCs; clients hold no DML grant.';

comment on column public.portfolio_items.object_key is
  'Opaque object key inside the PRIVATE professional-portfolio bucket: `<uuid>.<jpg|png|webp>`. Deliberately carries no owner id and no filename, superseding Increment 10''s owner-prefixed contract for this bucket only — a published item must be resolvable for an anonymous visitor, and the Next server shares the browser''s anon identity, so anything resolvable is disclosable.';

create index ix_portfolio_items_owner on public.portfolio_items (owner_user_id, sort_order, created_at, id);
-- The storage policies resolve an object key on every signed-URL mint.
create index ix_portfolio_items_public on public.portfolio_items (object_key)
  where visibility = 'public' and state = 'ready';

create trigger trg_portfolio_items_updated_at
  before update on public.portfolio_items
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. public.professional_certificates
-- ---------------------------------------------------------------------------
create table public.professional_certificates (
  id                uuid primary key default extensions.gen_random_uuid(),
  owner_user_id     uuid not null references public.users (id) on delete cascade,

  -- Increment 10's contract, UNCHANGED: `<owner-uuid>/<object-uuid>.<ext>`.
  -- A certificate is read by its owner and by nobody else, ever, so ownership in
  -- the key costs nothing and the existing policies already enforce it.
  object_path       text not null,
  content_type      text not null,

  title             text not null,
  issuer            text,
  issued_on         date,
  expires_on        date,

  -- Kept for the owner's own recognition only. Never part of a key, never used
  -- to fetch anything, and never rendered anywhere but this person's own list.
  original_filename text,

  state             public.professional_asset_state not null default 'pending',

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint uq_certificate_object_path unique (object_path),
  constraint ck_certificate_object_path check (
    object_path ~ '^[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png|webp)$'
    and split_part(object_path, '/', 1) = owner_user_id::text),
  constraint ck_certificate_content_type check (
    content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  constraint ck_certificate_title check (char_length(btrim(title)) between 1 and 160),
  constraint ck_certificate_issuer check (issuer is null or char_length(issuer) <= 160),
  constraint ck_certificate_filename check (
    original_filename is null or char_length(original_filename) <= 255),
  -- A certificate that expired before it was issued is a typo, and catching it
  -- here is the only validation this domain performs on the CLAIM itself.
  constraint ck_certificate_dates check (
    issued_on is null or expires_on is null or expires_on >= issued_on)
);

comment on table public.professional_certificates is
  'Self-declared professional evidence, owner-private in the Pilot (S2). There is deliberately NO verification column, no reviewer, no approval state and no public projection of any kind: the platform stores what a person says they hold and vouches for none of it. If verification is ever wanted it arrives as its own decision with a named holder — it must not appear here as a boolean nobody owns.';

create index ix_certificates_owner on public.professional_certificates (owner_user_id, created_at desc, id);

create trigger trg_certificates_updated_at
  before update on public.professional_certificates
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. RLS on the metadata — reads only, exactly as this repository does it
-- ---------------------------------------------------------------------------
-- RLS answers who may READ; the RPCs answer who may CHANGE. Neither table grants
-- INSERT, UPDATE or DELETE to any client role, so the policies below are purely
-- about visibility.
alter table public.portfolio_items enable row level security;
alter table public.professional_certificates enable row level security;

-- STRIP SUPABASE'S DEFAULTS FIRST. `alter default privileges` grants `arwdDxtm`
-- on every new public table to anon, authenticated and service_role — TRUNCATE
-- included, and TRUNCATE is not restricted by RLS. Enabling row level security
-- would therefore have left `anon` able to empty both tables. Same strip-then-
-- grant order the Jobs domain uses, and for the same reason.
revoke all on public.portfolio_items, public.professional_certificates
  from anon, authenticated, service_role;

grant select on public.portfolio_items to authenticated, service_role;
grant select on public.professional_certificates to authenticated, service_role;

-- `state <> 'deleted'` is IN THE POLICY rather than in each query (§8): a row
-- awaiting object cleanup is invisible to its owner by construction, so no
-- hand-written select can resurface it later.
create policy portfolio_items_select_own on public.portfolio_items
  for select to authenticated
  using (owner_user_id = (select auth.uid()) and state <> 'deleted');

create policy certificates_select_own on public.professional_certificates
  for select to authenticated
  using (owner_user_id = (select auth.uid()) and state <> 'deleted');

-- No policy admits `anon` to either table, and there is no public projection of
-- certificates anywhere in this migration. The public portfolio seam is §6's
-- view, which exposes no owner and no key.

-- ---------------------------------------------------------------------------
-- 5. Portfolio storage authority — ownership from METADATA, not from the path
-- ---------------------------------------------------------------------------
-- Two booleans, both `security definer` because they read a table the caller may
-- not read in full, and both answering only about the CALLER. Neither returns an
-- owner id, and neither can be asked about anybody else.

create function app.owns_portfolio_object(p_object_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.portfolio_items i
    where i.object_key = p_object_key
      and i.owner_user_id = (select auth.uid())
  );
$$;

comment on function app.owns_portfolio_object(text) is
  'True when the CALLER owns the portfolio metadata row that points at this object key. Deliberately ignores state, so an object stays readable and DELETABLE by its owner while a row sits in `deleted` awaiting cleanup — which is what lets deletion converge. Returns a boolean about auth.uid() and nothing about anyone else.';

create function app.can_upload_portfolio_object(p_object_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.portfolio_items i
    where i.object_key = p_object_key
      and i.owner_user_id = (select auth.uid())
      and i.state = 'pending'::public.professional_asset_state
  );
$$;

comment on function app.can_upload_portfolio_object(text) is
  'True when the caller owns a PENDING portfolio row for this key — the authorization to write those exact bytes, once. Stricter than the key-shape check it replaces: a well-formed key is no longer sufficient, the product must already have authorized this object. The professional persona gate lives at row creation (portfolio_item_create), so bytes are unreachable without having passed it.';

create function app.is_published_portfolio_object(p_object_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.portfolio_items i
    join public.profiles p on p.user_id = i.owner_user_id
    -- The ONE definition of "listed", reused rather than reproduced: the same
    -- projection the public profile page itself is built on, so publication can
    -- never mean one thing to a page and another to a photo.
    join public.profile_public_directory d on d.id = p.id
    where i.object_key = p_object_key
      and i.visibility = 'public'::public.portfolio_visibility
      and i.state = 'ready'::public.professional_asset_state
  );
$$;

comment on function app.is_published_portfolio_object(text) is
  'The complete public test for ONE portfolio object: explicitly public, ready, and belonging to a profile that is CURRENTLY listed. Unlisting a profile therefore withdraws its public portfolio immediately without touching any saved visibility, and relisting restores exactly what the owner had chosen. Takes a key and returns a boolean — it discloses nothing, which is why it is safe for anon to evaluate inside a policy.';

revoke execute on function app.owns_portfolio_object(text),
                          app.can_upload_portfolio_object(text),
                          app.is_published_portfolio_object(text) from public;
grant execute on function app.owns_portfolio_object(text),
                         app.can_upload_portfolio_object(text) to authenticated;
-- anon needs this one: a signed-out visitor's own identity is what mints the
-- signed read URL, and the policy expression evaluates as that role.
grant execute on function app.is_published_portfolio_object(text)
  to anon, authenticated, service_role;

-- --- Replace Increment 10's three portfolio policies -------------------------
-- Certificates keep theirs untouched; only this bucket's ownership model moved.
drop policy if exists professional_portfolio_insert_own on storage.objects;
drop policy if exists professional_portfolio_select_own on storage.objects;
drop policy if exists professional_portfolio_delete_own on storage.objects;

create policy professional_portfolio_insert_authorized on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'professional-portfolio'
    and app.can_upload_portfolio_object(name)
  );

create policy professional_portfolio_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'professional-portfolio'
    and app.owns_portfolio_object(name)
  );

create policy professional_portfolio_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'professional-portfolio'
    and app.owns_portfolio_object(name)
  );

-- The one public door in this product, and it is exactly one object wide.
-- NOT a broad grant: it admits no bucket listing, no folder, and no object that
-- is not already published on a listed profile. The certificates bucket gains
-- nothing here and has no anon policy at all.
create policy professional_portfolio_select_published on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'professional-portfolio'
    and app.is_published_portfolio_object(name)
  );

-- Still no UPDATE policy on either bucket: object keys remain immutable, and a
-- replacement is a new object plus a deliberate metadata switch (Increment 10 §9).

-- ---------------------------------------------------------------------------
-- 6. The public portfolio projection (§6)
-- ---------------------------------------------------------------------------
-- Rendering data only. No owner id, no object key, no state, no visibility, no
-- certificate: the columns are the ones a page draws and nothing else.
create function app._public_portfolio_items()
returns table (
  profile_id  uuid,
  id          uuid,
  title       text,
  description text,
  sort_order  integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, i.id, i.title, i.description, i.sort_order
  from public.portfolio_items i
  join public.profiles p on p.user_id = i.owner_user_id
  join public.profile_public_directory d on d.id = p.id
  where i.visibility = 'public'::public.portfolio_visibility
    and i.state = 'ready'::public.professional_asset_state;
$$;

create view public.public_portfolio_items with (security_invoker = true) as
  select profile_id, id, title, description, sort_order
  from app._public_portfolio_items();

comment on view public.public_portfolio_items is
  'Published portfolio items of currently listed profiles, keyed by profiles.id. Exposes only what a page renders — title, optional description and the owner''s order. NOT here, deliberately: owner_user_id (17_public_directory_hardening keeps user ids out of every public projection), the storage key, visibility and state. Media is fetched separately through /p/media/<id>, which re-proves publication for the exact object.';

grant execute on function app._public_portfolio_items() to anon, authenticated, service_role;
revoke all on public.public_portfolio_items from anon, authenticated, service_role;
grant select on public.public_portfolio_items to anon, authenticated, service_role;

-- The media resolver. Returns an OPAQUE key and only for a published item, so a
-- caller learns nothing it could not already see on the public page.
create function public.public_portfolio_media_key(p_item_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select i.object_key
  from public.portfolio_items i
  join public.profiles p on p.user_id = i.owner_user_id
  join public.profile_public_directory d on d.id = p.id
  where i.id = p_item_id
    and i.visibility = 'public'::public.portfolio_visibility
    and i.state = 'ready'::public.professional_asset_state;
$$;

comment on function public.public_portfolio_media_key(uuid) is
  'Maps a PUBLISHED portfolio item id to its opaque storage key, for the /p/media/<id> route handler. Safe to grant to anon because the key it returns is opaque by construction: no owner id, no filename, nothing derivable. Returns null for a private item, a pending or deleted one, an unlisted profile, and for every certificate — certificates are not in this table at all.';

revoke execute on function public.public_portfolio_media_key(uuid) from public;
grant execute on function public.public_portfolio_media_key(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Portfolio writers
-- ---------------------------------------------------------------------------
-- Every one of them: security definer, owner derived from auth.uid(), no caller
-- may name an owner, and no client holds DML on the table.

create function public.portfolio_item_create(
  p_title        text,
  p_description  text,
  p_content_type text
)
returns table (item_id uuid, object_key text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_ext  text;
  v_key  text;
  v_next integer;
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- The ONLY persona gate in this domain, and it is on creation alone (§4).
  -- Publishing, editing, reordering and deleting never consult it, so a persona
  -- downgrade can never strand somebody's own data.
  if not app.can_create_professional_asset() then
    raise exception 'a professional persona is required to add portfolio work'
      using errcode = '42501';
  end if;

  v_ext := case p_content_type
             when 'image/jpeg' then 'jpg'
             when 'image/png'  then 'png'
             when 'image/webp' then 'webp'
           end;
  if v_ext is null then
    raise exception 'unsupported content type for portfolio work'
      using errcode = '22023';
  end if;

  -- Opaque and server-generated. The caller contributes nothing to it.
  v_key := extensions.gen_random_uuid()::text || '.' || v_ext;

  select coalesce(max(i.sort_order), -1) + 1 into v_next
  from public.portfolio_items i
  where i.owner_user_id = v_uid and i.state <> 'deleted'::public.professional_asset_state;

  insert into public.portfolio_items
    (owner_user_id, object_key, content_type, title, description, sort_order)
  values
    (v_uid, v_key, p_content_type, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), v_next)
  returning id into v_id;

  return query select v_id, v_key;
end;
$$;

comment on function public.portfolio_item_create(text, text, text) is
  'Creates a PRIVATE, PENDING portfolio item and returns the opaque storage key the caller may then upload to, once. Metadata first (S3): the row is the authority, so the object identity is decided and recorded before any bytes exist — which is what makes a lost response recoverable rather than ambiguous. Requires the professional persona; this is the only writer in the domain that does.';

create function public.portfolio_item_finalize(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_state public.professional_asset_state;
begin
  select i.state into v_state
  from public.portfolio_items i
  where i.id = p_item_id and i.owner_user_id = v_uid
  for update;

  if not found then
    raise exception 'portfolio item not found' using errcode = '42501';
  end if;
  -- Idempotent: a retried finalize on a ready item is a success, because the
  -- caller's intent ("this upload is complete") already holds.
  if v_state = 'ready'::public.professional_asset_state then
    return;
  end if;
  if v_state <> 'pending'::public.professional_asset_state then
    raise exception 'this portfolio item cannot be finalized' using errcode = '22023';
  end if;

  update public.portfolio_items
     set state = 'ready'::public.professional_asset_state
   where id = p_item_id;
end;
$$;

comment on function public.portfolio_item_finalize(uuid) is
  'Marks a pending portfolio item ready once its bytes are stored. Idempotent, so a client that lost the response can simply call again. Does NOT publish: a finalized item is still private, because bytes arriving is not a decision to show them to anyone (S1).';

create function public.portfolio_item_update(
  p_item_id     uuid,
  p_title       text,
  p_description text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  update public.portfolio_items
     set title = btrim(p_title),
         description = nullif(btrim(coalesce(p_description, '')), '')
   where id = p_item_id
     and owner_user_id = v_uid
     and state <> 'deleted'::public.professional_asset_state;

  if not found then
    raise exception 'portfolio item not found' using errcode = '42501';
  end if;
end;
$$;

create function public.portfolio_item_set_visibility(
  p_item_id uuid,
  p_public  boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_state public.professional_asset_state;
begin
  select i.state into v_state
  from public.portfolio_items i
  where i.id = p_item_id and i.owner_user_id = v_uid
    and i.state <> 'deleted'::public.professional_asset_state
  for update;

  if not found then
    raise exception 'portfolio item not found' using errcode = '42501';
  end if;
  if p_public and v_state <> 'ready'::public.professional_asset_state then
    raise exception 'an unfinished item cannot be published' using errcode = '22023';
  end if;

  update public.portfolio_items
     set visibility = case when p_public then 'public' else 'private' end::public.portfolio_visibility
   where id = p_item_id;
end;
$$;

comment on function public.portfolio_item_set_visibility(uuid, boolean) is
  'The owner''s publish/unpublish switch, and the ONLY writer of visibility. No persona gate on purpose: a downgraded professional must always be able to UNPUBLISH, exactly as availability may always be withdrawn. Publishing while downgraded is harmless and needs no gate either — such a profile is not listed, so nothing becomes visible.';

create function public.portfolio_item_move(p_item_id uuid, p_direction text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_pos  integer;
  v_swap uuid;
begin
  if p_direction not in ('up', 'down') then
    raise exception 'unknown direction' using errcode = '22023';
  end if;

  perform 1 from public.portfolio_items
   where id = p_item_id and owner_user_id = v_uid
     and state <> 'deleted'::public.professional_asset_state;
  if not found then
    raise exception 'portfolio item not found' using errcode = '42501';
  end if;

  -- Renumber densely first, in the CURRENT total order. History may hold ties
  -- (equal sort_order from a create race), and a swap over ties is ambiguous;
  -- after this every row of the owner's has a distinct position.
  with ordered as (
    select id, row_number() over (order by sort_order, created_at, id) - 1 as rn
    from public.portfolio_items
    where owner_user_id = v_uid and state <> 'deleted'::public.professional_asset_state
  )
  update public.portfolio_items i
     set sort_order = o.rn
    from ordered o
   where i.id = o.id and i.sort_order is distinct from o.rn;

  select sort_order into v_pos from public.portfolio_items where id = p_item_id;

  select id into v_swap
  from public.portfolio_items
  where owner_user_id = v_uid
    and state <> 'deleted'::public.professional_asset_state
    and sort_order = case when p_direction = 'up' then v_pos - 1 else v_pos + 1 end;

  -- At either end there is nothing to swap with, and that is not an error: the
  -- button is simply inert, and saying so with an exception would turn a no-op
  -- into a failure the reader has to interpret.
  if v_swap is null then
    return;
  end if;

  update public.portfolio_items set sort_order = v_pos where id = v_swap;
  update public.portfolio_items
     set sort_order = case when p_direction = 'up' then v_pos - 1 else v_pos + 1 end
   where id = p_item_id;
end;
$$;

comment on function public.portfolio_item_move(uuid, text) is
  'Moves one item earlier or later in the owner''s order, server-authoritatively. Renumbers the owner''s items densely before swapping so the operation is well defined even if positions ever tie. The public profile reads the same sort_order, so what the owner arranges is what a visitor sees.';

create function public.portfolio_item_delete(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  -- Step one of two systems: visibility stops HERE, atomically, before anything
  -- is asked of Storage. The policy on this table excludes `deleted`, so the row
  -- leaves the owner's list in the same instant it leaves the public one.
  update public.portfolio_items
     set state = 'deleted'::public.professional_asset_state,
         visibility = 'private'::public.portfolio_visibility
   where id = p_item_id
     and owner_user_id = v_uid
     and state <> 'deleted'::public.professional_asset_state;

  if not found then
    raise exception 'portfolio item not found' using errcode = '42501';
  end if;
end;
$$;

comment on function public.portfolio_item_delete(uuid) is
  'Withdraws an item from every surface immediately and marks its object for cleanup. Visibility is also forced back to private so that a row which somehow survives cleanup can never be republished by a later bug. No persona gate: removing your own data is always allowed.';

create function public.portfolio_item_purge(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  delete from public.portfolio_items
   where id = p_item_id
     and owner_user_id = v_uid
     and state = 'deleted'::public.professional_asset_state;
  -- Silent when there is nothing left to purge. This runs after an idempotent
  -- object delete, and a retry that finds the work already done has succeeded.
end;
$$;

comment on function public.portfolio_item_purge(uuid) is
  'Removes a row whose object has been deleted. Only a `deleted` row of the caller''s own, and silent when absent — the last step of a convergent sequence has to be safe to repeat. A row that never reaches purge stays invisible to everyone and can be swept by running the same sequence again.';

-- ---------------------------------------------------------------------------
-- 8. Certificate writers
-- ---------------------------------------------------------------------------
create function public.certificate_create(
  p_title             text,
  p_issuer            text,
  p_issued_on         date,
  p_expires_on        date,
  p_content_type      text,
  p_original_filename text
)
returns table (item_id uuid, object_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_ext  text;
  v_path text;
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not app.can_create_professional_asset() then
    raise exception 'a professional persona is required to add a certificate'
      using errcode = '42501';
  end if;

  v_ext := case p_content_type
             when 'application/pdf' then 'pdf'
             when 'image/jpeg'      then 'jpg'
             when 'image/png'       then 'png'
             when 'image/webp'      then 'webp'
           end;
  if v_ext is null then
    raise exception 'unsupported content type for a certificate'
      using errcode = '22023';
  end if;

  -- Increment 10's owner-prefixed contract, unchanged. Nothing public ever
  -- resolves a certificate, so ownership in the key discloses nothing.
  v_path := v_uid::text || '/' || extensions.gen_random_uuid()::text || '.' || v_ext;

  insert into public.professional_certificates
    (owner_user_id, object_path, content_type, title, issuer, issued_on, expires_on, original_filename)
  values
    (v_uid, v_path, p_content_type, btrim(p_title),
     nullif(btrim(coalesce(p_issuer, '')), ''), p_issued_on, p_expires_on,
     nullif(btrim(coalesce(p_original_filename, '')), ''))
  returning id into v_id;

  return query select v_id, v_path;
end;
$$;

comment on function public.certificate_create(text, text, date, date, text, text) is
  'Creates a PENDING certificate and returns the storage path to upload to. Records what the holder says they hold: there is no verification field to set, no reviewer to route to, and no state that could be mistaken for platform endorsement (S2).';

create function public.certificate_finalize(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_state public.professional_asset_state;
begin
  select c.state into v_state
  from public.professional_certificates c
  where c.id = p_item_id and c.owner_user_id = v_uid
  for update;

  if not found then
    raise exception 'certificate not found' using errcode = '42501';
  end if;
  if v_state = 'ready'::public.professional_asset_state then
    return;
  end if;
  if v_state <> 'pending'::public.professional_asset_state then
    raise exception 'this certificate cannot be finalized' using errcode = '22023';
  end if;

  update public.professional_certificates
     set state = 'ready'::public.professional_asset_state
   where id = p_item_id;
end;
$$;

create function public.certificate_update(
  p_item_id    uuid,
  p_title      text,
  p_issuer     text,
  p_issued_on  date,
  p_expires_on date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  update public.professional_certificates
     set title = btrim(p_title),
         issuer = nullif(btrim(coalesce(p_issuer, '')), ''),
         issued_on = p_issued_on,
         expires_on = p_expires_on
   where id = p_item_id
     and owner_user_id = v_uid
     and state <> 'deleted'::public.professional_asset_state;

  if not found then
    raise exception 'certificate not found' using errcode = '42501';
  end if;
end;
$$;

create function public.certificate_delete(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  update public.professional_certificates
     set state = 'deleted'::public.professional_asset_state
   where id = p_item_id
     and owner_user_id = v_uid
     and state <> 'deleted'::public.professional_asset_state;

  if not found then
    raise exception 'certificate not found' using errcode = '42501';
  end if;
end;
$$;

create function public.certificate_purge(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  delete from public.professional_certificates
   where id = p_item_id
     and owner_user_id = v_uid
     and state = 'deleted'::public.professional_asset_state;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Grants — the RPCs are the whole write path
-- ---------------------------------------------------------------------------
revoke execute on function
  public.portfolio_item_create(text, text, text),
  public.portfolio_item_finalize(uuid),
  public.portfolio_item_update(uuid, text, text),
  public.portfolio_item_set_visibility(uuid, boolean),
  public.portfolio_item_move(uuid, text),
  public.portfolio_item_delete(uuid),
  public.portfolio_item_purge(uuid),
  public.certificate_create(text, text, date, date, text, text),
  public.certificate_finalize(uuid),
  public.certificate_update(uuid, text, text, date, date),
  public.certificate_delete(uuid),
  public.certificate_purge(uuid)
from public, anon;

grant execute on function
  public.portfolio_item_create(text, text, text),
  public.portfolio_item_finalize(uuid),
  public.portfolio_item_update(uuid, text, text),
  public.portfolio_item_set_visibility(uuid, boolean),
  public.portfolio_item_move(uuid, text),
  public.portfolio_item_delete(uuid),
  public.portfolio_item_purge(uuid),
  public.certificate_create(text, text, date, date, text, text),
  public.certificate_finalize(uuid),
  public.certificate_update(uuid, text, text, date, date),
  public.certificate_delete(uuid),
  public.certificate_purge(uuid)
to authenticated;
