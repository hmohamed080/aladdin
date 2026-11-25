-- Marketplace PR 14 (1/3): the payment-complaint permission and tables.
--
-- WHAT THIS ADDS
--   * the grantable admin permission `marketplace_payment_complaints.review` (Super Admin holds it, locked; the owner
--     grants it to chosen admins through the existing role editor, like `marketplace_media.moderate`)
--   * `marketplace_payment_complaints` and `marketplace_payment_complaint_events` (append-only)
--
-- NEEDS: PR 12 (orders v2: `marketplace_orders.source`, `payment_status = 'receipt_disputed'`). Nothing is dropped.
-- SECURITY MODEL: RLS enabled, no policy, no client grant: the tables are read and written only by SECURITY DEFINER
-- functions of the next two migrations. Actor ids carry no foreign key (audit outlives accounts).
-- A complaint exists only when somebody files one (owner decision 4C); a disputed receipt alone never creates one.

insert into public.admin_permissions (key, resource, action, description, sort_order) values
  ('marketplace_payment_complaints.review', 'marketplace_payment_complaints', 'review',
   'Review and decide Marketplace payment complaints (a disputed InstaPay receipt that the buyer or the showroom escalated). Grantable by the Super Admin to chosen admins.', 114)
on conflict (key) do nothing;
insert into public.admin_role_permissions (role_id, permission_key, is_locked)
select r.id, 'marketplace_payment_complaints.review', true from public.admin_roles r where r.is_system and r.key = 'super_admin'
on conflict do nothing;

create table public.marketplace_payment_complaints (
  id                uuid        primary key default gen_random_uuid(),
  order_id          uuid        not null references public.marketplace_orders(id) on delete cascade,
  filed_by_user_id  uuid,
  filed_by_role     text        not null,
  reason            text        not null,
  note              text,
  state             text        not null default 'open',
  decision          text,
  decision_note     text,
  decided_by        uuid,
  decided_at        timestamptz,
  taken_by          uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint ck_mp_complaints_role   check (filed_by_role in ('buyer', 'seller')),
  constraint ck_mp_complaints_reason check (reason in ('transfer_made', 'amount_mismatch', 'receipt_unreadable', 'other')),
  constraint ck_mp_complaints_note   check (note is null or char_length(note) between 3 and 500),
  constraint ck_mp_complaints_state  check (state in ('open', 'under_review', 'resolved', 'dismissed')),
  constraint ck_mp_complaints_decision check (decision is null or decision in ('payment_valid', 'payment_not_received', 'dismissed')),
  constraint ck_mp_complaints_decision_note check (decision_note is null or char_length(decision_note) between 3 and 500),
  -- a decided complaint carries its decision, who took it and when; an undecided one carries none
  constraint ck_mp_complaints_decided check (
    (state in ('open', 'under_review') and decision is null and decided_at is null)
    or (state in ('resolved', 'dismissed') and decision is not null and decision_note is not null and decided_by is not null and decided_at is not null))
);
comment on table public.marketplace_payment_complaints is
  'A formal complaint about a disputed InstaPay receipt, reviewed by an admin holding marketplace_payment_complaints.review. At most one open complaint per order. No client grant: SECURITY DEFINER functions only.';
create unique index ux_mp_complaints_open_order on public.marketplace_payment_complaints (order_id)
  where state in ('open', 'under_review');
create index ix_mp_complaints_state_created on public.marketplace_payment_complaints (state, created_at desc);
create index ix_mp_complaints_order on public.marketplace_payment_complaints (order_id, created_at desc);
create trigger set_marketplace_payment_complaints_updated_at before update on public.marketplace_payment_complaints
  for each row execute function app.set_updated_at();

create table public.marketplace_payment_complaint_events (
  id            uuid        primary key default gen_random_uuid(),
  sequence      bigint      generated always as identity,
  complaint_id  uuid        not null references public.marketplace_payment_complaints(id) on delete cascade,
  action        text        not null,
  actor_id      uuid,
  actor_role    text        not null,
  note          text,
  at            timestamptz not null default now(),
  constraint ck_mp_complaint_events_action check (action in ('filed', 'taken', 'resolved', 'dismissed')),
  constraint ck_mp_complaint_events_role   check (actor_role in ('buyer', 'seller', 'admin')),
  constraint ck_mp_complaint_events_note   check (note is null or char_length(note) <= 500)
);
comment on table public.marketplace_payment_complaint_events is 'Append-only history of a payment complaint. Actor carries no foreign key.';
create index ix_mp_complaint_events_complaint on public.marketplace_payment_complaint_events (complaint_id, sequence);
create trigger marketplace_payment_complaint_events_append_only before update or delete on public.marketplace_payment_complaint_events
  for each row execute function app.marketplace_append_only();

alter table public.marketplace_payment_complaints enable row level security;
alter table public.marketplace_payment_complaint_events enable row level security;
revoke all on public.marketplace_payment_complaints, public.marketplace_payment_complaint_events
  from public, anon, authenticated, service_role;
