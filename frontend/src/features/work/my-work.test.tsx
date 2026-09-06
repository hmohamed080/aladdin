import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/server/actions/assignment-forms", () => ({
  startWorkAction: async () => ({ ok: true }),
  addProgressAction: async () => ({ ok: true }),
  cancelAssignmentAction: async () => ({ ok: true }),
  completeAssignmentAction: async () => ({ ok: true }),
}));

import { MyWork } from "./my-work";
import type { JobAssignmentStatus, MyAssignmentRow } from "@/server/queries/job-assignments";

const row = (over: Partial<MyAssignmentRow> = {}): MyAssignmentRow =>
  ({
    id: "a1",
    job_id: "j1",
    application_id: "ap1",
    status: "in_progress",
    agreed_amount: 18000,
    agreed_currency: "EGP",
    latest_progress_percent: 60,
    last_progress_at: "2026-09-05T09:00:00Z",
    version: 2,
    started_at: "2026-09-04T08:00:00Z",
    completed_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    created_at: "2026-09-03T00:00:00Z",
    job_title: "Marble staircase cladding",
    job_description: "Ground to first floor.",
    job_status: "awarded",
    trade_key: "marble_granite",
    trade_is_active: true,
    governorate: "Cairo",
    city: "New Cairo",
    site_address: "12 Street 90",
    expected_duration_days: 14,
    starts_on: null,
    ends_by: null,
    published_at: "2026-09-01T00:00:00Z",
    poster_org_name: "Horizon Contracting",
    ...over,
  }) as MyAssignmentRow;

const counts = (over: Partial<Record<JobAssignmentStatus, number>> = {}) => ({
  scheduled: 0,
  in_progress: 0,
  completed: 0,
  cancelled: 0,
  ...over,
});

const base = { locale: "en" as const, filtered: false };

describe("MyWork", () => {
  // ---- The featured current assignment (§7) ------------------------------
  it("leads with the current assignment, its organization and its terms", () => {
    renderWithI18n(
      <MyWork {...base} assignments={[row()]} counts={counts({ in_progress: 1 })} />,
      "en",
    );
    expect(screen.getByRole("heading", { name: "Marble staircase cladding" })).toBeTruthy();
    expect(screen.getAllByText("Horizon Contracting").length).toBeGreaterThan(0);
    // "Current work" is both the featured band's eyebrow and a summary row.
    expect(screen.getAllByText("Current work").length).toBe(2);
    expect(screen.getAllByText("Marble & granite").length).toBeGreaterThan(0);
  });

  /**
   * §7: the progress figure is the subject of the featured block, so it is
   * announced rather than drawn. `PanelRow`'s decorative share bar could not
   * have carried this.
   */
  it("announces the progress as a real progressbar", () => {
    renderWithI18n(
      <MyWork {...base} assignments={[row()]} counts={counts({ in_progress: 1 })} />,
      "en",
    );
    const meters = screen.getAllByRole("progressbar");
    expect(meters.length).toBeGreaterThan(0);
    expect(meters[0]?.getAttribute("aria-valuenow")).toBe("60");
    expect(meters[0]?.getAttribute("aria-valuemax")).toBe("100");
  });

  /**
   * A browser found `1%` where the data said 100. `formatPercent` already divides
   * by 100 — it takes a whole-number percentage — and the code divided again.
   * Four call sites carried it and no test looked at the rendered figure. This is
   * that test, and it is deliberately about the STRING, not the aria value.
   */
  it("prints the progress figure the data actually holds", () => {
    for (const [percent, shown] of [[0, "0%"], [25, "25%"], [60, "60%"], [100, "100%"]] as const) {
      const { container, unmount } = renderWithI18n(
        <MyWork
          {...base}
          assignments={[row({ latest_progress_percent: percent })]}
          counts={counts({ in_progress: 1 })}
        />,
        "en",
      );
      expect(container.textContent).toContain(shown);
      unmount();
    }
  });

  it("offers Update progress on work under way, and Start work on work that is booked", () => {
    const running = renderWithI18n(
      <MyWork {...base} assignments={[row()]} counts={counts({ in_progress: 1 })} />,
      "en",
    );
    expect(screen.getByRole("button", { name: "Update progress" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start work" })).toBeNull();
    running.unmount();

    renderWithI18n(
      <MyWork
        {...base}
        assignments={[row({ status: "scheduled", latest_progress_percent: 0 })]}
        counts={counts({ scheduled: 1 })}
      />,
      "en",
    );
    expect(screen.getByRole("button", { name: "Start work" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Update progress" })).toBeNull();
  });

  /**
   * §16, the assertion this file exists for. There is no completion control on
   * any installer surface, in any state — including the one where the work is
   * reported finished and a button would feel most natural.
   */
  it("NEVER renders a completion control, at any progress or state", () => {
    for (const a of [
      row({ status: "scheduled", latest_progress_percent: 0 }),
      row({ status: "in_progress", latest_progress_percent: 60 }),
      row({ status: "in_progress", latest_progress_percent: 100 }),
      row({ status: "completed", latest_progress_percent: 100 }),
    ]) {
      const { container, unmount } = renderWithI18n(
        <MyWork {...base} assignments={[a]} counts={counts({ in_progress: 1 })} />,
        "en",
      );
      for (const name of [/complete/i, /finish/i, /mark.*done/i, /confirm/i]) {
        expect(screen.queryByRole("button", { name })).toBeNull();
      }
      expect(container.textContent).not.toContain("Confirm completion");
      unmount();
    }
  });

  /** §14: at 100 the state is still In progress, plus a claim beside it. */
  it("says 'reported as finished' at 100 without calling the assignment complete", () => {
    const { container } = renderWithI18n(
      <MyWork
        {...base}
        assignments={[row({ latest_progress_percent: 100 })]}
        counts={counts({ in_progress: 1 })}
      />,
      "en",
    );
    // Scoped to the featured block, because "Completed" is also a permanent
    // summary-row label and a tab — neither of which is a claim about THIS work.
    const featured = within(
      container.querySelector('section[aria-labelledby="current-a1"]') as HTMLElement,
    );
    expect(featured.getByText("Reported as finished")).toBeTruthy();
    expect(featured.getByText("In progress")).toBeTruthy();
    expect(featured.queryByText("Completed")).toBeNull();
  });

  // ---- Real counts (§6, §8) ----------------------------------------------
  it("shows the caller's own counts, zeros included, and invents none", () => {
    renderWithI18n(
      <MyWork
        {...base}
        assignments={[row()]}
        counts={counts({ in_progress: 1, completed: 3 })}
      />,
      "en",
    );
    expect(screen.getByText("Your work summary")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.getByText("Cancelled")).toBeTruthy();
  });

  /**
   * §8. The reference's sidebar also carries a documents panel, a files count,
   * a quick-tools rail and "completed this month". None has authority behind it.
   */
  it("carries no invented metric from the reference sidebar", () => {
    const { container } = renderWithI18n(
      <MyWork {...base} assignments={[row()]} counts={counts({ in_progress: 1 })} />,
      "en",
    );
    expect(container.textContent).not.toMatch(
      /this month|revenue|earnings|rating|performance|invoice|documents|files|photos/i,
    );
  });

  it("never describes the agreed amount as paid, owed or handled by Aladdin", () => {
    const { container } = renderWithI18n(
      <MyWork {...base} assignments={[row()]} counts={counts({ in_progress: 1 })} />,
      "en",
    );
    expect(container.textContent).not.toMatch(
      /\b(paid|payout|escrow|wallet|invoice|balance|commission|owed)\b/i,
    );
  });

  // ---- The all-work list (§9) --------------------------------------------
  it("lists every assignment with its state and a route to its record", () => {
    const { container } = renderWithI18n(
      <MyWork
        {...base}
        assignments={[
          row({ id: "a1" }),
          row({ id: "a2", status: "completed", job_title: "Bathroom fitting" }),
        ]}
        counts={counts({ in_progress: 1, completed: 1 })}
      />,
      "en",
    );
    expect(container.querySelector('a[href="/home/work/a1"]')).toBeTruthy();
    expect(container.querySelector('a[href="/home/work/a2"]')).toBeTruthy();
    expect(screen.getAllByText("Bathroom fitting").length).toBeGreaterThan(0);
  });

  /**
   * The width defect the visual review found: at 1440px with the navigation
   * EXPANDED, a separate Organization column left the State cell too narrow, so
   * the two status chips wrapped, every row doubled in height, and Agreed,
   * Assigned and View were pushed into the table's horizontal scroller — the
   * reader had to scroll sideways to discover that a View action existed.
   *
   * The fix is one column fewer, not a width hack: the organization moved into
   * the identity cell it was already represented in by the monogram. These
   * assertions pin the SHAPE, because a future author adding a column back is
   * how the row height returns.
   */
  it("carries no separate Organization column — it lives in the identity cell", () => {
    const { container } = renderWithI18n(
      <MyWork {...base} assignments={[row()]} counts={counts({ in_progress: 1 })} />,
      "en",
    );
    const headers = [...container.querySelectorAll("thead th")].map((h) => h.textContent?.trim());
    expect(headers).not.toContain("Organization");
    // ...and the organization is still on the row, beside the trade.
    expect(screen.getAllByText(/Horizon Contracting · Marble & granite/).length)
      .toBeGreaterThan(0);
  });

  it("keeps the whole row readable — five columns, and the action among them", () => {
    const { container } = renderWithI18n(
      <MyWork {...base} assignments={[row()]} counts={counts({ in_progress: 1 })} />,
      "en",
    );
    const headers = [...container.querySelectorAll("thead th")];
    expect(headers).toHaveLength(5);
    expect(headers.map((h) => h.textContent?.trim())).toEqual([
      "Job",
      "State",
      "Agreed",
      "Assigned",
      "",
    ]);
  });

  /** The pair of chips must occupy one line, whatever the state. */
  it("holds the status chips on a single line", () => {
    const { container } = renderWithI18n(
      <MyWork
        {...base}
        assignments={[row({ latest_progress_percent: 100 })]}
        counts={counts({ in_progress: 1 })}
      />,
      "en",
    );
    const chipRow = [...container.querySelectorAll("tbody td span")].find((el) =>
      el.className.includes("whitespace-nowrap"),
    );
    expect(chipRow).toBeTruthy();
    expect(chipRow?.className).not.toContain("flex-wrap");
  });

  /** The RTL truncation defect, at the surface that showed it. */
  it("lets each user-entered title resolve its own direction", () => {
    const { container } = renderWithI18n(
      <MyWork {...base} assignments={[row()]} counts={counts({ in_progress: 1 })} />,
      "ar",
    );
    const titles = [...container.querySelectorAll('[dir="auto"]')]
      .map((e) => e.textContent)
      .filter((t) => t?.includes("Marble staircase cladding"));
    expect(titles.length).toBeGreaterThan(0);
  });

  /** §9 and §22: no thumbnail, no rating, no fake client. */
  it("puts no image or rating in the list", () => {
    const { container } = renderWithI18n(
      <MyWork {...base} assignments={[row()]} counts={counts({ in_progress: 1 })} />,
      "en",
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).not.toMatch(/★|4\.\d\b/);
  });

  // ---- Empty states (§22, §29) -------------------------------------------
  /**
   * §22 is the point of this test. With nothing at all the page must still be a
   * page: a featured region, a list region and a summary — not a header above a
   * void.
   */
  it("keeps its structure when the caller has no work at all", () => {
    renderWithI18n(<MyWork {...base} assignments={[]} counts={counts()} />, "en");
    expect(screen.getByText("No work under way")).toBeTruthy();
    expect(screen.getByText("All work")).toBeTruthy();
    expect(screen.getByText("Your work summary")).toBeTruthy();
    expect(screen.getByText("No work yet")).toBeTruthy();
  });

  it("tells 'nothing yet' apart from 'nothing in this state'", () => {
    const bare = renderWithI18n(<MyWork {...base} assignments={[]} counts={counts()} />, "en");
    expect(bare.container.textContent).toContain("No work yet");
    bare.unmount();

    renderWithI18n(
      <MyWork {...base} filtered assignments={[]} counts={counts({ completed: 2 })} />,
      "en",
    );
    expect(screen.getByText("Nothing in this state")).toBeTruthy();
  });

  // ---- Historical records (§18, §19, §24) --------------------------------
  it("keeps a completed assignment legible, with no review or invoice control", () => {
    const { container } = renderWithI18n(
      <MyWork
        {...base}
        assignments={[row({ status: "completed", completed_at: "2026-09-09T00:00:00Z" })]}
        counts={counts({ completed: 1 })}
      />,
      "en",
    );
    expect(screen.getAllByText("Marble staircase cladding").length).toBeGreaterThan(0);
    // The organization now reads from the identity cell rather than its own
    // column, so this asserts the FACT is present, not where it sits.
    expect(container.textContent).toContain("Horizon Contracting");
    expect(container.textContent).not.toMatch(/review|rate|certificate|invoice|payment/i);
  });

  /** §19: shown, and never dressed up as work the reader finished. */
  it("shows a cancelled assignment neutrally rather than erasing it", () => {
    renderWithI18n(
      <MyWork
        {...base}
        assignments={[row({ status: "cancelled", cancelled_at: "2026-09-06T00:00:00Z" })]}
        counts={counts({ cancelled: 1 })}
      />,
      "en",
    );
    expect(screen.getAllByText("Marble staircase cladding").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cancelled").length).toBeGreaterThan(0);
    expect(screen.queryByText("Completed work")).toBeNull();
  });

  /** §24: the label a retired trade leaves behind. */
  it("keeps the historical trade label after the trade is retired", () => {
    renderWithI18n(
      <MyWork
        {...base}
        assignments={[row({ trade_is_active: false })]}
        counts={counts({ in_progress: 1 })}
      />,
      "en",
    );
    expect(screen.getAllByText(/Marble & granite/).length).toBeGreaterThan(0);
    expect(screen.getByText(/no longer offered/i)).toBeTruthy();
  });

  // ---- Locale -------------------------------------------------------------
  it("renders in Arabic with no raw enum, key or message path", () => {
    const { container } = renderWithI18n(
      <MyWork {...base} assignments={[row()]} counts={counts({ in_progress: 1 })} />,
      "ar",
    );
    expect(container.textContent).not.toMatch(/marble_granite|in_progress|scheduled|cancelled/);
    expect(container.textContent).not.toMatch(/work\.|jobs\.|onboarding\./);
  });
});
