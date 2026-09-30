"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { canAccessAdminPath, type AdminAccess } from "@/lib/permissions/admin";
import { GaugeIcon, UsersIcon, BuildingIcon, BadgeCheckIcon, ScrollIcon, EyeIcon } from "@/components/ui/icons";

type Item = { href: string; key: string; exact: boolean; Icon: ComponentType<{ size?: number }>; badge?: string };

const items: Item[] = [
  { href: "/admin", key: "admin.nav.dashboard", exact: true, Icon: GaugeIcon },
  { href: "/admin/users", key: "admin.nav.users", exact: false, Icon: UsersIcon },
  { href: "/admin/organizations", key: "admin.nav.organizations", exact: false, Icon: BuildingIcon },
  { href: "/admin/verifications", key: "admin.nav.verifications", exact: false, Icon: BadgeCheckIcon },
  { href: "/admin/audit", key: "admin.nav.audit", exact: false, Icon: ScrollIcon },
  // Phase 0 — Admin Frontend Blueprint (PD-013). A discoverability link only:
  // this item changes nothing about the five routes above, and /admin/preview
  // inherits the SAME platform-role gate this layout already enforces.
  { href: "/admin/preview", key: "admin.preview.navLabel", exact: false, Icon: EyeIcon, badge: "preview" },
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
      {items.filter((i) => canAccessAdminPath(access, i.href)).map(({ href, key, exact, Icon, badge }) => {
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
            {badge ? (
              <span className="ms-auto rounded-pill bg-warning/15 px-1.5 py-0.5 text-[0.6875rem] font-medium text-warning">
                {t("admin.preview.previewOnlyBadge")}
              </span>
            ) : null}
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
