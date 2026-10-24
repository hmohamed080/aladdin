"""Permanent deletion of historical Supabase portfolio photos and avatars.

Owner decision 2026-10-19: these images are not migrated to R2. People see an
empty portfolio or avatar and upload new images (R2 only). The database decides
what is historical (migration 20261019120000): portfolio and avatar rows created
before `--cutoff` whose object is not already a verified R2 object, plus orphan
objects in the same two buckets. Certificates, business-verification documents,
products, organization images, accounts and profiles are never selected.

Dry run is the default and writes nothing. A real run needs `--execute` and
`--confirm-project <ref>` naming the project in SUPABASE_URL, so a run can only
ever touch the project the operator typed. Each batch:

  1. `media_historical_purge_retire`: hide + unlink + journal (one transaction);
  2. remove the Storage objects through the Storage API (service role);
  3. `media_historical_purge_storage_removed`: the database confirms each object
     is really gone from storage.objects;
  4. `media_historical_purge_finalize`: delete the confirmed metadata rows.

A crash anywhere leaves journal rows the next run resumes. The local JSON-lines
journal records a short hash of each key, never the key itself.

    uv run python -m app.workers.historical_media_purge --cutoff 2026-10-20T00:00:00Z
    uv run python -m app.workers.historical_media_purge --cutoff ... \
        --execute --confirm-project <ref>
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import defaultdict
from collections.abc import Callable
from contextlib import nullcontext
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlparse

from app.coordination import LockUnavailable, job_lock

# Closed set. Anything the database returns outside it stops the run.
BUCKETS: dict[str, str] = {"avatar": "avatars", "portfolio": "professional-portfolio"}
STORAGE_REMOVE_LIMIT = 100


class PurgeClient(Protocol):
    def rpc(self, name: str, params: dict[str, Any]) -> Any: ...
    def remove(self, bucket: str, keys: list[str]) -> None: ...


class SupabasePurgeClient:
    """The two calls the purge needs, on a service-role supabase-py client."""

    def __init__(self, client: Any) -> None:
        self._client = client

    def rpc(self, name: str, params: dict[str, Any]) -> Any:
        return self._client.rpc(name, params).execute().data

    def remove(self, bucket: str, keys: list[str]) -> None:
        self._client.storage.from_(bucket).remove(keys)


@dataclass
class PurgeReport:
    dry_run: bool
    before: dict[str, Any]
    after: dict[str, Any] | None = None
    batches: int = 0
    removed: int = 0
    finalized: int = 0
    unconfirmed: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "dry_run": self.dry_run,
            "before": self.before,
            "after": self.after,
            "batches": self.batches,
            "removed": self.removed,
            "finalized": self.finalized,
            "unconfirmed": self.unconfirmed,
        }


class PurgeError(RuntimeError):
    pass


def key_hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def project_ref(supabase_url: str) -> str:
    """`<ref>` for a hosted project, `local` for a loopback stack."""
    host = urlparse(supabase_url).hostname or ""
    if host in {"127.0.0.1", "localhost", "::1"}:
        return "local"
    if host.endswith(".supabase.co") and host.count(".") == 2:
        return host.split(".", 1)[0]
    raise PurgeError("SUPABASE_URL is neither a hosted Supabase project nor a local stack")


def run(
    client: PurgeClient,
    cutoff: datetime,
    *,
    execute: bool,
    batch_size: int = 25,
    max_batches: int = 1000,
    journal: Callable[[dict[str, Any]], None] = lambda _: None,
) -> PurgeReport:
    if cutoff.tzinfo is None:
        raise PurgeError("cutoff must carry a timezone")
    if cutoff > datetime.now(UTC):
        raise PurgeError("cutoff must be in the past")
    iso = cutoff.isoformat()
    report = PurgeReport(
        dry_run=not execute,
        before=client.rpc("media_historical_purge_inventory", {"p_cutoff": iso}),
    )
    if not execute:
        return report

    for _ in range(max_batches):
        rows = client.rpc("media_historical_purge_retire", {"p_cutoff": iso, "p_limit": batch_size})
        if not rows:
            break
        report.batches += 1
        by_bucket: dict[str, list[tuple[str, str]]] = defaultdict(list)
        for row in rows:
            namespace, key, bucket = row["namespace"], row["object_key"], row["bucket"]
            if BUCKETS.get(namespace) != bucket:
                raise PurgeError(f"refusing unexpected bucket for {namespace}")
            by_bucket[bucket].append((namespace, key))
        confirmed = 0
        for bucket, items in by_bucket.items():
            for start in range(0, len(items), STORAGE_REMOVE_LIMIT):
                chunk = items[start : start + STORAGE_REMOVE_LIMIT]
                client.remove(bucket, [key for _, key in chunk])
                for namespace, key in chunk:
                    ok = bool(
                        client.rpc(
                            "media_historical_purge_storage_removed",
                            {"p_namespace": namespace, "p_key": key},
                        )
                    )
                    journal({"namespace": namespace, "key": key_hash(key), "removed": ok})
                    digest = key_hash(key)
                    if ok:
                        confirmed += 1
                        if digest in report.unconfirmed:
                            report.unconfirmed.remove(digest)
                    elif digest not in report.unconfirmed:
                        report.unconfirmed.append(digest)
        report.removed += confirmed
        report.finalized += int(
            client.rpc("media_historical_purge_finalize", {"p_limit": 500}) or 0
        )
        if confirmed == 0:
            # Storage refused every removal in this batch; retrying would loop.
            raise PurgeError("no removal could be confirmed in this batch; stopping")
    report.after = client.rpc("media_historical_purge_inventory", {"p_cutoff": iso})
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--cutoff", required=True, help="ISO timestamp with timezone; rows before it are historical"
    )
    parser.add_argument("--execute", action="store_true", help="delete for real (default: dry run)")
    parser.add_argument(
        "--confirm-project", help="required with --execute: the project ref in SUPABASE_URL"
    )
    parser.add_argument("--batch-size", type=int, default=25)
    parser.add_argument(
        "--journal", type=Path, help="append JSON lines (hashed keys only) to this file"
    )
    args = parser.parse_args(argv)

    # Imported here so `--help` and the unit tests need no configuration.
    from app.config import get_settings
    from app.database import create_service_client

    settings = get_settings()
    ref = project_ref(settings.supabase_url)
    if args.execute and args.confirm_project != ref:
        print(
            f"refusing: --confirm-project must equal the configured project ({ref})",
            file=sys.stderr,
        )
        return 2
    cutoff = datetime.fromisoformat(args.cutoff.replace("Z", "+00:00"))
    handle = args.journal.open("a", encoding="utf-8") if args.journal else None
    try:
        # One executing purge at a time across machines; a dry run needs no lock.
        with (
            job_lock("historical-media-purge", ttl_seconds=600)
            if args.execute
            else nullcontext(None) as lock
        ):

            def journal(entry: dict[str, Any]) -> None:
                if handle:
                    handle.write(json.dumps(entry) + "\n")
                if lock is not None:
                    lock.extend()

            report = run(
                SupabasePurgeClient(create_service_client(settings)),
                cutoff,
                execute=args.execute,
                batch_size=args.batch_size,
                journal=journal,
            )
    except LockUnavailable:
        print("stopped: another purge is running", file=sys.stderr)
        return 3
    except PurgeError as exc:
        print(f"stopped: {exc}", file=sys.stderr)
        return 1
    finally:
        if handle:
            handle.close()
    print(json.dumps({"project": ref, **report.as_dict()}, indent=2, default=str))
    return 0 if not report.unconfirmed else 1


if __name__ == "__main__":
    raise SystemExit(main())
