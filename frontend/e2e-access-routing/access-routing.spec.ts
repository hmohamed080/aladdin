import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { installAccessRouting } from "../e2e-acceptance/access.mjs";

/**
 * Real-Chromium regression test for the Cloudflare Access credential scoping (no network, local servers only).
 *
 *   SCOPE  = http://127.0.0.1:<a>   stands in for the Acceptance preview origin (the exact origin that may get the token)
 *   OTHER  = http://127.0.0.1:<b>   another origin (different port) that must NEVER see the token
 *   ACCESS = http://team.cloudflareaccess.com:<b>  an Access login host (host-resolver-rules maps it to 127.0.0.1)
 *
 * Why it exists: Playwright's route.continue({headers}) forwards the overridden headers to a cross-origin redirect target in
 * real Chromium (reproduced before the fix). installAccessRouting must not.
 */
const CREDS = { id: "TEST-ID-0123456789", secret: "TEST-SECRET-9876543210" };
const HEADER = "cf-access-client-id";
const SECRET_HEADER = "cf-access-client-secret";

type Seen = { host: string; url: string; id: string | null; secret: string | null; cookie: string | null };
const scope: Seen[] = [];
const other: Seen[] = [];
let scopeServer: Server;
let otherServer: Server;
let scopeOrigin = "";
let otherOrigin = "";
let otherPort = 0;

const record = (list: Seen[], req: IncomingMessage) =>
  list.push({ host: String(req.headers.host), url: String(req.url), id: (req.headers[HEADER] as string) ?? null, secret: (req.headers[SECRET_HEADER] as string) ?? null, cookie: req.headers.cookie ?? null });
const listen = (s: Server) => new Promise<number>((res) => s.listen(0, "127.0.0.1", () => res((s.address() as AddressInfo).port)));

// Test browser only: map the fake Access host to loopback, and switch off Chromium's local-network-access check, which would
// otherwise block loopback subrequests from a document delivered via route.fulfill (an artifact of testing on 127.0.0.1).
test.use({
  launchOptions: {
    args: [
      "--host-resolver-rules=MAP team.cloudflareaccess.com 127.0.0.1",
      "--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,BlockInsecurePrivateNetworkRequests",
    ],
  },
});

test.beforeAll(async () => {
  otherServer = createServer((req, res) => {
    record(other, req);
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("content-type", "text/html");
    res.end("<h1>other</h1>");
  });
  otherPort = await listen(otherServer);
  otherOrigin = `http://127.0.0.1:${otherPort}`;
  scopeServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    record(scope, req);
    const path = String(req.url).split("?")[0];
    if (path === "/to-other") {
      res.writeHead(308, { location: `${otherOrigin}/landing` });
      return res.end();
    }
    if (path === "/to-access") {
      res.writeHead(302, { location: `http://team.cloudflareaccess.com:${otherPort}/cdn-cgi/access/login` });
      return res.end();
    }
    if (path === "/reset") {
      req.socket.destroy(); // the connection dies mid-request: route.fetch throws
      return;
    }
    if (path === "/to-access-path") {
      res.writeHead(302, { location: "/cdn-cgi/access/login/preview?kid=x" });
      return res.end();
    }
    if (path === "/same-1") {
      // like Access after a valid service token: issue the session cookie with the first answer
      res.writeHead(308, { location: "/same-2", "set-cookie": "CF_Authorization=issued-by-access; Path=/; HttpOnly" });
      return res.end();
    }
    if (path === "/subresources") {
      res.setHeader("content-type", "text/html");
      return res.end(`<img src="${otherOrigin}/pixel.png"><script>fetch("${otherOrigin}/api",{mode:"cors"}).catch(()=>{})</script><p>ok</p>`);
    }
    res.setHeader("content-type", "text/html");
    res.end("<p>scope</p>");
  });
  scopeOrigin = `http://127.0.0.1:${await listen(scopeServer)}`;
});

test.afterAll(() => {
  scopeServer.close();
  otherServer.close();
});

test.beforeEach(() => {
  scope.length = 0;
  other.length = 0;
});

async function routedContext(browser: import("@playwright/test").Browser) {
  const violations: string[] = [];
  const context = await browser.newContext();
  await installAccessRouting(context, CREDS, { origin: scopeOrigin, onViolation: (m) => violations.push(m) });
  return { context, violations };
}

test("the token reaches the exact scope origin", async ({ browser }) => {
  const { context } = await routedContext(browser);
  const page = await context.newPage();
  await page.goto(`${scopeOrigin}/plain`);
  expect(scope).toHaveLength(1);
  expect(scope[0]).toMatchObject({ id: CREDS.id, secret: CREDS.secret });
  await context.close();
});

test("a cross-origin redirect does NOT carry the token to the other origin", async ({ browser }) => {
  const { context } = await routedContext(browser);
  const page = await context.newPage();
  await page.goto(`${scopeOrigin}/to-other`);
  expect(page.url()).toBe(`${otherOrigin}/landing`); // the browser did follow the redirect
  expect(scope.map((s) => s.id)).toEqual([CREDS.id]); // the first hop was authenticated
  expect(other).toHaveLength(1);
  expect(other[0]).toMatchObject({ url: "/landing", id: null, secret: null });
  await context.close();
});

test("same-origin redirect hops: the token only on the first request, the Access cookie carries the rest", async ({ browser }) => {
  // Chromium does not route redirect hops again, so a later hop never gets the header: it is authenticated by the
  // CF_Authorization cookie that Access issues for a valid service token (simulated by the scope server).
  const { context } = await routedContext(browser);
  const page = await context.newPage();
  await page.goto(`${scopeOrigin}/same-1`);
  expect(page.url()).toBe(`${scopeOrigin}/same-2`);
  expect(scope.map((s) => [s.url, s.id, s.cookie])).toEqual([
    ["/same-1", CREDS.id, null],
    ["/same-2", null, "CF_Authorization=issued-by-access"],
  ]);
  await context.close();
});

test("cross-origin subresources and fetches from a preview page get no token", async ({ browser }) => {
  const { context } = await routedContext(browser);
  const page = await context.newPage();
  await page.goto(`${scopeOrigin}/subresources`);
  await expect.poll(() => other.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  for (const s of other) expect(s, s.url).toMatchObject({ id: null, secret: null });
  await context.close();
});

test("a redirect to an Access login host is a violation and never reaches that host", async ({ browser }) => {
  const { context, violations } = await routedContext(browser);
  const page = await context.newPage();
  await page.goto(`${scopeOrigin}/to-access`).catch(() => {});
  expect(violations.join(" | ")).toMatch(/Cloudflare Access login redirect \(team\.cloudflareaccess\.com/);
  expect(other.filter((s) => s.host.startsWith("team.cloudflareaccess.com"))).toEqual([]);
  expect(other.some((s) => s.id !== null || s.secret !== null)).toBe(false);
  await context.close();
});

test("same-origin Access login endpoints never get the token (blocker takes precedence over the preview route)", async ({ browser }) => {
  // /cdn-cgi/access/* on the PREVIEW origin matches both routes; the blocker must win, so the server never sees the request.
  const { context, violations } = await routedContext(browser);
  const page = await context.newPage();
  await page.goto(`${scopeOrigin}/cdn-cgi/access/login/preview?kid=x`).catch(() => {});
  const page2 = await context.newPage();
  await page2.goto(`${scopeOrigin}/plain`);
  await page2.evaluate((u) => fetch(u, { credentials: "include" }).catch(() => {}), `${scopeOrigin}/cdn-cgi/access/get-identity`);
  expect(violations.join(" | ")).toMatch(/Cloudflare Access login request \(127\.0\.0\.1:\d+\)/);
  expect(scope.filter((s) => s.url.startsWith("/cdn-cgi/access/") && (s.id !== null || s.secret !== null))).toEqual([]);
  expect(scope.filter((s) => s.url.startsWith("/cdn-cgi/access/login"))).toEqual([]); // the browser request never left the browser
  await context.close();
});

test("a same-origin redirect to /cdn-cgi/access/login is a violation and the token never follows it", async ({ browser }) => {
  const { context, violations } = await routedContext(browser);
  const page = await context.newPage();
  await page.goto(`${scopeOrigin}/to-access-path`).catch(() => {});
  expect(violations.join(" | ")).toMatch(/Cloudflare Access login redirect/);
  expect(scope.filter((s) => s.url.startsWith("/cdn-cgi/access/"))).toEqual([]);
  await context.close();
});

test("a failed in-scope request never exposes the token in an error or a violation", async ({ browser }) => {
  // route.fetch's own error text includes a call log with the request headers (the token). It must be scrubbed, not thrown.
  const { context, violations } = await routedContext(browser);
  const page = await context.newPage();
  const seen: string[] = [];
  page.on("pageerror", (e) => seen.push(String(e.message)));
  page.on("console", (m) => seen.push(m.text()));
  const navError = await page.goto(`${scopeOrigin}/reset`).then(() => "", (e: Error) => String(e.message));
  await page.waitForTimeout(300);
  const everything = JSON.stringify([navError, seen, violations]);
  expect(everything).not.toContain(CREDS.secret);
  expect(everything).not.toContain(CREDS.id);
  expect(violations.join(" | ")).toMatch(/request failed/i);
  await context.close();
});

test("no request anywhere ever carries the secret value outside the scope origin", async ({ browser }) => {
  const { context } = await routedContext(browser);
  const page = await context.newPage();
  for (const p of ["/to-other", "/subresources"]) await page.goto(`${scopeOrigin}${p}`).catch(() => {});
  expect(JSON.stringify(other)).not.toContain(CREDS.secret);
  expect(JSON.stringify(other)).not.toContain(CREDS.id);
  await context.close();
});
