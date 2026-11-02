-- Rollback of bv-evidence-r2-adoption.sql: removes the functions. Adopted R2 locations and the Supabase copies are not touched
-- (use public.bv_evidence_unadopt per document BEFORE running this if a document must go back to its Supabase location).
drop function if exists public.bv_evidence_adoption_verify();
drop function if exists public.bv_evidence_unadopt(text, text);
drop function if exists public.bv_evidence_adopt(text, bigint, text);
drop function if exists public.bv_evidence_adoption_inventory(text, integer);
