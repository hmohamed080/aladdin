-- ===========================================================================
-- Database - Migration 20261126120002: pin search_path on the last nine functions that had none
-- ===========================================================================
-- WHY
--   Supabase advisor `function_search_path_mutable`: a function without a pinned search_path resolves names with the
--   caller's setting. These nine are SECURITY INVOKER helpers in the `app` schema; every other application function
--   already pins it.
-- WHAT THIS DOES
--   `set search_path = ''` on each. Their bodies name only pg_catalog built-ins and schema-qualified objects, so nothing
--   they do changes. Only function settings change: no body, grant, table or row. A SQL function with a setting is no
--   longer inlined; these classify one row at a time on admin lists and location writes.
-- pgTAP 420 refuses any later function without a pinned search_path.
-- ===========================================================================

alter function app.admin_follow_up_status(timestamp with time zone, timestamp with time zone) set search_path = '';
alter function app.admin_org_status_tab(public.org_status) set search_path = '';
alter function app.admin_user_status_tab(public.user_status, public.verification_status) set search_path = '';
alter function app.admin_user_verification_state(boolean, public.verification_status) set search_path = '';
alter function app.normalize_org_name(text) set search_path = '';
alter function app.resolve_city(text, text) set search_path = '';
alter function app.resolve_governorate(text) set search_path = '';
alter function app.set_updated_at() set search_path = '';
alter function app.user_facing_email(text) set search_path = '';
