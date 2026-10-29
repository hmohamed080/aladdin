#!/usr/bin/env python3
"""Media list of ONE database snapshot, read from the dump itself (data.sql), so it matches the backup exactly.

  python3 snapshot-objects.py <data.sql> <objects.tsv>

Writes objects.tsv: id, bucket, name, size, etag (one storage.objects row per line, as the dump holds them)
and prints the number of live R2 media records (media_storage_locations: provider r2, not cleaned), whose
bytes are NOT in Supabase Storage and therefore not covered by the Supabase media copy.
"""
import json
import re
import sys

COPY = re.compile(r'^COPY "?([a-z_]+)"?\."?([a-z_]+)"? \((.*)\) FROM stdin;\r?$')
ESC = {"t": "\t", "n": "\n", "r": "\r", "\\": "\\", "b": "\b", "f": "\f", "v": "\v"}


def field(raw):
    if raw == r"\N":
        return None
    return re.sub(r"\\(.)", lambda m: ESC.get(m.group(1), m.group(1)), raw)


def tables(path):
    cols, rows, name = None, None, None
    with open(path, encoding="utf-8") as f:
        for line in f:
            if cols is None:
                m = COPY.match(line)
                if m:
                    name, cols, rows = f"{m.group(1)}.{m.group(2)}", [c.strip().strip('"') for c in m.group(3).split(",")], []
                continue
            if line.rstrip("\r\n") == r"\.":
                yield name, rows
                cols = None
                continue
            rows.append(dict(zip(cols, (field(v) for v in line.rstrip("\r\n").split("\t")))))


def main(data, out):
    objects, r2 = None, 0
    for name, rows in tables(data):
        if name == "storage.objects":
            objects = rows
        elif name == "public.media_storage_locations":
            r2 = sum(1 for r in rows if r.get("provider") == "r2" and r.get("cleaned_at") is None)
    if objects is None:
        sys.exit("the dump holds no storage.objects table")
    with open(out, "w", encoding="utf-8") as f:
        for r in objects:
            meta = json.loads(r.get("metadata") or "{}")
            size = int(meta.get("size") or 0)
            if size <= 0:
                continue  # folder placeholders and failed uploads hold no bytes
            etag = re.sub(r"[^0-9A-Za-z]", "", str(meta.get("eTag") or ""))
            if not re.fullmatch(r"[0-9a-f-]{36}", r["id"]) or not re.fullmatch(r"[0-9a-z_-]+", r["bucket_id"]):
                sys.exit("unexpected storage.objects id or bucket")
            if "\t" in r["name"] or "\n" in r["name"]:
                sys.exit("unexpected storage object name")
            f.write(f'{r["id"]}\t{r["bucket_id"]}\t{r["name"]}\t{size}\t{etag}\n')
    print(r2)


if __name__ == "__main__":
    main(*sys.argv[1:3])
