import type { ComponentType } from "react";
import {
  BriefcaseIcon,
  ClipboardIcon,
  GiftIcon,
  HelpIcon,
  HomeIcon,
  MessageIcon,
  ScrollIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
  StorefrontIcon,
  UserIcon,
} from "@/components/ui/icons";
import type { Bi } from "./mock-data";

export type InstallerNavItem = {
  id: string;
  label: Bi;
  Icon: ComponentType<{ size?: number }>;
  badge?: number;
  href?: string;
  /**
   * An in-page section this row can genuinely take the reader to. Phase 1 has
   * exactly one route — everything else in the target sidebar structure names
   * a real future destination that does not exist yet, so those rows render as
   * honest, inert affordances rather than links to a 404.
   */
  anchor?: string;
};

export const INSTALLER_PRIMARY_NAV: InstallerNavItem[] = [
  { id: "home", label: { ar: "الرئيسية", en: "Home" }, Icon: HomeIcon, anchor: "top", href: "/home" },
  { id: "jobs", label: { ar: "فرص شغل", en: "Job opportunities" }, Icon: BriefcaseIcon, badge: 3, anchor: "opportunities", href: "/home/jobs" },
  { id: "my-work", label: { ar: "شغلي", en: "My work" }, Icon: ClipboardIcon, href: "/home/work" },
  { id: "messages", label: { ar: "الرسائل", en: "Messages" }, Icon: MessageIcon, badge: 2, anchor: "attention" },
  { id: "account", label: { ar: "حسابي", en: "My account" }, Icon: UserIcon, anchor: "profile", href: "/home/profile" },
];

export const INSTALLER_QUICK_NAV: InstallerNavItem[] = [
  { id: "search-jobs", label: { ar: "ابحث عن شغل", en: "Search for work" }, Icon: SearchIcon, anchor: "opportunities", href: "/home/jobs" },
  { id: "my-showrooms", label: { ar: "شبكتي", en: "My network" }, Icon: StorefrontIcon, anchor: "ecosystem", href: "/home/network" },
  { id: "learn", label: { ar: "تعلم وتدرب", en: "Learn & train" }, Icon: ScrollIcon, anchor: "learning" },
  { id: "rewards", label: { ar: "نقاطي ومكافآتي", en: "Points & rewards" }, Icon: GiftIcon, anchor: "rewards", href: "/home/points" },
  { id: "reviews", label: { ar: "تقييماتي", en: "My reviews" }, Icon: StarIcon, anchor: "profile", href: "/home/reviews" },
  { id: "settings", label: { ar: "الإعدادات", en: "Settings" }, Icon: SettingsIcon, href: "/home/settings" },
  { id: "support", label: { ar: "المساعدة والدعم", en: "Help & support" }, Icon: HelpIcon },
];
