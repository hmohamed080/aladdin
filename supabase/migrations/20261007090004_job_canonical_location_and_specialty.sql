-- ===========================================================================
-- Installer Jobs — canonical job LOCATION and the optional required SPECIALTY
--
-- 1. jobs.governorate_key / jobs.city_key — the EXISTING Egypt catalogue's keys, stored.
--    Until now a job's place was FREE TEXT the poster typed and every read re-resolved
--    it against the catalogue, row by row (the dominant cost of "Nearest" at scale).
--    The text columns stay as the poster's own words; the keys are the canonical form.
--
--      * deterministic backfill: a job gets keys only where its text resolves EXACTLY
--        (same normalisation the app uses). A legacy row that does not resolve keeps its
--        raw text and has NULL keys — nothing is guessed;
--      * NEW and EDITED jobs go through job_create / job_update below, which accept the
--        catalogue keys (the form's governorate -> city pickers) or, for older callers,
--        text that must resolve exactly. Arbitrary free text is refused (22023). "Other"
--        is the catalogue's own `other` city, not a free-text escape.
--
-- 2. jobs.required_specialty_id — OPTIONAL. The composite FK (trade_id, required_specialty_id)
--    onto trade_specialties(trade_id, id) makes "the specialty belongs to the job's trade" a
--    property of the data, not of the writer.
--
-- 3. Indexes for the keyset board (all PARTIAL on open jobs — a closed job is never paged):
--      ix_jobs_open_published   (published_at desc, id desc)                    newest / the rest tier
--      ix_jobs_open_amount      (offered_amount desc, published_at desc, id desc)  highest pay
--      ix_jobs_open_gov         (governorate_key, published_at desc, id desc)   governorate filter / Near me
--      ix_jobs_open_gov_city    (governorate_key, city_key, published_at desc, id desc)   city filter / Near me
--    (ix_jobs_open_trade (trade_id, published_at desc) already serves a trade filter / skill tiers.)
-- ===========================================================================

alter table public.jobs
  add column governorate_key       text,
  add column city_key              text,
  add column required_specialty_id uuid;

alter table public.jobs
  add constraint ck_jobs_governorate_key_shape check (governorate_key is null or (governorate_key ~ '^[a-z][a-z0-9-]*$' and char_length(governorate_key) <= 64)),
  add constraint ck_jobs_city_key_shape        check (city_key is null or (city_key ~ '^[a-z][a-z0-9-]*$' and char_length(city_key) <= 64)),
  add constraint ck_jobs_city_needs_governorate check (city_key is null or governorate_key is not null),
  add constraint fk_jobs_required_specialty
    foreign key (trade_id, required_specialty_id) references public.trade_specialties (trade_id, id) on delete restrict;

comment on column public.jobs.governorate_key is
  'Canonical governorate key from the existing Egypt catalogue (app.place_governorates). NULL for a legacy row whose free text did not resolve exactly — nothing is guessed. The raw text stays in jobs.governorate.';
comment on column public.jobs.city_key is
  'Canonical city key INSIDE governorate_key (app.place_cities); `other` is the catalogue''s own entry. NULL when unresolved or not chosen.';
comment on column public.jobs.required_specialty_id is
  'OPTIONAL detailed specialty the job requires. Must belong to the job''s own trade (composite FK). NULL = no specialty requirement. A presentation/ranking input only — never an eligibility rule (O5).';

-- A safety net for every writer that is NOT the RPCs below (seed files, psql, a future import): keys follow
-- the text whenever the text resolves EXACTLY, and are never guessed otherwise. The RPCs set both explicitly.
create function app.jobs_derive_location_keys()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (new.governorate is distinct from old.governorate or new.city is distinct from old.city)
     and new.governorate_key is not distinct from old.governorate_key
     and new.city_key is not distinct from old.city_key then
    -- the wording changed and nobody set the keys: derive them afresh rather than keep stale ones
    new.governorate_key := null;
    new.city_key := null;
  end if;
  if new.governorate_key is null and new.governorate is not null then
    new.governorate_key := app.resolve_governorate(new.governorate);
  end if;
  if new.governorate_key is not null and new.city_key is null and new.city is not null then
    new.city_key := app.resolve_city(new.governorate_key, new.city);
  end if;
  return new;
end;
$$;

revoke execute on function app.jobs_derive_location_keys() from public, anon, authenticated;

create trigger jobs_derive_location_keys
  before insert or update of governorate, city, governorate_key, city_key on public.jobs
  for each row execute function app.jobs_derive_location_keys();

-- Deterministic backfill. The updated_at trigger is paused so a data migration does not rewrite every
-- job's modification time.
alter table public.jobs disable trigger set_jobs_updated_at;
update public.jobs
   set governorate_key = app.resolve_governorate(governorate)
 where governorate is not null;
update public.jobs
   set city_key = app.resolve_city(governorate_key, city)
 where governorate_key is not null and city is not null;
alter table public.jobs enable trigger set_jobs_updated_at;

create index ix_jobs_open_published on public.jobs (published_at desc, id desc)                              where status = 'open';
create index ix_jobs_open_amount    on public.jobs (offered_amount desc, published_at desc, id desc)         where status = 'open';
create index ix_jobs_open_gov       on public.jobs (governorate_key, published_at desc, id desc)             where status = 'open';
create index ix_jobs_open_gov_city  on public.jobs (governorate_key, city_key, published_at desc, id desc)   where status = 'open';

-- ---------------------------------------------------------------------------
-- One place to turn what a caller sent into (text, text, key, key).
-- ---------------------------------------------------------------------------
create or replace function app.resolve_job_location(
  p_governorate     text,
  p_city            text,
  p_governorate_key text,
  p_city_key        text
)
returns table (governorate text, city text, governorate_key text, city_key text)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_gtext text := nullif(btrim(coalesce(p_governorate, '')), '');
  v_ctext text := nullif(btrim(coalesce(p_city, '')), '');
  v_gk    text := nullif(btrim(coalesce(p_governorate_key, '')), '');
  v_ck    text := nullif(btrim(coalesce(p_city_key, '')), '');
begin
  -- Keys win. Text, when also sent, must agree with them (it is only the poster's own wording).
  if v_gk is not null then
    if not exists (select 1 from app.place_governorates g where g.key = v_gk) then
      raise exception 'unknown governorate' using errcode = '22023';
    end if;
    if v_gtext is not null and app.resolve_governorate(v_gtext) is distinct from v_gk then
      raise exception 'governorate text does not match its key' using errcode = '22023';
    end if;
    if v_ck is not null then
      if not exists (select 1 from app.place_cities c where c.governorate_key = v_gk and c.key = v_ck) then
        raise exception 'unknown city' using errcode = '22023';
      end if;
      if v_ctext is not null and app.resolve_city(v_gk, v_ctext) is distinct from v_ck then
        raise exception 'city text does not match its key' using errcode = '22023';
      end if;
    end if;
    return query select
      coalesce(v_gtext, (select g.name from app.place_governorates g where g.key = v_gk and g.name ~ '^[A-Z]' order by g.name limit 1), v_gk),
      case when v_ck is null then null
           else coalesce(v_ctext, (select c.name from app.place_cities c where c.governorate_key = v_gk and c.key = v_ck and c.name ~ '^[A-Z]' order by c.name limit 1), v_ck) end,
      v_gk,
      v_ck;
    return;
  end if;

  if v_ck is not null then
    raise exception 'a city needs its governorate' using errcode = '22023';
  end if;

  -- Text only (an older caller): it must resolve EXACTLY. Free text that is not in the catalogue is refused.
  if v_gtext is null then
    if v_ctext is not null then
      raise exception 'a city needs its governorate' using errcode = '22023';
    end if;
    return query select null::text, null::text, null::text, null::text;
    return;
  end if;
  v_gk := app.resolve_governorate(v_gtext);
  if v_gk is null then
    raise exception 'unknown governorate' using errcode = '22023';
  end if;
  if v_ctext is not null then
    v_ck := app.resolve_city(v_gk, v_ctext);
    if v_ck is null then
      raise exception 'unknown city' using errcode = '22023';
    end if;
  end if;
  return query select v_gtext, v_ctext, v_gk, v_ck;
end;
$$;

revoke execute on function app.resolve_job_location(text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- job_create / job_update — the same RPCs, now location-canonical and specialty-aware.
-- The old signatures are dropped (a second overload would make every call ambiguous).
-- ---------------------------------------------------------------------------
drop function public.job_create(uuid, text, text, numeric, text, text, text, text, smallint, date, date, uuid);
drop function public.job_update(uuid, integer, text, text, numeric, text, text, text, text, smallint, date, date);

create function public.job_create(
  p_org_id                 uuid,
  p_title                  text,
  p_trade_key              text,
  p_offered_amount         numeric,
  p_description            text default null,
  p_governorate            text default null,
  p_city                   text default null,
  p_site_address           text default null,
  p_expected_duration_days smallint default null,
  p_starts_on              date default null,
  p_ends_by                date default null,
  p_branch_id              uuid default null,
  p_governorate_key        text default null,
  p_city_key               text default null,
  p_required_specialty_id  uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := app.require_verified_caller();
  v_trade_id uuid;
  v_id       uuid;
  v_loc      record;
begin
  if not app.is_org_member(p_org_id) then
    raise exception 'not a member of the posting organization' using errcode = '42501';
  end if;
  if not app.can_post_job(p_org_id) then
    raise exception 'job.post required' using errcode = '42501';
  end if;
  -- NOT `status = 'active'` (see 20260902090001): verification gates discovery, never drafting.
  if not exists (
    select 1 from public.organizations o
    where o.id = p_org_id
      and o.deleted_at is null
      and o.status not in ('suspended'::public.org_status, 'archived'::public.org_status)
  ) then
    raise exception 'the organization cannot post work' using errcode = '22023';
  end if;

  select t.id into v_trade_id
  from public.trades t where t.key = btrim(coalesce(p_trade_key, '')) and t.is_active;
  if v_trade_id is null then
    raise exception 'unknown or retired trade' using errcode = '22023';
  end if;

  -- A required specialty must be an ACTIVE specialty of THIS trade.
  if p_required_specialty_id is not null and not exists (
    select 1 from public.trade_specialties s
    where s.id = p_required_specialty_id and s.trade_id = v_trade_id and s.is_active
  ) then
    raise exception 'unknown specialty for this trade' using errcode = '22023';
  end if;

  select * into v_loc from app.resolve_job_location(p_governorate, p_city, p_governorate_key, p_city_key);

  insert into public.jobs (
    poster_org_id, poster_branch_id, title, description, trade_id,
    offered_amount, governorate, city, governorate_key, city_key, required_specialty_id, site_address,
    expected_duration_days, starts_on, ends_by, created_by)
  values (
    p_org_id, p_branch_id, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), v_trade_id,
    p_offered_amount, v_loc.governorate, v_loc.city, v_loc.governorate_key, v_loc.city_key, p_required_specialty_id,
    nullif(btrim(coalesce(p_site_address, '')), ''),
    p_expected_duration_days, p_starts_on, p_ends_by, v_uid)
  returning id into v_id;

  perform app.record_audit_event('job.created', 'job', v_id, p_org_id,
    jsonb_build_object('trade_key', p_trade_key, 'status', 'draft'));
  return v_id;
end;
$$;

create function public.job_update(
  p_job_id                 uuid,
  p_expected_version       integer,
  p_title                  text,
  p_trade_key              text,
  p_offered_amount         numeric,
  p_description            text default null,
  p_governorate            text default null,
  p_city                   text default null,
  p_site_address           text default null,
  p_expected_duration_days smallint default null,
  p_starts_on              date default null,
  p_ends_by                date default null,
  p_governorate_key        text default null,
  p_city_key               text default null,
  p_required_specialty_id  uuid default null
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_j            public.jobs;
  v_trade_id     uuid;
  v_trade_active boolean;
  v_has_apps     boolean;
  v_gtext        text;
  v_ctext        text;
  v_gk           text;
  v_ck           text;
begin
  perform app.require_verified_caller();
  select * into v_j from public.jobs where id = p_job_id for update;
  if not found then raise exception 'job not found' using errcode = '22023'; end if;
  if not app.is_org_member(v_j.poster_org_id) then
    raise exception 'not a member of the posting organization' using errcode = '42501';
  end if;
  if not app.can_post_job(v_j.poster_org_id) then
    raise exception 'job.post required' using errcode = '42501';
  end if;
  if v_j.status not in ('draft', 'open') then
    raise exception 'a % job cannot be edited', v_j.status using errcode = '22023';
  end if;
  if v_j.version <> p_expected_version then
    raise exception 'job was modified concurrently' using errcode = '40001';
  end if;

  -- Resolved WITHOUT the is_active filter, then judged: a job may RETAIN a trade retired since it was posted.
  select t.id, t.is_active into v_trade_id, v_trade_active
  from public.trades t where t.key = btrim(coalesce(p_trade_key, ''));
  if v_trade_id is null
     or (not v_trade_active and v_trade_id is distinct from v_j.trade_id) then
    raise exception 'unknown or retired trade' using errcode = '22023';
  end if;

  -- The specialty must belong to THIS trade, and be active unless the job already carries it.
  if p_required_specialty_id is not null and not exists (
    select 1 from public.trade_specialties s
    where s.id = p_required_specialty_id and s.trade_id = v_trade_id
      and (s.is_active or p_required_specialty_id is not distinct from v_j.required_specialty_id)
  ) then
    raise exception 'unknown specialty for this trade' using errcode = '22023';
  end if;

  v_has_apps := exists (select 1 from public.job_applications a where a.job_id = p_job_id);
  if v_has_apps and (p_offered_amount <> v_j.offered_amount or v_trade_id <> v_j.trade_id) then
    raise exception
      'the offer and trade cannot change once someone has applied; close this job and post a new one'
      using errcode = '22023';
  end if;

  -- Sending NO location at all leaves the job's location AS IT IS. That is what protects a legacy job whose
  -- free text never resolved: editing its title must not erase the only location it has, and the form has no
  -- way to "clear" a place (a new job always carries one).
  if p_governorate is null and p_city is null and p_governorate_key is null and p_city_key is null then
    v_gtext := v_j.governorate; v_ctext := v_j.city; v_gk := v_j.governorate_key; v_ck := v_j.city_key;
  else
    select l.governorate, l.city, l.governorate_key, l.city_key into v_gtext, v_ctext, v_gk, v_ck
      from app.resolve_job_location(p_governorate, p_city, p_governorate_key, p_city_key) l;
  end if;

  update public.jobs set
    title                  = btrim(p_title),
    description            = nullif(btrim(coalesce(p_description, '')), ''),
    trade_id               = v_trade_id,
    offered_amount         = p_offered_amount,
    governorate            = v_gtext,
    city                   = v_ctext,
    governorate_key        = v_gk,
    city_key               = v_ck,
    required_specialty_id  = p_required_specialty_id,
    site_address           = nullif(btrim(coalesce(p_site_address, '')), ''),
    expected_duration_days = p_expected_duration_days,
    starts_on              = p_starts_on,
    ends_by                = p_ends_by,
    version                = version + 1
  where id = p_job_id;

  perform app.record_audit_event('job.updated', 'job', p_job_id, v_j.poster_org_id,
    jsonb_build_object('status', v_j.status));
  return v_j.version + 1;
end;
$$;

comment on function public.job_create(uuid, text, text, numeric, text, text, text, text, smallint, date, date, uuid, text, text, uuid) is
  'Creates a DRAFT job. Location is canonical: pass the catalogue keys (governorate_key / city_key), or text that resolves EXACTLY against the catalogue — arbitrary free text is refused (22023). An optional required specialty must be an active specialty of the job''s trade.';
comment on function public.job_update(uuid, integer, text, text, numeric, text, text, text, text, smallint, date, date, text, text, uuid) is
  'Edits a draft or open job under job.post and optimistic concurrency. Same trade rules as before (a job may retain a retired trade; the offer and trade freeze once someone applies). Location is canonical (keys, or text that resolves exactly); the optional required specialty must belong to the job''s trade.';

revoke execute on function
  public.job_create(uuid, text, text, numeric, text, text, text, text, smallint, date, date, uuid, text, text, uuid),
  public.job_update(uuid, integer, text, text, numeric, text, text, text, text, smallint, date, date, text, text, uuid)
  from public, anon;
grant execute on function
  public.job_create(uuid, text, text, numeric, text, text, text, text, smallint, date, date, uuid, text, text, uuid),
  public.job_update(uuid, integer, text, text, numeric, text, text, text, text, smallint, date, date, text, text, uuid)
  to authenticated, service_role;
