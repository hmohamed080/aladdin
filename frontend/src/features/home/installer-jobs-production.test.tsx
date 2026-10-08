import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createElement, type ImgHTMLAttributes } from "react";
import Link from "next/link";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import type { MatchBreakdown } from "@/lib/installer/overall-match";
import type { JobCardVM } from "@/features/installer-job-opportunities-preview/view-model";
import { DEFAULT_BOARD_FILTERS } from "@/features/installer-job-opportunities-preview/view-model";
import { I18nProvider } from "@/lib/i18n/context";
import { InstallerJobsBoard } from "./installer-jobs-board";

/**
 * The PRODUCTION Jobs board (`/home/jobs`): one approved presentation, only real capabilities — Match, Saved, URL-driven
 * filters, and keyset "View more / Show fewer" paging. (My Work has its own file: `installer-work-production.test.tsx`.)
 */

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), path: "/home/jobs" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: nav.refresh }),
}));
const actions = vi.hoisted(() => ({
  loadMoreJobs: vi.fn(),
  setJobSaved: vi.fn(),
}));
vi.mock("@/server/actions/saved-jobs", () => ({ setJobSavedAction: actions.setJobSaved }));
vi.mock("@/server/actions/job-board", () => ({ loadMoreJobsAction: actions.loadMoreJobs }));
vi.mock("next/image", () => ({
  default: ({ fill: _fill, priority: _priority, sizes: _sizes, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean; sizes?: string }) => {
    void _fill; void _priority; void _sizes;
    return createElement("img", { ...props, alt: props.alt ?? "" });
  },
}));

function job(over: Partial<JobCardVM> = {}): JobCardVM {
  return {
    id: "j1", title: "Install SPC flooring", org: "Modern Floors", place: "New Cairo، Cairo", tradeKey: "flooring",
    tradeLabel: "Flooring", durationDays: 3, amount: 4500, postedLabel: "Posted 2 hours ago", image: null,
    hasApplied: false, href: "/home/jobs/j1", distanceKm: null, matchPercent: null, match: null, ...over,
  };
}

function board(over: Partial<React.ComponentProps<typeof InstallerJobsBoard>> = {}) {
  return (
    <InstallerJobsBoard
      opportunities={[job(), job({ id: "j2", title: "Paint a flat", hasApplied: true, amount: null, href: "/home/jobs/j2" })]}
      filters={DEFAULT_BOARD_FILTERS}
      sort="newest"
      search=""
      tradeOptions={[{ key: "flooring", label: "Flooring" }, { key: "painting", label: "Painting" }]}
      total={2}
      nextCursor={null}
      savedIds={[]}
      savedCount={0}
      unavailableSaved={0}
      subtitle="Work that organizations are hiring for."
      headerAction={<Link href="/home/jobs/applications">My applications</Link>}
      {...over}
    />
  );
}

beforeEach(() => {
  nav.replace.mockClear();
  nav.refresh.mockClear();
  nav.path = "/home/jobs";
  actions.loadMoreJobs.mockReset();
  actions.setJobSaved.mockReset().mockResolvedValue({ ok: true });
});

describe("production Jobs board — one approved presentation, only real capabilities", () => {
  it("renders the real cards with the trade illustration, never a photo", () => {
    const { container } = renderWithI18n(board(), "en");
    expect(screen.getAllByTestId("job-card")).toHaveLength(2);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(0);
  });

  it("exposes no preview-only affordance: no distance, map, radius, slider, New badge or local Apply", () => {
    const { container } = renderWithI18n(board(), "en");
    expect(screen.queryByText(/skill match/i)).toBeNull();
    expect(screen.queryByText(/\bkm\b/)).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.queryByText(/distance radius|Within \d+ km/i)).toBeNull();
    expect(screen.queryByText(/^new$/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^apply now$/i })).toBeNull();
  });

  it("has no redundant 'Apply filters' button — filters are live — but keeps Clear all and the mobile Filters opener", () => {
    renderWithI18n(board(), "en");
    expect(screen.queryByRole("button", { name: /apply filters/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Clear all" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filters" })).toBeTruthy();
  });

  it("the results area is its OWN scroll region on desktop, so more cards never lengthen the page", () => {
    renderWithI18n(board(), "en");
    const results = screen.getByTestId("job-results");
    expect(results.className).toContain("wide:overflow-y-auto");
    expect(results.className).toContain("wide:h-full");
    expect(results.parentElement!.className).toMatch(/wide:h-\[calc\(100dvh-/);
  });

  it("the application-state filter says 'All opportunities' by default, with the same real choices", () => {
    renderWithI18n(board(), "en");
    const trigger = screen.getByRole("button", { name: "My applications" });
    expect(trigger.textContent).toBe("All opportunities");
    fireEvent.click(trigger);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["All opportunities", "Not applied yet", "Already applied"]);
    fireEvent.click(screen.getByRole("option", { name: "Already applied" }));
    expect(nav.replace).toHaveBeenCalledWith("/home/jobs?applied=yes", { scroll: false });
  });

  describe("Overall Match — the canonical database breakdown, drawn and never recomputed", () => {
    const match = (percent: number, over: Partial<MatchBreakdown> = {}): MatchBreakdown => ({
      overallPercent: percent, tradePoints: 50, specialtyPoints: 20, locationPoints: 15, availabilityPoints: 15,
      tradeReason: "trade_matches", specialtyReason: "no_specialty_required", locationReason: "same_city", availabilityReason: "available_no_dates", ...over,
    });
    const withMatch = (percent: number, over: Partial<MatchBreakdown> = {}) => job({ matchPercent: percent, match: match(percent, over) });

    it.each([[0, "Low match"], [39, "Low match"], [40, "Partial match"], [59, "Partial match"], [60, "Good match"], [74, "Good match"], [75, "Strong match"], [89, "Strong match"], [90, "Excellent match"], [100, "Excellent match"]])(
      "%i%% is named '%s' in its breakdown",
      (percent, level) => {
        renderWithI18n(board({ opportunities: [withMatch(percent)] }), "en");
        const badge = screen.getByTestId("match-badge");
        expect(badge.textContent).toBe(`Overall Match ${percent}%`);
        fireEvent.click(badge);
        expect(within(screen.getByTestId("match-breakdown")).getByText(new RegExp(level))).toBeTruthy();
      },
    );

    it("is worded in Arabic with the approved level names", () => {
      renderWithI18n(board({ opportunities: [withMatch(92)] }), "ar");
      expect(screen.getByTestId("match-badge").textContent).toContain("نسبة التوافق");
      fireEvent.click(screen.getByTestId("match-badge"));
      expect(screen.getByTestId("match-breakdown").textContent).toContain("توافق ممتاز");
      expect(screen.queryByText(/مناسب لمهاراتك/)).toBeNull();
    });

    it("the breakdown shows each component's own points and reason — met and not met", () => {
      renderWithI18n(board({ opportunities: [withMatch(65, { tradePoints: 50, specialtyPoints: 0, specialtyReason: "specialty_missing", locationPoints: 5, locationReason: "other_service_area", availabilityPoints: 10 + 0, availabilityReason: "window_covers" })] }), "en");
      fireEvent.click(screen.getByTestId("match-badge"));
      const panel = screen.getByTestId("match-breakdown");
      expect(within(panel).getByTestId("match-line-specialty")).toHaveTextContent("You don't have the required specialty");
      expect(within(panel).getByTestId("match-line-specialty")).toHaveTextContent("0/20");
      expect(within(panel).getByTestId("match-line-location")).toHaveTextContent("In another area you serve");
      expect(within(panel).getByTestId("match-line-location")).toHaveTextContent("5/15");
      expect(within(panel).getByTestId("match-line-specialty").getAttribute("data-reason")).toBe("specialty_missing");
    });

    it("a match of 0 never gates anything: the card is still listed, and Details and Apply now still work", () => {
      renderWithI18n(board({ opportunities: [withMatch(0, { tradePoints: 0, specialtyPoints: 0, locationPoints: 0, availabilityPoints: 0, tradeReason: "trade_mismatch", specialtyReason: "trade_mismatch", locationReason: "outside_service_area", availabilityReason: "not_available_for_work" })] }), "en");
      const card = screen.getByTestId("job-card");
      expect(within(card).getByTestId("match-badge").textContent).toBe("Overall Match 0%");
      expect(within(card).getByRole("link", { name: "Details" })).toHaveAttribute("href", "/home/jobs/j1");
      expect(within(card).getByRole("link", { name: "Apply now" })).toHaveAttribute("href", "/home/jobs/j1?apply=1");
      expect(within(card).getByRole("button", { name: "Save opportunity" })).not.toBeDisabled();
    });

    it("a job with no match shows no badge — never a guess", () => {
      renderWithI18n(board({ opportunities: [job({ matchPercent: null, match: null })] }), "en");
      expect(screen.queryByTestId("match-badge")).toBeNull();
    });
  });

  describe("saved opportunities — persisted, not local", () => {
    it("shows the real saved count beside My applications, and the filter is saved=1 in the URL", () => {
      renderWithI18n(board({ savedCount: 3 }), "en");
      const saved = screen.getByRole("button", { name: /saved opportunities/i });
      expect(saved).toHaveAttribute("aria-pressed", "false");
      expect(within(saved).getByTestId("saved-count").textContent).toBe("3");
      expect(screen.getByRole("link", { name: "My applications" })).toHaveAttribute("href", "/home/jobs/applications");
      fireEvent.click(saved);
      expect(nav.replace).toHaveBeenCalledWith("/home/jobs?saved=1", { scroll: false });
    });

    it("is pressed while the saved filter is on, and a second press leaves it", () => {
      renderWithI18n(board({ filters: { ...DEFAULT_BOARD_FILTERS, saved: true }, savedCount: 1 }), "en");
      const saved = screen.getByRole("button", { name: /saved opportunities/i });
      expect(saved).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(saved);
      expect(nav.replace).toHaveBeenCalledWith("/home/jobs", { scroll: false });
    });

    it("each heart reflects the REAL saved state through aria-pressed", () => {
      renderWithI18n(board({ savedIds: ["j2"], savedCount: 1 }), "en");
      const [first, second] = screen.getAllByTestId("job-card");
      expect(within(first!).getByRole("button", { name: "Save opportunity" })).toHaveAttribute("aria-pressed", "false");
      expect(within(second!).getByRole("button", { name: "Remove from saved jobs" })).toHaveAttribute("aria-pressed", "true");
    });

    it("saving calls the real action, shows the new state and count at once, then refreshes from the server", async () => {
      renderWithI18n(board(), "en");
      const [first] = screen.getAllByTestId("job-card");
      fireEvent.click(within(first!).getByRole("button", { name: "Save opportunity" }));
      expect(actions.setJobSaved).toHaveBeenCalledWith("j1", true);
      expect(within(first!).getByRole("button", { name: "Remove from saved jobs" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("saved-count").textContent).toBe("1");
      await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
    });

    it("unsaving calls the real action with saved=false", async () => {
      renderWithI18n(board({ savedIds: ["j1"], savedCount: 1 }), "en");
      const [first] = screen.getAllByTestId("job-card");
      fireEvent.click(within(first!).getByRole("button", { name: "Remove from saved jobs" }));
      expect(actions.setJobSaved).toHaveBeenCalledWith("j1", false);
      await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
      expect(screen.getByTestId("saved-count").textContent).toBe("0");
    });

    it("a failed save reverts the heart and the count and says so (role=alert) — it never pretends to persist", async () => {
      actions.setJobSaved.mockResolvedValue({ ok: false });
      renderWithI18n(board(), "en");
      const [first] = screen.getAllByTestId("job-card");
      fireEvent.click(within(first!).getByRole("button", { name: "Save opportunity" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/could not update your saved opportunities/i);
      expect(within(first!).getByRole("button", { name: "Save opportunity" })).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByTestId("saved-count").textContent).toBe("0");
      expect(nav.refresh).not.toHaveBeenCalled();
    });

    it("says how many saved jobs are no longer available, only while looking at the saved list", () => {
      const { unmount } = renderWithI18n(board({ filters: { ...DEFAULT_BOARD_FILTERS, saved: true }, savedCount: 1, unavailableSaved: 2 }), "en");
      expect(screen.getByText("2 of your saved opportunities are no longer available.")).toBeTruthy();
      unmount();
      renderWithI18n(board({ unavailableSaved: 2 }), "en");
      expect(screen.queryByText(/no longer available/)).toBeNull();
    });

    it("an empty saved list explains how to save, instead of showing the generic empty board", () => {
      renderWithI18n(board({ opportunities: [], filters: { ...DEFAULT_BOARD_FILTERS, saved: true } }), "en");
      expect(screen.getByText("No saved opportunities")).toBeTruthy();
    });
  });

  it("offers Newest, Highest pay and Nearest (a city/governorate tier) — never a demo sort", () => {
    renderWithI18n(board(), "en");
    const group = screen.getByRole("group", { name: "Sort opportunities" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["Newest", "Highest pay", "Nearest"]);
    expect(screen.queryByRole("button", { name: "Most requested" })).toBeNull();
  });

  it("gives each card two separate actions that lead to the real detail / apply flow", () => {
    renderWithI18n(board(), "en");
    const [first] = screen.getAllByTestId("job-card");
    expect(within(first!).getByRole("link", { name: "Details" })).toHaveAttribute("href", "/home/jobs/j1");
    // Apply now is a link into the real confirmation — never a local "applied" flip.
    expect(within(first!).getByRole("link", { name: "Apply now" })).toHaveAttribute("href", "/home/jobs/j1?apply=1");
    fireEvent.click(within(first!).getByRole("link", { name: "Apply now" }));
    expect(within(first!).queryByText("You applied")).toBeNull();
  });

  it("an already-applied card shows the real applied state and no Apply now", () => {
    renderWithI18n(board(), "en");
    const second = screen.getAllByTestId("job-card")[1]!;
    expect(within(second).getByText("You applied")).toBeTruthy();
    expect(within(second).queryByRole("link", { name: "Apply now" })).toBeNull();
    expect(within(second).getByRole("link", { name: "Details" })).toHaveAttribute("href", "/home/jobs/j2");
  });

  it("states a missing budget honestly and formats real money exactly", () => {
    renderWithI18n(board({ opportunities: [job({ amount: 4500.5 }), job({ id: "j2", amount: null })] }), "en");
    expect(screen.getByText("4,500.50 EGP")).toBeTruthy();
    expect(screen.getByText("Budget not specified")).toBeTruthy();
    expect(screen.queryByText(/(^|\s)0(\.00)?\s*EGP/)).toBeNull();
  });

  it("states the database's exact total — all shown reads like the unpaged label, fewer shown reads 'Showing N of M'", () => {
    const { unmount } = renderWithI18n(board(), "en");
    expect(screen.getByText("2 opportunities available")).toBeTruthy();
    unmount();
    renderWithI18n(board({ total: 340 }), "en");
    expect(screen.getByText("Showing 2 of 340 opportunities")).toBeTruthy();
  });

  it("keeps the real search, minimum/maximum budget, governorate, applied and duration controls", () => {
    renderWithI18n(board(), "en");
    expect(screen.getByRole("searchbox", { name: /search by title/i })).toBeTruthy();
    expect(screen.getByLabelText("Minimum (EGP)")).toBeTruthy();
    expect(screen.getByLabelText("Maximum (EGP)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Governorate" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "City" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Duration" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "My applications" })).toHaveAttribute("href", "/home/jobs/applications");
    // No preview slider with a made-up ceiling.
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByText(/12,000/)).toBeNull();
  });

  it("lists every catalog trade and leaves all unchecked by default", () => {
    renderWithI18n(board(), "en");
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([false, false]);
  });

  describe("URL-driven state", () => {
    it("ticking a trade navigates to the canonical URL", () => {
      renderWithI18n(board(), "en");
      fireEvent.click(screen.getByLabelText("Painting"));
      expect(nav.replace).toHaveBeenCalledWith("/home/jobs?trade=painting", { scroll: false });
    });

    it("sorting by highest pay navigates, and newest drops the param", () => {
      renderWithI18n(board(), "en");
      fireEvent.click(screen.getByRole("button", { name: "Highest pay" }));
      expect(nav.replace).toHaveBeenCalledWith("/home/jobs?sort=highest", { scroll: false });
    });

    it("commits a numeric budget range on blur", () => {
      renderWithI18n(board(), "en");
      fireEvent.change(screen.getByLabelText("Minimum (EGP)"), { target: { value: "1000" } });
      fireEvent.change(screen.getByLabelText("Maximum (EGP)"), { target: { value: "4500.5" } });
      fireEvent.blur(screen.getByLabelText("Maximum (EGP)"));
      expect(nav.replace).toHaveBeenCalledWith("/home/jobs?min=1000&max=4500.5", { scroll: false });
    });

    it("refuses an inverted range instead of navigating", () => {
      renderWithI18n(board(), "en");
      fireEvent.change(screen.getByLabelText("Minimum (EGP)"), { target: { value: "9000" } });
      fireEvent.change(screen.getByLabelText("Maximum (EGP)"), { target: { value: "1000" } });
      fireEvent.blur(screen.getByLabelText("Maximum (EGP)"));
      expect(nav.replace).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toBeTruthy();
    });

    it("commits a search on submit", () => {
      renderWithI18n(board(), "en");
      const input = screen.getByRole("searchbox", { name: /search by title/i });
      fireEvent.change(input, { target: { value: "tiles" } });
      fireEvent.submit(input.closest("form")!);
      expect(nav.replace).toHaveBeenCalledWith("/home/jobs?q=tiles", { scroll: false });
    });

    it("choosing a governorate puts its catalogue KEY in the URL, and the city list follows it", () => {
      renderWithI18n(board(), "en");
      expect(screen.getByRole("button", { name: "City" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Governorate" }));
      fireEvent.click(screen.getByRole("option", { name: "Cairo" }));
      expect(nav.replace).toHaveBeenCalledWith("/home/jobs?gov=cairo", { scroll: false });
    });

    it("with a governorate chosen, the city dropdown lists that governorate's catalogue cities, 'All cities' first", () => {
      renderWithI18n(board({ filters: { ...DEFAULT_BOARD_FILTERS, governorate: "alexandria" } }), "en");
      const city = screen.getByRole("button", { name: "City" });
      expect(city).not.toBeDisabled();
      expect(city.textContent).toBe("All cities");
      fireEvent.click(city);
      expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["All cities", "Alexandria City", "Borg El Arab", "Amreya", "Other city"]);
      fireEvent.click(screen.getByRole("option", { name: "Borg El Arab" }));
      expect(nav.replace).toHaveBeenCalledWith("/home/jobs?gov=alexandria&city=borg-el-arab", { scroll: false });
    });

    it("'Other city' is just another catalogue key — no free-text box, and it filters on city=other", () => {
      renderWithI18n(board({ filters: { ...DEFAULT_BOARD_FILTERS, governorate: "alexandria", city: "other" } }), "en");
      expect(screen.queryByLabelText("City name")).toBeNull();
      expect(screen.getByRole("button", { name: "City" }).textContent).toBe("Other city");
      fireEvent.click(screen.getByRole("button", { name: "City" }));
      fireEvent.click(screen.getByRole("option", { name: "Amreya" }));
      expect(nav.replace).toHaveBeenCalledWith("/home/jobs?gov=alexandria&city=amreya", { scroll: false });
    });

    it("changing the governorate clears the city", () => {
      renderWithI18n(board({ filters: { ...DEFAULT_BOARD_FILTERS, governorate: "alexandria", city: "amreya" } }), "en");
      fireEvent.click(screen.getByRole("button", { name: "Governorate" }));
      fireEvent.click(screen.getByRole("option", { name: "Giza" }));
      expect(nav.replace).toHaveBeenCalledWith("/home/jobs?gov=giza", { scroll: false });
    });

    it("Nearest navigates with sort=nearest", () => {
      renderWithI18n(board(), "en");
      fireEvent.click(screen.getByRole("button", { name: "Nearest" }));
      expect(nav.replace).toHaveBeenCalledWith("/home/jobs?sort=nearest", { scroll: false });
    });

    it("Clear all returns to the bare path", () => {
      renderWithI18n(board({ filters: { ...DEFAULT_BOARD_FILTERS, tradeKeys: ["flooring"] } }), "en");
      fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
      expect(nav.replace).toHaveBeenCalledWith("/home/jobs", { scroll: false });
    });
  });

  it("shows the real empty state, not the demo one, with and without filters", () => {
    renderWithI18n(board({ opportunities: [], total: 0 }), "en");
    expect(screen.getByText("No opportunities right now")).toBeTruthy();
  });

  describe("paged append — the NEXT page of the same question, loaded and appended", () => {
    const cards = (from: number, n: number) => Array.from({ length: n }, (_, i) => job({ id: `j${from + i}`, title: `Opportunity ${from + i}`, href: `/home/jobs/j${from + i}` }));
    const titles = () => screen.getAllByTestId("job-card").length;
    /**
     * The database: `all` cards in order. The cursor is OPAQUE to the board (`c<position>` here, an encoded blob
     * in production): the board hands back verbatim whatever the previous page returned.
     */
    const database = (all: number) => actions.loadMoreJobs.mockImplementation(async (_search: string, cursor: string) => {
      const from = Number(cursor.slice(1));
      return { ok: true, cards: cards(from, Math.min(6, all - from)), total: all, savedIds: [], nextCursor: from + 6 < all ? `c${from + 6}` : null };
    });
    /** The first page as the server renders it: 6 cards and the cursor of the page after them. */
    const first = (total: number, extra: Partial<React.ComponentProps<typeof InstallerJobsBoard>> = {}) =>
      board({ opportunities: cards(0, Math.min(6, total)), total, nextCursor: total > 6 ? "c6" : null, ...extra });

    it("View more loads the next page and appends it — it is not a navigation and it does not scroll the page", async () => {
      database(20);
      renderWithI18n(first(20), "en");
      expect(titles()).toBe(6);
      fireEvent.click(screen.getByRole("button", { name: "View more opportunities" }));
      await waitFor(() => expect(titles()).toBe(12));
      expect(actions.loadMoreJobs).toHaveBeenCalledWith("", "c6");
      expect(nav.replace).not.toHaveBeenCalled();
      expect(screen.getByText("Showing 12 of 20 opportunities")).toBeTruthy();
      expect(screen.getByText("Opportunity 0")).toBeTruthy(); // the first page is still there
      expect(screen.getByText("Opportunity 11")).toBeTruthy();
    });

    it("keeps every filter and the sort: the next page is asked of the SAME question", async () => {
      database(20);
      renderWithI18n(first(20, { search: "trade=flooring&sort=highest", sort: "highest", filters: { ...DEFAULT_BOARD_FILTERS, tradeKeys: ["flooring"] } }), "en");
      fireEvent.click(screen.getByRole("button", { name: "View more opportunities" }));
      await waitFor(() => expect(titles()).toBe(12));
      expect(actions.loadMoreJobs).toHaveBeenCalledWith("trade=flooring&sort=highest", "c6");
    });

    it("asks for each following page from where the list ends, with no ceiling — past 300 cards and on", async () => {
      database(400);
      renderWithI18n(first(400), "en");
      for (let n = 12; n <= 336; n += 6) {
        fireEvent.click(screen.getByRole("button", { name: "View more opportunities" }));
        await waitFor(() => expect(titles()).toBe(n));
      }
      expect(titles()).toBe(336); // beyond the old 300
      expect(actions.loadMoreJobs).toHaveBeenLastCalledWith("", "c330");
      expect(screen.getByRole("button", { name: "View more opportunities" })).toBeEnabled();
      expect(screen.getByText("Showing 336 of 400 opportunities")).toBeTruthy();
    }, 120_000);

    it("stops offering more exactly when the database has no more", async () => {
      database(8);
      renderWithI18n(first(8), "en");
      fireEvent.click(screen.getByRole("button", { name: "View more opportunities" }));
      await waitFor(() => expect(titles()).toBe(8));
      expect(screen.queryByRole("button", { name: "View more opportunities" })).toBeNull();
      expect(screen.getByText("8 opportunities available")).toBeTruthy();
    });

    it("never shows the same card twice if the database shifts between pages", async () => {
      actions.loadMoreJobs.mockResolvedValue({ ok: true, cards: [...cards(5, 1), ...cards(6, 5)], total: 20, savedIds: [], nextCursor: "c12" });
      renderWithI18n(first(20), "en");
      fireEvent.click(screen.getByRole("button", { name: "View more opportunities" }));
      await waitFor(() => expect(titles()).toBe(11));
    });

    it("Show fewer drops the last appended page, and is offered only once more than the first page is shown", async () => {
      database(20);
      renderWithI18n(first(20), "en");
      expect(screen.queryByRole("button", { name: "Show fewer opportunities" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "View more opportunities" }));
      await waitFor(() => expect(titles()).toBe(12));
      fireEvent.click(screen.getByRole("button", { name: "View more opportunities" }));
      await waitFor(() => expect(titles()).toBe(18));
      fireEvent.click(screen.getByRole("button", { name: "Show fewer opportunities" }));
      expect(titles()).toBe(12);
      fireEvent.click(screen.getByRole("button", { name: "Show fewer opportunities" }));
      expect(titles()).toBe(6);
      expect(screen.queryByRole("button", { name: "Show fewer opportunities" })).toBeNull();
      expect(screen.getByText("Showing 6 of 20 opportunities")).toBeTruthy();
    });

    it("after Show fewer, View more loads that page again from the right place", async () => {
      database(20);
      renderWithI18n(first(20), "en");
      fireEvent.click(screen.getByRole("button", { name: "View more opportunities" }));
      await waitFor(() => expect(titles()).toBe(12));
      fireEvent.click(screen.getByRole("button", { name: "Show fewer opportunities" }));
      fireEvent.click(screen.getByRole("button", { name: "View more opportunities" }));
      await waitFor(() => expect(actions.loadMoreJobs).toHaveBeenCalledTimes(2));
      // The chain is intact: the dropped page's own cursor is asked for again, not a later one.
      expect(actions.loadMoreJobs.mock.calls.map((c) => c[1])).toEqual(["c6", "c6"]);
      await waitFor(() => expect(titles()).toBe(12));
    });

    it("walks the cursor chain: each page is asked with the cursor the previous one returned, verbatim", async () => {
      const seen: string[] = [];
      actions.loadMoreJobs.mockImplementation(async (_search: string, cursor: string) => {
        seen.push(cursor);
        const n = seen.length;
        return { ok: true, cards: cards(n * 6, 6), total: 100, savedIds: [], nextCursor: `v1.opaque-${n}` };
      });
      renderWithI18n(first(100, { nextCursor: "v1.opaque-0" }), "en");
      for (let n = 12; n <= 24; n += 6) {
        fireEvent.click(screen.getByRole("button", { name: "View more opportunities" }));
        await waitFor(() => expect(titles()).toBe(n));
      }
      expect(seen).toEqual(["v1.opaque-0", "v1.opaque-1", "v1.opaque-2"]);
    });

    it("Show fewer then View more twice keeps the chain consistent: dropped pages are re-fetched from their own cursor", async () => {
      database(40);
      renderWithI18n(first(40), "en");
      for (const n of [12, 18]) {
        fireEvent.click(screen.getByRole("button", { name: "View more opportunities" }));
        await waitFor(() => expect(titles()).toBe(n));
      }
      fireEvent.click(screen.getByRole("button", { name: "Show fewer opportunities" }));
      fireEvent.click(screen.getByRole("button", { name: "Show fewer opportunities" }));
      expect(titles()).toBe(6);
      for (const n of [12, 18, 24]) {
        fireEvent.click(screen.getByRole("button", { name: "View more opportunities" }));
        await waitFor(() => expect(titles()).toBe(n));
      }
      expect(actions.loadMoreJobs.mock.calls.map((c) => c[1])).toEqual(["c6", "c12", "c6", "c12", "c18"]);
      expect(new Set(screen.getAllByTestId("job-card").map((c) => c.textContent)).size).toBe(24);
    });

    it("a page that arrives after the question changed is ignored", async () => {
      let release!: (value: unknown) => void;
      actions.loadMoreJobs.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
      const { rerender } = renderWithI18n(first(20), "en");
      fireEvent.click(screen.getByRole("button", { name: "View more opportunities" }));
      rerender(<I18nProvider locale="en" dir="ltr">{board({ opportunities: cards(100, 6), total: 9, nextCursor: "c106", search: "trade=painting" })}</I18nProvider>);
      release({ ok: true, cards: cards(6, 6), total: 20, savedIds: [], nextCursor: "c12" });
      await waitFor(() => expect(titles()).toBe(6));
      expect(screen.getByText("Opportunity 100")).toBeTruthy();
      expect(screen.queryByText("Opportunity 6")).toBeNull();
    });

    it("a failed load keeps what is shown, says so, and can be retried", async () => {
      actions.loadMoreJobs.mockResolvedValueOnce({ ok: false });
      database(20);
      renderWithI18n(first(20), "en");
      fireEvent.click(screen.getByRole("button", { name: "View more opportunities" }));
      expect(await screen.findByText(/could not load more/i)).toBeTruthy();
      expect(titles()).toBe(6);
      actions.loadMoreJobs.mockReset();
      database(20);
      fireEvent.click(screen.getByRole("button", { name: "View more opportunities" }));
      await waitFor(() => expect(titles()).toBe(12));
    });

    it("changing the question (a new first page) discards the appended pages", async () => {
      database(20);
      const { rerender } = renderWithI18n(first(20), "en");
      fireEvent.click(screen.getByRole("button", { name: "View more opportunities" }));
      await waitFor(() => expect(titles()).toBe(12));
      rerender(<I18nProvider locale="en" dir="ltr">{board({ opportunities: cards(100, 6), total: 9, nextCursor: "c106", search: "trade=painting" })}</I18nProvider>);
      expect(titles()).toBe(6);
      expect(screen.getByText("Opportunity 100")).toBeTruthy();
      expect(screen.getByText("Showing 6 of 9 opportunities")).toBeTruthy();
    });

    it("changing a filter navigates and starts again from the first page", () => {
      renderWithI18n(first(40), "en");
      fireEvent.click(screen.getByLabelText("Painting"));
      expect(nav.replace).toHaveBeenCalledWith("/home/jobs?trade=painting", { scroll: false });
    });
  });

  it("explains a filtered-out board differently from an empty one", () => {
    renderWithI18n(board({ opportunities: [], filters: { ...DEFAULT_BOARD_FILTERS, governorate: "giza" } }), "en");
    expect(screen.getByText("No opportunities match those filters")).toBeTruthy();
  });
});

describe("GRID is the default view on the Jobs board", () => {
  it("Jobs opens in Grid view, with List view one explicit choice away", () => {
    renderWithI18n(board(), "en");
    expect(screen.getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "true");
  });

  it("names the views عرض الشبكة / عرض القائمة in Arabic, Grid first", () => {
    renderWithI18n(board(), "ar");
    expect(screen.getByRole("button", { name: "عرض الشبكة" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "عرض القائمة" })).toHaveAttribute("aria-pressed", "false");
  });
});
