-- Transactional Chat -> Notifications: the message.sent integration.
--
-- Authority: docs/database/chat-core.md §13 (Q6 decided 2026-08-23) and
-- docs/database/notifications-core.md, "MVP event-to-recipient mapping".
-- Foundation: 20260822090001_notifications_core.sql (table, RLS, app.notify*),
--             20260823090001_chat_core.sql (conversations, messages, RPCs).
--
-- This migration does exactly the two things chat-core.md §13.3 predicted, and
-- nothing else:
--   1. ck_notifications_event_type_known gains 'message.sent';
--   2. public.send_message is CREATE OR REPLACE'd with ONE app.notify_org call
--      added beside the existing writes, inside the same transaction.
--
-- It adds NO new fan-out mechanism and NO new helper. app.notify_org already
-- owns capability-scoped delivery and the approved org.manage owner fallback;
-- app.notify already suppresses self-notification. Neither is modified here, and
-- neither is public.notifications, its RLS, its indexes, or the read-state RPCs.
--
-- Chat's schema, RLS policies, capability model and error codes are untouched.
-- send_message keeps its signature, its authorization, its sender derivations,
-- its body validation, its immutable insert, its last_message_at bump, its
-- read-state upsert, its error codes, its definer settings and its grants.
--
-- TRANSACTIONAL COUPLING is the point. The notify call is an ordinary statement
-- in the same transaction as the message insert, not a deferred or background
-- write, and its failures propagate rather than being swallowed. So either the
-- message, the last_message_at bump AND the notification all commit, or none of
-- them does. A message nobody was told about is not an acceptable partial state.
--
-- Deliberately NOT here: Realtime (no publication change), Points, message
-- previews in notifications, grouping, digests, notification preferences, and
-- any 'project' chat subject.

-- ===========================================================================
-- 1. The bounded event vocabulary gains exactly one value
-- ===========================================================================
-- Extending the allow-list is a migration by design (notifications-core.md).
-- The constraint is dropped and re-added rather than edited in place because
-- Postgres has no "alter check"; every pre-existing value is reproduced verbatim
-- so this is purely additive.
alter table public.notifications
  drop constraint ck_notifications_event_type_known;

alter table public.notifications
  add constraint ck_notifications_event_type_known check (event_type in (
    'rfq.submitted', 'rfq.cancelled',
    'quotation.submitted', 'quotation.accepted', 'quotation.rejected',
    'order.created', 'order.started', 'order.completed', 'order.cancelled',
    'project.created', 'project.activated', 'project.completed',
    'verification.approved', 'verification.rejected', 'verification.changes_requested',
    'message.sent'
  ));

-- ===========================================================================
-- 2. public.send_message — reproduced verbatim, with emission added
-- ===========================================================================
-- Everything above the marked block is character-for-character the definition
-- from 20260823090001_chat_core.sql. Read the diff as: one declare line, one
-- deep-link resolution, one recipient resolution, one app.notify_org call.
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
  -- Added by this migration.
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

  -- === message.sent emission (added by 20260823090002) ====================
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
  -- Pilot (chat-core.md §13.2). Fan-out, the org.manage owner fallback and
  -- actor suppression are all app.notify_org's, not reimplemented here.
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
    jsonb_build_object('counterparty_name', app.org_display_name(v_org)));
  -- === end emission =======================================================

  return v_id;
end;
$fn$;
comment on function public.send_message(uuid, text) is 'Appends one immutable message and advances conversations.last_message_at in the same transaction. sender_user_id comes from auth.uid() and sender_organization_id is resolved by capability lookup against the conversation''s party columns — neither is a parameter. Rejects non-participants (42501) and empty, whitespace-only or over-4000-character bodies (22023). Emits no audit row. Emits exactly one message.sent notification to the OPPOSITE party organization via app.notify_org/conversation.participate, in the same transaction, carrying the conversation''s own subject and NO message body.';
