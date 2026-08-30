-- Migration: Points Core — the append-only, user-level engagement ledger.
--
-- Authority: docs/database/points-core.md (approved 2026-08-30).
-- This migration implements the DATABASE FOUNDATION ONLY. It deliberately does
-- NOT wire any earning event. The single approved event
-- (referral.organization_approved) has no call site here because its numeric
-- value is still PRODUCT DECISION REQUIRED (spec D1) — the foundation is built
-- so that increment adds a call site and nothing else.
--
-- Model, in one line each:
--   • A points entry belongs to a PERSON. user_id is the only authority column.
--   • organization_id is business CONTEXT and must never reach a USING clause.
--   • History is append-only: no UPDATE, no DELETE, for anyone, ever.
--   • Balance is DERIVED (sum of points_delta). There is no balance column.
--   • Corrections are compensating entries; the original is never rewritten.
--   • Idempotency is the deterministic tuple
--     (user_id, event_type, source_type, source_id), enforced by a unique index.
--
-- Points are NOT money. There is no currency, rate, redemption or payout field,
-- and none may be added without a further approved specification.
--
-- Out of scope here and not to be added without a further approved spec:
-- earning-event wiring, numeric point values, Points UI, manager/team
-- visibility, leaderboards, challenges, badges, tiers, Sales Score, wallet,
-- commissions, expiry/decay, Realtime, Notifications and Chat integration.

-- ===========================================================================
-- 1. Metadata shape guard (immutable, so it can be used in a CHECK)
--    CHECK cannot contain a subquery, so the "scalars only" rule lives in a
--    small immutable function — the same technique app.normalize_phone uses to
--    put non-trivial logic behind a constraint.
-- ===========================================================================
create or replace function app.points_metadata_is_flat(p_metadata jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  -- True for an empty object. False as soon as any value is a nested object or
  -- array: nesting is how a duplicated business record gets smuggled into a
  -- column that no policy can filter and no constraint can bound.
  select coalesce(
    bool_and(jsonb_typeof(e.value) not in ('object', 'array')),
    true
  )
  from jsonb_each(coalesce(p_metadata, '{}'::jsonb)) e;
$fn$;
comment on function app.points_metadata_is_flat(jsonb) is 'True when every value in the metadata object is a scalar. Enforces the "display context only, never a duplicated business record" rule from docs/database/points-core.md at the column.';

-- ===========================================================================
-- 2. points_ledger — the canonical append-only ledger
-- ===========================================================================
create table public.points_ledger (
  id                 uuid primary key default extensions.gen_random_uuid(),

  -- The authority column. Points are the caller's own standing on the platform,
  -- not an organization record, so the owner is the canonical user identity and
  -- the entry survives every membership, branch and employer change.
  user_id            uuid not null references public.users (id) on delete cascade,

  -- Context only: the workspace the person was acting in when the entry was
  -- written, kept so an entry can be explained ("earned while at X").
  -- MUST NEVER appear in a USING clause — see the RLS section below.
  -- ON DELETE SET NULL, not CASCADE: removing a business must never delete a
  -- person's earned history. (Matches audit_log.organization_id.)
  organization_id    uuid references public.organizations (id) on delete set null,

  event_type         text not null,

  -- Signed and never zero. Positive = award, negative = compensating entry.
  -- An integer count, deliberately not numeric/money: Points are not currency.
  points_delta       integer not null,

  -- The authoritative record that justified the entry.
  -- source_id is NOT NULL on purpose: the idempotency identity below is a
  -- unique index, and SQL treats NULLs as distinct, so a nullable source_id
  -- would silently disable duplicate protection for exactly the events that
  -- most need it. The spec requires a source record for every Pilot event; an
  -- event without one is not eligible until its own idempotency story exists.
  source_type        text not null,
  source_id          uuid not null,

  -- Set only on a compensating entry. Null on every ordinary award — which is
  -- what keeps reversals out of the award-idempotency index below.
  reverses_entry_id  uuid references public.points_ledger (id) on delete restrict,

  -- The platform actor responsible, for administrative entries only. Null for
  -- system-issued awards, whose actor is the transaction that fired them.
  awarded_by_user_id uuid references public.users (id) on delete set null,

  reason_code        text,

  -- Bounded display context. Never authorization input, never money, never
  -- personal data, never authored content, never a duplicated business record.
  metadata           jsonb not null default '{}'::jsonb,

  created_at         timestamptz not null default now(),

  -- Bounded vocabulary, mirroring ck_notifications_event_type_known. Extending
  -- it is a migration, deliberately.
  --   referral.organization_approved — the ONE approved earning event. Present
  --     so the wiring increment adds a call site and no schema change; it has
  --     NO call site today and no approved point value (D1).
  --   admin.adjustment — the standalone administrative correction primitive
  --     required by the spec's reversal model. NOT an earning event.
  constraint ck_points_ledger_event_type_known check (event_type in (
    'referral.organization_approved',
    'admin.adjustment'
  )),

  -- A zero-delta entry records nothing and only pollutes the history.
  constraint ck_points_ledger_delta_nonzero check (points_delta <> 0),

  constraint ck_points_ledger_source_type check (char_length(source_type) between 1 and 64),

  -- Bounded reason vocabulary, both values straight from the approved spec.
  constraint ck_points_ledger_reason_code_known check (
    reason_code is null or reason_code in ('support_correction', 'event_invalidated')
  ),

  -- An administrative entry must always name a reason and a responsible actor:
  -- a human-written row with neither is an unattributable adjustment.
  constraint ck_points_ledger_admin_attribution check (
    (reverses_entry_id is null and event_type <> 'admin.adjustment')
    or (reason_code is not null and awarded_by_user_id is not null)
  ),

  -- An entry cannot reverse itself.
  constraint ck_points_ledger_no_self_reversal check (
    reverses_entry_id is null or reverses_entry_id <> id
  ),

  constraint ck_points_ledger_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint ck_points_ledger_metadata_size check (length(metadata::text) <= 2048),
  constraint ck_points_ledger_metadata_flat check (app.points_metadata_is_flat(metadata))
);

comment on table public.points_ledger is 'Append-only, user-level Points ledger (docs/database/points-core.md). user_id is the only authority column; organization_id is context and must never appear in a USING clause. Balance is DERIVED as sum(points_delta) — there is no balance column and none may be added. Immutable: no UPDATE or DELETE for any role. Writes happen exclusively through app.award_points (internal) and the two platform-gated correction RPCs. Points are not money.';
comment on column public.points_ledger.user_id is 'The owner and the sole authority column. The recipient of the points, which is not necessarily the actor who triggered the event.';
comment on column public.points_ledger.organization_id is 'Business context in which the entry was earned. NOT an authorization path: sharing an organization grants no visibility of a colleague''s ledger. ON DELETE SET NULL so removing a business never deletes a person''s history.';
comment on column public.points_ledger.points_delta is 'Signed, non-zero integer count. Positive award, negative compensating entry. Not money: no currency, rate, or convertibility exists anywhere in this model.';
comment on column public.points_ledger.source_id is 'The authoritative record that justified the entry. NOT NULL because it is part of the unique idempotency identity, and SQL treats NULLs as distinct.';
comment on column public.points_ledger.reverses_entry_id is 'Set only on a compensating entry; references the entry being reversed. Unique, so an entry is reversible at most once. Null on every ordinary award, which excludes reversals from the award-idempotency index.';
comment on column public.points_ledger.metadata is 'Bounded display context: a flat object of scalars, <= 2048 bytes. Must never carry authorization input, money, personal data, authored content, or a duplicated business record. Per-event key allow-lists arrive with each event''s wiring increment.';

-- ===========================================================================
-- 3. Indexes
-- ===========================================================================
-- The balance sum and the history list, which are the same access path:
-- everything about one person, newest first.
create index ix_points_ledger_user_created
  on public.points_ledger (user_id, created_at desc);

-- "Has this business record already awarded?" — and the lookup a future wiring
-- increment uses to explain an entry.
create index ix_points_ledger_source
  on public.points_ledger (source_type, source_id);

-- THE idempotency mechanism. Deterministic identity derived from the event
-- itself, never from a client-generated token: a frontend key only protects
-- against a client retrying its own request, and makes correctness depend on
-- the least trusted participant. Partial, so compensating entries (which
-- legitimately repeat the original's event/source identity) never collide with
-- it. This is an INDEX, not an application-level "if not exists" check, which
-- would race between its SELECT and its INSERT.
create unique index ux_points_ledger_event_identity
  on public.points_ledger (user_id, event_type, source_type, source_id)
  where reverses_entry_id is null;

-- An entry may be reversed at most once. A mistaken reversal is corrected by a
-- new administrative adjustment, never by reversing the reversal.
create unique index ux_points_ledger_one_reversal_per_entry
  on public.points_ledger (reverses_entry_id)
  where reverses_entry_id is not null;

-- ===========================================================================
-- 4. RLS — owner-only, plus platform read for the correction path
-- ===========================================================================
alter table public.points_ledger enable row level security;

-- The owner reads their own history. Nothing else grants visibility.
create policy points_ledger_select_own on public.points_ledger
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Platform support/moderator/administrator read-only (app.is_platform('support')
-- is true for all three). This is a DELIBERATE divergence from notifications,
-- which has no platform read path: a notification is private correspondence,
-- whereas a points entry is a CONTESTED record. Support must be able to answer
-- "why did my points change?", and a correction cannot be issued responsibly by
-- someone who cannot see what they are correcting.
create policy points_ledger_select_platform on public.points_ledger
  for select to authenticated
  using (app.is_platform('support'));

-- Exclusions that are load-bearing and must not be "fixed" later without a
-- revision of docs/database/points-core.md:
--   • NO app.is_org_member(organization_id) policy. It would let an owner
--     harvest the standing of every employee, past and present — including
--     points those people earned at OTHER employers, because entries keep their
--     historical context and a departed colleague's rows still carry that org id.
--   • NO capability-based policy. org.manage authorizes acting on organization
--     records; Points are not an organization record.
--   • NO counterparty policy. Being on the other side of a transaction is not a
--     reason to read someone's reputation.
--   • NO INSERT/UPDATE/DELETE policy of any kind, for any role.

-- ===========================================================================
-- 5. Grants (deny-by-default; SELECT only — every write is a definer function)
--    service_role is granted NOTHING: a service-role key is not a business
--    authorization path (ADR-0008 / D17).
-- ===========================================================================
revoke all on public.points_ledger from anon, authenticated, service_role;
grant select on public.points_ledger to authenticated;

-- ===========================================================================
-- 6. Append-only enforcement
--    The triggers are NOT redundant with the missing policies. Policies bind
--    the `authenticated` role; the triggers bind EVERYONE, including the
--    security-definer functions this migration itself introduces. The
--    append-only guarantee has to survive a mistake in our own RPC, not only a
--    hostile browser.
-- ===========================================================================
-- Generalise the shared guard's message so it names the table that was actually
-- touched. It previously hard-coded "audit_log", which would have reported
-- "audit_log is append-only (UPDATE points_ledger forbidden)". Same behaviour,
-- same P0001 errcode (asserted by 07_audit_test and 13_audit_emission_test,
-- both of which match on the code and not the text).
create or replace function app.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  raise exception '%.% is append-only (% forbidden)',
    tg_table_schema, tg_table_name, tg_op;
end;
$fn$;

create trigger points_ledger_no_update
  before update on public.points_ledger
  for each row execute function app.forbid_mutation();

create trigger points_ledger_no_delete
  before delete on public.points_ledger
  for each row execute function app.forbid_mutation();

-- ===========================================================================
-- 7. app.award_points — the single insertion point (INTERNAL ONLY)
--    Invoked only from other security-definer RPCs that have ALREADY authorized
--    the caller and ALREADY established that the business event happened.
--    Execute is revoked from every client role with no compensating grant, so
--    no product client can forge an award: there is no award endpoint to send a
--    request to, and the amount is never supplied by a browser.
--
--    A future earning event calls this beside its existing
--    app.record_audit_event(...) call and INSIDE THE SAME TRANSACTION, so the
--    award and the business transition commit together or roll back together.
-- ===========================================================================
create or replace function app.award_points(
  p_user_id            uuid,
  p_organization_id    uuid,
  p_event_type         text,
  p_source_type        text,
  p_source_id          uuid,
  p_points_delta       integer,
  p_metadata           jsonb default '{}'::jsonb,
  p_reason_code        text default null,
  p_awarded_by_user_id uuid default null,
  p_reverses_entry_id  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_id       uuid;
begin
  -- Fail at the WRITER rather than at the constraint, so a bad call site is
  -- diagnosable. These mirror the table CHECKs exactly.
  if p_user_id is null then
    raise exception 'points recipient is required' using errcode = '22023';
  end if;
  if p_source_id is null or p_source_type is null then
    raise exception 'points entries require an authoritative source record' using errcode = '22023';
  end if;
  if p_points_delta is null or p_points_delta = 0 then
    raise exception 'points_delta must be a non-zero integer' using errcode = '22023';
  end if;
  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'points metadata must be a JSON object' using errcode = '22023';
  end if;
  if length(v_metadata::text) > 2048 then
    raise exception 'points metadata exceeds the 2048-byte limit' using errcode = '22023';
  end if;
  if not app.points_metadata_is_flat(v_metadata) then
    raise exception 'points metadata must be a flat object of scalar values' using errcode = '22023';
  end if;

  insert into public.points_ledger (
    user_id, organization_id, event_type, points_delta,
    source_type, source_id, reverses_entry_id,
    awarded_by_user_id, reason_code, metadata
  )
  values (
    p_user_id, p_organization_id, p_event_type, p_points_delta,
    p_source_type, p_source_id, p_reverses_entry_id,
    p_awarded_by_user_id, p_reason_code, v_metadata
  )
  -- THE idempotency guarantee. A retry, a replayed event, a duplicated request
  -- or a concurrent second call re-presents the same deterministic identity and
  -- is collapsed to a no-op rather than raising, so the surrounding business
  -- transaction still commits. Returns null, so a call site can tell "written"
  -- from "already awarded".
  on conflict (user_id, event_type, source_type, source_id)
    where reverses_entry_id is null
    do nothing
  returning id into v_id;

  return v_id;
end;
$fn$;
comment on function app.award_points(uuid, uuid, text, text, uuid, integer, jsonb, text, uuid, uuid) is 'Internal-only Points writer. Appends one ledger entry, validating the payload at the writer and collapsing a duplicate canonical event (user_id, event_type, source_type, source_id) to a no-op returning null. Not callable by clients; invoked from security-definer RPCs that have already authorized the caller, in the same transaction as the business transition. The point amount is always supplied by the trusted call site, never by a browser.';

-- ===========================================================================
-- 8. Audit vocabulary — two Points actions
--    Every administrative entry is audited, so a correction appears in TWO
--    append-only records: the ledger it adjusts and the forensic log.
--    Ordinary awards get no action of their own: they are written beside the
--    business event's OWN audit row, in the same transaction, and that row is
--    already the record that the event happened.
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
  -- Points Core. Only the two ADMINISTRATIVE transitions: a human wrote a row
  -- against someone's standing, and must be answerable for it.
  'points.adjusted', 'points.reversed'
));

-- ===========================================================================
-- 9. public.adjust_points — standalone administrative adjustment
--    Platform-gated. Its authoritative source record is the audit event that
--    authorized it, which gives every adjustment a real, unique, auditable
--    identity and lets it flow through the SAME idempotency rule as every other
--    entry — no special case, no second code path.
-- ===========================================================================
create or replace function public.adjust_points(
  p_user_id         uuid,
  p_points_delta    integer,
  p_reason_code     text,
  p_organization_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor    uuid := (select auth.uid());
  v_audit_id uuid;
  v_entry_id uuid;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  -- Platform role is the ONLY authority over another person's ledger.
  -- Organization membership, ownership and capabilities grant nothing here.
  if not app.is_platform('support') then
    raise exception 'platform support authority is required to adjust points' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'points recipient is required' using errcode = '22023';
  end if;
  if p_points_delta is null or p_points_delta = 0 then
    raise exception 'points_delta must be a non-zero integer' using errcode = '22023';
  end if;
  if p_reason_code is null then
    raise exception 'an administrative adjustment requires a reason code' using errcode = '22023';
  end if;

  -- Audit FIRST: the audit row is this adjustment's authoritative source record.
  v_audit_id := app.record_audit_event(
    'points.adjusted', 'points_ledger', null, p_organization_id,
    jsonb_build_object('subject_user_id', p_user_id, 'reason_code', p_reason_code)
  );

  v_entry_id := app.award_points(
    p_user_id            => p_user_id,
    p_organization_id    => p_organization_id,
    p_event_type         => 'admin.adjustment',
    p_source_type        => 'audit_event',
    p_source_id          => v_audit_id,
    p_points_delta       => p_points_delta,
    p_metadata           => '{}'::jsonb,
    p_reason_code        => p_reason_code,
    p_awarded_by_user_id => v_actor
  );

  return v_entry_id;
end;
$fn$;
comment on function public.adjust_points(uuid, integer, text, uuid) is 'Platform-gated administrative Points adjustment. Appends a signed entry whose authoritative source is the audit event that authorized it, so every adjustment is uniquely identified and answerable. Never floors the resulting derived balance at zero. Not an earning event.';

-- ===========================================================================
-- 10. public.reverse_points_entry — the compensating-entry path
--     Platform-gated. Never mutates or deletes the original: it appends a new
--     entry carrying the exact negation, linked to what it reverses. The pair
--     reads as a complete account of what happened and what was decided about it.
-- ===========================================================================
create or replace function public.reverse_points_entry(
  p_entry_id    uuid,
  p_reason_code text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor    uuid := (select auth.uid());
  v_original public.points_ledger;
  v_entry_id uuid;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not app.is_platform('support') then
    raise exception 'platform support authority is required to reverse points' using errcode = '42501';
  end if;
  if p_reason_code is null then
    raise exception 'a reversal requires a reason code' using errcode = '22023';
  end if;

  select * into v_original from public.points_ledger where id = p_entry_id;
  if not found then
    raise exception 'points entry not found' using errcode = 'P0002';
  end if;

  -- A reversal of a reversal is refused by contract, not merely by the unique
  -- index: a mistaken reversal is corrected by a new administrative adjustment,
  -- which carries its own reason and its own audit row.
  if v_original.reverses_entry_id is not null then
    raise exception 'a compensating entry cannot itself be reversed' using errcode = '22023';
  end if;

  begin
    insert into public.points_ledger (
      user_id, organization_id, event_type, points_delta,
      source_type, source_id, reverses_entry_id,
      awarded_by_user_id, reason_code, metadata
    )
    values (
      v_original.user_id, v_original.organization_id, v_original.event_type,
      -- The exact negation. The derived balance is allowed to go negative; a
      -- constraint or a clamp that prevented it would mean either refusing a
      -- legitimate correction or writing a smaller reversal than the error
      -- requires, both of which corrupt the record to protect a display.
      - v_original.points_delta,
      v_original.source_type, v_original.source_id, v_original.id,
      v_actor, p_reason_code, '{}'::jsonb
    )
    returning id into v_entry_id;
  exception when unique_violation then
    -- ux_points_ledger_one_reversal_per_entry. Raised, not collapsed: unlike a
    -- retried award, a second reversal request is a human asking for something
    -- that already happened and must be told so.
    raise exception 'points entry % has already been reversed', p_entry_id
      using errcode = '23505';
  end;

  perform app.record_audit_event(
    'points.reversed', 'points_ledger', v_original.id, v_original.organization_id,
    jsonb_build_object(
      'subject_user_id', v_original.user_id,
      'reason_code',     p_reason_code,
      'reversed_delta',  v_original.points_delta
    )
  );

  return v_entry_id;
end;
$fn$;
comment on function public.reverse_points_entry(uuid, text) is 'Platform-gated reversal. Appends a compensating entry carrying the exact negation of the original and linked to it; the original is never mutated or deleted. An entry can be reversed at most once, and a compensating entry cannot itself be reversed. The resulting derived balance may legitimately be negative.';

-- ===========================================================================
-- 11. public.points_balance — the derived balance, and the only one
--     SECURITY INVOKER on purpose: the sum runs under the caller's own RLS, so
--     a user gets their own total and a platform reader gets whoever they are
--     allowed to see. A definer function here would have quietly become a
--     read path around the policies.
--     No clamping. A corrected balance that is negative is returned negative:
--     a floor at zero hides the correction the person would need in order to
--     dispute it, and a displayed number that disagrees with the ledger is the
--     mutable-balance failure mode reintroduced at the read layer.
-- ===========================================================================
create or replace function public.points_balance(p_user_id uuid default null)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $fn$
  select coalesce(sum(l.points_delta), 0)::bigint
  from public.points_ledger l
  where l.user_id = coalesce(p_user_id, (select auth.uid()));
$fn$;
comment on function public.points_balance(uuid) is 'The canonical Points balance: sum(points_delta) over the ledger, derived at read time. SECURITY INVOKER, so it returns 0 for a ledger the caller cannot read rather than leaking a total. Never clamped at zero — a negative balance after a correction is returned faithfully. There is no stored balance anywhere in this schema.';

-- ===========================================================================
-- 12. Execute grants
--     app.award_points and app.points_metadata_is_flat are INTERNAL: revoked
--     from every client role with no compensating grant. This is the property
--     that makes "the browser cannot award itself points" structural rather
--     than a matter of policy wording.
-- ===========================================================================
revoke execute on function
  app.award_points(uuid, uuid, text, text, uuid, integer, jsonb, text, uuid, uuid)
  from public, anon, authenticated, service_role;

revoke execute on function
  app.points_metadata_is_flat(jsonb)
  from public, anon, authenticated, service_role;

-- The two correction RPCs are reachable by authenticated callers, but each
-- re-checks app.is_platform('support') INSIDE the function body — being able to
-- call is not being allowed to act (a service-role key is not a business
-- authorization path, ADR-0008/D17).
revoke execute on function
  public.adjust_points(uuid, integer, text, uuid),
  public.reverse_points_entry(uuid, text),
  public.points_balance(uuid)
  from public, anon, service_role;

grant execute on function
  public.adjust_points(uuid, integer, text, uuid),
  public.reverse_points_entry(uuid, text),
  public.points_balance(uuid)
  to authenticated;
