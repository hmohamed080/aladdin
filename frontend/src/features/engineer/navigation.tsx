"use client";
import { usePathname } from "next/navigation";
import { useState } from "react";
import Image from "next/image";
import { ButtonLink } from "@/components/ui/controls";
import { useI18n } from "@/lib/i18n/context";
import { useSidebarDisplay } from "@/components/layout/sidebar-shell";
import { NavLink } from "@/components/layout/nav-item";
import { ActiveCarve } from "@/components/layout/nav-carve";
import { navColumnClass } from "@/lib/ui/nav-geometry";
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
import { ENGINEER_LINKS } from "./links";
const icons = [
  HomeIcon,
  ClipboardIcon,
  StorefrontIcon,
  BriefcaseIcon,
  UsersIcon,
  PackageIcon,
  UsersIcon,
  HeartIcon,
  UserIcon,
];

export function EngineerNavigation({ mobile = false }: { mobile?: boolean }) {
  const path = usePathname();
  const { locale } = useI18n();
  const { narrow, carved } = useSidebarDisplay();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const links = ENGINEER_LINKS.map((link, i) => (
    <NavLink
      key={link.id}
      item={{
        href: link.href,
        key: "personalNav.home",
        label: locale === "ar" ? link.ar : link.en,
        exact: link.id === "home",
        Icon: icons[i]!,
      }}
      active={
        link.id === "home"
          ? path === link.href
          : path.startsWith(link.href) &&
            !(link.id === "profile" && path.includes("portfolio"))
      }
      narrow={!mobile && narrow}
      carved={!mobile && carved}
      ground={mobile ? "surface" : "shell"}
    />
  ));
  if (mobile)
    return (
      <nav
        aria-label={locale === "ar" ? "التنقل" : "Navigation"}
        className="flex max-w-full gap-2 overflow-x-auto border-t bg-surface p-2 tablet:hidden [&>a]:shrink-0"
      >
        {links}
      </nav>
    );
  return (
    <div ref={setContainer} className="relative">
      {carved && (
        <ActiveCarve container={container} narrow={narrow} roundedBand />
      )}
      <nav
        aria-label={locale === "ar" ? "حساب المهندس" : "Engineer account"}
        className={`relative z-10 flex flex-col gap-1 ${navColumnClass(narrow)}`}
        style={{ width: "var(--shell-nav-w, 100%)" }}
      >
        {links}
      </nav>
      {!narrow && <div className="engineer-sidebar-promo">
        <ButtonLink href="/home/profile/portfolio" variant="outline" className="w-full">{locale === "ar" ? "إضافة مشروع +" : "Add a project +"}</ButtonLink>
        <div className="relative mt-lg overflow-hidden rounded-md border">
          <Image src="/assets/engineer/hero-living-room.webp" alt="" width={300} height={220} className="h-40 w-full object-cover" />
          <div className="p-md"><h2>{locale === "ar" ? "حوّل أفكارك إلى واقع" : "Bring your ideas to life"}</h2><p className="mt-2 text-label">{locale === "ar" ? "اكتشف المعارض والمتخصصين لمشروعك القادم." : "Discover showrooms and professionals for your next project."}</p><ButtonLink href="/home/engineer/requests/new" variant="accent" className="mt-md w-full">{locale === "ar" ? "ابدأ الآن" : "Start now"}</ButtonLink></div>
        </div>
      </div>}
    </div>
  );
}
