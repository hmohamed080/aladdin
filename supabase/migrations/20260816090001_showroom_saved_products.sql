-- Migration: Showroom buyer surfaces — saved products + persona-filterable
-- professional directory (Phase 3, Sprint 14).
--
-- Two additions, each required by exactly one showroom module and nothing else:
--
--   A. public.saved_products — the "Saved Products" module. A showroom shortlists
--      catalog items it intends to request a quote for. This is a BOOKMARK, not a
--      cart and not a commitment: Aladdin is consultation-first, so a saved product
--      confers no price, no reservation and no order. It is owned by the
--      ORGANIZATION (the whole buying team shares one shortlist) while recording
--      which member saved it.
--
--   B. app._profile_public_directory() gains the persona column — the "Technicians"
--      module needs to show installers/technicians (الصنايعية) specifically, not an
--      undifferentiated list of every listed professional. The persona is already
--      the eligibility gate for appearing in this directory at all, so exposing it
--      publishes no new fact about a person; it only makes the existing projection
--      filterable.
--
-- Security model is unchanged (ADR-0008): the base table is SELECT-only for client
-- roles, every mutation is a security-definer RPC that derives the actor from
-- auth.uid() and enforces organization scope, and the directory stays a
-- security_invoker view over a constrained definer reader.
--
-- Deliberately NOT audited: saving/unsaving a catalog item is a private shortlisting
-- act with no lifecycle, counterparty or money attached. Adding it to audit_log
-- would dilute a table that records business-consequential events, so the audit
-- action allow-list is left untouched.

-- ===========================================================================
-- A1. saved_products
-- ===========================================================================
create table public.saved_products (
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  product_id      uuid        not null references public.products (id)      on delete cascade,
  saved_by        uuid        not null references public.users (id)         on delete cascade,
  note            text,
  created_at      timestamptz not null default now(),
  -- One shortlist entry per product per organization. A second member saving the
  -- same product updates the existing row rather than duplicating it.
  primary key (organization_id, product_id),
  constraint ck_saved_products_note_len check (note is null or char_length(note) <= 500)
);

comment on table public.saved_products is
  'Organization-owned shortlist of catalog products a buying team intends to request quotes for. A bookmark only — never a cart, reservation, price lock or order (Aladdin is consultation-first). Written exclusively through save_product/unsave_product.';

-- Listing a shortlist is always "this organization, newest first".
create index ix_saved_products_org_created on public.saved_products (organization_id, created_at desc);
-- Supports the cascade path and "who saved this" lookups.
create index ix_saved_products_saved_by on public.saved_products (saved_by);

-- ===========================================================================
-- A2. RLS — a member of the owning organization may read its shortlist.
-- ===========================================================================
alter table public.saved_products enable row level security;

create policy saved_products_select_own_org on public.saved_products
  for select to authenticated
  using (app.is_org_member(organization_id));

create policy saved_products_select_platform on public.saved_products
  for select to authenticated
  using (app.is_platform('support'));

-- No INSERT/UPDATE/DELETE policy exists: writes go through the RPCs below only.
revoke all on public.saved_products from anon, authenticated, service_role;
grant select on public.saved_products to authenticated, service_role;

-- ===========================================================================
-- A3. Display view — the shortlist joined to its catalog projection.
-- ===========================================================================
-- security_invoker = true: the caller's own RLS decides which saved_products rows
-- they see, and catalog_published_products already restricts to published products
-- of non-deleted suppliers. A product that is later unpublished or deleted simply
-- drops out of the list instead of leaking a private row.
create view public.saved_product_list with (security_invoker = true) as
  select
    s.organization_id,
    s.product_id,
    s.saved_by,
    s.note,
    s.created_at        as saved_at,
    c.name,
    c.sku,
    c.category,
    c.brand,
    c.short_description,
    c.unit,
    c.image_ref,
    c.organization_id   as supplier_org_id,
    c.supplier_name,
    c.supplier_verified
  from public.saved_products s
  join public.catalog_published_products c on c.id = s.product_id;

comment on view public.saved_product_list is
  'Saved-products shortlist joined to the public catalog projection for display. security_invoker=true, so saved_products RLS scopes the rows and only still-published products appear.';

revoke all on public.saved_product_list from anon, authenticated, service_role;
grant select on public.saved_product_list to authenticated;

-- ===========================================================================
-- A4. Write paths
-- ===========================================================================
-- Saving requires organization membership only. Shortlisting is not a commercial
-- act, so gating it on catalog.write/rfq.create would lock out exactly the buyers
-- the module exists for. The product must be visible in the PUBLIC catalog: without
-- that check, save_product would answer "does product <uuid> exist?" for private
-- draft products of other tenants.
create or replace function public.save_product(
  p_organization_id uuid,
  p_product_id      uuid,
  p_note            text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_org_member(p_organization_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.products p
    join public.organizations o on o.id = p.organization_id
    where p.id = p_product_id
      and p.status = 'published'
      and p.deleted_at is null
      and o.deleted_at is null
  ) then
    raise exception 'product not found' using errcode = 'P0002';
  end if;

  insert into public.saved_products (organization_id, product_id, saved_by, note)
  values (p_organization_id, p_product_id, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (organization_id, product_id) do update
    set note     = excluded.note,
        saved_by = excluded.saved_by;
end;
$$;

comment on function public.save_product(uuid, uuid, text) is
  'Adds a PUBLISHED catalog product to the calling organization''s shortlist (or updates its note). Membership-scoped; confers no price, reservation or order.';

create or replace function public.unsave_product(
  p_organization_id uuid,
  p_product_id      uuid
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_org_member(p_organization_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  delete from public.saved_products
  where organization_id = p_organization_id
    and product_id = p_product_id;
end;
$$;

comment on function public.unsave_product(uuid, uuid) is
  'Removes a product from the calling organization''s shortlist. Membership-scoped. Idempotent — removing an absent entry succeeds.';

revoke execute on function public.save_product(uuid, uuid, text)  from public;
revoke execute on function public.unsave_product(uuid, uuid)      from public;
grant  execute on function public.save_product(uuid, uuid, text)  to authenticated;
grant  execute on function public.unsave_product(uuid, uuid)      to authenticated;

-- ===========================================================================
-- B. Expose the persona on the professional directory
-- ===========================================================================
-- The function's RETURNS TABLE signature changes, so the dependent view must be
-- dropped first — `create or replace function` cannot alter a return type.
drop view public.profile_public_directory;
drop function app._profile_public_directory();

create function app._profile_public_directory()
returns table (
  id              uuid,
  display_name    text,
  headline        text,
  bio             text,
  avatar_media_id uuid,
  locality_id     uuid,
  languages       text[],
  persona         public.persona_type
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.headline, p.bio,
         p.avatar_media_id, p.locality_id, p.languages,
         u.primary_account_type
  from public.profiles p
  join public.users u on u.id = p.user_id
  where p.deleted_at is null
    and p.public_profile_status = 'listed'::public.public_profile_status
    and u.status = 'active'::public.user_status
    and u.primary_account_type is not null
    and u.primary_account_type <> 'end_consumer'::public.persona_type;
$$;

comment on function app._profile_public_directory() is
  'Internal SECURITY DEFINER reader backing public.profile_public_directory. Returns ONLY approved display columns of listed, active, non-deleted PERSONAL professional profiles, plus the persona that already gates listing (so the directory can be filtered to technicians, engineers, designers). A business-only identity (null persona) is never listed. Not in an exposed schema; PUBLIC execute revoked.';

-- DROP destroyed the previous ACL, so the full grant set must be reasserted here,
-- not just the revoke: the view is security_invoker, which means the CALLER needs
-- EXECUTE on this reader. Reasserting only the revoke would leave the directory
-- readable by nobody (42501 for every caller, anon and authenticated alike).
revoke execute on function app._profile_public_directory() from public;
grant  execute on function app._profile_public_directory() to anon, authenticated, service_role;

create view public.profile_public_directory
  with (security_invoker = true) as
  select id, display_name, headline, bio, avatar_media_id, locality_id, languages, persona
  from app._profile_public_directory();

comment on view public.profile_public_directory is
  'Approved PUBLIC projection of professional profiles for discovery. security_invoker=true view over the constrained SECURITY DEFINER reader app._profile_public_directory(). Requires listed + active + not-deleted + a professional persona. Exposes the persona so callers can filter (e.g. installer_technician for the Technicians directory); never user_id/contacts/timestamps/deleted_at.';

revoke all on public.profile_public_directory from anon, authenticated, service_role;
grant select on public.profile_public_directory to anon, authenticated, service_role;
