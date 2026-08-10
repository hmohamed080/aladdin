"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { GaugeIcon, UsersIcon, BuildingIcon, BadgeCheckIcon, ScrollIcon } from "@/components/ui/icons";

type Item = { href: string; key: string; exact: boolean; Icon: ComponentType<{ size?: number }> };

const items: Item[] = [
  { href: "/admin", key: "admin.nav.dashboard", exact: true, Icon: GaugeIcon },
  { href: "/admin/users", key: "admin.nav.users", exact: false, Icon: UsersIcon },
  { href: "/admin/organizations", key: "admin.nav.organizations", exact: false, Icon: BuildingIcon },
  { href: "/admin/verifications", key: "admin.nav.verifications", exact: false, Icon: BadgeCheckIcon },
  { href: "/admin/audit", key: "admin.nav.audit", exact: false, Icon: ScrollIcon },
];

function useActive() {
  const pathname = usePathname();
  return (href: string, exact: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}

/** Vertical rail for the admin console (desktop/tablet). */
export function AdminSidebar() {
  const { t } = useI18n();
  const isActive = useActive();
  return (
    <nav aria-label={t("admin.title")} className="flex flex-col gap-0.5">
      {items.map(({ href, key, exact, Icon }) => {
        const active = isActive(href, exact);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-sm px-3 py-2 text-label font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
              active ? "bg-surface-2 text-fg" : "text-fg-secondary hover:bg-surface-2/60 hover:text-fg",
            )}
          >
            <span className={cn(active ? "text-accent" : "text-fg-muted")}>
              <Icon size={18} />
            </span>
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}

/** Horizontal scroll nav for mobile. */
export function AdminTopNav() {
  const { t } = useI18n();
  const isActive = useActive();
  return (
    <nav
      aria-label={t("admin.title")}
      className="flex gap-1 overflow-x-auto border-b bg-surface px-md py-1.5 tablet:hidden"
    >
      {items.map(({ href, key, exact, Icon }) => {
        const active = isActive(href, exact);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-label font-medium",
              active ? "bg-surface-2 text-fg" : "text-fg-secondary",
            )}
          >
            <Icon size={16} />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
