import { notFound } from "next/navigation";
import { getPageContext } from "@/server/queries/page-context";
import {
  getRequestForWorkspace,
  signRequestImageUrls,
} from "@/server/queries/purchase-requests";
import { Card } from "@/components/ui/primitives";
import { createTranslator } from "@/lib/i18n/translate";
import { MaterialResponseForm } from "@/features/purchase-requests/response-form";

export default async function MaterialRequestPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { requestId } = await params;
  const request = await getRequestForWorkspace(
    ctx.supabase,
    ctx.org.organizationId,
    requestId,
  );
  if (!request) notFound();
  const ar = ctx.locale === "ar";
  const t = createTranslator(ctx.locale);
  const [{ data: location, error }, images] = await Promise.all([
    ctx.supabase.rpc("engineer_request_location", {
      p_request_id: requestId,
      p_org_id: ctx.org.organizationId,
    }),
    signRequestImageUrls(
      ctx.supabase,
      request.items.flatMap((i) => i.images.map((m) => m.key)),
      { orgId: ctx.org.organizationId },
    ),
  ]);
  if (error) throw error;
  return (
    <div className="flex flex-col gap-lg">
      <h1 className="text-headline">{request.title}</h1>
      {location && (
        <p className="text-body">
          {ar ? "مكان المشروع: " : "Project location: "}
          {location}
        </p>
      )}
      <p className="whitespace-pre-wrap text-body text-fg-secondary">
        {request.notes}
      </p>
      {request.neededBy && (
        <p>
          {ar ? "مطلوب بحلول: " : "Needed by: "}
          {request.neededBy}
        </p>
      )}
      <div className="grid gap-md tablet:grid-cols-2">
        {request.items.map((item) => (
          <Card key={item.id}>
            <h2 className="text-title">{item.name}</h2>
            <p>
              {item.quantity} {t(`commerce.units.${item.unit}`)}
            </p>
            <p className="text-body text-fg-secondary">{item.specs}</p>
            {item.images.map(
              (m) =>
                images.has(m.key) && (
                  <a
                    key={m.id}
                    href={images.get(m.key)}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {ar ? "الصورة المرجعية" : "Reference image"}
                  </a>
                ),
            )}
          </Card>
        ))}
      </div>
      <MaterialResponseForm request={request} orgId={ctx.org.organizationId} />
    </div>
  );
}
