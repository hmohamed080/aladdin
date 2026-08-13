import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { messageIdsFor, readNewOtp, signIn } from "./helpers/auth";
import { en } from "../src/lib/i18n/messages/en";
import { ar } from "../src/lib/i18n/messages/ar";

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

/**
 * An exact matcher for one label, in either locale. Built from the shipped
 * catalogues: hand-transcribed Arabic drifts invisibly (a missing shadda reads
 * identically and fails as a timeout), and a renamed label should fail at
 * typecheck rather than pass against copy nobody ships.
 */
const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const label = (pick: (m: typeof en) => string) =>
  new RegExp(`^(?:${esc(pick(en))}|${esc(pick(ar as unknown as typeof en))})$`, "i");
/** Same, but matching anywhere in the accessible name (label + description cards). */
const labelIn = (pick: (m: typeof en) => string) =>
  new RegExp(`(?:${esc(pick(en))}|${esc(pick(ar as unknown as typeof en))})`, "i");

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
  await page.getByLabel(labelIn((m) => m.auth.emailLabel)).fill(email);
  await page.getByLabel(labelIn((m) => m.auth.consent.terms)).check();
  await page.getByLabel(labelIn((m) => m.auth.consent.privacy)).check();
  await page.getByLabel(labelIn((m) => m.auth.consent.pilot)).check();
  await page.getByRole("button", { name: label((m) => m.auth.createAccount) }).click();
  await expect(page.getByText(labelIn((m) => m.auth.info.codeSent.split("{")[0]!.trim()))).toBeVisible();
  const code = await readNewOtp(request, email, seen);
  await page.getByLabel(labelIn((m) => m.auth.codeLabel)).fill(code);
  await page.getByRole("button", { name: label((m) => m.auth.verify) }).click();
  await page.waitForURL(/\/onboarding\/profile$/, { waitUntil: "commit" });

  await page.locator("#displayName").fill(displayName);
  await page.getByRole("button", { name: label((m) => m.onboarding.continue) }).click();
  await page.waitForURL(/\/onboarding\/contact$/, { waitUntil: "commit" });
  await page.locator("#phone").fill("01012345678");
  await page.getByRole("button", { name: label((m) => m.onboarding.continue) }).click();
  await page.waitForURL(/\/onboarding\/account-type$/, { waitUntil: "commit" });
  return email;
}

async function pickType(page: Page, card: RegExp, landing: RegExp) {
  await page.getByRole("button", { name: card }).click();
  await page.getByRole("button", { name: label((m) => m.onboarding.continue) }).click();
  await page.waitForURL(landing, { waitUntil: "commit" });
}

/** Fresh Consumer, all the way to a usable /home. */
async function registerConsumer(page: Page, request: APIRequestContext, name: string) {
  const email = await toAccountType(page, request, name);
  await pickType(page, labelIn((m) => m.onboarding.accountType.types.end_consumer), /\/onboarding\/consumer$/);
  await page.getByRole("button", { name: label((m) => m.onboarding.consumer.intents.planning) }).click();
  await page.getByRole("button", { name: label((m) => m.onboarding.continue) }).click();
  await page.getByRole("button", { name: label((m) => m.onboarding.consumer.interests.flooring) }).click();
  await page.getByRole("button", { name: label((m) => m.onboarding.continue) }).click();
  await page.locator("#gov").selectOption("cairo");
  await page.locator("#city").selectOption("new_cairo");
  await page.getByRole("button", { name: label((m) => m.onboarding.continue) }).click();
  await page.getByRole("button", { name: label((m) => m.onboarding.continue) }).click(); // budget (optional)
  await page.getByRole("button", { name: label((m) => m.onboarding.consumer.review.finish) }).click();
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
  await page.getByRole("button", { name: label((m) => m.onboarding.continue) }).click();
  await page.getByRole("button", { name: opts.service }).click();
  await page.getByRole("button", { name: label((m) => m.onboarding.continue) }).click();
  // Remote-only keeps the flow short and is a valid professional shape.
  await page.getByRole("checkbox", { name: labelIn((m) => m.onboarding.professional.location.remoteLabel) }).check();
  await page.getByRole("button", { name: label((m) => m.onboarding.continue) }).click();
  await page.getByRole("button", { name: label((m) => m.onboarding.continue) }).click();
  await page.getByRole("button", { name: label((m) => m.onboarding.professional.toReview) }).click();
  await page.waitForURL(/\/onboarding\/professional\/review$/, { waitUntil: "commit" });
  await page.getByRole("button", { name: label((m) => m.onboarding.professional.review.submit) }).click();
  await page.waitForURL(/\/home$/, { waitUntil: "commit" });
  return email;
}

const registerSalesperson = (page: Page, request: APIRequestContext, name: string, headline: string) =>
  registerProfessional(page, request, name, labelIn((m) => m.onboarding.accountType.types.salesperson), headline, {
    specialization: label((m) => m.onboarding.professional.specializations.showroom_sales),
    service: label((m) => m.onboarding.professional.serviceItems.showroom_advice),
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
      labelIn((m) => m.onboarding.accountType.types.engineer),
      "Structural engineer, Cairo",
      { specialization: label((m) => m.onboarding.professional.specializations.structural), service: label((m) => m.onboarding.professional.serviceItems.structural_design) },
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
    // A unique display name keeps this journey self-isolating: a retry (or a
    // previous run) leaves a real request in the showroom's queue, and scoping the
    // owner's decision to THIS person's card is what makes the assertions mean what
    // they say instead of matching whichever card happens to be first.
    const name = `Sales Joins ${Date.now()}`;
    const email = await registerSalesperson(page, request, name, "Ceramics sales");

    // --- request ---
    await page.getByRole("link", { name: /connect your showroom/i }).first().click();
    await page.waitForURL(/\/home\/showroom/, { waitUntil: "commit" });
    await page.locator("#q").fill("ceramics");
    await page.getByRole("button", { name: /^search$/i }).click();
    await page.getByRole("link", { name: /cairo ceramics showroom/i }).first().click();
    await expect(page.getByRole("heading", { name: /cairo ceramics showroom/i })).toBeVisible();
    await page.getByRole("button", { name: /request to join/i }).click();
    await page.waitForURL(/connected=pending/, { waitUntil: "commit" });

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
    const declineCard = page.getByRole("listitem").filter({ hasText: name });
    await expect(declineCard).toBeVisible();
    await declineCard.getByLabel(/reason for declining/i).fill("Please ask your branch manager first");
    await declineCard.getByRole("button", { name: /^decline$/i }).click();
    await page.waitForURL(/decided=1/, { waitUntil: "commit" });

    // The salesperson's personal account is untouched, and the reason is visible.
    await page.context().clearCookies();
    await prefs(page, "en");
    await signIn(page, request, email, /\/home$/);
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`welcome, ${name}`, "i") })).toBeVisible();
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
    await page.waitForURL(/connected=pending/, { waitUntil: "commit" });
    await expect(page.getByText(/connection pending/i)).toBeVisible();

    await page.context().clearCookies();
    await prefs(page, "en");
    await signIn(page, request, OWNER, /\/b2b(\/|$)/);
    await page.goto("/b2b/organization");
    const approveCard = page.getByRole("listitem").filter({ hasText: name });
    await approveCard.getByRole("button", { name: /approve and add to team/i }).click();
    await page.waitForURL(/joined=1/, { waitUntil: "commit" });
    // They are on the MEMBERS roster now, as an active member. Scoped to that
    // section: their name also appears in the collapsed decided-requests history
    // above it, which is in the DOM but deliberately not visible.
    const roster = page.locator("section").filter({ has: page.getByRole("heading", { name: /^Members/ }) });
    await expect(roster.getByText(name)).toBeVisible();
    await expect(roster.getByText(/^active$/i).first()).toBeVisible();

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
    const referrer = `Sales Refers ${Date.now()}`;
    const email = await registerSalesperson(page, request, referrer, "Tiles sales");
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
    await page.waitForURL(/connected=submitted/, { waitUntil: "commit" });

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
    const card = page.getByRole("listitem").filter({ hasText: showroom });
    await expect(card).toBeVisible();
    // The referring salesperson is named on the card — the attribution a future
    // rewards feature reads — alongside the supplied business/location data.
    await expect(card.getByText(/referred by/i)).toBeVisible();
    await expect(card.getByText(referrer)).toBeVisible();
    await expect(card.getByText(/sheikh zayed/i)).toBeVisible();

    await card.getByRole("button", { name: /approve as a new business/i }).click();
    await page.waitForURL(/referral=approved/, { waitUntil: "commit" });

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
    // The Personal entry's accessible name LEADS with the display name and carries
    // "Personal" as its subtitle, so an anchored match would never hit it.
    await page.getByRole("menuitem").filter({ hasText: /personal/i }).click();
    await page.waitForURL(/\/home$/, { waitUntil: "commit" });
    await page.getByRole("button", { name: label((m) => m.common.signOut) }).click();
    await page.waitForURL(/\/auth\/sign-in/, { waitUntil: "commit" });
    await signIn(page, request, "mostafa@example.test", /\/home$/);
    await expect(page).toHaveURL(/\/home$/);

    // Select the Business → sign out → back in → the Business is restored.
    await switcher(page).click();
    // EXACT accessible name: this fixture's personal display name is
    // "Mostafa (Horizon Contracting Owner)", so a loose match hits both entries.
    // A business entry reads "<org name> <relationship>".
    await page.getByRole("menuitem", { name: "Horizon Contracting Owner", exact: true }).click();
    await page.waitForURL(/\/b2b(\/|$)/, { waitUntil: "commit" });
    await page.getByRole("button", { name: label((m) => m.common.signOut) }).click();
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

    // The switch is labelled "Language" (it toggles to the other locale).
    await page.getByRole("button", { name: /^language$/i }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { name: /إعداد المبيعات/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /your sales setup/i })).toHaveCount(0);
  });
});
