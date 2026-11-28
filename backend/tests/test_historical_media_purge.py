"""The historical-media purge worker: dry run by default, closed bucket set,
database-confirmed removal, resumable, and stops instead of looping."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from app.workers import historical_media_purge as purge

CUTOFF = datetime(2026, 10, 1, tzinfo=UTC)


class FakeClient:
    """A tiny in-memory stand-in for the four RPCs and the Storage API."""

    def __init__(self, journal_rows: list[dict[str, str]], stuck: set[str] | None = None) -> None:
        self.pending = list(journal_rows)  # retired, not yet confirmed
        self.stored = {(r["bucket"], r["object_key"]) for r in journal_rows}
        self.stuck = stuck or set()  # keys Storage refuses to delete
        self.calls: list[str] = []
        self.finalized = 0

    def rpc(self, name: str, params: dict[str, Any]) -> Any:
        self.calls.append(name)
        if name == "media_historical_purge_inventory":
            return {"portfolio": {"rows": len(self.pending)}}
        if name == "media_historical_purge_retire":
            return self.pending[: params["p_limit"]]
        if name == "media_historical_purge_storage_removed":
            row = next(r for r in self.pending if r["object_key"] == params["p_key"])
            if (row["bucket"], row["object_key"]) in self.stored:
                return False
            self.pending.remove(row)
            self.finalized += 1
            return True
        if name == "media_historical_purge_finalize":
            done, self.finalized = self.finalized, 0
            return done
        raise AssertionError(name)

    def remove(self, bucket: str, keys: list[str]) -> None:
        self.calls.append(f"remove:{bucket}:{len(keys)}")
        for key in keys:
            if key not in self.stuck:
                self.stored.discard((bucket, key))


def rows(n: int, namespace: str = "portfolio") -> list[dict[str, str]]:
    return [
        {
            "namespace": namespace,
            "object_key": f"{namespace}-{i}.jpg",
            "bucket": purge.BUCKETS[namespace],
        }
        for i in range(n)
    ]


def test_dry_run_only_reads_the_inventory() -> None:
    client = FakeClient(rows(3))
    report = purge.run(client, CUTOFF, execute=False)
    assert report.dry_run and client.calls == ["media_historical_purge_inventory"]
    assert client.stored  # nothing removed


def test_execute_removes_confirms_and_finalizes_in_batches() -> None:
    client = FakeClient(rows(5) + rows(2, "avatar"))
    journal: list[dict[str, Any]] = []
    report = purge.run(client, CUTOFF, execute=True, batch_size=3, journal=journal.append)
    assert report.removed == 7 and report.finalized == 7 and report.unconfirmed == []
    assert report.batches == 3 and not client.stored
    # The journal never holds a key in clear.
    assert all("jpg" not in entry["key"] for entry in journal) and len(journal) == 7


def test_unexpected_bucket_stops_the_run_before_any_removal() -> None:
    bad = [{"namespace": "portfolio", "object_key": "x.pdf", "bucket": "professional-certificates"}]
    client = FakeClient(bad)
    with pytest.raises(purge.PurgeError, match="unexpected bucket"):
        purge.run(client, CUTOFF, execute=True)
    assert not any(c.startswith("remove:") for c in client.calls)


def test_a_batch_with_no_confirmed_removal_stops_instead_of_looping() -> None:
    client = FakeClient(rows(2), stuck={"portfolio-0.jpg", "portfolio-1.jpg"})
    with pytest.raises(purge.PurgeError, match="no removal"):
        purge.run(client, CUTOFF, execute=True)


def test_partial_failure_is_reported_and_the_rest_completes() -> None:
    client = FakeClient(rows(3), stuck={"portfolio-1.jpg"})
    with pytest.raises(purge.PurgeError):
        purge.run(client, CUTOFF, execute=True, batch_size=3)
    assert len(client.pending) == 1  # only the stuck object is left for the next run


def test_cutoff_must_be_past_and_zoned() -> None:
    with pytest.raises(purge.PurgeError):
        purge.run(FakeClient([]), datetime.now(UTC) + timedelta(days=1), execute=False)
    with pytest.raises(purge.PurgeError):
        purge.run(FakeClient([]), datetime(2026, 10, 1), execute=False)


@pytest.mark.parametrize(
    ("url", "ref"),
    [
        ("https://kkpkgjrweysgvhvkhzun.supabase.co", "kkpkgjrweysgvhvkhzun"),
        ("http://127.0.0.1:54321", "local"),
    ],
)
def test_project_ref(url: str, ref: str) -> None:
    assert purge.project_ref(url) == ref


def test_project_ref_refuses_other_hosts() -> None:
    with pytest.raises(purge.PurgeError):
        purge.project_ref("https://evil.example.com")


def test_execute_requires_the_matching_project(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "http://127.0.0.1:54321")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "x")
    from app.config import get_settings

    get_settings.cache_clear()
    try:
        code = purge.main(
            ["--cutoff", "2026-10-01T00:00:00Z", "--execute", "--confirm-project", "other"]
        )
    finally:
        get_settings.cache_clear()
    assert code == 2
