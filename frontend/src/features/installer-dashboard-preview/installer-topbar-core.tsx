"use client";

import { accountTypeLabel } from "@/lib/i18n/account-type-label";
import { useRef, useState } from "react";
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
import type { InstallerOpportunityVM } from "./view-model";
import { signOut } from "@/server/actions/auth";
import { FloatingMenu } from "@/components/ui/floating-menu";

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
export function InstallerTopbarCore({
  theme,
  onMenuClick,
  displayName,
  location,
  production = false,
  searchJobs,
}: {
  theme: "light" | "dark";
  onMenuClick: () => void;
  displayName?: string;
  location?: string | null;
  production?: boolean;
  /** Real, bounded opportunities for the shared search overlay — required in
   *  production; the preview falls back to its own mock list. */
  searchJobs?: readonly InstallerOpportunityVM[];
}) {
  const { locale, t } = useI18n();
  const resolvedName = displayName || (locale === "ar" ? "حسابي" : "My account");
  const initial = resolvedName.charAt(0);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountButton = useRef<HTMLButtonElement>(null);

  return (
    <header
      data-app-header="card"
      className={cn(
        "sticky top-0 z-header isolate flex min-w-0 shrink-0 items-center gap-2.5 border-b px-3.5 shadow-raised backdrop-blur tablet:rounded-[1.25rem] tablet:border tablet:px-5 tablet:shadow-card desktop:h-12",
        // Phones: a second row carries the service area, so the bar grows.
        "h-auto min-h-14 flex-wrap py-1.5 tablet:h-14 tablet:min-h-0 tablet:flex-nowrap tablet:py-0",
      )}
    >
      <button
        type="button"
        onClick={onMenuClick}
        aria-label={locale === "ar" ? "فتح القائمة" : "Open menu"}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-sm text-fg-secondary hover:bg-surface-2 hover:text-fg desktop:hidden"
      >
        <MenuIcon size={19} />
      </button>

      {/* Location selector — the craftsman's own service area, not a filter. */}
      <div className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-1.5 py-1 text-label font-medium text-fg-secondary tablet:flex">
        <MapPinIcon size={15} className="text-fg-muted" />
        {production ? location || (locale === "ar" ? "منطقة الخدمة غير محددة" : "Service area not set") : locale === "ar" ? "الشيخ زايد، الجيزة" : "Sheikh Zayed, Giza"}
      </div>

      <div className={dividerClass} aria-hidden="true" />

      <div className="min-w-0 flex-1">
        <InstallerSearch jobs={searchJobs ?? []} production={production} />
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {production ? null : (
          <button
            type="button"
            aria-label={locale === "ar" ? "الإشعارات" : "Notifications"}
            className="relative grid h-10 w-10 shrink-0 place-items-center rounded-sm text-fg-secondary hover:bg-surface-2 hover:text-fg tablet:h-8 tablet:w-8"
          >
            <BellIcon size={18} />
            <span className="absolute end-1.5 top-1.5 h-1.5 w-1.5 rounded-pill bg-danger" aria-hidden="true" />
          </button>
        )}

        <div className="flex shrink-0 items-center gap-0.5">
          <ThemeSwitch current={theme} compact />
          <LanguageSwitch />
        </div>
      </div>

      <div className={dividerClass} aria-hidden="true" />

      <div className="relative shrink-0">
        <button
          ref={accountButton}
          type="button"
          onClick={() => setAccountOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={accountOpen}
          // Same stable test contract as the canonical ProfileMenu.
          data-testid="profile-menu-trigger"
          className="flex items-center gap-1.5 rounded-sm py-1 pe-1 ps-1 hover:bg-surface-2"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-pill bg-accent-solid text-label font-semibold text-on-accent">
            {initial}
          </span>
          <span className="hidden min-w-0 max-w-32 flex-col items-start desktop:flex">
            <span className="w-full truncate text-label font-medium leading-tight text-fg">{resolvedName}</span>
            <span className="w-full truncate text-[11px] leading-tight text-fg-muted">
              {accountTypeLabel(t, "installer_technician", "person")}
            </span>
          </span>
          <ChevronDownIcon size={15} className="hidden shrink-0 text-fg-muted desktop:block" />
        </button>

        <FloatingMenu
          open={accountOpen}
          onClose={() => setAccountOpen(false)}
          anchorRef={accountButton}
          role="menu"
          aria-label={locale === "ar" ? "الحساب" : "Account"}
          placement="bottom-end"
          className="w-52 py-1"
        >
            {production ? (
              <>
                <MenuLink href="/home/profile" icon={UserIcon} label={locale === "ar" ? "ملفي الشخصي" : "My profile"} />
                <MenuLink href="/home/settings" icon={SettingsIcon} label={locale === "ar" ? "الإعدادات" : "Settings"} />
                <div className="my-1 border-t" />
                <form action={signOut}><MenuRow icon={LogOutIcon} label={locale === "ar" ? "تسجيل خروج" : "Sign out"} tone="danger" submit testId="profile-sign-out" /></form>
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
        </FloatingMenu>
      </div>
      {/* Phones: the service area is part of the shell, not hidden. */}
      <div className="order-last flex basis-full items-center gap-1.5 border-t pt-1.5 text-label font-medium text-fg-secondary tablet:hidden">
        <MapPinIcon size={15} className="shrink-0 text-fg-muted" />
        <span className="min-w-0 truncate">
          {production
            ? location || (locale === "ar" ? "منطقة الخدمة غير محددة" : "Service area not set")
            : locale === "ar" ? "الشيخ زايد، الجيزة" : "Sheikh Zayed, Giza"}
        </span>
      </div>
    </header>
  );
}

function MenuRow({
  icon: Icon,
  label,
  tone = "default",
  submit = false,
  testId,
}: {
  icon: typeof UserIcon;
  label: string;
  tone?: "default" | "danger";
  submit?: boolean;
  testId?: string;
}) {
  return (
    <button
      type={submit ? "submit" : "button"}
      role="menuitem"
      data-testid={testId}
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
