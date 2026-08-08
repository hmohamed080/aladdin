import { test, expect, type Page, type Browser } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { signIn, IDENTITIES } from "./helpers/auth";

/**
 * Sprint 6.1 — scoped Realtime lifecycle E2E. Real local Supabase, real Email-OTP,
 * real trusted UI mutations across TWO browser contexts. Uses the test-safe
 * `window.__salesRealtime` adapter (only present when NEXT_PUBLIC_REALTIME_DEBUG=1)
 * to PROVE channel scope, teardown, single-channel, and refresh vs. deferred —
 * never a mocked DB event. Requires NEXT_PUBLIC_REALTIME_DEBUG=1 on the dev server.
 */
const CAIRO = "c1111111-cccc-4ccc-8ccc-cccccccccccc";
const SZ = "c2222222-cccc-4ccc-8ccc-cccccccccccc";
const CAIRO_MEM = "e2222222-eeee-4eee-8eee-eeeeeeeeeee2";
const SEED_CUST = "d0000001-0000-4000-8000-000000000001";
const DB = "supabase_db_aladdin";
const uid = () => randomUUID().slice(0, 8);
const isMobile = () => test.info().project.name.includes("mobile");

const createBtn = /create|إضافة|حفظ/i;

type Rt = { channels: string[]; channelCount: number; refreshes: number; deferred: number; lastRefreshScope: string | null } | null;
const rt = (p: Page): Promise<Rt> => p.evaluate(() => (window as unknown as { __salesRealtime?: Rt }).__salesRealtime ?? null);

async function signed(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, ctx.request, email);
  return page;
}

/** Wait until the test adapter is present (it is re-created on every page load). */
async function waitRt(page: Page) {
  await expect
    .poll(async () => (await rt(page)) !== null, { timeout: 15_000, message: "NEXT_PUBLIC_REALTIME_DEBUG=1 required" })
    .toBe(true);
}

async function requireDebug(page: Page) {
  await page.goto("/b2b");
  await waitRt(page);
}

/** Create a lead in a specific branch through the trusted new-lead UI. */
async function createLeadInBranch(page: Page, title: string, branchId: string): Promise<void> {
  await page.goto("/b2b/leads/new");
  await page.locator("#title").fill(title);
  await page.locator("#branchId").selectOption(branchId);
  await page.getByRole("button", { name: createBtn }).click();
  await page.waitForURL(/\/b2b\/leads\/[0-9a-f-]{36}(\?|$)/, { waitUntil: "commit" });
}

async function switchBranch(page: Page, branchId: string) {
  await page.getByLabel(/branch|الفرع/i).first().selectOption(branchId);
}

test.describe("scoped realtime lifecycle", () => {
  test.beforeEach(() => test.skip(isMobile(), "desktop-only (multi-context + instrumentation)"));

  test("A+B: manager scope narrows to the active branch and tears down on switch", async ({ browser }) => {
    test.setTimeout(120_000); // longest scenario (5 creates + 2 branch switches + polls)
    const a = await signed(browser, IDENTITIES.manager);
    const b = await signed(browser, IDENTITIES.manager);
    try {
      await requireDebug(a);
      // All Branches → organization scope, exactly one channel.
      await expect.poll(async () => (await rt(a))?.channels ?? []).toEqual([expect.stringMatching(/^org:/)]);

      // A lead created elsewhere refreshes context A (in-scope, All Branches).
      let before = (await rt(a))!.refreshes;
      await createLeadInBranch(b, `RT All ${uid()}`, CAIRO);
      await expect.poll(async () => (await rt(a))!.refreshes, { timeout: 25_000 }).toBeGreaterThan(before);

      // Switch A to Cairo → scope becomes branch:CAIRO, still exactly one channel.
      await switchBranch(a, CAIRO);
      await expect.poll(async () => (await rt(a))?.channels ?? [], { timeout: 30_000 }).toEqual([`branch:${CAIRO}`]);
      expect((await rt(a))!.channelCount).toBe(1);

      // Cairo mutation → refresh; Sheikh Zayed mutation → NO refresh.
      before = (await rt(a))!.refreshes;
      await createLeadInBranch(b, `RT Cairo ${uid()}`, CAIRO);
      await expect.poll(async () => (await rt(a))!.refreshes, { timeout: 25_000 }).toBeGreaterThan(before);

      const afterCairo = (await rt(a))!.refreshes;
      await createLeadInBranch(b, `RT SZ ${uid()}`, SZ);
      await a.waitForTimeout(5000);
      expect((await rt(a))!.refreshes, "out-of-branch SZ event must not refresh a Cairo-scoped page").toBe(afterCairo);

      // Switch A to Sheikh Zayed → Cairo channel torn down, one SZ channel.
      await switchBranch(a, SZ);
      await expect.poll(async () => (await rt(a))?.channels ?? [], { timeout: 30_000 }).toEqual([`branch:${SZ}`]);
      expect((await rt(a))!.channelCount).toBe(1);

      // Now an SZ mutation refreshes.
      before = (await rt(a))!.refreshes;
      await createLeadInBranch(b, `RT SZ2 ${uid()}`, SZ);
      await expect.poll(async () => (await rt(a))!.refreshes, { timeout: 25_000 }).toBeGreaterThan(before);
    } finally {
      await a.context().close();
      await b.context().close();
    }
  });

  test("C: a follow-up created in one context is observed in another without reload", async ({ browser }) => {
    const a = await signed(browser, IDENTITIES.manager);
    const b = await signed(browser, IDENTITIES.manager);
    try {
      await requireDebug(a);
      await a.goto("/b2b/follow-ups");
      await waitRt(a);
      const before = (await rt(a))!.refreshes;

      // Context B creates a fresh follow-up on a seeded lead (idempotent INSERT →
      // follow_up_tasks change event), through the trusted inline UI.
      await b.goto("/b2b/leads/1ead0001-0000-4000-8000-000000000001");
      await b.getByText(/\+ (new follow-up|متابعة جديدة)/i).first().click();
      const fuTitle = `RT FU ${uid()}`;
      await b.locator('input[name="title"]').fill(fuTitle);
      await b.getByRole("button", { name: /create follow-up|إنشاء متابعة/i }).click();
      await expect(b.getByText(fuTitle)).toBeVisible();

      // Context A refreshed from the Realtime hint (no manual reload) and now shows it.
      await expect.poll(async () => (await rt(a))!.refreshes, { timeout: 25_000 }).toBeGreaterThan(before);
      await expect(a.getByRole("main").getByText(fuTitle)).toBeVisible();
    } finally {
      await a.context().close();
      await b.context().close();
    }
  });

  test("D: sign-out removes every sales channel and stops refreshing", async ({ browser }) => {
    test.setTimeout(120_000);
    const a = await signed(browser, IDENTITIES.manager);
    // A different user mutates AFTER A signs out: supabase signOut() is global for
    // the user, so a second manager session would also be revoked — use the rep.
    const b = await signed(browser, IDENTITIES.branchLimited);
    try {
      await requireDebug(a);
      await expect.poll(async () => (await rt(a))?.channelCount ?? 0).toBe(1);

      await a.getByRole("button", { name: /sign out|تسجيل الخروج/i }).click();
      await a.waitForURL(/\/auth\/sign-in/, { waitUntil: "commit" });
      // The channel is gone (component unmounted on leaving the /b2b shell).
      await expect.poll(async () => (await rt(a))?.channelCount ?? 0, { timeout: 10_000 }).toBe(0);

      // A subsequent mutation elsewhere does not bring sales data onto the sign-in page.
      await createLeadInBranch(b, `RT PostSignout ${uid()}`, CAIRO);
      await a.waitForTimeout(3000);
      await expect(a).toHaveURL(/\/auth\/sign-in/);
      expect(await a.content()).not.toContain("RT PostSignout");
    } finally {
      await a.context().close();
      await b.context().close();
    }
  });

  test("F: an in-scope event never overwrites an open edit; manual apply then refreshes", async ({ browser }) => {
    const a = await signed(browser, IDENTITIES.manager);
    const b = await signed(browser, IDENTITIES.manager);
    try {
      await requireDebug(a);
      // Open a customer edit form and type unsaved text, THEN move focus OFF the
      // input (to the page heading) — the dirty-form guard must still protect it.
      await a.goto(`/b2b/customers/d0000001-0000-4000-8000-000000000001/edit`);
      await waitRt(a);
      const nameField = a.locator("#displayName");
      await nameField.click();
      await nameField.fill("Unsaved Edit In Progress");
      await a.getByRole("heading").first().click(); // focus leaves the input
      await expect(nameField).not.toBeFocused();

      const before = (await rt(a))!;
      // Context B creates an in-scope lead → A must DEFER (form is dirty), not refresh.
      await createLeadInBranch(b, `RT Edit ${uid()}`, CAIRO);
      await expect.poll(async () => (await rt(a))!.deferred, { timeout: 25_000 }).toBeGreaterThan(before.deferred);
      // Typed value preserved, no silent overwrite, focus not stolen by Realtime.
      await expect(nameField).toHaveValue("Unsaved Edit In Progress");
      expect((await rt(a))!.refreshes).toBe(before.refreshes);

      // The manual "Updated ↻" affordance is offered; clicking it applies the refresh.
      const refreshBtn = a.getByTestId("realtime-refresh");
      await expect(refreshBtn).toBeVisible();
      await refreshBtn.click();
      await expect.poll(async () => (await rt(a))!.refreshes).toBeGreaterThan(before.refreshes);
    } finally {
      await a.context().close();
      await b.context().close();
    }
  });

  test("H: a terminal dialog with an entered reason is protected from an incoming event", async ({ browser }) => {
    const a = await signed(browser, IDENTITIES.manager);
    const b = await signed(browser, IDENTITIES.manager);
    try {
      await requireDebug(a);
      // Open the Mark-Lost confirmation dialog on a seeded lead and enter a reason.
      await a.goto("/b2b/leads/1ead0001-0000-4000-8000-000000000001");
      await waitRt(a);
      await a.getByRole("button", { name: /mark lost|تحديد كخاسرة|خاسرة/i }).click();
      const dialog = a.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const reason = dialog.locator("textarea").first();
      await reason.fill("Budget postponed to next quarter");
      // Move focus off the textarea but stay inside the (focus-trapped) dialog, so
      // deferral is proven by the dirty-form guard, not merely by input focus.
      await a.keyboard.press("Tab");
      await expect(reason).not.toBeFocused();

      const before = (await rt(a))!;
      await createLeadInBranch(b, `RT Lost ${uid()}`, CAIRO);
      await expect.poll(async () => (await rt(a))!.deferred, { timeout: 25_000 }).toBeGreaterThan(before.deferred);
      // Dialog stays open, the entered reason survives, and no refresh fired.
      await expect(dialog).toBeVisible();
      await expect(reason).toHaveValue("Budget postponed to next quarter");
      expect((await rt(a))!.refreshes).toBe(before.refreshes);
    } finally {
      await a.context().close();
      await b.context().close();
    }
  });

  test("G: repeated events on one lead still render exactly one row", async ({ browser }) => {
    const a = await signed(browser, IDENTITIES.manager);
    const b = await signed(browser, IDENTITIES.manager);
    try {
      await requireDebug(a);
      await a.goto("/b2b/leads");
      const title = `RT Dup ${uid()}`;
      await createLeadInBranch(b, title, CAIRO);
      await expect(a.getByRole("main").getByRole("link", { name: title })).toHaveCount(1, { timeout: 25_000 });

      // Edit the same lead twice in B (repeated events); A must still show ONE row.
      const detail = b.url();
      for (const suffix of [" v2", " v3"]) {
        await b.goto(`${detail.split("?")[0]}/edit`);
        await b.locator("#title").fill(title + suffix);
        await b.getByRole("button", { name: /save changes|حفظ التغييرات/i }).click();
        await b.waitForURL(/\?updated=1/, { waitUntil: "commit" });
      }
      await expect(a.getByRole("main").getByRole("link", { name: `${title} v3` })).toHaveCount(1, { timeout: 25_000 });
      await expect(a.getByRole("main").getByRole("link", { name: title, exact: true })).toHaveCount(0);
    } finally {
      await a.context().close();
      await b.context().close();
    }
  });

  test("E: a revoked membership can no longer surface data", async ({ browser }) => {
    const rep = await signed(browser, IDENTITIES.branchLimited); // Cairo rep
    try {
      await rep.goto("/b2b/customers");
      // Before revoke, the rep can see their Cairo customers.
      await expect(rep.getByRole("main").getByRole("link", { name: /النيل|Nile/ }).first()).toBeVisible();
      expect(await rep.content()).toContain("شركة النيل للديكور");

      // Revoke the rep's membership via the DB (test harness only, as postgres).
      execSync(`docker exec ${DB} psql -U postgres -d postgres -c "update public.memberships set status='revoked' where id='${CAIRO_MEM}'"`, { stdio: "ignore" });

      // A re-fetch now yields the no-organization state; no customer row leaks.
      await rep.reload();
      await expect(rep.getByText(/not a member|no organization|لست عضو|أي مؤسسة/i).first()).toBeVisible();
      expect(await rep.content()).not.toContain("شركة النيل للديكور");
    } finally {
      // Restore the seed so reruns and other specs are unaffected.
      execSync(`docker exec ${DB} psql -U postgres -d postgres -c "update public.memberships set status='active' where id='${CAIRO_MEM}'"`, { stdio: "ignore" });
      await rep.context().close();
    }
  });

  // Stale-conflict UI rendering is covered deterministically by a COMPONENT test
  // (customer-edit-form.test.tsx) — the browser path is unreliable because React
  // controls the optimistic-token hidden input (DOM tampering is reverted, and the
  // real token round-trips), so a genuine stale conflict can't be forced in-page
  // without a second real writer racing the exact render. The RPC 40001 is proven
  // by pgTAP 19 + customer_update_concurrency_test.sh, and the 40001 → conflict
  // mapping by the sales-forms unit tests.

  test("J: the reconnecting status is shown when the channel degrades (deterministic)", async ({ browser }) => {
    const a = await signed(browser, IDENTITIES.manager);
    try {
      await requireDebug(a);
      // Drive the status deterministically via the debug-only hook (no random network).
      await a.evaluate(() => window.dispatchEvent(new CustomEvent("sales-realtime:set-status", { detail: "reconnecting" })));
      const statusEl = a.getByTestId("realtime-status");
      await expect(statusEl).toBeVisible();
      await expect(statusEl).toHaveText(/reconnecting|إعادة الاتصال/i);
      await a.screenshot({ path: "test-results/vqa/state-realtime-reconnecting.png" });
      // Recover to live.
      await a.evaluate(() => window.dispatchEvent(new CustomEvent("sales-realtime:set-status", { detail: "live" })));
      await expect(statusEl).toHaveText("");
    } finally {
      await a.context().close();
    }
  });

  test("K: a read-only member gets the permission-denied panel on an edit route", async ({ browser }) => {
    const rep = await signed(browser, IDENTITIES.branchLimited); // Cairo rep (sales.read + sales.write)
    try {
      // Temporarily strip sales.write so the rep is read-only (harness; restored after).
      execSync(`docker exec ${DB} psql -U postgres -d postgres -c "delete from public.membership_capabilities where membership_id='${CAIRO_MEM}' and capability_key='sales.write'"`, { stdio: "ignore" });
      await rep.goto(`/b2b/customers/${SEED_CUST}/edit`);
      await expect(rep.getByText(/don.t have access|permission|role or branch|الوصول|صلاحية|دورك/i).first()).toBeVisible();
      await rep.screenshot({ path: "test-results/vqa/state-permission-denied.png" });
    } finally {
      execSync(`docker exec ${DB} psql -U postgres -d postgres -c "insert into public.membership_capabilities (membership_id, capability_key) values ('${CAIRO_MEM}','sales.write') on conflict do nothing"`, { stdio: "ignore" });
      await rep.context().close();
    }
  });
});
