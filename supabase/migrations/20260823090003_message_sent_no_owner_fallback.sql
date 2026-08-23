-- message.sent must never reach someone who cannot open the thread.
--
-- Authority: docs/database/chat-core.md §13.1, docs/database/notifications-core.md
-- ("Internal — app.notify_org"). Fixes a recipient-authority mismatch introduced
-- by 20260823090002_chat_message_notifications.sql.
--
-- THE DEFECT
-- app.notify_org falls back to org.manage holders when p_capability_key yields
-- no holder, so that a notice is never silently dropped. That is right for every
-- commerce and verification event: an owner can already read the rfq, quotation,
-- order or verification the notice is about, so the fallback widens WHO is told
-- about a record they were already entitled to see.
--
-- It is wrong for message.sent. Chat access is `active membership +
-- conversation.participate in a party org` and nothing else — an owner holding
-- only org.manage is refused by conversations_select_party. So in a recipient
-- organization with no conversation.participate holder, the fallback would tell
-- an owner that a conversation exists, on which record, and with which
-- counterparty — every fact except the body — about a thread they cannot open.
-- The notification would have become a wider read path than the feature it
-- describes, which is exactly the divergence Chat's RLS was shaped to prevent.
--
-- THE FIX, and why it is a parameter rather than a special case
-- app.notify_org gains `p_allow_owner_fallback boolean default true`. The
-- default preserves today's behaviour for all thirteen existing call sites
-- without touching one of them, and send_message passes `false`.
--
-- The flag lives at the CALL SITE because whether an owner may be told is a
-- property of the EVENT's authorization model, which only the emitting RPC
-- knows. Hard-coding `p_event_type <> 'message.sent'` inside the helper would
-- put Chat policy inside a generic mechanism and quietly mislead the next event
-- with the same shape.
--
-- WHEN NOBODY IS AUTHORISED, NOBODY IS TOLD. If the counterparty organization
-- has no active conversation.participate holder, this emits zero rows and the
-- message still persists. Silence is the correct outcome: the alternative is
-- disclosing a thread to someone the database would refuse to show it to. The
-- counterparty still sees the conversation the moment somebody there is granted
-- the capability, because Chat reads are live, not replayed from the inbox.
--
-- Adding a defaulted parameter requires DROP + CREATE rather than CREATE OR
-- REPLACE: a 10-argument overload beside the existing 9-argument function would
-- make every existing 9-argument call ambiguous ("function is not unique").
-- Dropping is safe — plpgsql resolves callees by name at execution time, so the
-- thirteen callers rebind to the new definition with the default applied.

-- ===========================================================================
-- 1. app.notify_org — same body, one new switch on the fallback branch
-- ===========================================================================
drop function if exists app.notify_org(uuid, text, text, text, uuid, text, text, text, jsonb);

create function app.notify_org(
  p_organization_id     uuid,
  p_capability_key      text,
  p_event_type          text,
  p_subject_type        text,
  p_subject_id          uuid,
  p_deep_link           text,
  p_title_key           text,
  p_body_key            text default null,
  p_params              jsonb default '{}'::jsonb,
  -- Added here. Default true, so every pre-existing caller keeps the approved
  -- owner fallback with no change at its call site.
  p_allow_owner_fallback boolean default true
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
  --
  -- SUPPRESSED when the caller says the event's own authorization model does not
  -- admit an owner who lacks p_capability_key. For such events a dropped notice
  -- is strictly safer than a disclosed one.
  if v_holders = 0 and p_allow_owner_fallback then
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
comment on function app.notify_org(uuid, text, text, text, uuid, text, text, text, jsonb, boolean) is 'Internal-only capability-scoped fan-out. Notifies active memberships holding the capability, falling back to org.manage holders when the capability has no holder so a notice is never silently dropped. Pass p_allow_owner_fallback => false for events whose own authorization model would refuse such an owner — message.sent does, because Chat access requires conversation.participate and an owner without it cannot open the thread. Returns the number of rows actually written (self-notifications are suppressed by app.notify and are not counted).';

-- The drop took the revokes with it; internal-only status is re-established.
revoke execute on function
  app.notify_org(uuid, text, text, text, uuid, text, text, text, jsonb, boolean)
  from public, anon, authenticated, service_role;

-- ===========================================================================
-- 2. send_message — opt out of the fallback, nothing else
-- ===========================================================================
-- Reproduced from 20260823090002 with ONE change: the tenth argument.
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
  v_actor     uuid := (select auth.uid());
  v_c         public.conversations;
  v_org       uuid;
  v_body      text;
  v_id        uuid;
  v_recipient uuid;
  v_link      text;
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

  -- === message.sent emission ==============================================
  -- The recipient is the OPPOSITE party, taken from the very row this function
  -- already locked and authorized against. It is NOT a second independent
  -- membership guess: v_org was resolved above as exactly one of these two
  -- columns, so "the other one" is total, and the notice can never address a
  -- party the message itself was not authorized against.
  v_recipient := case
                   when v_org = v_c.requester_org_id then v_c.supplier_org_id
                   else v_c.requester_org_id
                 end;

  -- There is deliberately no /chat route, so the notice deep-links to the REAL
  -- transaction record and the reader opens Chat from the entry point already
  -- there. ck_conversations_subject_type bounds subject_type to these three, so
  -- the CASE is total; the else exists because a null deep_link would violate a
  -- not-null column far away from the cause, and a loud failure here is better.
  v_link := case v_c.subject_type
              when 'rfq'       then '/b2b/rfqs/'
              when 'quotation' then '/b2b/quotations/'
              when 'order'     then '/b2b/orders/'
              else null
            end;
  if v_link is null then
    raise exception 'no deep link is defined for conversation subject type %', v_c.subject_type
      using errcode = '22023';
  end if;
  v_link := v_link || v_c.subject_id::text;

  -- One notice per persisted message — no dedupe, grouping or digest in the
  -- Pilot (chat-core.md §13.2). Fan-out and actor suppression are
  -- app.notify_org's, not reimplemented here.
  --
  -- p_allow_owner_fallback => FALSE. This is the recipient-authority rule: the
  -- notice may reach ONLY active members of the opposite organization who hold
  -- conversation.participate — exactly the people conversations_select_party
  -- would let open the thread. An org.manage owner without the capability cannot
  -- read the conversation, so telling them one exists would disclose its
  -- existence, its record and its counterparty past the boundary Chat enforces.
  -- Where the counterparty has no holder at all, nobody is notified and the
  -- message still persists.
  --
  -- PARAMS CARRY BUSINESS CONTEXT ONLY. v_body is deliberately absent: the
  -- authored message is never copied, excerpted or previewed into a
  -- notification row, because notifications and Chat have different visibility
  -- rules and a preview would mirror private correspondence past the narrower
  -- one. The notice says THAT a message exists; the thread stays behind Chat.
  perform app.notify_org(
    v_recipient, 'conversation.participate',
    'message.sent', v_c.subject_type, v_c.subject_id,
    v_link,
    'notifications.message.sent.title', 'notifications.message.sent.body',
    jsonb_build_object('counterparty_name', app.org_display_name(v_org)),
    false);
  -- === end emission =======================================================

  return v_id;
end;
$fn$;
comment on function public.send_message(uuid, text) is 'Appends one immutable message and advances conversations.last_message_at in the same transaction. sender_user_id comes from auth.uid() and sender_organization_id is resolved by capability lookup against the conversation''s party columns — neither is a parameter. Rejects non-participants (42501) and empty, whitespace-only or over-4000-character bodies (22023). Emits no audit row. Emits exactly one message.sent notification to the OPPOSITE party organization via app.notify_org/conversation.participate, in the same transaction, carrying the conversation''s own subject and NO message body. The owner fallback is DISABLED for this event: only holders of conversation.participate — the people who can actually open the thread — are ever told.';
