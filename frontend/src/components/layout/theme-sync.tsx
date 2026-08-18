"use client";

import { useEffect } from "react";

/**
 * Keeps the "System" appearance choice LIVE.
 *
 * The pre-paint script in the document head resolves the OS colour scheme once,
 * at load. That is enough for a page view, but not for a session: a user whose
 * machine switches to dark at sunset — or who flips the OS setting with the app
 * open — would otherwise keep the scheme they happened to load with until the
 * next full navigation.
 *
 * It acts ONLY while the stored preference is `system`. An explicit light/dark
 * choice is the user overriding their OS, and must not be walked back by it.
 * Nothing is written anywhere: this component owns no state and no cookie, it
 * only re-applies the same decision the head script already made.
 */
export function ThemeSync() {
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const root = document.documentElement;
      if (root.getAttribute("data-theme-pref") !== "system") return;
      root.classList.toggle("dark", query.matches);
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return null;
}
