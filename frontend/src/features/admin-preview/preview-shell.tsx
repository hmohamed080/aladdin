"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";
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
 * so it already sits behind the same platform-role gate as every other admin
 * route — no second auth check is implemented here.
 */
export function PreviewShell({ children, paletteItems }: { children: ReactNode; paletteItems: PaletteItem[] }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/admin/preview" ? pathname === href : pathname.startsWith(href));

  return (
    <div className="flex flex-col gap-lg">
      <div
        role="note"
        className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/10 px-md py-3"
      >
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-warning">
          <AlertIcon size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-body-lg font-medium text-fg">{t("admin.preview.bannerTitle")}</p>
          <p className="mt-0.5 text-body text-fg-secondary">{t("admin.preview.bannerBody")}</p>
        </div>
      </div>

      <div className="flex justify-end">
        <CommandPalette items={paletteItems} />
      </div>

      <nav aria-label={t("admin.preview.navLabel")} className="-mx-1 overflow-x-auto overflow-y-hidden">
        <ul className="flex w-max min-w-full gap-1 border-b px-1">
          {items.map(({ href, key, Icon }) => {
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
