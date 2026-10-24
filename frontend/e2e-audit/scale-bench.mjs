// Scale benchmark against the DISPOSABLE stack (55521) only.
import { readFileSync, appendFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).map(l => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map(m => [m[1], m[2].replace(/^"|"$/g, "")]));
const URL_ = "http://127.0.0.1:55521"; const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY; const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const svc = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const OWNER = "70000001-0000-4000-8000-000000000001", ORG = "9c000000-cccc-4ccc-8ccc-000000000001";
const pw = "Scale-" + Math.random().toString(36).slice(2) + "-Q9!";
const u = await svc.auth.admin.updateUserById(OWNER, { password: pw, email_confirm: true });
if (u.error) throw u.error;
const seller = createClient(URL_, ANON, { auth: { persistSession: false } });
const si = await seller.auth.signInWithPassword({ email: u.data.user.email, password: pw }); if (si.error) throw si.error;
const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
const total = (await svc.from("marketplace_products").select("id", { count: "exact", head: true }).eq("status", "published")).count;
const slug = (await svc.from("marketplace_products").select("slug").eq("status", "published").limit(1).single()).data.slug;
const pid = (await svc.from("marketplace_products").select("id").eq("slug", slug).single()).data.id;
const N = Number(process.env.N ?? 15); const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const cases = [
  [anon, "public catalog page 1", "marketplace_public_catalog_page", {}],
  [anon, "public catalog last page", "marketplace_public_catalog_page", { p_offset: Math.max(0, total - 24) }],
  [anon, "public catalog colour filter", "marketplace_public_catalog_page", { p_type: "wallpaper", p_attrs: { color: ["white", "beige"] } }],
  [anon, "public catalog price+stock+sort", "marketplace_public_catalog_page", { p_price_min: 500, p_price_max: 900, p_in_stock: true, p_sort: "price_asc" }],
  [anon, "public catalog search", "marketplace_public_catalog_page", { p_query: "scale product 49" }],
  [anon, "public facets()", "marketplace_public_facets", {}],
  [anon, "public facets(wallpaper)", "marketplace_public_facets", { p_type: "wallpaper" }],
  [anon, "public product detail", "marketplace_public_product", { p_slug: slug }],
  [seller, "seller products page 1", "marketplace_seller_products_page", { p_organization_id: ORG, p_limit: 20, p_offset: 0 }],
  [seller, "seller products deep page", "marketplace_seller_products_page", { p_organization_id: ORG, p_limit: 20, p_offset: Math.max(0, total - 20) }],
  [seller, "seller products search", "marketplace_seller_products_page", { p_organization_id: ORG, p_query: "scale-49", p_limit: 20, p_offset: 0 }],
  [seller, "seller product readiness", "marketplace_seller_product_readiness", { p_product_id: pid }],
];
for (const [c, label, fn, args] of cases) {
  for (let i = 0; i < 2; i++) await c.rpc(fn, args);
  const t = []; let err = null;
  for (let i = 0; i < N; i++) { const t0 = performance.now(); const r = await c.rpc(fn, args); t.push(performance.now() - t0); if (r.error) err = r.error.message.slice(0, 60); }
  const row = { dataset: `${total} published products (${total * 2} variants)`, rpc: label, n: N, p50_ms: +q(t, .5).toFixed(1), p95_ms: +q(t, .95).toFixed(1), error: err };
  console.log(JSON.stringify(row));
  appendFileSync("../docs/qa/audits/2026-10-15-full-audit/traces/scale-bench.jsonl", JSON.stringify(row) + "\n");
}
