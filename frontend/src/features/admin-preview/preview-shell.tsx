"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";
import { canAccessAdminPath, type AdminAccess } from "@/lib/permissions/admin";
import { cn } from "@/lib/ui/cn";
import { CommandPalette } from "@/features/admin-preview/command-palette";
import type { PaletteItem } from "@/features/admin-preview/command-palette-search";
import {
  AlertIcon,
  GaugeIcon,
  UsersIcon,
  BuildingIcon,
  BadgeCheckIcon,
  MoneyIcon,
  ScrollIcon,
  UserIcon,
  BarChartIcon,
  SettingsIcon,
} from "@/components/ui/icons";

/** Preview routes already promoted to real, enforced Admin Core (Phase 1A: Staff · Roles · Permissions). */
const LIVE_PREVIEW_ROUTES = ["/admin/preview/staff"];

type Item = { href: string; key: string; Icon: ComponentType<{ size?: number }> };

const items: Item[] = [
  { href: "/admin/preview", key: "admin.preview.nav.dashboard", Icon: GaugeIcon },
  { href: "/admin/preview/users", key: "admin.preview.nav.users", Icon: UsersIcon },
  { href: "/admin/preview/organizations", key: "admin.preview.nav.organizations", Icon: BuildingIcon },
  { href: "/admin/preview/review", key: "admin.preview.nav.review", Icon: BadgeCheckIcon },
  { href: "/admin/preview/points", key: "admin.preview.nav.points", Icon: MoneyIcon },
  { href: "/admin/preview/staff", key: "admin.preview.nav.staff", Icon: UserIcon },
  { href: "/admin/preview/analytics", key: "admin.preview.nav.analytics", Icon: BarChartIcon },
  { href: "/admin/preview/audit", key: "admin.preview.nav.audit", Icon: ScrollIcon },
  { href: "/admin/preview/settings", key: "admin.preview.nav.settings", Icon: SettingsIcon },
];

/**
 * The Phase 0 Preview's own chrome: a permanent banner (so this can never be
 * mistaken for the live Admin console) and a secondary nav for the preview's
 * information architecture. Rendered inside the REAL `app/admin/layout.tsx`,
 * so it already sits behind the Admin Staff gate. Tabs show only areas the
 * caller's permissions open (same route table as the page guards); each page
 * still enforces its own permission.
 */
export function PreviewShell({
  children,
  paletteItems,
  access,
}: {
  children: ReactNode;
  paletteItems: PaletteItem[];
  access: AdminAccess;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/admin/preview" ? pathname === href : pathname.startsWith(href));

  // PD-016: Preview areas are promoted one at a time. A promoted (live) area must
  // never sit under the "nothing is saved" banner — that would be untrue.
  const live = LIVE_PREVIEW_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));

  return (
    <div className="flex flex-col gap-lg">
      <div
        role="note"
        className={cn(
          "flex items-start gap-3 rounded-md border px-md py-3",
          live ? "border-info/40 bg-info/10" : "border-warning/40 bg-warning/10",
        )}
      >
        <span aria-hidden="true" className={cn("mt-0.5 shrink-0", live ? "text-info" : "text-warning")}>
          <AlertIcon size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-body-lg font-medium text-fg">{t(live ? "admin.preview.liveBannerTitle" : "admin.preview.bannerTitle")}</p>
          <p className="mt-0.5 text-body text-fg-secondary">{t(live ? "admin.preview.liveBannerBody" : "admin.preview.bannerBody")}</p>
        </div>
      </div>

      {/* No trigger here: the header search is the single entry point (see palette-bridge). */}
      <CommandPalette items={paletteItems} />

      <nav aria-label={t("admin.preview.navLabel")} className="-mx-1 overflow-x-auto overflow-y-hidden">
        <ul className="flex w-max min-w-full gap-1 border-b px-1">
          {items.filter((i) => canAccessAdminPath(access, i.href)).map(({ href, key, Icon }) => {
            const active = isActive(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-label font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-canvas",
                    active
                      ? "border-accent-solid text-fg"
                      : "border-transparent text-fg-secondary hover:border-strong hover:text-fg",
                  )}
                >
                  <Icon size={16} />
                  {t(key)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {children}
    </div>
  );
}
