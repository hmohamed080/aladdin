-- ===========================================================================
-- Migration 20261126090001: an independent publisher can publish (owner decision 2026-11-26)
-- ===========================================================================
-- WHY
--   Trigger `showroom_product_publish_complete` (20261014160000) asks `app.showroom_seller_ready(new.organization_id)` for
--   every product that becomes `published`. An independent publisher's product has no organization (20261015090038), the
--   question answers false for NULL, and so such a product could never be published. The same release family already
--   skips that case in `public.set_product_published` and in the catalog reads (20261015090053); the trigger was missed.
-- WHAT THIS DOES
--   The trigger asks for showroom readiness only when the product belongs to an organization. Organization products are
--   refused exactly as before. `organization_id` cannot be omitted to get around it: `products_enforce_publisher` (which
--   fires first, by trigger name) fills it in for an organization publisher, refuses one for an independent publisher, and
--   forbids changing the owner afterwards. An independent publisher's authority stays enforced by the publisher rules.
-- NOTHING IS DROPPED. Same signature, same grants (none), SECURITY DEFINER, search_path = ''.
-- ===========================================================================

create or replace function app.showroom_publish_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and new.organization_id is not null
     and not app.showroom_seller_ready(new.organization_id) then
    raise exception 'showroom must be active, approved and complete before product publishing' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.showroom_publish_guard() from public, anon, authenticated, service_role;
