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

    def __init__(self, root: Path) -> None:
        self.root = root
        self.aborted: list[tuple[str, str]] = []
        self.types: dict[str, str] = {}

    def put(self, key: str, data: bytes) -> None:
        (self.root / key).parent.mkdir(parents=True, exist_ok=True)
        (self.root / key).write_bytes(data)

    def download(self, key: str, target: Path) -> int:
        shutil.copyfile(self.root / key, target)
        return target.stat().st_size

    def upload(self, source: Path, key: str, content_type: str) -> None:
        (self.root / key).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, self.root / key)
        self.types[key] = content_type

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
    assert args[args.index("-f") + 1] == "matroska"
    assert args[args.index("-i") + 1] == "file:/x/original"


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
