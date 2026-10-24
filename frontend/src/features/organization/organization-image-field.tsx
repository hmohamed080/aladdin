"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Cropper, { type Area } from "react-easy-crop";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/controls";
import { InlineError, InlineSuccess } from "@/components/ui/primitives";
import { StorefrontIcon } from "@/components/ui/icons";
import { uploadWithGrant } from "@/lib/storage/browser-upload";
import { encodeCanvasWithin, ImagePrepareError } from "@/lib/media/resize-image";
import {
  ORGANIZATION_IMAGE_ALLOWED_TYPES,
  ORGANIZATION_IMAGE_MAX_BYTES,
  ORGANIZATION_IMAGE_OUTPUT_PX,
  ORGANIZATION_IMAGE_OUTPUT_TYPE,
  validateOrganizationImageFile,
} from "@/lib/storage/organization-image-assets";
import {
  confirmOrganizationImageUploadAction,
  removeOrganizationImageAction,
  requestOrganizationImageUploadAction,
} from "@/server/actions/organization-image";

/**
 * Renders the chosen square of the source image into a fixed 640 px asset. WebP
 * where the browser can encode it — which keeps a logo's transparency — else PNG
 * for alpha-capable sources and JPEG (on white) for opaque ones.
 */
async function cropToBlob(src: string, area: Area, sourceType: string): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ImagePrepareError("decode"));
    img.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = ORGANIZATION_IMAGE_OUTPUT_PX;
  canvas.height = ORGANIZATION_IMAGE_OUTPUT_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImagePrepareError("canvas");
  const opaque = sourceType === "image/jpeg";
  if (opaque) {
    // Only a JPEG source can become a JPEG; the fill is pixel data under it, not a themed colour.
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, ORGANIZATION_IMAGE_OUTPUT_PX, ORGANIZATION_IMAGE_OUTPUT_PX);
  }
  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, ORGANIZATION_IMAGE_OUTPUT_PX, ORGANIZATION_IMAGE_OUTPUT_PX);
  return encodeCanvasWithin(canvas, 0.9, opaque ? ORGANIZATION_IMAGE_OUTPUT_TYPE : "image/png", ORGANIZATION_IMAGE_MAX_BYTES);
}

/**
 * The Showroom's business profile image: select -> crop (square) -> upload -> confirm, or remove. Same
 * pending->ready ownership model as the personal avatar, but a different bucket, table and permission
 * (org.manage on THIS organization). `canManage` only decides what chrome is drawn; the database refuses
 * everyone else. Members who cannot manage see the image without controls.
 */
export function OrganizationImageField({ orgId, imageUrl, canManage }: { orgId: string; imageUrl: string | null; canManage: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState("image/jpeg");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => () => {
    if (source) URL.revokeObjectURL(source);
  }, [source]);

  const reset = useCallback(() => {
    setSource(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setArea(null);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setNotice(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const valid = validateOrganizationImageFile(file);
    if (!valid.ok) {
      setError(t(valid.code));
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setSourceType(file.type);
    setSource(URL.createObjectURL(file));
  };

  const onSave = async () => {
    if (!source || !area) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await cropToBlob(source, area, sourceType);
      const ticket = await requestOrganizationImageUploadAction(orgId, blob.type, blob.size);
      if (!ticket.ok) throw new Error(ticket.code);
      await uploadWithGrant(ticket.grant, blob);
      const confirmed = await confirmOrganizationImageUploadAction(ticket.key);
      if (!confirmed.ok) throw new Error(confirmed.code);
      reset();
      setNotice(t("showroomSettings.image.saved"));
      router.refresh();
    } catch (e) {
      // A photo this device could not crop or fit is named as such, not reported as a failed upload.
      setError(t(e instanceof ImagePrepareError ? "showroomSettings.image.errorPrepare" : "showroomSettings.image.errorUpload"));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    setBusy(true);
    setError(null);
    const result = await removeOrganizationImageAction(orgId);
    setBusy(false);
    setConfirmRemove(false);
    if (!result.ok) {
      setError(t("showroomSettings.image.errorRemove"));
      return;
    }
    setNotice(t("showroomSettings.image.removed"));
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-sm" data-testid="organization-image-field">
      <span className="text-label font-medium text-fg-secondary">{t("showroomSettings.image.label")}</span>
      <div className="flex flex-wrap items-center gap-md">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a static asset
          <img src={imageUrl} alt={t("showroomSettings.image.label")} width={96} height={96} decoding="async" className="h-24 w-24 rounded-md border object-cover" data-testid="organization-image-current" />
        ) : (
          <span aria-hidden="true" className="grid h-24 w-24 place-items-center rounded-md bg-surface-2 text-fg-muted" data-testid="organization-image-empty">
            <StorefrontIcon size={32} />
          </span>
        )}
        {canManage ? (
          <div className="flex flex-col gap-1.5">
            <input
              ref={inputRef}
              type="file"
              accept={ORGANIZATION_IMAGE_ALLOWED_TYPES.join(",")}
              className="sr-only"
              id="organization-image-input"
              data-testid="organization-image-input"
              onChange={onPick}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
                {imageUrl ? t("showroomSettings.image.change") : t("showroomSettings.image.add")}
              </Button>
              {imageUrl && !confirmRemove ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmRemove(true)} disabled={busy} data-testid="organization-image-remove">
                  {t("showroomSettings.image.remove")}
                </Button>
              ) : null}
            </div>
            {confirmRemove ? (
              <div className="flex flex-wrap items-center gap-2 text-label text-fg-secondary" role="alertdialog" aria-label={t("showroomSettings.image.removeConfirm")}>
                <span>{t("showroomSettings.image.removeConfirm")}</span>
                <Button type="button" variant="danger" size="sm" onClick={onRemove} disabled={busy} data-testid="organization-image-remove-confirm">
                  {t("showroomSettings.image.removeYes")}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmRemove(false)} disabled={busy}>
                  {t("showroomSettings.image.cancel")}
                </Button>
              </div>
            ) : null}
            <p className="max-w-xs text-label text-fg-muted">{t("showroomSettings.image.hint")}</p>
          </div>
        ) : null}
      </div>
      {notice ? <InlineSuccess>{notice}</InlineSuccess> : null}
      {error && !source ? <InlineError>{error}</InlineError> : null}

      {source ? (
        <div role="dialog" aria-modal="true" aria-labelledby="organization-image-crop-title" className="fixed inset-0 z-50 flex items-center justify-center bg-brand-deep-navy/60 p-md">
          <div className="flex w-full max-w-md flex-col gap-md rounded-lg bg-surface p-md shadow-lg">
            <h2 id="organization-image-crop-title" className="text-title text-fg">{t("showroomSettings.image.cropTitle")}</h2>
            <div className="relative h-72 w-full overflow-hidden rounded-md bg-surface-2" data-testid="organization-image-cropper">
              <Cropper
                image={source}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="rect"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, pixels) => setArea(pixels)}
              />
            </div>
            <label className="flex items-center gap-sm text-label text-fg-secondary">
              {t("showroomSettings.image.zoom")}
              <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1" aria-label={t("showroomSettings.image.zoom")} />
            </label>
            {error ? <InlineError>{error}</InlineError> : null}
            <div className="flex justify-end gap-sm">
              <Button type="button" variant="ghost" onClick={reset} disabled={busy}>{t("showroomSettings.image.cancel")}</Button>
              <Button type="button" onClick={onSave} disabled={busy || !area} data-testid="organization-image-save">
                {busy ? t("showroomSettings.image.saving") : t("showroomSettings.image.save")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
