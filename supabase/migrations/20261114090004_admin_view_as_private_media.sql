-- Admin View-As, stage 4: private media (avatar, portfolio image, certificate) inside a live, audited view session.
--
-- ONE new function and one audit action. The shared media resolvers (media_storage_resolve, media_edge_authorize,
-- organization_media_resolve) are NOT changed: an admin, with or without a view session, still cannot read another user's
-- private media through them, through /api/media or through the edge ticket path. The view has its own door:
--
--   public.admin_view_as_media_open(subject, namespace, media id)
--     1. app.require_view_as: users.view_as, subject eligibility and rank, a view session that is unexpired, not ended and
--        bound to the caller's Auth session (the same predicate every other admin_view_* read runs, re-evaluated per call);
--     2. the media id must be a READY object owned by the SUBJECT in an allow-listed namespace, with a verified R2 location
--        (legacy Supabase-provider objects are not delivered by a view);
--     3. one audit row per (view session, namespace, media id): a page of thumbnails is not an audit flood, and the row never
--        holds the object key;
--     4. returns the physical object key and the verified content type to the SERVER. The browser only ever holds the
--        opaque media id in the view's own URL.
--   Any refusal is the same generic error (no existence oracle). The application re-runs it before and after every delivery,
--   so Exit, expiry, sign-out or a permission change cuts a file in flight.

select app.audit_actions_add(array['admin.view_as.media_read']);

create or replace function public.admin_view_as_media_open(p_subject uuid, p_namespace text, p_media_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := (select auth.uid());
  v_key     text;
  v_loc     public.media_storage_locations;
  v_session uuid;
begin
  perform app.require_view_as(p_subject, 'craftsman');                       -- permission, eligibility, rank, live session
  if p_namespace is null or p_media_id is null then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_namespace = 'portfolio' then
    select i.object_key into v_key from public.portfolio_items i
     where i.id = p_media_id and i.owner_user_id = p_subject and i.state = 'ready';
  elsif p_namespace = 'certificate' then
    select c.object_path into v_key from public.professional_certificates c
     where c.id = p_media_id and c.owner_user_id = p_subject and c.state = 'ready';
  elsif p_namespace = 'avatar' then
    select a.object_key into v_key from public.avatar_uploads a
     where a.id = p_media_id and a.owner_user_id = p_subject and a.state = 'ready';
  end if;
  if v_key is not null then
    select * into v_loc from public.media_storage_locations l
     where l.namespace = p_namespace and l.object_key = v_key and l.owner_user_id = p_subject
       and l.provider = 'r2' and l.verified_at is not null and l.cleaned_at is null;
  end if;
  if v_key is null or v_loc.object_key is null then raise exception 'not permitted' using errcode = '42501'; end if;

  select s.id into v_session from public.admin_view_sessions s
   where s.admin_user_id = v_actor and s.subject_user_id = p_subject and s.account_kind = 'craftsman'
     and s.ended_at is null and s.expires_at > now()
     and s.auth_session_id is not distinct from nullif((select auth.jwt()) ->> 'session_id', '')::uuid;
  if not exists (select 1 from public.audit_log a
                  where a.action = 'admin.view_as.media_read' and a.actor_user_id = v_actor and a.subject_id = p_subject
                    and a.metadata ->> 'session_id' = v_session::text and a.metadata ->> 'namespace' = p_namespace
                    and a.metadata ->> 'media_id' = p_media_id::text) then
    perform app.record_audit_event('admin.view_as.media_read', 'user', p_subject, null, jsonb_build_object(
      'kind', 'craftsman', 'session_id', v_session, 'namespace', p_namespace, 'media_id', p_media_id));   -- never the key
  end if;
  return jsonb_build_object(
    'object', coalesce(v_loc.storage_key, v_loc.namespace || '/' || v_loc.object_key),
    'contentType', v_loc.content_type);
end;
$$;

revoke all on function public.admin_view_as_media_open(uuid, text, uuid) from public, anon, service_role;
grant execute on function public.admin_view_as_media_open(uuid, text, uuid) to authenticated;
comment on function public.admin_view_as_media_open(uuid, text, uuid) is 'View-As private media: authorize (live view session, ready media owned by the subject, verified R2 location), audit once per session and media id, and return the physical object key and content type to the SERVER. The browser only ever holds the opaque media id.';
