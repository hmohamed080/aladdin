import Link from "next/link";
import type { ReactNode } from "react";
import { Card, Field, Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/controls";
import { BadgeCheckIcon } from "@/components/ui/icons";
import { ProductMedia } from "@/features/commerce/product-media";
import type { CatalogRow } from "@/server/queries/commerce";
import { effectiveColors } from "@/features/showroom-shell/products/color-items";
import { Swatch } from "@/features/showroom-shell/products/color-swatches";
import type { getMessages } from "@/lib/i18n/translate";
import type { VideoPlayback } from "@/server/video/playback";
import { VideoPlayer } from "@/features/video/video-player";

/** One item of the product gallery, in the publisher's order (photos and videos share slots). */
export type GalleryEntry = { kind: "image"; url: string } | { kind: "video"; video: VideoPlayback };

type Messages = ReturnType<typeof getMessages>;

/**
 * The published-product detail card, shared by the production catalog route and
 * the showroom suite's adapter route so the two can never drift. It is pure
 * presentation: the product comes from `getCatalogProduct` (RLS-scoped published
 * view) and each route decides the back link, the quote link and the permission
 * flags around it.
 */
export function CatalogProductDetail({
  product,
  m,
  isOwnOrg,
  canRfq,
  rfqHref,
  back,
  extra,
  imageUrls = [],
  media,
}: {
  /** Signed URLs of the product's uploaded photos, main first. Empty -> the legacy `image_ref`. */
  imageUrls?: string[];
  /** The whole gallery in order, videos included. Takes precedence over `imageUrls`. */
  media?: GalleryEntry[];
  product: CatalogRow & {
    id: string;
    category: NonNullable<CatalogRow["category"]>;
    unit: NonNullable<CatalogRow["unit"]>;
    organization_id: string | null;
  };
  m: Messages;
  isOwnOrg: boolean;
  canRfq: boolean;
  rfqHref: string;
  /** The route's own back link, rendered above the card. */
  back: ReactNode;
  /** Optional route-specific controls shown beside the quote action. */
  extra?: ReactNode;
}) {
  // A canonical category wins; a historical product shows its legacy broad category (never a guessed canonical one).
  const categoryLabel =
    product.category_code && product.category_code in m.commerce.canonicalCategories
      ? m.commerce.canonicalCategories[product.category_code as keyof typeof m.commerce.canonicalCategories]
      : m.commerce.categories[product.category];
  // Public attributes only. The owner's regular price is private and never part of this read model.
  const colors = effectiveColors(product);
  const f = m.showroomProducts.fields;
  return (
    <div className="mx-auto max-w-3xl pb-16 tablet:pb-0">
      {back}

      <Card>
        {/* The material itself, at the size a buyer can actually judge it — the
            card grid's thumbnail is for scanning, this is for deciding. */}
        <div className="grid gap-md tablet:grid-cols-[minmax(0,15rem)_1fr] tablet:items-start">
          <div className="flex min-w-0 flex-col gap-2">
            {(() => {
              const entries: GalleryEntry[] = media ?? imageUrls.map((url) => ({ kind: "image" as const, url }));
              const [first, ...rest] = entries;
              const show = (entry: GalleryEntry | undefined, aspect: string) => {
                if (entry?.kind === "video") {
                  const v = entry.video;
                  return (
                    <div className={`relative w-full overflow-hidden rounded-md bg-black ${aspect}`} data-testid="product-detail-video">
                      <VideoPlayer fill source={v} title={v.title} width={v.width} height={v.height}
                        labels={{ play: m.video.play.replace("{title}", v.title), unavailable: m.video.unavailable }} />
                    </div>
                  );
                }
                return <ProductMedia src={entry?.url ?? product.image_ref} alt={product.name ?? ""} aspect={aspect === "aspect-square" ? "aspect-square" : undefined} />;
              };
              return (
                <>
                  {show(first, "aspect-[4/3]")}
                  {rest.length > 0 ? (
                    <ul className="grid grid-cols-3 gap-2" data-testid="product-detail-thumbnails">
                      {rest.map((entry) => (
                        <li key={entry.kind === "video" ? `video-${entry.video.id}` : entry.url}>{show(entry, "aspect-square")}</li>
                      ))}
                    </ul>
                  ) : null}
                </>
              );
            })()}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-headline text-fg">{product.name}</h1>
              <Badge tone="neutral">{categoryLabel}</Badge>
            </div>
            {product.brand ? <p className="mt-1 text-body text-fg-secondary">{product.brand}</p> : null}
          </div>
        </div>

        {product.short_description ? (
          <p className="mt-md whitespace-pre-wrap text-body-lg text-fg-secondary">{product.short_description}</p>
        ) : null}

        <dl className="mt-md grid grid-cols-2 gap-md border-t pt-md tablet:grid-cols-3">
          <Field label={m.commerce.fields.unit}>{m.commerce.units[product.unit]}</Field>
          <Field label={m.commerce.fields.sku}>{product.sku ?? "—"}</Field>
          <Field label={m.commerce.catalog.supplier}>
            <span className="inline-flex items-center gap-1">
              {product.supplier_name}
              {product.supplier_verified ? (
                <span className="text-success" title={m.commerce.catalog.verifiedSupplier}>
                  <BadgeCheckIcon size={13} />
                </span>
              ) : null}
            </span>
          </Field>
          {product.size_label ? <Field label={f.size}><span dir="auto">{product.size_label}</span></Field> : null}
          {product.weight_kg !== null && product.weight_kg !== undefined ? (
            <Field label={f.weight}><span dir="ltr">{Number(product.weight_kg)}</span></Field>
          ) : null}
          {colors.length > 0 ? (
            <div className="col-span-2 tablet:col-span-3">
              <Field label={f.colors}>
                <ul className="flex flex-wrap gap-1.5" data-testid="product-detail-colors">
                  {colors.map((c) => (
                    <li key={c.name} className="inline-flex items-center gap-1.5 text-body text-fg-secondary">
                      <Swatch color={c} size="sm" />
                      <span dir="auto">{c.name}</span>
                    </li>
                  ))}
                </ul>
              </Field>
            </div>
          ) : null}
        </dl>

        <div className="mt-lg flex flex-wrap items-center gap-sm border-t pt-md">
          {isOwnOrg ? (
            <p className="text-body text-fg-secondary">{m.commerce.catalog.ownProductNote}</p>
          ) : !product.organization_id ? (
            // An independent professional seller cannot be requested yet (M4b).
            <p className="text-body text-fg-muted" data-testid="independent-no-request">{m.independentPublishing.noRequestYet}</p>
          ) : canRfq ? (
            <Link href={rfqHref}>
              <Button variant="accent">{m.commerce.catalog.requestQuote}</Button>
            </Link>
          ) : (
            <p className="text-body text-fg-muted">{m.commerce.catalog.rfqDenied}</p>
          )}
          {extra}
        </div>
      </Card>
    </div>
  );
}
