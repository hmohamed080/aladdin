import { expect, test, type Locator, type Page } from "@playwright/test";
import { psql } from "./global-setup";
import { signIn } from "./helpers/auth";
import { INSTALLER, INSTALLER_ID, POSTER, cleanupE2eJobs, expectNoHorizontalOverflow, openFilters, psqlValue, seedAssignments, seedOpenJob, unique, setLocale } from "./helpers/jobs-work";

/**
 * Batch 1B — dropdown / overlay regression for the shared FloatingMenu and Listbox surfaces.
 *
 * Every representative menu is opened the way a person does and must: appear, stay fully inside the viewport (no
 * clipping by its filter panel or card), never create horizontal page scroll, move between items with the arrow keys,
 * close on Escape and hand focus back to the control that opened it. Behaviour, not pixels: nothing here compares
 * screenshots.
 */

test.afterAll(() => cleanupE2eJobs());

type MenuUnderTest = {
  page: Page;
  /** The control that opens the menu. */
  trigger: Locator;
  /** The popup surface (listbox / menu). */
  popup: Locator;
  /** The roving items inside it. */
  items: Locator;
};

/** Open a menu and prove the behaviour every shared menu promises. */
async function exerciseMenu({ page, trigger, popup, items }: MenuUnderTest) {
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await expect(popup).toBeVisible();

  // Inside the viewport, not clipped, and the page does not scroll sideways.
  const viewport = page.viewportSize()!;
  const box = (await popup.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  await expectNoHorizontalOverflow(page);

  // Keyboard: arrows move between items, Home / End jump, and focus stays inside the popup.
  const count = await items.count();
  expect(count).toBeGreaterThan(0);
  if (count > 1) {
    await page.keyboard.press("Home");
    const first = await items.first().evaluate((el) => el === document.activeElement);
    expect(first).toBe(true);
    await page.keyboard.press("ArrowDown");
    expect(await items.nth(1).evaluate((el) => el === document.activeElement)).toBe(true);
    await page.keyboard.press("End");
    expect(await items.last().evaluate((el) => el === document.activeElement)).toBe(true);
  }

  // Escape closes and focus returns to the trigger.
  await page.keyboard.press("Escape");
  await expect(popup).toBeHidden();
  await expect(trigger).toBeFocused();
  await expectNoHorizontalOverflow(page);
}

test.describe("overlays on the installer surfaces", () => {
  test.beforeEach(async ({ page, request }) => {
    await setLocale(page, "en");
    await signIn(page, request, INSTALLER, /\/home$/);
  });

  test("dashboard: the sort-by-date menu", async ({ page }) => {
    await page.goto("/home");
    await exerciseMenu({
      page,
      trigger: page.getByRole("button", { name: "Sort by date" }),
      popup: page.getByRole("menu", { name: "Sort by date" }),
      items: page.getByRole("menu", { name: "Sort by date" }).getByRole("menuitemradio"),
    });
  });

  test("jobs board: Governorate (scrolls inside itself), City, Duration and My applications", async ({ page }) => {
    const tag = unique();
    seedOpenJob({ title: `${tag} overlay`, amount: 2000 });
    await page.goto(`/home/jobs?q=${tag}`);
    await expect(page.getByTestId("job-card")).toHaveCount(1);
    await openFilters(page);

    const governorate = page.getByRole("button", { name: /^Governorate/ });
    const governorateList = page.getByRole("listbox", { name: "Governorate" });
    await exerciseMenu({ page, trigger: governorate, popup: governorateList, items: governorateList.getByRole("option") });

    // The long list scrolls INSIDE the popup — the popup never grows past the viewport or the filter panel.
    await governorate.click();
    const { scrollable, panelHeight } = await governorateList.evaluate((el) => ({ scrollable: el.scrollHeight > el.clientHeight, panelHeight: el.getBoundingClientRect().height }));
    expect(scrollable).toBe(true);
    expect(panelHeight).toBeLessThanOrEqual(page.viewportSize()!.height);
    await page.getByRole("option", { name: "Cairo", exact: true }).click();
    await expect(page).toHaveURL(/gov=cairo/);

    const city = page.getByRole("button", { name: /^City/ });
    const cityList = page.getByRole("listbox", { name: "City" });
    await exerciseMenu({ page, trigger: city, popup: cityList, items: cityList.getByRole("option") });

    const duration = page.getByRole("button", { name: /^Duration/ });
    const durationList = page.getByRole("listbox", { name: "Duration" });
    await exerciseMenu({ page, trigger: duration, popup: durationList, items: durationList.getByRole("option") });

    const applications = page.getByRole("button", { name: /^My applications/ });
    const applicationsList = page.getByRole("listbox", { name: "My applications" });
    await exerciseMenu({ page, trigger: applications, popup: applicationsList, items: applicationsList.getByRole("option") });
  });

  test("jobs board: the Overall Match breakdown popover", async ({ page }) => {
    const tag = unique();
    seedOpenJob({ title: `${tag} match`, amount: 2000, trade: "hvac" });
    await page.goto(`/home/jobs?q=${tag}`);
    const badge = page.getByTestId("job-card").getByTestId("match-badge");
    await badge.click();
    const popup = page.getByTestId("match-breakdown");
    await expect(popup).toBeVisible();
    const box = (await popup.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    await expectNoHorizontalOverflow(page);
    await page.keyboard.press("Escape");
    await expect(popup).toBeHidden();
    await expect(badge).toBeFocused();
  });

  test("my work: Sort, Saved searches and the row three-dot menu", async ({ page, isMobile }) => {
    const tag = unique();
    seedAssignments({ tag, count: 2, state: "in_progress" });
    const name = `E2E overlay ${tag}`;
    psql(`
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"${INSTALLER_ID}","role":"authenticated"}';
select public.saved_search_create('work', '${name}', '{"q":"${tag}"}'::jsonb);
commit;
`);
    try {
      await page.goto(`/home/work?q=${tag}`);
      await expect(page.getByRole("heading", { level: 1, name: "My work" })).toBeVisible();
      await expect(page.locator('section[aria-labelledby="all-work-title"]').getByRole("listitem")).toHaveCount(2);

      const sortList = page.getByRole("listbox", { name: "Sort" });
      await exerciseMenu({ page, trigger: page.getByRole("button", { name: /^Sort/ }), popup: sortList, items: sortList.getByRole("option") });

      // Saved searches live in the filters sheet on phones.
      if (isMobile) await page.getByRole("button", { name: "All filters" }).click();
      const saved = (isMobile ? page.getByRole("dialog", { name: "Filters" }) : page).getByRole("button", { name: /^Saved searches/ });
      const savedList = page.getByRole("listbox", { name: "Saved searches" });
      await saved.click();
      await expect(savedList).toBeVisible();
      const box = (await savedList.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
      await expect(savedList.getByRole("option", { name })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(savedList).toBeHidden();
      await expect(saved).toBeFocused();
      if (isMobile) await page.getByRole("button", { name: "Close filters" }).click();

      // The row menu.
      const trigger = page.locator('section[aria-labelledby="all-work-title"]').getByRole("button", { name: "More actions" }).first();
      const menu = page.getByRole("menu", { name: "Work actions" });
      await exerciseMenu({ page, trigger, popup: menu, items: menu.getByRole("menuitem") });
    } finally {
      psql(`delete from public.saved_searches where user_id = '${INSTALLER_ID}' and name = '${name}';`);
    }
    expect(psqlValue(`select count(*) from public.saved_searches where name = '${name}';`)).toBe("0");
  });

  test("settings: the phone country picker", async ({ page }) => {
    await page.goto("/home/settings");
    const trigger = page.getByRole("button", { name: "Country" }).first();
    const list = page.getByRole("listbox", { name: "Country" });
    await trigger.click();
    await expect(list).toBeVisible();
    const box = (await list.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    await expectNoHorizontalOverflow(page);
    // Search is focused first; the arrow keys move into the options, and Escape hands focus back.
    await expect(page.getByRole("searchbox", { name: "Search country" }).or(page.getByPlaceholder(/search/i)).first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    expect(await list.getByRole("option").first().evaluate((el) => el === document.activeElement)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test.describe("overlays outside the installer surfaces (shared Select / Listbox)", () => {
  test("poster job form: Trade and Governorate keep the same behaviour", async ({ page, request }) => {
    await setLocale(page, "en");
    await signIn(page, request, POSTER, /\/(home|b2b)/);
    await page.goto("/b2b/jobs/new");
    const trade = page.getByRole("button", { name: /^Trade/ });
    const tradeList = page.getByRole("listbox", { name: "Trade" });
    await exerciseMenu({ page, trigger: trade, popup: tradeList, items: tradeList.getByRole("option") });
    const governorate = page.getByRole("button", { name: /^Governorate/ });
    const governorateList = page.getByRole("listbox", { name: "Governorate" });
    await exerciseMenu({ page, trigger: governorate, popup: governorateList, items: governorateList.getByRole("option") });
  });
});
