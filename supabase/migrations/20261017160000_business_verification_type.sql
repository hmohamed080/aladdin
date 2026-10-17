-- ===========================================================================
-- Business verification prerequisite: one more kind of review on the EXISTING verifications system.
--
--   business   an APPROVED organization asking for the Verified badge, with legal/company documents
--
-- This is deliberately separate from the organization application (verification_type 'organization'),
-- which activates the business. Enum values must be committed before they can be used, so this is its
-- own migration (same pattern as 20261015090032).
-- ===========================================================================
alter type public.verification_type add value if not exists 'business';
