"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Card, InlineError, ProgressMeter } from "@/components/ui/primitives";
import { Button, Input, LabeledField } from "@/components/ui/controls";
import { useI18n } from "@/lib/i18n/context";
import { VIDEO_TITLE_MAX, VIDEO_TYPES, type VideoScope } from "@/lib/media/video-policy";
import type { ManagedVideo } from "@/server/queries/videos";
import { VideoPlayer } from "./video-player";
import { UploadFailure, cancelUpload, rememberUpload, rememberedUpload, uploadVideo, type UploadErrorCode } from "./upload-engine";

/**
 * Videos for one portfolio or one product: upload with progress, processing
 * state, playback, publish (portfolio only) and delete. The list is server data;
 * after any change the page re-renders (router.refresh), and while something is
 * processing it refreshes every ten seconds until it is ready.
 */
export function VideoManager({ scope, productId, videos, canPublish, showList = true }: {
  scope: VideoScope; productId?: string; videos: ManagedVideo[]; canPublish: boolean;
  /** False where the videos are listed in the shared photo-and-video gallery instead. */
  showList?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  useProcessingRefresh(showList ? videos : []);

  return (
    <section className="flex flex-col gap-lg" data-testid="video-manager" aria-labelledby="video-manager-title">
      <div className="flex flex-col gap-1">
        <h2 id="video-manager-title" className="text-title text-fg">{t("video.title")}</h2>
        <p className="max-w-prose text-body text-fg-secondary">
          {t(scope === "portfolio" ? "video.subtitlePortfolio" : "video.subtitleProduct")}
        </p>
      </div>
      <VideoUploader scope={scope} productId={productId} onDone={() => router.refresh()} />
      {showList && videos.length > 0 && (
        <ul className="grid gap-lg sm:grid-cols-2 xl:grid-cols-3">
          {videos.map((video) => (
            <li key={video.id}><VideoCard video={video} canPublish={canPublish} onChange={() => router.refresh()} /></li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Refreshes the page while a video is still being processed, so its card turns ready. */
export function useProcessingRefresh(videos: readonly { state: string }[]) {
  const router = useRouter();
  const processing = videos.some((v) => v.state === "processing");
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(timer);
  }, [processing, router]);
}

export function VideoCard({ video, canPublish, onChange, extra }: {
  video: ManagedVideo; canPublish: boolean; onChange: () => void;
  /** Gallery controls (move earlier/later) shown at the end of the action row. */
  extra?: ReactNode;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function send(method: "PATCH" | "DELETE", body?: unknown) {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/video/${video.id}`, { method, credentials: "same-origin",
      headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined })
      .catch(() => null);
    setBusy(false);
    if (!response?.ok) { setError(t("video.error.server")); return; }
    onChange();
  }

  return (
    <Card pad="sm" className="flex flex-col gap-sm" >
      {video.state === "ready" && video.playback ? (
        <VideoPlayer source={video.playback} title={video.title}
          width={video.width} height={video.height}
          labels={{ play: t("video.play", { title: video.title }), unavailable: t("video.unavailable") }} />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center rounded-md bg-surface-2 px-md text-center text-label text-fg-secondary"
          data-testid="video-state">
          {video.state === "failed" ? t("video.state.failed") : video.state === "uploading" ? t("video.state.uploading") : t("video.state.processing")}
        </div>
      )}
      <div className="flex items-start justify-between gap-sm">
        <div className="min-w-0">
          <p className="truncate text-label font-medium text-fg">{video.title}</p>
          <p className="text-caption text-fg-secondary">
            {video.state === "ready" ? (video.isPublic ? t("video.status.published") : t("video.status.private")) : t(`video.state.${video.state}`)}
            {video.durationSeconds ? ` · ${formatDuration(video.durationSeconds)}` : ""}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-sm">
        {canPublish && video.state === "ready" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => send("PATCH", { isPublic: !video.isPublic })}>
            {video.isPublic ? t("video.actions.unpublish") : t("video.actions.publish")}
          </Button>
        )}
        {confirming ? (
          <>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => send("DELETE")}>{t("video.actions.confirmDelete")}</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>{t("common.cancel")}</Button>
          </>
        ) : (
          <Button size="sm" variant="danger" disabled={busy} onClick={() => setConfirming(true)}>{t("video.actions.delete")}</Button>
        )}
        {extra ? <span className="ms-auto flex items-center gap-1">{extra}</span> : null}
      </div>
      {error && <InlineError>{error}</InlineError>}
    </Card>
  );
}

function formatDuration(seconds: number) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function VideoUploader({ scope, productId, onDone }: { scope: VideoScope; productId?: string; onDone: () => void }) {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<UploadErrorCode | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function start() {
    if (!file) return;
    setError(null);
    setProgress(0);
    abort.current = new AbortController();
    try {
      await uploadVideo({ file, title: title.trim() || file.name.slice(0, VIDEO_TITLE_MAX), scope, productId,
        onProgress: setProgress, signal: abort.current.signal });
      setFile(null);
      setTitle("");
      setProgress(null);
      onDone();
    } catch (failure) {
      setProgress(null);
      setError(failure instanceof UploadFailure ? failure.code : "server");
    }
  }

  return (
    <Card pad="sm" className="flex flex-col gap-md">
      <LabeledField label={t("video.file")} htmlFor="video-file" hint={t("video.fileHint")}>
        <Input id="video-file" type="file" accept={VIDEO_TYPES.join(",")} disabled={progress !== null}
          onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(null); }} />
      </LabeledField>
      <LabeledField label={t("video.titleField")} htmlFor="video-title" optional={t("common.optional")}>
        <Input id="video-title" value={title} maxLength={VIDEO_TITLE_MAX} disabled={progress !== null}
          onChange={(event) => setTitle(event.target.value)} />
      </LabeledField>
      {progress !== null && (
        <div className="flex flex-col gap-1" data-testid="video-upload-progress">
          <ProgressMeter value={Math.round(progress * 100)} label={t("video.uploading")} />
          <p className="text-caption text-fg-secondary">{t("video.percent", { percent: String(Math.round(progress * 100)) })}</p>
        </div>
      )}
      {error && error !== "aborted" && <InlineError>{t(`video.error.${error}`)}</InlineError>}
      <div className="flex flex-wrap gap-sm">
        <Button variant="accent" disabled={!file || progress !== null} onClick={start}>{t("video.upload")}</Button>
        {progress !== null && (
          <Button variant="ghost" onClick={() => abort.current?.abort()}>{t("video.pause")}</Button>
        )}
        {progress === null && file && rememberedUpload(file) && (
          <Button variant="danger" onClick={() => {
            const id = rememberedUpload(file);
            rememberUpload(file, null);
            setError(null);
            if (id) void cancelUpload(id).then(onDone);
          }}>{t("video.cancelUpload")}</Button>
        )}
      </div>
      {error && error !== "type" && error !== "size" && file && (
        <p className="text-caption text-fg-secondary">{t("video.resumeHint")}</p>
      )}
    </Card>
  );
}
