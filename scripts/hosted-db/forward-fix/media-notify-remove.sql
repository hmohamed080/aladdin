-- Forward-fix "media-notify": remove everything 20261121090001..003 added and restore what they changed.
-- NOT a down migration and NOT applied anywhere. Use only with the owner's explicit approval, on a hosted database, through the Supabase
-- migration path as a NEW migration (never the SQL Editor), and only if the plan "media-notify" must be undone.
--   20261121090001 media policy caps and rejected-image purge: function public.marketplace_rejected_images_purge, function and trigger
--                  that cap new video rows, the receipt check public.media_storage_attest, three legacy bucket size limits.
--   20261121090002 admin-configurable upload limits: tables media_limits and media_limit_events, 5 functions, permissions media_limits.*.
--   20261121090003 notification templates: tables notification_templates and notification_template_events, column notifications.content,
--                  two constraints on notifications, 8 functions, permissions notification_templates.*.
-- Removes 4 tables, 15 functions, 1 trigger, 1 column and 4 permissions; restores public.media_storage_attest, the notifications event-type
-- constraint and the three bucket limits to the Acceptance state read on 2026-11-22 (232 migrations, latest 20261116100014).
-- Safe from a partly applied plan (each migration commits separately): it inspects only the tables and the column that exist, and every drop is IF EXISTS.
-- DATA GUARD: refuses (RAISE) as soon as an administrator has changed an upload limit or a notification template, when any notification
-- holds a rendered snapshot or one of the six new event types, or when a seeded table differs from its migration seed. It never deletes
-- user data. Roll the Worker (the application) back to the version before these migrations first: the old code does not call any of this.
-- NOT undone, because it cannot be: marketplace_rejected_images_purge deletes rejected Marketplace image rows and their objects when the
-- media cleanup job runs it; whatever it already purged stays purged. The bucket limits go back only where they are still exactly 10 MiB.
begin;

do $guard$
declare n bigint;
begin
  -- each migration commits separately, so a partly applied plan is a valid starting state: inspect only what exists
  if to_regclass('public.media_limit_events') is not null then
    execute 'select count(*) from public.media_limit_events' into n;
    if n <> 0 then raise exception 'media-notify forward-fix refused: media_limit_events holds % rows (an upload limit was changed; the audit trail would be lost)', n; end if;
  end if;
  if to_regclass('public.media_limits') is not null then
    if exists (select 1 from public.media_limits where max_bytes <> default_bytes) then
      raise exception 'media-notify forward-fix refused: an upload limit differs from its default';
    end if;
    select count(*) into n from public.media_limits;
    if n <> 10 then raise exception 'media-notify forward-fix refused: media_limits holds % rows (migration seed: 10)', n; end if;
  end if;

  if to_regclass('public.notification_template_events') is not null then
    execute 'select count(*) from public.notification_template_events' into n;
    if n <> 0 then raise exception 'media-notify forward-fix refused: notification_template_events holds % rows (a template was edited; the history would be lost)', n; end if;
  end if;
  if to_regclass('public.notification_templates') is not null then
    if exists (select 1 from public.notification_templates where title_ar is not null or body_ar is not null or title_en is not null or body_en is not null) then
      raise exception 'media-notify forward-fix refused: a notification template holds an edit';
    end if;
    select count(*) into n from public.notification_templates;
    if n <> 6 then raise exception 'media-notify forward-fix refused: notification_templates holds % rows (migration seed: 6)', n; end if;
  end if;

  -- the content column and the six event types exist only once 20261121090003 is applied
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'content') then
    execute 'select count(*) from public.notifications where content is not null' into n;
    if n <> 0 then raise exception 'media-notify forward-fix refused: % notification(s) hold a rendered snapshot', n; end if;
  end if;
  select count(*) into n from public.notifications
   where event_type in ('marketplace.seller.approved', 'marketplace.seller.rejected', 'marketplace.seller.suspended',
                        'marketplace.seller.reinstated', 'marketplace.seller.revoked', 'marketplace.product.rejected');
  if n <> 0 then raise exception 'media-notify forward-fix refused: % notification(s) use one of the six new event types', n; end if;
end
$guard$;

-- locked core permissions refuse direct deletes (app.admin_role_permissions_guard); the guard is paused only for this statement, inside the transaction.
ALTER TABLE public.admin_role_permissions DISABLE TRIGGER trg_admin_role_permissions_guard;
delete from public.admin_role_permissions where permission_key in ('media_limits.view', 'media_limits.manage', 'notification_templates.view', 'notification_templates.manage');
ALTER TABLE public.admin_role_permissions ENABLE TRIGGER trg_admin_role_permissions_guard;
delete from public.admin_permissions where key in ('media_limits.view', 'media_limits.manage', 'notification_templates.view', 'notification_templates.manage');

-- 20261121090003: notification templates (tables first, then the functions their triggers used)
DROP TABLE IF EXISTS public.notification_template_events CASCADE;
DROP TABLE IF EXISTS public.notification_templates CASCADE;
DROP FUNCTION IF EXISTS public.admin_notification_template_events(integer);
DROP FUNCTION IF EXISTS public.admin_notification_template_reset(text, text);
DROP FUNCTION IF EXISTS public.admin_notification_template_set(text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.admin_notification_templates();
DROP FUNCTION IF EXISTS app.notify_from_template(uuid, uuid, text, text, uuid, text, jsonb);
DROP FUNCTION IF EXISTS app.notification_template_events_append_only();
DROP FUNCTION IF EXISTS app.render_template(text, jsonb);
DROP FUNCTION IF EXISTS app.template_variables(text);
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS ck_notifications_content_shape;
ALTER TABLE public.notifications DROP COLUMN IF EXISTS content;
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS ck_notifications_event_type_known;
ALTER TABLE public.notifications ADD CONSTRAINT ck_notifications_event_type_known CHECK ((event_type = ANY (ARRAY['rfq.submitted'::text, 'rfq.cancelled'::text, 'quotation.submitted'::text, 'quotation.accepted'::text, 'quotation.rejected'::text, 'order.created'::text, 'order.started'::text, 'order.completed'::text, 'order.cancelled'::text, 'project.created'::text, 'project.activated'::text, 'project.completed'::text, 'verification.approved'::text, 'verification.rejected'::text, 'verification.changes_requested'::text, 'message.sent'::text, 'job.application.accepted'::text, 'job.application.rejected'::text, 'job.assignment.ready'::text, 'job.assignment.completed'::text, 'job.assignment.cancelled'::text, 'job.review.received'::text, 'whatsapp_otp.audit_unmatched'::text, 'whatsapp_otp.budget_critical'::text, 'whatsapp_otp.budget_exhausted'::text, 'whatsapp_otp.budget_warning'::text, 'whatsapp_otp.failure_rate'::text, 'whatsapp_otp.delivery_unmatched'::text])));

-- 20261121090002 and 20261121090001: upload limits, the video cap and the purge
DROP TRIGGER IF EXISTS media_videos_cap_on_insert ON public.media_videos;
DROP FUNCTION IF EXISTS app.media_videos_enforce_cap();
DROP TABLE IF EXISTS public.media_limit_events CASCADE;
DROP TABLE IF EXISTS public.media_limits CASCADE;
DROP FUNCTION IF EXISTS public.admin_media_limit_events(integer);
DROP FUNCTION IF EXISTS public.admin_media_limit_set(text, text, bigint, text);
DROP FUNCTION IF EXISTS public.media_limits_get();
DROP FUNCTION IF EXISTS app.media_limit_events_append_only();
DROP FUNCTION IF EXISTS app.media_limit_bytes(text, text);
DROP FUNCTION IF EXISTS public.marketplace_rejected_images_purge(interval, integer);

-- the receipt check with its fixed per-place sizes (definition read from Acceptance 2026-11-22; CREATE OR REPLACE keeps its grants)
CREATE OR REPLACE FUNCTION public.media_storage_attest(p_namespace text, p_key text, p_owner uuid, p_provider text, p_size bigint, p_content_type text, p_sha256 text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m jsonb; v_limit bigint; v_existing public.media_storage_locations;
begin
  m := app.media_metadata(p_namespace,p_key);
  v_limit := case p_namespace when 'avatar' then 3145728 when 'portfolio' then 5242880 when 'certificate' then 10485760
    when 'product' then 5242880 when 'organization' then 3145728 when 'request' then 5242880 when 'verification' then 10485760
    when 'marketplace' then 5242880 end;
  if m is null or p_owner is null or p_size is null or p_sha256 is null or p_content_type is null
    or (m->>'owner')::uuid<>p_owner or m->>'state'<>'pending'
    or m->>'contentType'<>p_content_type or p_size<=0 or p_size>v_limit
    or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid verification receipt' using errcode='42501';
  end if;
  select * into v_existing from public.media_storage_locations
    where namespace=p_namespace and object_key=p_key for update;
  if not found or v_existing.provider<>p_provider or v_existing.owner_user_id<>p_owner then
    raise exception 'missing provider reservation' using errcode='42501';
  end if;
  if v_existing.verified_at is not null and
    (v_existing.sha256<>p_sha256 or v_existing.size_bytes<>p_size) then
    raise exception 'immutable receipt conflict' using errcode='42501';
  end if;
  update public.media_storage_locations set size_bytes=p_size,sha256=p_sha256,verified_at=now()
    where namespace=p_namespace and object_key=p_key;
end;
$function$;

-- the three legacy buckets were 5 MiB on Acceptance before 20261121090001 raised them to 10 MiB
UPDATE storage.buckets
   SET file_size_limit = 5242880
 WHERE id IN ('professional-portfolio', 'product-images', 'purchase-request-images')
   AND file_size_limit = 10485760;

commit;
