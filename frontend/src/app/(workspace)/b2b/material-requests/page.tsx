import { getPageContext } from "@/server/queries/page-context";
import { discoverRequestsPage } from "@/server/queries/purchase-requests";
import { Card, StatePanel } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/controls";

export default async function MaterialRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const ar = ctx.locale === "ar";
  const page = Math.max(
    1,
    Math.min(1000, Number((await searchParams).page) || 1),
  );
  const { rows, total } = await discoverRequestsPage(
    ctx.supabase,
    ctx.org.organizationId,
    {},
    (page - 1) * 24,
    24,
  );
  return (
    <div className="flex flex-col gap-lg">
      <h1 className="text-headline">
        {ar ? "طلبات خامات المشاريع" : "Project material requests"}
      </h1>
      <p className="text-body text-fg-secondary">
        {ar
          ? "طلبات منشورة متاحة لمعرضك. قدّم عرضاً مستقلاً للخامات التي تستطيع توريدها."
          : "Published requests available to your workspace. Quote the materials you can supply."}
      </p>
      {!rows.length ? (
        <StatePanel
          title={ar ? "لا توجد طلبات متاحة" : "No available requests"}
        />
      ) : (
        <div className="grid gap-md tablet:grid-cols-2">
          {rows.map((r) => (
            <Card key={r.id}>
              <h2 className="text-title">{r.title}</h2>
              <ButtonLink
                className="mt-md"
                href={`/b2b/material-requests/${r.id}`}
              >
                {ar ? "عرض الطلب وتقديم سعر" : "View request & quote"}
              </ButtonLink>
            </Card>
          ))}
        </div>
      )}
      <div className="flex gap-md">
        {page > 1 && (
          <ButtonLink href={`?page=${page - 1}`}>
            {ar ? "السابق" : "Previous"}
          </ButtonLink>
        )}
        {page * 24 < total && (
          <ButtonLink href={`?page=${page + 1}`}>
            {ar ? "التالي" : "Next"}
          </ButtonLink>
        )}
      </div>
    </div>
  );
}
