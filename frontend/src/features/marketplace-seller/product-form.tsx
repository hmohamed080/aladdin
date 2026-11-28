"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { Button, ButtonLink, Input, LabeledField, Select, Textarea } from "@/components/ui/controls";
import { cn } from "@/lib/ui/cn";
import { adjustStockAction, ensureDefaultLocationAction, publishProductAction, saveSellerProductAction } from "@/server/actions/marketplace-seller";
import type { SellerProductDetail } from "@/server/queries/marketplace-seller-catalog";
import { AttributeInput } from "./attribute-input";
import { ImagesPanel } from "./images-panel";
import { QueuedImages } from "./queued-images";
import { uploadProductImages } from "./image-upload";
import { AddStockAtMain, QuantityStepper } from "./stock-editor";
import { errorKey } from "./errors";
import { RED_FIELD } from "./red-field";
import {
  SELLING_UNITS,
  canOfferPublish,
  draftBlockingIssues,
  emptyVariant,
  fromStoredValue,
  fieldsAt,
  requiredIssues,
  toSavePayload,
  type AttrValue,
  type ProductDraft,
  type ProductTypeSchema,
  type StoreSetup,
  type VariantDraft,
} from "./form-model";

const LIST = "/showroom/marketplace/products";
const PAYMENTS = "/showroom/marketplace/payments";
const DELIVERY = "/showroom/marketplace/delivery";

function draftFrom(detail: SellerProductDetail, schema: ProductTypeSchema | undefined): ProductDraft {
  const byKey = new Map((schema?.fields ?? []).map((f) => [f.key, f]));
  const toValues = (raw: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, fromStoredValue(byKey.get(k), v)])) as Record<string, AttrValue>;
  return {
    id: detail.id,
    organizationId: detail.organizationId,
    typeKey: detail.productTypeKey,
    nameAr: detail.nameAr,
    nameEn: detail.nameEn,
    descriptionAr: detail.descriptionAr ?? "",
    descriptionEn: detail.descriptionEn ?? "",
    brand: detail.brand ?? "",
    externalRef: detail.externalRef ?? "",
    slug: detail.slug,
    lowStockThreshold: String(detail.publication?.lowStockThreshold ?? 5),
    attributes: toValues(detail.attributes),
    variants: detail.variants.map((v) => ({
      uid: v.id,
      id: v.id,
      sku: v.sku,
      sellingUnit: (SELLING_UNITS as readonly string[]).includes(v.selling_unit) ? (v.selling_unit as VariantDraft["sellingUnit"]) : "",
      price: String(v.price_egp),
      status: v.status,
      attributes: toValues(v.attributes),
      initialQty: "",
    })),
  };
}

function Section({ title, hint, children, id }: { title: string; hint?: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="flex flex-col gap-md rounded-md border bg-surface p-md shadow-card tablet:p-lg">
      <header className="flex flex-col gap-0.5">
        <h2 className="text-title text-fg">{title}</h2>
        {hint ? <p className="text-label text-fg-muted">{hint}</p> : null}
      </header>
      {children}
    </section>
  );
}

/** A field that marks itself red while a required value is missing. */
function Req({ invalid, children }: { invalid: boolean; children: React.ReactNode }) {
  return (
    <div className={cn(invalid && RED_FIELD)} data-invalid={invalid ? "true" : undefined}>
      {children}
    </div>
  );
}

/**
 * The Marketplace product form — one component for Add and Edit.
 *
 * The DATABASE is the authority: the type's specification fields come from the taxonomy, and every save goes through
 * `marketplace_seller_product_save`, which re-checks the seller, the ownership and every value. Every condition the
 * database needs before publishing is a REQUIRED FIELD here, marked in red when missing (no readiness button, no
 * blocker list, no banner). Publishing opens by itself once the platform team approves the product.
 */
export function ProductForm({
  organizationId,
  schemas,
  product,
  storeSetup,
  notice,
  beforeActions,
}: {
  organizationId: string;
  schemas: ProductTypeSchema[];
  product?: SellerProductDetail;
  /** Payment / delivery facts for a product that does not exist yet (a saved product carries its own). */
  storeSetup?: StoreSetup;
  notice?: string;
  /** Settings of the saved product that save on their own; shown with the other sections, above the action bar. */
  beforeActions?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const ar = locale === "ar";
  const router = useRouter();
  const editing = Boolean(product);

  const initialSchema = schemas.find((s) => s.key === product?.productTypeKey);
  const [draft, setDraft] = useState<ProductDraft>(() =>
    product
      ? draftFrom(product, initialSchema)
      : {
          organizationId,
          typeKey: "",
          nameAr: "",
          nameEn: "",
          descriptionAr: "",
          descriptionEn: "",
          brand: "",
          externalRef: "",
          slug: "",
          lowStockThreshold: "5",
          attributes: {},
          variants: [emptyVariant("new-0")],
        },
  );
  const schema = useMemo(() => schemas.find((s) => s.key === draft.typeKey), [schemas, draft.typeKey]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(notice ?? null);
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<"save" | "draft" | "publish" | null>(null);
  /** The seller pressed a button once: a new, empty form is not red before that. */
  const [attempted, setAttempted] = useState(false);
  /** New product only: images picked before the first save, uploaded right after it. */
  const [queued, setQueued] = useState<File[]>([]);
  const [uploadingQueued, setUploadingQueued] = useState<{ done: number; total: number } | null>(null);

  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setVariant = (uid: string, patch: Partial<VariantDraft>) =>
    setDraft((d) => ({ ...d, variants: d.variants.map((v) => (v.uid === uid ? { ...v, ...patch } : v)) }));

  const storedStock = (product?.variants ?? []).some((v) => v.status === "active" && v.stock.some((s) => s.location_active && s.available > 0));
  const confirmedImages = (product?.images ?? []).filter((i) => i.uploadState === "confirmed");
  const hasImage = editing ? confirmedImages.some((i) => i.isPrimary && !i.variantId) : queued.length > 0;
  const issues = useMemo(
    () => requiredIssues(draft, schema, { storedStock, hasImage }),
    [draft, schema, storedStock, hasImage],
  );
  const show = editing || attempted;
  const bad = (id: string) => show && issues.has(id);

  const setup: StoreSetup = product?.publication
    ? { paymentReady: product.publication.paymentReady, deliveryReady: product.publication.deliveryReady }
    : (storeSetup ?? { paymentReady: true, deliveryReady: true });
  const setupMissing = !setup.paymentReady || !setup.deliveryReady;

  const fieldName = (key: string) => {
    const f = schema?.fields.find((x) => x.key === key);
    return f ? (ar ? f.nameAr : f.nameEn) : key;
  };

  const describe = (code: string, detail?: string) => {
    const base = t(errorKey(code));
    if (!detail) return base;
    const shown = detail.includes(":") ? detail : fieldName(detail) || detail;
    return `${base} (${shown})`;
  };

  const status = product?.status ?? "draft";
  const publication = product?.publication ?? null;
  const offerPublish = canOfferPublish(publication ? { status: publication.status, canPublish: publication.canPublish } : null);

  /** Validates every required field, then saves; `mode` decides where the seller lands afterwards. */
  const submit = (mode: "save" | "draft") => {
    setAttempted(true);
    setError(null);
    setOk(null);
    // A draft needs the product fields only; stock and a main image are conditions of publishing (owner decision, 2026-11-24).
    const blocking = mode === "draft" ? draftBlockingIssues(issues) : issues;
    if (blocking.size > 0) {
      setError(t("marketplaceSeller.form.fixRed"));
      requestAnimationFrame(() => document.querySelector("[data-invalid='true']")?.scrollIntoView({ behavior: "smooth", block: "center" }));
      return;
    }
    setAction(mode);
    startTransition(async () => {
      const r = await saveSellerProductAction(toSavePayload(draft, schema));
      if (!r.ok) {
        setError(describe(r.code, r.detail));
        setAction(null);
        return;
      }
      // First quantities for NEW variants, at the main location, through the ledger.
      // Keyed by product + variant, so a retried save never enters them twice.
      const wanted = draft.variants
        .filter((v) => !v.id && Number.parseInt(v.initialQty, 10) > 0)
        .map((v) => ({ qty: Number.parseInt(v.initialQty, 10), saved: r.variants.find((s) => s.sku === v.sku.trim()) }))
        .filter((x) => x.saved);
      if (wanted.length) {
        const loc = await ensureDefaultLocationAction(organizationId);
        if (!loc.ok) {
          setError(describe(loc.code));
        } else {
          for (const w of wanted) {
            const s = await adjustStockAction({
              variantId: w.saved!.id,
              locationId: loc.locationId,
              delta: w.qty,
              key: `init-${r.id}-${w.saved!.id}`,
            });
            if (!s.ok) setError(describe(s.code, w.saved!.sku));
          }
        }
      }
      // Images picked before the product existed: upload them now that it does (the first one is the main image).
      let imageFailures = 0;
      if (!editing && queued.length) {
        setUploadingQueued({ done: 0, total: queued.length });
        let done = 0;
        const failures = await uploadProductImages(r.id, queued, (name) => {
          if (name === null) return;
          setUploadingQueued({ done: done++, total: queued.length });
        });
        imageFailures = failures.length;
        setUploadingQueued(null);
      }
      if (mode === "draft" && !imageFailures) {
        router.push(LIST);
        return;
      }
      if (!editing) {
        router.replace(`${LIST}/${r.id}/edit?created=1${imageFailures ? `&imagesFailed=${imageFailures}` : ""}`);
        return;
      }
      setOk(t("marketplaceSeller.saved"));
      setAction(null);
      router.refresh();
    });
  };

  const publish = () => {
    if (!product) return;
    setError(null);
    setOk(null);
    setAction("publish");
    startTransition(async () => {
      const r = await publishProductAction(product.id);
      setAction(null);
      if (!r.ok) return setError(describe(r.code));
      setOk(t("marketplaceSeller.form.published"));
      router.refresh();
    });
  };

  const productFields = fieldsAt(schema, "product");
  const variantFields = fieldsAt(schema, "variant");
  const savedVariants = (product?.variants ?? []).filter((v) => v.status === "active").map((v) => ({ id: v.id, sku: v.sku }));

  return (
    <div className="flex flex-col gap-lg pb-24 pt-xs">
      {/* ---------------- Basic information (name first, then type) ---------------- */}
      <Section title={t("marketplaceSeller.form.basicInfo")}>
        <div className="grid gap-md tablet:grid-cols-2">
          <Req invalid={bad("nameAr")}>
            <LabeledField label={t("marketplaceSeller.form.nameAr")} htmlFor="mp-name-ar">
              <Input id="mp-name-ar" dir="rtl" value={draft.nameAr} maxLength={200} aria-invalid={bad("nameAr")} onChange={(e) => set("nameAr", e.target.value)} />
            </LabeledField>
          </Req>
          <Req invalid={bad("nameEn")}>
            <LabeledField label={t("marketplaceSeller.form.nameEn")} htmlFor="mp-name-en">
              <Input id="mp-name-en" dir="ltr" value={draft.nameEn} maxLength={200} aria-invalid={bad("nameEn")} onChange={(e) => set("nameEn", e.target.value)} />
            </LabeledField>
          </Req>
          <Req invalid={bad("type")}>
            <LabeledField label={t("marketplaceSeller.form.productType")} htmlFor="mp-type" hint={t("marketplaceSeller.form.typeHint")}>
              <Select
                id="mp-type"
                value={draft.typeKey}
                aria-invalid={bad("type")}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    typeKey: e.target.value,
                    attributes: {},
                    variants: d.variants.map((v) => ({ ...v, attributes: {} })),
                  }))
                }
              >
                <option value="">{t("marketplaceSeller.form.chooseType")}</option>
                {schemas.map((s) => (
                  <option key={s.key} value={s.key}>
                    {ar ? s.nameAr : s.nameEn}
                  </option>
                ))}
              </Select>
            </LabeledField>
          </Req>
          <LabeledField label={t("marketplaceSeller.form.category")} htmlFor="mp-category">
            <Input id="mp-category" value={schema ? (ar ? schema.categoryNameAr : schema.categoryNameEn) : "—"} readOnly disabled />
          </LabeledField>
          <LabeledField label={t("marketplaceSeller.form.descriptionAr")} htmlFor="mp-desc-ar" optional={t("marketplaceSeller.form.optional")}>
            <Textarea id="mp-desc-ar" dir="rtl" rows={3} value={draft.descriptionAr} maxLength={5000} onChange={(e) => set("descriptionAr", e.target.value)} />
          </LabeledField>
          <LabeledField label={t("marketplaceSeller.form.descriptionEn")} htmlFor="mp-desc-en" optional={t("marketplaceSeller.form.optional")}>
            <Textarea id="mp-desc-en" dir="ltr" rows={3} value={draft.descriptionEn} maxLength={5000} onChange={(e) => set("descriptionEn", e.target.value)} />
          </LabeledField>
          <LabeledField label={t("marketplaceSeller.form.brand")} htmlFor="mp-brand" optional={t("marketplaceSeller.form.optional")}>
            <Input id="mp-brand" value={draft.brand} maxLength={80} onChange={(e) => set("brand", e.target.value)} />
          </LabeledField>
          <LabeledField
            label={t("marketplaceSeller.form.externalRef")}
            htmlFor="mp-ref"
            optional={t("marketplaceSeller.form.optional")}
            hint={t("marketplaceSeller.form.externalRefHint")}
          >
            <Input id="mp-ref" dir="ltr" value={draft.externalRef} maxLength={80} onChange={(e) => set("externalRef", e.target.value)} />
          </LabeledField>
          <LabeledField
            label={t("marketplaceSeller.form.slug")}
            htmlFor="mp-slug"
            optional={t("marketplaceSeller.form.optional")}
            hint={t("marketplaceSeller.form.slugHint")}
          >
            <Input id="mp-slug" dir="ltr" value={draft.slug} maxLength={120} onChange={(e) => set("slug", e.target.value)} />
          </LabeledField>
        </div>
      </Section>

      {/* ---------------- Dynamic specifications ---------------- */}
      <Section title={t("marketplaceSeller.form.attributes")} hint={t("marketplaceSeller.form.attributesHint")}>
        {!schema ? (
          <p className="text-body text-fg-muted">{t("marketplaceSeller.form.chooseTypeFirst")}</p>
        ) : productFields.length === 0 ? (
          <p className="text-body text-fg-muted">{t("marketplaceSeller.form.noProductFields")}</p>
        ) : (
          <div className="grid gap-md tablet:grid-cols-2">
            {productFields.map((f) => (
              <AttributeInput
                key={f.key}
                field={f}
                idPrefix="mp-attr"
                invalid={bad(`attr:${f.key}`)}
                value={draft.attributes[f.key]}
                onChange={(v) => set("attributes", { ...draft.attributes, [f.key]: v })}
              />
            ))}
          </div>
        )}
      </Section>

      {/* ---------------- Variants (+ stock) ---------------- */}
      <Section id="variants" title={t("marketplaceSeller.form.variants")} hint={t("marketplaceSeller.form.variantsHint")}>
        <div className="flex flex-col gap-md">
          {draft.variants.map((v, index) => {
            const stored = product?.variants.find((s) => s.id === v.id);
            return (
              <div key={v.uid} className="flex flex-col gap-md rounded-md border bg-surface-2/40 p-md">
                <div className="flex items-center justify-between gap-sm">
                  <h3 className="text-body-lg font-semibold text-fg">{t("marketplaceSeller.form.variant", { n: index + 1 })}</h3>
                  {!v.id && draft.variants.length > 1 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDraft((d) => ({ ...d, variants: d.variants.filter((x) => x.uid !== v.uid) }))}
                    >
                      {t("marketplaceSeller.form.removeVariant")}
                    </Button>
                  ) : null}
                </div>
                <div className="grid gap-md tablet:grid-cols-2 desktop:grid-cols-4">
                  <Req invalid={bad(`v:${v.uid}:sku`)}>
                    <LabeledField label={t("marketplaceSeller.form.sku")} optional="SKU" htmlFor={`mp-sku-${v.uid}`}>
                      <Input
                        id={`mp-sku-${v.uid}`}
                        dir="ltr"
                        value={v.sku}
                        maxLength={64}
                        aria-invalid={bad(`v:${v.uid}:sku`)}
                        onChange={(e) => setVariant(v.uid, { sku: e.target.value })}
                      />
                    </LabeledField>
                  </Req>
                  <Req invalid={bad(`v:${v.uid}:unit`)}>
                    <LabeledField label={t("marketplaceSeller.form.sellingUnit")} htmlFor={`mp-unit-${v.uid}`}>
                      <Select
                        id={`mp-unit-${v.uid}`}
                        value={v.sellingUnit}
                        aria-invalid={bad(`v:${v.uid}:unit`)}
                        onChange={(e) => setVariant(v.uid, { sellingUnit: e.target.value as VariantDraft["sellingUnit"] })}
                      >
                        <option value="">{t("marketplaceSeller.form.chooseUnit")}</option>
                        {SELLING_UNITS.map((u) => (
                          <option key={u} value={u}>
                            {t(`marketplaceSeller.unit.${u}`)}
                          </option>
                        ))}
                      </Select>
                    </LabeledField>
                  </Req>
                  <Req invalid={bad(`v:${v.uid}:price`)}>
                    <LabeledField label={t("marketplaceSeller.form.price")} htmlFor={`mp-price-${v.uid}`}>
                      <Input
                        id={`mp-price-${v.uid}`}
                        dir="ltr"
                        inputMode="decimal"
                        value={v.price}
                        aria-invalid={bad(`v:${v.uid}:price`)}
                        onChange={(e) => setVariant(v.uid, { price: e.target.value.replace(/[^0-9.]/g, "") })}
                      />
                    </LabeledField>
                  </Req>
                  <LabeledField label={t("marketplaceSeller.form.variantStatus")} htmlFor={`mp-vstatus-${v.uid}`}>
                    <Select
                      id={`mp-vstatus-${v.uid}`}
                      value={v.status}
                      onChange={(e) => setVariant(v.uid, { status: e.target.value as VariantDraft["status"] })}
                    >
                      <option value="active">{t("marketplaceSeller.form.active")}</option>
                      <option value="inactive">{t("marketplaceSeller.form.inactive")}</option>
                    </Select>
                  </LabeledField>
                  {variantFields.map((f) => (
                    <AttributeInput
                      key={f.key}
                      field={f}
                      idPrefix={`mp-vattr-${v.uid}`}
                      invalid={bad(`v:${v.uid}:${f.key}`)}
                      value={v.attributes[f.key]}
                      onChange={(val) => setVariant(v.uid, { attributes: { ...v.attributes, [f.key]: val } })}
                    />
                  ))}
                </div>

                <div className="border-t pt-md">
                  <h4 className="mb-sm text-label font-medium text-fg-secondary">{t("marketplaceSeller.stockEditor.title")}</h4>
                  {!v.id ? (
                    <Req invalid={bad("stock")}>
                      <LabeledField
                        label={t("marketplaceSeller.form.initialQty")}
                        htmlFor={`mp-qty-${v.uid}`}
                        hint={t("marketplaceSeller.form.initialQtyHint")}
                      >
                        <Input
                          id={`mp-qty-${v.uid}`}
                          dir="ltr"
                          inputMode="numeric"
                          className="max-w-40"
                          value={v.initialQty}
                          aria-invalid={bad("stock")}
                          onChange={(e) => setVariant(v.uid, { initialQty: e.target.value.replace(/[^0-9]/g, "") })}
                        />
                      </LabeledField>
                    </Req>
                  ) : stored && stored.stock.length ? (
                    <div className={cn(bad("stock") && "rounded-md ring-1 ring-danger")} data-invalid={bad("stock") ? "true" : undefined}>
                      <ul className="flex flex-col gap-sm">
                        {stored.stock.map((s) => (
                          <li key={s.location_id} className="flex flex-wrap items-center justify-between gap-sm">
                            <span className="text-body text-fg">{ar ? s.location_name_ar : s.location_name_en}</span>
                            <QuantityStepper
                              variantId={stored.id}
                              level={{
                                locationId: s.location_id,
                                locationName: ar ? s.location_name_ar : s.location_name_en,
                                onHand: s.on_hand,
                                reserved: s.reserved,
                                available: s.available,
                              }}
                            />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className={cn(bad("stock") && "rounded-md ring-1 ring-danger")} data-invalid={bad("stock") ? "true" : undefined}>
                      <AddStockAtMain organizationId={organizationId} variantId={v.id} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div>
            <Button variant="outline" onClick={() => setDraft((d) => ({ ...d, variants: [...d.variants, emptyVariant()] }))}>
              + {t("marketplaceSeller.form.addVariant")}
            </Button>
          </div>
          <Req invalid={bad("lowStock")}>
            <LabeledField label={t("marketplaceSeller.form.lowStock")} htmlFor="mp-low-stock" hint={t("marketplaceSeller.form.lowStockHint")}>
              <Input
                id="mp-low-stock"
                dir="ltr"
                inputMode="numeric"
                className="max-w-40"
                value={draft.lowStockThreshold}
                aria-invalid={bad("lowStock")}
                onChange={(e) => set("lowStockThreshold", e.target.value.replace(/[^0-9]/g, ""))}
              />
            </LabeledField>
          </Req>
          {publication && !publication.listed && status === "published" ? (
            <p role="status" className="text-label text-warning">
              {t("marketplaceSeller.form.withdrawn")}
            </p>
          ) : null}
        </div>
      </Section>

      {/* ---------------- Media: up to 5 slots, one is the main image ---------------- */}
      <Section title={t("marketplaceSeller.image.title")}>
        <Req invalid={bad("images")}>
          {product ? (
            <ImagesPanel productId={product.id} images={product.images} pendingRemovals={product.pendingRemovals.length} variants={savedVariants} />
          ) : (
            <>
              <QueuedImages files={queued} onChange={setQueued} disabled={pending} />
              {uploadingQueued ? (
                <p role="status" className="text-label text-fg-secondary">
                  {t("marketplaceSeller.image.uploadingQueued", { done: uploadingQueued.done, total: uploadingQueued.total })}
                </p>
              ) : null}
            </>
          )}
          {bad("images") ? <p className="mt-xs text-label text-danger">{t("marketplaceSeller.image.mainRequired")}</p> : null}
        </Req>
      </Section>

      {/* ---------------- Store setup: payment + delivery (set once for the whole store) ---------------- */}
      {setupMissing && status !== "published" ? (
        <Section title={t("marketplaceSeller.form.storeSetup")} hint={t("marketplaceSeller.form.storeSetupHint")}>
          <ul className="flex flex-col gap-sm">
            {!setup.paymentReady ? (
              <li className="flex flex-wrap items-center justify-between gap-sm rounded-md border border-danger px-md py-sm" data-invalid="true">
                <span className="text-body text-danger">{t("marketplaceSeller.form.needPayment")}</span>
                <ButtonLink href={PAYMENTS} variant="outline" size="sm">
                  {t("marketplaceSeller.form.goPayment")}
                </ButtonLink>
              </li>
            ) : null}
            {!setup.deliveryReady ? (
              <li className="flex flex-wrap items-center justify-between gap-sm rounded-md border border-danger px-md py-sm" data-invalid="true">
                <span className="text-body text-danger">{t("marketplaceSeller.form.needDelivery")}</span>
                <ButtonLink href={DELIVERY} variant="outline" size="sm">
                  {t("marketplaceSeller.form.goDelivery")}
                </ButtonLink>
              </li>
            ) : null}
          </ul>
        </Section>
      ) : null}

      {/* ---------------- Review record + Publish (opens by itself once approved) ---------------- */}
      {publication && (status === "draft" || status === "unpublished") ? (
        <div role="status" className={cn("flex flex-wrap items-center justify-between gap-sm rounded-md border p-md", offerPublish ? "border-success/50 bg-success/10" : "bg-surface-2/40")}>
          <p className="text-body text-fg">
            <span className="font-medium">{t("marketplaceSeller.form.reviewTitle")}: </span>
            {t(`marketplaceSeller.review.${publication.reviewState}`)}
            {" · "}
            {offerPublish ? t("marketplaceSeller.form.readyToPublish") : publication.reviewState === "approved" ? t("marketplaceSeller.form.fixRed") : t("marketplaceSeller.form.awaitingApproval")}
          </p>
          {offerPublish ? (
            <Button variant="accent" onClick={publish} disabled={pending}>
              {action === "publish" ? t("marketplaceSeller.form.publishing") : t("marketplaceSeller.form.publish")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {beforeActions}

      {/* ---------------- Action bar ---------------- */}
      <div className="sticky bottom-20 z-10 flex flex-col gap-sm rounded-md border bg-surface/95 tablet:bottom-2 p-sm shadow-card backdrop-blur tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="min-w-0 text-label">
          {error ? (
            <p role="alert" className="text-danger">
              {error}
            </p>
          ) : ok ? (
            <p role="status" className="text-success">
              {ok}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-sm">
          {product && product.status === "published" ? (
            <ButtonLink href={`/market/products/${product.slug}`} variant="ghost">
              {t("marketplaceSeller.form.preview")}
            </ButtonLink>
          ) : (
            <Button variant="ghost" disabled title={t("marketplaceSeller.form.previewUnavailable")}>
              {t("marketplaceSeller.form.preview")}
            </Button>
          )}
          {status !== "published" ? (
            <Button variant="outline" onClick={() => submit("draft")} disabled={pending}>
              {action === "draft" ? t("marketplaceSeller.form.saving") : t("marketplaceSeller.form.saveDraft")}
            </Button>
          ) : null}
          <Button variant="accent" onClick={() => submit("save")} disabled={pending}>
            {action === "save" ? t("marketplaceSeller.form.saving") : t("marketplaceSeller.form.save")}
          </Button>
        </div>
      </div>
      <p className="text-label text-fg-muted">
        <Link href={LIST} className="text-accent hover:underline">
          ← {t("marketplaceSeller.backToProducts")}
        </Link>
      </p>
    </div>
  );
}
