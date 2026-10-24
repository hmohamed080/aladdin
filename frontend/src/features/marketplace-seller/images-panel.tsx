"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Button, Select } from "@/components/ui/controls";
import { UploadIcon } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";
import { finishPendingImageRemovalsAction, removeImageAction, updateImagesAction } from "@/server/actions/marketplace-seller";
import { errorKey } from "./errors";
import { ACCEPTED_IMAGE_TYPES, uploadProductImages } from "./image-upload";
import type { SellerProductImage } from "@/server/queries/marketplace-seller-catalog";

type Arranged = SellerProductImage;

/**
 * Product images through the trusted workflow:
 *   1. the server issues an org/product-scoped key and a pending row;
 *   2. the browser uploads the bytes to that key (the storage policy refuses any
 *      key the server did not issue);
 *   3. the server CONFIRMS by finding the object in storage — only then is the
 *      image shown as uploaded.
 * An uploaded image is never "approved": its content stays pending review until a
 * verification pipeline exists, and customers do not see it before that.
 */
export function ImagesPanel({
  productId,
  images,
  pendingRemovals = 0,
  variants,
}: {
  productId: string;
  images: SellerProductImage[];
  /** Removals marked but not confirmed deleted yet — shown so a failed delete is retried, not forgotten. */
  pendingRemovals?: number;
  variants: { id: string; sku: string }[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Arranged[]>(images.filter((i) => i.uploadState === "confirmed"));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pending, startTransition] = useTransition();

  // A server refresh (after an upload) brings new signed URLs: take them unless the seller is mid-arrangement.
  useEffect(() => {
    if (!dirty) setItems(images.filter((i) => i.uploadState === "confirmed"));
  }, [images, dirty]);

  const upload = async (files: FileList | File[]) => {
    setMessage(null);
    const failures = await uploadProductImages(productId, Array.from(files), setBusy);
    const first = failures[0];
    if (first) setMessage({ tone: "error", text: `${first.name}: ${t(errorKey(first.code))}` });
    setDirty(false);
    router.refresh();
  };

  const move = (index: number, by: -1 | 1) => {
    const next = [...items];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setItems(next);
    setDirty(true);
  };

  const makePrimary = (id: string) => {
    setItems((prev) => prev.map((i) => ({ ...i, isPrimary: i.id === id && !i.variantId })));
    setDirty(true);
  };

  const setVariant = (id: string, variantId: string) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, variantId: variantId || null, isPrimary: variantId ? false : i.isPrimary } : i)),
    );
    setDirty(true);
  };

  const saveArrangement = () => {
    setMessage(null);
    startTransition(async () => {
      const r = await updateImagesAction(
        productId,
        items.map((i, index) => ({ id: i.id, sort_order: index, is_primary: i.isPrimary, variant_id: i.variantId })),
      );
      if (!r.ok) return setMessage({ tone: "error", text: t(errorKey(r.code)) });
      setDirty(false);
      setMessage({ tone: "ok", text: t("marketplaceSeller.image.arrangementSaved") });
      router.refresh();
    });
  };

  const finishRemovals = () => {
    setMessage(null);
    startTransition(async () => {
      const r = await finishPendingImageRemovalsAction(productId);
      if (!r.ok) return setMessage({ tone: "error", text: t(errorKey(r.code)) });
      setMessage({ tone: "ok", text: t("marketplaceSeller.image.removalDone") });
      router.refresh();
    });
  };

  const remove = (id: string) => {
    setMessage(null);
    startTransition(async () => {
      const r = await removeImageAction(id);
      if (!r.ok) return setMessage({ tone: "error", text: t(errorKey(r.code)) });
      setItems((prev) => prev.filter((i) => i.id !== id));
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-md">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-sm rounded-md border-2 border-dashed px-md py-lg text-center",
          dragOver ? "border-accent bg-accent-solid/10" : "border-strong bg-surface-2/40",
        )}
      >
        <UploadIcon size={22} />
        <p className="text-body text-fg-secondary">
          {t("marketplaceSeller.image.drop")}{" "}
          <button type="button" className="font-medium text-accent underline-offset-2 hover:underline" onClick={() => inputRef.current?.click()}>
            {t("marketplaceSeller.image.browse")}
          </button>
        </p>
        <p className="text-label text-fg-muted">{t("marketplaceSeller.image.hint")}</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(",")}
          multiple
          className="sr-only"
          onChange={(e) => {
            if (e.target.files?.length) void upload(e.target.files);
            e.target.value = "";
          }}
        />
        {busy ? (
          <p role="status" className="text-label text-fg-secondary">
            {t("marketplaceSeller.image.uploading", { name: busy })}
          </p>
        ) : null}
      </div>

      {pendingRemovals > 0 ? (
        <div role="alert" className="flex flex-wrap items-center gap-sm rounded-md border border-warning/40 bg-warning/10 px-md py-sm">
          <p className="text-label text-fg-secondary">{t("marketplaceSeller.image.pendingRemoval", { count: pendingRemovals })}</p>
          <Button size="sm" variant="outline" onClick={finishRemovals} disabled={pending}>
            {t("marketplaceSeller.image.retryRemoval")}
          </Button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="text-label text-fg-muted">{t("marketplaceSeller.image.empty")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-md tablet:grid-cols-3 desktop:grid-cols-4">
          {items.map((img, index) => (
            <li key={img.id} className={cn("flex flex-col gap-xs rounded-md border bg-surface p-xs", img.isPrimary && "border-accent")}>
              <div className="relative aspect-square overflow-hidden rounded-sm bg-surface-2">
                {img.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL of a private object
                  <img src={img.url} alt="" className="h-full w-full object-cover" />
                ) : null}
                {img.isPrimary ? (
                  <span className="absolute start-1 top-1 rounded-pill bg-accent-solid px-2 py-0.5 text-label text-on-accent ring-1 ring-accent-edge">
                    {t("marketplaceSeller.image.primary")}
                  </span>
                ) : null}
              </div>
              <span className="text-label text-fg-secondary">
                {t("marketplaceSeller.image.uploaded")} ·{" "}
                {img.status === "verified" ? t("marketplaceSeller.image.verified") : t("marketplaceSeller.image.pendingReview")}
              </span>
              <Select
                aria-label={t("marketplaceSeller.image.forVariant")}
                value={img.variantId ?? ""}
                onChange={(e) => setVariant(img.id, e.target.value)}
                size="compact"
              >
                <option value="">{t("marketplaceSeller.image.forProduct")}</option>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.sku}
                  </option>
                ))}
              </Select>
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" onClick={() => move(index, -1)} disabled={index === 0} aria-label={t("marketplaceSeller.image.moveEarlier")}>
                  ↑
                </Button>
                <Button size="sm" variant="ghost" onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label={t("marketplaceSeller.image.moveLater")}>
                  ↓
                </Button>
                {!img.isPrimary && !img.variantId ? (
                  <Button size="sm" variant="ghost" onClick={() => makePrimary(img.id)}>
                    {t("marketplaceSeller.image.makePrimary")}
                  </Button>
                ) : null}
                <Button size="sm" variant="danger" onClick={() => remove(img.id)} disabled={pending}>
                  {t("marketplaceSeller.image.remove")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dirty ? (
        <div>
          <Button variant="outline" onClick={saveArrangement} disabled={pending}>
            {t("marketplaceSeller.image.saveArrangement")}
          </Button>
        </div>
      ) : null}
      {message ? (
        <p role={message.tone === "error" ? "alert" : "status"} className={cn("text-label", message.tone === "error" ? "text-danger" : "text-success")}>
          {message.text}
        </p>
      ) : null}
      <p className="text-label text-fg-muted">{t("marketplaceSeller.image.reviewNote")}</p>
    </div>
  );
}
