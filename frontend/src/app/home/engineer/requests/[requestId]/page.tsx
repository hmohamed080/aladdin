import { loadEngineerRequestContext } from "@/server/queries/engineer-request-context";
import { listOrganizations } from "@/server/queries/directory";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { requireEngineer } from "@/server/queries/engineer";
import {
  getMyRequest,
  listResponsesForRequester,
  signRequestImageUrls,
} from "@/server/queries/purchase-requests";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { Card, Badge } from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/controls";
import {
  RequestComposer,
  RequestLifecycle,
} from "@/features/engineer/request-composer";
import { EngineerEmpty } from "@/features/engineer/sections";
import { requestStatusLabel } from "@/features/engineer/status";
import { createTranslator } from "@/lib/i18n/translate";
export const dynamic = "force-dynamic";
export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ requestId: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { supabase } = await requireEngineer();
  const { requestId } = await params;
  const { edit } = await searchParams;
  const own = await getMyRequest(supabase, requestId);
  if (!own || own.request.requester_org_id !== null) notFound();
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const ar = locale === "ar";
  const context = await loadEngineerRequestContext(requestId);
  const showrooms = (
    await listOrganizations(supabase, { types: ["showroom_dealer"] })
  ).flatMap((s) => (s.id ? [{ id: s.id, name: s.name ?? "" }] : []));
  const urls = await signRequestImageUrls(
    supabase,
    own.items.flatMap((i) => i.images.map((m) => m.key)),
  );
  if (edit === "1" && own.request.status === "draft")
    return (
      <RequestComposer
        key={own.request.version}
        existing={own}
        context={context}
        showrooms={showrooms}
        imageUrls={Object.fromEntries(urls)}
      />
    );
  const responses = await listResponsesForRequester(supabase, requestId);
  return (
    <div className="flex flex-col gap-lg">
      <ButtonLink href="/home/engineer/requests" variant="ghost">
        {ar ? "العودة إلى الطلبات" : "Back to requests"}
      </ButtonLink>
      <header className="flex flex-wrap items-center justify-between gap-md">
        <h1 className="text-headline">{own.request.title}</h1>
        <Badge>{requestStatusLabel(own.request.status, locale)}</Badge>
      </header>
      <Card>
        <p className="mb-3 text-body">{context.location}</p>
        <p className="mb-3 text-label">
          {context.showroomIds.length
            ? showrooms
                .filter((s) => context.showroomIds.includes(s.id))
                .map((s) => s.name)
                .join(" · ")
            : ar
              ? "كل المعارض المؤهلة"
              : "All eligible showrooms"}
        </p>
        <p className="whitespace-pre-wrap text-body-lg">{own.request.notes}</p>
        {own.request.needed_by && (
          <p className="mt-3 text-body text-fg-secondary">
            {ar ? "تاريخ الاحتياج: " : "Needed by: "}
            {own.request.needed_by}
          </p>
        )}
      </Card>
      <h2 className="text-title">
        {ar ? "الخامات المطلوبة" : "Requested materials"}
      </h2>
      <div className="grid gap-md tablet:grid-cols-2">
        {own.items.map((i) => (
          <Card key={i.id} pad="sm">
            <h3 className="text-title">{i.name}</h3>
            <p className="my-2 text-body">
              {i.quantity} ·{" "}
              {createTranslator(locale)(`commerce.units.${i.unit}`)}
            </p>
            <p className="text-body text-fg-secondary">{i.specs}</p>
            <div className="mt-3 flex gap-3">
              {i.images.map(
                (m) =>
                  urls.get(m.key) && (
                    <a
                      key={m.id}
                      href={urls.get(m.key)}
                      className="text-label underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {ar ? "الصورة المرجعية" : "Reference image"}
                    </a>
                  ),
              )}
            </div>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {own.request.status === "draft" && (
          <>
            <ButtonLink href={`?edit=1`} variant="outline">
              {ar ? "تعديل وإضافة صور" : "Edit & attach images"}
            </ButtonLink>
            <RequestLifecycle
              id={requestId}
              version={own.request.version}
              action="publish"
            />
          </>
        )}
        {own.request.status === "published" && (
          <RequestLifecycle
            id={requestId}
            version={own.request.version}
            action="close"
          />
        )}
        {(own.request.status === "draft" ||
          own.request.status === "published") && (
          <RequestLifecycle
            id={requestId}
            version={own.request.version}
            action="cancel"
          />
        )}
      </div>
      <h2 className="text-title">
        {ar ? "العروض المستلمة" : "Supplier responses"} ({responses.length})
      </h2>
      {!responses.length ? (
        <EngineerEmpty locale={locale} />
      ) : (
        <div className="grid gap-md tablet:grid-cols-2">
          {responses.map((r) => (
            <Card key={r.id} className="flex flex-col gap-md">
              <h3 className="text-title">{r.responder?.name}</h3>
              <Badge>
                {r.coverage === "full"
                  ? ar
                    ? "تغطية كاملة"
                    : "Full coverage"
                  : ar
                    ? "تغطية جزئية"
                    : "Partial coverage"}
              </Badge>
              <strong className="text-headline">
                {new Intl.NumberFormat(locale, {
                  style: "currency",
                  currency: "EGP",
                }).format(r.total)}
              </strong>
              <p>{r.note}</p>
              {r.validUntil && (
                <p className="text-label">
                  {ar ? "صالح حتى " : "Valid until "}
                  {r.validUntil}
                </p>
              )}
              <ul className="space-y-2 text-body">
                {r.items.map((line) => (
                  <li key={line.requestItemId}>
                    {own.items.find((i) => i.id === line.requestItemId)?.name}:{" "}
                    {line.offeredQuantity} × {line.unitPrice} {r.currency}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      <p className="text-label text-fg-secondary">
        {ar
          ? "العروض غير ملزمة. قارن الكميات والوحدات والمواصفات قبل اتخاذ القرار."
          : "Responses are non-binding. Compare quantities, units and specifications before deciding."}
      </p>
    </div>
  );
}
