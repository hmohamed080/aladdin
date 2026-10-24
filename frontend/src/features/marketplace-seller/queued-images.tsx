"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { UploadIcon, XIcon } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";
import { errorKey } from "./errors";
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGES_PER_BATCH, imageFileProblem } from "./image-upload";

/**
 * Image picker for a product that does not exist yet (the "new product" page).
 * Files stay in the browser (local previews only — nothing is uploaded) until
 * the first save creates the product; the form then uploads them through the
 * same trusted workflow as the images panel. The first image is the cover.
 */
export function QueuedImages({ files, onChange, disabled }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const previews = useMemo(() => files.map((f) => ({ file: f, url: URL.createObjectURL(f) })), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  const add = (list: FileList | File[]) => {
    setMessage(null);
    const next = [...files];
    for (const file of Array.from(list)) {
      const problem = imageFileProblem(file);
      if (problem) {
        setMessage(`${file.name}: ${t(errorKey(problem))}`);
        continue;
      }
      if (next.length >= MAX_IMAGES_PER_BATCH) {
        setMessage(t("marketplaceSeller.image.queueFull", { count: MAX_IMAGES_PER_BATCH }));
        break;
      }
      if (!next.some((f) => f.name === file.name && f.size === file.size)) next.push(file);
    }
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-md">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!disabled && e.dataTransfer.files.length) add(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-sm rounded-md border-2 border-dashed px-md py-lg text-center",
          dragOver ? "border-accent bg-accent-solid/10" : "border-strong bg-surface-2/40",
        )}
      >
        <UploadIcon size={22} />
        <p className="text-body text-fg-secondary">
          {t("marketplaceSeller.image.drop")}{" "}
          <button
            type="button"
            disabled={disabled}
            className="font-medium text-accent underline-offset-2 hover:underline disabled:opacity-50"
            onClick={() => inputRef.current?.click()}
          >
            {t("marketplaceSeller.image.browse")}
          </button>
        </p>
        <p className="text-label text-fg-muted">{t("marketplaceSeller.image.hint")}</p>
        <p className="text-label text-fg-muted">{t("marketplaceSeller.image.queuedHint")}</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(",")}
          multiple
          className="sr-only"
          onChange={(e) => {
            if (e.target.files?.length) add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {message ? (
        <p role="alert" className="text-label text-danger">
          {message}
        </p>
      ) : null}

      {previews.length ? (
        <ul className="grid grid-cols-2 gap-sm tablet:grid-cols-4 desktop:grid-cols-5">
          {previews.map((p, i) => (
            <li key={`${p.file.name}-${p.file.size}`} className="relative overflow-hidden rounded-md border bg-surface">
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview, never uploaded yet */}
              <img src={p.url} alt={p.file.name} className="aspect-square w-full object-cover" />
              {i === 0 ? (
                <span className="absolute start-2 top-2 rounded-pill bg-accent-solid px-2 py-0.5 text-label text-on-accent ring-1 ring-accent-edge">
                  {t("marketplaceSeller.image.cover")}
                </span>
              ) : null}
              <button
                type="button"
                disabled={disabled}
                aria-label={t("marketplaceSeller.image.removeQueued", { name: p.file.name })}
                className="absolute end-2 top-2 grid h-7 w-7 place-items-center rounded-pill bg-surface/90 text-fg-secondary hover:text-danger"
                onClick={() => onChange(files.filter((f) => f !== p.file))}
              >
                <XIcon size={14} />
              </button>
              <p className="truncate px-2 py-1 text-label text-fg-muted" dir="ltr">
                {p.file.name}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
