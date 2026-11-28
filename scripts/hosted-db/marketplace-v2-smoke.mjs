#!/usr/bin/env node
/**
 * Read-only smoke test for the Acceptance plan "marketplace-v2" (7 Marketplace migrations, 237 -> 244). Two parts, both read-only:
 *
 *   node marketplace-v2-smoke.mjs facts pre  <facts.json>   judge marketplace-v2-smoke.sql output taken BEFORE the push (acceptance-apply.sh does this)
 *   node marketplace-v2-smoke.mjs facts post <facts.json> [--applied N --latest V]   judge it AFTER the push (default 244 / 20261123160002; prod-marketplace-v2 passes 245 / 20261124090001): seeds, defaults, objects, public reads
 *   node marketplace-v2-smoke.mjs http                      anonymous Data API reads of the public Marketplace (owner, after the push; needs no database password)
 *
 * http (PowerShell):  $env:SMOKE_URL = "https://nxossqhdfltcqdwvbewi.supabase.co"; $env:SMOKE_PUBLISHABLE_KEY = "<the Acceptance publishable key>"
 * It only calls public, STABLE, anonymous-readable functions (marketplace_public_status / _catalog_page / _facets) and sends no user token. Only the
 * Acceptance project is accepted by default; Production only with SMOKE_TARGET=production (plan prod-marketplace-v2; SMOKE_EXPECT_OPEN=false after the owner
 * closed the Marketplace on purpose); any other project and any secret/service key is refused.
 *
 * What it cannot see (check by hand, see docs/operations/MARKETPLACE_V2_ACCEPTANCE_PLAN_20261123.md): the Worker flags (VIDEO_ENABLED=false, VIDEO_ROUTES=off) and the
 * deployed frontend version.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ACCEPTANCE_REF = "nxossqhdfltcqdwvbewi";
export const PRODUCTION_REF = "kkpkgjrweysgvhvkhzun";
export const NEW_TABLES = ["marketplace_free_shipping_products", "marketplace_seller_delivery_settings", "marketplace_seller_message_presets",
  "marketplace_seller_preset_events", "marketplace_seller_settings_events", "marketplace_video_events"];
/** Seeds measured on the scratch replay (marketplace-v2-scratch-proof.mjs): 6 + 2 stock templates, 15 owner-message presets. */
export const SEED = { templatesBefore: 6, templatesAfter: 8, presets: 15, presetActions: "approve:1,image_reject:5,reinstate:1,reject:4,revoke:2,suspend:2" };
export const MUST_EXIST = ["app.marketplace_is_open()", "app.marketplace_publication_blockers(uuid)", "app.notify_from_template(uuid,uuid,text,text,uuid,text,jsonb,jsonb,jsonb)",
  "public.admin_marketplace_pending_videos(integer)", "public.admin_marketplace_platform_status()", "public.admin_marketplace_product_review_queue(text,integer,integer)",
  "public.admin_marketplace_seller_presets()", "public.admin_marketplace_set_open(boolean,text)", "public.marketplace_product_video_list(uuid)",
  "public.marketplace_public_browse(text,text,text,text,integer,integer,numeric,numeric,jsonb,boolean,integer,text,text,text)",
  "public.marketplace_public_catalog_page(text,text,text,text,integer,integer,numeric,numeric,boolean,jsonb)", "public.marketplace_public_delivery(text,text,text,text)",
  "public.marketplace_public_facets(text)", "public.marketplace_public_product(text)", "public.marketplace_public_seller(text)", "public.marketplace_public_status()",
  "public.marketplace_seller_commerce_readiness(uuid)"];

/** `supabase db query -o json` output (rows, one `facts` column) or the bare object. */
export function parseFacts(text) {
  const start = text.search(/[\[{]/);
  if (start < 0) throw new Error("no JSON in the facts output");
  let doc = JSON.parse(text.slice(start));
  if (doc?.rows) doc = doc.rows;
  if (Array.isArray(doc)) { if (doc.length !== 1) throw new Error("expected exactly one row"); doc = doc[0]; }
  if (doc?.facts) doc = doc.facts;
  if (typeof doc === "string") doc = JSON.parse(doc);
  if (!doc || typeof doc !== "object" || !("applied_migrations" in doc)) throw new Error("not a marketplace-v2 facts row");
  return doc;
}

/** @returns {{ok: boolean, lines: string[]}} */
export function judgeFacts(phase, f, { applied = 244, latest = "20261123160002" } = {}) {
  const lines = []; let ok = true;
  const out = (pass, text) => { lines.push(`${pass ? "PASS" : "FAIL"}  ${text}`); if (!pass) ok = false; };
  const n = (v) => Number(v);
  if (phase === "pre") {
    out(n(f.applied_migrations) === 237 && f.latest_migration === "20261122090002", `history is 237 / 20261122090002 (got ${f.applied_migrations} / ${f.latest_migration})`);
    out(f.new_tables.length === 0, `none of the 6 new tables exists yet (found ${JSON.stringify(f.new_tables)})`);
    out(n(f.templates) === SEED.templatesBefore && n(f.stock_templates) === 0, `${SEED.templatesBefore} notification templates, no stock template (got ${f.templates} / ${f.stock_templates})`);
    out(f.marketplace_open === null && f.public_status === null, "marketplace_open and the public status function do not exist yet");
    out(f.enum_has_marketplace === false, "enum media_video_scope has no 'marketplace' value yet");
    lines.push(`INFO  media_verification_ready before the push: ${JSON.stringify(f.media_verification_ready)} (20261123100001 sets it to true and the forward-fix does not undo it; note this value)`);
    lines.push(`INFO  existing Marketplace data: ${f.sellers} seller(s), ${f.products} product(s), ${f.published_products} published`);
    return { ok, lines };
  }
  out(n(f.applied_migrations) === applied && f.latest_migration === latest, `history is ${applied} / ${latest} (got ${f.applied_migrations} / ${f.latest_migration})`);
  out(NEW_TABLES.every((t) => f.new_tables.includes(t)) && f.new_tables.length === NEW_TABLES.length, `the 6 new tables exist (${f.new_tables.length})`);
  out(n(f.templates) === SEED.templatesAfter && n(f.stock_templates) === 2, `${SEED.templatesAfter} notification templates, the 2 stock templates seeded (got ${f.templates} / ${f.stock_templates})`);
  out(n(f.presets) === SEED.presets && f.preset_actions === SEED.presetActions, `${SEED.presets} owner-message presets seeded (${f.preset_actions})`);
  out(f.marketplace_open_default === "true", `column marketplace_open defaults to true (${f.marketplace_open_default})`);
  out(f.marketplace_open === true, `marketplace_open is true: the Marketplace is OPEN by default (${JSON.stringify(f.marketplace_open)}); false means somebody closed it`);
  out(f.media_verification_ready === true, `media_verification_ready is true, image verification is mandatory (${JSON.stringify(f.media_verification_ready)})`);
  out(f.enum_has_marketplace === true, "enum media_video_scope has the 'marketplace' value");
  out(n(f.permission) === 1 && n(f.permission_super_admin_locked) === 1 && n(f.permission_other_roles) === 0, "permission marketplace_platform.manage exists, locked to Super Admin only");
  out(n(f.marketplace_videos) === 0, `no Marketplace product video rows (video delivery stays OFF; ${f.marketplace_videos})`);
  const missing = MUST_EXIST.filter((x) => !f.functions_present.includes(x));
  out(missing.length === 0, missing.length ? `missing functions: ${missing.join(", ")}` : `all ${MUST_EXIST.length} key functions exist`);
  out(f.public_status && f.public_status.open === true, `marketplace_public_status() answers ${JSON.stringify(f.public_status)}`);
  out(f.public_catalog_page === "object", `marketplace_public_catalog_page answers (${f.public_catalog_page})`);
  out(f.public_facets === "object", `marketplace_public_facets answers (${f.public_facets})`);
  out(f.publication_blockers_unknown_product === "array", `app.marketplace_publication_blockers answers for an unknown product (${f.publication_blockers_unknown_product})`);
  lines.push(`INFO  Marketplace data now: ${f.sellers} seller(s), ${f.products} product(s), ${f.published_products} published (compare with the "before" line; the plan changes no existing row)`);
  return { ok, lines };
}

export function projectRef(url) { try { return new URL(url).hostname.split(".")[0]; } catch { return ""; } }

export async function runHttp({ fetchImpl = fetch, env = process.env } = {}) {
  const lines = []; let ok = true;
  const out = (pass, text) => { lines.push(`${pass ? "PASS" : "FAIL"}  ${text}`); if (!pass) ok = false; };
  const url = (env.SMOKE_URL ?? "").replace(/\/+$/, ""), key = env.SMOKE_PUBLISHABLE_KEY ?? "";
  if (!url || !key) return { ok: false, lines: ["FAIL  set SMOKE_URL and SMOKE_PUBLISHABLE_KEY (see the header of this file)"] };
  // Acceptance by default. Production only when the owner says so explicitly (SMOKE_TARGET=production, plan prod-marketplace-v2); any other project is refused.
  const want = env.SMOKE_TARGET === "production" ? PRODUCTION_REF : ACCEPTANCE_REF;
  if (projectRef(url) !== want) return { ok: false, lines: [`FAIL  refused: ${url} is not the ${want === PRODUCTION_REF ? "Production" : "Acceptance"} project (${want})${want === ACCEPTANCE_REF ? "; set SMOKE_TARGET=production to smoke Production (read-only, anonymous)" : ""}`] };
  const expectOpen = env.SMOKE_EXPECT_OPEN === "false" ? false : true; // after the owner closed the Marketplace on purpose, expect open=false
  if (key.startsWith("sb_secret_") || key.includes("service_role")) return { ok: false, lines: ["FAIL  refused: pass the PUBLISHABLE key, never a secret/service key"] };
  const rpc = async (name, body) => {
    const r = await fetchImpl(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { status: r.status, json };
  };
  const s = await rpc("marketplace_public_status", {});
  out(s.status === 200 && s.json?.open === expectOpen, `anonymous marketplace_public_status answers open=${expectOpen} (HTTP ${s.status} ${JSON.stringify(s.json)?.slice(0, 60)})`);
  const c = await rpc("marketplace_public_catalog_page", { p_limit: 1 });
  out(c.status === 200 && c.json && typeof c.json === "object", `anonymous marketplace_public_catalog_page answers (HTTP ${c.status})`);
  const f = await rpc("marketplace_public_facets", {});
  out(f.status === 200 && f.json && typeof f.json === "object", `anonymous marketplace_public_facets answers (HTTP ${f.status})`);
  lines.push(ok ? "\nMARKETPLACE V2 HTTP SMOKE: OK" : "\nMARKETPLACE V2 HTTP SMOKE: FAILED - do not continue; roll back only on the owner's GO (forward-fix marketplace-v2)");
  return { ok, lines };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [mode, a, b] = process.argv.slice(2);
  try {
    if (mode === "facts" && (a === "pre" || a === "post") && b) {
      const opt = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : undefined; };
      // --applied/--latest: the history after the push. Default 244 / 20261123160002 (Acceptance plan marketplace-v2); the combined Production plan prod-marketplace-v2 ends at 245 / 20261124090001.
      const { ok, lines } = judgeFacts(a, parseFacts(readFileSync(b, "utf8")), { applied: opt("--applied") ? Number(opt("--applied")) : undefined, latest: opt("--latest") });
      console.log(lines.join("\n") + `\n\nMARKETPLACE V2 SMOKE (${a}): ${ok ? "OK" : "FAILED"}`);
      process.exit(ok ? 0 : 1);
    } else if (mode === "http") {
      const { ok, lines } = await runHttp();
      console.log(lines.join("\n")); process.exit(ok ? 0 : 1);
    } else { console.error("usage: marketplace-v2-smoke.mjs facts <pre|post> <facts.json> | http"); process.exit(2); }
  } catch (e) { console.error(`UNUSABLE INPUT: ${e.message}`); process.exit(2); }
}
