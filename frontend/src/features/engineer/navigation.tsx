"use client";

import {
  HomeIcon,
  ClipboardIcon,
  StorefrontIcon,
  BriefcaseIcon,
  UsersIcon,
  PackageIcon,
  HeartIcon,
  UserIcon,
} from "@/components/ui/icons";
import type { SidebarMode } from "@/lib/ui/sidebar-mode";
import { ShowroomSidebar } from "@/features/showroom-shell/sidebar";
import { ShowroomSearch } from "@/features/showroom-shell/search";
import type { ShowroomNavGroup, ShowroomNavItem } from "@/features/showroom-shell/navigation";
import { ENGINEER_LINKS } from "./links";

const ICONS: Record<(typeof ENGINEER_LINKS)[number]["id"], ShowroomNavItem["Icon"]> = {
  home: HomeIcon,
  requests: ClipboardIcon,
  showrooms: StorefrontIcon,
  projects: BriefcaseIcon,
  professionals: UsersIcon,
  products: PackageIcon,
  teams: UsersIcon,
  saved: HeartIcon,
  profile: UserIcon,
};

const ENGINEER_GROUPS: readonly ShowroomNavGroup[] = [
  {
    label: { ar: "", en: "" },
    items: ENGINEER_LINKS.map((link) => ({
      id: link.id,
      label: { ar: link.ar, en: link.en },
      Icon: ICONS[link.id],
      href: link.href,
      capabilities: [],
      // Overview owns only /home; every other row owns its subtree (the longest path wins, so
      // "My projects" at /home/profile/portfolio is not swallowed by "My profile" at /home/profile).
      exact: link.id === "home",
    })),
  },
];

/** The header's search field: the Showroom's command palette, searching the Engineer's pages. */
export function EngineerSearch() {
  return <ShowroomSearch capabilities={[]} groups={ENGINEER_GROUPS} />;
}

/**
 * The Engineer's navigation: the same sidebar the Showroom account uses (display modes, hover
 * reveal, mobile drawer, points and sign-out), filled with the Engineer's destinations.
 */
export function EngineerSidebar({ initialMode }: { initialMode: SidebarMode }) {
  return <ShowroomSidebar initialMode={initialMode} groups={ENGINEER_GROUPS} pointsHref="/home/points" />;
}
