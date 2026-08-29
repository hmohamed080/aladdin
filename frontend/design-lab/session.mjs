/**
 * A CACHED signed-in session for the fidelity loop.
 *
 * The shots specs sign in through the real passwordless path on every run:
 * request a code, poll Mailpit, read the OTP, submit it. That is correct for a
 * test — it exercises the flow it depends on — and it costs 10-20 seconds. A
 * visual pass runs the capture twenty or thirty times, so that toll is the
 * difference between "edit a class, look again" and a coffee break.
 *
 * So the OTP round trip happens ONCE and the resulting cookies are written to
 * disk. Every later capture loads the jar and goes straight to the page.
 *
 * The cache is disposable by design: if it is stale, expired, or was written
 * against a different seed, the capture lands on `/auth/sign-in` instead of the
 * workspace, and `restore()` says so rather than screenshotting a login form for
 * an hour. Delete the file (or pass `--fresh`) to re-mint it.
 *
 * This is a DESIGN-LAB tool. Nothing here is imported by the app or by the E2E
 * gate, and the credentials it uses are the seeded synthetic ones.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const JAR = "design-lab-shots/.session.json";
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

/** Cairo Sanitary Ware Trading — the organization the reference concept names. */
export const IMPORTER = "fady@example.test";

async function messagesFor(email) {
  const res = await fetch(`${MAILPIT}/api/v1/messages?limit=50`);
  if (!res.ok) return [];
  const body = await res.json();
  return (body.messages ?? []).filter((m) =>
    m.To?.some((t) => t.Address.toLowerCase() === email.toLowerCase()),
  );
}

async function readNewOtp(email, seen) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const fresh = (await messagesFor(email)).filter((m) => !seen.has(m.ID));
    for (const m of fresh) {
      const full = await fetch(`${MAILPIT}/api/v1/message/${m.ID}`);
      if (!full.ok) continue;
      const body = await full.json();
      const code = /\b(\d{6})\b/.exec(`${body.Text ?? ""} ${body.HTML ?? ""}`);
      if (code) return code[1];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no OTP arrived for ${email}`);
}

/** Mint a session by walking the real sign-in flow, and persist the cookie jar. */
async function mint(context, baseURL, email) {
  const page = await context.newPage();
  const seen = new Set((await messagesFor(email)).map((m) => m.ID));

  await page.goto(`${baseURL}/auth/sign-in`);
  await page.getByLabel(/email|البريد/i).fill(email);
  await page.getByRole("button", { name: /send code|إرسال الرمز/i }).click();
  await page.waitForTimeout(400);

  const code = await readNewOtp(email, seen);
  await page.getByLabel(/one-time code|الرمز/i).fill(code);
  await page.getByRole("button", { name: /verify|تأكيد/i }).click();
  await page.waitForURL(/\/b2b(\/|$)/, { waitUntil: "commit" });
  await page.close();

  mkdirSync("design-lab-shots", { recursive: true });
  writeFileSync(JAR, JSON.stringify(await context.cookies(), null, 2));
  return true;
}

/**
 * Put a signed-in session on `context`, minting one only if the cache misses.
 * Returns the cookies actually installed.
 */
export async function restore(context, baseURL, { email = IMPORTER, fresh = false } = {}) {
  if (!fresh && existsSync(JAR)) {
    const jar = JSON.parse(readFileSync(JAR, "utf8"));
    // Session cookies come back with `expires: -1`; only drop ones that carry a
    // real expiry in the past, which is what an actually-stale jar looks like.
    const live = jar.filter((c) => c.expires === -1 || c.expires * 1000 > Date.now());
    if (live.length) {
      await context.addCookies(live);
      return live;
    }
  }
  await mint(context, baseURL, email);
  return JSON.parse(readFileSync(JAR, "utf8"));
}

/**
 * Land on a workspace route and prove we actually got there.
 *
 * Without this check a stale jar produces a full run of beautifully captured
 * sign-in forms, and the first sign of trouble is the reviewer's eye. One URL
 * assertion converts that into an immediate, named failure — and re-mints once
 * before giving up, since an expired session is the ordinary case, not an error.
 */
export async function open(page, context, baseURL, route, opts = {}) {
  await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded" });
  if (/\/auth\//.test(page.url())) {
    await mint(context, baseURL, opts.email ?? IMPORTER);
    await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded" });
  }
  if (/\/auth\//.test(page.url())) {
    throw new Error(`could not reach ${route} — landed on ${page.url()}`);
  }
}

/**
 * Settle before capturing. `networkidle` alone is not enough: the carve is a
 * measured, spring-animated element, and a frame caught mid-travel shows it
 * between two rows in every shot it appears in.
 */
export async function settle(page, ms = 700) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
}

/** The preference cookies the shell reads on the server. */
export async function prefs(context, { locale = "en", theme = "light", sidebar = "expanded" } = {}) {
  await context.addCookies(
    [
      ["NEXT_LOCALE", locale],
      ["aladdin-theme", theme],
      ["aladdin-sidebar", sidebar],
    ].map(([name, value]) => ({ name, value, url: "http://127.0.0.1" })),
  );
}
