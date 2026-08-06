"use client";

import { useTransition } from "react";
import { useI18n } from "@/lib/i18n/context";
import { setLocale, setTheme } from "@/server/actions/preferences";
import { Button } from "@/components/ui/controls";
import { SunIcon, MoonIcon } from "@/components/ui/icons";

/** Toggle Arabic <-> English (cookie-backed; re-renders the server layout). */
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
      onClick={() => start(() => setLocale(next))}
    >
      <span className="min-w-5 text-center font-medium">{locale === "ar" ? "EN" : "ع"}</span>
    </Button>
  );
}

/** Toggle light <-> dark (cookie-backed). Reads current from the <html> class. */
export function ThemeSwitch({ current }: { current: "light" | "dark" }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const next = current === "dark" ? "light" : "dark";
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`${t("nav.theme")}: ${current === "dark" ? t("nav.themeLight") : t("nav.themeDark")}`}
      disabled={pending}
      onClick={() =>
        start(async () => {
          document.documentElement.classList.toggle("dark", next === "dark");
          await setTheme(next);
        })
      }
    >
      {current === "dark" ? <SunIcon size={18} /> : <MoonIcon size={18} />}
    </Button>
  );
}
