# Video and R2 media: isolated local end-to-end run

Runs the whole video path on one machine with no hosted service: browser → S3-compatible stand-in for R2 → Python transcode worker → the media Worker's real handler on local HTTPS → browser. See [ADR-0020](../decisions/ADR-0020-video-r2-hls.md).

## Prerequisites

1. Local Supabase: `npx supabase start`, `npx supabase db reset`, and the demo seed (see [supabase-setup.md](supabase-setup.md)).
2. An S3-compatible stand-in on `127.0.0.1:8333` with a private bucket. SeaweedFS works:

   ```sh
   mkdir -p /tmp/s3 && cat > /tmp/s3/s3.json <<'JSON'
   {"identities":[{"name":"local","credentials":[{"accessKey":"localtestaccess","secretKey":"localtestsecretkey0123456789"}],"actions":["Admin","Read","Write","List","Tagging"]}]}
   JSON
   docker run -d --name aladdin-s3 -p 8333:8333 -v /tmp/s3:/etc/s3 chrislusf/seaweedfs server -s3 -s3.config=/etc/s3/s3.json
   ```

   The spec creates the bucket `aladdin-local-private` and its CORS rule (PUT from the app origin), the same rule production needs on R2.
3. `ffmpeg`, `openssl`, `uv` (backend `uv sync --group video-worker`) and Playwright's Chromium.

## Run

```sh
cd frontend
PW_CHROMIUM=/path/to/chromium pnpm exec playwright test -c playwright.video.config.ts
# Rollback check: restart the app with R2_STORAGE_ENABLED=false (and VIDEO_ENABLED=false), then
E2E_R2_ROLLBACK=1 E2E_REUSE_SERVER=1 pnpm exec playwright test -c playwright.video.config.ts r2-images
```

`E2E_REUSE_SERVER=1` reuses an app server you started with the same environment (pass the same `E2E_TICKET_SECRET`), which skips the production build on reruns.

**Codec note.** Playwright's open-source Chromium has no H.264 or AAC decoder, so the spec runs the worker with `--test-codec vp9` (VP9/Opus in the same fMP4 HLS layout). The worker refuses that flag outside `APP_ENV=local`; production always encodes H.264/AAC, which Chrome, Edge, Firefox, Safari, iOS and Android play. The H.264 output is checked by the backend's real-ffmpeg test, not by in-browser decoding here.

The config refuses anything but a local Supabase stack and a local S3 endpoint. It builds the app on port 3200 with `R2_LOCAL_S3_ENDPOINT`, edge delivery and video enabled; the spec starts the edge handler on `https://127.0.0.1:8788` with a throwaway certificate and a temporary `media_edge` LOGIN role, and drops the role afterwards. Screenshots go to `VIDEO_E2E_SHOTS` (default `/mnt/project-files/showroom-admin/e2e/video`).

## What it proves (desktop and mobile; R2 photos on desktop)

- R2 photo: browser → storage presigned PUT, verified R2 row with sha256 and WebP variants, rendered from the edge `/m/` with a ticket, no image bytes from the app; deleting the work removes the row and the stored original.
- Rollback: with R2 switched off, an R2 photo still renders from R2 and a new upload goes to Supabase Storage.
- Video upload goes to storage in presigned parts with progress; the app never receives the bytes.
- The worker produces HLS (360p/720p for a 720p source) and a poster under a new revision.
- The owner plays and seeks with a ticket; a Range request answers 206.
- After publishing, an anonymous visitor plays it on the public profile without a ticket.
- Unpublish refuses the very next anonymous segment; delete refuses the owner's next segment; sign-out refuses the owner's play ticket.
- `--purge` removes every object under `video/<id>/`.
- No playlist, segment or original passes through the app origin.
