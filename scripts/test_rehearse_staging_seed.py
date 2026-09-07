"""Unit tests for scripts/rehearse_staging_seed.py.

Pure-Python, no Docker/Supabase dependency — matches the fast, always-run
convention of scripts/test_staging_demo.py (`python -m unittest discover -s
scripts -p "test_*.py"`).
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import rehearse_staging_seed as r  # noqa: E402


class DetectStorageDependencyTests(unittest.TestCase):
    def _write(self, tmp: Path, name: str, content: str) -> Path:
        path = tmp / name
        path.write_text(content, encoding="utf-8")
        return path

    def test_flags_storage_buckets_reference(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            f = self._write(tmp, "1.sql", "insert into storage.buckets (id, name) values ('x', 'x');")
            self.assertEqual(r.detect_storage_dependency([f]), ["1.sql"])

    def test_flags_storage_objects_policy(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            f = self._write(tmp, "2.sql", "create policy p on storage.objects for select using (true);")
            self.assertEqual(r.detect_storage_dependency([f]), ["2.sql"])

    def test_flags_storage_helper_functions(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            f = self._write(tmp, "3.sql", "select storage.foldername(name) from x;")
            self.assertEqual(r.detect_storage_dependency([f]), ["3.sql"])

    def test_ignores_migrations_with_no_storage_reference(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            f = self._write(tmp, "4.sql", "create table public.widgets (id uuid primary key);")
            self.assertEqual(r.detect_storage_dependency([f]), [])

    def test_ignores_the_word_storage_used_generically(self) -> None:
        # Must match the qualified `storage.<object>` form only — a comment or
        # identifier that merely contains the word "storage" is not a real
        # dependency on the Supabase Storage schema.
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            f = self._write(
                tmp, "5.sql",
                "-- this migration adds cold storage archival metadata\n"
                "create table public.storage_notes (id uuid primary key);",
            )
            self.assertEqual(r.detect_storage_dependency([f]), [])

    def test_reports_multiple_files_in_order(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            a = self._write(tmp, "a_first.sql", "select 1;")
            b = self._write(tmp, "b_second.sql", "select * from storage.objects;")
            c = self._write(tmp, "c_third.sql", "select * from storage.buckets;")
            self.assertEqual(r.detect_storage_dependency([a, b, c]), ["b_second.sql", "c_third.sql"])

    def test_real_migration_chain_matches_the_known_three_files(self) -> None:
        # Regression pin: as of the 21-migration Storage increment, exactly
        # these three migrations touch Supabase-managed Storage. If this list
        # legitimately changes with a future migration, update the pin — the
        # point of the test is that isolated mode's fast-fail stays in sync
        # with the real chain, not that this exact list is permanent.
        files = sorted(r.MIGRATIONS.glob("*.sql"))
        hits = r.detect_storage_dependency(files)
        self.assertEqual(
            hits,
            [
                "20260906090001_professional_asset_storage.sql",
                "20260907090001_portfolio_and_certificates.sql",
                "20260908090001_portfolio_public_read_sign_only.sql",
            ],
        )


class StartIsolatedFastFailTests(unittest.TestCase):
    """`start_isolated()` must refuse BEFORE touching Docker when the real
    migration chain is storage-dependent — never fail deep into a replay with
    an unexplained missing relation, and never fabricate a fake Storage
    schema to dodge the question."""

    def test_start_isolated_refuses_before_any_docker_call(self) -> None:
        import subprocess as _subprocess
        import unittest.mock as mock

        with mock.patch.object(_subprocess, "run", side_effect=AssertionError(
            "start_isolated() called a Docker/subprocess operation before the "
            "storage-dependency fast-fail check — it must refuse first."
        )):
            with self.assertRaises(SystemExit) as ctx:
                r.start_isolated()

        message = str(ctx.exception)
        self.assertIn("isolated mode cannot rehearse", message)
        self.assertIn("professional_asset_storage.sql", message)
        self.assertIn("fake/minimal Storage schema", message)


class ConcurrencyGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        self._orig_lock_path = r.LOCK_PATH
        self._tmpdir = tempfile.TemporaryDirectory()
        r.LOCK_PATH = Path(self._tmpdir.name) / "rehearsal.lock"

    def tearDown(self) -> None:
        r.LOCK_PATH = self._orig_lock_path
        self._tmpdir.cleanup()

    def test_acquire_then_release_leaves_no_lock_file(self) -> None:
        r.acquire_lock()
        self.assertTrue(r.LOCK_PATH.exists())
        r.release_lock()
        self.assertFalse(r.LOCK_PATH.exists())

    def test_second_acquire_refuses_while_holder_is_alive(self) -> None:
        r.LOCK_PATH.write_text(str(os.getpid()), encoding="utf-8")  # this test process is alive
        with self.assertRaises(SystemExit) as ctx:
            r.acquire_lock()
        self.assertIn("another rehearsal appears to already be running", str(ctx.exception))

    def test_stale_lock_from_a_dead_pid_is_silently_reclaimed(self) -> None:
        # A PID essentially guaranteed not to be a live process right now.
        dead_pid = 2**31 - 1
        r.LOCK_PATH.write_text(str(dead_pid), encoding="utf-8")
        r.acquire_lock()  # must not raise
        self.assertEqual(r.LOCK_PATH.read_text(encoding="utf-8").strip(), str(os.getpid()))
        r.release_lock()


if __name__ == "__main__":
    unittest.main()
