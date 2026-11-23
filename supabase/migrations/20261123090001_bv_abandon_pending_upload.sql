-- Business verification: release the slot of an upload that did not finish.
--
-- An upload reserves a `pending` document row (it counts toward the 10-document limit) before the browser sends the bytes.
-- When the browser upload fails, the row used to stay until the next upload request more than one hour later retired it, so
-- an owner could be told "10 documents" while the page showed one. This lets the owner of that draft retire it at once.
-- Only the caller's own, never-confirmed (`pending`), never-submitted draft can be abandoned; ready and submitted evidence is
-- untouched (those go through business_verification_document_remove / are kept as evidence).

create or replace function public.business_verification_document_abandon(p_object_key text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_d public.business_verification_documents;
begin
  perform app.require_verified_caller();
  select * into v_d from public.business_verification_documents
   where object_key = p_object_key and state = 'pending' and submission_id is null
     and created_by = (select auth.uid())
   for update;
  if not found or not app.has_capability(v_d.organization_id, 'org.manage') then
    raise exception 'document not found' using errcode = 'P0002';
  end if;
  update public.business_verification_documents set state = 'deleted' where id = v_d.id;
  return v_d.object_key;
end;
$$;
comment on function public.business_verification_document_abandon(text) is
  'Business verification: the creator of a pending (unconfirmed, unsubmitted) document retires it right away after a failed upload, freeing its slot in the 10-document limit. Returns the object key so the caller can delete a partial object. Ready or submitted documents are never touched.';
revoke all on function public.business_verification_document_abandon(text) from public, anon, service_role;
grant execute on function public.business_verification_document_abandon(text) to authenticated;
