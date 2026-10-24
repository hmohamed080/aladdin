"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { Button, ButtonLink, Input, LabeledField, Select, Textarea } from "@/components/ui/controls";
import { cn } from "@/lib/ui/cn";
import {
  adjustStockAction,
  ensureDefaultLocationAction,
  productReadinessAction,
  publishProductAction,
  saveSellerProductAction,
} from "@/server/actions/marketplace-seller";
import type { SellerProductDetail } from "@/server/queries/marketplace-seller-catalog";
import { AttributeInput } from "./attribute-input";
import { ImagesPanel } from "./images-panel";
import { QueuedImages } from "./queued-images";
import { uploadProductImages } from "./image-upload";
import { AddStockAtMain, QuantityStepper } from "./stock-editor";
import { blockerParts, errorKey } from "./errors";
import {
  SELLING_UNITS,
  emptyVariant,
  fieldsAt,
  fromStoredValue,
  missingRequired,
  toSavePayload,
  type AttrValue,
  type ProductDraft,
  type ProductTypeSchema,
  type VariantDraft,
} from "./form-model";

const LIST = "/b2c/seller/products";

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

/**
 * The Marketplace product form — one component for Add and Edit.
 *
 * The DATABASE is the authority: the type's specification fields come from the
 * taxonomy, and every save goes through `marketplace_seller_product_save`, which
 * re-checks the seller, the ownership and every value. This form only collects
 * input and shows the server's answer. A product is always a draft until the
 * server-side publication policy (readiness) allows publishing.
 */
export function ProductForm({
  organizationId,
  schemas,
  product,
  notice,
}: {
  organizationId: string;
  schemas: ProductTypeSchema[];
  product?: SellerProductDetail;
  notice?: string;
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
          attributes: {},
          variants: [emptyVariant("new-0")],
        },
  );
  const schema = useMemo(() => schemas.find((s) => s.key === draft.typeKey), [schemas, draft.typeKey]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(notice ?? null);
  const [blockers, setBlockers] = useState<string[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<"save" | "return" | "check" | "publish" | null>(null);
  /** New product only: images picked before the first save, uploaded right after it. */
  const [queued, setQueued] = useState<File[]>([]);
  const [uploadingQueued, setUploadingQueued] = useState<{ done: number; total: number } | null>(null);

  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setVariant = (uid: string, patch: Partial<VariantDraft>) =>
    setDraft((d) => ({ ...d, variants: d.variants.map((v) => (v.uid === uid ? { ...v, ...patch } : v)) }));

  const missing = missingRequired(draft, schema);
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

  const save = (andReturn: boolean) => {
    setError(null);
    setOk(null);
    setBlockers(null);
    setAction(andReturn ? "return" : "save");
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
      // Images picked before the product existed: upload them now that it does.
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
      if (andReturn && !imageFailures) {
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

  const check = () => {
    if (!product) return;
    setError(null);
    setOk(null);
    setAction("check");
    startTransition(async () => {
      const r = await productReadinessAction(product.id);
      setAction(null);
      if (!r.ok) return setError(describe(r.code));
      setBlockers(r.blockers);
    });
  };

  const publish = () => {
    if (!product) return;
    setError(null);
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
    <div className="flex flex-col gap-lg pb-24">
      {/* ---------------- Basic information ---------------- */}
      <Section title={t("marketplaceSeller.form.basicInfo")}>
        <div className="grid gap-md tablet:grid-cols-2">
          <LabeledField
            label={t("marketplaceSeller.form.productType")}
            htmlFor="mp-type"
            hint={editing ? t("marketplaceSeller.form.typeLocked") : undefined}
          >
            <Select
              id="mp-type"
              value={draft.typeKey}
              disabled={editing}
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
          <LabeledField label={t("marketplaceSeller.form.category")} htmlFor="mp-category">
            <Input id="mp-category" value={schema ? (ar ? schema.categoryNameAr : schema.categoryNameEn) : "—"} readOnly disabled />
          </LabeledField>
          <LabeledField label={t("marketplaceSeller.form.nameAr")} htmlFor="mp-name-ar">
            <Input id="mp-name-ar" dir="rtl" value={draft.nameAr} maxLength={200} onChange={(e) => set("nameAr", e.target.value)} />
          </LabeledField>
          <LabeledField label={t("marketplaceSeller.form.nameEn")} htmlFor="mp-name-en">
            <Input id="mp-name-en" dir="ltr" value={draft.nameEn} maxLength={200} onChange={(e) => set("nameEn", e.target.value)} />
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
                  <LabeledField label={t("marketplaceSeller.form.sku")} htmlFor={`mp-sku-${v.uid}`}>
                    <Input id={`mp-sku-${v.uid}`} dir="ltr" value={v.sku} maxLength={64} onChange={(e) => setVariant(v.uid, { sku: e.target.value })} />
                  </LabeledField>
                  <LabeledField label={t("marketplaceSeller.form.sellingUnit")} htmlFor={`mp-unit-${v.uid}`}>
                    <Select
                      id={`mp-unit-${v.uid}`}
                      value={v.sellingUnit}
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
                  <LabeledField label={t("marketplaceSeller.form.price")} htmlFor={`mp-price-${v.uid}`}>
                    <Input
                      id={`mp-price-${v.uid}`}
                      dir="ltr"
                      inputMode="decimal"
                      value={v.price}
                      onChange={(e) => setVariant(v.uid, { price: e.target.value.replace(/[^0-9.]/g, "") })}
                    />
                  </LabeledField>
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
                      value={v.attributes[f.key]}
                      onChange={(val) => setVariant(v.uid, { attributes: { ...v.attributes, [f.key]: val } })}
                    />
                  ))}
                </div>

                <div className="border-t pt-md">
                  <h4 className="mb-sm text-label font-medium text-fg-secondary">{t("marketplaceSeller.stockEditor.title")}</h4>
                  {!v.id ? (
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
                        onChange={(e) => setVariant(v.uid, { initialQty: e.target.value.replace(/[^0-9]/g, "") })}
                      />
                    </LabeledField>
                  ) : stored && stored.stock.length ? (
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
                  ) : (
                    <AddStockAtMain organizationId={organizationId} variantId={v.id} />
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
        </div>
      </Section>

      {/* ---------------- Images ---------------- */}
      <Section title={t("marketplaceSeller.image.title")}>
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
      </Section>

      {/* ---------------- Readiness result ---------------- */}
      {blockers ? (
        <div
          role="status"
          className={cn(
            "rounded-md border p-md",
            blockers.length ? "border-warning/50 bg-warning/10" : "border-success/50 bg-success/10",
          )}
        >
          <p className="font-medium text-fg">
            {blockers.length ? t("marketplaceSeller.form.notReady") : t("marketplaceSeller.form.ready")}
          </p>
          {blockers.length ? (
            <ul className="mt-xs list-inside list-disc text-body text-fg-secondary">
              {blockers.map((b) => {
                const { key, detail } = blockerParts(b);
                return (
                  <li key={b}>
                    {t(key)}
                    {detail ? ` (${detail.split(" · ").map((d) => fieldName(d)).join(" · ")})` : ""}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mt-sm">
              <Button variant="accent" onClick={publish} disabled={pending}>
                {action === "publish" ? t("marketplaceSeller.form.publishing") : t("marketplaceSeller.form.publish")}
              </Button>
            </div>
          )}
        </div>
      ) : null}

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
          ) : missing.length ? (
            <p className="text-fg-muted">
              {t("marketplaceSeller.form.missingRequired", {
                fields: missing.map((m) => m.split(":").map((p) => fieldName(p)).join(" · ")).join("، "),
              })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-sm">
          {product && product.status === "published" ? (
            <ButtonLink href={`/marketplace/products/${product.slug}`} variant="ghost">
              {t("marketplaceSeller.form.preview")}
            </ButtonLink>
          ) : (
            <Button variant="ghost" disabled title={t("marketplaceSeller.form.previewUnavailable")}>
              {t("marketplaceSeller.form.preview")}
            </Button>
          )}
          {product ? (
            <Button variant="outline" onClick={check} disabled={pending}>
              {action === "check" ? t("marketplaceSeller.form.checking") : t("marketplaceSeller.form.checkReadiness")}
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => save(true)} disabled={pending || !draft.typeKey}>
            {action === "return" ? t("marketplaceSeller.form.saving") : t("marketplaceSeller.form.saveAndReturn")}
          </Button>
          <Button variant="accent" onClick={() => save(false)} disabled={pending || !draft.typeKey}>
            {action === "save" ? t("marketplaceSeller.form.saving") : t("marketplaceSeller.form.saveDraft")}
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
