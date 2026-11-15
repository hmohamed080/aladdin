-- Admin View-As: private portfolio VIDEO through the view door (forward-only; adds ONE function, changes nothing else).
--
-- Videos are R2 + HLS (ADR-0020): playlists, an init segment, media segments and a poster under video/<id>/<revision>/. The
-- shared video authority (media_edge_video, called by the media Worker with a viewer ticket) is NOT changed and still refuses an
-- admin. The view has its own door, the sibling of admin_view_as_media_open:
--
--   public.admin_view_as_video_open(subject, video id)
--     1. app.require_view_as: users.view_as, subject eligibility and rank, a view session that is unexpired, not ended and bound
--        to the caller's Auth session (re-evaluated on EVERY call; the application calls it once per playlist, segment or range);
--     2. the video must be a READY portfolio video owned by the SUBJECT, delivered by R2 + HLS, with an output revision and not
--        purged (another provider, product videos, uploading/processing/failed/deleted videos are refused);
--     3. one audit row per (view session, 'video', video id) using the existing action admin.view_as.media_read: a player that
--        requests hundreds of segments is not an audit flood, and the row never holds an object key or prefix;
--     4. returns the object prefix, revision, renditions and poster flag to the SERVER only. The browser holds the opaque video id.
--   Any refusal is the same generic error (no existence oracle).

create or replace function public.admin_view_as_video_open(p_subject uuid, p_video_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := (select auth.uid());
  v         public.media_videos;
  v_session uuid;
begin
  perform app.require_view_as(p_subject, 'craftsman');                       -- permission, eligibility, rank, live session
  if p_video_id is null then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into v from public.media_videos m
   where m.id = p_video_id and m.owner_user_id = p_subject and m.scope = 'portfolio'
     and m.state = 'ready' and m.provider = 'r2_hls' and m.revision is not null
     and m.purged_at is null and m.deleted_at is null and cardinality(m.renditions) > 0;
  if not found then raise exception 'not permitted' using errcode = '42501'; end if;

  select s.id into v_session from public.admin_view_sessions s
   where s.admin_user_id = v_actor and s.subject_user_id = p_subject and s.account_kind = 'craftsman'
     and s.ended_at is null and s.expires_at > now()
     and s.auth_session_id is not distinct from nullif((select auth.jwt()) ->> 'session_id', '')::uuid;
  if not exists (select 1 from public.audit_log a
                  where a.action = 'admin.view_as.media_read' and a.actor_user_id = v_actor and a.subject_id = p_subject
                    and a.metadata ->> 'session_id' = v_session::text and a.metadata ->> 'namespace' = 'video'
                    and a.metadata ->> 'media_id' = p_video_id::text) then
    perform app.record_audit_event('admin.view_as.media_read', 'user', p_subject, null, jsonb_build_object(
      'kind', 'craftsman', 'session_id', v_session, 'namespace', 'video', 'media_id', p_video_id));        -- never a key
  end if;
  return jsonb_build_object(
    'prefix', 'video/' || v.id || '/' || v.revision || '/',
    'revision', v.revision,
    'renditions', to_jsonb(v.renditions),
    'poster', v.has_poster);
end;
$$;

revoke all on function public.admin_view_as_video_open(uuid, uuid) from public, anon, service_role;
grant execute on function public.admin_view_as_video_open(uuid, uuid) to authenticated;
comment on function public.admin_view_as_video_open(uuid, uuid) is 'View-As private video: authorize (live view session, ready R2+HLS portfolio video owned by the subject), audit once per session and video id, and return the object prefix, revision, renditions and poster flag to the SERVER. The browser only ever holds the opaque video id. media_edge_video stays owner-only.';
