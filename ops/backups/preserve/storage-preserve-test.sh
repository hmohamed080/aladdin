#!/usr/bin/env bash
# Offline test with a stub `aws` that serves a fixture (no network, no Docker).
set -uo pipefail
H="$(cd "$(dirname "$0")" && pwd)"; T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT; pass=0; failn=0
ok(){ if [ "$2" = 0 ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; failn=$((failn+1)); fi; }
mkdir -p "$T/bin" "$T/fx/avatars/dir/sub folder" "$T/fx/professional-certificates" "$T/fx/business-verification-documents"
printf 'hello avatar' > "$T/fx/avatars/a.png"; printf 'more bytes here' > "$T/fx/avatars/b.png"; : > "$T/fx/professional-certificates/empty"
printf 'unicode and plus' > "$T/fx/avatars/dir/sub folder/ü+é #1.png"
cat > "$T/lister.py" <<'PY'
import json, os, sys
root, mode, what, b = sys.argv[1:5]
if what == "buckets":
    out = {"Buckets": [{"Name": n} for n in sorted(os.listdir(root))]}
else:
    files = []
    for d, _, fs in os.walk(os.path.join(root, b)):
        for f in fs:
            p = os.path.join(d, f); k = os.path.relpath(p, os.path.join(root, b))
            files.append({"Key": k, "Size": 0 if os.environ.get("LIE_EMPTY") else os.path.getsize(p)})
    files.sort(key=lambda x: x["Key"]); out = {"Contents": files}
    if not files:
        out = {"None": {}, "null": None, "{}": {}, "nullc": {"Contents": None}}.get(mode, {}) if mode in ("None", "null", "{}", "nullc") else {}
    if mode == "trunc": out["NextToken"] = "abc"
    if mode == "badkey" and files: out["Contents"][0]["Key"] = "bad\tkey"
txt = json.dumps(out, indent=2)
if what == "objects" and not (out or {}).get("Contents") and mode in ("None", "empty"):
    txt = "None" if mode == "None" else ""
sys.stdout.write(txt + ("\r\n" if mode == "crlf" or mode == "None" else "\n") if mode != "crlf" else txt.replace("\n", "\r\n") + "\r\n")
PY
cat > "$T/bin/aws" <<STUB
#!/usr/bin/env bash
a=("\$@"); cmd=""; for x in "\${a[@]}"; do case "\$x" in list-buckets|list-objects-v2|get-object) cmd=\$x;; esac; done
get(){ for i in "\${!a[@]}"; do [ "\${a[\$i]}" = "\$1" ] && echo "\${a[\$((i+1))]}"; done; }
case \$cmd in
 list-buckets) python3 "$T/lister.py" "$T/fx" "\${LISTMODE:-normal}" buckets x;;
 list-objects-v2) python3 "$T/lister.py" "$T/fx" "\${LISTMODE:-normal}" objects "\$(get --bucket)";;
 get-object) b=\$(get --bucket); k=\$(get --key); cp "$T/fx/\$b/\$k" "\${a[\$((\${#a[@]}-1))]}"; [ "\${FAILGET:-}" ] && exit 1; echo '{}';;
esac
STUB
chmod +x "$T/bin/aws"; export PATH="$T/bin:$PATH"
age-keygen -o "$T/k.txt" 2>"$T/pub.txt"; PUB="$(grep -o 'age1[a-z0-9]*' "$T/pub.txt" | head -1)"
base=(env PROJECT_REF=kkpkgjrweysgvhvkhzun S3_ENDPOINT=x LOCAL_TEST=1 S3_REGION=r AWS_ACCESS_KEY_ID=a AWS_SECRET_ACCESS_KEY=b AGE_RECIPIENTS="$PUB")
"${base[@]}" OUT_DIR="$T/o1" bash "$H/storage-preserve.sh" >/dev/null 2>&1; ok "production needs the typed confirmation" $([ $? = 1 ] && echo 0 || echo 1)
"${base[@]}" CONFIRM="preserve production media" SUPABASE_SERVICE_ROLE_KEY=k OUT_DIR="$T/o2" bash "$H/storage-preserve.sh" >/dev/null 2>&1; ok "refuses to run beside a service-role key" $([ $? = 1 ] && echo 0 || echo 1)
"${base[@]}" CONFIRM="preserve production media" BACKUP_DB_URL=u OUT_DIR="$T/o3" bash "$H/storage-preserve.sh" >/dev/null 2>&1; ok "refuses to run beside a database URL" $([ $? = 1 ] && echo 0 || echo 1)
"${base[@]}" PROJECT_REF=other CONFIRM="preserve production media" OUT_DIR="$T/o4" bash "$H/storage-preserve.sh" >/dev/null 2>&1; ok "refuses an unknown project" $([ $? = 1 ] && echo 0 || echo 1)
"${base[@]}" CONFIRM="preserve production media" OUT_DIR="$T/out" bash "$H/storage-preserve.sh" >/dev/null 2>&1; ok "preservation run succeeds" $?
grep -q '"empty_objects": 1' "$T/out/summary.json"; ok "the zero-size object is recorded as EMPTY" $?
env -u AWS_SECRET_ACCESS_KEY -u AWS_ACCESS_KEY_ID AGE_IDENTITY_FILE="$T/k.txt" EXPECT_OBJECTS=4 bash "$H/storage-preserve-verify.sh" "$T/out" | tail -1 | grep -q 'RESULT: PASS'; ok "read-back PASS with the owner key (4 objects incl. an empty bucket and odd key)" $?
env -u AWS_SECRET_ACCESS_KEY -u AWS_ACCESS_KEY_ID AGE_IDENTITY_FILE="$T/k.txt" EXPECT_OBJECTS=5 bash "$H/storage-preserve-verify.sh" "$T/out" >/dev/null 2>&1; ok "read-back FAILS on a wrong expected count" $([ $? = 1 ] && echo 0 || echo 1)
f="$(ls "$T/out/objects" | head -1)"; printf x >> "$T/out/objects/$f"
env -u AWS_SECRET_ACCESS_KEY -u AWS_ACCESS_KEY_ID AGE_IDENTITY_FILE="$T/k.txt" bash "$H/storage-preserve-verify.sh" "$T/out" >/dev/null 2>&1; ok "read-back FAILS on a tampered file" $([ $? = 1 ] && echo 0 || echo 1)
"${base[@]}" CONFIRM="preserve production media" FAILGET=1 OUT_DIR="$T/o5" bash "$H/storage-preserve.sh" >/dev/null 2>&1; ok "a read failure stops the run" $([ $? = 1 ] && echo 0 || echo 1)
"${base[@]}" CONFIRM="preserve production media" LIE_EMPTY=1 OUT_DIR="$T/o6" bash "$H/storage-preserve.sh" >/dev/null 2>&1; ok "an object listed empty but holding bytes stops the run" $([ $? = 1 ] && echo 0 || echo 1)
for m in crlf None null nullc empty "{}"; do
  "${base[@]}" CONFIRM="preserve production media" LISTMODE="$m" OUT_DIR="$T/m-$m" bash "$H/storage-preserve.sh" >/dev/null 2>&1; ok "listing format '$m' (empty bucket, Windows/CRLF) succeeds" $?
  grep -q '"objects": 4' "$T/m-$m/summary.json"; ok "listing format '$m': 4 objects recorded" $?
done
"${base[@]}" CONFIRM="preserve production media" LISTMODE=trunc OUT_DIR="$T/m-t" bash "$H/storage-preserve.sh" >/dev/null 2>&1; ok "a partial (paginated) listing is refused" $([ $? = 1 ] && echo 0 || echo 1)
"${base[@]}" CONFIRM="preserve production media" LISTMODE=badkey OUT_DIR="$T/m-b" bash "$H/storage-preserve.sh" >/dev/null 2>&1; ok "a key with a control character is refused" $([ $? = 1 ] && echo 0 || echo 1)
mkdir -p "$T/used"; echo x > "$T/used/f"; "${base[@]}" CONFIRM="preserve production media" OUT_DIR="$T/used" bash "$H/storage-preserve.sh" >/dev/null 2>&1; ok "a non-empty OUT_DIR is refused" $([ $? = 1 ] && echo 0 || echo 1)
echo "storage-preserve-test: $pass passed, $failn failed"; [ "$failn" = 0 ]
