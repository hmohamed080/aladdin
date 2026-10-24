"""Job locks: one holder at a time, token-checked release, TTL-bounded."""

from __future__ import annotations

import os
import time

import pytest

from app.config import Settings, get_settings
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


def test_redis_is_off_by_default_even_with_a_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("REDIS_CACHE_ENABLED", raising=False)
    monkeypatch.setenv("REDIS_URL", "redis://127.0.0.1:1")
    get_settings.cache_clear()
    try:
        assert get_settings().redis_active_url == ""
        # Off means no connection attempt at all, so a dead port costs nothing.
        with job_lock("historical-media-purge") as lock:
            assert lock.key is None
    finally:
        get_settings.cache_clear()


def test_unreachable_redis_runs_the_job_unlocked(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REDIS_CACHE_ENABLED", "true")
    monkeypatch.setenv("APP_ENV", "local")
    monkeypatch.setenv("REDIS_URL", "redis://127.0.0.1:1")
    get_settings.cache_clear()
    ran = False
    try:
        with job_lock("historical-media-purge") as lock:
            ran = True
            assert lock.key is None
            assert lock.extend() is True
    finally:
        get_settings.cache_clear()
    assert ran


def test_extend_after_redis_dies_mid_job_does_not_raise() -> None:
    from redis.exceptions import ConnectionError as RedisConnectionError

    class Dead:
        def eval(self, *args: object) -> int:
            raise RedisConnectionError("gone")

    assert JobLock(Dead(), lock_key("local", "x"), ttl_ms=1_000).extend() is False


def _settings(**values: str) -> Settings:
    return Settings(_env_file=None, **values)  # type: ignore[arg-type]


def test_hosted_redis_must_use_tls() -> None:
    on = {"redis_cache_enabled": "true", "redis_key_env": "preview"}
    with pytest.raises(ValueError, match="TLS"):
        _settings(app_env="staging", redis_url="redis://db.example.com:6379", **on)
    assert _settings(app_env="staging", redis_url="rediss://db.example.com:6379", **on)
    # Loopback and local development may be plain.
    assert _settings(app_env="staging", redis_url="redis://127.0.0.1:6379", **on)
    assert _settings(app_env="local", redis_url="redis://db.example.com:6379", **on)
    with pytest.raises(ValueError, match="redis://"):
        _settings(app_env="local", redis_url="http://db.example.com", **on)
    # Switched off, the URL is not used and so not checked.
    assert _settings(app_env="production", redis_url="redis://db.example.com:6379")


def test_each_deployed_environment_names_its_own_namespace() -> None:
    url = {"redis_cache_enabled": "true", "redis_url": "rediss://db.example.com:6379"}
    with pytest.raises(ValueError, match="REDIS_KEY_ENV is required"):
        _settings(app_env="production", **url)
    with pytest.raises(ValueError, match="REDIS_KEY_ENV must match"):
        _settings(app_env="production", redis_key_env="Prod:1", **url)
    assert _settings(app_env="production", redis_key_env="production", **url).redis_namespace == (
        "production"
    )
    assert _settings(app_env="local", **url).redis_namespace == "local"


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
