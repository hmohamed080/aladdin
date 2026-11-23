-- Forward-fix "mkt-seller-approval-v2": remove everything 20261123090001 (Marketplace seller approval v2, PR #239) added and restore what it changed.
-- NOT a down migration and NOT applied anywhere. Use only with the owner's explicit approval, on a hosted database, through the Supabase migration path
-- as a NEW migration (never the SQL Editor). Undo order of plan prod-catchup: THIS file first, then media-notify-remove.sql, marketplace-remove.sql, prod-catchup-restore-previous.sql.
-- 20261123090001 changes only objects created inside the catch-up plan (Marketplace seller tables and functions). It REPLACES no existing function: every function it creates is a new
-- overload (5-argument seller transitions, 7-argument app.marketplace_seller_transition, 9-argument app.notify_from_template, *_v2 reads, preset RPCs), so the previous
-- definitions are still present and nothing has to be re-created. Removes: 2 tables (presets and preset events), 12 functions, 4 columns of marketplace_seller_accounts, 3 columns of
-- marketplace_seller_account_events and 9 constraints; restores 3 constraints, the NOT NULL on events.reason and the column comment of status.
-- DATA GUARD: refuses (RAISE) when a seller was rejected, an owner message or preset was stored, a preset was edited or a reason-less event exists. It never deletes user data.
-- Proven on a scratch database: after the 27 migrations + 20261123090001 + this file the catalog fingerprint equals the one after the 27 migrations.
begin;

do $guard$
declare n bigint;
begin
  if to_regclass('public.marketplace_seller_preset_events') is not null then
    execute 'select count(*) from public.marketplace_seller_preset_events' into n;
    if n <> 0 then raise exception 'mkt-seller-approval-v2 forward-fix refused: marketplace_seller_preset_events holds % rows (a preset was edited)', n; end if;
  end if;
  if to_regclass('public.marketplace_seller_message_presets') is not null then
    execute 'select count(*) from public.marketplace_seller_message_presets' into n;
    if n <> 10 then raise exception 'mkt-seller-approval-v2 forward-fix refused: marketplace_seller_message_presets holds % rows (migration seed: 10)', n; end if;
    if exists (select 1 from public.marketplace_seller_message_presets where updated_by is not null) then
      raise exception 'mkt-seller-approval-v2 forward-fix refused: a preset was changed';
    end if;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'marketplace_seller_accounts' and column_name = 'owner_message_ar') then
    execute 'select count(*) from public.marketplace_seller_accounts where status = ''rejected'' or owner_message_ar is not null or owner_message_en is not null or rejected_at is not null' into n;
    if n <> 0 then raise exception 'mkt-seller-approval-v2 forward-fix refused: % seller account(s) hold a rejection or an owner message', n; end if;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'marketplace_seller_account_events' and column_name = 'owner_message_ar') then
    execute 'select count(*) from public.marketplace_seller_account_events where action = ''rejected'' or reason is null or owner_message_ar is not null or owner_message_en is not null or preset_id is not null' into n;
    if n <> 0 then raise exception 'mkt-seller-approval-v2 forward-fix refused: % seller event(s) use the v2 shape', n; end if;
  end if;
end
$guard$;

DROP FUNCTION IF EXISTS public.admin_marketplace_seller_approve(uuid, text, uuid, text, text);
DROP FUNCTION IF EXISTS public.admin_marketplace_seller_reject(uuid, text, uuid, text, text);
DROP FUNCTION IF EXISTS public.admin_marketplace_seller_suspend(uuid, text, uuid, text, text);
DROP FUNCTION IF EXISTS public.admin_marketplace_seller_revoke(uuid, text, uuid, text, text);
DROP FUNCTION IF EXISTS public.admin_marketplace_seller_reinstate(uuid, text, uuid, text, text);
DROP FUNCTION IF EXISTS public.marketplace_seller_request_approval(uuid);
DROP FUNCTION IF EXISTS public.admin_marketplace_seller_presets();
DROP FUNCTION IF EXISTS public.admin_marketplace_seller_preset_save(uuid, text, text, text, text, text, boolean, integer, text);
DROP FUNCTION IF EXISTS public.admin_marketplace_seller_overview_v2();
DROP FUNCTION IF EXISTS public.admin_marketplace_seller_history_v2(uuid);
DROP FUNCTION IF EXISTS app.marketplace_seller_transition(uuid, text, text, uuid, uuid, text, text);
DROP FUNCTION IF EXISTS app.notify_from_template(uuid, uuid, text, text, uuid, text, jsonb, jsonb, jsonb);

DROP TABLE IF EXISTS public.marketplace_seller_preset_events CASCADE;
DROP TABLE IF EXISTS public.marketplace_seller_message_presets CASCADE;

ALTER TABLE public.marketplace_seller_account_events DROP CONSTRAINT IF EXISTS ck_marketplace_seller_events_owner_message;
ALTER TABLE public.marketplace_seller_account_events DROP CONSTRAINT IF EXISTS ck_marketplace_seller_events_reason_required;
ALTER TABLE public.marketplace_seller_account_events DROP CONSTRAINT IF EXISTS ck_marketplace_seller_events_reason;
ALTER TABLE public.marketplace_seller_account_events DROP CONSTRAINT IF EXISTS ck_marketplace_seller_events_action;
ALTER TABLE public.marketplace_seller_account_events DROP COLUMN IF EXISTS owner_message_ar, DROP COLUMN IF EXISTS owner_message_en, DROP COLUMN IF EXISTS preset_id;
ALTER TABLE public.marketplace_seller_account_events ALTER COLUMN reason SET NOT NULL;
ALTER TABLE public.marketplace_seller_account_events ADD CONSTRAINT ck_marketplace_seller_events_action CHECK ((action = ANY (ARRAY['requested'::text, 'approved'::text, 'suspended'::text, 'revoked'::text, 'reinstated'::text])));
ALTER TABLE public.marketplace_seller_account_events ADD CONSTRAINT ck_marketplace_seller_events_reason CHECK (((char_length(btrim(reason)) >= 3) AND (char_length(btrim(reason)) <= 500)));

ALTER TABLE public.marketplace_seller_accounts DROP CONSTRAINT IF EXISTS ck_marketplace_sellers_owner_message;
ALTER TABLE public.marketplace_seller_accounts DROP CONSTRAINT IF EXISTS ck_marketplace_sellers_status;
ALTER TABLE public.marketplace_seller_accounts DROP COLUMN IF EXISTS owner_message_ar, DROP COLUMN IF EXISTS owner_message_en, DROP COLUMN IF EXISTS rejected_at, DROP COLUMN IF EXISTS rejected_by;
ALTER TABLE public.marketplace_seller_accounts ADD CONSTRAINT ck_marketplace_sellers_status CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'suspended'::text, 'revoked'::text])));
COMMENT ON COLUMN public.marketplace_seller_accounts.status IS 'pending | approved | suspended | revoked. revoked is terminal in V1.';
COMMENT ON COLUMN public.marketplace_seller_accounts.status_reason IS NULL;

commit;
