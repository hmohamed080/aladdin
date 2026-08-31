import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";

type State = { ok: boolean; code?: string };
const result: { value: State } = { value: { ok: true } };

vi.mock("@/server/actions/availability", () => ({
  setAvailabilityAction: async (): Promise<State> => result.value,
}));

import { AvailabilityControl } from "./availability-control";

const avail = (over: Partial<{ available: boolean; updatedAt: string | null }> = {}) => ({
  available: false,
  updatedAt: null,
  ...over,
});

beforeEach(() => {
  result.value = { ok: true };
});

/**
 * The professional's own availability control.
 *
 * What is asserted is the part a screenshot would not catch: that the BUTTON
 * names the state it will move to while the CURRENT state is stated separately,
 * and that the form posts a value rather than a flip. Both exist because this is
 * a server round trip that can be refused — a switch-shaped control would move,
 * snap back, and explain nothing.
 */
describe("AvailabilityControl", () => {
  it("states the current state and offers the opposite one — English", () => {
    renderWithI18n(<AvailabilityControl availability={avail({ available: false })} />, "en");
    expect(screen.getByText("Not taking work")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark me available" })).toBeTruthy();
    // The button must not name the state the person is already in.
    expect(screen.queryByRole("button", { name: "Mark me unavailable" })).toBeNull();
  });

  it("flips which state it offers once the person is available", () => {
    renderWithI18n(<AvailabilityControl availability={avail({ available: true })} />, "en");
    expect(screen.getByText("Available for work")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark me unavailable" })).toBeTruthy();
  });

  it("posts the DESTINATION value, so a double-click converges", () => {
    // The hidden field carries the value being requested. If this posted a
    // "toggle" instead, two rapid submissions would land the person on the
    // opposite of what they clicked.
    const { container } = renderWithI18n(
      <AvailabilityControl availability={avail({ available: false })} />,
      "en",
    );
    const hidden = container.querySelector('input[name="available"]') as HTMLInputElement;
    expect(hidden.value).toBe("1");

    const { container: c2 } = renderWithI18n(
      <AvailabilityControl availability={avail({ available: true })} />,
      "en",
    );
    expect((c2.querySelector('input[name="available"]') as HTMLInputElement).value).toBe("0");
  });

  it("never posts a timestamp", () => {
    const { container } = renderWithI18n(<AvailabilityControl availability={avail()} />, "en");
    const names = [...container.querySelectorAll("input")].map((i) => i.getAttribute("name"));
    expect(names).toEqual(["available"]);
  });

  it("shows the age, and 'not set' when there is none", () => {
    const { unmount } = renderWithI18n(<AvailabilityControl availability={avail()} />, "en");
    expect(screen.getByText("Not set yet")).toBeTruthy();
    unmount();

    renderWithI18n(
      <AvailabilityControl
        availability={avail({ available: true, updatedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() })}
      />,
      "en",
    );
    expect(screen.getByText(/^Updated /)).toBeTruthy();
  });

  it("says what the flag does NOT do", () => {
    // Pilot testers read an availability control as a calendar or a login state.
    // Saying so once, in place, is cheaper than the support conversation — and it
    // is also the O3 promise, stated to the person it binds.
    renderWithI18n(<AvailabilityControl availability={avail()} />, "en");
    expect(screen.getByText(/nothing switches it off for you/i)).toBeTruthy();
    expect(screen.getByText(/not a calendar/i)).toBeTruthy();
  });

  it("renders in Arabic, the default locale, with no key leak", () => {
    const { container } = renderWithI18n(
      <AvailabilityControl availability={avail({ available: true })} />,
      "ar",
    );
    expect(screen.getByText("متاح للعمل")).toBeTruthy();
    expect(screen.getByRole("button", { name: "حدِّد أنك غير متاح" })).toBeTruthy();
    expect(container.textContent).not.toMatch(/profile\./);
  });
});
