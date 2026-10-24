begin transaction read only;
\set org '2d3b6ab7-d5ee-4e7a-80a7-436d0b032b33'
select 'products', count(*) from marketplace_products where seller_organization_id=:'org'
union all select 'status:'||status, count(*) from marketplace_products where seller_organization_id=:'org' group by status
union all select 'variants', count(*) from marketplace_product_variants v join marketplace_products p on p.id=v.product_id where p.seller_organization_id=:'org'
union all select 'variants_active', count(*) from marketplace_product_variants v join marketplace_products p on p.id=v.product_id where p.seller_organization_id=:'org' and v.status='active'
union all select 'images', count(*) from marketplace_product_images i join marketplace_products p on p.id=i.product_id where p.seller_organization_id=:'org'
union all select 'images:'||i.status, count(*) from marketplace_product_images i join marketplace_products p on p.id=i.product_id where p.seller_organization_id=:'org' group by i.status
union all select 'products_with_images', count(distinct i.product_id) from marketplace_product_images i join marketplace_products p on p.id=i.product_id where p.seller_organization_id=:'org'
union all select 'products_without_type', count(*) from marketplace_products where seller_organization_id=:'org' and product_type_id is null;
select 'blocked_draft_or_unpub', count(*) from marketplace_products p where seller_organization_id=:'org' and status in ('draft','unpublished') and cardinality(app.marketplace_publication_blockers(p.id))>0;
select 'ready_unpublished', count(*) from marketplace_products p where seller_organization_id=:'org' and status in ('draft','unpublished') and cardinality(app.marketplace_publication_blockers(p.id))=0;
select split_part(b,':',1) || case when b like 'missing_%' then ':'||split_part(b,':',array_length(string_to_array(b,':'),1)) else '' end as reason, count(*) from marketplace_products p, unnest(app.marketplace_publication_blockers(p.id)) b where seller_organization_id=:'org' and status in ('draft','unpublished') group by 1 order by 2 desc;
rollback;
