"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";
import { CommandPalette } from "@/features/admin-preview/command-palette";
import type { PaletteItem } from "@/features/admin-preview/command-palette-search";
import { AlertIcon } from "@/components/ui/icons";

/**
 * Pages that still show demo (fixture / Preview-dialog) data. Only these carry the Preview banner;
 * every other admin page is real and shows no banner (owner decision, marketplace walkthrough Part 2).
 */
const DEMO_DATA_ROUTES = ["/admin/analytics", "/admin/points", "/admin/settings"];

/**
 * The Admin console's content chrome: a Preview banner on pages that still show demo data, plus the Command Palette. Rendered inside `app/admin/layout.tsx`, so
 * it sits behind the Admin Staff gate; navigation lives in the console rail
 * (components/admin/admin-nav.tsx) and each page still enforces its own permission.
 */
export function PreviewShell({
  children,
  paletteItems,
}: {
  children: ReactNode;
  paletteItems: PaletteItem[];
}) {
  const { t } = useI18n();
  const pathname = usePathname();

  const demo = DEMO_DATA_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));

  return (
    <div className="flex flex-col gap-lg">
      {demo ? (
        <div role="note" className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/10 px-md py-3">
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-warning">
            <AlertIcon size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-body-lg font-medium text-fg">{t("admin.preview.bannerTitle")}</p>
            <p className="mt-0.5 text-body text-fg-secondary">{t("admin.preview.bannerBody")}</p>
          </div>
        </div>
      ) : null}

      {/* No trigger here: the header search is the single entry point (see palette-bridge). */}
      <CommandPalette items={paletteItems} />

      {children}
    </div>
  );
}
