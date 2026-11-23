#!/usr/bin/env python3
"""Compares a snapshot's media inventory with the storage.objects rows of the restored database.

  python3 inventory-compare.py <inventory.tsv> <database.tsv> <label>

inventory.tsv   id, bucket, name, size, copy key, state            (the decrypted <snapshot>.media.tsv)
database.tsv    id, bucket_id, name, size, etag                    (rows of the restored storage.objects with bytes)

Every row must match on object id, bucket, COMPLETE path, size and the copy key that id, bucket and etag give,
and every inventory entry must be marked ok. Prints "P <text>" per finding (ids only, never paths) and finally
"N <count>" with the number of rows compared. Exit 0 when it ran; a crash is the caller's problem.
"""
import re
import sys


def rows(path, width):
    out, problems = {}, []
    with open(path, encoding="utf-8") as f:
        for number, line in enumerate(f, 1):
            line = line.rstrip("\n")
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) != width:
                problems.append(f"{path.rsplit('/', 1)[-1]} line {number} has {len(parts)} columns, not {width}")
                continue
            if parts[0] in out:
                problems.append(f"object {parts[0]} appears twice in {path.rsplit('/', 1)[-1]}")
            out[parts[0]] = parts[1:]
    return out, problems


def sample(ids, n=3):
    ids = sorted(ids)
    return ", ".join(ids[:n]) + (f" and {len(ids) - n} more" if len(ids) > n else "")


def main(inventory, database, label):
    inv, problems = rows(inventory, 6)
    db, more = rows(database, 5)
    problems += more
    for id_, (bucket, name, size, etag) in db.items():
        if not re.fullmatch(r"[0-9a-f-]{36}", id_):
            problems.append(f"unexpected object id {id_!r} in the database rows")
    only_db, only_inv = set(db) - set(inv), set(inv) - set(db)
    if only_db:
        problems.append(f"{len(only_db)} files of the restored database are not in the inventory: {sample(only_db)}")
    if only_inv:
        problems.append(f"{len(only_inv)} inventory entries are not in the restored database: {sample(only_inv)}")
    differs = {"bucket": set(), "path": set(), "size": set(), "copy key": set(), "state": set()}
    for id_ in set(db) & set(inv):
        bucket, name, size, etag = db[id_]
        i_bucket, i_name, i_size, i_key, i_state = inv[id_]
        if i_bucket != bucket:
            differs["bucket"].add(id_)
        if i_name != name:
            differs["path"].add(id_)
        if i_size != size:
            differs["size"].add(id_)
        if i_key != f"media/{label}/supabase/objects/{bucket}/{id_}-{etag or 'noetag'}.age":
            differs["copy key"].add(id_)
        if i_state != "ok":
            differs["state"].add(id_)
    for what, ids in differs.items():
        if ids:
            problems.append(f"{len(ids)} inventory entries differ from the restored database in their {what}: {sample(ids)}")
    for text in problems:
        print("P", text)
    print("N", len(set(db) & set(inv)) if problems else len(db))


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit("usage: inventory-compare.py <inventory.tsv> <database.tsv> <label>")
    main(*sys.argv[1:4])
