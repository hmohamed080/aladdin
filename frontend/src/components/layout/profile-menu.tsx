"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { signOut } from "@/server/actions/auth";
import { setLocale, setTheme } from "@/server/actions/preferences";
import { LOCALES, type Locale } from "@/lib/i18n/locales";
import { THEME_PREFERENCES, type ThemePreference } from "@/lib/theme/config";
import {
  UserIcon,
  SettingsIcon,
  LogOutIcon,
  SunIcon,
  MoonIcon,
  MonitorIcon,
  GlobeIcon,
} from "@/components/ui/icons";

/**
 * The account menu behind the header avatar.
 *
 * WHAT IT IS FOR, AND WHAT IT DELIBERATELY IS NOT
 * It answers "who am I signed in as, and how do I want the app to look and
 * speak". That is the whole scope. It is NOT a workspace switcher: the header
 * already carries one, and a second control that changed business context from
 * inside a menu about the person would be two doors to one room — and worse, it
 * would blur the account model's central line (a person is not a business).
 * The active workspace is shown here as CONTEXT only, never as a control.
 *
 * ONE PREFERENCE SYSTEM, NOT A SECOND ONE
 * Language writes the existing locale cookie through the existing `setLocale`
 * action; appearance writes the existing theme cookie through `setTheme`. This
 * component owns no preference state of its own. Both mirror the change onto
 * <html> immediately — React does not re-render `dir`/`lang`/`class` on the root
 * element from a server revalidation, so without the local mirror the text
 * changes language while the layout stays in the old direction.
 *
 * Sign-out goes through the trusted server action, unchanged.
 */
export function ProfileMenu({
  displayName,
  contact,
  /** Localized name of the active work context — shown, never switched here. */
  workspaceLabel,
  initials,
  /** Where "My profile" goes for this surface (personal vs. business shell). */
  profileHref,
  /** Where "Account preferences" goes; omitted when the surface has no settings. */
  preferencesHref,
  /** SSR seed for the appearance radio. Corrected from the DOM after mount. */
  themePreference,
}: {
  displayName: string | null;
  contact: string | null;
  workspaceLabel?: string | null;
  initials: string;
  profileHref?: string;
  preferencesHref?: string;
  themePreference: ThemePreference;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [theme, setThemeState] = useState<ThemePreference>(themePreference);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // The stored preference lives on <html>; after hydration that attribute is the
  // truth (the pre-paint script may have resolved `system` since SSR).
  useEffect(() => {
    const attr = document.documentElement.getAttribute("data-theme-pref");
    if (attr === "system" || attr === "light" || attr === "dark") setThemeState(attr);
  }, []);

  // Outside click and Escape both close. Escape also returns focus to the
  // trigger — a menu that closes and leaves focus on <body> strands a keyboard
  // user at the top of the document.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const chooseLocale = (next: Locale) => {
    if (next === locale) return;
    start(async () => {
      document.documentElement.setAttribute("dir", next === "ar" ? "rtl" : "ltr");
      document.documentElement.setAttribute("lang", next);
      await setLocale(next);
    });
  };

  const chooseTheme = (next: ThemePreference) => {
    setThemeState(next);
    start(async () => {
      const root = document.documentElement;
      root.setAttribute("data-theme-pref", next);
      const dark =
        next === "dark" ||
        (next === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      root.classList.toggle("dark", dark);
      await setTheme(next);
    });
  };

  const themeIcon: Record<ThemePreference, typeof SunIcon> = {
    system: MonitorIcon,
    light: SunIcon,
    dark: MoonIcon,
  };

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("account.menu")}
        data-testid="profile-menu-trigger"
        className={cn(
          "grid h-9 w-9 place-items-center rounded-pill bg-accent-solid text-label font-semibold text-brand-basalt",
          "transition-shadow hover:shadow-card",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        )}
      >
        <span aria-hidden="true">{initials}</span>
      </button>

      {open ? (
        <div
          role="menu"
          data-testid="profile-menu"
          // `end-0` and not `right-0`: the panel hangs from the trailing edge of
          // the trigger, which is the left edge in Arabic. A physical property
          // here would push the menu off-screen in RTL.
          className="absolute end-0 top-full mt-2 w-72 overflow-hidden rounded-md border border-strong bg-surface shadow-lg"
          style={{ zIndex: 600 }}
        >
          <div className="border-b px-md py-3">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-muted">
              {t("account.signedInAs")}
            </p>
            {displayName ? (
              <p className="mt-1 truncate text-body font-medium text-fg">{displayName}</p>
            ) : null}
            {contact ? (
              // `dir="ltr"` on the contact only: an email address or an E.164
              // phone number is a Latin/digit string, and letting it inherit RTL
              // reorders it into something that is not the user's address.
              <p dir="ltr" className="truncate text-label text-fg-secondary">
                {contact}
              </p>
            ) : null}
            {workspaceLabel ? (
              <p className="mt-1.5 truncate text-label text-fg-muted">
                {t("account.workingIn")}: <span className="text-fg-secondary">{workspaceLabel}</span>
              </p>
            ) : null}
          </div>

          {profileHref || preferencesHref ? (
            <div className="border-b py-1">
              {profileHref ? (
                <MenuLink href={profileHref} onNavigate={() => setOpen(false)} Icon={UserIcon}>
                  {t("account.profile")}
                </MenuLink>
              ) : null}
              {preferencesHref ? (
                <MenuLink href={preferencesHref} onNavigate={() => setOpen(false)} Icon={SettingsIcon}>
                  {t("account.preferences")}
                </MenuLink>
              ) : null}
            </div>
          ) : null}

          <div className="border-b px-md py-2.5">
            <p className="mb-1.5 flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-muted">
              <GlobeIcon size={13} />
              {t("account.language")}
            </p>
            <SegmentedGroup label={t("account.language")}>
              {LOCALES.map((value) => (
                <Segment
                  key={value}
                  selected={value === locale}
                  disabled={pending}
                  onSelect={() => chooseLocale(value)}
                  testId={`locale-${value}`}
                >
                  {t(`common.languageName.${value}`)}
                </Segment>
              ))}
            </SegmentedGroup>
          </div>

          <div className="border-b px-md py-2.5">
            <p className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-muted">
              {t("account.appearance")}
            </p>
            <SegmentedGroup label={t("account.appearance")}>
              {THEME_PREFERENCES.map((value) => {
                const Icon = themeIcon[value];
                return (
                  <Segment
                    key={value}
                    selected={value === theme}
                    disabled={pending}
                    onSelect={() => chooseTheme(value)}
                    testId={`theme-${value}`}
                  >
                    <Icon size={14} />
                    {t(`account.theme.${value}`)}
                  </Segment>
                );
              })}
            </SegmentedGroup>
          </div>

          <form action={signOut} className="py-1">
            <button
              type="submit"
              role="menuitem"
              data-testid="profile-sign-out"
              className="flex w-full items-center gap-2.5 px-md py-2 text-start text-body font-medium text-danger transition-colors hover:bg-danger/10 focus-visible:outline-none focus-visible:bg-danger/10"
            >
              <LogOutIcon size={17} />
              {t("account.signOut")}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({
  href,
  children,
  Icon,
  onNavigate,
}: {
  href: string;
  children: React.ReactNode;
  Icon: typeof UserIcon;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onNavigate}
      className="flex items-center gap-2.5 px-md py-2 text-body text-fg transition-colors hover:bg-surface-2/70 focus-visible:outline-none focus-visible:bg-surface-2/70"
    >
      <span className="shrink-0 text-fg-muted">
        <Icon size={17} />
      </span>
      {children}
    </Link>
  );
}

/**
 * A radio group drawn as segments. `role="radiogroup"` rather than a set of
 * menu items because these choose between mutually exclusive states rather than
 * performing actions — which is also what makes arrow-key selection the correct
 * behaviour a screen reader will announce.
 */
function SegmentedGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {children}
    </div>
  );
}

function Segment({
  selected,
  disabled,
  onSelect,
  children,
  testId,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      data-testid={testId}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-sm border px-2 py-1.5 text-label font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
        "disabled:opacity-60",
        selected
          ? "border-accent-solid/50 bg-accent-solid/15 text-accent"
          : "border-transparent bg-surface-2/60 text-fg-secondary hover:bg-surface-2 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
