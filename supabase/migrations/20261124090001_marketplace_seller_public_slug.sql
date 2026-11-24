-- Marketplace: public slug of an approved seller (browse-only first launch).
-- The storefront (/market/sellers/<slug>) and the product page address a showroom by organizations.slug. PR 9 (20261123150001) is merged
-- and must not change, so the generator ships in this follow-up migration. No existing function is replaced or dropped, and
-- app.marketplace_seller_transition is not touched: the slug is assigned by an AFTER trigger on marketplace_seller_accounts.
-- The storefront and the product page address a showroom by organizations.slug. An organization that becomes an approved seller
-- and has no slug gets one generated from its name: ASCII letters and digits only (an Arabic-only name falls back to
-- 'showroom-<8 hex of the id>'), -2, -3 ... on collision, always inside ck_organizations_slug_format. Existing slugs are never
-- changed. Written as a trigger on the seller account so app.marketplace_seller_transition stays untouched.
create or replace function app.marketplace_assign_org_slug(p_org uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  o      public.organizations;
  v_base text;
  v_slug text;
  v_n    integer := 1;
begin
  select * into o from public.organizations where id = p_org for update;
  if not found or o.slug is not null then
    return o.slug;
  end if;
  v_base := regexp_replace(lower(coalesce(nullif(btrim(o.name_en), ''), o.name)), '[^a-z0-9]+', '-', 'g');
  v_base := btrim(left(btrim(v_base, '-'), 60), '-');
  if v_base = '' or v_base is null then
    v_base := 'showroom-' || left(replace(o.id::text, '-', ''), 8);
  end if;
  v_slug := v_base;
  while exists (select 1 from public.organizations x where x.slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  update public.organizations set slug = v_slug where id = p_org;
  return v_slug;
end;
$$;

create or replace function app.marketplace_seller_slug_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.marketplace_assign_org_slug(new.organization_id);
  return null;
end;
$$;

create or replace trigger marketplace_seller_slug_assign
  after insert or update of status on public.marketplace_seller_accounts
  for each row when (new.status = 'approved')
  execute function app.marketplace_seller_slug_trigger();

-- Backfill: sellers that are approved already and still have no slug (only those organizations are touched).
do $backfill$
declare
  r record;
begin
  for r in select a.organization_id from public.marketplace_seller_accounts a
           join public.organizations o on o.id = a.organization_id
           where a.status = 'approved' and o.slug is null
  loop
    perform app.marketplace_assign_org_slug(r.organization_id);
  end loop;
end
$backfill$;

revoke all on function app.marketplace_assign_org_slug(uuid), app.marketplace_seller_slug_trigger()
  from public, anon, authenticated, service_role;
