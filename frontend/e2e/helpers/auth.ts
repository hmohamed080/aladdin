import { expect, type Page, type APIRequestContext } from "@playwright/test";

/** Seeded synthetic identities (from supabase/demo-seed.sql). Never production. */
export const IDENTITIES = {
  manager: "a-owner@example.test",
  branchLimited: "a-cairo@example.test",
  admin: "admin@example.test",
  consumer: "consumer@example.test",
  salesperson: "youssef@example.test",
  /* Cairo Ceramics Showroom owner - the Showroom/Dealer acceptance workspace.
     Org A is a supplier and Org B a design office; neither exercises the
     buyer-first showroom IA the workspace is actually tuned for. */
  showroom: "hana@example.test",

  /* The three SUPPLY-SIDE acceptance workspaces, in manual-priority order. All
     three own an organization whose `org_type` puts it in the seller seat, and
     all three have the seeded demand, quotations, orders and fulfilment work
     that the supply-side surfaces exist to show (seed-pilot.sql section 11).

     Note what these names are NOT: none of them is a "supplier account". The
     classification lives on the ORGANIZATION, and `supplier` is the internal
     identifier for the Distributor product concept — it is never user-facing. */
  distributor: "rania@example.test", // Suez Paints & Coatings   (org_type supplier)
  manufacturer: "mahmoud@example.test", // Alexandria Glass & Aluminium (org_type manufacturer)
  importer: "fady@example.test", // Cairo Sanitary Ware Trading  (org_type importer)
} as const;

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

type MailpitMessage = { ID: string; To: Array<{ Address: string }> };

async function messagesFor(request: APIRequestContext, email: string): Promise<MailpitMessage[]> {
  const res = await request.get(`${MAILPIT}/api/v1/messages?limit=50`);
  if (!res.ok()) return [];
  const body = await res.json();
  const messages: MailpitMessage[] = body.messages ?? [];
  return messages.filter((m) => m.To?.some((t) => t.Address.toLowerCase() === email.toLowerCase()));
}

/** The set of message IDs currently in Mailpit for `email` (snapshot BEFORE sending). */
export async function messageIdsFor(request: APIRequestContext, email: string): Promise<Set<string>> {
  return new Set((await messagesFor(request, email)).map((m) => m.ID));
}

/** Subject lines of messages for `email` that arrived AFTER `seen` was captured. */
export async function newMessageSubjectsFor(
  request: APIRequestContext,
  email: string,
  seen: Set<string>,
): Promise<string[]> {
  const all = await messagesFor(request, email);
  return all.filter((m) => !seen.has(m.ID)).map((m) => (m as unknown as { Subject: string }).Subject);
}

/**
 * Deterministically read the OTP from the message that arrived AFTER `seen` was
 * captured — never a stale code from a previous test. Exercises the REAL
 * passwordless path (no auth bypass): the app sends the code, Mailpit captures
 * it, and we extract the 6 digits from the newest genuinely-new message.
 */
export async function readNewOtp(
  request: APIRequestContext,
  email: string,
  seen: Set<string>,
): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const fresh = (await messagesFor(request, email)).filter((m) => !seen.has(m.ID));
    for (const m of fresh) {
      const full = await request.get(`${MAILPIT}/api/v1/message/${m.ID}`);
      if (!full.ok()) continue;
      const msg = await full.json();
      const code = `${msg.Text ?? ""} ${msg.HTML ?? ""}`.match(/\b(\d{6})\b/);
      if (code) return code[1]!;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No new OTP code arrived in Mailpit for ${email}`);
}

/**
 * The known password every E2E identity signs in with. LOCAL TEST DB ONLY:
 * `global-setup.ts` stamps it onto the seeded synthetic `@example.test`
 * identities (the product seeds carry no passwords), and fixtures registered
 * through `/auth/sign-up` choose it themselves. Never a production credential.
 */
export const E2E_PASSWORD = "Zq9$Kx4#WmT7!Pn2Rb";

/**
 * Sign in through the REAL canonical Email + Password flow (`/auth/sign-in`,
 * no CAPTCHA by design) and wait for the expected landing. No auth bypass:
 * the credential goes through the real server action and Supabase Auth.
 */
export async function signIn(
  page: Page,
  _request: APIRequestContext,
  email: string,
  expectedLanding: RegExp = /\/b2b(\/|$)/,
  password: string = E2E_PASSWORD,
): Promise<void> {
  await page.goto("/auth/sign-in");
  await page.getByLabel(/^email address$|^البريد الإلكتروني$/i).fill(email);
  // Anchored: the "Show password" toggle is labelled too.
  await page.getByLabel(/^password$|^كلمة المرور$/i).fill(password);
  await page.getByRole("button", { name: /^sign in$|^تسجيل الدخول$/i }).click();

  // Wait on the URL committing, not the full "load" event — under sustained
  // full-suite load the load event can lag far behind an interactive page.
  await page.waitForURL(expectedLanding, { waitUntil: "commit" });
}

/**
 * Waits for Cloudflare Turnstile's REAL widget (always-pass TEST site key
 * locally — see turnstile-widget.tsx) to populate the hidden `captchaToken`
 * input. No bypass: the server verifies it with Cloudflare Siteverify. Needs
 * challenges.cloudflare.com to be reachable.
 */
export async function waitForCaptchaToken(page: Page): Promise<void> {
  await expect(page.locator('input[name="captchaToken"]')).not.toHaveValue("", { timeout: 30_000 });
}

/**
 * Picks an account type from the canonical sign-up dropdown by its visible
 * (localized) label. Coming Soon options are disabled and cannot be picked.
 */
export async function selectAccountType(page: Page, label: RegExp = /tradespeople & technicians|الصنايعية/i): Promise<void> {
  const select = page.locator('select[name="accountType"]');
  const value = await select.locator("option").evaluateAll(
    (options, source) => {
      const re = new RegExp(source.pattern, source.flags);
      const match = (options as HTMLOptionElement[]).find((o) => !o.disabled && o.value && re.test(o.textContent ?? ""));
      return match?.value ?? null;
    },
    { pattern: label.source, flags: label.flags },
  );
  if (!value) throw new Error(`No selectable account type matches ${label}`);
  await select.selectOption(value);
}

/**
 * Register a brand-new account through the REAL canonical `/auth/sign-up`
 * (Full Name, email, username, account type, password, consents, Turnstile)
 * and its OTP confirmation, then wait for the app landing. Leaves the browser
 * signed in; the account's password is `E2E_PASSWORD`.
 */
export async function registerWithPassword(
  page: Page,
  request: APIRequestContext,
  {
    email,
    username,
    displayName = "E2E Tester",
    accountType = /tradespeople & technicians|الصنايعية/i,
    landing = /\/(home|b2b)(\/|$|\?)/,
  }: { email: string; username: string; displayName?: string; accountType?: RegExp; landing?: RegExp },
): Promise<void> {
  await page.goto("/auth/sign-up");
  await page.getByLabel(/^full name$|^الاسم الكامل$/i).fill(displayName);
  await page.getByLabel(/^email address$|^البريد الإلكتروني$/i).fill(email);
  await page.getByLabel(/^username$|^اسم المستخدم$/i).fill(username);
  await selectAccountType(page, accountType);
  await page.getByLabel(/^password$|^كلمة المرور$/i).fill(E2E_PASSWORD);
  await page.getByLabel(/confirm password|تأكيد كلمة المرور/i).fill(E2E_PASSWORD);
  await page.getByLabel(/terms of service|شروط الخدمة/i).check();
  await page.getByLabel(/privacy policy|سياسة الخصوصية/i).check();
  await page.getByLabel(/pilot release|إصدار تجريبي/i).check();
  const seen = await messageIdsFor(request, email);
  await waitForCaptchaToken(page);
  await page.getByRole("button", { name: /create account|إنشاء حساب/i }).click();
  await expect(page.getByText(/next step|الخطوة التالية/i)).toBeVisible({ timeout: 20_000 });
  const code = await readNewOtp(request, email, seen);
  await page.getByLabel(/one-time code|الرمز لمرة واحدة/i).pressSequentially(code);
  await page.getByRole("button", { name: /verify and continue|تحقق وتابع/i }).click();
  await page.waitForURL(landing, { waitUntil: "commit", timeout: 20_000 });
}
