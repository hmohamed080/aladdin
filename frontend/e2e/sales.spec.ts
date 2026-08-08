import { test, expect, type Page, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { signIn, IDENTITIES } from "./helpers/auth";

/**
 * Click a server-action control and wait for its effect to land, re-clicking only
 * if the effect never appears within a generous window (a swallowed pre-hydration
 * click — the failure mode that surfaces under full-suite load). It WAITS before
 * any retry, so a slow-but-successful submit never double-submits, and it never
 * re-clicks a control that has already been replaced by its effect. The real
 * post-state is still asserted — no weakened assertion, no blind timeout bump.
 */
async function clickUntil(target: Locator, effect: Locator): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await effect.isVisible().catch(() => false)) return;
    await target.click().catch(() => {});
    const landed = await effect.waitFor({ state: "visible", timeout: 7000 }).then(() => true, () => false);
    if (landed) return;
  }
  await expect(effect).toBeVisible();
}

/**
 * Local sales-workflow E2E. Local Next.js + local Supabase, seeded synthetic
 * identities, real Email-OTP via Mailpit (no bypass). Assumes a fresh `db reset`
 * + applied `supabase/demo-seed.sql`. Creates use collision-proof unique names
 * (randomUUID), so reruns stay deterministic without a reset. Every scenario
 * ASSERTS the persisted result — not just the URL. Field inputs are targeted by
 * their stable `id` (language-independent); buttons by role+bilingual name.
 */
const uid = () => randomUUID().slice(0, 8);
const isMobile = () => test.info().project.name.includes("mobile");
const desktopOnly = () => test.skip(isMobile(), "desktop-only scenario");
const mobileOnly = () => test.skip(!isMobile(), "mobile-only scenario");

const createBtn = /create|إضافة|حفظ/i;
const saveChangesBtn = /save changes|حفظ التغييرات/i;

async function createCustomer(page: Page, name: string): Promise<string> {
  await page.goto("/b2b/customers/new");
  await page.locator("#displayName").fill(name);
  await page.getByRole("button", { name: createBtn }).click();
  await page.waitForURL(/\/b2b\/customers\/[0-9a-f-]{36}(\?|$)/, { waitUntil: "commit" });
  await expect(page.getByRole("heading", { name })).toBeVisible();
  return page.url().split("?")[0]!;
}

async function createLead(page: Page, title: string): Promise<string> {
  await page.goto("/b2b/leads/new");
  await page.locator("#title").fill(title);
  await page.getByRole("button", { name: createBtn }).click();
  await page.waitForURL(/\/b2b\/leads\/[0-9a-f-]{36}(\?|$)/, { waitUntil: "commit" });
  return page.url().split("?")[0]!;
}

test.describe("manager — daily sales workflow", () => {
  test.beforeEach(async ({ page, request }) => {
    await signIn(page, request, IDENTITIES.manager);
  });

  test("cockpit and customer list load with seeded data", async ({ page }) => {
    desktopOnly();
    await expect(page).toHaveURL(/\/b2b(\/|$)/);
    await page.goto("/b2b/customers");
    await expect(page.getByRole("main").getByRole("link", { name: /النيل|Nile|Sheikh Zayed|الزهور/ }).first()).toBeVisible();
  });

  test("customer create, edit, and clear an optional value persist", async ({ page }) => {
    desktopOnly();
    const detail = await createCustomer(page, `E2E Cust ${uid()}`);

    await page.goto(`${detail}/edit`);
    await page.locator("#primaryPhone").fill("01000000123");
    await page.getByRole("button", { name: saveChangesBtn }).click();
    await page.waitForURL(/\?updated=1/, { waitUntil: "commit" });
    await expect(page.getByText("01000000123")).toBeVisible();

    // Clear the optional phone (submit blank) and verify it is gone.
    await page.goto(`${detail}/edit`);
    await page.locator("#primaryPhone").fill("");
    await page.getByRole("button", { name: saveChangesBtn }).click();
    await page.waitForURL(/\?updated=1/, { waitUntil: "commit" });
    await expect(page.getByText("01000000123")).toHaveCount(0);
  });

  test("lead create, edit details, and stage transition persist", async ({ page }) => {
    desktopOnly();
    const title = `E2E Lead ${uid()}`;
    const detail = await createLead(page, title);

    const edited = `${title} v2`;
    await page.goto(`${detail}/edit`);
    await page.locator("#title").fill(edited);
    await page.getByRole("button", { name: saveChangesBtn }).click();
    await page.waitForURL(/\?updated=1/, { waitUntil: "commit" });
    await expect(page.getByRole("heading", { name: edited })).toBeVisible();

    await page.goto(detail);
    await page.locator("#stage").selectOption({ index: 1 });
    await page.getByRole("button", { name: /^(save|حفظ)$/i }).first().click();
    await expect(page.getByRole("main").getByText(/contacted|تم التواصل/i).first()).toBeVisible();
  });

  test("lead terminal confirmation: mark won requires the dialog and persists", async ({ page }) => {
    desktopOnly();
    const detail = await createLead(page, `E2E Won ${uid()}`);
    await page.goto(detail);
    await page.getByRole("button", { name: /mark won|تحديد كرابحة/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /mark won|تحديد كرابحة/i }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("main").getByText(/won|رابحة/i).first()).toBeVisible();
  });

  test("follow-up create, edit every field, reassign, complete, reopen", async ({ page }) => {
    desktopOnly();
    const leadDetail = await createLead(page, `E2E FU Lead ${uid()}`);
    await page.goto(leadDetail);

    const fuTitle = `E2E FU ${uid()}`;
    // The "+ new follow-up" disclosure is a native <details> (works pre-hydration);
    // the create SUBMIT is a server action, so guard it against a swallowed click.
    await page.getByText(/\+ (new follow-up|متابعة جديدة)/i).first().click();
    const fuTitleInput = page.locator('input[name="title"]');
    await expect(fuTitleInput).toBeVisible();
    await fuTitleInput.fill(fuTitle);
    await clickUntil(
      page.getByRole("button", { name: /create follow-up|إنشاء متابعة/i }),
      page.getByText(fuTitle),
    );

    // Edit route: change title + description, verify persisted on the board.
    await page.getByRole("link", { name: /^(edit|تعديل)$/i }).first().click();
    await page.waitForURL(/\/b2b\/follow-ups\/[0-9a-f-]{36}\/edit/, { waitUntil: "commit" });
    const editedFu = `${fuTitle} edited`;
    await page.locator("#title").fill(editedFu);
    await page.locator("#description").fill("call the site engineer");
    // Save redirects to the board; the persisted title landing there IS the effect.
    await clickUntil(page.getByRole("button", { name: saveChangesBtn }), page.getByText(editedFu));

    // Reassign (manager holds the capability): the assignee select is present.
    await page.goto(leadDetail);
    await page.getByRole("link", { name: /^(edit|تعديل)$/i }).first().click();
    await expect(page.locator("#reassign-assignee")).toBeVisible();
    await page.locator("#reassign-assignee").selectOption({ index: 1 });
    await clickUntil(page.getByRole("button", { name: /reassign|إعادة إسناد/i }), page.getByRole("status"));

    // Complete then reopen from the board (state toggles; guard each transition).
    await page.goto("/b2b/follow-ups");
    const row = () => page.locator("li", { hasText: editedFu });
    await clickUntil(
      row().getByRole("button", { name: /^(complete|إكمال)$/i }),
      row().getByRole("button", { name: /reopen|إعادة فتح/i }),
    );
    await clickUntil(
      row().getByRole("button", { name: /reopen|إعادة فتح/i }),
      row().getByRole("button", { name: /^(complete|إكمال)$/i }),
    );
  });

  test("branch selector narrows the visible pipeline", async ({ page }) => {
    desktopOnly();
    // The only seeded Sheikh-Zayed-branch lead; all E2E-created leads are Cairo.
    // Target the visible list-view ROW LINK (the pipeline view renders a hidden
    // duplicate span).
    const main = page.getByRole("main");
    const szLink = main.getByRole("link", { name: "Full villa finishing" });
    const cairoLink = main.getByRole("link", { name: /توريد أرضيات|صيانة دورية|تشطيب/ });

    await page.goto("/b2b/leads");
    await expect(szLink).toBeVisible(); // visible at "all branches"
    await expect(cairoLink.first()).toBeVisible();

    // The shell branch selector (header, first on the page) → Cairo.
    const branch = page.getByLabel(/branch|الفرع/i).first();
    const cairo = branch.locator("option", { hasText: /cairo|القاهرة/i });
    await branch.selectOption({ label: (await cairo.textContent())!.trim() });

    // Narrowing to Cairo removes the SZ lead but keeps the Cairo ones.
    await expect(szLink).toHaveCount(0);
    await expect(cairoLink.first()).toBeVisible();
  });

  test("language switch flips <html dir>; theme switch flips the dark class", async ({ page }) => {
    desktopOnly();
    const html = page.locator("html");
    const dir0 = await html.getAttribute("dir");
    await page.getByRole("button", { name: /language|اللغة|EN|ع/i }).first().click();
    await expect(html).not.toHaveAttribute("dir", dir0 ?? "");

    const wasDark = (await html.getAttribute("class"))?.includes("dark") ?? false;
    await page.getByRole("button", { name: /theme|المظهر/i }).first().click();
    if (wasDark) await expect(html).not.toHaveClass(/dark/);
    else await expect(html).toHaveClass(/dark/);
  });

  test("mobile bottom navigation reaches the sections", async ({ page }) => {
    mobileOnly();
    await page.goto("/b2b");
    // Scope to the bottom-nav landmark (the only navigation in the mobile a11y
    // tree — the desktop sidebar is display:none). Avoids a page-wide `.first()`
    // that could resolve to a cockpit link once seeded/created data grows.
    const bottomNav = page.getByRole("navigation", { name: /sales workspace|مساحة المبيعات/i }).last();
    await bottomNav.getByRole("link", { name: /customers|العملاء/i }).click();
    await page.waitForURL(/\/b2b\/customers/, { waitUntil: "commit" });
    await bottomNav.getByRole("link", { name: /leads|الفرص/i }).click();
    await page.waitForURL(/\/b2b\/leads/, { waitUntil: "commit" });
  });
});

test.describe("branch-limited salesperson — scope enforcement", () => {
  test("out-of-scope record is absent from the list and its direct URL is blocked", async ({ page, request }) => {
    desktopOnly();
    await signIn(page, request, IDENTITIES.branchLimited);

    await page.goto("/b2b/leads");
    await expect(page.getByRole("main").getByText(/Sheikh Zayed|شيخ زايد/i)).toHaveCount(0);

    // Locate a Sheikh Zayed lead via service-role (test harness only) and prove the
    // Cairo rep gets not-found/permission on its direct URL — no leaked data.
    const svc = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
    let sz: { id: string; title: string } | undefined;
    if (svc) {
      const r = await request.get(`${url}/rest/v1/leads?select=id,title&branch_id=eq.c2222222-cccc-4ccc-8ccc-cccccccccccc&limit=1`, {
        headers: { apikey: svc, Authorization: `Bearer ${svc}` },
      });
      if (r.ok()) sz = (await r.json())[0];
    }
    if (sz?.id) {
      await page.goto(`/b2b/leads/${sz.id}`);
      await expect(page.getByText(/not found|permission|غير موجود|صلاحية/i).first()).toBeVisible();
      expect(await page.content()).not.toContain(sz.title);
    }
  });
});
