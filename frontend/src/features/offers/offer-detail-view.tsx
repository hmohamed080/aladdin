import Link from "next/link";
import { ProductMedia } from "@/features/commerce/product-media";
import { Card } from "@/components/ui/primitives";
import { CalendarIcon, ClockIcon, PackageIcon, TagIcon } from "@/components/ui/icons";
import { SwatchRow } from "@/features/showroom-shell/products/color-swatches";
import { productMetaLine } from "@/features/showroom-shell/products/labels";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";
import { daysLeft, sellerTypeLabel, type PublicOffer, productsLabel } from "./offer-model";
import { formatOfferDate } from "./offer-datetime";
import { OfferPrice, SellerLine } from "./offer-parts";
import { OfferCollage } from "./offer-parts";
import { SaveOfferButton } from "./save-offer-button";

type T = (key: string, vars?: Record<string, string | number>) => string;

const imageOf = (item: PublicOffer["items"][number], urls: Record<string, string>) => (item.imageKey ? urls[item.imageKey] : undefined) ?? item.imageRef ?? null;

/**
 * Offer detail — account-agnostic and price-safe. It renders only the audience projection (the
 * package price, the optional offer-level "price before", products, quantities, public
 * attributes, validity, seller identity). The owner's base prices are not part of that data.
 */
export function OfferDetailView({
  offer,
  imageUrls,
  related,
  locale,
  t,
  canRfq,
  rfqHref,
  orgId,
  showRfq = true,
  backHref = `${SHOWROOM_ROOT}/offers`,
  feedHref = `${SHOWROOM_ROOT}/offers`,
  detailBase = feedHref,
}: {
  offer: PublicOffer;
  imageUrls: Record<string, string>;
  related: PublicOffer[];
  locale: "ar" | "en";
  t: T;
  canRfq: boolean;
  rfqHref: string;
  /** The active business workspace, or null for a personal account (used by the bookmark). */
  orgId: string | null;
  /** Personal accounts have no RFQ entry yet; the block is hidden for them. */
  showRfq?: boolean;
  backHref?: string;
  feedHref?: string;
  /** Where "more offers" links point (each shell has its own Offers route). */
  detailBase?: string;
}) {
  const images = offer.items.map((i) => imageOf(i, imageUrls)).filter((u): u is string => Boolean(u));
  const main = images[0] ?? null;
  const thumbs = images.slice(1, 4);
  const left = daysLeft(offer.endsAt);
  // An independent professional seller cannot be requested yet (M4b): no request action, an honest note instead.
  const independentSeller = (offer.seller.orgType ?? "").startsWith("independent_");
  const rfqAllowed = showRfq && !independentSeller;

  return (
    <div className="flex flex-col gap-md" data-testid="offer-detail">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <Link href={backHref} className="inline-flex w-fit items-center gap-1 rounded-sm border border-strong px-2.5 py-1 text-label text-fg-secondary hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          <span aria-hidden="true" className="rtl:rotate-180">←</span>
          {t("showroomOffers.detail.back")}
        </Link>
        <p className="text-label text-fg-muted">
          <Link href={feedHref} className="hover:underline">{t("showroomOffers.feed.title")}</Link>
          <span aria-hidden="true"> ← </span>
          <span className="text-fg-secondary">{t("showroomOffers.detail.breadcrumb")}</span>
        </p>
      </div>

      <div className="grid min-w-0 items-start gap-md desktop:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-md">
          <Card className="flex flex-col gap-md">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-sm border border-success/60 bg-surface px-2.5 py-1 text-label font-semibold text-success">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />
                {t("showroomOffers.detail.activeBadge")}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-sm border border-strong bg-surface px-2.5 py-1 text-label font-medium text-fg-secondary">
                <TagIcon size={13} />
                {t("showroomOffers.detail.typeBadge")}
              </span>
            </div>
            <div className="flex flex-wrap items-start justify-between gap-md">
              <div className="min-w-0 flex-1 basis-72">
                <h1 className="text-headline font-bold text-fg" dir="auto" data-testid="offer-title">{offer.title}</h1>
                {offer.description ? <p className="mt-1 whitespace-pre-wrap text-body text-fg-secondary" dir="auto">{offer.description}</p> : null}
              </div>
              <SellerLine name={offer.seller.name} verified={offer.seller.verified} typeLabel={sellerTypeLabel(t, offer.seller.orgType)} />
            </div>

            <div className="grid gap-2 tablet:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]" data-testid="offer-gallery" aria-label={t("showroomOffers.detail.galleryAlt")}>
              <div className="relative">
                <ProductMedia src={main} alt={offer.title} aspect="aspect-[16/9]" />
                <span className="absolute bottom-2 end-2 inline-flex items-center gap-1 rounded-sm border border-strong bg-surface px-2 py-0.5 text-label font-medium text-fg shadow-sm">
                  <PackageIcon size={12} />
                  {productsLabel(t, offer.items.length)}
                </span>
              </div>
              {thumbs.length > 0 ? (
                <ul className="grid grid-cols-3 gap-2 tablet:grid-cols-1 tablet:grid-rows-3">
                  {thumbs.map((src, i) => (
                    <li key={i} className="min-w-0">
                      <ProductMedia src={src} alt="" aspect="aspect-[16/10]" />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Card>

          <Card className="flex flex-col gap-sm">
            <h2 className="flex items-center gap-2 text-title font-semibold text-fg">
              <PackageIcon size={18} className="text-accent" />
              {t("showroomOffers.detail.contents")}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-start text-body" data-testid="offer-contents">
                <thead>
                  <tr className="border-b text-label text-fg-muted">
                    {["product", "code", "category", "specs", "colors", "quantity"].map((k) => (
                      <th key={k} scope="col" className="px-2 py-2 text-start font-medium">{t(`showroomOffers.detail.${k}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {offer.items.map((i) => (
                    <tr key={i.productId} className="border-b last:border-b-0" data-testid="offer-content-row">
                      <td className="px-2 py-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="w-12 shrink-0"><ProductMedia src={imageOf(i, imageUrls)} alt={i.name} aspect="aspect-square" /></span>
                          <span className="min-w-0 font-medium text-fg" dir="auto">{i.name}</span>
                        </span>
                      </td>
                      <td className="px-2 py-2 text-fg-secondary" dir="ltr">{i.code ?? "—"}</td>
                      <td className="px-2 py-2 text-fg-secondary">{i.categoryCode ? t(`commerce.canonicalCategories.${i.categoryCode}`) : "—"}</td>
                      <td className="px-2 py-2 text-label text-fg-secondary" dir="auto">{productMetaLine(t, { unit: i.unit, sizeLabel: i.sizeLabel, weightKg: i.weightKg }) || "—"}</td>
                      <td className="px-2 py-2">{i.colors.length > 0 ? <SwatchRow colors={i.colors} max={4} /> : "—"}</td>
                      <td className="px-2 py-2 font-semibold text-fg" dir="ltr" data-testid="offer-content-quantity">{t("showroomOffers.quantityTimes", { count: String(i.quantity) })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {related.length > 0 ? (
            <Card className="flex flex-col gap-sm">
              <h2 className="flex items-center gap-2 text-title font-semibold text-fg">
                <TagIcon size={18} className="text-accent" />
                {t("showroomOffers.detail.moreOffers")}
              </h2>
              <ul className="grid gap-sm tablet:grid-cols-3" data-testid="offer-related">
                {related.slice(0, 3).map((o) => (
                  <li key={o.id} className="min-w-0 rounded-sm border bg-surface p-2">
                    <Link href={`${detailBase}/${o.id}`} className="flex flex-col gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                      <OfferCollage images={o.items.map((i) => imageOf(i, imageUrls)).filter((u): u is string => Boolean(u)).slice(0, 3)} count={o.items.length} alt={o.title} aspect="aspect-[16/9]" />
                      <span className="line-clamp-1 text-body font-semibold text-fg" dir="auto">{o.title}</span>
                      <span className="truncate text-label text-fg-muted" dir="auto">{o.seller.name}</span>
                      <OfferPrice total={o.totalPrice} reference={null} />
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href={feedHref} className="inline-flex min-h-10 items-center justify-center rounded-sm border border-strong text-label font-medium text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                {t("showroomOffers.detail.showMore")}
              </Link>
            </Card>
          ) : null}
        </div>

        <aside className="flex min-w-0 flex-col gap-md">
          <Card className="flex flex-col gap-sm bg-accent-solid/5">
            <OfferPrice total={offer.totalPrice} reference={offer.referencePrice} size="lg" />
          </Card>

          <Card className="flex flex-col gap-sm">
            <h2 className="flex items-center gap-2 text-title font-semibold text-fg">
              <CalendarIcon size={18} className="text-accent" />
              {t("showroomOffers.detail.duration")}
            </h2>
            <dl className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-sm border bg-surface-2 p-2">
                <dt className="text-label text-fg-muted">{t("showroomOffers.detail.from")}</dt>
                <dd className="text-body font-semibold text-fg" data-testid="offer-starts">{formatOfferDate(offer.startsAt, locale)}</dd>
              </div>
              <div className="rounded-sm border bg-surface-2 p-2">
                <dt className="text-label text-fg-muted">{t("showroomOffers.detail.to")}</dt>
                <dd className="text-body font-semibold text-fg" data-testid="offer-ends">{formatOfferDate(offer.endsAt, locale)}</dd>
              </div>
            </dl>
            {left > 0 ? (
              <p className="flex items-center justify-center gap-1.5 rounded-sm bg-accent-solid/10 p-2 text-body font-semibold text-accent" data-testid="offer-remaining">
                <ClockIcon size={16} />
                {left === 1 ? t("showroomOffers.dayLeft") : t("showroomOffers.daysLeft", { count: String(left) })}
              </p>
            ) : null}
          </Card>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <SaveOfferButton offerId={offer.id} orgId={orgId} saved={offer.saved} className="h-11 w-11" />
              {rfqAllowed && canRfq ? (
                <Link
                  href={rfqHref}
                  className="inline-flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-sm bg-accent-solid ring-1 ring-accent-edge px-md text-label font-semibold text-on-accent hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                  data-testid="offer-request-quote"
                >
                  {t("showroomOffers.detail.requestQuote")}
                </Link>
              ) : null}
            </div>
            {showRfq && independentSeller ? <p className="text-label text-fg-muted" data-testid="independent-no-request">{t("independentPublishing.noRequestYet")}</p> : null}
            {rfqAllowed && !canRfq ? <p className="text-label text-fg-muted">{t("showroomOffers.detail.rfqDenied")}</p> : null}
            {rfqAllowed && canRfq ? <p className="text-label text-fg-muted">{t("showroomOffers.detail.requestQuoteHint")}</p> : null}
          </div>

          <Card className="flex flex-col gap-sm">
            <h2 className="text-title font-semibold text-fg">{t("showroomOffers.detail.termsTitle")}</h2>
            <ul className="flex flex-col gap-1.5 text-label text-fg-secondary">
              {["terms1", "terms2", "terms3", "terms4"].map((k) => (
                <li key={k} className="flex items-start gap-2">
                  <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-solid ring-1 ring-accent-edge" />
                  {t(`showroomOffers.detail.${k}`)}
                </li>
              ))}
            </ul>
          </Card>

          <Card className="flex flex-col gap-sm">
            <h2 className="text-title font-semibold text-fg">{t("showroomOffers.detail.sellerCard")}</h2>
            <SellerLine name={offer.seller.name} verified={offer.seller.verified} typeLabel={sellerTypeLabel(t, offer.seller.orgType)} />
          </Card>
        </aside>
      </div>
    </div>
  );
}
