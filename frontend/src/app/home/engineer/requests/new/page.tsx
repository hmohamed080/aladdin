import { listOrganizations } from "@/server/queries/directory";
import { cookies } from "next/headers";
import { requireEngineer } from "@/server/queries/engineer";
import { getCatalogProduct } from "@/server/queries/commerce";
import { RequestComposer } from "@/features/engineer/request-composer";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { isUuid } from "@/features/purchase-requests/model";
export const dynamic = "force-dynamic";
export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; supplier?: string }>;
}) {
  const { supabase } = await requireEngineer();
  const { product: productId, supplier } = await searchParams;
  const product =
    productId && isUuid(productId)
      ? await getCatalogProduct(supabase, null, productId)
      : null;
  const showrooms = (
    await listOrganizations(supabase, { types: ["showroom_dealer"] })
  ).flatMap((s) => (s.id ? [{ id: s.id, name: s.name ?? "" }] : []));
  const selected = supplier ?? product?.organization_id;
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return (
    <div lang={locale}>
      <RequestComposer
        product={product}
        showrooms={showrooms}
        context={{
          location: "",
          showroomIds:
            selected && showrooms.some((s) => s.id === selected)
              ? [selected]
              : [],
        }}
      />
    </div>
  );
}
