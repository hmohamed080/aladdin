-- Migration: identity core (Phase 1 — Identity & Multi-Tenancy, Sprint 1).
--
-- Creates the canonical single-identity foundation: `users` (mirrors auth.uid()),
-- `profiles` (1-1 shared identity data), `contacts` (verified channels), the shared
-- `app` helper schema, the updated_at trigger, and the auth->app profile bootstrap.
--
-- Design decisions are recorded in ADR-0007 and docs/database/phase1-identity-tenancy-review.md.
-- Schema is the ONLY source of truth (ADR-0002). RLS is enabled with explicit
-- policies on every table (06_rls_strategy.md). Extensions (pgcrypto, pg_trgm) are
-- provided by 20260729000000_extensions.sql and live in the `extensions` schema.

-- ---------------------------------------------------------------------------
-- 0. Shared helper schema + updated_at trigger
-- ---------------------------------------------------------------------------
create schema if not exists app;
comment on schema app is 'Aladdin helper functions/triggers (tenancy, identity). Not exposed via the Data API.';

-- Maintains updated_at on every mutable row (03_database_design.md §0).
create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Enum types (Phase 1 subset; others ship with their feature migration)
-- ---------------------------------------------------------------------------
-- Account type describes a user's PRIMARY PRODUCT EXPERIENCE only. It confers no
-- platform authority: platform governance is sourced solely from
-- `platform_role_grants` (ADR-0007 D4). `administrator` is deliberately NOT an
-- account type — platform staff hold a normal account type plus a platform-role
-- grant, so account type can never be mistaken for privilege (Sprint 1.1 review).
create type public.account_type as enum (
  'end_consumer', 'installer_technician', 'engineer', 'interior_designer',
  'showroom_dealer', 'supplier', 'manufacturer', 'importer', 'wholesaler',
  'sales', 'contractor', 'trainer', 'trainee'
);
create type public.platform_role as enum ('support', 'moderator', 'administrator');
create type public.contact_channel as enum ('whatsapp', 'email');
create type public.user_status as enum ('pending_verification', 'active', 'suspended', 'deactivated');

-- ---------------------------------------------------------------------------
-- 2. users — the single canonical identity (id = auth.uid())
-- ---------------------------------------------------------------------------
create table public.users (
  id                   uuid primary key references auth.users (id) on delete cascade,
  primary_account_type public.account_type not null default 'end_consumer',
  status               public.user_status  not null default 'pending_verification',
  is_verified          boolean not null default false,
  locale               text    not null default 'en',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint ck_users_locale check (locale in ('en', 'ar'))
);
comment on table public.users is 'One row per human identity, keyed to auth.users. Never duplicated per verification channel or account upgrade.';

create index ix_users_primary_account_type on public.users (primary_account_type);
create index ix_users_status on public.users (status);

create trigger set_users_updated_at
  before update on public.users
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. profiles — 1-1 shared identity/display data
-- ---------------------------------------------------------------------------
create table public.profiles (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references public.users (id) on delete cascade,
  display_name    text not null,
  headline        text,
  bio             text,
  avatar_media_id uuid,   -- FK to media added by the media migration (later phase)
  locality_id     uuid,   -- FK to localities added by the locality migration (later phase)
  languages       text[],
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint uq_profiles_user_id unique (user_id),
  constraint ck_profiles_display_name_len check (char_length(display_name) between 1 and 80),
  constraint ck_profiles_headline_len check (headline is null or char_length(headline) <= 120),
  constraint ck_profiles_bio_len check (bio is null or char_length(bio) <= 1000)
);
comment on table public.profiles is 'Shared identity/display data. Role-/org-specific data is modeled separately (never in the base profile). One per user (uq_profiles_user_id) prevents duplicate base profiles.';

create index ix_profiles_locality_id on public.profiles (locality_id);
create index ix_profiles_display_name_trgm on public.profiles using gin (display_name extensions.gin_trgm_ops);

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. contacts — verified/pending contact channels (WhatsApp/email)
-- ---------------------------------------------------------------------------
create table public.contacts (
  id          uuid primary key default extensions.gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  channel     public.contact_channel not null,
  value       text not null,
  is_primary  boolean not null default false,
  is_verified boolean not null default false,
  verified_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.contacts is 'Contact channels. Exactly one verified primary per user; a verified value is globally unique per channel.';

-- A verified contact value is unique per channel across all users (pending dupes allowed).
create unique index uq_contacts_verified_channel_value
  on public.contacts (channel, value) where is_verified;
-- At most one primary contact per user.
create unique index uq_contacts_primary_per_user
  on public.contacts (user_id) where is_primary;
create index ix_contacts_user on public.contacts (user_id);

create trigger set_contacts_updated_at
  before update on public.contacts
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Profile bootstrap — server-side, never client-created (ADR-0007 D3)
-- ---------------------------------------------------------------------------
-- Fires when Supabase Auth creates a user; atomically creates the app identity
-- rows. `on conflict do nothing` makes it idempotent and race-safe, so a base
-- profile can never be duplicated.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
  v_locale       text;
begin
  v_display_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Member'
  );
  v_locale := coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'en');
  if v_locale not in ('en', 'ar') then
    v_locale := 'en';
  end if;

  insert into public.users (id, locale)
  values (new.id, v_locale)
  on conflict (id) do nothing;

  insert into public.profiles (user_id, display_name)
  values (new.id, left(v_display_name, 80))
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------
-- 6. RLS — enable + identity policies
-- ---------------------------------------------------------------------------
alter table public.users    enable row level security;
alter table public.profiles enable row level security;
alter table public.contacts enable row level security;

-- users: self read/update only (platform cross-tenant read added in the next
-- migration once app.is_platform exists). No client insert/delete (bootstrap owns it).
create policy users_select_self on public.users
  for select to authenticated
  using (id = (select auth.uid()));

create policy users_update_self on public.users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- profiles: the base table is PRIVATE — a user sees only their own row (plus
-- platform read, added in the next migration). Public B2C discovery of
-- professional profiles is served exclusively by the curated
-- `profile_public_directory` view below, which exposes only approved columns
-- (never user_id / timestamps / deleted_at) — Sprint 1.1 review B1.
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()) and deleted_at is null)
  with check (user_id = (select auth.uid()));

-- Public directory: approved display columns of ACTIVE professional profiles.
-- Runs with the view owner's rights (security_invoker off) so it presents a
-- fixed, minimal projection instead of exposing the base table to anon. It never
-- reveals user_id, contact linkage, timestamps, or soft-delete state.
create view public.profile_public_directory
  with (security_invoker = false) as
  select p.id, p.display_name, p.headline, p.bio,
         p.avatar_media_id, p.locality_id, p.languages
  from public.profiles p
  join public.users u on u.id = p.user_id
  where p.deleted_at is null
    and u.status = 'active'
    and u.primary_account_type <> 'end_consumer';
comment on view public.profile_public_directory is 'Approved PUBLIC projection of professional profiles for B2C discovery (Sprint 1.1 review). Only display columns; never user_id/timestamps/deleted_at. The base profiles table stays private.';

-- contacts: strictly self-owned.
create policy contacts_select_self on public.contacts
  for select to authenticated using (user_id = (select auth.uid()));
create policy contacts_insert_self on public.contacts
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy contacts_update_self on public.contacts
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy contacts_delete_self on public.contacts
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 7. Grants (deny-by-default: the Data API no longer auto-exposes new objects)
-- ---------------------------------------------------------------------------
grant usage on schema app to anon, authenticated;

-- Security-definer helpers/triggers: revoke the default PUBLIC execute and grant
-- explicitly (Sprint 1.1 review H1). The bootstrap/updated_at trigger functions
-- are invoked by triggers only — no role needs direct execute.
revoke execute on function app.set_updated_at() from public;
revoke execute on function app.handle_new_user() from public;

-- CRITICAL (Sprint 1.1 review): Supabase's default table privileges hand anon and
-- authenticated TRUNCATE/REFERENCES/TRIGGER on every new public table. TRUNCATE
-- bypasses RLS and row-level triggers, so a client role could destroy tenant data.
-- Strip ALL default privileges from the client roles first, then grant back only
-- the intended access. `service_role` is the trusted, RLS-bypassing backend path
-- and must be granted its DML explicitly (Supabase does not auto-grant it here).
revoke all on public.users, public.profiles, public.contacts
  from anon, authenticated, service_role;

-- users: read own; update only non-privileged columns (is_verified/status are
-- server-controlled — withheld via column-level grant).
grant select on public.users to authenticated;
grant update (primary_account_type, locale) on public.users to authenticated;
grant select, insert, update, delete on public.users to service_role;

-- profiles: base table is PRIVATE (self + platform only). No anon grant — public
-- discovery goes through the view. Authenticated edits own profile columns only.
grant select on public.profiles to authenticated;
grant update (display_name, headline, bio, avatar_media_id, locality_id, languages, deleted_at)
  on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;

-- Public directory view: readable by anon + authenticated (approved columns only).
grant select on public.profile_public_directory to anon, authenticated, service_role;

-- contacts: full self-management.
grant select, insert, update, delete on public.contacts to authenticated;
grant select, insert, update, delete on public.contacts to service_role;
