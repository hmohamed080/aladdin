import { test, type Page } from "@playwright/test";
import { IDENTITIES, signIn } from "../helpers/auth";
import { psql } from "../regression/setup";
import { prefs } from "../regression/util";
import { appendRoute } from "./audit-util";

/** Route health sweep: status, redirect target, console errors, overflow, direction. No screenshots. */
const q = (s: string) => psql(s).trim();
const SUITE = "/showroom";

async function visit(page: Page, persona: string, route: string, vp: "desk-en" | "mob-ar") {
  const errors: string[] = [];
  const onConsole = (m: import("@playwright/test").ConsoleMessage) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); };
  const onPageError = (e: Error) => errors.push(String(e).slice(0, 200));
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  let status = 0, finalPath = "", overflow = 0, dir: string | null = null, h1 = "", chars = 0, nf = false;
  try {
    const res = await page.goto(route, { waitUntil: "domcontentloaded", timeout: 90_000 });
    status = res?.status() ?? 0;
    await page.waitForLoadState("load", { timeout: 60_000 }).catch(() => undefined);
    await page.waitForTimeout(500);
    finalPath = new URL(page.url()).pathname;
    overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    dir = await page.evaluate(() => document.documentElement.getAttribute("dir"));
    h1 = await page.evaluate(() => (document.querySelector("h1")?.textContent ?? "").trim().slice(0, 80));
    const body = await page.evaluate(() => document.body.innerText);
    chars = body.length;
    nf = /this page could not be found|404/i.test(body.slice(0, 600));
  } catch (e) {
    errors.push("NAV_FAIL " + String(e).slice(0, 160));
  }
  page.off("console", onConsole);
  page.off("pageerror", onPageError);
  appendRoute({ route, persona: `${persona}@${vp}`, status, finalPath, consoleErrors: errors, overflowPx: overflow, dir, h1, bodyChars: chars, notFoundShell: nf });
}

async function sweep(page: Page, persona: string, routes: string[], both: boolean) {
  for (const vp of both ? (["desk-en", "mob-ar"] as const) : (["desk-en"] as const)) {
    await prefs(page, vp === "desk-en" ? { locale: "en", theme: "light" } : { locale: "ar", theme: "dark" });
    await page.setViewportSize(vp === "desk-en" ? { width: 1440, height: 900 } : { width: 390, height: 844 });
    for (const r of routes) await visit(page, persona, r, vp);
  }
}

test.describe.configure({ mode: "serial" });

test("sweep anonymous", async ({ page }) => {
  test.setTimeout(1_200_000);
  await sweep(page, "anonymous", [
    "/auth/sign-in", "/auth/sign-up", "/auth/forgot-password", "/auth/forgot-password/verify", "/auth/forgot-password/reset", "/auth/forgot-password/success",
    "/auth/recovery", "/auth/support", "/auth/verify", "/auth/finish-registration", "/auth/invite/not-a-token",
    "/legal/privacy", "/legal/terms", "/preview/landing",
    "/preview/auth-password/sign-in", "/preview/auth-password/sign-up", "/preview/installer-account", "/preview/installer-dashboard",
    "/b2b", "/home", "/business/applications", "/home/independent-publishing", "/admin", "/onboarding",
  ], false);
});

test("sweep showroom owner (hana)", async ({ page, request }) => {
  test.setTimeout(2_400_000);
  const product = q(`select p.id from public.products p join public.organizations o on o.id = p.organization_id where o.name like 'Cairo Ceramics%' and p.deleted_at is null order by p.created_at limit 1`);
  const other = q(`select p.id from public.products p join public.organizations o on o.id = p.organization_id where o.name not like 'Cairo Ceramics%' and p.status = 'published' and p.deleted_at is null order by p.created_at limit 1`);
  const offer = q(`select id from public.product_offers limit 1`);
  const lead = q(`select id from public.leads limit 1`);
  const cust = q(`select id from public.customers limit 1`);
  await prefs(page, { locale: "en", theme: "light" });
  await signIn(page, request, IDENTITIES.showroom);
  const routes = [
    "/b2b", "/b2b/activity", "/b2b/buyers", "/b2b/catalog", `/b2b/catalog/${other}`, "/b2b/customers", ...(cust ? [`/b2b/customers/${cust}`, `/b2b/customers/${cust}/edit`] : []), "/b2b/customers/new",
    "/b2b/follow-ups", "/b2b/institutions", "/b2b/jobs", "/b2b/jobs/new", "/b2b/leads", ...(lead ? [`/b2b/leads/${lead}`, `/b2b/leads/${lead}/edit`] : []), "/b2b/leads/new",
    "/b2b/offers", `/b2b/offers/${offer}`, "/b2b/orders", "/b2b/orders/da000001-0000-4000-8000-000000000001", "/b2b/organization", "/b2b/points",
    "/b2b/products", `/b2b/products/${product}`, `/b2b/products/${product}/edit`, "/b2b/products/new",
    "/b2b/projects", "/b2b/projects/db000001-0000-4000-8000-000000000001", "/b2b/quotations", "/b2b/quotations/d3000001-0000-4000-8000-000000000001",
    "/b2b/reports", "/b2b/rfqs", "/b2b/rfqs/d8000001-0000-4000-8000-000000000001", "/b2b/rfqs/new", "/b2b/saved", "/b2b/settings", "/b2b/suppliers", "/b2b/technicians",
    `${SUITE}`, `${SUITE}/home`, `${SUITE}/catalog`, `${SUITE}/catalog/${other}`, `${SUITE}/offers`, `${SUITE}/offers/${offer}`, `${SUITE}/my-products`,
    `${SUITE}/my-products/new`, `${SUITE}/my-products/${product}/edit`, `${SUITE}/my-offers`, `${SUITE}/my-offers/new`, `${SUITE}/my-offers/${offer}/edit`,
    `${SUITE}/saved`, `${SUITE}/add-business`, "/business/applications", "/business/new", "/settings/profile", "/home", "/home/independent-publishing", "/admin",
  ];
  await sweep(page, "hana-showroom", routes, true);
});

test("sweep consumer (personal)", async ({ page, request }) => {
  test.setTimeout(1_800_000);
  await prefs(page, { locale: "en", theme: "light" });
  await signIn(page, request, IDENTITIES.consumer, /\/(home|b2b|onboarding)(\/|$)/);
  const profile = q(`select id from public.profiles limit 1`);
  await sweep(page, "consumer", [
    "/home", "/home/jobs", "/home/jobs/applications", "/home/network", "/home/network/refer", "/home/offers", "/home/points", "/home/profile", "/home/profile/certificates",
    "/home/profile/edit", "/home/profile/portfolio", "/home/reviews", "/home/settings", "/home/showroom", "/home/showroom/refer", "/home/work", "/home/independent-publishing",
    "/business/applications", "/business/new", "/onboarding", "/onboarding/account-type", "/onboarding/profile", "/settings/profile", `/p/${profile}`, "/b2b", "/admin",
  ], true);
});

test("sweep admin", async ({ page, request }) => {
  test.setTimeout(900_000);
  await prefs(page, { locale: "en", theme: "light" });
  await signIn(page, request, IDENTITIES.admin, /\/(home|b2b|admin|onboarding)(\/|$)/);
  const org = q(`select id from public.organizations limit 1`);
  const usr = q(`select id from public.users limit 1`);
  await sweep(page, "admin", ["/admin", "/admin/audit", "/admin/organizations", `/admin/organizations/${org}`, "/admin/users", `/admin/users/${usr}`, "/admin/verifications"], true);
});
