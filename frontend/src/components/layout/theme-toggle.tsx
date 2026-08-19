"use client";

import { useTransition } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { setTheme } from "@/server/actions/preferences";
import { applyThemePreference, type Theme } from "@/lib/theme/config";
import { useThemeState } from "@/lib/theme/use-theme";
import { SunIcon, MoonIcon } from "@/components/ui/icons";

/**
 * The header's direct Light/Dark switch.
 *
 * WHY IT IS A PAIR OF SEGMENTS AND NOT ONE BUTTON
 * A single toggle button has a question it can never answer on its own: does the
 * moon on it mean "you are in dark" or "press for dark"? Both readings are
 * common in the wild, so whichever one we picked, half of the people looking at
 * it would read the current theme backwards. Two segments with the active one
 * lit states the answer instead of implying it — the sun is on when it is light
 * out. It is also the same segmented pattern the profile menu already uses for
 * appearance and language, so this is a compact instance of a control the
 * product has, not a new species of switch.
 *
 * IT OWNS NO STATE
 * The preference lives in one cookie and is rendered by one class on `<html>`.
 * This component writes through the same `setTheme` action and the same
 * `applyThemePreference` helper as the profile menu, and reads back what the
 * document actually resolved to. Adding a second source of truth here is how you
 * get a header that says light while the page is dark.
 *
 * SYSTEM IS NOT LOST
 * `system` remains available in the profile menu, which is the right home for a
 * three-way preference. This control answers the far more frequent question —
 * "make it dark, now" — and choosing a side here is a deliberate override of
 * `system`, exactly as picking Light or Dark in the menu is.
 *
 * SSR
 * The server cannot know the OS setting, so a `system` user's first paint is
 * corrected by the pre-paint script before anything is shown. `suppressHydration
 * Warning` covers the one frame where this markup and the corrected document
 * disagree; the effect below then syncs the control to the document.
 */
export function ThemeToggle({ initial = "light" }: { initial?: Theme }) {
  const { t } = useI18n();
  // Read from the document, not from local state — see lib/theme/use-theme. This
  // control and the profile menu's must never be able to disagree.
  const { theme } = useThemeState(initial === "dark" ? "dark" : "light", initial);
  const [, start] = useTransition();

  const choose = (next: Theme) => {
    applyThemePreference(next);
    start(async () => {
      await setTheme(next);
    });
  };

  return (
    <div
      role="radiogroup"
      aria-label={t("account.appearance")}
      data-testid="theme-toggle"
      className="flex shrink-0 items-center gap-0.5 rounded-pill border bg-surface-2/50 p-0.5"
      suppressHydrationWarning
    >
      {(
        [
          ["light", SunIcon],
          ["dark", MoonIcon],
        ] as const
      ).map(([value, Icon]) => {
        const selected = value === theme;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            // The visible glyph is decorative; the name has to carry both the
            // option AND that this is the appearance control, because a screen
            // reader user arrives here with no sun to look at.
            aria-label={t(`account.theme.${value}`)}
            onClick={() => choose(value)}
            data-testid={`theme-quick-${value}`}
            suppressHydrationWarning
            className={cn(
              "grid h-7 w-7 place-items-center rounded-pill transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
              selected
                ? "bg-accent-solid/15 text-accent shadow-sm"
                : "text-fg-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            <Icon size={15} />
          </button>
        );
      })}
    </div>
  );
}
