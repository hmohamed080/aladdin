"use client";

import { useEffect, useState } from "react";
import {
  applyThemePreference,
  readActiveTheme,
  readThemePreference,
  type Theme,
  type ThemePreference,
} from "./config";

/**
 * The live theme, read from the document rather than held per component.
 *
 * WHY THIS EXISTS — THE BUG IT FIXES
 * There are two controls for one preference: the quick Light/Dark switch in the
 * header and the full System/Light/Dark group in the profile menu. Each of them
 * used to seed a `useState` from the DOM once, on mount. That is fine while only
 * one of them is mounted, and wrong the moment both are: change the theme from
 * the header, open the account menu, and the menu still showed the OLD choice,
 * because nothing had told it. A header that says light while the menu says dark
 * is precisely the incoherence a second copy of the state produces, and it is
 * what the e2e assertion "do the two controls agree" caught.
 *
 * So neither component owns theme state any more. `<html>` is the single source
 * of truth — it already had to be, because it is what actually renders the theme
 * — and this hook subscribes to it. Any writer that goes through
 * `applyThemePreference` is observed by every reader, with no wiring between
 * them and no context provider for a value the DOM is already carrying.
 *
 * A `MutationObserver` callback runs as a microtask, so a click updates both
 * controls before the next paint; nothing flashes and no optimistic local copy
 * is needed.
 *
 * THE `system` CASE
 * Under `system` the OS can change while the app is open, and no DOM write
 * happens on its own — the pre-paint script runs at load and never again. So the
 * media query is watched too, and re-applied when (and only when) the stored
 * preference is still `system`. Without this, a workspace left open past sunset
 * on a machine set to switch automatically simply stays light.
 *
 * @param seedPreference what the SERVER rendered, from the cookie.
 * @param seedTheme      what the server resolved that to (`system` → light).
 */
export function useThemeState(
  seedPreference: ThemePreference,
  seedTheme: Theme,
): { preference: ThemePreference; theme: Theme } {
  const [preference, setPreference] = useState<ThemePreference>(seedPreference);
  const [theme, setTheme] = useState<Theme>(seedTheme);

  useEffect(() => {
    const sync = () => {
      setPreference(readThemePreference() ?? "system");
      setTheme(readActiveTheme());
    };
    // Once immediately: the pre-paint script may have resolved `system` to dark
    // since the server rendered, so the seed can already be stale at mount.
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme-pref", "class"],
    });

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onMedia = () => {
      if ((readThemePreference() ?? "system") === "system") applyThemePreference("system");
    };
    media.addEventListener("change", onMedia);

    return () => {
      observer.disconnect();
      media.removeEventListener("change", onMedia);
    };
  }, []);

  return { preference, theme };
}
