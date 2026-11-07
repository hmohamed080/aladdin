import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { requireApprovedShowroomContext } from "@/features/showroom-shell/context";
import { SHOWROOM_GROUPS, canNavigate } from "@/features/showroom-shell/navigation";

export default async function ShowroomModule({ params }: { params: Promise<{ page: string }> }) {
  const { org } = await requireApprovedShowroomContext();
  const { page } = await params;
  const item = SHOWROOM_GROUPS.flatMap((group) => group.items).find((entry) => entry.id === page);
  if (!item || !canNavigate(item, org.capabilities)) notFound();
  // Earlier preview links to a module that now lives at its finished route keep working.
  if (!item.hidden && item.href !== `/showroom/${item.id}`) redirect(item.href);
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return <section className="rounded-lg border bg-surface p-6">
    <h1 className="text-title font-semibold text-fg">{item.label[locale]}</h1>
    <p className="mt-2 text-body text-fg-secondary">{org.organizationName}</p>
    <p className="mt-6 text-body text-fg-muted">{locale === "ar" ? "هذه الصفحة غير متاحة بعد. يمكنك الآن التنقل بين الأقسام وتبديل نشاطك التجاري." : "This page is not available yet. You can navigate sections and switch your business workspace."}</p>
  </section>;
}
