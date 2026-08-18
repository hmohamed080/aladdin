import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, directionFor } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/context";
import { getMessages } from "@/lib/i18n/translate";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadPlatformRole } from "@/server/queries/platform";
import { Brand } from "@/components/layout/brand";
import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/primitives";
import { AdminSidebar, AdminTopNav } from "@/components/admin/admin-nav";

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
      <div className="flex min-h-dvh bg-canvas">
        <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-e bg-surface px-3 py-lg tablet:flex">
          <div className="flex items-center gap-2 px-2 pb-lg">
            <Brand name={m.common.appName} size="md" />
          </div>
          <p className="px-3 pb-2 text-label font-semibold uppercase tracking-wide text-fg-muted">
            {m.admin.title}
          </p>
          <AdminSidebar />
          <div className="mt-auto px-3 pt-lg">
            <Badge tone="accent">{m.admin.roleLabel[role]}</Badge>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
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

          <AdminTopNav />

          <main className="mx-auto w-full max-w-[1200px] flex-1 px-md py-lg" id="main">
            {children}
          </main>
        </div>
      </div>
    </I18nProvider>
  );
}
