#!/usr/bin/env python3
"""Strict check of a snapshot's media record (<snapshot>.media.json). One validator for every reader:
the freshness alarm, the scheduled backup's "is today's snapshot already done?" test and the restore test.

  python3 media-record.py <media.json> <label> <snapshot-name> [production|other]

Prints one line per finding and exits 0 when it ran:
  "P <text>"  the snapshot's media backup is not (provably) complete: a new snapshot supersedes it,
  "A <text>"  an alarm that a new snapshot cannot fix (Production media that lives in R2 and is not copied here),
  "W <text>"  a warning.
No output at all means the record is well formed, consistent and says complete. It fails CLOSED: a file that is
missing, empty, unreadable, not JSON, not an object, has a repeated key, lacks a required field, has a field of
the wrong type, contradicts itself, or names another label or snapshot is a problem. A crash of this script
(non-zero exit) is the caller's problem to report too, never "all clear".
"""
import json
import os
import re
import sys

MAX_BYTES = 65536
COUNTS = ("objects", "backed_up", "missing", "copy_failures", "r2_media_records_not_covered")


def no_duplicates(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise ValueError(f"the key {key!r} appears twice")
        out[key] = value
    return out


def findings(path, label, snapshot, kind):
    try:
        size = os.path.getsize(path)
    except OSError as e:
        return [("P", f"the media record cannot be read ({e.strerror or e})")]
    if size == 0:
        return [("P", "the media record is empty")]
    if size > MAX_BYTES:
        return [("P", f"the media record is {size} bytes, far more than a record can be")]
    try:
        with open(path, encoding="utf-8") as f:
            record = json.load(f, object_pairs_hook=no_duplicates)
    except (OSError, ValueError) as e:  # UnicodeDecodeError and JSONDecodeError are ValueErrors
        return [("P", f"the media record is not valid JSON ({e})")]
    if not isinstance(record, dict):
        return [("P", "the media record is not a JSON object")]

    problems = []

    def bad(text):
        problems.append(("P", text))

    for field in ("snapshot", "label", "inventory_sha256", "complete") + COUNTS:
        if field not in record:
            bad(f"the media record lacks the field {field!r}")
    for field in COUNTS:
        v = record.get(field)
        if field in record and (isinstance(v, bool) or not isinstance(v, int) or v < 0):
            bad(f"the media record field {field!r} is not a count (it is {v!r})")
    if "complete" in record and not isinstance(record["complete"], bool):
        bad(f"the media record field 'complete' is not true or false (it is {record['complete']!r})")
    digest = record.get("inventory_sha256")
    if "inventory_sha256" in record and not (isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest)):
        bad("the media record field 'inventory_sha256' is not a sha256")
    if "label" in record and record["label"] != label:
        bad(f"the media record is of {record['label']!r}, not {label!r}")
    if "snapshot" in record and record["snapshot"] != snapshot:
        bad(f"the media record is of snapshot {record['snapshot']!r}, not {snapshot!r}")
    if problems:
        return problems

    objects, backed_up = record["objects"], record["backed_up"]
    missing, failures = record["missing"], record["copy_failures"]
    if backed_up + missing != objects:
        bad(f"the media record contradicts itself: {backed_up} backed up + {missing} missing is not {objects} objects")
    if record["complete"] != (missing == 0 and failures == 0):
        bad("the media record contradicts itself: its 'complete' does not match its missing and failure counts")
    if not record["complete"]:
        bad(f"the snapshot's media backup is incomplete: {missing} missing, {failures} copy failures")
    if problems:
        return problems
    if record["r2_media_records_not_covered"]:
        level = "A" if kind == "production" else "W"
        return [(level, f"{record['r2_media_records_not_covered']} media records live in R2, which this snapshot's media backup does not copy")]
    return []


def main(argv):
    if len(argv) < 4:
        sys.exit("usage: media-record.py <media.json> <label> <snapshot-name> [production|other]")
    for level, text in findings(argv[1], argv[2], argv[3], argv[4] if len(argv) > 4 else ""):
        print(level, text)


if __name__ == "__main__":
    main(sys.argv)
