-- Migration: Notifications Core — the first persisted per-recipient inbox.
--
-- Authority: docs/database/notifications-core.md (approved 2026-08-22).
-- This migration implements the DATABASE FOUNDATION ONLY. It deliberately does
-- NOT wire emission into the commerce RPCs (submit_rfq, decide_quotation,
-- create_order_from_quotation, …); those call sites are added in a later
-- increment, beside their existing app.record_audit_event(...) calls.
--
-- Why a table and not audit_log: audit_log is an append-only forensic trail read
-- by platform admins, one row per EVENT. A notification is mutable (read_at),
-- read only by its recipient, and is one row per EVENT x RECIPIENT. Making
-- audit_log mutable by ordinary users would destroy the one property that makes
-- it worth having. The two are written in the same transaction.
--
-- Security model (ADR-0008, deny-by-default writes):
--   • recipient_user_id is the ONLY authority column. organization_id is context.
--   • Exactly one SELECT policy; NO insert/update/delete policy at all.
--   • Every write is a security-definer function; app.notify* are internal-only.
--
-- Out of scope here and not to be added without a further approved spec:
-- Chat, Points, outbound delivery (email/WhatsApp), preferences, grouping,
-- Realtime publication, B2C events, retention/pruning.

-- ===========================================================================
-- 1. notifications — a durable, per-recipient inbox
-- ===========================================================================
create table public.notifications (
  id                 uuid primary key default extensions.gen_random_uuid(),
  -- The authority column. A notification belongs to a PERSON, not a company.
  recipient_user_id  uuid not null references public.users (id) on delete cascade,
  -- Context only: which workspace the notice belongs to, so the header can scope
  -- the list to the active work context. Nullable (personal context carries null).
  -- MUST NEVER appear in a USING clause — see the RLS section below.
  organization_id    uuid references public.organizations (id) on delete cascade,
  event_type         text not null,
  subject_type       text not null,
  subject_id         uuid,
  -- Stored, not computed at render time, so the destination reflects where the
  -- record lived when the event happened. Relative-only (see the CHECK below).
  deep_link          text not null,
  -- i18n KEYS, never rendered text: Arabic is an MVP release language and a
  -- user's locale can change after the row is written.
  title_key          text not null,
  body_key           text,
  -- Interpolation values only ({"org_name": "…"}), bounded and PII-minimised
  -- like audit metadata.
  params             jsonb not null default '{}'::jsonb,
  -- Unread is `read_at is null`. Not a boolean: this records WHEN at no extra
  -- cost, supports the partial index, and makes mark-read idempotent by
  -- construction. There is no updated_at — read_at is the only mutable column
  -- and is its own timestamp.
  read_at            timestamptz,
  created_at         timestamptz not null default now(),

  -- Bounded vocabulary, mirroring ck_audit_action_known so the two trails stay
  -- legible side by side. Extending it is a migration, deliberately.
  constraint ck_notifications_event_type_known check (event_type in (
    'rfq.submitted', 'rfq.cancelled',
    'quotation.submitted', 'quotation.accepted', 'quotation.rejected',
    'order.created', 'order.started', 'order.completed', 'order.cancelled',
    'project.created', 'project.activated', 'project.completed',
    'verification.approved', 'verification.rejected', 'verification.changes_requested'
  )),
  constraint ck_notifications_subject_type check (char_length(subject_type) between 1 and 64),
  -- Relative paths only: a leading slash, then path characters. Forbids
  -- https://…, protocol-relative //evil.example, javascript: and every other
  -- scheme, plus ? # & = — closing off open-redirect and script-URL injection
  -- AT THE COLUMN rather than at each render site.
  constraint ck_notifications_deep_link check (deep_link ~ '^/[A-Za-z0-9/_-]*$'),
  constraint ck_notifications_params_object check (jsonb_typeof(params) = 'object'),
  constraint ck_notifications_params_size check (length(params::text) <= 4096)
);
comment on table public.notifications is 'Per-recipient in-app inbox, one row per event x recipient. recipient_user_id is the only authority column; organization_id is context and must never appear in a USING clause. Writes happen exclusively through app.notify/app.notify_org (security definer); clients get SELECT plus the two mark-read RPCs. Stores i18n keys, never rendered text.';
comment on column public.notifications.organization_id is 'Workspace context for scoping the list to the active work context. NOT an authorization path: an inbox is personal even when its subject is corporate.';
comment on column public.notifications.deep_link is 'Relative path only (ck_notifications_deep_link). Not an authorization claim — the target route re-checks RLS, so a subject that later becomes invisible yields an ordinary not-found.';
comment on column public.notifications.read_at is 'Null means unread. Written only by mark_notification_read / mark_all_notifications_read, and only for the recipient.';

-- ===========================================================================
-- 2. Indexes — three, each earning its place
-- ===========================================================================
-- The important one. The header badge count and the unread panel run on EVERY
-- authenticated page render. Partial, so it holds only unread rows and stays
-- small permanently: rows LEAVE the index when they are read.
create index ix_notifications_recipient_unread
  on public.notifications (recipient_user_id, created_at desc)
  where read_at is null;

-- The full inbox list, which includes read rows and so cannot use the partial index.
create index ix_notifications_recipient_recent
  on public.notifications (recipient_user_id, created_at desc);

-- Dedupe ("has this subject already notified this recipient?") and subject lookups.
create index ix_notifications_subject
  on public.notifications (subject_type, subject_id);

-- ===========================================================================
-- 3. RLS — recipient-only, the narrowest rule that works
-- ===========================================================================
alter table public.notifications enable row level security;

-- Exactly ONE policy. Three exclusions are deliberate and must not be "fixed"
-- later without a revision of docs/database/notifications-core.md:
--   • No org-wide read policy. app.is_org_member(organization_id) would let
--     every employee read every colleague's inbox, including notices about deals
--     they are not party to.
--   • No platform-support read policy. Support has the complete forensic record
--     in audit_log; reading a personal inbox is a materially different act.
--   • No write policies. Every write is a security-definer RPC, matching orders,
--     projects, rfqs and quotations.
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (recipient_user_id = (select auth.uid()));

-- ===========================================================================
-- 4. Grants (deny-by-default; SELECT only — every write is a definer function)
--    service_role is granted NOTHING: a service-role key is not a business
--    authorization path (ADR-0008 / D17).
-- ===========================================================================
revoke all on public.notifications from anon, authenticated, service_role;
grant select on public.notifications to authenticated;

-- ===========================================================================
-- 5. app.notify — the single insertion point (INTERNAL ONLY)
--    Invoked only from other security-definer RPCs that have ALREADY authorized
--    the caller. Execute is revoked from every client role with no compensating
--    grant, so no product client can forge a notification.
-- ===========================================================================
create or replace function app.notify(
  p_recipient_user_id uuid,
  p_organization_id   uuid,
  p_event_type        text,
  p_subject_type      text,
  p_subject_id        uuid,
  p_deep_link         text,
  p_title_key         text,
  p_body_key          text default null,
  p_params            jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor  uuid := (select auth.uid());
  v_params jsonb := coalesce(p_params, '{}'::jsonb);
  v_id     uuid;
begin
  if p_recipient_user_id is null then
    raise exception 'notification recipient is required' using errcode = '22023';
  end if;

  -- Never notify the actor. Telling someone they did the thing they just did is
  -- noise, and suppressing it centrally is cheaper than at every call site.
  -- Returns null (a no-op), so callers can count "rows actually written".
  if v_actor is not null and p_recipient_user_id = v_actor then
    return null;
  end if;

  -- Fail at the WRITER rather than at the constraint, so a bad call site is
  -- diagnosable. These mirror ck_notifications_params_* / _deep_link exactly.
  if jsonb_typeof(v_params) <> 'object' then
    raise exception 'notification params must be a JSON object' using errcode = '22023';
  end if;
  if length(v_params::text) > 4096 then
    raise exception 'notification params exceed the 4096-byte limit' using errcode = '22023';
  end if;
  if p_deep_link is null or p_deep_link !~ '^/[A-Za-z0-9/_-]*$' then
    raise exception 'notification deep_link must be a relative path' using errcode = '22023';
  end if;

  insert into public.notifications (
    recipient_user_id, organization_id, event_type, subject_type, subject_id,
    deep_link, title_key, body_key, params
  )
  values (
    p_recipient_user_id, p_organization_id, p_event_type, p_subject_type, p_subject_id,
    p_deep_link, p_title_key, p_body_key, v_params
  )
  returning id into v_id;

  return v_id;
end;
$fn$;
comment on function app.notify(uuid, uuid, text, text, uuid, text, text, text, jsonb) is 'Internal-only notification writer. Inserts one row for one recipient, validates the payload at the writer, and suppresses self-notification (returns null). Not callable by clients; invoked from security-definer RPCs that have already authorized the caller.';

-- ===========================================================================
-- 6. app.notify_org — capability-scoped fan-out (INTERNAL ONLY)
--    Capability-scoped rather than org-wide: "your quotation was accepted"
--    should reach the people who can act on it, not every employee. Recipient
--    resolution reuses the same memberships + membership_capabilities join that
--    app.has_capability uses (that helper is caller-scoped, so it cannot be
--    called here — the join is the shared authority model, not a duplicate of it).
-- ===========================================================================
create or replace function app.notify_org(
  p_organization_id uuid,
  p_capability_key  text,
  p_event_type      text,
  p_subject_type    text,
  p_subject_id      uuid,
  p_deep_link       text,
  p_title_key       text,
  p_body_key        text default null,
  p_params          jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_recipient uuid;
  v_written   integer := 0;
  v_holders   integer := 0;
begin
  if p_organization_id is null then
    raise exception 'notification organization is required' using errcode = '22023';
  end if;

  -- Active memberships holding the capability, one row per recipient.
  for v_recipient in
    select distinct m.user_id
    from public.memberships m
    join public.membership_capabilities c on c.membership_id = m.id
    where m.organization_id = p_organization_id
      and m.status = 'active'
      and c.capability_key = p_capability_key
  loop
    v_holders := v_holders + 1;
    if app.notify(v_recipient, p_organization_id, p_event_type, p_subject_type,
                  p_subject_id, p_deep_link, p_title_key, p_body_key, p_params) is not null then
      v_written := v_written + 1;
    end if;
  end loop;

  -- Owner fallback: where the capability yields NO holder, the organization
  -- owner receives it, so a valid notice is never silently dropped. "Owner" is
  -- the established meaning used by app.assert_not_last_owner — an active
  -- membership holding org.manage. No new capability key is introduced.
  if v_holders = 0 then
    for v_recipient in
      select distinct m.user_id
      from public.memberships m
      join public.membership_capabilities c on c.membership_id = m.id
      where m.organization_id = p_organization_id
        and m.status = 'active'
        and c.capability_key = 'org.manage'
    loop
      if app.notify(v_recipient, p_organization_id, p_event_type, p_subject_type,
                    p_subject_id, p_deep_link, p_title_key, p_body_key, p_params) is not null then
        v_written := v_written + 1;
      end if;
    end loop;
  end if;

  return v_written;
end;
$fn$;
comment on function app.notify_org(uuid, text, text, text, uuid, text, text, text, jsonb) is 'Internal-only capability-scoped fan-out. Notifies active memberships holding the capability, falling back to org.manage holders when the capability has no holder so a notice is never silently dropped. Returns the number of rows actually written (self-notifications are suppressed by app.notify and are not counted).';

-- Internal-only: no client role may invoke either writer directly.
revoke execute on function
  app.notify(uuid, uuid, text, text, uuid, text, text, text, jsonb),
  app.notify_org(uuid, text, text, text, uuid, text, text, text, jsonb)
  from public, anon, authenticated, service_role;

-- ===========================================================================
-- 7. Public read-state RPCs — the only client write paths
-- ===========================================================================
-- Mark ONE notice read. Recipient-only; idempotent by construction (the
-- `read_at is null` predicate makes a second call a no-op), so the UI may fire
-- it optimistically.
create or replace function public.mark_notification_read(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor     uuid := (select auth.uid());
  v_recipient uuid;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Read the authority column directly (definer bypasses RLS), so a
  -- non-recipient gets 42501 rather than a silent no-op that looks like success.
  select n.recipient_user_id into v_recipient
  from public.notifications n
  where n.id = p_id;

  if v_recipient is null then
    raise exception 'notification not found' using errcode = '42501';
  end if;
  if v_recipient <> v_actor then
    raise exception 'not the recipient of this notification' using errcode = '42501';
  end if;

  update public.notifications
  set read_at = now()
  where id = p_id
    and recipient_user_id = v_actor
    and read_at is null;
end;
$fn$;
comment on function public.mark_notification_read(uuid) is 'Marks one notification read. Raises 42501 unless the caller is the recipient; sets read_at only where it is null, so repeat calls are no-ops.';

-- Mark every unread notice read for the caller, narrowed to one workspace when
-- p_org_id is supplied. Scoping to the active workspace means "clear all" in a
-- business context does not silently clear personal notices the user has not
-- seen. Returns the number affected. organization_id narrows; it never widens.
create or replace function public.mark_all_notifications_read(p_org_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor   uuid := (select auth.uid());
  v_updated integer;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  update public.notifications
  set read_at = now()
  where recipient_user_id = v_actor          -- the authority predicate, always
    and read_at is null
    and (p_org_id is null or organization_id = p_org_id);

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$fn$;
comment on function public.mark_all_notifications_read(uuid) is 'Marks every unread notification of the caller read, narrowed to organization_id = p_org_id when supplied (null = all of the caller''s notices). Returns the count affected. recipient_user_id = auth.uid() is unconditional: p_org_id narrows the set, never widens it.';

-- Execute grants — authenticated only (a service-role key is not a business
-- authorization path, ADR-0008/D17).
revoke execute on function
  public.mark_notification_read(uuid),
  public.mark_all_notifications_read(uuid)
  from public, anon, service_role;

grant execute on function
  public.mark_notification_read(uuid),
  public.mark_all_notifications_read(uuid)
  to authenticated;
