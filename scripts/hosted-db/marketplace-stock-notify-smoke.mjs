#!/usr/bin/env node
/**
 * Read-only smoke test for the stock-notify migration 20261124120001 (plans "marketplace-slug" on Acceptance 244 -> 246 and "prod-marketplace-v2" on Production 237 -> 246).
 *
 *   node marketplace-stock-notify-smoke.mjs facts pre  <facts.json> [--applied N --latest V] [--no-templates]   judge marketplace-stock-notify-smoke.sql output taken BEFORE the push
 *   node marketplace-stock-notify-smoke.mjs facts post <facts.json> [--applied N --latest V]                    judge it AFTER the push
 * Defaults are the Acceptance plan: pre 244 / 20261123160002, post 246 / 20261124120001; the apply scripts pass the history they expect.
 * "pre" judges the OLD behaviour (the function passes one variable, the defaults use {product_name}). On Production the stock templates do not exist before the plan
 * (the marketplace-v2 migrations of the same plan seed them), so production-apply.sh passes --no-templates.
 * It reads only (the SQL has no write verb, see the unit test) and cannot see the Worker or the deployed frontend.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const STOCK_VERSION = "20261124120001";

export function parseFacts(text) {
  const start = text.search(/[\[{]/);
  if (start < 0) throw new Error("no JSON in the facts output");
  let doc = JSON.parse(text.slice(start));
  if (doc?.rows) doc = doc.rows;
  if (Array.isArray(doc)) { if (doc.length !== 1) throw new Error("expected exactly one row"); doc = doc[0]; }
  if (doc?.facts) doc = doc.facts;
  if (typeof doc === "string") doc = JSON.parse(doc);
  if (!doc || typeof doc !== "object" || !("fn_passes_localized_names" in doc)) throw new Error("not a marketplace-stock-notify facts row");
  return doc;
}

/** @returns {{ok: boolean, lines: string[]}} */
export function judgeFacts(phase, f, { applied, latest, noTemplates } = {}) {
  const lines = []; let ok = true;
  const out = (pass, text) => { lines.push(`${pass ? "PASS" : "FAIL"}  ${text}`); if (!pass) ok = false; };
  const n = (v) => Number(v);
  if (phase === "pre") {
    const a = applied ?? 244, l = latest ?? "20261123160002";
    out(n(f.applied_migrations) === a && f.latest_migration === l, `history is ${a} / ${l} (got ${f.applied_migrations} / ${f.latest_migration})`);
    out(f.fn_passes_localized_names === false, "the stock notification function does not pass the per-language names yet (or does not exist yet: Production)");
    out(n(f.defaults_localized) === 0 && n(f.defaults_declared) === 0, "no stock template default uses {product_name_ar} / {product_name_en} yet");
    if (noTemplates) out(n(f.stock_templates) === 0, "Production: the stock templates do not exist yet (the marketplace-v2 migrations of the same plan seed them)");
    else out(n(f.stock_templates) === 2, `the two stock templates exist (got ${f.stock_templates})`);
    return { ok, lines };
  }
  const a = applied ?? 246, l = latest ?? STOCK_VERSION;
  out(n(f.applied_migrations) === a && f.latest_migration === l, `history is ${a} / ${l} (got ${f.applied_migrations} / ${f.latest_migration})`);
  out(f.fn_present === true && f.fn_passes_localized_names === true, "app.marketplace_stock_notify() exists and passes product_name_ar and product_name_en");
  out(f.trigger_enabled === true, "trigger marketplace_stock_notify is enabled");
  out(n(f.fn_callable_by_api_roles) === 0, `the function is not executable by anon, authenticated or service_role (${f.fn_callable_by_api_roles} are)`);
  out(n(f.stock_templates) === 2 && n(f.defaults_localized) === 2 && n(f.defaults_declared) === 2, `both stock templates: defaults use the per-language names and variables declares them (templates ${f.stock_templates}, localized ${f.defaults_localized}, declared ${f.defaults_declared})`);
  lines.push(`INFO  ${f.stock_templates_edited} stock template(s) carry an admin edit (never touched by the migration)`);
  return { ok, lines };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const [mode, phase, file] = argv;
  try {
    if (mode === "facts" && (phase === "pre" || phase === "post") && file) {
      const { ok, lines } = judgeFacts(phase, parseFacts(readFileSync(file, "utf8")), { applied: opt("--applied") ? Number(opt("--applied")) : undefined, latest: opt("--latest"), noTemplates: argv.includes("--no-templates") });
      console.log(lines.join("\n") + `\n\nMARKETPLACE STOCK-NOTIFY SMOKE (${phase}): ${ok ? "OK" : "FAILED"}`);
      process.exit(ok ? 0 : 1);
    } else { console.error("usage: marketplace-stock-notify-smoke.mjs facts <pre|post> <facts.json> [--applied N --latest V] [--no-templates]"); process.exit(2); }
  } catch (e) { console.error(`UNUSABLE INPUT: ${e.message}`); process.exit(2); }
}
