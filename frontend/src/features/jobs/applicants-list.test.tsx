import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";

// ConfirmDialog refreshes the route after a successful decision, so the router
// has to exist — the same mock confirm-dialog's own tests use.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

vi.mock("@/server/actions/job-forms", () => ({
  acceptApplicationAction: async () => ({ ok: true }),
  rejectApplicationAction: async () => ({ ok: true }),
}));

import { ApplicantsList } from "./applicants-list";
import type { JobApplicantRow } from "@/server/queries/jobs";

const applicant = (over: Partial<JobApplicantRow> = {}): JobApplicantRow =>
  ({
    application_id: "a1",
    job_id: "j1",
    status: "submitted",
    note: "Available from Sunday.",
    applied_at: "2026-09-02T09:00:00Z",
    decided_at: null,
    decision_reason: null,
    display_name: "Sayed Abdel-Rahman",
    headline: "Marble and granite fixing",
    avatar_media_id: null,
    public_profile_id: "p1",
    years_experience: 18,
    service_areas: ["New Cairo"],
    trade_keys: ["marble_granite", "tiling"],
    primary_trade_key: "marble_granite",
    ...over,
  }) as JobApplicantRow;

const base = { jobId: "j1", canManage: true, jobIsOpen: true, locale: "en" as const };

describe("ApplicantsList", () => {
  /**
   * Increment 8 has not shipped, so no installer can apply through the product
   * yet and this is the state nearly every real local job is in. It has to read
   * as a normal, explained condition — not as a failure, and not padded with
   * invented people to look populated.
   */
  it("states the empty case rather than showing an empty box", () => {
    renderWithI18n(<ApplicantsList {...base} applicants={[]} />, "en");
    expect(screen.getByTestId("applicants-empty")).toBeTruthy();
    expect(screen.getByText(/Applications will appear here/i)).toBeTruthy();
  });

  it("shows the applicant's identity and canonical trades", () => {
    renderWithI18n(<ApplicantsList {...base} applicants={[applicant()]} />, "en");
    expect(screen.getByText("Sayed Abdel-Rahman")).toBeTruthy();
    expect(screen.getByText("Marble & granite")).toBeTruthy();
    expect(screen.getByText("Tiling")).toBeTruthy();
    expect(screen.getByText("Main trade")).toBeTruthy();
  });

  it("never shows a raw trade key or a message path", () => {
    const { container } = renderWithI18n(
      <ApplicantsList {...base} applicants={[applicant()]} />,
      "ar",
    );
    expect(container.textContent).not.toMatch(/marble_granite|tiling/);
    expect(container.textContent).not.toMatch(/jobs\.|onboarding\./);
  });

  /**
   * The projection returns a null profile id for a professional who has not
   * published a profile. Linking anyway would hand the poster a route that 404s.
   */
  it("links to the public profile only when there is one to open", () => {
    const listed = renderWithI18n(<ApplicantsList {...base} applicants={[applicant()]} />, "en");
    expect(listed.container.querySelector('a[href="/p/p1"]')).toBeTruthy();
    listed.unmount();

    const hidden = renderWithI18n(
      <ApplicantsList {...base} applicants={[applicant({ public_profile_id: null })]} />,
      "en",
    );
    expect(hidden.container.querySelector('a[href^="/p/"]')).toBeNull();
    // But the person is still NAMED — that is the whole point of the projection.
    expect(screen.getByText("Sayed Abdel-Rahman")).toBeTruthy();
  });

  it("shows the applicant's own note", () => {
    renderWithI18n(<ApplicantsList {...base} applicants={[applicant()]} />, "en");
    expect(screen.getByText("Available from Sunday.")).toBeTruthy();
  });

  /**
   * No fit score, no ranking, no recommendation, no contact detail. None of them
   * has any backing in this repository, and a number the product invented is one
   * the poster would then trust.
   */
  it("invents no score, ranking or contact detail", () => {
    const { container } = renderWithI18n(
      <ApplicantsList {...base} applicants={[applicant()]} />,
      "en",
    );
    expect(container.textContent).not.toMatch(/\b(match|fit|score|rank|recommended|%)\b/i);
    expect(container.textContent).not.toMatch(/@|\+20|\b01[0-9]{9}\b/);
  });

  it("offers Award and Decline on a live candidacy when the caller may decide", () => {
    renderWithI18n(<ApplicantsList {...base} applicants={[applicant()]} />, "en");
    expect(screen.getByRole("button", { name: "Award" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
  });

  it("offers no decision to a member who only holds job.post", () => {
    renderWithI18n(
      <ApplicantsList {...base} canManage={false} applicants={[applicant()]} />,
      "en",
    );
    expect(screen.queryByRole("button", { name: "Award" })).toBeNull();
    expect(screen.getByText(/cannot decide applications/i)).toBeTruthy();
  });

  /** Once the job is awarded there is nothing left to decide. */
  it("offers no decision once the job is no longer open", () => {
    renderWithI18n(
      <ApplicantsList {...base} jobIsOpen={false} applicants={[applicant()]} />,
      "en",
    );
    expect(screen.queryByRole("button", { name: "Award" })).toBeNull();
  });

  it("offers no decision on a candidacy that is already decided", () => {
    renderWithI18n(
      <ApplicantsList
        {...base}
        applicants={[applicant({ status: "rejected", decision_reason: "Booked elsewhere." })]}
      />,
      "en",
    );
    expect(screen.queryByRole("button", { name: "Award" })).toBeNull();
    // The poster's own words stay legible to whoever opens this next.
    expect(screen.getByText("Booked elsewhere.")).toBeTruthy();
  });

  it("labels each candidacy with its state, in the poster's words", () => {
    renderWithI18n(
      <ApplicantsList {...base} applicants={[applicant({ status: "rejected", decision_reason: "x" })]} />,
      "en",
    );
    expect(screen.getByText("Not selected")).toBeTruthy();
  });
});
