-- ===========================================================================
-- Marketplace PR 15 - Migration 150001: returns and exchanges, tables and the admin permission
-- ===========================================================================
-- WHAT THIS ADDS (owner decisions 2026-11-21 and the order model contract, sections 2.9, 4.5, 7)
--   * Permission marketplace_returns.review (Super Admin, locked, grantable like marketplace_media.moderate).
--   * marketplace_seller_return_settings  how many days a showroom offers (never below the 14 / 30 floor).
--   * marketplace_return_reason_rules     what a buyer-facing reason preset (action return_reason) means: the claim type
--                                         (general / defect), whether evidence is required, who pays the return shipping,
--                                         whether it is visible transit damage (48 h rule). A preset without a row is a
--                                         general claim, no evidence, buyer pays (the safe default).
--   * marketplace_return_requests, _items, _events (append-only), _evidence (photos, R2 private),
--     marketplace_order_refunds (a RECORD of a refund the seller executed and the buyer confirmed; no money moves here).
--   * Triggers that keep marketplace_order_items.quantity_returned equal to the quantity held by open or completed returns
--     (rejected and cancelled returns give the units back) and never above the ordered quantity.
-- NEEDS PR 12 (20261124120001): orders v2 columns, order items snapshot, timers, presets, hooks.
-- NOTHING IS DROPPED. SECURITY: RLS on, no policy, no client grant on any table; reads and writes are SECURITY DEFINER RPCs
-- (migration 150002). Actor ids carry no foreign key (audit outlives accounts).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Permission
-- ---------------------------------------------------------------------------
insert into public.admin_permissions (key, resource, action, description, sort_order) values
  ('marketplace_returns.review', 'marketplace_returns', 'review',
   'Review the Marketplace returns queue: remind a showroom that is silent, decide a return with the showroom, read the return evidence of an escalated return (Super Admin; grantable to chosen admins).', 115)
on conflict (key) do nothing;
insert into public.admin_role_permissions (role_id, permission_key, is_locked)
select r.id, 'marketplace_returns.review', true from public.admin_roles r where r.is_system and r.key = 'super_admin'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Seller settings and reason rules
-- ---------------------------------------------------------------------------
create table public.marketplace_seller_return_settings (
  seller_organization_id uuid        primary key references public.organizations (id) on delete cascade,
  general_days           smallint    not null default 14,
  defect_days            smallint    not null default 30,
  updated_by             uuid,
  updated_at             timestamptz not null default now(),
  constraint ck_mp_return_settings_general check (general_days between 14 and 365),
  constraint ck_mp_return_settings_defect check (defect_days between 30 and 365)
);
comment on table public.marketplace_seller_return_settings is
  'Return window a showroom offers. The floor (14 days general, 30 days defect) is a CHECK: a showroom may offer more, never less. No row = the floor.';
create trigger set_mp_return_settings_updated_at before update on public.marketplace_seller_return_settings
  for each row execute function app.set_updated_at();

create table public.marketplace_return_reason_rules (
  preset_id         uuid        primary key references public.marketplace_seller_message_presets (id) on delete cascade,
  claim_type        text        not null default 'general',
  requires_evidence boolean     not null default false,
  shipping_payer    text        not null default 'buyer',
  transit_damage    boolean     not null default false,
  constraint ck_mp_reason_rules_claim check (claim_type in ('general', 'defect')),
  constraint ck_mp_reason_rules_payer check (shipping_payer in ('seller', 'buyer')),
  constraint ck_mp_reason_rules_transit check (not transit_damage or (claim_type = 'defect' and requires_evidence))
);
comment on table public.marketplace_return_reason_rules is
  'What a return_reason preset means for the policy: claim type (14 or 30 day window), evidence, who pays the return shipping (seller for defect, wrong item, damaged in transit; buyer for change of mind), and the 48 hour rule for visible transit damage.';

-- ---------------------------------------------------------------------------
-- 3. Return requests
-- ---------------------------------------------------------------------------
create sequence public.marketplace_return_number_seq;

create table public.marketplace_return_requests (
  id                      uuid          primary key default gen_random_uuid(),
  request_number          text          not null unique default ('RT-' || lpad(nextval('public.marketplace_return_number_seq')::text, 6, '0')),
  order_id                uuid          not null references public.marketplace_orders (id) on delete cascade,
  buyer_user_id           uuid          not null references public.users (id) on delete restrict,
  seller_organization_id  uuid          not null references public.organizations (id) on delete restrict,
  kind                    text          not null,
  claim_type              text          not null,
  status                  text          not null default 'requested',
  reason_preset_id        uuid          references public.marketplace_seller_message_presets (id) on delete set null,
  reason_label_ar         text          not null,
  reason_label_en         text          not null,
  transit_damage          boolean       not null default false,
  buyer_note              text,
  remedy                  text          not null,
  partial_refund_egp      numeric(14,2),
  return_shipping_payer   text          not null,
  return_tracking         text,
  in_admin_queue          boolean       not null default false,
  escalated_reason        text,
  escalated_at            timestamptz,
  decided_by_role         text,
  decision_message_ar     text,
  decision_message_en     text,
  decision_internal_note  text,
  idempotency_key         text          not null,
  seller_due_at           timestamptz   not null,
  refund_due_at           timestamptz,
  shipped_at              timestamptz,
  received_at             timestamptz,
  closed_at               timestamptz,
  created_at              timestamptz   not null default now(),
  updated_at              timestamptz   not null default now(),
  constraint ck_mp_returns_kind check (kind in ('return', 'exchange')),
  constraint ck_mp_returns_claim check (claim_type in ('general', 'defect')),
  constraint ck_mp_returns_status check (status in
    ('requested', 'approved', 'rejected', 'in_transit', 'received', 'refunded', 'exchanged', 'closed', 'cancelled')),
  constraint ck_mp_returns_remedy check (remedy in ('refund', 'exchange') and (kind = 'return') = (remedy = 'refund')),
  constraint ck_mp_returns_payer check (return_shipping_payer in ('seller', 'buyer')),
  constraint ck_mp_returns_escalated check (escalated_reason is null or escalated_reason in ('seller_silent', 'complaint')),
  constraint ck_mp_returns_queue check (not in_admin_queue or escalated_reason is not null),
  constraint ck_mp_returns_decider check (decided_by_role is null or decided_by_role in ('seller', 'admin')),
  constraint ck_mp_returns_partial check (partial_refund_egp is null or partial_refund_egp > 0),
  constraint ck_mp_returns_note check (buyer_note is null or char_length(buyer_note) <= 500),
  constraint ck_mp_returns_tracking check (return_tracking is null or return_tracking ~ '^[A-Za-z0-9._/-]{3,64}$'),
  constraint ck_mp_returns_idem check (char_length(idempotency_key) between 8 and 128),
  constraint uq_mp_returns_buyer_idem unique (buyer_user_id, idempotency_key)
);
comment on table public.marketplace_return_requests is
  'A buyer return or exchange request for a delivered order. A separate record: it never moves the order out of delivered. At most one active (requested, approved, in_transit, received) request per order.';
create unique index ux_mp_returns_active_per_order on public.marketplace_return_requests (order_id)
  where status in ('requested', 'approved', 'in_transit', 'received');
create index ix_mp_returns_buyer on public.marketplace_return_requests (buyer_user_id, created_at desc);
create index ix_mp_returns_seller on public.marketplace_return_requests (seller_organization_id, status, created_at desc);
create index ix_mp_returns_queue on public.marketplace_return_requests (created_at desc) where in_admin_queue;
create trigger set_mp_returns_updated_at before update on public.marketplace_return_requests
  for each row execute function app.set_updated_at();

create table public.marketplace_return_items (
  id             uuid        primary key default gen_random_uuid(),
  return_id      uuid        not null references public.marketplace_return_requests (id) on delete cascade,
  order_item_id  uuid        not null references public.marketplace_order_items (id) on delete restrict,
  quantity       integer     not null,
  sellable       boolean,
  created_at     timestamptz not null default now(),
  constraint ck_mp_return_items_qty check (quantity between 1 and 9999),
  constraint uq_mp_return_items unique (return_id, order_item_id)
);
create index ix_mp_return_items_item on public.marketplace_return_items (order_item_id);

create table public.marketplace_return_events (
  id             uuid        primary key default gen_random_uuid(),
  sequence       bigint      generated always as identity,
  return_id      uuid        not null references public.marketplace_return_requests (id) on delete cascade,
  action         text        not null,
  from_status    text,
  to_status      text,
  actor_user_id  uuid,
  actor_role     text        not null,
  note           text,
  created_at     timestamptz not null default now(),
  constraint ck_mp_return_events_role check (actor_role in ('buyer', 'seller', 'admin', 'system')),
  constraint ck_mp_return_events_note check (note is null or char_length(note) <= 500)
);
comment on table public.marketplace_return_events is
  'Append-only dispute record of a return: every step, its actor and the written reasons. Actor carries no foreign key.';
create index ix_mp_return_events_return on public.marketplace_return_events (return_id, sequence);
create trigger marketplace_return_events_append_only before update or delete on public.marketplace_return_events
  for each row execute function app.marketplace_append_only();

create table public.marketplace_return_evidence (
  id               uuid        primary key default gen_random_uuid(),
  return_id        uuid        references public.marketplace_return_requests (id) on delete cascade,
  order_id         uuid        not null references public.marketplace_orders (id) on delete cascade,
  object_key       text        not null unique,
  mime_type        text        not null,
  created_by       uuid        not null references public.users (id) on delete restrict,
  upload_state     text        not null default 'awaiting_upload',
  byte_size        bigint,
  checksum_sha256  text,
  created_at       timestamptz not null default now(),
  constraint ck_mp_evidence_mime check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint ck_mp_evidence_state check (upload_state in ('awaiting_upload', 'confirmed', 'deleting'))
);
comment on table public.marketplace_return_evidence is
  'Photos the buyer attaches to a return (no video in this phase). Bytes live privately in R2 through the central media system (namespace marketplace, key returns/<order>/<evidence>.<ext>); never public, never logged.';
create index ix_mp_evidence_order on public.marketplace_return_evidence (order_id, created_at);
create index ix_mp_evidence_return on public.marketplace_return_evidence (return_id) where return_id is not null;

create table public.marketplace_order_refunds (
  id              uuid          primary key default gen_random_uuid(),
  return_id       uuid          not null unique references public.marketplace_return_requests (id) on delete cascade,
  order_id        uuid          not null references public.marketplace_orders (id) on delete cascade,
  amount_egp      numeric(14,2) not null,
  method          text          not null,
  state           text          not null default 'pending',
  sent_by         uuid,
  sent_at         timestamptz,
  confirmed_by    uuid,
  confirmed_at    timestamptz,
  reference_note  text,
  created_at      timestamptz   not null default now(),
  constraint ck_mp_refunds_amount check (amount_egp > 0),
  constraint ck_mp_refunds_state check (state in ('pending', 'sent', 'confirmed', 'disputed')),
  constraint ck_mp_refunds_note check (reference_note is null or char_length(reference_note) <= 300)
);
comment on table public.marketplace_order_refunds is
  'The record of a refund: the showroom pays the buyer through the buyer''s ORIGINAL method (InstaPay transfer, or cash for cash on delivery) and records it; the buyer confirms receipt. Aladdin holds and moves no money.';

-- ---------------------------------------------------------------------------
-- 4. quantity_returned follows the returns
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_return_sync_quantity(p_order_item uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.marketplace_order_items oi set quantity_returned = coalesce((
    select sum(ri.quantity) from public.marketplace_return_items ri
      join public.marketplace_return_requests r on r.id = ri.return_id
     where ri.order_item_id = oi.id and r.status not in ('rejected', 'cancelled')), 0)
   where oi.id = p_order_item;
$$;

create or replace function app.marketplace_return_items_sync_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform app.marketplace_return_sync_quantity(old.order_item_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform app.marketplace_return_sync_quantity(new.order_item_id);
  end if;
  return null;
end;
$$;
create trigger trg_mp_return_items_sync after insert or update or delete on public.marketplace_return_items
  for each row execute function app.marketplace_return_items_sync_trg();

create or replace function app.marketplace_return_status_sync_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item uuid;
begin
  if (old.status in ('rejected', 'cancelled')) is distinct from (new.status in ('rejected', 'cancelled')) then
    for v_item in select order_item_id from public.marketplace_return_items where return_id = new.id loop
      perform app.marketplace_return_sync_quantity(v_item);
    end loop;
  end if;
  return null;
end;
$$;
create trigger trg_mp_return_status_sync after update of status on public.marketplace_return_requests
  for each row execute function app.marketplace_return_status_sync_trg();

-- ---------------------------------------------------------------------------
-- 5. RLS: on, no policy, no grant
-- ---------------------------------------------------------------------------
alter table public.marketplace_seller_return_settings enable row level security;
alter table public.marketplace_return_reason_rules    enable row level security;
alter table public.marketplace_return_requests        enable row level security;
alter table public.marketplace_return_items           enable row level security;
alter table public.marketplace_return_events          enable row level security;
alter table public.marketplace_return_evidence        enable row level security;
alter table public.marketplace_order_refunds          enable row level security;
revoke all on public.marketplace_seller_return_settings, public.marketplace_return_reason_rules,
  public.marketplace_return_requests, public.marketplace_return_items, public.marketplace_return_events,
  public.marketplace_return_evidence, public.marketplace_order_refunds from public, anon, authenticated, service_role;
revoke all on sequence public.marketplace_return_number_seq from public, anon, authenticated, service_role;
revoke all on function app.marketplace_return_sync_quantity(uuid), app.marketplace_return_items_sync_trg(),
  app.marketplace_return_status_sync_trg() from public, anon, authenticated, service_role;
