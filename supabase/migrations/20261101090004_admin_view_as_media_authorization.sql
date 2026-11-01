-- Admin View-As, Stage 4: database authority for delivering a viewed craftsman's PRIVATE media to an Admin.
--
-- Follows ADR-0018 exactly: the Cloudflare `media-edge` Worker holds no authorization logic and calls ONE SECURITY DEFINER function per
-- request; the database decides, and every lifecycle change (revocation, rank change, session end, deletion) applies on the next request.
-- This adds a second, separate Worker function next to media_edge_authorize. It does NOT reuse the owner path: the owner path is
-- "the viewer must be the owner" and stays byte-for-byte unchanged (owner-media delivery is untouched).
--
-- Differences from the owner path, all deliberate:
--   * The request names a DATABASE RECORD (portfolio item / certificate / avatar upload id) and a subject, never an object key. The key
--     is looked up here, so no storage key or path ever reaches a ticket or the browser.
--   * The caller is an Admin. Authorization is the View-As gate, evaluated exactly as the readers evaluate it (permission `users.view_as`,
--     rank rules, subject eligibility, a live audited view session BOUND to the Admin's current Supabase Auth session), plus the Auth
--     session itself being valid right now.
--   * The record must be the subject's own and `ready`; the verified, not-cleaned R2 location must be owned by the same subject
--     (authoritative owner link). A record of another account, a pending/deleted record, a Supabase-provider (legacy) row, or a key with no
--     location returns null. There is no fallback to Supabase Storage.
--   * Only media the View-As sections show: portfolio item, certificate, avatar. Products and organization images are not reachable here.
create function public.media_edge_view_as_authorize(p_kind text, p_record uuid, p_variant text,
  p_admin uuid, p_session uuid, p_subject uuid, p_expires_at timestamptz)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub    text := current_setting('request.jwt.claim.sub', true);
  v_role   text := current_setting('request.jwt.claim.role', true);
  v_ns text;
  v_key text;
  v_ok boolean;
begin
  if p_kind is null or p_kind not in ('portfolio_item', 'certificate', 'avatar') or p_record is null
     or p_variant is null or p_variant not in ('original', 'thumb', 'card', 'full')
     or p_admin is null or p_session is null or p_subject is null or p_admin = p_subject
     -- Same ticket-expiry bound as the owner path, independent of the Worker clock: at most 120 s, 5 s skew.
     or p_expires_at is null or p_expires_at < now() - interval '5 seconds'
     or p_expires_at > now() + interval '125 seconds' then
    return null;
  end if;
  if not app.account_is_active(p_admin) then return null; end if;
  -- The Admin's own Auth session must still be valid (sign-out, ban and deletion end it).
  if not exists (select 1 from auth.sessions s join auth.users u on u.id = s.user_id
      where s.id = p_session and s.user_id = p_admin and (s.not_after is null or s.not_after > now())
        and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())) then
    return null;
  end if;

  -- The View-As gate, as the Admin, bound to this login session. Claims are restored before any return.
  perform set_config('request.jwt.claim.sub', p_admin::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_admin, 'role', 'authenticated', 'session_id', p_session)::text, true);
  v_ok := app.view_as_active(p_subject, 'craftsman');
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(v_role, ''), true);
  if not coalesce(v_ok, false) then return null; end if;

  -- The record must be the subject's own, ready record; its key is resolved here and never leaves the database.
  if p_kind = 'portfolio_item' then
    select 'portfolio', i.object_key into v_ns, v_key
      from public.portfolio_items i where i.id = p_record and i.owner_user_id = p_subject and i.state = 'ready';
  elsif p_kind = 'certificate' then
    select 'certificate', c.object_path into v_ns, v_key
      from public.professional_certificates c where c.id = p_record and c.owner_user_id = p_subject and c.state = 'ready';
  else
    select 'avatar', a.object_key into v_ns, v_key
      from public.avatar_uploads a where a.id = p_record and a.owner_user_id = p_subject and a.state = 'ready';
  end if;
  if v_key is null then return null; end if;

  -- Authoritative storage link: the verified, not-cleaned R2 location owned by the SAME subject. No provider other than r2.
  if not exists (select 1 from public.media_storage_locations l
      where l.namespace = v_ns and l.object_key = v_key and l.owner_user_id = p_subject and l.provider = 'r2') then
    return null;
  end if;
  return app.media_edge_grant(v_ns, v_key, p_variant);
end;
$$;

comment on function public.media_edge_view_as_authorize(text, uuid, text, uuid, uuid, uuid, timestamptz) is
  'Worker-only. Admin View-As private media: re-validates users.view_as, the live view session bound to the Admin''s Auth session, subject eligibility and the record-to-owner link on every request. Returns the R2 grant or null; never a key to the browser.';

revoke all on function public.media_edge_view_as_authorize(text, uuid, text, uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.media_edge_view_as_authorize(text, uuid, text, uuid, uuid, uuid, timestamptz) to media_edge;
