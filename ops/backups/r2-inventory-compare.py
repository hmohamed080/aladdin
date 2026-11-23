#!/usr/bin/env python3
"""Compares a snapshot's R2 media inventory with the media_storage_locations rows of the restored database.

  python3 r2-inventory-compare.py <inventory.tsv> <database.tsv> <label>

inventory.tsv   sha256, "r2", physical key, size, copy key, state      (the decrypted <snapshot>.r2media.tsv)
database.tsv    sha256, size, physical key                             (verified, not cleaned provider=r2 rows)

Every row must match on physical key, sha256 and size; the copy key must be media/<label>/r2/<YYYYMM>/objects/<sha256>.age
and the state ok. Prints "P <text>" per finding (never full keys, which hold user or organization ids) and
finally "N <count>". Exit 0 when it ran; a crash is the caller's problem.
"""
import re
import sys


def rows(path, width, name):
    out, problems = {}, []
    with open(path, encoding="utf-8") as f:
        for number, line in enumerate(f, 1):
            line = line.rstrip("\n")
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) != width:
                problems.append(f"{name} line {number} has {len(parts)} columns, not {width}")
                continue
            key = parts[2] if width == 6 else parts[2]
            if key in out:
                problems.append(f"an R2 key appears twice in {name} (line {number})")
            out[key] = parts
    return out, problems


def main(inventory, database, label):
    inv, problems = rows(inventory, 6, "the inventory")
    db, more = rows(database, 3, "the database rows")
    problems += more
    only_db, only_inv = set(db) - set(inv), set(inv) - set(db)
    if only_db:
        problems.append(f"{len(only_db)} verified R2 originals of the restored database are not in the inventory")
    if only_inv:
        problems.append(f"{len(only_inv)} inventory entries are not in the restored database")
    bad = {"sha256": 0, "size": 0, "copy key": 0, "state": 0}
    for key in set(db) & set(inv):
        d_sha, d_size, _ = db[key]
        i_sha, tag, _, i_size, i_copy, i_state = inv[key]
        if i_sha != d_sha or not re.fullmatch(r"[0-9a-f]{64}", d_sha):
            bad["sha256"] += 1
        if i_size != d_size or tag != "r2":
            bad["size"] += 1
        if not re.fullmatch(rf"media/{re.escape(label)}/r2/[0-9]{{6}}/objects/{d_sha}\.age", i_copy):
            bad["copy key"] += 1
        if i_state != "ok":
            bad["state"] += 1
    for what, n in bad.items():
        if n:
            problems.append(f"{n} inventory entries differ from the restored database in their {what}")
    for text in problems:
        print("P", text)
    print("N", len(set(db) & set(inv)) if problems else len(db))


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit("usage: r2-inventory-compare.py <inventory.tsv> <database.tsv> <label>")
    main(*sys.argv[1:4])
