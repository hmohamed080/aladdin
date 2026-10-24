// Builds PERFORMANCE_RESULTS.csv from the raw traces (no hand-entered numbers).
const fs = require("fs");
const path = require("path");
const dir = path.resolve(__dirname, "..");
const T = (f) => path.join(dir, "traces", f);
const q = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]) : null; };
const rows = [["category", "item", "dataset", "role", "profile", "cache", "n", "metric", "p50_ms", "p95_ms", "extra", "budget", "verdict", "evidence"]];
const verdict = (v, good, poor) => (v == null ? "NO_DATA" : v <= good ? "GOOD" : v <= poor ? "NEEDS_IMPROVEMENT" : "POOR");

// Pages (lab). Run 1 of "cold" is the only truly cold load (Chromium memory cache survives CDP cache-disable on later runs).
const raw = JSON.parse(fs.readFileSync(T("page-perf-raw.json"), "utf8"));
const keys = [...new Set(raw.map((r) => `${r.page}|${r.profile}|${r.cache}`))];
for (const k of keys) {
  const [page, profile, cache] = k.split("|");
  const all = raw.filter((r) => r.page === page && r.profile === profile && r.cache === cache);
  const ok = all.filter((r) => !r.error);
  const errs = all.length - ok.length;
  const role = all[0].role;
  const ds = "QA DB: 1 published, 795 Decore products";
  const lcp = ok.map((r) => r.lcp), ttfb = ok.map((r) => r.ttfb), load = ok.map((r) => r.load);
  const first = ok.find((r) => r.run === 1);
  const extra = `ttfb_p50=${pct(ttfb, 50)}; load_p50=${pct(load, 50)}; cls_max=${ok.length ? Math.max(...ok.map((r) => r.cls)).toFixed(3) : ""}; requests=${first?.requests ?? ""}; run1_transfer_kb=${first ? Math.round(first.totalBytes / 1024) : ""}; run1_img_kb=${first ? Math.round(first.imgBytes / 1024) : ""}; js_decoded_kb=${first ? Math.round(first.jsDecoded / 1024) : ""}${errs ? `; TIMEOUTS=${errs}/${all.length} (60 s)` : ""}`;
  rows.push(["page", page, ds, role, profile, cache, ok.length, "LCP", pct(lcp, 50), pct(lcp, 95), extra, "LCP ≤2500 good / ≤4000", errs ? "POOR (timeouts)" : verdict(pct(lcp, 95), 2500, 4000), "traces/page-perf-raw.json"]);
}
// RPCs on QA DB
for (const r of JSON.parse(fs.readFileSync(T("rpc-bench.json"), "utf8")))
  rows.push(["rpc", r.rpc, "QA DB (795 Decore products, 1 published)", r.role, "server (supabase-js, localhost)", "", r.n, "round-trip", Math.round(r.p50_ms), Math.round(r.p95_ms), `max=${r.max_ms}; bytes=${r.response_bytes}`, "p95 ≤200", r.error ? "ERROR" : verdict(r.p95_ms, 200, 1000), "traces/rpc-bench.json"]);
// Scale (disposable stack)
for (const l of fs.readFileSync(T("scale-bench.jsonl"), "utf8").trim().split("\n")) {
  const r = JSON.parse(l);
  rows.push(["scale", r.rpc, `disposable stack: ${r.dataset}`, /seller/.test(r.rpc) ? "seller" : "anon", "server", "", r.n, "round-trip", Math.round(r.p50_ms), Math.round(r.p95_ms), r.error ? `ERROR: ${r.error}` : "", "p95 ≤200 (anon statement_timeout = 3 s)", r.error ? "FAIL (statement timeout)" : verdict(r.p95_ms, 200, 1000), "traces/scale-bench.jsonl"]);
}
// Actions
const acts = {};
for (const l of fs.readFileSync(T("perf-results.jsonl"), "utf8").trim().split("\n")) {
  const r = JSON.parse(l);
  (acts[`${r.kind}|${r.action}`] ??= []).push(r.ms);
}
for (const [k, v] of Object.entries(acts)) {
  const [kind, action] = k.split("|");
  rows.push([kind === "rpc" ? "rpc-write" : "user-action", action, /Import|import/.test(action) ? "fixture org" : "QA DB (1 published product)", /admin/.test(action) ? "admin" : /seller|save|stock|import|Import|publish/.test(action) ? "seller (fixture/Decore)" : "anonymous", "desktop 1440", "warm", v.length, "input→rendered", pct(v, 50), pct(v, 95), "", "≤1000 (actions), ≤200 (RPC)", verdict(pct(v, 95), kind === "rpc" ? 200 : 1000, kind === "rpc" ? 1000 : 3000), "traces/perf-results.jsonl"]);
}
fs.writeFileSync(path.join(dir, "PERFORMANCE_RESULTS.csv"), "﻿" + rows.map((r) => r.map(q).join(",")).join("\n") + "\n");
console.log(rows.length - 1, "rows");
