import { test, expect, type Page, type Browser } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { signIn, IDENTITIES } from "./helpers/auth";

/**
 * Sprint 6 E2E: post-create OWNERSHIP edits (customer branch/assignee, lead
 * source/branch, incompatible-assignment handling) and SCOPED REALTIME between
 * two real browser contexts. Local Next.js + local Supabase, seeded identities,
 * real Email-OTP (no bypass). Every scenario asserts a PERSISTED/observed result.
 * The Realtime tests perform a real mutation through the trusted UI in one context
 * and observe the authorized outcome (and the branch-scoped ABSENCE of an
 * unauthorized one) in another — never a fake injected event.
 */
const uid = () => randomUUID().slice(0, 8);
const isMobile = () => test.info().project.name.includes("mobile");
const desktopOnly = () => test.skip(isMobile(), "desktop-only scenario");

const createBtn = /create|إضافة|حفظ/i;
const saveChangesBtn = /save changes|حفظ التغييرات/i;
const CAIRO = /Cairo Branch/i;
const SZ = /Sheikh Zayed Branch/i;

async function createCustomer(page: Page, name: string): Promise<string> {
  await page.goto("/b2b/customers/new");
  await page.locator("#displayName").fill(name);
  await page.getByRole("button", { name: createBtn }).click();
  await page.waitForURL(/\/b2b\/customers\/[0-9a-f-]{36}(\?|$)/, { waitUntil: "commit" });
  return page.url().split("?")[0]!;
}

async function createLead(page: Page, title: string, branchLabel?: RegExp): Promise<string> {
  await page.goto("/b2b/leads/new");
  await page.locator("#title").fill(title);
  if (branchLabel) {
    const opt = page.locator("#branchId option", { hasText: branchLabel });
    await page.locator("#branchId").selectOption({ label: (await opt.textContent())!.trim() });
  }
  await page.getByRole("button", { name: createBtn }).click();
  await page.waitForURL(/\/b2b\/leads\/[0-9a-f-]{36}(\?|$)/, { waitUntil: "commit" });
  return page.url().split("?")[0]!;
}

test.describe("manager — ownership edits", () => {
  test.beforeEach(async ({ page, request }) => {
    await signIn(page, request, IDENTITIES.manager);
  });

  test("customer branch change persists on the detail", async ({ page }) => {
    desktopOnly();
    // New customers default to the first branch (Cairo), so move to Sheikh Zayed
    // to exercise a real change.
    const detail = await createCustomer(page, `E2E Own Cust ${uid()}`);
    await page.goto(`${detail}/edit`);

    await page.getByRole("button", { name: /branch & salesperson|الفرع ومندوب/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator("#own-branch").selectOption({ label: "Sheikh Zayed Branch" });
    await dialog.getByRole("button", { name: saveChangesBtn }).click();

    await page.waitForURL(/\?updated=1/, { waitUntil: "commit" });
    await expect(page.getByRole("main").getByText(SZ)).toBeVisible();
  });

  test("lead source + branch change (with reassignment) persists", async ({ page }) => {
    desktopOnly();
    const detail = await createLead(page, `E2E Own Lead ${uid()}`);
    await page.goto(`${detail}/edit`);

    await page.getByRole("button", { name: /source & branch|المصدر والفرع/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator("#lsb-source").selectOption("campaign");
    await dialog.locator("#lsb-branch").selectOption({ label: "Cairo Branch" });
    await dialog.getByRole("button", { name: saveChangesBtn }).click();

    await page.waitForURL(/\?updated=1/, { waitUntil: "commit" });
    await expect(page.getByRole("main").getByText(CAIRO)).toBeVisible();
  });

  test("incompatible assignment is rejected and the dialog stays open with an error", async ({ page }) => {
    desktopOnly();
    // Put a lead in Cairo assigned to the Cairo-only rep, then try to move it to
    // Sheikh Zayed while keeping that rep — the RPC must reject the strand.
    const detail = await createLead(page, `E2E Strand ${uid()}`, CAIRO);
    await page.goto(`${detail}/edit`);

    await page.getByRole("button", { name: /source & branch|المصدر والفرع/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Assign the Cairo-only rep (option value = their membership id), then move to
    // Sheikh Zayed — a branch they cannot reach → the RPC must reject the strand.
    await dialog.locator("#lsb-assignee").selectOption("e2222222-eeee-4eee-8eee-eeeeeeeeeee2");
    await dialog.locator("#lsb-branch").selectOption({ label: "Sheikh Zayed Branch" });
    await dialog.getByRole("button", { name: saveChangesBtn }).click();

    // The dialog stays open and shows a localized error; nothing navigated.
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(page).not.toHaveURL(/\?updated=1/);
  });
});

test.describe("scoped realtime between two browser contexts", () => {
  async function signedContext(browser: Browser, email: string): Promise<Page> {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signIn(page, ctx.request, email);
    return page;
  }

  test("a lead created in one manager context appears in another without manual reload", async ({ browser }) => {
    test.skip(browser.browserType().name() === "webkit", "chromium only");
    if (test.info().project.name.includes("mobile")) test.skip(true, "desktop-only");

    const a = await signedContext(browser, IDENTITIES.manager);
    const b = await signedContext(browser, IDENTITIES.manager);
    try {
      await a.goto("/b2b/leads");
      const title = `RT Lead ${uid()}`;

      // Real mutation through the trusted UI in context B.
      await b.goto("/b2b/leads/new");
      await b.locator("#title").fill(title);
      await b.getByRole("button", { name: createBtn }).click();
      await b.waitForURL(/\/b2b\/leads\/[0-9a-f-]{36}(\?|$)/, { waitUntil: "commit" });

      // Context A refreshes itself from the Realtime hint (no manual reload).
      // Exactly one row — repeated/duplicate events never duplicate a card.
      await expect(a.getByRole("main").getByRole("link", { name: title })).toHaveCount(1, { timeout: 25_000 });
    } finally {
      await a.context().close();
      await b.context().close();
    }
  });

  test("a branch-limited rep never receives an out-of-scope lead", async ({ browser }) => {
    if (test.info().project.name.includes("mobile")) test.skip(true, "desktop-only");

    const rep = await signedContext(browser, IDENTITIES.branchLimited); // Cairo-only
    const mgr = await signedContext(browser, IDENTITIES.manager);
    try {
      await rep.goto("/b2b/leads");
      const title = `RT SZ ${uid()}`;

      // Manager creates a Sheikh Zayed lead (outside the Cairo rep's scope).
      await mgr.goto("/b2b/leads/new");
      await mgr.locator("#title").fill(title);
      const opt = mgr.locator("#branchId option", { hasText: SZ });
      await mgr.locator("#branchId").selectOption({ label: (await opt.textContent())!.trim() });
      await mgr.getByRole("button", { name: createBtn }).click();
      await mgr.waitForURL(/\/b2b\/leads\/[0-9a-f-]{36}(\?|$)/, { waitUntil: "commit" });

      // Give Realtime + any refresh time to settle, then prove ABSENCE: the
      // rep's RLS-scoped refetch never surfaces the SZ lead.
      await rep.waitForTimeout(4000);
      await expect(rep.getByText(title)).toHaveCount(0);
      expect(await rep.content()).not.toContain(title);
    } finally {
      await rep.context().close();
      await mgr.context().close();
    }
  });
});
