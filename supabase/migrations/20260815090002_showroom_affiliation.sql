-- Migration: a Salesperson's AFFILIATION with a Showroom (Sprint 13, parts B-G).
--
-- The Pilot rule this implements:
--
--   A Salesperson has a usable personal Aladdin account IMMEDIATELY. The Sales /
--   B2B tools of a showroom require an ACTIVE affiliation WITH that showroom.
--
-- Those are separate states and nothing here merges them. Account activation,
-- profile completeness, personal verification, showroom verification and showroom
-- affiliation each move on their own; a pending affiliation is not a locked
-- account, and verification is not an access gate anywhere in this file.
--
-- Two paths, because a salesperson is in one of two situations:
--
--   1. THE SHOWROOM IS ON ALADDIN  -> public.organization_join_requests
--      They find it, ask to join, and an authorized Owner/Manager of THAT
--      organization decides — through the org's existing People Ops surface and
--      the existing `org.members.manage` capability. No second permission system.
--
--   2. THE SHOWROOM IS NOT ON ALADDIN -> public.organization_referrals
--      They REFER the business they work for. This is emphatically not the
--      "Add Business" owner flow: the salesperson does not become Owner, no
--      organization is created on submit, and an Admin reviews the candidate
--      through the existing verification architecture.
--
-- Neither path ever creates a second USER, and path 1 never creates an
-- organization at all.
--
-- WHAT A REQUEST IS NOT: a request grants nothing. Until it is approved the
-- organization does not appear in `my_workspaces()`, so it is not a workspace, and
-- every B2B read/write still re-checks active membership, capability, branch scope
-- and RLS independently. Approval routes through the same trusted membership path
-- an invitation uses.
--
-- FUTURE POINTS (part G): no wallet, no balance, no leaderboard and no reward
-- calculation exists here. Only the PROVENANCE a future reward would need:
-- `organizations.referred_by_user_id` + `organizations.source`, write-once by
-- trigger, plus the immutable referral record itself. "Which salesperson referred
-- this showroom?" is answerable by one query, forever.

-- ===========================================================================
-- 1. Statuses
-- ===========================================================================
create type public.affiliation_request_status as enum (
  'pending', 'approved', 'rejected', 'cancelled'
);
comment on type public.affiliation_request_status is
  'Lifecycle of a salesperson''s request to join an existing organization. `cancelled` is withdrawal by the requester; `rejected` is a decision by an authorized Owner/Manager.';

create type public.referral_status as enum (
  'draft', 'submitted', 'approved', 'rejected'
);
comment on type public.referral_status is
  'Lifecycle of a referred BUSINESS CANDIDATE. `draft` is resumable and private to the referrer; `submitted` is awaiting Admin review; `approved` means an organization was linked or created.';

-- ===========================================================================
-- 2. organization_join_requests — "I work at this showroom, let me in"
-- ===========================================================================
create table public.organization_join_requests (
  id                  uuid primary key default extensions.gen_random_uuid(),
  -- The requester. Always the authenticated caller: every write path derives this
  -- from auth.uid() and the column is never accepted from a client.
  user_id             uuid not null references public.users (id) on delete cascade,
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  -- The branch the salesperson says they work at. Optional: a single-branch
  -- showroom needs no choice, and the approver may override it.
  requested_branch_id uuid references public.branches (id) on delete set null,
  note                text,

  status              public.affiliation_request_status not null default 'pending',

  -- The RESULT. Set only by approval, and it is the idempotency anchor: an
  -- already-approved request returns this membership instead of granting again.
  membership_id       uuid references public.memberships (id) on delete set null,
  decided_by          uuid references public.users (id) on delete set null,
  decided_at          timestamptz,
  decision_reason     text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint ck_ojr_note_len   check (note is null or char_length(note) <= 500),
  constraint ck_ojr_reason_len check (decision_reason is null or char_length(decision_reason) <= 500),
  -- A pending request carries no decision; a decided one is stamped.
  constraint ck_ojr_decision_stamp check (
    (status = 'pending' and decided_at is null and decided_by is null)
    or (status <> 'pending' and decided_at is not null)
  ),
  -- A rejection must say why — the salesperson is shown this, and "no" without a
  -- reason is not a reviewable decision.
  constraint ck_ojr_reject_reason check (
    status <> 'rejected' or (decision_reason is not null and char_length(btrim(decision_reason)) > 0)
  ),
  -- A membership exists exactly when the request was approved.
  constraint ck_ojr_membership_only_approved check (
    (membership_id is not null) = (status = 'approved')
  )
);
comment on table public.organization_join_requests is
  'A salesperson''s request to be affiliated with an EXISTING organization (Sprint 13). It is a REQUEST, never an authorization: no membership, capability or workspace follows from a row here. Decided by an Owner/Manager of that organization holding org.members.manage — the same capability that runs People Ops. Self-owned reads; every write goes through the security-definer RPCs.';

create index ix_ojr_organization on public.organization_join_requests (organization_id, status);
create index ix_ojr_user on public.organization_join_requests (user_id, status);
-- One OPEN request per person per organization, so a double-tapped button (or an
-- impatient salesperson) cannot fan out into a queue of duplicates for the
-- approver to wade through. Decided rows are unconstrained: a rejection may be
-- followed by a fresh, better-explained request.
create unique index uq_ojr_open_per_user_org
  on public.organization_join_requests (user_id, organization_id)
  where status = 'pending';

create trigger set_ojr_updated_at
  before update on public.organization_join_requests
  for each row execute function app.set_updated_at();

-- ===========================================================================
-- 3. organization_referrals — "my showroom isn't here yet"
-- ===========================================================================
-- The candidate's field set is deliberately IDENTICAL to
-- `business_creation_drafts`: it is the same business information the platform
-- already asks for, including the minimum location the schema uses, so a referred
-- showroom can be materialised through the same trusted path with nothing missing
-- and nothing extra collected.
create table public.organization_referrals (
  id                  uuid primary key default extensions.gen_random_uuid(),
  -- The referring salesperson. This is the ATTRIBUTION and it never changes.
  referred_by         uuid not null references public.users (id) on delete cascade,

  legal_name          text,
  display_name        text,
  org_type            public.organization_type not null default 'showroom_dealer',
  description         text,
  governorate         text,
  city                text,
  primary_branch_name text,

  status              public.referral_status not null default 'draft',

  -- The RESULT: the organization this candidate turned out to BE — whether it was
  -- linked to one that already existed or created on approval. Also the
  -- idempotency anchor: an approved referral returns this id and can never
  -- produce a second business.
  organization_id     uuid references public.organizations (id) on delete set null,
  -- The affiliation the approval produced, so the salesperson's relationship has
  -- ONE representation regardless of which path created it.
  join_request_id     uuid references public.organization_join_requests (id) on delete set null,
  reviewed_by         uuid references public.users (id) on delete set null,
  reviewed_at         timestamptz,
  decision_reason     text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint ck_ref_legal_len   check (legal_name is null or char_length(legal_name) <= 120),
  constraint ck_ref_display_len check (display_name is null or char_length(display_name) <= 120),
  constraint ck_ref_desc_len    check (description is null or char_length(description) <= 1000),
  constraint ck_ref_gov_len     check (governorate is null or char_length(governorate) <= 80),
  constraint ck_ref_city_len    check (city is null or char_length(city) <= 80),
  constraint ck_ref_branch_len  check (primary_branch_name is null or char_length(primary_branch_name) <= 120),
  constraint ck_ref_reason_len  check (decision_reason is null or char_length(decision_reason) <= 500),
  -- An approved referral always names its organization, and only an approved one does.
  constraint ck_ref_org_only_approved check (
    (organization_id is not null) = (status = 'approved')
  ),
  constraint ck_ref_decision_stamp check (
    (status in ('draft', 'submitted') and reviewed_at is null)
    or (status in ('approved', 'rejected') and reviewed_at is not null)
  ),
  constraint ck_ref_reject_reason check (
    status <> 'rejected' or (decision_reason is not null and char_length(btrim(decision_reason)) > 0)
  )
);
comment on table public.organization_referrals is
  'A BUSINESS CANDIDATE referred by a salesperson who could not find their employer on Aladdin (Sprint 13). Submitting creates NO organization and grants NO access — an Admin reviews it through the existing verification architecture and either LINKS it to an organization that already exists or materialises it. The referrer becomes a Sales member, never the Owner. `referred_by` is the durable attribution a future rewards feature will read; no reward is computed anywhere.';

create index ix_ref_status on public.organization_referrals (status, created_at);
create index ix_ref_referrer on public.organization_referrals (referred_by, status);
-- Name matching for Admin de-duplication (part F): trigram, because a referred
-- name is typed by hand and rarely matches character-for-character.
create index ix_ref_display_name_trgm
  on public.organization_referrals using gin (display_name extensions.gin_trgm_ops);
-- One OPEN referral per salesperson, exactly like a business-creation draft: the
-- resume handle is unambiguous and a re-submitted form cannot fork into parallel
-- half-filled candidates. Decided referrals are unconstrained.
create unique index uq_ref_open_per_referrer
  on public.organization_referrals (referred_by)
  where status in ('draft', 'submitted');

create trigger set_ref_updated_at
  before update on public.organization_referrals
  for each row execute function app.set_updated_at();

-- ===========================================================================
-- 4. Attribution on the organization itself (part G)
-- ===========================================================================
-- Two columns, no rewards machinery. They answer "where did this business come
-- from, and who brought it?" directly on the row every other query already joins.
alter table public.organizations
  add column if not exists source text not null default 'self_created',
  add column if not exists referred_by_user_id uuid references public.users (id) on delete set null;

alter table public.organizations
  drop constraint if exists ck_organizations_source,
  add constraint ck_organizations_source check (
    source in ('self_created', 'salesperson_referral')
  ),
  -- Provenance is only meaningful together: a referred business names its referrer.
  drop constraint if exists ck_organizations_referral_attribution,
  add constraint ck_organizations_referral_attribution check (
    (source = 'salesperson_referral') = (referred_by_user_id is not null)
  );

comment on column public.organizations.source is
  'How this business came to exist: self_created (someone made their own) or salesperson_referral (a salesperson referred it and an Admin approved). Write-once — see app.organizations_provenance_immutable().';
comment on column public.organizations.referred_by_user_id is
  'The salesperson who referred this business, retained so a future rewards feature can attribute it. Write-once and never inferred; it is NOT a relationship and confers no membership, capability or ownership.';

create index ix_organizations_referred_by
  on public.organizations (referred_by_user_id)
  where referred_by_user_id is not null;

-- Write-once. Attribution that can be edited is attribution that can be stolen,
-- and a reward paid on a mutable field is a reward paid to whoever wrote last.
create or replace function app.organizations_provenance_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.referred_by_user_id is not null
     and new.referred_by_user_id is distinct from old.referred_by_user_id then
    raise exception 'referral attribution is immutable once recorded' using errcode = '23514';
  end if;
  if old.source = 'salesperson_referral' and new.source is distinct from old.source then
    raise exception 'business provenance is immutable once recorded' using errcode = '23514';
  end if;
  return new;
end;
$$;
comment on function app.organizations_provenance_immutable() is
  'Enforces write-once provenance on organizations.referred_by_user_id / .source (Sprint 13, part G). A recorded referral attribution can never be reassigned, including by a platform actor.';

drop trigger if exists organizations_provenance_immutable on public.organizations;
create trigger organizations_provenance_immutable
  before update on public.organizations
  for each row execute function app.organizations_provenance_immutable();

-- ===========================================================================
-- 5. Audit actions
-- ===========================================================================
-- The full allow-list from 20260813090002 plus this sprint's affiliation events.
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
  -- Sprint 13 — showroom affiliation and referral.
  'affiliation.requested', 'affiliation.cancelled',
  'affiliation.approved', 'affiliation.rejected',
  'referral.submitted', 'referral.approved', 'referral.rejected'
));

-- ===========================================================================
-- 6. app.membership_grant_sales — the ONE trusted way an affiliation activates
-- ===========================================================================
-- Both approval paths end here, so "approved" means exactly the same thing however
-- the request arrived. It reuses the existing membership model rather than
-- inventing a parallel one: an existing membership row (invited from a previous
-- attempt, or suspended/revoked from a past stint) is REACTIVATED in place, so a
-- returning salesperson keeps their membership id and its history instead of
-- accumulating duplicates.
--
-- The granted set is a SALESPERSON's set. It deliberately excludes org.manage and
-- org.members.manage: affiliation makes someone a member, never an owner or an
-- administrator of the business (part D/E/F).
create or replace function app.membership_grant_sales(
  p_org_id    uuid,
  p_user_id   uuid,
  p_branch_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mid   uuid;
  v_cap   text;
  v_bid   uuid := p_branch_id;
  v_caps  text[] := array[
    'catalog.read',
    'sales.opportunity.read', 'sales.opportunity.write', 'sales.match.share',
    'sales.task.write', 'sales.followup.send',
    'rfq.create', 'rfq.respond', 'quote.submit',
    'project.read', 'conversation.participate'
  ];
begin
  -- Same stable lock target as every other membership mutation, so concurrent
  -- approvals of the same person serialise instead of racing.
  perform 1 from public.organizations where id = p_org_id for update;

  -- Fall back to the organization's own primary branch when no branch was named,
  -- so a member is never left with empty branch scope.
  if v_bid is null then
    select b.id into v_bid from public.branches b
    where b.organization_id = p_org_id and b.is_active
    order by b.created_at
    limit 1;
  end if;

  select m.id into v_mid from public.memberships m
  where m.organization_id = p_org_id and m.user_id = p_user_id
  for update;

  if v_mid is null then
    insert into public.memberships
      (user_id, organization_id, primary_branch_id, status, invited_by, accepted_at)
    values (p_user_id, p_org_id, v_bid, 'active', (select auth.uid()), now())
    returning id into v_mid;
    perform app.record_audit_event('membership.granted', 'membership', v_mid, p_org_id,
      jsonb_build_object('user_id', p_user_id, 'status', 'active', 'via', 'showroom_affiliation'));
  elsif exists (select 1 from public.memberships m where m.id = v_mid and m.status <> 'active') then
    update public.memberships
       set status = 'active',
           accepted_at = coalesce(accepted_at, now()),
           primary_branch_id = coalesce(v_bid, primary_branch_id)
     where id = v_mid;
  end if;

  perform app.record_audit_event('membership.activated', 'membership', v_mid, p_org_id,
    jsonb_build_object('via', 'showroom_affiliation'));

  foreach v_cap in array v_caps loop
    insert into public.membership_capabilities (membership_id, capability_key)
    values (v_mid, v_cap)
    on conflict (membership_id, capability_key) do nothing;
  end loop;

  if v_bid is not null then
    insert into public.membership_branch_access (membership_id, branch_id)
    values (v_mid, v_bid)
    on conflict do nothing;
    perform app.record_audit_event('branch.assignment_changed', 'membership', v_mid, p_org_id,
      jsonb_build_object('branch_id', v_bid, 'via', 'showroom_affiliation'));
  end if;

  return v_mid;
end;
$$;
comment on function app.membership_grant_sales(uuid, uuid, uuid) is
  'Internal: activate a SALESPERSON membership in an organization with the sales capability set and branch scope, reusing an existing membership row where one exists. Never grants org.manage or org.members.manage — an affiliated salesperson is a member, never an owner. Idempotent.';
revoke execute on function app.membership_grant_sales(uuid, uuid, uuid) from public;

-- ===========================================================================
-- 7. showroom_directory_search — find the business you work for
-- ===========================================================================
-- Column set: exactly the approved public business-directory projection. Nothing
-- operational (created_by, deleted_at, timestamps, status, member counts) is
-- exposed, and no private organization data becomes visible to the requester
-- before OR after they ask to join.
--
-- ROW eligibility deliberately includes `pending_verification` showrooms, unlike
-- organization_public_directory which lists verified businesses only. The reason is
-- concrete: most Pilot showrooms are not verified yet, and hiding them would push
-- every one of their salespeople into referring a DUPLICATE of a business already
-- on the platform — the exact outcome part F exists to prevent. The trade is a
-- business NAME being discoverable by a signed-in user, which is public
-- information about a business, not private data about a person.
create or replace function public.showroom_directory_search(
  p_query text,
  p_limit int default 20
)
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
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  perform app.require_verified_caller();
  -- A blank or one-character query is an attempt to enumerate the directory, not
  -- to find an employer. Return nothing rather than everything.
  if v_q is null or char_length(v_q) < 2 then
    return;
  end if;

  return query
    select o.id, o.name, o.slug, o.org_type, o.is_verified,
           o.primary_locale, o.locality_id, o.logo_media_id
    from public.organizations o
    where o.deleted_at is null
      and o.status in ('active', 'pending_verification')
      and o.org_type = 'showroom_dealer'
      and o.name ilike '%' || v_q || '%'
    order by o.is_verified desc, o.name
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;
comment on function public.showroom_directory_search(text, int) is
  'Showroom/Dealer lookup for the "connect your showroom" flow. Returns ONLY the approved public business-directory columns, for non-deleted showrooms that are active or pending verification, minimum 2-character query, capped result count. Confers no access to any organization''s private data.';
revoke execute on function public.showroom_directory_search(text, int) from public;
grant execute on function public.showroom_directory_search(text, int) to authenticated;

-- A single showroom's public card, for the confirm step and for showing a pending
-- request whose organization the caller is not yet a member of (RLS on
-- `organizations` would correctly hide the name from them).
create or replace function public.showroom_branches(p_org_id uuid)
returns table (id uuid, name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_verified_caller();
  return query
    select b.id, b.name
    from public.branches b
    join public.organizations o on o.id = b.organization_id
    where b.organization_id = p_org_id
      and b.is_active
      and o.deleted_at is null
      and o.org_type = 'showroom_dealer'
    order by b.created_at;
end;
$$;
comment on function public.showroom_branches(uuid) is
  'The active branch names of a showroom, so a salesperson can say WHERE they work before any membership exists. Names only — no addresses, staff, or operational data.';
revoke execute on function public.showroom_branches(uuid) from public;
grant execute on function public.showroom_branches(uuid) to authenticated;

-- ===========================================================================
-- 8. The salesperson's side
-- ===========================================================================

-- 8a. Ask to join an existing showroom. Creates a REQUEST and nothing else.
create or replace function public.showroom_join_request_create(
  p_organization_id uuid,
  p_branch_id       uuid default null,
  p_note            text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_verified_caller();
  v_org public.organizations;
  v_id  uuid;
begin
  select * into v_org from public.organizations o
  where o.id = p_organization_id and o.deleted_at is null;
  if not found then
    raise exception 'showroom not found' using errcode = '42501';
  end if;
  if v_org.org_type <> 'showroom_dealer' then
    raise exception 'sales affiliation applies to a showroom/dealer' using errcode = '22023';
  end if;

  -- Already working there: this is a no-op, not an error the UI must explain.
  if exists (
    select 1 from public.memberships m
    where m.organization_id = p_organization_id and m.user_id = v_uid and m.status = 'active'
  ) then
    raise exception 'you already work in this business' using errcode = '23505';
  end if;

  -- A named branch must belong to the named showroom. Silently accepting a foreign
  -- branch id would leak that it exists and would scope the future membership into
  -- another tenant.
  if p_branch_id is not null and not exists (
    select 1 from public.branches b
    where b.id = p_branch_id and b.organization_id = p_organization_id and b.is_active
  ) then
    raise exception 'that branch does not belong to this showroom' using errcode = '22023';
  end if;

  -- IDEMPOTENT: an existing open request is returned, so a retry or a second tap
  -- never queues a duplicate for the approver.
  select r.id into v_id from public.organization_join_requests r
  where r.user_id = v_uid and r.organization_id = p_organization_id and r.status = 'pending'
  for update;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.organization_join_requests
    (user_id, organization_id, requested_branch_id, note)
  values (v_uid, p_organization_id, p_branch_id,
          nullif(left(btrim(coalesce(p_note, '')), 500), ''))
  returning id into v_id;

  perform app.record_audit_event('affiliation.requested', 'organization_join_request', v_id,
    p_organization_id, jsonb_build_object('user_id', v_uid, 'branch_id', p_branch_id));
  return v_id;
end;
$$;
comment on function public.showroom_join_request_create(uuid, uuid, text) is
  'Requests affiliation with an EXISTING showroom. Creates no organization, no membership and no access; idempotent per (caller, showroom) while a request is open. The requester is always auth.uid().';
revoke execute on function public.showroom_join_request_create(uuid, uuid, text) from public;
grant execute on function public.showroom_join_request_create(uuid, uuid, text) to authenticated;

-- 8b. Withdraw one's own open request.
create or replace function public.showroom_join_request_cancel(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_verified_caller();
  v_r   public.organization_join_requests;
begin
  select * into v_r from public.organization_join_requests r
  where r.id = p_request_id and r.user_id = v_uid
  for update;
  if not found then
    raise exception 'request not found' using errcode = '42501';
  end if;
  if v_r.status <> 'pending' then
    return;   -- already decided or already withdrawn
  end if;

  update public.organization_join_requests
     set status = 'cancelled', decided_at = now()
   where id = p_request_id;

  perform app.record_audit_event('affiliation.cancelled', 'organization_join_request',
    p_request_id, v_r.organization_id, jsonb_build_object('by', 'requester'));
end;
$$;
revoke execute on function public.showroom_join_request_cancel(uuid) from public;
grant execute on function public.showroom_join_request_cancel(uuid) to authenticated;

-- 8c. The salesperson's own affiliation state, for their personal home.
-- A definer read-model because the point of a PENDING request is that the caller
-- is not yet a member — RLS on `organizations` hides the name they just typed.
-- Only the public name/type is returned.
create or replace function public.my_showroom_affiliations()
returns table (
  request_id        uuid,
  organization_id   uuid,
  organization_name text,
  org_type          public.organization_type,
  is_verified       boolean,
  branch_name       text,
  status            public.affiliation_request_status,
  decision_reason   text,
  created_at        timestamptz,
  decided_at        timestamptz,
  via_referral      boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, o.id, o.name, o.org_type, o.is_verified, b.name,
         r.status, r.decision_reason, r.created_at, r.decided_at,
         exists (select 1 from public.organization_referrals f where f.join_request_id = r.id)
  from public.organization_join_requests r
  join public.organizations o on o.id = r.organization_id
  left join public.branches b on b.id = r.requested_branch_id
  where r.user_id = (select auth.uid())
  order by case r.status when 'pending' then 0 when 'approved' then 1 else 2 end,
           r.created_at desc;
$$;
comment on function public.my_showroom_affiliations() is
  'The caller''s own showroom affiliation requests with the public identity of each showroom. Presentation only — an approved row is not what grants access; the ACTIVE membership is, and my_workspaces() reports that independently.';
revoke execute on function public.my_showroom_affiliations() from public;
grant execute on function public.my_showroom_affiliations() to authenticated;

-- 8d. The caller's own referral (candidate) state.
create or replace function public.my_showroom_referrals()
returns table (
  id                uuid,
  display_name      text,
  legal_name        text,
  org_type          public.organization_type,
  governorate       text,
  city              text,
  primary_branch_name text,
  description       text,
  status            public.referral_status,
  decision_reason   text,
  organization_id   uuid,
  created_at        timestamptz,
  reviewed_at       timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.display_name, f.legal_name, f.org_type, f.governorate, f.city,
         f.primary_branch_name, f.description, f.status, f.decision_reason,
         f.organization_id, f.created_at, f.reviewed_at
  from public.organization_referrals f
  where f.referred_by = (select auth.uid())
  order by case f.status when 'submitted' then 0 when 'draft' then 1 when 'approved' then 2 else 3 end,
           f.created_at desc;
$$;
revoke execute on function public.my_showroom_referrals() from public;
grant execute on function public.my_showroom_referrals() to authenticated;

-- ===========================================================================
-- 9. The showroom's side — decided through the EXISTING People Ops capability
-- ===========================================================================

-- 9a. The pending roster, for the organization's existing team surface.
create or replace function public.org_join_requests_list(p_org_id uuid)
returns table (
  request_id      uuid,
  user_id         uuid,
  display_name    text,
  email_masked    text,
  persona         public.persona_type,
  note            text,
  branch_id       uuid,
  branch_name     text,
  status          public.affiliation_request_status,
  decision_reason text,
  created_at      timestamptz,
  decided_at      timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  -- The SAME capability that gates the members roster. No second permission model.
  if not app.has_capability(p_org_id, 'org.members.manage') then
    raise exception 'org.members.manage required' using errcode = '42501';
  end if;

  return query
    select r.id, r.user_id, coalesce(p.display_name, ''), app.mask_email(au.email),
           u.primary_account_type, r.note, r.requested_branch_id, b.name,
           r.status, r.decision_reason, r.created_at, r.decided_at
    from public.organization_join_requests r
    join public.users u on u.id = r.user_id
    left join public.profiles p on p.user_id = r.user_id
    left join auth.users au on au.id = r.user_id
    left join public.branches b on b.id = r.requested_branch_id
    where r.organization_id = p_org_id
    order by case r.status when 'pending' then 0 else 1 end, r.created_at;
end;
$$;
comment on function public.org_join_requests_list(uuid) is
  'Manager-gated read-model of affiliation requests for ONE organization, mirroring org_members_list: display name, MASKED email, persona, requested branch. Never a raw email and never a cross-org row.';
revoke execute on function public.org_join_requests_list(uuid) from public;
grant execute on function public.org_join_requests_list(uuid) to authenticated;

-- 9b. Approve — activates the membership through the shared trusted path.
create or replace function public.org_join_request_approve(
  p_request_id uuid,
  p_branch_id  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r   public.organization_join_requests;
  v_bid uuid;
  v_mid uuid;
begin
  select * into v_r from public.organization_join_requests r
  where r.id = p_request_id
  for update;
  if not found then
    raise exception 'request not found' using errcode = '42501';
  end if;
  -- Capability is checked against the request's OWN organization, so a manager of
  -- another business cannot reach this row (part P).
  if not app.has_capability(v_r.organization_id, 'org.members.manage') then
    raise exception 'org.members.manage required' using errcode = '42501';
  end if;

  -- IDEMPOTENT: approving twice returns the one membership it created.
  if v_r.status = 'approved' then
    return v_r.membership_id;
  end if;
  if v_r.status <> 'pending' then
    raise exception 'this request was already % ', v_r.status using errcode = '22023';
  end if;

  -- Branch scope: the approver's choice wins, otherwise the requested branch, and
  -- app.membership_grant_sales falls back to the primary branch.
  v_bid := coalesce(p_branch_id, v_r.requested_branch_id);
  if v_bid is not null and not exists (
    select 1 from public.branches b
    where b.id = v_bid and b.organization_id = v_r.organization_id and b.is_active
  ) then
    raise exception 'that branch does not belong to this showroom' using errcode = '22023';
  end if;

  v_mid := app.membership_grant_sales(v_r.organization_id, v_r.user_id, v_bid);

  update public.organization_join_requests
     set status = 'approved',
         membership_id = v_mid,
         decided_by = (select auth.uid()),
         decided_at = now(),
         requested_branch_id = coalesce(v_bid, requested_branch_id)
   where id = p_request_id;

  perform app.record_audit_event('affiliation.approved', 'organization_join_request',
    p_request_id, v_r.organization_id,
    jsonb_build_object('user_id', v_r.user_id, 'membership_id', v_mid,
                       'branch_id', v_bid, 'relationship', 'sales_member'));
  return v_mid;
end;
$$;
comment on function public.org_join_request_approve(uuid, uuid) is
  'Approves an affiliation request: activates exactly ONE Sales membership through app.membership_grant_sales, preserving the requested/approved branch scope. Requires org.members.manage in the request''s own organization. Idempotent. Never grants owner or manager capabilities.';
revoke execute on function public.org_join_request_approve(uuid, uuid) from public;
grant execute on function public.org_join_request_approve(uuid, uuid) to authenticated;

-- 9c. Reject — with a reason, and with no effect on the personal account.
create or replace function public.org_join_request_reject(
  p_request_id uuid,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r      public.organization_join_requests;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is null then
    raise exception 'a reason is required to reject a request' using errcode = '22023';
  end if;
  select * into v_r from public.organization_join_requests r
  where r.id = p_request_id
  for update;
  if not found then
    raise exception 'request not found' using errcode = '42501';
  end if;
  if not app.has_capability(v_r.organization_id, 'org.members.manage') then
    raise exception 'org.members.manage required' using errcode = '42501';
  end if;
  if v_r.status = 'rejected' then
    return;
  end if;
  if v_r.status <> 'pending' then
    raise exception 'this request was already % ', v_r.status using errcode = '22023';
  end if;

  -- Rejection touches the REQUEST only. The salesperson's identity, account
  -- status, personal workspace and verification are all untouched.
  update public.organization_join_requests
     set status = 'rejected',
         decision_reason = left(v_reason, 500),
         decided_by = (select auth.uid()),
         decided_at = now()
   where id = p_request_id;

  perform app.record_audit_event('affiliation.rejected', 'organization_join_request',
    p_request_id, v_r.organization_id, jsonb_build_object('user_id', v_r.user_id));
end;
$$;
revoke execute on function public.org_join_request_reject(uuid, text) from public;
grant execute on function public.org_join_request_reject(uuid, text) to authenticated;

-- ===========================================================================
-- 10. Referral — save, submit
-- ===========================================================================

-- 10a. Resumable draft. Same shape as business_draft_save, so a half-filled
-- referral survives a closed tab.
create or replace function public.showroom_referral_save(
  p_referral_id         uuid default null,
  p_legal_name          text default null,
  p_display_name        text default null,
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
  v_uid    uuid := app.require_verified_caller();
  v_id     uuid;
  v_status public.referral_status;
begin
  if p_referral_id is null then
    select f.id into v_id from public.organization_referrals f
    where f.referred_by = v_uid and f.status = 'draft'
    for update;
  else
    select f.id, f.status into v_id, v_status from public.organization_referrals f
    where f.id = p_referral_id and f.referred_by = v_uid
    for update;
    if v_id is null then
      raise exception 'referral not found' using errcode = '42501';
    end if;
    if v_status <> 'draft' then
      raise exception 'this referral has already been submitted' using errcode = '22023';
    end if;
  end if;

  if v_id is null then
    insert into public.organization_referrals (
      referred_by, legal_name, display_name, description,
      governorate, city, primary_branch_name
    ) values (
      v_uid,
      nullif(left(btrim(coalesce(p_legal_name, '')), 120), ''),
      nullif(left(btrim(coalesce(p_display_name, '')), 120), ''),
      nullif(left(btrim(coalesce(p_description, '')), 1000), ''),
      nullif(left(btrim(coalesce(p_governorate, '')), 80), ''),
      nullif(left(btrim(coalesce(p_city, '')), 80), ''),
      nullif(left(btrim(coalesce(p_primary_branch_name, '')), 120), '')
    )
    returning id into v_id;
    return v_id;
  end if;

  update public.organization_referrals set
    legal_name          = nullif(left(btrim(coalesce(p_legal_name, '')), 120), ''),
    display_name        = nullif(left(btrim(coalesce(p_display_name, '')), 120), ''),
    description         = nullif(left(btrim(coalesce(p_description, '')), 1000), ''),
    governorate         = nullif(left(btrim(coalesce(p_governorate, '')), 80), ''),
    city                = nullif(left(btrim(coalesce(p_city, '')), 80), ''),
    primary_branch_name = nullif(left(btrim(coalesce(p_primary_branch_name, '')), 120), '')
  where id = v_id;

  return v_id;
end;
$$;
revoke execute on function public.showroom_referral_save(
  uuid, text, text, text, text, text, text) from public;
grant execute on function public.showroom_referral_save(
  uuid, text, text, text, text, text, text) to authenticated;

-- 10b. Submit for Admin review. RETRY-SAFE: re-submitting a submitted or approved
-- referral returns the same row rather than creating a second candidate, so a
-- network retry cannot produce two businesses for one showroom.
create or replace function public.showroom_referral_submit(p_referral_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_verified_caller();
  v_f   public.organization_referrals;
begin
  if p_referral_id is null then
    select * into v_f from public.organization_referrals f
    where f.referred_by = v_uid and f.status in ('draft', 'submitted')
    order by case f.status when 'draft' then 0 else 1 end
    limit 1
    for update;
  else
    select * into v_f from public.organization_referrals f
    where f.id = p_referral_id and f.referred_by = v_uid
    for update;
  end if;

  if v_f.id is null then
    raise exception 'referral not found' using errcode = '42501';
  end if;
  -- Already submitted or decided: hand back the same referral.
  if v_f.status <> 'draft' then
    return v_f.id;
  end if;

  -- The minimum the existing business path needs to create an organization and its
  -- primary branch. Nothing beyond it is collected.
  if nullif(btrim(coalesce(v_f.display_name, '')), '') is null then
    raise exception 'the showroom name is required' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(v_f.governorate, '')), '') is null
     or nullif(btrim(coalesce(v_f.city, '')), '') is null then
    raise exception 'the showroom location is required' using errcode = '22023';
  end if;

  update public.organization_referrals
     set status = 'submitted'
   where id = v_f.id;

  perform app.record_audit_event('referral.submitted', 'organization_referral', v_f.id, null,
    jsonb_build_object('display_name', v_f.display_name, 'org_type', v_f.org_type,
                       'referred_by', v_uid));
  return v_f.id;
end;
$$;
comment on function public.showroom_referral_submit(uuid) is
  'Submits a referred showroom candidate for Admin review. Creates NO organization and grants NO access — the personal account stays usable and the referral is simply pending. Retry-safe: re-submitting returns the same referral.';
revoke execute on function public.showroom_referral_submit(uuid) from public;
grant execute on function public.showroom_referral_submit(uuid) to authenticated;

-- ===========================================================================
-- 11. Admin review of a referred showroom (part F)
-- ===========================================================================
-- This EXTENDS the existing review architecture — platform authority via
-- app.is_platform('support'), the same audit trail, the same decision vocabulary.
-- It is not a second Admin system and it does not touch RLS.

-- 11a. The review queue, with the referring salesperson and de-duplication
-- candidates already computed, so an Admin sees "this may already exist" without
-- having to go looking.
create or replace function public.admin_showroom_referrals_list(
  p_pending_only boolean default true
)
returns table (
  id                  uuid,
  display_name        text,
  legal_name          text,
  org_type            public.organization_type,
  description         text,
  governorate         text,
  city                text,
  primary_branch_name text,
  status              public.referral_status,
  decision_reason     text,
  organization_id     uuid,
  organization_name   text,
  referred_by         uuid,
  referrer_name       text,
  referrer_email      text,
  referrer_persona    public.persona_type,
  created_at          timestamptz,
  reviewed_at         timestamptz,
  match_count         int,
  match_id            uuid,
  match_name          text
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if not app.is_platform('support') then
    raise exception 'platform authority required' using errcode = '42501';
  end if;

  return query
    with matches as (
      -- Candidate duplicates: same business classification, similar name. NOT a
      -- unique constraint on name — two genuinely different showrooms may share
      -- one — just the shortlist a human decides from.
      select f.id as referral_id, o.id as org_id, o.name as org_name,
             row_number() over (partition by f.id
                                order by extensions.similarity(o.name, f.display_name) desc, o.name) as rn,
             count(*) over (partition by f.id) as n
      from public.organization_referrals f
      join public.organizations o
        on o.deleted_at is null
       and o.org_type = f.org_type
       and f.display_name is not null
       and (o.name ilike f.display_name
            or extensions.similarity(o.name, f.display_name) > 0.4)
    )
    select f.id, f.display_name, f.legal_name, f.org_type, f.description,
           f.governorate, f.city, f.primary_branch_name, f.status, f.decision_reason,
           f.organization_id, o.name,
           f.referred_by, coalesce(p.display_name, ''), app.mask_email(au.email),
           u.primary_account_type,
           f.created_at, f.reviewed_at,
           coalesce(mt.n, 0)::int, mt.org_id, mt.org_name
    from public.organization_referrals f
    join public.users u on u.id = f.referred_by
    left join public.profiles p on p.user_id = f.referred_by
    left join auth.users au on au.id = f.referred_by
    left join public.organizations o on o.id = f.organization_id
    left join matches mt on mt.referral_id = f.id and mt.rn = 1
    where (not p_pending_only or f.status = 'submitted')
      and f.status <> 'draft'
    order by case f.status when 'submitted' then 0 else 1 end, f.created_at;
end;
$$;
comment on function public.admin_showroom_referrals_list(boolean) is
  'Platform review queue for referred showrooms: the candidate business/location data, the referring salesperson (masked email), and the closest existing organization of the same classification as a de-duplication hint. A draft is private to its referrer and never listed.';
revoke execute on function public.admin_showroom_referrals_list(boolean) from public;
grant execute on function public.admin_showroom_referrals_list(boolean) to authenticated;

-- 11b. Approve — LINK to an existing organization, or materialise a new one.
--
-- THE OWNER QUESTION, answered explicitly (part F). The data model has no
-- invariant requiring an organization to have an owner: `app.assert_not_last_owner`
-- protects an owner that EXISTS from being removed, and nothing requires one to
-- exist in the first place. So the honest outcome is available and is what this
-- function does — a referred showroom is created with its primary branch and the
-- referring salesperson's SALES membership, and with NO org.manage membership at
-- all. It is a platform-managed business, claimable later by its real owner
-- through the normal verification/ownership path. No owner relationship is faked,
-- and the salesperson is never made Owner of their employer.
--
-- `created_by` is the reviewing Admin, not the salesperson: that column is the
-- creator for the organizations_insert_creator RLS policy and would read as
-- ownership if it named the referrer. Attribution lives in referred_by_user_id.
create or replace function public.showroom_referral_approve(
  p_referral_id           uuid,
  p_link_organization_id  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  v_f      public.organization_referrals;
  v_org_id uuid;
  v_bid    uuid;
  v_locale text;
  v_linked boolean := false;
  v_rid    uuid;
  v_mid    uuid;
begin
  if not app.is_platform('support') then
    raise exception 'platform authority required' using errcode = '42501';
  end if;

  select * into v_f from public.organization_referrals f
  where f.id = p_referral_id
  for update;
  if not found then
    raise exception 'referral not found' using errcode = '22023';
  end if;

  -- IDEMPOTENT, and the structural reason approval cannot duplicate a business:
  -- the referral already names its organization, so it is returned unchanged.
  if v_f.status = 'approved' then
    return v_f.organization_id;
  end if;
  if v_f.status <> 'submitted' then
    raise exception 'only a submitted referral can be approved (status=%)', v_f.status
      using errcode = '22023';
  end if;

  -- ---- Resolve the organization: prefer LINKING over creating. ----
  if p_link_organization_id is not null then
    -- The Admin decided this candidate IS an existing business.
    select o.id into v_org_id from public.organizations o
    where o.id = p_link_organization_id and o.deleted_at is null
      and o.org_type = v_f.org_type
    for update;
    if v_org_id is null then
      raise exception 'the organization to link is not an existing % ', v_f.org_type
        using errcode = '22023';
    end if;
    v_linked := true;
  else
    -- No explicit link: an EXACT (case/space-insensitive) name match of the same
    -- classification is treated as the same business rather than a second copy of
    -- it. Anything fuzzier is a judgement call and stays with the Admin, who is
    -- shown the shortlist by admin_showroom_referrals_list.
    select o.id into v_org_id from public.organizations o
    where o.deleted_at is null
      and o.org_type = v_f.org_type
      and lower(btrim(o.name)) = lower(btrim(v_f.display_name))
    order by o.created_at
    limit 1
    for update;
    v_linked := v_org_id is not null;
  end if;

  if v_org_id is null then
    -- ---- Materialise the business, WITHOUT an owner. ----
    select u.locale into v_locale from public.users u where u.id = v_f.referred_by;
    insert into public.organizations
      (name, org_type, status, is_verified, primary_locale, created_by,
       source, referred_by_user_id)
    values (btrim(v_f.display_name), v_f.org_type, 'pending_verification', false,
            case when v_locale in ('en', 'ar') then v_locale else 'en' end, v_actor,
            'salesperson_referral', v_f.referred_by)
    returning id into v_org_id;

    insert into public.branches (organization_id, name)
    values (v_org_id, coalesce(nullif(btrim(coalesce(v_f.primary_branch_name, '')), ''),
                               btrim(v_f.display_name)))
    returning id into v_bid;

    perform app.record_audit_event('organization.created', 'organization', v_org_id, v_org_id,
      jsonb_build_object('org_type', v_f.org_type, 'status', 'pending_verification',
                         'source', 'salesperson_referral',
                         'referred_by', v_f.referred_by, 'referral_id', v_f.id));
    perform app.record_audit_event('branch.created', 'branch', v_bid, v_org_id,
      jsonb_build_object('primary', true));
  else
    select b.id into v_bid from public.branches b
    where b.organization_id = v_org_id and b.is_active
    order by b.created_at
    limit 1;
  end if;

  -- ---- The salesperson's relationship: SALES MEMBER. Never Owner. ----
  -- Recorded as an approved join request too, so an affiliation looks the same
  -- whichever path produced it and the salesperson's home needs one read model.
  insert into public.organization_join_requests
    (user_id, organization_id, requested_branch_id, status, decided_by, decided_at, note)
  values (v_f.referred_by, v_org_id, v_bid, 'pending', null, null,
          'Referred this showroom to Aladdin')
  on conflict do nothing
  returning id into v_rid;

  if v_rid is null then
    select r.id into v_rid from public.organization_join_requests r
    where r.user_id = v_f.referred_by and r.organization_id = v_org_id
    order by r.created_at desc
    limit 1;
  end if;

  v_mid := app.membership_grant_sales(v_org_id, v_f.referred_by, v_bid);

  update public.organization_join_requests
     set status = 'approved', membership_id = v_mid,
         decided_by = v_actor, decided_at = now()
   where id = v_rid and status <> 'approved';

  update public.organization_referrals
     set status = 'approved', organization_id = v_org_id, join_request_id = v_rid,
         reviewed_by = v_actor, reviewed_at = now()
   where id = p_referral_id;

  perform app.record_audit_event('referral.approved', 'organization_referral',
    p_referral_id, v_org_id,
    jsonb_build_object('organization_id', v_org_id,
                       'resolution', case when v_linked then 'linked_existing' else 'created' end,
                       'referred_by', v_f.referred_by,
                       'membership_id', v_mid,
                       'relationship', 'sales_member'));
  return v_org_id;
end;
$$;
comment on function public.showroom_referral_approve(uuid, uuid) is
  'Platform approval of a referred showroom. Links the candidate to an existing organization of the same classification when one matches (preferred), otherwise materialises the organization + primary branch with NO owner membership — a platform-managed business claimable later, because the model requires no owner and faking one is worse. Always ends with the referring salesperson as a SALES MEMBER, never Owner. Idempotent: an approved referral returns its organization and can never create a second.';
revoke execute on function public.showroom_referral_approve(uuid, uuid) from public;
grant execute on function public.showroom_referral_approve(uuid, uuid) to authenticated;

-- 11c. Reject — the personal account is untouched.
create or replace function public.showroom_referral_reject(
  p_referral_id uuid,
  p_reason      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f      public.organization_referrals;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not app.is_platform('support') then
    raise exception 'platform authority required' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'a reason is required to reject a referral' using errcode = '22023';
  end if;

  select * into v_f from public.organization_referrals f
  where f.id = p_referral_id
  for update;
  if not found then
    raise exception 'referral not found' using errcode = '22023';
  end if;
  if v_f.status = 'rejected' then
    return;
  end if;
  if v_f.status <> 'submitted' then
    raise exception 'only a submitted referral can be rejected (status=%)', v_f.status
      using errcode = '22023';
  end if;

  update public.organization_referrals
     set status = 'rejected', decision_reason = left(v_reason, 500),
         reviewed_by = (select auth.uid()), reviewed_at = now()
   where id = p_referral_id;

  perform app.record_audit_event('referral.rejected', 'organization_referral',
    p_referral_id, null,
    jsonb_build_object('referred_by', v_f.referred_by, 'display_name', v_f.display_name));
end;
$$;
revoke execute on function public.showroom_referral_reject(uuid, text) from public;
grant execute on function public.showroom_referral_reject(uuid, text) to authenticated;

-- ===========================================================================
-- 12. RLS — self read, manager read, platform read; every write via the RPCs
-- ===========================================================================
alter table public.organization_join_requests enable row level security;
alter table public.organization_referrals     enable row level security;

-- The requester sees their own requests.
create policy ojr_select_self on public.organization_join_requests
  for select to authenticated
  using (user_id = (select auth.uid()));

-- An Owner/Manager sees the requests addressed to THEIR organization — scoped by
-- the same capability check that gates the members roster, so a manager of org B
-- can neither read nor decide a request belonging to org A.
create policy ojr_select_org_manager on public.organization_join_requests
  for select to authenticated
  using (app.has_capability(organization_id, 'org.members.manage'));

create policy ojr_select_platform on public.organization_join_requests
  for select to authenticated
  using (app.is_platform('support'));

-- A referral is private to its referrer until the platform reviews it.
create policy ref_select_self on public.organization_referrals
  for select to authenticated
  using (referred_by = (select auth.uid()));

create policy ref_select_platform on public.organization_referrals
  for select to authenticated
  using (app.is_platform('support'));

-- ===========================================================================
-- 13. Grants (deny-by-default; strip the Supabase defaults first)
-- ===========================================================================
-- No INSERT/UPDATE/DELETE to authenticated on either table: a request or a
-- referral can only come into existence through a security-definer RPC that
-- derives the actor from auth.uid(). A client-supplied user_id is therefore not
-- merely ignored — there is no path that accepts one.
revoke all on public.organization_join_requests from anon, authenticated, service_role;
revoke all on public.organization_referrals     from anon, authenticated, service_role;
grant select on public.organization_join_requests to authenticated;
grant select on public.organization_referrals     to authenticated;
grant select on public.organization_join_requests to service_role;
grant select on public.organization_referrals     to service_role;
