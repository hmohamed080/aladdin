"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Cropper, { type Area } from "react-easy-crop";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/controls";
import { InlineError } from "@/components/ui/primitives";
import { uploadWithGrant } from "@/lib/storage/browser-upload";
import { AVATAR_MAX_BYTES } from "@/lib/storage/avatar-assets";
import { confirmCoverUploadAction, requestCoverUploadAction } from "@/server/actions/profile-identity";

/** Same cover shape and size as the Craftsman hero: the public profile draws it at 6:1. */
const COVER_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const COVER_ASPECT = 6;
const COVER_OUTPUT_WIDTH_PX = 1800;
const COVER_OUTPUT_HEIGHT_PX = 300;
const COVER_OUTPUT_TYPE = "image/jpeg";

/** Renders the chosen 6:1 region of the source image into a fixed-size JPEG. */
async function cropToBlob(src: string, area: Area): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = COVER_OUTPUT_WIDTH_PX;
  canvas.height = COVER_OUTPUT_HEIGHT_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  // JPEG has no alpha: flatten transparency to white rather than black. This is
  // pixel data baked into the uploaded file, not a themed UI colour.
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), COVER_OUTPUT_TYPE, 0.88),
  );
}

/**
 * The profile cover banner with its "Change cover" control. Select -> crop
 * (fixed 6:1) -> the shared avatar pipeline (pending row -> `uploadWithGrant`
 * -> verified bytes -> confirm), so the failed-upload and limit rules of
 * ADR-0032 apply with nothing cover-specific.
 *
 * With no cover yet the banner shows a neutral token-coloured surface — never an
 * invented picture. Failure leaves the current cover untouched.
 */
export function CoverField({ coverUrl }: { coverUrl: string | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const file = e.target.files?.[0];
    if (!file) return;
    if (!(COVER_ALLOWED_TYPES as readonly string[]).includes(file.type) || file.size <= 0) {
      setError(t("profileIdentity.cover.errorUpload"));
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setSource(URL.createObjectURL(file));
  };

  const onSave = async () => {
    if (!source || !area) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await cropToBlob(source, area);
      if (blob.size > AVATAR_MAX_BYTES) throw new Error("too large");
      const ticket = await requestCoverUploadAction(blob.type, blob.size);
      if (!ticket.ok) throw new Error(ticket.code);
      await uploadWithGrant(ticket.grant, blob, { namespace: "avatar", key: ticket.key });
      const confirmed = await confirmCoverUploadAction(ticket.key);
      if (!confirmed.ok) throw new Error(confirmed.code);
      reset();
      router.refresh();
    } catch {
      setError(t("profileIdentity.cover.errorUpload"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="engineer-cover" data-testid="cover-field">
      {coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a static asset
        <img src={coverUrl} alt="" className="engineer-cover-img" data-testid="cover-current" />
      ) : (
        <div className="engineer-cover-fallback" aria-hidden="true" />
      )}
      <input
        ref={inputRef}
        type="file"
        accept={COVER_ALLOWED_TYPES.join(",")}
        className="sr-only"
        id="cover-input"
        data-testid="cover-input"
        onChange={onPick}
      />
      <Button type="button" variant="outline" size="sm" className="engineer-cover-button" onClick={() => inputRef.current?.click()}>
        {coverUrl ? t("profileIdentity.cover.change") : t("profileIdentity.cover.add")}
      </Button>
      {error && !source ? <div className="engineer-cover-error"><InlineError>{error}</InlineError></div> : null}

      {source ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cover-crop-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-md"
        >
          <div className="flex w-full max-w-2xl flex-col gap-md rounded-lg bg-surface p-md shadow-lg">
            <h2 id="cover-crop-title" className="text-title text-fg">
              {t("profileIdentity.cover.cropTitle")}
            </h2>
            <div className="relative h-56 w-full overflow-hidden rounded-md bg-surface-2" data-testid="cover-cropper">
              <Cropper
                image={source}
                crop={crop}
                zoom={zoom}
                aspect={COVER_ASPECT}
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, pixels) => setArea(pixels)}
              />
            </div>
            <label className="flex items-center gap-sm text-label text-fg-secondary">
              {t("profileIdentity.cover.zoom")}
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1"
                aria-label={t("profileIdentity.cover.zoom")}
              />
            </label>
            {error ? <InlineError>{error}</InlineError> : null}
            <div className="flex justify-end gap-sm">
              <Button type="button" variant="ghost" onClick={reset} disabled={busy}>
                {t("profileIdentity.cover.cancel")}
              </Button>
              <Button type="button" onClick={onSave} disabled={busy || !area}>
                {busy ? t("profileIdentity.cover.saving") : t("profileIdentity.cover.save")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
