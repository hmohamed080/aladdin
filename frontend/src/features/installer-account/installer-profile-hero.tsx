"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Area } from "react-easy-crop";
import { ImageCropDialog } from "@/components/ui/image-crop-dialog";
import Link from "next/link";
import { CameraIcon, PencilIcon, TrashIcon, UserIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { cropImageToBlob } from "@/lib/media/crop-image";
import { uploadWithGrant } from "@/lib/storage/browser-upload";
import { AVATAR_MAX_BYTES } from "@/lib/storage/avatar-assets";
import {
  confirmAvatarUploadAction,
  confirmCoverUploadAction,
  deleteCoverAction,
  requestAvatarUploadAction,
  requestCoverUploadAction,
} from "@/server/actions/profile-identity";

type Kind = "cover" | "avatar";
const ALLOWED = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * The approved "Complete your profile" hero (`/preview/installer-account`) on the real media pipeline: the cover and the
 * profile photo are cropped in the browser (cover 6:1 at 1800x300, photo 1:1 at 512x512), uploaded through the
 * pending -> verified -> ready flow, and become current only when the database confirms them. "Adjust current photo"
 * re-crops the image already in use and uploads the result. The cover appears on the account and on the public profile.
 */
export function InstallerProfileHero({
  displayName,
  avatarUrl,
  coverUrl,
  title,
  subtitle,
  publicProfileHref = null,
}: {
  displayName: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  title: string;
  subtitle: string;
  /** `/p/<profile id>` once the profile is public; the button is shown only then. */
  publicProfileHref?: string | null;
}) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const router = useRouter();
  const coverInput = useRef<HTMLInputElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const [crop, setCrop] = useState<{ kind: Kind; source: string; owned: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (crop?.owned) URL.revokeObjectURL(crop.source);
  }, [crop]);

  const close = () => {
    setCrop(null);
    if (coverInput.current) coverInput.current.value = "";
    if (avatarInput.current) avatarInput.current.value = "";
  };

  const pick = (kind: Kind, event: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = event.target.files?.[0];
    if (!file) return;
    if (!(ALLOWED as readonly string[]).includes(file.type) || file.size <= 0) {
      setError(ar ? "اختر صورة JPG أو PNG أو WebP." : "Choose a JPG, PNG, or WebP image.");
      event.target.value = "";
      return;
    }
    setCrop({ kind, source: URL.createObjectURL(file), owned: true });
  };

  const save = async (area: Area) => {
    if (!crop) return;
    setBusy(true);
    setError(null);
    try {
      const isCover = crop.kind === "cover";
      const blob = await cropImageToBlob(crop.source, area, {
        width: isCover ? 1800 : 512,
        height: isCover ? 300 : 512,
        type: "image/jpeg",
        quality: 0.9,
        backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim(),
      });
      if (blob.size > AVATAR_MAX_BYTES) throw new Error("too large");
      const ticket = isCover ? await requestCoverUploadAction(blob.type, blob.size) : await requestAvatarUploadAction(blob.type, blob.size);
      if (!ticket.ok) throw new Error(ticket.code);
      await uploadWithGrant(ticket.grant, blob);
      const confirmed = isCover ? await confirmCoverUploadAction(ticket.key) : await confirmAvatarUploadAction(ticket.key);
      if (!confirmed.ok) throw new Error(confirmed.code);
      close();
      router.refresh();
    } catch {
      setError(ar ? "تعذر حفظ الصورة. جرّب صورة أخرى." : "The image could not be saved. Try another image.");
    } finally {
      setBusy(false);
    }
  };

  const removeCover = async () => {
    setBusy(true);
    setError(null);
    const result = await deleteCoverAction().catch(() => ({ ok: false as const, code: "" }));
    setBusy(false);
    if (!result.ok) setError(ar ? "تعذر حذف صورة الغلاف." : "The cover photo could not be removed.");
    else router.refresh();
  };

  const initial = Array.from(displayName.trim())[0]?.toLocaleUpperCase() ?? "?";

  return (
    <header className="relative isolate overflow-hidden rounded-md border border-strong bg-surface shadow-card tablet:min-h-60" data-testid="profile-hero">
      <div className="absolute inset-x-0 top-0 -z-20 h-28 bg-surface-2 tablet:inset-0 tablet:h-auto">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a static asset
          <img src={coverUrl} alt="" className="h-full w-full object-cover object-center" data-testid="profile-cover" />
        ) : (
          // Optimised by next/image: the source PNG is 1.7 MB, the delivered WebP/AVIF a fraction of that.
          <Image src="/assets/installer-account/profile-completion-hero-2026.png" alt="" fill priority sizes="(min-width: 1024px) 80vw, 100vw" className="object-cover object-center" />
        )}
        <div className="absolute inset-0 hidden bg-gradient-to-l from-canvas/45 via-canvas/10 to-transparent tablet:block ltr:tablet:bg-gradient-to-r" />
      </div>
      <div className="flex flex-col items-start gap-md px-md pb-sm pt-[4.5rem] tablet:min-h-60 tablet:flex-row tablet:items-center tablet:justify-start tablet:gap-lg tablet:px-xl tablet:py-xl">
        <div className="order-2 max-w-xl text-start">
          <h1 className="text-title font-bold text-fg tablet:text-headline">{title}</h1>
          <p className="mt-1 text-body text-fg-secondary tablet:mt-2 tablet:text-body-lg">{subtitle}</p>
        </div>
        <div className="relative order-1 shrink-0 tablet:me-sm">
          <span className="relative grid h-24 w-24 place-items-center overflow-hidden rounded-pill border-4 border-canvas bg-surface-2 text-headline font-bold text-fg shadow-raised tablet:h-28 tablet:w-28">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a static asset
              <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
            ) : (
              initial
            )}
          </span>
          <button type="button" onClick={() => avatarInput.current?.click()} aria-label={ar ? "تغيير صورة الملف" : "Change profile photo"} className="absolute -bottom-1 -start-1 grid h-10 w-10 place-items-center rounded-pill border-2 border-canvas bg-accent-solid text-on-accent shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" data-testid="profile-avatar-change"><CameraIcon size={18} /></button>
          {avatarUrl ? (
            <button type="button" onClick={() => setCrop({ kind: "avatar", source: avatarUrl, owned: false })} aria-label={ar ? "ضبط صورة الملف الحالية" : "Adjust current profile photo"} className="absolute -end-1 -top-1 grid h-9 w-9 place-items-center rounded-pill border-2 border-canvas bg-surface text-accent shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><PencilIcon size={16} /></button>
          ) : null}
        </div>
      </div>
      <input ref={coverInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label={ar ? "رفع صورة الغلاف" : "Upload cover photo"} className="sr-only" onChange={(e) => pick("cover", e)} data-testid="profile-cover-input" />
      <input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label={ar ? "رفع صورة الملف" : "Upload profile photo"} className="sr-only" onChange={(e) => pick("avatar", e)} data-testid="profile-avatar-input" />
      <div className="relative z-raised flex flex-wrap gap-sm px-md pb-md tablet:absolute tablet:bottom-md tablet:end-md tablet:p-0">
        {publicProfileHref ? (
          <Link href={publicProfileHref} className="flex min-h-11 items-center gap-xs rounded-md border border-strong bg-surface px-md text-label font-bold text-fg shadow-raised transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" data-testid="profile-public-link">
            <UserIcon size={16} />{ar ? "عرض ملفي العام" : "View public profile"}
          </Link>
        ) : null}
        <button type="button" onClick={() => coverInput.current?.click()} disabled={busy} className="flex min-h-11 items-center gap-xs rounded-md border border-accent bg-accent-solid px-md text-label font-bold text-on-accent shadow-raised transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60" data-testid="profile-cover-change">
          <CameraIcon size={17} />{ar ? "تغيير صورة الغلاف" : "Change cover photo"}
        </button>
        {coverUrl ? (
          <>
            <button type="button" onClick={() => setCrop({ kind: "cover", source: coverUrl, owned: false })} disabled={busy} className="flex min-h-11 items-center gap-xs rounded-md border border-strong bg-surface px-md text-label font-bold text-fg shadow-raised transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60">
              <PencilIcon size={16} />{ar ? "ضبط الصورة الحالية" : "Adjust current photo"}
            </button>
            <button type="button" onClick={removeCover} disabled={busy} aria-label={ar ? "حذف صورة الغلاف" : "Remove cover photo"} className="grid min-h-11 w-11 place-items-center rounded-md border border-strong bg-surface text-danger shadow-raised hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"><TrashIcon size={16} /></button>
          </>
        ) : null}
      </div>
      {error && !crop ? <p role="alert" className="relative z-raised mx-md mb-md rounded-md bg-surface px-sm py-xs text-label text-danger shadow-raised tablet:absolute tablet:bottom-md tablet:start-md tablet:m-0">{error}</p> : null}
      {crop ? (
        <ImageCropDialog
          image={crop.source}
          title={crop.kind === "cover" ? (ar ? "اضبط صورة الغلاف" : "Adjust cover photo") : (ar ? "اضبط صورة الملف" : "Adjust profile photo")}
          zoomLabel={ar ? "حجم الصورة" : "Image size"}
          cancelLabel={ar ? "إلغاء" : "Cancel"}
          saveLabel={ar ? "حفظ الصورة" : "Save photo"}
          savingLabel={ar ? "جارٍ الحفظ…" : "Saving…"}
          aspect={crop.kind === "cover" ? 6 : 1}
          cropShape={crop.kind === "avatar" ? "round" : "rect"}
          showGrid={crop.kind === "cover"}
          busy={busy}
          error={error}
          onCancel={close}
          onConfirm={save}
        />
      ) : null}
    </header>
  );
}
