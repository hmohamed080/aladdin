import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { psql } from "../global-setup";

/**
 * Shared fixtures for the Batch 1B installer Jobs / Work journeys.
 *
 * Everything here talks to the LOCAL test database only (the container named by `E2E_DB_CONTAINER`). Each test seeds
 * its own uniquely-tagged openings (`E2E-…`), drives everything an installer or a poster CAN do through the real UI,
 * and uses the real RPCs — as the real caller — for the few steps the UI cannot take (an organization accepting an
 * application). No test depends on a fixture count, so the specs stay valid against any reviewed local database.
 */

export const INSTALLER = "hossam@example.test";
export const POSTER = "mostafa@example.test";
export const INSTALLER_ID = "72000001-0000-4000-8000-000000000001";
export const POSTER_ID = "70000006-0000-4000-8000-000000000006"; // Mostafa, owner of Horizon Contracting
export const POSTER_ORG = "9a000000-aaaa-4aaa-8aaa-000000000005";
export const POSTER_BRANCH = "b0000005-0000-4000-8000-000000000005";
const DB = process.env.E2E_DB_CONTAINER ?? "supabase_db_aladdin";

export function psqlValue(sql: string): string {
  return execSync(`docker exec -i ${DB} psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1`, { input: sql }).toString().trim();
}

export const unique = () => `E2E-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const GOVERNORATE_NAMES: Record<string, string> = { cairo: "Cairo", giza: "Giza", alexandria: "Alexandria" };
const CITY_NAMES: Record<string, string> = {
  "new-cairo": "New Cairo",
  "nasr-city": "Nasr City",
  maadi: "Maadi",
  dokki: "Dokki",
  "alexandria-city": "Alexandria",
};

export type SeedJob = {
  title: string;
  amount: number;
  trade?: string;
  governorateKey?: string;
  cityKey?: string;
  days?: number;
  endsBy?: string | null;
  /** Hours ago the job was published (default: just now). The publication time is the Newest sort key. */
  publishedHoursAgo?: number;
  /** An exact publication instant (ISO), for ties. Wins over `publishedHoursAgo`. */
  publishedAtIso?: string;
  contact?: { name?: string; phone?: string; email?: string };
  /** Anything but `open` is NOT discoverable on the board (default `open`). */
  status?: "open" | "draft" | "closed";
  /** Another organization as the poster (e.g. an unverified one, whose openings must never be discoverable). */
  posterOrg?: string;
};

/** A seeded organization still awaiting verification (supabase/seed-pilot.sql); its openings are never discoverable. */
export const UNVERIFIED_ORG = "9d000000-dddd-4ddd-8ddd-000000000002";

/** A published opening from Horizon Contracting (a verified poster). Returns its id. */
export function seedOpenJob({
  title,
  amount,
  trade = "marble_granite",
  governorateKey = "cairo",
  cityKey = "new-cairo",
  days = 4,
  endsBy = null,
  publishedHoursAgo = 0,
  publishedAtIso,
  contact,
  status = "open",
  posterOrg = POSTER_ORG,
}: SeedJob): string {
  const id = randomUUID();
  const branch = posterOrg === POSTER_ORG ? `'${POSTER_BRANCH}'` : "null";
  const published = status === "draft" ? "null" : publishedAtIso ? `'${publishedAtIso}'::timestamptz` : `now() - interval '${publishedHoursAgo} hours'`;
  psql(`
insert into public.jobs (id, poster_org_id, poster_branch_id, title, description, trade_id, offered_amount,
                         governorate, city, governorate_key, city_key, site_address, expected_duration_days, starts_on, ends_by,
                         status, version, published_at, created_by, created_at)
select '${id}', '${posterOrg}', ${branch}, '${title.replace(/'/g, "''")}', 'E2E opening', t.id, ${amount},
       '${GOVERNORATE_NAMES[governorateKey] ?? governorateKey}', '${CITY_NAMES[cityKey] ?? cityKey}', '${governorateKey}', '${cityKey}',
       'E2E site address', ${days}, (now() + interval '3 days')::date,
       ${endsBy ? `'${endsBy}'` : "null"}, '${status}', 1, ${published}, '${POSTER_ID}', ${status === "draft" ? "now()" : published}
from public.trades t where t.key = '${trade}';
`);
  if (contact) setWorkContact(id, contact);
  return id;
}

/** As the posting organization's owner: set the job's work contact through the real RPC. */
export function setWorkContact(jobId: string, contact: { name?: string; phone?: string; email?: string }): void {
  const q = (v?: string) => (v ? `'${v.replace(/'/g, "''")}'` : "null");
  psql(`
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"${POSTER_ID}","role":"authenticated"}';
select public.job_work_contact_set('${jobId}', ${q(contact.name)}, ${q(contact.phone)}, ${q(contact.email)});
commit;
`);
}

/** As the posting organization's owner: accept the installer's application, creating the assignment (and its contact snapshot). */
export function acceptApplication(jobId: string): string {
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
export function reportProgress(assignmentId: string, percent: number, stage: string): void {
  psql(`
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"${INSTALLER_ID}","role":"authenticated"}';
select public.job_progress_add('${assignmentId}', ${percent}::smallint, '${stage}', null);
commit;
`);
}

/** As the posting organization: cancel an assignment through the real RPC (scheduled or in progress). */
export function cancelAssignment(assignmentId: string): void {
  const version = psqlValue(`select version from public.job_assignments where id = '${assignmentId}';`);
  psql(`
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"${POSTER_ID}","role":"authenticated"}';
select public.job_assignment_cancel('${assignmentId}', ${version}, 'E2E cancel');
commit;
`);
}

/** The job's current publication time, as the database holds it. */
export function publishedAt(jobId: string): string {
  return psqlValue(`select published_at::text from public.jobs where id = '${jobId}';`);
}

/**
 * Remove ONLY this run's test-owned rows (`E2E-` titles) from the LOCAL test database, bottom-up.
 *
 * Progress updates are append-only by design (a trigger forbids DELETE), and the foreign keys cascade through triggers,
 * so a plain `delete from jobs` cannot work once an assignment has progress. The cleanup therefore runs as the database
 * owner with `session_replication_role = replica` (triggers off, this transaction only) and removes every dependent row
 * explicitly, scoped by the tagged job ids. Reviewed fixtures are never matched, and production has no such path.
 */
export function cleanupE2eJobs(): void {
  try {
    psql(`
begin;
set local session_replication_role = replica;
create temp table _e2e_jobs on commit drop as select id from public.jobs where title like 'E2E-%';
create temp table _e2e_assignments on commit drop as select id from public.job_assignments where job_id in (select id from _e2e_jobs);
delete from public.job_progress_updates where assignment_id in (select id from _e2e_assignments);
delete from public.job_reviews where assignment_id in (select id from _e2e_assignments);
delete from public.assignment_contacts where assignment_id in (select id from _e2e_assignments);
delete from public.job_assignments where id in (select id from _e2e_assignments);
delete from public.job_applications where job_id in (select id from _e2e_jobs);
delete from public.saved_jobs where job_id in (select id from _e2e_jobs);
delete from public.job_work_contacts where job_id in (select id from _e2e_jobs);
delete from public.jobs where id in (select id from _e2e_jobs);
commit;
`);
  } catch (error) {
    console.warn("E2E cleanup could not remove every test-owned job:", (error as Error).message);
  }
}

export async function setLocale(page: Page, locale: "en" | "ar") {
  const baseURL = test.info().project.use.baseURL!;
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseURL }]);
}

/**
 * Wait until React has hydrated the page: every interactive node carries React's props key once hydration reached it.
 * Acting before that (WebKit hydrates visibly later than Chromium) would type into, or click, a server-rendered node
 * whose handlers are not attached yet, and the interaction would be silently lost.
 */
export async function waitForHydration(page: Page) {
  await page.waitForFunction(() => {
    const nodes = document.querySelectorAll("main button, main input:not([type=hidden]), main a");
    return nodes.length > 0 && Array.from(nodes).every((node) => Object.keys(node).some((key) => key.startsWith("__reactProps$")));
  });
}

/** Horizontal overflow is a layout bug at any width. */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** The element's box lies fully inside the visual viewport. */
export async function expectInsideViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
}

/** Below the `wide` breakpoint the filters are a bottom sheet behind a Filters button; at 1440px the rail is always open. */
export async function openFilters(page: Page) {
  const trigger = page.getByRole("button", { name: /^Filters/ });
  if (await trigger.isVisible()) {
    await trigger.click();
    await expect(page.getByRole("dialog", { name: "Filter results" })).toBeVisible();
  }
}

/** The ids of the job cards on screen, in order (from their links), without duplicates collapsed so duplicates are detectable. */
export async function cardIds(page: Page): Promise<string[]> {
  return page.getByTestId("job-card").evaluateAll((cards) =>
    cards.map((card) => {
      const href = card.querySelector<HTMLAnchorElement>('a[href^="/home/jobs/"]')?.getAttribute("href") ?? "";
      return /\/home\/jobs\/([0-9a-f-]{36})/.exec(href)?.[1] ?? "";
    }),
  );
}

/**
 * Apply through the real detail flow in either language: open the opening with its confirmation (`?apply=1`, the very
 * link the cards use), confirm, and wait for the real applied state (the confirmation closes and the page no longer
 * offers to apply).
 */
export async function applyThroughUi(page: Page, jobId: string) {
  await page.goto(`/home/jobs/${jobId}?apply=1`);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^(Send application|إرسال الطلب)$/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => psqlValue(`select count(*) from public.job_applications where job_id = '${jobId}';`)).toBe("1");
}

export type AssignmentState = "scheduled" | "in_progress" | "completed" | "cancelled";

/**
 * `count` real assignments for the installer, built through the REAL RPCs as the real callers inside one transaction:
 * the poster's job (and optional work contact), the installer's application, the poster's accept (which snapshots the
 * contact), then start (installer) / complete or cancel (poster) as the state requires. Titles are `<tag> NN`, so a
 * search for the tag finds exactly these. Returns the assignment ids in creation order.
 */
export function seedAssignments({
  tag,
  count,
  state,
  contact,
  endsBy = "2030-01-31",
  startsOn,
}: {
  tag: string;
  count: number;
  state: AssignmentState;
  contact?: { name?: string; phone?: string; email?: string };
  endsBy?: string;
  /** Planned start (ISO date). Default: three days from now. */
  startsOn?: string;
}): [string, ...string[]] {
  const q = (v?: string) => (v ? `'${v.replace(/'/g, "''")}'` : "null");
  const poster = `{"sub":"${POSTER_ID}","role":"authenticated"}`;
  const installer = `{"sub":"${INSTALLER_ID}","role":"authenticated"}`;
  const out = psqlValue(`
begin;
create temp table _e2e_ids (n int, id uuid);
do $$
declare
  i int; j uuid; app uuid; asg uuid; ver int;
begin
  for i in 1..${count} loop
    j := gen_random_uuid();
    insert into public.jobs (id, poster_org_id, poster_branch_id, title, description, trade_id, offered_amount, governorate, city, governorate_key, city_key,
                             site_address, expected_duration_days, starts_on, ends_by, status, version, published_at, created_by, created_at)
    select j, '${POSTER_ORG}', '${POSTER_BRANCH}', '${tag} ' || lpad(i::text, 2, '0'), 'E2E assignment', t.id, 6200, 'Cairo', 'New Cairo', 'cairo', 'new-cairo',
           'E2E site address', 4, ${startsOn ? `'${startsOn}'::date` : "(now() + interval '3 days')::date"}, '${endsBy}', 'open', 1, now() - (i || ' minutes')::interval, '${POSTER_ID}', now()
      from public.trades t where t.key = 'marble_granite';
    set local role authenticated;
    perform set_config('request.jwt.claims', '${poster}', true);
    ${contact ? `perform public.job_work_contact_set(j, ${q(contact.name)}, ${q(contact.phone)}, ${q(contact.email)});` : ""}
    perform set_config('request.jwt.claims', '${installer}', true);
    app := public.job_application_submit(j, null);
    perform set_config('request.jwt.claims', '${poster}', true);
    asg := public.job_application_accept(app);
    select version into ver from public.job_assignments where id = asg;
    ${state === "in_progress" || state === "completed" ? `perform set_config('request.jwt.claims', '${installer}', true);
    ver := public.job_assignment_start(asg, ver);` : ""}
    ${state === "completed" ? `perform set_config('request.jwt.claims', '${poster}', true);
    ver := public.job_assignment_complete(asg, ver);` : ""}
    ${state === "cancelled" ? `perform set_config('request.jwt.claims', '${poster}', true);
    ver := public.job_assignment_cancel(asg, ver, 'E2E cancel');` : ""}
    reset role;
    insert into _e2e_ids values (i, asg);
  end loop;
end $$;
select id from _e2e_ids order by n;
commit;
`);
  return out.split("\n").filter(Boolean) as [string, ...string[]];
}
