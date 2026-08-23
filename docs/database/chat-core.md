# Transactional Chat Core — Database Specification

**Status:** **Approved and implemented** · 2026-08-23 · migrations `20260823090001_chat_core.sql` (tables, RLS, RPCs), `20260823090002_chat_message_notifications.sql` (`message.sent` emission), `20260823090003_message_sent_no_owner_fallback.sql` (recipient-authority correction)

## 1. Purpose

Authorize and constrain the first persisted messaging model, so that
`supabase/AGENTS.md` ("do not invent production tables without an approved
database specification") is satisfied before any migration exists.

This document specifies **Transactional Chat Core only**: durable, append-only
conversation between the **two organizations already party to a B2B commercial
record**. It is not a messenger. A conversation exists because a transaction
exists, and it is reachable only from that transaction.

The header's `ChatMenu` is currently an honest empty shell
(`frontend/src/components/layout/header-panels.tsx`), deliberately carrying no
count and no rows because "there is no messaging model in the repository". This
specification is the model that shell was waiting for — but **nothing in this
document is implemented, and the shell must not change until it is approved.**

Companion specification: [`notifications-core.md`](notifications-core.md), which
is implemented and whose conventions this document deliberately follows.

## 2. Non-goals

Chat in the Pilot is **transactional communication between business parties
already interacting through Aladdin**. It is explicitly not a social product.
None of the following is designed, reserved, or stubbed here — see
[§19 Out of scope](#19-out-of-scope) for the full list and the reasoning:

- no public chat, discovery, communities, or channels;
- no arbitrary user-to-user DMs — **there is no way to start a conversation with
  a person**, only with a transaction;
- no group chat beyond the two organizations the transaction already names;
- no attachments, media, voice, or calls;
- no reactions, editing, deletion, threads, replies, or forwarding;
- no typing indicators, presence, or read receipts;
- no AI replies and no bots.

## 3. Existing domain relationships inspected

Everything below was read from the migrations, not assumed. Nothing in this
specification requires a table, capability, route, or helper that does not
already exist.

### 3.1 The commercial spine

| Table | Migration | Party columns | Isolation constraint |
|---|---|---|---|
| `public.rfqs` | `20260810090001` | `requester_org_id`, `supplier_org_id` | `ck_rfqs_distinct_orgs` |
| `public.quotations` | `20260810090001` | `requester_org_id`, `supplier_org_id` | `ck_quotations_distinct_orgs` |
| `public.orders` | `20260811090001` | `requester_org_id`, `supplier_org_id` | `ck_orders_distinct_orgs` |
| `public.projects` | `20260811090001` | `requester_org_id`, `executing_org_id` | `ck_projects_distinct_orgs` |

**This is the single most important finding in the inspection.** Every
commercial record in the chain already carries *exactly two* organization
columns, already named identically across three of the four tables, and already
constrained so the two can never be the same tenant. An RFQ addresses **exactly
one** supplier (`supplier_org_id` is a scalar `not null` column, not a join
table). A quotation belongs to one RFQ, and `uq_quotations_rfq_live` permits at
most one live quotation per RFQ. An order is one per accepted quotation
(`uq_orders_quotation`), and a project is one per order (`uq_projects_order`).

So the two-party rule in [§4](#4-chosen-conversation-authority-model) is **proved
by the existing schema rather than assumed by this document**. Multi-party group
chat has no evidence anywhere in the repository and is therefore not designed.

### 3.2 The authorization model

- `app.is_org_member(p_org_id)` — `security definer`, `search_path = ''`, true
  when the caller holds an **`active`** membership. `public.membership_status` is
  `('invited', 'active', 'suspended', 'revoked')`; only `active` counts.
- `app.has_capability(p_org_id, p_key)` — the same, additionally joined to
  `membership_capabilities`. **A capability check already implies an active
  membership**, so the two never need to be combined.
- `app.is_platform(p_role)` — platform-role authority, used by the
  `*_select_platform` policies on `rfqs`, `quotations`, `products`.
- **`conversation.participate` already exists** in the fixed capability
  allow-list `ck_membership_capability_key` (introduced in
  `20260802090002_organizations_tenancy.sql`, carried forward unchanged through
  its latest redefinition in `20260811090001_orders_projects.sql`) and is
  **already granted by live role templates** in
  `20260809100000_business_onboarding.sql`,
  `20260812090001_pilot_people_ops.sql`,
  `20260815090001_persona_organization_type_separation.sql`, and
  `20260815090002_showroom_affiliation.sql`.

  **Chat therefore introduces no new capability key and requires no change to
  `ck_membership_capability_key`.** It also means real seeded organizations
  already have people holding it, so the model below is testable the day it
  lands. `docs/technical/07_permissions_matrix.md` has always listed
  `conversation.participate` under a `conversations` domain.

### 3.3 The write-path convention (ADR-0008)

Uniform across `sales`, `catalog`, `rfq`, `quotation`, `orders`, `projects` and
`notifications`, and followed here without deviation:

- base tables are **SELECT-only** for client roles; `revoke all … from anon,
  authenticated, service_role` precedes every grant;
- every mutation is `language plpgsql security definer set search_path = ''`;
- the actor is derived from `(select auth.uid())` — **never** passed as a
  parameter;
- authorization error is `42501`, invalid lifecycle/state is `22023`, optimistic
  concurrency conflict is `40001`;
- `app.record_audit_event(p_action, p_subject_type, p_subject_id,
  p_organization_id, p_metadata)` is called in the **same transaction** as the
  state change;
- `app.notify_org(p_organization_id, p_capability_key, …)` fans a notice out to
  active capability holders, falling back to `org.manage`, and
  `app.notify` suppresses self-notification.

### 3.4 The polymorphic subject pattern (already established — do not reinvent)

Two shipped tables already discriminate a subject the same way:

```
public.audit_log      (subject_type text not null, subject_id uuid)   -- ix_audit_subject
public.notifications  (subject_type text not null, subject_id uuid)   -- ix_notifications_subject
```

Both bound `subject_type` with `check (char_length(subject_type) between 1 and 64)`
and index `(subject_type, subject_id)`. Chat adopts this pattern verbatim, with
one deliberate tightening: because a conversation's `subject_type` **drives an
authorization decision** (it selects which table the parties are derived from),
it is constrained to a closed enumerated allow-list rather than a length check.
A free-form subject discriminator is acceptable for a forensic trail; it is not
acceptable for an access-control key.

### 3.5 Existing Chat surfaces (shells only — not to be modified)

- `ChatMenu` in `frontend/src/components/layout/header-panels.tsx` — an
  `EmptyPanel`, no count, no badge, no query, no storage, no subscription.
- i18n keys `chat.empty.title` / `chat.empty.body` exist in **both**
  `en.ts` and `ar.ts`; `nav.chat` is bilingual.
- **There is no `/chat` route** anywhere under `frontend/src/app`.
- **There are no `conversations` or `messages` tables** in any migration.

### 3.6 Pre-existing product documentation, and where this spec departs from it

`docs/technical/08_api_contracts.md` §10 sketches
`startConversation({subjectType, subjectId, participantUserIds[]})`,
`sendMessage({conversationId, body, attachments[]?})` and Realtime message
delivery. That document predates the Pilot and, in the same three lines, also
assumes attachments and Realtime — both of which this increment defers.

This specification keeps the `subjectType` / `subjectId` idea (it matches the
established pattern) and **deliberately drops `participantUserIds[]` and
`attachments[]`**, for the reasons in [§6](#6-chosen-user-access-model) and
[§19](#19-out-of-scope). `08_api_contracts.md` is a forward-looking contract
sketch, not the schema source of truth (`supabase/AGENTS.md`: migrations are).
**It is not edited by this task**; reconciling it is listed in
[§21](#21-recommended-implementation-sequence).

`docs/technical/07_permissions_matrix.md` also states
`Moderator/Admin | xt (on report) | — | — | audited` for conversations. That is a
conditional grant predicated on a **report**, and no reporting or moderation
model exists in the repository. It is therefore recorded as an open question in
[§20](#20-open-questions--blockers) and **no platform read policy is proposed
here**.

## 4. Chosen conversation authority model

> **A conversation is not a room. It is a property of a transaction.**

A conversation is valid if and only if it is anchored to an existing business
record that already names both organizations. There is no other way to create
one, and no RPC accepts an organization id from the caller.

### 4.1 Discriminator

`subject_type` + `subject_id`, exactly as `audit_log` and `notifications` use
them. No new polymorphic pattern is introduced.

### 4.2 Bounded MVP subject types

Exactly three:

| `subject_type` | Source table | Party A (`requester_org_id`) | Party B (`supplier_org_id`) |
|---|---|---|---|
| `rfq` | `public.rfqs` | `rfqs.requester_org_id` | `rfqs.supplier_org_id` |
| `quotation` | `public.quotations` | `quotations.requester_org_id` | `quotations.supplier_org_id` |
| `order` | `public.orders` | `orders.requester_org_id` | `orders.supplier_org_id` |

Enforced by `ck_conversations_subject_type check (subject_type in ('rfq',
'quotation', 'order'))` — an allow-list, matching `ck_audit_action_known` and
`ck_notifications_event_type_known`. Extending it is a migration, deliberately,
because each new value needs a party-derivation rule in
[§10](#10-transaction-subject--party-derivation-rules).

### 4.3 Why `project` is excluded from the Pilot

`projects` is 1:1 with `orders` (`uq_projects_order`) and names the **same two
organizations** under different column names (`executing_org_id` rather than
`supplier_org_id`). Admitting it would split one continuous two-party
conversation across two records for no gain, and would require the derivation
function to special-case a column name.

**Rule:** the project record page surfaces the conversation of its **parent
order** (`projects.order_id`). No new subject type, no fragmentation, one thread
per commercial relationship-instance. Revisiting this is
[Q1](#20-open-questions--blockers).

### 4.4 Considered and rejected: one thread per commercial chain

Anchoring every message to the originating **RFQ** — so RFQ, quotation and order
share one continuous thread — was considered, and rejected on evidence:

`uq_quotations_rfq_live` is a *partial* unique index
(`where status <> 'rejected'`), which exists precisely so that **a rejected
quotation frees the RFQ for a fresh one**. An RFQ can therefore carry more than
one commercial negotiation over its life, and a single RFQ-anchored thread would
silently merge them. Per-subject anchoring also matches the UI seam — the
conversation belongs to the record page the user is standing on.

### 4.5 Excluded: organization-relationship conversations

An org-to-org subject type is admissible only if the existing product model
genuinely requires it. The only org-to-org tables that exist are
`organization_join_requests` and `organization_referrals`
(`20260815090002_showroom_affiliation.sql`). Both are short-lived approval
records, neither carries a durable trading relationship, and neither has a
record page that would host a conversation. **No evidence — not included.**

## 5. Proposed schema

Three tables. Naming follows `docs/database/naming-conventions.md` throughout.

### 5.1 `public.conversations`

```sql
create table public.conversations (
  id                uuid primary key default extensions.gen_random_uuid(),
  subject_type      text not null,
  subject_id        uuid not null,
  -- Both parties, DERIVED from the subject row by the opening RPC and never
  -- accepted from a caller. Denormalised deliberately -- see 5.1.1.
  requester_org_id  uuid not null references public.organizations (id) on delete cascade,
  supplier_org_id   uuid not null references public.organizations (id) on delete cascade,
  -- Maintained by send_message in the same transaction. This column is what
  -- makes the unread badge a single index scan -- see 11.3.
  last_message_at   timestamptz,
  created_by        uuid not null references public.users (id) on delete restrict,
  created_at        timestamptz not null default now(),

  constraint ck_conversations_subject_type
    check (subject_type in ('rfq', 'quotation', 'order')),
  constraint ck_conversations_distinct_orgs
    check (requester_org_id <> supplier_org_id)
);
```

**No `status`, no `archived_at`, no `deleted_at`, no `updated_at`, no `version`.**
Each absence is a decision recorded in [§12](#12-lifecycle--immutability-rules).

#### 5.1.1 Why the parties are denormalised

The alternative is to resolve parties in RLS by joining back to the subject
table. That would force every policy on `conversations` **and every policy on
`messages`** to run a three-branch `CASE` over `rfqs` / `quotations` / `orders`
— a polymorphic join in the hottest predicate in the feature, evaluated once per
row on every thread read.

Denormalising costs two columns and buys a policy that is a plain two-column
capability check. The duplication is safe because the columns are written
**exactly once**, by a `security definer` function, from the authoritative
subject row, and there is no `UPDATE` path that can ever change them
([§14](#14-security-invariants), INV-6).

### 5.2 `public.messages`

```sql
create table public.messages (
  id                     uuid primary key default extensions.gen_random_uuid(),
  conversation_id        uuid not null references public.conversations (id) on delete cascade,
  -- WHO spoke, and on WHOSE BEHALF. Both are derived from auth.uid() + the
  -- conversation; neither is a parameter of send_message.
  sender_user_id         uuid not null references public.users (id) on delete restrict,
  sender_organization_id uuid not null references public.organizations (id) on delete restrict,
  body                   text not null,
  created_at             timestamptz not null default now(),

  constraint ck_messages_body_len check (char_length(body) between 1 and 4000),
  constraint ck_messages_body_not_blank check (btrim(body) <> '')
);
```

**Column decisions**

- **`sender_user_id` uses `on delete restrict`**, matching `created_by` on
  `rfqs`, `quotations` and `orders`. Attribution of an immutable business
  record must not silently become `null`.
- **`sender_organization_id` is not redundant with the conversation.** It records
  *which side* spoke, which the thread view needs to render, and which must
  survive the sender later moving between organizations. It is derived, not
  supplied ([§14](#14-security-invariants), INV-5).
- **`body` is plain text and is stored exactly as authored** (after `btrim`),
  in one column, in one language, with no markup. No HTML, no rich text, no
  markdown contract, no `body_html`, no rendered variant, and — per
  [§16](#16-bilingual--product-presentation-boundary) — **no translation**.
- **Maximum 4000 characters**, with the repository's existing text bounds as the
  scale: `rfqs.note` and `quotations.note` are 2000, `audit_log.metadata` is
  8192 bytes. A message is longer-form than an operational note and shorter than
  a document; 4000 bounds row width and makes an abusive payload a constraint
  violation rather than a storage problem.
- **Empty and whitespace-only messages are rejected twice** — `send_message`
  applies `btrim` and raises `22023` on the empty result, and
  `ck_messages_body_not_blank` catches anything that reaches the table by any
  other route. The trimmed value is what is stored.
- **No `updated_at`, no `edited_at`, no `deleted_at`, no `read_at`, no
  `attachment_ref`, no `reply_to_message_id`, no `seq`.** Messages are immutable
  ([§12](#12-lifecycle--immutability-rules)); read state is per-user, not
  per-message ([§11](#11-read-state-model)).

### 5.3 `public.conversation_read_state`

```sql
create table public.conversation_read_state (
  id              uuid primary key default extensions.gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.users (id) on delete cascade,
  last_read_at    timestamptz not null,

  constraint uq_conversation_read_state_user unique (user_id, conversation_id)
);
```

One row per **user** per conversation, created lazily on first read or first
send. A user with no row has never opened the conversation, and every message in
it is unread — `coalesce(last_read_at, '-infinity')` handles that without a
backfill.

`user_id`, not `membership_id`: read state is a property of a person's attention,
and storing it against the person is what lets a row **survive a membership being
suspended and later restored** — the reader's position comes back with them
instead of being destroyed and rebuilt.

Storing it against the person is **not** the same as authorising it against the
person. This table has the narrowest visibility in the feature: a row is
readable and writable only when it is the caller's **and** the caller still has
live access to its parent conversation
([§7.4](#74-conversation_read_state--own-rows-and-only-while-parent-access-lasts)).

## 6. Chosen user-access model

> **Option A — derived from active organization membership + capability. There is
> no `conversation_participants` table.**

Access to a conversation is:

```
app.has_capability(requester_org_id, 'conversation.participate')
  OR
app.has_capability(supplier_org_id,  'conversation.participate')
```

`app.has_capability` already requires `memberships.status = 'active'`, so
membership and capability are one check, not two.

### 6.1 Why derived, not persisted

| | Derived (chosen) | Persisted participants table |
|---|---|---|
| Source of truth | `memberships` + `membership_capabilities` — already the source of truth for every other domain | a second, parallel authority that can drift from membership |
| Staff leaves the org | access ends the moment `status` leaves `active`, **with no cleanup job** | requires a revocation path; a missed one is a live cross-tenant leak |
| Staff joins mid-transaction | authorised immediately; nothing to invite | needs an invitation step nobody asked for |
| New capability key | none — `conversation.participate` already exists and is already granted | same |
| Individual mute / opt-out | not possible | possible |
| Outside individual invited in | not possible | possible |

The two capabilities in the bottom rows are exactly the two this Pilot does not
want. **A transactional conversation belongs to the businesses, not to two
individuals who happened to type first.** Sales staff rotate, an order outlives
the person who placed it, and the counterparty must never lose its channel
because an employee left. Persisting participants would model a social thread;
deriving them models a business relationship, which is what this is.

### 6.2 The questions this settles

- **Who may open/read?** Any user holding an **active** membership with
  `conversation.participate` in **either** party organization. Nobody else —
  including other members of the same organizations who lack the capability.
- **Who may send?** Exactly the same set. There is no read-only participant tier
  in the Pilot; a separate `conversation.read` capability was considered and
  rejected as an unjustified addition to a fixed catalog.
- **A user leaves an organization** — `memberships.status` becomes `suspended`
  or `revoked`, `app.has_capability` returns false, and **read and write both
  stop on the next statement**. No cleanup, no scheduled job, no stale row. This
  covers the conversation, its messages, **and their own read-state rows**, which
  are gated on live parent access rather than on ownership alone
  ([§7.4.2](#742-what-losing-access-does-precisely)) — so a departed user cannot
  even see which threads they were in or when they last read them. The same
  applies when the membership stays `active` but `conversation.participate` is
  withdrawn. Their historical messages remain, correctly attributed
  (`sender_user_id … on delete restrict`).
- **Newly-added authorised staff see the full earlier history**, from the first
  message onward. This is deliberate: the organization was party to the whole
  conversation, the new employee acts for the organization, and a partial thread
  is worse than useless when the question is "what did we agree?".
- **Access follows the organization's transaction**, never an individual
  invitation. There is no invitation mechanism, and none is to be added.

### 6.3 The colleague rule — stated explicitly, because it differs from Notifications

`notifications-core.md` deliberately refuses an org-wide read policy: an inbox is
personal even when its subject is corporate. **Chat takes the opposite position
on purpose.** A colleague holding `conversation.participate` in a party
organization **can read the whole thread**, because a transactional conversation
*is* company correspondence — the commercial equivalent of a shared mailbox, and
the same people can already read the underlying `rfqs`, `quotations` and
`orders` rows.

The capability is what draws the line: a colleague *without*
`conversation.participate` sees nothing, even though they may be able to read the
RFQ itself. This is the deliberate grant this model makes, and it is what
[§15](#15-pgtap-acceptance-matrix) T-07/T-08 assert in both directions.

## 7. RLS model

Deny-by-default, matching `orders`, `projects`, `rfqs`, `quotations` and
`notifications`. **Three SELECT policies in total, and no INSERT, UPDATE or
DELETE policy on any of the three tables.**

```sql
alter table public.conversations           enable row level security;
alter table public.messages                enable row level security;
alter table public.conversation_read_state enable row level security;
```

### 7.1 Helper

```sql
create or replace function app.can_participate(p_org_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select app.has_capability(p_org_id, 'conversation.participate'); $$;
```

Mirrors `app.can_create_rfq` / `app.can_respond_rfq` / `app.can_manage_order`
exactly. `revoke execute … from public`, `grant execute … to authenticated`,
as with every other `app.can_*`.

### 7.2 `conversations` — party capability only

```sql
create policy conversations_select_party on public.conversations
  for select to authenticated
  using (app.can_participate(requester_org_id) or app.can_participate(supplier_org_id));
```

**There is no `conversations_select_platform` policy**, which is a deliberate
departure from `rfqs`/`quotations`/`products`. Platform support reading private
correspondence is materially different from reading a commercial record, the
permissions matrix conditions it on a *report* mechanism that does not exist, and
the audit trail already records that a conversation was opened. See
[Q2](#20-open-questions--blockers).

### 7.3 `messages` — visible exactly when the parent is

```sql
create policy messages_select_parent on public.messages
  for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = messages.conversation_id));
```

The subquery is itself RLS-filtered by the policy above, so the predicate is
written once. This is the exact pattern of `rfq_items_select_parent` and
`quotation_items_select_parent`.

### 7.4 `conversation_read_state` — own rows, and only while parent access lasts

Read state is authorised by **two conditions that must both hold**, not one:

```sql
create policy conversation_read_state_select_own on public.conversation_read_state
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_read_state.conversation_id
    )
  );
```

1. **`user_id = auth.uid()`** — a row is personal. **When a colleague last read a
   thread is nobody's business**; exposing it would be a read receipt, which is
   out of scope. This is the owner-only shape of `notifications_select_own`.
2. **The parent conversation must still be visible to the caller.** The `EXISTS`
   subquery is itself RLS-filtered by `conversations_select_party`
   ([§7.2](#72-conversations--party-capability-only)), so it resolves to the live
   test `app.can_participate(requester_org_id) or app.can_participate(supplier_org_id)`
   — which `app.has_capability` evaluates against `memberships.status = 'active'`
   and a currently-granted `conversation.participate`, at statement time, every
   time. The predicate is composed rather than restated, exactly as
   `messages_select_parent` composes it ([§7.3](#73-messages--visible-exactly-when-the-parent-is)).

**Why the second condition is not redundant.** Ownership alone would leave a
user's read-state rows readable after they lost access to the conversations those
rows point at. Those rows are not inert: each one discloses a **`conversation_id`
that the caller may no longer open**, and a **`last_read_at` timestamp** that
reveals the thread was still active — metadata about a transaction the caller is
no longer party to. `messages` and `conversations` would correctly return nothing
while `conversation_read_state` quietly kept answering. Read-state metadata is
therefore held to the same authority as the conversation it describes, and the
narrower of the two tests always wins.

Keeping the policy name `conversation_read_state_select_own` is deliberate: the
**audience** is still "own rows", and the parent-access clause is a scoping
condition on that audience — the same shape as `rfqs_select_supplier`, which
carries `status <> 'draft'` inside a policy still named for its audience.

#### 7.4.1 Mutation is held to the identical test

There is **no `INSERT`, `UPDATE` or `DELETE` policy** on this table, so the
`SELECT` policy above governs reads and the sole write path governs writes. That
path is `public.mark_conversation_read`
([§9.3](#93-publicmark_conversation_read)), which is `security definer` and
therefore bypasses RLS — meaning **its own explicit check is the enforcement**,
not a formality:

- it raises `42501` unless `app.can_participate` holds for one of the
  conversation's two party organizations **at the moment of the call**, and
- it writes `user_id = (select auth.uid())` rather than accepting a user id,

so the mutable set is exactly the readable set: *my row, in a conversation I can
still reach*. A caller can neither advance someone else's read pointer nor their
own on a conversation they have lost.

#### 7.4.2 What losing access does, precisely

When a user's membership leaves `active` (`suspended` or `revoked`), or their
`conversation.participate` capability is withdrawn, `app.has_capability` returns
false on the **next statement**. From that instant, and with **no cleanup job, no
scheduled sweep, and no cascade**:

| Surface | Effect |
|---|---|
| `conversations` | invisible — `conversations_select_party` no longer matches |
| `messages` | invisible — its parent-visibility `EXISTS` fails |
| `conversation_read_state` | **invisible** — condition 2 of the policy above fails, even though the rows are still the caller's own |
| `open_conversation` | `42501` |
| `send_message` | `42501` |
| `mark_conversation_read` | `42501` |

**Leaving the organization or losing the capability removes access to the
conversation and to its read-state metadata in the same instant, by the same
mechanism.** There is no window in which a departed user can still see which
threads they were in or when they last read them.

The rows are **retained, not deleted** — they are merely unreachable. If the
membership is later restored to `active` with the capability re-granted, the
user's read position returns intact and their unread badge is correct
immediately, with no backfill. This is the reason the table keys on `user_id`
rather than `membership_id` ([§5.3](#53-publicconversation_read_state)), and the
reason revocation needs no destructive step.

### 7.5 Grants

```sql
revoke all on public.conversations, public.messages, public.conversation_read_state
  from anon, authenticated, service_role;

grant select on public.conversations           to authenticated;
grant select on public.messages                to authenticated;
grant select on public.conversation_read_state to authenticated;
```

`service_role` is granted **nothing**, following `notifications` rather than
`rfqs` (which grants it `select`). A service-role key is not a business
authorization path (ADR-0008 / D17), no worker has a stated reason to read
private correspondence, and the grant can be added additively if one ever does.

`anon` is granted nothing and appears in no policy. Chat has no public surface.

### 7.6 What this model refuses

Knowing a UUID grants nothing, in all three directions:

- **a conversation UUID** — `conversations_select_party` ignores `id` entirely;
- **a subject UUID** — `open_conversation` re-derives parties from the subject
  row and checks capability against *them*, so naming someone else's RFQ returns
  `42501`;
- **an organization UUID** — every predicate runs through `app.has_capability`,
  which reads `memberships` for `auth.uid()`; an org id in a request is never an
  authority claim.

Cross-tenant isolation is therefore structural: org C, holding
`conversation.participate` in its own org, matches neither `requester_org_id` nor
`supplier_org_id` of an A–B conversation and sees zero rows — not an error, an
empty set.

## 8. Indexes

Every index is justified by a real access path, per `supabase/AGENTS.md`.

```sql
-- 1. Uniqueness AND the subject -> conversation lookup, in one object.
create unique index uq_conversations_subject
  on public.conversations (subject_type, subject_id);

-- 2/3. The two org-scoped conversation lists (one per side of the party pair),
--      ordered the way the inbox renders them.
create index ix_conversations_requester
  on public.conversations (requester_org_id, last_message_at desc nulls last);
create index ix_conversations_supplier
  on public.conversations (supplier_org_id, last_message_at desc nulls last);

-- 4. The thread page: newest messages of one conversation, id breaking ties.
create index ix_messages_conversation
  on public.messages (conversation_id, created_at desc, id desc);
```

`uq_conversation_read_state_user (user_id, conversation_id)` is declared as a
constraint in [§5.3](#53-publicconversation_read_state) and needs no separate
index: its **`user_id` prefix** serves the badge query, its full key serves the
`on conflict` upsert in `mark_conversation_read`.

**Deliberately absent:** no index on `messages.sender_user_id` or
`sender_organization_id` (no access path reads messages by sender), no trigram
or full-text index on `body` (search is out of scope — [§19](#19-out-of-scope)),
and no index on `created_by`.

### 8.1 An index that is also a constraint

`uq_conversations_subject` is the **uniqueness rule** of
[§12.2](#122-uniqueness) and the **lookup path** of `open_conversation` at the
same time. Two callers racing to open the same conversation cannot produce two
rows: the loser gets a unique violation, which the RPC resolves into the existing
row ([§9.1](#91-publicopen_conversation)).

## 9. RPC contracts

Three public functions. **Reads are plain RLS-scoped `SELECT`s** — listing
conversations, reading a thread, and computing unread counts all work through the
policies above, so none of them gets an RPC. No view is proposed either; if one
is added later it must be `security_invoker = true`, per
`20260817100000_catalog_view_invoker_hardening.sql`.

All three are `language plpgsql security definer set search_path = ''`, with
`revoke execute … from public` followed by `grant execute … to authenticated`.

### 9.1 `public.open_conversation`

```sql
public.open_conversation(p_subject_type text, p_subject_id uuid) returns uuid
```

Idempotent get-or-create. Named `open_` rather than `create_` or `get_` because
it is honestly both, and calling it twice is not an error.

1. Reject `p_subject_type` outside the allow-list — `22023`.
2. Derive `(requester_org_id, supplier_org_id, visible)` from the authoritative
   subject row via `app.conversation_parties`
   ([§10](#10-transaction-subject--party-derivation-rules)). Subject missing →
   not-found error, consistent with `submit_rfq`'s `'RFQ not found'`.
3. Reject unless the subject is `visible` to both parties — `22023`.
4. Reject unless the caller holds `conversation.participate` in **one of the two
   derived orgs** — `42501`. **The caller supplies no organization id at any
   point.**
5. `insert … on conflict (subject_type, subject_id) do nothing returning id`;
   on conflict, `select` the existing row. Returns the conversation id either way.
6. On first creation only, `app.record_audit_event('conversation.opened',
   'conversation', v_id, <caller's party org>, jsonb_build_object('subject_type',
   …, 'subject_id', …))`. Re-opening writes no audit row, because nothing changed.

### 9.2 `public.send_message`

```sql
public.send_message(p_conversation_id uuid, p_body text) returns uuid
```

1. Load the conversation `for update` (serialises the `last_message_at` bump).
   Not found → error.
2. Resolve the **sender's own side**: the one of `requester_org_id` /
   `supplier_org_id` in which the caller holds `conversation.participate`. **This
   resolution is the anti-spoofing mechanism** — it is a lookup, not an argument.
   Neither → `42501`.
3. `v_body := btrim(p_body)`; empty → `22023`; longer than 4000 → `22023`.
4. Insert with `sender_user_id = (select auth.uid())` and
   `sender_organization_id = <resolved side>`.
5. `update conversations set last_message_at = now()`.
6. Upsert the **sender's own** read state to `now()` — so a user is never shown
   as having unread messages they wrote themselves
   ([§11.3](#113-why-last_message_at-is-enough-and-why-counts-stay-cheap)).
7. Returns the new message id. **No audit event per message** — a forensic row
   per chat line would swamp `audit_log`, whose actions are lifecycle
   transitions; the messages table is itself the immutable record.
8. Notification emission: **one `app.notify_org(...)` to the opposite party**,
   in this same transaction — see [§13](#13-notifications-integration-seam).
   Added by `20260823090002_chat_message_notifications.sql` and amended by
   `20260823090003_message_sent_no_owner_fallback.sql`, which disables the
   `org.manage` owner fallback for this event — so the live definition of this
   function is 090003's. Every other step above is unchanged from the original.

Deliberately **no `p_expected_version`**: optimistic concurrency guards *edits*,
and there are none. Two people sending at once is a correct outcome, not a
conflict.

### 9.3 `public.mark_conversation_read`

```sql
public.mark_conversation_read(p_conversation_id uuid) returns void
```

1. Reject unless `app.can_participate` holds for one of the conversation's two
   party organizations **at the moment of the call** — `42501`. Because the
   function is `security definer` and so bypasses RLS, **this check is the
   enforcement, not a convenience**: it is what holds mutation to the same
   authority the `SELECT` policy applies to reads
   ([§7.4.1](#741-mutation-is-held-to-the-identical-test)). A user who has left
   the organization or lost the capability cannot advance their own read pointer.
2. `insert … values (p_conversation_id, auth.uid(), now())
   on conflict (user_id, conversation_id)
   do update set last_read_at = greatest(excluded.last_read_at, <existing>)`.
   **`user_id` is written from `(select auth.uid())` and is never a parameter**,
   so no caller can move another user's read pointer.

`greatest(...)` makes the call **monotonic**, so an out-of-order or replayed
request can never move a read pointer backwards and resurrect unread badges.
Idempotent, safe to fire optimistically from the UI — the same property
`mark_notification_read` was given.

**Not proposed:** a `mark_all_conversations_read`. Notifications has one because
an inbox accumulates notices nobody will open; a conversation is read by opening
it, and a bulk "mark everything read" would let a user dismiss a counterparty's
message without seeing it. Add it only if the UI proves a need.

## 10. Transaction subject → party derivation rules

All three subject types resolve through one internal helper, so there is exactly
one place where a subject becomes an authorization decision:

```sql
app.conversation_parties(p_subject_type text, p_subject_id uuid)
  returns table (requester_org_id uuid, supplier_org_id uuid, visible boolean)
  language plpgsql stable security definer set search_path = ''
```

`revoke execute … from public, anon, authenticated, service_role` — internal
only, like `app.notify`. It is called exclusively from `open_conversation`.

| `subject_type` | Parties read from | `visible` — both parties may legitimately see the subject |
|---|---|---|
| `rfq` | `rfqs.requester_org_id`, `rfqs.supplier_org_id` | `status <> 'draft'` |
| `quotation` | `quotations.requester_org_id`, `quotations.supplier_org_id` | `status <> 'draft'` |
| `order` | `orders.requester_org_id`, `orders.supplier_org_id` | always `true` |

### 10.1 Why `visible` exists, and why it is not optional

`rfqs_select_supplier` reads `status <> 'draft' and app.is_org_member(supplier_org_id)`,
and `quotations_select_requester` reads `status <> 'draft' and app.is_org_member(requester_org_id)`.
**A draft is private to the side that owns it.**

Without the `visible` gate, a requester could open a conversation on a *draft*
RFQ and message the supplier — disclosing both the RFQ's existence and its id
before submission, straight through a channel that never touches the `rfqs`
policies. Chat must not become a side channel that leaks what RLS hides. The gate
makes conversation visibility exactly track subject visibility.

`orders` is unconditional because both parties can see an order from the moment
it exists (`create_order_from_quotation` requires an `accepted` quotation), and
`order_status` has no draft.

### 10.2 The derivation is total — no subject type is under-determined

An under-determined subject type must be flagged rather than worked around.
**None of the three is under-determined**: each source table carries both
organization columns as `not null`, on the same row, with a `ck_*_distinct_orgs`
constraint. There is nothing to infer, no fallback, and no workaround anywhere in
this specification.

The under-determined cases are the ones **excluded** from the allow-list, and
they are excluded for exactly this reason:

- **B2C / consumer conversations** — a consumer is a `users` row and may hold
  **zero** organizations (`CLAUDE.md`, account model). There is no second
  organization to derive, so the two-party model does not describe this case at
  all. Out of scope; see [Q5](#20-open-questions--blockers).
- **Internal team chat** — one organization, not two; would violate
  `ck_conversations_distinct_orgs` by construction. Out of scope.

## 11. Read-state model

> **Chosen: per-participant `last_read_at`, one row per user per conversation.**

### 11.1 Why not the alternatives

| Model | Verdict |
|---|---|
| per-message receipt rows | **Rejected.** One row per message × per reader is a WhatsApp-style delivery/read matrix. It is out of scope, the UI shows no per-message ticks, and it multiplies write volume by the number of readers. |
| per-participant `last_read_message_id` | **Rejected.** Every unread comparison would need a join back to `messages` to fetch that message's timestamp before it could compare anything. It also assumes a participants table, which [§6](#6-chosen-user-access-model) removed. |
| per-participant **`last_read_at`** | **Chosen.** Directly comparable to `messages.created_at` and to `conversations.last_message_at` with no join, monotonic under `greatest()`, and the same `timestamptz`-not-boolean convention `notifications.read_at` already set. |

### 11.2 The three reads it must serve

```sql
-- (a) unread indicator, one conversation
select c.last_message_at > coalesce(rs.last_read_at, '-infinity') as has_unread
from public.conversations c
left join public.conversation_read_state rs
  on rs.conversation_id = c.id and rs.user_id = (select auth.uid())
where c.id = $1;

-- (b) unread CONVERSATION count -- the header badge
select count(*)
from public.conversations c
left join public.conversation_read_state rs
  on rs.conversation_id = c.id and rs.user_id = (select auth.uid())
where c.last_message_at > coalesce(rs.last_read_at, '-infinity');

-- (c) mark read -> public.mark_conversation_read(p_conversation_id)
```

Both reads are RLS-scoped `SELECT`s and need no RPC.

**The tightened read-state policy costs these queries nothing.** Both drive from
`conversations` and left-join read state, so a conversation the caller can no
longer reach drops out of the result on its own — the read-state row it would
have joined to is unreachable by the same test at the same moment
([§7.4](#74-conversation_read_state--own-rows-and-only-while-parent-access-lasts)).
The two policies can never disagree: there is no state in which a read-state row
is visible while its conversation is not, so a stale row can never inflate or
suppress a badge.

### 11.3 Why `last_message_at` is enough, and why counts stay cheap

**The badge never touches `public.messages`.** Query (b) scans only the
conversations the caller can see — bounded by
`ix_conversations_requester` / `ix_conversations_supplier`, and in practice a
small number per organization — and left-joins read state on
`uq_conversation_read_state_user`'s `user_id` prefix. Cost grows with the number
of *conversations* a user is party to, never with the number of *messages*, so a
long-running thread costs the badge nothing.

The one thing `last_message_at` cannot express on its own is *who sent the last
message* — my own message would otherwise light up my own badge. Step 6 of
`send_message` ([§9.2](#92-publicsend_message)) resolves this by advancing the
**sender's** read state in the same transaction, which is strictly cheaper than
carrying a `last_message_sender_org_id` column and testing it on every count.

**Accepted imprecision:** `mark_conversation_read` stamps `now()`, so a message
committed in the same instant the user marks the thread read is counted as read
without having been rendered. The alternative — trusting a client-supplied
"newest message I saw" — adds a spoofable parameter to buy sub-second accuracy in
a model that has no realtime delivery at all. Not worth it; `now()` stands.

**The Pilot ships one unread number: the count of conversations with unread
messages.** A per-message unread total is not specified and the header must not
invent one — the same rule that keeps `ChatMenu`'s badge honest today.

## 12. Lifecycle / immutability rules

### 12.1 Creation

Only `public.open_conversation`. A conversation cannot exist without a visible
subject that names two organizations, and no client can insert one.

Conversations are created **lazily, on first open** — not eagerly when an RFQ is
submitted. A transaction where nobody speaks leaves no row.

### 12.2 Uniqueness

**Exactly one conversation per `(subject_type, subject_id)`**, enforced by
`uq_conversations_subject`. One subject never has several conversations; there is
no "new thread" action, no per-user thread, and no per-branch thread. Repeated
`open_conversation` calls return the same id
([§15](#15-pgtap-acceptance-matrix), T-02).

### 12.3 Archive / close

**Not modelled in the Pilot.** There is no `status`, no `archived_at`, no
`closed_at`. Consequently:

- **closed business records stay readable** — a cancelled RFQ, a rejected
  quotation and a completed order all keep their conversations, in full, for as
  long as the subject row exists;
- **they also stay writable**, because "why was this cancelled?" and "when is the
  balance due?" are asked precisely after the record reaches a terminal state.
  Freezing sends on terminal status is [Q3](#20-open-questions--blockers) —
  raised, not decided, and additive if wanted.

### 12.4 Immutability

- **Messages are append-only.** No `UPDATE` policy, no `DELETE` policy, no
  `update_message` RPC, no `delete_message` RPC, no soft-delete column.
- **No edit history table**, because there is no edit.
- **`conversations` rows are never updated by a client.** The only mutation is
  `last_message_at`, written inside `send_message`.
- **`conversation_read_state.last_read_at` is the only user-mutable value in the
  entire feature**, it moves in one direction only, and it is readable and
  writable only by its owner **and only while that owner still has live access to
  the parent conversation**
  ([§7.4](#74-conversation_read_state--own-rows-and-only-while-parent-access-lasts)).
  Losing access does not delete the row; it makes it unreachable, so a restored
  membership recovers the reader's position intact.

### 12.5 Retention, moderation, deletion

**Unresolved and explicitly out of scope.** No retention window, no pruning job,
no moderation queue, no report mechanism, no takedown path, and no legal-hold or
erasure procedure is specified here — and none is invented.

Unlike `notifications`, which is prunable by design because a stale read notice
has no value, **chat messages are business correspondence and may be evidentiary**.
Deleting them is a legal question, not a schema question. If a data-retention or
right-to-erasure requirement lands, it needs its own specification.
See [Q4](#20-open-questions--blockers).

## 13. Notifications integration seam

**Implemented and approved for the Pilot** (`20260823090002_chat_message_notifications.sql`).
This section described a proposal until Q6 was decided; it now records the
contract as built.

### 13.1 The event

| Contract | Value |
|---|---|
| `event_type` | `message.sent` |
| Emission point | `public.send_message(...)`, in the **same transaction** as the message insert |
| `subject_type` / `subject_id` | the **conversation's** subject (`'rfq'`, `'quotation'` or `'order'` + its id) — so the notice and the deep link agree |
| `deep_link` | `/b2b/rfqs/{id}`, `/b2b/quotations/{id}`, `/b2b/orders/{id}` — the existing record routes, valid under `ck_notifications_deep_link` |
| Recipient org | **the opposite party only** — the one of `requester_org_id` / `supplier_org_id` the sender does not belong to, resolved from the conversation row `send_message` has already authorized and locked |
| Capability | `conversation.participate` |
| Owner fallback | **disabled for this event** (`p_allow_owner_fallback => false`). An `org.manage` owner without the capability is refused by `conversations_select_party`, so telling them a thread exists would disclose its record and counterparty past the boundary Chat enforces. Where the counterparty has no holder, nobody is notified and the message still persists. |
| Self-notification | suppressed centrally by `app.notify`; the sending organization is additionally never targeted |
| Dedupe / grouping / digest | **none in the Pilot** — one persisted message is one persisted notification event |
| `title_key` / `body_key` | `notifications.message.sent.title` / `notifications.message.sent.body` |
| `params` | `{"counterparty_name": app.org_display_name(<sender org>)}` — business context only |
| Message body | **never** copied, excerpted, previewed or otherwise persisted into the notification row |
| Realtime | still deferred — no publication change |

Emission is a single `app.notify_org(...)` inside `send_message`, immediately
beside the existing pattern — **no new call site, no new fan-out mechanism, no
new helper**. `app.notify` already suppresses self-notification, so the sender is
covered twice over: once because the recipient organization is the opposite
party, and once because the actor is filtered out centrally.

The recipient organization is **not** re-derived by a second membership guess. It
is whichever party column the sender's already-resolved acting organization is
not, taken from the same locked conversation row — so the notification cannot
address a party the message itself was not authorized against.

### 13.2 Q6 (volume) — decided: no dedupe in the Pilot

Every event previously in the allow-list is a *lifecycle transition* — a handful
per transaction. Chat is conversational, so a brisk exchange writes one
notification row per message per recipient. The Pilot accepts that:

- **every successfully persisted message is an independently persisted event.**
  A dedupe rule that suppresses a notice because an earlier one is still unread
  makes the inbox lie about how much correspondence is waiting, and the failure
  it prevents (a noisy badge) is more recoverable than the one it causes (a
  message nobody was told about);
- Pilot volumes are small enough to measure before optimising, and the natural
  rule — *at most one unread `message.sent` per recipient per subject*, which
  `ix_notifications_subject` supports directly — remains available as a purely
  additive change if real usage shows the badge becoming useless;
- grouping, digests and notification preferences are all still out of scope.

**Revisit when** observed `message.sent` volume per recipient per day makes the
unread count uninformative — not before, and not on speculation.

### 13.3 What did not change

`public.notifications` keeps its columns, RLS and indexes; `app.notify` is
untouched; `mark_notification_read` and `mark_all_notifications_read` are
unchanged, as are their tests and the Notifications UI. Chat's own schema, RLS
policies, capability model and error codes are unchanged, and `send_message`
keeps its signature, authorization, derivations, validation, immutability,
read-state bump, error codes, definer settings and grants.

Three things changed. Two were predicted: **one allow-list value**
(`ck_notifications_event_type_known` gains `'message.sent'`) and **one call
inside a Chat-owned function** (`send_message`).

The third was not, and is a correction: **`app.notify_org` gained
`p_allow_owner_fallback boolean default true`**
(`20260823090003_message_sent_no_owner_fallback.sql`). The first wiring inherited
the approved `org.manage` owner fallback, which is safe for every event whose
record an owner can already read — and unsafe for this one, because Chat access
requires `conversation.participate` and an owner without it cannot open the
thread. The default preserves the fallback for every pre-existing emission —
fifteen `app.notify_org` call sites across the thirteen functions
`20260822090002_notifications_event_wiring.sql` replaced — without touching any
of them; only `send_message` opts out. (The migration header says "thirteen call
sites", conflating functions with calls: several functions emit two events.) See
[`notifications-core.md`](notifications-core.md) for the general rule.

## 14. Realtime-deferred seam

**Realtime is explicitly deferred.** No table is added to any publication, no
publication is altered, and no subscription is written.

**The persisted model is correct without sockets.** Messages are durable and
ordered by `created_at`; `last_message_at` and `last_read_at` are durable; unread
state is computed from stored columns. A client that fetches on navigation, on
panel open, or on send shows correct state at all times — nothing about
correctness depends on push.

**The later seam, unchanged in shape:**

```sql
alter publication supabase_realtime add table public.messages;
```

Replica identity stays **default**, so change frames carry only the primary key
and every client re-fetches through RLS — the convention set by `leads` and
`follow_up_tasks` in `20260806090001_sales_ownership_and_realtime.sql`, and the
one `notifications-core.md` committed to. RLS authorises each subscriber
individually, so a socket grants no authority the policies do not already grant.

**This is a one-line change with no table-authority consequences.** No column,
constraint, policy, index or RPC in this specification would need to change to
add it — which is the property the deferral is meant to preserve.

## 15. Security invariants

Each is an assertion the implementation must satisfy and
[§15](#15-pgtap-acceptance-matrix) must test.

| # | Invariant | Mechanism |
|---|---|---|
| INV-1 | A user cannot read another transaction's messages | `messages_select_parent` → `conversations_select_party`; no `id`-based access |
| INV-2 | A same-org colleague **with** `conversation.participate` **can** read the thread; **without** it, cannot | `app.can_participate` is the only predicate — a deliberate grant ([§6.3](#63-the-colleague-rule--stated-explicitly-because-it-differs-from-notifications)) |
| INV-3 | Org C cannot access an org A–B conversation | C matches neither party column; empty set, not an error |
| INV-4 | A sender cannot spoof `sender_user_id` | not a parameter; `send_message` writes `(select auth.uid())` |
| INV-5 | A sender cannot spoof `sender_organization_id` | not a parameter; resolved by capability lookup against the conversation's own two party columns |
| INV-6 | A caller cannot create a conversation for unrelated organizations | `open_conversation` takes **no org id**; parties come from the subject row |
| INV-7 | A caller cannot attach a conversation to an unrelated subject | parties are re-derived from the subject and the caller must hold capability in one of *them*; `uq_conversations_subject` blocks re-anchoring |
| INV-8 | A draft subject cannot be used to open a channel | the `visible` gate ([§10.1](#101-why-visible-exists-and-why-it-is-not-optional)) |
| INV-9 | Inactive membership — or a withdrawn capability — loses read **and** write immediately, across **conversations, messages and read state alike** | `app.has_capability` requires `status = 'active'`; no cached participant row exists to go stale; read state is gated on live parent access ([§7.4.2](#742-what-losing-access-does-precisely)) |
| INV-10 | Direct `INSERT` / `UPDATE` / `DELETE` is unavailable to ordinary clients | `revoke all`, `grant select` only, and **no write policy on any of the three tables** |
| INV-11 | `security definer` functions do not bypass business authorization | every function re-checks `app.can_participate` against derived orgs and raises `42501`; `set search_path = ''` throughout; `app.conversation_parties` is not executable by any client role |
| INV-12 | Knowing a conversation, subject or organization UUID grants nothing | [§7.6](#76-what-this-model-refuses) |
| INV-13 | Read state is private to its owner | `conversation_read_state_select_own` requires `user_id = auth.uid()`; no caller can read or advance another user's pointer (`user_id` is written from `auth.uid()`, never passed) |
| INV-13a | Read state is **additionally** unreadable and unwritable once the owner loses access to the parent conversation | the same policy's second condition — an `EXISTS` on `conversations`, itself RLS-filtered by `conversations_select_party`; `mark_conversation_read` re-checks `app.can_participate` and raises `42501` ([§7.4](#74-conversation_read_state--own-rows-and-only-while-parent-access-lasts)) |
| INV-13b | Read-state metadata never outlives conversation access | no window exists in which `conversation_id` or `last_read_at` is visible while the conversation is not; both tests are evaluated at statement time ([§7.4.2](#742-what-losing-access-does-precisely)) |
| INV-14 | Sent messages cannot be altered or removed | append-only; no update/delete policy or RPC |
| INV-15 | Existing audit/security behaviour is unaffected | Chat adds one audit action and no change to any existing table, policy, function or grant |

## 16. pgTAP acceptance matrix

Proposed suite: **`supabase/tests/33_chat_core_test.sql`**, following
`31_notifications_core_test.sql` and `24_orders_projects_test.sql`. Mandatory
before merge. Per the recorded validation protocol, pgTAP runs against a **clean
`supabase db reset`**.

| # | Case | Expected |
|---|---|---|
| T-01 | `open_conversation('order', <valid order>)` by a requester-side capability holder | returns a uuid; row has both derived orgs; `conversation.opened` audit row written |
| T-02 | `open_conversation` called twice for the same subject | **same uuid**, exactly one row, no second audit row |
| T-03 | `open_conversation` on a **draft** RFQ | `22023` — INV-8 |
| T-04 | `open_conversation` by a user from an unrelated org C | `42501` — INV-6 |
| T-05 | `open_conversation` with `subject_type = 'project'` / arbitrary text | `22023` (outside allow-list) |
| T-06 | `open_conversation` with a random uuid as `p_subject_id` | not-found error, no row created |
| T-07 | Same-org colleague **holding** `conversation.participate` reads the thread | full history visible — INV-2 |
| T-08 | Same-org colleague **lacking** `conversation.participate` reads the thread | zero rows, from both `conversations` and `messages` — INV-2 |
| T-09 | Org C member selects the conversation and its messages by known uuid | zero rows both times — INV-3, INV-12 |
| T-10 | Supplier-side holder reads messages sent by the requester side | visible — both parties share one thread |
| T-11 | `send_message` persists | row with correct `conversation_id`, `body`, `created_at`; `conversations.last_message_at` advanced |
| T-12 | `sender_user_id` equals `auth.uid()` for the calling session, and differs when a second user sends | INV-4 — identity cannot be spoofed |
| T-13 | `sender_organization_id` equals the **caller's own** party org, for a sender on each side | INV-5 |
| T-14 | `send_message` with `''`, `'   '`, `E'\n\t '` | `22023`, no row |
| T-15 | `send_message` with 4001 characters | `22023`; 4000 characters succeeds |
| T-16 | Body is stored trimmed and byte-identical otherwise, including Arabic text | no mutation, no translation — [§17](#17-bilingual--product-presentation-boundary) |
| T-17 | Messages read back in `created_at` order | chronological, stable under the `id` tiebreak |
| T-18 | `send_message` by an unrelated org C member, and by a party-org member lacking the capability | `42501` both |
| T-19 | `mark_conversation_read` sets `last_read_at`; called twice, never moves backwards | monotonic under `greatest()` |
| T-20 | Unread conversation count before read, after counterparty send, after read | 0 → 1 → 0 |
| T-21 | Sending does not mark the **sender's** own conversation unread | [§11.3](#113-why-last_message_at-is-enough-and-why-counts-stay-cheap) |
| T-22 | A user cannot select another user's `conversation_read_state`, including a colleague's in the same party org | zero rows — INV-13 |
| T-22a | Participant reads their **own** read-state row while access is live | exactly one row, correct `last_read_at` — proves the compound policy does not over-block |
| T-22b | The **same** user re-reads their own row after their membership is set to `suspended` | **zero rows** — the row is theirs, and still unreadable — INV-13a |
| T-22c | The same user, membership restored to `active` with the capability re-granted | the row is visible again with `last_read_at` **unchanged** — retained, not deleted ([§7.4.2](#742-what-losing-access-does-precisely)) |
| T-22d | Membership stays `active` but `conversation.participate` is revoked | own read-state row becomes invisible — capability loss, not only membership loss, closes the surface |
| T-23 | `mark_conversation_read` by a non-participant | `42501` |
| T-23a | `mark_conversation_read` by the row's owner **after** losing membership or capability | `42501`, and `last_read_at` is unchanged — INV-13a, mutation held to the same test as reads |
| T-24 | Membership set to `suspended`, then `revoked` | conversation, messages, read state, `open_conversation`, `send_message` **and** `mark_conversation_read` all become unavailable, in the same statement — INV-9, INV-13b |
| T-25 | Direct `insert` / `update` / `delete` on all three tables as `authenticated` | denied on every combination — INV-10 |
| T-26 | `update` / `delete` on `messages` by a legitimate participant | denied — INV-14 |
| T-27 | `app.conversation_parties` executed by `authenticated` | permission denied — INV-11 |
| T-28 | Message rows survive the sender's membership being revoked | still readable, still attributed |
| T-29 | Existing suites `23`, `24`, `31`, `32` re-run unchanged | all pass — INV-15 |
| T-30 | `send_message` writes exactly one `message.sent` notice to the **opposite** party, carrying the conversation's own subject and no message body | the seam, as wired — covered by `34_chat_message_notifications_test.sql` |
| T-31 | With the counterparty holding **no** `conversation.participate` holder but an active `org.manage` owner, `send_message` notifies **nobody** — while a non-Chat event in the same state still reaches that owner | the recipient-authority rule: the owner fallback is off for `message.sent` and unchanged for every other event ([§13.1](#131-the-event)) — `34_chat_message_notifications_test.sql` |

## 17. Bilingual / product presentation boundary

- **`messages.body` is stored exactly as authored**, after `btrim` only. Arabic,
  English, or mixed — one column, one value, byte-identical on read back.
- **No automatic translation.** Not at write, not at read, not at render. A
  translation column, a detected-language column, and a translation service are
  all out of scope.
- **No rendered UI labels are stored in any Chat table.** There is no
  `title_key`, no `body_key`, and no `params` here — unlike `notifications`,
  where the *platform* authors the sentence and must not freeze one language into
  the row. In Chat the *user* authors the sentence, so the opposite rule applies:
  store it verbatim, and never key it.
- **System UI labels stay in the frontend catalogs** (`en.ts` / `ar.ts`), where
  `chat.empty.title`, `chat.empty.body` and `nav.chat` already live in both
  languages.
- Timestamps are `timestamptz`; locale formatting and RTL layout are presentation
  concerns and stay in the frontend.

## 18. Constraints summary

| Constraint | Table | Purpose |
|---|---|---|
| `ck_conversations_subject_type` | `conversations` | closed allow-list; `subject_type` selects a derivation rule, so it is an access-control key |
| `ck_conversations_distinct_orgs` | `conversations` | a tenant cannot converse with itself; mirrors `ck_rfqs_distinct_orgs` |
| `uq_conversations_subject` | `conversations` | **one conversation per subject** ([§8.1](#81-an-index-that-is-also-a-constraint)) |
| `ck_messages_body_len` | `messages` | 1–4000 characters |
| `ck_messages_body_not_blank` | `messages` | `btrim(body) <> ''` — no whitespace-only message |
| `uq_conversation_read_state_user` | `conversation_read_state` | one read-state row per user per conversation; also the upsert conflict target |
| `fk … on delete restrict` | `messages.sender_user_id`, `messages.sender_organization_id` | attribution on immutable history cannot become `null` |
| `fk … on delete cascade` | all `conversation_id` / `organization_id` / `user_id` parents | a deleted tenant takes its conversations with it |

## 19. Out of scope

Explicitly **not** part of Transactional Chat Core, and not to be added without a
further approved specification:

**Delivery & liveness** — Realtime subscriptions · typing indicators · online
presence · delivery receipts · per-message read receipts · push notifications ·
email delivery · external WhatsApp bridge.

**Message features** — attachments, media and file upload · voice notes · calls ·
reactions · message editing · message deletion · threads and replies ·
forwarding · quoting · mentions · full-text search · pinning · drafts.

**Conversation features** — group chat beyond the two transacting organizations ·
adding or inviting individual participants · channels · communities · public
chat · social discovery · arbitrary user-to-user DMs · consumer/social DMs ·
internal single-org team chat · blocking · muting · per-conversation
notification preferences · archiving and closing ([§12.3](#123-archive--close)).

**Governance** — moderation tooling · reporting and takedown · platform-support
read access ([Q2](#20-open-questions--blockers)) · retention and pruning policy ·
legal hold · right-to-erasure procedure ([§12.5](#125-retention-moderation-deletion)).

**Intelligence** — AI-generated replies · chat bots · summarisation · sentiment ·
automatic translation ([§17](#17-bilingual--product-presentation-boundary)) ·
embedding or indexing message bodies for RAG.

**Adjacent** — Points and gamification (a separate, unspecified increment) ·
B2C consumer conversations ([Q5](#20-open-questions--blockers)) · project-anchored
conversations ([Q1](#20-open-questions--blockers)).

## 20. Open questions / blockers

**No blockers.** Every table, capability, helper, route and convention this
specification depends on already exists. Implementation can begin on approval.

Six product decisions were **raised, not decided** — each is recorded here rather
than invented, and none prevented the core from shipping. **Q6 has since been
decided** (see its row); the remaining five stand open:

| # | Question | Recommendation |
|---|---|---|
| **Q1** | Should `project` become a fourth subject type? | **No, for the Pilot.** 1:1 with `orders`, same two orgs; the project page shows the parent order's conversation ([§4.3](#43-why-project-is-excluded-from-the-pilot)). Purely additive later. |
| **Q2** | `07_permissions_matrix.md` grants Moderator/Admin cross-tenant read "on report", audited. No reporting model exists. | **Add nothing now.** Support already has `audit_log`. Revisit with a moderation specification; the policy is additive. |
| **Q3** | Should sending be frozen once the subject reaches a terminal state (`cancelled`, `rejected`, `completed`)? | **No, for the Pilot** — post-completion questions are real. Needs a product answer; additive as a `22023` guard in `send_message`. |
| **Q4** | Retention, deletion, and erasure of message bodies. | **Unresolved — deliberately.** Business correspondence may be evidentiary; this is a legal question and needs its own specification ([§12.5](#125-retention-moderation-deletion)). |
| **Q5** | B2C consumer chat — a consumer may hold **zero** organizations, so no second party can be derived. | **Out of scope.** The two-party model does not describe it; a consumer chat model would need its own authority design. |
| **Q6** | ~~Notification volume for `message.sent`~~ — **DECIDED 2026-08-23.** | **No dedupe, grouping or digest in the Pilot**: one persisted message emits one independent notification event. Wired in `20260823090002_chat_message_notifications.sql` (recipient authority corrected in `20260823090003`); the dedupe rule stays available as an additive change if measured volume makes the badge uninformative ([§13.2](#132-q6-volume--decided-no-dedupe-in-the-pilot)). |

One documentation reconciliation is also outstanding:
`docs/technical/08_api_contracts.md` §10 still describes
`startConversation({… participantUserIds[]})` and `sendMessage({… attachments[]})`.
Both contradict the model chosen here. **That file is not edited by this task**;
it is reconciled in step 6 below.

## 21. Recommended implementation sequence

Each step is independently reviewable. No step begins before this document is
approved.

1. **Approve this specification** — the `supabase/AGENTS.md` precondition for any
   production table.
2. **Migration `2026xxxx_chat_core.sql`** — three tables, their constraints and
   indexes, `alter table … enable row level security`, the three SELECT policies,
   the `revoke`/`grant` block, `app.can_participate`,
   `app.conversation_parties`, the three public RPCs with their
   `revoke`/`grant execute`, one `alter table public.audit_log` extending
   `ck_audit_action_known` with `'conversation.opened'`, and `comment on` for
   every table and function. **One migration — the schema and the only write
   paths that may touch it must never land apart.**
3. **pgTAP `33_chat_core_test.sql`** — the T-01…T-29 matrix, run against a
   clean `supabase db reset`, with suites 23/24/31/32 confirmed still green.
   (T-30 and T-31 concern the Notifications seam and live in
   `34_chat_message_notifications_test.sql`, added with step 7.)
4. **Read surfaces** — thread and conversation list as RLS-scoped `SELECT`s;
   `ChatMenu` gains a real unread **conversation** count and real rows. It stops
   being a shell here and not before, and only once a real number exists to show.
5. **Record-page integration** — a conversation panel on the RFQ, quotation and
   order pages, calling `open_conversation` on first use.
6. **Reconcile `docs/technical/08_api_contracts.md` §10** with the model actually
   built ([§3.6](#36-pre-existing-product-documentation-and-where-this-spec-departs-from-it)),
   and record the increment in `docs/operations/AGENT_WORK_LOG.md` and
   `docs/operations/RUNTIME_STATE.md`.
7. **Then, and only as separate increments:** ~~resolve Q6 and wire
   `message.sent` notifications~~ — **done 2026-08-23**, see
   [§13](#13-notifications-integration-seam); add `public.messages` to the
   Realtime publication — **still deferred**.

## References

- [`notifications-core.md`](notifications-core.md) — the companion increment whose conventions this follows
- [`naming-conventions.md`](naming-conventions.md) · [`migration-strategy.md`](migration-strategy.md)
- `supabase/AGENTS.md` — the RLS mandate and the specification requirement this satisfies
- `docs/technical/07_permissions_matrix.md` — `conversation.participate`, and the moderator question (Q2)
- `docs/technical/08_api_contracts.md` §10 — the superseded contract sketch (§3.6)
- ADR-0002 (migrations), ADR-0007 (identity & tenancy), ADR-0008 (deny-by-default write paths)
- `supabase/migrations/20260810090001_catalog_rfq_quotation.sql` · `20260811090001_orders_projects.sql` · `20260822090001_notifications_core.sql`
