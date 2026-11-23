# ADR-0030 — Site-wide media upload policy (per-file caps, re-encoded originals, verified video cleanup)

**Status:** Proposed · 2026-11-21 · **Needs owner approval** before it is applied to Acceptance or Production. Implemented by marketplace plan PR 2 (`docs/product/marketplace-implementation-plan-20261121.md`).

**Supersedes in part:** [ADR-0020](ADR-0020-video-r2-hls.md) Revision 2 ("no product size or length cap") — video now has a 100 MB per-file cap; the 2026-10-19 rule that a picked photo is never refused for its size and is shrunk in the browser to fit 5 MB.

## Purpose

One media policy for the whole site (Marketplace, portfolio, requests), decided in the Marketplace requirements walkthrough (Part 3, rounds 3–5): predictable per-file limits, original quality kept, personal data removed, and no early deletion of video originals.

## Current decision

- **Caps are per file.** Image 10 MB, video 100 MB. One oversize or unsupported file is refused on its own; the rest of the batch (images and videos together) still uploads. The old 5 MB image limit is gone. Avatars and organization images (fixed-size crops, 3 MB), certificates and verification documents (10 MB, evidence) keep their existing ceilings.
- **Images keep a re-encoded original.** The browser uploads the picked file untouched. The server re-encodes it in its own format: long edge ≤ 2560 px (never upscaled), quality 90 (stepped down only to fit the byte ceiling), EXIF orientation baked in, converted to sRGB with the profile attached, full chroma on JPEG, and **no personal metadata** (EXIF device and GPS, XMP, IPTC, text chunks). A pure last-pass stripper (`image-processing/metadata-strip.ts`) removes anything an engine leaves behind while keeping the ICC profile. Verification documents and certificates are stored exactly as uploaded. The WebP variants thumb 320 / card 768 / full 1600 are unchanged and derive from the re-encoded original.
- **Compression is an estimate, not a guarantee.** The Node engine is exact on colour; the Cloudflare Images binding gives no control over chroma or the profile, so the colour fidelity of the Workers path is covered by the ΔE acceptance check on real marble/wood/decor samples before the numbers are final.
- **Video.** The worker keeps 360p / 720p / 1080p adaptive HLS (720p is the rendition for weak connections), H.264 constant quality CRF 22 held under each rendition's max rate, at most 1080p and 30 fps, AAC 128k, 4-second segments, plus a poster. **The original is deleted only after verification**: every published object present at its uploaded size, playlists, a clean decode of a rendition's first segment with the expected video codec and, when the source had sound, the audio codec, and a poster. A failed check retries the job with the original intact; a missing poster finishes the video but keeps the original. The database refuses a new video row over 100 MB.
- **Rejected Marketplace images are purged after 2 days.** `marketplace_rejected_images_purge()` moves rejected images older than two days into the existing removal lifecycle; the central cleanup deletes the bytes (original, pending copy, variants) and the row is forgotten once the deletion is confirmed. The moderation trail keeps the decision.

## Rationale

The owner wants colour-critical product photos kept at high quality without storing multi-megabyte phone originals or personal location data, simple limits a seller can understand, and weak-connection playback. Verified deletion avoids losing a video whose transcode silently failed.

## Scope

All uploads that go through the media storage layer (`server/storage/media.ts`), the seller image panel, the portfolio, product and request upload paths, the video worker and the database receipt/purge functions. Migration: `20261121090001_media_policy_caps_and_rejected_purge.sql` (receipt cap, video cap trigger, purge function).

## What is deferred

ΔE acceptance on real samples and throttled-network playback acceptance (need the owner's samples and a deployed Worker); purge of rejected images outside the Marketplace (the other namespaces have no moderation state); one slot-limited product media UI (PR 7); existing stored originals are not re-encoded retroactively.

## Consequences

- Existing images are untouched; only new uploads are re-encoded. Uploads cost more Cloudflare Images transforms on Workers (verify, re-encode, three variants).
- A video over 100 MB can no longer be uploaded; videos already stored are unaffected.
- The video worker needs the R2 delete permission it already uses for the purge.

## Related files

`frontend/src/lib/media/upload-limits.ts`, `frontend/src/server/storage/image-processing/*`, `frontend/src/server/storage/media.ts`, `frontend/src/features/marketplace-seller/image-upload.ts`, `backend/app/workers/video_transcode.py`, `scripts/media-storage.mjs`, `supabase/migrations/20261121090001_media_policy_caps_and_rejected_purge.sql`.
