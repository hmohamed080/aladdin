import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { VerificationActions } from "./verification-actions";

vi.mock("@/server/actions/admin-forms", () => ({
  startReviewAction: vi.fn(),
  approveVerificationAction: vi.fn(),
  rejectVerificationAction: vi.fn(),
}));

const row = (verificationType: string) => ({
  id: "v1",
  subjectType: "user" as const,
  subjectName: "Sara",
  verificationType,
  requestedAccountType: "engineer",
  status: "under_review",
  reason: null,
  submittedAt: "2026-10-01T00:00:00Z",
  decidedAt: null,
});
const show = (type: string) =>
  render(
    <I18nProvider locale="en" dir="ltr">
      <VerificationActions v={row(type)} />
    </I18nProvider>,
  );
afterEach(cleanup);

describe("VerificationActions (queue) — public listing is opt-in", () => {
  it("offers an UNTICKED listing checkbox for a professional request", () => {
    show("professional");
    const box = screen.getByRole("checkbox", { name: /list this profile publicly/i }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.name).toBe("grantListing");
    fireEvent.click(box);
    expect(box.checked).toBe(true);
  });

  it("offers none for an identity request", () => {
    show("identity");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
