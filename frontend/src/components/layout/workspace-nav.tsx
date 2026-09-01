"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ComponentType } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { navColumnClass, NAV_GROUP_SEPARATOR_CLASS } from "@/lib/ui/nav-geometry";
import { useSidebarDisplay } from "@/components/layout/sidebar-shell";
import { ActiveCarve } from "@/components/layout/nav-carve";
import { NavLink, type NavItem } from "@/components/layout/nav-item";
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
  GaugeIcon,
  SettingsIcon,
  MenuIcon,
  XIcon,
  StorefrontIcon,
  DemandIcon,
  FileTextIcon,
  ChevronDownIcon,
  GlobeIcon,
  BuildingIcon,
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
/** Re-exported so module tables keep reading as `Item` locally. */
type Item = NavItem;

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

  points: { href: "/b2b/points", key: "nav.points", exact: false, Icon: GaugeIcon },
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
 * DESIGN-LAB ONLY: the collapsed rail's one icon per hidden group.
 *
 * Each group's OWN glyph, chosen for what the group is about rather than
 * reused from `MenuIcon` — a single "more items" glyph repeated four times
 * told the reader nothing about which group was which without opening one.
 * `supply`/`overview` are absent on purpose: both are quick access on this
 * rail (see `quickAccess` below) and never reach this map.
 */
const GROUP_ICON: Partial<Record<NavSection, ComponentType<{ size?: number }>>> = {
  network: GlobeIcon,
  selling: TargetIcon,
  buying: SearchIcon,
  business: BuildingIcon,
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
  carved = false,
}: {
  allowed: readonly string[];
  narrow?: boolean;
  stance?: CommerceStance;
  /**
   * Whether the active module gets the carved surface.
   *
   * True for every DESKTOP display mode, which reverses the previous rule and is
   * the point of this pass. It used to be docked-and-expanded only: the rail was
   * excluded for having no room, and the hover reveal for floating above a page
   * it could not plausibly merge into. Both exclusions produced a different
   * active mechanic in each mode, so the sidebar stopped being one object the
   * moment it changed width.
   *
   * The carve handles both cases itself now — it shrinks to the icon's own tile
   * at rail width and drops its fillets, and in the hover reveal it ends flush
   * with the shell's edge over a body that is directly beneath it and the same
   * light. What stays excluded is the mobile "More" sheet, which has no shell,
   * no trailing edge and nothing to be carved out of.
   */
  carved?: boolean;
}) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const isActive = useActive();
  /* SETTINGS IS NEVER IN THIS LIST. It would otherwise appear twice — once
     here, grouped under Business, and again as the fixed bottom action
     `SidebarShell` always renders. One Settings entry, and the fixed one wins:
     it is in the same place on every screen regardless of which groups are
     open. */
  const sections = allowedNavSections(allowed, stance)
    .map(({ section, keys }) => ({
      section,
      keys: keys.filter((k) => k !== "settings"),
    }))
    .filter((s) => s.keys.length > 0);
  /* State, not a ref: the carve measures against this node from a LAYOUT effect,
     and a child's layout effect runs before its parent's ref is attached. A
     callback ref that stores the node re-renders once with it in hand, which is
     what makes the first measurement possible at all. See ActiveCarve. */
  const [list, setList] = useState<HTMLDivElement | null>(null);
  /* Which sections the reader has manually CLOSED.
     For the shared (non-design-lab) rail every section renders `!collapsible`,
     so this set is never consulted and its initial content is moot.
     For the design-lab rail, sections start CLOSED except the first two —
     Home and the commerce trio are the quick-access list, never grouped (see
     `quickAccess` below) — and except whichever group holds the current route,
     which `open` below reopens regardless of this set. A rail that greeted the
     reader with every group already open buried the five items that matter
     under four more that don't. */
  const [closed, setClosed] = useState<ReadonlySet<NavSection>>(
    () => new Set(sections.slice(2).map((s) => s.section)),
  );
  /**
   * DESIGN-LAB ONLY: which secondary group, if any, is revealed on the
   * COLLAPSED rail — a single value rather than a set, because at most one
   * may be open there at a time (the brief is explicit: opening a second
   * group must close whatever the first one was, or the rail grows without
   * bound). Independent of `closed` above, which governs the EXPANDED rail's
   * groups and allows any number open at once — the two views are allowed to
   * disagree about how MUCH is open, just not about WHAT is in each group.
   * Seeded once, to whichever group holds the route the reader loaded on, so
   * a fresh collapsed load doesn't hide the page they're already looking at;
   * purely manual from then on; a click always wins outright, per the brief,
   * even over the active route.
   */
  const [narrowOpenSection, setNarrowOpenSection] = useState<NavSection | null>(() => {
    const active = sections.slice(2).find(({ keys }) =>
      keys.some((k) => {
        const item = itemFor(k, stance);
        return isActive(item.href, item.exact);
      }),
    );
    return active ? active.section : null;
  });

  return (
    <div ref={setList} className="relative">
      {carved ? (
        <ActiveCarve container={list} narrow={narrow} roundedBand />
      ) : null}
      <nav
        aria-label={t("nav.workspace")}
        /* The column inset lives HERE rather than on the scrolling panel that
           holds it, so that the carve — a sibling of this nav, not a child —
           can reach the panel's trailing edge. Rows land in exactly the same
           place either way: the padding simply moved one level in.

           The WIDTH is here for the same reason and is the other half of it. The
           scroller above spans the panel INCLUDING its gutter (it has to; a
           scroll container clips both axes and would otherwise sever the carve),
           so without this the rows would inherit that full width and every hover
           surface would run out past the navy and onto the frame. Holding the
           nav to `--shell-nav-w` keeps the rows on the material and leaves the
           gutter to the one element entitled to cross it. */
        className={cn("relative z-10 flex flex-col gap-1", navColumnClass(narrow))}
        style={{ width: "var(--shell-nav-w, 100%)" }}
      >
      {sections.map(({ section, keys }, i) => {
        const labelKey = sectionLabelKey(section, stance);
        // A manually-closed section still OPENS for the page the reader is
        // actually on — collapsing the group under your own feet and losing
        // the carve inside it would be a worse defect than the feature is
        // worth.
        const containsActive = keys.some((k) => {
          const item = itemFor(k, stance);
          return isActive(item.href, item.exact);
        });
        /* THE FIRST TWO SECTIONS ARE QUICK ACCESS, NEVER A GROUP.
           `overview` (Home) and the section right after it — Supply for a
           seller, Buying for a buyer — are the handful of modules a caller
           opens every day. Burying them one hover-delay behind a heading
           just to keep the rail visually tidy would be optimizing the wrong
           thing; Bitrix24 doesn't group its own daily-use row either. Every
           later section (Network, Selling, Sourcing, Business) still gets
           the heading + collapse treatment below. */
        const quickAccess = i < 2;
        /** Whether this section is one of the collapsible groups (Network,
         *  Selling, Sourcing, Business) as opposed to quick access — true
         *  regardless of `narrow`, unlike `collapsible` below, because the
         *  RAIL needs to know "this is a group" even where it draws no
         *  collapse control for one. */
        const isSecondaryGroup = Boolean(labelKey) && !quickAccess;
        const collapsible = isSecondaryGroup && !narrow;
        const open = !collapsible || containsActive || !closed.has(section);
        const heading = labelKey && !narrow && !quickAccess ? labelKey : null;
        /** Whether THIS group's children are the ones currently showing on the
         *  collapsed rail — see `narrowOpenSection`'s own note. */
        const revealed = narrowOpenSection === section;
        return (
          <div
            key={section}
            className={cn(
              // Expanded groups are separated by their heading; narrow ones by a
              // rule, which needs far less room around it than a word does.
              // Quick access has neither — Home and the commerce trio read as
              // one continuous list, exactly as the reference shows them.
              heading ? "mt-3 first:mt-0" : undefined,
              narrow && i > 0 && NAV_GROUP_SEPARATOR_CLASS,
            )}
          >
            {heading ? (
              collapsible ? (
                <button
                  type="button"
                  onClick={() =>
                    setClosed((prev) => {
                      const next = new Set(prev);
                      if (next.has(section)) next.delete(section);
                      else next.add(section);
                      return next;
                    })
                  }
                  aria-expanded={open}
                  /* A proper row, not a caption with a click handler bolted
                     on — `py-1.5` gives it a real height to hover, and the
                     hover/active-adjacent surface is the same `shell-2` tile
                     paint every other control on this rail uses, so it reads
                     as "one more interactive row" rather than a bespoke
                     control. Still compact: no border, no card, same 12px
                     inset as the rows it groups. `open` gets the same wash
                     at rest, not just on hover — an expanded group should
                     read as "currently open", not only "currently pointed
                     at". */
                  className={cn(
                    "group flex w-full items-center justify-between rounded-sm px-3 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-shell-fg-muted transition-colors hover:bg-shell-2 hover:text-shell-fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-shell",
                    open && "bg-shell-2",
                  )}
                >
                  <span>{t(heading)}</span>
                  <ChevronDownIcon
                    size={13}
                    className={cn(
                      "shrink-0 text-shell-fg-muted transition-transform duration-base ease-standard group-hover:text-shell-fg-secondary",
                      !open && "-rotate-90 rtl:rotate-90",
                    )}
                  />
                </button>
              ) : (
                <h2 className="px-3 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-shell-fg-muted">
                  {t(heading)}
                </h2>
              )
            ) : null}
            {/* THE COLLAPSE, WITHOUT MEASURING HEIGHT. `grid-template-rows`
                between `0fr` and `1fr` on a single-row grid animates a track
                from nothing to its content's intrinsic height with no JS
                measurement and no `height: auto` jump-cut — the inner
                `overflow-hidden` is what makes the fractional row clip
                rather than show its content bleeding past a 0fr track. */}
            <div
              style={
                collapsible
                  ? {
                      display: "grid",
                      gridTemplateRows: open ? "1fr" : "0fr",
                      transition: "grid-template-rows 220ms cubic-bezier(0.4, 0, 0.2, 1)",
                    }
                  : undefined
              }
            >
              {collapsible ? (
                /* The height reveal is CSS (above); the fade + settle is
                   Motion, layered on top rather than replacing it — a grid
                   track alone is a wipe, and the reference's groups arrive
                   with a little more give than that. Both run on the same
                   `open`, so they land together. The plain `<div>` below is
                   what quick-access sections and the narrow rail render
                   instead — neither has a collapse control to animate. */
                <motion.div
                  className="flex flex-col gap-0.5 overflow-hidden"
                  /* `inert` WHILE CLOSED, AND IT IS NOT DECORATION.
                     A `0fr` grid track plus `overflow: hidden` hides these rows
                     VISUALLY and does nothing else: the links stay in the
                     accessibility tree and in the tab order, so a keyboard user
                     tabbing down a rail with four closed groups walks through
                     ~12 links they cannot see, and a screen reader reads out a
                     navigation the sighted user has deliberately collapsed.
                     `inert` removes the whole subtree from both at once, which
                     `hidden`/`display:none` could also do but only by killing
                     the height transition this collapse is built on. */
                  inert={!open}
                  initial={false}
                  animate={{ opacity: open ? 1 : 0, y: open ? 0 : -4 }}
                  transition={{ duration: reduced ? 0 : 0.18, ease: "easeOut" }}
                >
                  {keys.map((k) => {
                    const item = itemFor(k, stance);
                    return (
                      // A SMALL, DELIBERATE INDENT FOR GROUPED CHILDREN ONLY.
                      // Quick access and the narrow rail keep every icon on
                      // the same column the carve assumes (see
                      // NAV_COLUMN_START) — this wrapper only appears where
                      // the carve is a full-width band anyway, so the extra
                      // inline-start space reads as the row sitting a touch
                      // further inside its own highlight, never as a
                      // misaligned icon.
                      <div key={k} className="ps-2">
                        <NavLink
                          item={item}
                          active={isActive(item.href, item.exact)}
                          narrow={narrow}
                          carved={carved}
                        />
                      </div>
                    );
                  })}
                </motion.div>
              ) : narrow && isSecondaryGroup ? (
                /* ONE ICON PER HIDDEN GROUP ON THE RAIL, NOT ITS FLATTENED
                   CHILDREN. This used to fall through to the plain branch
                   below, which draws every key in `keys` as its own icon —
                   correct for quick access, wrong here: a "Network" group
                   the reader left CLOSED in expanded mode would still print
                   four separate icons the moment the sidebar collapsed,
                   exposing state the expanded rail had just hidden. Collapsed
                   and expanded now agree: a closed group is one thing in
                   both, drawn smaller in one of them.
                   The icon's own click TOGGLES its children open beneath it
                   rather than navigating — `href` still names the group's
                   first module (so the accessible name and keyboard Enter
                   both point somewhere real), but the pointer's click is
                   intercepted. It still carries the carve whenever the
                   reader is anywhere INSIDE the group, not only on the item
                   it links to, via `containsActive` rather than a route
                   match of its own — but ONLY WHILE CLOSED (`!revealed`).
                   Once the group is open, its real child is on screen and
                   carrying its OWN `active`, and the single shared carve can
                   only ever be on one element at a time — leaving the group
                   icon ALSO claiming `active` here would race it for the
                   carve (`querySelector` finds whichever is first in the DOM,
                   which is this icon, not the child underneath it) and the
                   highlight would sit on the wrong glyph. Closed, this is the
                   only cue there is; open, it steps back to the separate,
                   static `bg-shell-2` wash (`openIndicator`), which marks the
                   REVEAL state rather than the route — a group can be open
                   with no active route inside it, or active without being
                   open. */
                <div className="flex flex-col items-center gap-0.5">
                  <NavLink
                    item={{
                      href: itemFor(keys[0]!, stance).href,
                      key: labelKey!,
                      exact: false,
                      Icon: GROUP_ICON[section] ?? MenuIcon,
                    }}
                    active={containsActive && !revealed}
                    narrow
                    carved={carved}
                    openIndicator={revealed}
                    onClick={(e) => {
                      e.preventDefault();
                      setNarrowOpenSection((prev) => (prev === section ? null : section));
                    }}
                  />
                  {/* THE CHILD ICONS, REVEALED UNDERNEATH — same grid-rows +
                      Motion fade the expanded groups use (see above), just
                      centred rather than indented: there is no label here to
                      indent FROM, and every rail icon already shares one
                      centre line. Each child keeps its OWN route icon
                      (`itemFor`, not the group's glyph), so a revealed
                      Network prints Customers/Distributors/Technicians/
                      Institutions as themselves, not four copies of a globe. */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateRows: revealed ? "1fr" : "0fr",
                      transition: "grid-template-rows 220ms cubic-bezier(0.4, 0, 0.2, 1)",
                      width: "100%",
                    }}
                  >
                    <motion.div
                      className="flex flex-col items-center gap-0.5 overflow-hidden"
                      /* Same reasoning as the expanded groups above: clipped is
                         not hidden. On the RAIL this matters more, not less —
                         only one group may be revealed at a time, so everything
                         in the other three is off-screen by design. */
                      inert={!revealed}
                      initial={false}
                      animate={{
                        opacity: revealed ? 1 : 0,
                        y: revealed ? 0 : -4,
                      }}
                      transition={{ duration: reduced ? 0 : 0.18, ease: "easeOut" }}
                    >
                      {keys.map((k) => {
                        const item = itemFor(k, stance);
                        return (
                          <NavLink
                            key={k}
                            item={item}
                            active={isActive(item.href, item.exact)}
                            narrow
                            carved={carved}
                          />
                        );
                      })}
                    </motion.div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {keys.map((k) => {
                    const item = itemFor(k, stance);
                    return (
                      <NavLink
                        key={k}
                        item={item}
                        active={isActive(item.href, item.exact)}
                        narrow={narrow}
                        carved={carved}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
      </nav>
    </div>
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
                        return (
                          <NavLink
                            key={k}
                            item={item}
                            active={isActive(item.href, item.exact)}
                            /* The sheet is `bg-surface`, not the navy rail. */
                            ground="surface"
                          />
                        );
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

/**
 * The workspace rail as the shell mounts it.
 *
 * A thin client wrapper whose only job is reading the shell's display state from
 * context, so the SERVER layout can pass a plain element across the RSC boundary
 * instead of a function it is not allowed to serialize.
 */
export function WorkspaceNavPanel({
  allowed,
  stance = "buyer",
}: {
  allowed: readonly string[];
  stance?: CommerceStance;
}) {
  const { narrow, carved } = useSidebarDisplay();
  return <Sidebar allowed={allowed} narrow={narrow} stance={stance} carved={carved} />;
}
