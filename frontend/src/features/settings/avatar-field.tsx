"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Cropper, { type Area } from "react-easy-crop";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/controls";
import { InlineError, InlineSuccess } from "@/components/ui/primitives";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  AVATAR_ALLOWED_TYPES,
  AVATAR_BUCKET,
  AVATAR_OUTPUT_PX,
  AVATAR_OUTPUT_TYPE,
  validateAvatarFile,
} from "@/lib/storage/avatar-assets";
import { confirmAvatarUploadAction, requestAvatarUploadAction } from "@/server/actions/profile-identity";

/** Renders the chosen square of the source image into a fixed-size JPEG. */
async function cropToBlob(src: string, area: Area): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_OUTPUT_PX;
  canvas.height = AVATAR_OUTPUT_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  // JPEG has no alpha: a transparent PNG would otherwise flatten to black. This
  // is pixel data baked into the uploaded file, not a themed UI colour.
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, AVATAR_OUTPUT_PX, AVATAR_OUTPUT_PX);
  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, AVATAR_OUTPUT_PX, AVATAR_OUTPUT_PX);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), AVATAR_OUTPUT_TYPE, 0.9),
  );
}

/**
 * Select → crop (drag / pinch / zoom, fixed 1:1, circular preview) → upload →
 * confirm. Uses the avatar_uploads pending→ready ownership model exactly:
 *
 *   1. avatar_request_upload creates the PENDING metadata row and returns a
 *      server-generated key — the storage INSERT policy refuses any key that
 *      row does not already name for this caller;
 *   2. the cropped bytes go straight from the browser to Storage under that key;
 *   3. avatar_confirm_upload flips it to ready, points profiles.avatar_media_id
 *      at it, and the previous object is cleaned up server-side.
 *
 * A failed upload leaves only an invisible pending row and the current avatar
 * untouched; Cancel discards everything local and uploads nothing.
 */
export function AvatarField({ avatarUrl, displayName }: { avatarUrl: string | null; displayName: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
    setSaved(false);
    const file = e.target.files?.[0];
    if (!file) return;
    const valid = validateAvatarFile(file);
    if (!valid.ok) {
      setError(t(valid.code));
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
      const ticket = await requestAvatarUploadAction(AVATAR_OUTPUT_TYPE);
      if (!ticket.ok) throw new Error(ticket.code);
      const supabase = createBrowserSupabaseClient();
      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(ticket.key, blob, { contentType: AVATAR_OUTPUT_TYPE, upsert: false });
      if (uploadError) throw uploadError;
      const confirmed = await confirmAvatarUploadAction(ticket.key);
      if (!confirmed.ok) throw new Error(confirmed.code);
      reset();
      setSaved(true);
      router.refresh();
    } catch {
      setError(t("profileIdentity.avatar.errorUpload"));
    } finally {
      setBusy(false);
    }
  };

  const initial = displayName.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="flex flex-col gap-sm" data-testid="avatar-field">
      <span className="text-label font-medium text-fg-secondary">{t("profileIdentity.avatar.label")}</span>
      <div className="flex flex-wrap items-center gap-md">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a static asset
          <img
            src={avatarUrl}
            alt={t("profileIdentity.avatar.label")}
            className="h-20 w-20 rounded-full border object-cover"
            data-testid="avatar-current"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-20 w-20 items-center justify-center rounded-full bg-surface-2 text-title text-fg-muted"
          >
            {initial}
          </span>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={AVATAR_ALLOWED_TYPES.join(",")}
          className="sr-only"
          id="avatar-input"
          data-testid="avatar-input"
          onChange={onPick}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          {avatarUrl ? t("profileIdentity.avatar.change") : t("profileIdentity.avatar.add")}
        </Button>
      </div>
      {saved ? <InlineSuccess>{t("profileIdentity.avatar.saved")}</InlineSuccess> : null}
      {error && !source ? <InlineError>{error}</InlineError> : null}

      {source ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="avatar-crop-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-md"
        >
          <div className="flex w-full max-w-md flex-col gap-md rounded-lg bg-surface p-md shadow-lg">
            <h2 id="avatar-crop-title" className="text-title text-fg">
              {t("profileIdentity.avatar.cropTitle")}
            </h2>
            <div className="relative h-72 w-full overflow-hidden rounded-md bg-surface-2" data-testid="avatar-cropper">
              <Cropper
                image={source}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, pixels) => setArea(pixels)}
              />
            </div>
            <label className="flex items-center gap-sm text-label text-fg-secondary">
              {t("profileIdentity.avatar.zoom")}
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1"
                aria-label={t("profileIdentity.avatar.zoom")}
              />
            </label>
            {error ? <InlineError>{error}</InlineError> : null}
            <div className="flex justify-end gap-sm">
              <Button type="button" variant="ghost" onClick={reset} disabled={busy}>
                {t("profileIdentity.avatar.cancel")}
              </Button>
              <Button type="button" onClick={onSave} disabled={busy || !area}>
                {busy ? t("profileIdentity.avatar.saving") : t("profileIdentity.avatar.save")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
