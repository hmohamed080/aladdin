import { notFound } from "next/navigation";
import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import { getCatalogProduct } from "@/server/queries/commerce";
import { BackLink } from "@/features/sales/page-parts";
import { CatalogProductDetail } from "@/features/commerce/catalog-product-detail";
import { listCatalogImages, signProductImageUrls } from "@/server/queries/product-images";

export const dynamic = "force-dynamic";

export default async function CatalogProductPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const { productId } = await params;

  const product = await getCatalogProduct(supabase, org.organizationId, productId);
  // View columns are nullable in the generated types though logically non-null;
  // a row missing its core fields is treated as not found.
  if (!product || !product.id || !product.category || !product.unit) {
    notFound();
  }

  // The uploaded photos (RLS: a published product's ready images), signed with the caller's own access.
  const gallery = (await listCatalogImages(supabase, org.organizationId, [product.id])).get(product.id) ?? [];
  const signed = await signProductImageUrls(supabase, gallery.map((g) => g.objectKey), { orgId: org.organizationId });
  const imageUrls = gallery.map((g) => signed.get(g.objectKey)).filter((u): u is string => Boolean(u));

  const isOwnOrg = product.organization_id === org.organizationId;
  const canRfq = org.canManageSales || org.capabilities.includes("rfq.create") || org.capabilities.includes("org.manage");

  return (
    <CatalogProductDetail
      product={{ ...product, id: product.id, category: product.category, unit: product.unit, organization_id: product.organization_id }}
      m={m}
      imageUrls={imageUrls}
      isOwnOrg={isOwnOrg}
      canRfq={canRfq}
      rfqHref={`/b2b/rfqs/new?product=${product.id}`}
      back={<BackLink href="/b2b/catalog">{m.commerce.catalog.backToCatalog}</BackLink>}
    />
  );
}
