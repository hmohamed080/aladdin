-- ===========================================================================
-- Admin Core Phase 1B-B (4/4) — organization duplicate detection and
-- link-to-existing (PD-006: detect -> suggest -> link, NO merge), and the
-- human-readable Entity Timeline (docs/admin/ADMIN_USER_ORG_OPERATIONS.md §9–§10).
--
-- Duplicates: users have no authoritative duplicate signal (phone, email and
-- username are unique-constrained), so candidates are organizations only.
-- A candidate is a suggestion; a resolution is an explicit, audited Admin
-- record. Nothing is re-parented, merged, deleted or status-changed.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Normalized organization name (case, whitespace, punctuation folded)
-- ---------------------------------------------------------------------------
create or replace function app.normalize_org_name(p_name text)
returns text
language sql
immutable
as $$
  select nullif(btrim(regexp_replace(lower(coalesce(p_name, '')), '[[:space:][:punct:]،؛«»]+', ' ', 'g')), '')
$$;
revoke execute on function app.normalize_org_name(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Resolutions (append-only)
-- ---------------------------------------------------------------------------
create table public.organization_duplicate_resolutions (
  id                uuid primary key default extensions.gen_random_uuid(),
  duplicate_org_id  uuid not null references public.organizations(id),
  canonical_org_id  uuid not null references public.organizations(id),
  resolution        text not null,
  reason            text not null,
  provenance        jsonb not null,
  resolved_by       uuid not null references public.users(id),
  resolved_at       timestamptz not null default now(),
  constraint ck_org_dup_distinct check (duplicate_org_id <> canonical_org_id),
  constraint ck_org_dup_resolution check (resolution in ('linked', 'not_duplicate')),
  constraint ck_org_dup_reason check (char_length(reason) between 1 and 500)
);
comment on table public.organization_duplicate_resolutions is
  'Admin resolutions of organization duplicate suggestions (PD-006). linked = duplicate_org_id is the same business as canonical_org_id (link-to-existing, no merge); not_duplicate = the suggestion was dismissed. provenance snapshots both organizations (source, referrer, creator, time). Append-only.';
-- One resolution per pair (either direction) and one canonical per duplicate.
create unique index uq_org_dup_pair on public.organization_duplicate_resolutions
  (least(duplicate_org_id, canonical_org_id), greatest(duplicate_org_id, canonical_org_id));
create unique index uq_org_dup_linked_once on public.organization_duplicate_resolutions (duplicate_org_id)
  where resolution = 'linked';
create index ix_org_dup_canonical on public.organization_duplicate_resolutions (canonical_org_id);
alter table public.organization_duplicate_resolutions enable row level security;
revoke all on public.organization_duplicate_resolutions from public, anon, authenticated;

create or replace function app.org_dup_resolutions_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'duplicate resolutions are append-only' using errcode = '42501';
end;
$$;
create trigger trg_org_dup_resolutions_append_only
  before update or delete on public.organization_duplicate_resolutions
  for each row execute function app.org_dup_resolutions_append_only();

create or replace function app.org_provenance(p_org_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id, 'name', o.name, 'org_type', o.org_type, 'status', o.status,
    'source', o.source, 'referred_by_user_id', o.referred_by_user_id,
    'created_by', o.created_by, 'created_at', o.created_at)
  from public.organizations o where o.id = p_org_id;
$$;
revoke execute on function app.org_provenance(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Candidates + current resolutions of one organization
-- ---------------------------------------------------------------------------
create or replace function public.admin_organization_duplicates(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org  public.organizations;
  v_keys text[];
begin
  perform app.admin_require_subject('organization', p_organization_id);
  select * into v_org from public.organizations where id = p_organization_id;
  v_keys := array_remove(array[app.normalize_org_name(v_org.name),
                               app.normalize_org_name(v_org.name_ar),
                               app.normalize_org_name(v_org.name_en)], null);

  return jsonb_build_object(
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', c.id, 'name', c.name, 'name_ar', c.name_ar, 'name_en', c.name_en,
          'org_type', c.org_type, 'status', c.status, 'created_at', c.created_at,
          'signal', c.signal, 'similarity', round(c.sim::numeric, 2))
        order by c.signal_rank, c.sim desc, c.name, c.id)
      from (
        select o.*,
               extensions.similarity(o.name, v_org.name) as sim,
               case when array[app.normalize_org_name(o.name), app.normalize_org_name(o.name_ar),
                               app.normalize_org_name(o.name_en)] && v_keys
                    then 'same_name' else 'similar_name' end as signal,
               case when array[app.normalize_org_name(o.name), app.normalize_org_name(o.name_ar),
                               app.normalize_org_name(o.name_en)] && v_keys
                    then 0 else 1 end as signal_rank
        from public.organizations o
        where o.id <> v_org.id and o.deleted_at is null
          and not exists (
            select 1 from public.organization_duplicate_resolutions r
            where least(r.duplicate_org_id, r.canonical_org_id) = least(o.id, v_org.id)
              and greatest(r.duplicate_org_id, r.canonical_org_id) = greatest(o.id, v_org.id))
          and (array[app.normalize_org_name(o.name), app.normalize_org_name(o.name_ar),
                     app.normalize_org_name(o.name_en)] && v_keys
               or (o.org_type = v_org.org_type and extensions.similarity(o.name, v_org.name) >= 0.6))
        order by signal_rank, sim desc, o.name, o.id
        limit 20
      ) c), '[]'::jsonb),
    'resolutions', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', r.id, 'resolution', r.resolution, 'reason', r.reason, 'resolved_at', r.resolved_at,
          'role', case when r.duplicate_org_id = v_org.id then 'duplicate' else 'canonical' end,
          'other', jsonb_build_object('id', o.id, 'name', o.name, 'name_ar', o.name_ar, 'name_en', o.name_en),
          'resolved_by', jsonb_build_object('user_id', r.resolved_by, 'display_name', coalesce(p.display_name, '')))
        order by r.resolved_at desc, r.id)
      from public.organization_duplicate_resolutions r
      join public.organizations o
        on o.id = case when r.duplicate_org_id = v_org.id then r.canonical_org_id else r.duplicate_org_id end
      left join public.profiles p on p.user_id = r.resolved_by
      where r.duplicate_org_id = v_org.id or r.canonical_org_id = v_org.id), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.admin_organization_duplicates(uuid) from public, anon;
grant execute on function public.admin_organization_duplicates(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Resolve: link-to-existing, or dismiss (duplicates.resolve)
-- ---------------------------------------------------------------------------
create or replace function app.org_dup_resolve(
  p_duplicate uuid, p_canonical uuid, p_resolution text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason   text := app.admin_clean_reason(p_reason);
  v_existing public.organization_duplicate_resolutions;
  v_id       uuid;
begin
  perform app.admin_require_subject('organization', p_duplicate);
  perform app.admin_require_subject('organization', p_canonical);
  perform app.admin_require('duplicates.resolve');
  if p_duplicate = p_canonical then
    raise exception 'an organization cannot be its own duplicate' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  -- Serialize resolutions touching this pair.
  perform pg_advisory_xact_lock(hashtext('aladdin.org_dup.' || least(p_duplicate, p_canonical)::text
                                        || greatest(p_duplicate, p_canonical)::text));

  select * into v_existing from public.organization_duplicate_resolutions r
  where least(r.duplicate_org_id, r.canonical_org_id) = least(p_duplicate, p_canonical)
    and greatest(r.duplicate_org_id, r.canonical_org_id) = greatest(p_duplicate, p_canonical);
  if found then
    if v_existing.resolution = p_resolution
       and (p_resolution = 'not_duplicate'
            or (v_existing.duplicate_org_id = p_duplicate and v_existing.canonical_org_id = p_canonical)) then
      return jsonb_build_object('resolution_id', v_existing.id, 'changed', false);
    end if;
    raise exception 'this pair has already been resolved differently' using errcode = '23505';
  end if;

  if p_resolution = 'linked' then
    if exists (select 1 from public.organization_duplicate_resolutions
               where duplicate_org_id = p_duplicate and resolution = 'linked') then
      raise exception 'this organization is already linked to another existing organization' using errcode = '23505';
    end if;
    -- No chains: the canonical record is not itself a linked duplicate, and a
    -- record that is already someone's canonical is not linked away.
    if exists (select 1 from public.organization_duplicate_resolutions
               where duplicate_org_id = p_canonical and resolution = 'linked') then
      raise exception 'the chosen existing organization is itself linked to another record' using errcode = '22023';
    end if;
    if exists (select 1 from public.organization_duplicate_resolutions
               where canonical_org_id = p_duplicate and resolution = 'linked') then
      raise exception 'this organization is the existing record for other duplicates' using errcode = '22023';
    end if;
  end if;

  insert into public.organization_duplicate_resolutions
    (duplicate_org_id, canonical_org_id, resolution, reason, provenance, resolved_by)
  values (p_duplicate, p_canonical, p_resolution, v_reason,
          jsonb_build_object('duplicate', app.org_provenance(p_duplicate),
                             'canonical', app.org_provenance(p_canonical)),
          (select auth.uid()))
  returning id into v_id;

  perform app.record_audit_event(
    case p_resolution when 'linked' then 'organization.duplicate_linked' else 'organization.duplicate_dismissed' end,
    'organization', p_duplicate, p_duplicate,
    jsonb_build_object('resolution_id', v_id, 'other_organization_id', p_canonical, 'reason', v_reason));
  return jsonb_build_object('resolution_id', v_id, 'changed', true);
end;
$$;
revoke execute on function app.org_dup_resolve(uuid, uuid, text, text) from public, anon, authenticated;

create or replace function public.admin_organization_link_duplicate(
  p_duplicate_org_id uuid, p_canonical_org_id uuid, p_reason text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app.org_dup_resolve(p_duplicate_org_id, p_canonical_org_id, 'linked', p_reason);
$$;
revoke execute on function public.admin_organization_link_duplicate(uuid, uuid, text) from public, anon;
grant execute on function public.admin_organization_link_duplicate(uuid, uuid, text) to authenticated;

create or replace function public.admin_organization_dismiss_duplicate(
  p_organization_id uuid, p_other_org_id uuid, p_reason text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app.org_dup_resolve(p_organization_id, p_other_org_id, 'not_duplicate', p_reason);
$$;
revoke execute on function public.admin_organization_dismiss_duplicate(uuid, uuid, text) from public, anon;
grant execute on function public.admin_organization_dismiss_duplicate(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Entity Timeline — human-readable combined history (never a copy of Audit)
-- ---------------------------------------------------------------------------
create or replace function public.admin_entity_timeline(p_subject_type text, p_subject_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_notes boolean;
  v_fu    boolean;
  v_cases boolean;
  v_user  boolean := p_subject_type = 'user';
begin
  perform app.admin_require_subject(p_subject_type, p_subject_id);
  v_notes := app.has_admin_permission('notes.read');
  v_fu    := app.has_admin_permission('follow_ups.read');
  v_cases := app.has_admin_permission('cases.read');

  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'kind', e.kind, 'at', e.at, 'data', e.data,
        'actor', case when e.actor is null then null else
          jsonb_build_object('user_id', e.actor, 'display_name', coalesce(p.display_name, '')) end)
      order by e.at desc, e.kind)
    from (
      -- registration
      select 'registered' as kind, u.created_at as at, null::uuid as actor, '{}'::jsonb as data
        from public.users u where v_user and u.id = p_subject_id
      union all
      select 'registered', o.created_at, o.created_by, '{}'::jsonb
        from public.organizations o where not v_user and o.id = p_subject_id
      -- verification
      union all
      select 'verification_submitted', v.submitted_at, null, jsonb_build_object('type', v.verification_type)
        from public.verifications v
        where (v_user and v.subject_type = 'user' and v.user_id = p_subject_id)
           or (not v_user and v.subject_type = 'organization' and v.organization_id = p_subject_id)
      union all
      select 'verification_decided', v.decided_at, v.reviewer_id,
             jsonb_build_object('type', v.verification_type, 'status', v.status)
        from public.verifications v
        where v.decided_at is not null
          and ((v_user and v.subject_type = 'user' and v.user_id = p_subject_id)
            or (not v_user and v.subject_type = 'organization' and v.organization_id = p_subject_id))
      -- memberships
      union all
      select 'membership_joined', coalesce(m.accepted_at, m.created_at), null,
             jsonb_build_object('organization_id', o.id, 'organization_name', o.name)
        from public.memberships m join public.organizations o on o.id = m.organization_id
        where v_user and m.user_id = p_subject_id
      union all
      select 'member_joined', coalesce(m.accepted_at, m.created_at), null,
             jsonb_build_object('user_id', m.user_id, 'display_name', coalesce(pr.display_name, ''))
        from public.memberships m left join public.profiles pr on pr.user_id = m.user_id
        where not v_user and m.organization_id = p_subject_id
      -- suspension episodes
      union all
      select 'suspended', s.suspended_at, s.suspended_by, jsonb_build_object('reason', s.reason)
        from public.admin_suspensions s
        where s.subject_type = p_subject_type and (s.user_id = p_subject_id or s.organization_id = p_subject_id)
      union all
      select 'restored', s.restored_at, s.restored_by, jsonb_build_object('reason', s.restore_reason)
        from public.admin_suspensions s
        where s.restored_at is not null and s.subject_type = p_subject_type
          and (s.user_id = p_subject_id or s.organization_id = p_subject_id)
      -- follow-ups (follow_ups.read)
      union all
      select 'follow_up_logged', f.logged_at, f.logged_by, jsonb_build_object('action_type', f.action_type)
        from public.admin_follow_ups f
        where v_fu and f.subject_type = p_subject_type and (f.user_id = p_subject_id or f.organization_id = p_subject_id)
      union all
      select 'follow_up_completed', f.completed_at, f.completed_by, jsonb_build_object('action_type', f.action_type)
        from public.admin_follow_ups f
        where v_fu and f.completed_at is not null and f.subject_type = p_subject_type
          and (f.user_id = p_subject_id or f.organization_id = p_subject_id)
      -- notes (notes.read) — the body is not repeated here
      union all
      select 'note_added', n.created_at, n.author_id, '{}'::jsonb
        from public.admin_notes n
        where v_notes and n.subject_type = p_subject_type and (n.user_id = p_subject_id or n.organization_id = p_subject_id)
      -- cases (cases.read)
      union all
      select 'case_opened', c.created_at, c.created_by, jsonb_build_object('title', c.title)
        from public.admin_cases c
        where v_cases and c.subject_type = p_subject_type and (c.user_id = p_subject_id or c.organization_id = p_subject_id)
      -- duplicate resolutions (organizations)
      union all
      select case r.resolution when 'linked' then 'duplicate_linked' else 'duplicate_dismissed' end,
             r.resolved_at, r.resolved_by,
             jsonb_build_object('role', case when r.duplicate_org_id = p_subject_id then 'duplicate' else 'canonical' end,
                                'other_organization_id', o.id, 'other_organization_name', o.name)
        from public.organization_duplicate_resolutions r
        join public.organizations o
          on o.id = case when r.duplicate_org_id = p_subject_id then r.canonical_org_id else r.duplicate_org_id end
        where not v_user and (r.duplicate_org_id = p_subject_id or r.canonical_org_id = p_subject_id)
    ) e
    left join public.profiles p on p.user_id = e.actor
    where e.at is not null), '[]'::jsonb);
end;
$$;
revoke execute on function public.admin_entity_timeline(text, uuid) from public, anon;
grant execute on function public.admin_entity_timeline(text, uuid) to authenticated;
