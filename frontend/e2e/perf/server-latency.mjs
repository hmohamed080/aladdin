// Server latency (TTFB + full response) for pages and API routes of a PRODUCTION
// server. Signs in each seeded identity once through the real sign-in page (Turnstile
// script stubbed), then issues N sequential requests per target with Node fetch and
// that identity's cookies. No browser rendering is involved: this isolates server time.
//
//   PW_CHROMIUM=/path/to/chrome node e2e/perf/server-latency.mjs --base http://127.0.0.1:3306 --label after --n 25 --out /tmp/lat.json
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const BASE = args.base ?? "http://127.0.0.1:3306";
const LABEL = args.label ?? "run";
const N = Number(args.n ?? 25);
const OUT = args.out ?? `/tmp/server-latency-${LABEL}.json`;
const PASSWORD = "Zq9$Kx4#WmT7!Pn2Rb"; // e2e/helpers/auth.ts E2E_PASSWORD (local test DB only)
const PRODUCT = "d7000002-0000-4000-8000-000000000002";
const PUBLIC_PROFILE = "c90bd439-5ecb-4834-972a-5e04551a45e5";
const VIDEO = "0e7fa000-0000-4000-8000-000000000002"; // scripts/perf/segment-auth-fixture.sql (consumer-owned)

const ALL_TARGETS = [
  { id: "page /", path: "/", who: null },
  { id: "page /auth/sign-in", path: "/auth/sign-in", who: null },
  { id: "page /home", path: "/home", who: "consumer@example.test" },
  { id: "page /showroom/home", path: "/showroom/home", who: "hana@example.test" },
  { id: "page /showroom/catalog", path: "/showroom/catalog", who: "hana@example.test" },
  { id: "page /showroom/catalog/[id]", path: `/showroom/catalog/${PRODUCT}`, who: "hana@example.test" },
  { id: "page /p/[id]", path: `/p/${PUBLIC_PROFILE}`, who: null },
  { id: "page /admin", path: "/admin", who: "admin@example.test" },
  { id: "page /b2b", path: "/b2b", who: "a-owner@example.test" },
  { id: "RSC /b2b (soft nav)", path: "/b2b", who: "a-owner@example.test", headers: { RSC: "1" } },
  { id: "GET /api/health", path: "/api/health", who: null },
  { id: "GET /api/media/avatar (auth check, miss)", path: "/api/media/avatar?key=perf-missing", who: "consumer@example.test" },
  { id: "GET /api/video/[id]/playback", path: `/api/video/${VIDEO}/playback`, who: "consumer@example.test", headers: { "sec-fetch-site": "same-origin" } },
];
// --only "page /,page /home" limits the run (used by the per-page DB-load measurement).
const ONLY = args.only ? new Set(args.only.split(",")) : null;
const TARGETS = ALL_TARGETS.filter((t) => !ONLY || ONLY.has(t.id));

const TURNSTILE_STUB =
  'window.turnstile={render:function(el,o){setTimeout(function(){o.callback("XXXX.DUMMY.TOKEN.XXXX")},0);return "local-test"},remove:function(){},reset:function(){}};';

async function cookieHeader(browser, email) {
  const context = await browser.newContext({ baseURL: BASE, locale: "en-US" });
  await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: BASE }]);
  await context.route("https://challenges.cloudflare.com/**", (r) => r.fulfill({ contentType: "application/javascript", body: TURNSTILE_STUB }));
  const page = await context.newPage();
  await page.goto("/auth/sign-in");
  await page.getByLabel(/^email address$/i).fill(email);
  await page.getByLabel(/^password$/i).fill(PASSWORD);
  if (await page.locator('input[name="captchaToken"]').count())
    await page.waitForFunction(() => document.querySelector('input[name="captchaToken"]')?.value, null, { timeout: 30_000 });
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/sign-in"), { timeout: 60_000 });
  const cookies = await context.cookies();
  await context.close();
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10 : null;
};
const loadavg = () => Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]);

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const cookies = {};
for (const who of new Set(TARGETS.map((t) => t.who).filter(Boolean))) cookies[who] = await cookieHeader(browser, who);
await browser.close();

const results = [];
for (const t of TARGETS) {
  const headers = { ...(t.headers ?? {}), cookie: t.who ? cookies[t.who] : "NEXT_LOCALE=en" };
  const ttfb = [];
  const total = [];
  const statuses = {};
  const load = [];
  let bytes = 0;
  // --pgss <dir>: snapshot pg_stat_statements around each target (all N+2 requests) for the DB-load diff.
  const snap = (tag) => args.pgss && execFileSync(new URL("../../../scripts/perf/pgss-snapshot.sh", import.meta.url).pathname,
    [`${args.pgss}/${TARGETS.indexOf(t)}-${tag}.tsv`]);
  snap("a");
  for (let i = 0; i < N + 2; i++) {
    const start = performance.now();
    const res = await fetch(BASE + t.path, { headers, redirect: "manual" });
    const head = performance.now();
    const body = await res.arrayBuffer();
    const end = performance.now();
    if (i < 2) continue; // two warm-up requests
    ttfb.push(head - start);
    total.push(end - start);
    statuses[res.status] = (statuses[res.status] ?? 0) + 1;
    bytes = body.byteLength;
    load.push(loadavg());
  }
  snap("b");
  const row = {
    label: LABEL, target: t.id, n: N, statuses, kb: Math.round(bytes / 1024),
    ttfb: { p50: pct(ttfb, 0.5), p95: pct(ttfb, 0.95) },
    total: { p50: pct(total, 0.5), p95: pct(total, 0.95) },
    load1: pct(load, 0.5),
  };
  results.push(row);
  console.log(`${LABEL} ${t.id}: ttfb p50 ${row.ttfb.p50} p95 ${row.ttfb.p95} | total p50 ${row.total.p50} p95 ${row.total.p95} | ${JSON.stringify(statuses)} ${row.kb}KB load ${row.load1}`);
}
writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(`wrote ${OUT}`);
