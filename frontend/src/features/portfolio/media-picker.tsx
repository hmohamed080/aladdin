"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useI18n } from "@/lib/i18n/context";
import { CameraIcon, PlayIcon, UploadIcon, VideoIcon, XIcon } from "@/components/ui/icons";
import {
  ASSET_POLICY,
  PORTFOLIO_MAX_FILES,
  PORTFOLIO_VIDEO_MAX_SECONDS,
  isVideoType,
  validateAssetFile,
} from "@/lib/storage/professional-assets";
import "./portfolio-add.css";

/** One file the person has chosen but not yet uploaded. */
export type PickedMedia = {
  id: string;
  file: File;
  kind: "image" | "video";
  /** Object URL for the preview tile; revoked when the tile goes away. */
  previewUrl: string;
  /** Whole seconds, read from the file itself. Videos only. */
  durationSeconds: number | null;
};

/** Reads a video's length from its own metadata. Rejects when the browser cannot decode it. */
function readDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const timer = window.setTimeout(() => reject(new Error("timeout")), 8000);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      resolve(Number.isFinite(video.duration) ? Math.round(video.duration) : 0);
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("unreadable"));
    };
    video.src = url;
  });
}

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.max(0, seconds - m * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** The cover is the first IMAGE: if a video ended up first, bring the first image to the front. */
export function normalizeOrder(list: PickedMedia[]): PickedMedia[] {
  if (list[0]?.kind !== "video") return list;
  const at = list.findIndex((m) => m.kind === "image");
  if (at < 0) return list;
  const next = list.slice();
  const [cover] = next.splice(at, 1);
  return [cover as PickedMedia, ...next];
}

const ACCEPT = ASSET_POLICY.portfolio_media.types.join(",");

/**
 * Choose, check, order and remove the files of ONE work before anything uploads.
 *
 * Everything here is a fast, specific answer — type, size, count, one video, video
 * length — and none of it is the boundary: the database (`portfolio_media_create`)
 * and the bucket enforce the same limits again, so a caller that skipped this
 * would simply be refused later.
 *
 * ORDER RULE: the first tile is the work's COVER, and the cover is always an
 * image. A move that would put a video first is ignored, and removing the first
 * image brings the next image forward.
 */
export function MediaPicker({
  items,
  onChange,
  onError,
  disabled = false,
}: {
  items: PickedMedia[];
  onChange: (next: PickedMedia[]) => void;
  /** An i18n key, or null to clear. */
  onError: (code: string | null) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const dragId = useRef<string | null>(null);
  const live = useRef<PickedMedia[]>(items);
  live.current = items;

  // Free every preview URL when the picker goes away.
  useEffect(() => () => live.current.forEach((m) => URL.revokeObjectURL(m.previewUrl)), []);

  const addFiles = useCallback(
    async (files: File[]) => {
      onError(null);
      const next = items.slice();
      for (const file of files) {
        if (next.length >= PORTFOLIO_MAX_FILES) {
          onError("portfolio.errors.tooManyFiles");
          break;
        }
        const valid = validateAssetFile("portfolio_media", { type: file.type, size: file.size });
        if (!valid.ok) {
          onError(valid.code);
          continue;
        }
        const video = isVideoType(file.type);
        if (video && next.some((m) => m.kind === "video")) {
          onError("portfolio.errors.oneVideo");
          continue;
        }
        const previewUrl = URL.createObjectURL(file);
        let durationSeconds: number | null = null;
        if (video) {
          try {
            durationSeconds = await readDuration(previewUrl);
          } catch {
            URL.revokeObjectURL(previewUrl);
            onError("portfolio.errors.videoUnreadable");
            continue;
          }
          if (durationSeconds < 1 || durationSeconds > PORTFOLIO_VIDEO_MAX_SECONDS) {
            URL.revokeObjectURL(previewUrl);
            onError("portfolio.errors.videoLength");
            continue;
          }
        }
        next.push({ id: crypto.randomUUID(), file, kind: video ? "video" : "image", previewUrl, durationSeconds });
      }
      onChange(normalizeOrder(next));
    },
    [items, onChange, onError],
  );

  const remove = (id: string) => {
    const gone = items.find((m) => m.id === id);
    if (gone) URL.revokeObjectURL(gone.previewUrl);
    onError(null);
    onChange(normalizeOrder(items.filter((m) => m.id !== id)));
  };

  const move = (id: string, to: number) => {
    const from = items.findIndex((m) => m.id === id);
    if (from < 0 || to < 0 || to >= items.length || from === to) return;
    const next = items.slice();
    const [picked] = next.splice(from, 1);
    next.splice(to, 0, picked as PickedMedia);
    // A video can never become the cover.
    if (next[0]?.kind === "video") return;
    onChange(next);
  };

  const onHandleKey = (event: KeyboardEvent<HTMLButtonElement>, id: string, index: number) => {
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const earlier = rtl ? "ArrowRight" : "ArrowLeft";
    const later = rtl ? "ArrowLeft" : "ArrowRight";
    if (event.key === earlier) {
      event.preventDefault();
      move(id, index - 1);
    } else if (event.key === later) {
      event.preventDefault();
      move(id, index + 1);
    }
  };

  const onZoneDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setOver(false);
    if (disabled) return;
    void addFiles(Array.from(event.dataTransfer.files));
  };

  const full = items.length >= PORTFOLIO_MAX_FILES;

  return (
    <div className="flex flex-col gap-md" data-testid="media-picker">
      <label
        className="portfolio-drop"
        data-over={over}
        data-disabled={disabled || full}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onZoneDrop}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          disabled={disabled || full}
          data-testid="media-input"
          onChange={(e) => {
            const files = Array.from(e.currentTarget.files ?? []);
            e.currentTarget.value = "";
            void addFiles(files);
          }}
        />
        <span className="portfolio-drop-icon" aria-hidden="true"><UploadIcon size={28} /></span>
        <span className="portfolio-drop-title">{t("portfolio.media.dropTitle")}</span>
        <span className="portfolio-drop-hint">{t("portfolio.media.dropHint")}</span>
        <span className="portfolio-drop-types" aria-hidden="true">
          <CameraIcon size={20} />
          <span className="portfolio-chip">JPG</span>
          <span className="portfolio-chip">PNG</span>
          <span className="portfolio-chip">WEBP</span>
          <span className="portfolio-drop-sep" />
          <VideoIcon size={20} />
          <span className="portfolio-chip">MP4</span>
          <span className="portfolio-chip">MOV</span>
        </span>
      </label>

      {items.length > 0 ? (
        <ul className="portfolio-tiles" data-testid="media-tiles">
          {items.map((item, index) => (
            <li
              key={item.id}
              className="portfolio-tile"
              draggable={!disabled}
              onDragStart={(e) => {
                dragId.current = item.id;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", item.id);
              }}
              onDragOver={(e) => {
                if (dragId.current) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (dragId.current) move(dragId.current, index);
                dragId.current = null;
              }}
              onDragEnd={() => {
                dragId.current = null;
              }}
            >
              {item.kind === "video" ? (
                <video src={`${item.previewUrl}#t=0.1`} muted playsInline preload="metadata" className="portfolio-tile-media" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- local object URL
                <img src={item.previewUrl} alt="" className="portfolio-tile-media" draggable={false} />
              )}
              {item.kind === "video" ? (
                <>
                  <span className="portfolio-tile-play" aria-hidden="true"><PlayIcon size={22} /></span>
                  {item.durationSeconds ? <span className="portfolio-tile-time" dir="ltr">{formatClock(item.durationSeconds)}</span> : null}
                </>
              ) : null}
              {index === 0 ? <span className="portfolio-tile-cover">{t("portfolio.media.cover")}</span> : null}
              <button
                type="button"
                className="portfolio-tile-remove"
                aria-label={t("portfolio.media.remove")}
                disabled={disabled}
                onClick={() => remove(item.id)}
              >
                <XIcon size={16} />
              </button>
              <button
                type="button"
                className="portfolio-tile-handle"
                aria-label={t("portfolio.media.reorder")}
                disabled={disabled || items.length < 2}
                onKeyDown={(e) => onHandleKey(e, item.id, index)}
              >
                <span aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
