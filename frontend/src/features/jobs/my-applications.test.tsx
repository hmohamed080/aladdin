import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/server/actions/application-forms", () => ({
  applyToJobAction: async () => ({ ok: true }),
  withdrawApplicationAction: async () => ({ ok: true }),
}));

import { MyApplications } from "./my-applications";
import type { MyApplicationRow } from "@/server/queries/job-opportunities";

const application = (over: Partial<MyApplicationRow> = {}): MyApplicationRow =>
  ({
    id: "a1",
    job_id: "j1",
    status: "submitted",
    note: "Available from Sunday.",
    created_at: "2026-09-02T00:00:00Z",
    decided_at: null,
    decision_reason: null,
    job_title: "Marble staircase cladding",
    job_description: "Ground to first floor.",
    trade_key: "marble_granite",
    offered_amount: 18000,
    offered_currency: "EGP",
    governorate: "Cairo",
    city: "New Cairo",
    expected_duration_days: 14,
    starts_on: null,
    ends_by: null,
    published_at: "2026-09-01T00:00:00Z",
    job_status: "open",
    poster_org_name: "Horizon Contracting",
    ...over,
  }) as MyApplicationRow;

const live = new Set(["j1"]);
const none = new Set<string>();
const base = { locale: "en" as const, filtered: false };

describe("MyApplications", () => {
  it("answers what was applied to, and to whom", () => {
    renderWithI18n(
      <MyApplications {...base} applications={[application()]} discoverableJobIds={live} />,
      "en",
    );
    expect(screen.getByRole("heading", { name: "Marble staircase cladding" })).toBeTruthy();
    expect(screen.getByText("Horizon Contracting")).toBeTruthy();
    expect(screen.getByText("Marble & granite")).toBeTruthy();
    expect(screen.getByText("Applied")).toBeTruthy();
  });

  it("prints the currency exactly once", () => {
    const { container } = renderWithI18n(
      <MyApplications {...base} applications={[application()]} discoverableJobIds={live} />,
      "en",
    );
    expect(container.textContent?.match(/EGP/g)?.length).toBe(1);
  });

  /**
   * §13. An applicant NEVER sees a competitor — the read seam returns no other
   * candidacy at all, and nothing here derives one.
   */
  it("exposes no sibling applicant, count or ranking", () => {
    const { container } = renderWithI18n(
      <MyApplications {...base} applications={[application()]} discoverableJobIds={live} />,
      "en",
    );
    expect(container.textContent).not.toMatch(
      /\b(\d+ applicants?|other applicants?|rank|position|shortlist)\b/i,
    );
  });

  // ---- The four states ---------------------------------------------------
  it("offers Withdraw only on a live candidacy", () => {
    renderWithI18n(
      <MyApplications {...base} applications={[application()]} discoverableJobIds={live} />,
      "en",
    );
    expect(screen.getByRole("button", { name: "Withdraw application" })).toBeTruthy();
  });

  it("offers no Withdraw on a decided or withdrawn one", () => {
    for (const status of ["accepted", "rejected", "withdrawn"] as const) {
      const { unmount } = renderWithI18n(
        <MyApplications
          {...base}
          applications={[application({ status, decision_reason: "x" })]}
          discoverableJobIds={none}
        />,
        "en",
      );
      expect(screen.queryByRole("button", { name: "Withdraw application" })).toBeNull();
      unmount();
    }
  });

  it("states an acceptance without a My Work link Increment 9 has not built", () => {
    const { container } = renderWithI18n(
      <MyApplications
        {...base}
        applications={[application({ status: "accepted", job_status: "awarded" })]}
        discoverableJobIds={none}
      />,
      "en",
    );
    expect(screen.getByText("Your application was accepted")).toBeTruthy();
    expect(container.querySelector('a[href*="work"]')).toBeNull();
  });

  it("shows a rejection with the reason the organization gave", () => {
    renderWithI18n(
      <MyApplications
        {...base}
        applications={[
          application({ status: "rejected", decision_reason: "We needed marble experience." }),
        ]}
        discoverableJobIds={none}
      />,
      "en",
    );
    expect(screen.getByText("Your application was not selected")).toBeTruthy();
    expect(screen.getByText(/We needed marble experience\./)).toBeTruthy();
  });

  it("translates the system's auto-rejection rather than printing it raw", () => {
    const { container } = renderWithI18n(
      <MyApplications
        {...base}
        applications={[
          application({
            status: "rejected",
            decision_reason: "the job was awarded to another applicant",
          }),
        ]}
        discoverableJobIds={none}
      />,
      "en",
    );
    expect(container.textContent).not.toContain("the job was awarded to another applicant");
    expect(container.textContent).toContain("The job was awarded to another professional.");
  });

  /**
   * §17. These are two different facts about the same person, and rendering both
   * as a neutral grey row would tell somebody they were rejected when they had
   * simply changed their mind.
   */
  it("says 'you withdrew' and not 'you were rejected'", () => {
    renderWithI18n(
      <MyApplications
        {...base}
        applications={[application({ status: "withdrawn" })]}
        discoverableJobIds={none}
      />,
      "en",
    );
    expect(screen.getByText("You withdrew this application")).toBeTruthy();
    expect(screen.queryByText("Your application was not selected")).toBeNull();
  });

  // ---- Re-application ----------------------------------------------------
  it("offers Apply again on a withdrawn candidacy whose opening is still live", () => {
    const { container } = renderWithI18n(
      <MyApplications
        {...base}
        applications={[application({ status: "withdrawn" })]}
        discoverableJobIds={live}
      />,
      "en",
    );
    const link = container.querySelector('a[href="/home/jobs/j1"]');
    expect(link?.textContent).toContain("Apply again");
  });

  /**
   * The gate discovery answers and the application row cannot: the job may still
   * say `open` while its poster's verification has lapsed, and
   * `job_application_submit` would refuse.
   */
  it("withholds Apply again when the opening has left discovery, even if it still says open", () => {
    renderWithI18n(
      <MyApplications
        {...base}
        applications={[application({ status: "withdrawn", job_status: "open" })]}
        discoverableJobIds={none}
      />,
      "en",
    );
    expect(screen.queryByText("Apply again")).toBeNull();
    expect(screen.getByText(/no longer accepting applications, so it cannot be sent again/i))
      .toBeTruthy();
  });

  it("never offers a decided candidacy a way back in", () => {
    for (const status of ["accepted", "rejected"] as const) {
      const { unmount } = renderWithI18n(
        <MyApplications
          {...base}
          applications={[application({ status, decision_reason: "x" })]}
          discoverableJobIds={live}
        />,
        "en",
      );
      expect(screen.queryByText("Apply again")).toBeNull();
      unmount();
    }
  });

  // ---- Job state as SUPPORTING context (§23) ------------------------------
  /**
   * A rejected application does not become ambiguous because the job it was for
   * was later awarded to somebody else. The application badge leads; the job's
   * own state is a quiet second line.
   */
  it("keeps the application state primary when the job has moved on", () => {
    renderWithI18n(
      <MyApplications
        {...base}
        applications={[
          application({ status: "rejected", decision_reason: "x", job_status: "awarded" }),
        ]}
        discoverableJobIds={none}
      />,
      "en",
    );
    expect(screen.getByText("Not selected")).toBeTruthy();
    expect(screen.getByText("Awarded")).toBeTruthy();
    expect(screen.getByText("Your application was not selected")).toBeTruthy();
  });

  it("does not repeat 'Open' beside a live candidacy, where it says nothing", () => {
    const { container } = renderWithI18n(
      <MyApplications {...base} applications={[application()]} discoverableJobIds={live} />,
      "en",
    );
    expect(container.textContent).not.toContain("Open");
  });

  // ---- Historical context -------------------------------------------------
  /**
   * §8. The opening is gone from the board; the record of applying to it is not,
   * and it stays fully legible.
   */
  it("stays readable after the opening disappears from discovery", () => {
    const { container } = renderWithI18n(
      <MyApplications
        {...base}
        applications={[application({ status: "rejected", decision_reason: "x", job_status: "cancelled" })]}
        discoverableJobIds={none}
      />,
      "en",
    );
    expect(screen.getByRole("heading", { name: "Marble staircase cladding" })).toBeTruthy();
    expect(screen.getByText("Horizon Contracting")).toBeTruthy();
    expect(screen.getByText("Marble & granite")).toBeTruthy();
    // And no link to a detail page that would 404 for them.
    expect(container.querySelector('a[href="/home/jobs/j1"]')).toBeNull();
  });

  // ---- Empty states -------------------------------------------------------
  it("tells 'nothing yet' apart from 'nothing in this state'", () => {
    const bare = renderWithI18n(
      <MyApplications {...base} applications={[]} discoverableJobIds={none} />,
      "en",
    );
    expect(bare.container.textContent).toContain("You have not applied to anything yet");
    expect(bare.container.querySelector('a[href="/home/jobs"]')).toBeTruthy();
    bare.unmount();

    renderWithI18n(
      <MyApplications {...base} filtered applications={[]} discoverableJobIds={none} />,
      "en",
    );
    expect(screen.getByText("Nothing in this state")).toBeTruthy();
  });

  it("renders in Arabic with no raw key, enum or message path", () => {
    const { container } = renderWithI18n(
      <MyApplications
        {...base}
        applications={[application({ status: "withdrawn" })]}
        discoverableJobIds={none}
      />,
      "ar",
    );
    expect(container.textContent).not.toMatch(/marble_granite|withdrawn|cancelled/);
    expect(container.textContent).not.toMatch(/jobs\.|onboarding\./);
  });
});
