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

/**
 * Offline sandboxes only (E2E_STUB_TURNSTILE=1): challenges.cloudflare.com is unreachable there, so the
 * REAL widget never loads and never mints a token. This serves a stand-in `window.turnstile` that hands
 * the widget a dummy token, the same stub pr88-admin-showroom and installer-phone-auth use. Sign In
 * forwards the token to the local GoTrue, which has [auth.captcha] OFF; flows the APP verifies with
 * Siteverify (Create Account, Forgot Password) still need the real network and still fail closed.
 * Unset (the default), nothing is stubbed.
 */
/**
 * E2E_STUB_TURNSTILE_DELAY_MS (default 0) makes the stand-in mint its token that much later, like the real
 * widget does, so a test that submits before the token exists fails offline exactly as it does online.
 */
export const TURNSTILE_STUB_DELAY_MS = Number(process.env.E2E_STUB_TURNSTILE_DELAY_MS ?? 0) || 0;
const TURNSTILE_STUB = `window.turnstile={render:function(el,o){setTimeout(function(){o.callback("XXXX.DUMMY.TOKEN.XXXX")},${TURNSTILE_STUB_DELAY_MS});return "local-test"},remove:function(){},reset:function(){}};`;
const stubbedContexts = new WeakSet<object>();
export async function stubTurnstileWhenOffline(page: Page): Promise<void> {
  if (process.env.E2E_STUB_TURNSTILE !== "1") return;
  const context = page.context();
  if (stubbedContexts.has(context)) return;
  stubbedContexts.add(context);
  await context.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: TURNSTILE_STUB }),
  );
}

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
/** Sign-up requires an 18+ birthday (ADR-0025). */
export const E2E_BIRTH_DATE = "1990-01-15";

/** Picks E2E_BIRTH_DATE in the sign-up Month / Day / Year dropdowns. */
export async function fillBirthDate(page: Page): Promise<void> {
  const [year, month, day] = E2E_BIRTH_DATE.split("-").map(Number);
  await page.locator("#birthMonth").selectOption(String(month));
  await page.locator("#birthDay").selectOption(String(day));
  await page.locator("#birthYear").selectOption(String(year));
}
/** The one sign-in field and the sign-up contact field (ADR-0025), EN and AR. */
export const SIGN_IN_IDENTIFIER_LABEL = /^mobile number, username or email$|^رقم الموبايل أو اسم المستخدم أو البريد الإلكتروني$/i;
export const SIGN_UP_CONTACT_LABEL = /^mobile number or email$|^رقم الموبايل أو البريد الإلكتروني$/i;
export const SIGN_IN_BUTTON = /^log in$|^تسجيل الدخول$/i;
export const SIGN_UP_BUTTON = /^sign up$|^تسجيل$/i;

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
  await stubTurnstileWhenOffline(page);
  await page.goto("/auth/sign-in");
  await page.getByLabel(SIGN_IN_IDENTIFIER_LABEL).fill(email);
  // Anchored: the "Show password" toggle is labelled too.
  await page.getByLabel(/^password$|^كلمة المرور$/i).fill(password);
  // PR #84: sign-in forwards a Turnstile token to GoTrue and refuses an unchallenged request, so wait for the REAL widget
  // (always-pass TEST site key locally) to produce it before submitting.
  await waitForCaptchaToken(page);
  await page.getByRole("button", { name: SIGN_IN_BUTTON }).click();

  // Wait on the URL committing, not the full "load" event — under sustained
  // full-suite load the load event can lag far behind an interactive page.
  await reachLanding(page, expectedLanding);
}

const ACCOUNT_BASICS_URL = /\/onboarding\/basics(\?|$)/;

/**
 * Waits for `landing`, completing the one-time "Complete your account" screen
 * (ADR-0026: phone, governorate + town, specialties) through the REAL form if
 * the account is sent there first. Only the sections the account still misses
 * are on the page.
 */
export async function reachLanding(page: Page, landing: RegExp, timeout = 20_000): Promise<void> {
  const onBasics = (url: URL) => ACCOUNT_BASICS_URL.test(url.pathname + url.search);
  await page.waitForURL((url) => onBasics(url) || landing.test(url.href), { waitUntil: "commit", timeout });
  if (onBasics(new URL(page.url()))) {
    await completeAccountBasics(page);
    await page.waitForURL(landing, { waitUntil: "commit", timeout });
  }
}

/** Fills whatever the basics screen asks for and continues. */
export async function completeAccountBasics(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: /complete your account|أكمل حسابك/i })).toBeVisible();
  const phone = page.locator('input[name="phone"]');
  if (await phone.count()) await phone.fill(`010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`);
  const governorate = page.locator('select[name="governorate"]');
  if (await governorate.count()) {
    await governorate.selectOption("cairo");
    await page.locator("select#city").selectOption("new-cairo");
  }
  // Specialties are picked from a dropdown (select#specialtyAdd, account-basics-form.tsx); option 0 is the disabled placeholder, so
  // index 1 is the first real trade. The picked trade shows up as a removable item in the list below the dropdown, which proves the
  // REAL form accepted the choice (the first one is the main specialty) before we submit.
  const specialty = page.locator("select#specialtyAdd");
  if (await specialty.count()) {
    await specialty.selectOption({ index: 1 });
    await expect(page.locator('ul[aria-labelledby="basics-specialties"] li')).toHaveCount(1);
  }
  await page.getByRole("button", { name: /^continue$|^متابعة$/i }).click();
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
export async function selectAccountType(page: Page, label: RegExp = /craftsmen|الصنايعية/i): Promise<void> {
  // The sign-up control is the design-system listbox (role=combobox); older builds used a native <select>.
  const native = page.locator('select[name="accountType"]');
  if (await native.count()) {
    const value = await native.locator("option").evaluateAll(
      (options, source) => {
        const re = new RegExp(source.pattern, source.flags);
        const match = (options as HTMLOptionElement[]).find((o) => !o.disabled && o.value && re.test(o.textContent ?? ""));
        return match?.value ?? null;
      },
      { pattern: label.source, flags: label.flags },
    );
    if (!value) throw new Error(`No selectable account type matches ${label}`);
    await native.selectOption(value);
    return;
  }
  await page.getByRole("combobox", { name: /how will you use aladdin|كيف ستستخدم/i }).click();
  const options = page.getByRole("option");
  await expect(options.first()).toBeVisible();
  const all = await options.evaluateAll((els) =>
    els.map((el) => ({ text: (el.textContent ?? "").trim(), disabled: el.getAttribute("aria-disabled") === "true" || el.hasAttribute("data-disabled") })),
  );
  const index = all.findIndex((o) => !o.disabled && label.test(o.text));
  if (index < 0) throw new Error(`No selectable account type matches ${label}`);
  await options.nth(index).click();
}

/** Every account type offered by the sign-up control, with its Coming Soon (disabled) state. Leaves the list closed. */
export async function accountTypeOptions(page: Page): Promise<Array<{ text: string; disabled: boolean }>> {
  await page.getByRole("combobox", { name: /how will you use aladdin|كيف ستستخدم/i }).click();
  const options = page.getByRole("option");
  await expect(options.first()).toBeVisible();
  const all = await options.evaluateAll((els) =>
    els.map((el) => ({ text: (el.textContent ?? "").trim(), disabled: el.getAttribute("aria-disabled") === "true" || el.hasAttribute("data-disabled") })),
  );
  await page.keyboard.press("Escape");
  return all;
}

/**
 * Register a brand-new account through the REAL canonical `/auth/sign-up`
 * (email, password, birthday, Full Name, username, account type, Turnstile)
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
    accountType = /craftsmen|الصنايعية/i,
    landing = /\/(home|b2b)(\/|$|\?)/,
  }: { email: string; username: string; displayName?: string; accountType?: RegExp; landing?: RegExp },
): Promise<void> {
  await stubTurnstileWhenOffline(page);
  await page.goto("/auth/sign-up");
  await page.getByLabel(SIGN_UP_CONTACT_LABEL).fill(email);
  await page.getByLabel(/^password$|^كلمة المرور$/i).fill(E2E_PASSWORD);
  await fillBirthDate(page);
  await page.getByLabel(/^full name$|^الاسم الكامل$/i).fill(displayName);
  await page.getByLabel(/^username$|^اسم المستخدم$/i).fill(username);
  await selectAccountType(page, accountType);
  const seen = await messageIdsFor(request, email);
  await waitForCaptchaToken(page);
  await page.getByRole("button", { name: SIGN_UP_BUTTON }).click();
  await expect(page.getByRole("heading", { name: /verify your email|تحقق من بريدك الإلكتروني/i })).toBeVisible({ timeout: 20_000 });
  const code = await readNewOtp(request, email, seen);
  await page.getByLabel(/one-time code|الرمز لمرة واحدة/i).pressSequentially(code);
  await page.getByRole("button", { name: /verify and continue|تحقق وتابع/i }).click();
  await reachLanding(page, landing);
}
