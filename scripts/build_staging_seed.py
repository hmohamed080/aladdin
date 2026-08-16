#!/usr/bin/env python3
"""Assemble the one-time STAGING demo-world seed for a hosted Supabase project.

Why this exists
---------------
`supabase/seed.sql`, `seed-pilot.sql`, and `seed-showroom-sales.sql` are applied
locally by `supabase db reset`, which drops the database first. That command must
NEVER be pointed at a hosted project, and the seed files are not idempotent on
their own: they insert into `auth.users` and every public table with fixed UUIDs
and no `ON CONFLICT`, so a second apply fails on duplicate keys partway through.

This script does not rewrite those files (they are pinned by the pgTAP suite and
the E2E fixtures). It concatenates them, in the order `supabase/config.toml`
already declares, into a single transaction fronted by a refusal guard. The
result is safe to apply exactly once to a freshly migrated STAGING database and
is inert against any database that already holds data — which is what keeps
Production from ever depending on demo seeds.

`config.toml` stays the single source of truth for the seed list, so a seed added
to the local reset flow is picked up here automatically.

Usage:
    python scripts/build_staging_seed.py            # writes supabase/.staging-seed.sql
    python scripts/build_staging_seed.py --stdout   # prints instead (paste into SQL Editor)

The output path is gitignored: the assembled file is a build artifact, not source.
See docs/operations/staging-deployment-runbook.md.
"""

from __future__ import annotations

import sys
import tomllib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG = REPO_ROOT / "supabase" / "config.toml"
DEFAULT_OUT = REPO_ROOT / "supabase" / ".staging-seed.sql"

# Refuses on a non-empty database rather than trying to merge. A staging project
# is cheap to recreate; a half-applied demo world on top of real rows is not.
# `to_regclass` is checked first so "you forgot to push migrations" reads as
# itself instead of as a missing-relation error from the emptiness probe.
GUARD = """\
-- ---------------------------------------------------------------------------
-- Refusal guard. Everything below runs in ONE transaction: if this raises,
-- nothing is written. Re-running on an already-seeded database is a no-op error,
-- never a partial load.
-- ---------------------------------------------------------------------------
do $staging_guard$
begin
  if to_regclass('public.organizations') is null then
    raise exception
      'Schema is not deployed. Push migrations (supabase db push) before loading the staging demo world.';
  end if;

  if exists (select 1 from auth.users) or exists (select 1 from public.organizations) then
    raise exception
      'Refusing to load the staging demo world: this database already has users or organizations.'
      using hint =
        'This is a ONE-TIME load for an empty STAGING database. It must never run against Production.';
  end if;
end
$staging_guard$;
"""


def seed_paths() -> list[Path]:
    """The seed files declared by `[db.seed].sql_paths`, resolved and ordered."""
    with CONFIG.open("rb") as fh:
        config = tomllib.load(fh)
    declared = config.get("db", {}).get("seed", {}).get("sql_paths", [])
    if not declared:
        raise SystemExit("no [db.seed].sql_paths declared in supabase/config.toml")

    resolved: list[Path] = []
    for entry in declared:
        # Paths in config.toml are relative to the supabase/ directory, but the
        # repo writes them as "./seed.sql" — resolve against supabase/ and fall
        # back to the repo root so either convention works.
        candidate = (CONFIG.parent / entry).resolve()
        if not candidate.is_file():
            candidate = (REPO_ROOT / entry).resolve()
        if not candidate.is_file():
            raise SystemExit(f"seed file declared in config.toml does not exist: {entry}")
        resolved.append(candidate)
    return resolved


def build() -> str:
    files = seed_paths()
    listing = "\n".join(f"--   {i}. {f.relative_to(REPO_ROOT).as_posix()}" for i, f in enumerate(files, 1))
    parts = [
        "-- ===========================================================================",
        "-- GENERATED — do not edit. Rebuild with:",
        "--   python scripts/build_staging_seed.py",
        "--",
        "-- One-time STAGING demo world, assembled from the seed files declared in",
        "-- supabase/config.toml [db.seed].sql_paths:",
        listing,
        "--",
        "-- SYNTHETIC data only (no real people or companies). Apply once, to an empty",
        "-- STAGING database that has already had its migrations pushed. Never Production.",
        "-- ===========================================================================",
        "",
        "begin;",
        "",
        GUARD,
    ]
    for path in files:
        rel = path.relative_to(REPO_ROOT).as_posix()
        parts.append("")
        parts.append(f"-- ==== BEGIN {rel} " + "=" * max(0, 60 - len(rel)))
        parts.append(path.read_text(encoding="utf-8").rstrip())
        parts.append(f"-- ==== END {rel} " + "=" * max(0, 62 - len(rel)))
    parts.append("")
    parts.append("commit;")
    parts.append("")
    return "\n".join(parts)


def main(argv: list[str]) -> int:
    sql = build()
    if "--stdout" in argv:
        sys.stdout.write(sql)
        return 0
    DEFAULT_OUT.write_text(sql, encoding="utf-8")
    lines = sql.count("\n")
    print(f"wrote {DEFAULT_OUT.relative_to(REPO_ROOT).as_posix()} ({lines} lines)")
    print("apply ONCE to an empty, already-migrated staging database — see")
    print("docs/operations/staging-deployment-runbook.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
