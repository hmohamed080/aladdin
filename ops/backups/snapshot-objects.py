#!/usr/bin/env python3
"""Media list of ONE database snapshot, read from the dump itself (data.sql), so it matches the backup exactly.

  python3 snapshot-objects.py <data.sql> <objects.tsv> [<r2-objects.tsv>]

Writes objects.tsv: id, bucket, name, size, etag (one storage.objects row per line, as the dump holds them)
With a third argument it also writes r2-objects.tsv: sha256, size, physical key (one VERIFIED live R2 original per
line; the key is storage_key when set, else namespace/object_key, exactly as the media service resolves it).
It prints the number of live R2 media records (media_storage_locations: provider r2, not cleaned), whose
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


def main(data, out, r2_out=None):
    objects, r2, r2_rows = None, 0, []
    for name, rows in tables(data):
        if name == "storage.objects":
            objects = rows
        elif name == "public.media_storage_locations":
            live = [r for r in rows if r.get("provider") == "r2" and r.get("cleaned_at") is None]
            r2 = len(live)
            r2_rows = [r for r in live if r.get("verified_at") is not None]
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
    if r2_out is not None:
        seen = set()
        with open(r2_out, "w", encoding="utf-8") as f:
            for r in sorted(r2_rows, key=lambda r: (r["namespace"], r["object_key"])):
                key = r.get("storage_key") or f'{r["namespace"]}/{r["object_key"]}'
                sha, size = r.get("sha256") or "", r.get("size_bytes") or ""
                if not re.fullmatch(r"[0-9a-f]{64}", sha) or not size.isdigit() or int(size) <= 0:
                    sys.exit("a verified R2 media record lacks its sha256 or size")
                if "\t" in key or "\n" in key or key.startswith("/") or ".." in key.split("/") or key in seen:
                    sys.exit("unexpected R2 object key")
                seen.add(key)
                f.write(f"{sha}\t{size}\t{key}\n")
    print(r2)


if __name__ == "__main__":
    main(*sys.argv[1:4])
