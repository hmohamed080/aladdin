"use client";

import { useEffect, useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/context";
import { setLocale, setTheme } from "@/server/actions/preferences";
import { Button } from "@/components/ui/controls";
import { SunIcon, MoonIcon } from "@/components/ui/icons";

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
 * Binary light/dark toggle for the surfaces OUTSIDE the authenticated shell —
 * auth, onboarding, business creation, and the settings page. Inside the
 * workspace the same preference is set from the profile menu, which offers the
 * full System/Light/Dark choice; both write the SAME cookie through the SAME
 * action, so there is one theme system and not two.
 *
 * `current` is the server's guess and only seeds the first paint. Because the
 * preference may be `system`, the resolved theme can differ from that guess by
 * the time the script in <head> has run — so after mount the control reads the
 * live `.dark` class and follows it. Toggling always writes an EXPLICIT choice:
 * a user reaching for this control is overriding their OS on purpose.
 */
export function ThemeSwitch({ current }: { current: "light" | "dark" }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [theme, setThemeState] = useState<"light" | "dark">(current);

  useEffect(() => {
    setThemeState(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  const next = theme === "dark" ? "light" : "dark";
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`${t("nav.theme")}: ${theme === "dark" ? t("nav.themeLight") : t("nav.themeDark")}`}
      disabled={pending}
      onClick={() =>
        start(async () => {
          document.documentElement.classList.toggle("dark", next === "dark");
          document.documentElement.setAttribute("data-theme-pref", next);
          setThemeState(next);
          await setTheme(next);
        })
      }
    >
      {theme === "dark" ? <SunIcon size={18} /> : <MoonIcon size={18} />}
    </Button>
  );
}
