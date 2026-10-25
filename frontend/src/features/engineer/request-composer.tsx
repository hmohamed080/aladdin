"use client";
import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { parseQuantity } from "@/features/purchase-requests/model";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import {
  Button,
  Input,
  Select,
  Textarea,
  LabeledField,
} from "@/components/ui/controls";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  PlusIcon,
  TrashIcon,
  FileTextIcon,
  ShieldIcon,
  BoltIcon,
  StorefrontIcon,
  MapPinIcon,
  UploadIcon,
  SendIcon,
  HelpIcon,
  UsersIcon,
} from "@/components/ui/icons";
import {
  CANONICAL_CATEGORY_CODES,
  SHARED_UNITS,
} from "@/features/commerce/constants";
import {
  savePurchaseRequestAction,
  purchaseRequestLifecycleAction,
  requestRequestImageUploadAction,
  confirmRequestImageUploadAction,
  removeRequestImageAction,
  abortRequestImageUploadAction,
} from "@/server/actions/purchase-requests";
import {
  REQUEST_IMAGE_BUCKET,
  validateRequestImageFile,
} from "@/lib/storage/request-images";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import type { OwnRequest } from "@/server/queries/purchase-requests";
import type { CatalogRow } from "@/server/queries/commerce";

import "./request-composer.css";

type Line = {
  key: string;
  id?: string;
  name: string;
  categoryCode: string;
  quantity: string;
  unit: string;
  specs: string;
  code: string;
  colors: { name: string; hex: string | null; code?: string }[];
};
const blank = (key: string): Line => ({
  key,
  name: "",
  categoryCode: "wood_alternative",
  quantity: "1",
  unit: "square_meter",
  specs: "",
  code: "",
  colors: [],
});

export function RequestComposer({
  existing,
  sample = false,
  product,
  imageUrls = {},
  showrooms = [],
  context = { location: "", showroomIds: [] },
}: {
  existing?: OwnRequest;
  sample?: boolean;
  product?: CatalogRow | null;
  imageUrls?: Record<string, string>;
  showrooms?: { id: string; name: string }[];
  context?: { location: string; showroomIds: string[] };
}) {
  const { locale, t } = useI18n();
  const ar = locale === "ar";
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const saving = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [invalidQuantities, setInvalidQuantities] = useState<string[]>([]);
  const quantityHelp = ar
    ? "أدخل كمية أكبر من صفر وحتى ١٬٠٠٠٬٠٠٠، بحد أقصى ٣ أرقام عشرية."
    : "Enter a quantity greater than zero and up to 1,000,000, with at most 3 decimal places.";
  const [title, setTitle] = useState(existing?.request.title ?? (sample ? (ar ? "تشطيبات شقة — طلب توضيحي" : "Apartment finishing — example request") : ""));
  const [location, setLocation] = useState(context.location);
  const [showroomIds, setShowroomIds] = useState(context.showroomIds);
  const [notes, setNotes] = useState(existing?.request.notes ?? "");
  const [neededBy, setNeededBy] = useState(existing?.request.needed_by ?? "");
  const [lines, setLines] = useState<Line[]>(
    existing
      ? existing.items.map((i) => ({
          key: i.id,
          id: i.id,
          name: i.name,
          categoryCode: i.categoryCode,
          quantity: String(i.quantity),
          unit: i.unit,
          specs: i.specs ?? "",
          code: i.code ?? "",
          colors: i.colors,
        }))
      : sample && !product ? [
          { ...blank("wood"), name: ar ? "بديل خشب" : "Wood alternative", quantity: "120", specs: ar ? "WPC — حوائط داخلية" : "WPC — interior walls" },
          { ...blank("marble"), name: ar ? "بديل رخام" : "Marble alternative", categoryCode: "marble_alternative", quantity: "80" },
          { ...blank("floor"), name: ar ? "أرضيات" : "Flooring", categoryCode: "spc_flooring", quantity: "200", specs: "SPC" },
          { ...blank("paint"), name: ar ? "دهانات" : "Paint", categoryCode: "paints", quantity: "15", unit: "pail" },
        ] : [
          {
            ...blank("first"),
            name: product?.name ?? "",
            categoryCode: product?.category_code ?? "wood_alternative",
            unit:
              product?.unit && SHARED_UNITS.some((u) => u === product.unit)
                ? product.unit
                : "square_meter",
          },
        ],
  );
  const patch = (key: string, values: Partial<Line>) =>
    setLines((old) =>
      old.map((l) => (l.key === key ? { ...l, ...values } : l)),
    );
  function save() {
    if (saving.current || pending) return;
    const invalid = lines.filter((line) => parseQuantity(line.quantity) === null);
    setInvalidQuantities(invalid.map((line) => line.key));
    if (invalid.length) {
      document.getElementById(`qty-${invalid[0]!.key}`)?.focus();
      return;
    }
    saving.current = true;
    setError("");
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("engineer", "true");
        fd.set("location", location);
        fd.set("showroomIds", JSON.stringify(showroomIds));
        fd.set("title", title);
        fd.set("notes", notes);
        fd.set("neededBy", neededBy);
        fd.set("items", JSON.stringify(lines));
        if (existing) {
          fd.set("requestId", existing.request.id);
          fd.set("expectedVersion", String(existing.request.version));
        }
        const result = await savePurchaseRequestAction({ ok: false }, fd);
        if (!result.ok || !result.id) {
          setError(
            result.code
              ? t(result.code)
              : ar
                ? "راجع عنوان الطلب واسم وصنف وكمية كل منتج."
                : "Check the request title and each item's name, category and quantity.",
          );
          return;
        }
        router.push(`/home/engineer/requests/${result.id}`);
        router.refresh();
      } catch {
        setError(
          ar
            ? "تعذر الحفظ. احتفظنا ببياناتك هنا، حاول مرة أخرى."
            : "Could not save. Your input is still here; please retry.",
        );
      } finally {
        saving.current = false;
        requestAnimationFrame(() => errorRef.current?.focus());
      }
    });
  }
  async function upload(itemId: string, file: File) {
    const valid = validateRequestImageFile(file);
    if (!valid.ok) {
      setError(t(valid.code));
      return;
    }
    setError("");
    start(async () => {
      let pendingKey: string | null = null;
      try {
        const ticket = await requestRequestImageUploadAction(itemId, file.type);
        if (!ticket.ok) {
          setError(t(ticket.code));
          return;
        }
        pendingKey = ticket.key;
        const client = createBrowserSupabaseClient();
        const { error: uploadError } = await client.storage
          .from(REQUEST_IMAGE_BUCKET)
          .upload(ticket.key, file, { contentType: file.type, upsert: false });
        if (uploadError) {
          setError(t("states.genericRetry"));
          return;
        }
        const done = await confirmRequestImageUploadAction(ticket.key);
        if (!done.ok) {
          setError(t(done.code));
          return;
        }
        pendingKey = null;
        router.refresh();
      } catch {
        setError(t("states.genericRetry"));
      } finally {
        if (pendingKey) {
          try {
            await abortRequestImageUploadAction(pendingKey);
          } catch {
            setError(t("states.genericRetry"));
          }
        }
      }
    });
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="request-composer"
      aria-busy={pending}
    >
      <header className="request-hero engineer-hero">
        <Image src="/assets/engineer/hero-living-room.webp" alt="" fill priority sizes="(min-width: 1024px) 80vw, 100vw" className="object-cover" />
        <div className="request-hero-copy">
          <h1>{ar ? "اطلب عروض أسعار" : "Request project quotations"}</h1>
          <p>{ar ? "أضف كل احتياجات مشروعك في مكان واحد، واحصل على عروض من المعارض المناسبة." : "Bring your project needs together. Get quotations from suitable showrooms, all in one place."}</p>
        </div>
      </header>
      {sample && !existing && <p className="request-sample-note">{ar ? "بيانات توضيحية محلية — عدّل المنتجات قبل حفظ طلبك. لا يتم إرسال أي شيء تلقائياً." : "Local example requirements — edit before saving. Nothing is sent automatically."}</p>}
      {error && (
        <p
          role="alert"
          ref={errorRef}
          tabIndex={-1}
          className="rounded-sm border border-danger p-md text-danger"
        >
          {error}
        </p>
      )}
      <fieldset disabled={pending} className="request-layout">
        <div className="request-main">
          <div className="request-benefits">
            {[
              [BoltIcon, ar ? "سريع وسهل" : "Quick and easy", ar ? "أضف احتياجاتك في دقائق" : "Add requirements in minutes"],
              [StorefrontIcon, ar ? "معارض مناسبة" : "Suitable showrooms", ar ? "اختر شركاء مشروعك" : "Choose your project partners"],
              [ShieldIcon, ar ? "مقارنة سهلة" : "Easy comparison", ar ? "راجع المواصفات والعروض" : "Review specifications and quotes"],
              [UsersIcon, ar ? "القرار لك" : "You're in control", ar ? "راجع طلبك قبل النشر" : "Review before publishing"],
            ].map(([Icon, label, detail]) => { const I = Icon as typeof BoltIcon; return <div key={String(label)}><I size={30} /><span><strong>{String(label)}</strong><small>{String(detail)}</small></span></div>; })}
          </div>
          <section className="request-section">
            <div className="request-section-heading">
              <span className="request-step">1</span>
              <div><h2>{ar ? "أضف احتياجات مشروعك" : "Add your project requirements"}</h2><p>{ar ? "اختر المنتجات وحدد الكمية والمواصفات لكل منتج في نفس الطلب." : "Add products, quantities and specifications to one request."}</p></div>
              <Button variant="outline" disabled={pending || lines.length >= 30} onClick={() => { const key = crypto.randomUUID(); setLines((old) => [...old, blank(key)]); requestAnimationFrame(() => document.getElementById(`name-${key}`)?.focus()); }}><PlusIcon size={18} />{ar ? "إضافة منتج جديد" : "Add product"}</Button>
            </div>
            <LabeledField label={ar ? "اسم المشروع أو الطلب" : "Project or request title"} htmlFor="request-title"><Input id="request-title" required minLength={2} maxLength={160} placeholder={ar ? "مثال: تشطيب فيلا — التجمع الخامس" : "e.g. Villa finishing — New Cairo"} value={title} onChange={(e) => setTitle(e.target.value)} /></LabeledField>
            <div className="request-items">
            {lines.map((line, index) => (
              <fieldset key={line.key} className="request-item">
                <legend className="sr-only">{ar ? "المنتج" : "Item"} {index + 1}</legend>
                <MaterialThumbnail category={line.categoryCode} />
                <div className="request-item-fields">
                  <div className="request-item-name"><LabeledField label={ar ? "اسم المنتج" : "Product name"} htmlFor={`name-${line.key}`}><Input id={`name-${line.key}`} required minLength={2} maxLength={160} placeholder={ar ? "اسم المنتج المطلوب" : "Product name"} value={line.name} onChange={(e) => patch(line.key, { name: e.target.value })} /></LabeledField>
                  <Button variant="ghost" size="sm" aria-label={ar ? `حذف المنتج ${index + 1}` : `Remove item ${index + 1}`} disabled={pending || lines.length === 1} onClick={() => setLines((old) => old.filter((l) => l.key !== line.key))}><TrashIcon size={16} /></Button></div>
                  <div className="request-item-details">
                    <LabeledField label={ar ? "الصنف" : "Category"} htmlFor={`cat-${line.key}`}><Select id={`cat-${line.key}`} value={line.categoryCode} onChange={(e) => patch(line.key, { categoryCode: e.target.value })}>{CANONICAL_CATEGORY_CODES.map((c) => <option key={c} value={c}>{t(`commerce.canonicalCategories.${c}`)}</option>)}</Select></LabeledField>
                    <LabeledField label={ar ? "الكمية" : "Quantity"} htmlFor={`qty-${line.key}`}><Input id={`qty-${line.key}`} required inputMode="decimal" aria-invalid={invalidQuantities.includes(line.key) || undefined} aria-describedby={invalidQuantities.includes(line.key) ? `qty-help-${line.key}` : undefined} value={line.quantity} onChange={(e) => { patch(line.key, { quantity: e.target.value }); setInvalidQuantities((old) => old.filter((key) => key !== line.key)); }} />{invalidQuantities.includes(line.key) && <p id={`qty-help-${line.key}`} className="text-label text-danger">{quantityHelp}</p>}</LabeledField>
                    <LabeledField label={ar ? "الوحدة" : "Unit"} htmlFor={`unit-${line.key}`}><Select id={`unit-${line.key}`} value={line.unit} onChange={(e) => patch(line.key, { unit: e.target.value })}>{SHARED_UNITS.map((u) => <option key={u} value={u}>{t(`commerce.units.${u}`)}</option>)}</Select></LabeledField>
                    <LabeledField label={ar ? "المواصفات ومكان الاستخدام" : "Specifications and intended use"} htmlFor={`spec-${line.key}`}><Input id={`spec-${line.key}`} maxLength={250} placeholder={ar ? "مثال: حوائط داخلية، مقاوم للمياه" : "e.g. Interior walls, water resistant"} value={line.specs} onChange={(e) => patch(line.key, { specs: e.target.value })} /></LabeledField>
                  </div>
                </div>
              </fieldset>
            ))}
            </div>
          </section>
          <section className="request-section request-location">
            <div className="request-section-heading"><span className="request-step">2</span><div><h2>{ar ? "مكان المشروع" : "Project location"}</h2><p>{ar ? "حدد موقع المشروع وموعد احتياجك للخامات." : "Tell showrooms where and when materials are needed."}</p></div></div>
            <div className="request-two-fields"><LabeledField label={ar ? "موقع المشروع" : "Project location"} htmlFor="location"><Input id="location" maxLength={200} value={location} placeholder={ar ? "المدينة، المنطقة" : "City, area"} onChange={(e) => setLocation(e.target.value)} /></LabeledField><LabeledField label={ar ? "التاريخ المطلوب (اختياري)" : "Needed by (optional)"} htmlFor="needed-by"><Input id="needed-by" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} /></LabeledField></div>
          </section>
          <section className="request-section request-notes">
            <div className="request-section-heading"><span className="request-step">3</span><div><h2>{ar ? "ملاحظات عامة (اختياري)" : "General notes (optional)"}</h2><p>{ar ? "أضف التفاصيل التي تساعد المعارض على فهم طلبك." : "Add details that help showrooms understand your request."}</p></div></div>
            <div><LabeledField label={ar ? "تعليمات التوريد وتفاصيل إضافية" : "Delivery instructions and additional details"} htmlFor="notes"><Textarea id="notes" maxLength={500} rows={3} placeholder={ar ? "موعد التنفيذ، جودة الخامات، أو تعليمات التوريد…" : "Schedule, material quality or delivery instructions…"} value={notes} onChange={(e) => setNotes(e.target.value)} /></LabeledField><p className="request-count">{Array.from(notes).length}/500</p></div>
          </section>
          <section className="request-section">
            <div className="request-section-heading"><span className="request-step">4</span><div><h2>{ar ? "صور مرجعية (اختياري)" : "Reference images (optional)"}</h2><p>{ar ? "أضف صور الموقع أو الخامات لتوضيح احتياجاتك." : "Show your space or materials to make requirements clear."}</p></div></div>
            {!existing && <div className="request-upload-hint"><UploadIcon size={28} /><strong>{ar ? "احفظ المسودة لإرفاق صورك" : "Save your draft to attach images"}</strong><span>{ar ? "صورتان لكل منتج · JPG، PNG، WebP · حتى 5 ميجابايت للصورة" : "Two images per item · JPG, PNG, WebP · up to 5 MB each"}</span></div>}
            {existing && <p>{ar ? "صورتان لكل منتج · JPG، PNG، WebP · حتى 5 ميجابايت للصورة" : "Two images per item · JPG, PNG, WebP · up to 5 MB each"}</p>}
            {existing?.items.map((item) => (
              <div key={item.id} className="flex flex-col gap-3 border-t pt-3">
                <label className="text-label">
                  {item.name}
                  <Input
                    className="mt-2"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={pending || item.images.length >= 2}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void upload(item.id, f);
                      e.target.value = "";
                    }}
                  />
                </label>
                <div className="flex flex-wrap gap-3">
                  {item.images.map((img) => (
                    <div key={img.id}>
                      {imageUrls[img.key] && (
                        <a
                          href={imageUrls[img.key]}
                          target="_blank"
                          rel="noreferrer"
                          className="text-label underline"
                        >
                          {ar ? "عرض الصورة" : "View image"}
                        </a>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            try {
                              const r = await removeRequestImageAction(img.id);
                              if (!r.ok) setError(t(r.code));
                              else router.refresh();
                            } catch {
                              setError(t("states.genericRetry"));
                            }
                          })
                        }
                      >
                        {ar ? "إزالة" : "Remove"}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}

          </section>
          <Button className="request-submit" type="submit" disabled={pending}><SendIcon size={20} />{pending ? (ar ? "جارٍ الحفظ…" : "Saving…") : (ar ? "حفظ المسودة ومراجعة الطلب" : "Save draft & review")}</Button>
          <p className="request-submit-note">{ar ? "راجع طلبك وأضف الصور، ثم انشره للمعارض المناسبة. لا يتم إرسال المسودة." : "Review your request and attach images before publishing. Drafts are not sent."}</p>
        </div>
        <aside className="request-sidebar">
          <section className="request-summary request-section">
            <h2><FileTextIcon size={21} />{ar ? "ملخص الطلب" : "Request summary"}</h2>
            <p>{lines.length} {ar ? "منتجات في هذا الطلب" : "items in this request"}</p>
            {lines.map((line, index) => <button type="button" key={line.key} className="request-summary-item" onClick={() => document.getElementById(`name-${line.key}`)?.focus()} aria-label={ar ? `تعديل المنتج ${index + 1}` : `Edit item ${index + 1}`}><MaterialThumbnail category={line.categoryCode} /><span><strong>{line.name || (ar ? "منتج جديد" : "New item")}</strong><small>{line.quantity} {t(`commerce.units.${line.unit}`)}</small><small>{line.specs || t(`commerce.canonicalCategories.${line.categoryCode}`)}</small></span></button>)}
            <button type="button" className="request-summary-detail" onClick={() => document.getElementById("location")?.focus()}><MapPinIcon size={20} /><span><strong>{ar ? "مكان المشروع" : "Project location"}</strong><small>{location || (ar ? "أضف مكان المشروع" : "Add project location")}</small></span></button>
            <button type="button" className="request-summary-detail" onClick={() => document.getElementById("notes")?.focus()}><FileTextIcon size={20} /><span><strong>{ar ? "ملاحظات عامة" : "General notes"}</strong><small>{notes || (ar ? "لا توجد ملاحظات" : "No notes yet")}</small></span></button>
          </section>
          <section className="request-next request-section"><h2><HelpIcon size={22} />{ar ? "ماذا يحدث بعد النشر؟" : "What happens after publishing?"}</h2><ol>{(ar ? ["يظهر طلبك للمعارض المناسبة.", "تستقبل عروض الأسعار على طلبك.", "قارن المواصفات والكميات والتكلفة.", "اختر العرض الأنسب لمشروعك؛ العروض غير ملزمة."] : ["Eligible showrooms discover your requirements.", "Receive quotations on your request.", "Compare specifications, quantities and cost.", "Choose what suits your project. Quotes are non-binding."]).map((text) => <li key={text}>{text}</li>)}</ol></section>
          <section className="request-section request-showrooms"><h2><StorefrontIcon size={22} />{ar ? "المعارض المناسبة لطلبك" : "Select showrooms"}</h2><p>{ar ? "حدد المعارض، أو اترك القائمة فارغة للوصول لكل المعارض المؤهلة عند النشر." : "Select showrooms, or leave unchecked to reach all eligible showrooms when publishing."}</p>
          {showrooms.length === 0 ? <p>{ar ? "لا توجد معارض متاحة حالياً. سيظهر طلبك للمعارض المؤهلة عند النشر." : "No showrooms are listed yet. Eligible showrooms can discover your published request."}</p> : <div role="group" aria-label={ar ? "المعارض المناسبة لطلبك" : "Select showrooms"}>{showrooms.map((s) => <label key={s.id} className="request-showroom"><span className="request-showroom-mark"><StorefrontIcon size={24} /></span><span>{s.name || (ar ? "معرض بدون اسم" : "Unnamed showroom")}</span><input type="checkbox" checked={showroomIds.includes(s.id)} disabled={!showroomIds.includes(s.id) && showroomIds.length >= 30} onChange={(e) => setShowroomIds((old) => e.target.checked ? [...old, s.id] : old.filter((id) => id !== s.id))} /></label>)}</div>}
          </section>
        </aside>
      </fieldset>
    </form>
  );
}

/** Category imagery is illustrative, never a supplier product photograph. */
function MaterialThumbnail({ category }: { category: string }) {
  const image = category === "marble_alternative" ? "/assets/installer-dashboard/jobs/marble-alt.jpg" : category === "paints" ? "/assets/installer-dashboard/jobs/interior-painting.png" : category === "spc_flooring" || category === "vinyl_flooring" ? "/assets/installer-dashboard/jobs/spc-flooring.jpg" : "/assets/installer-dashboard/jobs/decorative-wall.png";
  return <span className="request-material"><Image src={image} alt="" fill sizes="80px" className="object-cover" /></span>;
}

export function RequestLifecycle({
  id,
  version,
  action,
}: {
  id: string;
  version: number;
  action: "publish" | "close" | "cancel";
}) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const label =
    action === "publish"
      ? ar
        ? "نشر طلب عرض الأسعار"
        : "Publish quotation request"
      : action === "close"
        ? ar
          ? "إغلاق الطلب"
          : "Close request"
        : ar
          ? "إلغاء الطلب"
          : "Cancel request";
  return (
    <ConfirmDialog
      trigger={label}
      title={label}
      confirmLabel={label}
      triggerVariant={action === "publish" ? "accent" : "outline"}
      confirmVariant={action === "publish" ? "primary" : "danger"}
      body={
        action === "publish"
          ? ar
            ? "سيظهر الطلب للمعارض المؤهلة. بعد النشر لن تتمكن من تعديل الخامات."
            : "Eligible showrooms will see your request. Materials cannot be edited after publication."
          : ar
            ? "لن يستقبل الطلب عروضاً جديدة بعد هذه الخطوة."
            : "This request will no longer accept new responses."
      }
      formAction={async () => {
        try {
          const fd = new FormData();
          fd.set("requestId", id);
          fd.set("expectedVersion", String(version));
          fd.set("action", action);
          return await purchaseRequestLifecycleAction({ ok: false }, fd);
        } catch {
          return { ok: false, code: "states.genericRetry" };
        }
      }}
    />
  );
}

