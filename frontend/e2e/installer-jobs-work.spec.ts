import { expect, test, type Page } from "@playwright/test";
import { psql } from "./global-setup";
import { signIn } from "./helpers/auth";
import {
  INSTALLER,
  POSTER_ID,
  UNVERIFIED_ORG,
  applyThroughUi,
  cardIds,
  cleanupE2eJobs,
  expectNoHorizontalOverflow,
  openFilters,
  psqlValue,
  publishedAt,
  seedOpenJob,
  unique,
  setLocale,
  waitForHydration,
} from "./helpers/jobs-work";

/**
 * Batch 1B — the installer Jobs board (`/home/jobs`) and the opportunity page (`/home/jobs/[id]`) in production.
 *
 * Signs in through the REAL password flow as the seeded craftsman. Every test seeds its OWN uniquely-tagged openings
 * (`E2E-…`) in the LOCAL test database and finds them by searching that tag, so nothing depends on how many other jobs
 * the reviewed database holds. Applying, saving and every other installer action goes through the real UI; the only
 * database-side steps are the ones an installer cannot take (publishing an opening, an organization editing it).
 *
 * The board contract these tests pin: Grid is the default; the URL is the question (`q`, `trade`, `gov`, `city`,
 * `applied`, `saved`, `min`, `max`, `duration`, `sort`) and NEVER how far down the list the viewer is; paging is by
 * keyset cursor ("View more opportunities" appends, filters or sort reset it); Newest is `published_at DESC, id DESC`.
 */

test.afterAll(() => cleanupE2eJobs());

/** The discoverable jobs of a tag in the order the database defines for Newest — the independent oracle. */
function newestOracle(tag: string): string[] {
  return psqlValue(
    `select j.id from public.jobs j join public.organizations o on o.id = j.poster_org_id and o.is_verified and o.deleted_at is null and o.status = 'active'
      where j.status = 'open' and j.title like '${tag}%' order by j.published_at desc, j.id desc;`,
  )
    .split("\n")
    .filter(Boolean);
}

async function searchFor(page: Page, tag: string, extra = "") {
  await page.goto(`/home/jobs?q=${encodeURIComponent(tag)}${extra}`);
  await expect(page.getByRole("heading", { level: 1, name: "Job opportunities" })).toBeVisible();
  await waitForHydration(page);
}

/** Wait for the board to settle on `count` cards (the board is `aria-busy` while a new page is loading). */
async function expectCards(page: Page, count: number) {
  await expect(page.getByTestId("job-card")).toHaveCount(count);
  await expect(page.getByTestId("job-results")).not.toHaveAttribute("aria-busy", "true");
}

async function viewMore(page: Page) {
  const before = await page.getByTestId("job-card").count();
  await page.getByRole("button", { name: "View more opportunities" }).click();
  await expect.poll(() => page.getByTestId("job-card").count()).toBeGreaterThan(before);
}

test.describe("installer job board (/home/jobs)", () => {
  test.beforeEach(async ({ page, request }) => {
    await setLocale(page, "en");
    await signIn(page, request, INSTALLER, /\/home$/);
  });

  test("Grid is the default view and the Grid / List toggle works", async ({ page, isMobile }) => {
    const tag = unique();
    seedOpenJob({ title: `${tag} a`, amount: 2000 });
    seedOpenJob({ title: `${tag} b`, amount: 2100 });
    await searchFor(page, tag);
    await expectCards(page, 2);

    const view = page.getByRole("group", { name: "Opportunity view" });
    if (isMobile) {
      // Phones always use the single-column grid; the toggle is not offered.
      await expect(view).toBeHidden();
      return;
    }
    await expect(view.getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "true");
    await expect(view.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "false");

    await view.getByRole("button", { name: "List view" }).click();
    await expect(view.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "true");
    await expect(view.getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "false");
    await expectCards(page, 2);

    await view.getByRole("button", { name: "Grid view" }).click();
    await expect(view.getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "true");

    // A fresh visit is Grid again — the choice is never a stale default.
    await searchFor(page, tag);
    await expect(page.getByRole("group", { name: "Opportunity view" }).getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "true");
  });

  test("search: English, Arabic and no-result queries, and it never widens what is discoverable", async ({ page }) => {
    const tag = unique();
    const english = seedOpenJob({ title: `${tag} Ceramic bathroom tiling`, amount: 3000 });
    const arabic = seedOpenJob({ title: `${tag} دهان ديكوري للصالة`, amount: 3100 });
    // The same tag on openings that must NEVER be discoverable: a draft, a closed job and an unverified organization's job.
    seedOpenJob({ title: `${tag} hidden draft`, amount: 3200, status: "draft" });
    seedOpenJob({ title: `${tag} hidden closed`, amount: 3300, status: "closed" });
    seedOpenJob({ title: `${tag} hidden unverified`, amount: 3400, posterOrg: UNVERIFIED_ORG });

    // The tag finds exactly the two discoverable openings.
    await searchFor(page, tag);
    await expectCards(page, 2);
    expect((await cardIds(page)).sort()).toEqual([english, arabic].sort());
    await expect(page.getByTestId("job-results")).not.toContainText(/hidden (draft|closed|unverified)/);

    // English term, narrowed.
    await searchFor(page, `${tag} Ceramic`);
    await expectCards(page, 1);
    expect(await cardIds(page)).toEqual([english]);

    // Arabic term, narrowed (the Arabic title is matched as written).
    await searchFor(page, `${tag} دهان`);
    await expectCards(page, 1);
    expect(await cardIds(page)).toEqual([arabic]);

    // A hidden opening is not found even by its own exact words.
    await searchFor(page, `${tag} hidden`);
    await expectCards(page, 0);
    await expect(page.getByTestId("job-results")).toContainText("No opportunities match those filters");

    // A query that matches nothing says so.
    await searchFor(page, `${tag}-no-such-term`);
    await expectCards(page, 0);

    // And the search box itself is the real control that writes the URL.
    await page.goto("/home/jobs");
    await openFilters(page);
    const search = page.getByRole("search").getByRole("searchbox");
    await search.fill(`${tag} Ceramic`);
    await search.press("Enter");
    await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(tag)}`));
    await expectCards(page, 1);
  });

  test("Newest is published_at DESC, id DESC, and restores after Highest pay and Nearest", async ({ page }) => {
    const tag = unique();
    // Distinct publication times, plus two openings published at the SAME instant (the id breaks the tie).
    seedOpenJob({ title: `${tag} oldest`, amount: 9000, publishedHoursAgo: 72 });
    seedOpenJob({ title: `${tag} tie one`, amount: 1500, publishedAtIso: "2031-05-05T10:00:00Z" });
    seedOpenJob({ title: `${tag} tie two`, amount: 2500, publishedAtIso: "2031-05-05T10:00:00Z" });
    seedOpenJob({ title: `${tag} mid`, amount: 5000, publishedHoursAgo: 24 });
    seedOpenJob({ title: `${tag} fresh`, amount: 700, publishedHoursAgo: 0 });
    const expectedNewest = newestOracle(tag);
    expect(expectedNewest).toHaveLength(5);

    await searchFor(page, tag);
    await expectCards(page, 5);
    await expect(page.getByRole("button", { name: "Newest" })).toHaveAttribute("aria-pressed", "true");
    // The board shows exactly what the database orders by — never updated_at.
    expect(await cardIds(page)).toEqual(expectedNewest);

    // Highest pay: by amount, regardless of when it was published.
    await page.getByRole("button", { name: "Highest pay" }).click();
    await expect(page).toHaveURL(/sort=highest/);
    await expectCards(page, 5);
    const byAmount = psqlValue(`select id from public.jobs where title like '${tag}%' and status = 'open' order by offered_amount desc, published_at desc, id desc;`).split("\n");
    expect(await cardIds(page)).toEqual(byAmount);

    // Nearest: a different, tiered ordering over the very same set.
    await page.getByRole("button", { name: "Nearest" }).click();
    await expect(page).toHaveURL(/sort=nearest/);
    await expectCards(page, 5);
    expect([...(await cardIds(page))].sort()).toEqual([...expectedNewest].sort());

    // Back to Newest: the original order is restored exactly.
    await page.getByRole("button", { name: "Newest" }).click();
    await expect(page).not.toHaveURL(/sort=/);
    await expectCards(page, 5);
    expect(await cardIds(page)).toEqual(expectedNewest);
  });

  test("an edited older job never jumps above newer publications under Newest", async ({ page }) => {
    const tag = unique();
    const old = seedOpenJob({ title: `${tag} old`, amount: 2000, publishedHoursAgo: 48 });
    seedOpenJob({ title: `${tag} newer`, amount: 2000, publishedHoursAgo: 24 });
    seedOpenJob({ title: `${tag} newest`, amount: 2000, publishedHoursAgo: 1 });
    const before = newestOracle(tag);
    const publishedBefore = publishedAt(old);

    // A legitimate edit by the job's own poster, through the real RPC (bumps updated_at, never published_at).
    const version = psqlValue(`select version from public.jobs where id = '${old}';`);
    psql(`
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"${POSTER_ID}","role":"authenticated"}';
select public.job_update('${old}', ${version}, '${tag} old (edited)', 'marble_granite', 2000::numeric, 'edited just now', 'Cairo', 'New Cairo', null, 4::smallint, null, null, 'cairo', 'new-cairo', null);
commit;
`);
    expect(publishedAt(old)).toBe(publishedBefore);

    await searchFor(page, tag);
    await expectCards(page, 3);
    const after = await cardIds(page);
    expect(after).toEqual(before);
    expect(after.at(-1)).toBe(old);
    await expect(page.getByTestId("job-card").last()).toContainText("(edited)");
  });

  test("filters: Governorate drives the dependent City, trade, budget and application state", async ({ page }) => {
    const tag = unique();
    const cairoNew = seedOpenJob({ title: `${tag} cairo new`, amount: 2000, governorateKey: "cairo", cityKey: "new-cairo", trade: "marble_alternative_installation" });
    const cairoNasr = seedOpenJob({ title: `${tag} cairo nasr`, amount: 4000, governorateKey: "cairo", cityKey: "nasr-city", trade: "vinyl_flooring_installation" });
    const gizaDokki = seedOpenJob({ title: `${tag} giza dokki`, amount: 6000, governorateKey: "giza", cityKey: "dokki", trade: "vinyl_flooring_installation" });
    await searchFor(page, tag);
    await expectCards(page, 3);
    await openFilters(page);

    // Governorate narrows; the City list then only offers that governorate's cities.
    await page.getByRole("button", { name: /^Governorate/ }).click();
    await page.getByRole("option", { name: "Cairo", exact: true }).click();
    await expect(page).toHaveURL(/gov=cairo/);
    await expectCards(page, 2);
    expect((await cardIds(page)).sort()).toEqual([cairoNew, cairoNasr].sort());

    await page.getByRole("button", { name: /^City/ }).click();
    const cities = (await page.getByRole("option").allTextContents()).join("|");
    expect(cities).toMatch(/New Cairo/);
    expect(cities).not.toMatch(/Dokki/);
    await page.getByRole("option", { name: "Nasr City" }).click();
    await expect(page).toHaveURL(/city=nasr-city/);
    await expectCards(page, 1);
    expect(await cardIds(page)).toEqual([cairoNasr]);

    // Changing the governorate clears the dependent city instead of keeping an impossible pair.
    await page.getByRole("button", { name: /^Governorate/ }).click();
    await page.getByRole("option", { name: "Giza", exact: true }).click();
    await expect(page).toHaveURL(/gov=giza/);
    await expect(page).not.toHaveURL(/city=/);
    await expectCards(page, 1);
    expect(await cardIds(page)).toEqual([gizaDokki]);

    // Clear all resets every filter, the search included; the page is no longer narrowed by location.
    await page.getByRole("button", { name: "Clear all" }).click();
    await expect(page).not.toHaveURL(/gov=|q=/);
    await searchFor(page, tag);
    await openFilters(page);
    await expectCards(page, 3);
    await page.getByRole("checkbox", { name: "Marble-alternative installation" }).check();
    await expect(page).toHaveURL(/trade=marble_alternative_installation/);
    await expectCards(page, 1);
    expect(await cardIds(page)).toEqual([cairoNew]);
    await page.getByRole("checkbox", { name: "Marble-alternative installation" }).uncheck();
    await expectCards(page, 3);

    // Budget: an inclusive numeric range.
    await page.getByLabel("Minimum (EGP)").fill("3000");
    await page.getByLabel("Maximum (EGP)").fill("5000");
    await page.getByLabel("Maximum (EGP)").press("Enter");
    await expect(page).toHaveURL(/min=3000/);
    await expect(page).toHaveURL(/max=5000/);
    await expectCards(page, 1);
    expect(await cardIds(page)).toEqual([cairoNasr]);
    await page.getByRole("button", { name: "Clear all" }).click();
    await expect(page).not.toHaveURL(/min=|max=/);

    // Application state: apply to one, then both sides of the filter are honest.
    await applyThroughUi(page, cairoNew);
    await searchFor(page, tag);
    await openFilters(page);
    await page.getByRole("button", { name: /^My applications/ }).click();
    await page.getByRole("option", { name: "Already applied" }).click();
    await expect(page).toHaveURL(/applied=yes/);
    await expectCards(page, 1);
    expect(await cardIds(page)).toEqual([cairoNew]);
    await page.getByRole("button", { name: /^My applications/ }).click();
    await page.getByRole("option", { name: "Not applied yet" }).click();
    await expect(page).toHaveURL(/applied=no/);
    await expectCards(page, 2);
  });

  test("cursor paging: View more appends without duplicates, filters reset it, and the URL never records a page", async ({ page }) => {
    const tag = unique();
    for (let i = 0; i < 14; i += 1) seedOpenJob({ title: `${tag} ${String(i).padStart(2, "0")}`, amount: 2000 + i * 10, publishedHoursAgo: i + 1 });
    const oracle = newestOracle(tag);
    expect(oracle).toHaveLength(14);

    await searchFor(page, tag);
    await expectCards(page, 6);
    const first = await cardIds(page);
    expect(first).toEqual(oracle.slice(0, 6));
    await expect(page.getByRole("button", { name: "Show fewer opportunities" })).toHaveCount(0);

    await viewMore(page);
    await expectCards(page, 12);
    const second = await cardIds(page);
    expect(second.slice(0, 6)).toEqual(first); // existing rows remain, in place
    expect(second).toEqual(oracle.slice(0, 12));
    expect(new Set(second).size).toBe(second.length);

    await viewMore(page);
    await expectCards(page, 14);
    const third = await cardIds(page);
    expect(third).toEqual(oracle);
    expect(new Set(third).size).toBe(14);
    await expect(page.getByRole("button", { name: "View more opportunities" })).toHaveCount(0);

    // No offset / page state leaks into the URL.
    expect(page.url()).not.toMatch(/[?&](shown|offset|page|cursor|after)=/);

    // Show fewer steps back down without changing the order.
    await page.getByRole("button", { name: "Show fewer opportunities" }).click();
    await expect.poll(() => page.getByTestId("job-card").count()).toBeLessThan(14);
    const fewer = await cardIds(page);
    expect(fewer).toEqual(oracle.slice(0, fewer.length));

    // A sort change starts the cursor over (the first page of the new ordering) ...
    await page.getByRole("button", { name: "Highest pay" }).click();
    await expect(page).toHaveURL(/sort=highest/);
    await expectCards(page, 6);
    const highest = psqlValue(`select id from public.jobs where title like '${tag}%' and status = 'open' order by offered_amount desc, published_at desc, id desc limit 6;`).split("\n");
    expect(await cardIds(page)).toEqual(highest);
    // ... and so does going back.
    await viewMore(page);
    await page.getByRole("button", { name: "Newest" }).click();
    await expectCards(page, 6);
    expect(await cardIds(page)).toEqual(oracle.slice(0, 6));
    expect(page.url()).not.toMatch(/[?&](shown|offset|page|cursor|after)=/);
  });

  test("saving: a heart persists across reloads, appears under Saved opportunities and leaves when removed", async ({ page }) => {
    const tag = unique();
    const kept = seedOpenJob({ title: `${tag} keep`, amount: 2000 });
    seedOpenJob({ title: `${tag} other`, amount: 2100 });
    await searchFor(page, tag);
    await expectCards(page, 2);

    const keptCard = () => page.getByTestId("job-card").filter({ has: page.locator(`a[href="/home/jobs/${kept}"]`) });
    await keptCard().getByRole("button", { name: "Save opportunity" }).click();
    await expect(keptCard().getByRole("button", { name: "Remove from saved jobs" })).toHaveAttribute("aria-pressed", "true");

    // Persisted by the database: still saved after a reload.
    await expect.poll(() => psqlValue(`select count(*) from public.saved_jobs where job_id = '${kept}';`)).toBe("1");
    await page.reload();
    await waitForHydration(page);
    await expectCards(page, 2);
    await expect(keptCard().getByRole("button", { name: "Remove from saved jobs" })).toBeVisible();

    // Saved opportunities narrows to exactly the saved one.
    await page.getByRole("button", { name: /^Saved opportunities/ }).click();
    await expect(page).toHaveURL(/saved=1/);
    await expectCards(page, 1);
    expect(await cardIds(page)).toEqual([kept]);

    // Unsaving there removes it from the saved view (once the board has refreshed) and from the database.
    await page.getByTestId("job-card").getByRole("button", { name: "Remove from saved jobs" }).click();
    await expect.poll(() => page.getByTestId("job-card").count()).toBe(0);
    await page.reload();
    await expectCards(page, 0);
    expect(psqlValue(`select count(*) from public.saved_jobs where job_id = '${kept}';`)).toBe("0");
  });

  test("Overall Match: the badge opens a structured breakdown, and a low match never blocks the job", async ({ page }) => {
    const tag = unique();
    // The seeded installer works in HVAC; a marble opening is outside his trade, so it is a weak (but real) match.
    const low = seedOpenJob({ title: `${tag} low`, amount: 2000, trade: "marble_alternative_installation" });
    await searchFor(page, tag);
    await expectCards(page, 1);

    const badge = page.getByTestId("job-card").getByTestId("match-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute("aria-label", /Overall Match \d+%/);
    await badge.click();
    const breakdown = page.getByTestId("match-breakdown");
    await expect(breakdown).toBeVisible();
    for (const line of ["trade", "specialty", "location", "availability"]) {
      await expect(breakdown.getByTestId(`match-line-${line}`)).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(breakdown).toBeHidden();

    // The card's number is the one the job page shows for the same caller and job.
    const onCard = (await badge.getAttribute("aria-label"))!.match(/Overall Match (\d+)%/)![1];
    await page.getByTestId("job-card").getByRole("link", { name: "Details" }).click();
    await expect(page).toHaveURL(new RegExp(`/home/jobs/${low}$`));
    const detailMatch = page.getByTestId("job-match");
    await expect(detailMatch).toBeVisible();
    await expect(detailMatch).toContainText(`${onCard}%`);
    for (const line of ["trade", "specialty", "location", "availability"]) {
      await expect(detailMatch.getByTestId(`match-line-${line}`)).toBeVisible();
    }
    // A low match never blocks normal access: the page is whole and applying is still offered.
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`${tag} low`);
    await expect(page.getByRole("button", { name: "Apply for this job" })).toBeVisible();
  });

  test("the opportunity page shows the real job, the same Overall Match as the board, and never blocks on a low match", async ({ page }) => {
    const tag = unique();
    const jobId = seedOpenJob({ title: `${tag} detail`, amount: 4500.5, trade: "marble_alternative_installation", days: 6 });
    await searchFor(page, tag);
    await expectCards(page, 1);
    const onBoard = (await page.getByTestId("job-card").getByTestId("match-badge").getAttribute("aria-label"))!.match(/Overall Match (\d+)%/)![1];

    await page.goto(`/home/jobs/${jobId}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`${tag} detail`);
    await expect(page.locator("main")).toContainText(/EGP\s*4,500\.50/);
    await expect(page.locator("main")).toContainText("Horizon Contracting");
    await expect(page.locator("main")).toContainText("6 working days");
    // The caller's Overall Match is the board's number, with the same structured lines.
    const match = page.getByTestId("job-match");
    await expect(match).toContainText(`${onBoard}%`);
    for (const line of ["trade", "specialty", "location", "availability"]) await expect(match.getByTestId(`match-line-${line}`)).toBeVisible();
    // Whatever the match, the job opens and can be applied to.
    await expect(page.getByRole("button", { name: "Apply for this job" })).toBeEnabled();
    // Back to the board.
    await page.getByRole("link", { name: /job opportunities/i }).first().click();
    await expect(page).toHaveURL(/\/home\/jobs(\?|$)/);
  });

  test("apply goes through the real confirmation, and the applied state is real everywhere", async ({ page }) => {
    const tag = unique();
    const jobId = seedOpenJob({ title: `${tag} apply`, amount: 7000 });
    await searchFor(page, tag);
    const card = page.getByTestId("job-card");
    await expectCards(page, 1);
    await expect(card.getByRole("button", { name: /apply/i })).toHaveCount(0); // no local one-tap apply on the card

    // "Apply now" leads to the opening's own confirmation, not to an immediate submission.
    await card.getByRole("link", { name: "Apply now" }).click();
    await expect(page).toHaveURL(new RegExp(`/home/jobs/${jobId}\\?apply=1$`));
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(psqlValue(`select count(*) from public.job_applications where job_id = '${jobId}';`)).toBe("0");
    await dialog.getByRole("button", { name: "Send application" }).click();
    await expect(dialog).toHaveCount(0);
    expect(psqlValue(`select count(*) from public.job_applications where job_id = '${jobId}';`)).toBe("1");

    // The board's badge comes from the database and survives a reload.
    await searchFor(page, tag);
    await expect(page.getByTestId("job-card")).toContainText("You applied");
    await expect(page.getByTestId("job-card").getByRole("link", { name: "Apply now" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("job-card")).toContainText("You applied");

    // It is listed in My applications, once.
    await page.getByRole("link", { name: "My applications" }).click();
    await expect(page).toHaveURL(/\/home\/jobs\/applications/);
    await expect(page.getByText(`${tag} apply`)).toHaveCount(1);

    // An opening cannot be applied to twice: the detail offers no apply any more.
    await page.goto(`/home/jobs/${jobId}`);
    await expect(page.getByRole("button", { name: "Apply for this job" })).toHaveCount(0);
    expect(psqlValue(`select count(*) from public.job_applications where job_id = '${jobId}';`)).toBe("1");
  });

  test("a reversed or junk URL never invents a filter", async ({ page }) => {
    seedOpenJob({ title: unique(), amount: 2500 });
    await page.goto("/home/jobs?sort=sideways&min=abc&duration=forever&applied=maybe&gov=atlantis&city=nowhere");
    await expect(page.getByTestId("job-card").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Newest" })).toHaveAttribute("aria-pressed", "true");
  });

  test("no layout overflow at any approved width, in English and Arabic RTL", async ({ page }) => {
    seedOpenJob({ title: unique(), amount: 3100 });
    for (const locale of ["en", "ar"] as const) {
      await setLocale(page, locale);
      for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]] as const) {
        await page.setViewportSize({ width, height });
        await page.goto("/home/jobs");
        await expect(page.getByTestId("job-card").first()).toBeVisible();
        await expect(page.locator(".installer-surface")).toHaveCount(1);
        if (locale === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
        await expectNoHorizontalOverflow(page);
      }
    }
  });
});

test.describe("non-installer surfaces are unchanged", () => {
  for (const [name, email, landing] of [
    ["consumer", "consumer@example.test", /\/home(\/|$|\?)/],
    ["sales", "youssef@example.test", /\/(b2b|home)(\/|$|\?)/],
    ["showroom/business", "hana@example.test", /\/b2b(\/|$)/],
    ["admin", "admin@example.test", /\/(admin|b2b|home)(\/|$|\?)/],
  ] as const) {
    test(`${name} still lands on its own surface, with no installer chrome`, async ({ page, request }) => {
      await setLocale(page, "en");
      await signIn(page, request, email, landing);
      await expect(page.locator(".installer-surface")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(/job opportunities.*overall match/is);
    });
  }

  test("a non-installer cannot use the installer board", async ({ page, request }) => {
    await setLocale(page, "en");
    await signIn(page, request, "consumer@example.test", /\/home(\/|$|\?)/);
    await page.goto("/home/jobs");
    await expect(page.getByTestId("job-card")).toHaveCount(0);
    await expect(page.locator(".installer-surface")).toHaveCount(0);
  });
});
