"""Job locks: one holder at a time, token-checked release, TTL-bounded."""

from __future__ import annotations

import os
import time

import pytest

from app.config import get_settings
from app.coordination import JobLock, LockUnavailable, connect, job_lock, lock_key

REDIS_TEST_URL = os.environ.get("REDIS_TEST_URL")


def test_lock_key_is_namespaced_and_validated() -> None:
    assert (
        lock_key("staging", "video-transcode") == "aladdin:staging:v1:lock:global:video-transcode"
    )
    with pytest.raises(ValueError):
        lock_key("staging", "a:b")


def test_without_redis_the_job_runs_unlocked(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REDIS_URL", "")
    get_settings.cache_clear()
    with job_lock("historical-media-purge") as lock:
        assert lock.extend() is True
    get_settings.cache_clear()


@pytest.mark.skipif(not REDIS_TEST_URL, reason="needs REDIS_TEST_URL")
class TestRealRedis:
    def setup_method(self) -> None:
        self.client = connect(REDIS_TEST_URL)
        self.client.delete(lock_key("local", "test-job"))

    def test_second_holder_is_refused_until_release(self) -> None:
        with job_lock("test-job", client=self.client):
            with pytest.raises(LockUnavailable):
                with job_lock("test-job", client=self.client):
                    pass
        with job_lock("test-job", client=self.client):
            pass

    def test_released_on_error(self) -> None:
        with pytest.raises(RuntimeError):
            with job_lock("test-job", client=self.client):
                raise RuntimeError("job failed")
        assert self.client.get(lock_key("local", "test-job")) is None

    def test_an_expired_holder_cannot_release_the_next_holders_lock(self) -> None:
        key = lock_key("local", "test-job")
        first = JobLock(self.client, key, ttl_ms=50)
        assert first.acquire()
        time.sleep(0.1)
        second = JobLock(self.client, key, ttl_ms=5_000)
        assert second.acquire()
        assert first.release() is False
        assert first.extend() is False
        assert self.client.get(key) == second.token.encode()
        assert second.extend() is True
        assert second.release() is True
