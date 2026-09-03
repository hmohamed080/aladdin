import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/server/actions/reviews", () => ({
  submitReviewAction: async () => ({ ok: true }),
}));

import { LeaveReview } from "./leave-review";

const ASSIGNMENT = "11111111-1111-4111-8111-111111111111";

describe("LeaveReview visibility", () => {
  /**
   * The rule that keeps the control honest: it appears only where the RPC would
   * accept it. A button that shows up and is then refused is worse than one that
   * never appeared, because the person has already decided to act.
   */
  it("renders NOTHING without the authority to review", () => {
    const { container } = renderWithI18n(
      <LeaveReview assignmentId={ASSIGNMENT} canReview={false} existing={null} locale="en" />,
      "en",
    );
    expect(container.innerHTML).toBe("");
  });

  it("offers the control when the caller can review and none exists", () => {
    renderWithI18n(
      <LeaveReview assignmentId={ASSIGNMENT} canReview existing={null} locale="en" />,
      "en",
    );
    expect(screen.getByRole("button", { name: "Leave review" })).toBeTruthy();
  });

  /**
   * A colleague WITHOUT job.manage still sees the submitted review — it is their
   * organization's statement — but is never offered a control. The two facts are
   * independent, which is why `canReview` and `existing` are separate props.
   */
  it("shows a submitted review even to someone who could not have written it", () => {
    renderWithI18n(
      <LeaveReview
        assignmentId={ASSIGNMENT}
        canReview={false}
        existing={{ rating: 4, comment: "Good work.", createdAt: "2026-09-01T00:00:00Z" }}
        locale="en"
      />,
      "en",
    );
    expect(screen.getByRole("heading", { name: "Your review" })).toBeTruthy();
    expect(screen.getByText("Good work.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Leave review" })).toBeNull();
  });
});

describe("the submitted state", () => {
  const existing = { rating: 5, comment: "Excellent.", createdAt: "2026-09-01T00:00:00Z" };

  /**
   * §4 rendered. There is no edit or delete control to hide — the table refuses
   * both for everybody — so the assertion is that none is offered AND that the
   * person is told why.
   */
  it("offers no way to change or remove it, and says so", () => {
    renderWithI18n(
      <LeaveReview assignmentId={ASSIGNMENT} canReview existing={existing} locale="en" />,
      "en",
    );
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Leave review" })).toBeNull();
    expect(screen.getByText(/cannot be changed once submitted/)).toBeTruthy();
  });

  it("shows the rating as both stars and a numeral", () => {
    renderWithI18n(
      <LeaveReview assignmentId={ASSIGNMENT} canReview existing={existing} locale="en" />,
      "en",
    );
    expect(screen.getByRole("img", { name: "5 out of 5" })).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("lets an organization-written comment resolve its own direction", () => {
    const { container } = renderWithI18n(
      <LeaveReview assignmentId={ASSIGNMENT} canReview existing={existing} locale="ar" />,
      "ar",
    );
    expect(container.querySelector('[dir="auto"]')).toBeTruthy();
  });
});

describe("the form", () => {
  it("warns that the review is final BEFORE it is written, not only after", () => {
    renderWithI18n(
      <LeaveReview assignmentId={ASSIGNMENT} canReview existing={null} locale="en" />,
      "en",
    );
    fireEvent.click(screen.getByRole("button", { name: "Leave review" }));
    expect(screen.getByText(/cannot be changed or removed once submitted/)).toBeTruthy();
  });

  /**
   * The person should know both facts while they are still deciding what to
   * write: it is published under the organization's name, and their own name is
   * never shown.
   */
  it("states that the review is organization-authored and the writer is not named", () => {
    renderWithI18n(
      <LeaveReview assignmentId={ASSIGNMENT} canReview existing={null} locale="en" />,
      "en",
    );
    fireEvent.click(screen.getByRole("button", { name: "Leave review" }));
    expect(screen.getByText(/published under your organisation's name/)).toBeTruthy();
    expect(screen.getByText(/never shown/)).toBeTruthy();
  });

  it("cannot be submitted before a rating is chosen", () => {
    renderWithI18n(
      <LeaveReview assignmentId={ASSIGNMENT} canReview existing={null} locale="en" />,
      "en",
    );
    fireEvent.click(screen.getByRole("button", { name: "Leave review" }));
    const submit = screen.getByRole("button", { name: "Submit review" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "4 out of 5" }));
    expect((screen.getByRole("button", { name: "Submit review" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("marks the chosen rating for a screen reader, not only by colour", () => {
    renderWithI18n(
      <LeaveReview assignmentId={ASSIGNMENT} canReview existing={null} locale="en" />,
      "en",
    );
    fireEvent.click(screen.getByRole("button", { name: "Leave review" }));
    fireEvent.click(screen.getByRole("radio", { name: "3 out of 5" }));
    expect(screen.getByRole("radio", { name: "3 out of 5" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByRole("radio", { name: "5 out of 5" }).getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("treats the comment as optional", () => {
    renderWithI18n(
      <LeaveReview assignmentId={ASSIGNMENT} canReview existing={null} locale="en" />,
      "en",
    );
    fireEvent.click(screen.getByRole("button", { name: "Leave review" }));
    const comment = screen.getByLabelText(/Comment/) as HTMLTextAreaElement;
    expect(comment.required).toBe(false);
  });

  it("offers no category scores to fill in", () => {
    const { container } = renderWithI18n(
      <LeaveReview assignmentId={ASSIGNMENT} canReview existing={null} locale="en" />,
      "en",
    );
    fireEvent.click(screen.getByRole("button", { name: "Leave review" }));
    // One rating, one comment. Five axes would be five judgements nobody asked
    // this reviewer to make.
    expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
    expect(container.querySelectorAll("textarea")).toHaveLength(1);
  });
});
