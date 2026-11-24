#!/usr/bin/env node
/**
 * Read-only smoke test for the slug migration 20261124090001 (plans "marketplace-slug" on Acceptance 244 -> 245 and "prod-marketplace-v2" on Production 237 -> 245).
 *
 *   node marketplace-slug-smoke.mjs facts pre  <facts.json> [--applied N --latest V]   judge marketplace-slug-smoke.sql output taken BEFORE the push
 *   node marketplace-slug-smoke.mjs facts post <facts.json> [--applied N --latest V]   judge it AFTER the push
 * Defaults are the Acceptance plan: pre 244 / 20261123160002, post 245 / 20261124090001. production-apply.sh passes the Production history (237 before).
 * It reads only (the SQL has no write verb, see the unit test) and cannot see the Worker or the deployed frontend.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SLUG_VERSION = "20261124090001";

export function parseFacts(text) {
  const start = text.search(/[\[{]/);
  if (start < 0) throw new Error("no JSON in the facts output");
  let doc = JSON.parse(text.slice(start));
  if (doc?.rows) doc = doc.rows;
  if (Array.isArray(doc)) { if (doc.length !== 1) throw new Error("expected exactly one row"); doc = doc[0]; }
  if (doc?.facts) doc = doc.facts;
  if (typeof doc === "string") doc = JSON.parse(doc);
  if (!doc || typeof doc !== "object" || !("fn_assign" in doc)) throw new Error("not a marketplace-slug facts row");
  return doc;
}

/** @returns {{ok: boolean, lines: string[]}} */
export function judgeFacts(phase, f, { applied, latest } = {}) {
  const lines = []; let ok = true;
  const out = (pass, text) => { lines.push(`${pass ? "PASS" : "FAIL"}  ${text}`); if (!pass) ok = false; };
  const n = (v) => Number(v);
  if (phase === "pre") {
    const a = applied ?? 244, l = latest ?? "20261123160002";
    out(n(f.applied_migrations) === a && f.latest_migration === l, `history is ${a} / ${l} (got ${f.applied_migrations} / ${f.latest_migration})`);
    out(f.fn_assign === false && f.fn_trigger === false && f.trigger_present === false, "none of the slug objects exists yet (2 functions, 1 trigger)");
    lines.push(`INFO  ${f.approved_without_slug} of ${f.approved_sellers} approved seller(s) have no slug: the backfill gives exactly these organizations a slug (the only data the plan writes; note the count)`);
    return { ok, lines };
  }
  const a = applied ?? 245, l = latest ?? SLUG_VERSION;
  out(n(f.applied_migrations) === a && f.latest_migration === l, `history is ${a} / ${l} (got ${f.applied_migrations} / ${f.latest_migration})`);
  out(f.fn_assign === true && f.fn_trigger === true, "app.marketplace_assign_org_slug(uuid) and app.marketplace_seller_slug_trigger() exist");
  out(f.trigger_present === true && f.trigger_enabled === true && f.trigger_runs_slug_fn === true, "trigger marketplace_seller_slug_assign exists on marketplace_seller_accounts, is enabled and runs the slug trigger function");
  out(n(f.fns_callable_by_api_roles) === 0, `the slug functions are not executable by anon, authenticated or service_role (${f.fns_callable_by_api_roles} are)`);
  out(n(f.approved_without_slug) === 0, `every approved seller has a slug (${f.approved_without_slug} without, of ${f.approved_sellers} approved)`);
  lines.push(`INFO  ${f.orgs_with_slug} organization(s) now have a slug`);
  return { ok, lines };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const [mode, phase, file] = argv;
  try {
    if (mode === "facts" && (phase === "pre" || phase === "post") && file) {
      const { ok, lines } = judgeFacts(phase, parseFacts(readFileSync(file, "utf8")), { applied: opt("--applied") ? Number(opt("--applied")) : undefined, latest: opt("--latest") });
      console.log(lines.join("\n") + `\n\nMARKETPLACE SLUG SMOKE (${phase}): ${ok ? "OK" : "FAILED"}`);
      process.exit(ok ? 0 : 1);
    } else { console.error("usage: marketplace-slug-smoke.mjs facts <pre|post> <facts.json> [--applied N --latest V]"); process.exit(2); }
  } catch (e) { console.error(`UNUSABLE INPUT: ${e.message}`); process.exit(2); }
}
