"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/ui/cn";
import { useI18n } from "@/lib/i18n/context";
import { type CatalogView } from "@/lib/ui/catalog-view";
import { Button, Input } from "@/components/ui/controls";
import { SelectMenu } from "@/components/ui/select-menu";
import { StatePanel } from "@/components/ui/primitives";
import { Pager } from "@/components/ui/pager";
import { lessCount } from "@/lib/pagination/batches";
import { IconStat } from "@/components/ui/icon-stat";
import { BookmarkIcon, ClockIcon, SearchIcon, TagIcon, SparklesIcon } from "@/components/ui/icons";
import { CANONICAL_CATEGORY_CODES } from "@/features/commerce/constants";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";
import { ViewToggle } from "@/features/showroom-shell/view-toggle";
import { loadOffersPageAction } from "@/server/actions/offer-feed";
import {
  appendUnique,
  DEFAULT_OFFERS_PARAMS,
  isAudienceCode,
  productsLabel,
  sellerTypeLabel,
  type OfferPeriod,
  type OfferSort,
  type OffersPage,
  type OffersPageParams,
  type PublicOffer,
} from "./offer-model";
import { OfferCollage, OfferPrice, OfferValidity, SellerLine } from "./offer-parts";
import { SaveOfferButton } from "./save-offer-button";

/**
 * The audience Offers feed — ONE implementation for every account shell. The first batch comes
 * from the server already filtered by the database (`offers_feed_page`); search, category, seller
 * type, validity, sort and the saved filter are applied THERE too, and every "Show more" is a real
 * bounded query for the next batch (never "load everything, hide with CSS"). Changing any filter
 * starts over from the first batch. "Show less" folds the list back to the first batch without
 * touching the filters.
 */
export function OffersFeedView({
  initialPage,
  initialImageUrls,
  orgId,
  locale,
  initialView,
  detailBase = `${SHOWROOM_ROOT}/offers`,
}: {
  initialPage: OffersPage;
  initialImageUrls: Record<string, string>;
  /** The active business workspace, or null for a personal account. Verified server-side on every call. */
  orgId: string | null;
  locale: "ar" | "en";
  initialView: CatalogView;
  detailBase?: string;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<CatalogView>(initialView);
  const [params, setParams] = useState<OffersPageParams>(DEFAULT_OFFERS_PARAMS);
  const [items, setItems] = useState<PublicOffer[]>(initialPage.items);
  const [total, setTotal] = useState(initialPage.total);
  const [stats, setStats] = useState(initialPage.stats);
  const [sellerTypes, setSellerTypes] = useState(initialPage.sellerTypes);
  const [imageUrls, setImageUrls] = useState(initialImageUrls);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const firstRun = useRef(true);
  const lastSearch = useRef("");

  const fetchPage = useCallback(
    async (p: OffersPageParams, offset: number, mode: "replace" | "append") => {
      const id = ++request.current;
      setLoading(true);
      setFailed(false);
      const res = await loadOffersPageAction(orgId, p, offset);
      if (id !== request.current) return; // a newer request superseded this one
      setLoading(false);
      if (!res.ok) {
        setFailed(true);
        return;
      }
      setImageUrls((prev) => ({ ...prev, ...res.imageUrls }));
      setItems((prev) => (mode === "replace" ? res.page.items : appendUnique(prev, res.page.items)));
      setTotal(res.page.total);
      setStats(res.page.stats);
      setSellerTypes(res.page.sellerTypes);
    },
    [orgId],
  );

  // A filter/sort/search change starts over from the first batch (debounced only while typing).
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      lastSearch.current = params.search;
      return;
    }
    const typing = params.search !== lastSearch.current;
    lastSearch.current = params.search;
    const timer = setTimeout(() => void fetchPage(params, 0, "replace"), typing ? 300 : 0);
    return () => clearTimeout(timer);
  }, [params, fetchPage]);

  const update = (patch: Partial<OffersPageParams>) => setParams((p) => ({ ...p, ...patch }));
  const filtered = Boolean(params.search || params.category || params.sellerType || params.period !== "all" || params.savedOnly);
  const clear = () => setParams(DEFAULT_OFFERS_PARAMS);

  const showMore = () => void fetchPage(params, items.length, "append");
  const showLess = () => {
    request.current++; // drop any in-flight batch so it cannot re-extend the list
    setLoading(false);
    setItems((prev) => prev.slice(0, lessCount(prev.length)));
    gridRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const markSaved = (id: string, saved: boolean) => setItems((prev) => prev.map((o) => (o.id === id ? { ...o, saved } : o)));

  const chips = [{ value: "", label: t("showroomOffers.feed.chipAll") }, ...CANONICAL_CATEGORY_CODES.map((c) => ({ value: c, label: t(`commerce.canonicalCategories.${c}`) }))];
  const sellerOptions = sellerTypes.filter((v) => isAudienceCode(v));

  return (
    <div className="flex flex-col gap-md" data-testid="offers-feed">
      <ul className="grid grid-cols-1 gap-sm tablet:grid-cols-3 tablet:gap-md" data-testid="offers-stats">
        {[
          { key: "available", label: t("showroomOffers.feed.statAvailable"), value: stats.available, Icon: TagIcon },
          { key: "ending", label: t("showroomOffers.feed.statEnding"), value: stats.ending, Icon: ClockIcon },
          { key: "new", label: t("showroomOffers.feed.statNew"), value: stats.fresh, Icon: SparklesIcon },
        ].map(({ key, label, value, Icon }) => (
          <li key={key} className="rounded-md border bg-surface p-sm shadow-card tablet:p-md" data-testid={`offers-stat-${key}`}>
            <IconStat Icon={Icon} label={label} value={String(value)} />
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-sm" data-testid="offers-toolbar">
        <div className="flex flex-wrap items-stretch gap-sm">
          <label className="relative min-w-0 flex-1 basis-56">
            <span className="sr-only">{t("showroomOffers.feed.searchPlaceholder")}</span>
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-fg-muted">
              <SearchIcon size={16} />
            </span>
            <Input value={params.search} onChange={(e) => update({ search: e.target.value })} placeholder={t("showroomOffers.feed.searchPlaceholder")} className="ps-9" data-testid="offers-search" />
          </label>
          <div className="min-w-0 basis-44">
            <SelectMenu
              value={params.category}
              aria-label={t("showroomOffers.feed.category")}
              onChange={(category) => update({ category })}
              data-testid="offers-category"
              options={[{ value: "", label: t("showroomOffers.feed.allCategories") }, ...CANONICAL_CATEGORY_CODES.map((c) => ({ value: c, label: t(`commerce.canonicalCategories.${c}`) }))]}
            />
          </div>
          <div className="min-w-0 basis-44">
            <SelectMenu
              value={params.sellerType}
              aria-label={t("showroomOffers.feed.sellerType")}
              onChange={(sellerType) => update({ sellerType })}
              data-testid="offers-seller-type"
              options={[{ value: "", label: t("showroomOffers.feed.allSellerTypes") }, ...sellerOptions.map((c) => ({ value: c, label: t(`showroomOffers.audience.${c}`) }))]}
            />
          </div>
          <div className="min-w-0 basis-44">
            <SelectMenu
              value={params.period}
              aria-label={t("showroomOffers.feed.validity")}
              onChange={(v) => update({ period: v as OfferPeriod })}
              data-testid="offers-validity"
              options={[
                { value: "all", label: t("showroomOffers.feed.validityAll") },
                { value: "ending", label: t("showroomOffers.feed.validityEnding") },
                { value: "week", label: t("showroomOffers.feed.validityWeek") },
              ]}
            />
          </div>
          <div className="min-w-0 basis-44">
            <SelectMenu
              value={params.sort}
              aria-label={t("showroomOffers.feed.sort")}
              onChange={(v) => update({ sort: v as OfferSort })}
              data-testid="offers-sort"
              options={[
                { value: "newest", label: t("showroomOffers.feed.sortNewest") },
                { value: "ending", label: t("showroomOffers.feed.sortEnding") },
                { value: "priceLow", label: t("showroomOffers.feed.sortPriceLow") },
                { value: "priceHigh", label: t("showroomOffers.feed.sortPriceHigh") },
              ]}
            />
          </div>
        </div>
        <nav aria-label={t("showroomOffers.feed.category")} className="min-w-0 overflow-x-auto pb-1" data-testid="offers-chips">
          <ul className="flex w-max min-w-full gap-2">
            <li className="shrink-0">
              <button
                type="button"
                aria-pressed={params.savedOnly}
                onClick={() => update({ savedOnly: !params.savedOnly })}
                data-testid="offers-saved-toggle"
                className={cn(
                  "inline-flex min-h-9 items-center gap-1.5 rounded-sm border px-3 text-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                  params.savedOnly ? "border-accent-edge bg-accent-solid text-on-accent" : "border-strong bg-surface text-fg-secondary hover:bg-surface-2",
                )}
              >
                <BookmarkIcon size={14} />
                {t("showroomOffers.feed.savedOnly")}
              </button>
            </li>
            {chips.map((chip) => (
              <li key={chip.value || "all"} className="shrink-0">
                <button
                  type="button"
                  aria-pressed={chip.value === params.category}
                  onClick={() => update({ category: chip.value })}
                  className={cn(
                    "inline-flex min-h-9 items-center rounded-sm border px-3 text-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                    chip.value === params.category ? "border-accent-edge bg-accent-solid text-on-accent" : "border-strong bg-surface text-fg-secondary hover:bg-surface-2",
                  )}
                >
                  {chip.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="flex items-center justify-between gap-sm">
        <p className="text-title font-semibold text-fg" data-testid="offers-count" dir="auto">{t("showroomOffers.feed.count", { count: String(total) })}</p>
        <ViewToggle view={view} onChange={setView} testIdPrefix="offers" />
      </div>

      <div ref={gridRef} aria-busy={loading} className="scroll-mt-24">
        {items.length === 0 && !loading ? (
          <StatePanel
            icon={<TagIcon size={22} />}
            title={filtered ? t("showroomOffers.feed.noResultsTitle") : t("showroomOffers.feed.emptyTitle")}
            body={filtered ? t("showroomOffers.feed.noResultsBody") : t("showroomOffers.feed.emptyBody")}
            action={filtered ? <Button type="button" variant="ghost" onClick={clear}>{t("showroomOffers.feed.clearFilters")}</Button> : undefined}
          />
        ) : view === "grid" ? (
          <ul className={cn("grid grid-cols-1 gap-sm min-[560px]:grid-cols-2 tablet:grid-cols-3 tablet:gap-md desktop:grid-cols-4 wide:grid-cols-5", loading && "opacity-70")} data-testid="offers-grid">
            {items.map((o) => (
              <li key={o.id} className="min-w-0">
                <OfferCard offer={o} imageUrls={imageUrls} locale={locale} detailBase={detailBase} orgId={orgId} onSaved={markSaved} />
              </li>
            ))}
          </ul>
        ) : (
          <ul className={cn("flex flex-col gap-sm", loading && "opacity-70")} data-testid="offers-list">
            {items.map((o) => (
              <li key={o.id} className="min-w-0">
                <OfferRow offer={o} imageUrls={imageUrls} locale={locale} detailBase={detailBase} orgId={orgId} onSaved={markSaved} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {failed ? <p role="alert" className="text-center text-label text-danger" data-testid="offers-load-error">{t("showroomOffers.feed.loadError")}</p> : null}

      <Pager shown={items.length} total={total} loading={loading} onMore={showMore} onLess={showLess} testId="offers" />
    </div>
  );
}

const offerImages = (offer: PublicOffer, imageUrls: Record<string, string>): string[] =>
  offer.items
    .map((i) => (i.imageKey ? imageUrls[i.imageKey] : undefined) ?? i.imageRef ?? null)
    .filter((u): u is string => Boolean(u))
    .slice(0, 3);

type CardProps = {
  offer: PublicOffer;
  imageUrls: Record<string, string>;
  locale: "ar" | "en";
  detailBase: string;
  orgId: string | null;
  onSaved: (id: string, saved: boolean) => void;
};

function OfferCard({ offer, imageUrls, locale, detailBase, orgId, onSaved }: CardProps) {
  const { t } = useI18n();
  const lines = offer.items.slice(0, 2);
  const more = offer.items.length - lines.length;
  return (
    <article className="flex h-full flex-col gap-2 rounded-md border bg-surface p-2.5 shadow-card transition-colors hover:border-strong" data-testid="offer-card">
      <SellerLine compact name={offer.seller.name} verified={offer.seller.verified} typeLabel={sellerTypeLabel(t, offer.seller.orgType)} />
      <Link href={`${detailBase}/${offer.id}`} aria-label={offer.title} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
        <OfferCollage images={offerImages(offer, imageUrls)} count={offer.items.length} alt={offer.title} aspect="aspect-[4/3]" />
      </Link>
      <h3 className="line-clamp-2 min-h-[2.5rem] text-label font-semibold leading-snug text-fg" dir="auto">{offer.title}</h3>
      <ul className="flex min-h-[3.25rem] flex-col gap-0.5 text-label text-fg-secondary" data-testid="offer-lines">
        {lines.map((i) => (
          <li key={i.productId} className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-solid ring-1 ring-accent-edge" />
            <span className="shrink-0" dir="ltr">{t("showroomOffers.quantityTimes", { count: String(i.quantity) })}</span>
            <span className="truncate" dir="auto">{i.name}</span>
          </li>
        ))}
        {more > 0 ? <li className="text-accent" data-testid="offer-more">{t("showroomOffers.moreProducts", { count: String(more) })}</li> : null}
      </ul>
      <div className="mt-auto flex flex-col gap-2 border-t pt-2">
        <OfferPrice size="sm" reserveReference total={offer.totalPrice} reference={offer.referencePrice} />
        <OfferValidity compact endsAt={offer.endsAt} locale={locale} />
        <div className="flex items-center gap-2">
          <SaveOfferButton offerId={offer.id} orgId={orgId} saved={offer.saved} onChange={(s) => onSaved(offer.id, s)} className="h-10 w-10" />
          <Link
            href={`${detailBase}/${offer.id}`}
            className="inline-flex min-h-10 min-w-0 flex-1 items-center justify-center rounded-sm bg-accent-solid ring-1 ring-accent-edge px-2 text-label font-semibold text-on-accent hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            data-testid="offer-view-details"
          >
            {t("showroomOffers.viewDetails")}
          </Link>
        </div>
      </div>
    </article>
  );
}

function OfferRow({ offer, imageUrls, locale, detailBase, orgId, onSaved }: CardProps) {
  const { t } = useI18n();
  return (
    <article className="flex flex-wrap items-center gap-x-md gap-y-2 rounded-md border bg-surface p-sm tablet:flex-nowrap" data-testid="offer-row">
      <div className="w-28 shrink-0 tablet:w-40">
        <OfferCollage images={offerImages(offer, imageUrls)} count={offer.items.length} alt={offer.title} aspect="aspect-[4/3]" />
      </div>
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
        <SellerLine name={offer.seller.name} verified={offer.seller.verified} typeLabel={sellerTypeLabel(t, offer.seller.orgType)} />
        <h3 className="line-clamp-2 text-body font-semibold text-fg" dir="auto">{offer.title}</h3>
        <p className="truncate text-label text-fg-muted">{productsLabel(t, offer.items.length)} • {offer.items.slice(0, 2).map((i) => i.name).join("، ")}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-1 tablet:w-56">
        <OfferPrice total={offer.totalPrice} reference={offer.referencePrice} />
        <OfferValidity endsAt={offer.endsAt} locale={locale} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <SaveOfferButton offerId={offer.id} orgId={orgId} saved={offer.saved} onChange={(s) => onSaved(offer.id, s)} className="h-10 w-10" />
        <Link href={`${detailBase}/${offer.id}`} className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-sm bg-accent-solid ring-1 ring-accent-edge px-md text-label font-semibold text-on-accent hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          {t("showroomOffers.viewDetails")}
        </Link>
      </div>
    </article>
  );
}
