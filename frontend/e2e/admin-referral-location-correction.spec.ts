import { execFileSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
import { registerWithPassword, signIn } from "./helpers/auth";
import { en } from "../src/lib/i18n/messages/en";

/**
 * Wiring test for the Admin's referral location correction (migration 20261011090003).
 *
 * A referral whose location is internally inconsistent (a city of another governorate) cannot become a business until the Admin corrects
 * it. This drives the REAL Admin UI: approve-as-new -> refused with the location message and nothing created -> the Admin enters the
 * corrected governorate + city -> exactly one organization with the Admin-confirmed legal name and the canonical branch location.
 */
const ADMIN = "admin@example.test";
const DB = process.env.E2E_DB_CONTAINER ?? "supabase_db_aladdin";

function sql(query: string): string {
  // No shell: the container name and psql flags are separate arguments, the SQL goes in on stdin.
  return execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-At"], { input: query }).toString().trim();
}

async function english(page: Page) {
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: "http://127.0.0.1" }]);
}

test.describe("Admin referral location correction", () => {
  test("an inconsistent referral location is refused, then corrected by the Admin, end to end", async ({ page, request }) => {
    await english(page);
    const stamp = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
    const email = `locfix-${stamp}@example.test`;
    await registerWithPassword(page, request, {
      email,
      displayName: "Location Fix Referrer",
      accountType: /sales team/i,
      landing: /\/home(\/|$|\?)/,
    });
    const userId = sql(`select id from auth.users where email = '${email}'`);
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);

    // The referral form only offers consistent pairs, so an inconsistent one is seeded the way an older client could have written it.
    const showroom = `Mansoura Tiles ${stamp}`;
    sql(`insert into public.organization_referrals (referred_by, display_name, org_type, governorate, city, primary_branch_name, status)
         values ('${userId}', '${showroom}', 'showroom_dealer', 'cairo', 'mansoura', 'Main Branch', 'submitted')`);
    const orgCount = () => Number(sql(`select count(*) from public.organizations where name = '${showroom}'`));
    expect(orgCount()).toBe(0);

    await page.context().clearCookies();
    await english(page);
    await signIn(page, request, ADMIN, /\/admin(\/|$)/);
    await page.goto("/admin/verifications");
    const card = page.getByRole("listitem").filter({ hasText: showroom });
    await expect(card).toBeVisible();

    // Approve-as-new needs the legal / registered name, and it is required.
    const legal = card.getByLabel(/legal \/ registered name/i);
    await expect(legal).toBeVisible();
    await expect(legal).toHaveAttribute("required", "");
    const legalName = `Mansoura Tiles Trading ${stamp} LLC`;
    await legal.fill(legalName);

    // 1. without correcting the location: refused, message shown, nothing created.
    await card.getByRole("button", { name: /approve as a new business/i }).click();
    await page.waitForURL(/error=location/, { waitUntil: "commit" });
    await expect(page.getByRole("alert").filter({ hasText: en.admin.referrals.locationInvalid })).toBeVisible();
    expect(orgCount()).toBe(0);
    expect(sql(`select status from public.organization_referrals where display_name = '${showroom}'`)).toBe("submitted");

    // 2. the Admin corrects governorate + city and approves.
    const again = page.getByRole("listitem").filter({ hasText: showroom });
    await again.getByLabel(/legal \/ registered name/i).fill(legalName);
    await again.locator('select[name="governorate"]').selectOption("dakahlia");
    await again.locator('input[name="city"]').fill("Mansoura");
    await again.getByRole("button", { name: /approve as a new business/i }).click();
    await page.waitForURL(/referral=approved/, { waitUntil: "commit" });

    // Exactly one organization, carrying the Admin-confirmed legal name.
    expect(orgCount()).toBe(1);
    const org = `(select id from public.organizations where name = '${showroom}')`;
    expect(sql(`select legal_name from public.organizations where id = ${org}`)).toBe(legalName);

    // The primary branch: canonical Dakahlia / Mansoura, no custom name.
    const mansoura = sql(`select app.resolve_city('dakahlia', 'mansoura')`);
    expect(mansoura).not.toBe("");
    expect(sql(`select governorate_key || '|' || coalesce(city_key, 'NULL') || '|' || coalesce(city_custom_name, 'NULL')
                from public.branches where organization_id = ${org}`)).toBe(`dakahlia|${mansoura}|NULL`);

    // Provenance unchanged; the referrer is a Sales member, never an Owner; Points unchanged (+100, once).
    expect(sql(`select source || '|' || referred_by_user_id from public.organizations where id = ${org}`)).toBe(`salesperson_referral|${userId}`);
    expect(sql(`select count(*) from public.memberships where organization_id = ${org} and user_id = '${userId}' and status = 'active'`)).toBe("1");
    expect(sql(`select count(*) from public.membership_capabilities c join public.memberships m on m.id = c.membership_id
                where m.organization_id = ${org} and c.capability_key in ('org.manage', 'org.members.manage')`)).toBe("0");
    expect(sql(`select count(*) from public.memberships m where m.organization_id = ${org}
                and exists (select 1 from public.membership_capabilities c where c.membership_id = m.id and c.capability_key = 'org.manage')`)).toBe("0");
    expect(sql(`select coalesce(sum(points_delta), 0) from public.points_ledger where user_id = '${userId}'`)).toBe("100");
  });
});
