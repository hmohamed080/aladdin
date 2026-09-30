import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/context";

vi.mock("@/server/actions/auth", () => ({ signOut: vi.fn() }));

const { SuspendedPanel } = await import("./suspended-panel");

afterEach(cleanup);

/**
 * PD-010: the suspended-account page renders as a client panel (it once
 * crashed when its client-only card was rendered from a Server Component),
 * says the data is kept, offers support and sign-out, and shows no Admin reason.
 */
describe("SuspendedPanel", () => {
  it("renders the suspension message with sign-out and support (English)", () => {
    render(
      <I18nProvider locale="en" dir="ltr">
        <SuspendedPanel />
      </I18nProvider>,
    );
    expect(screen.getByText("Your account is suspended")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Contact support" }).getAttribute("href")).toBe("/auth/support");
    expect(screen.queryByText(/reason/i)).toBeNull();
  });

  it("renders in Arabic", () => {
    render(
      <I18nProvider locale="ar" dir="rtl">
        <SuspendedPanel />
      </I18nProvider>,
    );
    expect(screen.getByText("حسابك موقوف")).toBeTruthy();
  });
});
