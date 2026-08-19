import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { applyThemePreference, type Theme, type ThemePreference } from "./config";
import { useThemeState } from "./use-theme";

/**
 * ONE PREFERENCE, TWO CONTROLS, NO SECOND COPY.
 *
 * The product has a quick Light/Dark switch in the header and a full
 * System/Light/Dark group in the profile menu. Both used to seed local state
 * from the DOM once at mount, which is fine until both are mounted at the same
 * time — then changing the theme in one left the other showing the previous
 * choice. These tests pin the mechanism that fixed it: `<html>` is the single
 * source of truth and every reader subscribes to it.
 */

function Probe({
  seedPreference = "system",
  seedTheme = "light",
  label,
}: {
  seedPreference?: ThemePreference;
  seedTheme?: Theme;
  label: string;
}) {
  const { preference, theme } = useThemeState(seedPreference, seedTheme);
  return (
    <span data-testid={label}>
      {preference}/{theme}
    </span>
  );
}

let mediaMatches = false;
const mediaListeners = new Set<() => void>();

beforeEach(() => {
  mediaMatches = false;
  mediaListeners.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme-pref");
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return mediaMatches;
    },
    addEventListener: (_: string, fn: () => void) => mediaListeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => mediaListeners.delete(fn),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useThemeState", () => {
  it("corrects a stale server seed from the document after mount", async () => {
    // The server renders `system` as light because it cannot know the OS. The
    // pre-paint script has since resolved it to dark.
    document.documentElement.setAttribute("data-theme-pref", "system");
    document.documentElement.classList.add("dark");

    render(<Probe label="probe" seedPreference="system" seedTheme="light" />);
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("system/dark"));
  });

  /**
   * THE REGRESSION. Two mounted readers, one writer — the second reader must not
   * be left on the value it captured at mount.
   */
  it("keeps two independent readers in agreement when either one writes", async () => {
    document.documentElement.setAttribute("data-theme-pref", "light");

    render(
      <>
        <Probe label="header" seedPreference="light" seedTheme="light" />
        <Probe label="menu" seedPreference="light" seedTheme="light" />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId("header")).toHaveTextContent("light/light"));

    // What the header's quick switch does.
    applyThemePreference("dark");
    await waitFor(() => {
      expect(screen.getByTestId("header")).toHaveTextContent("dark/dark");
      expect(screen.getByTestId("menu")).toHaveTextContent("dark/dark");
    });

    // And what the profile menu's three-way group does, including `system`.
    mediaMatches = true;
    applyThemePreference("system");
    await waitFor(() => {
      expect(screen.getByTestId("header")).toHaveTextContent("system/dark");
      expect(screen.getByTestId("menu")).toHaveTextContent("system/dark");
    });
  });

  it("follows the OS while the preference is `system`, and ignores it otherwise", async () => {
    document.documentElement.setAttribute("data-theme-pref", "system");
    render(<Probe label="probe" seedPreference="system" seedTheme="light" />);
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("system/light"));

    // Sunset on a machine set to switch automatically. Nothing writes the DOM on
    // its own — the pre-paint script ran once, at load.
    mediaMatches = true;
    mediaListeners.forEach((fn) => fn());
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("system/dark"));

    // An explicit choice is the user overriding the OS; it must NOT be undone by
    // the next OS change.
    applyThemePreference("light");
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("light/light"));
    mediaMatches = false;
    mediaListeners.forEach((fn) => fn());
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("light/light"));
  });
});
