begin;
delete from public.media_videos where id::text like '0e7fa000-%';
delete from auth.sessions where id = '0e7fa000-0000-4000-8000-00000000005e';
commit;
