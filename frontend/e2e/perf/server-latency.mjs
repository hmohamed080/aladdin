// Server latency (TTFB + full response) for pages and API routes of a PRODUCTION
// server. Signs in each seeded identity once through the real sign-in page (Turnstile
// script stubbed), then issues N sequential requests per target with Node fetch and
// that identity's cookies. No browser rendering is involved: this isolates server time.
//
//   PW_CHROMIUM=/path/to/chrome node e2e/perf/server-latency.mjs --base http://127.0.0.1:3306 --label after --n 25 --out /tmp/lat.json
//
// Optional:
//   --cpu-pids 123,456    sample utime+stime (/proc/<pid>/stat) and RSS of the serving process(es)
//                         around each target's N timed requests -> CPU ms/request and peak RSS
//   --catalog-action <id> Server Action id of loadCatalogBatchAction (from the build's
//                         server-reference-manifest.json) -> the "action" target
// The "auth" targets replay the captured Sign In Server Action POST, and a session refresh
// (cookie whose expires_at is in the past + a live refresh token, through the middleware).
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
  // Read-only, idempotent Server Action behind "Show more" on /showroom/catalog.
  ...(args["catalog-action"] ? [{ id: "POST action loadCatalogBatch", path: "/showroom/catalog", who: "hana@example.test", method: "POST",
    headers: { "next-action": args["catalog-action"], accept: "text/x-component", "content-type": "text/plain;charset=UTF-8" }, body: "[{},12]" }] : []),
  // The real Sign In Server Action POST, captured once in the browser and replayed (each one creates a session).
  { id: "POST sign-in (Server Action)", path: "/auth/sign-in", who: null, replay: "consumer@example.test" },
  // Session refresh: the cookie's session has expires_at in the past, so the middleware's getClaims()
  // refreshes it (one GoTrue token call) and the new cookies come back on the response; each request
  // sends the newest refresh token. /onboarding (a page that redirects an active user to /home) is used
  // because the middleware's own signed-in redirect on /auth/sign-in does not forward refreshed cookies.
  // The baseline is the same request with a valid session, so the difference is the refresh.
  { id: "GET /onboarding (valid session)", path: "/onboarding", who: "consumer@example.test" },
  { id: "GET /onboarding (expired session -> refresh)", path: "/onboarding", who: "consumer@example.test", refresh: true },
];
// --only "page /,page /home" limits the run (used by the per-page DB-load measurement).
const ONLY = args.only ? new Set(args.only.split(",")) : null;
const TARGETS = ALL_TARGETS.filter((t) => !ONLY || ONLY.has(t.id));

const TURNSTILE_STUB =
  'window.turnstile={render:function(el,o){setTimeout(function(){o.callback("XXXX.DUMMY.TOKEN.XXXX")},0);return "local-test"},remove:function(){},reset:function(){}};';

const signInReplay = {};

async function cookieHeader(browser, email) {
  const context = await browser.newContext({ baseURL: BASE, locale: "en-US" });
  await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: BASE }]);
  await context.route("https://challenges.cloudflare.com/**", (r) => r.fulfill({ contentType: "application/javascript", body: TURNSTILE_STUB }));
  const page = await context.newPage();
  page.on("request", (r) => {
    if (r.method() === "POST" && r.headers()["next-action"] && new URL(r.url()).pathname === "/auth/sign-in" && !signInReplay[email]) {
      const headers = Object.fromEntries(Object.entries(r.headers()).filter(([k]) => k !== "cookie"));
      signInReplay[email] = { headers, body: r.postDataBuffer() };
    }
  });
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

// --- session refresh helpers (@supabase/ssr cookie: "base64-" + base64url(JSON), maybe chunked .0/.1) ---
const parseCookies = (header) => Object.fromEntries(header.split("; ").map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]));
const AUTH = /^(sb-[^=]+-auth-token)(?:\.(\d+))?$/;
function readSession(jar) {
  const parts = Object.entries(jar).filter(([k]) => AUTH.test(k)).sort(([a], [b]) => Number(AUTH.exec(a)[2] ?? 0) - Number(AUTH.exec(b)[2] ?? 0));
  const name = AUTH.exec(parts[0][0])[1];
  const raw = parts.map(([, v]) => v).join("");
  return { name, session: JSON.parse(Buffer.from(raw.replace(/^base64-/, ""), "base64url").toString("utf8")) };
}
function expiredJar(jar) {
  const { name, session } = readSession(jar);
  const rest = Object.fromEntries(Object.entries(jar).filter(([k]) => !AUTH.test(k)));
  const value = "base64-" + Buffer.from(JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) - 60 })).toString("base64url");
  return { ...rest, [name]: value };
}
function applySetCookies(jar, res) {
  const next = { ...jar };
  for (const line of res.headers.getSetCookie()) {
    const [kv] = line.split(";");
    const k = kv.slice(0, kv.indexOf("=")), v = kv.slice(kv.indexOf("=") + 1);
    if (/max-age=0|expires=thu, 01 jan 1970/i.test(line) || v === "") delete next[k];
    else next[k] = v;
  }
  // A refreshed session arrives either whole or chunked; drop the other form.
  if (Object.keys(next).some((k) => /-auth-token\.\d+$/.test(k)) && res.headers.getSetCookie().some((l) => /-auth-token\.\d+=/.test(l)))
    for (const k of Object.keys(next)) if (/-auth-token$/.test(k)) delete next[k];
  return next;
}
const jarHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");

// --- per-process CPU (utime+stime, clock ticks) and RSS from /proc ---
const CPU_PIDS = args["cpu-pids"] ? args["cpu-pids"].split(",").map(Number) : [];
const CLK_TCK = Number(args["clk-tck"] ?? execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim());
const procCpu = (pid) => {
  const rest = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ").pop().split(" ");
  return Number(rest[11]) + Number(rest[12]); // fields 14 (utime) + 15 (stime)
};
const procMem = (pid) => {
  const st = readFileSync(`/proc/${pid}/status`, "utf8");
  const kb = (k) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(st)?.[1] ?? 0);
  return { rss: kb("VmRSS"), hwm: kb("VmHWM") };
};

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
  const replay = t.replay ? signInReplay[t.replay] : null;
  if (t.replay && !replay) { console.log(`${LABEL} ${t.id}: no Sign In POST captured, skipped`); continue; }
  const headers = { ...(t.headers ?? {}), ...(replay?.headers ?? {}), cookie: t.who ? cookies[t.who] : "NEXT_LOCALE=en" };
  let jar = t.refresh ? parseCookies(cookies[t.who]) : null;
  let refreshed = 0;
  let cpu0 = null;
  const rssPeak = Object.fromEntries(CPU_PIDS.map((p) => [p, 0]));
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
    if (i === 2) cpu0 = Object.fromEntries(CPU_PIDS.map((p) => [p, procCpu(p)]));
    if (jar) headers.cookie = jarHeader(expiredJar(jar));
    const start = performance.now();
    const res = await fetch(BASE + t.path, { method: t.method ?? (replay ? "POST" : "GET"), headers, body: replay?.body ?? t.body, redirect: "manual" });
    const head = performance.now();
    const body = await res.arrayBuffer();
    const end = performance.now();
    if (jar) {
      const before = readSession(jar).session.refresh_token;
      jar = applySetCookies(jar, res);
      if (readSession(jar).session.refresh_token !== before && i >= 2) refreshed++;
    }
    for (const p of CPU_PIDS) rssPeak[p] = Math.max(rssPeak[p], procMem(p).rss);
    if (i < 2) continue; // two warm-up requests
    ttfb.push(head - start);
    total.push(end - start);
    statuses[res.status] = (statuses[res.status] ?? 0) + 1;
    bytes = body.byteLength;
    load.push(loadavg());
  }
  snap("b");
  const cpu = CPU_PIDS.length
    ? Object.fromEntries(CPU_PIDS.map((p) => [p, Math.round(((procCpu(p) - cpu0[p]) * 1000) / CLK_TCK / N * 100) / 100]))
    : undefined;
  const mem = CPU_PIDS.length ? Object.fromEntries(CPU_PIDS.map((p) => [p, { rssPeakMb: Math.round(rssPeak[p] / 1024), hwmMb: Math.round(procMem(p).hwm / 1024) }])) : undefined;
  const row = {
    label: LABEL, target: t.id, n: N, statuses, kb: Math.round(bytes / 1024),
    ttfb: { p50: pct(ttfb, 0.5), p95: pct(ttfb, 0.95) },
    total: { p50: pct(total, 0.5), p95: pct(total, 0.95) },
    load1: pct(load, 0.5),
    ...(cpu ? { cpuMsPerReq: cpu, mem } : {}),
    ...(jar ? { refreshed } : {}),
  };
  results.push(row);
  console.log(`${LABEL} ${t.id}: ttfb p50 ${row.ttfb.p50} p95 ${row.ttfb.p95} | total p50 ${row.total.p50} p95 ${row.total.p95} | ${JSON.stringify(statuses)} ${row.kb}KB load ${row.load1}${cpu ? ` cpu ms/req ${JSON.stringify(cpu)} mem ${JSON.stringify(mem)}` : ""}${jar ? ` refreshed ${refreshed}/${N}` : ""}`);
}
writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(`wrote ${OUT}`);
