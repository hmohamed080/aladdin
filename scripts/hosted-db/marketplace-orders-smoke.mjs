#!/usr/bin/env node
/**
 * Read-only smoke test for the Acceptance plan "marketplace-orders" (246 -> 264) and the Production plan "prod-marketplace-orders" (246 -> 267).
 *
 *   node marketplace-orders-smoke.mjs facts pre  <facts.json>    judge marketplace-orders-smoke.sql output taken BEFORE the push
 *   node marketplace-orders-smoke.mjs facts post <facts.json>    judge it AFTER the push
 *   ... [--plan prod-marketplace-orders]                         PRODUCTION: history ends at 267, 39 templates after; "pre" also pins the template and preset counts
 * "pre" refuses while any order of the old model is still open: the new application cannot act on it (owner decision: legacy orders by data check).
 * It reads only (the SQL has no write verb, see the unit test) and cannot see the Worker, the timers Worker or the deployed frontend.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PLANS } from "./acceptance-gate.mjs";

const PLAN_NAMES = ["marketplace-orders", "prod-marketplace-orders"];

export function parseFacts(text) {
  const start = text.search(/[\[{]/);
  if (start < 0) throw new Error("no JSON in the facts output");
  let doc = JSON.parse(text.slice(start));
  if (doc?.rows) doc = doc.rows;
  if (Array.isArray(doc)) { if (doc.length !== 1) throw new Error("expected exactly one row"); doc = doc[0]; }
  if (doc?.facts) doc = doc.facts;
  if (typeof doc === "string") doc = JSON.parse(doc);
  if (!doc || typeof doc !== "object" || !("orders_open_old_model" in doc)) throw new Error("not a marketplace-orders facts row");
  return doc;
}

/** @returns {{ok: boolean, lines: string[]}} */
export function judgeFacts(phase, f, name = "marketplace-orders") {
  if (!PLAN_NAMES.includes(name)) throw new Error(`this smoke knows the plans ${PLAN_NAMES.join(", ")}, not "${name}"`);
  const P = PLANS[name];
  const prod = P.target === "production";
  const clarity = P.pending.includes(PLANS["marketplace-clarity"].pending[0]); // the combined Production push also adds the 3 clarity templates
  const lines = []; let ok = true;
  const out = (pass, text) => { lines.push(`${pass ? "PASS" : "FAIL"}  ${text}`); if (!pass) ok = false; };
  const is = (key, want, text) => out(f[key] !== null && String(f[key]) === String(want), `${text} (expected ${want}, got ${f[key]})`);
  const launch = () => { if ("marketplace_open" in f) lines.push(`INFO  Marketplace open=${f.marketplace_open}, ${f.approved_sellers} approved seller(s), ${f.marketplace_products} product(s): the push changes none of these`); };
  const history = (a, l) => out(Number(f.applied_migrations) === a && f.latest_migration === l, `history is ${a} / ${l} (got ${f.applied_migrations} / ${f.latest_migration})`);
  if (phase === "pre") {
    history(P.applied, P.latest);
    is("new_tables", 0, "none of the new tables exists yet");
    is("orders_open_old_model", 0, "no order of the old model is still open");
    is("new_permissions", 0, "the two new admin permissions do not exist yet");
    if (prod) { // the "post" counts below assume exactly the seeded rows: refuse before the push, not after it
      is("templates", 8, "notification templates before the push");
      is("presets", 15, "owner-message presets before the push");
    }
    lines.push(`INFO  ${f.orders} order(s), ${f.templates} notification template(s), ${f.presets} owner-message preset(s): write them down`);
    launch();
    return { ok, lines };
  }
  history(P.applied + P.pending.length, P.pending.at(-1));
  is("new_tables", 21, "the 21 new tables exist");
  is("new_tables_without_rls", 0, "row level security is on for every new table");
  is("new_tables_open_to_anon", 0, "anonymous clients have no privilege on any new table");
  is("orders_unmigrated", 0, "every existing order carries the new payment values");
  is("orders_not_legacy", 0, "every existing order is marked legacy");
  is("templates", clarity ? 39 : 36, "notification templates");
  is("presets", 35, "owner-message presets");
  is("new_permissions", 2, "the two new admin permissions exist");
  is("new_permission_grants", 2, "each is granted once");
  is("new_permission_grants_super_admin", 2, "both to the Super Admin only");
  is("return_rules", 6, "return reason rules are seeded");
  is("upload_limits", "50/150/1024", "upload limits: hourly uploads / hourly attempts / storage MB");
  is("functions_without_search_path", 0, "every application function pins its search_path");
  lines.push(`INFO  ${f.orders} order(s) after the push`);
  launch();
  return { ok, lines };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [mode, phase, file, flag, name] = process.argv.slice(2);
  try {
    if (mode === "facts" && (phase === "pre" || phase === "post") && file && (flag === undefined || (flag === "--plan" && name))) {
      const { ok, lines } = judgeFacts(phase, parseFacts(readFileSync(file, "utf8")), name);
      console.log(lines.join("\n") + `\n\nMARKETPLACE ORDERS SMOKE (${phase}): ${ok ? "OK" : "FAILED"}`);
      process.exit(ok ? 0 : 1);
    } else { console.error("usage: marketplace-orders-smoke.mjs facts <pre|post> <facts.json> [--plan <name>]"); process.exit(2); }
  } catch (e) { console.error(`UNUSABLE INPUT: ${e.message}`); process.exit(2); }
}
