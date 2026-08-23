-- Migration: Transactional Chat Core — the first persisted messaging model.
--
-- Authority: docs/database/chat-core.md (approved 2026-08-23).
-- This migration implements the DATABASE FOUNDATION ONLY.
--
-- What this deliberately does NOT do, per §13/§14 of the specification:
--   • no Chat UI, no /chat route, no change to the ChatMenu shell;
--   • no Realtime publication change (public.messages is NOT added to
--     supabase_realtime — the seam is one additive line, later);
--   • no notification emission and NO 'message.sent' added to
--     ck_notifications_event_type_known (volume/dedupe is Q6, undecided);
--   • no Points, no attachments, no participants table, no 'project' subject.
--
-- The model in one sentence: a conversation is not a room, it is a property of a
-- transaction. It exists only when anchored to a business record that already
-- names exactly two organizations, and no RPC ever accepts an organization id
-- from the caller — both parties are DERIVED from the authoritative subject row.
--
-- Security model (ADR-0008, deny-by-default writes):
--   • access = active membership + 'conversation.participate' in EITHER party org
--     (the capability already exists in ck_membership_capability_key; no new key);
--   • three SELECT policies, and NO insert/update/delete policy on any table;
--   • every write is a security-definer RPC that re-checks business authority;
--   • BOTH app.* helpers (conversation_parties, can_participate) are
--     internal-only — no client role may execute either directly. The RLS
--     policy therefore inlines its predicate over app.has_capability, because
--     policy expressions run with the INVOKER's privileges.
--
-- Deliberately different from Notifications: a colleague holding the capability
-- CAN read the whole thread. An inbox is personal; a transactional conversation
-- is company correspondence (§6.3).

-- ===========================================================================
-- 1. conversations — one per commercial subject, both parties derived
-- ===========================================================================
create table public.conversations (
  id                uuid primary key default extensions.gen_random_uuid(),
  -- The discriminator, exactly as audit_log and notifications use it. Unlike
  -- those two it is a CLOSED allow-list, because here subject_type selects which
  -- table the parties are derived from — it is an access-control key, not a label.
  subject_type      text not null,
  subject_id        uuid not null,
  -- Both parties, DERIVED from the subject row by open_conversation and never
  -- accepted from a caller. Denormalised so that every policy on conversations
  -- AND on messages is a plain two-column capability check, instead of a
  -- three-branch polymorphic join in the hottest predicate of the feature.
  -- Safe because these are written exactly once, by a security-definer function,
  -- from the authoritative row, and no UPDATE path can ever change them.
  requester_org_id  uuid not null references public.organizations (id) on delete cascade,
  supplier_org_id   uuid not null references public.organizations (id) on delete cascade,
  -- Maintained by send_message in the same transaction. This column is what makes
  -- the unread badge a single index scan that never touches public.messages.
  last_message_at   timestamptz,
  created_by        uuid not null references public.users (id) on delete restrict,
  created_at        timestamptz not null default now(),

  -- 'project' is deliberately absent: projects are 1:1 with orders and name the
  -- same two organizations, so a project page shows its PARENT ORDER's thread.
  constraint ck_conversations_subject_type
    check (subject_type in ('rfq', 'quotation', 'order')),
  -- A tenant cannot converse with itself; mirrors ck_rfqs_distinct_orgs.
  constraint ck_conversations_distinct_orgs
    check (requester_org_id <> supplier_org_id)
);
comment on table public.conversations is 'One durable conversation per commercial subject (rfq | quotation | order). Both party organizations are DERIVED from the subject row by public.open_conversation and are never accepted from a caller. No status/archived_at/updated_at: a conversation is never closed and is never updated by a client — last_message_at is its only mutation, written inside send_message.';
comment on column public.conversations.subject_type is 'Closed allow-list (ck_conversations_subject_type). It selects the party-derivation rule in app.conversation_parties, so it is an access-control key; extending it is a migration, deliberately.';
comment on column public.conversations.requester_org_id is 'Derived from the subject row, never from client input. Denormalised so RLS is a two-column capability check rather than a polymorphic join.';
comment on column public.conversations.supplier_org_id is 'Derived from the subject row, never from client input. See requester_org_id.';
comment on column public.conversations.last_message_at is 'Advanced by public.send_message only. Compared against conversation_read_state.last_read_at to compute unread WITHOUT reading public.messages.';

-- ===========================================================================
-- 2. messages — append-only, plain text, derived attribution
-- ===========================================================================
create table public.messages (
  id                     uuid primary key default extensions.gen_random_uuid(),
  conversation_id        uuid not null references public.conversations (id) on delete cascade,
  -- WHO spoke, and on WHOSE BEHALF. Both are derived from auth.uid() + the
  -- conversation's own party columns; NEITHER is a parameter of send_message.
  -- on delete restrict: attribution of immutable correspondence must never
  -- silently become null (matches created_by on rfqs / quotations / orders).
  sender_user_id         uuid not null references public.users (id) on delete restrict,
  -- Not redundant with the conversation: it records WHICH SIDE spoke, which the
  -- thread view renders and which must survive the sender later changing orgs.
  sender_organization_id uuid not null references public.organizations (id) on delete restrict,
  -- Plain text, stored exactly as authored after edge-trimming. No HTML, no markdown
  -- contract, no body_html, no rendered variant, and no translation (§17).
  body                   text not null,
  created_at             timestamptz not null default now(),

  -- 4000 chars: longer-form than an operational note (rfqs.note is 2000), shorter
  -- than a document. Bounds row width and makes an abusive payload a constraint
  -- violation rather than a storage problem.
  constraint ck_messages_body_len check (char_length(body) between 1 and 4000),
  -- Belt and braces: send_message trims and raises 22023 on the empty result;
  -- this catches anything reaching the table by any other route.
  --
  -- The explicit character set is deliberate and load-bearing. Single-argument
  -- btrim(text) strips SPACES ONLY, so a body of newlines and tabs would survive
  -- both this constraint and the RPC's own emptiness test — while §5.2 of the
  -- specification requires whitespace-only messages to be rejected and its T-14
  -- names E'\n\t ' explicitly. The RPC trims with the SAME set, so the guard and
  -- the write path can never disagree.
  constraint ck_messages_body_not_blank check (btrim(body, E' \t\n\r\f\v') <> '')
);
comment on table public.messages is 'Append-only plain-text messages. Immutable by construction: no UPDATE or DELETE policy, no update/delete RPC, and no soft-delete column. sender_user_id and sender_organization_id are derived inside send_message and cannot be supplied by a caller.';
comment on column public.messages.sender_organization_id is 'The party organization the sender acted for, resolved by capability lookup against the conversation''s own two party columns. Never a parameter — this resolution IS the anti-spoofing mechanism.';
comment on column public.messages.body is 'Stored exactly as authored, after edge whitespace-trimming only. Arabic, English or mixed; byte-identical on read back. Never keyed, never translated.';

-- ===========================================================================
-- 3. conversation_read_state — per-user reading position
-- ===========================================================================
create table public.conversation_read_state (
  id              uuid primary key default extensions.gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.users (id) on delete cascade,
  last_read_at    timestamptz not null,

  constraint uq_conversation_read_state_user unique (user_id, conversation_id)
);
comment on table public.conversation_read_state is 'One row per user per conversation, created lazily on first read or first send. A user with no row has read nothing — coalesce(last_read_at, ''-infinity'') handles that with no backfill. Keyed on user_id (not membership_id) so the reading position SURVIVES a membership being suspended and later restored. Visibility requires BOTH ownership AND live access to the parent conversation.';
comment on column public.conversation_read_state.last_read_at is 'Moves forward only (greatest() in mark_conversation_read / send_message), so a replayed or out-of-order call can never resurrect unread badges.';

-- ===========================================================================
-- 4. Indexes — each justified by a real access path (supabase/AGENTS.md)
-- ===========================================================================
-- Uniqueness AND the subject -> conversation lookup, in ONE object. This is what
-- makes open_conversation idempotent under concurrency: the loser of a race gets
-- a conflict, which the RPC resolves into the existing row.
create unique index uq_conversations_subject
  on public.conversations (subject_type, subject_id);

-- The two org-scoped conversation lists (one per side of the party pair),
-- ordered the way the inbox renders them.
create index ix_conversations_requester
  on public.conversations (requester_org_id, last_message_at desc nulls last);
create index ix_conversations_supplier
  on public.conversations (supplier_org_id, last_message_at desc nulls last);

-- The thread page: newest messages of one conversation, id breaking ties.
create index ix_messages_conversation
  on public.messages (conversation_id, created_at desc, id desc);

-- uq_conversation_read_state_user (user_id, conversation_id) needs no companion
-- index: its user_id PREFIX serves the unread-badge join, and its full key is the
-- on-conflict target of the upsert. Deliberately absent: any index on
-- messages.sender_user_id / sender_organization_id (no access path reads by
-- sender), and any trigram or full-text index on body (search is out of scope).

-- ===========================================================================
-- 5. Authorization helpers
-- ===========================================================================
-- Chat WRITE-PATH authority in one place. Mirrors app.can_create_rfq /
-- app.can_manage_order in shape, but WITHOUT their `or org.manage` fallback:
-- §6.3 makes the capability the whole line — a colleague lacking
-- conversation.participate sees nothing, even an owner, even though they can
-- read the underlying RFQ. app.has_capability already requires
-- memberships.status = 'active', so membership and capability are one check,
-- evaluated at statement time, every time.
--
-- INTERNAL ONLY. Unlike the other app.can_* helpers this is NOT granted to
-- authenticated, so it is called exclusively by the three security-definer Chat
-- RPCs (which execute as the function owner and therefore hold EXECUTE).
--
-- Consequence, and the reason conversations_select_party does not call it:
-- an RLS policy expression is evaluated with the privileges of the INVOKING
-- role, so a policy referencing this function would fail outright with
-- "permission denied for function can_participate" for every client. The policy
-- therefore inlines the identical predicate over app.has_capability — the
-- primitive that is already granted to authenticated repository-wide and that
-- every other policy in the schema is built on. The two must stay in step; the
-- pgTAP suite exercises the RPC path and the policy path against the same
-- fixtures precisely so a divergence cannot pass unnoticed.
create or replace function app.can_participate(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_capability(p_org_id, 'conversation.participate');
$$;
comment on function app.can_participate(uuid) is 'Internal-only Chat authority check for the write paths: true when the caller holds an ACTIVE membership with conversation.participate in p_org_id. No org.manage fallback — in Chat the capability is the entire access rule (chat-core.md §6.3). Not executable by any client role; conversations_select_party inlines the equivalent app.has_capability predicate because RLS expressions run with the invoker''s privileges.';

-- Internal only, like app.conversation_parties. No compensating grant anywhere.
revoke execute on function app.can_participate(uuid)
  from public, anon, authenticated, service_role;

-- The ONE place a subject becomes an authorization decision. INTERNAL ONLY.
--
-- `visible` is not optional and not cosmetic. rfqs_select_supplier is
-- `status <> 'draft' and app.is_org_member(supplier_org_id)`: a draft is private
-- to the side that owns it. Without this gate a requester could open a
-- conversation on a DRAFT rfq and message the supplier — disclosing the RFQ's
-- existence and id before submission, straight through a channel that never
-- touches the rfqs policies. Chat must not become a side channel that leaks what
-- RLS hides, so conversation visibility exactly tracks subject visibility.
create or replace function app.conversation_parties(
  p_subject_type text,
  p_subject_id   uuid
)
returns table (requester_org_id uuid, supplier_org_id uuid, visible boolean)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if p_subject_type = 'rfq' then
    return query
      select r.requester_org_id, r.supplier_org_id, (r.status <> 'draft')
      from public.rfqs r
      where r.id = p_subject_id;

  elsif p_subject_type = 'quotation' then
    return query
      select q.requester_org_id, q.supplier_org_id, (q.status <> 'draft')
      from public.quotations q
      where q.id = p_subject_id;

  -- Unconditional: both parties can see an order from the moment it exists
  -- (create_order_from_quotation requires an ACCEPTED quotation), and
  -- order_status has no draft.
  elsif p_subject_type = 'order' then
    return query
      select o.requester_org_id, o.supplier_org_id, true
      from public.orders o
      where o.id = p_subject_id;

  else
    -- Defence in depth: open_conversation already rejects this, and
    -- ck_conversations_subject_type rejects it at the table.
    raise exception 'unsupported conversation subject type: %', p_subject_type
      using errcode = '22023';
  end if;
end;
$fn$;
comment on function app.conversation_parties(text, uuid) is 'Internal-only. Resolves the two AUTHORITATIVE organizations for a chat subject from its own row, plus whether that subject is legitimately visible to both parties (drafts are not). Returns zero rows when the subject does not exist. Never callable by a client: the browser must have no way to ask "who are the parties of this id?".';

-- Internal only, like app.notify. No compensating grant anywhere.
revoke execute on function app.conversation_parties(text, uuid)
  from public, anon, authenticated, service_role;

-- ===========================================================================
-- 6. RLS — deny by default; three SELECT policies and nothing else
-- ===========================================================================
alter table public.conversations           enable row level security;
alter table public.messages                enable row level security;
alter table public.conversation_read_state enable row level security;

-- Party capability only. There is deliberately NO conversations_select_platform,
-- a departure from rfqs/quotations/products: platform support reading private
-- correspondence is materially different from reading a commercial record, the
-- permissions matrix conditions it on a REPORT mechanism that does not exist in
-- this repository, and audit_log already records that a conversation was opened.
-- Note what is absent from this predicate: `id`. Knowing a conversation uuid
-- grants nothing, and neither does knowing an organization uuid — every path
-- runs through app.has_capability, which reads memberships for auth.uid().
--
-- The predicate is written over app.has_capability rather than over
-- app.can_participate DELIBERATELY. A policy expression is evaluated with the
-- privileges of the invoking role, so referencing an internal-only helper here
-- would deny every client outright rather than filter their rows. This is the
-- same primitive, with the same capability key, that app.can_participate is
-- defined as — and the one every other policy in this schema already uses.
create policy conversations_select_party on public.conversations
  for select to authenticated
  using (
    app.has_capability(requester_org_id, 'conversation.participate')
    or app.has_capability(supplier_org_id, 'conversation.participate')
  );

-- Visible exactly when the parent is. The subquery is itself RLS-filtered by the
-- policy above, so the predicate is written once — the pattern of
-- rfq_items_select_parent and quotation_items_select_parent.
create policy messages_select_parent on public.messages
  for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
    )
  );

-- Own rows, AND only while parent access lasts. BOTH conditions are load-bearing.
--
-- Ownership alone would leave a user's read-state rows readable after they lost
-- access to the conversations those rows point at. Those rows are not inert: each
-- discloses a conversation_id the caller may no longer open, and a last_read_at
-- proving the thread was still active — metadata about a transaction they are no
-- longer party to. conversations and messages would correctly return nothing
-- while this table quietly kept answering.
--
-- The name stays *_select_own because the AUDIENCE is still "own rows"; the
-- parent-access clause scopes that audience, the same shape as
-- rfqs_select_supplier carrying `status <> 'draft'`.
create policy conversation_read_state_select_own on public.conversation_read_state
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_read_state.conversation_id
    )
  );

-- ===========================================================================
-- 7. Grants (deny-by-default; SELECT only — every write is a definer function)
--    service_role is granted NOTHING, following notifications rather than rfqs:
--    a service-role key is not a business authorization path (ADR-0008 / D17),
--    and no worker has a stated reason to read private correspondence.
--    anon is granted nothing and appears in no policy: Chat has no public surface.
-- ===========================================================================
revoke all on public.conversations, public.messages, public.conversation_read_state
  from anon, authenticated, service_role;

grant select on public.conversations           to authenticated;
grant select on public.messages                to authenticated;
grant select on public.conversation_read_state to authenticated;

-- ===========================================================================
-- 8. public.open_conversation — idempotent get-or-create
--    Named open_ rather than create_ or get_ because it is honestly both, and
--    calling it twice is not an error.
-- ===========================================================================
create or replace function public.open_conversation(
  p_subject_type text,
  p_subject_id   uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor     uuid := (select auth.uid());
  v_parties   record;
  v_actor_org uuid;
  v_id        uuid;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- 1. Allow-list first, so an unknown discriminator never reaches derivation.
  if p_subject_type is null or p_subject_type not in ('rfq', 'quotation', 'order') then
    raise exception 'unsupported conversation subject type' using errcode = '22023';
  end if;
  if p_subject_id is null then
    raise exception 'a conversation subject is required' using errcode = '22023';
  end if;

  -- 2. Derive both parties from the AUTHORITATIVE subject row. A subject id that
  --    belongs to a different subject type simply does not resolve here.
  select * into v_parties
  from app.conversation_parties(p_subject_type, p_subject_id);
  if not found then
    raise exception 'conversation subject not found';
  end if;

  -- 3. A draft is private to the side that owns it (see app.conversation_parties).
  if not v_parties.visible then
    raise exception 'this subject is not yet visible to both parties' using errcode = '22023';
  end if;

  -- 4. The caller must hold the capability in one of the two DERIVED orgs. The
  --    caller supplies no organization id at any point, so naming someone else's
  --    RFQ yields 42501 rather than a conversation.
  if app.can_participate(v_parties.requester_org_id) then
    v_actor_org := v_parties.requester_org_id;
  elsif app.can_participate(v_parties.supplier_org_id) then
    v_actor_org := v_parties.supplier_org_id;
  else
    raise exception 'conversation.participate is required in a party organization'
      using errcode = '42501';
  end if;

  -- 5. Get-or-create against uq_conversations_subject. Two callers racing cannot
  --    produce two rows: the loser conflicts and reads the winner's row.
  insert into public.conversations (
    subject_type, subject_id, requester_org_id, supplier_org_id, created_by
  )
  values (
    p_subject_type, p_subject_id,
    v_parties.requester_org_id, v_parties.supplier_org_id, v_actor
  )
  on conflict (subject_type, subject_id) do nothing
  returning id into v_id;

  -- 6. Audit ONLY on first creation. Re-opening changes nothing, so it writes no
  --    row: a forensic trail of "someone looked at a thread" is noise.
  if v_id is not null then
    perform app.record_audit_event(
      'conversation.opened', 'conversation', v_id, v_actor_org,
      jsonb_build_object('subject_type', p_subject_type, 'subject_id', p_subject_id)
    );
    return v_id;
  end if;

  select c.id into v_id
  from public.conversations c
  where c.subject_type = p_subject_type
    and c.subject_id = p_subject_id;

  return v_id;
end;
$fn$;
comment on function public.open_conversation(text, uuid) is 'Idempotent get-or-create for the ONE conversation of a commercial subject. Takes no organization id: both parties are derived from the subject row, and the caller must hold conversation.participate in one of THEM. Rejects unknown subject types and draft subjects (22023), non-participants (42501), and missing subjects (not found). Writes conversation.opened to the audit trail on first creation only.';

-- ===========================================================================
-- 9. public.send_message — the only way a message is ever written
-- ===========================================================================
create or replace function public.send_message(
  p_conversation_id uuid,
  p_body            text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_c     public.conversations;
  v_org   uuid;
  v_body  text;
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- for update serialises the last_message_at bump against a concurrent sender.
  select * into v_c from public.conversations where id = p_conversation_id for update;
  if not found then
    raise exception 'conversation not found';
  end if;

  -- Resolve the sender's OWN side by capability lookup against the conversation's
  -- own two party columns. This resolution IS the anti-spoofing mechanism: it is
  -- a lookup, not an argument, so there is nothing for a client to falsify.
  if app.can_participate(v_c.requester_org_id) then
    v_org := v_c.requester_org_id;
  elsif app.can_participate(v_c.supplier_org_id) then
    v_org := v_c.supplier_org_id;
  else
    raise exception 'conversation.participate is required in a party organization'
      using errcode = '42501';
  end if;

  -- Same character set as ck_messages_body_not_blank: single-argument btrim
  -- would strip spaces only and let a body of newlines and tabs through.
  -- Only the EDGES are trimmed — interior whitespace is part of what the user
  -- wrote and is stored untouched.
  v_body := btrim(coalesce(p_body, ''), E' \t\n\r\f\v');
  if v_body = '' then
    raise exception 'a message cannot be empty' using errcode = '22023';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'a message cannot exceed 4000 characters' using errcode = '22023';
  end if;

  insert into public.messages (
    conversation_id, sender_user_id, sender_organization_id, body
  )
  values (p_conversation_id, v_actor, v_org, v_body)
  returning id into v_id;

  update public.conversations
  set last_message_at = now()
  where id = p_conversation_id;

  -- Advance the SENDER's own read state in the same transaction, so a user is
  -- never shown as having unread messages they wrote themselves. Strictly cheaper
  -- than carrying a last_message_sender_org_id column and testing it per count.
  insert into public.conversation_read_state as rs (conversation_id, user_id, last_read_at)
  values (p_conversation_id, v_actor, now())
  on conflict (user_id, conversation_id)
  do update set last_read_at = greatest(rs.last_read_at, excluded.last_read_at);

  -- No audit event per message: a forensic row per chat line would swamp
  -- audit_log, whose actions are lifecycle transitions. messages IS the record.
  -- No notification either — that seam is Q6 and is deliberately not wired.
  return v_id;
end;
$fn$;
comment on function public.send_message(uuid, text) is 'Appends one immutable message and advances conversations.last_message_at in the same transaction. sender_user_id comes from auth.uid() and sender_organization_id is resolved by capability lookup against the conversation''s party columns — neither is a parameter. Rejects non-participants (42501) and empty, whitespace-only or over-4000-character bodies (22023). Emits no audit row and no notification, by design.';

-- ===========================================================================
-- 10. public.mark_conversation_read — the only user-mutable value in Chat
-- ===========================================================================
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_c     public.conversations;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Definer bypasses RLS, so THIS CHECK IS THE ENFORCEMENT, not a convenience.
  -- It holds mutation to exactly the authority the SELECT policy applies to
  -- reads: a user who left the organization or lost the capability cannot
  -- advance even their own read pointer. Not-found is also 42501 so a caller
  -- cannot probe which conversation ids exist.
  select * into v_c from public.conversations where id = p_conversation_id;
  if not found then
    raise exception 'conversation not found' using errcode = '42501';
  end if;

  if not (app.can_participate(v_c.requester_org_id)
          or app.can_participate(v_c.supplier_org_id)) then
    raise exception 'conversation.participate is required in a party organization'
      using errcode = '42501';
  end if;

  -- user_id is written from auth.uid() and is NEVER a parameter, so no caller can
  -- move another user's pointer. greatest() makes the call monotonic, so a
  -- replayed or out-of-order request can never resurrect an unread badge.
  insert into public.conversation_read_state as rs (conversation_id, user_id, last_read_at)
  values (p_conversation_id, v_actor, now())
  on conflict (user_id, conversation_id)
  do update set last_read_at = greatest(rs.last_read_at, excluded.last_read_at);
end;
$fn$;
comment on function public.mark_conversation_read(uuid) is 'Upserts the CALLER''S OWN read pointer to now(), monotonically. Raises 42501 unless the caller currently holds conversation.participate in one of the conversation''s two party organizations — the definer function re-checks the same authority the RLS policy applies to reads. Idempotent, so the UI may fire it optimistically.';

-- Execute grants — authenticated only (a service-role key is not a business
-- authorization path, ADR-0008 / D17).
revoke execute on function
  public.open_conversation(text, uuid),
  public.send_message(uuid, text),
  public.mark_conversation_read(uuid)
  from public, anon, service_role;

grant execute on function
  public.open_conversation(text, uuid),
  public.send_message(uuid, text),
  public.mark_conversation_read(uuid)
  to authenticated;

-- ===========================================================================
-- 11. Audit action allow-list — ONE new value
--     The full list from 20260815090002 plus Chat's single lifecycle event.
--     No existing action is removed, and app.record_audit_event is unchanged.
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
  -- Transactional Chat Core. Exactly one action: a conversation coming into
  -- existence is a lifecycle transition; individual messages are not, and
  -- public.messages is itself the immutable record of them.
  'conversation.opened'
));
