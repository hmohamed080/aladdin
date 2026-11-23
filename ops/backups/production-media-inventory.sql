-- Read-only, one statement/snapshot. Exhaustive union includes canonical rows,
-- provider locations and Storage objects; no timestamp filter drops old orphans.
with canonical as (
 select 'avatar' namespace, 'avatars' bucket, object_key key, state::text, owner_user_id owner, false protected from public.avatar_uploads
 union all select 'portfolio','professional-portfolio',object_key,state::text,owner_user_id,false from public.portfolio_items
 union all select 'certificate','professional-certificates',object_path,state::text,owner_user_id,false from public.professional_certificates
 union all select 'product','product-images',object_key,state::text,created_by,false from public.product_images
 union all select 'organization','organization-images',object_key,state::text,created_by,false from public.organization_images
 union all select 'request','purchase-request-images',object_key,state::text,created_by,false from public.purchase_request_images
 union all select 'verification','business-verification-documents',object_key,state::text,created_by,submission_id is not null from public.business_verification_documents
), buckets(namespace,bucket) as (values
 ('avatar','avatars'),('portfolio','professional-portfolio'),('certificate','professional-certificates'),
 ('product','product-images'),('organization','organization-images'),('request','purchase-request-images'),('verification','business-verification-documents')
), keys as (
 select namespace,bucket,key from canonical
 union select l.namespace,b.bucket,l.object_key from public.media_storage_locations l left join buckets b using(namespace)
 union select coalesce(b.namespace,'unmapped'),o.bucket_id,o.name from storage.objects o left join buckets b on b.bucket=o.bucket_id
), inventory as (
 select k.namespace,k.bucket,md5(k.key) key_fingerprint,
   o.id storage_id,o.updated_at,coalesce((o.metadata->>'size')::bigint,0) size_bytes,
   l.provider,l.cleaned_at, l.sha256,
   (select count(*) from canonical c where c.namespace=k.namespace and c.key=k.key) canonical_count,
   exists(select 1 from canonical c where c.namespace=k.namespace and c.key=k.key and c.owner is distinct from l.owner_user_id) ownership_conflict,
   exists(select 1 from canonical c where c.namespace=k.namespace and c.key=k.key and c.protected) protected,
   case
     when not exists(select 1 from canonical c where c.namespace=k.namespace and c.key=k.key) then 'orphaned'
     when exists(select 1 from canonical c where c.namespace=k.namespace and c.key=k.key and c.state='ready') then
       case when coalesce(l.provider,'supabase')='supabase' and o.id is null then 'missing' else 'active' end
     when not exists(select 1 from canonical c where c.namespace=k.namespace and c.key=k.key and c.state<>'deleted') then 'deleted'
     else 'pending'
   end classification
 from keys k
 left join storage.objects o on o.bucket_id=k.bucket and o.name=k.key
 left join public.media_storage_locations l on l.namespace=k.namespace and l.object_key=k.key
)
select jsonb_build_object('captured_at',statement_timestamp(),'scope','all rows in one read-only statement',
 'summary',(select jsonb_agg(s) from (select namespace,classification,count(*) records,
    count(storage_id) storage_objects,sum(size_bytes) metadata_bytes,count(*) filter(where protected) protected,
    count(*) filter(where ownership_conflict and provider is not null) ownership_conflicts
    from inventory group by namespace,classification order by namespace,classification) s),
 'rows',(select jsonb_agg(i order by namespace,key_fingerprint) from inventory i)) as inventory;

