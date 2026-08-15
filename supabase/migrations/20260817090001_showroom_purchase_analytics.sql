-- =============================================================================
-- Migration: purchase analytics projection for the Showroom Reports surface.
--
-- WHY A VIEW AND NOT A CLIENT-SIDE JOIN
-- Reports needs to answer "where does my money go, by product category". The
-- money lives on order lines; the category lives on the product. Nothing joins
-- the two directly, because an order line is a frozen SNAPSHOT (name/unit/price)
-- and deliberately carries no product_id — an order must not change meaning when
-- a supplier later renames or deletes a catalog item.
--
-- The link that does exist is the chain the order came from:
--   order -> quotation_items -> rfq_items.product_id -> products.category
-- Walking that chain from the app would mean either a deep PostgREST embedding
-- on every Reports render, or four round trips and a join in JavaScript. Both
-- put a schema traversal in the UI layer. One view states the relationship once,
-- in the place that owns it.
--
-- SECURITY
-- `security_invoker = true`, so every base relation applies its own RLS to the
-- caller: an organization sees the spend lines of orders it can already open, and
-- nothing else. Products are joined through the existing published-products
-- policy, so no private catalog row is reachable through this projection either.
-- Forward-only and purely additive — no table, column, or enum changes.
-- =============================================================================

create view public.order_category_spend with (security_invoker = true) as
  select
    o.id                  as order_id,
    o.requester_org_id,
    o.supplier_org_id,
    o.requester_branch_id,
    o.status,
    o.confirmed_at,
    -- A line whose product was removed from the catalog still spent money; it
    -- reports as 'other' rather than vanishing from the total.
    coalesce(p.category, 'other'::public.product_category) as category,
    qi.line_total         as amount
  from public.orders o
  join public.quotation_items qi on qi.quotation_id = o.quotation_id
  left join public.rfq_items ri  on ri.id = qi.rfq_item_id
  left join public.products p    on p.id = ri.product_id;

comment on view public.order_category_spend is
  'Order value split across the sector taxonomy, resolved through the quotation lines the order was created from. security_invoker=true: orders/quotations/products RLS scope the rows, so a caller sees only the spend of orders it can already open. Read-only analytics projection for Reports; never a write path.';

revoke all on public.order_category_spend from anon, authenticated, service_role;
grant select on public.order_category_spend to authenticated;

-- =============================================================================
-- Two additive columns on the existing list projections.
--
-- `order_list` gains the requester's branch so Reports can answer "this branch's
-- purchasing" — without it a branch filter could narrow requests but not the
-- orders they became, which would show a filtered page whose numbers disagree
-- with each other.
--
-- `project_list` gains the branch and the ORDER VALUE. A delivery project's
-- value is not a field anyone types; it is the value of the order that created
-- the project, and reading it here means the Projects table shows what the work
-- is worth without a second query per row.
--
-- Both are `create or replace view` with the columns APPENDED, so every existing
-- consumer's column set is untouched.
-- =============================================================================
create or replace view public.order_list with (security_invoker = true) as
  select
    o.id, o.quotation_id, o.rfq_id, o.requester_org_id, o.supplier_org_id,
    o.title, o.status, o.total, o.confirmed_at, o.started_at, o.completed_at,
    o.created_at, o.updated_at, o.version,
    app.org_display_name(o.requester_org_id) as requester_name,
    app.org_display_name(o.supplier_org_id)  as supplier_name,
    (select count(*) from public.order_items oi where oi.order_id = o.id) as item_count,
    exists (select 1 from public.projects p where p.order_id = o.id)       as has_project,
    o.requester_branch_id
  from public.orders o;
comment on view public.order_list is 'Order list projection (RLS-scoped) with party names, item counts, whether a project exists, and the requester-side branch for branch-scoped reporting.';

create or replace view public.project_list with (security_invoker = true) as
  select
    p.id, p.order_id, p.requester_org_id, p.executing_org_id, p.title,
    p.status, p.location, p.start_date, p.target_date, p.activated_at, p.completed_at,
    p.created_at, p.updated_at, p.version,
    app.org_display_name(p.requester_org_id) as requester_name,
    app.org_display_name(p.executing_org_id) as executing_name,
    p.branch_id,
    -- The order this project delivers. Scoped by the same RLS as the project
    -- itself: a project is only visible to a party of its order.
    (select o.total from public.orders o where o.id = p.order_id) as order_total
  from public.projects p;
comment on view public.project_list is 'Project list projection (RLS-scoped) with party names, the requester-side branch, and the value of the order the project delivers.';

grant select on public.order_list   to authenticated;
grant select on public.project_list to authenticated;
