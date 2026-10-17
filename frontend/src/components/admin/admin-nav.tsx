"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { canAccessAdminPath, type AdminAccess } from "@/lib/permissions/admin";
import {
  GaugeIcon,
  UsersIcon,
  BuildingIcon,
  BadgeCheckIcon,
  ShieldIcon,
  MoneyIcon,
  UserIcon,
  BarChartIcon,
  ScrollIcon,
  SettingsIcon,
} from "@/components/ui/icons";

type Item = { href: string; key: string; exact: boolean; Icon: ComponentType<{ size?: number }> };

const items: Item[] = [
  { href: "/admin", key: "admin.preview.nav.dashboard", exact: true, Icon: GaugeIcon },
  { href: "/admin/users", key: "admin.preview.nav.users", exact: false, Icon: UsersIcon },
  { href: "/admin/organizations", key: "admin.preview.nav.organizations", exact: false, Icon: BuildingIcon },
  { href: "/admin/review", key: "admin.preview.nav.review", exact: false, Icon: BadgeCheckIcon },
  // Verification, referral and organization decisions are still taken here; the
  // Review Center's Approve / Reject remain Preview until they are wired.
  { href: "/admin/verifications", key: "admin.nav.verifications", exact: false, Icon: ShieldIcon },
  // The Verified badge: its own queue, separate from approving an organization's application.
  { href: "/admin/business-verification", key: "businessVerification.admin.title", exact: false, Icon: BadgeCheckIcon },
  { href: "/admin/points", key: "admin.preview.nav.points", exact: false, Icon: MoneyIcon },
  { href: "/admin/staff", key: "admin.preview.nav.staff", exact: false, Icon: UserIcon },
  { href: "/admin/analytics", key: "admin.preview.nav.analytics", exact: false, Icon: BarChartIcon },
  { href: "/admin/audit", key: "admin.preview.nav.audit", exact: false, Icon: ScrollIcon },
  { href: "/admin/settings", key: "admin.preview.nav.settings", exact: false, Icon: SettingsIcon },
];

function useActive() {
  const pathname = usePathname();
  return (href: string, exact: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}

/**
 * Vertical rail for the admin console (desktop/tablet). Shows only destinations
 * the caller's server-loaded `access` opens, via the SAME route table the page
 * guards use (lib/permissions/admin.ts). Presentation only: a hidden link is
 * still guarded by its page, and the data behind it by RLS/RPCs.
 */
export function AdminSidebar({ access }: { access: AdminAccess }) {
  const { t } = useI18n();
  const isActive = useActive();
  return (
    <nav aria-label={t("admin.title")} className="flex flex-col gap-0.5">
      {items.filter((i) => canAccessAdminPath(access, i.href)).map(({ href, key, exact, Icon }) => {
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

/** Horizontal scroll nav for mobile (same permission filter). */
export function AdminTopNav({ access }: { access: AdminAccess }) {
  const { t } = useI18n();
  const isActive = useActive();
  return (
    <nav
      aria-label={t("admin.title")}
      className="flex gap-1 overflow-x-auto border-b bg-surface px-md py-1.5 tablet:hidden"
    >
      {items.filter((i) => canAccessAdminPath(access, i.href)).map(({ href, key, exact, Icon }) => {
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
