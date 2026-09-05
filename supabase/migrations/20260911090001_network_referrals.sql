-- ===========================================================================
-- Installer Pilot Increment 13 (continued) — Network referrals
--
-- Foundation: 20260910090001_installer_network.sql (my_network_organizations,
--             the completed-work authority this migration does NOT touch)
--             20260815090002_showroom_affiliation.sql (organizations.source /
--             .referred_by_user_id, app.organizations_provenance_immutable)
--             20260830090001_points_core.sql (app.award_points,
--             referral.organization_approved — the ONE approved earning event)
--
-- WHY THIS IS A NEW TABLE AND NOT A REUSE OF organization_referrals /
-- organization_join_requests. Those two tables (Sprint 13) ARE a referral
-- system, but they are the SALES AFFILIATION system specifically:
-- 20260831090001_sales_affiliation_persona_hardening.sql closed them to any
-- caller who is not `app.is_sales_persona` — at draft, at submit and at the
-- membership-grant chokepoint itself — because their approval always ends
-- with the referrer holding a `sales.*` membership in the referred business.
-- An Installer referring a showroom they know is not becoming that showroom's
-- employee, so reusing that path would either be refused outright (correct
-- but useless) or would require reopening the exact hole that hardening
-- closed. §18's "another user cannot manage another user's referrals" and
-- §15's "organizations cannot become trusted simply because a professional
-- typed their name" are already the Sales system's own invariants; this
-- table restates them for a caller who must never receive `sales.*`.
--
-- ONE thing IS reused: the Points event. `showroom_referral_approve` already
-- established the pattern this migration's approval RPC copies exactly —
-- award only on a genuinely NEW organization, never on a link to one that
-- already existed, keyed off the organization's own write-once
-- `referred_by_user_id` so the amount can never be paid to whoever wrote
-- last.
--
-- TWO CASES, ONE TABLE, NEVER MERGED:
--   A. an organization ALREADY on Aladdin — resolves the instant it is
--      created (status starts and stays 'joined'; there is nothing to
--      review), zero Points (the brief is explicit: an existing organization
--      was not brought here by this referral).
--   B. a showroom NOT YET on Aladdin — pure referral DATA (name, area,
--      phone) until a platform reviewer approves it, at which point it
--      becomes a real, unowned `organizations` row exactly the way a Sales
--      referral does, and the referrer earns the one approved Points event.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Lifecycle
-- ---------------------------------------------------------------------------
create type public.network_referral_status as enum ('pending', 'joined', 'cancelled');
comment on type public.network_referral_status is
  'pending: a not-yet-registered showroom awaiting platform review. joined: either case A the instant it is created, or case B once approved and linked to a real organization. cancelled: withdrawn by the referrer or invalidated by the platform — a terminal negative with no organization attached.';

-- Recorded at creation and NEVER inferred afterwards. Without it, "was this
-- always a known organization, or a candidate that got linked to one" is
-- unanswerable once both end up with organization_id set — and the two are
-- different facts: one never needed review, the other did.
create type public.network_referral_origin as enum ('known_organization', 'new_showroom');
comment on type public.network_referral_origin is
  'How the referral started. known_organization: case A, resolves to joined immediately. new_showroom: case B, starts pending and may later be linked to an existing organization by a reviewer — which still leaves its origin as new_showroom, because that is what the REFERRAL was, not what it turned out to be.';

-- ---------------------------------------------------------------------------
-- 2. Widen organization provenance — a THIRD source, not a second scheme
-- ---------------------------------------------------------------------------
-- app.organizations_provenance_immutable() already guards ANY non-null
-- referred_by_user_id generically (it does not branch on which source wrote
-- it), so admitting this value needs no change there.
alter table public.organizations drop constraint ck_organizations_source;
alter table public.organizations add constraint ck_organizations_source check (
  source in ('self_created', 'salesperson_referral', 'installer_referral')
);
alter table public.organizations drop constraint ck_organizations_referral_attribution;
alter table public.organizations add constraint ck_organizations_referral_attribution check (
  (source <> 'self_created') = (referred_by_user_id is not null)
);
comment on column public.organizations.source is
  'How this business came to exist: self_created, salesperson_referral (Sales affiliation, Sprint 13) or installer_referral (Network referral, Installer Pilot Increment 13). Write-once — see app.organizations_provenance_immutable().';

-- ---------------------------------------------------------------------------
-- 3. public.network_referrals
-- ---------------------------------------------------------------------------
create table public.network_referrals (
  id              uuid primary key default extensions.gen_random_uuid(),

  -- The referrer. Always auth.uid() inside the write paths — never accepted
  -- as a parameter, so another user's id cannot reach this column (§15/§18).
  referred_by     uuid not null references public.users (id) on delete cascade,

  -- Set at creation, never changes. The structural answer to "which case is
  -- this", so nothing downstream has to infer it from column nullability.
  origin          public.network_referral_origin not null,

  -- CASE A: an organization already on Aladdin. Write-once (guarded below).
  organization_id uuid references public.organizations (id) on delete cascade,

  -- CASE B: referral DATA only — never a trusted organization record (§2 of
  -- the brief). Deliberately the same practical Pilot fields
  -- organization_referrals collects, and nothing more: no CRM stage, no
  -- assigned owner, no lead score.
  display_name    text,
  governorate     text,
  city            text,
  phone           text,
  note            text,

  status          public.network_referral_status not null default 'pending',

  decided_by      uuid references public.users (id) on delete set null,
  decided_at      timestamptz,
  decision_reason text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- A row always names SOMETHING — a known organization or a candidate name.
  -- Not mutually exclusive forever: a case-B row keeps its original candidate
  -- name/location/phone as historical context even after approval sets
  -- organization_id to what it became, which is a feature — "this is what
  -- was referred, and here is the real organization it turned out to be" —
  -- not a violation of the two-cases distinction.
  constraint ck_netref_shape check (
    organization_id is not null or display_name is not null
  ),
  -- known_organization NAMES the organization from the moment it exists —
  -- there is no candidate name to hold. new_showroom always has one; whether
  -- it ALSO gains organization_id later (via approval) is independent of
  -- this check, which is why this reads display_name rather than origin.
  constraint ck_netref_origin_shape check (
    origin <> 'known_organization' or (organization_id is not null and display_name is null)
  ),
  constraint ck_netref_display_len check (display_name is null or char_length(display_name) between 2 and 120),
  constraint ck_netref_gov_len     check (governorate is null or char_length(governorate) <= 80),
  constraint ck_netref_city_len    check (city is null or char_length(city) <= 80),
  constraint ck_netref_phone_len   check (phone is null or char_length(phone) <= 32),
  constraint ck_netref_note_len    check (note is null or char_length(note) <= 500),
  constraint ck_netref_reason_len  check (decision_reason is null or char_length(decision_reason) <= 500),
  -- CASE A resolves the instant it exists — there is nothing to review, so it
  -- is never 'pending'. CASE B always starts 'pending'.
  constraint ck_netref_case_a_status check (organization_id is null or status <> 'pending'),
  -- A decided row (joined or cancelled) is stamped; a pending one is not.
  constraint ck_netref_decision_stamp check (
    (status = 'pending' and decided_at is null)
    or (status <> 'pending' and decided_at is not null)
  )
);

comment on table public.network_referrals is
  'An installer/professional referring a showroom — either one already on Aladdin (case A: organization_id set, resolves to joined immediately, zero Points) or one that is not (case B: referral data only, pending platform review, exactly the approved referral.organization_approved Points event on approval). NOT the Sales affiliation system (organization_referrals/organization_join_requests) — this never grants sales.* or any membership. No client DML: every row is written by a security-definer RPC that derives the actor from auth.uid().';
comment on column public.network_referrals.phone is
  'The referrer''s OWN typed contact for a case-B showroom. Never an organization''s private data — the organization does not exist as a trusted record yet, and no organizations.phone column exists in this schema at all (§ Call/Message, increment brief).';

create index ix_netref_referrer on public.network_referrals (referred_by, status);
create index ix_netref_status   on public.network_referrals (status, created_at) where status = 'pending';
create index ix_netref_org      on public.network_referrals (organization_id) where organization_id is not null;

-- Case A: one referral row per (referrer, known organization) — the
-- narrowest reliable identity there is for "I already told you about this
-- one" (§2/§18 duplicate-abuse guard). Scoped to origin = 'known_organization'
-- rather than "organization_id is not null": a case-B referral that a
-- reviewer later LINKS to an organization the referrer already directly
-- referred is a different fact (a candidate turning out to be that
-- business) from referring the same known organization twice, and the two
-- must be able to coexist without colliding on this index.
create unique index uq_netref_known_org_per_referrer
  on public.network_referrals (referred_by, organization_id)
  where origin = 'known_organization';

-- Case B: one OPEN referral per (referrer, normalised name) — the narrowest
-- reliable identity available before a real organization record exists.
-- Decided rows are unconstrained, so a cancelled or approved referral does
-- not block a fresh, better-described one under the same name later.
create unique index uq_netref_pending_name_per_referrer
  on public.network_referrals (referred_by, lower(btrim(display_name)))
  where status = 'pending';

create trigger set_netref_updated_at
  before update on public.network_referrals
  for each row execute function app.set_updated_at();

-- organization_id is write-once, exactly like organizations.referred_by_user_id:
-- attribution that can be edited is attribution that can be stolen. origin is
-- write-once too — it is the historical fact of how the referral started.
create or replace function app.network_referrals_org_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.organization_id is not null
     and new.organization_id is distinct from old.organization_id then
    raise exception 'a network referral''s organization cannot be reassigned once set'
      using errcode = '23514';
  end if;
  if new.origin is distinct from old.origin then
    raise exception 'a network referral''s origin cannot change once recorded'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function app.network_referrals_org_immutable() from public;

create trigger network_referrals_org_immutable
  before update on public.network_referrals
  for each row execute function app.network_referrals_org_immutable();

-- ---------------------------------------------------------------------------
-- 4. Audit vocabulary
-- ---------------------------------------------------------------------------
alter table public.audit_log drop constraint ck_audit_action_known;
alter table public.audit_log add constraint ck_audit_action_known check (action in (
  'organization.created',
  'membership.granted', 'membership.activated', 'membership.role_changed',
  'membership.suspended', 'membership.revoked',
  'branch.created', 'branch.assignment_changed',
  'platform_role.granted', 'platform_role.revoked', 'platform.override_used',
  'account.upgrade_requested',
  'verification.review_started', 'verification.changes_requested',
  'verification.approved', 'verification.rejected',
  'account.type_changed', 'profile.listed', 'profile.hidden',
  'customer.created', 'customer.updated',
  'lead.created', 'lead.assigned', 'lead.reassigned', 'lead.stage_changed',
  'lead.won', 'lead.lost', 'lead.reopened', 'lead.archived',
  'followup.created', 'followup.reassigned', 'followup.completed', 'followup.reopened',
  'customer.reassigned', 'lead.details_changed',
  'onboarding.completed',
  'onboarding.consumer_completed', 'onboarding.professional_submitted',
  'onboarding.organization_created',
  'product.created', 'product.updated', 'product.published', 'product.unpublished',
  'rfq.created', 'rfq.submitted', 'rfq.updated', 'rfq.cancelled', 'rfq.closed',
  'quotation.created', 'quotation.updated', 'quotation.submitted',
  'quotation.accepted', 'quotation.rejected',
  'order.created', 'order.started', 'order.completed', 'order.cancelled',
  'project.created', 'project.activated', 'project.completed',
  'organization.verified',
  'affiliation.requested', 'affiliation.cancelled',
  'affiliation.approved', 'affiliation.rejected',
  'referral.submitted', 'referral.approved', 'referral.rejected',
  'conversation.opened',
  'points.adjusted', 'points.reversed',
  'job.created', 'job.updated', 'job.published', 'job.closed', 'job.cancelled',
  'job.application.submitted', 'job.application.withdrawn',
  'job.application.accepted', 'job.application.rejected',
  'job.assignment.started', 'job.assignment.progress_updated',
  'job.assignment.completed', 'job.assignment.cancelled',
  'job.review.submitted', 'job.review.suppressed', 'job.review.restored',
  -- Increment 13 (continued) — Network referrals. Distinct verbs from the
  -- Sales 'referral.*'/'affiliation.*' family above so an audit reader never
  -- confuses which system produced a row.
  'network_referral.submitted', 'network_referral.joined',
  'network_referral.approved', 'network_referral.rejected', 'network_referral.cancelled'
));

-- ---------------------------------------------------------------------------
-- 5. RLS and grants — self read, platform read, no client DML
-- ---------------------------------------------------------------------------
revoke all on public.network_referrals from anon, authenticated, service_role;
alter table public.network_referrals enable row level security;

create policy netref_select_self on public.network_referrals
  for select to authenticated
  using (referred_by = (select auth.uid()));

create policy netref_select_platform on public.network_referrals
  for select to authenticated
  using (app.is_platform('support'));

-- Deliberately ABSENT: any policy keyed on organization_id / org membership.
-- A showroom manager must not learn who referred them, their phone, or their
-- note by being a member of the organization the referral points to (§15).

grant select on public.network_referrals to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Create — case A (known organization), resolves immediately
-- ---------------------------------------------------------------------------
create or replace function public.network_referral_create_existing(
  p_organization_id uuid,
  p_note            text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_verified_caller();
  v_id  uuid;
begin
  if not app.is_professional_persona(v_uid) then
    raise exception 'a personal professional account is required to refer a showroom'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organizations o
    where o.id = p_organization_id and o.deleted_at is null
  ) then
    raise exception 'organization not found' using errcode = '22023';
  end if;

  -- IDEMPOTENT: referring the same known organization twice returns the row
  -- that already exists rather than raising or duplicating. Scoped to this
  -- RPC's own origin, matching uq_netref_known_org_per_referrer — a case-B
  -- candidate that a reviewer separately linked to this same organization is
  -- a different fact and must not be returned here.
  select r.id into v_id from public.network_referrals r
  where r.referred_by = v_uid and r.organization_id = p_organization_id
    and r.origin = 'known_organization';
  if v_id is not null then
    return v_id;
  end if;

  insert into public.network_referrals (referred_by, origin, organization_id, status, decided_at, note)
  values (v_uid, 'known_organization', p_organization_id, 'joined', now(),
          nullif(left(btrim(coalesce(p_note, '')), 500), ''))
  returning id into v_id;

  perform app.record_audit_event('network_referral.joined', 'network_referral', v_id,
    p_organization_id, jsonb_build_object('case', 'existing_organization'));
  return v_id;
end;
$$;
comment on function public.network_referral_create_existing(uuid, text) is
  'Referring an organization ALREADY on Aladdin. Resolves to joined the instant it is created — there is nothing to review — and earns NO Points: the organization was not brought to Aladdin by this referral. Idempotent per (referrer, organization).';
revoke execute on function public.network_referral_create_existing(uuid, text) from public;
grant execute on function public.network_referral_create_existing(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Create — case B (not-yet-registered showroom), pending platform review
-- ---------------------------------------------------------------------------
create or replace function public.network_referral_create_new(
  p_display_name text,
  p_governorate  text,
  p_city         text,
  p_phone        text default null,
  p_note         text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := app.require_verified_caller();
  v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_gov  text := nullif(btrim(coalesce(p_governorate, '')), '');
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_id   uuid;
begin
  if not app.is_professional_persona(v_uid) then
    raise exception 'a personal professional account is required to refer a showroom'
      using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) < 2 then
    raise exception 'the showroom name is required' using errcode = '22023';
  end if;
  if v_gov is null or v_city is null then
    raise exception 'the showroom location is required' using errcode = '22023';
  end if;

  -- IDEMPOTENT / DUPLICATE-ABUSE GUARD IN ONE MECHANISM: an open referral
  -- under the same normalised name from the same referrer is returned
  -- unchanged rather than duplicated — the same shape job_application_submit
  -- and showroom_referral_save already use.
  select r.id into v_id from public.network_referrals r
  where r.referred_by = v_uid and r.status = 'pending'
    and lower(btrim(r.display_name)) = lower(v_name);
  if v_id is not null then
    return v_id;
  end if;

  insert into public.network_referrals (
    referred_by, origin, display_name, governorate, city, phone, note)
  values (
    v_uid, 'new_showroom', v_name, v_gov, v_city,
    nullif(left(btrim(coalesce(p_phone, '')), 32), ''),
    nullif(left(btrim(coalesce(p_note, '')), 500), ''))
  returning id into v_id;

  perform app.record_audit_event('network_referral.submitted', 'network_referral', v_id, null,
    jsonb_build_object('display_name', v_name, 'governorate', v_gov, 'city', v_city));
  return v_id;
end;
$$;
comment on function public.network_referral_create_new(text, text, text, text, text) is
  'Referring a showroom NOT YET on Aladdin. Creates NO organization and grants NO access — pure referral data, pending platform review. Practical Pilot fields only: name, location, an optional phone the REFERRER themselves supplies, and an optional note. Idempotent per (referrer, normalised name) while pending.';
revoke execute on function public.network_referral_create_new(text, text, text, text, text) from public;
grant execute on function public.network_referral_create_new(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Cancel — the referrer's own pending (case B) referral
-- ---------------------------------------------------------------------------
create or replace function public.network_referral_cancel(p_referral_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_verified_caller();
  v_r   public.network_referrals;
begin
  select * into v_r from public.network_referrals r
  where r.id = p_referral_id and r.referred_by = v_uid
  for update;
  if not found then
    raise exception 'referral not found' using errcode = '42501';
  end if;
  if v_r.status <> 'pending' then
    return; -- already decided; withdrawing again is a no-op, not an error
  end if;

  update public.network_referrals
     set status = 'cancelled', decided_at = now(), decided_by = v_uid
   where id = p_referral_id;

  perform app.record_audit_event('network_referral.cancelled', 'network_referral',
    p_referral_id, null, jsonb_build_object('by', 'referrer'));
end;
$$;
revoke execute on function public.network_referral_cancel(uuid) from public;
grant execute on function public.network_referral_cancel(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. The referrer's own read model
-- ---------------------------------------------------------------------------
create function app._my_network_referrals()
returns table (
  id                 uuid,
  origin             public.network_referral_origin,
  organization_id    uuid,
  organization_name  text,
  display_name       text,
  governorate        text,
  city               text,
  phone              text,
  note               text,
  status             public.network_referral_status,
  decision_reason    text,
  created_at         timestamptz,
  decided_at         timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.origin, r.organization_id, o.name, r.display_name, r.governorate, r.city,
         r.phone, r.note, r.status, r.decision_reason, r.created_at, r.decided_at
  from public.network_referrals r
  left join public.organizations o on o.id = r.organization_id
  where r.referred_by = (select auth.uid())
    and (select auth.uid()) is not null
  order by case r.status when 'pending' then 0 when 'joined' then 1 else 2 end,
           r.created_at desc;
$$;
comment on function app._my_network_referrals() is
  'Internal SECURITY DEFINER reader backing public.my_network_referrals. The caller''s own referrals, case A joined with the organization''s public name (RLS on organizations would otherwise hide it from a non-member), case B carrying its own referral data. origin is the structural case marker — never inferred from column nullability. Scoped to auth.uid() with no parameter.';

revoke execute on function app._my_network_referrals() from public;
grant  execute on function app._my_network_referrals() to authenticated, service_role;

create view public.my_network_referrals with (security_invoker = true) as
  select id, origin, organization_id, organization_name, display_name, governorate, city,
         phone, note, status, decision_reason, created_at, decided_at
  from app._my_network_referrals();

comment on view public.my_network_referrals is
  'The caller''s own referrals — organizations already on Aladdin (joined immediately) and not-yet-registered showrooms (pending platform review). Never another user''s referral, never an organization''s internal data, never exposed to that organization''s members.';

revoke all on public.my_network_referrals from anon, authenticated, service_role;
grant select on public.my_network_referrals to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. Platform review of a pending (case B) referral
-- ---------------------------------------------------------------------------

-- 10a. Approve — link to an existing organization, or materialise a new one
-- with NO membership for the referrer (the Sales-referral precedent, minus
-- the membership grant this domain must never make).
create or replace function public.network_referral_approve(
  p_referral_id          uuid,
  p_link_organization_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := (select auth.uid());
  v_r           public.network_referrals;
  v_org_id      uuid;
  v_bid         uuid;
  v_locale      text;
  v_points_user uuid;
begin
  if not app.is_platform('support') then
    raise exception 'platform authority required' using errcode = '42501';
  end if;

  select * into v_r from public.network_referrals r
  where r.id = p_referral_id
  for update;
  if not found then
    raise exception 'referral not found' using errcode = '22023';
  end if;

  -- IDEMPOTENT: an already-joined referral returns its organization,
  -- structurally unable to duplicate a business or double-award (the
  -- organization_id is already set and Points already resolved).
  if v_r.status = 'joined' then
    return v_r.organization_id;
  end if;
  if v_r.status <> 'pending' then
    raise exception 'only a pending referral can be approved (status=%)', v_r.status
      using errcode = '22023';
  end if;

  if p_link_organization_id is not null then
    select o.id into v_org_id from public.organizations o
    where o.id = p_link_organization_id and o.deleted_at is null
    for update;
    if v_org_id is null then
      raise exception 'the organization to link does not exist' using errcode = '22023';
    end if;
  else
    select u.locale into v_locale from public.users u where u.id = v_r.referred_by;
    insert into public.organizations
      (name, org_type, status, is_verified, primary_locale, created_by,
       source, referred_by_user_id)
    values (btrim(v_r.display_name), 'showroom_dealer', 'pending_verification', false,
            case when v_locale in ('en', 'ar') then v_locale else 'en' end, v_actor,
            'installer_referral', v_r.referred_by)
    returning id into v_org_id;

    insert into public.branches (organization_id, name)
    values (v_org_id, btrim(v_r.display_name))
    returning id into v_bid;

    perform app.record_audit_event('organization.created', 'organization', v_org_id, v_org_id,
      jsonb_build_object('org_type', 'showroom_dealer', 'status', 'pending_verification',
                         'source', 'installer_referral',
                         'referred_by', v_r.referred_by, 'referral_id', v_r.id));
    perform app.record_audit_event('branch.created', 'branch', v_bid, v_org_id,
      jsonb_build_object('primary', true));
  end if;

  update public.network_referrals
     set status = 'joined', organization_id = v_org_id,
         decided_by = v_actor, decided_at = now()
   where id = p_referral_id;

  perform app.record_audit_event('network_referral.approved', 'network_referral',
    p_referral_id, v_org_id,
    jsonb_build_object('organization_id', v_org_id,
                       'resolution', case when p_link_organization_id is not null
                                          then 'linked_existing' else 'created' end,
                       'referred_by', v_r.referred_by));

  -- ---- Points: the ONE approved earning event, exactly the Sales-referral
  -- precedent. Awarded ONLY when a genuinely new organization was created —
  -- never on the linking path — and read back from the organization's own
  -- write-once provenance, never from this request.
  select o.referred_by_user_id into v_points_user
  from public.organizations o
  where o.id = v_org_id
    and o.source = 'installer_referral'
    and o.referred_by_user_id is not null;

  if v_points_user is not null then
    perform app.award_points(
      p_user_id         => v_points_user,
      p_organization_id => v_org_id,
      p_event_type      => 'referral.organization_approved',
      p_source_type     => 'organization',
      p_source_id       => v_org_id,
      p_points_delta    => 100
    );
  end if;

  return v_org_id;
end;
$$;
comment on function public.network_referral_approve(uuid, uuid) is
  'Platform approval of a pending Network referral. Links to an existing organization when the reviewer names one (no Points — it already existed), otherwise materialises a new, UNOWNED organization + primary branch with installer_referral provenance and awards the referrer the approved referral.organization_approved event (+100, via app.award_points, which is itself idempotent on (user, event, organization)). The referrer receives NO membership, NO capability and NO access to the organization — a Network referral is attribution, never employment.';
revoke execute on function public.network_referral_approve(uuid, uuid) from public;
grant execute on function public.network_referral_approve(uuid, uuid) to authenticated;

-- 10b. Reject — a pending referral that should not proceed.
create or replace function public.network_referral_reject(
  p_referral_id uuid,
  p_reason      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_r      public.network_referrals;
begin
  if not app.is_platform('support') then
    raise exception 'platform authority required' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'a reason is required to reject a referral' using errcode = '22023';
  end if;

  select * into v_r from public.network_referrals r
  where r.id = p_referral_id
  for update;
  if not found then
    raise exception 'referral not found' using errcode = '22023';
  end if;
  if v_r.status = 'cancelled' then
    return;
  end if;
  if v_r.status <> 'pending' then
    raise exception 'only a pending referral can be rejected (status=%)', v_r.status
      using errcode = '22023';
  end if;

  update public.network_referrals
     set status = 'cancelled', decision_reason = left(v_reason, 500),
         decided_by = (select auth.uid()), decided_at = now()
   where id = p_referral_id;

  perform app.record_audit_event('network_referral.rejected', 'network_referral',
    p_referral_id, null,
    jsonb_build_object('referred_by', v_r.referred_by, 'display_name', v_r.display_name));
end;
$$;
revoke execute on function public.network_referral_reject(uuid, text) from public;
grant execute on function public.network_referral_reject(uuid, text) to authenticated;
