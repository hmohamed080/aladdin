-- ===========================================================================
-- Marketplace PR 15 - Migration 150003: the order document, order actions (contract 4.1, 3.3, 4.6)
-- ===========================================================================
-- WHAT THIS DOES
--   * Fills the order document keys `return_window` and `returns` (reserved by PR 12, "keys are never removed or renamed").
--   * Adds the buyer actions `request_return` / `request_exchange` to the order actions through PR 12's hook
--     app.marketplace_order_extra_actions.
-- HOW (merge-order safe): PR 13 rebuilds app.marketplace_order_document_v2 (adds `invoice`) and PR 14 replaces the hook body
-- (adds `file_complaint`). This migration runs after both of them, so it must not copy an older body. It reads the body that is
-- installed at apply time:
--   * the document: only the two reserved literals are replaced; the migration fails loudly if either is not found;
--   * the hook: the installed body is kept as app.marketplace_order_extra_actions_base and the new body is base || ours.
-- Nothing is dropped. SECURITY: internal functions, no client grant.
-- ===========================================================================

do $do$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('app.marketplace_order_document_v2(uuid, text)'::regprocedure);
  v_new := replace(v_def, '''return_window'', null', '''return_window'', app.marketplace_order_return_window(o.id)');
  v_new := replace(v_new, '''returns'', ''[]''::jsonb', '''returns'', app.marketplace_order_returns_json(o.id, p_for)');
  if v_new = v_def or v_new not like '%marketplace_order_return_window(o.id)%' or v_new not like '%marketplace_order_returns_json(o.id, p_for)%' then
    raise exception 'order document patch failed: the reserved return_window / returns keys were not found';
  end if;
  execute v_new;

  v_def := pg_get_functiondef('app.marketplace_order_extra_actions(uuid, text)'::regprocedure);
  v_new := replace(v_def, 'app.marketplace_order_extra_actions(', 'app.marketplace_order_extra_actions_base(');
  if v_new = v_def then
    raise exception 'extra actions hook not found';
  end if;
  execute v_new;
end;
$do$;

create or replace function app.marketplace_order_extra_actions(p_order uuid, p_for text)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out text[] := app.marketplace_order_extra_actions_base(p_order, p_for);
begin
  if p_for = 'buyer' and app.marketplace_return_can_start(p_order) then
    v_out := v_out || array['request_return', 'request_exchange'];
  end if;
  return v_out;
end;
$$;

revoke all on function app.marketplace_order_extra_actions_base(uuid, text), app.marketplace_order_extra_actions(uuid, text),
  app.marketplace_order_document_v2(uuid, text) from public, anon, authenticated, service_role;
