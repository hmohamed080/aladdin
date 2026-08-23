# Notifications Core — Database Specification

**Status:** **Approved and implemented** · 2026-08-22 · migrations `20260822090001_notifications_core.sql` (table, RLS, `app.notify*`), `20260822090002_notifications_event_wiring.sql` (15 emissions across 13 RPCs), `20260823090002` / `20260823090003` (`message.sent`, and its owner-fallback scoping)

## Purpose

Authorize and constrain the first persisted notification model, so that
`supabase/AGENTS.md` ("do not invent production tables without an approved
database specification") is satisfied before any migration is written.

This document specifies **Notifications Core only**: a durable, per-recipient
inbox for events the platform already emits. Chat, Points, and outbound delivery
(e-mail / WhatsApp) are explicitly out of scope — see [Out of scope](#out-of-scope).

## Why a new table, and not `audit_log`

`public.audit_log` already records every state transition with actor, action,
subject and organization. Reusing it as an inbox was considered and rejected on
four counts, each a structural conflict rather than a preference:

| | `audit_log` | `notifications` |
|---|---|---|
| **Reader** | platform admins only | the recipient, and nobody else |
| **Mutability** | append-only, never updated | `read_at` is written by the recipient |
| **Cardinality** | one row per *event* | one row per *event × recipient* |
| **Retention** | forensic, kept indefinitely | prunable; an old read notice has no value |

Adding `read_at` to `audit_log` would make an append-only forensic trail mutable
by ordinary users, which is the one property that makes it worth having. The two
tables therefore stay separate and are written in the same transaction.

What *is* reused is the **emission point**. Every commerce transition already
calls `app.record_audit_event(...)` from inside a `security definer` RPC, so
Notifications Core adds **no new call sites** — only a second write beside an
existing one.

## Table: `public.notifications`

```sql
create table public.notifications (
  id                 uuid primary key default extensions.gen_random_uuid(),
  recipient_user_id  uuid not null references public.users (id) on delete cascade,
  organization_id    uuid references public.organizations (id) on delete cascade,
  event_type         text not null,
  subject_type       text not null,
  subject_id         uuid,
  deep_link          text not null,
  title_key          text not null,
  body_key           text,
  params             jsonb not null default '{}'::jsonb,
  read_at            timestamptz,
  created_at         timestamptz not null default now(),

  constraint ck_notifications_event_type_known check (event_type in (
    'rfq.submitted', 'rfq.cancelled',
    'quotation.submitted', 'quotation.accepted', 'quotation.rejected',
    'order.created', 'order.started', 'order.completed', 'order.cancelled',
    'project.created', 'project.activated', 'project.completed',
    'verification.approved', 'verification.rejected', 'verification.changes_requested',
    -- Added 2026-08-23 by 20260823090002; see the mapping table below.
    'message.sent'
  )),
  constraint ck_notifications_subject_type check (char_length(subject_type) between 1 and 64),
  constraint ck_notifications_deep_link check (deep_link ~ '^/[A-Za-z0-9/_-]*$'),
  constraint ck_notifications_params_object check (jsonb_typeof(params) = 'object'),
  constraint ck_notifications_params_size check (length(params::text) <= 4096)
);
```

### Column decisions

- **`recipient_user_id` is the only authority column.** A notification belongs to
  a person, not to a company. Every RLS decision reads this column and no other.
- **`organization_id` is nullable context, never authority.** It records which
  workspace the notice belongs to, so the header can scope the list to the active
  work context and a personal-context notice can carry `null`. It must never
  appear in a `USING` clause — see [RLS](#rls--recipient-only).
- **`event_type` is a bounded allow-list**, matching the `ck_audit_action_known`
  pattern. The vocabulary mirrors the existing audit actions so the two trails
  stay legible side by side. Extending it is a migration, deliberately.
- **`title_key` / `body_key` / `params` store i18n keys, not rendered text.**
  Arabic is an MVP release language and a user's locale can change after the row
  is written; storing an English sentence would freeze one language into the
  record permanently. `params` carries only interpolation values
  (`{"org_name": "…", "total": "…"}`), bounded and PII-minimised like audit
  metadata.
- **`read_at timestamptz null`, not `is_read boolean`.** Unread is
  `read_at is null`. This records *when* a notice was read at no extra cost,
  supports the partial index below, and makes "mark read" idempotent by
  construction.
- **No `updated_at`.** The only mutable column is `read_at`, which is its own
  timestamp; a trigger-maintained `updated_at` would carry no additional fact.

### Indexes

```sql
create index ix_notifications_recipient_unread
  on public.notifications (recipient_user_id, created_at desc)
  where read_at is null;

create index ix_notifications_recipient_recent
  on public.notifications (recipient_user_id, created_at desc);

create index ix_notifications_subject
  on public.notifications (subject_type, subject_id);
```

Each is intentional, per `docs/database/naming-conventions.md`:

1. **`ix_notifications_recipient_unread`** — partial, and the important one. The
   header badge count and the unread panel are the two reads that run on *every
   authenticated page render*. A partial index holds only unread rows, so it stays
   small permanently even as the table grows, because rows leave the index when
   they are read.
2. **`ix_notifications_recipient_recent`** — the full inbox list, which includes
   read rows and therefore cannot use the partial index.
3. **`ix_notifications_subject`** — supports dedupe ("has this subject already
   notified this recipient?") and subject-driven lookups.

## RLS — recipient-only

RLS is mandatory. The rule is deliberately the narrowest one that works:

```sql
alter table public.notifications enable row level security;

create policy notifications_select_own on public.notifications
  for select to authenticated
  using (recipient_user_id = (select auth.uid()));
```

**There is exactly one SELECT policy, and no INSERT/UPDATE/DELETE policy at all.**

Three exclusions are deliberate and must not be "fixed" later without a revision
of this document:

- **No org-wide read policy.** A policy of the form
  `app.is_org_member(organization_id)` would let every employee read every
  colleague's inbox, including notices about deals they are not party to. An inbox
  is personal even when its subject is corporate. This is precisely why
  `organization_id` is context and not authority.
- **No platform-support read policy.** Support already has the complete forensic
  record in `audit_log`, which is the correct surface for investigation. Reading a
  user's personal inbox is a materially different act and is not granted here.
- **No write policies.** Every write is a `security definer` RPC, matching the
  deny-by-default convention used by `orders`, `projects`, `rfqs` and
  `quotations`.

### Grants

```sql
revoke all on public.notifications from anon, authenticated, service_role;
grant select on public.notifications to authenticated;
```

`service_role` is granted nothing: a service-role key is not a business
authorization path (ADR-0008 / D17), and every legitimate write path is a definer
function.

## RPC contracts

### Internal — `app.notify(...)`

```sql
app.notify(
  p_recipient_user_id uuid,
  p_organization_id   uuid,
  p_event_type        text,
  p_subject_type      text,
  p_subject_id        uuid,
  p_deep_link         text,
  p_title_key         text,
  p_body_key          text default null,
  p_params            jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = ''
```

- **Not callable by clients.** `revoke execute … from public, anon, authenticated`
  with no compensating grant. It is invoked only from other `security definer`
  RPCs that have already authorized the caller.
- Validates that `p_params` is a JSON object and `p_deep_link` is relative before
  insert, so a bad call fails at the writer rather than at the constraint.
- **Never notifies the actor.** If `p_recipient_user_id = auth.uid()` the call is
  a no-op returning `null`. Telling someone they did the thing they just did is
  noise, and it is cheaper to suppress here than at every call site.

### Internal — `app.notify_org(...)`

```sql
app.notify_org(
  p_organization_id uuid,
  p_capability_key  text,
  p_event_type      text,
  p_subject_type    text,
  p_subject_id      uuid,
  p_deep_link       text,
  p_title_key       text,
  p_body_key        text default null,
  p_params          jsonb default '{}'::jsonb,
  p_allow_owner_fallback boolean default true
) returns integer
```

Fans out to **active memberships holding `p_capability_key`**, one row per
recipient, returning the count written. Capability-scoped rather than org-wide:
"your quotation was accepted" should reach the people who can act on it, not
every employee of the company. Recipient resolution reuses the same
`memberships` + `membership_capabilities` join that `app.has_capability` already
uses. Where a capability yields no holder, the organization owner receives it, so
a notice is never silently dropped.

**`p_allow_owner_fallback` turns that last sentence off, per call.** The default
is `true`, so every event above keeps the fallback unchanged. It is passed
`false` only by `send_message`, and the reason generalises: the fallback is safe
exactly when an owner could already read the record the notice is about. For
every commerce and verification event that holds — an owner can open the rfq,
quotation, order or verification, so the fallback only widens *who is told* about
something they were already entitled to see. It does **not** hold for
`message.sent`: Chat access is `active membership + conversation.participate` and
nothing else, so an owner holding only `org.manage` is refused by
`conversations_select_party`, and telling them a conversation exists would
disclose its record and its counterparty past the boundary Chat enforces. **When
the counterparty organization has no capability holder, nobody is notified and
the message still persists** — a dropped notice is strictly safer than a
disclosed one, and the conversation is still there the moment somebody is granted
the capability.

The flag is a **call-site** decision, not a check on `p_event_type` inside the
helper: whether an owner may be told is a property of the emitting event's
authorization model, and hard-coding one event name into a generic mechanism
would quietly mislead the next event with the same shape.

### Public — `public.mark_notification_read(p_id uuid)`

```sql
returns void language plpgsql security definer set search_path = ''
```

- Raises `42501` unless `recipient_user_id = auth.uid()`.
- Sets `read_at = now()` only where `read_at is null`; re-marking is a no-op, so
  the call is idempotent and safe to fire optimistically from the UI.
- `grant execute to authenticated`.

### Public — `public.mark_all_notifications_read(p_org_id uuid default null)`

```sql
returns integer language plpgsql security definer set search_path = ''
```

Marks every unread notice for `auth.uid()`, narrowed to
`organization_id = p_org_id` when supplied, and returns the number affected.
Scoping to the active workspace means "clear all" in a business context does not
silently clear personal notices the user has not seen.

## MVP event-to-recipient mapping

Every row below already has a live emission point. The **Emitting RPC** column
names the function that will gain the `app.notify*` call, immediately beside its
existing `app.record_audit_event` call and inside the same transaction.

| Event | Emitting RPC | Recipient org | Capability | Deep link |
|---|---|---|---|---|
| `rfq.submitted` | `submit_rfq` | `rfqs.supplier_org_id` | `rfq.respond` | `/b2b/rfqs/{rfq_id}` |
| `rfq.cancelled` | `cancel_rfq` | `rfqs.supplier_org_id` | `rfq.respond` | `/b2b/rfqs/{rfq_id}` |
| `quotation.submitted` | `submit_quotation` | `quotations.requester_org_id` | `quote.decide` | `/b2b/quotations/{quotation_id}` |
| `quotation.accepted` | `decide_quotation` | `quotations.supplier_org_id` | `quote.submit` | `/b2b/quotations/{quotation_id}` |
| `quotation.rejected` | `decide_quotation` | `quotations.supplier_org_id` | `quote.submit` | `/b2b/quotations/{quotation_id}` |
| `order.created` | `create_order_from_quotation` | `orders.supplier_org_id` | `order.manage` | `/b2b/orders/{order_id}` |
| `order.started` | `start_order` | `orders.requester_org_id` | `order.create` | `/b2b/orders/{order_id}` |
| `order.cancelled` | `cancel_order` | counterparty of the actor's org | `order.manage` | `/b2b/orders/{order_id}` |
| `order.completed` | `complete_project` | `orders.requester_org_id` | `order.create` | `/b2b/orders/{order_id}` |
| `project.created` | `create_project_from_order` | `projects.requester_org_id` | `project.write` | `/b2b/projects/{project_id}` |
| `project.activated` | `activate_project` | `projects.requester_org_id` | `project.write` | `/b2b/projects/{project_id}` |
| `project.completed` | `complete_project` | `projects.requester_org_id` | `project.write` | `/b2b/projects/{project_id}` |
| `verification.approved` | `review_approve` | `verifications.organization_id` | `org.manage` | `/b2b/organization` |
| `verification.rejected` | `review_reject` | `verifications.organization_id` | `org.manage` | `/b2b/organization` |
| `verification.changes_requested` | `review_request_changes` | `verifications.organization_id` | `org.manage` | `/b2b/organization` |
| `message.sent` | `send_message` | counterparty of the sender's org | `conversation.participate` | the conversation's own subject route — `/b2b/rfqs/{id}`, `/b2b/quotations/{id}` or `/b2b/orders/{id}` |

Notes on the mapping:

- **The recipient is always the counterparty**, never the organization that acted.
  Combined with actor suppression inside `app.notify`, no organization is ever
  notified of its own action.
- **`order.completed` is emitted by `complete_project`**, not by a
  `complete_order` RPC — no such function exists; completing the project completes
  the order it belongs to. This specification follows the schema as built rather
  than as one might assume it to be.
- **`cancel_order` resolves the counterparty dynamically**, because either party
  may cancel: the recipient is whichever of `requester_org_id` /
  `supplier_org_id` the actor is *not* a member of.
- **Verification notices address the organization** via `org.manage`, because
  `verifications` may carry either `organization_id` or `user_id`; the
  personal-verification case is deferred with the rest of the B2C surface.
- **`message.sent` is the one event whose subject type is not fixed by its
  emitting RPC.** A conversation is a property of a transaction
  ([`chat-core.md`](chat-core.md) §4), so the notice inherits the conversation's
  own `subject_type` / `subject_id` — `rfq`, `quotation` or `order` — and its
  deep link is that record's existing route. There is deliberately **no `/chat`
  route to link to**, and none is invented: the recipient lands on the real
  transaction record, where the existing Chat entry point is.
- **`message.sent` is the one event with the owner fallback disabled**
  (`p_allow_owner_fallback => false`). Its recipients are exactly the active
  members of the opposite organization holding `conversation.participate` — the
  people who can actually open the thread. Every other event keeps the fallback.
- **`message.sent` carries no message content.** Its params are business context
  only (`counterparty_name`); the authored body is never copied into a
  notification row, never excerpted, and never previewed. A notification says
  *that* correspondence happened, and the thread itself stays behind the Chat
  authorization path rather than being partially mirrored into an inbox with
  different visibility rules.
- **`message.sent` is not deduped or grouped in the Pilot.** Every successfully
  persisted message emits one independent notification event. This was raised as
  Q6 in `chat-core.md` and is now decided; see §13.2 there for the decision and
  the conditions under which it should be revisited.
- Every capability named above is already in use in the schema. Every target
  route already exists. Nothing in this table needs to be created first.

## Deep-link rules

`deep_link` is stored, not computed at render time, so the destination reflects
where the record lived when the event happened. The rules are enforced by the
`ck_notifications_deep_link` CHECK constraint, not by convention:

1. **Relative paths only.** Must match `^/[A-Za-z0-9/_-]*$` — a leading slash,
   then path characters only. This forbids `https://…`, protocol-relative
   `//evil.example`, `javascript:` and any other scheme, closing off open-redirect
   and script-URL injection at the column rather than at each render site.
2. **No query string and no fragment.** The character class excludes `?`, `#`,
   `&` and `=`. A notification points at a *record*, and any filter state it might
   carry would be stale by the time it is read.
3. **Path segments come from ids the RPC already holds**, never from user text,
   so no interpolation can escape the pattern.
4. **The link is not an authorization claim.** Following it lands on a route that
   re-checks RLS. A notice whose subject later becomes invisible to the recipient
   yields an ordinary not-found, never a leak.
5. **Rendered with `next/link`** against the stored value; the UI never rebuilds,
   rewrites, or concatenates onto the stored path.

## Realtime

The table is **not** added to the `supabase_realtime` publication in this
increment. Realtime is a one-line follow-up
(`alter publication supabase_realtime add table public.notifications`) and RLS
authorizes each subscriber individually, but it opens a live socket on every
authenticated page and this table's write volume is currently unknown.
Persistence plus read-on-navigation ships first; the publication is revisited
once real volume is observable.

When it is added, replica identity stays default, so change frames carry only the
primary key and the client re-fetches through RLS — the convention already set by
`leads` and `follow_up_tasks` in `20260806090001_sales_ownership_and_realtime.sql`.

## Testing requirements

A pgTAP suite in `supabase/tests/` is mandatory before merge and must cover:

- **Recipient isolation** — user B cannot read user A's rows, **including when
  both are active members of the same organization**. This is the test that proves
  `organization_id` is not being used as authority.
- **Tenant isolation** — members of org B cannot read org A's notices.
- **`mark_notification_read`** rejects a non-recipient with `42501`, and is
  idempotent when called twice.
- **`mark_all_notifications_read`** respects `p_org_id` scoping and never clears
  another user's rows.
- **`app.notify` / `app.notify_org` are not executable** by `authenticated`.
- **Actor suppression** — the acting organization receives no notice.
- **Deep-link constraint** rejects absolute URLs, scheme-bearing values, and
  values carrying `?` or `#`.
- **Emission** — each RPC in the mapping table writes exactly the expected rows,
  to exactly the expected recipients.
- **Owner-fallback scoping** — an event passing `p_allow_owner_fallback => false`
  notifies nobody when the capability has no holder, while an event in the same
  organization state that keeps the default still reaches the `org.manage` owner.
  (`message.sent` is the only such event today;
  `34_chat_message_notifications_test.sql` covers both halves.)

## Out of scope

Explicitly **not** part of Notifications Core, and not to be added without a
further approved specification:

- **Chat / messaging.** Notifications Core introduced no conversation, thread or
  message model, and did not change the `ChatMenu` shell.
  **Superseded 2026-08-23:** that model now exists
  ([`chat-core.md`](chat-core.md)), `ChatMenu` is a real list with a real unread
  count, and this document's mapping table above carries `message.sent`. What
  remains out of scope here is unchanged: Notifications owns no chat model of its
  own, and stores no message content.
- **Points / gamification.** No balance, ledger, tier, reward, or leaderboard
  model. The `/b2b/points` route stays a shell.
- **Outbound delivery** — e-mail, WhatsApp, or push. This table is an in-app inbox
  only. Delivery is a background-worker concern whose host is still undecided
  (ADR-0009).
- **Notification preferences** — per-event mute, digest scheduling, channel
  selection, quiet hours.
- **Grouping, threading, or digesting** of related notices.
- **Realtime subscription** (deferred as above).
- **B2C / personal-context events.** The MVP mapping covers B2B commerce and
  organization verification only.
- **Retention and pruning policy.** The table is prunable by design, but no job is
  specified here.

## References

- `docs/database/naming-conventions.md` — table, index, constraint and policy naming
- `docs/database/migration-strategy.md` — the migration workflow this precedes
- `supabase/AGENTS.md` — the RLS mandate and the specification requirement this satisfies
- ADR-0002 (migrations), ADR-0007 (identity & tenancy), ADR-0008 (B2B sales domain, deny-by-default writes)
- `docs/architecture/realtime-and-background-jobs.md` — Notifications listed as a Realtime consumer
