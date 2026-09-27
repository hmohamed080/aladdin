-- pgTAP: app.mask_email never renders the temporary craftsman flow's internal
-- login alias (20260927090001), and is otherwise unchanged.
create extension if not exists pgtap;

begin;
select plan(5);

select is(app.mask_email('p201012345678@craftsman-login.aladdin.invalid'), '•••',
  'the internal craftsman login alias masks to the no-email placeholder');
select is(app.mask_email('P201012345678@CRAFTSMAN-LOGIN.ALADDIN.INVALID'), '•••',
  'alias detection is case-insensitive');
select is(app.mask_email('ahmed@example.com'), 'a•••@•••.com', 'a real email masks exactly as before');
select is(app.mask_email(null), '•••', 'NULL still masks to the placeholder');
select is(app.mask_email('not-an-email'), '•••', 'non-email input still masks to the placeholder');

select * from finish();
rollback;
