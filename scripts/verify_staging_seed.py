#!/usr/bin/env python3
"""Run the canonical staging-seed verifier against HOSTED Supabase staging.

This is the ONE supported command for hosted verification:

    python scripts/verify_staging_seed.py

Why this exists
----------------
`supabase/staging/verify-staging-seed.sql` is the single source of truth for
every structural, linkage, commerce, landing, RLS and per-account check the
staging demo world must pass — in both rehearsal (local/isolated, exactly 26
accounts) and hosted (linked project, tolerates unrelated non-demo
registrations) modes. See the comment at the top of that file for the full
design.

`supabase db query --linked --file` runs SQL through Supabase's
Management API, not through `psql` — it does not understand psql
meta-commands (`\\set`, `\\if`, `\\gset`) or `-v` variable substitution, which
is exactly why the canonical file contains none of those. Instead, this
script prepends ONE line of ordinary SQL —
`select set_config('aladdin.verify_mode', 'hosted', false);` — ahead of the
canonical file's own unmodified content, into a private temporary file, and
runs that through the Management API. Nothing here re-implements, forks, or
duplicates the verifier's actual checks; this script is pure plumbing.

Read-only and safe to run repeatedly: the canonical file wraps every check in
`begin; ... rollback;`, so this performs zero persistent writes regardless of
outcome. It never prints row data for anything outside the 26 expected demo
accounts — an unrelated hosted registration is tolerated by the checks, never
named in the output.

Requires the Supabase CLI to already be linked to the target project
(`supabase link --project-ref <ref>`, or run inside a repo where that link
already exists) and does not accept or need a connection string / password on
the command line.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
VERIFY = REPO_ROOT / "supabase" / "staging" / "verify-staging-seed.sql"
MODE_PRELUDE = "select set_config('aladdin.verify_mode', 'hosted', false);\n"


def main(argv: list[str]) -> int:
    if argv:
        print("verify_staging_seed.py takes no arguments", file=sys.stderr)
        return 2

    if not VERIFY.is_file():
        print(f"missing {VERIFY}", file=sys.stderr)
        return 2

    body = VERIFY.read_text(encoding="utf-8")

    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", suffix=".sql", delete=False, encoding="utf-8", dir=REPO_ROOT
        ) as tmp:
            tmp.write(MODE_PRELUDE)
            tmp.write(body)
            tmp_path = Path(tmp.name)

        result = subprocess.run(
            ["supabase", "db", "query", "--linked", "--file", str(tmp_path)],
            cwd=REPO_ROOT,
        )
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)

    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
