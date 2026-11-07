#!/usr/bin/env python3
"""What media a snapshot REQUIRES to be backed up, read from its plain manifest (<snapshot>.json) - never from a
switch. The manifest counts come from the dump of that very snapshot (its storage.objects rows and its eligible
R2 media records), so they are independent of the live storage location and of which backup switches are on.

  python3 media-coverage.py <manifest.json>

Prints two lines, "legacy <n>" (Supabase Storage files) and "r2 <n>" (R2 originals that must be copied), and exits
0. A legitimately empty inventory prints 0. Exits non-zero (printing nothing) when the manifest is missing,
unreadable, not a JSON object, has a repeated key, or lacks a usable count: coverage is then UNKNOWN, which the
callers treat as a problem, never as "nothing to back up".
R2 count: r2_required_originals (exact: retired originals removed on purpose are not counted). A manifest of an
older kit lacks it; then r2_media_records is used (an upper bound, so it can only demand more, never less).
"""
import json
import os
import sys


def no_duplicates(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise ValueError(f"the key {key!r} appears twice")
        out[key] = value
    return out


def count(record, field):
    v = record.get(field)
    if isinstance(v, bool) or not isinstance(v, int) or v < 0:
        raise ValueError(f"{field!r} is missing or not a count")
    return v


def main(argv):
    if len(argv) != 2:
        sys.exit("usage: media-coverage.py <manifest.json>")
    try:
        if not 0 < os.path.getsize(argv[1]) <= 65536:
            raise ValueError("the manifest is empty or far too large")
        with open(argv[1], encoding="utf-8") as f:
            record = json.load(f, object_pairs_hook=no_duplicates)
        if not isinstance(record, dict):
            raise ValueError("not a JSON object")
        legacy = count(record, "storage_objects")
        r2 = count(record, "r2_required_originals") if "r2_required_originals" in record else count(record, "r2_media_records")
    except (OSError, ValueError) as e:
        print(f"media-coverage: {e}", file=sys.stderr)
        sys.exit(1)
    print(f"legacy {legacy}")
    print(f"r2 {r2}")


if __name__ == "__main__":
    main(sys.argv)
