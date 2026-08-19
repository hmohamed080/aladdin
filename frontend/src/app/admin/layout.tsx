import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/context";
import { getMessages } from "@/lib/i18n/translate";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadPlatformRole } from "@/server/queries/platform";
import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/primitives";
import { AdminSidebar, AdminTopNav } from "@/components/admin/admin-nav";
import { contentColumnClass } from "@/components/layout/content-column";
import { cn } from "@/lib/ui/cn";

export const dynamic = "force-dynamic";

/**
 * Admin console shell. Platform-staff ONLY: the gate reads the caller's
 * platform_role_grant and bounces anyone else to their derived landing. This is
 * defense in depth — every admin query is still RLS-scoped by `is_platform(...)`,
 * so a non-staff caller who bypassed this guard would read nothing. Denser,
 * operational layout, but visually part of Aladdin.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = await getServerSupabase();
  const role = await loadPlatformRole(supabase);
  if (!role) redirect("/");

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const dir = directionFor(locale);
  const m = getMessages(locale);

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
          context={<Badge tone="accent">{m.admin.roleLabel[role]}</Badge>}
        />

        <div className="flex min-w-0 flex-1">
          <aside
            className="sticky hidden w-56 shrink-0 flex-col border-e bg-surface px-3 py-md tablet:flex"
            style={{ top: "var(--app-header-h)", height: "calc(100dvh - var(--app-header-h))" }}
          >
            <p className="px-3 pb-2 text-label font-semibold uppercase tracking-wide text-fg-muted">
              {m.admin.title}
            </p>
            <AdminSidebar />
            <div className="mt-auto px-3 pt-lg">
              <Badge tone="accent">{m.admin.roleLabel[role]}</Badge>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <AdminTopNav />

            <main className={cn(contentColumnClass, "py-lg")} id="main">
              {children}
            </main>
          </div>
        </div>
      </div>
    </I18nProvider>
  );
}
