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
  ClipboardIcon,
  LayersIcon,
  ShoppingBagIcon,
  InboxIcon,
  BookmarkIcon,
  TruckIcon,
  WrenchIcon,
  LandmarkIcon,
  BarChartIcon,
  SettingsIcon,
} from "@/components/ui/icons";
import type { NavKey, NavSection } from "@/lib/nav/modules";
import { allowedNavSections } from "@/lib/nav/modules";

/**
 * Primary workspace navigation — the implemented modules (no dead links). A
 * persistent grouped rail on desktop/tablet (`Sidebar`) and a fixed bottom bar on
 * mobile (`MobileNav`). Both derive the active item from the pathname and mirror
 * correctly in RTL (leading/trailing via logical properties). Access is still
 * enforced server-side on every page.
 *
 * Sections come from `lib/nav/modules`; this file only knows how to draw them.
 */
type Item = {
  href: string;
  /** Translation key for the label. */
  key: string;
  exact: boolean;
  Icon: ComponentType<{ size?: number }>;
};

const ITEMS: Record<NavKey, Item> = {
  home: { href: "/b2b", key: "nav.home", exact: true, Icon: HomeIcon },

  purchaseRequests: { href: "/b2b/rfqs", key: "nav.purchaseRequests", exact: false, Icon: ShoppingBagIcon },
  offers: { href: "/b2b/quotations", key: "nav.offers", exact: false, Icon: InboxIcon },
  orders: { href: "/b2b/orders", key: "nav.orders", exact: false, Icon: ClipboardIcon },
  catalog: { href: "/b2b/catalog", key: "nav.catalog", exact: false, Icon: SearchIcon },
  saved: { href: "/b2b/saved", key: "nav.saved", exact: false, Icon: BookmarkIcon },

  suppliers: { href: "/b2b/suppliers", key: "nav.suppliers", exact: false, Icon: TruckIcon },
  technicians: { href: "/b2b/technicians", key: "nav.technicians", exact: false, Icon: WrenchIcon },
  institutions: { href: "/b2b/institutions", key: "nav.institutions", exact: false, Icon: LandmarkIcon },

  customers: { href: "/b2b/customers", key: "nav.customers", exact: false, Icon: UsersIcon },
  leads: { href: "/b2b/leads", key: "nav.leads", exact: false, Icon: TargetIcon },
  followUps: { href: "/b2b/follow-ups", key: "nav.followUps", exact: false, Icon: CalendarCheckIcon },
  products: { href: "/b2b/products", key: "nav.products", exact: false, Icon: PackageIcon },

  projects: { href: "/b2b/projects", key: "nav.projects", exact: false, Icon: LayersIcon },
  team: { href: "/b2b/organization", key: "nav.team", exact: false, Icon: UsersIcon },
  reports: { href: "/b2b/reports", key: "nav.reports", exact: false, Icon: BarChartIcon },
  settings: { href: "/b2b/settings", key: "nav.settings", exact: false, Icon: SettingsIcon },
};

/**
 * Two modules answer to `/b2b/rfqs` and `/b2b/quotations` respectively but no
 * other item shares a prefix, so plain prefix matching is unambiguous.
 */
function useActive() {
  const pathname = usePathname();
  return (href: string, exact: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}

const sectionLabel: Record<NavSection, string | null> = {
  overview: null, // Home stands alone above the first heading.
  buying: "nav.section.buying",
  network: "nav.section.network",
  selling: "nav.section.selling",
  business: "nav.section.business",
};

function NavLink({ item, active }: { item: Item; active: boolean }) {
  const { t } = useI18n();
  const { href, key, Icon } = item;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-sm px-3 py-2 text-label font-medium transition-colors duration-fast",
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
      <span className={cn("shrink-0", active ? "text-accent" : "text-fg-muted group-hover:text-fg-secondary")}>
        <Icon size={19} />
      </span>
      <span className="truncate">{t(key)}</span>
    </Link>
  );
}

/** Desktop/tablet vertical rail (rendered inside the persistent sidebar). */
export function Sidebar({ allowed }: { allowed: readonly string[] }) {
  const { t } = useI18n();
  const isActive = useActive();
  const sections = allowedNavSections(allowed);

  return (
    <nav aria-label={t("nav.workspace")} className="flex flex-col gap-1">
      {sections.map(({ section, keys }) => {
        const labelKey = sectionLabel[section];
        return (
          <div key={section} className={cn(labelKey ? "mt-md first:mt-0" : undefined)}>
            {labelKey ? (
              <h2 className="px-3 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-muted">
                {t(labelKey)}
              </h2>
            ) : null}
            <div className="flex flex-col gap-0.5">
              {keys.map((k) => {
                const item = ITEMS[k];
                return <NavLink key={k} item={item} active={isActive(item.href, item.exact)} />;
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

/**
 * Mobile fixed bottom bar. At most five modules, taken in canonical order — which
 * is buyer-first by design, so a showroom gets Home · Purchase requests · Offers ·
 * Orders · Browse, and a sales-only rep falls through to their own first five.
 */
export function MobileNav({ allowed }: { allowed: readonly string[] }) {
  const { t } = useI18n();
  const isActive = useActive();
  const shown = allowedNavSections(allowed)
    .flatMap((s) => s.keys)
    .slice(0, 5);

  return (
    <nav
      aria-label={t("nav.workspace")}
      className="fixed inset-x-0 bottom-0 z-sticky border-t bg-surface/95 backdrop-blur tablet:hidden"
      style={{ zIndex: 100 }}
    >
      <ul
        className="mx-auto grid max-w-lg"
        style={{ gridTemplateColumns: `repeat(${Math.max(shown.length, 1)}, minmax(0, 1fr))` }}
      >
        {shown.map((k) => {
          const { href, key, exact, Icon } = ITEMS[k];
          const active = isActive(href, exact);
          return (
            <li key={k}>
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
