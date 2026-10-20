import { cookies } from "next/headers";
import { requireEngineer } from "@/server/queries/engineer";
import { listMyRequests } from "@/server/queries/purchase-requests";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { Card, Badge } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/controls";
import { EngineerEmpty } from "@/features/engineer/sections";
import { requestStatusLabel } from "@/features/engineer/status";
export const dynamic = "force-dynamic";
const statuses = ["all", "draft", "published", "closed", "cancelled"] as const;
export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { supabase } = await requireEngineer();
  const rows = await listMyRequests(supabase, null);
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const ar = locale === "ar";
  const requested = (await searchParams).status;
  const active = statuses.find((status) => status === requested) ?? "all";
  const filtered =
    active === "all" ? rows : rows.filter((row) => row.status === active);
  return (
    <div className="flex flex-col gap-lg">
      <header className="flex flex-wrap items-center justify-between gap-md">
        <h1 className="text-headline">
          {ar ? "طلبات عروض الأسعار" : "Quotation requests"}
        </h1>
        <ButtonLink href="/home/engineer/requests/new">
          {ar ? "طلب جديد" : "New request"}
        </ButtonLink>
      </header>
      <nav
        aria-label={ar ? "حالة الطلب" : "Request status"}
        className="flex flex-wrap gap-2"
      >
        {statuses.map((status) => (
          <ButtonLink
            key={status}
            href={
              status === "all"
                ? "/home/engineer/requests"
                : `/home/engineer/requests?status=${status}`
            }
            variant={active === status ? "primary" : "outline"}
            aria-current={active === status ? "page" : undefined}
            size="sm"
          >
            {status === "all"
              ? ar
                ? "الكل"
                : "All"
              : requestStatusLabel(status, locale)}
          </ButtonLink>
        ))}
      </nav>
      {!filtered.length ? (
        <EngineerEmpty
          locale={locale}
          title={
            ar ? "لا توجد طلبات بهذه الحالة" : "No requests with this status"
          }
          description={
            ar
              ? "ابدأ بتحديد خامات مشروعك وكمياتها، ويمكنك حفظ طلبك كمسودة قبل إرساله."
              : "Start with your project's materials and quantities. You can save a draft before publishing."
          }
          href="/home/engineer/requests/new"
          action={ar ? "إنشاء طلب" : "Create a request"}
        />
      ) : (
        filtered.map((r) => (
          <Card
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-md"
          >
            <div>
              <h2 className="text-title">{r.title}</h2>
              <p className="mt-2 text-label text-fg-secondary">
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                }).format(new Date(r.created_at))}
              </p>
              <p className="mt-2 text-body text-fg-secondary">{r.notes}</p>
            </div>
            <Badge>{requestStatusLabel(r.status, locale)}</Badge>
            <ButtonLink
              href={`/home/engineer/requests/${r.id}`}
              variant="outline"
            >
              {ar ? "عرض التفاصيل" : "View details"}
            </ButtonLink>
          </Card>
        ))
      )}
    </div>
  );
}
