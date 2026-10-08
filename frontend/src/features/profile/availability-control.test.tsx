import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { I18nProvider } from "@/lib/i18n/context";
import { renderWithI18n } from "@/test/render";

type State = { ok: boolean; code?: string };
const result: { value: State } = { value: { ok: true } };

vi.mock("@/server/actions/availability", () => ({
  setAvailabilityAction: async (): Promise<State> => result.value,
}));

import { AvailabilityControl } from "./availability-control";
import { availabilityState } from "@/lib/profile/availability-state";

const DECLARED = new Date(Date.now() - 3 * 86_400_000).toISOString();

/** Defaults to NOT DECLARED (false, no marker). The state is derived exactly as the server derives it. */
const avail = (over: Partial<{ available: boolean; updatedAt: string | null }> = {}) => {
  const base = { available: false, updatedAt: null as string | null, ...over };
  return { ...base, state: availabilityState(base.available, base.updatedAt) };
};

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
    renderWithI18n(<AvailabilityControl availability={avail({ available: false, updatedAt: DECLARED })} />, "en");
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

  it("NOT SPECIFIED is its own state: it is not called unavailable, and it offers BOTH answers", () => {
    const { container } = renderWithI18n(<AvailabilityControl availability={avail()} />, "en");
    expect(screen.getByText("Not specified")).toBeTruthy();
    expect(screen.queryByText("Not taking work")).toBeNull();
    expect(screen.getByRole("button", { name: "Mark me available" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark me unavailable" })).toBeTruthy();
    const values = [...container.querySelectorAll('input[name="available"]')].map((i) => (i as HTMLInputElement).value);
    expect(values.sort()).toEqual(["0", "1"]);
    expect(container.querySelector('[data-availability-state="unknown"]')).toBeTruthy();
  });

  it("posts the DESTINATION value, so a double-click converges", () => {
    // The hidden field carries the value being requested. If this posted a
    // "toggle" instead, two rapid submissions would land the person on the
    // opposite of what they clicked.
    const { container } = renderWithI18n(
      <AvailabilityControl availability={avail({ available: false, updatedAt: DECLARED })} />,
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
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => n === "available")).toBe(true);
  });

  it("shows the age, and invites a first answer when there is none", () => {
    const { unmount } = renderWithI18n(<AvailabilityControl availability={avail()} />, "en");
    expect(screen.getByText(/You haven't said yet/)).toBeTruthy();
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

/**
 * HYDRATION. The age ("Updated 3 minutes ago") is relative to NOW, and this component is server-rendered and then
 * hydrated a moment later — often across a minute boundary. If the hydrated text differs from the server's, React
 * throws a hydration error (#418) and throws the server markup away. The line is therefore allowed to differ on the
 * first client render (`suppressHydrationWarning`) and is re-derived from the client's own clock right after mount.
 */
describe("AvailabilityControl hydration", () => {
  afterEach(() => vi.useRealTimers());

  it("does not trip a hydration mismatch when the page ages between the server render and hydration", async () => {
    const T = new Date("2027-03-01T12:00:00Z").getTime();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T);
    const declaredAt = new Date(T - 2 * 60_000).toISOString(); // "2 minutes ago" when the server renders
    const tree = (
      <I18nProvider locale="en" dir="ltr">
        <AvailabilityControl availability={avail({ available: true, updatedAt: declaredAt })} />
      </I18nProvider>
    );
    const html = renderToString(tree);
    expect(html).toContain("Updated 2 minutes ago");

    // The browser hydrates three minutes later.
    vi.setSystemTime(T + 3 * 60_000);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const recoverable: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await act(async () => {
      hydrateRoot(container, tree, { onRecoverableError: (error) => recoverable.push(error) });
    });
    const hydrationErrors = consoleError.mock.calls.filter((call) => /hydrat|did not match/i.test(String(call[0])));
    consoleError.mockRestore();
    expect(recoverable).toEqual([]);
    expect(hydrationErrors).toEqual([]);
    // and once mounted it shows the client's own age, not the stale server text
    expect(container.textContent).toContain("Updated 5 minutes ago");
    container.remove();
  });
});
