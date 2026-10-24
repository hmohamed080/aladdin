import { test, type Browser, type Page } from "@playwright/test";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { OUT, admin, uiSignIn } from "./audit-helpers";

/**
 * Route inventory crawl: every page.tsx under src/app, visited as anonymous,
 * Decore Store (approved seller) and Super Admin. Dynamic segments are filled
 * with real ids visible to that role where cheaply resolvable; otherwise the
 * route is recorded NOT_TESTED. GET navigations only — no form is submitted.
 */
function pages(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const full = path.join(dir, n);
    if (statSync(full).isDirectory()) out.push(...pages(full, `${base}/${n}`));
    else if (n === "page.tsx") out.push(base || "/");
  }
  return out;
}
const ROUTES = pages(path.resolve("src/app")).sort();

async function resolveParams(): Promise<Record<string, string>> {
  const one = async (table: string, col = "id", filter?: [string, string]) => {
    let q = admin.from(table).select(col).limit(1);
    if (filter) q = q.eq(filter[0], filter[1]);
    const { data } = await q;
    return (data?.[0] as Record<string, string> | undefined)?.[col];
  };
  const DECORE = "2d3b6ab7-d5ee-4e7a-80a7-436d0b032b33";
  return {
    "/marketplace/products/[slug]": `/marketplace/products/${(await admin.from("marketplace_products").select("slug").eq("status", "published").limit(1).single()).data?.slug}`,
    "/b2c/seller/products/[id]/edit": `/b2c/seller/products/${await one("marketplace_products", "id", ["seller_organization_id", DECORE])}/edit`,
    "/admin/organizations/[id]": `/admin/organizations/${DECORE}`,
    "/admin/users/[id]": `/admin/users/${(await admin.auth.admin.listUsers({ perPage: 1 })).data.users[0]?.id}`,
    "/p/[profileId]": `/p/${(await admin.from("profiles").select("user_id").limit(1).single()).data?.user_id}`,
    "/b2b/products/[id]": `/b2b/products/${await one("products")}`,
    "/b2b/products/[id]/edit": `/b2b/products/${await one("products")}/edit`,
  };
}

type Row = { route: string; role: string; url: string; status: number; final: string; ms: number; consoleErrors: number; firstError: string; result: string };

async function crawl(browser: Browser, role: string, signIn?: (p: Page) => Promise<void>, params: Record<string, string> = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar-EG" });
  const page = await ctx.newPage();
  if (signIn) await signIn(page);
  const rows: Row[] = [];
  for (const route of ROUTES) {
    const dynamic = route.includes("[");
    const url = dynamic ? params[route] : route;
    if (!url || url.includes("undefined")) {
      rows.push({ route, role, url: "-", status: 0, final: "-", ms: 0, consoleErrors: 0, firstError: "", result: "NOT_TESTED (no id resolved)" });
      continue;
    }
    const errors: string[] = [];
    const onConsole = (m: { type(): string; text(): string }) => {
      if (m.type() === "error" && !/Failed to load resource: the server responded with a status of 404/.test(m.text())) errors.push(m.text().slice(0, 160));
    };
    page.on("console", onConsole);
    const t0 = Date.now();
    let status = 0;
    try {
      const res = await page.goto(url, { waitUntil: "load", timeout: 45_000 });
      status = res?.status() ?? 0;
    } catch (e) {
      errors.push(`navigation: ${(e as Error).message.slice(0, 80)}`);
    }
    const ms = Date.now() - t0;
    await page.waitForTimeout(300);
    page.off("console", onConsole);
    const final = new URL(page.url()).pathname;
    const result = status >= 500 ? "BROKEN (5xx)" : status === 404 ? "404" : final !== url.split("?")[0] ? `redirect → ${final}` : "200";
    rows.push({ route, role, url, status, final, ms, consoleErrors: errors.length, firstError: errors[0] ?? "", result });
  }
  await ctx.close();
  return rows;
}

test("route inventory crawl (3 roles)", async ({ browser }) => {
  test.setTimeout(900_000);
  const params = await resolveParams();
  const all = [
    ...(await crawl(browser, "anonymous")),
    ...(await crawl(browser, "decore (approved seller)", (p) => uiSignIn(p, "decore"), params)),
    ...(await crawl(browser, "super admin", (p) => uiSignIn(p, "admin"), params)),
  ];
  writeFileSync(`${OUT}/traces/route-crawl.json`, JSON.stringify(all, null, 2));
  const head = "route,role,url,status,final,ms,console_errors,result,first_error";
  writeFileSync(`${OUT}/traces/route-crawl.csv`, [head, ...all.map((r) => [r.route, r.role, r.url, r.status, r.final, r.ms, r.consoleErrors, r.result, r.firstError].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n"));
  const broken = all.filter((r) => r.result.startsWith("BROKEN") || r.consoleErrors > 0);
  console.log(`crawled ${all.length} route×role; broken/console: ${broken.length}`);
  for (const b of broken.slice(0, 40)) console.log(` ${b.role} ${b.url} ${b.status} ${b.result} ${b.firstError}`);
});
