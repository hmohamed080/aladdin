# notifications feature

The in-app inbox: the UI half of Notifications Core
(`docs/database/notifications-core.md`).

## What is here

- `view-model.ts` — persisted row → UI-ready row. Presentation only. Resolves the
  stored `title_key` / `body_key` against the caller's locale, interpolates
  `params`, formats the timestamp, and re-validates the stored `deep_link` as
  relative. It never composes a sentence of its own.
- `notification-list.tsx` — the one notification list, rendered by both the
  header panel and the supply-dashboard block. Owns the optimistic read state and
  the two RPC calls.

The read/query layer lives at `server/queries/notifications.ts`; the mutations at
`server/actions/notifications.ts`, both per the repository's server conventions.

## Rules this feature is built on

- **Authority is `recipient_user_id`, and only the database decides it.** One RLS
  policy, no org-wide read path. Nothing in this folder re-checks ownership.
- **`organization_id` is a UX filter.** It scopes the list to the active work
  context. It can narrow an RLS-bounded result and can never widen one.
- **Writes go through `public.mark_notification_read` /
  `public.mark_all_notifications_read`.** `public.notifications` has no write
  policy at all; application code never touches the table directly.
- **Rows store i18n KEYS, never rendered text.** A reader's locale can change
  after a row is written, so the sentence is built at render time from the key
  plus `params`.
- **A row the UI has no copy for still renders**, under a neutral translated
  title, still carrying its deep link. Dropping it would let the counted badge
  disagree with the visible panel — see the degradation note in `view-model.ts`.

## Not here, deliberately

Realtime subscriptions, Chat, Points, notification preferences, digests,
grouping, pagination and outbound delivery are all out of scope for this
increment — see "Out of scope" in the specification.

See `frontend/AGENTS.md` (organization by product domain).
