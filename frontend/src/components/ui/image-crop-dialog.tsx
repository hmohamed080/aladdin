"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Cropper, { type Area } from "react-easy-crop";
import { Button } from "@/components/ui/controls";

export function ImageCropDialog({
  image,
  title,
  zoomLabel,
  cancelLabel,
  saveLabel,
  savingLabel,
  aspect,
  cropShape = "rect",
  showGrid = true,
  busy = false,
  error,
  onCancel,
  onConfirm,
}: {
  image: string;
  title: string;
  zoomLabel: string;
  cancelLabel: string;
  saveLabel: string;
  savingLabel: string;
  aspect: number;
  cropShape?: "rect" | "round";
  showGrid?: boolean;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (area: Area) => void | Promise<void>;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(busy);
  const cancelRef = useRef(onCancel);
  const titleId = useId();
  busyRef.current = busy;
  cancelRef.current = onCancel;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => cancelButtonRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        cancelRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-modal flex items-center justify-center bg-brand-basalt/70 p-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div ref={dialogRef} tabIndex={-1} className="flex w-full max-w-2xl flex-col gap-md rounded-lg border border-strong bg-surface p-md shadow-overlay">
        <h2 id={titleId} className="text-title text-fg">
          {title}
        </h2>
        <div className="relative h-72 w-full overflow-hidden rounded-md bg-surface-2" data-testid="image-cropper">
          <Cropper
            image={image}
            crop={crop}
            zoom={zoom}
            aspect={aspect}
            cropShape={cropShape}
            showGrid={showGrid}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_, pixels) => setArea(pixels)}
          />
        </div>
        <label className="flex items-center gap-sm text-label text-fg-secondary">
          {zoomLabel}
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="installer-budget-range flex-1"
            aria-label={zoomLabel}
          />
        </label>
        {error ? <p role="alert" className="text-label text-danger">{error}</p> : null}
        <div className="flex justify-end gap-sm">
          <Button ref={cancelButtonRef} type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button type="button" onClick={() => area && onConfirm(area)} disabled={busy || !area}>
            {busy ? savingLabel : saveLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
