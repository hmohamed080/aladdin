-- Migration: localized (Arabic/English) profile display names.
--
-- CONTEXT. `public.profiles.display_name` is a single, required, free-text
-- column — the SAME shape organizations/branches had before their own
-- bilingual columns (20260913090001) — so a real Arabic name a person
-- actually goes by (not a transliteration of their Latin one) had no
-- durable home, and the Showroom dashboard's greeting fell back to
-- rendering a Latin name inside an Arabic sentence.
--
-- SHAPE. `display_name_ar`/`display_name_en` are nullable, additive
-- overrides — `display_name` stays the required canonical fallback,
-- unchanged, exactly as it is read today by every existing surface
-- (ProfileMenu, initials, assignment pickers, ...). Resolution is
-- `resolveBilingualText` (frontend/src/lib/i18n/bilingual.ts), the SAME
-- function the org/branch names already use: Arabic prefers `display_name_ar`
-- falling back to `display_name`, English prefers `display_name_en` falling
-- back to `display_name`. Never auto-translated — an owner who only ever
-- typed one name keeps seeing that one name in both languages, which is
-- still their real, entered name.
--
-- AUTHORIZATION. Extends the EXISTING safe write path rather than opening a
-- new one: `profiles.display_name`/`headline`/`bio`/... is already a plain
-- column-level `grant update (...) to authenticated`, gated by the existing
-- `profiles_update_self` row policy (own row only). This migration only adds
-- the two new columns to that same grant — no RLS change, no new RPC, no
-- table reopened beyond what was already writable.

alter table public.profiles
  add column display_name_ar text,
  add column display_name_en text;

alter table public.profiles
  add constraint ck_profiles_display_name_ar_len
    check (display_name_ar is null or char_length(display_name_ar) between 1 and 80),
  add constraint ck_profiles_display_name_en_len
    check (display_name_en is null or char_length(display_name_en) between 1 and 80);

comment on column public.profiles.display_name_ar is
  'Real Arabic display name the person entered, or NULL if they never set one — never a translation of display_name. See lib/i18n/bilingual.ts resolveBilingualText for the display-fallback rule.';
comment on column public.profiles.display_name_en is
  'Real English display name the person entered, or NULL if they never set one — never a translation of display_name.';

-- Additive to the existing column-level grant (20260802090001) — same row
-- policy (profiles_update_self), same self-only scope, no new privilege
-- surface. A caller could already rewrite display_name freely; these two
-- columns are no more sensitive than that one already is.
grant update (display_name_ar, display_name_en) on public.profiles to authenticated;
