-- Migration: write paths + timezone for organization/branch bilingual data.
--
-- CONTEXT. 20260913090001 added name_ar/name_en (organizations) and
-- name_ar/name_en/address_ar/address_en (branches) but deliberately added NO
-- write grant, because neither table has ever had a direct-client UPDATE
-- path — `organizations` never had one, and `branches`' one was explicitly
-- revoked by 20260804090001 ("branch lifecycle writes are prohibited until
-- their own auditable RPC lands"). That RPC is this migration. It does not
-- reopen the table grants at all; it adds two narrow, capability-gated,
-- SECURITY DEFINER functions in the same shape as every other write RPC in
-- this schema (see membership_set_capabilities, set_customer_ownership).
--
-- ALSO ADDS: `organizations.timezone` / `branches.timezone` (nullable IANA
-- identifiers) for the dashboard's period-boundary resolution — branch
-- timezone, then organization timezone, then a hardcoded Africa/Cairo
-- fallback (see frontend/src/lib/workspace/timezone.ts). Validated against
-- Postgres's own `pg_timezone_names` via a trigger, so the check applies to
-- every future write path, not only the RPCs added here.
--
-- Additive and backward-compatible throughout: existing rows keep working
-- unmodified (timezone stays null, falls back to Africa/Cairo; name_ar/
-- name_en/address_* stay null, falls back to the original column) — no
-- backfill of any kind.

alter table public.organizations add column if not exists timezone text;
alter table public.branches      add column if not exists timezone text;

comment on column public.organizations.timezone is
  'Optional IANA timezone identifier (e.g. Africa/Cairo). Null = fall back to the branch timezone, then to Africa/Cairo. Validated against pg_timezone_names by app.validate_iana_timezone().';
comment on column public.branches.timezone is
  'Optional IANA timezone identifier. Null = fall back to the organization timezone, then to Africa/Cairo. Validated the same way as organizations.timezone.';

-- ---------------------------------------------------------------------------
-- 1. Timezone validation — one trigger function, reused on both tables, so
--    the rule holds regardless of which write path reaches the column.
-- ---------------------------------------------------------------------------
create function app.validate_iana_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if NEW.timezone is not null and not exists (
    select 1 from pg_timezone_names where name = NEW.timezone
  ) then
    raise exception 'not a valid IANA timezone identifier: %', NEW.timezone using errcode = '22023';
  end if;
  return NEW;
end;
$$;

comment on function app.validate_iana_timezone() is
  'BEFORE INSERT/UPDATE guard: NEW.timezone must be null or a name pg_timezone_names recognizes. Reused on organizations and branches.';

create trigger validate_organizations_timezone
  before insert or update of timezone on public.organizations
  for each row execute function app.validate_iana_timezone();

create trigger validate_branches_timezone
  before insert or update of timezone on public.branches
  for each row execute function app.validate_iana_timezone();

-- ---------------------------------------------------------------------------
-- 2. organization_update_i18n — the org's own Arabic/English trading name +
--    timezone. org.manage only (the same capability organizations_update_
--    manager's now-inert RLS policy already required, and the same one
--    organization_create_owned grants the founder).
-- ---------------------------------------------------------------------------
create function public.organization_update_i18n(
  p_org_id   uuid,
  p_name_ar  text,
  p_name_en  text,
  p_timezone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name_ar  text := nullif(trim(p_name_ar), '');
  v_name_en  text := nullif(trim(p_name_en), '');
  v_timezone text := nullif(trim(p_timezone), '');
begin
  if p_org_id is null then
    raise exception 'organization id is required' using errcode = '22023';
  end if;
  if not app.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not app.has_capability(p_org_id, 'org.manage') then
    raise exception 'org.manage required' using errcode = '42501';
  end if;

  update public.organizations
     set name_ar = v_name_ar,
         name_en = v_name_en,
         timezone = v_timezone
   where id = p_org_id;

  if not found then
    raise exception 'organization not found' using errcode = '22023';
  end if;
end;
$$;

comment on function public.organization_update_i18n(uuid, text, text, text) is
  'Updates ONLY organizations.name_ar/name_en/timezone (original `name` is never touched). org.manage required for the target org — cross-org callers are rejected at app.is_org_member before the capability check is even reached. Empty/whitespace-only input normalizes to null (never an empty-string value). Timezone validated by app.validate_iana_timezone() on write.';

revoke execute on function public.organization_update_i18n(uuid, text, text, text) from public;
grant execute on function public.organization_update_i18n(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. branch_update_i18n — one branch's Arabic/English name + address +
--    timezone. branch.manage or org.manage, mirroring the exact predicate
--    the now-revoked branches_update_manager policy used to enforce, so this
--    RPC restores the SAME authorization shape through an auditable seam
--    instead of a raw table grant.
-- ---------------------------------------------------------------------------
create function public.branch_update_i18n(
  p_branch_id  uuid,
  p_name_ar    text,
  p_name_en    text,
  p_address_ar text,
  p_address_en text,
  p_timezone   text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id     uuid;
  v_name_ar    text := nullif(trim(p_name_ar), '');
  v_name_en    text := nullif(trim(p_name_en), '');
  v_address_ar text := nullif(trim(p_address_ar), '');
  v_address_en text := nullif(trim(p_address_en), '');
  v_timezone   text := nullif(trim(p_timezone), '');
begin
  if p_branch_id is null then
    raise exception 'branch id is required' using errcode = '22023';
  end if;

  select organization_id into v_org_id
    from public.branches
   where id = p_branch_id and deleted_at is null;

  if v_org_id is null then
    -- Deliberately the SAME message/code whether the branch does not exist or
    -- belongs to an org the caller cannot see — distinguishing them would let
    -- a caller probe for the existence of another organization's branch ids.
    raise exception 'branch not found' using errcode = '22023';
  end if;
  if not app.is_org_member(v_org_id) then
    raise exception 'branch not found' using errcode = '22023';
  end if;
  if not (app.has_capability(v_org_id, 'branch.manage') or app.has_capability(v_org_id, 'org.manage')) then
    raise exception 'branch.manage required' using errcode = '42501';
  end if;

  update public.branches
     set name_ar    = v_name_ar,
         name_en    = v_name_en,
         address_ar = v_address_ar,
         address_en = v_address_en,
         timezone   = v_timezone
   where id = p_branch_id;
end;
$$;

comment on function public.branch_update_i18n(uuid, text, text, text, text, text) is
  'Updates ONLY branches.name_ar/name_en/address_ar/address_en/timezone (original `name` is never touched). branch.manage or org.manage required, scoped to the branch''s own organization. A branch belonging to another organization, or that does not exist, produces the identical "branch not found" error so cross-org callers cannot distinguish the two. Empty/whitespace-only input normalizes to null. Timezone validated by app.validate_iana_timezone() on write.';

revoke execute on function public.branch_update_i18n(uuid, text, text, text, text, text) from public;
grant execute on function public.branch_update_i18n(uuid, text, text, text, text, text) to authenticated;
