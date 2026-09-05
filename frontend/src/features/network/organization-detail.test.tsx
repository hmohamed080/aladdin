import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { createTranslator } from "@/lib/i18n/translate";
import { OrganizationDetail } from "./organization-detail";
import type { NetworkOrganization, NetworkWorkHistoryRow } from "@/server/queries/network";
import type { NetworkReferral } from "@/server/queries/network-referrals";
import type { OrganizationRow } from "@/lib/network/rows";

const t = createTranslator("en");

const org: NetworkOrganization = {
  orgId: "9a000000-aaaa-4aaa-8aaa-000000000005",
  orgName: "Horizon Contracting",
  completedCount: 2,
  firstCompletedAt: "2026-06-01T00:00:00Z",
  lastCompletedAt: "2026-08-01T00:00:00Z",
  tradeKeys: ["marble_granite", "tiling"],
  latestJobTitle: "Tiling entrance hall - Zamalek",
  latestAssignmentId: "assignment-2",
  reviewCount: 1,
};

const history: NetworkWorkHistoryRow[] = [
  {
    assignmentId: "assignment-1",
    orgId: org.orgId,
    orgName: org.orgName,
    jobTitle: "Marble foyer restoration - Zamalek",
    tradeKey: "marble_granite",
    agreedAmount: 5000,
    agreedCurrency: "EGP",
    completedAt: "2026-06-01T00:00:00Z",
  },
  {
    assignmentId: "assignment-2",
    orgId: org.orgId,
    orgName: org.orgName,
    jobTitle: "Tiling entrance hall - Zamalek",
    tradeKey: "tiling",
    agreedAmount: 6200,
    agreedCurrency: "EGP",
    completedAt: "2026-08-01T00:00:00Z",
  },
];

const workedWithRow: OrganizationRow = {
  kind: "organization",
  orgId: org.orgId,
  orgName: org.orgName,
  completedWork: org,
  referral: null,
};

const referral: NetworkReferral = {
  id: "ref-1",
  origin: "new_showroom",
  organizationId: "showroom-1",
  organizationName: "Al Amal Marble Workshop",
  displayName: "Al Amal Marble Workshop",
  governorate: "Giza",
  city: "6th of October",
  phone: "01099998888",
  note: null,
  status: "joined",
  decisionReason: null,
  createdAt: "2026-07-01T00:00:00Z",
  decidedAt: "2026-07-05T00:00:00Z",
};

const referralOnlyRow: OrganizationRow = {
  kind: "organization",
  orgId: "showroom-1",
  orgName: "Al Amal Marble Workshop",
  completedWork: null,
  referral,
};

const bothRow: OrganizationRow = {
  kind: "organization",
  orgId: org.orgId,
  orgName: org.orgName,
  completedWork: org,
  referral: { ...referral, organizationId: org.orgId, organizationName: org.orgName, origin: "known_organization", phone: null },
};

describe("OrganizationDetail — completed-work relationship", () => {
  it("shows the organization's safe identity", () => {
    renderWithI18n(
      <OrganizationDetail row={workedWithRow} history={history} reviewCount={1} t={t} locale="en" />,
      "en",
    );
    expect(screen.getByRole("heading", { name: "Horizon Contracting" })).toBeTruthy();
  });

  it("leads with a Verified work relationship badge", () => {
    renderWithI18n(
      <OrganizationDetail row={workedWithRow} history={history} reviewCount={1} t={t} locale="en" />,
      "en",
    );
    expect(screen.getByText("Verified work relationship")).toBeTruthy();
  });

  it("shows the real relationship summary — completed count, first/latest dates, trades", () => {
    renderWithI18n(
      <OrganizationDetail row={workedWithRow} history={history} reviewCount={1} t={t} locale="en" />,
      "en",
    );
    const summary = screen.getByTestId("relationship-summary");
    expect(summary.textContent).toContain("2");
    expect(summary.textContent).toMatch(/Marble & granite/);
    expect(summary.textContent).toMatch(/Tiling/);
  });

  it("links every history entry to the caller's own My Work assignment record", () => {
    renderWithI18n(
      <OrganizationDetail row={workedWithRow} history={history} reviewCount={1} t={t} locale="en" />,
      "en",
    );
    const links = screen.getAllByRole("link", { name: "View in My work" });
    const hrefs = links.map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/home/work/assignment-1");
    expect(hrefs).toContain("/home/work/assignment-2");
  });

  it("shows a compact review indication only when a visible review exists", () => {
    renderWithI18n(
      <OrganizationDetail row={workedWithRow} history={history} reviewCount={1} t={t} locale="en" />,
      "en",
    );
    expect(screen.getByText("1 reviews from this organization")).toBeTruthy();
  });

  it("omits the review line entirely when there is none — reviews are never required", () => {
    renderWithI18n(
      <OrganizationDetail row={workedWithRow} history={history} reviewCount={0} t={t} locale="en" />,
      "en",
    );
    expect(screen.queryByText(/reviews from this organization/)).toBeNull();
  });

  it("never shows an organization rating or CRM-style relationship score", () => {
    const { container } = renderWithI18n(
      <OrganizationDetail row={workedWithRow} history={history} reviewCount={1} t={t} locale="en" />,
      "en",
    );
    const text = container.textContent ?? "";
    for (const word of ["relationship score", "CRM", "stage", "unpaid balance", "revenue"]) {
      expect(text).not.toContain(word);
    }
  });

  it("never shows a Call action for an organization the caller only worked for — no organization phone exists in this product", () => {
    renderWithI18n(
      <OrganizationDetail row={workedWithRow} history={history} reviewCount={1} t={t} locale="en" />,
      "en",
    );
    expect(screen.queryByRole("link", { name: /Call/ })).toBeNull();
  });

  it("shows the Message coming-soon slot, disabled, never a fake conversation", () => {
    renderWithI18n(
      <OrganizationDetail row={workedWithRow} history={history} reviewCount={1} t={t} locale="en" />,
      "en",
    );
    const message = screen.getByText("Message · Coming soon");
    expect(message.closest("[aria-disabled='true']")).toBeTruthy();
  });

  it("resolves mixed-direction identity and job titles with dir=auto", () => {
    const { container } = renderWithI18n(
      <OrganizationDetail row={workedWithRow} history={history} reviewCount={1} t={t} locale="ar" />,
      "ar",
    );
    const nodes = container.querySelectorAll("[dir]");
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(node.getAttribute("dir")).toBe("auto");
    }
  });
});

describe("OrganizationDetail — referral-only (no completed work yet)", () => {
  it("shows a Joined through your referral badge, never Verified work relationship", () => {
    renderWithI18n(
      <OrganizationDetail row={referralOnlyRow} history={[]} reviewCount={0} t={t} locale="en" />,
      "en",
    );
    expect(screen.getByText("Joined through your referral")).toBeTruthy();
    expect(screen.queryByText("Verified work relationship")).toBeNull();
  });

  it("shows no fake completed-work figures — the relationship summary panel does not render", () => {
    renderWithI18n(
      <OrganizationDetail row={referralOnlyRow} history={[]} reviewCount={0} t={t} locale="en" />,
      "en",
    );
    expect(screen.queryByTestId("relationship-summary")).toBeNull();
    expect(screen.getByTestId("referral-only-summary")).toBeTruthy();
  });

  it("shows Call using the REFERRER'S OWN typed phone for a not-yet-registered showroom", () => {
    renderWithI18n(
      <OrganizationDetail row={referralOnlyRow} history={[]} reviewCount={0} t={t} locale="en" />,
      "en",
    );
    const call = screen.getByRole("link", { name: /Call/ });
    expect(call.getAttribute("href")).toBe("tel:01099998888");
  });
});

describe("OrganizationDetail — both a referral and completed work coexist", () => {
  it("leads with Verified work relationship and notes the referral as secondary context", () => {
    renderWithI18n(
      <OrganizationDetail row={bothRow} history={history} reviewCount={0} t={t} locale="en" />,
      "en",
    );
    expect(screen.getByText("Verified work relationship")).toBeTruthy();
    // Secondary context, not a second equal badge (§10's "avoid badge overload").
    expect(screen.queryByText("Joined through your referral")).toBeNull();
    expect(screen.getByText("Also joined through your referral")).toBeTruthy();
  });

  it("does not show Call for a KNOWN-organization referral — case A never collects a phone", () => {
    renderWithI18n(
      <OrganizationDetail row={bothRow} history={history} reviewCount={0} t={t} locale="en" />,
      "en",
    );
    expect(screen.queryByRole("link", { name: /Call/ })).toBeNull();
  });
});
