"""Cross-process coordination for background jobs (Redis).

A job lock keeps two workers from running the same job at once (two purge
operators, two video transcode workers picking up the same upload). It is a
coordination aid, never an authorization input: what a job may touch is still
decided by the database.

Redis is optional. Without ``REDIS_URL`` the lock degrades to "no cross-process
lock" and says so; every job here is also idempotent (resumable journals,
state-machine transitions guarded in SQL), so a duplicate run wastes work but
does not corrupt data.
"""

from __future__ import annotations

import secrets
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import structlog

log = structlog.get_logger(__name__)

# Delete the key only if it still holds OUR token: a lock that expired and was
# taken by another worker must not be released by the first one.
_RELEASE = (
    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0"
)
_EXTEND = (
    "if redis.call('GET', KEYS[1]) == ARGV[1] then "
    "return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end return 0"
)


class LockUnavailable(RuntimeError):
    """Another worker holds the lock."""


def lock_key(env: str, name: str) -> str:
    if not name.replace("-", "").replace("_", "").isalnum() or len(name) > 64:
        raise ValueError("invalid lock name")
    return f"aladdin:{env}:v1:lock:global:{name}"


def connect(url: str) -> Any:
    """One connection for a job run. Upstash bills per command, so the
    handshake is RESP2 with no ``CLIENT SETINFO`` (one AUTH instead of HELLO
    plus two CLIENT commands) and there is no health-check PING. The
    connection lives only as long as the job, so it is never left idle."""
    import redis

    return redis.Redis.from_url(
        url,
        socket_connect_timeout=2,
        socket_timeout=2,
        protocol=2,
        driver_info=None,
    )


class JobLock:
    def __init__(self, client: Any, key: str, ttl_ms: int) -> None:
        self._client = client
        self.key = key
        self.ttl_ms = ttl_ms
        self.token = secrets.token_hex(16)

    def acquire(self) -> bool:
        return bool(self._client.set(self.key, self.token, nx=True, px=self.ttl_ms))

    def extend(self) -> bool:
        """Call between batches of a long job so the lock outlives it."""
        return bool(self._client.eval(_EXTEND, 1, self.key, self.token, self.ttl_ms))

    def release(self) -> bool:
        return bool(self._client.eval(_RELEASE, 1, self.key, self.token))


class _NoLock:
    key = None

    def extend(self) -> bool:
        return True


@contextmanager
def job_lock(name: str, *, ttl_seconds: int = 300, client: Any | None = None) -> Iterator[Any]:
    """Hold ``name`` for the duration of the block, or raise ``LockUnavailable``.

    ``client`` is injectable for tests; otherwise ``REDIS_URL`` decides.
    """
    from app.config import get_settings

    settings = get_settings()
    owned = client is None
    if client is None:
        if not settings.redis_url:
            log.warning("job_lock.redis_not_configured", lock=name)
            yield _NoLock()
            return
        client = connect(settings.redis_url)
    lock = JobLock(
        client, lock_key(settings.redis_key_env or settings.app_env, name), ttl_seconds * 1000
    )
    try:
        if not lock.acquire():
            raise LockUnavailable(name)
        try:
            yield lock
        finally:
            try:
                lock.release()
            except Exception:  # noqa: BLE001 - the TTL frees it; never mask the job's own error
                log.warning("job_lock.release_failed", lock=name)
    finally:
        if owned:
            client.close()
