// Lab Core Web Vitals for the key Aladdin surfaces against a PRODUCTION server
// (`next build && next start`). Not a Playwright test: a plain Node script that drives
// the local Chromium so every run gets a fresh browser context (cold HTTP cache) on a
// warm server, with optional mobile throttling through CDP.
//
//   E2E_STUB_TURNSTILE=1 PW_CHROMIUM=/path/to/chrome \
//     node e2e/perf/web-vitals.mjs --base http://127.0.0.1:3306 --label after --runs 3 --out /tmp/after.json
//
// Per run it records: TTFB, FCP, LCP (+ the LCP element), CLS (+ the biggest shift
// source), INP from the Event Timing API after one scripted real interaction, total
// blocking time from long tasks, request count, transferred KB by resource type, and
// the 1-minute load average (the CPU is shared, so noisy runs must be visible).
// Mobile = Pixel 5 viewport/touch, 1.6 Mbps down / 750 kbps up / 150 ms RTT, CPU x4.
// Desktop = 1440x900, no throttling. Sign-in uses the real Email + Password flow;
// only the third-party Turnstile script is stubbed (local GoTrue has CAPTCHA off).
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, devices } from "@playwright/test";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const BASE = args.base ?? "http://127.0.0.1:3306";
const LABEL = args.label ?? "run";
const RUNS = Number(args.runs ?? 3);
const OUT = args.out ?? `/tmp/web-vitals-${LABEL}.json`;
const ONLY = args.pages ? new Set(args.pages.split(",")) : null;
const PROFILES = (args.profiles ?? "mobile,desktop").split(",");
const PASSWORD = "Zq9$Kx4#WmT7!Pn2Rb"; // e2e/helpers/auth.ts E2E_PASSWORD (local test DB only)

const PRODUCT = "d7000002-0000-4000-8000-000000000002"; // seeded public product
const PUBLIC_PROFILE = "c90bd439-5ecb-4834-972a-5e04551a45e5"; // seeded profile in profile_public_directory

/** who = seeded identity (null = signed out); act = the scripted interaction. */
const PAGES = [
  { id: "landing", path: "/", who: null, act: "menu" },
  { id: "auth", path: "/auth/sign-in", who: null, act: "type-email" },
  { id: "home", path: "/home", who: "consumer@example.test", act: "menu" },
  { id: "showroom", path: "/showroom/home", who: "hana@example.test", act: "menu" },
  { id: "showroom-product", path: `/showroom/catalog/${PRODUCT}`, who: "hana@example.test", act: "menu" },
  { id: "public-profile", path: `/p/${PUBLIC_PROFILE}`, who: null, act: "menu" },
  { id: "admin", path: "/admin", who: "admin@example.test", act: "menu" },
  { id: "b2b", path: "/b2b", who: "a-owner@example.test", act: "menu" },
  { id: "marketplace", path: "/showroom/catalog", who: "hana@example.test", act: "search" },
].filter((p) => !ONLY || ONLY.has(p.id));

const MOBILE_NET = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };

const OBSERVERS = `
  window.__v = { lcp: 0, lcpEl: '', cls: 0, shifts: [], events: [], longTasks: [] };
  const describe = (n) => {
    if (!n || !n.tagName) return '';
    const id = n.id ? '#' + n.id : '';
    const cls = typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    const src = n.currentSrc || n.src || '';
    const txt = (n.textContent || '').trim().slice(0, 40);
    return n.tagName.toLowerCase() + id + cls + (src ? ' src=' + src.slice(-60) : txt ? ' "' + txt + '"' : '');
  };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__v.lcp = e.startTime; window.__v.lcpEl = describe(e.element) + ' area=' + e.size; } })
      .observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (e.hadRecentInput) continue; window.__v.cls += e.value;
        window.__v.shifts.push({ value: e.value, t: Math.round(e.startTime), src: (e.sources || []).map((s) => describe(s.node)).join(' | ') }); } })
      .observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__v.events.push({ name: e.name, d: e.duration, id: e.interactionId || 0, t: e.startTime }); })
      .observe({ type: 'event', buffered: true, durationThreshold: 16 });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__v.events.push({ name: e.name, d: e.duration, id: e.interactionId || 0, t: e.startTime }); })
      .observe({ type: 'first-input', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__v.longTasks.push({ t: e.startTime, d: e.duration }); })
      .observe({ type: 'longtask', buffered: true });
  } catch {}
`;

const TURNSTILE_STUB =
  'window.turnstile={render:function(el,o){setTimeout(function(){o.callback("XXXX.DUMMY.TOKEN.XXXX")},0);return "local-test"},remove:function(){},reset:function(){}};';

const loadavg = () => Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
const median = (xs) => {
  const s = xs.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

async function newContext(browser, profile, storageState) {
  const base = profile === "mobile" ? { ...devices["Pixel 5"] } : { viewport: { width: 1440, height: 900 } };
  const context = await browser.newContext({ ...base, baseURL: BASE, storageState, locale: "en-US" });
  // English UI (the app defaults to Arabic): the app's own locale cookie.
  await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: BASE }]);
  await context.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({ contentType: "application/javascript", body: TURNSTILE_STUB }),
  );
  return context;
}

async function signIn(browser, email) {
  const context = await newContext(browser, "desktop");
  const page = await context.newPage();
  await page.goto("/auth/sign-in");
  await page.getByLabel(/^email address$/i).fill(email);
  await page.getByLabel(/^password$/i).fill(PASSWORD);
  const captcha = page.locator('input[name="captchaToken"]');
  if (await captcha.count()) await page.waitForFunction(() => document.querySelector('input[name="captchaToken"]')?.value, null, { timeout: 30_000 });
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/sign-in"), { timeout: 60_000 });
  const state = await context.storageState();
  await context.close();
  return state;
}

/** One real user interaction; returns a short description of what was done. */
async function interact(page, act, mobile) {
  const press = (loc) => (mobile ? loc.tap() : loc.click());
  if (act === "type-email") {
    const input = page.getByLabel(/^email address$/i);
    await press(input);
    await input.pressSequentially("perf@example.test", { delay: 60 });
    return "type email";
  }
  if (act === "search") {
    const search = page.locator('[role="search"] input, input[type="search"], input[name="q"]').filter({ visible: true }).first();
    if (await search.isVisible().catch(() => false)) {
      await press(search);
      await search.pressSequentially("ceramic", { delay: 60 });
      return "type search";
    }
  }
  // Menus first (hamburger, account, notifications), then any visible button.
  for (const sel of ["button[aria-haspopup]", "button[aria-expanded]", "header button", "main button", "button"]) {
    const loc = page.locator(sel);
    const n = await loc.count();
    for (let i = 0; i < Math.min(n, 8); i++) {
      const el = loc.nth(i);
      if (!(await el.isVisible().catch(() => false)) || !(await el.isEnabled().catch(() => false))) continue;
      const label = ((await el.getAttribute("aria-label")) ?? (await el.innerText().catch(() => "")) ?? "").trim().slice(0, 30);
      // Skip actions that leave or reload the page (locale/theme switches reload; sign-out navigates).
      if (/sign ?out|log ?out|delete|remove|language|العربية|english|theme|dark|light/i.test(label)) continue;
      await press(el);
      await page.waitForTimeout(400);
      await page.keyboard.press("Escape").catch(() => {});
      return `tap ${sel} "${label}"`;
    }
  }
  // No control on the page: a tap on the heading is still a real pointer interaction.
  const heading = page.locator("h1").filter({ visible: true }).first();
  if (await heading.count()) {
    await press(heading);
    return "tap h1";
  }
  return "none";
}

async function measure(browser, entry, profile, storageState) {
  const mobile = profile === "mobile";
  const context = await newContext(browser, profile, storageState);
  const page = await context.newPage();
  await page.addInitScript(OBSERVERS);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  if (mobile) {
    await cdp.send("Network.emulateNetworkConditions", MOBILE_NET);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  const load1 = loadavg();
  const response = await page.goto(entry.path, { waitUntil: "load", timeout: 120_000 });
  const finalPath = new URL(page.url()).pathname;
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const action = await interact(page, entry.act, mobile).catch((e) => `failed: ${e.message.split("\n")[0]}`);
  await page.waitForTimeout(1000);
  const data = await page.evaluate(() => {
    const v = window.__v;
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    const res = performance.getEntriesByType("resource");
    const kb = { total: nav.transferSize || 0, script: 0, img: 0, css: 0, font: 0, fetch: 0, other: 0 };
    for (const r of res) {
      kb.total += r.transferSize || 0;
      const t = r.initiatorType === "link" && /\.css/.test(r.name) ? "css" : /\.(woff2?|ttf)/.test(r.name) ? "font" : r.initiatorType;
      const key = t === "script" ? "script" : t === "img" || t === "image" ? "img" : t === "css" ? "css" : t === "font" ? "font" : t === "fetch" ? "fetch" : "other";
      kb[key] += r.transferSize || 0;
    }
    for (const k of Object.keys(kb)) kb[k] = Math.round(kb[k] / 1024);
    // INP = the slowest interaction (fewer than 50 interactions, so no percentile trimming).
    const byInteraction = new Map();
    for (const e of v.events) if (e.id) byInteraction.set(e.id, Math.max(byInteraction.get(e.id) ?? 0, e.d));
    const inp = byInteraction.size ? Math.max(...byInteraction.values()) : null;
    const fcpT = fcp ? fcp.startTime : 0;
    const tbt = v.longTasks.filter((t) => t.t >= fcpT).reduce((s, t) => s + Math.max(0, t.d - 50), 0);
    const worstShift = v.shifts.sort((a, b) => b.value - a.value)[0];
    return {
      ttfb: Math.round(nav.responseStart),
      fcp: fcp ? Math.round(fcp.startTime) : null,
      lcp: Math.round(v.lcp),
      lcpEl: v.lcpEl,
      cls: Number(v.cls.toFixed(3)),
      clsSrc: worstShift ? `${worstShift.value.toFixed(3)}@${worstShift.t}ms ${worstShift.src}` : "",
      inp: inp === null ? null : Math.round(inp),
      interactions: byInteraction.size,
      tbt: Math.round(tbt),
      longTasks: v.longTasks.length,
      reqs: res.length + 1,
      kb,
    };
  });
  await context.close();
  return { ...data, status: response?.status() ?? 0, finalPath, action, load1 };
}

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const states = {};
for (const who of new Set(PAGES.map((p) => p.who).filter(Boolean))) states[who] = await signIn(browser, who);

const results = [];
for (const entry of PAGES) {
  // Warm the server route once (untimed) so the numbers are not a first-request compile/cache miss.
  const warm = await newContext(browser, "desktop", entry.who ? states[entry.who] : undefined);
  await (await warm.newPage()).goto(entry.path, { waitUntil: "load" }).catch(() => {});
  await warm.close();
  for (const profile of PROFILES) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const r = await measure(browser, entry, profile, entry.who ? states[entry.who] : undefined);
      runs.push(r);
      console.log(`${LABEL} ${entry.id} ${profile} #${i + 1}: LCP ${r.lcp} CLS ${r.cls} INP ${r.inp} TTFB ${r.ttfb} TBT ${r.tbt} ${r.kb.total}KB load ${r.load1} [${r.finalPath}] ${r.action}`);
    }
    const pick = (k) => median(runs.map((r) => r[k]));
    results.push({
      label: LABEL, page: entry.id, path: entry.path, profile, runs,
      median: { lcp: pick("lcp"), cls: pick("cls"), inp: pick("inp"), ttfb: pick("ttfb"), fcp: pick("fcp"), tbt: pick("tbt"),
        kb: median(runs.map((r) => r.kb.total)), jsKb: median(runs.map((r) => r.kb.script)), load1: pick("load1") },
    });
  }
}
await browser.close();
writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(`wrote ${OUT}`);
