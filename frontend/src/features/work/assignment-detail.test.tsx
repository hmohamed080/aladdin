import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/server/actions/assignment-forms", () => ({
  startWorkAction: async () => ({ ok: true }),
  addProgressAction: async () => ({ ok: true }),
  cancelAssignmentAction: async () => ({ ok: true }),
  completeAssignmentAction: async () => ({ ok: true }),
}));

import { AssignmentDetail } from "./assignment-detail";
import type { MyAssignmentRow, ProgressUpdateRow } from "@/server/queries/job-assignments";

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
    job_description: "Ground to first floor, including nosings.",
    job_status: "awarded",
    trade_key: "marble_granite",
    trade_is_active: true,
    governorate: "Cairo",
    city: "New Cairo",
    site_address: "12 Street 90, Fifth Settlement",
    expected_duration_days: 14,
    starts_on: null,
    ends_by: null,
    published_at: "2026-09-01T00:00:00Z",
    poster_org_name: "Horizon Contracting",
    ...over,
  }) as MyAssignmentRow;

const update = (over: Partial<ProgressUpdateRow> = {}): ProgressUpdateRow => ({
  id: "u1",
  progress_percent: 60,
  stage: "Second course",
  note: "First floor landing done.",
  created_at: "2026-09-05T09:00:00Z",
  ...over,
});

const base = { locale: "en" as const, updates: [] as ProgressUpdateRow[] };

describe("AssignmentDetail", () => {
  // ---- §10, the hierarchy -------------------------------------------------
  it("opens with the work, who it is for, and its state", () => {
    renderWithI18n(<AssignmentDetail {...base} assignment={row()} />, "en");
    expect(screen.getByRole("heading", { name: "Marble staircase cladding" })).toBeTruthy();
    // Named ONCE. The header used to carry a "Posted by: X" line directly above
    // an identity block saying the same thing.
    expect(screen.getAllByText(/Horizon Contracting/).length).toBe(1);
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.getByText(/Ground to first floor/)).toBeTruthy();
  });

  it("prints the agreed amount once, and never as a payment", () => {
    const { container } = renderWithI18n(
      <AssignmentDetail {...base} assignment={row()} />,
      "en",
    );
    expect(container.textContent?.match(/EGP/g)?.length).toBe(1);
    expect(container.textContent).not.toMatch(
      /\b(paid|payout|escrow|wallet|invoice|balance|commission|owed)\b/i,
    );
  });

  /** §11: the address is released to the professional who holds the work. */
  it("shows the site address while the assignment is live", () => {
    renderWithI18n(<AssignmentDetail {...base} assignment={row()} />, "en");
    expect(screen.getByText("12 Street 90, Fifth Settlement")).toBeTruthy();
  });

  it("explains the withheld address rather than leaving a blank", () => {
    renderWithI18n(
      <AssignmentDetail
        {...base}
        assignment={row({ status: "cancelled", site_address: null, cancelled_at: "2026-09-06T00:00:00Z" })}
      />,
      "en",
    );
    expect(screen.getByText(/available while the assignment is active/i)).toBeTruthy();
  });

  // ---- §11 Start ----------------------------------------------------------
  it("offers Start work on a scheduled assignment and explains when to use it", () => {
    renderWithI18n(
      <AssignmentDetail
        {...base}
        assignment={row({ status: "scheduled", latest_progress_percent: 0, started_at: null })}
      />,
      "en",
    );
    expect(screen.getByRole("button", { name: "Start work" })).toBeTruthy();
    expect(screen.getByText(/actually on site/i)).toBeTruthy();
    // Progress cannot be reported before starting — the RPC refuses it.
    expect(screen.queryByRole("button", { name: "Update progress" })).toBeNull();
    expect(screen.getByText(/opens once you have started/i)).toBeTruthy();
  });

  it("stops offering Start once the work is under way", () => {
    renderWithI18n(<AssignmentDetail {...base} assignment={row()} />, "en");
    expect(screen.queryByRole("button", { name: "Start work" })).toBeNull();
    expect(screen.getByRole("button", { name: "Update progress" })).toBeTruthy();
  });

  // ---- §12, §13 Progress --------------------------------------------------
  it("renders the append-only history newest-first with no way to edit it", () => {
    const { container } = renderWithI18n(
      <AssignmentDetail
        {...base}
        assignment={row()}
        updates={[update(), update({ id: "u0", progress_percent: 25, stage: "Base course" })]}
      />,
      "en",
    );
    expect(screen.getByText("Second course")).toBeTruthy();
    expect(screen.getByText("Base course")).toBeTruthy();
    expect(screen.getByText(/kept as a record and are not edited/i)).toBeTruthy();
    for (const name of [/edit/i, /delete/i, /remove/i]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    // §12: no raw database id reaches the page.
    expect(container.textContent).not.toContain("u1");
  });

  /** The `formatPercent` double-division regression, on the history rows too. */
  it("prints each historical figure as reported, not divided twice", () => {
    const { container } = renderWithI18n(
      <AssignmentDetail
        {...base}
        assignment={row({ latest_progress_percent: 100 })}
        updates={[
          update({ id: "u2", progress_percent: 100 }),
          update({ id: "u1", progress_percent: 60 }),
          update({ id: "u0", progress_percent: 25 }),
        ]}
      />,
      "en",
    );
    for (const shown of ["100%", "60%", "25%"]) {
      expect(container.textContent).toContain(shown);
    }
    expect(container.textContent).not.toMatch(/0%|1%/);
  });

  it("says so honestly when nothing has been reported yet", () => {
    renderWithI18n(<AssignmentDetail {...base} assignment={row()} />, "en");
    expect(screen.getByText(/No progress reported yet/i)).toBeTruthy();
  });

  /** §13: a controlled 0–100 input, not a raw integer field with no guidance. */
  it("offers a bounded control seeded from the current figure", () => {
    const { container } = renderWithI18n(
      <AssignmentDetail {...base} assignment={row()} />,
      "en",
    );
    fireEvent.click(screen.getByRole("button", { name: "Update progress" }));
    const range = container.querySelector('input[type="range"]');
    const number = container.querySelector('input[name="percent"]');
    expect(range?.getAttribute("min")).toBe("0");
    expect(range?.getAttribute("max")).toBe("100");
    expect((number as HTMLInputElement | null)?.value).toBe("60");
  });

  // ---- §14, the rule -------------------------------------------------------
  it("at 100 says the work was REPORTED finished and offers nothing further", () => {
    const { container } = renderWithI18n(
      <AssignmentDetail {...base} assignment={row({ latest_progress_percent: 100 })} />,
      "en",
    );
    expect(screen.getByText("You reported this work as finished")).toBeTruthy();
    expect(screen.getByText(/They confirm completion/)).toBeTruthy();
    expect(screen.getByText("There is nothing further for you to do here.")).toBeTruthy();
    // Still in progress, and still not completed.
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(container.textContent).not.toContain("Confirm completion");
  });

  /** §16, structurally: no completion control exists in any state. */
  it("NEVER offers the installer a way to complete their own work", () => {
    for (const a of [
      row({ status: "scheduled", latest_progress_percent: 0 }),
      row({ status: "in_progress", latest_progress_percent: 100 }),
      row({ status: "completed", completed_at: "2026-09-09T00:00:00Z" }),
    ]) {
      const { unmount } = renderWithI18n(<AssignmentDetail {...base} assignment={a} />, "en");
      for (const name of [/confirm completion/i, /mark complete/i, /finish/i]) {
        expect(screen.queryByRole("button", { name })).toBeNull();
      }
      unmount();
    }
  });

  // ---- §17 Cancellation ---------------------------------------------------
  it("offers cancellation from either live state, with a required reason", () => {
    for (const status of ["scheduled", "in_progress"] as const) {
      const { container, unmount } = renderWithI18n(
        <AssignmentDetail {...base} assignment={row({ status })} />,
        "en",
      );
      fireEvent.click(screen.getByRole("button", { name: "Cancel assignment" }));
      expect(container.querySelector('input[name="reason"]')?.hasAttribute("required")).toBe(true);
      unmount();
    }
  });

  it("offers no cancellation once the assignment has ended", () => {
    for (const status of ["completed", "cancelled"] as const) {
      const { unmount } = renderWithI18n(
        <AssignmentDetail {...base} assignment={row({ status, cancellation_reason: "x" })} />,
        "en",
      );
      expect(screen.queryByRole("button", { name: "Cancel assignment" })).toBeNull();
      unmount();
    }
  });

  // ---- §18, §19 History ---------------------------------------------------
  it("keeps a completed assignment whole, with no review or invoice control", () => {
    const { container } = renderWithI18n(
      <AssignmentDetail
        {...base}
        assignment={row({
          status: "completed",
          latest_progress_percent: 100,
          completed_at: "2026-09-09T00:00:00Z",
        })}
        updates={[update({ progress_percent: 100 })]}
      />,
      "en",
    );
    expect(screen.getByRole("heading", { name: "Marble staircase cladding" })).toBeTruthy();
    // Twice: the status badge, and the "Completed" date field in the record.
    expect(screen.getAllByText("Completed").length).toBe(2);
    expect(screen.getByText("Second course")).toBeTruthy();
    expect(container.textContent).not.toMatch(/review|rate this|certificate|invoice|payment/i);
  });

  /** §19: kept, shown neutrally, with the reason the other party gave. */
  it("keeps a cancelled assignment as a record, with its stated reason", () => {
    renderWithI18n(
      <AssignmentDetail
        {...base}
        assignment={row({
          status: "cancelled",
          cancelled_at: "2026-09-06T00:00:00Z",
          cancellation_reason: "The client postponed the handover.",
          site_address: null,
        })}
      />,
      "en",
    );
    expect(screen.getAllByText("Cancelled").length).toBe(2);
    expect(screen.getByText("The client postponed the handover.")).toBeTruthy();
    // And it does not imply the reader finished the work.
    expect(screen.queryByText("You reported this work as finished")).toBeNull();
  });

  /** §24: the trade the work was agreed as survives the taxonomy moving on. */
  it("keeps the historical trade label and explains why it is still shown", () => {
    renderWithI18n(
      <AssignmentDetail {...base} assignment={row({ trade_is_active: false })} />,
      "en",
    );
    expect(screen.getByText(/Marble & granite/)).toBeTruthy();
    expect(screen.getByText(/what this work was agreed as/i)).toBeTruthy();
  });

  // ---- §10, what must not be here -----------------------------------------
  it("exposes no poster-side management and no other applicant", () => {
    const { container } = renderWithI18n(
      <AssignmentDetail {...base} assignment={row()} />,
      "en",
    );
    for (const name of [/publish/i, /applicants/i, /edit job/i, /close job/i, /accept/i, /reject/i]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(container.querySelector('a[href^="/b2b"]')).toBeNull();
    expect(container.textContent).not.toMatch(/\b(\d+ applicants?|other applicants?|shortlist)\b/i);
  });

  it("renders in Arabic with no raw enum, key or message path", () => {
    const { container } = renderWithI18n(
      <AssignmentDetail {...base} assignment={row()} updates={[update()]} />,
      "ar",
    );
    expect(container.textContent).not.toMatch(/marble_granite|in_progress|scheduled|awarded/);
    expect(container.textContent).not.toMatch(/work\.|jobs\.|onboarding\./);
  });
});
