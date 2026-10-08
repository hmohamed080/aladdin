import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers/auth";
import { POSTER, POSTER_ORG, cleanupE2eJobs, expectNoHorizontalOverflow, psqlValue, unique, setLocale } from "./helpers/jobs-work";

/**
 * Batch 1B — the POSTING side: an organization creates and edits a job at `/b2b/jobs/new` and `/b2b/jobs/[id]/edit`.
 *
 * Signs in as the seeded poster (the owner of a verified organization) through the real password flow, creates a draft
 * through the real form and checks what the DATABASE stored — the canonical catalogue keys for the place, the optional
 * required specialty, and the work contact in canonical E.164. Everything the test creates is `E2E-` tagged and removed
 * by the shared cleanup; no reviewed fixture is touched.
 */

test.afterAll(() => cleanupE2eJobs());

const jobRow = (jobId: string) =>
  psqlValue(
    `select concat_ws('|', j.status, j.governorate_key, j.city_key, j.offered_amount::int, coalesce(j.required_specialty_id::text, ''), coalesce(c.contact_name, ''), coalesce(c.contact_phone_e164, ''), coalesce(c.contact_email, ''))
       from public.jobs j left join public.job_work_contacts c on c.job_id = j.id where j.id = '${jobId}';`,
  );

async function idFromUrl(page: Page): Promise<string> {
  await expect(page).toHaveURL(/\/b2b\/jobs\/[0-9a-f-]{36}(\/edit)?\?/);
  return /\/b2b\/jobs\/([0-9a-f-]{36})/.exec(page.url())![1]!;
}

test.describe("poster: create and edit a job (/b2b/jobs)", () => {
  test.beforeEach(async ({ page, request }) => {
    await setLocale(page, "en");
    await signIn(page, request, POSTER, /\/(home|b2b)/);
  });

  test("creates a draft with a canonical place and work contact, then edits and persists the changes", async ({ page }) => {
    const tag = unique();
    await page.goto("/b2b/jobs/new");
    await expect(page.getByRole("heading", { level: 1, name: "New job" })).toBeVisible();

    await page.getByLabel("Job title").fill(`${tag} Poster job`);
    await page.getByLabel("What the work involves").fill("Created by the E2E poster journey");

    // Trade. The optional specialty appears only when the chosen trade really has specialties, and is never required.
    await page.getByRole("button", { name: /^Trade/ }).click();
    await page.getByRole("option", { name: "Plastering & gypsum" }).click();
    const specialtyCount = Number(psqlValue(`select count(*) from public.trade_specialties s join public.trades t on t.id = s.trade_id where t.key = 'plastering_and_gypsum';`));
    const specialty = page.getByRole("button", { name: /^Required specialty/ });
    if (specialtyCount > 0) {
      await expect(specialty).toBeVisible();
      await specialty.click();
      // The first option is the explicit "no specialty": the field is optional.
      await expect(page.getByRole("option").first()).toHaveText("Any specialty in this trade");
      await page.keyboard.press("Escape");
    } else {
      await expect(specialty).toHaveCount(0);
    }
    // Another trade without specialties never shows the selector.
    const noSpecialtyTrade = psqlValue(`select t.key from public.trades t where t.is_active and not exists (select 1 from public.trade_specialties s where s.trade_id = t.id) limit 1;`);
    if (noSpecialtyTrade) {
      await page.getByRole("button", { name: /^Trade/ }).click();
      const option = page.getByRole("option").filter({ hasNotText: "Plastering & gypsum" });
      // Choosing a different trade must hide a specialty that belonged to the previous one.
      await option.first().click();
      if (specialtyCount > 0) {
        const currentKey = await page.locator('input[name="tradeKey"]').inputValue();
        const stillHas = Number(psqlValue(`select count(*) from public.trade_specialties s join public.trades t on t.id = s.trade_id where t.key = '${currentKey}';`)) > 0;
        await expect(specialty).toHaveCount(stillHas ? 1 : 0);
      }
      await page.getByRole("button", { name: /^Trade/ }).click();
      await page.getByRole("option", { name: "Plastering & gypsum" }).click();
    }

    await page.getByLabel(/^Offered compensation/).fill("5500");
    await page.getByLabel(/^Expected duration/).fill("3");

    // Place: the City cannot be chosen before a Governorate, and then only offers that governorate's cities.
    const city = page.getByRole("button", { name: /^City/ });
    await expect(city).toBeDisabled();
    await page.getByRole("button", { name: /^Governorate/ }).click();
    await page.getByRole("option", { name: "Cairo", exact: true }).click();
    await expect(city).toBeEnabled();
    await city.click();
    const cityOptions = (await page.getByRole("option").allTextContents()).join("|");
    expect(cityOptions).toMatch(/New Cairo/);
    expect(cityOptions).not.toMatch(/Dokki/);
    await page.getByRole("option", { name: "New Cairo" }).click();
    await page.getByLabel(/^Site address/).fill("12 E2E Street");

    // Work contact, with the compact phone field.
    await page.getByLabel("Contact name").fill("E2E Foreman");
    await page.getByLabel("Phone number").fill("1012345678");
    await page.getByLabel("E-mail").fill("foreman@e2e-poster.test");

    await page.getByRole("button", { name: "Create draft" }).click();
    const jobId = await idFromUrl(page);

    // The database holds the canonical keys, the money and the E.164 contact — nothing free-typed.
    const created = jobRow(jobId).split("|");
    expect(created[0]).toBe("draft");
    expect(created[1]).toBe("cairo");
    expect(created[2]).toBe("new-cairo");
    expect(created[3]).toBe("5500");
    expect(created.slice(5)).toEqual(["E2E Foreman", "+201012345678", "foreman@e2e-poster.test"]);
    expect(psqlValue(`select published_at is null from public.jobs where id = '${jobId}';`)).toBe("t");

    // Edit: the place and the contact are pre-filled from what was saved.
    await page.goto(`/b2b/jobs/${jobId}/edit`);
    await expect(page.getByLabel("Job title")).toHaveValue(`${tag} Poster job`);
    await expect(page.getByRole("button", { name: /^Governorate/ })).toContainText("Cairo");
    await expect(page.getByRole("button", { name: /^City/ })).toContainText("New Cairo");
    await expect(page.getByLabel("Contact name")).toHaveValue("E2E Foreman");
    await expect(page.getByLabel("Phone number")).toHaveValue(/1012345678/);
    await expect(page.getByLabel("E-mail")).toHaveValue("foreman@e2e-poster.test");

    // Change the city and the contact, save, then reload and verify the canonical values persisted.
    await page.getByRole("button", { name: /^City/ }).click();
    await page.getByRole("option", { name: "Nasr City" }).click();
    await page.getByLabel("E-mail").fill("site@e2e-poster.test");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(new RegExp(`/b2b/jobs/${jobId}\\?saved=1`));

    const edited = jobRow(jobId).split("|");
    expect(edited[1]).toBe("cairo");
    expect(edited[2]).toBe("nasr-city");
    expect(edited.slice(5)).toEqual(["E2E Foreman", "+201012345678", "site@e2e-poster.test"]);

    await page.goto(`/b2b/jobs/${jobId}/edit`);
    await expect(page.getByRole("button", { name: /^City/ })).toContainText("Nasr City");
    await expect(page.getByLabel("E-mail")).toHaveValue("site@e2e-poster.test");
    await expect(page.getByLabel("Phone number")).toHaveValue(/1012345678/);
    await expectNoHorizontalOverflow(page);
  });

  test("an invalid draft is refused with field messages and nothing is created", async ({ page }) => {
    const tag = unique();
    await page.goto("/b2b/jobs/new");
    await page.getByLabel("Job title").fill(`${tag} incomplete`);
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page).toHaveURL(/\/b2b\/jobs\/new/);
    await expect(page.getByRole("alert").or(page.locator("[data-invalid='true']")).first()).toBeVisible();
    expect(psqlValue(`select count(*) from public.jobs where title = '${tag} incomplete' and poster_org_id = '${POSTER_ORG}';`)).toBe("0");
  });
});
