-- Notification templates (Marketplace plan PR 4; owner decisions 2026-11-19, Parts 1-2).
--
-- WHAT: admin-managed, bilingual (Arabic + English) in-app notification texts with named variables.
-- Each template has a seeded DEFAULT (immutable) and an optional admin edit; the effective text is
-- the edit when present, the default otherwise, so a template can never be "missing".
--
-- HOW A NOTIFICATION IS WRITTEN: app.notify_from_template renders BOTH languages at write time and
-- stores them in notifications.content. A later template edit never rewrites history, and the reader
-- still gets their own language when their locale changes. Rows written before this migration keep
-- using title_key/body_key and are untouched.
--
-- VARIABLES are written {name} (ASCII, lower snake case). Each template declares the variables it may
-- use; the admin RPC refuses a text that uses an undeclared one. Substitution is plain text only: a
-- value is trimmed, stripped of control characters and cut at 300 characters, and an absent variable
-- renders as an empty string, so a notification can never fail the business transaction that fires it.
--
-- PERMISSIONS (new; deliberately NOT marketplace_sellers.manage):
--   notification_templates.view   Administrator and higher
--   notification_templates.manage Super Admin
-- Every edit appends a notification_template_events row (who, when, old, new, reason); actor carries
-- no foreign key because audit outlives accounts.
--
-- SEEDED here: the Phase 1 events. Later PRs (orders, returns) add their own rows in their own
-- migrations.

-- ---------------------------------------------------------------------------
-- 1. Permissions
-- ---------------------------------------------------------------------------
insert into public.admin_permissions (key, resource, action, description, sort_order) values
  ('notification_templates.view', 'notification_templates', 'view',
   'See the in-app notification templates (Arabic and English) and their change history (Administrator and higher).', 82),
  ('notification_templates.manage', 'notification_templates', 'manage',
   'Edit the text of an in-app notification template, with a mandatory reason (Super Admin only).', 83)
on conflict (key) do nothing;

insert into public.admin_role_permissions (role_id, permission_key, is_locked)
select r.id, p.key, true
  from public.admin_roles r
 cross join (values ('notification_templates.view'), ('notification_templates.manage')) as p(key)
 where r.key = 'super_admin'
on conflict (role_id, permission_key) do nothing;

insert into public.admin_role_permissions (role_id, permission_key, is_locked)
select r.id, 'notification_templates.view', true
  from public.admin_roles r
 where r.key = 'administrator'
on conflict (role_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Notification event vocabulary: the Marketplace events this PR seeds
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint ck_notifications_event_type_known;
alter table public.notifications add constraint ck_notifications_event_type_known check (event_type in (
  'rfq.submitted', 'rfq.cancelled',
  'quotation.submitted', 'quotation.accepted', 'quotation.rejected',
  'order.created', 'order.started', 'order.completed', 'order.cancelled',
  'project.created', 'project.activated', 'project.completed',
  'verification.approved', 'verification.rejected', 'verification.changes_requested',
  'message.sent',
  'job.application.accepted', 'job.application.rejected',
  'job.assignment.ready', 'job.assignment.completed', 'job.assignment.cancelled',
  'job.review.received',
  'whatsapp_otp.audit_unmatched', 'whatsapp_otp.budget_critical', 'whatsapp_otp.budget_exhausted',
  'whatsapp_otp.budget_warning', 'whatsapp_otp.failure_rate', 'whatsapp_otp.delivery_unmatched',
  'marketplace.seller.approved', 'marketplace.seller.rejected', 'marketplace.seller.suspended',
  'marketplace.seller.reinstated', 'marketplace.seller.revoked',
  'marketplace.product.rejected'
));

-- The rendered snapshot: {"ar": {"title": "...", "body": "..."}, "en": {...}}. Null for the older
-- key-based rows. Bounded, and both languages must be present when it is.
alter table public.notifications add column content jsonb;
alter table public.notifications add constraint ck_notifications_content_shape check (
  content is null or (
    jsonb_typeof(content) = 'object'
    and jsonb_typeof(content -> 'ar') = 'object' and jsonb_typeof(content -> 'en') = 'object'
    -- bound the fields themselves (what the writer guarantees), not the serialized size: escaping of quotes and
    -- backslashes in JSON can double the serialized length, so a size-only limit could reject a valid template
    and char_length(coalesce(content -> 'ar' ->> 'title', '')) <= 120
    and char_length(coalesce(content -> 'en' ->> 'title', '')) <= 120
    and char_length(coalesce(content -> 'ar' ->> 'body', '')) <= 500
    and char_length(coalesce(content -> 'en' ->> 'body', '')) <= 500
    and length(content::text) <= 16384));
comment on column public.notifications.content is
  'Rendered bilingual snapshot written by app.notify_from_template. Null for key-based rows (title_key/body_key). A template edit never changes a stored row.';

-- ---------------------------------------------------------------------------
-- 3. Variable helpers
-- ---------------------------------------------------------------------------
-- The variables a text uses: the names inside {braces}.
create or replace function app.template_variables(p_text text)
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct m[1] order by m[1]), '{}'::text[])
    from regexp_matches(coalesce(p_text, ''), '\{([A-Za-z0-9_]+)\}', 'g') as m;
$$;
revoke all on function app.template_variables(text) from public, anon, authenticated, service_role;

-- Plain-text substitution. Unknown placeholders are left out (rendered empty), values are cleaned.
create or replace function app.render_template(p_text text, p_vars jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v_out  text := coalesce(p_text, '');
  v_name text;
  v_val  text;
begin
  for v_name in select unnest(app.template_variables(v_out)) loop
    v_val := case when jsonb_typeof(p_vars -> v_name) in ('string', 'number') then p_vars ->> v_name else '' end;
    v_val := left(btrim(regexp_replace(v_val, '[[:cntrl:]]', ' ', 'g')), 300);
    v_out := replace(v_out, '{' || v_name || '}', v_val);
  end loop;
  return btrim(v_out);
end;
$$;
revoke all on function app.render_template(text, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Tables
-- ---------------------------------------------------------------------------
create table public.notification_templates (
  key          text        primary key,
  event_type   text        not null,
  variables    text[]      not null default '{}',
  -- seeded defaults (never edited)
  default_title_ar text not null, default_body_ar text not null,
  default_title_en text not null, default_body_en text not null,
  -- admin edits; null = use the default
  title_ar text, body_ar text, title_en text, body_en text,
  version    integer     not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint notification_templates_key_ck check (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  constraint notification_templates_event_ck check (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  constraint notification_templates_vars_ck check (cardinality(variables) <= 12),
  constraint notification_templates_text_len_ck check (
    char_length(default_title_ar) between 1 and 120 and char_length(default_title_en) between 1 and 120
    and char_length(default_body_ar) between 1 and 500 and char_length(default_body_en) between 1 and 500
    and (title_ar is null or char_length(title_ar) between 1 and 120)
    and (title_en is null or char_length(title_en) between 1 and 120)
    and (body_ar  is null or char_length(body_ar)  between 1 and 500)
    and (body_en  is null or char_length(body_en)  between 1 and 500)),
  -- an edit is all four texts or none: a half-translated template would show one language blank
  constraint notification_templates_edit_complete_ck check (
    (title_ar is null and body_ar is null and title_en is null and body_en is null)
    or (title_ar is not null and body_ar is not null and title_en is not null and body_en is not null))
);
comment on table public.notification_templates is
  'Bilingual in-app notification templates. Effective text = admin edit when present, else the seeded default. Changed only by admin_notification_template_set/reset, which validate variables and append notification_template_events.';

create table public.notification_template_events (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  template_key text      not null,
  action     text        not null check (action in ('set', 'reset')),
  old_content jsonb      not null,
  new_content jsonb      not null,
  actor_id   uuid        not null,
  reason     text        not null check (char_length(btrim(reason)) between 3 and 500)
);
comment on table public.notification_template_events is
  'Append-only history of template edits. Actor carries no foreign key: audit outlives accounts.';

create or replace function app.notification_template_events_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '23514';
end;
$$;
revoke all on function app.notification_template_events_append_only() from public, anon, authenticated, service_role;
create trigger notification_template_events_append_only
  before update or delete on public.notification_template_events
  for each row execute function app.notification_template_events_append_only();

alter table public.notification_templates       enable row level security;
alter table public.notification_template_events enable row level security;
revoke all on public.notification_templates       from public, anon, authenticated, service_role;
revoke all on public.notification_template_events from public, anon, authenticated, service_role;
-- both tables: RLS on, no grant, no policy. Access is through the functions below.

-- ---------------------------------------------------------------------------
-- 5. Seeded templates (Phase 1)
-- ---------------------------------------------------------------------------
-- {showroom_name}: the seller organization; {message}: the owner-facing message the admin chose
-- (preset or custom); {product_name}: the product the review concerned.
insert into public.notification_templates
  (key, event_type, variables, default_title_ar, default_body_ar, default_title_en, default_body_en) values
  ('marketplace.seller.approved', 'marketplace.seller.approved', array['showroom_name', 'message'],
   'تم اعتماد معرضك في المتجر',
   'تم اعتماد {showroom_name} للبيع في المتجر. {message}',
   'Your showroom was approved for the Marketplace',
   '{showroom_name} is now approved to sell on the Marketplace. {message}'),
  ('marketplace.seller.rejected', 'marketplace.seller.rejected', array['showroom_name', 'message'],
   'لم يتم اعتماد معرضك في المتجر',
   'لم يتم اعتماد {showroom_name} للبيع في المتجر. {message}',
   'Your showroom was not approved for the Marketplace',
   '{showroom_name} was not approved to sell on the Marketplace. {message}'),
  ('marketplace.seller.suspended', 'marketplace.seller.suspended', array['showroom_name', 'message'],
   'تم إيقاف معرضك في المتجر مؤقتًا',
   'تم إيقاف {showroom_name} في المتجر مؤقتًا. {message}',
   'Your showroom was suspended on the Marketplace',
   '{showroom_name} was suspended on the Marketplace. {message}'),
  ('marketplace.seller.reinstated', 'marketplace.seller.reinstated', array['showroom_name', 'message'],
   'تمت إعادة تفعيل معرضك في المتجر',
   'تمت إعادة تفعيل {showroom_name} في المتجر. {message}',
   'Your showroom was reinstated on the Marketplace',
   '{showroom_name} is active on the Marketplace again. {message}'),
  ('marketplace.seller.revoked', 'marketplace.seller.revoked', array['showroom_name', 'message'],
   'تم سحب اعتماد معرضك من المتجر',
   'تم سحب اعتماد {showroom_name} من المتجر. {message}',
   'Your showroom approval was withdrawn',
   'The Marketplace approval of {showroom_name} was withdrawn. {message}'),
  ('marketplace.product.rejected', 'marketplace.product.rejected', array['product_name', 'showroom_name', 'message'],
   'لم يتم اعتماد منتجك',
   'لم يتم اعتماد المنتج {product_name}. {message}',
   'Your product was not approved',
   'The product {product_name} was not approved. {message}');

-- ---------------------------------------------------------------------------
-- 6. Writer: the one way a template becomes a notification (INTERNAL ONLY)
-- ---------------------------------------------------------------------------
create or replace function app.notify_from_template(
  p_recipient_user_id uuid,
  p_organization_id   uuid,
  p_template_key      text,
  p_subject_type      text,
  p_subject_id        uuid,
  p_deep_link         text,
  p_vars              jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  t      public.notification_templates%rowtype;
  v_vars jsonb := coalesce(p_vars, '{}'::jsonb);
  v_id   uuid;
  v_content jsonb;
begin
  select * into t from public.notification_templates where key = p_template_key;
  if not found then
    raise exception 'unknown notification template %', p_template_key using errcode = '22023';
  end if;
  if jsonb_typeof(v_vars) <> 'object' then
    raise exception 'template variables must be a JSON object' using errcode = '22023';
  end if;

  -- Each rendered field is cut to its limit (title 120, body 500, the same limits the editor enforces on the template
  -- itself). A template that repeats a variable can expand past them; cutting keeps the write from failing, which would
  -- roll back the caller's transaction (for example a seller approval).
  v_content := jsonb_build_object(
    'ar', jsonb_build_object(
      'title', btrim(left(app.render_template(coalesce(t.title_ar, t.default_title_ar), v_vars), 120)),
      'body',  btrim(left(app.render_template(coalesce(t.body_ar,  t.default_body_ar),  v_vars), 500))),
    'en', jsonb_build_object(
      'title', btrim(left(app.render_template(coalesce(t.title_en, t.default_title_en), v_vars), 120)),
      'body',  btrim(left(app.render_template(coalesce(t.body_en,  t.default_body_en),  v_vars), 500))));

  -- the key is the i18n fallback for readers that do not know `content`; it is never shown as text
  v_id := app.notify(p_recipient_user_id, p_organization_id, t.event_type, p_subject_type, p_subject_id,
                     p_deep_link, 'notifications.template.' || t.key, null, '{}'::jsonb);
  if v_id is not null then
    update public.notifications set content = v_content where id = v_id;
  end if;
  return v_id;
end;
$fn$;
revoke all on function app.notify_from_template(uuid, uuid, text, text, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
comment on function app.notify_from_template(uuid, uuid, text, text, uuid, text, jsonb) is
  'Internal-only. Renders both languages of a template with the given variables, writes one notification through app.notify (self-notification still suppressed) and stores the rendered snapshot in notifications.content. Unknown template raises; a missing variable renders empty.';

-- ---------------------------------------------------------------------------
-- 7. Admin RPCs
-- ---------------------------------------------------------------------------
create or replace function public.admin_notification_templates()
returns table (
  key text, event_type text, variables text[],
  title_ar text, body_ar text, title_en text, body_en text,
  default_title_ar text, default_body_ar text, default_title_en text, default_body_en text,
  is_edited boolean, version integer, updated_at timestamptz, updated_by uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not (app.has_admin_permission('notification_templates.view') or app.has_admin_permission('notification_templates.manage')) then
    raise exception 'permission notification_templates.view is required' using errcode = '42501';
  end if;
  return query
    select t.key, t.event_type, t.variables,
           coalesce(t.title_ar, t.default_title_ar), coalesce(t.body_ar, t.default_body_ar),
           coalesce(t.title_en, t.default_title_en), coalesce(t.body_en, t.default_body_en),
           t.default_title_ar, t.default_body_ar, t.default_title_en, t.default_body_en,
           (t.title_ar is not null), t.version, t.updated_at, t.updated_by
      from public.notification_templates t
     order by t.key;
end;
$$;
revoke all on function public.admin_notification_templates() from public, anon, authenticated, service_role;
grant execute on function public.admin_notification_templates() to authenticated;

create or replace function public.admin_notification_template_set(
  p_key text, p_title_ar text, p_body_ar text, p_title_en text, p_body_en text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  t       public.notification_templates%rowtype;
  v_text  text;
  v_old   jsonb;
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
  select * into t from public.notification_templates where key = p_key for update;
  if not found then
    raise exception 'unknown template' using errcode = '22023';
  end if;
  p_title_ar := btrim(p_title_ar); p_body_ar := btrim(p_body_ar);
  p_title_en := btrim(p_title_en); p_body_en := btrim(p_body_en);
  if coalesce(char_length(p_title_ar), 0) not between 1 and 120 or coalesce(char_length(p_title_en), 0) not between 1 and 120
     or coalesce(char_length(p_body_ar), 0) not between 1 and 500 or coalesce(char_length(p_body_en), 0) not between 1 and 500 then
    raise exception 'every text must be 1-120 characters (title) or 1-500 characters (body)' using errcode = '22023';
  end if;
  -- only the variables this template declares may appear, and in every language
  foreach v_text in array array[p_title_ar, p_body_ar, p_title_en, p_body_en] loop
    if not (app.template_variables(v_text) <@ t.variables) then
      raise exception 'the text uses an undeclared variable' using errcode = '22023',
        detail = array_to_string(array(select unnest(app.template_variables(v_text)) except select unnest(t.variables)), ',');
    end if;
  end loop;

  v_old := jsonb_build_object('title_ar', coalesce(t.title_ar, t.default_title_ar), 'body_ar', coalesce(t.body_ar, t.default_body_ar),
                              'title_en', coalesce(t.title_en, t.default_title_en), 'body_en', coalesce(t.body_en, t.default_body_en));
  v_new := jsonb_build_object('title_ar', p_title_ar, 'body_ar', p_body_ar, 'title_en', p_title_en, 'body_en', p_body_en);
  if v_old = v_new then
    return jsonb_build_object('key', p_key, 'changed', false);
  end if;
  update public.notification_templates
     set title_ar = p_title_ar, body_ar = p_body_ar, title_en = p_title_en, body_en = p_body_en,
         version = version + 1, updated_at = now(), updated_by = v_actor
   where key = p_key;
  insert into public.notification_template_events (template_key, action, old_content, new_content, actor_id, reason)
  values (p_key, 'set', v_old, v_new, v_actor, btrim(p_reason));
  return jsonb_build_object('key', p_key, 'changed', true);
end;
$$;
revoke all on function public.admin_notification_template_set(text, text, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_notification_template_set(text, text, text, text, text, text) to authenticated;

create or replace function public.admin_notification_template_reset(p_key text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  t       public.notification_templates%rowtype;
  v_old   jsonb;
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
  select * into t from public.notification_templates where key = p_key for update;
  if not found then
    raise exception 'unknown template' using errcode = '22023';
  end if;
  if t.title_ar is null then
    return jsonb_build_object('key', p_key, 'changed', false);
  end if;
  v_old := jsonb_build_object('title_ar', t.title_ar, 'body_ar', t.body_ar, 'title_en', t.title_en, 'body_en', t.body_en);
  v_new := jsonb_build_object('title_ar', t.default_title_ar, 'body_ar', t.default_body_ar,
                              'title_en', t.default_title_en, 'body_en', t.default_body_en);
  update public.notification_templates
     set title_ar = null, body_ar = null, title_en = null, body_en = null,
         version = version + 1, updated_at = now(), updated_by = v_actor
   where key = p_key;
  insert into public.notification_template_events (template_key, action, old_content, new_content, actor_id, reason)
  values (p_key, 'reset', v_old, v_new, v_actor, btrim(p_reason));
  return jsonb_build_object('key', p_key, 'changed', true);
end;
$$;
revoke all on function public.admin_notification_template_reset(text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_notification_template_reset(text, text) to authenticated;

create or replace function public.admin_notification_template_events(p_limit integer default 50)
returns table (id bigint, at timestamptz, template_key text, action text, actor_id uuid, reason text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not (app.has_admin_permission('notification_templates.view') or app.has_admin_permission('notification_templates.manage')) then
    raise exception 'permission notification_templates.view is required' using errcode = '42501';
  end if;
  return query
    select e.id, e.at, e.template_key, e.action, e.actor_id, e.reason
      from public.notification_template_events e
     order by e.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
revoke all on function public.admin_notification_template_events(integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_notification_template_events(integer) to authenticated;
