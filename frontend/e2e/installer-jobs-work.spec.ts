import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { psql } from "./global-setup";
import { signIn } from "./helpers/auth";

/**
 * Batch 1B — `/home/jobs` and `/home/work` in production.
 *
 * Signs in through the REAL password flow (no OTP helper, no auth bypass) as the
 * seeded craftsman Hossam, whose declared trade is HVAC. Everything else is data:
 * each test seeds its own uniquely-titled opening directly in the LOCAL test DB
 * (never production), so the specs do not depend on, or disturb, each other.
 *
 * Applying, starting work and everything an installer CAN do is driven through the
 * real UI (the real server actions). The only database-side steps are the ones an
 * installer cannot take: publishing the opening and, as the posting organization's
 * owner, accepting the application.
 */

const INSTALLER = "hossam@example.test";
const INSTALLER_ID = "72000001-0000-4000-8000-000000000001";
const POSTER_ID = "70000006-0000-4000-8000-000000000006"; // Mostafa, owner of Horizon Contracting
const POSTER_ORG = "9a000000-aaaa-4aaa-8aaa-000000000005";
const POSTER_BRANCH = "b0000005-0000-4000-8000-000000000005";
const DB = process.env.E2E_DB_CONTAINER ?? "supabase_db_aladdin";

function psqlValue(sql: string): string {
  return execSync(`docker exec -i ${DB} psql -U postgres -d postgres -At -v ON_ERROR_STOP=1`, { input: sql }).toString().trim();
}

type SeedJob = { title: string; amount: number; trade?: string; governorate?: string; days?: number; endsBy?: string | null };

/** A published opening from Horizon Contracting (a verified poster). Returns its id. */
function seedOpenJob({ title, amount, trade = "marble_granite", governorate = "Cairo", days = 4, endsBy = null }: SeedJob): string {
  const id = randomUUID();
  psql(`
insert into public.jobs (id, poster_org_id, poster_branch_id, title, description, trade_id, offered_amount,
                         governorate, city, site_address, expected_duration_days, starts_on, ends_by, status, version, published_at,
                         created_by, created_at)
select '${id}', '${POSTER_ORG}', '${POSTER_BRANCH}', '${title.replace(/'/g, "''")}', 'E2E opening', t.id, ${amount},
       '${governorate}', 'New Cairo', 'E2E site address', ${days}, (now() + interval '3 days')::date,
       ${endsBy ? `'${endsBy}'` : "null"}, 'open', 1, now(), '${POSTER_ID}', now()
from public.trades t where t.key = '${trade}';
`);
  return id;
}

/** As the posting organization's owner: accept the installer's application, creating the assignment. */
function acceptApplication(jobId: string): string {
  const applicationId = psqlValue(`select id from public.job_applications where job_id = '${jobId}' limit 1;`);
  expect(applicationId).not.toBe("");
  psql(`
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"${POSTER_ID}","role":"authenticated"}';
select public.job_application_accept('${applicationId}');
commit;
`);
  const assignmentId = psqlValue(`select id from public.job_assignments where job_id = '${jobId}' limit 1;`);
  expect(assignmentId).not.toBe("");
  return assignmentId;
}

/** As the installer: a real progress report, through the same RPC the UI calls. */
function reportProgress(assignmentId: string, percent: number, stage: string): void {
  psql(`
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"${INSTALLER_ID}","role":"authenticated"}';
select public.job_progress_add('${assignmentId}', ${percent}::smallint, '${stage}', null);
commit;
`);
}

const unique = () => `E2E-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

async function useEnglish(page: Page) {
  const baseURL = test.info().project.use.baseURL!;
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL }]);
}

/** Horizontal overflow is a layout bug at any width. */
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Below the `wide` breakpoint the filters are a bottom sheet behind a Filters button; at 1440px the rail is always open. */
async function openFilters(page: Page) {
  const trigger = page.getByRole("button", { name: /^Filters/ });
  if (await trigger.isVisible()) {
    await trigger.click();
    await expect(page.getByRole("dialog", { name: "Filter results" })).toBeVisible();
  }
}

test.describe("installer job board (/home/jobs)", () => {
  test.beforeEach(async ({ page, request }) => {
    await useEnglish(page);
    await signIn(page, request, INSTALLER, /\/home$/);
  });

  test("shows every trade by default, with only real facts and no invented ones", async ({ page }) => {
    const title = unique();
    seedOpenJob({ title, amount: 4500.5 });

    await page.goto("/home/jobs");
    await expect(page.getByRole("heading", { level: 1, name: "Job opportunities" })).toBeVisible();

    // Exact money: a real fraction is kept, a whole amount drops its ".00".
    await page.goto(`/home/jobs?q=${encodeURIComponent(title)}`);
    await expect(page.getByTestId("job-card")).toContainText("4,500.50 EGP");

    // Hossam's trade is HVAC; the seeded opening is marble. The declared trade must
    // NOT narrow the board. (Looked up by search: the board shows its first few cards.)
    await page.goto("/home/jobs?q=Marble%20staircase");
    const marble = page.getByTestId("job-card").filter({ hasText: "Marble staircase cladding" });
    await expect(marble).toBeVisible();
    await expect(marble).toContainText("18,000 EGP");

    await page.goto("/home/jobs");
    const board = page.getByTestId("job-opportunities");
    const text = await board.innerText();
    expect(text).not.toMatch(/skill match|\d+(\.\d)?\s?km\b|saved opportunities|\bnearest\b|most requested/i);
    expect(text).not.toMatch(/(?<![\d,.])0(\.00)? EGP/);
    await expect(page.locator('img[src*="/assets/installer-dashboard/jobs/"]')).toHaveCount(0);
    await expect(board.locator("iframe")).toHaveCount(0);
    await expect(board.getByRole("button", { name: /save opportunity|apply now/i })).toHaveCount(0);

    // The two honest orderings, and only those.
    const sort = page.getByRole("group", { name: "Sort opportunities" });
    await expect(sort.getByRole("button")).toHaveText(["Newest", "Highest pay"]);
  });

  test("uses a stock-free illustration of the opening's real trade instead of a photo", async ({ page }) => {
    seedOpenJob({ title: unique(), amount: 3000 });
    await page.goto("/home/jobs");
    await expect(page.getByTestId("job-card").first()).toBeVisible();
    await expect(page.getByTestId("job-card").first().locator("img")).toHaveCount(0);
    await expect(page.getByTestId("job-card").first().locator("svg").first()).toBeVisible();
  });

  test("the URL is the board: search, budget range, highest pay and clear", async ({ page }) => {
    const tag = unique();
    const cheap = seedOpenJob({ title: `${tag} cheap`, amount: 1200 });
    const mid = seedOpenJob({ title: `${tag} mid`, amount: 4500.5 });
    const high = seedOpenJob({ title: `${tag} high`, amount: 9000 });
    void cheap; void mid; void high;

    // Search.
    await page.goto(`/home/jobs?q=${encodeURIComponent(tag)}`);
    await expect(page.getByTestId("job-card")).toHaveCount(3);

    // A real numeric range — inclusive, no invented ceiling.
    await page.goto(`/home/jobs?q=${encodeURIComponent(tag)}&min=2000&max=5000`);
    await expect(page.getByTestId("job-card")).toHaveCount(1);
    await expect(page.getByTestId("job-card")).toContainText(`${tag} mid`);

    await page.goto(`/home/jobs?q=${encodeURIComponent(tag)}&min=5000`);
    await expect(page.getByTestId("job-card")).toHaveCount(1);
    await expect(page.getByTestId("job-card")).toContainText(`${tag} high`);

    // Highest pay puts the most generous first; newest-first would put `high` last.
    await page.goto(`/home/jobs?q=${encodeURIComponent(tag)}&sort=highest`);
    await expect(page.getByTestId("job-card").first()).toContainText(`${tag} high`);
    await expect(page.getByTestId("job-card").last()).toContainText(`${tag} cheap`);

    // Driving the real controls writes the canonical URL.
    await page.goto(`/home/jobs?q=${encodeURIComponent(tag)}`);
    await page.getByRole("button", { name: "Highest pay" }).click();
    await expect(page).toHaveURL(/sort=highest/);
    await openFilters(page);
    await page.getByRole("button", { name: "Clear all" }).click();
    // Clear all resets the filters; the ordering is not a filter and stays.
    await expect(page).not.toHaveURL(/[?&]q=/);
    await expect(page).toHaveURL(/sort=highest/);
  });

  test("trade, budget and search controls drive the URL (filter sheet on phones)", async ({ page }) => {
    const tag = unique();
    // Only ACTIVE trades are offered as filters, so seed two of those.
    seedOpenJob({ title: `${tag} marble`, amount: 2000, trade: "marble_alternative_installation" });
    seedOpenJob({ title: `${tag} vinyl`, amount: 2100, trade: "vinyl_flooring_installation" });
    const cards = page.getByTestId("job-card");

    await page.goto(`/home/jobs?q=${encodeURIComponent(tag)}`);
    await expect(cards).toHaveCount(2); // all trades by default

    await openFilters(page);
    await page.getByRole("checkbox", { name: "Marble-alternative installation" }).check();
    await expect(page).toHaveURL(/trade=marble_alternative_installation/);
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText(`${tag} marble`);

    await page.getByRole("checkbox", { name: "Marble-alternative installation" }).uncheck();
    await expect(cards).toHaveCount(2);

    await page.getByLabel("Minimum (EGP)").fill("2050");
    await page.getByLabel("Minimum (EGP)").press("Enter");
    await expect(page).toHaveURL(/min=2050/);
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText(`${tag} vinyl`);

    await page.getByLabel("Maximum (EGP)").fill("2060");
    await page.getByLabel("Maximum (EGP)").press("Enter");
    await expect(page).toHaveURL(/max=2060/);
    await expect(cards).toHaveCount(0);
    await expect(page.getByTestId("job-opportunities")).toContainText("No opportunities match those filters");
  });

  test("a reversed or junk URL never invents a filter", async ({ page }) => {
    seedOpenJob({ title: unique(), amount: 2500 });
    await page.goto("/home/jobs?sort=nearest&min=abc&duration=forever&applied=maybe");
    await expect(page.getByTestId("job-card").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Newest" })).toHaveAttribute("aria-pressed", "true");
  });

  test("apply goes through the real detail flow, and the applied state is real", async ({ page }) => {
    const title = unique();
    seedOpenJob({ title, amount: 7000 });

    await page.goto(`/home/jobs?q=${encodeURIComponent(title)}`);
    const card = page.getByTestId("job-card");
    await expect(card).toHaveCount(1);
    // The card does not apply locally; it leads to the opening's own page.
    await expect(card.getByRole("button", { name: /apply/i })).toHaveCount(0);
    await card.getByRole("link", { name: /view details and apply/i }).click();

    await expect(page).toHaveURL(/\/home\/jobs\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: "Apply for this job" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Send application" }).click();
    await expect(page.getByText(/you applied|application/i).first()).toBeVisible();

    // Back on the board the badge comes from the database, not from local state...
    await page.goto(`/home/jobs?q=${encodeURIComponent(title)}`);
    await expect(page.getByTestId("job-card")).toContainText("You applied");
    // ...and survives a reload.
    await page.reload();
    await expect(page.getByTestId("job-card")).toContainText("You applied");

    // The real Applied filter.
    await page.goto(`/home/jobs?q=${encodeURIComponent(title)}&applied=no`);
    await expect(page.getByTestId("job-card")).toHaveCount(0);
    await page.goto(`/home/jobs?q=${encodeURIComponent(title)}&applied=yes`);
    await expect(page.getByTestId("job-card")).toHaveCount(1);

    // My applications stays one click away.
    await page.goto("/home/jobs");
    await expect(page.getByRole("link", { name: "My applications" })).toHaveAttribute("href", "/home/jobs/applications");
  });

  test("renders the installer shell once, with no layout overflow at any approved width", async ({ page }) => {
    seedOpenJob({ title: unique(), amount: 3100 });
    for (const [width, height] of [[390, 844], [430, 932], [768, 1024], [1440, 900]] as const) {
      await page.setViewportSize({ width, height });
      await page.goto("/home/jobs");
      await expect(page.getByTestId("job-card").first()).toBeVisible();
      // One shell: the installer palette scope appears exactly once.
      await expect(page.locator(".installer-surface")).toHaveCount(1);
      await expectNoHorizontalOverflow(page);
    }
  });

  test("Arabic RTL: no overflow and a real Arabic count line", async ({ page }) => {
    const baseURL = test.info().project.use.baseURL!;
    await page.context().addCookies([{ name: "NEXT_LOCALE", value: "ar", url: baseURL }]);
    seedOpenJob({ title: unique(), amount: 3100 });
    for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]] as const) {
      await page.setViewportSize({ width, height });
      await page.goto("/home/jobs");
      await expect(page.getByTestId("job-card").first()).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expectNoHorizontalOverflow(page);
    }
    await expect(page.getByTestId("job-opportunities")).toContainText(/فرصة|فرص/);
  });

  test("dark theme keeps the board legible and inside the viewport", async ({ page }) => {
    const baseURL = test.info().project.use.baseURL!;
    await page.context().addCookies([{ name: "aladdin-theme", value: "dark", url: baseURL }]);
    seedOpenJob({ title: unique(), amount: 3100 });
    await page.goto("/home/jobs");
    await expect(page.getByTestId("job-card").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("installer my work (/home/work)", () => {
  test.beforeEach(async ({ page, request }) => {
    await useEnglish(page);
    await signIn(page, request, INSTALLER, /\/home$/);
  });

  /** Apply through the real UI, then accept as the poster; returns the new assignment. */
  async function assigned(page: Page, title: string, amount = 6200, endsBy: string | null = "2030-01-31") {
    const jobId = seedOpenJob({ title, amount, endsBy });
    await page.goto(`/home/jobs/${jobId}`);
    await page.getByRole("button", { name: "Apply for this job" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Send application" }).click();
    await expect(page.getByText(/you applied|application/i).first()).toBeVisible();
    return { jobId, assignmentId: acceptApplication(jobId) };
  }

  test("a scheduled assignment offers Start work through the real detail flow, then reports real progress", async ({ page }) => {
    const title = unique();
    const { assignmentId } = await assigned(page, title);

    await page.goto("/home/work");
    await expect(page.getByRole("heading", { level: 1, name: "My work" })).toBeVisible();
    const work = page.getByTestId("my-work");
    await expect(work.locator(`a[href="/home/work/${assignmentId}"]:visible`).first()).toBeVisible();
    await expect(work).toContainText(title);
    await expect(work).toContainText("6,200 EGP");
    await expect(work.getByRole("link", { name: "Start work" }).first()).toHaveAttribute("href", `/home/work/${assignmentId}`);

    // Real start, on the real detail page.
    await work.getByRole("link", { name: "Start work" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/home/work/${assignmentId}$`));
    await page.getByRole("button", { name: "Start work" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Start work" }).click();
    await expect(page.getByText(/in progress|under way/i).first()).toBeVisible();

    // A real progress report (the RPC the detail dialog calls), then it shows up here.
    reportProgress(assignmentId, 40, "Surface preparation");
    await page.goto("/home/work");
    const panel = page.locator('section[aria-labelledby="active-work-title"]');
    await expect(panel.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
    await expect(panel).toContainText("Surface preparation");
    await expect(panel).toContainText(title);
    await expect(panel.getByRole("link", { name: "Update progress" })).toHaveAttribute("href", `/home/work/${assignmentId}`);
    // The link reaches the real progress flow on the assignment's own page.
    await panel.getByRole("link", { name: "Update progress" }).click();
    await expect(page).toHaveURL(new RegExp(`/home/work/${assignmentId}$`));
    await page.getByRole("button", { name: "Update progress" }).click();
    await expect(page.getByRole("dialog")).toContainText("Report progress");
  });

  test("states only what exists: no fake contact, rating, documents, tools, export, next stage or paused/review tabs", async ({ page }) => {
    await assigned(page, unique());
    await page.goto("/home/work");
    const work = page.getByTestId("my-work");
    await expect(work).toBeVisible();
    const text = await work.innerText();
    expect(text).not.toMatch(/documents and files|quick tools|upload current-work photos|request materials|message the showroom|deadline extension|export report|save search|next stage|completed this month/i);
    expect(text).not.toMatch(/010 ••••|projects@example\.com|\b4\.[0-9]\b ?★/);
    await expect(page.locator('img[src*="/assets/installer-dashboard/jobs/"]')).toHaveCount(0);

    // The status vocabulary is the real one.
    await page.getByRole("button", { name: "All filters" }).click();
    await page.getByRole("button", { name: "Status" }).click();
    const options = await page.getByRole("option").allTextContents();
    expect(options.join("|")).not.toMatch(/paused|in review|archive|accepted/i);
    expect(options.length).toBe(5); // current + the four real statuses
  });

  test("the status tab is the URL and narrows by real status", async ({ page }) => {
    const title = unique();
    await assigned(page, title);
    await page.goto("/home/work?state=scheduled");
    await expect(page.getByTestId("my-work").locator("table:visible, ul:visible").first()).toContainText(title);
    await page.goto("/home/work?state=completed");
    await expect(page.getByTestId("my-work")).not.toContainText(title);
    // An unknown state falls back to everything instead of an empty page.
    await page.goto("/home/work?state=paused");
    await expect(page.getByTestId("my-work")).toContainText(title);
  });

  test("the planned-period date range includes overlapping work and the control says what it means", async ({ page }) => {
    const title = unique();
    const jobId = seedOpenJob({ title, amount: 5000, endsBy: "2031-06-20" });
    await page.goto(`/home/jobs/${jobId}`);
    await page.getByRole("button", { name: "Apply for this job" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Send application" }).click();
    await expect(page.getByText(/you applied|application/i).first()).toBeVisible();
    acceptApplication(jobId);

    await page.goto("/home/work");
    await page.getByRole("button", { name: "Planned period" }).click();
    await page.getByLabel("From date").fill("2031-06-01");
    await page.getByLabel("To date").fill("2031-06-30");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByTestId("my-work")).toContainText(title);

    await page.getByRole("button", { name: /Jun 2031|01 Jun/ }).click();
    await page.getByLabel("From date").fill("2031-08-01");
    await page.getByLabel("To date").fill("2031-08-31");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByTestId("my-work")).not.toContainText(title);
  });

  test("no layout overflow at any approved width, English and Arabic", async ({ page }) => {
    await assigned(page, unique());
    for (const locale of ["en", "ar"] as const) {
      const baseURL = test.info().project.use.baseURL!;
      await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseURL }]);
      for (const [width, height] of [[390, 844], [430, 932], [768, 1024], [1440, 900]] as const) {
        await page.setViewportSize({ width, height });
        await page.goto("/home/work");
        await expect(page.getByTestId("my-work")).toBeVisible();
        await expect(page.locator(".installer-surface")).toHaveCount(1);
        await expectNoHorizontalOverflow(page);
      }
    }
  });

  test("dark theme keeps My Work inside the viewport", async ({ page }) => {
    await assigned(page, unique());
    const baseURL = test.info().project.use.baseURL!;
    await page.context().addCookies([{ name: "aladdin-theme", value: "dark", url: baseURL }]);
    await page.goto("/home/work");
    await expect(page.getByTestId("my-work")).toBeVisible();
    await expectNoHorizontalOverflow(page);
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
      await useEnglish(page);
      await signIn(page, request, email, landing);
      await expect(page.locator(".installer-surface")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(/job opportunities.*skill match/is);
    });
  }

  test("a non-installer cannot use the installer board", async ({ page, request }) => {
    await useEnglish(page);
    await signIn(page, request, "consumer@example.test", /\/home(\/|$|\?)/);
    await page.goto("/home/jobs");
    await expect(page.getByTestId("job-card")).toHaveCount(0);
    await expect(page.locator(".installer-surface")).toHaveCount(0);
  });
});
