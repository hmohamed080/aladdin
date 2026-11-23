-- Marketplace seller approval v2 (plan PR 5; owner decisions 2026-11-19, Part 1).
--
-- WHAT CHANGES
--   1. A new status `rejected` (with a reason). An admin can approve a rejected seller later.
--   2. `revoked` is no longer terminal: an admin can approve a revoked seller again. This reverses the V1 design of
--      app.marketplace_seller_transition ("revoked is terminal in V1").
--   3. The showroom owner can ask for approval himself (public.marketplace_seller_request_approval), also after a
--      rejection. The `pending` status and the `requested` event finally have a writer.
--   4. Reason rules: required for reject, suspend, revoke and reinstate; optional for approve (and for a request).
--   5. Two texts per transition: the internal admin REASON (admins only, never readable by the seller) and an
--      owner-facing MESSAGE, chosen from an admin-managed preset list (each preset carries Arabic and English text)
--      or written as custom free text ("other"). Both are stored on the account and on the append-only event.
--   6. Every transition except a request notifies the OWNER (members holding org.manage, not every manager) through
--      the notification-template system (20261121090003): one base template per transition. The owner message fills
--      {message} in each language. app.notify_from_template gains optional per-language variables for that.
--   7. The sellers overview reports why an organization is not eligible (type / status / deleted) so the admin can
--      explain "Eligible = No" on hover, and lists deleted organizations that still hold a seller account.
--
-- PERMISSIONS: no new permission is needed. Transitions stay under marketplace_sellers.manage. The preset list is
-- readable by the seller admins and the template viewers, and edited under notification_templates.manage (Super
-- Admin), the same permission as the notification texts it feeds. Every preset edit appends an event (who, when, old,
-- new, reason). The owner request is authorised by org.manage on the organization and nothing else.

-- ---------------------------------------------------------------------------
-- 1. Account and event shape
-- ---------------------------------------------------------------------------
alter table public.marketplace_seller_accounts drop constraint ck_marketplace_sellers_status;
alter table public.marketplace_seller_accounts add constraint ck_marketplace_sellers_status
  check (status in ('pending', 'approved', 'suspended', 'rejected', 'revoked'));

alter table public.marketplace_seller_accounts
  add column owner_message_ar text,
  add column owner_message_en text,
  add column rejected_at timestamptz,
  add column rejected_by uuid;
alter table public.marketplace_seller_accounts add constraint ck_marketplace_sellers_owner_message
  check ((owner_message_ar is null or char_length(owner_message_ar) between 1 and 300)
     and (owner_message_en is null or char_length(owner_message_en) between 1 and 300));

comment on column public.marketplace_seller_accounts.status is
  'pending | approved | suspended | rejected | revoked. Only approved sells. rejected and revoked are reversible: an admin can approve the organization again, and the owner can request approval again after a rejection.';
comment on column public.marketplace_seller_accounts.status_reason is
  'Internal admin reason of the latest transition. Admins only: not granted to any client role.';
comment on column public.marketplace_seller_accounts.owner_message_ar is
  'Owner-facing message (Arabic) of the latest transition: a preset text or the admin''s custom text. Safe for the organization''s members to read.';
comment on column public.marketplace_seller_accounts.owner_message_en is
  'Owner-facing message (English) of the latest transition. Safe for the organization''s members to read.';

alter table public.marketplace_seller_account_events drop constraint ck_marketplace_seller_events_action;
alter table public.marketplace_seller_account_events add constraint ck_marketplace_seller_events_action
  check (action in ('requested', 'approved', 'rejected', 'suspended', 'revoked', 'reinstated'));
alter table public.marketplace_seller_account_events drop constraint ck_marketplace_seller_events_reason;
alter table public.marketplace_seller_account_events alter column reason drop not null;
alter table public.marketplace_seller_account_events add constraint ck_marketplace_seller_events_reason
  check (reason is null or char_length(btrim(reason)) between 3 and 500);
-- the reason is optional for exactly two actions
alter table public.marketplace_seller_account_events add constraint ck_marketplace_seller_events_reason_required
  check (action in ('requested', 'approved') or reason is not null);
alter table public.marketplace_seller_account_events
  add column owner_message_ar text,
  add column owner_message_en text,
  add column preset_id uuid;
alter table public.marketplace_seller_account_events add constraint ck_marketplace_seller_events_owner_message
  check ((owner_message_ar is null or char_length(owner_message_ar) between 1 and 300)
     and (owner_message_en is null or char_length(owner_message_en) between 1 and 300));
comment on column public.marketplace_seller_account_events.preset_id is
  'The preset the owner message came from, null for a custom message. No foreign key: audit outlives presets.';

-- members may read the owner-facing message of their own account (RLS already limits the row); the reason stays closed
grant select (owner_message_ar, owner_message_en) on public.marketplace_seller_accounts to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Owner-message presets (admin-managed, bilingual)
-- ---------------------------------------------------------------------------
create table public.marketplace_seller_message_presets (
  id         uuid        primary key default gen_random_uuid(),
  action     text        not null,
  label_ar   text        not null,
  label_en   text        not null,
  text_ar    text        not null,
  text_en    text        not null,
  is_active  boolean     not null default true,
  sort_order integer     not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint ck_marketplace_seller_presets_action check (action in ('approve', 'reject', 'suspend', 'reinstate', 'revoke')),
  constraint ck_marketplace_seller_presets_label check (char_length(btrim(label_ar)) between 1 and 80 and char_length(btrim(label_en)) between 1 and 80),
  constraint ck_marketplace_seller_presets_text check (char_length(btrim(text_ar)) between 1 and 300 and char_length(btrim(text_en)) between 1 and 300)
);
comment on table public.marketplace_seller_message_presets is
  'Owner-facing message presets for the seller transitions. The label is what the admin picks; the text (Arabic and English) is what the owner reads in {message} of the notification and on the seller notice. Changed only by admin_marketplace_seller_preset_save; presets are deactivated, never deleted, so an old event keeps its meaning.';
create trigger set_marketplace_seller_message_presets_updated_at
  before update on public.marketplace_seller_message_presets
  for each row execute function app.set_updated_at();
create index ix_marketplace_seller_presets_action on public.marketplace_seller_message_presets (action, sort_order);

create table public.marketplace_seller_preset_events (
  id          bigint      generated always as identity primary key,
  at          timestamptz not null default now(),
  preset_id   uuid        not null,
  action      text        not null,
  old_content jsonb,
  new_content jsonb       not null,
  actor_id    uuid        not null,
  reason      text        not null,
  constraint ck_marketplace_seller_preset_events_action check (action in ('created', 'updated')),
  constraint ck_marketplace_seller_preset_events_reason check (char_length(btrim(reason)) between 3 and 500)
);
comment on table public.marketplace_seller_preset_events is
  'Append-only history of preset edits. Actor carries no foreign key: audit outlives accounts.';
create trigger marketplace_seller_preset_events_append_only
  before update or delete on public.marketplace_seller_preset_events
  for each row execute function app.marketplace_append_only();

alter table public.marketplace_seller_message_presets enable row level security;
alter table public.marketplace_seller_preset_events   enable row level security;
revoke all on public.marketplace_seller_message_presets from public, anon, authenticated, service_role;
revoke all on public.marketplace_seller_preset_events   from public, anon, authenticated, service_role;
-- both tables: RLS on, no grant, no policy. Access is through the admin functions below.

insert into public.marketplace_seller_message_presets (action, label_ar, label_en, text_ar, text_en, sort_order) values
  ('approve',   'ترحيب',                 'Welcome',
   'يمكنك الآن إضافة منتجاتك ونشرها في المتجر.', 'You can now add your products and publish them on the Marketplace.', 10),
  ('reject',    'بيانات غير مكتملة',     'Incomplete details',
   'بيانات نشاطك غير مكتملة. يرجى استكمالها ثم طلب الاعتماد من جديد.', 'Your business details are incomplete. Please complete them and request approval again.', 10),
  ('reject',    'لا يستوفي الشروط',      'Does not meet requirements',
   'نشاطك لا يستوفي حاليًا شروط البيع في المتجر.', 'Your business does not currently meet the Marketplace selling requirements.', 20),
  ('suspend',   'مراجعة شكاوى العملاء',  'Reviewing customer complaints',
   'تم إيقاف البيع مؤقتًا لمراجعة شكاوى العملاء.', 'Selling is paused while we review customer complaints.', 10),
  ('suspend',   'مراجعة بيانات المعرض',  'Reviewing showroom details',
   'تم إيقاف البيع مؤقتًا لمراجعة بيانات معرضك.', 'Selling is paused while we review your showroom details.', 20),
  ('reinstate', 'اكتملت المراجعة',       'Review completed',
   'اكتملت المراجعة ويمكنك استئناف البيع.', 'The review is complete and you can resume selling.', 10),
  ('revoke',    'مخالفة شروط المتجر',    'Breach of Marketplace terms',
   'تم سحب الاعتماد بسبب مخالفة شروط المتجر.', 'Approval was withdrawn because of a breach of the Marketplace terms.', 10),
  ('revoke',    'بناءً على طلب المعرض',  'At the showroom''s request',
   'تم سحب الاعتماد بناءً على طلبك.', 'Approval was withdrawn at your request.', 20);

-- ---------------------------------------------------------------------------
-- 3. Notification writer: optional per-language variables
-- ---------------------------------------------------------------------------
-- The owner message exists in both languages, so the writer must be able to render {message} differently per language.
-- p_vars_ar / p_vars_en are merged over p_vars for that language only. Callers with seven arguments are unaffected.
drop function app.notify_from_template(uuid, uuid, text, text, uuid, text, jsonb);
create or replace function app.notify_from_template(
  p_recipient_user_id uuid,
  p_organization_id   uuid,
  p_template_key      text,
  p_subject_type      text,
  p_subject_id        uuid,
  p_deep_link         text,
  p_vars              jsonb default '{}'::jsonb,
  p_vars_ar           jsonb default null,
  p_vars_en           jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  t      public.notification_templates%rowtype;
  v_vars jsonb := coalesce(p_vars, '{}'::jsonb);
  v_ar   jsonb;
  v_en   jsonb;
  v_id   uuid;
  v_content jsonb;
begin
  select * into t from public.notification_templates where key = p_template_key;
  if not found then
    raise exception 'unknown notification template %', p_template_key using errcode = '22023';
  end if;
  if jsonb_typeof(v_vars) <> 'object'
     or (p_vars_ar is not null and jsonb_typeof(p_vars_ar) <> 'object')
     or (p_vars_en is not null and jsonb_typeof(p_vars_en) <> 'object') then
    raise exception 'template variables must be a JSON object' using errcode = '22023';
  end if;
  v_ar := v_vars || coalesce(p_vars_ar, '{}'::jsonb);
  v_en := v_vars || coalesce(p_vars_en, '{}'::jsonb);

  -- Each rendered field is cut to its limit (title 120, body 500, the same limits the editor enforces on the template
  -- itself). A template that repeats a variable can expand past them; cutting keeps the write from failing, which would
  -- roll back the caller's transaction (for example a seller approval).
  v_content := jsonb_build_object(
    'ar', jsonb_build_object(
      'title', btrim(left(app.render_template(coalesce(t.title_ar, t.default_title_ar), v_ar), 120)),
      'body',  btrim(left(app.render_template(coalesce(t.body_ar,  t.default_body_ar),  v_ar), 500))),
    'en', jsonb_build_object(
      'title', btrim(left(app.render_template(coalesce(t.title_en, t.default_title_en), v_en), 120)),
      'body',  btrim(left(app.render_template(coalesce(t.body_en,  t.default_body_en),  v_en), 500))));

  -- the key is the i18n fallback for readers that do not know `content`; it is never shown as text
  v_id := app.notify(p_recipient_user_id, p_organization_id, t.event_type, p_subject_type, p_subject_id,
                     p_deep_link, 'notifications.template.' || t.key, null, '{}'::jsonb);
  if v_id is not null then
    update public.notifications set content = v_content where id = v_id;
  end if;
  return v_id;
end;
$fn$;
revoke all on function app.notify_from_template(uuid, uuid, text, text, uuid, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;
comment on function app.notify_from_template(uuid, uuid, text, text, uuid, text, jsonb, jsonb, jsonb) is
  'Internal-only. Renders both languages of a template with the given variables (p_vars_ar / p_vars_en override p_vars per language), writes one notification through app.notify (self-notification still suppressed) and stores the rendered snapshot in notifications.content. Unknown template raises; a missing variable renders empty.';

-- ---------------------------------------------------------------------------
-- 4. The single seller-state transition (internal; replaces the V1 four-argument function)
-- ---------------------------------------------------------------------------
drop function app.marketplace_seller_transition(uuid, text, text, uuid);

create or replace function app.marketplace_seller_transition(
  p_organization_id uuid,
  p_action          text,        -- request | approve | reject | suspend | reinstate | revoke
  p_reason          text,        -- internal admin reason (optional for request and approve)
  p_actor           uuid,
  p_preset_id       uuid default null,
  p_message         text default null   -- custom owner-facing message ("other")
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_acct    public.marketplace_seller_accounts;
  v_from    text;
  v_to      text;
  v_event   text;
  v_org     record;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_custom  text := nullif(btrim(coalesce(p_message, '')), '');
  v_msg_ar  text;
  v_msg_en  text;
  v_preset  public.marketplace_seller_message_presets;
  v_owner   uuid;
begin
  if p_action not in ('request', 'approve', 'reject', 'suspend', 'reinstate', 'revoke') then
    raise exception 'unknown action' using errcode = '22023';
  end if;

  -- reason: required for reject / suspend / revoke / reinstate, optional for request / approve; always bounded
  if p_action in ('reject', 'suspend', 'revoke', 'reinstate') and v_reason is null then
    raise exception 'a reason of 3-500 characters is required' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) not between 3 and 500 then
    raise exception 'a reason of 3-500 characters is required' using errcode = '22023';
  end if;

  -- owner-facing message: a preset of THIS action, or custom text, never both; a request carries none
  if p_action = 'request' and (p_preset_id is not null or v_custom is not null) then
    raise exception 'a request carries no owner message' using errcode = '22023';
  end if;
  if p_preset_id is not null and v_custom is not null then
    raise exception 'choose a preset or write a custom message, not both' using errcode = '22023';
  end if;
  if v_custom is not null then
    if char_length(v_custom) > 300 then
      raise exception 'the owner message is limited to 300 characters' using errcode = '22023';
    end if;
    v_msg_ar := v_custom;
    v_msg_en := v_custom;
  elsif p_preset_id is not null then
    select * into v_preset from public.marketplace_seller_message_presets
     where id = p_preset_id and is_active and action = p_action;
    if not found then
      raise exception 'unknown or inactive message preset' using errcode = '22023';
    end if;
    v_msg_ar := btrim(v_preset.text_ar);
    v_msg_en := btrim(v_preset.text_en);
  end if;

  select o.name as name, o.org_type::text as org_type, o.status::text as org_status, o.deleted_at
    into v_org from public.organizations o where o.id = p_organization_id;
  if not found then
    raise exception 'unknown organization' using errcode = '23503';
  end if;

  select a.* into v_acct from public.marketplace_seller_accounts a
   where a.organization_id = p_organization_id for update;
  v_from := case when found then v_acct.status else null end;

  -- transition table
  case p_action
    when 'request' then
      if v_from is not null and v_from <> 'rejected' then
        raise exception 'cannot request approval while the seller is %', v_from using errcode = '23514';
      end if;
      v_to := 'pending'; v_event := 'requested';
    when 'approve' then
      -- an admin can approve a never-reviewed, pending, rejected or revoked organization (revoked is not terminal)
      if v_from is not null and v_from not in ('pending', 'rejected', 'revoked') then
        raise exception 'cannot approve a seller that is %', v_from using errcode = '23514';
      end if;
      v_to := 'approved'; v_event := 'approved';
    when 'reject' then
      if v_from is distinct from 'pending' then
        raise exception 'only a pending request can be rejected' using errcode = '23514';
      end if;
      v_to := 'rejected'; v_event := 'rejected';
    when 'suspend' then
      if v_from is distinct from 'approved' then
        raise exception 'only an approved seller can be suspended' using errcode = '23514';
      end if;
      v_to := 'suspended'; v_event := 'suspended';
    when 'revoke' then
      if v_from is null or v_from not in ('approved', 'suspended') then
        raise exception 'only an approved or suspended seller can be revoked' using errcode = '23514';
      end if;
      v_to := 'revoked'; v_event := 'revoked';
    when 'reinstate' then
      if v_from is distinct from 'suspended' then
        raise exception 'only a suspended seller can be reinstated' using errcode = '23514';
      end if;
      v_to := 'approved'; v_event := 'reinstated';
  end case;

  -- Eligibility is re-validated every time a seller is (re)enabled or asks to be — never trusted from before.
  if v_to in ('approved', 'pending') and not app.marketplace_seller_is_eligible(p_organization_id) then
    raise exception 'the organization is not an eligible, active showroom (type %, status %, deleted %)',
      v_org.org_type, v_org.org_status, v_org.deleted_at is not null using errcode = '23514';
  end if;

  perform set_config('app.marketplace_seller_write', 'on', true);
  if v_from is null then
    insert into public.marketplace_seller_accounts
      (organization_id, status, status_reason, owner_message_ar, owner_message_en, requested_at,
       approved_at, approved_by, status_changed_at)
    values (p_organization_id, v_to, v_reason, v_msg_ar, v_msg_en, now(),
            case when v_to = 'approved' then now() end, case when v_to = 'approved' then p_actor end, now());
  else
    update public.marketplace_seller_accounts a set
      status = v_to,
      status_reason = v_reason,
      owner_message_ar = v_msg_ar,
      owner_message_en = v_msg_en,
      status_changed_at = now(),
      requested_at = case when p_action = 'request'  then now() else a.requested_at end,
      approved_at  = case when v_to = 'approved'  then now() else a.approved_at end,
      approved_by  = case when v_to = 'approved'  then p_actor else a.approved_by end,
      suspended_at = case when v_to = 'suspended' then now() else a.suspended_at end,
      suspended_by = case when v_to = 'suspended' then p_actor else a.suspended_by end,
      rejected_at  = case when v_to = 'rejected'  then now() else a.rejected_at end,
      rejected_by  = case when v_to = 'rejected'  then p_actor else a.rejected_by end,
      revoked_at   = case when v_to = 'revoked'   then now() else a.revoked_at end,
      revoked_by   = case when v_to = 'revoked'   then p_actor else a.revoked_by end
    where a.organization_id = p_organization_id;
  end if;
  perform set_config('app.marketplace_seller_write', 'off', true);

  insert into public.marketplace_seller_account_events
    (organization_id, action, from_status, to_status, reason, actor_user_id, org_type_at_event, org_status_at_event,
     owner_message_ar, owner_message_en, preset_id)
  values (p_organization_id, v_event, v_from, v_to, v_reason, p_actor, v_org.org_type, v_org.org_status,
          v_msg_ar, v_msg_en, p_preset_id);

  -- The OWNER hears about every decision (in-app only). Owners are the active members who hold org.manage; managers
  -- who do not are not notified. A request is not a decision, so it writes nothing here.
  if p_action <> 'request' then
    for v_owner in
      select distinct m.user_id
        from public.memberships m
        join public.membership_capabilities c on c.membership_id = m.id
       where m.organization_id = p_organization_id and m.status = 'active' and c.capability_key = 'org.manage'
    loop
      perform app.notify_from_template(
        v_owner, p_organization_id, 'marketplace.seller.' || v_event, 'marketplace_seller', p_organization_id,
        '/showroom/marketplace', jsonb_build_object('showroom_name', v_org.name),
        jsonb_build_object('message', coalesce(v_msg_ar, '')), jsonb_build_object('message', coalesce(v_msg_en, '')));
    end loop;
  end if;

  return v_to;
end;
$$;
revoke all on function app.marketplace_seller_transition(uuid, text, text, uuid, uuid, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Admin RPCs (permission-checked, audited)
-- ---------------------------------------------------------------------------
drop function public.admin_marketplace_seller_approve(uuid, text);
drop function public.admin_marketplace_seller_suspend(uuid, text);
drop function public.admin_marketplace_seller_revoke(uuid, text);
drop function public.admin_marketplace_seller_reinstate(uuid, text);

create or replace function public.admin_marketplace_seller_approve(
  p_organization_id uuid, p_reason text default null, p_preset_id uuid default null, p_message text default null)
returns text language plpgsql security definer set search_path = '' as $$
begin
  return app.marketplace_seller_transition(p_organization_id, 'approve', p_reason, app.marketplace_assert_seller_admin(true), p_preset_id, p_message);
end;
$$;
create or replace function public.admin_marketplace_seller_reject(
  p_organization_id uuid, p_reason text, p_preset_id uuid default null, p_message text default null)
returns text language plpgsql security definer set search_path = '' as $$
begin
  return app.marketplace_seller_transition(p_organization_id, 'reject', p_reason, app.marketplace_assert_seller_admin(true), p_preset_id, p_message);
end;
$$;
create or replace function public.admin_marketplace_seller_suspend(
  p_organization_id uuid, p_reason text, p_preset_id uuid default null, p_message text default null)
returns text language plpgsql security definer set search_path = '' as $$
begin
  return app.marketplace_seller_transition(p_organization_id, 'suspend', p_reason, app.marketplace_assert_seller_admin(true), p_preset_id, p_message);
end;
$$;
create or replace function public.admin_marketplace_seller_revoke(
  p_organization_id uuid, p_reason text, p_preset_id uuid default null, p_message text default null)
returns text language plpgsql security definer set search_path = '' as $$
begin
  return app.marketplace_seller_transition(p_organization_id, 'revoke', p_reason, app.marketplace_assert_seller_admin(true), p_preset_id, p_message);
end;
$$;
create or replace function public.admin_marketplace_seller_reinstate(
  p_organization_id uuid, p_reason text, p_preset_id uuid default null, p_message text default null)
returns text language plpgsql security definer set search_path = '' as $$
begin
  return app.marketplace_seller_transition(p_organization_id, 'reinstate', p_reason, app.marketplace_assert_seller_admin(true), p_preset_id, p_message);
end;
$$;

-- The showroom owner asks for approval (first time, or again after a rejection). Authority: org.manage on THIS
-- organization, nothing else; the database re-validates that the organization is an eligible, active showroom.
create or replace function public.marketplace_seller_request_approval(p_organization_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  -- an unknown organization and one the caller does not own are indistinguishable
  if p_organization_id is null or not app.has_capability(p_organization_id, 'org.manage') then
    raise exception 'organization not found or not permitted' using errcode = '42501';
  end if;
  return app.marketplace_seller_transition(p_organization_id, 'request', null, v_uid);
end;
$$;

-- Presets: readable by seller admins and template viewers, edited under notification_templates.manage.
create or replace function public.admin_marketplace_seller_presets()
returns table (id uuid, action text, label_ar text, label_en text, text_ar text, text_en text, is_active boolean, sort_order integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not (app.has_admin_permission('marketplace_sellers.read') or app.has_admin_permission('marketplace_sellers.manage')
          or app.has_admin_permission('notification_templates.view') or app.has_admin_permission('notification_templates.manage')) then
    raise exception 'permission marketplace_sellers.read is required' using errcode = '42501';
  end if;
  return query
    select p.id, p.action, p.label_ar, p.label_en, p.text_ar, p.text_en, p.is_active, p.sort_order
      from public.marketplace_seller_message_presets p
     order by p.action, p.sort_order, p.created_at;
end;
$$;

create or replace function public.admin_marketplace_seller_preset_save(
  p_id uuid, p_action text, p_label_ar text, p_label_en text, p_text_ar text, p_text_en text,
  p_is_active boolean, p_sort_order integer, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_old   public.marketplace_seller_message_presets;
  v_id    uuid;
  v_new   jsonb;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not app.has_admin_permission('notification_templates.manage') then
    raise exception 'permission notification_templates.manage is required' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'a reason of 3-500 characters is required' using errcode = '22023';
  end if;
  if p_action is null or p_action not in ('approve', 'reject', 'suspend', 'reinstate', 'revoke') then
    raise exception 'unknown action' using errcode = '22023';
  end if;
  p_label_ar := btrim(p_label_ar); p_label_en := btrim(p_label_en);
  p_text_ar := btrim(p_text_ar);   p_text_en := btrim(p_text_en);
  if coalesce(char_length(p_label_ar), 0) not between 1 and 80 or coalesce(char_length(p_label_en), 0) not between 1 and 80
     or coalesce(char_length(p_text_ar), 0) not between 1 and 300 or coalesce(char_length(p_text_en), 0) not between 1 and 300 then
    raise exception 'labels must be 1-80 characters and texts 1-300 characters, in both languages' using errcode = '22023';
  end if;
  v_new := jsonb_build_object('action', p_action, 'label_ar', p_label_ar, 'label_en', p_label_en, 'text_ar', p_text_ar,
                              'text_en', p_text_en, 'is_active', coalesce(p_is_active, true), 'sort_order', coalesce(p_sort_order, 0));
  if p_id is null then
    insert into public.marketplace_seller_message_presets
      (action, label_ar, label_en, text_ar, text_en, is_active, sort_order, updated_by)
    values (p_action, p_label_ar, p_label_en, p_text_ar, p_text_en, coalesce(p_is_active, true), coalesce(p_sort_order, 0), v_actor)
    returning id into v_id;
    insert into public.marketplace_seller_preset_events (preset_id, action, old_content, new_content, actor_id, reason)
    values (v_id, 'created', null, v_new, v_actor, btrim(p_reason));
    return v_id;
  end if;
  select * into v_old from public.marketplace_seller_message_presets where id = p_id for update;
  if not found then
    raise exception 'unknown preset' using errcode = '22023';
  end if;
  update public.marketplace_seller_message_presets set
    action = p_action, label_ar = p_label_ar, label_en = p_label_en, text_ar = p_text_ar, text_en = p_text_en,
    is_active = coalesce(p_is_active, true), sort_order = coalesce(p_sort_order, 0), updated_by = v_actor
   where id = p_id;
  insert into public.marketplace_seller_preset_events (preset_id, action, old_content, new_content, actor_id, reason)
  values (p_id, 'updated',
          jsonb_build_object('action', v_old.action, 'label_ar', v_old.label_ar, 'label_en', v_old.label_en, 'text_ar', v_old.text_ar,
                             'text_en', v_old.text_en, 'is_active', v_old.is_active, 'sort_order', v_old.sort_order),
          v_new, v_actor, btrim(p_reason));
  return p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Overview and history (return shape changes, so they are recreated)
-- ---------------------------------------------------------------------------
drop function public.admin_marketplace_seller_overview();
create or replace function public.admin_marketplace_seller_overview()
returns table (
  organization_id uuid, organization_name text, org_status text, org_type text, org_deleted boolean, eligible boolean,
  seller_status text, status_reason text, owner_message_ar text, owner_message_en text,
  status_changed_at timestamptz, requested_at timestamptz, approved_at timestamptz, approved_by_name text,
  products_total bigint, products_published bigint, products_draft bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (app.has_admin_permission('marketplace_sellers.read') or app.has_admin_permission('marketplace_sellers.manage')) then
    raise exception 'mp:not_permitted' using errcode = '42501';
  end if;
  return query
    select o.id, o.name, o.status::text, o.org_type::text, o.deleted_at is not null,
           app.marketplace_seller_is_eligible(o.id),
           a.status, a.status_reason, a.owner_message_ar, a.owner_message_en,
           a.status_changed_at, a.requested_at, a.approved_at,
           (select p.display_name from public.profiles p where p.user_id = a.approved_by),
           (select count(*) from public.marketplace_products mp where mp.seller_organization_id = o.id),
           (select count(*) from public.marketplace_products mp where mp.seller_organization_id = o.id and mp.status = 'published'),
           (select count(*) from public.marketplace_products mp where mp.seller_organization_id = o.id and mp.status = 'draft')
    from public.organizations o
    left join public.marketplace_seller_accounts a on a.organization_id = o.id
    -- a deleted organization stays listed while it still holds a seller account, so its state can be explained
    where (o.deleted_at is null and o.org_type::text = 'showroom_dealer') or a.organization_id is not null
    order by (a.status = 'pending') desc nulls last, (a.status = 'approved') desc nulls last,
             a.status_changed_at desc nulls last, o.name;
end;
$$;

drop function public.admin_marketplace_seller_history(uuid);
create or replace function public.admin_marketplace_seller_history(p_organization_id uuid)
returns table (sequence bigint, action text, from_status text, to_status text, reason text, owner_message_ar text,
               owner_message_en text, preset_id uuid, actor_user_id uuid, org_type_at_event text,
               org_status_at_event text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.marketplace_assert_seller_admin(false);
  return query
    select e.sequence, e.action, e.from_status, e.to_status, e.reason, e.owner_message_ar, e.owner_message_en,
           e.preset_id, e.actor_user_id, e.org_type_at_event, e.org_status_at_event, e.created_at
    from public.marketplace_seller_account_events e
    where e.organization_id = p_organization_id order by e.sequence desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
revoke all on function public.admin_marketplace_seller_approve(uuid, text, uuid, text)   from public, anon, authenticated, service_role;
revoke all on function public.admin_marketplace_seller_reject(uuid, text, uuid, text)    from public, anon, authenticated, service_role;
revoke all on function public.admin_marketplace_seller_suspend(uuid, text, uuid, text)   from public, anon, authenticated, service_role;
revoke all on function public.admin_marketplace_seller_revoke(uuid, text, uuid, text)    from public, anon, authenticated, service_role;
revoke all on function public.admin_marketplace_seller_reinstate(uuid, text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.marketplace_seller_request_approval(uuid)                  from public, anon, authenticated, service_role;
revoke all on function public.admin_marketplace_seller_presets()                         from public, anon, authenticated, service_role;
revoke all on function public.admin_marketplace_seller_preset_save(uuid, text, text, text, text, text, boolean, integer, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_marketplace_seller_overview()                        from public, anon, authenticated, service_role;
revoke all on function public.admin_marketplace_seller_history(uuid)                     from public, anon, authenticated, service_role;
grant execute on function public.admin_marketplace_seller_approve(uuid, text, uuid, text)   to authenticated;
grant execute on function public.admin_marketplace_seller_reject(uuid, text, uuid, text)    to authenticated;
grant execute on function public.admin_marketplace_seller_suspend(uuid, text, uuid, text)   to authenticated;
grant execute on function public.admin_marketplace_seller_revoke(uuid, text, uuid, text)    to authenticated;
grant execute on function public.admin_marketplace_seller_reinstate(uuid, text, uuid, text) to authenticated;
grant execute on function public.marketplace_seller_request_approval(uuid)                  to authenticated;
grant execute on function public.admin_marketplace_seller_presets()                         to authenticated;
grant execute on function public.admin_marketplace_seller_preset_save(uuid, text, text, text, text, text, boolean, integer, text)
  to authenticated;
grant execute on function public.admin_marketplace_seller_overview()                        to authenticated;
grant execute on function public.admin_marketplace_seller_history(uuid)                     to authenticated;
