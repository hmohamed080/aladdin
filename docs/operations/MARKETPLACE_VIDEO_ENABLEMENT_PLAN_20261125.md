# Marketplace product video: enablement plan (Acceptance first, then Production)

**Status:** PLAN ONLY, 2026-11-25. Nothing in this document has been run. Owner request: "prepare turning video on" for Production. Every hosted step below needs its own explicit owner GO. Video stays OFF everywhere until then.

## 1. What is true today (read-only checks, 2026-11-25)

- Production frontend Worker `aladdin-frontend-production` (Cloudflare dashboard, Variables): **no `VIDEO_ENABLED`**, no `MEDIA_EDGE_DELIVERY_ENABLED`, no `MEDIA_EDGE_*` variables. The code defaults are `false` (`frontend/src/lib/env/storage.ts`), so video is off. `R2_STORAGE_ENABLED=true`, `R2_PRODUCTION_WRITES_APPROVED=true`.
- The media Worker `aladdin-media-edge` **does not exist on Production** (dashboard: "Failed to find Worker"); only `aladdin-media-edge-preview` exists. `edge/media-worker/wrangler.toml` is a template with `<placeholders>`, `VIDEO_ROUTES = "off"` and a route `media.aladdindecore.com` that is not attached.
- Because edge delivery is off, every image URL on Production goes through the app proxy (`/api/media/...`). That is fine for images; video needs the edge (HLS playlists and segments, per-request authorization).
- Database: Production is at 246 and already has the Marketplace video schema (`media_videos`, `marketplace_video_events`, enum value `marketplace`) from `20261123160001` / `20261123160002`. There are 0 Marketplace video rows. The database is therefore NOT a blocker.
- Acceptance preview frontend (`frontend/wrangler.jsonc`, preview vars) also sets no `VIDEO_ENABLED` / `MEDIA_EDGE_*`: video has never been switched on in a hosted environment from this repo. Not verified: Worker variables set only in the Acceptance dashboard.
- A transcode host does not exist. `docs/architecture/video-transcode-cloudflare-containers.md` evaluates Cloudflare Containers (`backend/cloudflare/transcode/`, `backend/app/workers/video_transcode.py`); its status is "evaluation, NOT deployed".

## 2. What turning video on requires (ADR-0020, deployment dependencies)

1. **Media Worker on the target environment**: a real `wrangler` config (account id, bucket, Hyperdrive/database binding, `TICKET_KEYS` secret), `VIDEO_ROUTES = "on"`, `VIDEO_ALLOWED_ORIGINS` = the app origin(s), route `media.aladdindecore.com` (Custom Domain on the Cloudflare zone). Production has none of this.
2. **R2 bucket CORS**: `PUT` from the app origin, headers `content-type` and `content-length`; lifecycle rule aborting incomplete multipart uploads after 7 days.
3. **Transcode host** (ffmpeg, HLS) with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, R2 keys scoped to the private bucket. Candidate: Cloudflare Containers (not deployed).
4. **App env** on the frontend Worker: `MEDIA_EDGE_DELIVERY_ENABLED=true` plus `MEDIA_EDGE_ORIGIN`, `MEDIA_EDGE_TICKET_KID`, `MEDIA_EDGE_TICKET_SECRET` (Worker secrets), then `VIDEO_ENABLED=true`. The env schema refuses `VIDEO_ENABLED` unless `R2_STORAGE_ENABLED` and `MEDIA_EDGE_DELIVERY_ENABLED` are on.
5. **Marketplace gating**: product video upload is allowed only to a seller's managers for an enabled seller; videos start `pending` and play only after an Admin approves them at `/admin/marketplace/videos`. The public Marketplace itself is still "coming soon" on Production (`NEXT_PUBLIC_MARKETPLACE_PREVIEW` is not set there), so a Production video could only be exercised by sellers and Admins, not by the public, until the Marketplace is opened.

## 3. Proposed order

**Stage A: Acceptance (nothing on Production).**
1. Provision the transcode host for Acceptance and the Acceptance media Worker (`aladdin-media-edge-preview`) with `VIDEO_ROUTES="on"`.
2. Set the Acceptance preview frontend variables (section 2, item 4) in the dashboard / a reviewed config change.
3. Test end to end with a throwaway seller: upload in parts, transcode, Admin approve and reject, owner playback, public playback after approval, revocation (unpublish and suspend deny the next segment request), CORS from the preview origin, behaviour when the transcode host is down.
4. Record the measured cost and quota effects (Workers requests: about 80 per 5-minute view, ADR-0020 "Load note").

**Stage B: Production (only after Stage A passes and the owner says GO for each step).**
1. Create the Production media Worker and its Custom Domain; keep `VIDEO_ROUTES="off"`; verify private/public image routes first.
2. Provision the Production transcode host and R2 CORS / lifecycle rules.
3. Set the frontend variables with `VIDEO_ENABLED` last, through `cloudflare-production.yml` (`frontend-upload` then 10% then 100%, own approval each time); keep `media_mode=match-live` in mind: a new media flag set must be reviewed, the workflow compares the uploaded version with the live one.
4. Turn `VIDEO_ROUTES="on"` last. Rollback of any step is a variable or route removal; no database change is involved.

## 4. Decisions the owner must make

- Transcode host: Cloudflare Containers (evaluated, not built) or another host?
- Per-file video limits and the 3-videos-per-product rule (already in the schema) stay as built?
- Is Production video wanted before the public Marketplace opens (it would be usable only by sellers and Admins)?
- Who holds the R2 keys scoped for the transcode host (never in GitHub; Worker/host secrets).

## 5. Not verified / not done

- Nothing was created, deployed or switched on. No Cloudflare variable, route or Worker was changed.
- Acceptance dashboard variables for video were not read; the preview config in this repository has none.
- The transcode host, the media Worker on Production, and the R2 CORS rules do not exist yet.
- The cost of the transcode host and the Workers request volume are estimates from ADR-0020, not measurements.
