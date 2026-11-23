create extension if not exists pgtap;
begin;
select no_plan();
-- Synthetic pre-rollout records only; all changes roll back. Temporarily bypass
-- the new rollout guards while constructing historical products/orders/decisions.
alter table public.products disable trigger showroom_product_publish_complete;
alter table public.quotations disable trigger showroom_quotation_sell_complete;
alter table public.orders disable trigger trg_zz_showroom_order_sell_complete;
do $$
declare i integer; org_id uuid; branch_id uuid; member_id uuid; product_id uuid; rfq_id uuid; quote_id uuid; order_id uuid; verification_id uuid;
begin
 for i in 1..7 loop
  org_id:=('9400000'||i||'-0000-4000-8000-000000000094')::uuid;
  branch_id:=('9410000'||i||'-0000-4000-8000-000000000094')::uuid;
  member_id:=('9420000'||i||'-0000-4000-8000-000000000094')::uuid;
  product_id:=('9430000'||i||'-0000-4000-8000-000000000094')::uuid;
  rfq_id:=('9440000'||i||'-0000-4000-8000-000000000094')::uuid;
  quote_id:=('9450000'||i||'-0000-4000-8000-000000000094')::uuid;
  order_id:=('9460000'||i||'-0000-4000-8000-000000000094')::uuid;
  verification_id:=('9470000'||i||'-0000-4000-8000-000000000094')::uuid;
  insert into public.organizations(id,name,org_type,status,is_verified,created_by)
   values(org_id,'Historical 94 '||i,'showroom_dealer','active',true,'11111111-1111-4111-8111-111111111111');
  insert into public.branches(id,organization_id,name,address_ar)
   values(branch_id,org_id,'Historical branch',case when i in (3,4) then '94 Complete Address Street' else null end);
  insert into public.memberships(id,user_id,organization_id,primary_branch_id,status)
   values(member_id,'11111111-1111-4111-8111-111111111111',org_id,branch_id,'active');
  insert into public.membership_capabilities(membership_id,capability_key) values(member_id,'org.manage');
  insert into app.showroom_legacy_seller_exceptions(organization_id,reason,closed_at)
   values(org_id,'Synthetic historical approval fixture',case when i in (3,4) then now() else null end);
  insert into public.products(id,organization_id,name,category,unit,status,published_at,created_by)
   values(product_id,org_id,'Historical product','finishing','piece','published',now(),'11111111-1111-4111-8111-111111111111');
  insert into app.showroom_legacy_published_products(product_id,organization_id) values(product_id,org_id);
  insert into public.rfqs(id,requester_org_id,supplier_org_id,title,created_by)
   values(rfq_id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',org_id,'Historical RFQ','11111111-1111-4111-8111-111111111111');
  insert into public.quotations(id,rfq_id,supplier_org_id,requester_org_id,status,submitted_at,decided_at,created_by)
   values(quote_id,rfq_id,org_id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','accepted',now(),now(),'11111111-1111-4111-8111-111111111111');
  insert into public.orders(id,quotation_id,rfq_id,requester_org_id,supplier_org_id,title,created_by)
   values(order_id,quote_id,rfq_id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',org_id,'Historical order','11111111-1111-4111-8111-111111111111');
  insert into app.showroom_legacy_orders(order_id,organization_id) values(order_id,org_id);
  if i<>6 then
   insert into public.verifications(id,subject_type,organization_id,verification_type,status,submitted_at,expires_at)
    values(verification_id,'organization',org_id,'organization','submitted',now()-interval '2 days',case when i in (2,4) then now()-interval '1 day' else now()+interval '1 day' end);
   perform set_config('request.jwt.claims','{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}',true);
   perform public.review_start(verification_id);
   perform public.review_approve(verification_id,false);
  end if;
 end loop;
 update public.organizations set is_verified=false where id='94000005-0000-4000-8000-000000000094';
 update public.organizations set status='suspended' where id='94000007-0000-4000-8000-000000000094';
end;
$$;
alter table public.products enable trigger showroom_product_publish_complete;
alter table public.quotations enable trigger showroom_quotation_sell_complete;
alter table public.orders enable trigger trg_zz_showroom_order_sell_complete;

select ok(app.showroom_approval_current('94000001-0000-4000-8000-000000000094'),'active legacy approval still current');
select ok(not app.showroom_approval_current('94000002-0000-4000-8000-000000000094'),'open exception does not override expired approval');
select ok(app.showroom_seller_ready('94000003-0000-4000-8000-000000000094'),'closed exception with address and current approval may sell');
select ok(not app.showroom_seller_ready('94000004-0000-4000-8000-000000000094'),'closed exception does not override expired approval');
select ok(not app.showroom_approval_current('94000005-0000-4000-8000-000000000094'),'verification revocation flag denies historical trust');
select ok(app.showroom_approval_current('94000006-0000-4000-8000-000000000094'),'no-record pre-rollout trust remains compatible with observed staging cohort');
select ok(not app.showroom_approval_current('94000007-0000-4000-8000-000000000094'),'suspension overrides all legacy exceptions');
select ok(app.showroom_listing_visible('94000001-0000-4000-8000-000000000094','94300001-0000-4000-8000-000000000094'),'captured product visible with current approval despite missing address');
select ok(not app.showroom_listing_visible('94000002-0000-4000-8000-000000000094','94300002-0000-4000-8000-000000000094'),'expired approval hides captured product without unpublishing it');
select ok(not app.showroom_listing_visible('94000004-0000-4000-8000-000000000094','94300004-0000-4000-8000-000000000094'),'closed exception cannot restore expired listing visibility');
select ok(not app.showroom_listing_visible('94000005-0000-4000-8000-000000000094','94300005-0000-4000-8000-000000000094'),'revoked approval hides captured product');
select ok(not app.showroom_listing_visible('94000007-0000-4000-8000-000000000094','94300007-0000-4000-8000-000000000094'),'suspended legacy product hidden');
select is((select count(*)::int from public.products where id::text like '9430000%-0000-4000-8000-000000000094' and status='published'),7,'expiry/revocation does not mutate or unpublish products');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select lives_ok($$select public.start_order('94600001-0000-4000-8000-000000000094',1)$$,'captured order continues while approval remains current');
select throws_ok($$select public.start_order('94600002-0000-4000-8000-000000000094',1)$$,'42501',null,'expired approval blocks captured order progress');
select throws_ok($$select public.start_order('94600005-0000-4000-8000-000000000094',1)$$,'42501',null,'revoked approval blocks captured order progress');
select lives_ok($$select public.start_order('94600006-0000-4000-8000-000000000094',1)$$,'historical no-record captured order remains uninterrupted');
select set_config('test.expired_draft',public.create_product('94000004-0000-4000-8000-000000000094','Expired supplier draft','finishing','piece')::text,true);
select throws_ok(format('select public.set_product_published(%L,true,1)',current_setting('test.expired_draft')),'42501',null,'historical cohort cannot publish new products after expiry');
reset role;
select is((select status::text from public.orders where id='94600002-0000-4000-8000-000000000094'),'confirmed','denied expired order remains unchanged');
select * from finish();
rollback;
