"use client";
import Image from "next/image";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import {
  Button,
  Input,
  Select,
  Textarea,
  LabeledField,
} from "@/components/ui/controls";
import { Card } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  PlusIcon,
  TrashIcon,
  FileTextIcon,
  ShieldIcon,
  BoltIcon,
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
  product,
  imageUrls = {},
  showrooms = [],
  context = { location: "", showroomIds: [] },
}: {
  existing?: OwnRequest;
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
  const [title, setTitle] = useState(existing?.request.title ?? "");
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
      : [
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
      className="flex flex-col gap-lg"
    >
      <header className="engineer-hero relative isolate overflow-hidden rounded-lg p-lg tablet:p-xl">
        <Image
          src="/assets/showroom-auth/showroom-interior-2026.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-30"
        />
        <div className="relative max-w-2xl">
          <h1 className="text-headline">
            {ar
              ? "اطلب عروض أسعار لمشروعك"
              : "Bring your project requirements together"}
          </h1>
          <p className="mt-3 text-body-lg text-fg-secondary">
            {ar
              ? "حدد الخامات والكميات، ثم انشر طلبك للمعارض المناسبة وقارن عروضها."
              : "Specify your materials and quantities, publish to eligible showrooms, and compare their responses."}
          </p>
        </div>
      </header>
      <div className="grid gap-md tablet:grid-cols-3">
        {[
          [BoltIcon, ar ? "سريع وسهل" : "Quick and easy"],
          [ShieldIcon, ar ? "من معارض مناسبة" : "Eligible showrooms"],
          [FileTextIcon, ar ? "مقارنة في مكان واحد" : "Compare in one place"],
        ].map(([Icon, text]) => {
          const I = Icon as typeof BoltIcon;
          return (
            <Card
              key={String(text)}
              pad="sm"
              className="flex items-center gap-md"
            >
              <I size={25} />
              <span className="text-body">{String(text)}</span>
            </Card>
          );
        })}
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-sm border border-danger p-md text-danger"
        >
          {error}
        </p>
      )}
      <div className="grid items-start gap-lg desktop:grid-cols-3">
        <div className="flex flex-col gap-lg desktop:col-span-2">
          <Card className="flex flex-col gap-md">
            <h2 className="text-title">
              1. {ar ? "احتياجات مشروعك" : "Your project requirements"}
            </h2>
            <LabeledField
              label={ar ? "اسم المشروع أو الطلب" : "Project or request title"}
              htmlFor="request-title"
            >
              <Input
                id="request-title"
                required
                minLength={2}
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </LabeledField>
            {lines.map((line, index) => (
              <fieldset
                key={line.key}
                className="grid gap-3 rounded-sm border p-md tablet:grid-cols-2"
              >
                <legend className="px-2 text-label">
                  {ar ? "المنتج" : "Item"} {index + 1}
                </legend>
                <LabeledField
                  label={ar ? "اسم المنتج" : "Product name"}
                  htmlFor={`name-${line.key}`}
                >
                  <Input
                    id={`name-${line.key}`}
                    required
                    minLength={2}
                    maxLength={160}
                    value={line.name}
                    onChange={(e) => patch(line.key, { name: e.target.value })}
                  />
                </LabeledField>
                <LabeledField
                  label={ar ? "الصنف" : "Category"}
                  htmlFor={`cat-${line.key}`}
                >
                  <Select
                    id={`cat-${line.key}`}
                    value={line.categoryCode}
                    onChange={(e) =>
                      patch(line.key, { categoryCode: e.target.value })
                    }
                  >
                    {CANONICAL_CATEGORY_CODES.map((c) => (
                      <option key={c} value={c}>
                        {t(`commerce.canonicalCategories.${c}`)}
                      </option>
                    ))}
                  </Select>
                </LabeledField>
                <LabeledField
                  label={ar ? "الكمية" : "Quantity"}
                  htmlFor={`qty-${line.key}`}
                >
                  <Input
                    id={`qty-${line.key}`}
                    required
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(e) =>
                      patch(line.key, { quantity: e.target.value })
                    }
                  />
                </LabeledField>
                <LabeledField
                  label={ar ? "الوحدة" : "Unit"}
                  htmlFor={`unit-${line.key}`}
                >
                  <Select
                    id={`unit-${line.key}`}
                    value={line.unit}
                    onChange={(e) => patch(line.key, { unit: e.target.value })}
                  >
                    {SHARED_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {t(`commerce.units.${u}`)}
                      </option>
                    ))}
                  </Select>
                </LabeledField>
                <div className="tablet:col-span-2">
                  <LabeledField
                    label={
                      ar
                        ? "المواصفات ومكان الاستخدام"
                        : "Specifications and intended use"
                    }
                    htmlFor={`spec-${line.key}`}
                  >
                    <Input
                      id={`spec-${line.key}`}
                      maxLength={250}
                      value={line.specs}
                      onChange={(e) =>
                        patch(line.key, { specs: e.target.value })
                      }
                    />
                  </LabeledField>
                </div>
                <Button
                  variant="ghost"
                  onClick={() =>
                    setLines((old) => old.filter((l) => l.key !== line.key))
                  }
                  disabled={pending}
                >
                  <TrashIcon size={16} />
                  {ar ? "حذف المنتج" : "Remove item"}
                </Button>
              </fieldset>
            ))}
            <Button
              variant="outline"
              disabled={pending || lines.length >= 30}
              onClick={() =>
                setLines((old) => [...old, blank(crypto.randomUUID())])
              }
            >
              <PlusIcon size={18} />
              {ar ? "إضافة منتج جديد" : "Add another item"}
            </Button>
          </Card>
          <Card className="flex flex-col gap-md">
            <h2 className="text-title">
              2. {ar ? "الموقع وموعد الاحتياج" : "Location and timing"}
            </h2>
            <LabeledField
              label={ar ? "موقع المشروع" : "Project location"}
              htmlFor="location"
            >
              <Input
                id="location"
                maxLength={200}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </LabeledField>
            <LabeledField
              label={ar ? "التاريخ المطلوب (اختياري)" : "Needed by (optional)"}
              htmlFor="needed-by"
            >
              <Input
                id="needed-by"
                type="date"
                value={neededBy}
                onChange={(e) => setNeededBy(e.target.value)}
              />
            </LabeledField>
            <h2 className="mt-3 text-title">
              3.{" "}
              {ar
                ? "ملاحظات عامة (اختياري)"
                : "General notes (optional)"}
            </h2>
            <LabeledField
              label={
                ar
                  ? "تعليمات التوريد وتفاصيل إضافية"
                  : "Delivery instructions and additional details"
              }
              htmlFor="notes"
            >
              <Textarea
                id="notes"
                maxLength={500}
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </LabeledField>
            <span className="text-end text-label text-fg-secondary">
              {Array.from(notes).length}/500
            </span>
          </Card>
          <Card className="flex flex-col gap-md">
            <h2 className="text-title">
              4. {ar ? "صور مرجعية" : "Reference images"}
            </h2>
            <p className="text-body text-fg-secondary">
              {ar
                ? "احفظ المسودة أولاً، ثم أضف صورتين لكل منتج (JPG، PNG، WebP، بحد أقصى 5 ميجابايت)."
                : "Save your draft first, then attach up to two images per item (JPG, PNG, WebP; 5 MB each)."}
            </p>
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
          </Card>
          <Button type="submit" disabled={pending}>
            {pending
              ? ar
                ? "جارٍ الحفظ…"
                : "Saving…"
              : ar
                ? "حفظ المسودة ومراجعة الطلب"
                : "Save draft & review"}
          </Button>
        </div>
        <aside className="flex flex-col gap-md">
          <Card className="flex flex-col gap-3">
            <h2 className="text-title">
              {ar ? "المعارض المناسبة لطلبك" : "Select showrooms"}
            </h2>
            <p className="text-label text-fg-secondary">
              {ar
                ? "اختر معارض محددة، أو اترك القائمة فارغة ليظهر طلبك لكل المعارض المؤهلة."
                : "Choose specific showrooms, or leave all unchecked to reach every eligible showroom."}
            </p>
            {showrooms.map((s) => (
              <label key={s.id} className="flex items-center gap-3 text-body">
                <input
                  type="checkbox"
                  checked={showroomIds.includes(s.id)}
                  onChange={(e) =>
                    setShowroomIds((old) =>
                      e.target.checked
                        ? [...old, s.id]
                        : old.filter((id) => id !== s.id),
                    )
                  }
                  disabled={
                    !showroomIds.includes(s.id) && showroomIds.length >= 30
                  }
                />
                {s.name}
              </label>
            ))}
          </Card>
          <Card className="flex flex-col gap-md">
            <h2 className="text-title">
              {ar ? "ملخص الطلب" : "Request summary"}
            </h2>
            <p className="text-body text-fg-secondary">
              {lines.length}{" "}
              {ar ? "منتجات في هذا الطلب" : "items in this request"}
            </p>
            {lines.map((l) => (
              <div key={l.key} className="border-t pt-3">
                <p className="text-body font-medium">
                  {l.name || (ar ? "منتج جديد" : "New item")}
                </p>
                <p className="text-label text-fg-secondary">
                  {l.quantity} {t(`commerce.units.${l.unit}`)}
                </p>
              </div>
            ))}
            <p className="border-t pt-3 text-body text-fg-secondary">
              {ar
                ? "لا يتم إرسال المسودة. ستتمكن من مراجعتها ثم نشرها للمعارض المؤهلة."
                : "Drafts are not sent. Review your saved request before publishing it to eligible showrooms."}
            </p>
          </Card>
          <Card>
            <h2 className="mb-3 text-title">
              {ar ? "ماذا يحدث بعد النشر؟" : "What happens after publishing?"}
            </h2>
            <ol className="list-inside list-decimal space-y-3 text-body text-fg-secondary">
              <li>
                {ar
                  ? "تظهر احتياجاتك للمعارض المناسبة."
                  : "Eligible showrooms can discover your requirements."}
              </li>
              <li>
                {ar
                  ? "تستقبل عروض الأسعار على طلبك."
                  : "Their responses appear on your request."}
              </li>
              <li>
                {ar
                  ? "قارن المواصفات والكميات والتكلفة."
                  : "Compare specifications, quantities and cost."}
              </li>
              <li>
                {ar
                  ? "العروض غير ملزمة ولا تنشئ طلب شراء تلقائياً."
                  : "Responses are non-binding and do not create an order."}
              </li>
            </ol>
          </Card>
        </aside>
      </div>
    </form>
  );
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
