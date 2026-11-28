import { notFound } from "next/navigation";
import { formatCount } from "@/lib/ui/format";
import { getMessages } from "@/lib/i18n/translate";
import { PageHeader } from "@/components/ui/workspace-layout";
import { StorefrontIcon } from "@/components/ui/icons";
import { requireApprovedSeller } from "@/features/marketplace-seller/seller-gate";
import { ProductForm } from "@/features/marketplace-seller/product-form";
import { ReturnabilityToggle } from "@/features/marketplace-returns/returnability-toggle";
import { VideoManager } from "@/features/video/video-manager";
import { listMarketplaceVideos } from "@/server/queries/videos";
import { videoEnabled } from "@/server/video/playback";
import { loadProductTypeSchemas, loadSellerProduct } from "@/server/queries/marketplace-seller-catalog";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /showroom/marketplace/products/[id]/edit — the same form as Add, filled from the seller's
 * own product. The read RPC refuses another organization's product, and a product
 * of a business other than the ACTIVE one is treated as not found.
 */
export default async function EditMarketplaceProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; imagesFailed?: string }>;
}) {
  const { supabase, org, locale } = await requireApprovedSeller();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [product, schemas, sp] = await Promise.all([
    loadSellerProduct(supabase, id),
    loadProductTypeSchemas(supabase),
    searchParams,
  ]);
  if (!product || product.organizationId !== org.organizationId) notFound();
  const t = getMessages(locale).marketplaceSeller;
  // Product video (R2 + HLS). Hidden while video delivery is off, so a seller never uploads into a path that cannot play.
  const videos = videoEnabled() ? await listMarketplaceVideos(product.id) : null;
  return (
    <div className="flex flex-col gap-lg">
      <PageHeader
        locale={locale}
        Icon={StorefrontIcon}
        title={t.editTitle}
        subtitle={`${locale === "ar" ? product.nameAr : product.nameEn} · ${t.status[product.status]}`}
      />
      {Number(sp.imagesFailed) > 0 ? (
        <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 px-md py-sm text-label text-fg-secondary">
          {t.image.queuedFailed.replace("{count}", formatCount(Math.min(99, Number(sp.imagesFailed)), locale))}
        </p>
      ) : null}
      <ProductForm
        key={product.id}
        organizationId={org.organizationId}
        schemas={schemas}
        product={product}
        notice={sp.created ? t.created : undefined}
        beforeActions={<ReturnabilityToggle key={`returns-${product.id}`} organizationId={org.organizationId} productId={product.id} initial={product.nonReturnable === true} locale={locale} />}
      />
      {videos ? <VideoManager scope="marketplace" productId={product.id} videos={videos} canPublish={false} /> : null}
    </div>
  );
}
