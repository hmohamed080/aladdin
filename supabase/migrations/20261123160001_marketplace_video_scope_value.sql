-- Marketplace product video, step 1 of 2: the new media_video_scope value.
-- A new enum value cannot be used in the transaction that adds it, so the value lives alone in this file and
-- 20261123160002_marketplace_product_video.sql uses it. Additive: no existing row or caller is affected.
alter type public.media_video_scope add value if not exists 'marketplace';
