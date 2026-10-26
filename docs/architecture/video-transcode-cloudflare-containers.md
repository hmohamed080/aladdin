# Video transcoding on Cloudflare Containers: evaluation

**Status:** Evaluation and NOT-deployed config · 2026-10-22 · owner brief section 9. Nothing is deployed, bought or switched on. Video stays off (`VIDEO_ENABLED=false`, media Worker `VIDEO_ROUTES="off"`). Every hosted step below needs owner approval.

**Builds on:** [ADR-0020](../decisions/ADR-0020-video-r2-hls.md) (R2 originals, HLS worker, per-request edge authorization). That ADR left the transcode host open (deployment dependency 4). This page evaluates Cloudflare Containers as that host.

**Code:**
- [`backend/cloudflare/transcode/`](../../backend/cloudflare/transcode/): `Dockerfile`, `wrangler.jsonc`, `src/index.ts`.
- [`backend/app/workers/video_transcode.py`](../../backend/app/workers/video_transcode.py): new `--drain` mode and SIGTERM handling. Since 2026-10-24: progressive segment upload and the R2-over-HTTPS input for originals the disk cannot hold ([Long videos](#does-a-long-video-fit)).

## Recommendation

**Containers fits.** The disk gap found on 2026-10-22 is closed in code (2026-10-24): the instance disk no longer limits the size of an original. See [Long videos](#does-a-long-video-fit).
- **Shape:** one Worker, one Durable Object class (`TranscodeSlot`) and one separate image. A slot starts a container that drains every claimable video, then exits, so billing stops.
- **Coordination:** Postgres remains the only job authority. Nothing new holds job state.
- **Cost:** about **$0.22–0.38 of compute per hour of 1080p source video**. Total cost is **≈ $0.25–0.40** with R2 operations, and up to **≈ $0.55** if container-to-R2 uploads count as egress after the free allowance. On top of that, Workers Paid costs $5/month.
- **Duration:** a long video fits. Cloudflare sets no runtime cap.
- **Disk:** no longer a size limit. Before 2026-10-24 the 20 GB maximum capped an original at about 7.5 GB. Now an original up to ≈ 18.5 GB is read from a local copy, and a larger one is read straight from R2 over a presigned HTTPS URL. Finished segments leave the disk while ffmpeg runs. The remaining limit for one job is wall time, about 3–7 days of source video. See [Long videos](#does-a-long-video-fit).

## Platform facts (Cloudflare docs, read 2026-10-22)

| Item | Value | Source |
|---|---|---|
| Instance types | lite 1/16 vCPU · 256 MiB · 2 GB; basic 1/4 · 1 GiB · 4 GB; standard-1 1/2 · 4 GiB · 8 GB; standard-2 1 · 6 GiB · 12 GB; standard-3 2 · 8 GiB · 16 GB; standard-4 4 · 12 GiB · 20 GB | [Limits](https://developers.cloudflare.com/containers/platform/limits/) (updated 2026-10-21) |
| Custom instance | 1–4 vCPU, ≥ 3 GiB per vCPU, ≤ 12 GiB, disk ≤ 20 GB with no disk:memory ratio since 2026-09-29. All maximums are defaults that support can raise | same; [changelog 2026-09-29](https://developers.cloudflare.com/changelog/post/2026-09-29-remove-disk-to-memory-ratio/) |
| Disk | Ephemeral. A new start gets a fresh disk from the image. Image size is limited by instance disk | [FAQ](https://developers.cloudflare.com/containers/faq/), [Image management](https://developers.cloudflare.com/containers/guides/image-management/) |
| Max run time | No fixed maximum. Host restarts happen "on an irregular cadence": `SIGTERM`, up to 15 min grace, then `SIGKILL`. A rollout of a new image does the same | [FAQ](https://developers.cloudflare.com/containers/faq/), [Rollouts](https://developers.cloudflare.com/containers/configuration/rollouts/) |
| Inactivity | Without a timeout, the container stops shortly after its Durable Object goes idle. `setInactivityTimeout()` allows at most 6 h. A pending `monitor()` keeps the object alive for at most 15 min | [Durable Object Container API](https://developers.cloudflare.com/containers/api/durable-object-container/) |
| Concurrency | Per account: 1,500 vCPU, 6 TiB memory, 30 TB disk concurrently. `max_instances` per application (default 20). Image storage 50 GB per account | [Limits](https://developers.cloudflare.com/containers/platform/limits/) |
| Cold start | "Often 1–3 s", depending on image size and entrypoint | [Architecture](https://developers.cloudflare.com/containers/concepts/architecture/) |
| Pricing (Workers Paid, $5/month) | Memory $0.0000025 per GiB-s (25 GiB-h included). CPU $0.000020 per vCPU-s, **active usage only** (375 vCPU-min included). Disk $0.00000007 per GB-s (200 GB-h included). Billed per 10 ms while running. Memory and disk are billed on provisioned size | [Pricing](https://developers.cloudflare.com/containers/platform/pricing/) (updated 2026-10-05); [CPU change 2025-11-21](https://developers.cloudflare.com/changelog/post/2025-11-21-new-cpu-pricing/) |
| Egress | $0.025/GB NA & EU (1 TB included); $0.05 Oceania/Korea/Taiwan (500 GB); $0.04 elsewhere (500 GB) | [Pricing](https://developers.cloudflare.com/containers/platform/pricing/) |
| R2 | $0.015/GB-month; Class A $4.50/M; Class B $0.36/M; no egress fee | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Logs | Container stdout goes to Workers Logs (7 days) when `observability` is on. Logpush is available. Observability pricing applies from 2026-12-01 | [FAQ](https://developers.cloudflare.com/containers/faq/), [Observability pricing](https://developers.cloudflare.com/observability/pricing/) |
| Scheduling policy | `default` (GA): image and size come from Wrangler. `durable_object` is in **beta**, so we do not use it | [Scheduling policy](https://developers.cloudflare.com/containers/configuration/scheduling-policy/) |

## How the job model maps

The worker's guarantees all live in Postgres, so they carry over unchanged:
- `video_job_claim` takes a lease with `SKIP LOCKED` and counts an attempt at claim (max 3).
- `video_job_renew` is the 5-minute heartbeat on a 15-minute lease.
- `video_job_fail` releases a job for retry, or rejects it.
- `video_job_expire` turns spent attempts into `failed`.
- Writing under a fresh revision, with playlists last, makes a re-run idempotent.

Several workers need no coordination with each other. Containers only has to make sure a worker runs when there is work.

```
app (upload completes) ──service binding──▶ wake() ─┐
cron */10 ─────────────────────────────────▶ scheduled() ─┤ kickOne: first idle slot
                                                           ▼
                         Durable Object TranscodeSlot "slot-i"  (no job state)
                           start({env, enableInternet}) · alarm every 5 min extends
                           the inactivity timeout while running · monitor() logs the exit
                                                           ▼
                         container: python -m app.workers.video_transcode --drain
                           loop: expire → claim (lease) → download, or presign if too big
                                 → ffprobe/ffmpeg (segments uploaded as written)
                                 → upload playlists last → finish; until nothing to claim
                           then purge; exit 0 (1 if a job was released for retry)
```

- **Durable coordination:** Postgres alone. The Durable Object stores only its alarm. A duplicate start finds nothing to claim and exits within seconds. A lost container leaves a lease that expires (≤ 15 min) and is reclaimed on the next kick.
- **Concurrency:** `TRANSCODE_SLOTS` (2) equals `max_instances`. Each kick starts at most one new container: the first idle slot. A backlog therefore gains a second worker on the next kick.
- **Why not a Queue?** A Cloudflare Queue would be a second job store that has to agree with `media_videos`. The database already queues. The Redis wake-up list (ADR-0019) stays for the `--loop` hosts. Containers need no long-lived listener, because `wake()` replaces `BLPOP`.
- **Why not cron alone?** Cron alone means up to 10 minutes' latency, and each tick costs a start. The cron stays as the safety net for expired leases, retries and the purge. `wake()` gives immediate starts. When the frontend runs on Workers (ADR-0021), wire `wake()` through a service binding. A Vercel-hosted app has no binding, so it waits for the cron.
- **Long jobs and the 6-hour inactivity cap:** the alarm wakes the object every 5 minutes while the container runs and renews a 30-minute inactivity timeout. A multi-hour transcode is therefore never stopped as idle. When the container exits, the alarm stops rescheduling.

## Monitoring

- **The database is the truth.** Alert on these:
  - the oldest `state='processing'` row (`uploaded_at`) older than 1 h;
  - any rows with `attempts >= 2`;
  - new `failed` rows grouped by `failure_code`.
  These queries are read-only and run with the service role or in the SQL editor.
- **Worker and Durable Object logs** (`observability.enabled`): `transcode.cron`, `transcode.started`, `transcode.exited`, and `transcode.failed` with the exit code.
- **Container stdout** (same Workers Logs, 7 days): the worker's structlog events `video.ready` (with seconds), `video.retry`, `video.rejected`, `video.drained` (counts, `terminated`) and `video.lease_renew_failed`. A video is logged only as a 12-character hash, never as its id or any user data.
- **Dashboard:** the Containers dashboard shows CPU, memory and disk per instance. Watch disk headroom on large uploads.

## Temp-file cleanup

- Each job works in `tempfile.TemporaryDirectory` (`/tmp/video-*`). It is removed on success, on rejection and on any exception. That includes `Terminated` raised by SIGTERM in the middle of ffmpeg, which `test_a_job_terminated_mid_transcode_is_released_for_retry` covers.
- After a `SIGKILL`, an OOM or a host loss, nothing survives: Containers disk is ephemeral and the next start gets a fresh image filesystem. No sweeper is needed inside the container.
- **R2, not Containers:** a failed attempt may leave a partial `video/<id>/<revision>/` that nothing references. It is deleted when the video is deleted and purged. Until then it costs storage. This already happens on any host. A sweep for orphaned revisions is a separate follow-up.

## Failure handling

| Failure | What happens |
|---|---|
| Invalid media / no video stream | `video_job_fail(retry=false)` → `failed`, no retry (unchanged) |
| ffmpeg error, R2 or network error | `video_job_fail(retry=true)`; the same drain or the next one reclaims it; 3 attempts in total. On the R2 input, a probe that fails with an HTTP or network message (including an expired URL's 403) is retried, never rejected as `invalid_media` |
| SIGTERM (host restart, rollout of a new image) | `--drain` turns it into `Terminated` inside the job: `subprocess.run` kills ffmpeg, the job is released for retry, temp files are removed, and the process exits well within the 15-min grace. Python is PID 1, so without this handler SIGTERM would be ignored until SIGKILL |
| SIGKILL / OOM / host loss | Lease expires ≤ 15 min, then the next cron or wake reclaims it |
| Container fails to start (image, `max_instances`, capacity) | `monitor()` rejects → `transcode.failed` log; the next kick tries again |
| Missing secret | `kick()` throws before starting (fails closed); nothing half-configured runs |
| Attempts spent | `video_job_expire` → `failed / transcode_failed` (existing UI state) |

Two caveats:
- **Platform stops cost attempts.** A claim counts an attempt, so 3 host restarts during one long transcode fail the video. A follow-up migration could release a job on SIGTERM without counting the attempt. Not done here: no schema change in this task.
- **Rollouts interrupt work.** A new image SIGTERMs running transcodes. Deploy while the queue is empty, or set `rollout_active_grace_period`.

## Cost per hour of video transcoded

**Measured on 2026-10-22.** Setup:
- the worker's exact `transcode_command` (H.264 Main, `veryfast`, AAC, 360p/720p/1080p, 4 s fMP4);
- ffmpeg 6.1.1 on a shared 4-vCPU Xeon at 2.8 GHz;
- the host was busy with other jobs (load 13–17), so wall times are pessimistic. CPU-seconds are the better guide, and CPU is what is billed.

| 60 s 1080p30 source | CPUs | Wall | CPU-s | Peak RSS | Output |
|---|---|---|---|---|---|
| synthetic + heavy noise (worst case) | 2 | 132.5 s | 210 | 498 MiB | 67 MB |
| same | 4 | 121.8 s | 212 | 619 MiB | 67 MB |
| synthetic, clean | 2 | 126.9 s | 133 | 463 MiB | 67 MB |

- **CPU need:** about **2.2–3.5 vCPU-s per media second**.
- **4 vCPU does not help.** The single filter graph (decode → split → three scalers) keeps ffmpeg at about 1.7 cores. That is why the config uses **2 vCPU / 6 GiB / 20 GB**: 6 GiB is the minimum memory for 2 vCPU, and the peak RSS was well under 1 GiB.
- **Planning wall time:** 1.0–2.2 × the video's duration.

| Per hour of source video | Low | High |
|---|---|---|
| CPU: 3,600 × 2.2–3.5 vCPU-s × $0.00002 | $0.158 | $0.252 |
| Memory: 6 GiB × 1.0–2.2 h × $0.009/GiB-h | $0.054 | $0.119 |
| Disk: 20 GB × 1.0–2.2 h × $0.000252/GB-h | $0.005 | $0.011 |
| **Compute subtotal** | **$0.22** | **$0.38** |
| R2 Class A: ~2,710 PUTs (3 × 900 segments + inits + playlists + poster) | $0.012 | $0.012 |
| Egress, *if* uploads to R2 count (≈ 4.0 GB of output/h × $0.025–0.04), only after the 1 TB / 500 GB monthly allowance | $0 | $0.16 |
| **Total** | **≈ $0.23** | **≈ $0.55** |

- **Included each month:** the Workers Paid allowances cover about the first **2 video hours** (375 vCPU-min, 25 GiB-h). These allowances are **account-wide and shared** with the FastAPI container and the sandbox.
- **Reading large originals from R2 (2026-10-24):** this costs about the same. R2 charges no egress fee. The container *receives* the bytes, and Containers bills egress only on bytes leaving the container. A streamed read moves the original about once, the same as the download it replaces. Probe and poster read a few MB more with Range. Each HTTP request is one R2 Class B operation ($0.36/M). One request per ffprobe, ffmpeg run, seek and reconnect comes to tens per job, ≈ $0.00001. Segment uploads are the same PUTs as before, only earlier. The one real cost is time: a poorly interleaved MP4 makes ffmpeg seek often, and every seek is a new request with its own latency. Phone recordings interleave in ≈ 1 s chunks, so this was not measured on R2. Disk stays at 20 GB, because the local path still speeds up originals up to ≈ 18.5 GB. Disk costs ≈ $0.005–0.011 per video hour anyway.
- **Idle overhead:** a cron start every 10 min with nothing to do costs about 10 s × 4,320 starts/month. That is ≈ 72 GiB-h and 240 GB-h, so **≈ $0.45/month** above the allowances (an estimate; measure after a pilot).
- **Storage:** HLS output adds about 4 GB per video hour, ≈ $0.06/month at R2 rates. The original is kept too.
- **ADR-0020 was too low.** Its "$0.02–0.05 per hour" for per-second machines underestimated three 1080p renditions on a small CPU. Use this table instead.

## Does a long video fit?

- **Duration: yes.** Cloudflare sets no runtime cap. The lease heartbeat (5/15 min) and the alarm-renewed inactivity timeout keep a multi-hour job alive. ffmpeg's own budget is 8 s per media second. At 1.0–2.2 × real time, a 2-hour video takes about 2–4.5 h. The only duration risk is repeated host restarts (see the caveats above).
- **Disk: no longer a size limit (fixed 2026-10-24).**

**The problem (2026-10-22).** The worker downloaded the original, then wrote every rendition beside it. It needed 2.5 × the original free (`DISK_FACTOR`). A 20 GB instance minus a ≈ 0.5 GB image left room for originals up to **≈ 7.5 GB**: about 1 h of 1080p H.264 phone video, or 19–45 min of 4K. A larger original raised `InsufficientDisk` on every container and was `failed` after 3 attempts. The owner's rule is no user-facing size or duration cap (ADR-0020 Revision 2), so rejecting it was not an option.

**Options weighed:**

| Option | Disk need | Verdict |
|---|---|---|
| (a) ffmpeg reads the original from a presigned R2 GET URL | renditions only, ≈ 4 GB per hour of source | Removes the original from disk, but output still scales with duration (≈ 4.5 h of video on 19.5 GB). Not enough alone |
| (b) upload each finished HLS segment while ffmpeg runs, then delete it | original + a few MB | Removes output growth, but the original must still fit (≈ 18.5 GB). Not enough alone |
| (c) choose (a) only when the original would not fit locally | — | Keeps the common case on `file:` only, which is the tightest input hardening, with one robust boto3 download and no network reads during a multi-hour encode |
| Raise the Containers disk limit | unchanged | Moves the ceiling, does not remove it; needs Cloudflare support |
| Claim size filter + a bigger fallback host | unchanged | Needs a migration and a second, always-on host |
| R2 FUSE mount | renditions | Needs FUSE in the container (privileges, an extra daemon) |

**Chosen: (b) always, plus (a) selected by (c).** No new dependency, no schema change. The lease, heartbeat, attempts, revision and "playlists last" rules are unchanged.

- **Selection** (`read_locally`): with `OUTPUT_HEADROOM_BYTES` = 1 GiB, an original is read locally when `free ≥ size + 1 GiB`, read from R2 when it is bigger, and `InsufficientDisk` (retry) is raised only when less than 1 GiB is free. In both cases the size is checked against the database first: by the download, or by a `HEAD` for R2. A short object is still `upload_incomplete`.
- **Progressive upload** (`SegmentUploader`, `run_ticking`): every 2 s, from the worker's main thread, each rendition's segments except the newest go to `video/<id>/<revision>/` and are deleted locally. ffmpeg writes a rendition's segments one after another, so all older ones are complete. When ffmpeg exits, the rest go up. The worker then checks that every segment named in a playlist was uploaded, and uploads init segments, the poster and playlists, playlists last. A failed upload kills ffmpeg and retries the job. ffmpeg's stderr goes to a file, so a long run never blocks on a pipe.
- **R2 input hardening** (`_input_args`): only the single `-i` changes. Its `-protocol_whitelist` is `https,tls,tcp`, where `http,tcp` is accepted only for the local S3 stand-in, which config refuses outside `APP_ENV=local`. `S3VideoStore.presign_get` also refuses a non-HTTPS URL unless it was built for that stand-in. `file`, `crypto`, `hls` and `data` are all off. Both paths now also pass `-format_whitelist <forced demuxer>` (`mov` or `matroska`). ffmpeg copies both whitelists into anything a demuxer opens in turn, so a crafted file cannot open a playlist, a concat list or another URL. mov's external data references (`enable_drefs`) stay off by default. Outputs are unchanged: local paths that the worker builds.
- **The URL:** SigV4 signs the bucket and key, so the URL works for this one object only (verified: the same signature on another key returns 403). It allows GET only. Each ffmpeg run gets a fresh URL that lives for that run's own hard timeout plus 5 min (`url_seconds`): 6 min for ffprobe and the poster, and `8 s × duration + 15 min` for the transcode. The cap is 7 days, the SigV4/R2 maximum. The URL is never logged. ffmpeg echoes a failing input URL with its signature, as a test against SeaweedFS showed, so its stderr is redacted before it is truncated. The retry log's `detail` is redacted too, which covers `TimeoutExpired`, whose text holds the command line. A timeout of the transcode itself raises `FfmpegTimeout`, whose message has no command line. The URL does sit in ffmpeg's argv (`/proc/<pid>/cmdline`) inside the container. That container already holds the R2 secret key in its environment, and the URL grants strictly less.
- **Range and retry over HTTPS:** the flags are `-reconnect 1 -reconnect_on_network_error 1 -reconnect_on_http_error 5xx -reconnect_delay_max 30 -rw_timeout 60000000`, all present in ffmpeg 5.1, Debian bookworm's version. A dropped or stalled connection (no data for 60 s), or a 5xx, resumes at the same byte offset with a Range request, with backoff up to 30 s. A 4xx, such as an expired URL's 403, fails at once. A probe that fails with an HTTP or network message is a retry, not `invalid_media`. That was found and fixed while testing against SeaweedFS.
- **A URL expiring mid-job:** the signature is checked when a request starts, not while bytes stream. Expiry therefore matters only for a seek or reconnect after the URL's lifetime. That lifetime already outlasts ffmpeg's own hard timeout, so a URL never expires before ffmpeg would be killed anyway, unless the timeout exceeds 7 days. If one does expire, the run fails, the job is released, and the next attempt gets a fresh URL.

**The new ceiling, with its arithmetic:**
- **Disk:** none in size. Usable disk is 20 GB − ≈ 0.5 GB image = 19.5 GB. A local read needs `size + 1 GiB ≤ 19.5 GB`, so originals up to **≈ 18.4 GB** are read from disk. That is 2.5× the old 7.5 GB, because the outputs no longer accumulate. Anything larger is streamed and needs only the 1 GiB headroom.
- **Object:** R2's 5 TiB object limit (ADR-0020) is the only byte ceiling left.
- **Wall time:** a single transcode must finish within the URL's 7-day maximum: 604,800 s. At the measured 1.0–2.2 × real time for 1080p, that is about **76–168 h of source in one job**, roughly 3–7 days of video. ffmpeg's own budget (`8 s × duration + 600 s`) reaches 7 days at about 21 h of source. For a longer video, ffmpeg's timeout, not the URL, would still allow the run. The run then depends on no reconnect being needed after day 7. 4K decode is slower than the 1080p measurement, so for 4K use the low end.
- **Restarts:** platform restarts still cost an attempt each (see the caveats above). For multi-day jobs that is the more likely limit.

| Source | ≈ MB/min | Before: longest that fit | Now: read from disk up to | Above that |
|---|---|---|---|---|
| 1080p30 HEVC | 60 | ~2 h | ~5 h | streamed from R2 |
| 1080p30 H.264 | 130 | ~1 h | ~2.4 h | streamed from R2 |
| 4K30 HEVC | 170 | ~45 min | ~1.8 h | streamed from R2 |
| 4K30 H.264 | 350 | ~22 min | ~52 min | streamed from R2 |
| 4K60 HEVC | 400 | ~19 min | ~46 min | streamed from R2 |

**Still needs a real-provider test (not done):**
1. **R2 over HTTPS from a Container:** whitelist `https,tls,tcp` against `<account>.r2.cloudflarestorage.com`, the image's ffmpeg 5.1 with its TLS backend, and Range and seek behaviour on R2.
2. **A multi-GB original streamed end to end:** throughput against encode speed, and how many Class B requests one job makes.
3. **Reconnect on a real drop:** cut the connection mid-transcode and confirm ffmpeg resumes at the right offset with no corrupted segment.
4. **The image build:** Docker Hub was rate-limited earlier, so the bookworm image and its ffmpeg 5.1 flags have not been run.
5. **A poorly interleaved MP4 over R2:** wall time.

## Shared with the "FastAPI on Cloudflare" thread (not duplicated)

**Shared:**
- the `backend/` code, `pyproject.toml`/`uv.lock` and `app.config`;
- the base-image pattern (`python:3.12-slim` + uv, non-root user);
- the Cloudflare account, with its **included Containers allowances and concurrency limits**;
- the same Supabase service-role value. It is set separately per Worker; store it once in Secrets Store if both move.

**Separate on purpose:**
- **Image:** ffmpeg and boto3, no uvicorn and no port. The API image stays slim, with fast cold starts.
- **Worker and Durable Object:** `aladdin-video-transcode` / `TranscodeSlot`, with no route.
- **Instance size:** 2 vCPU with 20 GB disk, against the API's own sizing.
- **Lifecycle:** batch, scale to zero, against request-serving.

A transcode never competes with API requests for CPU. `backend/Dockerfile` and the API's container config are untouched.

## Real H.264 playback: what must be tested on devices

The automated suite runs Playwright's open-source Chromium, which has **no H.264 or AAC decoder**. It therefore plays a VP9/Opus encode (`--test-codec vp9`, local only). The production H.264 path has been checked only by:
- ffprobe;
- the backend's real-ffmpeg layout test;
- the master playlist carrying `CODECS="avc1.4d401e|4d401f|4d4028,mp4a.40.2"`, which Safari requires.

Before switching video on, test these on real hardware and branded browsers:

1. **Desktop Chrome and Edge** (hls.js over MSE): first frame, the hover preview (muted, lowest rendition), click-to-play with sound, a 360p → 1080p switch, seek, and play-ticket refresh after 50 s on a video longer than 5 min.
2. **Desktop Safari (macOS)** (native HLS): the same, plus ticket-carrying URIs rewritten in every playlist, poster, and no CORS errors from `media.aladdindecore.com`.
3. **iPhone Safari (iOS)** (native HLS): inline playback (no forced fullscreen), tap-to-play with sound, no preview on touch, rotation-tagged portrait video shown upright, lock-screen and background behaviour.
4. **Android Chrome:** playback, seek, and rendition choice on a mid-range phone over 4G.
5. **Firefox desktop:** hls.js with the OS H.264 decoder.
6. **Source variety:**
   - iPhone HEVC 10-bit HDR: output is SDR `yuv420p` with no tone mapping, so check colours;
   - iPhone portrait;
   - Android 60 fps;
   - a WebM/VP9 upload;
   - a video without audio;
   - a > 30 min upload for seek and ticket refresh.
7. **Revocation on real devices:** unpublish, delete and sign-out must stop the next segment. Native HLS on iOS buffers ahead, so record how much keeps playing.

## Validation done here

- `uv run --group video-worker pytest` (backend, all pass) and `ruff check` / `ruff format --check`. New tests cover drain-until-idle-then-purge, stop-before-claim, SIGTERM killing a running child and raising `Terminated`, and a terminated job released for retry with its temp dir removed.
- `wrangler types` and `tsc --noEmit` on the Worker: clean.
- `wrangler@4.151.2 deploy --dry-run` with the containers block: the config is accepted and wrangler went on to build the image. The build stopped at the Docker Hub pull of `python:3.12-slim-bookworm` (HTTP 429 from the sandbox), so **the image build was not verified**.
- The same dry run without the containers block bundled the Worker (2.84 KiB) with its bindings: `TRANSCODE` Durable Object, `APP_ENV`, `TRANSCODE_SLOTS`.
- Nothing was deployed, pushed or billed.

**Large-original fix (2026-10-24, local only):**
- `uv run pytest`: 118 passed, 3 skipped. The skips are the Redis tests, which need `REDIS_TEST_URL`. `ruff check .` and `ruff format --check .` are clean.
- New unit tests cover:
  - URL input argument construction and the whitelists;
  - refusal of non-http(s) inputs;
  - the local-or-R2 selection;
  - the URL lifetime and its 7-day cap;
  - `S3VideoStore.presign_get` refusing http and capping the expiry;
  - segments leaving the disk during the run, with only the newest per rendition kept;
  - playlists uploaded last;
  - a playlist naming a missing segment failing the job;
  - no URL, `X-Amz` or host in any log for a 403, a probe timeout and a transcode timeout;
  - redaction of truncated signature fragments;
  - `run_ticking` ticking, killing ffmpeg on a failed tick, a timeout or SIGTERM;
  - a storage error during the probe being retried;
  - temp directory cleanup.
- **Real ffmpeg 6.1.1, local HTTP with Range:** a 20 s 720p MP4 with its moov at the end was read only over `http,tcp`. Segments were uploaded while ffmpeg ran. Every playlist URI was stored. The test is `test_real_transcode_reads_the_original_over_http_and_uploads_segments_as_it_goes`.
- **Real S3 API, SeaweedFS 127.0.0.1:8333:** a scratch script, not committed, ran the real `S3VideoStore` (boto3 SigV4 presign, `HEAD`, uploads) through `process_one` on the R2 path. Result:
  - 16 objects stored, the poster included, with 0 downloads;
  - the presigned URL for one key was refused for another key (403);
  - an expired URL was retried after the fix (`invalid_media` before it);
  - no URL or signature in the logs.
- **Not run:** real R2, a real Container, the bookworm image (ffmpeg 5.1), multi-GB originals, and a mid-transcode network drop.

## Owner decisions before any hosted step

1. Workers Paid (likely already needed for the frontend, ADR-0021) and the Containers usage above.
2. ~~Disk for large originals~~: solved in code (2026-10-24, [Long videos](#does-a-long-video-fit)). Remaining step: approve a real-provider test with one multi-GB original on R2.
3. An R2 token scoped to the private bucket for this Worker's secrets.
4. Whether the app wakes the worker by service binding (frontend on Workers) or by cron only.
