#!/usr/bin/env node
/**
 * Pure comparison of two catalog-fingerprint.sql outputs (before/after a migration). No network.
 *   node catalog-diff.mjs <before.json> <after.json> [--expect-changed id1;id2;...  (function: schema.name)]
 * Prints every added/removed/changed key per section. With --expect-changed, exits 1 unless the set of touched objects
 * (function signatures in functions_def/functions_meta, any other section key) is EXACTLY the expected list.
 * Input is either the raw jsonb, an array of rows, or { rows: [...] } with a `fingerprint` column (db query -o json).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function load(text) {
  const start = text.search(/[\[{]/);
  if (start < 0) throw new Error("no JSON in input");
  let doc = JSON.parse(text.slice(start));
  if (Array.isArray(doc)) doc = doc[0];
  else if (doc?.rows) doc = doc.rows[0];
  if (doc?.fingerprint) doc = doc.fingerprint;
  if (typeof doc === "string") doc = JSON.parse(doc);
  if (!doc?.functions_def) throw new Error("not a catalog fingerprint");
  return doc;
}

/** @returns {{touched: Map<string,string[]>, lines: string[]}} touched: object key -> sections where it differs */
export function diff(before, after) {
  const touched = new Map(), lines = [];
  for (const sec of Object.keys({ ...before, ...after })) {
    if (sec === "counts") continue;
    const b = before[sec] ?? {}, a = after[sec] ?? {};
    for (const k of Object.keys({ ...b, ...a })) {
      const kind = !(k in b) ? "added" : !(k in a) ? "removed" : JSON.stringify(b[k]) !== JSON.stringify(a[k]) ? "changed" : null;
      if (!kind) continue;
      lines.push(`${kind.padEnd(7)} ${sec}: ${k}`);
      touched.set(k, [...(touched.get(k) ?? []), `${sec}:${kind}`]);
    }
  }
  return { touched, lines };
}

export function checkExpected(touched, expected) {
  // an expected entry is an exact key or a schema-qualified function name (matches every overload: name + "(")
  const hit = (k, e) => k === e || k.startsWith(e + "(");
  const p = [];
  for (const k of touched.keys()) if (!expected.some((e) => hit(k, e))) p.push(`unexpected change: ${k} (${touched.get(k).join(", ")})`);
  for (const e of expected) if (![...touched.keys()].some((k) => hit(k, e))) p.push(`expected change missing: ${e}`);
  return p;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const [bf, af, ...rest] = process.argv.slice(2);
    const i = rest.indexOf("--expect-changed");
    const { touched, lines } = diff(load(readFileSync(bf, "utf8")), load(readFileSync(af, "utf8")));
    console.log(lines.length ? lines.join("\n") : "no catalog differences");
    if (i >= 0) {
      const p = checkExpected(touched, rest[i + 1].split(";").filter(Boolean));
      if (p.length) { console.error("catalog diff: FAILED\n" + p.map((x) => `  - ${x}`).join("\n")); process.exit(1); }
      console.log(`catalog diff: ok (exactly ${touched.size} object(s) changed)`);
    }
  } catch (e) { console.error(`UNUSABLE INPUT: ${e.message}`); process.exit(2); }
}
