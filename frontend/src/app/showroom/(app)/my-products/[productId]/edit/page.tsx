import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { requireShowroomContext } from "@/features/showroom-shell/context";
import { SHOWROOM_GROUPS, SHOWROOM_ROOT, canNavigate } from "@/features/showroom-shell/navigation";
import { getOwnProduct, getProductAudiences, listProductPrices } from "@/server/queries/commerce";
import { isProductAudienceCode } from "@/features/showroom-shell/products/product-audiences";
import { listProductImages, signProductImageUrls } from "@/server/queries/product-images";
import { Card, Badge } from "@/components/ui/primitives";
import { ProductForm } from "@/features/showroom-shell/products/product-form";
import { ImageManager } from "@/features/showroom-shell/products/image-manager";
import { LifecycleControls } from "@/features/showroom-shell/products/lifecycle-controls";
import { ownProductStatus } from "@/features/showroom-shell/products/product-input";
import { effectiveColors } from "@/features/showroom-shell/products/color-items";
import { ShowroomPageHero, MY_PRODUCTS_HERO_ART } from "@/features/showroom-shell/page-hero";
import { PackageIcon } from "@/components/ui/icons";
import { VideoManager } from "@/features/video/video-manager";
import { listManagedVideos } from "@/server/queries/videos";
import { videoEnabled } from "@/server/video/playback";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ShowroomEditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ created?: string; saved?: string; photos?: string; audiences?: string }>;
}) {
  const { supabase, org } = await requireShowroomContext();
  const item = SHOWROOM_GROUPS.flatMap((g) => g.items).find((entry) => entry.id === "my-products");
  if (!item || !canNavigate(item, org.capabilities)) notFound();

  const { productId } = await params;
  const sp = await searchParams;
  if (!UUID.test(productId)) notFound();
  // Owned by THIS organization, or it does not exist here — another tenant's product never opens.
  const product = await getOwnProduct(supabase, org.organizationId, productId);
  if (!product) notFound();
  const price = (await listProductPrices(supabase, [product.id])).get(product.id) ?? null;
  const audiences = (await getProductAudiences(supabase, product.id)).filter(isProductAudienceCode);

  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const t = createTranslator(locale);
  const canWrite = org.capabilities.includes("catalog.write") || org.capabilities.includes("org.manage");
  const canPublish = org.capabilities.includes("catalog.publish") || org.capabilities.includes("org.manage");
  const status = ownProductStatus(product);

  const images = (await listProductImages(supabase, [product.id])).get(product.id) ?? [];
  const signed = await signProductImageUrls(supabase, images.map((i) => i.objectKey));

  // Videos: only while uploads go to R2 and playback runs at the edge.
  const videos = canWrite && status !== "archived" && videoEnabled()
    ? await listManagedVideos({ scope: "product", productId: product.id, workspace: org.organizationId }) : null;

  const photoManager = (
    <ImageManager
      productId={product.id}
      productName={product.name}
      archived={status === "archived"}
      images={images.map((i) => ({ id: i.id, url: signed.get(i.objectKey) ?? null, slot: i.slot }))}
      videos={videos ?? undefined}
    />
  );

  return (
    <div className="flex flex-col gap-md" data-testid="edit-product" data-status={status}>
      <ShowroomPageHero
        locale={locale}
        titleId="edit-product-title"
        Icon={PackageIcon}
        art={MY_PRODUCTS_HERO_ART}
        title={t("showroomProducts.editTitle")}
        subtitle={product.name}
        back={
          <Link href={`${SHOWROOM_ROOT}/my-products`} className="inline-flex w-fit items-center gap-1 rounded-sm border border-strong px-2.5 py-1 text-label text-fg-secondary hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            <span aria-hidden="true" className="rtl:rotate-180">←</span>
            {t("showroomProducts.backToList")}
          </Link>
        }
      />
      {sp.created === "1" ? <p role="status" className="rounded-sm border border-success/40 bg-success/10 px-md py-2 text-body text-success" data-testid="created-note">{sp.photos === "partial" ? t("showroomProducts.createdPartial") : t("showroomProducts.created")}</p> : null}
      {sp.audiences === "missing" ? <p role="alert" className="rounded-sm border border-warning/40 bg-warning/10 px-md py-2 text-body text-warning" data-testid="audiences-missing-note">{t("showroomProducts.audience.saveFailed")}</p> : null}
      {sp.saved === "1" ? <p role="status" className="rounded-sm border border-success/40 bg-success/10 px-md py-2 text-body text-success" data-testid="saved-note">{t("showroomProducts.saved")}</p> : null}

      <div className="grid min-w-0 items-start gap-md desktop:grid-cols-[minmax(0,78fr)_minmax(0,22fr)]">
      {status === "archived" ? (
        <div className="flex min-w-0 flex-col gap-md">
          <p className="rounded-sm border bg-surface px-md py-2 text-body text-fg-secondary" data-testid="archived-note">{t("showroomProducts.errors.archived")}</p>
          {canWrite ? <div id="product-photos" className="scroll-mt-24"><Card>{photoManager}</Card></div> : null}
        </div>
      ) : canWrite ? (
        <ProductForm
          orgId={org.organizationId}
          photos={photoManager}
          product={{
            id: product.id,
            version: product.version,
            name: product.name,
            code: product.sku,
            categoryCode: product.category_code,
            unit: product.unit,
            colors: effectiveColors(product),
            basePrice: price,
            weightKg: product.weight_kg,
            sizeLabel: product.size_label,
            brand: product.brand,
            description: product.short_description,
            audiences,
          }}
        />
      ) : (
        <p className="text-label text-fg-muted">{t("showroomProducts.readOnlyNote")}</p>
      )}

      <aside aria-labelledby="product-status-title" data-testid="product-status-card">
        <Card pad="sm" className="flex flex-col gap-sm bg-accent-solid/5">
          <h2 id="product-status-title" className="text-title text-fg">{t("showroomProducts.statusTitle")}</h2>
          <div><Badge tone={status === "active" ? "success" : status === "inactive" ? "warning" : "neutral"}>{t(`showroomProducts.status.${status}`)}</Badge></div>
          <LifecycleControls productId={product.id} version={product.version} status={status} canWrite={canWrite} canPublish={canPublish} />
        </Card>
      </aside>
      </div>
      {videos && <Card><VideoManager scope="product" productId={product.id} videos={videos} canPublish={false} showList={false} /></Card>}
    </div>
  );
}
