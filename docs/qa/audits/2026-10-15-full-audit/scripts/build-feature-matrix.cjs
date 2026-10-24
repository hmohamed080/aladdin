// Builds FEATURE_MATRIX.csv: executed E2E scenarios come from traces/e2e-results.jsonl (last record per id);
// non-executed / non-implemented / cross-cutting rows are listed explicitly below with their evidence.
const fs = require("fs");
const path = require("path");
const dir = path.resolve(__dirname, "..");
const q = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""').replace(/\n/g, " ")}"` : String(v));
const cut = (s, n = 320) => (String(s ?? "").length > n ? String(s).slice(0, n - 1) + "…" : String(s ?? ""));
const head = ["Module", "Feature", "Route", "Expected behavior", "Actual behavior", "Status", "Evidence", "Related test", "Priority", "Blocking catalog launch?", "Blocking full-commerce launch?"];
const rows = [head];

const spec = { A: "a-showroom-auth.spec.ts", B: "b-access.spec.ts", C: "c-seller-products.spec.ts", D: "d-import.spec.ts", E: "e-admin-sellers.spec.ts", F: "f-media.spec.ts", G: "g-public.spec.ts", H: "g-public.spec.ts" };
const route = { A: "/showroom/sign-up, /showroom/sign-in, /onboarding/business", B: "/b2c/seller/*, /admin/marketplace*, /b2b/*", C: "/b2c/seller/products[/new|/:id/edit]", D: "/b2c/seller/imports", E: "/admin/marketplace", F: "/admin/marketplace/media, /marketplace/media/:id", G: "/marketplace, /marketplace/products/:slug", H: "/" };
const moduleName = { A: "Showroom auth & onboarding", B: "Access control / tenancy", C: "Seller products", D: "Bulk import", E: "Admin seller management", F: "Media moderation", G: "Public Marketplace", H: "Homepage" };
// id -> [priority, blocks catalog, blocks full commerce]
const over = {
  D11z: ["P1", "YES (ZIP image import unusable; per-file upload works)", "YES"],
  D14: ["P1", "YES (wrong products created by import grouping)", "YES"],
  A15: ["P2", "NO", "NO (business decision)"],
  G8: ["P2", "NO (needs >24 published products to verify)", "NO"],
};
const lines = fs.readFileSync(path.join(dir, "traces/e2e-results.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const byId = new Map();
for (const r of lines) byId.set(r.id, r);
for (const r of byId.values()) {
  const j = r.journey[0];
  const o = over[r.id] ?? (r.status === "PASS" ? ["—", "NO", "NO"] : ["P2", "NO", "NO"]);
  rows.push([moduleName[j], `${r.id} ${r.scenario}`, route[j], cut(r.expected), cut(r.actual), r.status, cut(r.evidence ?? "traces/e2e-results.jsonl", 160), `frontend/e2e-audit/${spec[j]}`, o[0], o[1], o[2]]);
}

const X = (...r) => rows.push(r);
// --- Not executed in this audit
X("Access control / tenancy", "B7 Organization switching keeps permissions scoped", "/b2b (work-context switch)", "Switching active organization re-scopes seller/admin capabilities", "No fixture user with >1 organization; scenario not executed", "NOT_TESTED", "SECURITY_AND_LOGIC.md §4", "—", "P2", "NO", "NO");
X("Routes", "Dynamic routes without ids (58 routes)", "dynamic segments", "Every route renders without 5xx", "58 dynamic routes skipped (no id supplied)", "NOT_TESTED", "traces/route-crawl.csv", "frontend/e2e-audit/r-routes.spec.ts", "P3", "NO", "NO");
X("Quality gates", "Existing Playwright E2E suite (45 specs)", "frontend/e2e", "Suite runs green", "Not executed: its globalSetup truncates customers/leads and stamps passwords (destructive to the QA DB, forbidden by audit rules)", "BLOCKED", "frontend/e2e global setup", "frontend/e2e/*", "P2", "NO", "NO");
X("Showroom auth & onboarding", "Showroom requests organization verification", "/b2b (expected)", "New showroom can submit verification so admin can activate it", "No product path exists; fixture verification row had to be inserted with psql (BL-2)", "NOT_IMPLEMENTED", "SECURITY_AND_LOGIC.md BL-2", "frontend/e2e-audit/e-admin-sellers.spec.ts (E0)", "P1", "YES (new showrooms cannot become sellers)", "YES");
X("Showroom auth & onboarding", "Showroom phone ownership verification", "/showroom/sign-up", "Phone owned by registrant", "No ownership check; landline accepted (SEC-5)", "NOT_IMPLEMENTED", "SECURITY_AND_LOGIC.md SEC-5", "frontend/e2e-audit/a-showroom-auth.spec.ts (A15)", "P2", "NO", "NO");
X("Notifications", "Seller notified of moderation / status changes", "—", "Seller sees approval/rejection/suspension notices", "Generic notifications table exists; no marketplace notification is emitted", "NOT_IMPLEMENTED", "DB + code inspection", "—", "P2", "NO", "YES");
for (const [f, a] of [
  ["Cart", "/marketplace/cart returns notFound(); no cart model"],
  ["Checkout", "No checkout route or RPC"],
  ["Cash on delivery (COD)", "No payment method model in the marketplace"],
  ["Delivery fees / zones", "No delivery fee model"],
  ["Online payment (Kashier)", "Kashier not present on this branch (legacy B2B only, out of scope)"],
  ["Stock reservation at order time", "No reservation RPC; inventory ledger has adjustments only"],
  ["Marketplace orders", "No marketplace order tables"],
  ["Seller fulfillment", "No fulfillment workflow"],
  ["Order tracking (customer)", "No tracking pages"],
  ["Refunds / returns", "No refund model"],
]) X("Commerce (journey J)", f, "—", `${f} available to customers/sellers`, a, "NOT_IMPLEMENTED", "Code + schema inspection", "—", "P1 (for commerce)", "NO (catalog-only launch shows an honest no-purchase state)", "YES");
// --- Cross-cutting
X("Security", "SEC-1 Login rate limit cannot be bypassed", "GoTrue /auth/v1/token", "Repeated bad passwords throttled on every path", "Direct GoTrue calls: 6x 400 invalid_credentials, never 429, after the app bucket hit its limit", "FAIL", "SECURITY_AND_LOGIC.md SEC-1", "frontend/e2e-audit/gotrue-probe.mjs", "P0", "YES", "YES");
X("Security", "SEC-2 anon EXECUTE grants minimal on every Postgres image", "supabase/migrations", "Same function grants on any supported image", "postgres 17.11.0.004: anon can EXECUTE 106 public functions (17.6: 7); pgTAP 10 failures on 17.11 vs 102 files PASS on 17.6", "FAIL", "traces/pgtap-clean-stack.log; traces/pgtap-clean-stack-17.6.log", "supabase/tests (14,19,39,52,55)", "P1 (P0 if hosted image >= 17.11)", "YES until hosted version verified", "YES");
X("Security", "SEC-3 Marketplace eligibility honours showroom readiness (PR #84)", "/admin/marketplace", "Only showroom_seller_ready orgs eligible", "marketplace_seller_is_eligible ignores showroom_seller_ready; Decore and Zayed eligible while not ready", "FAIL", "SECURITY_AND_LOGIC.md SEC-3", "—", "P1", "YES", "YES");
X("Security", "SEC-4 Raw RPC image confirm validates magic bytes", "image confirm RPC", "Non-image bytes refused at confirm", "Confirm accepts spoof; admin byte validation blocks approval", "PARTIAL", "SECURITY_AND_LOGIC.md SEC-4; F3", "frontend/e2e-audit/f-media.spec.ts", "P2", "NO", "NO");
X("Security", "DOC-1 Sign-in CAPTCHA matches documented policy", "/auth/sign-in", "Guide: no CAPTCHA on Sign In", "Turnstile present on email Sign In; once not ready in a mobile/dark context and blocked an audit sign-in", "PARTIAL", "SECURITY_AND_LOGIC.md DOC-1; traces/playwright/u-ui-a11y (first run)", "frontend/e2e-audit/u-ui-a11y.spec.ts", "P2", "NO", "NO");
X("Performance", "Public catalog at scale", "/marketplace", "p95 < 1 s at expected catalog size", "5k published: p50 1.95 s; 15k published: statement timeout (3 s) on 4 of 5 query shapes", "FAIL", "PERFORMANCE_REPORT.md §4; traces/scale-bench.jsonl", "frontend/e2e-audit/scale-bench.mjs", "P1", "YES (beyond ~5k published products)", "YES");
X("Performance", "Product images sized for display", "/marketplace/products/:slug", "Thumbnails / responsive images", "Originals served (cover 956 KB, 1890x1890 shown ~270x200); product page 4.2 MB images; mobile LCP ~14.3 s", "FAIL", "PERFORMANCE_REPORT.md §2, §5", "frontend/e2e-audit/p-perf.spec.ts", "P1", "YES (mobile)", "YES");
X("Performance", "Seller edit page on mobile", "/b2c/seller/products/:id/edit", "Loads on 4G mobile", "6/6 loads timed out at 60 s (desktop 0.5-0.8 s); likely the 19.2 MB original images", "FAIL", "traces/page-perf-raw.json", "frontend/e2e-audit/p-perf.spec.ts", "P2", "NO", "NO");
X("Performance", "Static imagery optimised", "/, /marketplace", "Static images through next/image or resized", "Type-strip PNGs 755-861 KB (1200x900 shown 128x244), role-atlas 1.3 MB; listing mobile load 29 s", "PARTIAL", "traces/request-classification.json", "frontend/e2e-audit/v-requests.spec.ts", "P2", "NO", "NO");
X("Performance", "Desktop page LCP (13 pages)", "see PERFORMANCE_RESULTS.csv", "LCP <= 2.5 s", "Desktop warm LCP p50 52-516 ms; CLS <= 0.04", "PASS", "PERFORMANCE_RESULTS.csv", "frontend/e2e-audit/p-perf.spec.ts", "—", "NO", "NO");
X("Performance", "Public filter / sort / variant actions", "/marketplace", "<= 1 s perceived", "p50 55-252 ms (only 1 published product: not representative of scale)", "PASS", "traces/actions-public.json", "frontend/e2e-audit/x-actions.spec.ts", "—", "NO", "NO");
X("Performance", "Bulk import 50 rows", "/b2c/seller/imports", "Dry run + apply complete quickly", "Dry run 477 ms; apply 1,134 ms; 25 products x 2 variants created as drafts", "PASS", "traces/actions-import50.json", "frontend/e2e-audit/x-actions.spec.ts", "—", "NO", "NO");
X("UI / a11y", "Responsive layout 390/768/1440, light + dark (12 pages)", "12 key pages", "No horizontal overflow, RTL, no hydration warnings, img alt present", "72 combinations: overflowX 0, dir=rtl, 0 hydration warnings, 0 img without alt", "PASS", "traces/ui-a11y.json; screenshots/ui-*", "frontend/e2e-audit/u-ui-a11y.spec.ts", "—", "NO", "NO");
X("UI / a11y", "Image upload input has an accessible label", "/b2c/seller/products/new, /:id/edit", "axe 'label' passes", "Hidden (sr-only) file input without a label: axe critical on new + edit at every width", "FAIL", "traces/axe-detail.json", "frontend/e2e-audit/u-ui-a11y.spec.ts", "P2", "NO", "NO");
X("UI / a11y", "Colour contrast (WCAG AA)", "seller, public, admin pages", "Contrast >= 4.5:1", "text-accent #b96f52 on light surfaces 2.81-3.19:1 (links, danger buttons); up to 11 nodes on edit page", "FAIL", "traces/axe-detail.json", "frontend/e2e-audit/u-ui-a11y.spec.ts", "P2", "NO", "NO");
X("UI / a11y", "Touch target size (WCAG 2.2 AA)", "/, /marketplace, product page", ">= 24x24 px", "Header/footer text links 15 px high at 768/1440 (axe target-size, 4 nodes per page)", "PARTIAL", "traces/axe-detail.json", "frontend/e2e-audit/u-ui-a11y.spec.ts", "P3", "NO", "NO");
X("UI / a11y", "Measurement attributes shown with units", "/marketplace/products/:slug, seller forms", "mm values labelled with their unit", "roll_width input has no unit; product page shows raw 530", "PARTIAL", "screenshots/ui-product-*, ui-seller-edit-*", "—", "P3", "NO", "NO");
X("Data quality", "Decore catalogue publishable", "/b2c/seller/products", "Imported products can reach publication", "794/794 drafts blocked: 794 no verified primary image, 787 missing material_wallpaper, colour missing on 1,200 variant checks, roll size on 1,195", "FAIL", "EXECUTIVE_SUMMARY.md §D (read-only query)", "—", "P1", "YES (public catalogue would hold 1 product)", "YES");
X("Data quality", "Import grouping on Decore data", "Decore import", "No merged distinct products", "177 groups, 0 mixed album/price; Jaguar 160/161 sparse suffixes ambiguous", "PARTIAL", "traces/decore-grouping-analysis.json", "—", "P2", "NO", "NO");
X("Quality gates", "Unit / integration tests (vitest)", "frontend", "All pass", "231 files passed / 2 skipped; 2,969 tests passed / 13 skipped (80 s)", "PASS", "traces/vitest.log", "pnpm test", "—", "NO", "NO");
X("Quality gates", "TypeScript strict", "frontend", "0 errors", "tsc clean", "PASS", "traces/tsc.log", "pnpm typecheck", "—", "NO", "NO");
X("Quality gates", "Lint", "frontend", "0 errors", "0 errors, 1 pre-existing warning (sidebar-shell.tsx)", "PASS", "traces/lint.log", "pnpm lint", "—", "NO", "NO");
X("Quality gates", "pgTAP on clean stack (postgres 17.6)", "supabase/tests", "All pass", "102 files / 4,648 assertions PASS (25 s)", "PASS", "traces/pgtap-clean-stack-17.6.log", "supabase test db", "—", "NO", "NO");
X("Quality gates", "Production build", "frontend", "next build succeeds", "PASS in 86 s", "PASS", "traces/next-build.log", "pnpm build", "—", "NO", "NO");
X("Routes", "Route crawl (126 pages x 3 roles)", "all static routes", "No 5xx, no console errors", "378 visits, 0 5xx, 0 console errors; intended 404s only", "PASS", "traces/route-crawl.csv", "frontend/e2e-audit/r-routes.spec.ts", "—", "NO", "NO");
X("Routes", "/preview/installer-* exposure", "/preview/installer-* (11)", "Internal previews not public", "Public with sample data, noindex only", "PARTIAL", "SECURITY_AND_LOGIC.md R2", "frontend/e2e-audit/r-routes.spec.ts", "P3", "NO", "NO");

fs.writeFileSync(path.join(dir, "FEATURE_MATRIX.csv"), "﻿" + rows.map((r) => r.map(q).join(",")).join("\n") + "\n");
const c = {};
for (const r of rows.slice(1)) c[r[5]] = (c[r[5]] ?? 0) + 1;
console.log(rows.length - 1, JSON.stringify(c));
