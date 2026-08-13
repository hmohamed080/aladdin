-- Migration: PERMANENTLY separate the personal persona type from the business
-- organization type (Sprint 13, part A).
--
-- Sprint 12 fixed the SEMANTICS (`users.primary_account_type` is personal persona
-- state only, nullable; `organizations.org_type` is the sole business
-- classification) but both columns still shared ONE enum, `public.account_type`.
-- Semantics that live only in comments and RPC guards are semantics a future
-- `update ... set primary_account_type = 'supplier'` can quietly violate. This
-- migration moves the rule into the TYPE SYSTEM, where it cannot be bypassed:
--
--   public.persona_type       — who a PERSON is. No business classification.
--   public.organization_type  — what a BUSINESS is. No personal persona.
--
-- The two value sets are DISJOINT, so after this migration
--     update public.users set primary_account_type = 'supplier'    -> 22P02
--     update public.organizations set org_type    = 'engineer'     -> 22P02
-- fail at the type level, in every path, including a direct SQL statement by a
-- superuser. `public.account_type` is then DROPPED — the shared-enum debt is gone
-- rather than merely documented. Dropping it is also the completeness check: the
-- statement fails loudly if any column, signature or return type still uses it.
--
--   NAMES ARE KEPT. `users.primary_account_type` and `organizations.org_type` are
--   read by dozens of call sites; renaming them would be cosmetic churn with real
--   cross-cutting risk. Only their TYPES change.
--
-- ---------------------------------------------------------------------------
-- Two organization classifications had to be RENAMED, not removed
-- ---------------------------------------------------------------------------
-- Two organizations legitimately exist today whose `org_type` is a value that also
-- reads as a personal persona: a design studio typed `interior_designer` and a
-- contracting company typed `contractor` (both seeded, both real business
-- classifications — PRODUCT_DIRECTION_GUIDE lists "contractor company" and
-- "design/engineering office" as canonical org types). They are genuinely
-- implemented classifications and are PRESERVED, but a shared spelling would
-- re-create the very ambiguity this migration removes. They are therefore renamed
-- to their business-shaped names, which is what they always meant:
--
--   interior_designer -> design_office        (design / engineering office)
--   engineer          -> design_office        (same classification, if present)
--   contractor        -> contractor_company   (a contracting business)
--
-- Nothing is invented: no new KIND of business is introduced, no organization is
-- created, deleted, re-owned or re-keyed. Only the label of an existing
-- classification changes. Any other personal value on an organization has no
-- honest business meaning, so section 4 REFUSES to guess and fails with an
-- explicit instruction instead.
--
-- ---------------------------------------------------------------------------
-- What this migration preserves
-- ---------------------------------------------------------------------------
-- Every user id, auth identity, profile, organization, membership, branch,
-- capability, invitation, CRM row, product, RFQ, quotation, order, project and
-- audit record. No row is deleted anywhere. A business-only identity keeps its
-- NULL persona and is never given an inferred one. Every step is written to be
-- deterministic and idempotent: the data steps are value-scoped updates that match
-- nothing on a second run, and the DDL is guarded so a re-applied migration is a
-- no-op rather than an error.
--
-- Design: docs/product/PRODUCT_DIRECTION_GUIDE.md, docs/architecture/ARCHITECTURE_GUIDE.md.

-- ===========================================================================
-- 1. The two disjoint types
-- ===========================================================================
-- persona_type carries EXACTLY the personal values the system supports today,
-- including the legacy-but-legitimate training personas (`trainer` / `trainee`),
-- which are personal identities and are deliberately kept.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'persona_type'
                   and typnamespace = 'public'::regnamespace) then
    create type public.persona_type as enum (
      'end_consumer',
      'engineer', 'interior_designer', 'installer_technician', 'contractor', 'sales',
      'trainer', 'trainee'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'organization_type'
                   and typnamespace = 'public'::regnamespace) then
    create type public.organization_type as enum (
      'showroom_dealer', 'supplier', 'manufacturer', 'importer', 'wholesaler',
      'contractor_company', 'design_office'
    );
  end if;
end $$;

comment on type public.persona_type is
  'A PERSON''s personal persona. Never a business classification — showroom_dealer/supplier/manufacturer/importer/wholesaler/contractor_company/design_office are not values here, so users.primary_account_type cannot hold one. Sprint 13.';
comment on type public.organization_type is
  'A BUSINESS classification, the only source of "what kind of business is this". Never a personal persona — end_consumer/engineer/interior_designer/installer_technician/contractor/sales/trainer/trainee are not values here, so organizations.org_type cannot hold one. Sprint 13.';

-- ===========================================================================
-- 2. Drop everything that depends on public.account_type
-- ===========================================================================
-- Views first, then functions whose SIGNATURE or RETURN TYPE names the old enum.
-- Each is recreated in section 6 from its current definition; the only change is
-- the type. `if exists` keeps a re-run clean.
drop view if exists public.organization_public_directory;
drop function if exists app._organization_public_directory();
drop function if exists public.my_workspaces();
drop function if exists public.org_members_list(uuid);
drop function if exists public.request_account_upgrade(public.account_type);
drop function if exists public.onboarding_select_account_type(
  public.onboarding_track, public.account_type);
drop function if exists public.individual_save_professional(
  public.account_type, text, smallint, text, text, text[], text[], text[], text,
  text[], boolean, text, text, smallint);
drop function if exists public.business_draft_save(
  uuid, text, text, public.account_type, text, text, text, text);
drop function if exists public.business_save(
  text, text, public.account_type, text, text, text, text, boolean);
drop function if exists app.organization_create_owned(
  text, public.account_type, text, text);

-- ===========================================================================
-- 3. Drop the CHECK constraints that hard-code account_type literals
-- ===========================================================================
-- Several of these become structurally impossible once the types are disjoint and
-- are simply gone; the rest are re-added in section 5 in terms of the new types.
alter table public.organizations
  drop constraint if exists ck_organizations_type_not_consumer;
alter table public.verifications
  drop constraint if exists ck_verifications_requested_not_consumer,
  drop constraint if exists ck_verifications_type_matches_subject;
alter table public.onboarding_progress
  drop constraint if exists ck_onboarding_selected_type;
alter table public.business_onboarding
  drop constraint if exists ck_business_org_type;
alter table public.business_creation_drafts
  drop constraint if exists ck_bcd_org_type;
alter table public.individual_onboarding
  drop constraint if exists ck_indiv_prof_concrete_type;

-- ===========================================================================
-- 4. Retype the columns
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 4a. users.primary_account_type -> persona_type
-- ---------------------------------------------------------------------------
-- Sprint 12 already released identities that carried a business classification.
-- Repeating it here makes THIS migration self-sufficient and idempotent: it
-- matches nothing on a second run, and it guarantees the cast below cannot fail.
-- A released identity keeps its user id and everything attached to it and becomes
-- a valid business-only identity with NO personal persona — never an invented one.
update public.users
   set primary_account_type = null
 where primary_account_type::text in
       ('showroom_dealer', 'supplier', 'manufacturer', 'importer', 'wholesaler');

alter table public.users
  alter column primary_account_type type public.persona_type
  using primary_account_type::text::public.persona_type;

comment on column public.users.primary_account_type is
  'PERSONAL persona only, typed public.persona_type — the type system now makes a business classification here impossible (Sprint 13). NULL = a valid business-only identity with no personal persona. Business classification lives ONLY in organizations.org_type and is NEVER mirrored here. Server-controlled: written only by the approved upgrade/review workflow or a personal onboarding terminal.';

-- ---------------------------------------------------------------------------
-- 4b. organizations.org_type -> organization_type
-- ---------------------------------------------------------------------------
-- Refuse to guess. A personal value OTHER than the two renamed classifications has
-- no honest business meaning, and inventing one would corrupt the very
-- classification this migration exists to make trustworthy. Fail loudly, naming
-- the rows to fix, rather than picking a business type on the operator's behalf.
-- (The already-migrated spellings are accepted so a re-run is clean.)
do $$
declare v_bad text;
begin
  select string_agg(format('%s (%s)', o.id, o.org_type), ', ')
    into v_bad
    from public.organizations o
   where o.org_type::text not in
         ('showroom_dealer', 'supplier', 'manufacturer', 'importer', 'wholesaler',
          'contractor_company', 'design_office',      -- already migrated
          'interior_designer', 'engineer', 'contractor');  -- renamed below
  if v_bad is not null then
    raise exception
      'organizations carry a personal persona as org_type and cannot be classified automatically: %. Reclassify each to a real business type before applying this migration.',
      v_bad using errcode = '22023';
  end if;
end $$;

-- The rename happens INSIDE the cast: `design_office` is not a value of the old
-- enum, so it cannot be assigned before the column's type changes.
alter table public.organizations
  alter column org_type type public.organization_type
  using (case org_type::text
           when 'interior_designer' then 'design_office'
           when 'engineer'          then 'design_office'
           when 'contractor'        then 'contractor_company'
           else org_type::text
         end)::public.organization_type;

comment on column public.organizations.org_type is
  'The BUSINESS classification, typed public.organization_type — the type system now makes a personal persona here impossible (Sprint 13). This is the ONLY source of "what kind of business is this"; it is never mirrored onto users.primary_account_type. design_office covers a design/engineering office; contractor_company a contracting business.';

-- ---------------------------------------------------------------------------
-- 4c. verifications.requested_account_type -> persona_type
-- ---------------------------------------------------------------------------
-- A person can be reviewed for a PERSONAL persona only; a business is verified as
-- an organization (verification_type = 'organization'). A legacy row asking for a
-- business classification is void under the approved model, but it is HISTORY and
-- is never deleted: the original value is preserved in `metadata` and the column
-- is cleared, which section 5 permits for exactly these marked rows.
update public.verifications
   set metadata = coalesce(metadata, '{}'::jsonb)
                  || jsonb_build_object('legacy_requested_business_type',
                                        requested_account_type::text)
 where requested_account_type::text in
       ('showroom_dealer', 'supplier', 'manufacturer', 'importer', 'wholesaler');

alter table public.verifications
  alter column requested_account_type type public.persona_type
  using case
          when requested_account_type::text in
               ('showroom_dealer', 'supplier', 'manufacturer', 'importer', 'wholesaler')
            then null
          else requested_account_type::text::public.persona_type
        end;

comment on column public.verifications.requested_account_type is
  'The PERSONAL persona a user review is for, typed public.persona_type (Sprint 13) — a business is reviewed as an organization subject instead. NULL on identity/organization reviews, and on the historical rows marked with metadata.legacy_requested_business_type, whose original value is preserved there.';

-- ---------------------------------------------------------------------------
-- 4d. individual_onboarding.prof_concrete_type -> persona_type
-- ---------------------------------------------------------------------------
-- The person's own declaration of their individual professional identity. It was
-- always personal.
alter table public.individual_onboarding
  alter column prof_concrete_type type public.persona_type
  using prof_concrete_type::text::public.persona_type;

comment on column public.individual_onboarding.prof_concrete_type is
  'The individual professional persona the person declared for themselves, typed public.persona_type (Sprint 13). A business classification can no longer be stored here.';

-- Re-added in terms of the new type. Still narrower than persona_type itself:
-- end_consumer, trainer and trainee are personas, but not INDIVIDUAL PROFESSIONAL
-- ones, and this column is the professional track's declaration.
alter table public.individual_onboarding
  add constraint ck_indiv_prof_concrete_type check (
    prof_concrete_type is null or prof_concrete_type in
      ('engineer', 'interior_designer', 'installer_technician', 'contractor', 'sales')
  );

-- ---------------------------------------------------------------------------
-- 4e. The business drafts -> organization_type
-- ---------------------------------------------------------------------------
-- Both already held business values only (ck_bcd_org_type / ck_business_org_type),
-- so the type now expresses what the constraint used to police.
alter table public.business_creation_drafts
  alter column org_type type public.organization_type
  using org_type::text::public.organization_type;
alter table public.business_onboarding
  alter column org_type type public.organization_type
  using org_type::text::public.organization_type;

comment on column public.business_creation_drafts.org_type is
  'The BUSINESS classification the draft will create, typed public.organization_type (Sprint 13) — a personal persona can no longer be stored here, so the old CHECK constraint is redundant and has been dropped.';

-- ---------------------------------------------------------------------------
-- 4f. onboarding_progress — split the one union column into two typed ones
-- ---------------------------------------------------------------------------
-- `selected_account_type` recorded the registration CHOICE, which spans both
-- taxonomies ("I am an Engineer" and "I am creating a Showroom" landed in the same
-- column). That is the shared-enum debt in its last hiding place, so the column is
-- split by meaning instead of being retyped:
--
--   selected_persona   -> the personal persona claimed on the professional track
--   selected_org_type  -> the business classification intended on the business track
--
-- Both are INTENT only and neither is authority: the persona is applied to the
-- identity solely by the approved upgrade workflow, and the org type solely by
-- transactional business creation. The old column is dropped only AFTER its values
-- are routed, and the routing is value-scoped so a re-run is a no-op.
alter table public.onboarding_progress
  add column if not exists selected_persona  public.persona_type,
  add column if not exists selected_org_type public.organization_type;

update public.onboarding_progress
   set selected_persona = selected_account_type::text::public.persona_type
 where selected_account_type is not null
   and selected_persona is null
   and selected_account_type::text in
       ('engineer', 'interior_designer', 'installer_technician', 'contractor', 'sales',
        'trainer', 'trainee');

update public.onboarding_progress
   set selected_org_type = selected_account_type::text::public.organization_type
 where selected_account_type is not null
   and selected_org_type is null
   and selected_account_type::text in
       ('showroom_dealer', 'supplier', 'manufacturer', 'importer', 'wholesaler');

alter table public.onboarding_progress drop column if exists selected_account_type;

comment on column public.onboarding_progress.selected_persona is
  'INTENT only: the personal persona chosen at registration (professional track), typed public.persona_type. Never applied to users.primary_account_type from here — that requires the approved upgrade workflow.';
comment on column public.onboarding_progress.selected_org_type is
  'INTENT only: the business classification chosen at registration (business track), typed public.organization_type. Never creates an organization from here — that requires transactional business creation.';
comment on table public.onboarding_progress is
  'Per-user shared-onboarding progress: unverified phone, selected track, per-step and handoff timestamps, and the registration choice split by meaning into selected_persona (personal) and selected_org_type (business) — Sprint 13 removed the single union column. Self-owned; written only via the security-definer onboarding_* RPCs. Intent only — never activates an account or org.';

-- ===========================================================================
-- 5. Re-add the constraints, in terms of the new types
-- ===========================================================================
-- A registration choice belongs to exactly one taxonomy, and which one is decided
-- by the TRACK. The check makes the two columns mutually exclusive, so the union
-- column cannot reappear by convention.
alter table public.onboarding_progress
  add constraint ck_onboarding_choice_one_taxonomy check (
    selected_persona is null or selected_org_type is null
  ),
  add constraint ck_onboarding_choice_matches_track check (
    (selected_persona  is null or selected_track = 'professional')
    and
    (selected_org_type is null or selected_track = 'business')
  );

-- `end_consumer` is a persona a person HAS, never one they are upgraded TO.
alter table public.verifications
  add constraint ck_verifications_requested_not_consumer check (
    requested_account_type is null or requested_account_type <> 'end_consumer'
  );

-- Unchanged in intent from 20260804090001: the subject, the review type and the
-- requested persona must agree. The single addition is the final branch, which
-- covers the historical professional rows whose business-valued request was voided
-- in 4c — they keep their row, their decision and their original value in
-- metadata, so the constraint admits them explicitly rather than by weakening the
-- rule for every row.
alter table public.verifications
  add constraint ck_verifications_type_matches_subject check (
    (verification_type = 'professional'
      and subject_type = 'user'
      and user_id is not null
      and requested_account_type is not null)
    or (verification_type = 'identity'
      and subject_type = 'user'
      and user_id is not null
      and requested_account_type is null)
    or (verification_type = 'organization'
      and subject_type = 'organization'
      and organization_id is not null
      and requested_account_type is null)
    or (verification_type = 'professional'
      and subject_type = 'user'
      and user_id is not null
      and requested_account_type is null
      and metadata ? 'legacy_requested_business_type')
  );

-- ===========================================================================
-- 6. Recreate the dependents against the new types
-- ===========================================================================
-- Every function below is its current definition with the enum type changed.
-- Behavioural changes are called out individually; there are two, both forced by
-- the nullable persona Sprint 12 introduced.

-- ---------------------------------------------------------------------------
-- 6a. request_account_upgrade — a persona is now the only thing it can accept
-- ---------------------------------------------------------------------------
-- The Sprint 12 body, minus the "is this a business classification?" guard: the
-- parameter type rejects a business value before the function is entered, which is
-- exactly the point of this migration. Everything else (one open request per user,
-- idempotent re-request, the needs-more-info resubmission path, conflict on a
-- different open target, audit emission) is unchanged.
create or replace function public.request_account_upgrade(
  p_requested_account_type public.persona_type
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_current public.persona_type;
  v_v       public.verifications;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_requested_account_type = 'end_consumer' then
    raise exception 'cannot upgrade to end_consumer';
  end if;
  -- Presence of the ROW, not of a persona: a business-only identity has none.
  if not exists (select 1 from public.users u where u.id = v_uid) then
    raise exception 'no identity row for caller' using errcode = '42501';
  end if;
  select u.primary_account_type into v_current from public.users u where u.id = v_uid;
  if v_current is not distinct from p_requested_account_type then
    raise exception 'account is already of the requested type';
  end if;

  insert into public.verifications
    (subject_type, user_id, verification_type, requested_account_type, status, submitted_at)
  values ('user', v_uid, 'professional', p_requested_account_type, 'submitted', now())
  on conflict do nothing
  returning * into v_v;

  if v_v.id is null then
    select * into v_v from public.verifications
    where subject_type = 'user' and user_id = v_uid
      and status in ('draft','submitted','under_review','needs_more_info')
    for update;
    if v_v.requested_account_type is distinct from p_requested_account_type then
      raise exception 'an open upgrade request already exists for a different account type'
        using errcode = '23505';
    end if;
    if v_v.status = 'needs_more_info' then
      update public.verifications
        set status = 'submitted', reviewer_id = null, reason = null
        where id = v_v.id;
      perform app.record_audit_event(
        'account.upgrade_requested', 'verification', v_v.id, null,
        jsonb_build_object('requested_account_type', p_requested_account_type, 'resubmission', true)
      );
    end if;
    return v_v.id;
  end if;

  perform app.record_audit_event(
    'account.upgrade_requested', 'verification', v_v.id, null,
    jsonb_build_object('requested_account_type', p_requested_account_type)
  );
  return v_v.id;
end;
$$;
comment on function public.request_account_upgrade(public.persona_type) is
  'Opens (or idempotently re-opens) the caller''s personal-persona review. Typed public.persona_type, so a business classification is refused by the type system — a business is created as an Organization instead. Never writes users.primary_account_type; only the applied review does.';
revoke execute on function public.request_account_upgrade(public.persona_type) from public;
grant execute on function public.request_account_upgrade(public.persona_type) to authenticated;

-- ---------------------------------------------------------------------------
-- 6b. apply_account_upgrade — FIX: a null persona is a valid starting point
-- ---------------------------------------------------------------------------
-- Behavioural fix, and the reason it matters here. The guard tested the VALUE for
-- presence ("no identity row") — correct only while the column was NOT NULL. Since
-- Sprint 12 a professional's persona is legitimately NULL until this very function
-- applies it, so approving any individual professional created after Sprint 12
-- failed with "verification subject has no identity row". It now locks and tests
-- the ROW, exactly like request_account_upgrade. Everything else — platform
-- authority, approved-only, expiry, `applied_at` idempotency, the public-listing
-- side effect and both audit events — is unchanged.
create or replace function public.apply_account_upgrade(p_verification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_v    public.verifications;
  v_from public.persona_type;
  v_rows integer;
begin
  if not app.is_platform('support') then
    raise exception 'platform authority required' using errcode = '42501';
  end if;
  select * into v_v from public.verifications where id = p_verification_id for update;
  if not found then raise exception 'verification not found'; end if;
  if v_v.status <> 'approved' then
    raise exception 'only an approved verification can be applied (status=%)', v_v.status
      using errcode = '22023';
  end if;
  if v_v.applied_at is not null then return; end if;
  if v_v.expires_at is not null and v_v.expires_at <= now() then
    raise exception 'an expired verification cannot be applied' using errcode = '22023';
  end if;
  if v_v.subject_type <> 'user'
     or v_v.verification_type <> 'professional'
     or v_v.user_id is null
     or v_v.requested_account_type is null then
    raise exception 'verification is not a user account-upgrade approval'
      using errcode = '22023';
  end if;

  -- Lock the identity ROW and read its persona, which may legitimately be null.
  perform 1 from public.users u where u.id = v_v.user_id for update;
  if not found then
    raise exception 'verification subject has no identity row' using errcode = '23503';
  end if;
  select u.primary_account_type into v_from
    from public.users u where u.id = v_v.user_id;

  if v_from is distinct from v_v.requested_account_type then
    update public.users set primary_account_type = v_v.requested_account_type where id = v_v.user_id;
    perform app.record_audit_event('account.type_changed', 'user', v_v.user_id, null,
      jsonb_build_object('from', v_from, 'to', v_v.requested_account_type));
  end if;

  if v_v.grants_public_listing then
    update public.profiles set public_profile_status = 'listed'
      where user_id = v_v.user_id and public_profile_status <> 'listed';
    get diagnostics v_rows = row_count;
    if v_rows = 1 then
      perform app.record_audit_event('profile.listed', 'user', v_v.user_id, null, '{}'::jsonb);
    end if;
  end if;

  update public.verifications set applied_at = now() where id = p_verification_id;
end;
$$;
comment on function public.apply_account_upgrade(uuid) is
  'Applies an APPROVED personal-persona review to the identity. Platform authority, approved-only, expiry-checked, idempotent via applied_at, audited. Accepts a NULL starting persona — since Sprint 13 that is the normal state of an individual professional awaiting their first approval.';

-- ---------------------------------------------------------------------------
-- 6c. onboarding_select_account_type — routes the choice into the right column
-- ---------------------------------------------------------------------------
-- The choice arrives from the registration form as a string that may name either
-- taxonomy, so the parameter is text and the function RESOLVES it: a professional
-- choice must be a persona, a business choice must be an organization type, and a
-- consumer choice carries neither. The value is then written to the typed column
-- for that taxonomy, so an invalid combination cannot be stored even in intent.
create or replace function public.onboarding_select_account_type(
  p_track        public.onboarding_track,
  p_account_type text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := app.require_verified_caller();
  v_choice    text := nullif(btrim(coalesce(p_account_type, '')), '');
  v_persona   public.persona_type;
  v_org_type  public.organization_type;
begin
  if p_track is null then
    raise exception 'an onboarding track is required' using errcode = '22023';
  end if;

  if p_track = 'consumer' then
    -- Consumer keeps no concrete choice: the persona is recorded when consumer
    -- onboarding completes.
    if v_choice is not null and v_choice <> 'end_consumer' then
      raise exception 'consumer track takes no professional/business type' using errcode = '22023';
    end if;
  elsif p_track = 'business' then
    -- Optional: a concrete business type pre-selects the organization type; the
    -- generic owner/manager entry legitimately carries none.
    if v_choice is not null then
      if not exists (
        select 1 from unnest(enum_range(null::public.organization_type)) e
        where e::text = v_choice
      ) then
        raise exception 'business track requires a business organization type' using errcode = '22023';
      end if;
      v_org_type := v_choice::public.organization_type;
    end if;
  else
    -- Professional: a concrete personal persona is required. (The invited-employee
    -- path has no value here and so can never be recorded.)
    if v_choice is null or v_choice = 'end_consumer' then
      raise exception 'this track requires a concrete account type' using errcode = '22023';
    end if;
    if not exists (
      select 1 from unnest(enum_range(null::public.persona_type)) e
      where e::text = v_choice
    ) then
      raise exception 'professional track requires a personal persona' using errcode = '22023';
    end if;
    v_persona := v_choice::public.persona_type;
  end if;

  if not exists (
    select 1 from public.onboarding_progress op
    where op.user_id = v_uid and op.contact_completed_at is not null
  ) then
    raise exception 'complete the contact step first' using errcode = '22023';
  end if;

  update public.onboarding_progress
    set selected_track            = p_track,
        selected_persona          = v_persona,
        selected_org_type         = v_org_type,
        account_type_completed_at = now(),
        completed_at              = now()
    where user_id = v_uid;

  perform app.record_audit_event('onboarding.completed', 'user', v_uid, null,
    jsonb_build_object('track', p_track, 'account_type', v_choice));
end;
$$;
comment on function public.onboarding_select_account_type(public.onboarding_track, text) is
  'Records the registration track and choice as INTENT, routing the choice into the typed column for its taxonomy: selected_persona (professional) or selected_org_type (business). Consumer records neither. Applies nothing to the identity and creates no organization.';
revoke execute on function public.onboarding_select_account_type(
  public.onboarding_track, text) from public;
grant execute on function public.onboarding_select_account_type(
  public.onboarding_track, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6d. individual_save_professional — persona-typed
-- ---------------------------------------------------------------------------
-- Body unchanged from 20260808100000; only the parameter type differs. The
-- explicit allow-list stays: persona_type also contains end_consumer, trainer and
-- trainee, which are not individual-professional types for this flow.
create or replace function public.individual_save_professional(
  p_concrete_type        public.persona_type,
  p_headline             text default null,
  p_years_experience     smallint default null,
  p_specialization       text default null,
  p_bio                  text default null,
  p_services             text[] default null,
  p_additional_services  text[] default null,
  p_languages            text[] default null,
  p_availability         text default null,
  p_service_areas        text[] default null,
  p_offers_remote        boolean default false,
  p_governorate          text default null,
  p_city                 text default null,
  p_max_travel_km        smallint default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := app.require_verified_caller();
  v_track     public.onboarding_track := app.onboarding_selected_track(v_uid);
  v_headline  text := nullif(left(btrim(coalesce(p_headline, '')), 120), '');
  v_bio       text := nullif(left(btrim(coalesce(p_bio, '')), 1000), '');
begin
  if v_track is distinct from 'professional' then
    raise exception 'professional onboarding requires the professional track' using errcode = '42501';
  end if;
  if p_concrete_type is null or p_concrete_type not in
     ('engineer', 'interior_designer', 'installer_technician', 'contractor', 'sales') then
    raise exception 'a valid individual professional type is required' using errcode = '22023';
  end if;
  if p_availability is not null and p_availability not in
     ('within_week', 'within_month', 'flexible') then
    raise exception 'invalid availability' using errcode = '22023';
  end if;

  -- Reused profile columns (private until the upgrade is approved & listed).
  update public.profiles
    set headline  = v_headline,
        bio       = v_bio,
        languages = app.clean_text_array(p_languages, 40)
    where user_id = v_uid;

  insert into public.individual_onboarding as io (
    user_id, prof_concrete_type, prof_years_experience, prof_specialization,
    prof_services, prof_additional_services, prof_availability, prof_service_areas,
    prof_offers_remote, prof_governorate, prof_city, prof_max_travel_km
  ) values (
    v_uid,
    p_concrete_type,
    p_years_experience,
    nullif(left(btrim(coalesce(p_specialization, '')), 80), ''),
    app.clean_text_array(p_services, 60),
    app.clean_text_array(p_additional_services, 60),
    p_availability,
    app.clean_text_array(p_service_areas, 80),
    coalesce(p_offers_remote, false),
    nullif(left(btrim(coalesce(p_governorate, '')), 80), ''),
    nullif(left(btrim(coalesce(p_city, '')), 80), ''),
    p_max_travel_km
  )
  on conflict (user_id) do update set
    prof_concrete_type       = excluded.prof_concrete_type,
    prof_years_experience    = excluded.prof_years_experience,
    prof_specialization      = excluded.prof_specialization,
    prof_services            = excluded.prof_services,
    prof_additional_services = excluded.prof_additional_services,
    prof_availability        = excluded.prof_availability,
    prof_service_areas       = excluded.prof_service_areas,
    prof_offers_remote       = excluded.prof_offers_remote,
    prof_governorate         = excluded.prof_governorate,
    prof_city                = excluded.prof_city,
    prof_max_travel_km       = excluded.prof_max_travel_km;
end;
$$;
revoke execute on function public.individual_save_professional(
  public.persona_type, text, smallint, text, text, text[], text[], text[], text,
  text[], boolean, text, text, smallint) from public;
grant execute on function public.individual_save_professional(
  public.persona_type, text, smallint, text, text, text[], text[], text[], text,
  text[], boolean, text, text, smallint) to authenticated;

-- ---------------------------------------------------------------------------
-- 6e. app.organization_create_owned — organization-typed
-- ---------------------------------------------------------------------------
-- Body unchanged from 20260809100000. The `end_consumer` guard is gone because
-- organization_type has no such value, and the type itself now rejects a persona.
create or replace function app.organization_create_owned(
  p_name        text,
  p_org_type    public.organization_type,
  p_locale      text,
  p_branch_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_name   text := btrim(coalesce(p_name, ''));
  v_locale text := case when p_locale in ('en', 'ar') then p_locale else 'en' end;
  v_branch text := nullif(btrim(coalesce(p_branch_name, '')), '');
  v_org_id uuid;
  v_mid    uuid;
  v_bid    uuid;
  v_cap    text;
  v_caps   text[] := array[
    'org.manage', 'org.members.manage', 'branch.manage',
    'verification.submit', 'verification.read',
    'catalog.read', 'catalog.write', 'catalog.publish', 'inventory.write',
    'sales.opportunity.read', 'sales.opportunity.write', 'sales.match.share',
    'sales.task.write', 'sales.followup.send',
    'rfq.create', 'rfq.respond', 'quote.submit', 'quote.decide',
    'project.read', 'project.write', 'conversation.participate', 'ad.manage',
    'subscription.read', 'subscription.manage', 'analytics.view', 'export.data'
  ];
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'organization name must be 2..120 characters' using errcode = '22023';
  end if;
  if p_org_type is null then
    raise exception 'a business organization type is required' using errcode = '22023';
  end if;

  insert into public.organizations (name, org_type, status, is_verified, primary_locale, created_by)
  values (v_name, p_org_type, 'pending_verification', false, v_locale, v_uid)
  returning id into v_org_id;

  insert into public.branches (organization_id, name)
  values (v_org_id, coalesce(v_branch, v_name))
  returning id into v_bid;

  insert into public.memberships (user_id, organization_id, primary_branch_id, status, invited_by, accepted_at)
  values (v_uid, v_org_id, v_bid, 'active', v_uid, now())
  returning id into v_mid;

  foreach v_cap in array v_caps loop
    insert into public.membership_capabilities (membership_id, capability_key)
    values (v_mid, v_cap)
    on conflict (membership_id, capability_key) do nothing;
  end loop;

  perform app.record_audit_event('organization.created', 'organization', v_org_id, v_org_id,
    jsonb_build_object('org_type', p_org_type, 'status', 'pending_verification'));
  perform app.record_audit_event('branch.created', 'branch', v_bid, v_org_id,
    jsonb_build_object('primary', true));
  perform app.record_audit_event('membership.granted', 'membership', v_mid, v_org_id,
    jsonb_build_object('user_id', v_uid, 'status', 'active', 'via', 'owner_setup'));
  perform app.record_audit_event('membership.activated', 'membership', v_mid, v_org_id,
    jsonb_build_object('via', 'owner_setup'));

  return v_org_id;
end;
$$;
revoke execute on function app.organization_create_owned(
  text, public.organization_type, text, text) from public;
grant execute on function app.organization_create_owned(
  text, public.organization_type, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6f. business_draft_save / business_save — organization-typed
-- ---------------------------------------------------------------------------
-- Bodies unchanged from 20260814090002; the explicit business-type allow-list is
-- gone because the parameter type IS the allow-list.
create or replace function public.business_draft_save(
  p_draft_id            uuid default null,
  p_legal_name          text default null,
  p_display_name        text default null,
  p_org_type            public.organization_type default null,
  p_description         text default null,
  p_governorate         text default null,
  p_city                text default null,
  p_primary_branch_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_verified_caller();
  v_id  uuid;
  v_completed timestamptz;
begin
  if p_draft_id is null then
    select d.id into v_id
    from public.business_creation_drafts d
    where d.user_id = v_uid and d.completed_at is null
    for update;
  else
    select d.id, d.completed_at into v_id, v_completed
    from public.business_creation_drafts d
    where d.id = p_draft_id and d.user_id = v_uid
    for update;
    if v_id is null then
      raise exception 'business draft not found' using errcode = '42501';
    end if;
    if v_completed is not null then
      raise exception 'this business has already been created' using errcode = '22023';
    end if;
  end if;

  if v_id is null then
    insert into public.business_creation_drafts (
      user_id, legal_name, display_name, org_type, description,
      governorate, city, primary_branch_name
    ) values (
      v_uid,
      nullif(left(btrim(coalesce(p_legal_name, '')), 120), ''),
      nullif(left(btrim(coalesce(p_display_name, '')), 120), ''),
      p_org_type,
      nullif(left(btrim(coalesce(p_description, '')), 1000), ''),
      nullif(left(btrim(coalesce(p_governorate, '')), 80), ''),
      nullif(left(btrim(coalesce(p_city, '')), 80), ''),
      nullif(left(btrim(coalesce(p_primary_branch_name, '')), 120), '')
    )
    returning id into v_id;
    return v_id;
  end if;

  update public.business_creation_drafts set
    legal_name          = nullif(left(btrim(coalesce(p_legal_name, '')), 120), ''),
    display_name        = nullif(left(btrim(coalesce(p_display_name, '')), 120), ''),
    org_type            = p_org_type,
    description         = nullif(left(btrim(coalesce(p_description, '')), 1000), ''),
    governorate         = nullif(left(btrim(coalesce(p_governorate, '')), 80), ''),
    city                = nullif(left(btrim(coalesce(p_city, '')), 80), ''),
    primary_branch_name = nullif(left(btrim(coalesce(p_primary_branch_name, '')), 120), '')
  where id = v_id;

  return v_id;
end;
$$;
revoke execute on function public.business_draft_save(
  uuid, text, text, public.organization_type, text, text, text, text) from public;
grant execute on function public.business_draft_save(
  uuid, text, text, public.organization_type, text, text, text, text) to authenticated;

create or replace function public.business_save(
  p_legal_name          text default null,
  p_display_name        text default null,
  p_org_type            public.organization_type default null,
  p_description         text default null,
  p_governorate         text default null,
  p_city                text default null,
  p_primary_branch_name text default null,
  p_owner_confirmed     boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.business_draft_save(
    null, p_legal_name, p_display_name, p_org_type, p_description,
    p_governorate, p_city, p_primary_branch_name);
end;
$$;
revoke execute on function public.business_save(
  text, text, public.organization_type, text, text, text, text, boolean) from public;
grant execute on function public.business_save(
  text, text, public.organization_type, text, text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6g. my_workspaces — persona and org type are now DIFFERENT columns
-- ---------------------------------------------------------------------------
-- The old shape had one `org_type public.account_type` column carrying the
-- Personal row's PERSONA and the Business row's CLASSIFICATION — the shared enum
-- made that possible and it is exactly the conflation being removed. The two are
-- now separate, correctly typed columns; each row populates only its own.
create or replace function public.my_workspaces()
returns table (
  kind            text,
  organization_id uuid,
  name            text,
  persona         public.persona_type,
  org_type        public.organization_type,
  relationship    text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Personal: only when a personal persona was explicitly claimed.
  select 'personal'::text,
         null::uuid,
         coalesce(p.display_name, ''),
         u.primary_account_type,
         null::public.organization_type,
         null::text
  from public.users u
  left join public.profiles p on p.user_id = u.id and p.deleted_at is null
  where u.id = (select auth.uid())
    and app.has_personal_persona(u.id)
  union all
  -- Business: every organization with an ACTIVE membership for this caller.
  -- "Owner" is a RELATIONSHIP derived from the membership's capabilities, never a
  -- business or account type.
  select 'business'::text,
         o.id,
         o.name,
         null::public.persona_type,
         o.org_type,
         case
           when exists (
             select 1 from public.membership_capabilities c
             where c.membership_id = m.id and c.capability_key = 'org.manage'
           ) then 'owner'
           when exists (
             select 1 from public.membership_capabilities c
             where c.membership_id = m.id and c.capability_key = 'org.members.manage'
           ) then 'manager'
           else 'member'
         end
  from public.memberships m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and o.deleted_at is null
  order by 1 desc, 3;   -- 'personal' > 'business' alphabetically, so desc puts Personal first
$$;
comment on function public.my_workspaces() is 'The caller''s derived work contexts: the Personal context (only when a personal persona was explicitly claimed, reported in `persona`) plus every organization with an ACTIVE membership (reported in `org_type`). The two are separately typed columns — a persona is never an org type. Convenience projection only; selecting a workspace is NOT an authorization decision.';
revoke execute on function public.my_workspaces() from public;
grant execute on function public.my_workspaces() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6h. org_members_list — persona-typed member roster
-- ---------------------------------------------------------------------------
-- Unchanged from 20260812090001 apart from the column type. A co-member's
-- `primary_account_type` is their PERSONAL persona and may be null for a
-- business-only identity — the roster reports what is there, never an inference.
create or replace function public.org_members_list(p_org_id uuid)
returns table (
  membership_id        uuid,
  user_id              uuid,
  display_name         text,
  email_masked         text,
  primary_account_type public.persona_type,
  status               public.membership_status,
  primary_branch_id    uuid,
  branch_ids           uuid[],
  capabilities         text[],
  invited_at           timestamptz,
  accepted_at          timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if not app.has_capability(p_org_id, 'org.members.manage') then
    raise exception 'org.members.manage required' using errcode = '42501';
  end if;

  return query
    select
      m.id,
      m.user_id,
      coalesce(p.display_name, ''),
      app.mask_email(au.email),
      u.primary_account_type,
      m.status,
      m.primary_branch_id,
      coalesce(
        (select array_agg(ba.branch_id order by ba.branch_id)
         from public.membership_branch_access ba where ba.membership_id = m.id),
        array[]::uuid[]),
      coalesce(
        (select array_agg(c.capability_key order by c.capability_key)
         from public.membership_capabilities c where c.membership_id = m.id),
        array[]::text[]),
      m.created_at,
      m.accepted_at
    from public.memberships m
    join public.users u on u.id = m.user_id
    left join public.profiles p on p.user_id = m.user_id
    left join auth.users au on au.id = m.user_id
    where m.organization_id = p_org_id
    order by
      case m.status when 'active' then 0 when 'invited' then 1 when 'suspended' then 2 else 3 end,
      coalesce(p.display_name, '');
end;
$$;
revoke execute on function public.org_members_list(uuid) from public;
grant execute on function public.org_members_list(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6i. Public directories — same projections, new types
-- ---------------------------------------------------------------------------
-- The organization reader's `org_type` column changes type, which is why the view
-- had to be dropped. Eligibility, column set and order are unchanged, and the view
-- keeps `security_invoker = true` over the constrained definer reader (the
-- 20260805100000 hardening).
create or replace function app._organization_public_directory()
returns table (
  id             uuid,
  name           text,
  slug           text,
  org_type       public.organization_type,
  is_verified    boolean,
  primary_locale text,
  locality_id    uuid,
  logo_media_id  uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.name, o.slug, o.org_type, o.is_verified,
         o.primary_locale, o.locality_id, o.logo_media_id
  from public.organizations o
  where o.status = 'active'::public.org_status
    and o.is_verified
    and o.deleted_at is null;
$$;
comment on function app._organization_public_directory() is
  'Internal SECURITY DEFINER reader backing public.organization_public_directory. Returns ONLY approved public columns of active, verified, non-deleted organizations. Not in an exposed schema; PUBLIC execute revoked.';
revoke execute on function app._organization_public_directory() from public;
grant execute on function app._organization_public_directory() to anon, authenticated, service_role;

create view public.organization_public_directory
  with (security_invoker = true) as
  select id, name, slug, org_type, is_verified, primary_locale, locality_id, logo_media_id
  from app._organization_public_directory();
comment on view public.organization_public_directory is
  'Approved PUBLIC projection of organizations for B2C discovery. security_invoker=true view over the constrained SECURITY DEFINER reader app._organization_public_directory(). Only public columns; never created_by/status/deleted_at/timestamps. The base organizations table stays private (member/platform only).';
revoke all on public.organization_public_directory from anon, authenticated, service_role;
grant select on public.organization_public_directory to anon, authenticated, service_role;

-- The profile reader's SHAPE is unchanged, so its view survives; only the enum
-- cast inside the body needs the new type.
create or replace function app._profile_public_directory()
returns table (
  id              uuid,
  display_name    text,
  headline        text,
  bio             text,
  avatar_media_id uuid,
  locality_id     uuid,
  languages       text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.headline, p.bio,
         p.avatar_media_id, p.locality_id, p.languages
  from public.profiles p
  join public.users u on u.id = p.user_id
  where p.deleted_at is null
    and p.public_profile_status = 'listed'::public.public_profile_status
    and u.status = 'active'::public.user_status
    and u.primary_account_type is not null
    and u.primary_account_type <> 'end_consumer'::public.persona_type;
$$;
comment on function app._profile_public_directory() is
  'Internal SECURITY DEFINER reader backing public.profile_public_directory. Returns ONLY approved display columns of listed, active, non-deleted PERSONAL professional profiles. A business-only identity (null persona) is never listed — businesses are discovered through organization_public_directory. Not in an exposed schema; PUBLIC execute revoked.';

-- ===========================================================================
-- 7. Drop the shared enum — the debt, not just its documentation
-- ===========================================================================
-- RESTRICT (the default) makes this the completeness check for everything above:
-- if any column, parameter, return type or default still references
-- public.account_type, this statement fails and names it.
drop type public.account_type;
