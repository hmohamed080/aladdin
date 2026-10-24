-- Session revocation beyond the Data API: Supabase Storage and Realtime.
--
-- 20261019140000 made PostgREST refuse a signed-out, banned or deleted session on its
-- next request, through the db_pre_request hook. That hook runs only in PostgREST.
-- Two other Supabase services accept the same access token and evaluate RLS as
-- `authenticated` without it, so an ended session kept working there until the JWT
-- expired (jwt_expiry 3600 s):
--
--   * Storage API (/storage/v1): reads, signed-URL minting, uploads and deletes on
--     storage.objects are decided by the bucket policies alone. Business-verification
--     documents and purchase-request images are read, signed, uploaded and removed
--     with the caller's token directly (browser uploads, the BV file route).
--   * Realtime postgres_changes: each change on a published table (public.leads,
--     public.follow_up_tasks) is delivered to a subscriber after a SELECT under the
--     subscriber's stored claims (realtime.apply_rls). Realtime itself only checks
--     the signature and `exp`.
--
-- Fix: one RESTRICTIVE policy per surface that ANDs `app.jwt_session_is_live()` into
-- every existing policy. Restrictive, so no current or future permissive policy can
-- reopen access for an ended session. Wrapped in a scalar subquery so it is an
-- InitPlan: evaluated once per statement (one primary-key lookup on auth.sessions
-- joined to auth.users), not once per row. A token without a `session_id` claim, anon
-- and service_role are unaffected, exactly as in the hook.
--
-- Policies are evaluated as the calling role, so `authenticated` needs EXECUTE on the
-- helper. It only answers whether the caller's own token session is live, which
-- `my_account_status` already returns to the same caller; the `app` schema is not
-- exposed through the Data API.
--
-- A new table added to the supabase_realtime publication needs the same restrictive
-- policy (pgTAP 103 fails otherwise).
--
-- Rollback: drop the three policies, then
-- `revoke execute on function app.jwt_session_is_live() from authenticated`.

grant execute on function app.jwt_session_is_live() to authenticated;

create policy storage_objects_session_live on storage.objects
  as restrictive for all to authenticated
  using ((select app.jwt_session_is_live()))
  with check ((select app.jwt_session_is_live()));

create policy leads_session_live on public.leads
  as restrictive for select to authenticated
  using ((select app.jwt_session_is_live()));

create policy follow_up_tasks_session_live on public.follow_up_tasks
  as restrictive for select to authenticated
  using ((select app.jwt_session_is_live()));
