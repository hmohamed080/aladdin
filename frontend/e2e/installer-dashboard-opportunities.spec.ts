import { expect, test, type Locator, type Page } from "@playwright/test";
import { signIn } from "./helpers/auth";
import {
  INSTALLER,
  applyThroughUi,
  cleanupE2eJobs,
  expectNoHorizontalOverflow,
  psqlValue,
  seedOpenJob,
  unique,
  setLocale,
  waitForHydration,
} from "./helpers/jobs-work";

/**
 * Batch 1B — the installer dashboard (`/home`) "Opportunities for you" strip and the approved section order.
 *
 * Arabic is the installer's own language, so this runs in Arabic RTL. The strip is the real one: the quick filters ask
 * the database for the ordering, the heart is the real saved-jobs state, and "قدّم الآن" never submits by itself — it
 * leads to the opening's confirmation. Nothing here asserts a fixture-specific count or title: each test publishes its
 * own `E2E-…` opening, sorts the strip to Newest (so that opening is the first card) and works with that card.
 */

test.afterAll(() => cleanupE2eJobs());

const NEWEST = "الأحدث";

/** Choose "الأحدث" in the date-sort menu so the strip shows the most recently published openings first. */
async function chooseNewest(page: Page) {
  await page.getByRole("button", { name: "ترتيب حسب التاريخ" }).click();
  await page.getByRole("menuitemradio", { name: NEWEST }).click();
  await expect(page.getByRole("button", { name: "ترتيب حسب التاريخ" })).toBeVisible();
}

/** The dashboard card that links to `jobId`. */
const cardFor = (page: Page, jobId: string): Locator =>
  page.getByRole("listitem").filter({ has: page.locator(`a[href="/home/jobs/${jobId}"]`) });

test.describe("installer dashboard — opportunities and section order", () => {
  test.beforeEach(async ({ page, request }) => {
    await setLocale(page, "ar");
    await signIn(page, request, INSTALLER, /\/home$/);
  });

  test("loads the approved installer shell with the opportunities heading, quick filters and the approved section order", async ({ page }) => {
    await expect(page.getByTestId("installer-home")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator(".installer-surface")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 2, name: "فرص مناسبة لي" })).toBeVisible();

    // The three quick filters; skills match is the default.
    await expect(page.getByRole("button", { name: "قريب مني" })).toBeVisible();
    await expect(page.getByRole("button", { name: "مناسب لمهاراتي" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "ترتيب حسب التاريخ" }).click();
    await expect(page.getByRole("menuitemradio", { name: NEWEST })).toBeVisible();
    await page.keyboard.press("Escape");

    // The section order, top to bottom.
    const headings = (await page.getByTestId("installer-home").getByRole("heading", { level: 2 }).allTextContents()).map((h) => h.trim());
    const at = (text: RegExp) => headings.findIndex((h) => text.test(h));
    const order = [at(/^فرص مناسبة لي$/), at(/^نقاطي ومكافآتي$/), at(/^تعلم وتدري?ب$/), at(/^من المصانع والعلامات التجارية$/), at(/^أعمال تحتاج إجراء$/)];
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    await expectNoHorizontalOverflow(page);
  });

  test("a card offers exactly two actions, and Apply now enters the real confirmation without submitting", async ({ page }) => {
    const tag = unique();
    const jobId = seedOpenJob({ title: `${tag} dash`, amount: 4200, trade: "hvac" });
    await page.goto("/home");
    await chooseNewest(page);

    const card = cardFor(page, jobId);
    await expect(card).toBeVisible();
    await expect(card.getByRole("link", { name: "تفاصيل" })).toHaveAttribute("href", `/home/jobs/${jobId}`);
    await expect(card.getByRole("link", { name: "قدّم الآن" })).toHaveAttribute("href", `/home/jobs/${jobId}?apply=1`);
    // Two actions: no local one-tap apply button hides on the card.
    await expect(card.getByRole("button", { name: /قدّم|تقديم|apply/i })).toHaveCount(0);

    await card.getByRole("link", { name: "قدّم الآن" }).click();
    await expect(page).toHaveURL(new RegExp(`/home/jobs/${jobId}\\?apply=1$`));
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Opening the confirmation did not apply.
    expect(psqlValue(`select count(*) from public.job_applications where job_id = '${jobId}';`)).toBe("0");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(psqlValue(`select count(*) from public.job_applications where job_id = '${jobId}';`)).toBe("0");
  });

  test("an opening the installer already applied to is shown honestly as applied, with no Apply now", async ({ page }) => {
    const tag = unique();
    const jobId = seedOpenJob({ title: `${tag} applied`, amount: 4300, trade: "hvac" });
    await applyThroughUi(page, jobId);

    await page.goto("/home");
    await chooseNewest(page);
    const card = cardFor(page, jobId);
    await expect(card).toBeVisible();
    await expect(card).toContainText("تقدّمت لها");
    await expect(card.getByRole("link", { name: "قدّم الآن" })).toHaveCount(0);
    await expect(card.getByRole("link", { name: "تفاصيل" })).toBeVisible();
  });

  test("the heart is the real saved state: it saves, persists after a reload and unsaves", async ({ page }) => {
    const tag = unique();
    const jobId = seedOpenJob({ title: `${tag} heart`, amount: 4400, trade: "hvac" });
    const savedCount = () => psqlValue(`select count(*) from public.saved_jobs where job_id = '${jobId}';`);

    await page.goto("/home");
    await chooseNewest(page);
    await cardFor(page, jobId).getByRole("button", { name: "حفظ الفرصة" }).click();
    await expect(cardFor(page, jobId).getByRole("button", { name: "إزالة من الفرص المحفوظة" })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(savedCount).toBe("1");

    // After a reload the database still says saved.
    await page.reload();
    await chooseNewest(page);
    await expect(cardFor(page, jobId).getByRole("button", { name: "إزالة من الفرص المحفوظة" })).toHaveAttribute("aria-pressed", "true");

    // Unsave.
    await cardFor(page, jobId).getByRole("button", { name: "إزالة من الفرص المحفوظة" }).click();
    await expect(cardFor(page, jobId).getByRole("button", { name: "حفظ الفرصة" })).toHaveAttribute("aria-pressed", "false");
    await expect.poll(savedCount).toBe("0");
    await page.reload();
    await chooseNewest(page);
    await expect(cardFor(page, jobId).getByRole("button", { name: "حفظ الفرصة" })).toHaveAttribute("aria-pressed", "false");
  });

  test("the quick filters can each be chosen, and Newest / Oldest order the strip by publication time", async ({ page }) => {
    // The smallest deterministic fixture, independent of how many other openings exist: two openings older than any
    // real one and two newer than any real one, so they are the first cards of Oldest and of Newest on ANY database.
    const tag = unique();
    const old1 = seedOpenJob({ title: `${tag} oldest-1`, amount: 1000, trade: "hvac", publishedAtIso: "2001-01-01T00:00:00Z" });
    const old2 = seedOpenJob({ title: `${tag} oldest-2`, amount: 1000, trade: "hvac", publishedAtIso: "2001-01-02T00:00:00Z" });
    const new1 = seedOpenJob({ title: `${tag} newest-1`, amount: 1000, trade: "hvac", publishedAtIso: "2098-01-01T00:00:00Z" });
    const new2 = seedOpenJob({ title: `${tag} newest-2`, amount: 1000, trade: "hvac", publishedAtIso: "2099-01-01T00:00:00Z" });
    const stripIds = async () =>
      page
        .getByRole("listitem")
        .filter({ has: page.locator('a[href^="/home/jobs/"]') })
        .evaluateAll((items) => items.map((item) => /\/home\/jobs\/([0-9a-f-]{36})/.exec(item.querySelector<HTMLAnchorElement>('a[href^="/home/jobs/"]')?.getAttribute("href") ?? "")?.[1] ?? ""));
    try {
      await page.goto("/home");
      await waitForHydration(page);

      // Near me and skills match can each be chosen (their ordering is covered by the database tests).
      await page.getByRole("button", { name: "قريب مني" }).click();
      await expect(page.getByRole("button", { name: "قريب مني" })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "مناسب لمهاراتي" }).click();
      await expect(page.getByRole("button", { name: "مناسب لمهاراتي" })).toHaveAttribute("aria-pressed", "true");

      // Newest: the most recently published first.
      await chooseNewest(page);
      await expect.poll(async () => (await stripIds()).slice(0, 2)).toEqual([new2, new1]);

      // Oldest: the oldest published first.
      await page.getByRole("button", { name: "ترتيب حسب التاريخ" }).click();
      await page.getByRole("menuitemradio", { name: "الأقدم" }).click();
      await expect.poll(async () => (await stripIds()).slice(0, 2)).toEqual([old1, old2]);

      // And back: Newest restores newest-first.
      await chooseNewest(page);
      await expect.poll(async () => (await stripIds()).slice(0, 2)).toEqual([new2, new1]);
    } finally {
      cleanupE2eJobs();
    }
  });
});
