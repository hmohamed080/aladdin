"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import {
  personalNavItem,
  activePersonalNavKey,
  type PersonalNavKey,
} from "@/lib/nav/personal-modules";
import { HomeIcon, UserIcon, GaugeIcon, StorefrontIcon, BuildingIcon } from "@/components/ui/icons";

/**
 * The personal rail — HORIZONTAL, and that is a decision rather than a shortcut.
 *
 * The B2B `SidebarShell` is a full-height vertical panel because a workspace has
 * twenty-odd capability-gated modules in six sections, and because the shell's
 * whole composition (the architectural-blue room, the carve, the atmosphere) is
 * built around that panel being the outermost thing on its side. A personal
 * account has FOUR destinations at most and no such room. Rendering the same
 * panel here would give three-quarters of a 280px column to empty space, and
 * reproducing its display modes, hover reveal and mobile sheet for four links is
 * machinery with nothing to carry.
 *
 * So this is a row of links under the header, sharing the vertical shell's icon
 * geometry (`NAV_ICON_SIZE`) so the two navigations read as one family, and
 * scrolling horizontally rather than wrapping on a narrow screen — a rail that
 * reflows to two lines moves the page content down by a row on exactly the
 * devices with the least of it.
 *
 * Everything is logical (`gap`, `ms`, `text-start`, `overflow-x`), so Arabic is
 * the mirror of English with no Arabic-only rule: the row reverses with `dir`
 * and the active underline follows its own item.
 *
 * It draws only what `personalNavSections` derived. It grants nothing — every
 * destination re-checks access server-side.
 */

const ICONS: Record<PersonalNavKey, ComponentType<{ size?: number }>> = {
  home: HomeIcon,
  profile: UserIcon,
  // The same glyph the workspace Points module uses — one feature, one mark.
  points: GaugeIcon,
  connectShowroom: StorefrontIcon,
  addBusiness: BuildingIcon,
};

export function PersonalRail({ keys }: { keys: readonly PersonalNavKey[] }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const active = activePersonalNavKey(pathname ?? "");

  if (keys.length < 2) return null;

  return (
    <nav
      aria-label={t("personalNav.label")}
      className="border-b border-strong/60"
      data-testid="personal-rail"
    >
      {/* `-mb-px` laps the active item's underline over the container's own
          border so the two read as one line rather than a 2px double rule. */}
      <ul className="-mb-px flex min-w-0 items-stretch gap-1 overflow-x-auto">
        {keys.map((key) => {
          const item = personalNavItem(key);
          const Icon = ICONS[key];
          const current = key === active;
          return (
            <li key={key} className="shrink-0">
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-body transition-colors duration-fast ease-standard motion-reduce:transition-none",
                  "rounded-t-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                  current
                    ? "border-accent font-medium text-fg"
                    : "border-transparent text-fg-secondary hover:border-strong hover:text-fg",
                )}
              >
                <Icon size={18} />
                {t(item.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
