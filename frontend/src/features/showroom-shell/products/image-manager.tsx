"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { ProductMedia } from "@/features/commerce/product-media";
import { Badge, InlineError } from "@/components/ui/primitives";
import { ChevronLeftIcon, ChevronRightIcon, PencilIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";
import {
  PRODUCT_IMAGE_ALLOWED_TYPES,
  PRODUCT_IMAGE_MAX_COUNT,
  moveImage,
  remainingImageSlots,
  validateProductImageFile,
} from "@/lib/storage/product-images";
import { removeProductImageAction, reorderProductImagesAction, reorderProductMediaAction } from "@/server/actions/own-products";
import { mergeMedia } from "@/lib/media/media-order";
import { VideoPlayer } from "@/features/video/video-player";
import { useProcessingRefresh } from "@/features/video/video-manager";
import type { ManagedVideo } from "@/server/queries/videos";
import { uploadProductImage } from "./upload-image";

export type ManagedImage = { id: string; url: string | null; slot: number };
type Entry = { kind: "image"; item: ManagedImage } | { kind: "video"; item: ManagedVideo };

const iconButton =
  "inline-flex h-8 w-8 items-center justify-center rounded-sm border border-strong bg-surface text-fg-secondary transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Up to three owned photos, ordered; the first is the main photo.
 *
 * Upload follows the repository's ownership model exactly (as the avatar does):
 *   1. `product_image_request_upload` creates the PENDING metadata row and returns
 *      a server-minted, organization/product-scoped key — Storage refuses any key
 *      that row does not already name for this caller;
 *   2. the bytes go straight from the browser to the private bucket under that key;
 *   3. the server action confirms the object exists and flips the row to ready.
 * The three-item limit is enforced by the database (RPC and trigger); the count
 * shown here only avoids offering what would be refused.
 *
 * With `videos` (uploads to R2 enabled), photos and videos share the three slots
 * in one order: a video may come first. Videos are uploaded in the video section
 * below and appear here once they hold a slot.
 */
export function ImageManager({ productId, productName, images, archived, videos }: {
  productId: string; productName: string; images: ManagedImage[]; archived: boolean; videos?: ManagedVideo[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const addInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replacing = useRef<ManagedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mixed = videos !== undefined;
  const entries: Entry[] = mergeMedia(images.map((image) => ({ ...image, position: image.slot })), videos ?? []);
  const free = remainingImageSlots(entries.length);
  useProcessingRefresh(videos ?? []);
  const accept = PRODUCT_IMAGE_ALLOWED_TYPES.join(",");

  const upload = (file: File) => uploadProductImage(productId, file);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
      router.refresh();
    } catch (e) {
      const code = e instanceof Error && e.message.includes(".") ? e.message : "showroomProducts.images.errorUpload";
      setError(t(code));
    } finally {
      setBusy(false);
    }
  }

  const accepted = (file: File | undefined): file is File => {
    if (!file) return false;
    const valid = validateProductImageFile(file);
    if (!valid.ok) {
      setError(t(valid.code));
      return false;
    }
    return true;
  };

  const onAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    setError(null);
    if (!accepted(file)) return;
    void run(async () => {
      await upload(file);
    });
  };

  const onReplace = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const target = replacing.current;
    replacing.current = null;
    setError(null);
    if (!target || !accepted(file)) return;
    void run(async () => {
      const ids = images.map((i) => i.id);
      if (free === 0) {
        // Full: the old photo goes first, so the new one takes its freed slot.
        const removed = await removeProductImageAction(target.id);
        if (!removed.ok) throw new Error(removed.code);
        await upload(file);
        return;
      }
      // Room to spare: upload first (a failed upload never costs the existing photo), then swap in place.
      const newId = await upload(file);
      const removed = await removeProductImageAction(target.id);
      if (!removed.ok) throw new Error(removed.code);
      const reordered = mixed
        ? await reorderProductMediaAction(productId, readyOrder(entries).map((e) => (e.id === target.id ? { ...e, id: newId } : e)))
        : await reorderProductImagesAction(productId, ids.map((id) => (id === target.id ? newId : id)));
      if (!reordered.ok) throw new Error(reordered.code);
    });
  };

  const onRemove = (image: ManagedImage) =>
    run(async () => {
      const removed = await removeProductImageAction(image.id);
      if (!removed.ok) throw new Error(removed.code);
    });

  const onRemoveVideo = (video: ManagedVideo) =>
    run(async () => {
      const response = await fetch(`/api/video/${video.id}`, { method: "DELETE", credentials: "same-origin" }).catch(() => null);
      if (!response?.ok) throw new Error("video.error.server");
    });

  const onMove = (index: number, delta: -1 | 1) =>
    run(async () => {
      const result = mixed
        ? await reorderProductMediaAction(productId, readyOrder(moveImage(entries, index, delta)))
        : await reorderProductImagesAction(productId, moveImage(images.map((i) => i.id), index, delta));
      if (!result.ok) throw new Error(result.code);
    });

  // Only finished items take part in reordering; an upload in progress keeps its slot.
  const movable = (index: number) => entries[index] !== undefined && isReady(entries[index]);
  const firstImage = entries.findIndex((e) => e.kind === "image");

  return (
    <section className="flex flex-col gap-sm" aria-labelledby="product-images-title" data-testid="image-manager">
      <div className="flex flex-wrap items-baseline gap-x-md gap-y-1">
        <h2 id="product-images-title" className="text-label font-medium text-fg-secondary">{t("showroomProducts.images.title")}</h2>
        <p className="text-label text-fg-muted" data-testid="image-count">{t(mixed ? "showroomProducts.images.countMedia" : "showroomProducts.images.count", { count: String(entries.length) })}</p>
      </div>
      <p className="text-label text-fg-muted">{t(mixed ? "showroomProducts.images.hintMedia" : "showroomProducts.images.hint")}</p>

      {archived ? <p className="text-label text-fg-muted">{t("showroomProducts.images.errorArchived")}</p> : null}

      <ul className="grid grid-cols-3 gap-sm" data-testid="image-slots">
        {Array.from({ length: PRODUCT_IMAGE_MAX_COUNT }, (_, index) => {
          const entry = entries[index];
          const image = entry?.kind === "image" ? entry.item : undefined;
          const moveButtons = (
            <>
              <button type="button" className={iconButton} disabled={busy || index === 0 || !movable(index) || !movable(index - 1)} onClick={() => void onMove(index, -1)} aria-label={t("showroomProducts.images.moveEarlier")} title={t("showroomProducts.images.moveEarlier")}>
                <span aria-hidden="true" className="inline-flex rtl:rotate-180"><ChevronLeftIcon size={15} /></span>
              </button>
              <button type="button" className={iconButton} disabled={busy || index === entries.length - 1 || !movable(index) || !movable(index + 1)} onClick={() => void onMove(index, 1)} aria-label={t("showroomProducts.images.moveLater")} title={t("showroomProducts.images.moveLater")}>
                <span aria-hidden="true" className="inline-flex rtl:rotate-180"><ChevronRightIcon size={15} /></span>
              </button>
            </>
          );
          if (entry?.kind === "video") {
            const video = entry.item;
            const label = t("showroomProducts.images.videoN", { n: index + 1 });
            return (
              <li key={video.id} className="flex min-w-0 flex-col gap-1.5" data-testid="gallery-video" data-state={video.state}>
                <div className="relative aspect-square overflow-hidden rounded-sm border bg-black">
                  {video.state === "ready" && video.playback ? (
                    <VideoPlayer fill source={video.playback} title={video.title} width={video.width} height={video.height}
                      labels={{ play: t("video.play", { title: video.title }), unavailable: t("video.unavailable") }} />
                  ) : (
                    <p className="grid h-full place-items-center bg-surface-2 px-1 text-center text-label text-fg-secondary" data-testid="video-state">
                      {t(`video.state.${video.state}`)}
                    </p>
                  )}
                </div>
                {!archived ? (
                  <div className="flex flex-wrap justify-center gap-1" role="group" aria-label={label}>
                    {moveButtons}
                    <button type="button" className={cn(iconButton, "text-danger hover:text-danger")} disabled={busy} onClick={() => void onRemoveVideo(video)} aria-label={t("video.actions.delete")} title={t("video.actions.delete")}>
                      <TrashIcon size={15} />
                    </button>
                  </div>
                ) : null}
              </li>
            );
          }
          return (
            <li key={image?.id ?? `empty-${index}`} className="flex min-w-0 flex-col gap-1.5">
              {image ? (
                <>
                  <div className="relative">
                    <ProductMedia src={image.url} alt={`${productName} — ${t("showroomProducts.images.photoN", { n: index + 1 })}`} aspect="aspect-square" />
                    {index === firstImage ? <span className="absolute start-1 top-1 rounded-pill bg-surface"><Badge tone="accent">{t("showroomProducts.images.primary")}</Badge></span> : null}
                  </div>
                  {!archived ? (
                    <div className="flex flex-wrap justify-center gap-1" role="group" aria-label={t("showroomProducts.images.photoN", { n: index + 1 })}>
                      {moveButtons}
                      <button
                        type="button"
                        className={iconButton}
                        disabled={busy}
                        onClick={() => {
                          replacing.current = image;
                          replaceInput.current?.click();
                        }}
                        aria-label={t("showroomProducts.images.replace")}
                        title={t("showroomProducts.images.replace")}
                      >
                        <PencilIcon size={15} />
                      </button>
                      <button type="button" className={cn(iconButton, "text-danger hover:text-danger")} disabled={busy} onClick={() => void onRemove(image)} aria-label={t("showroomProducts.images.remove")} title={t("showroomProducts.images.remove")}>
                        <TrashIcon size={15} />
                      </button>
                    </div>
                  ) : null}
                </>
              ) : (
                <button
                  type="button"
                  disabled={busy || archived || index !== entries.length}
                  onClick={() => addInput.current?.click()}
                  className="grid aspect-square w-full place-items-center rounded-sm border border-dashed border-strong bg-surface text-fg-muted transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={t("showroomProducts.images.add")}
                  data-testid="image-add"
                >
                  <span className="flex flex-col items-center gap-1 px-1 text-center text-label">
                    <PlusIcon size={18} />
                    <span className="hidden tablet:inline">{t("showroomProducts.images.add")}</span>
                  </span>
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <input ref={addInput} type="file" accept={accept} className="sr-only" tabIndex={-1} onChange={onAdd} data-testid="image-input" />
      <input ref={replaceInput} type="file" accept={accept} className="sr-only" tabIndex={-1} onChange={onReplace} data-testid="image-replace-input" />

      {busy ? <p role="status" className="text-label text-fg-muted">{t("showroomProducts.images.uploading")}</p> : null}
      {free === 0 && !archived ? <p className="text-label text-fg-muted">{t(mixed ? "showroomProducts.images.fullMedia" : "showroomProducts.images.full")}</p> : null}
      {entries.length === 0 && !archived ? <p className="text-label text-fg-muted">{t("showroomProducts.images.none")}</p> : null}
      {error ? <InlineError>{error}</InlineError> : null}
    </section>
  );
}

function isReady(entry: Entry): boolean {
  return entry.kind === "image" || entry.item.state === "ready";
}

/** The ready photos and videos in display order, as `product_media_reorder` expects them. */
function readyOrder(entries: readonly Entry[]): { kind: "image" | "video"; id: string }[] {
  return entries.filter(isReady).map((e) => ({ kind: e.kind, id: e.item.id }));
}
