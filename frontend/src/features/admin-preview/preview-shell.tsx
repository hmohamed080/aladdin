"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { CommandPalette } from "@/features/admin-preview/command-palette";
import type { PaletteItem } from "@/features/admin-preview/command-palette-search";
import { AlertIcon } from "@/components/ui/icons";

/** Preview routes already promoted to real, enforced Admin Core (Phase 1A: Staff · Roles · Permissions). */
const LIVE_PREVIEW_ROUTES = ["/admin/staff"];
/**
 * Preview routes whose DATA is real (Phase 1B-A: Users · Organizations read
 * from Admin Core) while their actions are still Preview dialogs until 1B-B.
 * They get their own banner — "changes here are real" would be untrue.
 */
const LIVE_READ_ROUTES = ["/admin/users", "/admin/organizations"];

/**
 * Routes that predate the Admin Core dashboard and are fully live (real reads and
 * real decisions): they carry no Preview banner at all.
 */
const CLASSIC_ROUTES = ["/admin/verifications"];

/**
 * The Admin console's content chrome: a per-area banner saying honestly whether
 * the area is live, live-read, or still Preview (fixtures / dialogs that save
 * nothing), plus the Command Palette. Rendered inside `app/admin/layout.tsx`, so
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

  // PD-016: Preview areas are promoted one at a time. A promoted (live) area must
  // never sit under the "nothing is saved" banner — that would be untrue.
  const matches = (routes: string[]) => routes.some((r) => pathname === r || pathname.startsWith(r + "/"));
  // Admin View-As carries its own persistent "Admin View — Read Only" bar; the generic "changes here are saved" banner would be untrue there.
  const viewAs = /^\/admin\/users\/[^/]+\/view(\/|$)/.test(pathname);
  const classic = matches(CLASSIC_ROUTES) || viewAs;
  const live = matches(LIVE_PREVIEW_ROUTES);
  const liveRead = !live && matches(LIVE_READ_ROUTES);
  const bannerKey = live ? "liveBanner" : liveRead ? "liveReadBanner" : "banner";

  return (
    <div className="flex flex-col gap-lg">
      {classic ? null : (
        <div
          role="note"
          className={cn(
            "flex items-start gap-3 rounded-md border px-md py-3",
            live || liveRead ? "border-info/40 bg-info/10" : "border-warning/40 bg-warning/10",
          )}
        >
          <span aria-hidden="true" className={cn("mt-0.5 shrink-0", live || liveRead ? "text-info" : "text-warning")}>
            <AlertIcon size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-body-lg font-medium text-fg">{t(`admin.preview.${bannerKey}Title`)}</p>
            <p className="mt-0.5 text-body text-fg-secondary">{t(`admin.preview.${bannerKey}Body`)}</p>
          </div>
        </div>
      )}

      {/* No trigger here: the header search is the single entry point (see palette-bridge). */}
      <CommandPalette items={paletteItems} />

      {children}
    </div>
  );
}
