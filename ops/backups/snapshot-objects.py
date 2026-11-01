#!/usr/bin/env python3
"""Media list of ONE database snapshot, read from the dump itself (data.sql), so it matches the backup exactly.

  python3 snapshot-objects.py <data.sql> <objects.tsv> [<r2-objects.tsv> [<r2-excluded.json>]]

Writes objects.tsv: id, bucket, name, size, etag (one storage.objects row per line, as the dump holds them)
With a third argument it also writes r2-objects.tsv: sha256, size, physical key (one VERIFIED live R2 original per
line; the key is storage_key when set, else namespace/object_key, exactly as the media service resolves it).
Retired originals are left out of it and counted in r2-excluded.json ({"retired:avatar": 2, ...}: counts only, no keys).
The rule is the one in r2-eligibility.sql (the live and restored database use that file); r2-eligibility-test.sh
proves both give the same answer. A location is retired only when it is provably so; any doubt keeps it required.
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


NEEDED = {"storage.objects", "public.media_storage_locations", "public.profiles", "public.organizations",
          "public.avatar_uploads", "public.portfolio_items", "public.professional_certificates",
          "public.product_images", "public.organization_images"}
# namespace -> (table, key column, owner column)
CANON = {"avatar": ("public.avatar_uploads", "object_key", "owner_user_id"),
         "portfolio": ("public.portfolio_items", "object_key", "owner_user_id"),
         "certificate": ("public.professional_certificates", "object_path", "owner_user_id"),
         "product": ("public.product_images", "object_key", "created_by"),
         "organization": ("public.organization_images", "object_key", "created_by")}


def phys_key(r):
    return r.get("storage_key") or f'{r["namespace"]}/{r["object_key"]}'


def classify(locations, data):
    """Same rule as r2-eligibility.sql. Returns (location, "required" | "retired:<namespace>") per verified live R2 row."""
    canon = {}  # (namespace, key) -> [(state, owner, id)]
    key_namespaces = {}
    for ns, (table, kcol, ocol) in CANON.items():
        for r in data.get(table, []):
            canon.setdefault((ns, r.get(kcol)), []).append((r.get("state"), r.get(ocol), r.get("id")))
            key_namespaces.setdefault(r.get(kcol), set()).add(ns)
    phys_count = {}
    for r in locations:
        phys_count[phys_key(r)] = phys_count.get(phys_key(r), 0) + 1
    pointers = {r.get(c) for r in data.get("public.profiles", []) for c in ("avatar_media_id", "cover_media_id")}
    logos = {r.get("logo_media_id") for r in data.get("public.organizations", [])}
    pointers.discard(None); logos.discard(None)
    for r in locations:
        if not (r.get("provider") == "r2" and r.get("cleaned_at") is None and r.get("verified_at") is not None):
            continue
        ns, rows = r["namespace"], canon.get((r["namespace"], r["object_key"]), [])
        retired = (
            len(rows) == 1 and rows[0][0] == "deleted"
            and rows[0][1] is not None and r.get("owner_user_id") is not None and rows[0][1] == r["owner_user_id"]
            and len(key_namespaces.get(r["object_key"], ())) == 1
            and phys_count[phys_key(r)] == 1
            and not (ns == "avatar" and rows[0][2] in pointers)
            and not (ns == "organization" and rows[0][2] in logos)
        )
        yield r, f"retired:{ns}" if retired else "required"


def main(data, out, r2_out=None, excluded_out=None):
    objects, r2, r2_rows, excluded, tabs, locations = None, 0, [], {}, {}, []
    for name, rows in tables(data):
        if name in NEEDED:
            tabs[name] = rows
    objects = tabs.get("storage.objects")
    locations = tabs.get("public.media_storage_locations", [])
    r2 = sum(1 for r in locations if r.get("provider") == "r2" and r.get("cleaned_at") is None)
    for r, cls in classify(locations, tabs):
        if cls == "required":
            r2_rows.append(r)
        else:
            excluded[cls] = excluded.get(cls, 0) + 1
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
        seen = {}
        with open(r2_out, "w", encoding="utf-8") as f:
            for r in sorted(r2_rows, key=lambda r: (r["namespace"], r["object_key"])):
                key = r.get("storage_key") or f'{r["namespace"]}/{r["object_key"]}'
                sha, size = r.get("sha256") or "", r.get("size_bytes") or ""
                if not re.fullmatch(r"[0-9a-f]{64}", sha) or not size.isdigit() or int(size) <= 0:
                    sys.exit("a verified R2 media record lacks its sha256 or size")
                if "\t" in key or "\n" in key or key.startswith("/") or ".." in key.split("/"):
                    sys.exit("unexpected R2 object key")
                if key in seen:  # two records for one physical object are fine only if they agree on its bytes
                    if seen[key] != (sha, size):
                        sys.exit("two R2 media records disagree about one object key")
                    continue
                seen[key] = (sha, size)
                f.write(f"{sha}\t{size}\t{key}\n")
    if excluded_out is not None:
        with open(excluded_out, "w", encoding="utf-8") as f:
            json.dump(dict(sorted(excluded.items())), f, separators=(",", ":"))
            f.write("\n")
    print(r2)


if __name__ == "__main__":
    main(*sys.argv[1:5])
