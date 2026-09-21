import { expect, test } from "@playwright/test";
import { signIn } from "./helpers/auth";

const INSTALLER = "hossam@example.test";

test.describe("installer dashboard", () => {
  test("renders the approved shell with caller-scoped production data", async ({ page, request }) => {
    const pageErrors: string[] = [];
    const failedAssets: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400 && /\/(?:_next|assets)\//.test(response.url())) {
        failedAssets.push(`${response.status()} ${response.url()}`);
      }
    });

    await signIn(page, request, INSTALLER, /\/home$/);

    await expect(page.getByTestId("installer-home")).toBeVisible();
    await expect(page.getByText(/Hossam|حسام/i).first()).toBeVisible();
    await expect(page.locator('a[href="/home/jobs"]').first()).toBeVisible();
    await expect(page.locator('a[href="/home/work"]').first()).toBeVisible();
    await expect(page.locator('a[href="/home/points"]').first()).toBeVisible();
    await expect(page.locator('a[href="/home/reviews"]').first()).toBeVisible();

    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/96%|4\.2\s*km|Modern Floors|Marble Pro/i);
    expect(pageErrors).toEqual([]);
    expect(failedAssets).toEqual([]);
  });
});
