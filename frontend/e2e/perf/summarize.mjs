// Markdown tables from run-ab.sh output (a directory of <before|after>-<page>.json).
//   node e2e/perf/summarize.mjs /tmp/cwv            (A_LABEL / B_LABEL as in run-ab.sh)
import { readdirSync, readFileSync } from "node:fs";

const dir = process.argv[2] ?? "/tmp/cwv";
const rows = readdirSync(dir).filter((f) => f.endsWith(".json")).flatMap((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")));
const TARGET = { lcp: 2500, inp: 200, cls: 0.1 };
const key = (r) => `${r.page}|${r.profile}`;
const A = process.env.A_LABEL ?? "after";
const B = process.env.B_LABEL ?? "before";
const by = new Map();
for (const r of rows) by.set(key(r), { ...(by.get(key(r)) ?? {}), [r.label === A ? "after" : r.label === B ? "before" : r.label]: r });
const fmt = (v, unit = "") => (v === null || v === undefined ? "n/a" : `${v}${unit}`);
const verdict = (m) => (m.lcp <= TARGET.lcp && (m.inp ?? 0) <= TARGET.inp && m.cls <= TARGET.cls ? "pass" : "FAIL");
const range = (runs, k) => {
  const xs = runs.map((r) => r[k]).filter((x) => x !== null);
  return xs.length ? `${Math.min(...xs)}–${Math.max(...xs)}` : "n/a";
};

for (const profile of ["mobile", "desktop"]) {
  console.log(`\n### ${profile}\n`);
  console.log(`| Page | LCP ms (${B} → ${A}) | INP ms | CLS | TTFB ms | TBT ms | JS KB / total KB (${A}) | load1 (${B} / ${A}) | ${A} vs targets |`);
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const [k, v] of by) {
    if (!k.endsWith(`|${profile}`)) continue;
    const b = v.before?.median ?? {};
    const a = v.after?.median ?? {};
    console.log(
      `| ${k.split("|")[0]} | ${fmt(b.lcp)} → **${fmt(a.lcp)}** | ${fmt(b.inp)} → **${fmt(a.inp)}** | ${fmt(b.cls)} → **${fmt(a.cls)}** | ${fmt(b.ttfb)} → ${fmt(a.ttfb)} | ${fmt(b.tbt)} → ${fmt(a.tbt)} | ${fmt(a.jsKb)} / ${fmt(a.kb)} | ${fmt(b.load1)} / ${fmt(a.load1)} | ${v.after ? verdict(a) : "n/a"} |`,
    );
  }
}

console.log(`\n### Per-run spread and attribution (${A})\n`);
console.log("| Page | Profile | LCP range | INP range | LCP element (last run) | Interaction | Worst shift |");
console.log("|---|---|---|---|---|---|---|");
for (const v of by.values()) {
  const a = v.after;
  if (!a) continue;
  const last = a.runs[a.runs.length - 1];
  console.log(`| ${a.page} | ${a.profile} | ${range(a.runs, "lcp")} | ${range(a.runs, "inp")} | \`${last.lcpEl.replace(/\|/g, "/")}\` | ${last.action.replace(/\|/g, "/")} | ${last.clsSrc || "none"} |`);
}
