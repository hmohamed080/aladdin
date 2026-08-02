#!/usr/bin/env python3
"""Validate internal (relative) Markdown links across the repository.

Repo-owned so CI and humans run the same check. Scans Markdown under docs/,
design/, .github/, UI-UX/, and the repo root; verifies every relative
`](path)` target exists. Ignores http(s)/mailto and pure `#anchor` links.

Exit 0 if all links resolve; exit 1 (and print each broken link) otherwise.
Usage: python scripts/check_doc_links.py
"""
from __future__ import annotations
import glob
import os
import re
import sys

LINK_RE = re.compile(r"\]\(([^)#]+?)(#[^)]*)?\)")
PATTERNS = ("docs/**/*.md", "design/**/*.md", ".github/**/*.md", "UI-UX/*.md", "*.md")


def main() -> int:
    root = os.getcwd()
    files: set[str] = set()
    for pat in PATTERNS:
        for f in glob.glob(pat, recursive=True):
            if "node_modules" not in f:
                files.add(f)

    broken = 0
    checked = 0
    for f in sorted(files):
        base = os.path.dirname(f)
        try:
            text = open(f, encoding="utf-8", errors="ignore").read()
        except OSError:
            continue
        for m in LINK_RE.finditer(text):
            target = m.group(1)
            if target.startswith(("http://", "https://", "mailto:")):
                continue
            resolved = os.path.normpath(os.path.join(base, target))
            checked += 1
            if not os.path.exists(resolved):
                broken += 1
                print(f"BROKEN  {f} -> {target}")

    print(f"checked {checked} internal links across {len(files)} markdown files, {broken} broken")
    return 1 if broken else 0


if __name__ == "__main__":
    sys.exit(main())
