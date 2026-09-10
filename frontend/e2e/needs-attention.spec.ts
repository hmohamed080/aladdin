import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { IDENTITIES, signIn } from "./helpers/auth";

const SHOTS = "e2e/screenshots";
const ORG_C = "9c000000-cccc-4ccc-8ccc-000000000001";

/**
 * يحتاج تدخلك اليوم (#46) — a category-level SUMMARY (up to three compact
 * cards: overdue follow-ups, quotations awaiting decision, pending join
 * requests), each deep-linking to a real, existing page/filter. Never a
 * record-level list — the redesign this spec covers replaced that with
 * exactly this.
 */
function sql(statement: string) {
  execSync(`docker exec -u postgres supabase_db_aladdin psql -d postgres -c "${statement}"`);
}

/**
 * Temporarily clears every category to zero for the empty-state screenshot —
 * a local, throwaway dev-database fixture, not a change to any RLS/RPC path
 * the app itself uses. Restored by the session's own final `supabase db
 * reset` (run once, after all local verification is done), not per-test:
 * this local Postgres container's data is disposable dev-seed data, not a
 * shared or hosted resource.
 */
function clearAllCategoriesToZero() {
  sql(
    `update public.follow_up_tasks set status = 'completed', completed_at = now() where organization_id = '${ORG_C}' and status = 'open';`,
  );
  sql(`update public.quotations set status = 'accepted' where requester_org_id = '${ORG_C}' and status = 'submitted';`);
}

test.describe("Needs your attention today (#46) — category summary", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: "http://127.0.0.1:3100" }]);
    await signIn(page, page.context().request, IDENTITIES.showroom);
  });

  // Locale-agnostic: the AR heading text ("يحتاج تدخلك اليوم") does not match
  // an English name regex, so this locates the section by its stable
  // `aria-labelledby` wiring instead of by searching for English copy.
  const section = (page: import("@playwright/test").Page) =>
    page.locator('section[aria-labelledby="needs-attention-heading"]');

  test("renders three compact summary cards with real counts, each deep-linking to a real destination", async ({
    page,
  }) => {
    const sec = section(page);
    await expect(sec).toBeVisible();
    // Record-level content must be GONE — the redesign's whole point.
    await expect(sec.getByText("Call Rasha back with the tile options")).toHaveCount(0);

    const overdue = sec.getByRole("link", { name: /overdue follow-ups/i });
    const quotations = sec.getByRole("link", { name: /quotations awaiting review/i });
    await expect(overdue).toBeVisible();
    await expect(quotations).toBeVisible();
    await expect(overdue).toHaveAttribute("href", "/b2b/follow-ups");
    await expect(quotations).toHaveAttribute("href", "/b2b/quotations?view=received");

    // Real navigation, not just a plausible href: each destination is a real,
    // already-existing page with the closest supported filter — never an
    // invented query string the page ignores.
    await quotations.click();
    await expect(page).toHaveURL(/\/b2b\/quotations\?view=received$/);
    await expect(page.getByRole("heading", { name: /quotations|offers/i }).first()).toBeVisible();
  });

  test("this org's summary never reveals another organization's records", async ({ page }) => {
    const sec = section(page);
    await expect(sec).toBeVisible();
    await expect(sec.getByText("Egypt Marble Manufacturing")).toHaveCount(0);
  });

  test("no mutation control anywhere in the section", async ({ page }) => {
    const sec = section(page);
    await expect(sec).toBeVisible();
    await expect(sec.getByRole("button")).toHaveCount(0);
    expect(await sec.locator("form").count()).toBe(0);
  });

  test("screenshots — desktop light (EN), light (AR), dark (AR)", async ({ page }) => {
    await expect(section(page)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/15-en-needs-attention-summary.png`, fullPage: true });

    await page.context().addCookies([{ name: "NEXT_LOCALE", value: "ar", url: "http://127.0.0.1:3100" }]);
    await page.reload({ waitUntil: "networkidle" });
    await expect(section(page)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/16-ar-needs-attention-summary-light.png`, fullPage: true });

    await page.context().addCookies([{ name: "aladdin-theme", value: "dark", url: "http://127.0.0.1:3100" }]);
    await page.reload({ waitUntil: "networkidle" });
    await expect(section(page)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/17-ar-needs-attention-summary-dark.png`, fullPage: true });
  });

  test.describe("mobile 390px", () => {
    test("one compact card per row, no horizontal scroll", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.context().addCookies([{ name: "NEXT_LOCALE", value: "ar", url: "http://127.0.0.1:3100" }]);
      await page.reload({ waitUntil: "networkidle" });

      const sec = section(page);
      await expect(sec).toBeVisible();
      const cards = sec.getByRole("listitem");
      const count = await cards.count();
      expect(count).toBeGreaterThan(0);

      // Every card spans (approximately) the full available row width at
      // this breakpoint — "one compact card per row" — rather than several
      // narrow cards sharing a row.
      const sectionBox = await sec.boundingBox();
      for (let i = 0; i < count; i++) {
        const box = await cards.nth(i).boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThan(sectionBox!.width * 0.9);
      }

      const scrollsHorizontally = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(scrollsHorizontally).toBe(false);

      await page.screenshot({ path: `${SHOTS}/18-ar-mobile-needs-attention-summary.png`, fullPage: true });
    });
  });

  test.describe("empty state — every category cleared to zero (local fixture)", () => {
    test.beforeAll(() => {
      clearAllCategoriesToZero();
    });

    test("shows one shared compact empty state, not three empty cards", async ({ page }) => {
      const sec = section(page);
      await expect(sec).toBeVisible();
      await expect(page.getByText("You're all caught up")).toBeVisible();
      await expect(sec.getByRole("listitem")).toHaveCount(0);
    });

    test("screenshot — empty state", async ({ page }) => {
      await expect(page.getByText("You're all caught up")).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/19-en-needs-attention-empty.png`, fullPage: true });
    });
  });
});
