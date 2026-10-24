// RPC latency benchmark (read-only RPCs; N runs each, after 3 warm-ups). Local stack, PostgREST over HTTP.
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).map(l => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map(m => [m[1], m[2].replace(/^"|"$/g, "")]));
const acc = Object.fromEntries(readFileSync(".env.local-test-accounts", "utf8").split(/\r?\n/).map(l => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map(m => [m[1], m[2]]));
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const mk = () => createClient(URL_, ANON, { auth: { persistSession: false } });
const anon = mk(); const seller = mk(); const adm = mk();
await seller.auth.signInWithPassword({ email: acc.DECORE_STORE_EMAIL, password: acc.DECORE_STORE_PASSWORD });
await adm.auth.signInWithPassword({ email: acc.ADMIN_EMAIL, password: acc.ADMIN_PASSWORD });
const service = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DECORE = "2d3b6ab7-d5ee-4e7a-80a7-436d0b032b33";
const suzuki = (await service.from("marketplace_products").select("id, slug").eq("external_ref", "106-Suzuki-518").single()).data;
const img = (await service.from("marketplace_product_images").select("id").eq("product_id", suzuki.id).eq("status", "verified").limit(1).single()).data;
const N = Number(process.env.N ?? 30);
const cases = [
  ["anon", "marketplace_public_catalog_page", {}],
  ["anon", "marketplace_public_catalog_page (type+colour+price+stock)", { p_type: "wallpaper", p_attrs: { color: ["pink"] }, p_price_max: 2000, p_in_stock: true }, "marketplace_public_catalog_page"],
  ["anon", "marketplace_public_catalog_page (search)", { p_query: "suzuki" }, "marketplace_public_catalog_page"],
  ["anon", "marketplace_public_facets()", {}, "marketplace_public_facets"],
  ["anon", "marketplace_public_facets(wallpaper)", { p_type: "wallpaper" }, "marketplace_public_facets"],
  ["anon", "marketplace_public_product", { p_slug: suzuki.slug }],
  ["service", "marketplace_public_image_ref", { p_image_id: img.id }],
  ["seller", "marketplace_seller_products_page (page 1 of 795)", { p_organization_id: DECORE, p_limit: 20, p_offset: 0 }, "marketplace_seller_products_page"],
  ["seller", "marketplace_seller_products_page (page 40)", { p_organization_id: DECORE, p_limit: 20, p_offset: 780 }, "marketplace_seller_products_page"],
  ["seller", "marketplace_seller_products_page (search)", { p_organization_id: DECORE, p_query: "jaguar", p_limit: 20, p_offset: 0 }, "marketplace_seller_products_page"],
  ["seller", "marketplace_seller_product_get (7 variants)", { p_product_id: suzuki.id }, "marketplace_seller_product_get"],
  ["seller", "marketplace_seller_product_readiness", { p_product_id: suzuki.id }],
  ["admin", "admin_marketplace_seller_overview", {}],
  ["admin", "admin_marketplace_media_queue", { p_status: "verified", p_limit: 48, p_offset: 0 }],
  ["admin", "admin_marketplace_media_settings", {}],
];
const clients = { anon, seller, admin: adm, service };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const rows = [];
for (const [who, label, args, fn] of cases) {
  const c = clients[who]; const name = fn ?? label;
  for (let i = 0; i < 3; i++) await c.rpc(name, args);
  const t = []; let bytes = 0, err = null;
  for (let i = 0; i < N; i++) { const t0 = performance.now(); const r = await c.rpc(name, args); t.push(performance.now() - t0); if (r.error) err = r.error.code; bytes = JSON.stringify(r.data ?? null).length; }
  rows.push({ rpc: label, role: who, n: N, p50_ms: +q(t, 0.5).toFixed(1), p95_ms: +q(t, 0.95).toFixed(1), max_ms: +Math.max(...t).toFixed(1), response_bytes: bytes, error: err });
}
console.table(rows);
writeFileSync("../docs/qa/audits/2026-10-15-full-audit/traces/rpc-bench.json", JSON.stringify(rows, null, 2));
