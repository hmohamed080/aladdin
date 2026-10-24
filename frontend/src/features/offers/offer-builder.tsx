"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { useI18n } from "@/lib/i18n/context";
import { Button, Input, LabeledField, SubmitButton } from "@/components/ui/controls";
import { CalendarIcon, CheckIcon, FileTextIcon, PackageIcon, PlusIcon, SearchIcon, SendIcon, TagIcon, TrashIcon, UsersIcon, XIcon, LightbulbIcon, ClockIcon } from "@/components/ui/icons";
import { ProductMedia } from "@/features/commerce/product-media";
import { SwatchRow } from "@/features/showroom-shell/products/color-swatches";
import { productMetaLine } from "@/features/showroom-shell/products/labels";
import { Money } from "@/components/ui/money";
import { PriceInput } from "@/components/ui/price-input";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";
import { saveOfferAction, type OfferFormState } from "@/server/actions/offers";
import type { PickerProduct } from "@/server/queries/offers";
import { CountedTextarea } from "@/components/ui/counted-textarea";
import { countChars } from "@/lib/text/count-chars";
import { OFFER_LIMITS } from "./offer-input";
import { OFFER_AUDIENCE_GROUPS, audienceCodesForGroups, groupsForAudienceCodes, totalQuantity } from "./offer-model";
import { OfferCollage } from "./offer-parts";

export type BuilderInitial = {
  offerId: string | null;
  version: number | null;
  title: string;
  description: string;
  totalPrice: string;
  referencePrice: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  items: Array<{ productId: string; quantity: number }>;
  audiences: string[];
};

const initialState: OfferFormState = { ok: false };

function Section({ icon, title, hint, children, testId }: { icon: ReactNode; title: string; hint?: string; children: ReactNode; testId?: string }) {
  return (
    <section className="flex min-w-0 flex-col gap-md rounded-md border bg-surface p-md shadow-card tablet:p-lg" data-testid={testId}>
      <header className="flex flex-col gap-0.5">
        <h2 className="flex items-center gap-2 text-title font-semibold text-fg">
          <span className="text-accent">{icon}</span>
          {title}
        </h2>
        {hint ? <p className="text-label text-fg-muted">{hint}</p> : null}
      </header>
      {children}
    </section>
  );
}

function Counter({ value, max }: { value: number; max: number }) {
  return <span className="text-caption text-fg-muted" dir="ltr">{value}/{max}</span>;
}

/**
 * Desktop: the builder fills the viewport below the page header (no page scroll), the live
 * preview stays in view on one side and the editor scrolls inside its own column. The height is
 * measured from where the workspace starts, so it follows the real header/hero size. Below the
 * desktop breakpoint everything stacks and the page scrolls normally.
 */
function useFitViewport(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const fit = () => {
      if (!mq.matches) {
        el.style.height = "";
        return;
      }
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.height = `${Math.max(520, Math.floor(window.innerHeight - top - 84))}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    mq.addEventListener("change", fit);
    return () => {
      window.removeEventListener("resize", fit);
      mq.removeEventListener("change", fit);
    };
  }, [ref]);
}

/**
 * Create / edit one offer. The same component serves both: `initial` carries the stored values on
 * edit. The package price is ONE number for the whole package; each product carries only a
 * quantity. The selected-products list scrolls INSIDE its own region, so adding many products never
 * stretches the form. Everything is validated again by the server action and the database.
 */
export function OfferBuilder({
  orgId,
  zone,
  products,
  initial,
  readOnly,
  errorKey,
  canPublish,
  header,
}: {
  orgId: string;
  zone: string;
  products: PickerProduct[];
  initial: BuilderInitial;
  /** True when the offer's state does not allow editing (or the caller cannot write). */
  readOnly: boolean;
  errorKey?: string | null;
  canPublish: boolean;
  /** The page header. It lives at the top of the scrolling editor so the workspace can start right under the top bar. */
  header?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const [state, dispatch] = useActionState(saveOfferAction, initialState);
  const fe = state.fieldErrors ?? {};
  const editing = initial.offerId !== null;

  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [totalPrice, setTotalPrice] = useState(initial.totalPrice);
  const [referencePrice, setReferencePrice] = useState(initial.referencePrice);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [startTime, setStartTime] = useState(initial.startTime);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [endTime, setEndTime] = useState(initial.endTime);
  const [items, setItems] = useState(initial.items);
  const [groups, setGroups] = useState<string[]>(() => groupsForAudienceCodes(initial.audiences));
  const workspaceRef = useRef<HTMLDivElement>(null);
  useFitViewport(workspaceRef);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const selectedIds = useMemo(() => new Set(items.map((i) => i.productId)), [items]);
  const selected = items.flatMap((i) => {
    const p = byId.get(i.productId);
    return p ? [{ product: p, quantity: i.quantity }] : [];
  });
  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    return products.filter((p) => !term || `${p.name} ${p.code ?? ""}`.toLowerCase().includes(term));
  }, [products, query]);

  const toggleProduct = (id: string) =>
    setItems((cur) => (cur.some((i) => i.productId === id) ? cur.filter((i) => i.productId !== id) : cur.length >= OFFER_LIMITS.items ? cur : [...cur, { productId: id, quantity: 1 }]));
  const setQuantity = (id: string, q: number) =>
    setItems((cur) => cur.map((i) => (i.productId === id ? { ...i, quantity: Math.min(OFFER_LIMITS.quantityMax, Math.max(1, Math.trunc(q) || 1)) } : i)));
  const toggleGroup = (id: string) => setGroups((cur) => (cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id]));
  const audienceCodes = audienceCodesForGroups(groups);
  const overLimit = countChars(description) > OFFER_LIMITS.descriptionMax;

  const cur = t("showroomOffers.builder.currency");
  const priceNum = Number(totalPrice.replace(/,/g, "."));
  const refNum = Number(referencePrice.replace(/,/g, "."));
  const previewImages = selected.map((s) => s.product.imageUrl).filter((u): u is string => Boolean(u)).slice(0, 3);
  const errorText = (key?: string) => (key ? t(key) : undefined);
  const banner = state.code && !state.ok ? t(state.code) : errorKey ? t(errorKey) : null;
  const dis = readOnly;

  return (
    <form action={dispatch} noValidate data-testid="offer-builder">
    <div ref={workspaceRef} className="relative grid min-w-0 gap-md desktop:grid-cols-[minmax(0,1fr)_21rem] desktop:overflow-hidden" data-testid="offer-workspace">
      <input type="hidden" name="orgId" value={orgId} />
      {initial.offerId ? <input type="hidden" name="offerId" value={initial.offerId} /> : null}
      {initial.version !== null ? <input type="hidden" name="expectedVersion" value={initial.version} /> : null}
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      {audienceCodes.map((a) => <input key={a} type="hidden" name="audience" value={a} />)}

      <div className="flex min-w-0 flex-col gap-md desktop:min-h-0 desktop:overflow-y-auto desktop:overscroll-contain desktop:pe-1" data-testid="offer-editor-scroll">
        {header ? <div className="shrink-0">{header}</div> : null}
        {banner ? <p role="alert" className="rounded-sm border border-danger/40 bg-danger/10 px-md py-2 text-body text-danger" data-testid="offer-error">{banner}</p> : null}
        {readOnly ? <p className="rounded-sm border bg-surface px-md py-2 text-body text-fg-secondary" data-testid="offer-readonly">{t("showroomOffers.builder.notEditable")}</p> : null}

        <Section icon={<FileTextIcon size={18} />} title={t("showroomOffers.builder.dataTitle")} testId="offer-data">
          <LabeledField label={t("showroomOffers.builder.name")} htmlFor="title" error={errorText(fe.title)}>
            <div className="flex flex-col gap-1">
              <Input id="title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={OFFER_LIMITS.titleMax} placeholder={t("showroomOffers.builder.namePlaceholder")} disabled={dis} aria-invalid={fe.title ? true : undefined} dir="auto" data-testid="offer-title-input" />
              <Counter value={title.length} max={OFFER_LIMITS.titleMax} />
            </div>
          </LabeledField>
          <LabeledField label={t("showroomOffers.builder.description")} htmlFor="description" optional={t("showroomOffers.builder.optional")} error={overLimit ? t("showroomOffers.errors.description") : errorText(fe.description)}>
            <CountedTextarea
              id="description"
              name="description"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              max={OFFER_LIMITS.descriptionMax}
              unitLabel={t("showroomOffers.builder.descriptionChars")}
              counterTestId="offer-description-counter"
              placeholder={t("showroomOffers.builder.descriptionPlaceholder")}
              disabled={dis}
              dir="auto"
              aria-invalid={fe.description ? true : undefined}
              data-testid="offer-description-input"
            />
          </LabeledField>
          <div className="grid gap-md tablet:grid-cols-2">
            <LabeledField label={t("showroomOffers.builder.offerPrice")} htmlFor="totalPrice" hint={t("showroomOffers.builder.offerPriceHint")} error={errorText(fe.totalPrice)}>
              <PriceInput id="totalPrice" name="totalPrice" currency={cur} value={totalPrice} onChange={setTotalPrice} disabled={dis} invalid={Boolean(fe.totalPrice)} testId="offer-price-input" />
            </LabeledField>
            <LabeledField label={t("showroomOffers.builder.priceBefore")} htmlFor="referencePrice" optional={t("showroomOffers.builder.optional")} hint={t("showroomOffers.builder.priceBeforeHint")} error={errorText(fe.referencePrice)}>
              <PriceInput id="referencePrice" name="referencePrice" currency={cur} value={referencePrice} onChange={setReferencePrice} disabled={dis} invalid={Boolean(fe.referencePrice)} testId="offer-reference-input" />
            </LabeledField>
          </div>
        </Section>

        <Section icon={<CalendarIcon size={18} />} title={t("showroomOffers.builder.durationTitle")} hint={t("showroomOffers.builder.timezoneNote", { zone })} testId="offer-duration">
          <div className="grid gap-md tablet:grid-cols-2">
            <fieldset className="grid min-w-0 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-sm" disabled={dis}>
              <legend className="mb-1 text-label font-medium text-fg-secondary">{t("showroomOffers.builder.startsAt")}</legend>
              <Input type="date" name="startDate" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-label={t("showroomOffers.builder.startDate")} dir="ltr" aria-invalid={fe.dates ? true : undefined} data-testid="offer-start-date" />
              <Input type="time" name="startTime" value={startTime} onChange={(e) => setStartTime(e.target.value)} aria-label={t("showroomOffers.builder.startTime")} dir="ltr" aria-invalid={fe.dates ? true : undefined} data-testid="offer-start-time" />
            </fieldset>
            <fieldset className="grid min-w-0 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-sm" disabled={dis}>
              <legend className="mb-1 text-label font-medium text-fg-secondary">{t("showroomOffers.builder.endsAt")}</legend>
              <Input type="date" name="endDate" value={endDate} onChange={(e) => setEndDate(e.target.value)} aria-label={t("showroomOffers.builder.endDate")} dir="ltr" aria-invalid={fe.dates ? true : undefined} data-testid="offer-end-date" />
              <Input type="time" name="endTime" value={endTime} onChange={(e) => setEndTime(e.target.value)} aria-label={t("showroomOffers.builder.endTime")} dir="ltr" aria-invalid={fe.dates ? true : undefined} data-testid="offer-end-time" />
            </fieldset>
          </div>
          {fe.dates ? <p role="alert" className="text-label text-danger">{t(fe.dates)}</p> : null}
        </Section>

        <Section icon={<PackageIcon size={18} />} title={t("showroomOffers.builder.productsTitle")} hint={t("showroomOffers.builder.productsHint")} testId="offer-products">
          {!dis ? (
            <div className="flex flex-wrap items-stretch gap-sm">
              <Button type="button" variant="outline" onClick={() => setPickerOpen((o) => !o)} aria-expanded={pickerOpen} className="shrink-0" data-testid="offer-add-products">
                {pickerOpen ? <XIcon size={16} /> : <PlusIcon size={16} />}
                {pickerOpen ? t("showroomOffers.builder.closePicker") : t("showroomOffers.builder.addProducts")}
              </Button>
              <label className="relative min-w-0 flex-1 basis-56">
                <span className="sr-only">{t("showroomOffers.builder.pickerSearch")}</span>
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-fg-muted"><SearchIcon size={16} /></span>
                <Input value={query} onChange={(e) => { setQuery(e.target.value); setPickerOpen(true); }} onFocus={() => setPickerOpen(true)} placeholder={t("showroomOffers.builder.pickerSearch")} className="ps-9" data-testid="offer-picker-search" />
              </label>
            </div>
          ) : null}

          {pickerOpen && !dis ? (
            <ul className="max-h-72 overflow-y-auto overscroll-contain rounded-md border border-strong bg-surface-2/40 p-1" data-testid="offer-picker" aria-label={t("showroomOffers.builder.addProducts")}>
              {products.length === 0 ? (
                <li className="p-md text-center text-label text-fg-muted">{t("showroomOffers.builder.pickerNone")}</li>
              ) : matches.length === 0 ? (
                <li className="p-md text-center text-label text-fg-muted">{t("showroomOffers.builder.pickerEmpty")}</li>
              ) : (
                matches.map((p) => {
                  const on = selectedIds.has(p.id);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => toggleProduct(p.id)}
                        data-testid="offer-picker-item"
                        className={cn("flex w-full min-w-0 items-center gap-3 rounded-sm p-2 text-start transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", on && "bg-accent-solid/10")}
                      >
                        <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-sm border", on ? "border-accent-edge bg-accent-solid text-on-accent" : "border-strong bg-surface")}>{on ? <CheckIcon size={12} /> : null}</span>
                        <span className="w-10 shrink-0"><ProductMedia src={p.imageUrl} alt="" aspect="aspect-square" /></span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-body font-medium text-fg" dir="auto">{p.name}</span>
                          <span className="truncate text-label text-fg-muted">
                            <span dir="ltr">{p.code ?? "—"}</span>
                            {p.categoryCode ? <> • {t(`commerce.canonicalCategories.${p.categoryCode}`)}</> : null}
                            {!p.published ? <> • {t("showroomOffers.builder.pickerDraftNote")}</> : null}
                          </span>
                        </span>
                        {on ? <span className="shrink-0 text-label font-medium text-accent">{t("showroomOffers.builder.pickerAdded")}</span> : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <p className="text-label font-medium text-fg-secondary" data-testid="offer-selected-count">{t("showroomOffers.builder.selectedCount", { count: String(selected.length) })}</p>
          </div>
          {fe.items ? <p role="alert" className="text-label text-danger">{t(fe.items)}</p> : null}

          {selected.length === 0 ? (
            <p className="rounded-sm border border-dashed border-strong p-md text-center text-label text-fg-muted" data-testid="offer-no-selected">{t("showroomOffers.builder.noSelected")}</p>
          ) : (
            <div className="min-w-0 rounded-md border border-strong" data-testid="offer-selected-table">
              <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_14rem_2.5rem] items-center gap-2 border-b bg-surface-2 px-3 py-2 text-label font-medium text-fg-muted desktop:grid">
                <span>{t("showroomOffers.builder.colProduct")}</span>
                <span>{t("showroomOffers.builder.colCategory")}</span>
                <span>{t("showroomOffers.builder.colColors")}</span>
                <span>{t("showroomOffers.builder.colSpecs")}</span>
                <span>{t("showroomOffers.builder.colQuantity")}</span>
                <span className="sr-only">{t("showroomOffers.builder.colActions")}</span>
              </div>
              {/* The ONLY scrolling region: more products never lengthen the form. */}
              <ul className="max-h-80 overflow-y-auto overscroll-contain" data-testid="offer-selected-scroll" tabIndex={0} aria-label={t("showroomOffers.builder.productsTitle")}>
                {selected.map(({ product: p, quantity }) => (
                  <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 border-b px-3 py-2 last:border-b-0 desktop:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_14rem_2.5rem]" data-testid="offer-selected-row">
                    <span className="order-1 flex min-w-0 items-center gap-2">
                      <span className="w-12 shrink-0"><ProductMedia src={p.imageUrl} alt={p.name} aspect="aspect-square" /></span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-body font-medium text-fg" dir="auto">{p.name}</span>
                        <span className="truncate text-label text-fg-muted" dir="ltr">{p.code ?? "—"}</span>
                      </span>
                    </span>
                    <span className="order-2 hidden truncate text-label text-fg-secondary desktop:block">{p.categoryCode ? t(`commerce.canonicalCategories.${p.categoryCode}`) : "—"}</span>
                    <span className="order-3 hidden desktop:block">{p.colors.length > 0 ? <SwatchRow colors={p.colors} max={3} /> : <span className="text-fg-muted">—</span>}</span>
                    <span className="order-4 hidden truncate text-label text-fg-secondary desktop:block" dir="auto">{productMetaLine(t, { unit: null, sizeLabel: p.sizeLabel, weightKg: p.weightKg }) || "—"}</span>
                    <span className="order-6 col-span-2 flex items-center gap-2 desktop:order-5 desktop:col-span-1">
                      <span role="group" dir="ltr" aria-label={t("showroomOffers.builder.quantityOf", { name: p.name })} className="inline-flex shrink-0 items-center rounded-sm border border-strong bg-surface">
                        <button type="button" disabled={dis || quantity <= 1} aria-label={t("showroomOffers.builder.decrease")} onClick={() => setQuantity(p.id, quantity - 1)} className="grid h-9 w-9 place-items-center text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40" data-testid="offer-qty-minus">−</button>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={quantity}
                          disabled={dis}
                          aria-label={t("showroomOffers.builder.quantityOf", { name: p.name })}
                          onChange={(e) => setQuantity(p.id, Number(e.target.value.replace(/[^\d]/g, "")))}
                          className="h-9 w-12 border-x border-strong bg-transparent text-center text-body text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                          dir="ltr"
                          data-testid="offer-qty-input"
                        />
                        <button type="button" disabled={dis || quantity >= OFFER_LIMITS.quantityMax} aria-label={t("showroomOffers.builder.increase")} onClick={() => setQuantity(p.id, quantity + 1)} className="grid h-9 w-9 place-items-center text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40" data-testid="offer-qty-plus">+</button>
                      </span>
                      <span className="whitespace-nowrap text-label text-fg-muted">{t(`commerce.units.${p.unit}`)}</span>
                    </span>
                    {!dis ? (
                      <button type="button" aria-label={t("showroomOffers.builder.remove", { name: p.name })} onClick={() => toggleProduct(p.id)} className="order-2 grid h-9 w-9 place-items-center justify-self-end rounded-sm text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus desktop:order-6 desktop:justify-self-auto" data-testid="offer-remove">
                        <TrashIcon size={16} />
                      </button>
                    ) : <span className="order-2 desktop:order-6" />}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        <Section icon={<UsersIcon size={18} />} title={t("showroomOffers.builder.audienceTitle")} hint={t("showroomOffers.builder.audienceHint")} testId="offer-audience">
          <ul className="grid grid-cols-2 gap-sm tablet:grid-cols-3 desktop:grid-cols-4" role="group" aria-label={t("showroomOffers.builder.audienceTitle")} data-testid="offer-audience-groups">
            {OFFER_AUDIENCE_GROUPS.map(({ id }) => {
              const on = groups.includes(id);
              return (
                <li key={id} className="min-w-0">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={dis}
                    onClick={() => toggleGroup(id)}
                    data-testid={`offer-audience-${id}`}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-2 rounded-sm border px-3 text-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                      on ? "border-accent bg-accent-solid/10 text-accent" : "border-strong bg-surface text-fg hover:bg-surface-2",
                    )}
                  >
                    <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-sm border", on ? "border-accent-edge bg-accent-solid text-on-accent" : "border-strong bg-surface")}>{on ? <CheckIcon size={12} /> : null}</span>
                    <span className="min-w-0 truncate">{t(`showroomOffers.audienceGroup.${id}`)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {fe.audiences ? <p role="alert" className="text-label text-danger">{t(fe.audiences)}</p> : null}
          <p className="text-label text-fg-muted">{t("showroomOffers.builder.audienceNote")}</p>
        </Section>

        <div className="sticky bottom-0 z-raised -mx-1 flex flex-wrap items-center justify-between gap-sm border-t bg-canvas/95 px-1 py-sm backdrop-blur" data-testid="offer-actions">
          <div className="flex flex-wrap items-center gap-sm">
            <Link href={`${SHOWROOM_ROOT}/my-offers`} className="inline-flex min-h-11 items-center justify-center rounded-sm border border-strong px-md text-label font-medium text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
              {t("showroomOffers.builder.cancel")}
            </Link>
            {!dis ? (
              <SubmitButton name="intent" value="draft" variant="outline" pendingLabel={t("showroomOffers.builder.saving")} data-testid="offer-save-draft">
                <FileTextIcon size={16} />
                {editing ? t("showroomOffers.builder.saveChanges") : t("showroomOffers.builder.saveDraft")}
              </SubmitButton>
            ) : null}
          </div>
          {!dis && canPublish ? (
            <SubmitButton name="intent" value="publish" variant="accent" pendingLabel={t("showroomOffers.builder.saving")} data-testid="offer-publish">
              <SendIcon size={16} />
              {t("showroomOffers.builder.publish")}
            </SubmitButton>
          ) : null}
        </div>
      </div>

      <aside className="flex min-w-0 flex-col gap-md desktop:min-h-0 desktop:overflow-y-auto desktop:overscroll-contain" aria-label={t("showroomOffers.builder.previewTitle")} data-testid="offer-preview">
        <section className="flex flex-col gap-sm rounded-md border bg-surface p-md shadow-card">
          <h2 className="flex items-center gap-2 text-title font-semibold text-fg">
            <TagIcon size={18} className="text-accent" />
            {t("showroomOffers.builder.previewTitle")}
          </h2>
          <OfferCollage images={previewImages} count={selected.length} alt={title || t("showroomOffers.builder.previewName")} />
          <h3 className="text-title font-bold text-fg" dir="auto">{title || <span className="text-fg-muted">{t("showroomOffers.builder.previewName")}</span>}</h3>
          {description ? <p className="line-clamp-3 text-label text-fg-secondary" dir="auto">{description}</p> : null}
          <div className="rounded-sm bg-accent-solid/5 p-sm">
            {Number.isFinite(refNum) && refNum > 0 && referencePrice ? (
              <p className="flex items-baseline gap-2 text-label text-fg-muted">
                <span>{t("showroomOffers.priceBefore")}</span>
                <Money amount={refNum} currency={cur} locale={locale} className="line-through" />
              </p>
            ) : null}
            <p className="text-label font-medium text-accent">{t("showroomOffers.offerPrice")}</p>
            <p className="text-headline font-bold text-accent" data-testid="offer-preview-price">{Number.isFinite(priceNum) && priceNum > 0 && totalPrice ? <Money amount={priceNum} currency={cur} locale={locale} /> : "—"}</p>
          </div>
        </section>

        <section className="flex flex-col gap-2 rounded-md border bg-surface p-md shadow-card">
          <h2 className="flex items-center gap-2 text-title font-semibold text-fg">
            <ClockIcon size={18} className="text-accent" />
            {t("showroomOffers.builder.summaryTitle")}
          </h2>
          <dl className="flex flex-col gap-2 text-label">
            <div className="flex justify-between gap-2"><dt className="text-fg-muted">{t("showroomOffers.builder.summaryProducts")}</dt><dd className="font-semibold text-fg" dir="ltr">{selected.length}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-fg-muted">{t("showroomOffers.builder.summaryQuantity")}</dt><dd className="font-semibold text-fg" dir="ltr">{totalQuantity(items)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="shrink-0 text-fg-muted">{t("showroomOffers.builder.summaryAudience")}</dt><dd className="text-end font-semibold text-fg">{groups.length ? OFFER_AUDIENCE_GROUPS.filter((g) => groups.includes(g.id)).map((g) => t(`showroomOffers.audienceGroup.${g.id}`)).join("، ") : t("showroomOffers.builder.summaryNone")}</dd></div>
            <div className="flex justify-between gap-2"><dt className="shrink-0 text-fg-muted">{t("showroomOffers.builder.summaryDuration")}</dt><dd className="text-end font-semibold text-fg">{startDate && endDate ? (
              <span className="inline-flex items-center gap-1.5" data-testid="offer-summary-range"><bdi dir="ltr">{startDate}</bdi><span aria-hidden="true" className="rtl:rotate-180">→</span><bdi dir="ltr">{endDate}</bdi></span>
            ) : t("showroomOffers.builder.summaryNone")}</dd></div>
          </dl>
        </section>

        <section className="flex flex-col gap-2 rounded-md border bg-surface p-md shadow-card" data-testid="offer-completeness">
          <h2 className="flex items-center gap-2 text-title font-semibold text-fg">
            <CheckIcon size={18} className="text-accent" />
            {t("showroomOffers.builder.completenessTitle")}
          </h2>
          <ul className="flex flex-col gap-1.5 text-label">
            {[
              { key: "name", done: title.trim().length >= OFFER_LIMITS.titleMin },
              { key: "price", done: Number.isFinite(priceNum) && priceNum > 0 && totalPrice.trim() !== "" },
              { key: "period", done: Boolean(startDate && startTime && endDate && endTime) },
              { key: "products", done: selected.length > 0 },
              { key: "audience", done: groups.length > 0 },
            ].map(({ key, done }) => (
              <li key={key} className={cn("flex items-center gap-2", done ? "text-fg" : "text-fg-muted")} data-done={done ? "true" : "false"}>
                <span aria-hidden="true" className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-full border", done ? "border-accent-edge bg-accent-solid text-on-accent" : "border-strong")}>{done ? <CheckIcon size={10} /> : null}</span>
                {t(`showroomOffers.builder.complete.${key}`)}
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-2 rounded-md border bg-surface p-md shadow-card">
          <h2 className="flex items-center gap-2 text-title font-semibold text-accent">
            <LightbulbIcon size={18} />
            {t("showroomOffers.builder.tipsTitle")}
          </h2>
          <ul className="flex flex-col gap-1.5 text-label text-fg-secondary">
            {["tip1", "tip2", "tip3", "tip4"].map((k) => (
              <li key={k} className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-solid ring-1 ring-accent-edge" />
                {t(`showroomOffers.builder.${k}`)}
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
    </form>
  );
}
