"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ComponentType } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { navColumnClass, NAV_GROUP_SEPARATOR_CLASS } from "@/lib/ui/nav-geometry";
import { ActiveCarve } from "@/components/layout/nav-carve";
import { NavLink, type NavItem } from "@/components/layout/nav-item";
import { useSidebarDisplay } from "@/components/layout/sidebar-shell";
import {
  personalNavItem,
  personalNavSections,
  activePersonalNavKey,
  type PersonalNavKey,
  type PersonalNavInput,
} from "@/lib/nav/personal-modules";
import {
  HomeIcon,
  UserIcon,
  GaugeIcon,
  BriefcaseIcon,
  ClipboardIcon,
  StorefrontIcon,
  BuildingIcon,
  StarIcon,
  UsersIcon,
} from "@/components/ui/icons";

/**
 * PERSONAL navigation — the same navigation FAMILY as the workspace rail, a
 * different information architecture.
 *
 * WHAT THIS REPLACES, AND WHY IT HAD TO
 * The personal surface shipped a bespoke HORIZONTAL rail: a row of tabs under
 * the header, with its own hover, its own active underline and its own icon
 * geometry. The reasoning at the time was that four destinations do not earn a
 * 280px column. That reasoning is about INFORMATION ARCHITECTURE and it was
 * sound; the mistake was answering it with a different visual language rather
 * than a different list length. Route count does not authorize a new shell, and
 * an installer whose account looked like a different product from the showroom
 * they work with was the visible result.
 *
 * So the destinations are unchanged and the derivation is unchanged — only the
 * organ is. `personalNavKeys` still decides what exists; this draws it with
 * `NavLink`, the same row the workspace draws, inside `SidebarShell`, the same
 * panel the workspace stands in.
 *
 * NO DEAD LINKS. The list is exactly what `personalNavSections` derives from the
 * account, and nothing more. Jobs arrived in Increment 8, when `/home/jobs`
 * became a real route; My Work, Reviews and Network are still future Installer
 * destinations and slot into this same model when their routes exist — a nav
 * that advertises a route that 404s is worse than a short nav.
 *
 * SHORT LISTS DO NOT GET SECTION HEADINGS HERE. `personalNavSections` groups into
 * `account`, `work` and `business`, which the workspace would render as labelled
 * bands.
 * At three-to-five rows a heading costs more vertical space than the group it
 * introduces, so the grouping is carried by a rule between the bands — the same
 * device the collapsed workspace rail uses when its headings have no room.
 */

const ICONS: Record<PersonalNavKey, ComponentType<{ size?: number }>> = {
  home: HomeIcon,
  profile: UserIcon,
  // The same glyph the workspace Points module uses — one feature, one mark.
  points: GaugeIcon,
  jobs: BriefcaseIcon,
  // Distinct from the Jobs briefcase on purpose: they sit adjacent in the same
  // group, and two identical glyphs would make the two destinations read as one.
  myWork: ClipboardIcon,
  // The mark the whole domain uses — a rating is a star everywhere it appears.
  reviews: StarIcon,
  network: UsersIcon,
  connectShowroom: StorefrontIcon,
  addBusiness: BuildingIcon,
};

/** Resolve one personal key into the shape the shared row expects. */
function itemFor(key: PersonalNavKey): NavItem {
  const item = personalNavItem(key);
  return { href: item.href, key: item.labelKey, exact: item.href === "/home", Icon: ICONS[key] };
}

/**
 * The vertical personal rail, mounted inside `SidebarShell`.
 *
 * `narrow` and `carved` come from the shell, exactly as they do for the
 * workspace `Sidebar`, so the collapsed rail, the hover reveal and the carve all
 * behave identically on both surfaces without this component knowing they exist.
 */
export function PersonalSidebar({
  keys,
  narrow = false,
  carved = false,
}: {
  keys: readonly PersonalNavKey[];
  narrow?: boolean;
  carved?: boolean;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const active = activePersonalNavKey(pathname ?? "");
  const sections = groupsFor(keys);

  /* State, not a ref: the carve measures against this node from a LAYOUT effect,
     and a child's layout effect runs before its parent's ref is attached. A
     callback ref that stores the node re-renders once with it in hand, which is
     what makes the first measurement possible at all. See `ActiveCarve`. */
  const [list, setList] = useState<HTMLDivElement | null>(null);

  return (
    /* THE CARVE IS A SIBLING OF THE NAV, NOT A CHILD, and the column inset lives
       on the <nav> rather than on this wrapper — both exactly as the workspace
       rail arranges them, because the carve has to reach past the column's
       padding to the panel's trailing edge.

       This was missing in the first cut of this component and the browser found
       it: `carved` is true from the shell, which tells `NavLink` to suppress its
       own 2px active marker BECAUSE a carve is drawing the active surface — and
       nothing was drawing one. The result was an active row with no background,
       no shadow and no marker, distinguishable only by a slightly brighter
       glyph. The tests could not see it (they assert the rows, and the rows were
       right) and the build could not see it. */
    <div ref={setList} className="relative">
      {carved ? <ActiveCarve container={list} narrow={narrow} roundedBand /> : null}
      <nav
        aria-label={t("personalNav.label")}
        /* THE SAME THREE THINGS THE WORKSPACE <nav> DECLARES, AND THE WIDTH IS
           THE ONE THAT MATTERS. The scrolling panel this sits in spans the whole
           sidebar INCLUDING the 14px gutter — deliberately, because a scroll
           container clips both axes and a scroller sized to the navy alone would
           cut the carve off at exactly the edge it exists to cross. So every nav
           inside it has to hold ITSELF to `--shell-nav-w`; the workspace rail
           does, and this one did not.

           Fourteen pixels of consequence, all of it visible at rail width: the
           row became 70px instead of 56, `navRowClass`'s `justify-center` centred
           the 36px tile in a 54px track instead of a 40px one, and the glyph
           landed 17px from the leading edge instead of 10. The carve is pinned at
           `NAV_COLUMN_START` — a DERIVED number, correct for a 56px rail — so it
           drew a 36px tile seven pixels behind the icon it was meant to be
           under: the offset blob. The rows also carried their hover surface and
           their focus ring out past the navy and onto the frame.

           None of that is a carve bug and none of it wanted a carve fix. One
           declaration, and every route on both surfaces gets the same row height,
           the same hit area and the same icon centre line by construction. */
        className={cn("relative z-10 flex flex-col gap-1", navColumnClass(narrow))}
        style={{ width: "var(--shell-nav-w, 100%)" }}
      >
        {sections.map((group, i) => (
          <div
            key={group.section}
            /* A rule between bands rather than a heading — see the note above —
               and it is the RAIL's rule, not one of this list's own. It used to
               be a bare `<div className="mx-3 my-1.5 border-t">`: a different
               inset, a different rhythm, and a line that stopped short of the
               column at both ends, for the same structural statement the
               collapsed workspace rail was already making. */
            className={cn("flex flex-col gap-0.5", i > 0 && NAV_GROUP_SEPARATOR_CLASS)}
          >
            {group.keys.map((key) => (
              <NavLink
                key={key}
                item={itemFor(key)}
                active={key === active}
                narrow={narrow}
                carved={carved}
              />
            ))}
          </div>
        ))}
      </nav>
    </div>
  );
}

/**
 * The personal bottom bar below `tablet`.
 *
 * The workspace's `MobileNav` shows four modules plus a "More" sheet because it
 * has twenty. A personal account has at most five destinations, so they all fit
 * and there is no sheet — the same PATTERN (a fixed bottom bar of icon+label
 * targets, the current one lit) with the overflow branch simply not reached.
 * Squeezing the desktop panel into 390 points was never an option; this is what
 * the shell's `mobileNav` slot is for.
 */
export function PersonalMobileNav({ keys }: { keys: readonly PersonalNavKey[] }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const active = activePersonalNavKey(pathname ?? "");

  if (keys.length < 2) return null;

  return (
    /* Geometry, z-index, target height, glyph size, type size and active ink are
       all the workspace bar's, verbatim. The ONLY difference is the item source
       and the absence of a "More" branch — five destinations always fit. */
    <nav
      aria-label={t("personalNav.label")}
      data-testid="personal-mobile-nav"
      className="fixed inset-x-0 bottom-0 border-t bg-surface/95 backdrop-blur tablet:hidden"
      style={{ zIndex: 100 }}
    >
      <ul
        className="mx-auto grid max-w-lg"
        style={{ gridTemplateColumns: `repeat(${keys.length}, minmax(0, 1fr))` }}
      >
        {keys.map((key) => {
          const item = itemFor(key);
          const Icon = item.Icon;
          const current = key === active;
          return (
            <li key={key}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 py-1.5 text-[0.6875rem] font-medium transition-colors",
                  current ? "text-accent" : "text-fg-secondary",
                )}
              >
                <Icon size={22} />
                <span className="max-w-full truncate px-0.5">{t(item.key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The derived sections, filtered to the keys this account actually has. */
function groupsFor(keys: readonly PersonalNavKey[]) {
  const set = new Set(keys);
  // `personalNavSections` needs the derivation input; the caller has already run
  // it, so re-group the resolved keys instead of re-deriving and risking a
  // different answer from the one the page was built with.
  const shape: PersonalNavInput = { variant: "professional", isSalesPersona: true };
  return personalNavSections(shape)
    .map((g) => ({ section: g.section, keys: g.keys.filter((k) => set.has(k)) }))
    .filter((g) => g.keys.length > 0);
}

/**
 * The personal rail as the shell mounts it — the sibling of `WorkspaceNavPanel`,
 * and for the same reason: the layout is a Server Component and can only hand the
 * shell a plain element, so the display state is read here instead.
 */
export function PersonalNavPanel({ keys }: { keys: readonly PersonalNavKey[] }) {
  const { narrow, carved } = useSidebarDisplay();
  return <PersonalSidebar keys={keys} narrow={narrow} carved={carved} />;
}
