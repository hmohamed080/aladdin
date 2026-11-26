-- ===========================================================================
-- Marketplace - Migration 20261126100001: show the "not returnable" flag, and let a buyer remove a return photo
-- ===========================================================================
-- WHY
--   * PR 15 stores `marketplace_products.non_returnable` and a seller RPC sets it, but neither the seller's product read nor
--     the public product read returned it, so no screen could show or change it before checkout.
--   * A confirmed photo waiting for a return request could not be deleted: six wrong photos blocked new uploads until the
--     24 hour cleanup.
-- WHAT THIS DOES
--   * adds the key `non_returnable` to public.marketplace_seller_product_get and public.marketplace_public_product (their
--     installed bodies are patched; nothing else in them changes);
--   * public.marketplace_buyer_return_evidence_remove(evidence): the uploader marks a photo that no request holds as
--     `deleting`. The central media cleanup removes the bytes (the state app.marketplace_media_cleanup_rows already lists).
-- NOTHING IS DROPPED. EXPAND only. SECURITY DEFINER, search_path = '', no table grant.
-- ===========================================================================

do $do$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in
    select * from (values
      ('public.marketplace_seller_product_get(uuid)',
       '''brand'', p.brand, ''external_ref'', p.external_ref,',
       '''brand'', p.brand, ''non_returnable'', p.non_returnable, ''external_ref'', p.external_ref,'),
      ('public.marketplace_public_product(text)',
       '''ships_free'', app.marketplace_product_ships_free(v_p.id),',
       '''ships_free'', app.marketplace_product_ships_free(v_p.id),' || chr(10) || '    ''non_returnable'', v_p.non_returnable,')
    ) as x(fn, anchor, replacement)
  loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    v_new := replace(v_def, r.anchor, r.replacement);
    if v_new = v_def then
      raise exception 'patch anchor not found in %', r.fn;
    end if;
    execute v_new;
  end loop;
end;
$do$;

create or replace function public.marketplace_buyer_return_evidence_remove(p_evidence_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  e public.marketplace_return_evidence;
begin
  if v_uid is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  select * into e from public.marketplace_return_evidence where id = p_evidence_id and created_by = v_uid for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  -- a photo a request already holds is part of its record
  if e.return_id is not null then
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;
  update public.marketplace_return_evidence set upload_state = 'deleting' where id = e.id and upload_state <> 'deleting';
  return jsonb_build_object('evidence_id', e.id, 'object_key', e.object_key);
end;
$$;
revoke all on function public.marketplace_buyer_return_evidence_remove(uuid) from public, anon, authenticated, service_role;
grant execute on function public.marketplace_buyer_return_evidence_remove(uuid) to authenticated;
