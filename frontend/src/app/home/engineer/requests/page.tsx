import { cookies } from "next/headers";
import { requireEngineer } from "@/server/queries/engineer";
import { listMyRequests } from "@/server/queries/purchase-requests";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/translate";
import { Badge, StatePanel } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/controls";
import { PageHeader, WorkPane, Panel } from "@/components/ui/workspace-layout";
import { StatTiles, TabLinks } from "@/components/ui/stat-tiles";
import { DataTable, RecordCell, type Column } from "@/components/ui/data-table";
import { DonutSplit } from "@/components/ui/charts";
import { formatDate, formatNumber, formatPercent } from "@/lib/ui/format";
import { CheckIcon, ClipboardIcon, ClockIcon, FileTextIcon, ShoppingBagIcon, XIcon } from "@/components/ui/icons";
import { requestStatusLabel } from "@/features/engineer/status";

export const dynamic = "force-dynamic";

const STATUSES = ["draft", "published", "closed", "cancelled"] as const;
type Status = (typeof STATUSES)[number];
const TONE: Record<Status, "neutral" | "info" | "success" | "danger"> = {
  draft: "neutral",
  published: "info",
  closed: "success",
  cancelled: "danger",
};

/**
 * طلبات عروض الأسعار — the engineer's own quotation requests, in the showroom's RFQ layout.
 *
 * The same shell the showroom's requests screen is built from: page header with the primary action
 * and a count, a strip of summary tiles, a status-split chart beside the list, status tabs with
 * counts, and a table. Only the DATA is the engineer's — their own purchase requests and their four
 * statuses (draft, awaiting responses, closed, cancelled) — so none of the showroom's RFQ-specific
 * columns (counterparty, required-by) are invented here.
 */
export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { supabase } = await requireEngineer();
  const rows = await listMyRequests(supabase, null);
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const ar = locale === "ar";
  const requested = (await searchParams).status;
  const active = STATUSES.find((status) => status === requested) ?? "all";
  const filtered = active === "all" ? rows : rows.filter((row) => row.status === active);
  const count = (status: Status) => rows.filter((row) => row.status === status).length;
  const title = ar ? "طلبات عروض الأسعار" : "Quotation requests";

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: "title",
      header: ar ? "الطلب" : "Request",
      cell: (r) => (
        <RecordCell title={r.title} meta={r.notes || undefined} href={`/home/engineer/requests/${r.id}`} />
      ),
    },
    {
      key: "status",
      header: ar ? "الحالة" : "Status",
      cell: (r) => <Badge tone={TONE[r.status as Status] ?? "neutral"}>{requestStatusLabel(r.status as Status, locale)}</Badge>,
    },
    {
      key: "created",
      header: ar ? "تاريخ الإنشاء" : "Created",
      numeric: true,
      desktopOnly: true,
      cell: (r) => formatDate(r.created_at, locale),
    },
    {
      key: "updated",
      header: ar ? "آخر تحديث" : "Updated",
      numeric: true,
      cell: (r) => formatDate(r.updated_at, locale),
    },
  ];

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0" data-testid="engineer-requests">
      <PageHeader
        locale={locale}
        Icon={ClipboardIcon}
        title={title}
        subtitle={ar ? "اطلب أسعار الخامات لمشروعك وتابع حالة كل طلب." : "Ask for prices on your project's materials and follow each request."}
        count={rows.length}
        action={{ href: "/home/engineer/requests/new", label: ar ? "طلب جديد" : "New request" }}
      />

      <StatTiles
        locale={locale}
        layout="strip"
        tiles={[
          { label: requestStatusLabel("published", locale), value: count("published"), Icon: ClockIcon, tone: "warning" },
          { label: requestStatusLabel("draft", locale), value: count("draft"), Icon: FileTextIcon },
          { label: requestStatusLabel("closed", locale), value: count("closed"), Icon: CheckIcon, tone: "success" },
          { label: requestStatusLabel("cancelled", locale), value: count("cancelled"), Icon: XIcon, tone: "danger" },
        ]}
      />

      <WorkPane
        aside={
          <Panel title={ar ? "الطلبات حسب الحالة" : "Requests by status"} Icon={ShoppingBagIcon}>
            <DonutSplit
              slices={STATUSES.map((status) => ({ label: requestStatusLabel(status, locale), value: count(status) }))}
              emptyLabel={m.reports.noData}
              ariaLabel={ar ? "الطلبات حسب الحالة" : "Requests by status"}
              centerLabel={title}
              formatValue={(v) => formatNumber(v, locale)}
              formatShare={(pct) => formatPercent(pct, locale)}
            />
          </Panel>
        }
      >
        <TabLinks
          locale={locale}
          basePath="/home/engineer/requests"
          param="status"
          current={active === "all" ? "" : active}
          label={ar ? "حالة الطلب" : "Request status"}
          tabs={[
            { value: "", label: ar ? "الكل" : "All", count: rows.length },
            ...STATUSES.map((status) => ({ value: status, label: requestStatusLabel(status, locale), count: count(status) })),
          ]}
        />

        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          caption={title}
          empty={
            <StatePanel
              icon={<FileTextIcon size={22} />}
              title={ar ? "لا توجد طلبات بهذه الحالة" : "No requests with this status"}
              body={
                ar
                  ? "ابدأ بتحديد خامات مشروعك وكمياتها، ويمكنك حفظ طلبك كمسودة قبل إرساله."
                  : "Start with your project's materials and quantities. You can save a draft before publishing."
              }
              action={<ButtonLink href="/home/engineer/requests/new">{ar ? "إنشاء طلب" : "Create a request"}</ButtonLink>}
            />
          }
        />
      </WorkPane>
    </div>
  );
}
