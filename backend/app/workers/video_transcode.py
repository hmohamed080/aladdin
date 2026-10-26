"""Video transcoding and purge worker (ADR-0020).

Uploaded originals sit in the PRIVATE R2 bucket at ``video/<id>/original``. For
each video the database hands out (``video_job_claim``, leased, SKIP LOCKED, at
most three attempts) the worker:

  1. checks the original's size against the database and reads it from a local
     copy when the disk holds it, or else straight from R2 over a presigned
     HTTPS URL for that one object, so no size depends on the host's disk;
  2. probes it with ffprobe, forcing the demuxer the declared type allows and
     whitelisting only that demuxer and the input's own protocol (``file``, or
     ``https,tls,tcp`` for the URL), so a crafted container cannot make ffmpeg
     open another URL or file;
  3. refuses media with no video stream;
  4. writes adaptive HLS (fMP4, 360p/720p/1080p, never above the source) and a
     poster frame, uploading each finished segment to ``video/<id>/<revision>/``
     (a fresh revision) and deleting it locally while ffmpeg runs, so outputs
     never pile up on disk; playlists go last, and
  5. calls ``video_job_finish``. A video deleted meanwhile stays deleted; the
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
    uv run --group video-worker python -m app.workers.video_transcode --drain

``--drain`` is for hosts that start the worker on demand and bill while it runs
(Cloudflare Containers, docs/architecture/video-transcode-cloudflare-containers.md):
it processes every claimable video, purges, and exits. On SIGTERM it stops ffmpeg,
releases the job for a retry and exits.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import signal
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
# technical: ffmpeg's time budget grows with the video and the lease is renewed
# while it runs. Disk no longer bounds the size: segments leave the disk as they
# are written, and an original the disk cannot hold is read from R2 over HTTPS.
LEASE_SECONDS = 900
LEASE_RENEW_SECONDS = 300
FFMPEG_MIN_TIMEOUT_SECONDS = 1500
# Three renditions on a small CPU run at about one to three times real time.
FFMPEG_SECONDS_PER_MEDIA_SECOND = 8
PROBE_TIMEOUT_SECONDS = 60
# Room for what stays on disk while ffmpeg runs: the newest segment of each
# rendition, init segments, playlists, the poster and ffmpeg's error log. A few
# MB in practice; generous so a slow upload never fills the disk.
OUTPUT_HEADROOM_BYTES = 1024**3
# How often finished segments are uploaded while ffmpeg works.
UPLOAD_EVERY_SECONDS = 2.0
# A presigned URL outlives the ffmpeg run that uses it by this much. SigV4 (and
# R2) refuse more than 7 days.
URL_SLACK_SECONDS = 300
URL_MAX_SECONDS = 7 * 24 * 3600
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
# The protocols an input URL may use, by scheme. http only reaches the local S3
# stand-in (S3VideoStore refuses it otherwise). Never file, crypto or hls.
URL_PROTOCOLS = {"https": "https,tls,tcp", "http": "http,tcp"}
# ffmpeg 5.1 (Debian bookworm, the image) knows all of these. A dropped connection
# or a 5xx resumes at the same byte with a Range request; a 403 (such as an expired
# URL) fails at once; a read stalled for 60 s counts as a dropped connection.
# What ffmpeg prints when the HTTP layer, not the media, fails.
NETWORK_ERROR = re.compile(
    r"Server returned|HTTP error|Connection (?:refused|reset|timed out)|"
    r"Input/output error|Network is unreachable|Failed to resolve|timed out",
    re.IGNORECASE,
)
RECONNECT = [
    "-reconnect",
    "1",
    "-reconnect_on_network_error",
    "1",
    "-reconnect_on_http_error",
    "5xx",
    "-reconnect_delay_max",
    "30",
    "-rw_timeout",
    "60000000",
]
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
    def size(self, key: str) -> int: ...
    def presign_get(self, key: str, seconds: int) -> str: ...
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

    def __init__(self, client: Any, bucket: str, allow_http: bool = False) -> None:
        self._client = client
        self._bucket = bucket
        self._allow_http = allow_http

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
                retries={"max_attempts": 4, "mode": "standard"},
                s3={"addressing_style": "path"},
                signature_version="s3v4",
            ),
        )
        # Only the local S3 stand-in speaks plain HTTP; config refuses it outside local.
        return cls(
            client, settings.r2_private_bucket, allow_http=bool(settings.r2_local_s3_endpoint)
        )

    def download(self, key: str, target: Path) -> int:
        self._client.download_file(self._bucket, key, str(target))
        return target.stat().st_size

    def size(self, key: str) -> int:
        return int(self._client.head_object(Bucket=self._bucket, Key=key)["ContentLength"])

    def presign_get(self, key: str, seconds: int) -> str:
        """A GET for this one object only (SigV4 signs the key), valid for `seconds`.
        It is a credential: hand it to ffmpeg, never log it."""
        url = str(
            self._client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self._bucket, "Key": key},
                ExpiresIn=max(1, min(seconds, URL_MAX_SECONDS)),
            )
        )
        if not (url.startswith("https://") or (self._allow_http and url.startswith("http://"))):
            raise RuntimeError("refusing a storage URL that is not HTTPS")
        return url

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
# Like Runner, calling the third argument every few seconds while the process runs.
Transcoder = Callable[[Sequence[str], int, Callable[[], None]], subprocess.CompletedProcess[bytes]]
# A local copy of the original, or a presigned URL to it in R2.
Source = Path | str


def run(args: Sequence[str], timeout: int) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(list(args), capture_output=True, timeout=timeout, check=False)


class FfmpegTimeout(RuntimeError):
    """ffmpeg exceeded its budget. Unlike subprocess.TimeoutExpired, the message does
    not carry the command line, which may hold a presigned URL."""


STDERR_KEEP_BYTES = 64 * 1024


def run_ticking(
    args: Sequence[str],
    timeout: int,
    tick: Callable[[], None],
    every: float = UPLOAD_EVERY_SECONDS,
) -> subprocess.CompletedProcess[bytes]:
    """Runs ffmpeg, calling tick() (the segment upload) every few seconds from this
    thread. Any exception, from tick(), the timeout or Terminated, kills ffmpeg first.
    stderr goes to a file, so a long run can never block on a full pipe."""
    deadline = time.monotonic() + timeout
    with tempfile.TemporaryFile() as err:
        process = subprocess.Popen(
            list(args), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=err
        )
        try:
            while True:
                try:
                    code = process.wait(timeout=every)
                    break
                except subprocess.TimeoutExpired:
                    pass
                if time.monotonic() > deadline:
                    raise FfmpegTimeout(f"ffmpeg ran longer than {timeout} s")
                tick()
        except BaseException:
            process.kill()
            process.wait()
            raise
        length = err.seek(0, 2)
        err.seek(max(0, length - STDERR_KEEP_BYTES))
        tail = err.read()
        if length > STDERR_KEEP_BYTES:
            tail = tail.partition(b"\n")[2]  # never start inside a line, or a URL
        return subprocess.CompletedProcess(list(args), code, b"", tail)


_SECRET = re.compile(r"[a-z][a-z0-9+.-]*://\S+|X-Amz-[A-Za-z-]+=[^&\s'\"]*", re.IGNORECASE)


def redact(text: str) -> str:
    """Removes URLs and SigV4 query parameters: ffmpeg echoes a failing input URL,
    signature included. Redact before truncating, or a cut may keep part of one."""
    return _SECRET.sub("<redacted>", text)


def _input_args(content_type: str, source: Source) -> list[str]:
    demuxer = DEMUXERS.get(content_type)
    if demuxer is None:
        raise MediaRejected("invalid_media")
    # Both whitelists also bind anything the demuxer opens in turn, so a crafted
    # file cannot reach HLS, concat or another URL or file.
    if isinstance(source, Path):
        protocols, target, network = "file", f"file:{source}", []
    else:
        protocols = URL_PROTOCOLS.get(source.partition("://")[0])
        if protocols is None:
            raise ValueError("an input URL must be http(s)")
        target, network = source, RECONNECT
    return [
        "-protocol_whitelist",
        protocols,
        "-format_whitelist",
        demuxer,
        *network,
        "-f",
        demuxer,
        "-i",
        target,
    ]


def probe(source: Source, content_type: str, runner: Runner = run) -> Probe:
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
        if isinstance(source, str) and NETWORK_ERROR.search(done.stderr.decode(errors="replace")):
            # R2 unreachable, a 5xx after the reconnects, or an expired URL: the
            # storage failed, not the media, so the job is retried.
            raise RuntimeError("could not read the original from storage")
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
    source: Source,
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


def poster_command(source: Source, content_type: str, target: Path, info: Probe) -> list[str]:
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


class SegmentUploader:
    """Moves finished media segments to R2 while ffmpeg runs, so the disk holds only
    a segment or two per rendition at any time, however long the video.

    A rendition's newest segment may still be being written; every older one is
    complete (ffmpeg writes a rendition's segments one after another). After ffmpeg
    exits, flush(final=True) takes the rest. Playlists, init segments and the poster
    stay on disk for the caller to upload last."""

    def __init__(self, store: VideoStore, out: Path, prefix: str, names: list[str]) -> None:
        self._store, self._out, self._prefix, self._names = store, out, prefix, names
        self.uploaded: set[str] = set()

    def flush(self, final: bool = False) -> None:
        for name in self._names:
            segments = sorted((self._out / name).glob("seg_*.m4s"))
            for segment in segments if final else segments[:-1]:
                relative = f"{name}/{segment.name}"
                if not OUTPUT_FILE.match(relative):
                    raise RuntimeError("unexpected output file")
                self._store.upload(segment, self._prefix + relative, CONTENT_TYPES[".m4s"])
                segment.unlink()
                self.uploaded.add(relative)

    def check_playlists(self) -> None:
        """Every segment a playlist names was uploaded (they are no longer on disk)."""
        for name in self._names:
            text = (self._out / name / "index.m3u8").read_text()
            uris = [line for line in text.splitlines() if line and not line.startswith("#")]
            missing = [u for u in uris if f"{name}/{u}" not in self.uploaded]
            if not uris or missing:
                raise RuntimeError(f"playlist {name} names segments that were not uploaded")


def read_locally(size: int, free: int) -> bool:
    """True: download the original and read it from disk (the common case, and ffmpeg
    stays on file: only). False: read it from R2 over HTTPS, so its size never
    depends on this host's disk. Raises when even the outputs' headroom is missing."""
    if free < OUTPUT_HEADROOM_BYTES:
        raise InsufficientDisk(f"needs {OUTPUT_HEADROOM_BYTES} bytes free, has {free}")
    return free >= size + OUTPUT_HEADROOM_BYTES


def url_seconds(timeout: int) -> int:
    """A presigned URL lives as long as the ffmpeg run that reads it, plus slack."""
    return min(URL_MAX_SECONDS, timeout + URL_SLACK_SECONDS)


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
    transcoder: Transcoder = run_ticking,
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
            key = f"video/{video_id}/original"
            # A host short of disk is too small for the job, not the file too big:
            # InsufficientDisk retries later.
            local = read_locally(size, shutil.disk_usage(root).free)
            if (store.download(key, source) if local else store.size(key)) != size:
                raise MediaRejected("upload_incomplete")

            def input_for(timeout: int) -> Source:
                # A fresh URL per ffmpeg run, living as long as that run may.
                return source if local else store.presign_get(key, url_seconds(timeout))

            info = probe(input_for(PROBE_TIMEOUT_SECONDS), content_type, runner)
            renditions = plan_renditions(info.width, info.height)
            names = [r[0] for r in renditions]
            for name in names:
                (out / name).mkdir(parents=True)
            revision = str(uuid.uuid4())
            prefix = f"video/{video_id}/{revision}/"
            segments = SegmentUploader(store, out, prefix, names)
            timeout = ffmpeg_timeout(info.duration)
            done = transcoder(
                transcode_command(input_for(timeout), content_type, out, info, renditions, codec),
                timeout,
                segments.flush,
            )
            if done.returncode != 0:
                stderr = redact(done.stderr.decode(errors="replace"))
                raise RuntimeError(f"ffmpeg failed: {stderr[-400:]}")
            segments.flush(final=True)
            normalize_outputs(out, names)
            segments.check_playlists()
            poster = runner(
                poster_command(
                    input_for(PROBE_TIMEOUT_SECONDS), content_type, out / "poster.jpg", info
                ),
                PROBE_TIMEOUT_SECONDS,
            )
            has_poster = poster.returncode == 0 and (out / "poster.jpg").is_file()
            if not has_poster:
                (out / "poster.jpg").unlink(missing_ok=True)
            files = output_files(out)
            # Playlists last: nothing references a segment that is not stored yet.
            for name in sorted(files, key=lambda f: f.endswith(".m3u8")):
                suffix = name[name.rfind(".") :]
                store.upload(out / name, prefix + name, CONTENT_TYPES[suffix])
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
                source="local" if local else "r2",
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
                # A TimeoutExpired or ffmpeg message can carry the presigned URL.
                detail=redact(str(error))[:200],
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


class Terminated(Exception):
    """The host asked the worker to stop (SIGTERM). Raised inside the running job, so
    ffmpeg is killed, the job is released for a retry and the temp files are removed."""


def stop_on_sigterm() -> Callable[[], bool]:
    """Turns the first SIGTERM into Terminated in the main thread. As PID 1 in a
    container, Python would otherwise ignore SIGTERM until the platform's SIGKILL."""
    stopping = threading.Event()

    def handler(_signum: int, _frame: object) -> None:
        if not stopping.is_set():
            stopping.set()
            raise Terminated()

    signal.signal(signal.SIGTERM, handler)
    return stopping.is_set


def drain(
    jobs: JobClient,
    store: VideoStore,
    codec: str = "h264",
    stop: Callable[[], bool] = lambda: False,
) -> dict[str, int]:
    """Every claimable video, then the purge, then return: the container exits and
    stops billing. The database still decides which job runs (SKIP LOCKED leases)."""
    counts = {"ready": 0, "rejected": 0, "retry": 0, "purged": 0}
    while not stop():
        result = process_one(jobs, store, codec=codec)
        if result is None:
            break
        counts[result.outcome] += 1
    if not stop():
        counts["purged"] = purge(jobs, store, limit=500)
    return counts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--once", action="store_true", help="process at most one video")
    mode.add_argument(
        "--loop", action="store_true", help="keep processing; wake on the Redis queue"
    )
    mode.add_argument("--purge", action="store_true", help="remove deleted and expired videos")
    mode.add_argument(
        "--drain", action="store_true", help="process every waiting video, purge, then exit"
    )
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
    if args.drain:
        stopping = stop_on_sigterm()
        try:
            counts = drain(jobs, store, codec=codec, stop=stopping)
        except Terminated:
            # Between jobs: nothing is held that the lease would not release.
            counts = {}
        log.info("video.drained", **counts, terminated=stopping())
        print(json.dumps({**counts, "terminated": stopping()}))
        return 1 if counts.get("retry") else 0
    redis_client = None
    if settings.redis_active_url:
        from app.coordination import connect

        # The budget-tuned handshake (no CLIENT SETINFO, no health-check PING):
        # idle, the worker costs one BLPOP per wait (ADR-0019 command estimate).
        redis_client = connect(settings.redis_active_url, socket_timeout=45)
    loop(jobs, store, redis_client, queue_key(settings.redis_namespace))
    return 0


if __name__ == "__main__":
    sys.exit(main())
