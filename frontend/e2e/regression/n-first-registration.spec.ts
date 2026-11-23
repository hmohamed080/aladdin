import { test, expect, type Page } from "@playwright/test";
import { E2E_PASSWORD, IDENTITIES, accountTypeOptions, registerWithPassword, selectAccountType, signIn, waitForCaptchaToken } from "../helpers/auth";
import { psql, signedInClient } from "./setup";
import { open, prefs } from "./util";

/**
 * BATCH N (B3-D) - first registration and onboarding of a Showroom, end to end through the real screens.
 *
 * Real: /auth/sign-up (Turnstile test key), Email OTP read from the local Mailpit inbox (MAILPIT_URL, port 59324 on this
 * stack), the real first-business wizard, and the real Admin review RPCs for the decisions. Nothing bypasses
 * authentication or review. Not verified here: delivery of mail by a real provider (the local inbox stands in for it).
 */
test.describe.configure({ mode: "serial" });

const q = (s: string) => psql(s).trim();
const RUN = Date.now().toString(36);
const EMAIL = `reg-first-${RUN}@example.test`;
const SHOWROOM = `Nile Tiles ${RUN}`;
const SUITE = "/showroom";
const uid = () => q(`select id from auth.users where email = '${EMAIL}'`);
/** A cold `next dev` compile of a wizard route can exceed the default 60 s navigation timeout. */
async function openSlow(page: Page, route: string) {
  await page.goto(route, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForLoadState("load");
}
const orgByName = (name: string) => q(`select id from public.organizations where name = '${name}' limit 1`);

test("N1 the sign-up form: Showroom is selectable, Coming Soon types are disabled, invalid input cannot be submitted", async ({ page }) => {
  await prefs(page, { locale: "en" });
  await open(page, "/auth/sign-up");
  const real = (await accountTypeOptions(page)).filter((o) => o.text && !/^choose an account type$/i.test(o.text));
  expect(real.map((o) => o.text), "the offered account types, in order").toEqual(expect.arrayContaining([expect.stringMatching(/showroom/i), expect.stringMatching(/supplier/i)]));
  expect(real.length, "the nine canonical account types").toBe(9);
  const byText = (re: RegExp) => real.find((o) => re.test(o.text));
  expect(byText(/showroom/i)?.disabled, "Showroom").toBe(false);
  expect(byText(/supplier/i)?.disabled, "Supplier").toBe(false);
  expect(byText(/contractor/i)?.disabled, "Contractor is Coming Soon").toBe(true);
  expect(byText(/engineer/i)?.disabled, "Engineer is Coming Soon").toBe(true);
  expect(real.some((o) => /installer|interior|wholesaler|trainer|trainee/i.test(o.text)), "retired types are gone").toBe(false);

  // client validation: nothing is submitted for a mismatched/weak password or missing consents
  await page.getByLabel(/^full name$/i).fill("Validation Tester");
  await page.getByLabel(/^email address$/i).fill("not-an-email");
  await selectAccountType(page, /showroom/i);
  await page.getByLabel(/^password$/i).fill("short");
  await page.getByLabel(/confirm password/i).fill("different");
  // the submit control stays disabled until every field is valid and the consents are given
  await expect(page.getByRole("button", { name: /create account/i })).toBeDisabled();
  await expect(page.getByText(/next step/i)).toHaveCount(0);
  expect(q(`select count(*) from auth.users where email = 'not-an-email'`)).toBe("0");
});

test("N2 first registration as a Showroom: Email OTP verifies the account, and there is no business workspace yet", async ({ page, request }) => {
  test.setTimeout(240_000);
  await prefs(page, { locale: "en" });
  await registerWithPassword(page, request, {
    email: EMAIL,
    displayName: `First ${RUN}`,
    accountType: /showroom/i,
    landing: /\/(home|b2b|onboarding|business)(\/|$|\?)/,
  });
  // the account exists, is verified by the OTP, and carries the chosen intent; there is no organization and no membership
  expect(q(`select email_confirmed_at is not null from auth.users where email = '${EMAIL}'`)).toBe("t");
  expect(q(`select coalesce(primary_account_type::text, '') from public.users where id = '${uid()}'`)).toMatch(/showroom|^$/);
  expect(q(`select count(*) from public.memberships where user_id = '${uid()}'`)).toBe("0");
  expect(q(`select count(*) from public.organizations o join public.memberships m on m.organization_id = o.id where m.user_id = '${uid()}'`)).toBe("0");
  const me = await signedInClient(EMAIL);
  expect(((await me.rpc("my_workspaces")).data as Array<{ kind: string }>).filter((w) => w.kind === "business")).toHaveLength(0);
  // no Showroom workspace without an approved organization
  await page.goto(`${SUITE}/home`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("showroom-quotes")).toHaveCount(0);
  await expect(page).not.toHaveURL(new RegExp(`${SUITE}/home`));
  // a duplicate registration with the same email is refused
  await page.context().clearCookies();
  await prefs(page, { locale: "en" });
  await open(page, "/auth/sign-up");
  await page.getByLabel(/^full name$/i).fill("Duplicate");
  await page.getByLabel(/^email address$/i).fill(EMAIL);
  await selectAccountType(page, /showroom/i);
  await page.getByLabel(/^password$/i).fill(E2E_PASSWORD);
  await page.getByLabel(/confirm password/i).fill(E2E_PASSWORD);
  await page.getByLabel(/terms of service/i).check();
  await page.getByLabel(/privacy policy/i).check();
  await page.getByLabel(/pilot release/i).check();
  await waitForCaptchaToken(page);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForTimeout(3000);
  expect(q(`select count(*) from auth.users where email = '${EMAIL}'`), "still one account for this email").toBe("1");
});

test("N3 first organization application: the 250-character Business Description rule, then pending Admin review, never a workspace", async ({ page, request }) => {
  test.setTimeout(300_000);
  await prefs(page, { locale: "en" });
  await signIn(page, request, EMAIL, /\/(home|b2b|onboarding|business)(\/|$|\?)/);
  await openSlow(page, "/business/new");
  await page.getByLabel(/^business name$/i).fill(SHOWROOM);
  await page.locator("#bdesc").fill("د".repeat(251));
  await expect(page.getByTestId("business-description-count-figure")).toHaveText("251/250");
  await expect(page.getByRole("button", { name: /^continue$/i })).toBeDisabled();
  await page.locator("#bdesc").fill("د".repeat(249) + "😀");
  await expect(page.getByTestId("business-description-count-figure")).toHaveText("250/250");
  await page.getByRole("button", { name: /^continue$/i }).click();
  // walk the wizard to the review step (the Showroom type comes from the sign-up intent; the remaining steps are optional)
  const submit = page.getByRole("button", { name: /submit for review/i });
  const next = page.getByRole("button", { name: /^continue$/i });
  for (let i = 0; i < 8; i += 1) {
    await expect(submit.or(next).first()).toBeVisible();
    if (await submit.isVisible()) break;
    await next.click();
    await page.waitForLoadState("networkidle");
  }
  await page.getByRole("button", { name: /submit for review/i }).click();
  await page.waitForURL(/\/business\/applications/, { timeout: 60_000 });

  const org = orgByName(SHOWROOM);
  expect(org).toMatch(/^[0-9a-f-]{36}$/);
  expect(q(`select char_length(description) from public.organizations where id = '${org}'`), "the description reached the organization untruncated").toBe("250");
  expect(q(`select org_type from public.organizations where id = '${org}'`)).toBe("showroom_dealer");
  const verification = q(`select status from public.verifications where organization_id = '${org}' and subject_type = 'organization' order by submitted_at desc limit 1`);
  expect(["submitted", "under_review"]).toContain(verification);
  await expect(page.getByTestId("application-pending_review")).toBeVisible();
  await expect(page.getByTestId("not-a-workspace-note")).toBeVisible();
  await expect(page.getByRole("button", { name: /open workspace/i })).toHaveCount(0);

  // BEFORE approval: no business workspace anywhere
  const me = await signedInClient(EMAIL);
  // the pending organization is listed for the applications screen but flagged not approved: it is never an active workspace
  const entries = ((await me.rpc("my_workspaces")).data as Array<{ kind: string; is_approved: boolean }>).filter((w) => w.kind === "business");
  expect(entries.filter((w) => w.is_approved), "no approved business workspace before review").toHaveLength(0);
  await page.goto(`${SUITE}/home`);
  await page.waitForLoadState("networkidle");
  await expect(page).not.toHaveURL(new RegExp(`${SUITE}/home`));
  // the applicant cannot approve their own application
  const vid = q(`select id from public.verifications where organization_id = '${org}' and subject_type = 'organization' order by submitted_at desc limit 1`);
  expect((await me.rpc("review_approve", { p_verification_id: vid, p_grant_public_listing: false })).error?.code, "self-approval").toBe("42501");
  // and another business owner cannot see or decide it
  const rania = await signedInClient(IDENTITIES.distributor);
  expect((await rania.rpc("review_approve", { p_verification_id: vid, p_grant_public_listing: false })).error?.code).toBe("42501");
  expect((await rania.from("verifications").select("id").eq("id", vid)).data ?? []).toHaveLength(0);
});

test("N4 Admin requests changes, the applicant sees the reason; after approval the Showroom workspace opens", async ({ page, request }) => {
  test.setTimeout(300_000);
  await prefs(page, { locale: "en" });
  const org = orgByName(SHOWROOM);
  const admin = await signedInClient(IDENTITIES.admin);
  const vid = () => q(`select id from public.verifications where organization_id = '${org}' and subject_type = 'organization' order by submitted_at desc limit 1`);
  expect((await admin.rpc("review_start", { p_verification_id: vid() })).error).toBeNull();
  expect((await admin.rpc("review_request_changes", { p_verification_id: vid(), p_reason: "Please add the commercial register number." })).error).toBeNull();

  await signIn(page, request, EMAIL, /\/(home|b2b|onboarding|business)(\/|$|\?)/);
  await openSlow(page, "/business/applications");
  await expect(page.getByText(/commercial register number/i).first()).toBeVisible();
  const me = await signedInClient(EMAIL);
  expect(((await me.rpc("my_workspaces")).data as Array<{ kind: string; is_approved: boolean }>).filter((w) => w.kind === "business" && w.is_approved), "needs-changes grants nothing").toHaveLength(0);

  // the applicant resubmits through the supported UI action (this failed before migration 20261015090047: the guard made
  // submitted_at immutable while the RPC rewrote it, so every Resubmit ended in "That didn't work")
  await page.getByRole("button", { name: "Resubmit" }).click();
  await expect.poll(() => q(`select status from public.verifications where id = '${vid()}'`), { timeout: 20_000 }).toBe("submitted");
  await expect(page.getByText("That didn't work. Please try again.")).toHaveCount(0);
  const status = q(`select status from public.verifications where id = '${vid()}'`);
  if (status === "submitted") expect((await admin.rpc("review_start", { p_verification_id: vid() })).error).toBeNull();
  expect((await admin.rpc("review_approve", { p_verification_id: vid(), p_grant_public_listing: false })).error).toBeNull();

  // AFTER approval: the application is approved and the V2 Showroom workspace opens for the owner
  expect(q(`select status from public.organizations where id = '${org}'`)).toBe("active");
  expect(q(`select count(*) from public.memberships where user_id = '${uid()}' and organization_id = '${org}' and status = 'active'`)).toBe("1");
  await page.goto(`${SUITE}/home`);
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(new RegExp(`${SUITE}/home`));
  await expect(page.getByText(SHOWROOM).first()).toBeVisible();
  // approval is audited
  expect(Number(q(`select count(*) from public.audit_log where subject_id = '${vid()}' and action = 'verification.approved'`))).toBeGreaterThanOrEqual(1);
});
