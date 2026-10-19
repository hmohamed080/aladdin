"""Diff two pgss-snapshot.sh TSVs: per-statement calls / time / buffer deltas, heaviest first.
   python3 -I scripts/perf/pgss-diff.py before.tsv after.tsv [top]"""
import sys

def load(path):
    out = {}
    for line in open(path, encoding="utf-8"):
        p = line.rstrip("\n").split("\t")
        if len(p) < 8:
            continue
        out[(p[0], p[1])] = (int(p[2]), float(p[3]), int(p[4]), int(p[5]), int(p[6]), p[7])
    return out

a, b = load(sys.argv[1]), load(sys.argv[2])
top = int(sys.argv[3]) if len(sys.argv) > 3 else 15
rows = []
for k, v in b.items():
    o = a.get(k, (0, 0.0, 0, 0, 0, ""))
    calls, ms = v[0] - o[0], v[1] - o[1]
    if calls > 0:
        rows.append((ms, calls, v[2] - o[2], v[3] - o[3], v[4] - o[4], k[1], v[5]))
rows.sort(reverse=True)
tot_ms, tot_calls = sum(r[0] for r in rows), sum(r[1] for r in rows)
print(f"statements={len(rows)} calls={tot_calls} exec_ms={tot_ms:.1f}")
print("exec_ms\tcalls\tms/call\trows\tblk_hit\tblk_read\trole\tquery")
for ms, calls, nrows, hit, read, role, q in rows[:top]:
    print(f"{ms:.1f}\t{calls}\t{ms / calls:.2f}\t{nrows}\t{hit}\t{read}\t{role}\t{q}")
