"""Video worker: probe rules, rendition plan, output layout, job transitions, purge."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

import pytest

from app.workers import video_transcode as vt

VIDEO_ID = "11111111-2222-4333-8444-555555555555"
SIGNATURE = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


class FakeJobs:
    def __init__(
        self, claim: list[dict[str, Any]] | None = None, purge: list[dict[str, Any]] | None = None
    ):
        self.claim = claim or []
        self.purge_rows = purge or []
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def rpc(self, name: str, params: dict[str, Any]) -> Any:
        self.calls.append((name, params))
        if name == "video_job_claim":
            claim, self.claim = self.claim, []
            return claim
        if name == "video_purge_candidates":
            return self.purge_rows
        return None

    def last(self, name: str) -> dict[str, Any]:
        return [p for n, p in self.calls if n == name][-1]


class DirStore:
    """A bucket on disk."""

    def __init__(self, root: Path, url_base: str = "https://r2.test/bucket/") -> None:
        self.root = root
        self.url_base = url_base
        self.aborted: list[tuple[str, str]] = []
        self.types: dict[str, str] = {}
        self.downloads: list[str] = []
        self.presigned: list[tuple[str, int]] = []
        self.order: list[str] = []

    def put(self, key: str, data: bytes) -> None:
        (self.root / key).parent.mkdir(parents=True, exist_ok=True)
        (self.root / key).write_bytes(data)

    def download(self, key: str, target: Path) -> int:
        self.downloads.append(key)
        shutil.copyfile(self.root / key, target)
        return target.stat().st_size

    def size(self, key: str) -> int:
        return (self.root / key).stat().st_size

    def presign_get(self, key: str, seconds: int) -> str:
        self.presigned.append((key, seconds))
        return f"{self.url_base}{key}?X-Amz-Expires={seconds}&X-Amz-Signature={SIGNATURE}"

    def upload(self, source: Path, key: str, content_type: str) -> None:
        (self.root / key).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, self.root / key)
        self.types[key] = content_type
        self.order.append(key)

    def delete_prefix(self, prefix: str) -> int:
        target = self.root / prefix
        count = sum(1 for p in target.rglob("*") if p.is_file()) if target.exists() else 0
        shutil.rmtree(target, ignore_errors=True)
        return count

    def abort_multipart(self, key: str, upload_id: str) -> None:
        self.aborted.append((key, upload_id))

    def keys(self) -> list[str]:
        return sorted(
            p.relative_to(self.root).as_posix() for p in self.root.rglob("*") if p.is_file()
        )


def probe_output(
    streams: list[dict[str, Any]], duration: str = "12.5"
) -> subprocess.CompletedProcess[bytes]:
    body = json.dumps({"streams": streams, "format": {"duration": duration}}).encode()
    return subprocess.CompletedProcess([], 0, body, b"")


def fixed(result: subprocess.CompletedProcess[bytes]) -> vt.Runner:
    return lambda _args, _timeout: result


def test_probe_forces_the_demuxer_and_local_files_only():
    seen: list[list[str]] = []

    def runner(args: Any, _timeout: int) -> subprocess.CompletedProcess[bytes]:
        seen.append(list(args))
        return probe_output([{"codec_type": "video", "width": 1920, "height": 1080}])

    vt.probe(Path("/x/original"), "video/webm", runner)
    args = seen[0]
    assert args[args.index("-protocol_whitelist") + 1] == "file"
    assert args[args.index("-format_whitelist") + 1] == "matroska"
    assert args[args.index("-f") + 1] == "matroska"
    assert args[args.index("-i") + 1] == "file:/x/original"
    assert "-reconnect" not in args


def test_probe_rejects_unknown_types_without_running():
    with pytest.raises(vt.MediaRejected) as rejected:
        vt.probe(Path("/x"), "application/x-mpegurl", fixed(probe_output([])))
    assert rejected.value.code == "invalid_media"


@pytest.mark.parametrize(
    ("result", "code"),
    [
        (subprocess.CompletedProcess([], 1, b"", b"bad"), "invalid_media"),
        (subprocess.CompletedProcess([], 0, b"not json", b""), "invalid_media"),
        (probe_output([{"codec_type": "audio"}]), "no_video_stream"),
        (
            probe_output(
                [
                    {
                        "codec_type": "video",
                        "width": 10,
                        "height": 10,
                        "disposition": {"attached_pic": 1},
                    }
                ]
            ),
            "no_video_stream",
        ),
        (
            probe_output([{"codec_type": "video", "width": 640, "height": 360}], duration="0"),
            "invalid_media",
        ),
    ],
)
def test_probe_rejections(result: subprocess.CompletedProcess[bytes], code: str):
    with pytest.raises(vt.MediaRejected) as rejected:
        vt.probe(Path("/x"), "video/mp4", fixed(result))
    assert rejected.value.code == code


def test_long_videos_are_accepted_and_get_a_longer_ffmpeg_budget():
    info = vt.probe(
        Path("/x"),
        "video/mp4",
        fixed(
            probe_output([{"codec_type": "video", "width": 1920, "height": 1080}], duration="10800")
        ),
    )
    assert info.duration == 10800
    assert vt.ffmpeg_timeout(30) == vt.FFMPEG_MIN_TIMEOUT_SECONDS
    assert vt.ffmpeg_timeout(10800) == 10800 * vt.FFMPEG_SECONDS_PER_MEDIA_SECOND + 600


def test_a_host_without_disk_for_the_file_retries_instead_of_rejecting(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(vt.shutil, "disk_usage", lambda _p: type("U", (), {"free": 10})())
    jobs = FakeJobs(
        claim=[{"id": VIDEO_ID, "content_type": "video/mp4", "size_bytes": 1000, "attempts": 1}]
    )
    result = vt.process_one(jobs, DirStore(tmp_path / "bucket"))
    assert result is not None and result.outcome == "retry" and result.detail == "InsufficientDisk"
    assert jobs.last("video_job_fail")["p_retry"] is True


def test_the_lease_is_renewed_while_a_job_runs_and_stops_when_the_job_is_gone():
    renewals: list[dict[str, Any]] = []

    class Jobs:
        def rpc(self, name: str, params: dict[str, Any]) -> Any:
            renewals.append(params)
            return len(renewals) < 3  # the third renewal finds the video deleted

    with vt.LeaseHeartbeat(Jobs(), VIDEO_ID, every=0.01):
        time.sleep(0.2)
    assert len(renewals) == 3
    assert renewals[0] == {"p_id": VIDEO_ID, "p_lease_seconds": vt.LEASE_SECONDS}


def test_probe_uses_display_dimensions_for_rotated_phone_video():
    info = vt.probe(
        Path("/x"),
        "video/quicktime",
        fixed(
            probe_output(
                [
                    {
                        "codec_type": "video",
                        "width": 1920,
                        "height": 1080,
                        "side_data_list": [{"rotation": -90}],
                    },
                    {"codec_type": "audio"},
                ]
            )
        ),
    )
    assert (info.width, info.height, info.has_audio) == (1080, 1920, True)


def test_rendition_plan_never_upscales():
    assert [r[0] for r in vt.plan_renditions(3840, 2160)] == ["360p", "720p", "1080p"]
    assert [r[0] for r in vt.plan_renditions(1280, 720)] == ["360p", "720p"]
    assert [r[0] for r in vt.plan_renditions(1080, 1920)] == ["360p", "720p", "1080p"]
    assert [r[0] for r in vt.plan_renditions(320, 240)] == ["360p"]


def test_transcode_command_maps_audio_only_when_present():
    info = vt.Probe(duration=5, width=1280, height=720, has_audio=False)
    args = vt.transcode_command(
        Path("/s"), "video/mp4", Path("/o"), info, vt.plan_renditions(1280, 720)
    )
    assert "0:a:0" not in args
    assert args[args.index("-var_stream_map") + 1] == "v:0,name:360p v:1,name:720p"
    portrait = vt.Probe(duration=5, width=720, height=1280, has_audio=True)
    args = vt.transcode_command(
        Path("/s"), "video/mp4", Path("/o"), portrait, vt.plan_renditions(720, 1280)
    )
    graph = args[args.index("-filter_complex") + 1]
    assert "scale=360:-2" in graph and "scale=720:-2" in graph
    assert args[args.index("-var_stream_map") + 1] == "v:0,a:0,name:360p v:1,a:1,name:720p"


def test_queue_key_matches_the_app():
    # cacheKey("jobs", "global", "video") in frontend/src/server/cache/redis.ts
    assert (
        vt.queue_key("local")
        == "aladdin:local:v1:jobs:global:"
        + __import__("hashlib").sha256(b'["video"]').hexdigest()[:32]
    )


def test_short_original_is_rejected_without_transcoding(tmp_path: Path):
    store = DirStore(tmp_path / "bucket")
    store.put(f"video/{VIDEO_ID}/original", b"short")
    jobs = FakeJobs(
        claim=[{"id": VIDEO_ID, "content_type": "video/mp4", "size_bytes": 99, "attempts": 1}]
    )
    ran: list[Any] = []
    result = vt.process_one(jobs, store, runner=lambda a, t: ran.append(a))  # type: ignore[arg-type,func-returns-value]
    assert (
        result is not None and result.outcome == "rejected" and result.detail == "upload_incomplete"
    )
    assert jobs.last("video_job_fail") == {
        "p_id": VIDEO_ID,
        "p_code": "upload_incomplete",
        "p_retry": False,
    }
    assert ran == []


def test_unexpected_failure_is_retried(tmp_path: Path):
    store = DirStore(tmp_path / "bucket")
    jobs = FakeJobs(
        claim=[{"id": VIDEO_ID, "content_type": "video/mp4", "size_bytes": 5, "attempts": 1}]
    )
    result = vt.process_one(jobs, store)  # the original is missing: a storage error, not the media
    assert result is not None and result.outcome == "retry"
    assert jobs.last("video_job_fail")["p_retry"] is True


def test_idle_when_nothing_is_claimed(tmp_path: Path):
    jobs = FakeJobs()
    assert vt.process_one(jobs, DirStore(tmp_path)) is None
    assert [n for n, _ in jobs.calls] == ["video_job_expire", "video_job_claim"]


def test_purge_aborts_uploads_and_deletes_only_the_video_prefix(tmp_path: Path):
    store = DirStore(tmp_path / "bucket")
    other = "99999999-2222-4333-8444-555555555555"
    store.put(f"video/{VIDEO_ID}/original", b"x")
    store.put(f"video/{VIDEO_ID}/rev/master.m3u8", b"x")
    store.put(f"video/{other}/original", b"x")
    jobs = FakeJobs(purge=[{"id": VIDEO_ID, "upload_id": "up-1", "revision": None}])
    assert vt.purge(jobs, store) == 1
    assert store.aborted == [(f"video/{VIDEO_ID}/original", "up-1")]
    assert store.keys() == [f"video/{other}/original"]
    assert jobs.last("video_mark_purged") == {"p_id": VIDEO_ID}


def test_s3_store_refuses_a_prefix_wider_than_one_video():
    store = vt.S3VideoStore(client=object(), bucket="b")
    for prefix in ["video/", "", "video/../", f"video/{VIDEO_ID}"]:
        with pytest.raises(ValueError):
            store.delete_prefix(prefix)


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg not installed")
@pytest.mark.parametrize(
    ("size", "audio", "expected"),
    [
        ("1280x720", True, ["360p", "720p"]),
        ("360x640", False, ["360p"]),
    ],
)
def test_real_transcode_produces_the_layout_the_worker_serves(
    tmp_path: Path, size: str, audio: bool, expected: list[str]
):
    source = tmp_path / "sample.mp4"
    inputs = ["-f", "lavfi", "-i", f"testsrc2=size={size}:rate=25:duration=6"]
    if audio:
        inputs += ["-f", "lavfi", "-i", "sine=frequency=440:duration=6"]
    subprocess.run(
        [
            "ffmpeg",
            "-loglevel",
            "error",
            "-y",
            *inputs,
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            *(["-c:a", "aac", "-shortest"] if audio else []),
            str(source),
        ],
        check=True,
    )
    store = DirStore(tmp_path / "bucket")
    store.put(f"video/{VIDEO_ID}/original", source.read_bytes())
    jobs = FakeJobs(
        claim=[
            {
                "id": VIDEO_ID,
                "content_type": "video/mp4",
                "size_bytes": source.stat().st_size,
                "attempts": 1,
            }
        ]
    )
    result = vt.process_one(jobs, store, workdir=tmp_path)
    assert result is not None and result.outcome == "ready", result
    finish = jobs.last("video_job_finish")
    assert finish["p_renditions"] == expected and finish["p_has_poster"] is True
    assert 5.5 < finish["p_duration"] < 6.5
    prefix = f"video/{VIDEO_ID}/{finish['p_revision']}/"
    files = [k[len(prefix) :] for k in store.keys() if k.startswith(prefix)]
    assert all(vt.OUTPUT_FILE.match(f) for f in files)
    assert "master.m3u8" in files and "poster.jpg" in files
    for name in expected:
        assert f"{name}/init.mp4" in files and f"{name}/seg_00000.m4s" in files
        playlist = (store.root / prefix / name / "index.m3u8").read_text()
        assert '#EXT-X-MAP:URI="init.mp4"' in playlist
        uris = [line for line in playlist.splitlines() if line and not line.startswith("#")]
        assert uris and all(re.fullmatch(r"seg_\d{5}\.m4s", u) for u in uris)
    master = (store.root / prefix / "master.m3u8").read_text()
    assert [line for line in master.splitlines() if line and not line.startswith("#")] == [
        f"{n}/index.m3u8" for n in expected
    ]
    assert store.types[prefix + "master.m3u8"] == "application/vnd.apple.mpegurl"
    assert store.types[prefix + f"{expected[0]}/seg_00000.m4s"] == "video/iso.segment"


def test_vp9_test_codec_is_a_separate_local_only_path():
    info = vt.Probe(duration=5, width=1280, height=720, has_audio=True)
    args = vt.transcode_command(
        Path("/s"), "video/mp4", Path("/o"), info, vt.plan_renditions(1280, 720), "vp9"
    )
    assert "libvpx-vp9" in args and "libopus" in args
    assert "libx264" not in args and "-profile:v" not in args
    with pytest.raises(ValueError):
        vt.transcode_command(Path("/s"), "video/mp4", Path("/o"), info, [], "hevc")


def test_test_codec_is_refused_outside_local(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
):
    from app.config import Settings

    monkeypatch.setattr("shutil.which", lambda _name: "/usr/bin/ffmpeg")
    monkeypatch.setattr(
        "app.config.get_settings",
        lambda: Settings(
            app_env="staging",
            supabase_url="x",
            supabase_service_role_key="x",
            supabase_jwt_secret="x",
            database_url="x",
        ),
    )
    assert vt.main(["--once", "--test-codec", "vp9"]) == 2
    assert "only allowed" in capsys.readouterr().err


def test_drain_processes_until_idle_then_purges(tmp_path: Path):
    jobs = FakeJobs(
        claim=[{"id": VIDEO_ID, "content_type": "video/mp4", "size_bytes": 5, "attempts": 1}]
    )
    counts = vt.drain(jobs, DirStore(tmp_path))  # the original is missing: one retry
    assert counts == {"ready": 0, "rejected": 0, "retry": 1, "purged": 0}
    names = [n for n, _ in jobs.calls]
    assert names.count("video_job_claim") == 2  # stops at the first empty claim
    assert names[-1] == "video_purge_candidates"


def test_drain_stops_before_claiming_when_asked(tmp_path: Path):
    jobs = FakeJobs(
        claim=[{"id": VIDEO_ID, "content_type": "video/mp4", "size_bytes": 5, "attempts": 1}]
    )
    assert vt.drain(jobs, DirStore(tmp_path), stop=lambda: True)["purged"] == 0
    assert jobs.calls == []


def test_sigterm_stops_ffmpeg_and_raises_inside_the_job():
    import os
    import signal
    import threading

    previous = signal.getsignal(signal.SIGTERM)
    try:
        stopping = vt.stop_on_sigterm()
        threading.Timer(0.3, os.kill, (os.getpid(), signal.SIGTERM)).start()
        started = time.monotonic()
        with pytest.raises(vt.Terminated):
            vt.run(["sleep", "30"], 60)  # stands in for ffmpeg
        assert stopping() and time.monotonic() - started < 10
    finally:
        signal.signal(signal.SIGTERM, previous)


def test_a_job_terminated_mid_transcode_is_released_for_retry(tmp_path: Path):
    store = DirStore(tmp_path / "bucket")
    store.put(f"video/{VIDEO_ID}/original", b"12345")
    jobs = FakeJobs(
        claim=[{"id": VIDEO_ID, "content_type": "video/mp4", "size_bytes": 5, "attempts": 1}]
    )

    def runner(_args: Any, _timeout: int) -> subprocess.CompletedProcess[bytes]:
        raise vt.Terminated()

    work = tmp_path / "work"
    work.mkdir()
    result = vt.process_one(jobs, store, runner=runner, workdir=work)
    assert result is not None and result.outcome == "retry" and result.detail == "Terminated"
    assert jobs.last("video_job_fail")["p_retry"] is True
    assert list(work.iterdir()) == []  # temp files removed


# --- Originals larger than the host's disk: read from R2 over HTTPS -------------------


def _job(size: int) -> list[dict[str, Any]]:
    return [{"id": VIDEO_ID, "content_type": "video/mp4", "size_bytes": size, "attempts": 1}]


def _free(monkeypatch: pytest.MonkeyPatch, free: int) -> None:
    monkeypatch.setattr(vt.shutil, "disk_usage", lambda _p: type("U", (), {"free": free})())


def test_a_url_input_allows_only_its_own_protocol_and_the_forced_demuxer():
    url = f"https://acct.r2.cloudflarestorage.com/b/video/x/original?X-Amz-Signature={SIGNATURE}"
    args = vt.transcode_command(
        url,
        "video/quicktime",
        Path("/o"),
        vt.Probe(duration=5, width=1280, height=720, has_audio=True),
        vt.plan_renditions(1280, 720),
    )
    assert args.count("-i") == 1 and args[args.index("-i") + 1] == url
    assert args.count("-protocol_whitelist") == 1
    assert args[args.index("-protocol_whitelist") + 1] == "https,tls,tcp"
    assert args[args.index("-format_whitelist") + 1] == "mov"
    assert args[args.index("-f") + 1] == "mov"
    # Input options sit before -i; reconnects resume only on network errors and 5xx.
    head = args[: args.index("-i")]
    assert head[head.index("-reconnect") + 1] == "1"
    assert head[head.index("-reconnect_on_http_error") + 1] == "5xx"
    assert "-rw_timeout" in head
    assert not any(a.startswith("file:") for a in args)
    still = vt.Probe(5, 640, 360, False)
    local = vt.poster_command("http://127.0.0.1:8333/b/k", "video/webm", Path("/p.jpg"), still)
    assert local[local.index("-protocol_whitelist") + 1] == "http,tcp"
    for bad in ("file:///etc/passwd", "ftp://x/y", "crypto+https://x", "/plain/path"):
        with pytest.raises(ValueError):
            vt.poster_command(bad, "video/mp4", Path("/p.jpg"), still)


def test_the_local_copy_is_used_while_it_fits_and_r2_is_read_beyond():
    gib = 1024**3
    assert vt.read_locally(size=5 * gib, free=19 * gib) is True
    assert vt.read_locally(size=18 * gib, free=19 * gib) is True
    assert vt.read_locally(size=18 * gib + 1, free=19 * gib) is False
    assert vt.read_locally(size=400 * gib, free=19 * gib) is False
    with pytest.raises(vt.InsufficientDisk):
        vt.read_locally(size=1, free=vt.OUTPUT_HEADROOM_BYTES - 1)


def test_url_lifetime_follows_the_ffmpeg_budget_up_to_seven_days():
    assert vt.url_seconds(vt.PROBE_TIMEOUT_SECONDS) == 60 + vt.URL_SLACK_SECONDS
    two_hours = vt.ffmpeg_timeout(7200)
    assert vt.url_seconds(two_hours) == two_hours + vt.URL_SLACK_SECONDS
    assert vt.url_seconds(vt.ffmpeg_timeout(10 * 24 * 3600)) == 7 * 24 * 3600


class _Presigner:
    def __init__(self, url: str) -> None:
        self.url, self.expires = url, 0

    def generate_presigned_url(self, _op: str, Params: dict[str, str], ExpiresIn: int) -> str:  # noqa: N803
        self.expires = ExpiresIn
        return self.url + Params["Key"]


def test_s3_store_presigns_one_key_https_only_and_caps_the_lifetime():
    client = _Presigner("https://acct.r2.cloudflarestorage.com/b/")
    store = vt.S3VideoStore(client, "b")
    assert store.presign_get("video/x/original", 10**9).endswith("video/x/original")
    assert client.expires == vt.URL_MAX_SECONDS
    with pytest.raises(RuntimeError):
        vt.S3VideoStore(_Presigner("http://127.0.0.1:8333/b/"), "b").presign_get("k", 60)
    local = vt.S3VideoStore(_Presigner("http://127.0.0.1:8333/b/"), "b", allow_http=True)
    assert local.presign_get("k", 60).startswith("http://")


def _fake_transcode(on_disk: list[list[str]]) -> vt.Transcoder:
    """Writes three segments per rendition, ticking between them, as ffmpeg would."""

    def transcoder(args: Any, _timeout: int, tick: Any) -> subprocess.CompletedProcess[bytes]:
        out = Path(args[-1]).parent.parent  # .../out/%v/index.m3u8
        stream_map = args[args.index("-var_stream_map") + 1].split()
        names = [part.split("name:")[1] for part in stream_map]
        for n in range(3):
            for name in names:
                (out / name / f"seg_{n:05d}.m4s").write_bytes(b"seg")
            tick()
            on_disk.append(sorted(p.name for p in (out / names[0]).iterdir()))
        for i, name in enumerate(names):
            (out / name / f"init_{i}.mp4").write_bytes(b"init")
            (out / name / "index.m3u8").write_text(
                f'#EXTM3U\n#EXT-X-MAP:URI="init_{i}.mp4"\n'
                + "".join(f"#EXTINF:4,\nseg_{n:05d}.m4s\n" for n in range(3))
                + "#EXT-X-ENDLIST\n"
            )
        (out / "master.m3u8").write_text("#EXTM3U\n" + "".join(f"{n}/index.m3u8\n" for n in names))
        return subprocess.CompletedProcess([], 0, b"", b"")

    return transcoder


def _probe_then_no_poster(seen: list[list[str]]) -> vt.Runner:
    def runner(args: Any, _timeout: int) -> subprocess.CompletedProcess[bytes]:
        seen.append(list(args))
        if args[0] == "ffprobe":
            return probe_output(
                [{"codec_type": "video", "width": 1280, "height": 720}], duration="12"
            )
        return subprocess.CompletedProcess([], 1, b"", b"")

    return runner


def test_an_original_larger_than_the_disk_is_read_from_r2_and_segments_leave_the_disk(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    store = DirStore(tmp_path / "bucket")
    store.put(f"video/{VIDEO_ID}/original", b"x" * 1000)
    _free(monkeypatch, vt.OUTPUT_HEADROOM_BYTES + 999)  # the original does not fit
    jobs = FakeJobs(claim=_job(1000))
    ran: list[list[str]] = []
    on_disk: list[list[str]] = []
    work = tmp_path / "work"
    work.mkdir()

    result = vt.process_one(
        jobs,
        store,
        runner=_probe_then_no_poster(ran),
        workdir=work,
        transcoder=_fake_transcode(on_disk),
    )

    assert result is not None and result.outcome == "ready", result
    assert store.downloads == []  # never copied to disk
    assert [k for k, _ in store.presigned] == [f"video/{VIDEO_ID}/original"] * 3
    probe_args, poster_args = ran
    assert probe_args[probe_args.index("-i") + 1].startswith("https://r2.test/")
    assert poster_args[poster_args.index("-protocol_whitelist") + 1] == "https,tls,tcp"
    # The transcode's URL lives as long as ffmpeg may run.
    assert store.presigned[1][1] == vt.url_seconds(vt.ffmpeg_timeout(12))
    # While ffmpeg ran, only each rendition's newest segment stayed on disk.
    assert on_disk == [["seg_00000.m4s"], ["seg_00001.m4s"], ["seg_00002.m4s"]]
    finish = jobs.last("video_job_finish")
    prefix = f"video/{VIDEO_ID}/{finish['p_revision']}/"
    uploaded = [k[len(prefix) :] for k in store.order]
    assert sorted(uploaded) == sorted(
        [f"{n}/seg_{i:05d}.m4s" for n in ("360p", "720p") for i in range(3)]
        + ["360p/init.mp4", "720p/init.mp4", "360p/index.m3u8", "720p/index.m3u8", "master.m3u8"]
    )
    assert all(u.endswith(".m3u8") for u in uploaded[-3:])  # playlists last
    assert store.types[prefix + "360p/seg_00000.m4s"] == "video/iso.segment"
    assert finish["p_has_poster"] is False
    assert list(work.iterdir()) == []  # temp files removed


def test_a_fitting_original_is_still_read_from_local_disk_only(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    store = DirStore(tmp_path / "bucket")
    store.put(f"video/{VIDEO_ID}/original", b"x" * 1000)
    _free(monkeypatch, vt.OUTPUT_HEADROOM_BYTES + 1000)
    ran: list[list[str]] = []
    result = vt.process_one(
        FakeJobs(claim=_job(1000)),
        store,
        runner=_probe_then_no_poster(ran),
        workdir=tmp_path,
        transcoder=_fake_transcode([]),
    )
    assert result is not None and result.outcome == "ready"
    assert store.downloads == [f"video/{VIDEO_ID}/original"] and store.presigned == []
    assert all(a[a.index("-protocol_whitelist") + 1] == "file" for a in ran)


def test_a_short_original_in_r2_is_rejected_without_presigning(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    store = DirStore(tmp_path / "bucket")
    store.put(f"video/{VIDEO_ID}/original", b"short")
    _free(monkeypatch, vt.OUTPUT_HEADROOM_BYTES)
    result = vt.process_one(FakeJobs(claim=_job(10**12)), store)
    assert result is not None and result.detail == "upload_incomplete"
    assert store.presigned == []


@pytest.mark.parametrize("failure", ["ffmpeg_403", "probe_timeout", "transcode_timeout"])
def test_the_presigned_url_never_reaches_the_logs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, failure: str
):
    from structlog.testing import capture_logs

    store = DirStore(tmp_path / "bucket")
    store.put(f"video/{VIDEO_ID}/original", b"x" * 1000)
    _free(monkeypatch, vt.OUTPUT_HEADROOM_BYTES)
    jobs = FakeJobs(claim=_job(1000))

    def runner(args: Any, timeout: int) -> subprocess.CompletedProcess[bytes]:
        if failure == "probe_timeout":
            raise subprocess.TimeoutExpired(list(args), timeout)
        return _probe_then_no_poster([])(args, timeout)

    def transcoder(args: Any, timeout: int, _tick: Any) -> subprocess.CompletedProcess[bytes]:
        url = args[args.index("-i") + 1]
        if failure == "transcode_timeout":
            raise vt.FfmpegTimeout(f"ffmpeg ran longer than {timeout} s")
        # What ffmpeg prints when R2 refuses an expired URL.
        message = f"[https @ 0x1] HTTP error 403 Forbidden\n{url}: Server returned 403 Forbidden\n"
        return subprocess.CompletedProcess([], 8, b"", message.encode())

    with capture_logs() as logs:
        result = vt.process_one(jobs, store, runner=runner, transcoder=transcoder)
    assert result is not None and result.outcome == "retry"
    assert jobs.last("video_job_fail")["p_retry"] is True
    text = json.dumps(logs, default=str) + json.dumps(result.__dict__)
    assert logs and SIGNATURE not in text and "X-Amz" not in text and "r2.test" not in text


def test_a_storage_failure_while_probing_a_url_is_retried_not_rejected():
    url = f"https://r2.test/b/k?X-Amz-Signature={SIGNATURE}"
    expired = subprocess.CompletedProcess(
        [], 1, b"", f"{url}: Server returned 403 Forbidden (access denied)\n".encode()
    )
    with pytest.raises(RuntimeError) as failed:
        vt.probe(url, "video/mp4", fixed(expired))
    assert not isinstance(failed.value, vt.MediaRejected) and SIGNATURE not in str(failed.value)
    broken = subprocess.CompletedProcess([], 1, b"", b"Invalid data found when processing input\n")
    with pytest.raises(vt.MediaRejected):
        vt.probe(url, "video/mp4", fixed(broken))
    # A local file never hits the network, so the same message is the media's fault.
    with pytest.raises(vt.MediaRejected):
        vt.probe(Path("/x"), "video/mp4", fixed(expired))


def test_redaction_removes_urls_and_signature_fragments():
    tail = (
        "&X-Amz-Date=20261024T080643Z&X-Amz-Expires=600&X-Amz-Signature=abc: Server returned 403\n"
        "https://a.r2.cloudflarestorage.com/b/k?X-Amz-Credential=AK%2F: Invalid data\n"
    )
    clean = vt.redact(tail)
    assert "abc" not in clean and "AK" not in clean and "r2.cloudflarestorage" not in clean
    assert "Server returned 403" in clean and "Invalid data" in clean


def test_run_ticking_ticks_while_running_and_returns_stderr():
    ticks: list[int] = []
    done = vt.run_ticking(
        ["sh", "-c", "sleep 0.5; echo oops >&2; exit 3"], 30, lambda: ticks.append(1), every=0.05
    )
    assert done.returncode == 3 and done.stderr == b"oops\n" and len(ticks) >= 3


def test_run_ticking_kills_the_process_when_a_tick_fails_or_time_runs_out():
    started = time.monotonic()

    def failing_upload() -> None:
        raise OSError("R2 unavailable")

    with pytest.raises(OSError):
        vt.run_ticking(["sleep", "30"], 60, failing_upload, every=0.05)
    with pytest.raises(vt.FfmpegTimeout) as timed_out:
        vt.run_ticking(["sleep", "30"], 0, lambda: None, every=0.05)
    assert "sleep" not in str(timed_out.value)  # no command line, so no URL
    assert time.monotonic() - started < 10


def test_sigterm_stops_a_ticking_ffmpeg_too():
    import os
    import signal
    import threading

    previous = signal.getsignal(signal.SIGTERM)
    try:
        vt.stop_on_sigterm()
        threading.Timer(0.3, os.kill, (os.getpid(), signal.SIGTERM)).start()
        started = time.monotonic()
        with pytest.raises(vt.Terminated):
            vt.run_ticking(["sleep", "30"], 60, lambda: None, every=0.05)
        assert time.monotonic() - started < 10
    finally:
        signal.signal(signal.SIGTERM, previous)


def test_a_playlist_naming_a_segment_that_was_never_uploaded_fails_the_job(tmp_path: Path):
    out = tmp_path / "out"
    (out / "360p").mkdir(parents=True)
    (out / "360p" / "seg_00000.m4s").write_bytes(b"s")
    (out / "360p" / "index.m3u8").write_text("#EXTM3U\nseg_00000.m4s\nseg_00001.m4s\n")
    segments = vt.SegmentUploader(DirStore(tmp_path / "bucket"), out, "video/x/r/", ["360p"])
    segments.flush(final=True)
    with pytest.raises(RuntimeError):
        segments.check_playlists()


class _RangeServer:
    """A bucket over plain HTTP with Range support, standing in for R2's presigned GET."""

    def __init__(self, data: bytes) -> None:
        import threading
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

        requests: list[str] = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                requests.append(self.path)
                start, end = 0, len(data) - 1
                ranged = re.fullmatch(r"bytes=(\d+)-(\d*)", self.headers.get("Range", ""))
                if ranged:
                    start = int(ranged[1])
                    end = int(ranged[2]) if ranged[2] else end
                    self.send_response(206)
                    self.send_header("Content-Range", f"bytes {start}-{end}/{len(data)}")
                else:
                    self.send_response(200)
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", str(end - start + 1))
                self.end_headers()
                try:
                    self.wfile.write(data[start : end + 1])
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def log_message(self, *_: Any) -> None:
                pass

        self.requests = requests
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/bucket/"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg not installed")
def test_real_transcode_reads_the_original_over_http_and_uploads_segments_as_it_goes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    source = tmp_path / "sample.mp4"  # moov at the end: ffmpeg must seek with Range
    subprocess.run(
        [
            "ffmpeg",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=1280x720:rate=25:duration=20",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=20",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(source),
        ],
        check=True,
    )
    server = _RangeServer(source.read_bytes())
    try:
        store = DirStore(tmp_path / "bucket", url_base=server.url)
        store.put(f"video/{VIDEO_ID}/original", source.read_bytes())
        _free(monkeypatch, vt.OUTPUT_HEADROOM_BYTES)  # force the R2 path
        jobs = FakeJobs(claim=_job(source.stat().st_size))
        mid_run: list[int] = []

        def transcoder(args: Any, timeout: int, tick: Any) -> subprocess.CompletedProcess[bytes]:
            def counted() -> None:
                tick()
                mid_run.append(len(tick.__self__.uploaded))

            return vt.run_ticking(args, timeout, counted, every=0.05)

        work = tmp_path / "work"
        work.mkdir()
        result = vt.process_one(jobs, store, workdir=work, transcoder=transcoder)
    finally:
        server.close()

    assert result is not None and result.outcome == "ready", result
    assert store.downloads == []
    assert server.requests and all(
        r.startswith(f"/bucket/video/{VIDEO_ID}/original?") for r in server.requests
    )
    assert max(mid_run) > 0  # segments left the disk while ffmpeg was still running
    finish = jobs.last("video_job_finish")
    assert finish["p_renditions"] == ["360p", "720p"] and finish["p_has_poster"] is True
    assert 19.5 < finish["p_duration"] < 20.5
    prefix = f"video/{VIDEO_ID}/{finish['p_revision']}/"
    files = [k[len(prefix) :] for k in store.keys() if k.startswith(prefix)]
    assert all(vt.OUTPUT_FILE.match(f) for f in files)
    for name in ("360p", "720p"):
        playlist = (store.root / prefix / name / "index.m3u8").read_text()
        uris = [line for line in playlist.splitlines() if line and not line.startswith("#")]
        assert len(uris) >= 5 and all(f"{name}/{u}" in files for u in uris)
    assert list(work.iterdir()) == []
