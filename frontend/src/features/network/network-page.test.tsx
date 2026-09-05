import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { createTranslator } from "@/lib/i18n/translate";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));

// `PendingReferralRow` posts to this "use server" action (via `PendingRowMenu`'s
// Withdraw form), which imports `getServerSupabase` (a real `server-only`
// module) — mocked so the test never pulls that import chain into a client
// render.
const cancelNetworkReferral = vi.fn(async () => {});
vi.mock("@/server/actions/network-referrals", () => ({
  cancelNetworkReferral: () => cancelNetworkReferral(),
  createExistingReferral: async () => {},
  createNewReferral: async () => {},
}));

import { NetworkPage } from "./network-page";
import { summarizeNetwork } from "@/lib/network/summary";
import { buildNetworkRows, filterNetworkRows, countNetworkRows, countReferralStats, type NetworkTab } from "@/lib/network/rows";
import type { NetworkOrganization } from "@/server/queries/network";
import type { NetworkReferral } from "@/server/queries/network-referrals";

const t = createTranslator("en");

const org = (over: Partial<NetworkOrganization> = {}): NetworkOrganization => ({
  orgId: Math.random().toString(36).slice(2),
  orgName: "Horizon Contracting",
  completedCount: 2,
  firstCompletedAt: "2026-06-01T00:00:00Z",
  lastCompletedAt: "2026-08-01T00:00:00Z",
  tradeKeys: ["marble_granite", "tiling"],
  latestJobTitle: "Tiling entrance hall - Zamalek",
  latestAssignmentId: "assignment-1",
  reviewCount: 1,
  ...over,
});

const referral = (over: Partial<NetworkReferral> = {}): NetworkReferral => ({
  id: Math.random().toString(36).slice(2),
  origin: "new_showroom",
  organizationId: null,
  organizationName: null,
  displayName: "Al Amal Marble Workshop",
  governorate: "Giza",
  city: "6th of October",
  phone: null,
  note: null,
  status: "pending",
  decisionReason: null,
  createdAt: "2026-07-01T00:00:00Z",
  decidedAt: null,
  ...over,
});

/** Mirrors the merge and filtering the route itself performs. */
const render = (
  organizations: NetworkOrganization[],
  referrals: NetworkReferral[] = [],
  opts: { q?: string; trade?: string; tab?: NetworkTab; locale?: "en" | "ar"; pointsBalance?: number } = {},
) => {
  const locale = opts.locale ?? "en";
  const tradeKeys = [...new Set(organizations.flatMap((o) => o.tradeKeys))].sort();
  const translator = locale === "en" ? t : createTranslator("ar");
  const q = opts.q ?? "";
  const trade = opts.trade ?? "";
  const tab = opts.tab ?? "all";

  const allRows = buildNetworkRows(organizations, referrals);
  const tabCounts = countNetworkRows(allRows);
  const byTab = filterNetworkRows(allRows, tab);
  const shown = byTab.filter((row) => {
    const name = row.kind === "organization" ? row.orgName : row.referral.displayName;
    if (q && !(name ?? "").toLowerCase().includes(q.toLowerCase())) return false;
    if (trade) {
      if (row.kind !== "organization" || !row.completedWork) return false;
      if (!row.completedWork.tradeKeys.includes(trade)) return false;
    }
    return true;
  });
  const { referredOrgsCount, showroomsAddedCount } = countReferralStats(referrals);

  return renderWithI18n(
    <NetworkPage
      rows={shown}
      summary={summarizeNetwork(organizations)}
      tab={tab}
      tabCounts={tabCounts}
      q={q}
      trade={trade}
      tradeOptions={tradeKeys.map((key) => ({ key, label: key }))}
      pointsBalance={opts.pointsBalance ?? 0}
      referredOrgsCount={referredOrgsCount}
      showroomsAddedCount={showroomsAddedCount}
      pendingPreview={referrals.filter((r) => r.status === "pending").slice(0, 3)}
      t={translator}
      locale={locale}
    />,
    locale,
  );
};

describe("NetworkPage", () => {
  it("explains where a network comes from when there is none yet", () => {
    render([]);
    expect(screen.getByText("No network yet")).toBeTruthy();
    expect(
      screen.getByText(/When an organization confirms work you have finished/),
    ).toBeTruthy();
  });

  it("always shows the referral hero, even with an empty network", () => {
    render([]);
    expect(screen.getByTestId("referral-hero")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add showroom I know" })).toBeTruthy();
  });

  it("shows real summary counts as one compact strip, not four cards", () => {
    render([
      org({ orgId: "a", completedCount: 2, tradeKeys: ["marble_granite", "tiling"] }),
      org({ orgId: "b", completedCount: 1, tradeKeys: ["marble_granite"] }),
    ]);
    expect(screen.getByTestId("kpi-strip")).toBeTruthy();
    expect(screen.getByText("Organizations worked with")).toBeTruthy();
    expect(screen.getAllByText("Completed assignments").length).toBeGreaterThan(0);
    expect(screen.getByText("Repeat organizations")).toBeTruthy();
    expect(screen.getByText("Trades represented")).toBeTruthy();
  });

  it("never inflates the summary with a pending or joined referral", () => {
    render(
      [org({ orgId: "a", completedCount: 1 })],
      [referral({ status: "pending" }), referral({ id: "r2", status: "joined", organizationId: "b", organizationName: "Nile Finishing Supplies" })],
    );
    const label = screen.getByText("Organizations worked with");
    const cell = label.parentElement?.parentElement;
    expect(cell?.textContent).toContain("1");
  });

  it("renders one row per unique organization, each linking to its own relationship detail route", () => {
    render([org({ orgId: "org-77", orgName: "Horizon Contracting" }), org({ orgId: "org-78", orgName: "Nile Finishing Supplies" })]);
    expect(screen.getAllByText("Horizon Contracting").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Nile Finishing Supplies").length).toBeGreaterThan(0);
    const links = screen.getAllByRole("link", { name: "View relationship" });
    expect(links.some((l) => l.getAttribute("href") === "/home/network/org-77")).toBe(true);
  });

  it("shows a pending referral as its own distinct row, never as a relationship", () => {
    render([], [referral({ displayName: "Al Amal Marble Workshop" })]);
    // Appears twice by design: once in the Directory, once in the Pending
    // Invitations rail preview — both real, neither a relationship.
    expect(screen.getAllByText("Al Amal Marble Workshop").length).toBeGreaterThan(0);
    expect(screen.getByText("Pending invitation")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "View relationship" })).toBeNull();
  });

  it("renders the four tabs with real counts inside the Directory", () => {
    render(
      [org({ orgId: "a" })],
      [referral({ status: "pending" })],
    );
    expect(screen.getByText("Network Directory")).toBeTruthy();
    expect(screen.getByRole("link", { name: /All/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Worked with/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Joined through my referral/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Pending invitations/ })).toBeTruthy();
  });

  it("says the filter matched nothing rather than claiming the network is empty", () => {
    render([org()], [], { q: "nonexistent" });
    expect(screen.getByText("No organizations match your filters.")).toBeTruthy();
    expect(screen.queryByText("No network yet")).toBeNull();
  });

  it("never shows Sales/CRM/social vocabulary", () => {
    const { container } = render([org()]);
    const text = container.textContent ?? "";
    for (const word of [
      "Sales", "CRM", "lead", "Lead", "opportunity", "Opportunity",
      "follow", "Follow", "friend", "Friend", "rating of", "recommendation score",
    ]) {
      expect(text).not.toContain(word);
    }
  });

  it("renders in Arabic with no key leak", () => {
    const { container } = render([org()], [], { locale: "ar" });
    expect(screen.getByText("شبكتي")).toBeTruthy();
    expect(container.textContent).not.toMatch(/network\.|profile\./);
  });
});

describe("NetworkPage — Network Directory (§5/§6/§9 of the visual-correction pass)", () => {
  it("shows an initial limit of rows inside ONE directory container, with the rest behind Show more", () => {
    render([
      org({ orgId: "a", orgName: "Org A" }),
      org({ orgId: "b", orgName: "Org B" }),
      org({ orgId: "c", orgName: "Org C" }),
      org({ orgId: "d", orgName: "Org D" }),
      org({ orgId: "e", orgName: "Org E" }),
      org({ orgId: "f", orgName: "Org F" }),
    ]);
    expect(screen.getAllByTestId("relationship-row")).toHaveLength(4);
    expect(screen.getByTestId("network-show-more")).toBeTruthy();
  });

  it("Show more reveals the remaining rows and then removes itself", () => {
    render([
      org({ orgId: "a" }), org({ orgId: "b" }), org({ orgId: "c" }),
      org({ orgId: "d" }), org({ orgId: "e" }),
    ]);
    fireEvent.click(screen.getByTestId("network-show-more"));
    expect(screen.getAllByTestId("relationship-row")).toHaveLength(5);
    expect(screen.queryByTestId("network-show-more")).toBeNull();
  });

  it("the rows sit inside a bounded, scrollable region, and the tabs stay outside it", () => {
    render([org({ orgId: "a" }), org({ orgId: "b" })]);
    const scroller = screen.getByTestId("network-list-scroll");
    expect(scroller.className).toMatch(/overflow-y-auto/);
    // The tabs render as links outside the scroll region's own subtree.
    const tabsLink = screen.getByRole("link", { name: /Worked with/ });
    expect(scroller.contains(tabsLink)).toBe(false);
  });

  it("carries a REAL desktop max-height on the scroll region — a bare, unprefixed cap would also clamp mobile, which must keep growing naturally (§18)", () => {
    render([org({ orgId: "a" }), org({ orgId: "b" })]);
    const scroller = screen.getByTestId("network-list-scroll");
    expect(scroller.className).toMatch(/desktop:max-h-\[/);
    // No bare `max-h-[...]` outside the `desktop:` variant.
    expect(scroller.className).not.toMatch(/(^|\s)max-h-\[/);
  });

  it("a large (20+) result set still renders every row after Show more — the cap bounds the BOX, not the data", () => {
    const many = Array.from({ length: 24 }, (_, i) => org({ orgId: `org-${i}`, orgName: `Org ${i}` }));
    render(many);
    fireEvent.click(screen.getByTestId("network-show-more"));
    expect(screen.getAllByTestId("relationship-row")).toHaveLength(24);
    expect(screen.queryByTestId("network-show-more")).toBeNull();
    // Still the same one bounded, scrollable region — not a second/replacement container.
    const scroller = screen.getByTestId("network-list-scroll");
    expect(scroller.className).toMatch(/overflow-y-auto/);
    expect(scroller.className).toMatch(/desktop:max-h-\[/);
  });

  it("does not render Show more when every row already fits", () => {
    render([org({ orgId: "a" }), org({ orgId: "b" })]);
    expect(screen.queryByTestId("network-show-more")).toBeNull();
  });
});

describe("NetworkPage — Points card (revisit §10/§11)", () => {
  it("shows the real balance and the real referred-organizations / showrooms-added counts", () => {
    render(
      [],
      [
        referral({ id: "r1", status: "joined", organizationId: "a", organizationName: "Horizon Contracting" }),
        referral({ id: "r2", origin: "new_showroom", status: "pending", organizationId: null, organizationName: null, displayName: "Al Amal Marble Workshop" }),
      ],
      { pointsBalance: 350 },
    );
    expect(screen.getByText("350")).toBeTruthy();
    expect(screen.getByText("Joined via you")).toBeTruthy();
    expect(screen.getByText("Showrooms added")).toBeTruthy();
  });

  it("derives and shows the level and the real remaining-to-next-level amount", () => {
    render([org()], [], { pointsBalance: 350 });
    // Level 3 at 350, 150 remaining to Level 4 — see lib/network/points-level.
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("150 Points remaining to next level")).toBeTruthy();
  });

  it("shows the intentional highest-level state at and above the top band, never a Level 6", () => {
    render([org()], [], { pointsBalance: 1200 });
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("Highest level reached")).toBeTruthy();
    expect(screen.queryByText(/remaining to next level/)).toBeNull();
  });

  it("no longer shows 'How Points work' as its own standalone panel", () => {
    render([org()]);
    expect(screen.queryByText("How Points work")).toBeNull();
    // The one real sentence about how Points are earned still lives in the hero.
    expect(screen.getByText(/\+100 Points when a new showroom you refer is approved/)).toBeTruthy();
  });
});

describe("NetworkPage — Pending Invitations panel (revisit §13/§14)", () => {
  it("places the real count beside 'View all invitations'", () => {
    render([], [referral({ status: "pending" })]);
    expect(screen.getByRole("link", { name: "View all invitations (1)" })).toBeTruthy();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error test-only cleanup of a jsdom global that has no type by default
    delete navigator.share;
  });

  it("Resend uses the Web Share API when it is available, and never withdraws the referral", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true });

    render([], [referral({ displayName: "Al Amal Marble Workshop", status: "pending" })]);
    const resend = screen.getAllByTestId("resend-button")[0]!;
    fireEvent.click(resend);

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const message = (share.mock.calls[0]?.[0] as { text: string }).text;
    expect(message).toContain("Al Amal Marble Workshop");
    expect(message).toContain("/auth/sign-up");
    expect(cancelNetworkReferral).not.toHaveBeenCalled();
    // The referral is still on the page — Resend did not withdraw it.
    expect(screen.getAllByText("Al Amal Marble Workshop").length).toBeGreaterThan(0);
  });

  it("falls back to a clipboard copy, with honest 'copied' wording, when the Web Share API is unavailable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render([], [referral({ displayName: "Al Amal Marble Workshop", status: "pending" })]);
    const resend = screen.getAllByTestId("resend-button")[0]!;
    fireEvent.click(resend);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]?.[0]).toContain("Al Amal Marble Workshop");
    const scope = resend.closest("li,div") as HTMLElement;
    await waitFor(() => expect(within(scope).queryByText(/Invitation copied|copied/i)).toBeTruthy());
  });
});

describe("NetworkPage — pending row overflow menu (revisit §8)", () => {
  it("moves Withdraw into a compact overflow menu rather than the row body", () => {
    render([], [referral({ status: "pending" })], { tab: "pending" as NetworkTab });
    expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Withdraw" })).toBeTruthy();
  });
});
