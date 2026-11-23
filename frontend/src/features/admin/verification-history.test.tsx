import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VerificationHistory } from "./verification-history";

const labels = {
  title: "Decision history", admin_initiated: "Started by", review_started: "Review started by", changes_requested: "Changes requested by",
  approved: "Approved by", rejected: "Rejected by", unknownAdmin: "an Admin",
};

describe("VerificationHistory", () => {
  it("names the acting Admin and the time for initiation and the decision", () => {
    render(
      <VerificationHistory
        locale="en"
        labels={labels}
        events={[
          { action: "verification.admin_initiated", actorName: "Dina Admin", at: "2026-11-15T10:00:00Z" },
          { action: "verification.rejected", actorName: "Omar Admin", at: "2026-11-15T11:30:00Z" },
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toMatch(/Started by\s*Dina Admin/);
    expect(items[1]?.textContent).toMatch(/Rejected by\s*Omar Admin/);
    expect(items[1]?.textContent).toMatch(/2026|Nov/);
  });

  it("falls back to a neutral label when the Admin has no name, and renders nothing without events", () => {
    const { container, rerender } = render(<VerificationHistory locale="en" labels={labels} events={[{ action: "verification.approved", actorName: null, at: "2026-11-15T10:00:00Z" }]} />);
    expect(screen.getByRole("listitem").textContent).toMatch(/Approved by\s*an Admin/);
    rerender(<VerificationHistory locale="en" labels={labels} events={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
