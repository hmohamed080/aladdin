"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { LanguageSwitch, ThemeSwitch } from "@/components/layout/switchers";
import {
  BellIcon,
  ChevronDownIcon,
  HelpIcon,
  LogOutIcon,
  MapPinIcon,
  MenuIcon,
  SettingsIcon,
  UserIcon,
} from "@/components/ui/icons";
import { InstallerSearch } from "./installer-search";
import { PROFILE, pick } from "./mock-data";
import { signOut } from "@/server/actions/auth";

const dividerClass = "hidden h-5 w-px border-e tablet:block";

/**
 * The top bar — one compact row, no header-inside-a-header. Location, search,
 * notifications and the account/theme/language cluster. Kept visually quiet
 * (a slim bar, a borderless search field, muted controls) on purpose: the
 * greeting below is the page's real opening line, not this chrome.
 *
 * STAGING CONTRACT — ported directly from components/layout/app-header.tsx:
 *
 *   data-app-header="card"        activates globals.css floating-header rule
 *   sticky top-0                  sticky positioning (globals.css overrides
 *                                 top to --shell-gutter-w via !important)
 *   border-b                      bottom edge (resting state)
 *   shadow-raised                base elevation
 *   tablet:rounded-[1.25rem]     floating card radius (staging's own value)
 *   tablet:border                 bordered card (staging's own value)
 *   tablet:shadow-card            card elevation (staging's own value)
 *
 * globals.css then provides (transparently via the attribute):
 *   background-color: color-mix(in srgb, var(--workspace) 70%, transparent)
 *   border-color: color-mix(in srgb, white 45%, var(--workspace-line))
 *   box-shadow: inset 0 1px 0 rgba(255,255,255,0.6), 0 10px 24px -16px rgba(20,32,54,0.16)
 *   position: sticky !important
 *   top: var(--shell-gutter-w) !important   (≈0.875rem breathing room)
 *
 * NO manual border/shadow/bg here — the CSS rule owns all of it.
 */
export function InstallerTopbar({
  theme,
  onMenuClick,
  displayName,
  location,
  production = false,
  context,
}: {
  theme: "light" | "dark";
  onMenuClick: () => void;
  displayName?: string;
  location?: string | null;
  production?: boolean;
  context?: ReactNode;
}) {
  const { locale, t } = useI18n();
  const resolvedName = production ? displayName || (locale === "ar" ? "حسابي" : "My account") : pick(locale, PROFILE.name);
  const initial = resolvedName.charAt(0);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!accountOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!accountRef.current?.contains(e.target as Node)) setAccountOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAccountOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [accountOpen]);

  return (
    <header
      data-app-header="card"
      className="sticky top-0 z-header isolate flex h-14 min-w-0 shrink-0 items-center gap-2.5 border-b px-3.5 shadow-raised backdrop-blur tablet:rounded-[1.25rem] tablet:border tablet:px-5 tablet:shadow-card desktop:h-12"
    >
      <button
        type="button"
        onClick={onMenuClick}
        aria-label={locale === "ar" ? "فتح القائمة" : "Open menu"}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-sm text-fg-secondary hover:bg-surface-2 hover:text-fg desktop:hidden"
      >
        <MenuIcon size={19} />
      </button>

      {/* Location selector — the craftsman's own service area, not a filter. */}
      <div className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-1.5 py-1 text-label font-medium text-fg-secondary tablet:flex">
        <MapPinIcon size={15} className="text-fg-muted" />
        {production ? location || (locale === "ar" ? "منطقة الخدمة غير محددة" : "Service area not set") : locale === "ar" ? "الشيخ زايد، الجيزة" : "Sheikh Zayed, Giza"}
        {production ? null : <ChevronDownIcon size={13} className="text-fg-muted" />}
      </div>

      <div className={dividerClass} aria-hidden="true" />

      {production && context ? <div className="hidden shrink-0 tablet:block">{context}</div> : null}

      <div className="min-w-0 flex-1">
        {production ? (
          <form action="/home/jobs" method="get" className="flex h-10 min-w-0 items-center gap-2 rounded-lg border border-field-line bg-field px-3.5">
            <input name="search" aria-label={locale === "ar" ? "ابحث عن فرص شغل" : "Search job opportunities"} placeholder={locale === "ar" ? "ابحث عن فرص شغل…" : "Search job opportunities…"} className="min-w-0 flex-1 bg-transparent text-body text-field-fg outline-none placeholder:text-field-placeholder" />
          </form>
        ) : <InstallerSearch />}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          aria-label={locale === "ar" ? "الإشعارات" : "Notifications"}
          className="relative grid h-8 w-8 shrink-0 place-items-center rounded-sm text-fg-secondary hover:bg-surface-2 hover:text-fg"
        >
          <BellIcon size={18} />
          <span className="absolute end-1.5 top-1.5 h-1.5 w-1.5 rounded-pill bg-danger" aria-hidden="true" />
        </button>

        <div className="hidden shrink-0 items-center gap-0.5 tablet:flex">
          <ThemeSwitch current={theme} compact />
          <LanguageSwitch />
        </div>
      </div>

      <div className={dividerClass} aria-hidden="true" />

      <div ref={accountRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setAccountOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={accountOpen}
          className="flex items-center gap-1.5 rounded-sm py-1 pe-1 ps-1 hover:bg-surface-2"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-pill bg-accent-solid text-label font-semibold text-on-accent">
            {initial}
          </span>
          <span className="hidden min-w-0 max-w-32 flex-col items-start desktop:flex">
            <span className="w-full truncate text-label font-medium leading-tight text-fg">{resolvedName}</span>
            <span className="w-full truncate text-[11px] leading-tight text-fg-muted">
              {t("accountType.installer_technician")}
            </span>
          </span>
          <ChevronDownIcon size={15} className="hidden shrink-0 text-fg-muted desktop:block" />
        </button>

        {accountOpen ? (
          <div
            role="menu"
            className="absolute end-0 top-[calc(100%+8px)] z-popover w-52 overflow-hidden rounded-md border bg-surface py-1 shadow-lg"
          >
            {production ? (
              <>
                <MenuLink href="/home/profile" icon={UserIcon} label={locale === "ar" ? "ملفي الشخصي" : "My profile"} />
                <MenuLink href="/home/settings" icon={SettingsIcon} label={locale === "ar" ? "الإعدادات" : "Settings"} />
                <div className="my-1 border-t" />
                <form action={signOut}><MenuRow icon={LogOutIcon} label={locale === "ar" ? "تسجيل خروج" : "Sign out"} tone="danger" submit /></form>
              </>
            ) : (
              <>
                <MenuRow icon={UserIcon} label={locale === "ar" ? "ملفي الشخصي" : "My profile"} />
                <MenuRow icon={SettingsIcon} label={locale === "ar" ? "الإعدادات" : "Settings"} />
                <MenuRow icon={HelpIcon} label={locale === "ar" ? "المساعدة والدعم" : "Help & support"} />
                <div className="my-1 border-t" />
                <MenuRow icon={LogOutIcon} label={locale === "ar" ? "تسجيل خروج" : "Sign out"} tone="danger" />
              </>
            )}
          </div>
        ) : null}
      </div>
    </header>
  );
}

function MenuRow({
  icon: Icon,
  label,
  tone = "default",
  submit = false,
}: {
  icon: typeof UserIcon;
  label: string;
  tone?: "default" | "danger";
  submit?: boolean;
}) {
  return (
    <button
      type={submit ? "submit" : "button"}
      role="menuitem"
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-2 text-label font-medium transition-colors",
        tone === "danger" ? "text-danger hover:bg-danger/10" : "text-fg-secondary hover:bg-surface-2 hover:text-fg",
      )}
    >
      <Icon size={16} />
      {label}
    </button>
  );
}

function MenuLink({ href, icon: Icon, label }: { href: string; icon: typeof UserIcon; label: string }) {
  return <Link role="menuitem" href={href} className="flex w-full items-center gap-2.5 px-3 py-2 text-label font-medium text-fg-secondary transition-colors hover:bg-surface-2 hover:text-fg"><Icon size={16} />{label}</Link>;
}
