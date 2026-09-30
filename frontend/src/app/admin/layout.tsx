import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/context";
import { getMessages } from "@/lib/i18n/translate";
import { requireAdminStaff } from "@/server/authorization/admin";
import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/primitives";
import { AdminSidebar, AdminTopNav } from "@/components/admin/admin-nav";
import { contentColumnClass } from "@/components/layout/content-column";
import { cn } from "@/lib/ui/cn";

export const dynamic = "force-dynamic";

/**
 * Admin console shell. Admin Staff ONLY: `requireAdminStaff()` resolves the
 * caller's authority from `admin_role_assignments` (via `admin_my_access()`) and
 * bounces anyone else to their derived landing. Navigation shows only the areas
 * the caller's permissions open (same route table the page guards use). This is
 * defense in depth — every page re-checks its own permission, every admin read is
 * RLS-scoped and every mutation is a self-guarding RPC.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const access = await requireAdminStaff();

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const dir = directionFor(locale);
  const m = getMessages(locale);
  // Highest-ranked active role; system roles use their localized name.
  const top = access.roles[0];
  const roleLabel = top
    ? top.isSystem
      ? ((m.admin.roleLabel as Record<string, string>)[top.key] ?? top.name)
      : top.name
    : "";

  return (
    <I18nProvider locale={locale} dir={dir}>
      {/* Same shell shape as the workspace: full-width header, then a row of
          rail + content. The console differs in WHAT it navigates, never in how
          the shell is assembled. */}
      <div className="flex min-h-dvh flex-col bg-canvas">
        <AppHeader
          appName={m.common.appName}
          /* The console has no organization behind it, so the palette offers
             Admin destinations (server-gated on platform role) and nothing
             else. Admin record search is deliberately not wired here: the
             console's own lists are the searchable surface, and a second path
             into platform-wide data is a second place to get the gate wrong. */
          hasWorkspace={false}
          workspaceLabel={m.admin.title}
          context={roleLabel ? <Badge tone="accent">{roleLabel}</Badge> : null}
        />

        <div className="flex min-w-0 flex-1">
          <aside
            className="sticky hidden w-56 shrink-0 flex-col border-e bg-surface px-3 py-md tablet:flex"
            style={{ top: "var(--app-header-h)", height: "calc(100dvh - var(--app-header-h))" }}
          >
            <p className="px-3 pb-2 text-label font-semibold uppercase tracking-wide text-fg-muted">
              {m.admin.title}
            </p>
            <AdminSidebar access={access} />
            <div className="mt-auto px-3 pt-lg">
              {roleLabel ? <Badge tone="accent">{roleLabel}</Badge> : null}
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <AdminTopNav access={access} />

            <main className={cn(contentColumnClass, "py-lg")} id="main">
              {children}
            </main>
          </div>
        </div>
      </div>
    </I18nProvider>
  );
}
