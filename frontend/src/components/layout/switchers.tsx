"use client";

import { useTransition } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { setLocale, setTheme } from "@/server/actions/preferences";
import { Button } from "@/components/ui/controls";
import { SunIcon, MoonIcon } from "@/components/ui/icons";
import { applyThemePreference } from "@/lib/theme/config";
import { useThemeState } from "@/lib/theme/use-theme";

/** Toggle Arabic <-> English (cookie-backed; reloads so the root layout re-renders). */
export function LanguageSwitch() {
  const { locale, t } = useI18n();
  const [pending, start] = useTransition();
  const next = locale === "ar" ? "en" : "ar";
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={t("nav.language")}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await setLocale(next);
          // See `ProfileMenu.chooseLocale`: the root layout owns `<html lang>`
          // and `<html dir>` and is not reliably re-rendered for the current
          // page by a revalidation, so a language switch reloads the document
          // rather than leaving an RTL shell full of English strings.
          window.location.reload();
        })
      }
    >
      <span className="min-w-5 text-center font-medium">{locale === "ar" ? "EN" : "ع"}</span>
    </Button>
  );
}

/**
 * THE one-icon Light/Dark switch. One button, one press, both directions.
 *
 * This is the product's existing binary toggle — it has always lived here for
 * the surfaces outside the authenticated shell (auth, onboarding, business
 * creation, settings) — and it is now what the top header carries too, rather
 * than a second control with its own opinion. The header briefly used a
 * two-segment pill instead; a segmented radio answers "which theme am I in"
 * more literally, but it costs a permanent 60px of a 48px bar and reads as a
 * settings widget parked in the chrome. The single icon states the same thing
 * the way the rest of the product does: it shows the theme you would GET, which
 * is also the one you are not in.
 *
 * IT OWNS NO STATE — AND THAT PART IS NOT OPTIONAL
 * An earlier version of this component seeded local state from `<html>` once, at
 * mount. That is correct while only one theme control is mounted and wrong the
 * moment two are: change the theme in the profile menu and this switch kept
 * showing the previous choice. So it reads `useThemeState`, which subscribes to
 * the class on `<html>`, and writes through `applyThemePreference` + `setTheme`
 * exactly like the profile menu. One cookie, one class, one source of truth.
 *
 * Toggling always writes an EXPLICIT choice: a user reaching for this control is
 * overriding their OS on purpose. `system` stays available in the profile menu,
 * which is the right home for a three-way preference.
 */
export function ThemeSwitch({
  current,
  compact = false,
}: {
  /** The server's guess; only seeds the first paint (the preference may be `system`). */
  current: "light" | "dark";
  /** Header density: a 28px icon box instead of a ghost button. */
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const { theme } = useThemeState(current, current);
  const next = theme === "dark" ? "light" : "dark";

  // The name carries the ACTION, not the state: a screen-reader user has no
  // glyph to look at, and "theme: dark" would leave them guessing whether that
  // is a description or a promise.
  const label = `${t("nav.theme")}: ${next === "dark" ? t("nav.themeDark") : t("nav.themeLight")}`;
  const toggle = () => {
    applyThemePreference(next);
    start(async () => {
      await setTheme(next);
    });
  };
  const Icon = theme === "dark" ? SunIcon : MoonIcon;

  if (compact) {
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        data-testid="theme-switch"
        disabled={pending}
        onClick={toggle}
        suppressHydrationWarning
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-sm text-fg-muted transition-colors",
          "hover:bg-surface-hover hover:text-fg disabled:opacity-60",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
        )}
      >
        <Icon size={16} />
      </button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={label}
      data-testid="theme-switch"
      disabled={pending}
      onClick={toggle}
      suppressHydrationWarning
    >
      <Icon size={18} />
    </Button>
  );
}
