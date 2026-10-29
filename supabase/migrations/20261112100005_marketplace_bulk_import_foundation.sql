-- ===========================================================================
-- Marketplace — Migration 05: bulk import foundation
-- ===========================================================================
-- WHAT THIS IS. The database side of importing 15,000+ products (and many more
-- images) from Excel/CSV: organisation-scoped import jobs, row staging, image
-- asset staging, per-row validation findings, an append-only job history, and
-- the trusted functions a future Import Worker calls to validate and apply the
-- staged rows in bounded, resumable chunks.
--
-- WHAT THIS IS NOT. There is no file parser, no worker process and no image
-- upload here (all deliberately outside the database), no checkout and no
-- publication. Imported products are written to the CANONICAL marketplace tables
-- (marketplace_products / _variants / attribute values / _images) and always as
-- draft; images always as `pending`. Nothing here can publish: publication stays
-- behind the Migration 04 blockers (incl. media_verification_ready = false).
--
-- IDENTIFICATION. A product is identified by (seller organisation, external_ref);
-- a variant by (seller organisation, sku). Both already carry unique indexes in
-- the canonical tables, which is what makes re-running an import an UPDATE of the
-- same records instead of a duplicate.
--
-- TRUSTED WRITE MODEL. Every state-changing function is SECURITY DEFINER with an
-- empty search_path and is executable by service_role only (the future worker,
-- running server-side). The only authenticated entry points are create / cancel /
-- report, each re-checking membership + catalogue authority + an enabled seller.
-- The staging tables have no client write grant and a guard trigger that refuses
-- any write outside those functions, even from the table owner.
--
-- TRANSACTION BOUNDARIES. Nothing runs "the whole import" in one transaction.
-- stage_rows / stage_assets take at most 1000 items per call; validate_next and
-- apply_next process one chunk (job.chunk_size, <= 2000) per call; each row is
-- applied in its own sub-transaction so one bad row cannot poison its chunk.
-- Progress is the row status itself, so a crashed worker simply resumes.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table public.marketplace_import_jobs (
  id                     uuid        primary key default gen_random_uuid(),
  organization_id        uuid        not null references public.organizations (id) on delete restrict,
  created_by             uuid        not null,
  idempotency_key        text        not null,
  source_format          text        not null,
  source_file_name       text        not null,
  source_checksum_sha256 text        not null,
  mode                   text        not null,
  status                 text        not null default 'created',
  chunk_size             integer     not null default 500,
  total_rows             integer     not null default 0,
  total_assets           integer     not null default 0,
  valid_rows             integer     not null default 0,
  invalid_rows           integer     not null default 0,
  applied_rows           integer     not null default 0,
  failed_rows            integer     not null default 0,
  errors_recorded        integer     not null default 0,
  errors_dropped         integer     not null default 0,
  locked_by              text,
  lease_expires_at       timestamptz,
  started_at             timestamptz,
  finished_at            timestamptz,
  cancelled_at           timestamptz,
  failure_reason         text,
  metadata               jsonb       not null default '{}'::jsonb,
  status_changed_at      timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint uq_marketplace_import_jobs_id_org unique (id, organization_id),
  constraint uq_marketplace_import_jobs_idem   unique (organization_id, idempotency_key),
  constraint ck_marketplace_import_jobs_idem   check (char_length(idempotency_key) between 8 and 128),
  constraint ck_marketplace_import_jobs_format check (source_format in ('csv', 'xlsx')),
  constraint ck_marketplace_import_jobs_file   check (char_length(btrim(source_file_name)) between 1 and 255),
  constraint ck_marketplace_import_jobs_sum    check (source_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  constraint ck_marketplace_import_jobs_mode   check (mode in ('dry_run', 'apply')),
  constraint ck_marketplace_import_jobs_status check (status in
    ('created', 'staging', 'staged', 'validating', 'validated', 'applying',
     'completed', 'completed_with_errors', 'failed', 'cancelled')),
  constraint ck_marketplace_import_jobs_chunk  check (chunk_size between 1 and 2000),
  constraint ck_marketplace_import_jobs_counts check (
    total_rows between 0 and 50000 and total_assets between 0 and 200000
    and valid_rows >= 0 and invalid_rows >= 0 and applied_rows >= 0 and failed_rows >= 0
    and errors_recorded >= 0 and errors_dropped >= 0),
  constraint ck_marketplace_import_jobs_meta   check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 4096),
  constraint ck_marketplace_import_jobs_reason check (failure_reason is null or char_length(failure_reason) <= 500)
);
comment on table public.marketplace_import_jobs is
  'One bulk import of marketplace products for ONE organization. Idempotent creation per (organization_id, idempotency_key). Changed only by the trusted import functions; every status change appends a marketplace_import_job_events row. Jobs are never deleted (audit); only their staging rows may be purged once terminal.';
create trigger set_marketplace_import_jobs_updated_at
  before update on public.marketplace_import_jobs
  for each row execute function app.set_updated_at();
create index ix_marketplace_import_jobs_org on public.marketplace_import_jobs (organization_id, created_at desc);
create index ix_marketplace_import_jobs_active on public.marketplace_import_jobs (organization_id)
  where status not in ('completed', 'completed_with_errors', 'failed', 'cancelled');

create table public.marketplace_import_job_events (
  id          uuid        primary key default gen_random_uuid(),
  sequence    bigint      generated always as identity,
  job_id      uuid        not null references public.marketplace_import_jobs (id) on delete restrict,
  from_status text,
  to_status   text        not null,
  actor       text,
  note        text,
  created_at  timestamptz not null default now(),
  constraint ck_marketplace_import_events_note check (note is null or char_length(note) <= 500)
);
comment on table public.marketplace_import_job_events is
  'Append-only history of an import job''s status changes (who / which worker, when, why).';
create index ix_marketplace_import_events_job on public.marketplace_import_job_events (job_id, sequence);

create table public.marketplace_import_rows (
  id               uuid        primary key default gen_random_uuid(),
  job_id           uuid        not null,
  organization_id  uuid        not null,
  row_number       integer     not null,
  external_ref     text,
  sku              text,
  product_type_key text,
  name_ar          text,
  name_en          text,
  description_ar   text,
  description_en   text,
  brand            text,
  selling_unit     text,
  price_egp        numeric,
  attributes       jsonb       not null default '{}'::jsonb,
  raw              jsonb       not null,
  row_hash         text        not null,
  status           text        not null default 'pending',
  action           text,
  product_id       uuid,
  variant_id       uuid,
  attempt_count    integer     not null default 0,
  processed_at     timestamptz,
  created_at       timestamptz not null default now(),
  constraint uq_marketplace_import_rows_job_row unique (job_id, row_number),
  constraint uq_marketplace_import_rows_id_job  unique (id, job_id),
  constraint fk_marketplace_import_rows_job foreign key (job_id, organization_id)
    references public.marketplace_import_jobs (id, organization_id) on delete cascade,
  constraint fk_marketplace_import_rows_product foreign key (product_id, organization_id)
    references public.marketplace_products (id, seller_organization_id) on delete set null (product_id),
  constraint fk_marketplace_import_rows_variant foreign key (variant_id, organization_id)
    references public.marketplace_product_variants (id, seller_organization_id) on delete set null (variant_id),
  constraint ck_marketplace_import_rows_num    check (row_number >= 1),
  constraint ck_marketplace_import_rows_status check (status in ('pending', 'valid', 'invalid', 'applied', 'failed')),
  constraint ck_marketplace_import_rows_action check (action is null or action in ('create', 'update', 'unchanged')),
  constraint ck_marketplace_import_rows_attrs  check (jsonb_typeof(attributes) = 'object' and octet_length(attributes::text) <= 8192),
  constraint ck_marketplace_import_rows_raw    check (octet_length(raw::text) <= 16384),
  constraint ck_marketplace_import_rows_hash   check (row_hash ~ '^[0-9a-f]{64}$'),
  constraint ck_marketplace_import_rows_attempt check (attempt_count between 0 and 10)
);
comment on table public.marketplace_import_rows is
  'Staged spreadsheet rows: one row = one VARIANT (SKU) of a product (external_ref). raw keeps the original cells; the typed columns are the normalised view the validator and applier use. Cascade-deleted only with its job staging purge.';
create index ix_marketplace_import_rows_work on public.marketplace_import_rows (job_id, status, row_number);
create index ix_marketplace_import_rows_sku  on public.marketplace_import_rows (job_id, sku);
create index ix_marketplace_import_rows_ref  on public.marketplace_import_rows (job_id, external_ref, row_number);
-- case-insensitive lookups used by deterministic asset matching (first row wins)
create index ix_marketplace_import_rows_lsku on public.marketplace_import_rows (job_id, lower(sku), row_number) where sku is not null;
create index ix_marketplace_import_rows_lref on public.marketplace_import_rows (job_id, lower(external_ref), row_number) where external_ref is not null;

create table public.marketplace_import_assets (
  id               uuid        primary key default gen_random_uuid(),
  job_id           uuid        not null,
  organization_id  uuid        not null,
  file_name        text        not null,
  sku_key          text,
  sequence         integer,
  storage_provider text        not null default 'supabase_storage',
  storage_bucket   text        not null,
  object_key       text        not null,
  byte_size        bigint,
  checksum_sha256  text,
  mime_type        text,
  status           text        not null default 'pending',
  matched_row_id   uuid,
  matched_by       text,
  image_id         uuid        references public.marketplace_product_images (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint uq_marketplace_import_assets_file   unique (job_id, file_name),
  constraint uq_marketplace_import_assets_object unique (job_id, storage_provider, storage_bucket, object_key),
  constraint uq_marketplace_import_assets_id_job unique (id, job_id),
  constraint fk_marketplace_import_assets_job foreign key (job_id, organization_id)
    references public.marketplace_import_jobs (id, organization_id) on delete cascade,
  constraint fk_marketplace_import_assets_row foreign key (matched_row_id, job_id)
    references public.marketplace_import_rows (id, job_id) on delete set null (matched_row_id),
  constraint ck_marketplace_import_assets_file   check (char_length(file_name) between 1 and 255),
  constraint ck_marketplace_import_assets_seq    check (sequence is null or sequence between 1 and 999),
  constraint ck_marketplace_import_assets_prov   check (storage_provider in ('supabase_storage', 'cloudflare_r2')),
  constraint ck_marketplace_import_assets_bucket check (char_length(storage_bucket) between 1 and 63),
  constraint ck_marketplace_import_assets_key    check (char_length(object_key) between 1 and 512),
  constraint ck_marketplace_import_assets_size   check (byte_size is null or byte_size > 0),
  constraint ck_marketplace_import_assets_sum    check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  constraint ck_marketplace_import_assets_mime   check (mime_type is null or mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint ck_marketplace_import_assets_status check (status in ('pending', 'matched', 'unmatched', 'applied', 'rejected')),
  constraint ck_marketplace_import_assets_by     check (matched_by is null or matched_by in ('sku', 'external_ref'))
);
comment on table public.marketplace_import_assets is
  'Image files registered for a job as stable storage object REFERENCES (never bytes, never URLs). File names are parsed deterministically (<SKU>_<NN>.<ext>) and matched to a staged row by SKU, else by external_ref. Applied assets become marketplace_product_images with status pending.';
create index ix_marketplace_import_assets_work on public.marketplace_import_assets (job_id, status);
create index ix_marketplace_import_assets_row  on public.marketplace_import_assets (matched_row_id) where matched_row_id is not null;

create table public.marketplace_import_errors (
  id              uuid        primary key default gen_random_uuid(),
  sequence        bigint      generated always as identity,
  job_id          uuid        not null,
  organization_id uuid        not null,
  row_id          uuid,
  asset_id        uuid,
  row_number      integer,
  severity        text        not null,
  code            text        not null,
  field           text,
  message         text        not null,
  created_at      timestamptz not null default now(),
  constraint fk_marketplace_import_errors_job foreign key (job_id, organization_id)
    references public.marketplace_import_jobs (id, organization_id) on delete cascade,
  constraint fk_marketplace_import_errors_row foreign key (row_id, job_id)
    references public.marketplace_import_rows (id, job_id) on delete cascade,
  constraint fk_marketplace_import_errors_asset foreign key (asset_id, job_id)
    references public.marketplace_import_assets (id, job_id) on delete cascade,
  constraint ck_marketplace_import_errors_sev  check (severity in ('error', 'warning')),
  constraint ck_marketplace_import_errors_code check (char_length(code) between 1 and 64),
  constraint ck_marketplace_import_errors_msg  check (char_length(message) between 1 and 500)
);
comment on table public.marketplace_import_errors is
  'Row- and asset-level findings (error / warning), bounded per row (20) and per job (10000; the overflow is counted in the job, not stored).';
create index ix_marketplace_import_errors_job on public.marketplace_import_errors (job_id, row_number, sequence);
create index ix_marketplace_import_errors_row on public.marketplace_import_errors (row_id) where row_id is not null;
create index ix_marketplace_import_errors_asset on public.marketplace_import_errors (asset_id) where asset_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Guards: nothing writes these tables except the trusted functions
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_import_write_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.marketplace_import_write', true) is distinct from 'on' then
    raise exception '% changes only through the trusted import functions', tg_table_name using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create trigger marketplace_import_rows_guard   before insert or update or delete on public.marketplace_import_rows
  for each row execute function app.marketplace_import_write_guard();
create trigger marketplace_import_assets_guard before insert or update or delete on public.marketplace_import_assets
  for each row execute function app.marketplace_import_write_guard();
create trigger marketplace_import_errors_guard before insert or update or delete on public.marketplace_import_errors
  for each row execute function app.marketplace_import_write_guard();

-- Jobs: write flag + legal state machine + immutable identity.
create or replace function app.marketplace_import_job_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if current_setting('app.marketplace_import_write', true) is distinct from 'on' then
    raise exception 'import jobs change only through the trusted import functions' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'import jobs are never deleted (audit); purge their staging rows instead' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id or new.created_by is distinct from old.created_by
       or new.idempotency_key is distinct from old.idempotency_key or new.mode is distinct from old.mode
       or new.source_format is distinct from old.source_format or new.source_checksum_sha256 is distinct from old.source_checksum_sha256
       or new.source_file_name is distinct from old.source_file_name or new.created_at is distinct from old.created_at then
      raise exception 'an import job''s identity and source are immutable' using errcode = '23514';
    end if;
    if new.status is distinct from old.status then
      v_ok := (old.status, new.status) in (
        ('created', 'staging'), ('created', 'staged'), ('created', 'cancelled'),
        ('staging', 'staged'), ('staging', 'cancelled'),
        ('staged', 'validating'), ('staged', 'cancelled'),
        ('validating', 'validated'), ('validating', 'failed'), ('validating', 'cancelled'),
        ('validated', 'applying'), ('validated', 'completed'), ('validated', 'completed_with_errors'),
        ('validated', 'cancelled'),
        ('applying', 'completed'), ('applying', 'completed_with_errors'), ('applying', 'failed'),
        ('applying', 'cancelled'),
        ('completed_with_errors', 'applying'));
      if not v_ok then
        raise exception 'illegal import job transition % -> %', old.status, new.status using errcode = '23514';
      end if;
      new.status_changed_at := now();
    end if;
    return new;
  end if;
  return new;
end;
$$;
create trigger marketplace_import_job_guard
  before insert or update or delete on public.marketplace_import_jobs
  for each row execute function app.marketplace_import_job_guard();

create trigger marketplace_import_events_append_only
  before update or delete on public.marketplace_import_job_events
  for each row execute function app.marketplace_append_only();

-- ---------------------------------------------------------------------------
-- 3. Internal helpers
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_import_flag(p_on boolean)
returns void
language sql
set search_path = ''
as $$
  select set_config('app.marketplace_import_write', case when p_on then 'on' else 'off' end, true);
$$;

-- One place for every status change: update + history + timestamps.
create or replace function app.marketplace_import_set_status(
  p_job uuid, p_to text, p_actor text default null, p_note text default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_from text;
begin
  select status into v_from from public.marketplace_import_jobs where id = p_job;
  if v_from is null then
    raise exception 'unknown import job' using errcode = '23503';
  end if;
  if v_from = p_to then
    return;
  end if;
  perform app.marketplace_import_flag(true);
  update public.marketplace_import_jobs j set
    status = p_to,
    started_at  = case when p_to in ('staging', 'validating', 'applying') and j.started_at is null then now() else j.started_at end,
    finished_at = case when p_to in ('completed', 'completed_with_errors', 'failed', 'cancelled') then now()
                       when p_to = 'applying' then null else j.finished_at end,
    cancelled_at = case when p_to = 'cancelled' then now() else j.cancelled_at end,
    failure_reason = case when p_to = 'failed' then left(p_note, 500) else j.failure_reason end,
    locked_by = case when p_to in ('completed', 'completed_with_errors', 'failed', 'cancelled') then null else j.locked_by end,
    lease_expires_at = case when p_to in ('completed', 'completed_with_errors', 'failed', 'cancelled') then null else j.lease_expires_at end
  where j.id = p_job;
  insert into public.marketplace_import_job_events (job_id, from_status, to_status, actor, note)
  values (p_job, v_from, p_to, p_actor, left(p_note, 500));
  perform app.marketplace_import_flag(false);
end;
$$;

-- Bounded error recording: the job keeps counting what it had to drop.
create or replace function app.marketplace_import_record_finding(
  p_job uuid, p_org uuid, p_row_id uuid, p_asset_id uuid, p_row_number integer,
  p_severity text, p_code text, p_field text, p_message text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_recorded integer;
  v_prev     text := coalesce(current_setting('app.marketplace_import_write', true), 'off');
begin
  select errors_recorded into v_recorded from public.marketplace_import_jobs where id = p_job;
  perform app.marketplace_import_flag(true);
  if v_recorded >= 10000 then
    update public.marketplace_import_jobs set errors_dropped = errors_dropped + 1 where id = p_job;
  else
    insert into public.marketplace_import_errors
      (job_id, organization_id, row_id, asset_id, row_number, severity, code, field, message)
    values (p_job, p_org, p_row_id, p_asset_id, p_row_number, p_severity, left(p_code, 64), left(p_field, 64),
            left(coalesce(nullif(p_message, ''), p_code), 500));
    update public.marketplace_import_jobs set errors_recorded = errors_recorded + 1 where id = p_job;
  end if;
  perform set_config('app.marketplace_import_write', v_prev, true);   -- restore the caller's state
end;
$$;

-- Deterministic image file-name parsing:  <SKU>_<NN>.<jpg|jpeg|png|webp>
-- The sequence is the LAST _<1-3 digits> before the extension; without one the
-- image is sequence 1. SKU may itself contain underscores (A_B_02.jpg -> A_B, 2).
create or replace function app.marketplace_import_parse_asset_name(p_file_name text)
returns table (sku_key text, seq integer)
language sql
immutable
set search_path = ''
as $$
  select m[1], coalesce(m[2]::integer, 1)
  from (select regexp_match(btrim(p_file_name), '^(.+?)(?:_([0-9]{1,3}))?\.(jpg|jpeg|png|webp)$', 'i') as m) q
  where m is not null and (m[2] is null or m[2]::integer between 1 and 999);
$$;

create or replace function app.marketplace_import_slug(p_name text, p_org uuid, p_ref text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when char_length(b) >= 2 then b else 'product' end || '-' || substr(md5(p_org::text || '|' || p_ref), 1, 10)
  from (select left(btrim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'), '-'), 90) as b) q;
$$;

-- Findings for ONE staged row (read-only, deterministic, also used by tests).
create or replace function app.marketplace_import_row_findings(p_row_id uuid)
returns table (severity text, code text, field text, message text)
language plpgsql
stable
set search_path = ''
as $$
declare
  r         public.marketplace_import_rows;
  v_type_id uuid;
  v_master  boolean;
  v_other   text;
  v_ptype   uuid;
  a         record;
  v_key     text;
  v_val     jsonb;
  v_text    text;
  v_num     numeric;
  v_ok      boolean;
  v_opt     text;
begin
  select * into r from public.marketplace_import_rows where id = p_row_id;
  if not found then
    return;
  end if;

  -- identifiers
  if r.sku is null then
    return query select 'error', 'sku_required', 'sku', 'SKU is required';
  elsif char_length(r.sku) > 64 or r.sku !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$' then
    return query select 'error', 'sku_invalid', 'sku', 'SKU must be 1-64 characters: letters, digits, . _ / -';
  end if;
  if r.external_ref is null then
    return query select 'error', 'external_ref_required', 'external_ref', 'Product reference (external_ref) is required';
  elsif char_length(r.external_ref) > 80 then
    return query select 'error', 'external_ref_invalid', 'external_ref', 'Product reference is longer than 80 characters';
  end if;

  -- product data
  if r.name_ar is null or char_length(r.name_ar) > 200 then
    return query select 'error', 'name_ar_invalid', 'name_ar', 'Arabic name is required (max 200 characters)';
  end if;
  if r.name_en is null or char_length(r.name_en) > 200 then
    return query select 'error', 'name_en_invalid', 'name_en', 'English name is required (max 200 characters)';
  end if;
  if char_length(coalesce(r.description_ar, '')) > 5000 or char_length(coalesce(r.description_en, '')) > 5000 then
    return query select 'error', 'description_too_long', 'description', 'Descriptions are limited to 5000 characters';
  end if;
  if char_length(coalesce(r.brand, '')) > 80 then
    return query select 'error', 'brand_too_long', 'brand', 'Brand is limited to 80 characters';
  end if;

  -- product type
  if r.product_type_key is null then
    return query select 'error', 'product_type_required', 'product_type', 'Product type is required';
  else
    select t.id into v_type_id
    from public.marketplace_product_types t join public.marketplace_categories c on c.id = t.category_id
    where t.key = r.product_type_key and t.is_active and c.is_active;
    if v_type_id is null then
      return query select 'error', 'product_type_unknown', 'product_type', 'Unknown or inactive product type';
    end if;
  end if;

  -- variant data
  if r.selling_unit is null then
    return query select 'error', 'selling_unit_required', 'selling_unit', 'Selling unit is required';
  elsif r.selling_unit not in ('piece', 'roll', 'board', 'bar', 'linear_meter', 'square_meter', 'pack') then
    return query select 'error', 'selling_unit_invalid', 'selling_unit', 'Unknown selling unit';
  end if;
  if r.price_egp is null then
    if nullif(btrim(coalesce(r.raw ->> 'price', '')), '') is null then
      return query select 'error', 'price_required', 'price', 'Price (EGP, excluding VAT) is required';
    else
      return query select 'error', 'price_invalid', 'price', 'Price is not a valid number';
    end if;
  elsif r.price_egp <= 0 or r.price_egp > 9999999999.99 then
    return query select 'error', 'price_out_of_range', 'price', 'Price must be greater than 0';
  elsif scale(r.price_egp) > 2 then
    return query select 'error', 'price_precision', 'price', 'Price has more than 2 decimal places';
  end if;

  -- duplicates inside the file
  if r.sku is not null and exists (
       select 1 from public.marketplace_import_rows x
       where x.job_id = r.job_id and x.sku = r.sku and x.row_number < r.row_number) then
    return query select 'error', 'duplicate_sku_in_file', 'sku', 'This SKU already appears on an earlier row of the file';
  end if;

  -- conflicts with the seller's existing catalogue
  if r.sku is not null and r.external_ref is not null then
    select p.external_ref into v_other
    from public.marketplace_product_variants v join public.marketplace_products p on p.id = v.product_id
    where v.seller_organization_id = r.organization_id and v.sku = r.sku;
    if found and v_other is distinct from r.external_ref then
      return query select 'error', 'sku_belongs_to_other_product', 'sku',
        'This SKU already belongs to a different product of your catalogue';
    end if;
  end if;
  if r.external_ref is not null and v_type_id is not null then
    select p.product_type_id into v_ptype from public.marketplace_products p
    where p.seller_organization_id = r.organization_id and p.external_ref = r.external_ref;
    if found and v_ptype is distinct from v_type_id then
      return query select 'error', 'product_type_change_not_allowed', 'product_type',
        'An existing product''s type cannot be changed by import';
    end if;
  end if;

  if r.sku is not null and r.selling_unit is not null and exists (
       select 1 from public.marketplace_product_variants v
       where v.seller_organization_id = r.organization_id and v.sku = r.sku and v.selling_unit <> r.selling_unit) then
    return query select 'error', 'selling_unit_change_not_allowed', 'selling_unit',
      'The selling unit of an existing variant cannot be changed by import';
  end if;

  -- consistency between the rows of one product
  v_master := r.external_ref is null or not exists (
    select 1 from public.marketplace_import_rows x
    where x.job_id = r.job_id and x.external_ref = r.external_ref and x.row_number < r.row_number);
  if not v_master then
    if exists (select 1 from public.marketplace_import_rows x
               where x.job_id = r.job_id and x.external_ref = r.external_ref and x.row_number < r.row_number
                 and x.product_type_key is distinct from r.product_type_key) then
      return query select 'error', 'product_type_conflict', 'product_type',
        'Rows of the same product reference have different product types';
    end if;
    if exists (select 1 from public.marketplace_import_rows x
               where x.job_id = r.job_id and x.external_ref = r.external_ref
                 and x.row_number = (select min(y.row_number) from public.marketplace_import_rows y
                                     where y.job_id = r.job_id and y.external_ref = r.external_ref)
                 and (x.name_en is distinct from r.name_en or x.name_ar is distinct from r.name_ar)) then
      return query select 'warning', 'product_field_conflict', 'name',
        'Product name differs from the first row of this product; the first row wins';
    end if;
  end if;

  -- attributes
  if v_type_id is not null then
    for v_key, v_val in select * from jsonb_each(r.attributes) loop
      select d.id as def_id, d.data_type, ta.level into a
      from public.marketplace_attribute_definitions d
      join public.marketplace_product_type_attributes ta on ta.attribute_id = d.id
        and ta.product_type_id = v_type_id and ta.is_active
      where d.key = v_key and d.is_active;
      if not found then
        return query select 'error', 'attribute_unknown', v_key, 'Not an active field of this product type';
        continue;
      end if;
      v_ok := false;
      if a.data_type = 'option' then
        v_ok := jsonb_typeof(v_val) = 'string' and exists (
          select 1 from public.marketplace_attribute_options o
          where o.attribute_id = a.def_id and o.key = (v_val #>> '{}') and o.is_active);
      elsif a.data_type = 'multi_option' then
        v_ok := jsonb_typeof(v_val) = 'array' and jsonb_array_length(v_val) between 1 and 20 and not exists (
          select 1 from jsonb_array_elements(v_val) e
          where jsonb_typeof(e) <> 'string' or not exists (
            select 1 from public.marketplace_attribute_options o
            where o.attribute_id = a.def_id and o.key = (e #>> '{}') and o.is_active));
      elsif a.data_type in ('number', 'measurement') then
        v_ok := jsonb_typeof(v_val) = 'number' or (jsonb_typeof(v_val) = 'string' and (v_val #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$');
        if v_ok then
          v_num := (v_val #>> '{}')::numeric;
          v_ok := a.data_type = 'number' or v_num > 0;
        end if;
      elsif a.data_type = 'boolean' then
        v_ok := jsonb_typeof(v_val) = 'boolean';
      elsif a.data_type = 'text' then
        v_text := v_val #>> '{}';
        v_ok := jsonb_typeof(v_val) = 'string' and char_length(btrim(v_text)) between 1 and 500;
      end if;
      if not v_ok then
        return query select 'error', 'attribute_value_invalid', v_key, 'The value is not valid for this field';
      end if;
    end loop;

    -- required fields are a PUBLICATION prerequisite, not an import prerequisite
    for a in
      select d.key, ta.level
      from public.marketplace_product_type_attributes ta
      join public.marketplace_attribute_definitions d on d.id = ta.attribute_id
      where ta.product_type_id = v_type_id and ta.is_required and ta.is_active and d.is_active
        and not (r.attributes ? d.key)
        and (ta.level = 'variant' or v_master)
      order by ta.sort_order
    loop
      return query select 'warning', 'required_attribute_missing', a.key,
        'Required before this product can be published';
    end loop;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Job creation (idempotent) — service role, plus an authenticated wrapper
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_import_create_impl(
  p_organization_id uuid, p_actor uuid, p_format text, p_file_name text, p_checksum text,
  p_mode text, p_chunk_size integer, p_idempotency_key text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_job  public.marketplace_import_jobs;
  v_id   uuid;
  v_open integer;
begin
  select * into v_job from public.marketplace_import_jobs
   where organization_id = p_organization_id and idempotency_key = p_idempotency_key;
  if found then
    if v_job.source_checksum_sha256 is distinct from p_checksum or v_job.mode is distinct from p_mode
       or v_job.source_format is distinct from p_format then
      raise exception 'idempotency key already used for a different import' using errcode = '23505';
    end if;
    return v_job.id;
  end if;

  if not app.marketplace_seller_is_enabled(p_organization_id) then
    raise exception 'the organization is not an enabled Marketplace seller' using errcode = '23514';
  end if;
  select count(*) into v_open from public.marketplace_import_jobs
   where organization_id = p_organization_id
     and status not in ('completed', 'completed_with_errors', 'failed', 'cancelled');
  if v_open >= 3 then
    raise exception 'too many active imports for this organization (max 3)' using errcode = '23514';
  end if;

  perform app.marketplace_import_flag(true);
  insert into public.marketplace_import_jobs
    (organization_id, created_by, idempotency_key, source_format, source_file_name, source_checksum_sha256, mode, chunk_size)
  values (p_organization_id, p_actor, p_idempotency_key, p_format, btrim(p_file_name), p_checksum, p_mode,
          coalesce(p_chunk_size, 500))
  returning id into v_id;
  insert into public.marketplace_import_job_events (job_id, from_status, to_status, actor, note)
  values (v_id, null, 'created', p_actor::text, p_mode || ' ' || p_format);
  perform app.marketplace_import_flag(false);
  return v_id;
end;
$$;

create or replace function public.marketplace_import_create(
  p_organization_id uuid, p_actor uuid, p_format text, p_file_name text, p_checksum text,
  p_mode text default 'dry_run', p_chunk_size integer default 500, p_idempotency_key text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'an actor user id is required' using errcode = '22023';
  end if;
  return app.marketplace_import_create_impl(p_organization_id, p_actor, p_format, p_file_name, p_checksum,
                                            p_mode, p_chunk_size, p_idempotency_key);
end;
$$;

create or replace function public.marketplace_import_job_create(
  p_organization_id uuid, p_format text, p_file_name text, p_checksum text,
  p_mode text default 'dry_run', p_chunk_size integer default 500, p_idempotency_key text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not app.is_org_member(p_organization_id) or not app.can_publish_catalog(p_organization_id) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  return app.marketplace_import_create_impl(p_organization_id, v_uid, p_format, p_file_name, p_checksum,
                                            p_mode, p_chunk_size, p_idempotency_key);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Staging (bounded, idempotent)
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_import_stage_rows(p_job uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  j        public.marketplace_import_jobs;
  e        jsonb;
  v_num    integer;
  v_hash   text;
  v_price  text;
  v_exist  text;
  v_added  integer := 0;
  v_n      integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 1000 then
    raise exception 'p_rows must be an array of 1-1000 rows' using errcode = '22023';
  end if;
  select * into j from public.marketplace_import_jobs where id = p_job for update;
  if not found then
    raise exception 'unknown import job' using errcode = '23503';
  end if;
  if j.status not in ('created', 'staging') then
    raise exception 'rows can only be staged while the job is created/staging (is %)', j.status using errcode = '23514';
  end if;

  perform app.marketplace_import_flag(true);
  for e in select * from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(e) <> 'object' or (e ->> 'row_number') is null or (e ->> 'row_number') !~ '^[0-9]{1,6}$' then
      raise exception 'every row needs an integer row_number' using errcode = '22023';
    end if;
    v_num := (e ->> 'row_number')::integer;
    if v_num < 1 then
      raise exception 'row_number must be >= 1' using errcode = '22023';
    end if;
    v_hash := encode(sha256(convert_to(e::text, 'UTF8')), 'hex');

    select row_hash into v_exist from public.marketplace_import_rows where job_id = p_job and row_number = v_num;
    if found then
      if v_exist is distinct from v_hash then
        raise exception 'row % was already staged with different content', v_num using errcode = '23505';
      end if;
      continue;   -- identical replay: nothing to do
    end if;

    v_price := nullif(btrim(coalesce(e ->> 'price', '')), '');
    if v_price ~ '^[0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?$' then
      v_price := replace(v_price, ',', '');
    end if;
    if v_price !~ '^[0-9]{1,10}(\.[0-9]+)?$' then
      v_price := null;
    end if;

    insert into public.marketplace_import_rows
      (job_id, organization_id, row_number, external_ref, sku, product_type_key, name_ar, name_en,
       description_ar, description_en, brand, selling_unit, price_egp, attributes, raw, row_hash)
    values (p_job, j.organization_id, v_num,
            nullif(btrim(e ->> 'external_ref'), ''), nullif(btrim(e ->> 'sku'), ''),
            nullif(lower(btrim(e ->> 'product_type')), ''),
            nullif(btrim(e ->> 'name_ar'), ''), nullif(btrim(e ->> 'name_en'), ''),
            nullif(btrim(e ->> 'description_ar'), ''), nullif(btrim(e ->> 'description_en'), ''),
            nullif(btrim(e ->> 'brand'), ''), nullif(lower(btrim(e ->> 'selling_unit')), ''),
            v_price::numeric,
            case when jsonb_typeof(e -> 'attributes') = 'object' then e -> 'attributes' else '{}'::jsonb end,
            e, v_hash);
    v_added := v_added + 1;
  end loop;

  select count(*) into v_n from public.marketplace_import_rows where job_id = p_job;
  if v_n > 50000 then
    raise exception 'an import is limited to 50000 rows' using errcode = '23514';
  end if;
  update public.marketplace_import_jobs set total_rows = v_n where id = p_job;
  perform app.marketplace_import_flag(false);
  perform app.marketplace_import_set_status(p_job, 'staging', 'worker', null);
  return v_added;
end;
$$;

create or replace function public.marketplace_import_stage_assets(p_job uuid, p_assets jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  j       public.marketplace_import_jobs;
  e       jsonb;
  v_name  text;
  v_parse record;
  v_key   text;
  v_prov  text;
  v_bucket text;
  v_id    uuid;
  v_exist record;
  v_added integer := 0;
  v_n     integer;
  v_valid boolean;
begin
  if jsonb_typeof(p_assets) is distinct from 'array' or jsonb_array_length(p_assets) not between 1 and 1000 then
    raise exception 'p_assets must be an array of 1-1000 assets' using errcode = '22023';
  end if;
  select * into j from public.marketplace_import_jobs where id = p_job for update;
  if not found then
    raise exception 'unknown import job' using errcode = '23503';
  end if;
  if j.status not in ('created', 'staging') then
    raise exception 'assets can only be staged while the job is created/staging (is %)', j.status using errcode = '23514';
  end if;

  perform app.marketplace_import_flag(true);
  for e in select * from jsonb_array_elements(p_assets) loop
    v_name   := nullif(btrim(e ->> 'file_name'), '');
    v_key    := nullif(btrim(e ->> 'object_key'), '');
    v_prov   := coalesce(nullif(btrim(e ->> 'storage_provider'), ''), 'supabase_storage');
    v_bucket := nullif(btrim(e ->> 'storage_bucket'), '');
    if v_name is null or v_key is null or v_bucket is null or char_length(v_name) > 255 or char_length(v_key) > 512
       or v_prov not in ('supabase_storage', 'cloudflare_r2') or char_length(v_bucket) > 63 then
      raise exception 'every asset needs file_name, storage_bucket and object_key (within limits)' using errcode = '22023';
    end if;

    select id, object_key into v_exist from public.marketplace_import_assets where job_id = p_job and file_name = v_name;
    if found then
      if v_exist.object_key is distinct from v_key then
        raise exception 'asset % was already registered with a different object key', v_name using errcode = '23505';
      end if;
      continue;
    end if;

    select * into v_parse from app.marketplace_import_parse_asset_name(v_name);
    -- the SAME rule the canonical image table enforces: a reference, never a URL / path trick
    v_valid := v_key !~ '^/' and v_key !~ '\.\.' and v_key !~ '^[a-zA-Z][a-zA-Z0-9+.-]*://' and v_key !~ '[?#]'
               and v_bucket ~ '^[a-z0-9][a-z0-9._-]*$';

    insert into public.marketplace_import_assets
      (job_id, organization_id, file_name, sku_key, sequence, storage_provider, storage_bucket, object_key,
       byte_size, checksum_sha256, mime_type, status)
    values (p_job, j.organization_id, v_name, v_parse.sku_key, v_parse.seq, v_prov, v_bucket, v_key,
            nullif(e ->> 'byte_size', '')::bigint, nullif(e ->> 'checksum_sha256', ''), nullif(e ->> 'mime_type', ''),
            case when v_parse.sku_key is null or not v_valid then 'rejected' else 'pending' end)
    returning id into v_id;
    v_added := v_added + 1;

    if v_parse.sku_key is null then
      perform app.marketplace_import_record_finding(p_job, j.organization_id, null, v_id, null, 'warning',
        'asset_name_unparseable', 'file_name', 'File name must look like <SKU>_<NN>.jpg');
    elsif not v_valid then
      perform app.marketplace_import_record_finding(p_job, j.organization_id, null, v_id, null, 'error',
        'asset_key_invalid', 'object_key', 'Storage object reference is not a safe key');
    end if;
  end loop;

  select count(*) into v_n from public.marketplace_import_assets where job_id = p_job;
  if v_n > 200000 then
    raise exception 'an import is limited to 200000 assets' using errcode = '23514';
  end if;
  update public.marketplace_import_jobs set total_assets = v_n where id = p_job;
  perform app.marketplace_import_flag(false);
  perform app.marketplace_import_set_status(p_job, 'staging', 'worker', null);
  return v_added;
end;
$$;

-- Seal: no more rows/assets; deterministic asset -> row matching.
create or replace function public.marketplace_import_seal(p_job uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j          public.marketplace_import_jobs;
  v_matched  integer;
  v_unmatched integer;
  v_dups     integer;
  v_rec      record;
begin
  select * into j from public.marketplace_import_jobs where id = p_job for update;
  if not found then
    raise exception 'unknown import job' using errcode = '23503';
  end if;
  if j.status = 'staged' then
    return jsonb_build_object('status', 'staged', 'rows', j.total_rows, 'assets', j.total_assets);   -- idempotent
  end if;
  if j.status not in ('created', 'staging') then
    raise exception 'cannot seal a job in status %', j.status using errcode = '23514';
  end if;
  if j.total_rows < 1 then
    raise exception 'an import needs at least one row' using errcode = '23514';
  end if;

  perform app.marketplace_import_flag(true);
  -- a (sku_key, sequence) pair may appear once: SKU_01.jpg vs SKU_01.png keeps the lowest file name
  with ranked as (
    select a.id, row_number() over (partition by lower(a.sku_key), a.sequence order by a.file_name) as rn
    from public.marketplace_import_assets a
    where a.job_id = p_job and a.status = 'pending'
  )
  update public.marketplace_import_assets a set status = 'rejected'
  from ranked r where r.id = a.id and r.rn > 1;
  get diagnostics v_dups = row_count;
  for v_rec in select a.id, a.file_name from public.marketplace_import_assets a
               where a.job_id = p_job and a.status = 'rejected' and a.sku_key is not null
                 and not exists (select 1 from public.marketplace_import_errors er where er.asset_id = a.id) loop
    perform app.marketplace_import_record_finding(p_job, j.organization_id, null, v_rec.id, null, 'warning',
      'asset_duplicate_sequence', 'file_name', 'Another file already provides this SKU image position');
  end loop;

  -- 1) by SKU (case-insensitive; if the file repeats a SKU the lowest row wins).
  --    Correlated, index-driven lookup: stays linear with no planner statistics.
  update public.marketplace_import_assets a set status = 'matched', matched_by = 'sku', matched_row_id = sub.row_id
  from (select a2.id as asset_id,
               (select r.id from public.marketplace_import_rows r
                 where r.job_id = p_job and r.sku is not null and lower(r.sku) = lower(a2.sku_key)
                 order by r.row_number limit 1) as row_id
        from public.marketplace_import_assets a2
        where a2.job_id = p_job and a2.status = 'pending') sub
  where a.id = sub.asset_id and sub.row_id is not null;

  -- 2) else by product reference -> the product's first row (product-level images)
  update public.marketplace_import_assets a set status = 'matched', matched_by = 'external_ref', matched_row_id = sub.row_id
  from (select a2.id as asset_id,
               (select r.id from public.marketplace_import_rows r
                 where r.job_id = p_job and r.external_ref is not null and lower(r.external_ref) = lower(a2.sku_key)
                 order by r.row_number limit 1) as row_id
        from public.marketplace_import_assets a2
        where a2.job_id = p_job and a2.status = 'pending') sub
  where a.id = sub.asset_id and sub.row_id is not null;

  -- 3) the rest is reported, never guessed
  for v_rec in select a.id, a.file_name from public.marketplace_import_assets a
               where a.job_id = p_job and a.status = 'pending' loop
    update public.marketplace_import_assets set status = 'unmatched' where id = v_rec.id;
    perform app.marketplace_import_record_finding(p_job, j.organization_id, null, v_rec.id, null, 'warning',
      'asset_unmatched', 'file_name', 'No row with this SKU or product reference');
  end loop;
  perform app.marketplace_import_flag(false);

  select count(*) filter (where status = 'matched'), count(*) filter (where status = 'unmatched')
    into v_matched, v_unmatched from public.marketplace_import_assets where job_id = p_job;
  perform app.marketplace_import_set_status(p_job, 'staged', 'worker', 'sealed');
  return jsonb_build_object('status', 'staged', 'rows', j.total_rows, 'assets', j.total_assets,
                            'matched', v_matched, 'unmatched', v_unmatched);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Worker lease (resumable, single active worker per job)
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_import_claim(p_job uuid, p_worker text, p_lease_seconds integer default 300)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.marketplace_import_jobs;
begin
  if p_worker is null or char_length(p_worker) not between 1 and 100 then
    raise exception 'a worker id is required' using errcode = '22023';
  end if;
  select * into j from public.marketplace_import_jobs where id = p_job for update;
  if not found then
    raise exception 'unknown import job' using errcode = '23503';
  end if;
  if j.status in ('completed', 'completed_with_errors', 'failed', 'cancelled') then
    return false;
  end if;
  if j.locked_by is not null and j.locked_by <> p_worker and j.lease_expires_at > now() then
    return false;
  end if;
  perform app.marketplace_import_flag(true);
  update public.marketplace_import_jobs
     set locked_by = p_worker, lease_expires_at = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 300), 30), 3600))
   where id = p_job;
  perform app.marketplace_import_flag(false);
  return true;
end;
$$;

create or replace function public.marketplace_import_release(p_job uuid, p_worker text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.marketplace_import_flag(true);
  update public.marketplace_import_jobs set locked_by = null, lease_expires_at = null
   where id = p_job and locked_by = p_worker;
  perform app.marketplace_import_flag(false);
end;
$$;

create or replace function app.marketplace_import_assert_lease(p_job uuid, p_worker text)
returns public.marketplace_import_jobs
language plpgsql
set search_path = ''
as $$
declare
  j public.marketplace_import_jobs;
begin
  select * into j from public.marketplace_import_jobs where id = p_job for update;
  if not found then
    raise exception 'unknown import job' using errcode = '23503';
  end if;
  if j.locked_by is distinct from p_worker or j.lease_expires_at is null or j.lease_expires_at <= now() then
    raise exception 'worker % does not hold the lease of this job', p_worker using errcode = '55P03';
  end if;
  return j;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Validate one chunk
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_import_validate_next(p_job uuid, p_worker text)
returns table (processed integer, remaining integer, job_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  j       public.marketplace_import_jobs;
  r       record;
  f       record;
  v_n     integer := 0;
  v_err   integer;
  v_cnt   integer;
  v_left  integer;
begin
  j := app.marketplace_import_assert_lease(p_job, p_worker);
  if j.status not in ('staged', 'validating') then
    raise exception 'cannot validate a job in status %', j.status using errcode = '23514';
  end if;
  if j.status = 'staged' then
    perform app.marketplace_import_set_status(p_job, 'validating', p_worker, null);
  end if;

  for r in
    select id, row_number from public.marketplace_import_rows
    where job_id = p_job and status = 'pending'
    order by row_number
    limit j.chunk_size
    for update skip locked
  loop
    perform app.marketplace_import_flag(true);
    delete from public.marketplace_import_errors where row_id = r.id;     -- re-validation is idempotent
    v_err := 0; v_cnt := 0;
    for f in select * from app.marketplace_import_row_findings(r.id) order by (severity = 'error') desc, code, field loop
      v_cnt := v_cnt + 1;
      exit when v_cnt > 20;                                                -- bounded per row
      if f.severity = 'error' then v_err := v_err + 1; end if;
      perform app.marketplace_import_record_finding(p_job, j.organization_id, r.id, null, r.row_number,
                                                    f.severity, f.code, f.field, f.message);
    end loop;
    perform app.marketplace_import_flag(true);
    update public.marketplace_import_rows set status = case when v_err = 0 then 'valid' else 'invalid' end
     where id = r.id;
    perform app.marketplace_import_flag(false);
    v_n := v_n + 1;
  end loop;

  perform app.marketplace_import_flag(true);
  update public.marketplace_import_jobs x set
    valid_rows   = (select count(*) from public.marketplace_import_rows where job_id = p_job and status in ('valid', 'applied', 'failed')),
    invalid_rows = (select count(*) from public.marketplace_import_rows where job_id = p_job and status = 'invalid')
  where x.id = p_job;
  perform app.marketplace_import_flag(false);

  select count(*) into v_left from public.marketplace_import_rows where job_id = p_job and status = 'pending';
  if v_left = 0 then
    perform app.marketplace_import_set_status(p_job, 'validated', p_worker, null);
  end if;
  select status into job_status from public.marketplace_import_jobs where id = p_job;
  processed := v_n; remaining := v_left;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Apply one row (internal) and one chunk
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_import_apply_attribute(
  p_level text, p_owner uuid, p_attribute_id uuid, p_data_type text, p_value jsonb)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_option uuid;
  v_text   text;
  v_num    numeric;
  v_bool   boolean;
  v_changed boolean := false;
  v_n      integer;
  k        text;
begin
  if p_data_type = 'multi_option' then
    -- set semantics: drop options no longer listed, add the missing ones
    if p_level = 'product' then
      delete from public.marketplace_product_attribute_values v
       where v.product_id = p_owner and v.attribute_id = p_attribute_id
         and not exists (select 1 from jsonb_array_elements_text(p_value) e
                         join public.marketplace_attribute_options o on o.attribute_id = p_attribute_id and o.key = e
                         where o.id = v.option_id);
      get diagnostics v_n = row_count; v_changed := v_changed or v_n > 0;
    else
      delete from public.marketplace_variant_attribute_values v
       where v.variant_id = p_owner and v.attribute_id = p_attribute_id
         and not exists (select 1 from jsonb_array_elements_text(p_value) e
                         join public.marketplace_attribute_options o on o.attribute_id = p_attribute_id and o.key = e
                         where o.id = v.option_id);
      get diagnostics v_n = row_count; v_changed := v_changed or v_n > 0;
    end if;
    for k in select jsonb_array_elements_text(p_value) loop
      select o.id into v_option from public.marketplace_attribute_options o
       where o.attribute_id = p_attribute_id and o.key = k and o.is_active;
      if p_level = 'product' then
        insert into public.marketplace_product_attribute_values (product_id, attribute_id, data_type, option_id)
        values (p_owner, p_attribute_id, 'multi_option', v_option)
        on conflict (product_id, attribute_id, option_id) where data_type = 'multi_option' do nothing;
      else
        insert into public.marketplace_variant_attribute_values (variant_id, attribute_id, data_type, option_id)
        values (p_owner, p_attribute_id, 'multi_option', v_option)
        on conflict (variant_id, attribute_id, option_id) where data_type = 'multi_option' do nothing;
      end if;
      get diagnostics v_n = row_count; v_changed := v_changed or v_n > 0;
    end loop;
    return v_changed;
  end if;

  if p_data_type = 'option' then
    select o.id into v_option from public.marketplace_attribute_options o
     where o.attribute_id = p_attribute_id and o.key = (p_value #>> '{}') and o.is_active;
  elsif p_data_type in ('number', 'measurement') then
    v_num := (p_value #>> '{}')::numeric;
  elsif p_data_type = 'boolean' then
    v_bool := (p_value #>> '{}')::boolean;
  else
    v_text := btrim(p_value #>> '{}');
  end if;

  if p_level = 'product' then
    update public.marketplace_product_attribute_values v set
      option_id = v_option, value_number = v_num, value_boolean = v_bool, value_text = v_text
    where v.product_id = p_owner and v.attribute_id = p_attribute_id
      and (v.option_id, v.value_number, v.value_boolean, v.value_text)
          is distinct from (v_option, v_num, v_bool, v_text);
    get diagnostics v_n = row_count;
    if v_n > 0 then return true; end if;
    insert into public.marketplace_product_attribute_values
      (product_id, attribute_id, data_type, option_id, value_number, value_boolean, value_text)
    values (p_owner, p_attribute_id, p_data_type, v_option, v_num, v_bool, v_text)
    on conflict (product_id, attribute_id) where data_type <> 'multi_option' do nothing;
  else
    update public.marketplace_variant_attribute_values v set
      option_id = v_option, value_number = v_num, value_boolean = v_bool, value_text = v_text
    where v.variant_id = p_owner and v.attribute_id = p_attribute_id
      and (v.option_id, v.value_number, v.value_boolean, v.value_text)
          is distinct from (v_option, v_num, v_bool, v_text);
    get diagnostics v_n = row_count;
    if v_n > 0 then return true; end if;
    insert into public.marketplace_variant_attribute_values
      (variant_id, attribute_id, data_type, option_id, value_number, value_boolean, value_text)
    values (p_owner, p_attribute_id, p_data_type, v_option, v_num, v_bool, v_text)
    on conflict (variant_id, attribute_id) where data_type <> 'multi_option' do nothing;
  end if;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

create or replace function app.marketplace_import_apply_row(p_row_id uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  r         public.marketplace_import_rows;
  m         public.marketplace_import_rows;
  v_type_id uuid;
  v_master  boolean;
  v_product uuid;
  v_ptype   uuid;
  v_variant uuid;
  v_vprod   uuid;
  v_unit    text;
  v_price   numeric;
  v_created boolean := false;
  v_changed boolean := false;
  v_n       integer;
  a         record;
  img       record;
  v_img     record;
  v_sort    integer;
  v_var_for_img uuid;
  v_primary boolean;
begin
  select * into r from public.marketplace_import_rows where id = p_row_id;
  select t.id into v_type_id
  from public.marketplace_product_types t join public.marketplace_categories c on c.id = t.category_id
  where t.key = r.product_type_key and t.is_active and c.is_active;
  if v_type_id is null then
    raise exception 'product type is not available' using errcode = '23514';
  end if;
  if not app.marketplace_seller_is_enabled(r.organization_id) then
    raise exception 'the seller is not enabled for the Marketplace' using errcode = '23514';
  end if;

  select * into m from public.marketplace_import_rows
   where job_id = r.job_id and external_ref = r.external_ref order by row_number limit 1;
  v_master := m.id = r.id;

  -- product (identified by seller + external_ref)
  select p.id, p.product_type_id into v_product, v_ptype from public.marketplace_products p
   where p.seller_organization_id = r.organization_id and p.external_ref = r.external_ref for update;
  if v_product is null then
    insert into public.marketplace_products
      (seller_organization_id, product_type_id, slug, name_ar, name_en, description_ar, description_en, brand, external_ref, status)
    values (r.organization_id, v_type_id, app.marketplace_import_slug(m.name_en, r.organization_id, r.external_ref),
            m.name_ar, m.name_en, m.description_ar, m.description_en, m.brand, r.external_ref, 'draft')
    returning id into v_product;
    v_created := true;
  else
    if v_ptype is distinct from v_type_id then
      raise exception 'an existing product''s type cannot be changed by import' using errcode = '23514';
    end if;
    if v_master then
      update public.marketplace_products p set
        name_ar = m.name_ar, name_en = m.name_en, description_ar = m.description_ar,
        description_en = m.description_en, brand = m.brand
      where p.id = v_product
        and (p.name_ar, p.name_en, p.description_ar, p.description_en, p.brand)
            is distinct from (m.name_ar, m.name_en, m.description_ar, m.description_en, m.brand);
      get diagnostics v_n = row_count;
      v_changed := v_changed or v_n > 0;      -- status / seller / type are never touched
    end if;
  end if;

  -- variant (identified by seller + sku)
  select v.id, v.product_id, v.selling_unit, v.price_egp into v_variant, v_vprod, v_unit, v_price
  from public.marketplace_product_variants v
  where v.seller_organization_id = r.organization_id and v.sku = r.sku for update;
  if v_variant is null then
    insert into public.marketplace_product_variants (product_id, seller_organization_id, sku, selling_unit, price_egp)
    values (v_product, r.organization_id, r.sku, r.selling_unit, r.price_egp)
    returning id into v_variant;
    v_created := true;
  else
    if v_vprod <> v_product then
      raise exception 'this SKU belongs to a different product' using errcode = '23514';
    end if;
    if v_unit <> r.selling_unit then
      raise exception 'the selling unit of an existing variant cannot be changed by import' using errcode = '23514';
    end if;
    if v_price is distinct from r.price_egp then
      update public.marketplace_product_variants set price_egp = r.price_egp where id = v_variant;
      v_changed := true;
    end if;
  end if;

  -- attribute values (product-level ones come from the product's first row only)
  for a in
    select d.id as def_id, d.key, d.data_type, ta.level
    from public.marketplace_product_type_attributes ta
    join public.marketplace_attribute_definitions d on d.id = ta.attribute_id
    where ta.product_type_id = v_type_id and ta.is_active and d.is_active and r.attributes ? d.key
  loop
    if a.level = 'product' then
      continue when not v_master;
      v_changed := app.marketplace_import_apply_attribute('product', v_product, a.def_id, a.data_type, r.attributes -> a.key) or v_changed;
    else
      v_changed := app.marketplace_import_apply_attribute('variant', v_variant, a.def_id, a.data_type, r.attributes -> a.key) or v_changed;
    end if;
  end loop;

  -- images: stable object references, status pending, deterministic order
  for img in
    select s.*, 0 as ord
    from public.marketplace_import_assets s
    where s.matched_row_id = r.id and s.status in ('matched', 'applied')
    order by s.sequence, s.file_name
  loop
    v_var_for_img := case when img.matched_by = 'sku' then v_variant else null end;
    select i.id, i.product_id into v_img from public.marketplace_product_images i
     where i.storage_provider = img.storage_provider and i.storage_bucket = img.storage_bucket and i.object_key = img.object_key;
    if found then
      if v_img.product_id <> v_product then
        raise exception 'image object % already belongs to another product', img.object_key using errcode = '23505';
      end if;
    else
      select coalesce(max(i.sort_order) + 1, 0) into v_sort from public.marketplace_product_images i
       where i.product_id = v_product and i.variant_id is not distinct from v_var_for_img;
      v_primary := v_var_for_img is null
                   and not exists (select 1 from public.marketplace_product_images i
                                   where i.product_id = v_product and i.variant_id is null and i.is_primary and i.status <> 'rejected');
      insert into public.marketplace_product_images
        (product_id, variant_id, storage_provider, storage_bucket, object_key, sort_order, is_primary, status,
         mime_type, byte_size, checksum_sha256)
      values (v_product, v_var_for_img, img.storage_provider, img.storage_bucket, img.object_key,
              v_sort, v_primary, 'pending', img.mime_type, img.byte_size, img.checksum_sha256)
      returning id, product_id into v_img;
      v_changed := true;
    end if;
    update public.marketplace_import_assets set status = 'applied', image_id = v_img.id where id = img.id;
  end loop;

  update public.marketplace_import_rows set product_id = v_product, variant_id = v_variant where id = r.id;
  return case when v_created then 'create' when v_changed then 'update' else 'unchanged' end;
end;
$$;

create or replace function public.marketplace_import_apply_next(p_job uuid, p_worker text)
returns table (processed integer, remaining integer, job_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  j        public.marketplace_import_jobs;
  r        record;
  v_action text;
  v_n      integer := 0;
  v_left   integer;
  v_bad    integer;
  v_msg    text;
begin
  j := app.marketplace_import_assert_lease(p_job, p_worker);
  if j.mode <> 'apply' then
    raise exception 'a dry-run job never writes products' using errcode = '23514';
  end if;
  if j.status not in ('validated', 'applying') then
    raise exception 'cannot apply a job in status %', j.status using errcode = '23514';
  end if;
  if j.status = 'validated' then
    perform app.marketplace_import_set_status(p_job, 'applying', p_worker, null);
  end if;

  for r in
    select id, row_number from public.marketplace_import_rows
    where job_id = p_job and status = 'valid'
    order by row_number
    limit j.chunk_size
    for update skip locked
  loop
    begin
      -- one sub-transaction per row: a failure undoes only that row's writes
      perform app.marketplace_import_flag(true);
      v_action := app.marketplace_import_apply_row(r.id);
      perform app.marketplace_import_flag(true);
      update public.marketplace_import_rows
         set status = 'applied', action = v_action, attempt_count = attempt_count + 1, processed_at = now()
       where id = r.id;
      perform app.marketplace_import_flag(false);
    exception when others then
      get stacked diagnostics v_msg = message_text;
      perform app.marketplace_import_flag(true);
      update public.marketplace_import_rows
         set status = 'failed', attempt_count = attempt_count + 1, processed_at = now()
       where id = r.id;
      perform app.marketplace_import_flag(false);
      perform app.marketplace_import_record_finding(p_job, j.organization_id, r.id, null, r.row_number,
                                                    'error', 'apply_failed', null, v_msg);
    end;
    v_n := v_n + 1;
  end loop;

  perform app.marketplace_import_flag(true);
  update public.marketplace_import_jobs x set
    applied_rows = (select count(*) from public.marketplace_import_rows where job_id = p_job and status = 'applied'),
    failed_rows  = (select count(*) from public.marketplace_import_rows where job_id = p_job and status = 'failed')
  where x.id = p_job;
  perform app.marketplace_import_flag(false);

  select count(*) into v_left from public.marketplace_import_rows where job_id = p_job and status = 'valid';
  if v_left = 0 then
    select count(*) into v_bad from public.marketplace_import_rows where job_id = p_job and status in ('invalid', 'failed');
    perform app.marketplace_import_set_status(p_job, case when v_bad > 0 then 'completed_with_errors' else 'completed' end,
                                              p_worker, null);
  end if;
  select status into job_status from public.marketplace_import_jobs where id = p_job;
  processed := v_n; remaining := v_left;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Dry-run completion, retry, cancel, purge, report
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_import_complete_dry_run(p_job uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.marketplace_import_jobs;
begin
  select * into j from public.marketplace_import_jobs where id = p_job for update;
  if not found then
    raise exception 'unknown import job' using errcode = '23503';
  end if;
  if j.mode <> 'dry_run' then
    raise exception 'only a dry-run job is completed this way' using errcode = '23514';
  end if;
  if j.status in ('completed', 'completed_with_errors') then
    return j.status;
  end if;
  if j.status <> 'validated' then
    raise exception 'a dry run completes after validation (is %)', j.status using errcode = '23514';
  end if;
  perform app.marketplace_import_set_status(p_job,
    case when j.invalid_rows > 0 then 'completed_with_errors' else 'completed' end, 'worker', 'dry run');
  return (select status from public.marketplace_import_jobs where id = p_job);
end;
$$;

create or replace function public.marketplace_import_retry_failed(p_job uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  j   public.marketplace_import_jobs;
  v_n integer;
begin
  select * into j from public.marketplace_import_jobs where id = p_job for update;
  if not found then
    raise exception 'unknown import job' using errcode = '23503';
  end if;
  if j.mode <> 'apply' or j.status not in ('applying', 'completed_with_errors') then
    raise exception 'nothing to retry in status %', j.status using errcode = '23514';
  end if;
  perform app.marketplace_import_flag(true);
  update public.marketplace_import_rows set status = 'valid'
   where job_id = p_job and status = 'failed' and attempt_count < 3;
  get diagnostics v_n = row_count;
  perform app.marketplace_import_flag(false);
  if v_n > 0 and j.status = 'completed_with_errors' then
    perform app.marketplace_import_set_status(p_job, 'applying', 'worker', 'retry failed rows');
  end if;
  return v_n;
end;
$$;

create or replace function app.marketplace_import_cancel_impl(p_job uuid, p_actor text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  j public.marketplace_import_jobs;
begin
  select * into j from public.marketplace_import_jobs where id = p_job for update;
  if not found then
    raise exception 'unknown import job' using errcode = '23503';
  end if;
  if j.status = 'cancelled' then
    return 'cancelled';
  end if;
  if j.status in ('completed', 'completed_with_errors', 'failed') then
    raise exception 'a finished import cannot be cancelled' using errcode = '23514';
  end if;
  perform app.marketplace_import_set_status(p_job, 'cancelled', p_actor, 'cancelled');
  return 'cancelled';
end;
$$;

create or replace function public.marketplace_import_cancel(p_job uuid, p_actor uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.marketplace_import_cancel_impl(p_job, p_actor::text);
end;
$$;

create or replace function public.marketplace_import_job_cancel(p_job uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select organization_id into v_org from public.marketplace_import_jobs where id = p_job;
  if v_org is null or not app.is_org_member(v_org) or not app.can_publish_catalog(v_org) then
    raise exception 'import job not found or not permitted' using errcode = '42501';
  end if;
  return app.marketplace_import_cancel_impl(p_job, v_uid::text);
end;
$$;

create or replace function public.marketplace_import_purge_staging(p_job uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  j   public.marketplace_import_jobs;
  v_n integer;
begin
  select * into j from public.marketplace_import_jobs where id = p_job for update;
  if not found then
    raise exception 'unknown import job' using errcode = '23503';
  end if;
  if j.status not in ('completed', 'completed_with_errors', 'failed', 'cancelled') then
    raise exception 'only a finished job can be purged' using errcode = '23514';
  end if;
  perform app.marketplace_import_flag(true);
  delete from public.marketplace_import_errors where job_id = p_job;
  delete from public.marketplace_import_assets where job_id = p_job;
  delete from public.marketplace_import_rows   where job_id = p_job;
  get diagnostics v_n = row_count;
  perform app.marketplace_import_flag(false);
  return v_n;
end;
$$;

create or replace function public.marketplace_import_job_report(p_job uuid)
returns table (row_number integer, external_ref text, sku text, file_name text, severity text,
               code text, field text, message text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.marketplace_import_jobs where id = p_job;
  -- service_role (no auth.uid()) or a catalogue member of the owning organization
  if v_org is null or (
       (select auth.uid()) is not null
       and not (app.is_org_member(v_org) and app.can_publish_catalog(v_org))) then
    raise exception 'import job not found or not permitted' using errcode = '42501';
  end if;
  return query
    select e.row_number, r.external_ref, r.sku, a.file_name, e.severity, e.code, e.field, e.message
    from public.marketplace_import_errors e
    left join public.marketplace_import_rows r on r.id = e.row_id
    left join public.marketplace_import_assets a on a.id = e.asset_id
    where e.job_id = p_job
    order by e.row_number nulls last, e.sequence
    limit 10000;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. RLS, grants
-- ---------------------------------------------------------------------------
alter table public.marketplace_import_jobs       enable row level security;
alter table public.marketplace_import_job_events enable row level security;
alter table public.marketplace_import_rows       enable row level security;
alter table public.marketplace_import_assets     enable row level security;
alter table public.marketplace_import_errors     enable row level security;

revoke all on public.marketplace_import_jobs, public.marketplace_import_job_events, public.marketplace_import_rows,
              public.marketplace_import_assets, public.marketplace_import_errors
  from public, anon, authenticated, service_role;

-- Members of the owning organization may READ their own jobs and findings.
grant select on public.marketplace_import_jobs, public.marketplace_import_job_events, public.marketplace_import_rows,
                public.marketplace_import_assets, public.marketplace_import_errors to authenticated;
create policy marketplace_import_jobs_select_member on public.marketplace_import_jobs
  for select to authenticated using (app.is_org_member(organization_id));
create policy marketplace_import_rows_select_member on public.marketplace_import_rows
  for select to authenticated using (app.is_org_member(organization_id));
create policy marketplace_import_assets_select_member on public.marketplace_import_assets
  for select to authenticated using (app.is_org_member(organization_id));
create policy marketplace_import_errors_select_member on public.marketplace_import_errors
  for select to authenticated using (app.is_org_member(organization_id));
create policy marketplace_import_events_select_member on public.marketplace_import_job_events
  for select to authenticated using (exists (
    select 1 from public.marketplace_import_jobs j
    where j.id = job_id and app.is_org_member(j.organization_id)));

-- worker surface: service_role only
revoke all on function
  public.marketplace_import_create(uuid, uuid, text, text, text, text, integer, text),
  public.marketplace_import_stage_rows(uuid, jsonb),
  public.marketplace_import_stage_assets(uuid, jsonb),
  public.marketplace_import_seal(uuid),
  public.marketplace_import_claim(uuid, text, integer),
  public.marketplace_import_release(uuid, text),
  public.marketplace_import_validate_next(uuid, text),
  public.marketplace_import_apply_next(uuid, text),
  public.marketplace_import_complete_dry_run(uuid),
  public.marketplace_import_retry_failed(uuid),
  public.marketplace_import_cancel(uuid, uuid),
  public.marketplace_import_purge_staging(uuid),
  public.marketplace_import_job_create(uuid, text, text, text, text, integer, text),
  public.marketplace_import_job_cancel(uuid),
  public.marketplace_import_job_report(uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.marketplace_import_create(uuid, uuid, text, text, text, text, integer, text),
  public.marketplace_import_stage_rows(uuid, jsonb),
  public.marketplace_import_stage_assets(uuid, jsonb),
  public.marketplace_import_seal(uuid),
  public.marketplace_import_claim(uuid, text, integer),
  public.marketplace_import_release(uuid, text),
  public.marketplace_import_validate_next(uuid, text),
  public.marketplace_import_apply_next(uuid, text),
  public.marketplace_import_complete_dry_run(uuid),
  public.marketplace_import_retry_failed(uuid),
  public.marketplace_import_cancel(uuid, uuid),
  public.marketplace_import_purge_staging(uuid),
  public.marketplace_import_job_report(uuid)
  to service_role;
-- seller surface: authenticated, each re-checks membership + catalogue authority
grant execute on function
  public.marketplace_import_job_create(uuid, text, text, text, text, integer, text),
  public.marketplace_import_job_cancel(uuid),
  public.marketplace_import_job_report(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Hardening: internal helpers stay unreachable to every client role
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname like 'marketplace\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
  end loop;
end;
$$;
