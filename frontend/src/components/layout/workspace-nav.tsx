"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ComponentType } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import {
  HomeIcon,
  UsersIcon,
  TargetIcon,
  CalendarCheckIcon,
  SearchIcon,
  PackageIcon,
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
  MenuIcon,
  XIcon,
  StorefrontIcon,
  DemandIcon,
  FileTextIcon,
} from "@/components/ui/icons";
import type { NavKey, NavSection } from "@/lib/nav/modules";
import { allowedNavSections, navLabelKey } from "@/lib/nav/modules";
import type { CommerceStance } from "@/lib/workspace/supply-side";

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
  buyers: { href: "/b2b/buyers", key: "nav.buyers", exact: false, Icon: StorefrontIcon },
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
 * Presentation overrides for the seller seat.
 *
 * The route and the gate are unchanged — see `lib/nav/modules` for why the same
 * three modules carry two names. Only the two glyphs whose METAPHOR reverses are
 * swapped: a shopping bag means "what I am going out to buy", which is exactly
 * backwards for a distributor reading requests that arrived; and an inbox means
 * "prices that came to me", which is backwards for prices it sent out. On a
 * collapsed rail the glyph IS the label, so a wrong metaphor is a wrong label.
 */
const SELLER_ICONS: Partial<Record<NavKey, ComponentType<{ size?: number }>>> = {
  purchaseRequests: DemandIcon,
  offers: FileTextIcon,
};

function itemFor(key: NavKey, stance: CommerceStance): Item {
  const base = ITEMS[key];
  if (stance !== "seller") return base;
  const Icon = SELLER_ICONS[key] ?? base.Icon;
  return { ...base, key: navLabelKey(key, stance, base.key), Icon };
}

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
  supply: "nav.section.supply",
  buying: "nav.section.buying",
  network: "nav.section.network",
  selling: "nav.section.selling",
  business: "nav.section.business",
};

/**
 * A seller's demoted Buying group is not the buyer's leading one, and calling
 * both "Buying" would put the word twice on one rail (once over the commerce
 * trio's supply counterpart, once over browse/shortlist). Under the seller
 * layout it is what it actually is: sourcing.
 */
function sectionLabelKey(section: NavSection, stance: CommerceStance): string | null {
  if (stance === "seller" && section === "buying") return "nav.section.sourcing";
  return sectionLabel[section];
}

/**
 * One navigation row.
 *
 * `narrow` is the icon-rail presentation, not a different link: the same href,
 * the same active rule, the same capability gate. Only the label is dropped, so
 * a collapsed rail can never expose a different set of modules than an expanded
 * one.
 *
 * WHY THERE IS NO VISIBLE TOOLTIP ANY MORE
 * The collapsed rail used to grow a floating label beside whichever icon the
 * pointer touched. Two problems, and neither was cosmetic: the label appeared
 * OUTSIDE the rail, over page content, so a glance down the icons flickered a
 * box in and out over the workspace; and in "expand on hover" mode the rail was
 * already opening to show that exact word, so the tooltip raced the reveal and
 * the same label rendered twice in two places. What a user needs from a hover on
 * an icon rail is to know WHICH target they are on — that is a surface cue, not
 * a caption. So the hover now lights the icon's own tile.
 *
 * Nothing is lost for assistive technology: the localized label is still the
 * link's `aria-label` in the narrow state, so a screen reader announces exactly
 * what the expanded rail shows. The change is purely to what is PAINTED.
 *
 * Keyboard parity is deliberate — `focus-visible` gets the same lit tile plus a
 * focus ring, because a keyboard user moving down a rail of unlabelled icons has
 * strictly more need of "you are here" than a mouse user does.
 */
function NavLink({ item, active, narrow }: { item: Item; active: boolean; narrow?: boolean }) {
  const { t } = useI18n();
  const { href, key, Icon } = item;
  const label = t(key);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      aria-label={narrow ? label : undefined}
      className={cn(
        "group relative flex items-center rounded-sm text-label font-medium",
        "transition-[background-color,color,box-shadow] duration-fast ease-standard motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
        narrow ? "justify-center px-0 py-0.5" : "gap-3 px-3 py-2",
        !narrow && (active ? "bg-surface-2 text-fg" : "text-fg-secondary hover:bg-surface-2/60 hover:text-fg"),
      )}
    >
      {/* The active marker is the ONLY cue left once labels are gone, so it stays
          in both states rather than being an expanded-only flourish. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-1.5 start-0 w-0.5 rounded-pill bg-accent-solid transition-opacity",
          active ? "opacity-100" : "opacity-0",
        )}
      />
      <span
        className={cn(
          "shrink-0",
          // The hover/focus target on a collapsed rail. A tile rather than a
          // colour change: at 3.5rem the glyph is small and a hue shift alone is
          // easy to miss, whereas a raised square under the pointer is
          // unambiguous about which of nine icons is armed. Sized so the lit
          // tiles form an even column instead of touching each other.
          narrow &&
            "grid h-9 w-9 place-items-center rounded-sm transition-[background-color,box-shadow] duration-fast ease-standard motion-reduce:transition-none",
          narrow && !active && "group-hover:bg-surface-2 group-hover:shadow-sm group-focus-visible:bg-surface-2",
          // An active item already owns a tile; hovering it deepens rather than
          // re-announces, so the active/hover distinction survives the collapse.
          narrow && active && "bg-accent-solid/15 group-hover:bg-accent-solid/25",
          active ? "text-accent" : "text-fg-muted group-hover:text-fg",
        )}
      >
        <Icon size={19} />
      </span>
      {narrow ? null : <span className="truncate">{label}</span>}
    </Link>
  );
}

/**
 * Desktop/tablet vertical rail (rendered inside the persistent sidebar).
 *
 * `narrow` swaps the presentation only. The section list still comes from
 * `allowedNavSections(allowed)`, so every capability-derived module survives the
 * collapse — a narrow rail shows the same items, drawn smaller. Section headings
 * have no room at 3.5rem, so the grouping is carried by a rule instead of a
 * word; the groups themselves are unchanged and in the same order.
 */
export function Sidebar({
  allowed,
  narrow = false,
  stance = "buyer",
}: {
  allowed: readonly string[];
  narrow?: boolean;
  stance?: CommerceStance;
}) {
  const { t } = useI18n();
  const isActive = useActive();
  const sections = allowedNavSections(allowed, stance);

  return (
    <nav aria-label={t("nav.workspace")} className="flex flex-col gap-1">
      {sections.map(({ section, keys }, i) => {
        const labelKey = sectionLabelKey(section, stance);
        return (
          <div
            key={section}
            className={cn(
              // Expanded groups are separated by their heading; narrow ones by a
              // rule, which needs far less room around it than a word does.
              labelKey && !narrow ? "mt-md first:mt-0" : undefined,
              narrow && i > 0 && "mt-sm border-t pt-sm",
            )}
          >
            {labelKey && !narrow ? (
              <h2 className="px-3 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-muted">
                {t(labelKey)}
              </h2>
            ) : null}
            <div className="flex flex-col gap-0.5">
              {keys.map((k) => {
                const item = itemFor(k, stance);
                return (
                  <NavLink key={k} item={item} active={isActive(item.href, item.exact)} narrow={narrow} />
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

/**
 * Mobile chrome: a fixed bottom bar of the four highest-priority modules plus a
 * "More" sheet holding everything else.
 *
 * The sheet is not decoration — it is what makes the grouped IA safe on a phone.
 * A bottom bar fits five targets, but the workspace now has up to seventeen
 * modules across five sections, so truncating to the first five would leave a
 * manager unable to reach Projects, Team, Reports or Settings on mobile at all.
 * The sheet renders the SAME sections as the desktop rail, so both surfaces
 * expose exactly the same set of modules.
 */
export function MobileNav({
  allowed,
  stance = "buyer",
}: {
  allowed: readonly string[];
  stance?: CommerceStance;
}) {
  const { t } = useI18n();
  const isActive = useActive();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // The stance reorders the sections, so the four modules that earn a bottom-bar
  // slot follow the stance too: a distributor's phone opens on incoming demand,
  // not on purchase requests. The PATTERN — four plus a "More" sheet holding the
  // same sections as the desktop rail — is unchanged.
  const sections = allowedNavSections(allowed, stance);
  const flat = sections.flatMap((s) => s.keys);
  const primary = flat.slice(0, 4);
  const overflow = flat.slice(4);

  // Any navigation closes the sheet — otherwise it would cover the page it just
  // navigated to.
  useEffect(() => setOpen(false), [pathname]);

  // Escape closes it, matching the confirm dialog's behaviour.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const columns = overflow.length > 0 ? primary.length + 1 : primary.length;

  return (
    <>
      {open && overflow.length > 0 ? (
        <div className="fixed inset-0 tablet:hidden" style={{ zIndex: 99 }}>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-brand-basalt/60"
          />
          <div className="absolute inset-x-0 bottom-14 max-h-[65dvh] overflow-y-auto rounded-t-lg border-t bg-surface px-3 pb-3 pt-2 shadow-card">
            <nav aria-label={t("nav.more")} className="flex flex-col gap-1">
              {sections.map(({ section, keys }) => {
                const shown = keys.filter((k) => overflow.includes(k));
                if (shown.length === 0) return null;
                const labelKey = sectionLabelKey(section, stance);
                return (
                  <div key={section} className="mt-md first:mt-0">
                    {labelKey ? (
                      <h2 className="px-3 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-muted">
                        {t(labelKey)}
                      </h2>
                    ) : null}
                    <div className="flex flex-col gap-0.5">
                      {shown.map((k) => {
                        const item = itemFor(k, stance);
                        return <NavLink key={k} item={item} active={isActive(item.href, item.exact)} />;
                      })}
                    </div>
                  </div>
                );
              })}
            </nav>
          </div>
        </div>
      ) : null}

      <nav
        aria-label={t("nav.workspace")}
        className="fixed inset-x-0 bottom-0 z-sticky border-t bg-surface/95 backdrop-blur tablet:hidden"
        style={{ zIndex: 100 }}
      >
        <ul
          className="mx-auto grid max-w-lg"
          style={{ gridTemplateColumns: `repeat(${Math.max(columns, 1)}, minmax(0, 1fr))` }}
        >
          {primary.map((k) => {
            const { href, key, exact, Icon } = itemFor(k, stance);
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

          {overflow.length > 0 ? (
            <li>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className={cn(
                  "flex min-h-14 w-full flex-col items-center justify-center gap-1 py-1.5 text-[0.6875rem] font-medium transition-colors",
                  // The sheet holds the active module when it is not one of the four.
                  open || overflow.some((k) => isActive(ITEMS[k].href, ITEMS[k].exact))
                    ? "text-accent"
                    : "text-fg-secondary",
                )}
              >
                {open ? <XIcon size={22} /> : <MenuIcon size={22} />}
                <span className="max-w-full truncate px-0.5">{t("nav.more")}</span>
              </button>
            </li>
          ) : null}
        </ul>
      </nav>
    </>
  );
}
