#!/usr/bin/env node
/**
 * Read-only smoke test for the Acceptance plan "marketplace-retest" (266 -> 267); its "post" phase also judges the Production plan "prod-marketplace-orders".
 *
 *   node marketplace-retest-smoke.mjs facts pre  <facts.json>    judge marketplace-retest-smoke.sql output taken BEFORE the push
 *   node marketplace-retest-smoke.mjs facts post <facts.json>    judge it AFTER the push
 *   ... facts post <facts.json> --plan prod-marketplace-orders    PRODUCTION (there is no "pre": the SQL reads tables the same push creates)
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
  if (!doc || typeof doc !== "object" || !("money_helper" in doc)) throw new Error("not a marketplace-retest facts row");
  return doc;
}

/** @returns {{ok: boolean, lines: string[]}} */
export function judgeFacts(phase, f, name = "marketplace-retest") {
  if (name !== "marketplace-retest" && !(name === "prod-marketplace-orders" && phase === "post")) throw new Error(`this smoke judges marketplace-retest, and only "post" for prod-marketplace-orders, not "${phase}" for "${name}"`);
  const P = PLANS[name];
  const lines = []; let ok = true;
  const out = (pass, text) => { lines.push(`${pass ? "PASS" : "FAIL"}  ${text}`); if (!pass) ok = false; };
  const is = (key, want, text) => out(f[key] !== null && String(f[key]) === String(want), `${text} (expected ${want}, got ${f[key]})`);
  const history = (a, l) => out(Number(f.applied_migrations) === a && f.latest_migration === l, `history is ${a} / ${l} (got ${f.applied_migrations} / ${f.latest_migration})`);
  const pre = phase === "pre";
  history(pre ? P.applied : P.applied + P.pending.length, pre ? P.latest : P.pending.at(-1));
  is("money_helper", pre ? 0 : 1, pre ? "the money helper does not exist yet" : "the money helper exists");
  is("writers_using_helper", pre ? 0 : 4, "notification writers using the helper");
  is("writers_old_format", pre ? 4 : 0, "notification writers with the old money format");
  is("invoice_address_fallback", pre ? 0 : 1, "the invoice falls back to the showroom branch address");
  is("waybill_payment_status", pre ? 0 : 1, "the waybill returns the payment status");
  is("templates", 39, "notification templates (unchanged)");
  lines.push(`INFO  ${f.invoices} issued invoice(s) (issued invoices never change), ${f.showrooms_selling_without_address} selling showroom(s) with no branch address at all`);
  return { ok, lines };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [mode, phase, file, flag, name] = process.argv.slice(2);
  try {
    if (mode === "facts" && (phase === "pre" || phase === "post") && file && (flag === undefined || (flag === "--plan" && name))) {
      const { ok, lines } = judgeFacts(phase, parseFacts(readFileSync(file, "utf8")), name);
      console.log(lines.join("\n") + `\n\nMARKETPLACE RETEST SMOKE (${phase}): ${ok ? "OK" : "FAILED"}`);
      process.exit(ok ? 0 : 1);
    } else { console.error("usage: marketplace-retest-smoke.mjs facts <pre|post> <facts.json> [--plan <name>]"); process.exit(2); }
  } catch (e) { console.error(`UNUSABLE INPUT: ${e.message}`); process.exit(2); }
}
