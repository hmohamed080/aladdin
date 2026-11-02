-- Rollback of legacy-media-reset.sql: removes every function it installed so the reset can no longer be driven.
-- The journal table is KEPT on purpose: it is audit evidence of what was retired. The audit action stays allowed
-- (the vocabulary only ever grows). Nothing here touches Storage objects or media metadata.
drop function if exists public.media_reset_verify();
drop function if exists public.media_reset_drop_locations(jsonb);
drop function if exists public.media_reset_finalize(integer);
drop function if exists public.media_reset_storage_removed(text, text);
drop function if exists public.media_reset_retire(text, jsonb);
drop function if exists public.media_reset_manifest_counts();
drop function if exists public.media_reset_manifest_locations(text, text, integer);
drop function if exists public.media_reset_manifest_rows(text, text, integer);
drop function if exists public.media_reset_manifest_objects(text, text, integer);
drop function if exists app.media_reset_lock_row(text, text);
drop function if exists app.media_reset_referenced(text, uuid);
drop function if exists app.media_reset_rows();
drop function if exists app.media_is_r2(text, text);
drop function if exists app.media_reset_namespace(text);
drop function if exists app.media_reset_bucket(text);
