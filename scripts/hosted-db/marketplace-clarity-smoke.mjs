#!/usr/bin/env node
/**
 * Read-only smoke test for the Acceptance plan "marketplace-clarity" (264 -> 266).
 *
 *   node marketplace-clarity-smoke.mjs facts pre  <facts.json>    judge marketplace-clarity-smoke.sql output taken BEFORE the push
 *   node marketplace-clarity-smoke.mjs facts post <facts.json>    judge it AFTER the push
 * It reads only (the SQL has no write verb, see the unit test) and cannot see the Worker, the timers Worker or the deployed frontend.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PLANS } from "./acceptance-gate.mjs";

export function parseFacts(text) {
  const start = text.search(/[\[{]/);
  if (start < 0) throw new Error("no JSON in the facts output");
  let doc = JSON.parse(text.slice(start));
  if (doc?.rows) doc = doc.rows;
  if (Array.isArray(doc)) { if (doc.length !== 1) throw new Error("expected exactly one row"); doc = doc[0]; }
  if (doc?.facts) doc = doc.facts;
  if (typeof doc === "string") doc = JSON.parse(doc);
  if (!doc || typeof doc !== "object" || !("new_templates" in doc)) throw new Error("not a marketplace-clarity facts row");
  return doc;
}

/** @returns {{ok: boolean, lines: string[]}} */
export function judgeFacts(phase, f) {
  const P = PLANS["marketplace-clarity"];
  const lines = []; let ok = true;
  const out = (pass, text) => { lines.push(`${pass ? "PASS" : "FAIL"}  ${text}`); if (!pass) ok = false; };
  const is = (key, want, text) => out(f[key] !== null && String(f[key]) === String(want), `${text} (expected ${want}, got ${f[key]})`);
  const history = (a, l) => out(Number(f.applied_migrations) === a && f.latest_migration === l, `history is ${a} / ${l} (got ${f.applied_migrations} / ${f.latest_migration})`);
  const pre = phase === "pre";
  history(pre ? P.applied : P.applied + P.pending.length, pre ? P.latest : P.pending.at(-1));
  is("new_templates", pre ? 0 : 3, pre ? "the three new notification templates do not exist yet" : "the three new notification templates exist");
  is("new_helpers", pre ? 0 : 2, pre ? "the two new internal helpers do not exist yet" : "the two new internal helpers exist");
  is("templates", pre ? 36 : 39, "notification templates");
  if (pre) is("refund_confirm_timers", 0, "no refund confirmation timer exists yet");
  lines.push(`INFO  ${f.active_return_timers} active return timer(s), ${f.return_reject_presets} rejection preset(s), ${f.invoices} issued invoice(s) (issued invoices never change)`);
  return { ok, lines };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [mode, phase, file] = process.argv.slice(2);
  try {
    if (mode === "facts" && (phase === "pre" || phase === "post") && file) {
      const { ok, lines } = judgeFacts(phase, parseFacts(readFileSync(file, "utf8")));
      console.log(lines.join("\n") + `\n\nMARKETPLACE CLARITY SMOKE (${phase}): ${ok ? "OK" : "FAILED"}`);
      process.exit(ok ? 0 : 1);
    } else { console.error("usage: marketplace-clarity-smoke.mjs facts <pre|post> <facts.json>"); process.exit(2); }
  } catch (e) { console.error(`UNUSABLE INPUT: ${e.message}`); process.exit(2); }
}
