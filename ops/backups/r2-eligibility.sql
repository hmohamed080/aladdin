-- Which R2-hosted originals a media backup MUST hold. ONE rule, read by r2-media-backup.sh (live database) and
-- media-verify.sh (restored database); snapshot-objects.py implements the same rule over the dump, and
-- r2-eligibility-test.sh proves the three agree on the same data. Read-only; a single statement, so one snapshot.
--
-- Output, one row per verified, not-cleaned R2 location (tab separated):  sha256, size_bytes, physical key, class
--   class = required            the original must be backed up (the default for anything not provably retired)
--   class = retired:<namespace> the original was removed on purpose: nothing else needs it
-- A location is RETIRED only when ALL of these hold; any doubt leaves it REQUIRED (fail closed):
--   1. exactly one canonical row exists for (namespace, object_key) in that namespace's table, and its state is 'deleted'
--      (a missing, duplicate, pending, ready or unknown row is never retired; cleaned_at being NULL proves nothing);
--   2. that row's owner (owner_user_id / created_by) equals the location's owner_user_id, both non-null;
--   3. no OTHER canonical row, in any namespace, uses the same object_key;
--   4. no other media_storage_locations row (any provider, cleaned or not) resolves to the same physical key;
--   5. nothing active points at it: profiles.avatar_media_id / cover_media_id for an avatar upload,
--      organizations.logo_media_id for an organization image.
-- (to_jsonb: storage_key exists only after migration 20261029120001; cover_media_id after 20261024090009.)
with canon as (
  select 'avatar'::text ns, object_key k, state::text st, owner_user_id owner, id from public.avatar_uploads
  union all select 'portfolio', object_key, state::text, owner_user_id, id from public.portfolio_items
  union all select 'certificate', object_path, state::text, owner_user_id, id from public.professional_certificates
  union all select 'product', object_key, state::text, created_by, id from public.product_images
  union all select 'organization', object_key, state::text, created_by, id from public.organization_images
), canon_n as (
  select ns, k, count(*) n, count(*) filter (where st = 'deleted') n_deleted, min(owner::text) owner_min, max(owner::text) owner_max,
         bool_or(owner is null) owner_null
  from canon group by ns, k
), key_ns as (
  select k, count(distinct ns) namespaces from canon group by k
), phys as (
  select coalesce(to_jsonb(l)->>'storage_key', l.namespace || '/' || l.object_key) p, count(*) n
  from public.media_storage_locations l group by 1
), pointed as (
  select au.object_key k from public.avatar_uploads au
   where exists (select 1 from public.profiles p
                  where to_jsonb(p)->>'avatar_media_id' = au.id::text or to_jsonb(p)->>'cover_media_id' = au.id::text)
  union all
  select oi.object_key from public.organization_images oi
   where exists (select 1 from public.organizations o where to_jsonb(o)->>'logo_media_id' = oi.id::text)
), pointed_n as (select k, count(*) n from pointed group by k)
select l.sha256, l.size_bytes, ph.p as phys,
  case when c.n = 1 and c.n_deleted = 1 and not c.owner_null and c.owner_min = c.owner_max and l.owner_user_id is not null
            and c.owner_min = l.owner_user_id::text
            and coalesce(kn.namespaces, 0) = 1
            and ph.n = 1
            and not (l.namespace in ('avatar', 'organization') and coalesce(pt.n, 0) > 0)
       then 'retired:' || l.namespace else 'required' end as class
from public.media_storage_locations l
cross join lateral (select coalesce(to_jsonb(l)->>'storage_key', l.namespace || '/' || l.object_key) p) lp
join phys ph on ph.p = lp.p
left join canon_n c on c.ns = l.namespace and c.k = l.object_key
left join key_ns kn on kn.k = l.object_key
left join pointed_n pt on pt.k = l.object_key
where l.provider = 'r2' and l.cleaned_at is null and l.verified_at is not null
order by l.created_at, l.namespace, l.object_key;
