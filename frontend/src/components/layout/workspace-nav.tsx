"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import {
  HomeIcon,
  UsersIcon,
  TargetIcon,
  CalendarCheckIcon,
  SearchIcon,
  PackageIcon,
  FileTextIcon,
  ReceiptIcon,
} from "@/components/ui/icons";

/**
 * Primary workspace navigation — the implemented modules (no dead links). A
 * persistent icon+label rail on desktop/tablet (`Sidebar`) and a fixed bottom bar
 * on mobile (`MobileNav`). Both derive the active item from the pathname and
 * mirror correctly in RTL (leading/trailing via logical properties). Access is
 * still enforced server-side on every page.
 */
type Item = { href: string; key: string; exact: boolean; Icon: ComponentType<{ size?: number }> };

const items: Item[] = [
  { href: "/b2b", key: "nav.home", exact: true, Icon: HomeIcon },
  { href: "/b2b/customers", key: "nav.customers", exact: false, Icon: UsersIcon },
  { href: "/b2b/leads", key: "nav.leads", exact: false, Icon: TargetIcon },
  { href: "/b2b/follow-ups", key: "nav.followUps", exact: false, Icon: CalendarCheckIcon },
  { href: "/b2b/catalog", key: "nav.catalog", exact: false, Icon: SearchIcon },
  { href: "/b2b/products", key: "nav.products", exact: false, Icon: PackageIcon },
  { href: "/b2b/rfqs", key: "nav.rfqs", exact: false, Icon: FileTextIcon },
  { href: "/b2b/quotations", key: "nav.quotations", exact: false, Icon: ReceiptIcon },
];

function useActive() {
  const pathname = usePathname();
  return (href: string, exact: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}

/** Desktop/tablet vertical rail (rendered inside the persistent sidebar). */
export function Sidebar() {
  const { t } = useI18n();
  const isActive = useActive();
  return (
    <nav aria-label={t("nav.workspace")} className="flex flex-col gap-1">
      {items.map(({ href, key, exact, Icon }) => {
        const active = isActive(href, exact);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-sm px-3 py-2.5 text-label font-medium transition-colors duration-fast",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
              active ? "bg-surface-2 text-fg" : "text-fg-secondary hover:bg-surface-2/60 hover:text-fg",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-y-1.5 start-0 w-0.5 rounded-pill bg-accent-solid transition-opacity",
                active ? "opacity-100" : "opacity-0",
              )}
            />
            <span className={cn(active ? "text-accent" : "text-fg-muted group-hover:text-fg-secondary")}>
              <Icon size={20} />
            </span>
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}

/** Mobile fixed bottom bar. */
export function MobileNav() {
  const { t } = useI18n();
  const isActive = useActive();
  return (
    <nav
      aria-label={t("nav.workspace")}
      className="fixed inset-x-0 bottom-0 z-sticky border-t bg-surface/95 backdrop-blur tablet:hidden"
      style={{ zIndex: 100 }}
    >
      <ul className="mx-auto grid max-w-lg grid-cols-4">
        {items.map(({ href, key, exact, Icon }) => {
          const active = isActive(href, exact);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 py-1.5 text-[0.6875rem] font-medium transition-colors",
                  active ? "text-accent" : "text-fg-secondary",
                )}
              >
                <Icon size={22} />
                <span className="max-w-full truncate px-0.5">{t(key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
