import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { messageIdsFor, readNewOtp, signIn } from "./helpers/auth";

/**
 * Sprint 13 — Personal Experience + Sales Affiliation. Targeted acceptance, all
 * driving the REAL passwordless flow (no auth bypass) against the local stack.
 *
 *   1. Consumer product home — usable, product-first, nothing blocking;
 *   2. Engineer product home — professional-first, the two account signals secondary;
 *   3. Salesperson with no showroom — account usable, /b2b unavailable;
 *   4. Salesperson → existing showroom → owner approves → workspace opens;
 *   5. Missing showroom → referral submitted, account still usable;
 *   6. Admin approves the referral — no duplicate, Sales member not Owner;
 *   7. Rejection — the personal account survives;
 *   8. Last-workspace restoration across sign-out/sign-in;
 *   9. Arabic / RTL on the changed surfaces;
 *  10. Mobile on the changed surfaces (the mobile project runs every test here).
 *
 * The showroom fixtures are seed-pilot's: Cairo Ceramics Showroom, owned by
 * hana@example.test, with a Nasr City branch.
 */

const OWNER = "hana@example.test"; // Cairo Ceramics Showroom owner
const ADMIN = "admin@example.test"; // platform administrator

async function prefs(page: Page, locale: "en" | "ar", theme: "light" | "dark" = "light") {
  await page.context().addCookies([
    { name: "NEXT_LOCALE", value: locale, url: "http://127.0.0.1" },
    { name: "aladdin-theme", value: theme, url: "http://127.0.0.1" },
  ]);
}

/** The page body must never scroll horizontally — at either viewport. */
async function noOverflow(page: Page) {
  const o = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(o).toBeLessThanOrEqual(1);
}

/** Register a fresh identity and complete the shared steps. Returns its email. */
async function toAccountType(
  page: Page,
  request: APIRequestContext,
  displayName: string,
): Promise<string> {
  const email = `s13+${Date.now()}${Math.floor(Math.random() * 10000)}@example.test`;
  const seen = await messageIdsFor(request, email);
  await page.goto("/auth/sign-up");
  await page.getByLabel(/email address|البريد/i).fill(email);
  await page.getByLabel(/terms of service|شروط الخدمة/i).check();
  await page.getByLabel(/privacy policy|سياسة الخصوصية/i).check();
  await page.getByLabel(/pilot release|نسخة تجريبية/i).check();
  await page.getByRole("button", { name: /create account|إنشاء حساب/i }).click();
  await expect(page.getByText(/we sent a code|أرسلنا رمزًا/i)).toBeVisible();
  const code = await readNewOtp(request, email, seen);
  await page.getByLabel(/one-time code|الرمز/i).fill(code);
  await page.getByRole("button", { name: /verify|تأكيد/i }).click();
  await page.waitForURL(/\/onboarding\/profile$/, { waitUntil: "commit" });

  await page.locator("#displayName").fill(displayName);
  await page.getByRole("button", { name: /^continue$|متابعة/i }).click();
  await page.waitForURL(/\/onboarding\/contact$/, { waitUntil: "commit" });
  await page.locator("#phone").fill("01012345678");
  await page.getByRole("button", { name: /^continue$|متابعة/i }).click();
  await page.waitForURL(/\/onboarding\/account-type$/, { waitUntil: "commit" });
  return email;
}

async function pickType(page: Page, label: RegExp, landing: RegExp) {
  await page.getByRole("button", { name: label }).click();
  await page.getByRole("button", { name: /^continue$|متابعة/i }).click();
  await page.waitForURL(landing, { waitUntil: "commit" });
}

/** Fresh Consumer, all the way to a usable /home. */
async function registerConsumer(page: Page, request: APIRequestContext, name: string) {
  const email = await toAccountType(page, request, name);
  await pickType(page, /personal use|استخدام شخصي/i, /\/onboarding\/consumer$/);
  await page.getByRole("button", { name: /planning a project|أخطط لمشروع/i }).click();
  await page.getByRole("button", { name: /^continue$|متابعة/i }).click();
  await page.getByRole("button", { name: /^flooring$|^الأرضيات$/i }).click();
  await page.getByRole("button", { name: /^continue$|متابعة/i }).click();
  await page.locator("#gov").selectOption("cairo");
  await page.locator("#city").selectOption("new_cairo");
  await page.getByRole("button", { name: /^continue$|متابعة/i }).click();
  await page.getByRole("button", { name: /^continue$|متابعة/i }).click(); // budget (optional)
  await page.getByRole("button", { name: /finish setup|إنهاء الإعداد/i }).click();
  await page.waitForURL(/\/home$/, { waitUntil: "commit" });
  return email;
}

/**
 * Fresh individual professional, all the way to a usable /home. `typeLabel` picks
 * the registration card; `concrete` the sub-type button where the flow asks.
 */
async function registerProfessional(
  page: Page,
  request: APIRequestContext,
  name: string,
  typeLabel: RegExp,
  headline: string,
  opts: { concrete?: RegExp; specialization: RegExp; service: RegExp },
) {
  const email = await toAccountType(page, request, name);
  await pickType(page, typeLabel, /\/onboarding\/professional$/);
  if (opts.concrete) await page.getByRole("button", { name: opts.concrete }).click();
  await page.locator("#headline").fill(headline);
  await page.locator("#years").fill("6");
  await page.getByRole("button", { name: opts.specialization }).click();
  await page.getByRole("button", { name: /^continue$|متابعة/i }).click();
  await page.getByRole("button", { name: opts.service }).click();
  await page.getByRole("button", { name: /^continue$|متابعة/i }).click();
  // Remote-only keeps the flow short and is a valid professional shape.
  await page.getByRole("checkbox", { name: /i offer remote consultations|استشارات عن بُعد/i }).check();
  await page.getByRole("button", { name: /^continue$|متابعة/i }).click();
  await page.getByRole("button", { name: /^continue$|متابعة/i }).click();
  await page.getByRole("button", { name: /continue to review|متابعة إلى المراجعة/i }).click();
  await page.waitForURL(/\/onboarding\/professional\/review$/, { waitUntil: "commit" });
  await page.getByRole("button", { name: /submit for review|إرسال للمراجعة/i }).click();
  await page.waitForURL(/\/home$/, { waitUntil: "commit" });
  return email;
}

const registerSalesperson = (page: Page, request: APIRequestContext, name: string, headline: string) =>
  registerProfessional(page, request, name, /^salesperson|^مندوب مبيعات/i, headline, {
    specialization: /^showroom sales$|^مبيعات معارض$/i,
    service: /^showroom advice$|^استشارة معرض$/i,
  });

/** The switcher is rendered twice (desktop slot + mobile row); use the visible one. */
const switcher = (page: Page) => page.getByTestId("workspace-switcher").locator("visible=true");

test.describe("Sprint 13 — personal experience + sales affiliation", () => {
  /* ============================ 1. Consumer home ============================ */
  test("1 — a fresh Consumer lands on a product-first home that blocks nothing", async ({
    page,
    request,
  }) => {
    await prefs(page, "en");
    await registerConsumer(page, request, "Consumer Home Tester");

    // Identity leads, at the headline step of the type scale.
    const h1 = page.getByRole("heading", { level: 1, name: /welcome, consumer home tester/i });
    await expect(h1).toBeVisible();
    expect(parseFloat(await h1.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(28);

    // Real actions, not a status report.
    await expect(page.getByRole("heading", { name: /^start here$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /your project brief/i }).first()).toBeVisible();
    // A Consumer may own a business without becoming a second user.
    await expect(page.getByRole("link", { name: /add a business/i }).first()).toBeVisible();

    // Their own brief is read back — real data this account owns.
    await expect(page.getByText(/planning a project/i)).toBeVisible();

    // Completeness and verification are PRESENT but secondary: below the actions,
    // and not the page's leading message.
    await expect(page.getByText(/profile completeness/i)).toBeVisible();
    const actionsY = await page
      .getByRole("heading", { name: /^start here$/i })
      .evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    const accountY = await page
      .getByRole("heading", { name: /^your account$/i })
      .evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    expect(accountY).toBeGreaterThan(actionsY);

    // The previous three prominent "coming soon" cards are gone.
    await expect(page.getByRole("heading", { name: /coming up in the pilot/i })).toHaveCount(0);

    // Nothing gates the page, and the workspace switcher is reachable.
    await expect(switcher(page)).toBeVisible();
    await noOverflow(page);
  });

  /* =========================== 2. Engineer home ============================ */
  test("2 — a fresh Engineer gets a professional home, with the account signals secondary", async ({
    page,
    request,
  }) => {
    await prefs(page, "en");
    await registerProfessional(
      page,
      request,
      "Engineer Home Tester",
      /^engineer|^مهندس /i,
      "Structural engineer, Cairo",
      { specialization: /^structural$|^إنشائي$/i, service: /^structural design$|^تصميم إنشائي$/i },
    );

    // The professional identity leads.
    await expect(page.getByRole("heading", { level: 1, name: /welcome, engineer home tester/i })).toBeVisible();
    await expect(page.getByText("Structural engineer, Cairo")).toBeVisible();
    await expect(page.getByRole("heading", { name: /your practice/i })).toBeVisible();

    // Completeness is visible as a percentage, and verification as a badge — both
    // secondary, and the account is usable regardless.
    await expect(page.getByText(/%/).first()).toBeVisible();
    await expect(page.getByText(/pending review/i).first()).toBeVisible();
    // The old large review card is not the page's main experience.
    const practiceY = await page
      .getByRole("heading", { name: /your practice/i })
      .evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    const accountY = await page
      .getByRole("heading", { name: /^your account$/i })
      .evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    expect(accountY).toBeGreaterThan(practiceY);

    // An engineer has no showroom affiliation panel — that is salesperson-only.
    await expect(page.getByRole("heading", { name: /your sales setup/i })).toHaveCount(0);
    await noOverflow(page);
  });

  /* ================ 3. Salesperson without a showroom ===================== */
  test("3 — a fresh Salesperson has a usable account and no B2B access", async ({ page, request }) => {
    await prefs(page, "en");
    await registerSalesperson(page, request, "Sales No Showroom", "Showroom sales specialist");

    // NOT trapped in an affiliation/review screen: this is /home, and it works.
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("heading", { level: 1, name: /welcome, sales no showroom/i })).toBeVisible();

    // The Sales setup CTA is present as an invitation, not a blocker.
    await expect(page.getByRole("heading", { name: /your sales setup/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /connect your showroom/i }).first()).toBeVisible();

    // /b2b is unavailable without a membership — the caller is resolved back to
    // their usable personal home rather than shown a broken workspace.
    await page.goto("/b2b");
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("heading", { level: 1, name: /welcome, sales no showroom/i })).toBeVisible();
    await noOverflow(page);
  });

  /* ============ 4 + 7. Existing showroom: reject, then approve ============= */
  test("4 + 7 — request an existing showroom: a rejection is survivable, an approval opens the workspace", async ({
    page,
    request,
  }) => {
    await prefs(page, "en");
    const email = await registerSalesperson(page, request, "Sales Joins Ceramics", "Ceramics sales");

    // --- request ---
    await page.getByRole("link", { name: /connect your showroom/i }).first().click();
    await page.waitForURL(/\/home\/showroom/, { waitUntil: "commit" });
    await page.locator("#q").fill("ceramics");
    await page.getByRole("button", { name: /^search$/i }).click();
    await page.getByRole("link", { name: /cairo ceramics showroom/i }).first().click();
    await expect(page.getByRole("heading", { name: /cairo ceramics showroom/i })).toBeVisible();
    await page.getByRole("button", { name: /request to join/i }).click();
    await page.waitForURL(/\/home/, { waitUntil: "commit" });

    // Still usable, and the connection reads as pending — not as a locked account.
    await expect(page.getByText(/connection pending/i)).toBeVisible();
    await expect(page.getByText(/account works normally/i)).toBeVisible();
    // No workspace was granted by asking.
    await page.goto("/b2b");
    await expect(page).toHaveURL(/\/home$/);

    // --- 7. the owner DECLINES first ---
    await page.context().clearCookies();
    await prefs(page, "en");
    await signIn(page, request, OWNER, /\/b2b(\/|$)/);
    await page.goto("/b2b/organization");
    await expect(page.getByRole("heading", { name: /requests to join/i })).toBeVisible();
    await expect(page.getByText(/sales joins ceramics/i)).toBeVisible();
    await page.getByLabel(/reason for declining/i).fill("Please ask your branch manager first");
    await page.getByRole("button", { name: /^decline$/i }).click();
    await page.waitForURL(/\/b2b\/organization/, { waitUntil: "commit" });

    // The salesperson's personal account is untouched, and the reason is visible.
    await page.context().clearCookies();
    await prefs(page, "en");
    await signIn(page, request, email, /\/home$/);
    await expect(page.getByRole("heading", { level: 1, name: /welcome, sales joins ceramics/i })).toBeVisible();
    await expect(page.getByText(/connection declined/i)).toBeVisible();
    await expect(page.getByText(/ask your branch manager/i)).toBeVisible();
    // Still no B2B membership.
    await page.goto("/b2b");
    await expect(page).toHaveURL(/\/home$/);

    // --- 4. they try again, and this time it is approved ---
    await page.goto("/home/showroom");
    await page.locator("#q").fill("ceramics");
    await page.getByRole("button", { name: /^search$/i }).click();
    await page.getByRole("link", { name: /cairo ceramics showroom/i }).first().click();
    await page.getByRole("button", { name: /request to join/i }).click();
    await page.waitForURL(/\/home/, { waitUntil: "commit" });
    await expect(page.getByText(/connection pending/i)).toBeVisible();

    await page.context().clearCookies();
    await prefs(page, "en");
    await signIn(page, request, OWNER, /\/b2b(\/|$)/);
    await page.goto("/b2b/organization");
    await page.getByRole("button", { name: /approve and add to team/i }).click();
    await page.waitForURL(/\/b2b\/organization/, { waitUntil: "commit" });
    // They joined as a salesperson — the roster shows them as a member.
    await expect(page.getByText(/sales joins ceramics/i).first()).toBeVisible();

    // The showroom is now a real workspace for the salesperson.
    await page.context().clearCookies();
    await prefs(page, "en");
    await signIn(page, request, email, /\/(home|b2b)(\/|$)/);
    await page.goto("/home");
    await expect(page.getByRole("heading", { name: /your showrooms/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /cairo ceramics showroom/i }).first()).toBeVisible();

    // It appears in the workspace switcher...
    await switcher(page).click();
    await expect(page.getByRole("menu").getByText(/cairo ceramics showroom/i)).toBeVisible();
    await page.getByRole("menuitem", { name: /cairo ceramics showroom/i }).click();
    // ...and the B2B Sales workspace is reachable.
    await page.waitForURL(/\/b2b(\/|$)/, { waitUntil: "commit" });
    await page.goto("/b2b/customers");
    await expect(page).toHaveURL(/\/b2b\/customers/);
    await noOverflow(page);
  });

  /* ============ 5 + 6. Missing showroom: referral, then Admin ============= */
  test("5 + 6 — refer a missing showroom, and the Admin approves it without a duplicate", async ({
    page,
    request,
  }) => {
    await prefs(page, "en");
    const email = await registerSalesperson(page, request, "Sales Refers Zayed", "Tiles sales");
    const showroom = `Zayed Tiles ${Date.now()}`;

    // --- 5. the referral ---
    await page.goto("/home/showroom");
    await page.locator("#q").fill("zzzznotfound");
    await page.getByRole("button", { name: /^search$/i }).click();
    await expect(page.getByText(/no showrooms matched/i)).toBeVisible();
    await page.getByRole("link", { name: /add showroom/i }).click();
    await page.waitForURL(/\/home\/showroom\/refer/, { waitUntil: "commit" });

    // This is explicitly NOT the owner "add business" flow.
    await expect(page.getByText(/telling us about your employer/i)).toBeVisible();
    await expect(page.getByText(/not as its owner/i)).toBeVisible();

    await page.locator("#displayName").fill(showroom);
    await page.locator("#governorate").selectOption("giza");
    await page.locator("#city").selectOption("sheikh_zayed");
    await page.locator("#primaryBranchName").fill("Zayed Main");
    await page.getByRole("button", { name: /submit for review/i }).click();
    await page.waitForURL(/\/home/, { waitUntil: "commit" });

    // The account stays usable and the referral reads as pending.
    await expect(page.getByText(/submitted for verification/i)).toBeVisible();
    await expect(page.getByText(/account works normally/i)).toBeVisible();
    // No showroom B2B access yet.
    await page.goto("/b2b");
    await expect(page).toHaveURL(/\/home$/);
    await noOverflow(page);

    // --- 6. the Admin review ---
    await page.context().clearCookies();
    await prefs(page, "en");
    await signIn(page, request, ADMIN, /\/admin(\/|$)/);
    await page.goto("/admin/verifications");
    await expect(page.getByRole("heading", { name: /referred showrooms/i })).toBeVisible();
    // The referring salesperson is identified — the attribution a future rewards
    // feature will read.
    await expect(page.getByText(/referred by/i).first()).toBeVisible();
    await expect(page.getByText(/sales refers zayed/i)).toBeVisible();
    // The supplied business/location data is inspectable.
    await expect(page.getByText(showroom)).toBeVisible();
    await expect(page.getByText(/sheikh zayed/i).first()).toBeVisible();

    await page
      .getByRole("button", { name: /approve as a new business/i })
      .first()
      .click();
    await page.waitForURL(/\/admin\/verifications/, { waitUntil: "commit" });

    // Exactly ONE organization of that name exists — approval cannot duplicate.
    await page.goto("/admin/organizations");
    await expect(page.getByRole("cell", { name: showroom, exact: true })).toHaveCount(1);

    // The salesperson now has the workspace, as a MEMBER.
    await page.context().clearCookies();
    await prefs(page, "en");
    await signIn(page, request, email, /\/(home|b2b)(\/|$)/);
    await page.goto("/home");
    await expect(page.getByRole("heading", { name: /your showrooms/i })).toBeVisible();
    await switcher(page).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByText(showroom)).toBeVisible();
    // Their relationship is Member — never Owner.
    await expect(menu.getByText(/^member$/i).first()).toBeVisible();
    await expect(menu.getByText(/^owner$/i)).toHaveCount(0);
  });

  /* ==================== 8. Last-workspace restoration ===================== */
  test("8 — a valid work-context selection is restored after signing back in", async ({
    page,
    request,
  }) => {
    await prefs(page, "en");
    // Mostafa owns Horizon Contracting AND is a personal contractor: both contexts.
    await signIn(page, request, "mostafa@example.test", /\/(home|b2b)(\/|$)/);

    // Select Personal → sign out → back in → Personal is restored.
    await page.goto("/home");
    await switcher(page).click();
    await page.getByRole("menuitem", { name: /^personal/i }).click();
    await page.waitForURL(/\/home$/, { waitUntil: "commit" });
    await page.getByRole("button", { name: /sign out|تسجيل الخروج/i }).click();
    await page.waitForURL(/\/auth\/sign-in/, { waitUntil: "commit" });
    await signIn(page, request, "mostafa@example.test", /\/home$/);
    await expect(page).toHaveURL(/\/home$/);

    // Select the Business → sign out → back in → the Business is restored.
    await switcher(page).click();
    await page.getByRole("menuitem", { name: /horizon contracting/i }).click();
    await page.waitForURL(/\/b2b(\/|$)/, { waitUntil: "commit" });
    await page.getByRole("button", { name: /sign out|تسجيل الخروج/i }).click();
    await page.waitForURL(/\/auth\/sign-in/, { waitUntil: "commit" });
    await signIn(page, request, "mostafa@example.test", /\/b2b(\/|$)/);
    await expect(page).toHaveURL(/\/b2b(\/|$)/);

    // No valid selection at all → Personal is the default when both exist.
    await page.context().clearCookies();
    await prefs(page, "en");
    await signIn(page, request, "mostafa@example.test", /\/home$/);
    await expect(page).toHaveURL(/\/home$/);
  });

  test("8 — landing is never derived from persona: a Salesperson is not sent to /b2b", async ({
    page,
    request,
  }) => {
    await prefs(page, "en");
    // Youssef IS a salesperson persona WITH an active showroom membership, so he
    // has both contexts — and with no selection, Personal wins. Persona alone never
    // decides, and a verification decision never enters into it.
    await signIn(page, request, "youssef@example.test", /\/home$/);
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("heading", { name: /your showrooms/i })).toBeVisible();
  });

  /* =========================== 9. Arabic / RTL ============================ */
  test("9 — Consumer, Engineer and Salesperson surfaces read naturally in Arabic RTL", async ({
    page,
    request,
  }) => {
    await prefs(page, "ar");

    // --- Consumer ---
    await registerConsumer(page, request, "مستهلك تجريبي");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { name: /ابدأ من هنا/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /حسابك/ }).first()).toBeVisible();
    await expect(page.getByText(/اكتمال الملف الشخصي/)).toBeVisible();
    // No unintended English on the Arabic personal home.
    const consumerText = (await page.locator("main").innerText()).replace(/\d|%|·|EGP/g, "");
    expect(consumerText).not.toMatch(/[A-Za-z]{4,}/);
    await noOverflow(page);

    // --- Salesperson, including the affiliation surfaces ---
    await page.context().clearCookies();
    await prefs(page, "ar");
    await registerSalesperson(page, request, "مسؤول مبيعات تجريبي", "أخصائي مبيعات معارض");
    await expect(page.getByRole("heading", { name: /إعداد المبيعات/ })).toBeVisible();
    await page.getByRole("link", { name: /اربط معرضك/ }).first().click();
    await page.waitForURL(/\/home\/showroom/, { waitUntil: "commit" });
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1, name: /اربط معرضك/ })).toBeVisible();
    await expect(page.getByText(/لا تجد معرضك؟/)).toBeVisible();
    const searchText = (await page.locator("main").innerText()).replace(/\d|%|·/g, "");
    expect(searchText).not.toMatch(/[A-Za-z]{4,}/);
    await noOverflow(page);

    // The referral form, in Arabic.
    await page.getByRole("link", { name: /أضف معرضًا/ }).click();
    await page.waitForURL(/\/home\/showroom\/refer/, { waitUntil: "commit" });
    await expect(page.getByText(/أنت تخبرنا عن جهة عملك/)).toBeVisible();
    await expect(page.getByText(/وليس كمالك له/)).toBeVisible();
    await noOverflow(page);

    // --- Engineer ---
    await page.context().clearCookies();
    await prefs(page, "ar");
    await registerProfessional(
      page,
      request,
      "مهندس تجريبي",
      /^مهندس /,
      "مهندس إنشائي، القاهرة",
      { specialization: /^إنشائي$/, service: /^تصميم إنشائي$/ },
    );
    await expect(page.getByRole("heading", { name: /نشاطك المهني/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /حسابك/ }).first()).toBeVisible();
    const engineerText = (await page.locator("main").innerText()).replace(/\d|%|·|km|كم/g, "");
    expect(engineerText).not.toMatch(/[A-Za-z]{4,}/);
    await noOverflow(page);
  });

  /* ===== Locale switching updates every visible string on a changed page ==== */
  test("9 — switching locale on the personal home re-renders all copy", async ({ page, request }) => {
    await prefs(page, "en");
    await registerSalesperson(page, request, "Locale Switch Tester", "Showroom sales");
    await expect(page.getByRole("heading", { name: /your sales setup/i })).toBeVisible();

    await page.getByRole("button", { name: /العربية|arabic/i }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { name: /إعداد المبيعات/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /your sales setup/i })).toHaveCount(0);
  });
});
