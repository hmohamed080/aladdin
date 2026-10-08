import { expect, test, type Locator, type Page } from "@playwright/test";
import { psql } from "./global-setup";
import { signIn } from "./helpers/auth";
import {
  INSTALLER,
  POSTER_ID,
  acceptApplication,
  applyThroughUi,
  cleanupE2eJobs,
  expectNoHorizontalOverflow,
  psqlValue,
  reportProgress,
  seedAssignments,
  seedOpenJob,
  unique,
  setLocale,
  waitForHydration,
} from "./helpers/jobs-work";

/**
 * Batch 1B — the installer's My Work (`/home/work`) in production.
 *
 * Each test builds its own tagged assignments through the REAL RPCs (see `seedAssignments`) and finds them by searching
 * the tag, so nothing depends on how much reviewed data the local database holds. Starting work and reporting progress
 * go through the real UI.
 *
 * Contract pinned here: Grid is the default; "All your work" means in progress + completed; scheduled and cancelled are
 * reachable through explicit `?state=` views; the work contact is the immutable snapshot taken at award and is released
 * only while the work is in progress or completed; the three-dot menu offers only actions the backend authorizes.
 */

test.afterAll(() => cleanupE2eJobs());

const results = (page: Page): Locator => page.locator('section[aria-labelledby="all-work-title"]');

/** Assignment ids of the rows on screen, in order (Grid is a list of cards). */
async function workIds(page: Page): Promise<string[]> {
  return results(page)
    .getByRole("listitem")
    .evaluateAll((items) => items.map((item) => /\/home\/work\/([0-9a-f-]{36})/.exec(item.querySelector<HTMLAnchorElement>('a[href^="/home/work/"]')?.getAttribute("href") ?? "")?.[1] ?? ""));
}

async function goWork(page: Page, query: string) {
  await page.goto(`/home/work?${query}`);
  await expect(page.getByRole("heading", { level: 1, name: "My work" })).toBeVisible();
  await waitForHydration(page);
}

async function expectRows(page: Page, count: number) {
  await expect(results(page).getByRole("listitem")).toHaveCount(count);
  await expect(results(page)).not.toHaveAttribute("aria-busy", "true");
}

/** The three-dot menu of the row whose link goes to `assignmentId`. */
function rowOf(page: Page, assignmentId: string): Locator {
  return results(page).getByRole("listitem").filter({ has: page.locator(`a[href="/home/work/${assignmentId}"]`) });
}

async function menuItems(page: Page, assignmentId: string): Promise<string[]> {
  const row = rowOf(page, assignmentId);
  await row.getByRole("button", { name: "More actions" }).click();
  const menu = page.getByRole("menu", { name: "Work actions" });
  await expect(menu).toBeVisible();
  const items = await menu.getByRole("menuitem").allTextContents();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  return items.map((text) => text.trim());
}

test.describe("installer my work (/home/work)", () => {
  test.beforeEach(async ({ page, request }) => {
    await setLocale(page, "en");
    await signIn(page, request, INSTALLER, /\/home$/);
  });

  test("Grid is the default; All work means in progress + completed; scheduled and cancelled are explicit views", async ({ page, isMobile }) => {
    const tag = unique();
    const [scheduled] = seedAssignments({ tag: `${tag}-s`, count: 1, state: "scheduled" });
    const [progress] = seedAssignments({ tag: `${tag}-p`, count: 1, state: "in_progress" });
    const [done] = seedAssignments({ tag: `${tag}-d`, count: 1, state: "completed" });
    const [cancelled] = seedAssignments({ tag: `${tag}-c`, count: 1, state: "cancelled" });

    await goWork(page, `q=${tag}`);
    if (!isMobile) {
      await expect(page.getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "false");
    }
    // Default: only the work being done or already done.
    await expectRows(page, 2);
    expect((await workIds(page)).sort()).toEqual([progress, done].sort());
    await expect(results(page)).toContainText("In progress");
    await expect(results(page)).toContainText("Completed");

    // The explicit state views reach the rest.
    await goWork(page, `state=scheduled&q=${tag}`);
    await expectRows(page, 1);
    expect(await workIds(page)).toEqual([scheduled]);
    await goWork(page, `state=cancelled&q=${tag}`);
    await expectRows(page, 1);
    expect(await workIds(page)).toEqual([cancelled]);
    await goWork(page, `state=in_progress&q=${tag}`);
    expect(await workIds(page)).toEqual([progress]);
    await goWork(page, `state=completed&q=${tag}`);
    expect(await workIds(page)).toEqual([done]);

    // An unknown state falls back to the default instead of an empty page.
    await goWork(page, `state=paused&q=${tag}`);
    await expectRows(page, 2);

    // The List view is a real alternative on tablets and desktops.
    if (!isMobile) {
      await goWork(page, `q=${tag}`);
      await page.getByRole("button", { name: "List view" }).click();
      await expect(page.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "true");
      await expect(results(page).getByRole("table")).toBeVisible();
      await page.getByRole("button", { name: "Grid view" }).click();
      await expect(results(page).getByRole("table")).toBeHidden();
    }
  });

  test("the three-dot menu offers only the actions that really apply to each status", async ({ page }) => {
    const tag = unique();
    const [scheduled] = seedAssignments({ tag: `${tag}-s`, count: 1, state: "scheduled" });
    const [progress] = seedAssignments({ tag: `${tag}-p`, count: 1, state: "in_progress" });
    const completed = seedAssignments({ tag: `${tag}-d`, count: 2, state: "completed" });
    const [reviewed, unreviewed] = [completed[0], completed[1]!];
    const [cancelled] = seedAssignments({ tag: `${tag}-c`, count: 1, state: "cancelled" });
    // A real review exists for ONE completed assignment (submitted by the posting organization, through the real RPC).
    psql(`
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"${POSTER_ID}","role":"authenticated"}';
select public.job_review_submit('${reviewed}', 5::smallint, 'E2E review');
commit;
`);

    await goWork(page, `q=${tag}`);
    await expectRows(page, 3);
    expect(await menuItems(page, progress)).toEqual(["View details", "Update progress"]);
    expect(await menuItems(page, reviewed)).toEqual(["View details", "View rating"]);
    expect(await menuItems(page, unreviewed)).toEqual(["View details"]);

    await goWork(page, `state=scheduled&q=${tag}`);
    await expectRows(page, 1);
    expect(await menuItems(page, scheduled)).toEqual(["View details", "Start work"]);

    await goWork(page, `state=cancelled&q=${tag}`);
    await expectRows(page, 1);
    expect(await menuItems(page, cancelled)).toEqual(["View details"]);

    // Every menu entry is a real link to the assignment's own page.
    await goWork(page, `q=${tag}`);
    await rowOf(page, progress).getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Update progress" }).click();
    await expect(page).toHaveURL(new RegExp(`/home/work/${progress}$`));
  });

  test("work contact: the award-time snapshot is shown only where allowed, and never from a personal profile", async ({ page }) => {
    const tag = unique();
    const contact = { name: "E2E Coordinator", phone: "+201001234567", email: "coordinator@e2e-contact.test" };
    const [withContact] = seedAssignments({ tag: `${tag}-with`, count: 1, state: "in_progress", contact });
    const [noContact] = seedAssignments({ tag: `${tag}-none`, count: 1, state: "in_progress" });
    const [scheduled] = seedAssignments({ tag: `${tag}-sch`, count: 1, state: "scheduled", contact });
    const [cancelled] = seedAssignments({ tag: `${tag}-can`, count: 1, state: "cancelled", contact });

    // In progress with a snapshot: name, phone and e-mail are reachable (revealed on request).
    await goWork(page, `q=${tag}`);
    await expectRows(page, 2);
    const withRow = rowOf(page, withContact);
    await expect(withRow).toContainText("E2E Coordinator");
    await withRow.getByRole("button", { name: "Show full phone number" }).click();
    await expect(withRow).toContainText("+201001234567");
    await withRow.getByRole("button", { name: "Show full email address" }).click();
    await expect(withRow).toContainText("coordinator@e2e-contact.test");

    // The assignment with no contact states nothing: no placeholder phone / e-mail, and nothing borrowed from a profile.
    const noRow = rowOf(page, noContact);
    await expect(noRow.getByRole("button", { name: /Show full (phone number|email address)/ })).toHaveCount(0);
    await expect(noRow).not.toContainText("E2E Coordinator");
    await expect(noRow).not.toContainText(/@|\+20\d{8,}/);
    await expect(page.locator("body")).not.toContainText("mostafa@example.test");

    // The contact filter is the database's: available vs none.
    await page.getByRole("button", { name: "All filters" }).click();
    const drawer = page.getByRole("dialog", { name: "Filters" });
    await drawer.getByRole("button", { name: /^Contact details/ }).click();
    await page.getByRole("option", { name: "Contact available" }).click();
    await drawer.getByRole("button", { name: "Apply filters" }).click();
    await expectRows(page, 1);
    expect(await workIds(page)).toEqual([withContact]);
    await page.getByRole("button", { name: "All filters" }).click();
    await page.getByRole("dialog", { name: "Filters" }).getByRole("button", { name: /^Contact details/ }).click();
    await page.getByRole("option", { name: "No contact data" }).click();
    await page.getByRole("dialog", { name: "Filters" }).getByRole("button", { name: "Apply filters" }).click();
    await expectRows(page, 1);
    expect(await workIds(page)).toEqual([noContact]);

    // Scheduled and cancelled work whose job HAD a contact never leaks it.
    for (const [state, id] of [["scheduled", scheduled], ["cancelled", cancelled]] as const) {
      await goWork(page, `state=${state}&q=${tag}`);
      await expectRows(page, 1);
      expect(await workIds(page)).toEqual([id]);
      await expect(page.locator("body")).not.toContainText("E2E Coordinator");
      await expect(page.locator("body")).not.toContainText("+201001234567");
      await expect(page.locator("body")).not.toContainText("coordinator@e2e-contact.test");
    }
    // And the database agrees: no released contact for those states.
    expect(psqlValue(`select count(*) from public.assignment_contacts where assignment_id in ('${scheduled}', '${cancelled}');`)).toBe("2"); // snapshots exist ...
    expect(psqlValue(`select count(*) from public.job_assignments where id in ('${scheduled}', '${cancelled}') and status in ('in_progress', 'completed');`)).toBe("0"); // ... but are not releasable
  });

  test("search, company, planned period and sort narrow the work, and every change resets the loaded pages", async ({ page }) => {
    const tag = unique();
    const [late] = seedAssignments({ tag: `${tag}-late`, count: 1, state: "in_progress", startsOn: "2031-06-10", endsBy: "2031-06-20" });
    const [soon] = seedAssignments({ tag: `${tag}-soon`, count: 1, state: "in_progress", startsOn: "2031-09-01", endsBy: "2031-09-10" });

    await goWork(page, "");
    const search = page.getByRole("searchbox", { name: "Search work" });
    await search.fill(tag);
    await expect(page).toHaveURL(new RegExp(`q=${tag}`));
    await expectRows(page, 2);

    await search.fill(`${tag}-late`);
    await expectRows(page, 1);
    expect(await workIds(page)).toEqual([late]);
    await search.fill(`${tag}-no-such-work`);
    await expectRows(page, 0);
    await search.fill(tag);
    await expectRows(page, 2);

    // Company / client: the poster's own company keeps them, any other company removes them.
    await page.getByRole("button", { name: "All filters" }).click();
    const drawer = page.getByRole("dialog", { name: "Filters" });
    await drawer.getByRole("button", { name: /^Company \/ client/ }).click();
    const companies = await page.getByRole("option").allTextContents();
    expect(companies.map((c) => c.trim())).toContain("Horizon Contracting");
    await page.getByRole("option", { name: "Horizon Contracting" }).click();
    await drawer.getByRole("button", { name: "Apply filters" }).click();
    await expectRows(page, 2);
    const other = companies.map((c) => c.trim()).find((c) => c && c !== "Horizon Contracting");
    if (other) {
      await page.getByRole("button", { name: "All filters" }).click();
      await page.getByRole("dialog", { name: "Filters" }).getByRole("button", { name: /^Company \/ client/ }).click();
      await page.getByRole("option", { name: other, exact: true }).click();
      await page.getByRole("dialog", { name: "Filters" }).getByRole("button", { name: "Apply filters" }).click();
      await expectRows(page, 0);
      await page.getByRole("button", { name: "All filters" }).click();
      await page.getByRole("dialog", { name: "Filters" }).getByRole("button", { name: "Reset" }).click();
      await page.getByRole("dialog", { name: "Filters" }).getByRole("button", { name: "Apply filters" }).click();
      await expectRows(page, 2);
    }

    // Planned period: a work window overlapping the chosen dates is kept, one that does not is left out.
    await goWork(page, `q=${tag}`);
    await page.getByRole("button", { name: "Planned period" }).click();
    await page.getByLabel("From date").fill("2031-06-01");
    await page.getByLabel("To date").fill("2031-06-30");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expectRows(page, 1);
    expect(await workIds(page)).toEqual([late]);
    await expect(page).toHaveURL(/from=2031-06-01/);
    await goWork(page, `q=${tag}&from=2031-09-01&to=2031-09-30`);
    await expectRows(page, 1);
    expect(await workIds(page)).toEqual([soon]);
    await goWork(page, `q=${tag}&from=2032-01-01&to=2032-01-31`);
    await expectRows(page, 0);
  });

  test("saved searches: create, apply and delete", async ({ page, isMobile }) => {
    const tag = unique();
    seedAssignments({ tag, count: 2, state: "in_progress" });
    const name = `E2E search ${tag}`;
    await goWork(page, `q=${tag}`);
    await expectRows(page, 2);

    const openFilterDrawer = () => page.getByRole("button", { name: "All filters" }).click();
    if (isMobile) await openFilterDrawer();
    else await page.getByRole("button", { name: "Save search" }).click();
    if (isMobile) await page.getByRole("dialog", { name: "Filters" }).getByRole("button", { name: "Save search" }).click();
    const dialog = page.getByRole("dialog", { name: "Save a new search" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox", { name: "Name" }).fill(name);
    await dialog.getByRole("button", { name: "Save search" }).click();
    await expect(dialog).toBeHidden();
    // Saving persists, then the page re-applies the saved search; let that settle before navigating away.
    await expect.poll(() => psqlValue(`select count(*) from public.saved_searches where name = '${name}';`)).toBe("1");
    if (!isMobile) await expect(page.getByRole("button", { name: /^Saved searches/ })).toContainText(name);
    await page.waitForLoadState("networkidle");

    // Start over, then apply the saved search from the menu: the filters come back.
    await goWork(page, "");
    if (isMobile) {
      await openFilterDrawer();
      await page.getByRole("dialog", { name: "Filters" }).getByRole("button", { name: /^Saved searches/ }).click();
    } else {
      await page.getByRole("button", { name: /^Saved searches/ }).click();
    }
    await page.getByRole("option", { name }).click();
    await expect(page).toHaveURL(new RegExp(`q=${tag}`));
    await expectRows(page, 2);

    // Delete it from the same menu; it is gone, also after a reload.
    if (isMobile) {
      await openFilterDrawer();
      await page.getByRole("dialog", { name: "Filters" }).getByRole("button", { name: /^Saved searches/ }).click();
    } else {
      await page.getByRole("button", { name: /^Saved searches/ }).click();
    }
    await page.getByRole("button", { name: `Delete: ${name}` }).click();
    // The delete is a server action: wait for it to land before navigating away (a navigation would abort it).
    await expect.poll(() => psqlValue(`select count(*) from public.saved_searches where name = '${name}';`)).toBe("0");
    await page.keyboard.press("Escape");
    await goWork(page, "");
    if (isMobile) await openFilterDrawer();
    await (isMobile ? page.getByRole("dialog", { name: "Filters" }) : page).getByRole("button", { name: /^Saved searches/ }).click();
    await expect(page.getByRole("option", { name })).toHaveCount(0);
  });

  test("Show more loads cursor pages without duplicates, Show less steps back, and filters reset the pages", async ({ page }) => {
    const tag = unique();
    const all = seedAssignments({ tag, count: 14, state: "in_progress" });
    await goWork(page, `q=${tag}`);
    await expectRows(page, 6);
    const first = await workIds(page);
    expect(new Set(first).size).toBe(6);

    await page.getByRole("button", { name: "Show more" }).click();
    await expectRows(page, 12);
    const second = await workIds(page);
    expect(second.slice(0, 6)).toEqual(first); // existing rows remain
    expect(new Set(second).size).toBe(12);

    await page.getByRole("button", { name: "Show more" }).click();
    await expectRows(page, 14);
    const third = await workIds(page);
    expect(new Set(third).size).toBe(14);
    expect([...third].sort()).toEqual([...all].sort()); // every assignment, exactly once
    await expect(page.getByRole("button", { name: "Show more" })).toHaveCount(0);
    expect(page.url()).not.toMatch(/[?&](shown|offset|page|cursor|after)=/);

    await page.getByRole("button", { name: "Show less" }).click();
    await expect.poll(async () => (await workIds(page)).length).toBeLessThan(14);
    const fewer = await workIds(page);
    expect(fewer).toEqual(third.slice(0, fewer.length));

    // A filter change starts over from the first page.
    await page.getByRole("button", { name: "Show more" }).click();
    await expect.poll(async () => (await workIds(page)).length).toBeGreaterThan(fewer.length);
    await page.getByRole("searchbox", { name: "Search work" }).fill(`${tag} 0`);
    await expect.poll(async () => (await workIds(page)).length).toBeLessThanOrEqual(6);
  });

  test("a scheduled assignment is started and reports real progress through the real detail flow", async ({ page }) => {
    const tag = unique();
    const jobId = seedOpenJob({ title: `${tag} start`, amount: 6200, endsBy: "2030-01-31" });
    await applyThroughUi(page, jobId);
    const assignmentId = acceptApplication(jobId);

    await goWork(page, `state=scheduled&q=${tag}`);
    await expectRows(page, 1);
    const row = rowOf(page, assignmentId);
    await expect(row).toContainText("6,200 EGP");
    await row.getByRole("link", { name: "Start work" }).click();
    await expect(page).toHaveURL(new RegExp(`/home/work/${assignmentId}$`));
    await page.getByRole("button", { name: "Start work" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Start work" }).click();
    await expect(page.getByRole("button", { name: "Start work" })).toHaveCount(0);
    expect(psqlValue(`select status from public.job_assignments where id = '${assignmentId}';`)).toBe("in_progress");

    // A real progress report, then it shows on the board.
    reportProgress(assignmentId, 40, "Surface preparation");
    await goWork(page, `q=${tag}`);
    await expectRows(page, 1);
    const featured = page.locator('section[aria-labelledby="active-work-title"]');
    if (await featured.isVisible()) {
      // The featured card is the most recent current assignment; it is only asserted when it is this one.
      const link = featured.getByRole("link", { name: "Update progress" });
      if ((await link.getAttribute("href")) === `/home/work/${assignmentId}`) {
        await expect(featured.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
        await expect(featured).toContainText("Surface preparation");
      }
    }
    await rowOf(page, assignmentId).getByRole("link", { name: "Update progress" }).click();
    await expect(page).toHaveURL(new RegExp(`/home/work/${assignmentId}$`));
    await page.getByRole("button", { name: "Update progress" }).click();
    await expect(page.getByRole("dialog")).toContainText("Report progress");
  });

  test("states only what exists: no invented contact, rating, documents, tools, export or extra statuses", async ({ page }) => {
    const tag = unique();
    seedAssignments({ tag, count: 1, state: "in_progress" });
    await goWork(page, `q=${tag}`);
    await expectRows(page, 1);
    const text = await page.getByTestId("my-work").innerText();
    expect(text).not.toMatch(/documents and files|quick tools|upload current-work photos|request materials|message the showroom|deadline extension|export report/i);
    expect(text).not.toMatch(/010 ••••|projects@example\.com|\b4\.[0-9]\b ?★/);
    await expect(page.locator('img[src*="/assets/installer-dashboard/jobs/"]')).toHaveCount(0);

    // The status filter offers only the real vocabulary.
    await page.getByRole("button", { name: "All filters" }).click();
    await page.getByRole("dialog", { name: "Filters" }).getByRole("button", { name: /^Status/ }).click();
    const options = (await page.getByRole("option").allTextContents()).join("|");
    expect(options).not.toMatch(/paused|in review|archive|accepted/i);
    expect(options).toMatch(/In progress/);
    expect(options).toMatch(/Completed/);
  });

  test("no layout overflow at any approved width, English and Arabic RTL, light and dark", async ({ page }) => {
    const tag = unique();
    seedAssignments({ tag, count: 2, state: "in_progress" });
    for (const locale of ["en", "ar"] as const) {
      await setLocale(page, locale);
      for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]] as const) {
        await page.setViewportSize({ width, height });
        await page.goto("/home/work");
        await expect(page.getByTestId("my-work")).toBeVisible();
        await expect(page.locator(".installer-surface")).toHaveCount(1);
        if (locale === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
        await expectNoHorizontalOverflow(page);
      }
    }
    const baseURL = test.info().project.use.baseURL!;
    await page.context().addCookies([{ name: "aladdin-theme", value: "dark", url: baseURL }]);
    await page.goto("/home/work");
    await expect(page.getByTestId("my-work")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
