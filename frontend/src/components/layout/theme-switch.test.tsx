import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";

/**
 * THE HEADER'S LIGHT/DARK SWITCH — that it can be pressed MORE THAN ONCE.
 *
 * THE DEFECT THESE PIN. `ThemeSwitch` persists the preference inside
 * `useTransition` and renders `disabled={pending}` while it is in flight, which
 * is correct: a control that is writing should not be pressed again mid-write.
 * What made it a bug was `setTheme` ending in `revalidatePath("/", "layout")`.
 * A transition does not commit until the re-render its action triggered has been
 * applied, so the toggle stayed disabled for as long as the ENTIRE app layout
 * took to rebuild server-side. On the B2B shell that is workspace context, the
 * header's identity/notification/chat fan-out and the dashboard's own queries —
 * measured, it did not re-enable within 30 seconds. One press killed the control
 * for the rest of the page's life.
 *
 * And the revalidation bought nothing: the theme is a class on the ROOT <html>
 * element, which React does not re-render from a server revalidation. That is
 * why `applyThemePreference` writes the document directly, and why the page is
 * already correct before the action is even awaited.
 *
 * So the assertions below are about the LIFECYCLE, not the styling: press, land,
 * re-enable, press again — and never strand the control, even when the write
 * fails. `setTheme` is mocked because a server action cannot run in this
 * environment; what is under test is how the component drives it.
 */

const setTheme = vi.fn<(theme: string) => Promise<void>>();

vi.mock("@/server/actions/preferences", () => ({
  setTheme: (theme: string) => setTheme(theme),
  setLocale: vi.fn(),
}));

// Imported after the mock is registered.
const { ThemeSwitch } = await import("./switchers");

/** The control, by the test id the E2E suite drives it with too. */
const control = () => screen.getByTestId("theme-switch") as HTMLButtonElement;

beforeEach(() => {
  setTheme.mockReset();
  setTheme.mockResolvedValue(undefined);
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme-pref");
  // `applyThemePreference` consults the media query for the `system` case.
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ThemeSwitch", () => {
  it("applies dark immediately and re-enables once the write settles", async () => {
    renderWithI18n(<ThemeSwitch current="light" />);

    fireEvent.click(control());

    // The document is updated FIRST — before, and independently of, persistence.
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.getAttribute("data-theme-pref")).toBe("dark");
    expect(setTheme).toHaveBeenCalledWith("dark");

    // And the control comes back. This is the assertion the bug failed.
    await waitFor(() => expect(control().disabled).toBe(false));
  });

  it("toggles back to light in the SAME session, with no reload", async () => {
    renderWithI18n(<ThemeSwitch current="light" />);

    fireEvent.click(control());
    await waitFor(() => expect(control().disabled).toBe(false));
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    /* THE SECOND PRESS IS THE WHOLE POINT. With the layout revalidation in
       place this never landed: the control was still disabled, so the click did
       nothing and the user was stuck in dark until a hard reload. */
    fireEvent.click(control());
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(false));
    expect(document.documentElement.getAttribute("data-theme-pref")).toBe("light");
    expect(setTheme).toHaveBeenNthCalledWith(2, "light");

    await waitFor(() => expect(control().disabled).toBe(false));
  });

  it("survives many presses — the control never latches disabled", async () => {
    renderWithI18n(<ThemeSwitch current="light" />);

    for (let i = 0; i < 4; i++) {
      await waitFor(() => expect(control().disabled).toBe(false));
      fireEvent.click(control());
    }
    await waitFor(() => expect(control().disabled).toBe(false));
    expect(setTheme).toHaveBeenCalledTimes(4);
    // Four flips from light ends light again.
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("a FAILED write still re-enables the control, and keeps the applied theme", async () => {
    /* The requirement this pins: "failure/persistence errors cannot leave the
       switch permanently disabled". An error thrown inside the transition would
       propagate instead of letting it settle — the same dead control by another
       route. The theme the user asked for is already on the document; the only
       thing a failed write costs is that it will not survive a reload. */
    setTheme.mockRejectedValue(new Error("network down"));
    renderWithI18n(<ThemeSwitch current="light" />);

    fireEvent.click(control());
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    await waitFor(() => expect(control().disabled).toBe(false));

    // And it is still usable afterwards.
    setTheme.mockResolvedValue(undefined);
    fireEvent.click(control());
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(false));
  });

  it("is reachable and operable from the keyboard", async () => {
    renderWithI18n(<ThemeSwitch current="light" />);

    control().focus();
    expect(document.activeElement).toBe(control());

    // A native <button> activates on Enter/Space; fire the click that produces.
    fireEvent.keyDown(control(), { key: "Enter" });
    fireEvent.click(control());

    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
    await waitFor(() => expect(control().disabled).toBe(false));
  });

  it("names the theme the press would GIVE you, not the one you are in", async () => {
    renderWithI18n(<ThemeSwitch current="light" />);
    // In light the control offers dark; after the flip it offers light back.
    const before = control().getAttribute("aria-label") ?? "";
    fireEvent.click(control());
    await waitFor(() => expect(control().getAttribute("aria-label")).not.toBe(before));
  });
});

/**
 * F4 — the label used to read "Theme: Dark" while the page was genuinely
 * light (and vice versa): a bare "Theme: X" pair reads as a description of
 * the CURRENT theme, which is backwards from what the code actually computes
 * (`next`, the theme a press would apply). These pin the corrected,
 * action-phrased wording in both directions and both locales, and that the
 * accessible name and the visible tooltip never disagree.
 *
 * There is no separate "system" code path to test: `useThemeState` (see
 * lib/theme/use-theme.ts) always hands the component an already-RESOLVED
 * `Theme` ("light" | "dark"), collapsing `system` before ThemeSwitch ever
 * sees it — so exercising `current="light"` / `current="dark"` here already
 * covers the system-resolved case by construction.
 */
describe("ThemeSwitch action-phrased label (F4)", () => {
  /**
   * `current` only seeds the FIRST paint — `useThemeState`'s effect runs
   * `readActiveTheme()` against the live DOM immediately on mount (see
   * lib/theme/use-theme.ts) and that wins. So a "the page is dark" test has to
   * make the DOM actually dark first, exactly as `applyThemePreference` would
   * have left it; passing `current="dark"` alone is not enough (and was the
   * gap the first draft of these tests missed — they failed against the real
   * component instead of only asserting a fixture's opinion of itself).
   */
  const setDom = (theme: "light" | "dark") => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.setAttribute("data-theme-pref", theme);
  };

  it("on a dark page (EN), offers to switch to light — never a bare 'Theme: Dark' state label", async () => {
    setDom("dark");
    renderWithI18n(<ThemeSwitch current="dark" />, "en");
    expect(control().getAttribute("aria-label")).toBe("Switch to light theme");
  });

  it("on a light page (EN), offers to switch to dark", async () => {
    setDom("light");
    renderWithI18n(<ThemeSwitch current="light" />, "en");
    expect(control().getAttribute("aria-label")).toBe("Switch to dark theme");
  });

  it("on a dark page (AR), offers the Arabic 'switch to light' phrasing", async () => {
    setDom("dark");
    renderWithI18n(<ThemeSwitch current="dark" />, "ar");
    expect(control().getAttribute("aria-label")).toBe("التبديل إلى المظهر الفاتح");
  });

  it("on a light page (AR), offers the Arabic 'switch to dark' phrasing", async () => {
    setDom("light");
    renderWithI18n(<ThemeSwitch current="light" />, "ar");
    expect(control().getAttribute("aria-label")).toBe("التبديل إلى المظهر الداكن");
  });

  it("under System mode resolved to dark, offers to switch to light (no separate system code path)", async () => {
    // `system` never reaches ThemeSwitch as a distinct value — useThemeState
    // always hands it the theme the OS/preference already resolved to. Seed
    // the DOM the way `applyThemePreference("system")` would when the OS is
    // dark: a `dark` class, but the preference attribute stays "system".
    document.documentElement.classList.add("dark");
    document.documentElement.setAttribute("data-theme-pref", "system");
    renderWithI18n(<ThemeSwitch current="dark" />, "en");
    expect(control().getAttribute("aria-label")).toBe("Switch to light theme");
  });

  it("the compact (header) variant's visible title matches the accessible name exactly", async () => {
    setDom("dark");
    renderWithI18n(<ThemeSwitch current="dark" compact />, "en");
    const el = control();
    expect(el.getAttribute("title")).toBe(el.getAttribute("aria-label"));
    expect(el.getAttribute("title")).toBe("Switch to light theme");
  });

  it("the label flips correctly after a live toggle, in both directions", async () => {
    renderWithI18n(<ThemeSwitch current="light" />, "en");
    expect(control().getAttribute("aria-label")).toBe("Switch to dark theme");

    fireEvent.click(control());
    await waitFor(() => expect(control().getAttribute("aria-label")).toBe("Switch to light theme"));

    fireEvent.click(control());
    await waitFor(() => expect(control().getAttribute("aria-label")).toBe("Switch to dark theme"));
  });
});
