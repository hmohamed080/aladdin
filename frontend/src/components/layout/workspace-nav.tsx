"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";

/**
 * Primary navigation for the current sprint. Renders as a horizontal bar on
 * desktop/tablet and a bottom bar on mobile (reachable, no horizontal overflow).
 * Only the four implemented modules appear — no dead links.
 */
const items = [
  { href: "/b2b", key: "nav.home", exact: true },
  { href: "/b2b/customers", key: "nav.customers", exact: false },
  { href: "/b2b/leads", key: "nav.leads", exact: false },
  { href: "/b2b/follow-ups", key: "nav.followUps", exact: false },
] as const;

export function WorkspaceNav() {
  const { t } = useI18n();
  const pathname = usePathname();

  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  return (
    <nav aria-label={t("nav.workspace")} className="mx-auto w-full max-w-[1440px]">
      {/* Desktop / tablet: inline tabs under the top bar. */}
      <ul className="hidden gap-1 px-md tablet:flex">
        {items.map((it) => {
          const activeItem = isActive(it.href, it.exact);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={activeItem ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-9 items-center border-b-2 px-3 py-2 text-label transition-colors",
                  activeItem
                    ? "border-accent-solid text-fg"
                    : "border-transparent text-fg-secondary hover:text-fg",
                )}
              >
                {t(it.key)}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Mobile: fixed bottom bar. */}
      <ul
        className="fixed inset-x-0 bottom-0 z-sticky grid grid-cols-4 border-t bg-surface tablet:hidden"
        style={{ zIndex: 100 }}
      >
        {items.map((it) => {
          const activeItem = isActive(it.href, it.exact);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={activeItem ? "page" : undefined}
                className={cn(
                  "flex min-h-12 flex-col items-center justify-center gap-0.5 py-2 text-label",
                  activeItem ? "text-accent" : "text-fg-secondary",
                )}
              >
                {t(it.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
