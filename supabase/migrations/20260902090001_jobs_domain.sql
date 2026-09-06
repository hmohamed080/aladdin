-- ===========================================================================
-- Installer Pilot Increment 6 — Jobs domain database foundation
--
-- The transactional authority behind Increments 7 (posting), 8 (discovery +
-- application) and 9 (assignment + progress). No product UI ships with it.
--
-- The shape of this domain is organization → PERSON, and that is the whole
-- reason it does not reuse the commerce authority sitting next to it. An RFQ,
-- a quotation and an order are all organization ↔ organization: two tenants,
-- two capability sets, and every policy is a pair of org predicates. A job has
-- exactly ONE organization and one individual, and the individual's authority
-- is `auth.uid()` and nothing else. Reusing `orders` here would have given the
-- installer an org-shaped seat at a table where they have no organization, and
-- the first "simplification" that noticed the symmetry would have handed them
-- tenant reads. See §10.6 of docs/database/installer-jobs.md.
--
-- Four rules this file enforces structurally rather than by convention:
--
--   1. NO CLIENT DML. Not one INSERT/UPDATE/DELETE grant on any of the four
--      tables, in any role. Every state change is a security-definer RPC. RLS
--      answers "who may READ this row"; the RPCs answer "who may CHANGE it".
--   2. VERIFICATION SUPPRESSION IS DERIVED. Nothing caches
--      `organizations.is_verified` onto a job. Discovery and new applications
--      read the live organization row through a join, so losing verification
--      hides a job without rewriting it, and regaining verification restores it
--      without a backfill. A denormalised copy would freeze the wrong answer in
--      both directions.
--   3. ONE ACTIVE ASSIGNMENT, AT THE STORAGE LAYER.
--      `ux_job_assignments_active_job` is a partial unique index, so two
--      concurrent accepts cannot both win no matter what any RPC does.
--   4. TRADE IS NEVER AUTHORITY (O5). No policy, no trigger and no write path
--      in this file references `user_trades`. An installer may apply outside
--      their declared trades, and 41/42's structural assertions prove it.
--
-- Deliberately absent, permanently: payment, wallet, escrow, payout,
-- settlement, commission, invoice, balance, counter-offer, negotiated amount,
-- match score, ranking, skill level, auto-expiry. Jobs are not commerce orders.
-- ===========================================================================

-- ===========================================================================
-- 1. Lifecycle enums — three, each owned by exactly ONE party
--
-- Splitting these is the point of the design. An application is the
-- applicant's candidacy and they may withdraw it; an assignment is a bilateral
-- engagement whose completion is the posting organization's call. One status
-- column carrying both authorities is the shape that makes a policy unreadable
-- and a write path unprovable.
-- ===========================================================================
create type public.job_status as enum (
  'draft', 'open', 'awarded', 'completed', 'closed', 'cancelled');

create type public.job_application_status as enum (
  'submitted', 'accepted', 'rejected', 'withdrawn');

create type public.job_assignment_status as enum (
  'scheduled', 'in_progress', 'completed', 'cancelled');

comment on type public.job_status is
  'Posting-organization lifecycle. There is NO automatic expiry (O4): a job leaves open only because a human moved it. awarded->open is reachable only by cancelling the live assignment, which is why ux_job_assignments_active_job excludes cancelled rows. THERE IS NO awarded->cancelled: an awarded job has somebody holding live work on it, so the engagement is ended first, on its own terms and with its own reason, and only the resulting open job can then be called off.';
comment on type public.job_application_status is
  'Applicant candidacy. The two DECIDED states are terminal — there is no un-accept and no un-reject; a mistake is corrected by cancelling the assignment, which returns the job to open for a fresh round. `withdrawn` is not a decision but the applicant''s own act, and is the one reversible state: job_application_submit returns the SAME row to submitted while the job is open and the poster verified.';
comment on type public.job_assignment_status is
  'Bilateral engagement. completed is reachable ONLY by the posting organization (see job_assignment_complete): a rating anchored to work the rated party declared complete about themselves is not evidence.';

-- ===========================================================================
-- 2. Capability catalog — two new keys
--
-- Reusing the established membership-capability system rather than inventing a
-- second authorization scheme. `org.manage` remains the blanket in-org unlock,
-- checked as an OR on every trusted write path exactly as the commerce and
-- sales RPCs already treat it.
-- ===========================================================================
alter table public.membership_capabilities drop constraint ck_membership_capability_key;
alter table public.membership_capabilities add constraint ck_membership_capability_key check (capability_key in (
  'org.manage', 'org.members.manage', 'branch.manage',
  'verification.submit', 'verification.read',
  'catalog.read', 'catalog.write', 'catalog.publish',
  'inventory.write',
  'sales.opportunity.read', 'sales.opportunity.write', 'sales.match.share',
  'sales.task.write', 'sales.followup.send',
  'sales.read', 'sales.write', 'sales.assign', 'sales.manage',
  'rfq.create', 'rfq.respond',
  'quote.submit', 'quote.decide',
  'order.create', 'order.manage',
  'project.read', 'project.write',
  'conversation.participate',
  -- Installer Pilot Increment 6 — the poster side of the Jobs domain.
  -- job.post   : author, edit, publish, close and cancel this org's jobs.
  -- job.manage : decide applications and run the resulting engagement.
  -- No capability is ever granted to the INSTALLER side; there is none to grant.
  'job.post', 'job.manage',
  'ad.manage',
  'subscription.read', 'subscription.manage',
  'analytics.view',
  'export.data'
));

-- ===========================================================================
-- 3. Audit action allow-list — the Jobs lifecycle events
--
-- Emitted inside the same transaction as the state change, the placement Points
-- Core and Notifications Core established. Metadata carries ids and status
-- transitions only: never contact details, never a note, never a site address,
-- and NEVER the offered amount — a monetary value in an audit payload invites
-- exactly the payment reading D9 forbids.
-- ===========================================================================
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
  -- Installer Pilot Increment 6 — Jobs domain (§15). `job.created` is included
  -- deliberately even though a draft is private: the drafting of an opening is
  -- the first act the poster org is answerable for.
  'job.created', 'job.updated', 'job.published', 'job.closed', 'job.cancelled',
  'job.application.submitted', 'job.application.withdrawn',
  'job.application.accepted', 'job.application.rejected',
  'job.assignment.started', 'job.assignment.progress_updated',
  'job.assignment.completed', 'job.assignment.cancelled'
));

-- ===========================================================================
-- 4. public.jobs — the opening
-- ===========================================================================
create table public.jobs (
  id                     uuid primary key default extensions.gen_random_uuid(),

  -- The ONLY organization party. There is no second org column, which is what
  -- makes cross-tenant leakage impossible by shape rather than by policy.
  -- An installer_technician PERSONAL account can never appear here: the schema
  -- cannot express a personal poster, so there is no self-posted job and no
  -- shadow one-person organization to close off later.
  poster_org_id          uuid not null references public.organizations (id) on delete cascade,
  poster_branch_id       uuid,

  title                  text not null,
  description            text,

  -- The single required primary trade (D8). A foreign key, never free text.
  -- `restrict` is the history-safe choice: retiring a trade sets is_active =
  -- false and leaves every job that ever named it intact. A cascade here would
  -- delete work history to tidy a vocabulary.
  trade_id               uuid not null references public.trades (id) on delete restrict,

  -- Compensation DISCLOSURE and nothing else (D9, §5). numeric, never float:
  -- money that cannot be compared for equality is money that cannot be audited.
  -- The contrast with points_ledger.points_delta — deliberately an INTEGER
  -- because Points are not currency — is meaningful in both directions.
  offered_amount         numeric(12,2) not null,
  offered_currency       text not null default 'EGP',

  -- GENERAL location only, the rule individual_onboarding already applies.
  governorate            text,
  city                   text,
  -- Never exposed before assignment (§11). Excluded from every discovery
  -- projection; reachable only through the base table, whose policy requires
  -- org membership or a live assignment.
  site_address           text,

  expected_duration_days smallint,
  starts_on              date,
  ends_by                date,

  status                 public.job_status not null default 'draft',
  version                integer not null default 1,

  published_at           timestamptz,
  closed_at              timestamptz,

  created_by             uuid not null references public.users (id) on delete restrict,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint ck_jobs_title_len check (char_length(title) between 2 and 200),
  constraint ck_jobs_description_len check (description is null or char_length(description) <= 2000),
  constraint ck_jobs_governorate_len check (governorate is null or char_length(governorate) <= 80),
  constraint ck_jobs_city_len check (city is null or char_length(city) <= 80),
  constraint ck_jobs_site_address_len check (site_address is null or char_length(site_address) <= 300),
  constraint ck_jobs_duration_range check (
    expected_duration_days is null or expected_duration_days between 0 and 365),
  constraint ck_jobs_date_order check (
    starts_on is null or ends_by is null or ends_by >= starts_on),
  -- There is no zero-value and no "negotiable" job in the Pilot.
  constraint ck_jobs_offer_positive check (offered_amount > 0),
  -- Pinned to EGP for the Pilot. Explicit, never implied: adding a second
  -- currency has to be a deliberate migration, not a value someone passes in.
  constraint ck_jobs_offer_currency check (offered_currency = 'EGP'),
  constraint fk_jobs_poster_branch foreign key (poster_org_id, poster_branch_id)
    references public.branches (organization_id, id) on delete set null
);

comment on table public.jobs is
  'An organization''s opening for an individual installer/technician (org -> PERSON). Deliberately NOT reusing the commerce order authority beside it, which is org <-> org. Forbidden columns, permanently: payment_status, paid_at, payout_*, settlement_*, escrow_*, commission_*, invoice_*, wallet_*, or any balance (§5.2). No client DML grant exists; every transition is a security-definer RPC.';
comment on column public.jobs.offered_amount is
  'The organization''s OFFERED compensation. Disclosure only — never paid, earned, received, due or owed, and never aggregated into a balance anywhere in the product (§5.4). Immutable once the first application exists (O7).';
comment on column public.jobs.site_address is
  'Precise site address. NEVER exposed before assignment (§11) — excluded from open_job_opportunities and from my_job_applications; readable only via the base table by poster-org members and the assigned installer.';
comment on column public.jobs.status is
  'Never client-written and never set directly for awarded/completed: those two are side effects of the assignment lifecycle. app.jobs_status_transition_guard() enforces the legal edges even against a buggy RPC.';

create index ix_jobs_poster_org_status on public.jobs (poster_org_id, status);
-- Discovery's hot path: open jobs by trade, newest first.
create index ix_jobs_open_trade on public.jobs (trade_id, published_at desc)
  where status = 'open';
create index ix_jobs_created_by on public.jobs (created_by);

create trigger set_jobs_updated_at
  before update on public.jobs
  for each row execute function app.set_updated_at();

-- ===========================================================================
-- 5. public.job_applications — the candidacy
-- ===========================================================================
create table public.job_applications (
  id                uuid primary key default extensions.gen_random_uuid(),
  job_id            uuid not null references public.jobs (id) on delete cascade,

  -- A USER, never an organization. This column is the point of the domain: an
  -- installer applies as themselves, and applying creates no membership, no
  -- capability, no branch scope and no workspace in the posting organization —
  -- before, during or after the work (§10.1).
  applicant_user_id uuid not null references public.users (id) on delete cascade,

  -- Applicant-authored free text. Never parsed as an amount: there is no
  -- counter-offer in the Pilot, and a note that could be read as one would be a
  -- negotiation channel wearing a comment box's clothes (§5.3).
  note              text,

  status            public.job_application_status not null default 'submitted',

  decided_by        uuid references public.users (id) on delete set null,
  decided_at        timestamptz,
  decision_reason   text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- The idempotency identity (§12.1). A retry or a second tap never queues a
  -- duplicate candidacy; it returns the one that already exists.
  constraint uq_job_applications_job_applicant unique (job_id, applicant_user_id),
  constraint ck_job_app_note_len check (note is null or char_length(note) <= 1000),
  constraint ck_job_app_reason_len check (
    decision_reason is null or char_length(decision_reason) <= 500),
  -- A decision without an actor and a time is an unattributable decision.
  constraint ck_job_app_decision_stamp check (
    (status = 'submitted' and decided_by is null and decided_at is null)
    or (status = 'withdrawn' and decided_by is null)
    or (status in ('accepted', 'rejected') and decided_by is not null and decided_at is not null)),
  -- Mirrors ck_ref_reject_reason: a refusal the person cannot read is a refusal
  -- they cannot act on.
  constraint ck_job_app_reject_reason check (
    status <> 'rejected' or (decision_reason is not null and char_length(btrim(decision_reason)) > 0))
);

comment on table public.job_applications is
  'An individual installer''s candidacy for one job. Durable evidence of who applied, when and on what terms — which is why the engagement lives in job_assignments and never overwrites this row. An applicant NEVER sees a competing application: no policy branch, view or RPC returns another user''s candidacy.';
comment on column public.job_applications.note is
  'Applicant free text. Never a counter-offer and never parsed as an amount (§5.3).';

create index ix_job_applications_job_status on public.job_applications (job_id, status);
create index ix_job_applications_applicant on public.job_applications (applicant_user_id, created_at desc);

create trigger set_job_applications_updated_at
  before update on public.job_applications
  for each row execute function app.set_updated_at();

-- ===========================================================================
-- 6. public.job_assignments — the engagement
--
-- A separate table rather than a status column on the application, for four
-- reasons that do not overlap: different transition owners, auditability of the
-- application as submitted, a rating anchor whose every row is a real
-- engagement by construction, and re-assignability after cancellation without
-- corrupting the first applicant's history (§3.0).
-- ===========================================================================
create table public.job_assignments (
  id                       uuid primary key default extensions.gen_random_uuid(),
  job_id                   uuid not null references public.jobs (id) on delete cascade,

  -- Provenance. `restrict`, so deleting a candidacy can never orphan work.
  application_id           uuid not null references public.job_applications (id) on delete restrict,

  -- Both parties DENORMALISED from the authoritative rows, written exactly once
  -- by job_application_accept and unreachable by any UPDATE path. This is the
  -- conversations two-party precedent: it makes every policy on this table and
  -- on job_progress_updates a flat column check instead of a join, and it is
  -- what keeps the installer's read of their own work OFF any org predicate.
  installer_user_id        uuid not null references public.users (id) on delete restrict,
  poster_org_id            uuid not null references public.organizations (id) on delete cascade,

  -- The offer as accepted, frozen. The job's own columns are already immutable
  -- once an application exists, so this is belt and braces — but a work record
  -- that has to join back to a live row to say what was agreed is a work record
  -- that changes meaning when someone edits the job.
  agreed_amount            numeric(12,2) not null,
  agreed_currency          text not null default 'EGP',

  status                   public.job_assignment_status not null default 'scheduled',

  -- Maintained by job_progress_add in the same transaction — the
  -- conversations.last_message_at precedent. NEVER client-written.
  latest_progress_percent  smallint not null default 0,
  last_progress_at         timestamptz,

  version                  integer not null default 1,
  started_at               timestamptz,
  completed_at             timestamptz,
  cancelled_at             timestamptz,
  cancellation_reason      text,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- One engagement per accepted candidacy.
  constraint uq_job_assignments_application unique (application_id),
  constraint ck_job_assignment_progress_range check (
    latest_progress_percent between 0 and 100),
  constraint ck_job_assignment_agreed_positive check (agreed_amount > 0),
  constraint ck_job_assignment_agreed_currency check (agreed_currency = 'EGP'),
  constraint ck_job_assignment_cancel_reason check (
    status <> 'cancelled'
    or (cancellation_reason is not null and char_length(btrim(cancellation_reason)) > 0)),
  constraint ck_job_assignment_cancel_reason_len check (
    cancellation_reason is null or char_length(cancellation_reason) <= 500)
);

-- THE invariant of this domain, and it is an index rather than a check because
-- an index is enforced across concurrent transactions and a check is not. Two
-- simultaneous accepts on two different applications for one job: the second
-- one's INSERT collides here and its whole transaction rolls back. Never a
-- double award, regardless of what the RPC above it does. Excluding cancelled
-- rows is what makes awarded -> open re-assignable.
create unique index ux_job_assignments_active_job
  on public.job_assignments (job_id) where status <> 'cancelled';

comment on table public.job_assignments is
  'The bilateral engagement created by accepting one application. Completion authority is the POSTING ORGANIZATION, never the installer (§3.5). ux_job_assignments_active_job is the race-safe one-active-assignment invariant; it excludes cancelled rows so a cancelled engagement returns the job to the pool.';
comment on column public.job_assignments.installer_user_id is
  'The assigned individual. Every installer-side read in this domain is granted by THIS column against auth.uid(), never by an organization predicate. A refactor that "simplifies" the two into one org-membership check would silently hand installers tenant reads (§10.6).';
comment on column public.job_assignments.agreed_amount is
  'The offer as accepted, frozen at award time. Disclosure only — no payment of any kind is asserted, recorded or implied (§5.2).';
comment on column public.job_assignments.latest_progress_percent is
  'Denormalised from the append-only progress history by job_progress_add, in the same transaction. Never client-written and never an authority input — reaching 100 is the installer''s CLAIM, not a completion.';

create index ix_job_assignments_installer on public.job_assignments (installer_user_id, status);
create index ix_job_assignments_org_status on public.job_assignments (poster_org_id, status);

create trigger set_job_assignments_updated_at
  before update on public.job_assignments
  for each row execute function app.set_updated_at();

-- ===========================================================================
-- 7. public.job_progress_updates — the installer's channel, append-only
--
-- History, not a feed. Mirrors audit_log and points_ledger: no client
-- UPDATE/DELETE grant and app.forbid_mutation() behind it, so a progress claim
-- cannot be revised after the other party has read it.
--
-- NO MEDIA COLUMN, and none may be added before the storage foundation exists
-- (D5). A `photo_url text` here would be exactly the temporary-public-URL field
-- that foundation was written to prevent.
-- ===========================================================================
create table public.job_progress_updates (
  id               uuid primary key default extensions.gen_random_uuid(),
  assignment_id    uuid not null references public.job_assignments (id) on delete cascade,
  author_user_id   uuid not null references public.users (id) on delete restrict,
  progress_percent smallint not null,
  stage            text,
  note             text,
  created_at       timestamptz not null default now(),

  constraint ck_job_progress_range check (progress_percent between 0 and 100),
  constraint ck_job_progress_stage_len check (stage is null or char_length(stage) <= 80),
  constraint ck_job_progress_note_len check (note is null or char_length(note) <= 1000)
);

comment on table public.job_progress_updates is
  'Append-only progress history authored by the assigned installer. Reaching 100 percent is a CLAIM of readiness that the posting organization then confirms — the installer never completes their own commercial work record. Bilateral and never public (§11). No media column before the storage foundation (D5).';

create index ix_job_progress_assignment on public.job_progress_updates (assignment_id, created_at desc);

create trigger job_progress_updates_no_update
  before update on public.job_progress_updates
  for each row execute function app.forbid_mutation();
create trigger job_progress_updates_no_delete
  before delete on public.job_progress_updates
  for each row execute function app.forbid_mutation();

-- ===========================================================================
-- 8. Structural guards — the invariants that survive a buggy write path
--
-- Every one of these duplicates a check an RPC already performs. That is the
-- intent: the RPC gives a clear error, and the trigger makes the rule true even
-- if a future write path forgets it. The precedent is
-- app.organizations_provenance_immutable().
-- ===========================================================================

-- 8a. The offer freezes on first contact (O7, §5.3).
--
-- Extended beyond §5.3's two columns to include `trade_id`, on the same
-- reasoning: an applicant consented to a stated amount FOR A STATED TRADE, and
-- silently moving either afterwards makes every application a bid on something
-- that no longer exists. Changing the offer means closing the job and creating
-- a new one. That is not a workaround; it is the point.
create or replace function app.jobs_offer_immutable_after_application()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.offered_amount is distinct from old.offered_amount
      or new.offered_currency is distinct from old.offered_currency
      or new.trade_id is distinct from old.trade_id)
     and exists (select 1 from public.job_applications a where a.job_id = old.id)
  then
    raise exception
      'the offer and trade of a job with applications cannot change; close it and post a new one'
      using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function app.jobs_offer_immutable_after_application() from public;

create trigger jobs_offer_immutable
  before update on public.jobs
  for each row execute function app.jobs_offer_immutable_after_application();

-- 8b. The job lifecycle graph.
--
-- There is no client UPDATE grant, so this cannot catch a browser. It catches
-- US: a future RPC that sets `completed` from `open`, or reopens a `closed`
-- job, fails here rather than producing a job whose history is not a path.
create or replace function app.jobs_status_transition_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if not (
       (old.status = 'draft'   and new.status in ('open', 'cancelled'))
    or (old.status = 'open'    and new.status in ('awarded', 'closed', 'cancelled'))
    -- awarded -> open is the assignment being cancelled: the opening returns to
    -- the pool. It never returns to `closed`, which would be a job that had
    -- stopped recruiting still holding a live offer.
    --
    -- AND THERE IS NO awarded -> cancelled. An awarded job has a person holding
    -- live work on it, and cancelling the opening out from under them in one
    -- step makes the assignment's own cancellation a side effect nobody
    -- explicitly performed — with no reason attached to the record the
    -- installer will later read. The engagement must be ended first, on its own
    -- terms and with its own reason (assignment -> cancelled, job -> open); only
    -- then is there an unawarded opening to call off.
    or (old.status = 'awarded' and new.status in ('completed', 'open'))
  ) then
    raise exception 'illegal job transition % -> %', old.status, new.status
      using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function app.jobs_status_transition_guard() from public;

create trigger jobs_status_transition
  before update on public.jobs
  for each row execute function app.jobs_status_transition_guard();

-- 8c. A DECIDED application is final. A withdrawn one is not.
--
-- `accepted` and `rejected` are decisions the POSTER made, and reversing either
-- from the applicant's side would let someone re-enter a competition they were
-- already told they had lost. `withdrawn` is the applicant's own act about their
-- own availability, and undoing it costs nobody anything — so exactly one edge
-- out of a non-submitted state exists, and it is that one.
create or replace function app.job_applications_status_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if old.status = 'withdrawn' and new.status = 'submitted' then
    return new;
  end if;
  if old.status <> 'submitted' then
    raise exception 'a % application is final and cannot become %', old.status, new.status
      using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function app.job_applications_status_guard() from public;

create trigger job_applications_status_transition
  before update on public.job_applications
  for each row execute function app.job_applications_status_guard();

-- 8d. The assignment lifecycle graph.
create or replace function app.job_assignments_status_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if not (
       (old.status = 'scheduled'   and new.status in ('in_progress', 'cancelled'))
    or (old.status = 'in_progress' and new.status in ('completed', 'cancelled'))
  ) then
    raise exception 'illegal assignment transition % -> %', old.status, new.status
      using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function app.job_assignments_status_guard() from public;

create trigger job_assignments_status_transition
  before update on public.job_assignments
  for each row execute function app.job_assignments_status_guard();

-- ===========================================================================
-- 9. Poster-side authority helpers
--
-- Internal only. RLS policy expressions run with the INVOKER's privileges, so
-- the SELECT policies below inline app.has_capability / app.is_org_member
-- rather than calling these — the chat_core precedent.
-- ===========================================================================
create or replace function app.can_post_job(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_capability(p_org_id, 'job.post') or app.has_capability(p_org_id, 'org.manage');
$$;

create or replace function app.can_manage_job(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_capability(p_org_id, 'job.manage') or app.has_capability(p_org_id, 'org.manage');
$$;

-- The one place verification is asked about. Publishing and NEW applications
-- consult it; every other write path deliberately does not, so work already
-- under way survives a lapse untouched.
create or replace function app.job_poster_is_discoverable(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organizations o
    where o.id = p_org_id
      and o.is_verified
      and o.deleted_at is null
      and o.status = 'active'::public.org_status
  );
$$;

comment on function app.job_poster_is_discoverable(uuid) is
  'Live verification/liveness of a posting organization. Read at publish time and at every NEW application, and NEVER cached onto jobs: a denormalised copy would keep a suppressed job visible after a lapse and keep a re-verified org''s jobs buried after a restore. Accept, reject, start, progress, complete and cancel deliberately do not call this (O1, §10.3).';

revoke execute on function app.can_post_job(uuid), app.can_manage_job(uuid),
  app.job_poster_is_discoverable(uuid) from public;
grant execute on function app.can_post_job(uuid), app.can_manage_job(uuid),
  app.job_poster_is_discoverable(uuid) to authenticated;

-- ===========================================================================
-- 10. RLS — SELECT policies only. There is no INSERT/UPDATE/DELETE policy on
--     any table in this domain, and no client DML grant to make one reachable.
-- ===========================================================================
alter table public.jobs                 enable row level security;
alter table public.job_applications     enable row level security;
alter table public.job_assignments      enable row level security;
alter table public.job_progress_updates enable row level security;

-- jobs: the poster org, the ASSIGNED installer, platform staff. Note what is
-- absent — an applicant. Their candidacy does not open the base row, because
-- the base row carries site_address, which §11 withholds until assignment. An
-- applicant reads their own candidacy through public.my_job_applications.
create policy jobs_select_poster_org on public.jobs
  for select to authenticated using (app.is_org_member(poster_org_id));

create policy jobs_select_assigned_installer on public.jobs
  for select to authenticated using (
    exists (
      select 1 from public.job_assignments a
      where a.job_id = jobs.id
        and a.installer_user_id = (select auth.uid())
        and a.status <> 'cancelled'
    )
  );

create policy jobs_select_platform on public.jobs
  for select to authenticated using (app.is_platform('support'));

-- job_applications: the applicant sees THEIR OWN row and no other. The poster
-- org sees the candidacies for its own jobs.
create policy job_applications_select_applicant on public.job_applications
  for select to authenticated using (applicant_user_id = (select auth.uid()));

create policy job_applications_select_poster_org on public.job_applications
  for select to authenticated using (
    exists (
      select 1 from public.jobs j
      where j.id = job_applications.job_id
        and app.is_org_member(j.poster_org_id)
    )
  );

create policy job_applications_select_platform on public.job_applications
  for select to authenticated using (app.is_platform('support'));

-- job_assignments: flat column checks, thanks to the denormalised parties.
create policy job_assignments_select_installer on public.job_assignments
  for select to authenticated using (installer_user_id = (select auth.uid()));

create policy job_assignments_select_poster_org on public.job_assignments
  for select to authenticated using (app.is_org_member(poster_org_id));

create policy job_assignments_select_platform on public.job_assignments
  for select to authenticated using (app.is_platform('support'));

-- job_progress_updates: the two parties of the parent assignment. Bilateral,
-- never public.
create policy job_progress_select_parties on public.job_progress_updates
  for select to authenticated using (
    exists (
      select 1 from public.job_assignments a
      where a.id = job_progress_updates.assignment_id
        and (a.installer_user_id = (select auth.uid()) or app.is_org_member(a.poster_org_id))
    )
  );

create policy job_progress_select_platform on public.job_progress_updates
  for select to authenticated using (app.is_platform('support'));

-- ===========================================================================
-- 11. Grants — SELECT and nothing else
--
-- Stripping Supabase's defaults first (a TRUNCATE bypasses RLS), then granting
-- back exactly the intended access. service_role gets SELECT too and no DML:
-- the trusted backend has no business writing this domain outside its RPCs.
-- ===========================================================================
revoke all on public.jobs, public.job_applications, public.job_assignments,
  public.job_progress_updates from anon, authenticated, service_role;

grant select on public.jobs                 to authenticated, service_role;
grant select on public.job_applications     to authenticated, service_role;
grant select on public.job_assignments      to authenticated, service_role;
grant select on public.job_progress_updates to authenticated, service_role;

-- ===========================================================================
-- 12. Read seams for Increments 8 and 9
--
-- Two constrained projections, each a security_invoker view over a
-- SECURITY DEFINER reader — the profile_public_directory pattern. Preferred
-- over widening the base-table policy because a base-table grant exposes every
-- FUTURE column to the whole installer pool by default, whereas a view exposes
-- exactly what it names.
-- ===========================================================================

-- 12a. Discovery. Open jobs from currently-verified posters, plus whether the
-- CALLER has already applied. Anonymous discovery is not implied by the Pilot
-- auth model, so the reader returns nothing without an authenticated caller.
create function app._open_job_opportunities()
returns table (
  id                     uuid,
  title                  text,
  description            text,
  trade_key              text,
  offered_amount         numeric(12,2),
  offered_currency       text,
  governorate            text,
  city                   text,
  expected_duration_days smallint,
  starts_on              date,
  ends_by                date,
  published_at           timestamptz,
  poster_org_id          uuid,
  poster_org_name        text,
  has_applied            boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select j.id, j.title, j.description, t.key,
         j.offered_amount, j.offered_currency,
         j.governorate, j.city,
         j.expected_duration_days, j.starts_on, j.ends_by,
         j.published_at,
         o.id, o.name,
         exists (
           select 1 from public.job_applications a
           where a.job_id = j.id and a.applicant_user_id = (select auth.uid())
         )
  from public.jobs j
  join public.trades t on t.id = j.trade_id
  -- The live verification join. THIS is what makes suppression derived: no row
  -- is rewritten when verification lapses, the job simply stops matching.
  join public.organizations o
    on o.id = j.poster_org_id
   and o.is_verified
   and o.deleted_at is null
   and o.status = 'active'::public.org_status
  where j.status = 'open'
    and (select auth.uid()) is not null;
$$;

comment on function app._open_job_opportunities() is
  'Internal SECURITY DEFINER reader backing public.open_job_opportunities. Open jobs whose posting organization is CURRENTLY verified, active and not deleted, projecting display columns only. Never site_address, never a draft, never poster-side management metadata (version, created_by, closed_at), and never another user''s application. has_applied is computed for the CALLER. Returns nothing to an anonymous caller. It applies NO trade filter (O5): filtering is the query''s choice, at the caller''s discretion, never this projection''s gate.';

revoke execute on function app._open_job_opportunities() from public;
grant  execute on function app._open_job_opportunities() to authenticated, service_role;

create view public.open_job_opportunities with (security_invoker = true) as
  select id, title, description, trade_key, offered_amount, offered_currency,
         governorate, city, expected_duration_days, starts_on, ends_by,
         published_at, poster_org_id, poster_org_name, has_applied
  from app._open_job_opportunities();

comment on view public.open_job_opportunities is
  'Approved discovery projection of open jobs for the installer pool. security_invoker=true view over the constrained SECURITY DEFINER reader app._open_job_opportunities(). A job appears only while its poster is verified; losing verification removes it with no row rewritten and no cascade, and regaining verification restores it with no backfill. Excludes site_address (§11). Authenticated callers only — there is no anonymous job board.';

revoke all on public.open_job_opportunities from anon, authenticated, service_role;
grant select on public.open_job_opportunities to authenticated, service_role;

-- 12b. The applicant's own candidacies, with enough of the job to be legible.
-- An application row on its own is a job_id and a status, which is not a
-- record a person can read. This is the smallest projection that makes it one,
-- and it is scoped to auth.uid() inside the reader — there is no parameter to
-- point at somebody else.
create function app._my_job_applications()
returns table (
  id               uuid,
  job_id           uuid,
  status           public.job_application_status,
  note             text,
  created_at       timestamptz,
  decided_at       timestamptz,
  decision_reason  text,
  job_title        text,
  trade_key        text,
  offered_amount   numeric(12,2),
  offered_currency text,
  governorate      text,
  city             text,
  job_status       public.job_status,
  poster_org_name  text
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.job_id, a.status, a.note, a.created_at, a.decided_at, a.decision_reason,
         j.title, t.key, j.offered_amount, j.offered_currency,
         j.governorate, j.city, j.status, o.name
  from public.job_applications a
  join public.jobs j on j.id = a.job_id
  join public.trades t on t.id = j.trade_id
  join public.organizations o on o.id = j.poster_org_id
  where a.applicant_user_id = (select auth.uid())
    and (select auth.uid()) is not null;
$$;

comment on function app._my_job_applications() is
  'Internal SECURITY DEFINER reader backing public.my_job_applications. The CALLER''s own candidacies joined to the display half of the job. Scoped to auth.uid() with no parameter, so it cannot be pointed at another applicant. Never site_address (the applicant is not assigned), never a competing application, never poster-side management metadata. Unlike discovery it does NOT filter on verification: a candidacy already submitted stays fully readable if the poster later loses verification.';

revoke execute on function app._my_job_applications() from public;
grant  execute on function app._my_job_applications() to authenticated, service_role;

create view public.my_job_applications with (security_invoker = true) as
  select id, job_id, status, note, created_at, decided_at, decision_reason,
         job_title, trade_key, offered_amount, offered_currency,
         governorate, city, job_status, poster_org_name
  from app._my_job_applications();

comment on view public.my_job_applications is
  'The caller''s own job applications with the display half of each job. security_invoker=true over app._my_job_applications(). Exists because the base-table policy on jobs deliberately excludes applicants — site_address is withheld until assignment (§11) — so an applicant needs a projection to read their own candidacy as a record rather than as a uuid.';

revoke all on public.my_job_applications from anon, authenticated, service_role;
grant select on public.my_job_applications to authenticated, service_role;

-- ===========================================================================
-- 13. Write paths
--
-- Every one is SECURITY DEFINER with set search_path = ''. None takes a user
-- id: the actor is auth.uid(), so acting as somebody else is unexpressible
-- rather than merely refused. None takes an organization id where the target
-- row already names one.
-- ===========================================================================

-- 13a. job_create — draft only. Gated purely by capability, with NO org_type
-- restriction and NO verification check: any organization may DRAFT a job.
-- Verification gates discoverability, never workspace access (§10.3).
create or replace function public.job_create(
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
  p_branch_id              uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := app.require_verified_caller();
  v_trade_id uuid;
  v_id       uuid;
begin
  if not app.is_org_member(p_org_id) then
    raise exception 'not a member of the posting organization' using errcode = '42501';
  end if;
  if not app.can_post_job(p_org_id) then
    raise exception 'job.post required' using errcode = '42501';
  end if;
  -- NOT `status = 'active'`. Everywhere else in this repository that literal is
  -- a DISCOVERABILITY condition — the public directory and the catalog
  -- projection use it, and both are about being surfaced. Using it here would
  -- turn it into a workspace gate and lock an organization in
  -- `pending_verification` out of drafting, which is the exact line §10.3 says
  -- verification must never cross. A suspended or archived organization is a
  -- different matter: it should not be recruiting anybody.
  if not exists (
    select 1 from public.organizations o
    where o.id = p_org_id
      and o.deleted_at is null
      and o.status not in ('suspended'::public.org_status, 'archived'::public.org_status)
  ) then
    raise exception 'the organization cannot post work' using errcode = '22023';
  end if;

  -- A job must name an ACTIVE trade. Enforced here rather than by a constraint,
  -- because retiring a trade must leave every historical job intact (§9).
  select t.id into v_trade_id
  from public.trades t where t.key = btrim(coalesce(p_trade_key, '')) and t.is_active;
  if v_trade_id is null then
    raise exception 'unknown or retired trade' using errcode = '22023';
  end if;

  insert into public.jobs (
    poster_org_id, poster_branch_id, title, description, trade_id,
    offered_amount, governorate, city, site_address,
    expected_duration_days, starts_on, ends_by, created_by)
  values (
    p_org_id, p_branch_id, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), v_trade_id,
    p_offered_amount, nullif(btrim(coalesce(p_governorate, '')), ''), nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_site_address, '')), ''),
    p_expected_duration_days, p_starts_on, p_ends_by, v_uid)
  returning id into v_id;

  perform app.record_audit_event('job.created', 'job', v_id, p_org_id,
    jsonb_build_object('trade_key', p_trade_key, 'status', 'draft'));
  return v_id;
end;
$$;

-- 13b. job_update — content edits, state-scoped.
--
-- draft: everything. open: everything EXCEPT the offer and the trade once an
-- application exists (checked here for a clear error, and enforced regardless
-- by app.jobs_offer_immutable_after_application). awarded / completed / closed
-- / cancelled: nothing — the contract is settled, and the only remaining moves
-- are the lifecycle authorities.
create or replace function public.job_update(
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
  p_ends_by                date default null
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_j        public.jobs;
  v_trade_id uuid;
  v_has_apps boolean;
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

  select t.id into v_trade_id
  from public.trades t where t.key = btrim(coalesce(p_trade_key, '')) and t.is_active;
  if v_trade_id is null then
    raise exception 'unknown or retired trade' using errcode = '22023';
  end if;

  v_has_apps := exists (select 1 from public.job_applications a where a.job_id = p_job_id);
  if v_has_apps and (p_offered_amount <> v_j.offered_amount or v_trade_id <> v_j.trade_id) then
    raise exception
      'the offer and trade cannot change once someone has applied; close this job and post a new one'
      using errcode = '22023';
  end if;

  update public.jobs set
    title                  = btrim(p_title),
    description            = nullif(btrim(coalesce(p_description, '')), ''),
    trade_id               = v_trade_id,
    offered_amount         = p_offered_amount,
    governorate            = nullif(btrim(coalesce(p_governorate, '')), ''),
    city                   = nullif(btrim(coalesce(p_city, '')), ''),
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

-- 13c. job_publish — draft -> open. The ONE poster-side path that asks about
-- verification, because this is the moment a job becomes discoverable.
create or replace function public.job_publish(p_job_id uuid, p_expected_version integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_j public.jobs;
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
  if v_j.status <> 'draft' then
    raise exception 'only a draft job can be published' using errcode = '22023';
  end if;
  if v_j.version <> p_expected_version then
    raise exception 'job was modified concurrently' using errcode = '40001';
  end if;
  if not app.job_poster_is_discoverable(v_j.poster_org_id) then
    raise exception 'the organization must be verified to publish a job' using errcode = '42501';
  end if;
  -- Re-checked at publish, not only at create: a trade can retire while a draft
  -- sits, and publishing is when the job enters the pool under that label.
  if not exists (select 1 from public.trades t where t.id = v_j.trade_id and t.is_active) then
    raise exception 'the job''s trade is no longer available' using errcode = '22023';
  end if;

  update public.jobs
    set status = 'open', published_at = now(), version = version + 1
  where id = p_job_id;

  perform app.record_audit_event('job.published', 'job', p_job_id, v_j.poster_org_id,
    jsonb_build_object('from', 'draft', 'to', 'open'));
  return v_j.version + 1;
end;
$$;

-- 13d. job_close — open -> closed. The manual end of recruiting for an
-- UNAWARDED job (O4). There is no reopen path: a reopened job with a stale
-- offer and stale applications is exactly the ambiguity O7 closes.
create or replace function public.job_close(p_job_id uuid, p_expected_version integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_j public.jobs;
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
  if v_j.status <> 'open' then
    raise exception 'only an open job can be closed' using errcode = '22023';
  end if;
  if v_j.version <> p_expected_version then
    raise exception 'job was modified concurrently' using errcode = '40001';
  end if;

  update public.jobs
    set status = 'closed', closed_at = now(), version = version + 1
  where id = p_job_id;

  -- Applications already submitted are PRESERVED and stay readable by both
  -- parties. Closing recruits nobody new; it does not erase who applied.
  perform app.record_audit_event('job.closed', 'job', p_job_id, v_j.poster_org_id,
    jsonb_build_object('from', 'open', 'to', 'closed'));
  return v_j.version + 1;
end;
$$;

-- 13e. job_cancel — draft/open -> cancelled. Calls off an opening that nobody
-- is currently working.
--
-- AN AWARDED JOB CANNOT BE CANCELLED HERE. Ending an engagement is a distinct
-- act with a distinct authority and its own required reason, and collapsing it
-- into "cancel the job" would end somebody's live work as an unnamed side
-- effect. The poster cancels the assignment first (job_assignment_cancel, which
-- returns the job to `open`), and then cancels the opening if they still want
-- to. Two deliberate acts, two reasons on the record, in the order the installer
-- experiences them.
create or replace function public.job_cancel(
  p_job_id uuid, p_expected_version integer, p_reason text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_j      public.jobs;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
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
    raise exception
      'a % job cannot be cancelled; cancel its assignment first, which returns it to open',
      v_j.status using errcode = '22023';
  end if;
  if v_j.version <> p_expected_version then
    raise exception 'job was modified concurrently' using errcode = '40001';
  end if;

  update public.jobs
    set status = 'cancelled', closed_at = now(), version = version + 1
  where id = p_job_id;

  perform app.record_audit_event('job.cancelled', 'job', p_job_id, v_j.poster_org_id,
    jsonb_build_object('from', v_j.status, 'to', 'cancelled'));
  return v_j.version + 1;
end;
$$;

-- 13f. job_application_submit — the installer side.
--
-- Two authority inputs and NO third. The persona gate is the first write path
-- in the repository whose permission derives from the personal professional
-- identity, and the verification check reads the poster's LIVE row.
--
-- It performs NO TRADE CHECK (O5). Adding one would convert a profile signal
-- into an access rule, and a tiler who has done gypsum work before is the
-- platform's problem to inform, not to forbid.
create or replace function public.job_application_submit(
  p_job_id uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := app.require_verified_caller();
  v_j      public.jobs;
  v_id     uuid;
  v_status public.job_application_status;
begin
  if not app.is_professional_persona(v_uid) then
    raise exception 'a professional account is required to apply for work'
      using errcode = '42501';
  end if;

  -- Locked before the existence check so an apply cannot land on a job being
  -- awarded or cancelled concurrently. Jobs first, then the child row — the
  -- lock order every write path in this file keeps.
  select * into v_j from public.jobs where id = p_job_id for update;
  if not found then raise exception 'job not found' using errcode = '22023'; end if;

  select a.id, a.status into v_id, v_status from public.job_applications a
   where a.job_id = p_job_id and a.applicant_user_id = v_uid
   for update;

  -- `submitted` is idempotent (§12.1): a retry or a second tap returns the
  -- candidacy that already exists rather than erroring or queueing a duplicate.
  -- `accepted` and `rejected` are DECIDED, and return unchanged — the caller
  -- gets their own row back and can read what happened to it. Neither is
  -- resubmittable: a rejected applicant does not re-enter a reopened job by
  -- tapping Apply again.
  if v_id is not null and v_status <> 'withdrawn' then
    return v_id;
  end if;

  -- From here the caller is either applying for the first time or returning
  -- from a withdrawal, and BOTH pass the same two gates. A withdrawal that
  -- could be undone on a closed job, or against a poster who has since lost
  -- verification, would be a way back in that a first-time applicant does not
  -- have.
  if v_j.status <> 'open' then
    raise exception 'this job is not accepting applications' using errcode = '22023';
  end if;
  if not app.job_poster_is_discoverable(v_j.poster_org_id) then
    raise exception 'this job is not currently open to applications' using errcode = '22023';
  end if;

  if v_id is not null then
    -- THE SAME ROW returns to `submitted`, atomically, under the job lock taken
    -- above. Reusing it rather than inserting a second is what keeps
    -- uq_job_applications_job_applicant meaningful and keeps `created_at` — the
    -- honest record of when this person first put their name forward.
    update public.job_applications set
      status          = 'submitted',
      note            = nullif(btrim(coalesce(p_note, '')), ''),
      decided_by      = null,
      decided_at      = null,
      decision_reason = null
    where id = v_id;

    perform app.record_audit_event('job.application.submitted', 'job_application', v_id,
      v_j.poster_org_id, jsonb_build_object('job_id', p_job_id, 'resubmitted', true));
    return v_id;
  end if;

  insert into public.job_applications (job_id, applicant_user_id, note)
  values (p_job_id, v_uid, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;

  perform app.record_audit_event('job.application.submitted', 'job_application', v_id,
    v_j.poster_org_id, jsonb_build_object('job_id', p_job_id));
  return v_id;
end;
$$;

-- 13g. job_application_withdraw — the applicant's own candidacy, and only theirs.
create or replace function public.job_application_withdraw(p_application_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_verified_caller();
  v_a   public.job_applications;
  v_org uuid;
begin
  select * into v_a from public.job_applications where id = p_application_id for update;
  if not found then raise exception 'application not found' using errcode = '22023'; end if;
  if v_a.applicant_user_id <> v_uid then
    raise exception 'only the applicant may withdraw an application' using errcode = '42501';
  end if;
  if v_a.status <> 'submitted' then
    raise exception 'a % application cannot be withdrawn', v_a.status using errcode = '22023';
  end if;

  update public.job_applications set status = 'withdrawn' where id = p_application_id;

  select poster_org_id into v_org from public.jobs where id = v_a.job_id;
  perform app.record_audit_event('job.application.withdrawn', 'job_application',
    p_application_id, v_org, jsonb_build_object('job_id', v_a.job_id));
end;
$$;

-- 13h. job_application_reject — poster side. NO verification check: decisions
-- on applications that already exist survive a verification lapse (O1).
create or replace function public.job_application_reject(
  p_application_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := app.require_verified_caller();
  v_a      public.job_applications;
  v_j      public.jobs;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is null then
    raise exception 'a reason is required to reject an application' using errcode = '22023';
  end if;
  select * into v_a from public.job_applications where id = p_application_id for update;
  if not found then raise exception 'application not found' using errcode = '22023'; end if;
  select * into v_j from public.jobs where id = v_a.job_id;
  if not app.is_org_member(v_j.poster_org_id) then
    raise exception 'not a member of the posting organization' using errcode = '42501';
  end if;
  if not app.can_manage_job(v_j.poster_org_id) then
    raise exception 'job.manage required' using errcode = '42501';
  end if;
  if v_a.status <> 'submitted' then
    raise exception 'a % application cannot be rejected', v_a.status using errcode = '22023';
  end if;

  update public.job_applications set
    status = 'rejected', decided_by = v_uid, decided_at = now(), decision_reason = v_reason
  where id = p_application_id;

  perform app.record_audit_event('job.application.rejected', 'job_application',
    p_application_id, v_j.poster_org_id, jsonb_build_object('job_id', v_a.job_id));
end;
$$;

-- 13i. job_application_accept — the atomic award.
--
-- Six things happen or none do: the job is confirmed open, the application
-- confirmed submitted, the poster's authority confirmed, the assignment
-- created, every sibling candidacy auto-rejected, and the job moved to
-- awarded. Leaving losing candidacies open would show an installer a live
-- application against an already-awarded job — a lie the model can prevent.
--
-- Race safety is NOT this function's doing: the job row is locked, but the real
-- guarantee is ux_job_assignments_active_job. Two concurrent accepts on two
-- applications collide on that index and the second transaction rolls back
-- whole. Never a double award.
create or replace function public.job_application_accept(p_application_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_verified_caller();
  v_a   public.job_applications;
  v_j   public.jobs;
  v_id  uuid;
begin
  -- LOCK ORDER: jobs, then the child row. Every write path in this file takes
  -- its locks in that order, which is what makes the cancel paths unable to
  -- deadlock against each other. Reading the application unlocked first is only
  -- to learn which job to lock; it is re-read FOR UPDATE below before any
  -- decision is made on it.
  select job_id into v_id from public.job_applications where id = p_application_id;
  if v_id is null then raise exception 'application not found' using errcode = '22023'; end if;
  select * into v_j from public.jobs where id = v_id for update;
  select * into v_a from public.job_applications where id = p_application_id for update;
  v_id := null;

  if not app.is_org_member(v_j.poster_org_id) then
    raise exception 'not a member of the posting organization' using errcode = '42501';
  end if;
  if not app.can_manage_job(v_j.poster_org_id) then
    raise exception 'job.manage required' using errcode = '42501';
  end if;

  -- Idempotent (§12.2): accepting an already-accepted application returns the
  -- assignment it already produced, as showroom_referral_approve returns the
  -- organization it already created.
  if v_a.status = 'accepted' then
    select id into v_id from public.job_assignments where application_id = p_application_id;
    if v_id is not null then return v_id; end if;
  end if;

  if v_a.status <> 'submitted' then
    raise exception 'a % application cannot be accepted', v_a.status using errcode = '22023';
  end if;
  if v_j.status <> 'open' then
    raise exception 'only an open job can be awarded' using errcode = '22023';
  end if;

  update public.job_applications set
    status = 'accepted', decided_by = v_uid, decided_at = now()
  where id = p_application_id;

  -- Every sibling still in the running is closed with a system reason.
  update public.job_applications set
    status = 'rejected', decided_by = v_uid, decided_at = now(),
    decision_reason = 'the job was awarded to another applicant'
  where job_id = v_a.job_id and id <> p_application_id and status = 'submitted';

  insert into public.job_assignments (
    job_id, application_id, installer_user_id, poster_org_id,
    agreed_amount, agreed_currency)
  values (
    v_a.job_id, p_application_id, v_a.applicant_user_id, v_j.poster_org_id,
    v_j.offered_amount, v_j.offered_currency)
  returning id into v_id;

  update public.jobs set status = 'awarded', version = version + 1 where id = v_a.job_id;

  perform app.record_audit_event('job.application.accepted', 'job_application',
    p_application_id, v_j.poster_org_id,
    jsonb_build_object('job_id', v_a.job_id, 'assignment_id', v_id));
  return v_id;
end;
$$;

-- 13j. job_assignment_start — scheduled -> in_progress. The installer's move.
create or replace function public.job_assignment_start(
  p_assignment_id uuid, p_expected_version integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_verified_caller();
  v_a   public.job_assignments;
begin
  select * into v_a from public.job_assignments where id = p_assignment_id for update;
  if not found then raise exception 'assignment not found' using errcode = '22023'; end if;
  if v_a.installer_user_id <> v_uid then
    raise exception 'only the assigned installer may start this work' using errcode = '42501';
  end if;
  if v_a.status <> 'scheduled' then
    raise exception 'a % assignment cannot be started', v_a.status using errcode = '22023';
  end if;
  if v_a.version <> p_expected_version then
    raise exception 'assignment was modified concurrently' using errcode = '40001';
  end if;

  update public.job_assignments
    set status = 'in_progress', started_at = now(), version = version + 1
  where id = p_assignment_id;

  perform app.record_audit_event('job.assignment.started', 'job_assignment',
    p_assignment_id, v_a.poster_org_id, jsonb_build_object('job_id', v_a.job_id));
  return v_a.version + 1;
end;
$$;

-- 13k. job_progress_add — append-only, installer-authored.
--
-- Reaching 100 is a CLAIM of readiness and nothing more. This function moves no
-- status and completes nothing: the assignment stays in_progress until the
-- posting organization confirms. A rating anchored to work the rated party
-- declared complete about themselves is not evidence.
create or replace function public.job_progress_add(
  p_assignment_id   uuid,
  p_progress_percent smallint,
  p_stage           text default null,
  p_note            text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_verified_caller();
  v_a   public.job_assignments;
  v_id  uuid;
begin
  select * into v_a from public.job_assignments where id = p_assignment_id for update;
  if not found then raise exception 'assignment not found' using errcode = '22023'; end if;
  if v_a.installer_user_id <> v_uid then
    raise exception 'only the assigned installer may report progress' using errcode = '42501';
  end if;
  if v_a.status <> 'in_progress' then
    raise exception 'progress can only be reported on work in progress' using errcode = '22023';
  end if;
  if p_progress_percent is null or p_progress_percent < 0 or p_progress_percent > 100 then
    raise exception 'progress must be between 0 and 100' using errcode = '22023';
  end if;

  insert into public.job_progress_updates (
    assignment_id, author_user_id, progress_percent, stage, note)
  values (
    p_assignment_id, v_uid, p_progress_percent,
    nullif(btrim(coalesce(p_stage, '')), ''), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;

  -- Denormalised in the SAME transaction, so the summary can never disagree
  -- with the history it summarises.
  update public.job_assignments set
    latest_progress_percent = p_progress_percent, last_progress_at = now()
  where id = p_assignment_id;

  perform app.record_audit_event('job.assignment.progress_updated', 'job_assignment',
    p_assignment_id, v_a.poster_org_id,
    jsonb_build_object('job_id', v_a.job_id, 'progress_percent', p_progress_percent));
  return v_id;
end;
$$;

-- 13l. job_assignment_complete — THE POSTING ORGANIZATION ONLY.
--
-- The single most important authority line in this domain. The installer
-- signals readiness through progress; the poster confirms. No verification
-- check: work already under way completes normally through a lapse (O1).
create or replace function public.job_assignment_complete(
  p_assignment_id uuid, p_expected_version integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_a   public.job_assignments;
  v_jid uuid;
begin
  perform app.require_verified_caller();
  -- jobs first, then the assignment (see job_application_accept).
  select job_id into v_jid from public.job_assignments where id = p_assignment_id;
  if v_jid is null then raise exception 'assignment not found' using errcode = '22023'; end if;
  perform 1 from public.jobs where id = v_jid for update;
  select * into v_a from public.job_assignments where id = p_assignment_id for update;
  if not app.is_org_member(v_a.poster_org_id) then
    raise exception 'not a member of the posting organization' using errcode = '42501';
  end if;
  if not app.can_manage_job(v_a.poster_org_id) then
    raise exception 'job.manage required' using errcode = '42501';
  end if;
  if v_a.status <> 'in_progress' then
    raise exception 'a % assignment cannot be completed', v_a.status using errcode = '22023';
  end if;
  if v_a.version <> p_expected_version then
    raise exception 'assignment was modified concurrently' using errcode = '40001';
  end if;

  update public.job_assignments
    set status = 'completed', completed_at = now(), version = version + 1
  where id = p_assignment_id;

  -- The job follows its assignment. awarded -> completed is a side effect and
  -- is never set directly.
  update public.jobs
    set status = 'completed', closed_at = now(), version = version + 1
  where id = v_a.job_id;

  perform app.record_audit_event('job.assignment.completed', 'job_assignment',
    p_assignment_id, v_a.poster_org_id, jsonb_build_object('job_id', v_a.job_id));
  return v_a.version + 1;
end;
$$;

-- 13m. job_assignment_cancel — either party, with a reason.
--
-- The assignment is CANCELLED, never deleted, and the job returns to `open`.
-- Previously rejected applicants stay rejected: their candidacy was decided,
-- and silently reviving it would re-enter people into a competition they were
-- already told they had lost.
create or replace function public.job_assignment_cancel(
  p_assignment_id uuid, p_expected_version integer, p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := app.require_verified_caller();
  v_a      public.job_assignments;
  v_j      public.jobs;
  v_jid    uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is null then
    raise exception 'a reason is required to cancel an assignment' using errcode = '22023';
  end if;
  -- Same lock order as job_cancel — jobs first, then the assignment — so the
  -- two cancel paths cannot deadlock against each other.
  select job_id into v_jid from public.job_assignments where id = p_assignment_id;
  if v_jid is null then raise exception 'assignment not found' using errcode = '22023'; end if;
  select * into v_j from public.jobs where id = v_jid for update;
  select * into v_a from public.job_assignments where id = p_assignment_id for update;

  if not (
    v_a.installer_user_id = v_uid
    or (app.is_org_member(v_a.poster_org_id) and app.can_manage_job(v_a.poster_org_id))
  ) then
    raise exception 'only a party to this assignment may cancel it' using errcode = '42501';
  end if;
  if v_a.status not in ('scheduled', 'in_progress') then
    raise exception 'a % assignment cannot be cancelled', v_a.status using errcode = '22023';
  end if;
  if v_a.version <> p_expected_version then
    raise exception 'assignment was modified concurrently' using errcode = '40001';
  end if;

  update public.job_assignments set
    status = 'cancelled', cancelled_at = now(), cancellation_reason = v_reason,
    version = version + 1
  where id = p_assignment_id;

  -- The opening returns to the pool. Only from `awarded`: if the job was
  -- itself cancelled, job_cancel already handled the assignment and there is
  -- nothing to reopen.
  if v_j.status = 'awarded' then
    update public.jobs set status = 'open', version = version + 1 where id = v_j.id;
  end if;

  perform app.record_audit_event('job.assignment.cancelled', 'job_assignment',
    p_assignment_id, v_a.poster_org_id,
    jsonb_build_object('job_id', v_a.job_id, 'reopened', v_j.status = 'awarded'));
  return v_a.version + 1;
end;
$$;

-- ===========================================================================
-- 14. RPC grants
--
-- Every function is callable by `authenticated` and refuses internally on
-- authority it does not like. None is callable by `anon`: there is no
-- anonymous participation anywhere in this domain.
-- ===========================================================================
revoke execute on function
  public.job_create(uuid, text, text, numeric, text, text, text, text, smallint, date, date, uuid),
  public.job_update(uuid, integer, text, text, numeric, text, text, text, text, smallint, date, date),
  public.job_publish(uuid, integer),
  public.job_close(uuid, integer),
  public.job_cancel(uuid, integer, text),
  public.job_application_submit(uuid, text),
  public.job_application_withdraw(uuid),
  public.job_application_reject(uuid, text),
  public.job_application_accept(uuid),
  public.job_assignment_start(uuid, integer),
  public.job_progress_add(uuid, smallint, text, text),
  public.job_assignment_complete(uuid, integer),
  public.job_assignment_cancel(uuid, integer, text)
  from public, anon;

grant execute on function
  public.job_create(uuid, text, text, numeric, text, text, text, text, smallint, date, date, uuid),
  public.job_update(uuid, integer, text, text, numeric, text, text, text, text, smallint, date, date),
  public.job_publish(uuid, integer),
  public.job_close(uuid, integer),
  public.job_cancel(uuid, integer, text),
  public.job_application_submit(uuid, text),
  public.job_application_withdraw(uuid),
  public.job_application_reject(uuid, text),
  public.job_application_accept(uuid),
  public.job_assignment_start(uuid, integer),
  public.job_progress_add(uuid, smallint, text, text),
  public.job_assignment_complete(uuid, integer),
  public.job_assignment_cancel(uuid, integer, text)
  to authenticated, service_role;
