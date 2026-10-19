"""Video transcoding and purge worker (ADR-0020).

Uploaded originals sit in the PRIVATE R2 bucket at ``video/<id>/original``. For
each video the database hands out (``video_job_claim``, leased, SKIP LOCKED, at
most three attempts) the worker:

  1. downloads the original and checks its size against the database;
  2. probes it with ffprobe, forcing the demuxer the declared type allows and
     reading local files only, so a crafted container cannot make ffmpeg open a
     URL or another file;
  3. refuses media with no video stream or longer than the limit;
  4. writes adaptive HLS (fMP4, 360p/720p/1080p, never above the source) and a
     poster frame;
  5. uploads the outputs to ``video/<id>/<revision>/`` with a fresh revision, and
  6. calls ``video_job_finish``. A video deleted meanwhile stays deleted; the
     purge removes what was written.

The purge (``--purge``) removes deleted and expired videos: it aborts any
unfinished multipart upload, deletes every object under ``video/<id>/`` and
marks the row purged. It is the ONLY path that deletes video bytes.

Bytes never pass through Supabase or Vercel: R2 to this worker, and R2 to the
viewer through the media Worker. Redis only wakes the worker sooner; the
database decides which job runs.

    uv run --group video-worker python -m app.workers.video_transcode --once
    uv run --group video-worker python -m app.workers.video_transcode --loop
    uv run --group video-worker python -m app.workers.video_transcode --purge
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import structlog

log = structlog.get_logger(__name__)

# No product limit on length or size (ADR-0020 Revision 2). What remains is
# technical: ffmpeg's time budget grows with the video, the lease is renewed while
# it runs, and the host needs disk for the original plus its outputs.
LEASE_SECONDS = 900
LEASE_RENEW_SECONDS = 300
FFMPEG_MIN_TIMEOUT_SECONDS = 1500
# Three renditions on a small CPU run at about one to three times real time.
FFMPEG_SECONDS_PER_MEDIA_SECOND = 8
PROBE_TIMEOUT_SECONDS = 60
# Original + renditions (at most about its own size again) + headroom.
DISK_FACTOR = 2.5
SEGMENT_SECONDS = 4

# Closed set, mirrored by the media Worker's file pattern (edge/media-worker/src/video.ts).
RENDITIONS: tuple[tuple[str, int, str, str], ...] = (
    # name, short side, video bitrate, max rate
    ("360p", 360, "800k", "1200k"),
    ("720p", 720, "2800k", "4200k"),
    ("1080p", 1080, "5000k", "7500k"),
)
OUTPUT_FILE = re.compile(
    r"^(?:master\.m3u8|poster\.jpg|(?:360p|720p|1080p)/(?:index\.m3u8|init\.mp4|seg_\d{5}\.m4s))$"
)
CONTENT_TYPES = {
    ".m3u8": "application/vnd.apple.mpegurl",
    ".jpg": "image/jpeg",
    ".mp4": "video/mp4",
    ".m4s": "video/iso.segment",
}
# The demuxer each accepted upload type may use. Never auto-detected.
DEMUXERS = {"video/mp4": "mov", "video/quicktime": "mov", "video/webm": "matroska"}
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class MediaRejected(Exception):
    """The upload itself is unusable. Not retried."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class JobClient(Protocol):
    def rpc(self, name: str, params: dict[str, Any]) -> Any: ...


class VideoStore(Protocol):
    def download(self, key: str, target: Path) -> int: ...
    def upload(self, source: Path, key: str, content_type: str) -> None: ...
    def delete_prefix(self, prefix: str) -> int: ...
    def abort_multipart(self, key: str, upload_id: str) -> None: ...


class SupabaseJobClient:
    def __init__(self, client: Any) -> None:
        self._client = client

    def rpc(self, name: str, params: dict[str, Any]) -> Any:
        return self._client.rpc(name, params).execute().data


class S3VideoStore:
    """The private R2 bucket (or the local S3 stand-in) through boto3."""

    def __init__(self, client: Any, bucket: str) -> None:
        self._client = client
        self._bucket = bucket

    @classmethod
    def from_settings(cls, settings: Any) -> S3VideoStore:
        import boto3
        from botocore.config import Config

        if not (
            settings.r2_endpoint
            and settings.r2_access_key_id
            and settings.r2_secret_access_key
            and settings.r2_private_bucket
        ):
            raise RuntimeError("R2 is not configured for the video worker")
        client = boto3.client(
            "s3",
            endpoint_url=settings.r2_endpoint,
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            region_name="auto",
            config=Config(
                retries={"max_attempts": 4, "mode": "standard"}, s3={"addressing_style": "path"}
            ),
        )
        return cls(client, settings.r2_private_bucket)

    def download(self, key: str, target: Path) -> int:
        self._client.download_file(self._bucket, key, str(target))
        return target.stat().st_size

    def upload(self, source: Path, key: str, content_type: str) -> None:
        self._client.upload_file(
            str(source),
            self._bucket,
            key,
            ExtraArgs={
                "ContentType": content_type,
                "CacheControl": "private, max-age=31536000, immutable",
            },
        )

    def delete_prefix(self, prefix: str) -> int:
        if not re.match(r"^video/[0-9a-f-]{36}/$", prefix):
            raise ValueError("refusing to delete outside one video's prefix")
        deleted = 0
        paginator = self._client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix):
            keys = [{"Key": o["Key"]} for o in page.get("Contents", [])]
            if keys:
                self._client.delete_objects(
                    Bucket=self._bucket, Delete={"Objects": keys, "Quiet": True}
                )
                deleted += len(keys)
        return deleted

    def abort_multipart(self, key: str, upload_id: str) -> None:
        try:
            self._client.abort_multipart_upload(Bucket=self._bucket, Key=key, UploadId=upload_id)
        except self._client.exceptions.NoSuchUpload:
            pass


@dataclass(frozen=True)
class Probe:
    duration: float
    width: int
    height: int
    has_audio: bool


Runner = Callable[[Sequence[str], int], subprocess.CompletedProcess[bytes]]


def run(args: Sequence[str], timeout: int) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(list(args), capture_output=True, timeout=timeout, check=False)


def _input_args(content_type: str, source: Path) -> list[str]:
    demuxer = DEMUXERS.get(content_type)
    if demuxer is None:
        raise MediaRejected("invalid_media")
    return ["-protocol_whitelist", "file", "-f", demuxer, "-i", f"file:{source}"]


def probe(source: Path, content_type: str, runner: Runner = run) -> Probe:
    done = runner(
        [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            *_input_args(content_type, source),
        ],
        PROBE_TIMEOUT_SECONDS,
    )
    if done.returncode != 0:
        raise MediaRejected("invalid_media")
    try:
        data = json.loads(done.stdout)
    except ValueError as error:
        raise MediaRejected("invalid_media") from error
    streams = data.get("streams") or []
    video = next(
        (
            s
            for s in streams
            if s.get("codec_type") == "video"
            and not (s.get("disposition") or {}).get("attached_pic")
        ),
        None,
    )
    if video is None:
        raise MediaRejected("no_video_stream")
    try:
        duration = float((data.get("format") or {}).get("duration") or video.get("duration") or 0)
        width, height = int(video["width"]), int(video["height"])
    except (KeyError, TypeError, ValueError) as error:
        raise MediaRejected("invalid_media") from error
    if duration <= 0 or width <= 0 or height <= 0:
        raise MediaRejected("invalid_media")
    if abs(_rotation(video)) % 180 == 90:
        width, height = height, width
    return Probe(
        duration=round(duration, 3),
        width=width,
        height=height,
        has_audio=any(s.get("codec_type") == "audio" for s in streams),
    )


def _rotation(stream: dict[str, Any]) -> int:
    for side in stream.get("side_data_list") or []:
        if "rotation" in side:
            try:
                return int(side["rotation"])
            except (TypeError, ValueError):
                return 0
    try:
        return int((stream.get("tags") or {}).get("rotate", 0))
    except (TypeError, ValueError):
        return 0


def plan_renditions(width: int, height: int) -> list[tuple[str, int, str, str]]:
    """Every rendition no larger than the source; a small source gets one, at its own size."""
    short = min(width, height)
    chosen = [r for r in RENDITIONS if r[1] <= short]
    return chosen or [RENDITIONS[0]]


def _scale(target: tuple[str, int, str, str], info: Probe) -> str:
    short = min(target[1], min(info.width, info.height))
    short -= short % 2
    # ffmpeg auto-rotates, so the filter sees display orientation.
    return f"scale=-2:{short}" if info.width >= info.height else f"scale={short}:-2"


def transcode_command(
    source: Path,
    content_type: str,
    out: Path,
    info: Probe,
    renditions: list[tuple[str, int, str, str]],
    codec: str = "h264",
) -> list[str]:
    """H.264/AAC: what every browser and native iOS HLS plays. "vp9" (VP9/Opus) exists
    only for local tests: open-source Chromium, the automated test browser, has no
    H.264 or AAC decoder. main() refuses it outside APP_ENV=local."""
    if codec not in ("h264", "vp9"):
        raise ValueError("unknown codec")
    n = len(renditions)
    labels = "".join(f"[v{i}]" for i in range(n))
    graph = [f"[0:v:0]split={n}{labels}"] + [
        f"[v{i}]{_scale(r, info)},setsar=1[o{i}]" for i, r in enumerate(renditions)
    ]
    args = [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        *_input_args(content_type, source),
        "-filter_complex",
        ";".join(graph),
    ]
    stream_map = []
    for i, (name, _short, rate, maxrate) in enumerate(renditions):
        args += [
            "-map",
            f"[o{i}]",
            f"-c:v:{i}",
            "libx264" if codec == "h264" else "libvpx-vp9",
            f"-b:v:{i}",
            rate,
            f"-maxrate:v:{i}",
            maxrate,
            f"-bufsize:v:{i}",
            maxrate,
        ]
        if info.has_audio:
            audio = ["aac", "128k"] if codec == "h264" else ["libopus", "96k"]
            args += [
                "-map",
                "0:a:0",
                f"-c:a:{i}",
                audio[0],
                f"-b:a:{i}",
                audio[1],
                f"-ac:a:{i}",
                "2",
            ]
            stream_map.append(f"v:{i},a:{i},name:{name}")
        else:
            stream_map.append(f"v:{i},name:{name}")
    if codec == "h264":
        args += ["-preset", "veryfast", "-profile:v", "main"]
    else:
        args += ["-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1"]
    args += [
        "-pix_fmt",
        "yuv420p",
        "-sc_threshold",
        "0",
        "-force_key_frames",
        f"expr:gte(t,n_forced*{SEGMENT_SECONDS // 2})",
        "-map_metadata",
        "-1",
        "-map_chapters",
        "-1",
        "-f",
        "hls",
        "-hls_time",
        str(SEGMENT_SECONDS),
        "-hls_playlist_type",
        "vod",
        "-hls_segment_type",
        "fmp4",
        "-hls_flags",
        "independent_segments",
        "-hls_fmp4_init_filename",
        "init.mp4",
        "-hls_segment_filename",
        f"{out}/%v/seg_%05d.m4s",
        "-master_pl_name",
        "master.m3u8",
        "-var_stream_map",
        " ".join(stream_map),
        f"{out}/%v/index.m3u8",
    ]
    return args


def poster_command(source: Path, content_type: str, target: Path, info: Probe) -> list[str]:
    at = min(1.0, info.duration / 2)
    return [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{at:.3f}",
        *_input_args(content_type, source),
        "-frames:v",
        "1",
        "-vf",
        "scale='min(1280,iw)':-2",
        "-q:v",
        "3",
        "-map_metadata",
        "-1",
        str(target),
    ]


def normalize_outputs(out: Path, names: list[str]) -> None:
    """ffmpeg names each init segment init_<n>.mp4; the Worker serves init.mp4."""
    for name in names:
        folder = out / name
        inits = list(folder.glob("init*.mp4"))
        if len(inits) != 1:
            raise RuntimeError(f"expected one init segment for {name}")
        inits[0].rename(folder / "init.mp4")
        playlist = folder / "index.m3u8"
        text = re.sub(r'URI="init[^"]*\.mp4"', 'URI="init.mp4"', playlist.read_text())
        playlist.write_text(text)


def output_files(out: Path) -> list[str]:
    files = sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file())
    stray = [f for f in files if not OUTPUT_FILE.match(f)]
    if stray:
        raise RuntimeError(f"unexpected output files: {stray[:3]}")
    return files


@dataclass
class JobResult:
    video_id: str
    outcome: str  # ready | rejected | retry
    detail: str = ""


class InsufficientDisk(RuntimeError):
    """The worker host lacks the disk this job needs; the job is retried, not rejected."""


def ffmpeg_timeout(duration: float) -> int:
    return max(FFMPEG_MIN_TIMEOUT_SECONDS, int(duration * FFMPEG_SECONDS_PER_MEDIA_SECOND) + 600)


class LeaseHeartbeat:
    """Renews the job's lease while a long video is processed, so another worker
    does not take it over. Stops when the job is gone (deleted meanwhile)."""

    def __init__(self, jobs: JobClient, video_id: str, every: float = LEASE_RENEW_SECONDS) -> None:
        self._jobs, self._id, self._every = jobs, video_id, every
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="video-lease", daemon=True)

    def _run(self) -> None:
        while not self._stop.wait(self._every):
            try:
                if not self._jobs.rpc(
                    "video_job_renew", {"p_id": self._id, "p_lease_seconds": LEASE_SECONDS}
                ):
                    return
            except Exception as error:  # noqa: BLE001 - a missed renewal only risks a retry
                log.warning(
                    "video.lease_renew_failed", video=_ref(self._id), error=type(error).__name__
                )

    def __enter__(self) -> LeaseHeartbeat:
        self._thread.start()
        return self

    def __exit__(self, *_: object) -> None:
        self._stop.set()
        self._thread.join(timeout=5)


def process_one(
    jobs: JobClient,
    store: VideoStore,
    runner: Runner = run,
    workdir: Path | None = None,
    codec: str = "h264",
) -> JobResult | None:
    jobs.rpc("video_job_expire", {})
    claimed = jobs.rpc("video_job_claim", {"p_lease_seconds": LEASE_SECONDS}) or []
    if not claimed:
        return None
    job = claimed[0]
    video_id = str(job["id"])
    if not UUID.match(video_id):
        raise RuntimeError("database returned an invalid video id")
    content_type, size = str(job["content_type"]), int(job["size_bytes"] or 0)
    started = time.monotonic()
    heartbeat = LeaseHeartbeat(jobs, video_id)
    with tempfile.TemporaryDirectory(prefix="video-", dir=workdir) as tmp, heartbeat:
        root = Path(tmp)
        source, out = root / "original", root / "out"
        try:
            free = shutil.disk_usage(root).free
            if free < size * DISK_FACTOR:
                # The host is too small for this file, not the file too big: retry later.
                raise InsufficientDisk(f"needs {size * DISK_FACTOR:.0f} bytes, has {free}")
            if store.download(f"video/{video_id}/original", source) != size:
                raise MediaRejected("upload_incomplete")
            info = probe(source, content_type, runner)
            renditions = plan_renditions(info.width, info.height)
            names = [r[0] for r in renditions]
            for name in names:
                (out / name).mkdir(parents=True)
            done = runner(
                transcode_command(source, content_type, out, info, renditions, codec),
                ffmpeg_timeout(info.duration),
            )
            if done.returncode != 0:
                raise RuntimeError(f"ffmpeg failed: {done.stderr[-400:].decode(errors='replace')}")
            normalize_outputs(out, names)
            poster = runner(
                poster_command(source, content_type, out / "poster.jpg", info),
                PROBE_TIMEOUT_SECONDS,
            )
            has_poster = poster.returncode == 0 and (out / "poster.jpg").is_file()
            if not has_poster:
                (out / "poster.jpg").unlink(missing_ok=True)
            files = output_files(out)
            revision = str(uuid.uuid4())
            # Playlists last: nothing references a segment that is not stored yet.
            for name in sorted(files, key=lambda f: f.endswith(".m3u8")):
                suffix = name[name.rfind(".") :]
                store.upload(
                    out / name, f"video/{video_id}/{revision}/{name}", CONTENT_TYPES[suffix]
                )
            jobs.rpc(
                "video_job_finish",
                {
                    "p_id": video_id,
                    "p_revision": revision,
                    "p_duration": info.duration,
                    "p_width": info.width,
                    "p_height": info.height,
                    "p_renditions": names,
                    "p_has_poster": has_poster,
                },
            )
            log.info(
                "video.ready",
                video=_ref(video_id),
                renditions=names,
                seconds=round(time.monotonic() - started, 1),
            )
            return JobResult(video_id, "ready")
        except MediaRejected as rejected:
            jobs.rpc(
                "video_job_fail", {"p_id": video_id, "p_code": rejected.code, "p_retry": False}
            )
            log.info("video.rejected", video=_ref(video_id), code=rejected.code)
            return JobResult(video_id, "rejected", rejected.code)
        except Exception as error:  # noqa: BLE001 - any other failure is retried by the lease
            jobs.rpc(
                "video_job_fail", {"p_id": video_id, "p_code": "transcode_failed", "p_retry": True}
            )
            log.warning(
                "video.retry",
                video=_ref(video_id),
                error=type(error).__name__,
                detail=str(error)[:200],
            )
            return JobResult(video_id, "retry", type(error).__name__)


def purge(jobs: JobClient, store: VideoStore, limit: int = 50) -> int:
    purged = 0
    for row in jobs.rpc("video_purge_candidates", {"p_limit": limit}) or []:
        video_id = str(row["id"])
        if not UUID.match(video_id):
            raise RuntimeError("database returned an invalid video id")
        if row.get("upload_id"):
            store.abort_multipart(f"video/{video_id}/original", str(row["upload_id"]))
        store.delete_prefix(f"video/{video_id}/")
        jobs.rpc("video_mark_purged", {"p_id": video_id})
        purged += 1
    if purged:
        log.info("video.purged", count=purged)
    return purged


def _ref(video_id: str) -> str:
    return hashlib.sha256(video_id.encode()).hexdigest()[:12]


def queue_key(env: str) -> str:
    """Same key the app pushes to: cacheKey("jobs", "global", "video")."""
    digest = hashlib.sha256(json.dumps(["video"], separators=(",", ":")).encode()).hexdigest()[:32]
    return f"aladdin:{env}:v1:jobs:global:{digest}"


def loop(
    jobs: JobClient,
    store: VideoStore,
    redis_client: Any | None,
    key: str,
    idle_seconds: int = 30,
    stop: Callable[[], bool] = lambda: False,
) -> None:
    last_purge = 0.0
    while not stop():
        while process_one(jobs, store) is not None:
            if stop():
                return
        if time.monotonic() - last_purge > 600:
            purge(jobs, store)
            last_purge = time.monotonic()
        if redis_client is not None:
            try:
                redis_client.blpop([key], timeout=idle_seconds)
                continue
            except Exception:  # noqa: BLE001 - Redis is only a wake-up; fall back to polling
                log.warning("video.queue_unavailable")
        time.sleep(idle_seconds)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--once", action="store_true", help="process at most one video")
    mode.add_argument(
        "--loop", action="store_true", help="keep processing; wake on the Redis queue"
    )
    mode.add_argument("--purge", action="store_true", help="remove deleted and expired videos")
    parser.add_argument(
        "--test-codec",
        choices=["vp9"],
        help="local tests only: VP9/Opus for a browser without H.264 (APP_ENV=local)",
    )
    args = parser.parse_args(argv)

    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        print("ffmpeg and ffprobe must be installed", file=sys.stderr)
        return 2
    from app.config import get_settings
    from app.database import create_service_client

    settings = get_settings()
    if args.test_codec and settings.app_env != "local":
        print("--test-codec is only allowed with APP_ENV=local", file=sys.stderr)
        return 2
    codec = args.test_codec or "h264"
    jobs = SupabaseJobClient(create_service_client(settings))
    store = S3VideoStore.from_settings(settings)
    if args.once:
        result = process_one(jobs, store, codec=codec)
        print(json.dumps(result.__dict__ if result else {"outcome": "idle"}))
        return 0 if result is None or result.outcome != "retry" else 1
    if args.purge:
        print(json.dumps({"purged": purge(jobs, store, limit=500)}))
        return 0
    redis_client = None
    if settings.redis_url:
        import redis

        # A blocking pop needs a socket timeout longer than its own wait.
        redis_client = redis.Redis.from_url(
            settings.redis_url,
            socket_connect_timeout=2,
            socket_timeout=45,
            health_check_interval=30,
        )
    loop(jobs, store, redis_client, queue_key(settings.redis_key_env or settings.app_env))
    return 0


if __name__ == "__main__":
    sys.exit(main())
