"""Parse `aws s3api list-buckets|list-objects-v2 --output json` safely (stdin -> stdout). Run with python3 -I.

  s3-list.py buckets   -> one bucket name per line
  s3-list.py objects   -> one "<size>\t<key>" line per object

Handles what the AWS CLI does on Windows and for empty buckets: CRLF line endings, a BOM, empty output, "None"/"null",
{} and {"Contents": null} (all mean: no objects). Refuses anything unexpected instead of guessing: unparseable output,
a partial listing (a continuation token or IsTruncated), a key that is not a non-empty string or holds a control
character, a size that is not a non-negative integer, or a bucket name outside [a-z0-9._-]. Output is LF-only UTF-8.
"""
import json, re, sys

def fail(msg):
    sys.stderr.write("s3-list: " + msg + "\n")
    sys.exit(2)

mode = sys.argv[1] if len(sys.argv) == 2 else ""
if mode not in ("buckets", "objects"):
    fail("usage: s3-list.py buckets|objects")
text = sys.stdin.buffer.read().decode("utf-8-sig").strip()
if text in ("", "None", "null"):
    obj = {}
else:
    try:
        obj = json.loads(text)
    except ValueError:
        fail("the listing is not valid JSON")
if obj is None:
    obj = {}
if not isinstance(obj, dict):
    fail("the listing is not a JSON object")
out = sys.stdout.buffer
if mode == "buckets":
    names = []
    for b in obj.get("Buckets") or []:
        n = b.get("Name") if isinstance(b, dict) else None
        if not isinstance(n, str) or not re.fullmatch(r"[a-z0-9._-]+", n):
            fail("a bucket name is missing or unexpected")
        names.append(n)
    if not names:
        fail("no buckets listed: wrong key or endpoint")
    for n in names:
        out.write((n + "\n").encode())
else:
    if obj.get("NextToken") or obj.get("ContinuationToken") or obj.get("NextContinuationToken") or obj.get("IsTruncated") is True:
        fail("partial listing (more pages exist): refusing")
    for o in obj.get("Contents") or []:
        key = o.get("Key") if isinstance(o, dict) else None
        size = o.get("Size") if isinstance(o, dict) else None
        if not isinstance(key, str) or key == "":
            fail("an object has no key")
        if any(ord(c) < 32 or ord(c) == 127 for c in key):
            fail("an object key holds a control character: refusing")
        if isinstance(size, bool) or not isinstance(size, int) or size < 0:
            fail("an object has no valid size")
        out.write(("%d\t%s\n" % (size, key)).encode("utf-8"))
