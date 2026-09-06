-- ===========================================================================
-- Installer Pilot Increment 12 — reviews of completed work
--
-- Foundation: 20260902090001_jobs_domain.sql (job_assignments, app.can_manage_job)
--             20260822090001_notifications_core.sql (app.notify)
--             20260802090003_audit_foundation.sql (app.record_audit_event)
--
-- One organization says one thing, once, about work that is finished. Everything
-- below is arrangement around the three words in that sentence.
--
-- ONE. `assignment_id` is UNIQUE, so a second review is not a policy decision
-- taken in an RPC — it is a row the table refuses. `job_review_submit` is
-- idempotent on top of that (it returns the existing id rather than raising),
-- the same shape `job_application_submit` uses, so a double tap or a retried
-- request converges instead of erroring at somebody who did nothing wrong.
--
-- SAYS. The reviewer is an ORGANIZATION, and the individual employee who typed
-- it is recorded in `submitted_by` for audit and never projected anywhere. A
-- review is the organization's statement; naming the person who pressed the
-- button would turn a business record into a personal one, on a surface the
-- reviewed professional cannot answer back on.
--
-- ONCE. The row is IMMUTABLE — not "clients should not edit it" but no update
-- and no delete path exists for anybody, enforced by `app.forbid_mutation` on
-- both triggers. That is stronger than a missing grant, because it also refuses
-- the security-definer functions in this very file. A correction is therefore a
-- moderation act with its own append-only record, never a quiet rewrite of what
-- somebody once said.
--
-- WHAT IS DELIBERATELY ABSENT (§2): helpful votes, likes, replies, a
-- recommendation flag, per-category ratings, a verification badge, and any
-- sentiment or AI score. Each would need an authority that does not exist, and a
-- per-category score in particular would be five numbers nobody ever entered.
--
-- SUPPRESSION IS DERIVED, NEVER STORED. There is no `suppressed` column. State
-- is the LATEST row in an append-only moderation history, which means the
-- history cannot disagree with the flag, because there is no flag. Restoring is
-- another row, not an undo.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Audit vocabulary
-- ---------------------------------------------------------------------------
-- A review is an immutable public claim about a named professional, and
-- suppression removes one from every ordinary surface. Both are exactly the kind
-- of act an audit log exists for, and `submitted_by` is only half the answer:
-- the audit row is what records the act rather than the artefact.
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
  -- Increment 12. Submission and the two moderation acts; there is deliberately
  -- no `job.review.updated` or `.deleted`, because no such act exists.
  'job.review.submitted', 'job.review.suppressed', 'job.review.restored'
));

-- ---------------------------------------------------------------------------
-- 2. public.job_reviews
-- ---------------------------------------------------------------------------
create table public.job_reviews (
  id                uuid primary key default extensions.gen_random_uuid(),

  -- THE IDENTITY OF A REVIEW IS THE WORK IT IS ABOUT. Unique, so "one review per
  -- completed assignment" is a shape rather than a rule somebody enforces.
  -- RESTRICT rather than CASCADE: a review must outlive the ordinary lifecycle,
  -- and if anybody ever needs to remove an assignment they should have to deal
  -- with its review consciously rather than take it with them.
  assignment_id     uuid not null unique references public.job_assignments (id) on delete restrict,

  -- Both parties are denormalised from the assignment at submission. Not for
  -- speed — so that the two questions this table is asked ("whose reviews" and
  -- "which organization wrote them") never need a join to a row whose own
  -- policies would answer differently for different readers.
  installer_user_id uuid not null references public.users (id) on delete restrict,
  poster_org_id     uuid not null references public.organizations (id) on delete restrict,

  rating            smallint not null,

  comment           text,

  -- AUDIT AND AUTHORITY ONLY. Never projected, publicly or to the installer:
  -- the review is the organization's statement, and naming the employee who
  -- typed it would turn a business record into a personal one on a surface the
  -- reviewed professional cannot answer back on. §16 asserts its absence from
  -- both read models by column list.
  submitted_by      uuid not null references public.users (id) on delete restrict,

  created_at        timestamptz not null default now(),
  -- No `updated_at`. The row cannot change, so a column recording when it
  -- changed would be a permanent lie about a table whose whole point is that it
  -- does not move.

  constraint ck_job_reviews_rating check (rating between 1 and 5),
  constraint ck_job_reviews_comment check (
    comment is null or char_length(comment) between 1 and 1500)
);

comment on table public.job_reviews is
  'One immutable review per completed assignment, written by the posting ORGANIZATION about the assigned installer. No update or delete path exists for anybody — including the security-definer functions in this schema — so a correction is a moderation act with its own append-only record, never a rewrite. Carries no votes, replies, recommendation flag, per-category scores or sentiment: each would need an authority this product does not have.';

comment on column public.job_reviews.submitted_by is
  'The employee who submitted, for audit and authority only. Deliberately absent from every projection: the reviewer is the organization, and publishing the individual would expose a person on a surface the reviewed professional cannot reply on.';

create index ix_job_reviews_installer on public.job_reviews (installer_user_id, created_at desc, id);
create index ix_job_reviews_org on public.job_reviews (poster_org_id, created_at desc);

-- IMMUTABLE, at the table. `app.forbid_mutation` is the same guard the
-- append-only progress history uses. A trigger rather than a withheld grant,
-- because a grant only stops clients: this also stops every function in this
-- file, which is what makes "immutable" a property rather than a convention.
create trigger job_reviews_no_update
  before update on public.job_reviews
  for each row execute function app.forbid_mutation();
create trigger job_reviews_no_delete
  before delete on public.job_reviews
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- 3. public.job_review_moderations — the append-only seam
-- ---------------------------------------------------------------------------
-- There is NO `suppressed` column on the review. State is the latest row here,
-- so the history cannot contradict the flag — there is no flag to contradict.
-- Restoring is another row rather than an undo, which is the only shape in which
-- "we removed this and later put it back" stays legible a year afterwards.
create table public.job_review_moderations (
  id         uuid primary key default extensions.gen_random_uuid(),

  -- THE ORDER OF ACTS, and it exists because pgTAP caught the alternative being
  -- wrong. `created_at` defaults to now(), which is the TRANSACTION timestamp —
  -- so a suppression and a restore performed in one transaction share it exactly,
  -- and "the latest act" fell back to comparing random uuids. A strictly
  -- monotonic sequence is the only tiebreaker that means what it says.
  seq        bigint generated always as identity,

  review_id  uuid not null references public.job_reviews (id) on delete restrict,
  action     text not null,
  -- Required. An unexplained suppression is indistinguishable from a mistake,
  -- and this table exists precisely so that distinction survives.
  reason     text not null,
  acted_by   uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),

  constraint ck_review_moderation_action check (action in ('suppress', 'restore')),
  constraint ck_review_moderation_reason check (char_length(btrim(reason)) between 1 and 500)
);

comment on table public.job_review_moderations is
  'Append-only moderation history for reviews. Suppression is DERIVED from the latest row rather than stored as a column, so the record and the state cannot disagree. Never readable by ordinary users and never projected: a reader learning that a review was suppressed, or why, would be reading the moderation decision itself.';

create index ix_review_moderations_review on public.job_review_moderations (review_id, seq desc);

create trigger job_review_moderations_no_update
  before update on public.job_review_moderations
  for each row execute function app.forbid_mutation();
create trigger job_review_moderations_no_delete
  before delete on public.job_review_moderations
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- 4. Grants and RLS
-- ---------------------------------------------------------------------------
-- Strip Supabase's defaults FIRST. `alter default privileges` hands anon and
-- authenticated `arwdDxtm` on every new public table, TRUNCATE included, and
-- TRUNCATE is not restricted by RLS — the defect Increment 11 shipped and caught.
revoke all on public.job_reviews, public.job_review_moderations
  from anon, authenticated, service_role;

alter table public.job_reviews enable row level security;
alter table public.job_review_moderations enable row level security;

-- The installer reads their own reviews; both read models are projections, so
-- this base grant exists for the reviewed professional alone and never for the
-- public. The posting organization reads its own submitted review back through
-- the same policy on the org side.
grant select on public.job_reviews to authenticated, service_role;

create policy job_reviews_select_installer on public.job_reviews
  for select to authenticated
  using (installer_user_id = (select auth.uid()));

create policy job_reviews_select_poster on public.job_reviews
  for select to authenticated
  using (app.is_org_member(poster_org_id));

-- MODERATION IS NOT READABLE BY ANYBODY through this table. No grant, no policy:
-- not the installer, not the organization, not anon. Platform staff reach it
-- through the two RPCs below, which are the only writers as well.
-- (§5: moderation details and reasons stay out of every product projection.)

-- ---------------------------------------------------------------------------
-- 5. Suppression, derived
-- ---------------------------------------------------------------------------
create function app.review_is_suppressed(p_review_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Ordered by `seq`, never by `created_at`: two acts in one transaction share a
  -- timestamp exactly, and ordering by it would decide "latest" on a uuid.
  select coalesce(
    (select m.action = 'restore'
       from public.job_review_moderations m
      where m.review_id = p_review_id
      order by m.seq desc
      limit 1),
    true) is not true;
$$;

comment on function app.review_is_suppressed(uuid) is
  'True when the LATEST moderation row for a review is a suppression. A review with no moderation history is visible, which is why the default is written as "not restored" rather than "suppressed": the absence of moderation is the ordinary case, not a decision.';

revoke execute on function app.review_is_suppressed(uuid) from public;
grant execute on function app.review_is_suppressed(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. job_review_submit — the one writer
-- ---------------------------------------------------------------------------
create function public.job_review_submit(
  p_assignment_id uuid,
  p_rating        smallint,
  p_comment       text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_a         public.job_assignments;
  v_existing  uuid;
  v_id        uuid;
  v_job_title text;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Lock ordering is jobs -> child row everywhere in this domain, and this reads
  -- only the child, so it takes the assignment row alone.
  select * into v_a from public.job_assignments a
   where a.id = p_assignment_id
   for update;

  if not found then
    raise exception 'assignment not found' using errcode = '42501';
  end if;

  -- AUTHORITY BEFORE STATE, so a stranger cannot learn an assignment's status by
  -- reading which refusal they get.
  if not app.can_manage_job(v_a.poster_org_id) then
    raise exception 'job.manage required to review this work' using errcode = '42501';
  end if;

  if v_a.status <> 'completed'::public.job_assignment_status then
    raise exception 'only completed work can be reviewed' using errcode = '22023';
  end if;

  -- IDEMPOTENT, not an error. The unique constraint already makes a second
  -- review impossible; returning the existing one means a double tap or a
  -- retried request converges instead of failing at somebody who did nothing
  -- wrong. Same shape as job_application_submit.
  select r.id into v_existing from public.job_reviews r
   where r.assignment_id = p_assignment_id;
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.job_reviews
    (assignment_id, installer_user_id, poster_org_id, rating, comment, submitted_by)
  values
    (p_assignment_id, v_a.installer_user_id, v_a.poster_org_id, p_rating,
     nullif(btrim(coalesce(p_comment, '')), ''), v_uid)
  returning id into v_id;

  select j.title into v_job_title from public.jobs j where j.id = v_a.job_id;

  perform app.record_audit_event('job.review.submitted', 'job_review', v_id,
    v_a.poster_org_id, jsonb_build_object('rating', p_rating));

  -- The reviewed professional, and nobody else. Unambiguous recipient, so this
  -- uses app.notify directly rather than the capability-addressed notify_org —
  -- there is no organization-side question to answer here.
  perform app.notify(v_a.installer_user_id, null,
    'job.review.received', 'job_review', v_id,
    '/home/reviews',
    'notifications.job.review.received.title',
    'notifications.job.review.received.body',
    jsonb_build_object('org_name', app.org_display_name(v_a.poster_org_id),
                       'job_title', v_job_title));

  return v_id;
end;
$$;

comment on function public.job_review_submit(uuid, smallint, text) is
  'The ONLY writer of public.job_reviews. Derives the caller from auth.uid(), requires job.manage (or org.manage) on the posting organization, and refuses work that is not completed. Idempotent: a second call returns the existing review rather than raising, so a retry converges. The rating range is enforced by the table, not here, so no caller can reach the column another way.';

revoke execute on function public.job_review_submit(uuid, smallint, text) from public, anon;
grant execute on function public.job_review_submit(uuid, smallint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Moderation writers — platform staff only
-- ---------------------------------------------------------------------------
create function public.job_review_moderate(
  p_review_id uuid,
  p_action    text,
  p_reason    text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
begin
  -- The canonical platform authority. `is_platform('moderator')` is satisfied by
  -- a moderator or an administrator, and by nobody else — an organization that
  -- dislikes a review it received cannot reach this, and neither can the
  -- reviewed professional.
  if not app.is_platform('moderator') then
    raise exception 'platform moderation role required' using errcode = '42501';
  end if;
  if p_action not in ('suppress', 'restore') then
    raise exception 'unknown moderation action' using errcode = '22023';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required' using errcode = '22023';
  end if;

  select r.poster_org_id into v_org from public.job_reviews r where r.id = p_review_id;
  if not found then
    raise exception 'review not found' using errcode = '42501';
  end if;

  insert into public.job_review_moderations (review_id, action, reason, acted_by)
  values (p_review_id, p_action, btrim(p_reason), v_uid);

  perform app.record_audit_event(
    case when p_action = 'suppress' then 'job.review.suppressed'
         else 'job.review.restored' end,
    'job_review', p_review_id, v_org, jsonb_build_object('reason', btrim(p_reason)));
end;
$$;

comment on function public.job_review_moderate(uuid, text, text) is
  'Appends one moderation act. Requires the canonical platform moderator role, so an organization cannot bury a review it received and a professional cannot bury one they dislike. Never deletes: the review row is immutable and this only changes what the DERIVED suppression test answers, which is what keeps a removed review historically intact.';

revoke execute on function public.job_review_moderate(uuid, text, text) from public, anon;
grant execute on function public.job_review_moderate(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The installer's own reviews
-- ---------------------------------------------------------------------------
-- Same three-policy problem Increment 9 solved for assignments, and the same
-- answer. An installer is not a member of the reviewing organization
-- (`organizations_select_member`), a retired trade vanishes
-- (`trades_select_active`), and a closed or cancelled job is unreadable
-- (`jobs_select_assigned_installer`). §6 requires that none of those erase the
-- CONTEXT of a review, so the projection reads past all three and names its
-- columns — a policy would name none and grant every future one.
create function app._my_job_reviews()
returns table (
  id           uuid,
  rating       smallint,
  comment      text,
  org_name     text,
  job_title    text,
  trade_key    text,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.rating, r.comment, o.name, j.title, t.key, r.created_at
  from public.job_reviews r
  join public.job_assignments a on a.id = r.assignment_id
  join public.jobs j on j.id = a.job_id
  join public.trades t on t.id = j.trade_id
  join public.organizations o on o.id = r.poster_org_id
  where r.installer_user_id = (select auth.uid())
    and (select auth.uid()) is not null
    -- Suppressed reviews leave the installer's ordinary surfaces too. A person
    -- being shown a review the public cannot see would be reading a moderation
    -- decision by inference.
    and not app.review_is_suppressed(r.id);
$$;

create view public.my_job_reviews with (security_invoker = true) as
  select id, rating, comment, org_name, job_title, trade_key, created_at
  from app._my_job_reviews();

comment on view public.my_job_reviews is
  'The caller''s own visible reviews. Carries the reviewing organization''s NAME and never its employee, no assignment id, and no moderation state. Reads past the trade, organization and job policies so a retired trade, an unverified organization or a closed job cannot erase the context of finished work.';

grant execute on function app._my_job_reviews() to authenticated, service_role;
revoke all on public.my_job_reviews from anon, authenticated, service_role;
grant select on public.my_job_reviews to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. The public projection
-- ---------------------------------------------------------------------------
-- Keyed on `profiles.id`, like every other public surface, and gated on the SAME
-- listing test the profile page itself uses — `profile_public_directory` — so
-- publication cannot mean one thing to a profile and another to its reviews.
-- Unlisting therefore withdraws every review at once, without touching a row.
create function app._public_profile_reviews()
returns table (
  profile_id uuid,
  id         uuid,
  rating     smallint,
  comment    text,
  org_name   text,
  job_title  text,
  trade_key  text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, r.id, r.rating, r.comment, o.name, j.title, t.key, r.created_at
  from public.job_reviews r
  join public.profiles p on p.user_id = r.installer_user_id
  join public.profile_public_directory d on d.id = p.id
  join public.job_assignments a on a.id = r.assignment_id
  join public.jobs j on j.id = a.job_id
  join public.trades t on t.id = j.trade_id
  join public.organizations o on o.id = r.poster_org_id
  where not app.review_is_suppressed(r.id);
$$;

create view public.public_profile_reviews with (security_invoker = true) as
  select profile_id, id, rating, comment, org_name, job_title, trade_key, created_at
  from app._public_profile_reviews();

comment on view public.public_profile_reviews is
  'Reviews of currently listed professionals, unsuppressed only. Exposes the reviewing organization''s display name, the rating, the optional comment, the job and trade context and the date — and deliberately no reviewer user id, no submitted_by, no assignment id, no moderation state and no count of what is hidden. 17_public_directory_hardening''s rule applies here too: no user id reaches a public projection.';

grant execute on function app._public_profile_reviews() to anon, authenticated, service_role;
revoke all on public.public_profile_reviews from anon, authenticated, service_role;
grant select on public.public_profile_reviews to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. Notifications
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint ck_notifications_event_type_known;
alter table public.notifications add constraint ck_notifications_event_type_known check (
  event_type in (
    'rfq.submitted', 'rfq.cancelled',
    'quotation.submitted', 'quotation.accepted', 'quotation.rejected',
    'order.created', 'order.started', 'order.completed', 'order.cancelled',
    'project.created', 'project.activated', 'project.completed',
    'verification.approved', 'verification.rejected', 'verification.changes_requested',
    'message.sent',
    'job.application.accepted', 'job.application.rejected',
    'job.assignment.ready', 'job.assignment.completed', 'job.assignment.cancelled',
    -- Increment 12. One event, one unambiguous recipient: the professional the
    -- review is about. There is no organization-facing counterpart, because the
    -- organization is the party that just acted.
    'job.review.received'
  ));
