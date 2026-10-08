import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers/auth";
import { INSTALLER, INSTALLER_ID, cleanupE2eJobs, psqlValue, seedOpenJob, unique, setLocale, waitForHydration } from "./helpers/jobs-work";
import { psql } from "./global-setup";

/**
 * Batch 1B — the installer's availability and service areas.
 *
 * AVAILABILITY IS THREE-STATE. "Not specified" (never declared) is NOT "unavailable": it scores no points and loses none
 * in the Overall Match, and the profile says so. The tests drive the real settings page, declare each state, reload to
 * prove persistence, and look at the Overall Match breakdown on a real card. They never assert a particular percentage:
 * only what the availability line says for each state.
 *
 * The seeded installer is a shared review identity, so every test records his availability / windows / service areas
 * first and puts them back in `finally`.
 */

test.afterAll(() => cleanupE2eJobs());

type Saved = { available: string; updatedAt: string };

function snapshotAvailability(): Saved {
  const [available, updatedAt] = psqlValue(`select available_for_work, coalesce(availability_updated_at::text, '') from public.profiles where user_id = '${INSTALLER_ID}';`).split("|");
  return { available: available!, updatedAt: updatedAt! };
}

/** Put the declaration back exactly as it was (the stamp trigger only fires when available_for_work is in the SET list). */
function restoreAvailability(saved: Saved) {
  psql(`
update public.profiles set available_for_work = ${saved.available === "t"} where user_id = '${INSTALLER_ID}';
update public.profiles set availability_updated_at = ${saved.updatedAt ? `'${saved.updatedAt}'::timestamptz` : "null"} where user_id = '${INSTALLER_ID}';
`);
}

/** Never declared: unavailable by flag, no declaration time. */
function makeUndeclared() {
  psql(`
update public.profiles set available_for_work = false where user_id = '${INSTALLER_ID}';
update public.profiles set availability_updated_at = null where user_id = '${INSTALLER_ID}';
`);
}

const stateInDb = () =>
  psqlValue(`select case when available_for_work then 'available' when availability_updated_at is null then 'unknown' else 'unavailable' end from public.profiles where user_id = '${INSTALLER_ID}';`);

/** The availability line of the Overall Match breakdown on the card for `jobId`'s tag. */
async function availabilityLine(page: Page, tag: string) {
  await page.goto(`/home/jobs?q=${encodeURIComponent(tag)}`);
  await expect(page.getByTestId("job-card")).toHaveCount(1);
  await page.getByTestId("job-card").getByTestId("match-badge").click();
  return page.getByTestId("match-breakdown").getByTestId("match-line-availability");
}

test.describe("installer availability (/home/settings)", () => {
  test.beforeEach(async ({ page, request }) => {
    await setLocale(page, "en");
    await signIn(page, request, INSTALLER, /\/home$/);
  });

  test("undeclared is 'Not specified', never 'unavailable'; each declaration persists; the match says the same", async ({ page }) => {
    const saved = snapshotAvailability();
    const tag = unique();
    seedOpenJob({ title: `${tag} match`, amount: 2000, trade: "hvac" });
    try {
      makeUndeclared();
      expect(stateInDb()).toBe("unknown");

      await page.goto("/home/settings");
      const declared = page.locator("[data-availability-state]");
      await expect(declared).toHaveText("Not specified");
      await expect(declared).toHaveAttribute("data-availability-state", "unknown");
      // Neither answer is "the other one": both are offered.
      await expect(page.getByRole("button", { name: "Mark me available" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Mark me unavailable" })).toBeVisible();

      // The Overall Match is honest about it: the availability line is "Not specified", not 0 out of 15.
      let line = await availabilityLine(page, tag);
      await expect(line).toContainText("Not specified");
      await expect(line.getByTestId("match-not-specified")).toBeVisible();
      await expect(line.getByTestId("match-add-availability")).toBeVisible();
      await expect(line).not.toContainText(/\d+\/15/);

      // Declare UNAVAILABLE: a real choice the database records.
      await page.goto("/home/settings");
      await page.getByRole("button", { name: "Mark me unavailable" }).click();
      await expect(declared).toHaveText("Not taking work");
      await expect.poll(stateInDb).toBe("unavailable");
      await page.reload();
      await expect(declared).toHaveText("Not taking work");
      await expect(page.getByRole("button", { name: "Mark me available" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Mark me unavailable" })).toHaveCount(0);
      line = await availabilityLine(page, tag);
      await expect(line.getByTestId("match-not-specified")).toHaveCount(0);
      await expect(line).toContainText("0/15");

      // Declare AVAILABLE.
      await page.goto("/home/settings");
      await page.getByRole("button", { name: "Mark me available" }).click();
      await expect(declared).toHaveText("Available for work");
      await expect.poll(stateInDb).toBe("available");
      await page.reload();
      await expect(declared).toHaveText("Available for work");
      await expect(page.getByRole("button", { name: "Mark me unavailable" })).toBeVisible();
      line = await availabilityLine(page, tag);
      await expect(line.getByTestId("match-not-specified")).toHaveCount(0);
    } finally {
      restoreAvailability(saved);
    }
    expect(snapshotAvailability()).toEqual(saved);
  });

  test("availability windows: a valid window is added, persists after a reload and can be removed", async ({ page }) => {
    const windows = () => psqlValue(`select count(*) from public.user_availability_windows where user_id = '${INSTALLER_ID}' and available_from = date '2032-03-01';`);
    try {
      await page.goto("/home/settings");
      await page.getByLabel("From", { exact: true }).fill("2032-03-01");
      await page.getByLabel("To", { exact: true }).fill("2032-03-31");
      await page.getByRole("button", { name: "Add dates" }).click();
      const item = page.getByRole("listitem").filter({ hasText: "Mar 01, 2032 to Mar 31, 2032" });
      await expect(item).toHaveCount(1);
      expect(windows()).toBe("1");

      await page.reload();
      await expect(page.getByRole("listitem").filter({ hasText: "Mar 01, 2032 to Mar 31, 2032" })).toHaveCount(1);

      await page.getByRole("button", { name: "Remove the window starting Mar 01, 2032" }).click();
      await expect(page.getByRole("listitem").filter({ hasText: "Mar 01, 2032 to Mar 31, 2032" })).toHaveCount(0);
      expect(windows()).toBe("0");
    } finally {
      psql(`delete from public.user_availability_windows where user_id = '${INSTALLER_ID}' and available_from = date '2032-03-01';`);
    }
  });
});

test.describe("installer service areas (/home/profile/edit)", () => {
  test.beforeEach(async ({ page, request }) => {
    await setLocale(page, "en");
    await signIn(page, request, INSTALLER, /\/home$/);
  });

  test("canonical Governorate / City pickers: a main area, an added area, persistence, and the installer's own state restored", async ({ page }) => {
    // The committed seed gives this installer NO service area, a reviewed database may give him several. Either way the
    // test establishes its own prerequisite through the real UI and puts back exactly what it found.
    const rows = () =>
      psqlValue(
        `select coalesce(json_agg(json_build_object('g', governorate_key, 'c', city_key, 'p', is_primary) order by is_primary desc, governorate_key, city_key), '[]') from public.user_service_areas where user_id = '${INSTALLER_ID}';`,
      );
    const summary = () =>
      psqlValue(
        `select coalesce(string_agg(governorate_key || ':' || coalesce(city_key, '*') || ':' || is_primary, ',' order by governorate_key, city_key), '') from public.user_service_areas where user_id = '${INSTALLER_ID}';`,
      );
    const primaryKey = () => psqlValue(`select coalesce(max(governorate_key) filter (where is_primary), '') from public.user_service_areas where user_id = '${INSTALLER_ID}';`);
    const original = rows();

    try {
      await page.goto("/home/profile/edit");
      await waitForHydration(page);
      await expect(page.getByTestId("service-areas")).toBeVisible();

      // 1. The prerequisite: a MAIN governorate. Only chosen here when the installer has none.
      if (primaryKey() === "") {
        await page.getByRole("button", { name: /^Your main governorate/ }).click();
        await page.getByRole("option", { name: "Cairo", exact: true }).click();
        await page.getByRole("button", { name: "Save service areas" }).click();
        await expect(page.getByText("Service areas saved")).toBeVisible();
        expect(primaryKey()).toBe("cairo");
        await page.reload();
        await waitForHydration(page);
      }

      // 2. An additional area in a DIFFERENT governorate, from the canonical pickers.
      const extra = primaryKey() === "alexandria" ? "Giza" : "Alexandria";
      await page.getByRole("button", { name: "Add another area" }).click();
      const added = page.getByTestId("other-service-area").last();
      await added.getByRole("button", { name: /^Governorate/ }).click();
      await page.getByRole("option", { name: extra, exact: true }).click();
      // The City list belongs to the chosen governorate, and "the whole governorate" is the explicit default.
      await added.getByRole("button", { name: /^City/ }).click();
      const cityOptions = (await page.getByRole("option").allTextContents()).join("|");
      expect(cityOptions).toMatch(/The whole governorate/);
      expect(cityOptions).not.toMatch(/New Cairo/);
      await page.getByRole("option", { name: "The whole governorate" }).click();
      await page.getByRole("button", { name: "Save service areas" }).click();
      await expect(page.getByText("Service areas saved")).toBeVisible();
      expect(summary()).toContain(`${extra.toLowerCase()}:*:false`);

      // 3. Persisted: still there after a reload.
      await page.reload();
      await waitForHydration(page);
      await expect(page.getByRole("button", { name: `Remove ${extra}` })).toBeVisible();

      // 4. Remove the additional area through the UI.
      await page.getByRole("button", { name: `Remove ${extra}` }).click();
      await page.getByRole("button", { name: "Save service areas" }).click();
      await expect(page.getByText("Service areas saved")).toBeVisible();
      expect(summary()).not.toContain(`${extra.toLowerCase()}:*:false`);
    } finally {
      // Put back exactly the installer's own state: nothing this test created survives, nothing it found is lost.
      psql(`
delete from public.user_service_areas where user_id = '${INSTALLER_ID}';
insert into public.user_service_areas (user_id, governorate_key, city_key, is_primary)
select '${INSTALLER_ID}', x->>'g', x->>'c', (x->>'p')::boolean from json_array_elements('${original}'::json) x;
`);
    }
    expect(rows()).toBe(original);
  });
});
