"""Regression tests proving the assembled staging bundle gives every demo
account exactly one primary email contact row — no more, no less.

Pure-Python, no Docker/Supabase dependency — matches the fast, always-run
convention of scripts/test_staging_demo.py and scripts/test_rehearse_staging_seed.py
(`python -m unittest discover -s scripts -p "test_*.py"`).

Why this exists
----------------
scripts/build_staging_seed.py concatenates the base seed files declared by
`supabase/config.toml`'s `[db.seed].sql_paths` with the staging-only
`supabase/staging/demo-enrichment.sql` layer to produce the bundle that BOTH
`scripts/rehearse_staging_seed.py` (local rehearsal) and the real cloud load
apply. `supabase/staging/verify-staging-seed.sql`'s B5 check requires every one
of the 26 accounts in `supabase/staging/demo-accounts.toml` to end up with
exactly one `public.contacts` row where `channel = 'email'` and
`is_primary = true` — but nothing previously checked that invariant statically
against the SEED SOURCES themselves. Karim Adel and the platform admin
regressed silently: the base seed files never gave them a contact row, and only
`demo-enrichment.sql` fills the gap. This file parses the exact same seed
sources `build_staging_seed.py` concatenates (never a hand-copied list) and
pins the invariant so a future edit to any of those files that drops an
account's primary email contact fails fast, in this fast Docker-independent
suite, instead of surfacing later as an opaque `B5 email` error deep inside
`scripts/test_verify_staging_seed.py`.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_staging_seed as bss  # noqa: E402
import staging_demo as sd  # noqa: E402


def _extract_paren_groups(text: str) -> list[str]:
    """The contents of every TOP-LEVEL parenthesised group in `text`, respecting
    nesting (a row like `(..., now())` must not be split at the inner `)`)."""
    groups: list[str] = []
    depth = 0
    start: int | None = None
    for i, ch in enumerate(text):
        if ch == "(":
            if depth == 0:
                start = i + 1
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0 and start is not None:
                groups.append(text[start:i])
                start = None
    return groups


def _split_row_fields(row: str) -> list[str]:
    """Split one VALUES row's contents on top-level commas (quote-aware — none
    of the seeded values contain a literal comma, but this stays honest about
    it rather than assuming)."""
    fields: list[str] = []
    depth = 0
    in_quote = False
    current = []
    for ch in row:
        if ch == "'" and depth == 0:
            in_quote = not in_quote
            current.append(ch)
        elif ch == "(" and not in_quote:
            depth += 1
            current.append(ch)
        elif ch == ")" and not in_quote:
            depth -= 1
            current.append(ch)
        elif ch == "," and depth == 0 and not in_quote:
            fields.append("".join(current))
            current = []
        else:
            current.append(ch)
    fields.append("".join(current))
    return [f.strip() for f in fields]


class PrimaryEmailContactCoverageTests(unittest.TestCase):
    """Statically proves every one of the 26 demo accounts gets exactly one
    primary email contact row from the concatenated seed sources — the same
    sources scripts/build_staging_seed.py assembles into the bundle that both
    the standalone rehearsal and (once loaded) the verifier's own checks run
    against. This is what keeps "the seed sources" a SINGLE shared definition
    instead of the rehearsal path and any other consumer silently drifting."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.accounts = sd.load_accounts()
        # The exact file set build_staging_seed.py concatenates, in order:
        # config.toml's declared base seeds, then the staging-only enrichment
        # layer. Read directly from build_staging_seed.py rather than hardcoded,
        # so this test can never itself drift from what actually gets built.
        cls.source_files = bss.seed_paths() + [bss.ENRICHMENT]
        cls.exact_uuids: set[str] = set()
        cls.prefix_hits: list[tuple[str, Path]] = []
        cls.duplicate_exact: list[str] = []
        for path in cls.source_files:
            text = path.read_text(encoding="utf-8")
            exact, prefixes = cls._primary_email_sources(text, path)
            for uuid in exact:
                if uuid in cls.exact_uuids:
                    cls.duplicate_exact.append(uuid)
                cls.exact_uuids.add(uuid)
            cls.prefix_hits.extend((prefix, path) for prefix in prefixes)

    @staticmethod
    def _primary_email_sources(sql_text: str, path: Path) -> tuple[set[str], list[str]]:
        """UUIDs (exact) and id-prefixes (from a `where id::text like 'X%'`
        SELECT form) that receive a primary email `public.contacts` row from
        every `insert into public.contacts (...)` statement in `sql_text`."""
        exact: set[str] = set()
        prefixes: list[str] = []
        marker = "insert into public.contacts"
        search_from = 0
        while True:
            start = sql_text.find(marker, search_from)
            if start == -1:
                break
            col_open = sql_text.index("(", start)
            columns_group = _extract_paren_groups(sql_text[col_open:])
            if not columns_group:
                raise AssertionError(f"{path}: could not parse column list at offset {start}")
            columns = [c.strip() for c in columns_group[0].split(",")]
            try:
                channel_idx = columns.index("channel")
                primary_idx = columns.index("is_primary")
            except ValueError:
                raise AssertionError(
                    f"{path}: `insert into public.contacts` column list {columns!r} has no "
                    "'channel'/'is_primary' column — update this test's parser to match."
                )
            stmt_end = sql_text.index(";", col_open)
            body = sql_text[col_open + len(columns_group[0]) + 2 : stmt_end].strip()
            if body.lower().startswith("values"):
                rows_text = body[len("values"):]
                for row in _extract_paren_groups(rows_text):
                    fields = _split_row_fields(row)
                    channel = fields[channel_idx].strip("'").lower()
                    is_primary = fields[primary_idx].strip().lower() == "true"
                    if channel == "email" and is_primary:
                        exact.add(fields[0].strip("'").split("::")[0].lower())
            elif body.lower().startswith("select"):
                select_clause, _, rest = body.partition(" from ")
                select_fields = [f.strip() for f in select_clause[len("select"):].split(",")]
                channel = select_fields[channel_idx].strip("'").lower()
                is_primary = select_fields[primary_idx].strip().lower() == "true"
                import re
                m = re.search(r"id::text\s+like\s+'([0-9a-f]+)%'", rest, re.IGNORECASE)
                if not (channel == "email" and is_primary and m):
                    raise AssertionError(
                        f"{path}: unrecognized SELECT-based contacts insert {body!r} — "
                        "update this test's parser to match its new shape."
                    )
                prefixes.append(m.group(1).lower())
            else:
                raise AssertionError(
                    f"{path}: unrecognized `insert into public.contacts` body {body!r} — "
                    "update this test's parser to match its new shape."
                )
            search_from = stmt_end + 1
        return exact, prefixes

    def _covered(self, account_id: str) -> bool:
        uuid = account_id.lower()
        if uuid in self.exact_uuids:
            return True
        return any(uuid.startswith(prefix) for prefix, _ in self.prefix_hits)

    def test_every_demo_account_has_a_primary_email_contact_source(self) -> None:
        missing = [f"{a.slug} ({a.id})" for a in self.accounts if not self._covered(a.id)]
        self.assertEqual(
            missing, [],
            "these demo accounts have NO primary-email `public.contacts` source across "
            f"{[str(p) for p in self.source_files]} — B5 will fail once loaded:\n  "
            + "\n  ".join(missing),
        )

    def test_karim_and_platform_admin_are_covered_by_demo_enrichment(self) -> None:
        # Regression pin for the exact accounts the base seed files leave
        # without a primary email contact (see supabase/staging/demo-enrichment.sql) —
        # proof the fix lives in a real seed source, not merely asserted in general.
        karim = "22222222-2222-4222-8222-222222222222"
        admin = "55555555-5555-4555-8555-555555555555"
        self.assertIn(karim, self.exact_uuids, "Karim Adel must get a primary email contact")
        self.assertIn(admin, self.exact_uuids, "the platform admin must get a primary email contact")

    def test_no_account_gets_two_primary_email_contact_sources(self) -> None:
        # `uq_contacts_primary_per_user` (supabase/migrations, identity_core) already
        # enforces "at most one primary contact per user" at the database level — a
        # genuine duplicate would fail the bundle load loudly. This pins the same
        # invariant statically, in the always-run suite, so it is caught without
        # ever needing Docker.
        self.assertEqual(
            self.duplicate_exact, [],
            f"these UUIDs get more than one exact primary-email contacts insert: {self.duplicate_exact}",
        )
        prefix_uuids = [
            a.id for a in self.accounts
            if any(a.id.lower().startswith(prefix) for prefix, _ in self.prefix_hits)
        ]
        overlap = sorted(set(prefix_uuids) & self.exact_uuids)
        self.assertEqual(
            overlap, [],
            f"these accounts are covered by BOTH an exact insert and a prefix-SELECT insert "
            f"(would violate the one-primary-contact-per-user constraint at load time): {overlap}",
        )

    def test_accounts_covered_by_enrichment_are_exactly_the_ones_base_seeds_skip(self) -> None:
        # demo-enrichment.sql exists specifically for accounts the base seed files
        # leave with nothing to show (see build_staging_seed.py's module docstring).
        # If a future base-seed edit starts covering one of these two accounts
        # itself, the enrichment insert becomes a silent duplicate risk (caught by
        # test_no_account_gets_two_primary_email_contact_sources above) — this test
        # instead pins today's known split so a change to either side is deliberate.
        enrichment_text = bss.ENRICHMENT.read_text(encoding="utf-8")
        enrichment_uuids, _ = self._primary_email_sources(enrichment_text, bss.ENRICHMENT)
        self.assertEqual(
            enrichment_uuids,
            {"22222222-2222-4222-8222-222222222222", "55555555-5555-4555-8555-555555555555"},
        )
        base_files = bss.seed_paths()
        base_uuids: set[str] = set()
        base_prefixes: list[str] = []
        for path in base_files:
            exact, prefixes = self._primary_email_sources(path.read_text(encoding="utf-8"), path)
            base_uuids |= exact
            base_prefixes.extend(prefixes)
        for uuid in enrichment_uuids:
            covered_by_base = uuid in base_uuids or any(uuid.startswith(p) for p in base_prefixes)
            self.assertFalse(
                covered_by_base,
                f"{uuid} now ALSO gets a primary email contact from a base seed file — "
                "remove it from demo-enrichment.sql to avoid a duplicate-primary-contact load failure.",
            )


if __name__ == "__main__":
    unittest.main()
