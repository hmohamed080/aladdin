"use client";

import { useEffect, useRef, useState } from "react";

type HlsInstance = {
  destroy(): void; loadSource(src: string): void; attachMedia(media: HTMLMediaElement): void;
  on(event: string, handler: (event: string, data: { fatal?: boolean }) => void): void;
  config: { maxBufferLength: number };
};
type HlsModule = { default: { new (config: object): HlsInstance; isSupported(): boolean; Events: { ERROR: string } } };

/** How long the pointer rests on a video before its muted preview starts. */
export const HOVER_PREVIEW_DELAY_MS = 300;
/** A page ticket lives 60–120 s; older sources are refreshed before playback. */
const SOURCE_FRESH_MS = 50_000;

export type VideoSource = {
  id: string; src: string; poster: string | null; access: "public" | "ticketed"; workspace?: string | null;
};

/**
 * Adaptive (HLS) player for a video served by the media Worker.
 *
 * NOTHING PLAYS OR DOWNLOADS ON ITS OWN. The poster is the only request a page
 * makes; there is no autoplay on load or on scroll.
 *   * Desktop (a fine pointer that can hover): resting the pointer on the video
 *     starts a MUTED preview at the lowest quality with a short buffer, and
 *     leaving it stops the preview and releases the stream. Clicking starts the
 *     full player, with sound and controls, from the beginning.
 *   * Touch: the poster stays until the viewer taps play.
 *   * Reduced motion: no hover preview.
 * Safari and iOS play HLS natively; elsewhere `hls.js/light` (about 120 kB) loads
 * on the first interaction. The aspect ratio comes from the stored dimensions, so
 * nothing shifts when a video starts.
 *
 * Labels come in as props: public pages render it without the client i18n provider.
 */
export function VideoPlayer({ source, title, width, height, className, labels, fill = false, loadSource = refreshSource }: {
  source: VideoSource; title: string; width: number | null; height: number | null; className?: string;
  /** Fill a parent frame of fixed aspect (a gallery tile) instead of sizing from the video. */
  fill?: boolean;
  labels: { play: string; unavailable: string };
  loadSource?: (source: VideoSource) => Promise<string>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<HlsInstance | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const issuedAt = useRef(Date.now());
  const [mode, setModeState] = useState<"idle" | "preview" | "playing">("idle");
  // The ref changes in the same tick as the request, so an await that resolves
  // before React re-renders still sees the latest mode.
  const modeRef = useRef(mode);
  const [failed, setFailed] = useState(false);
  const setMode = (next: typeof mode) => { modeRef.current = next; setModeState(next); };
  const currentMode = () => modeRef.current;

  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hlsRef.current?.destroy();
  }, []);

  async function currentSource(): Promise<string> {
    if (source.access === "public" || Date.now() - issuedAt.current < SOURCE_FRESH_MS) return source.src;
    return loadSource(source);
  }

  /** Attaches the stream. `preview` starts at the lowest rendition with a short buffer. */
  async function attach(preview: boolean): Promise<boolean> {
    const video = videoRef.current;
    if (!video) return false;
    let src: string;
    try { src = await currentSource(); } catch { setFailed(true); return false; }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      return true;
    }
    const { default: Hls } = (await import("hls.js/light")) as unknown as HlsModule;
    if (!Hls.isSupported()) { setFailed(true); return false; }
    // Capped to the frame size so a phone does not download 1080p.
    const hls = new Hls({ capLevelToPlayerSize: true, maxBufferLength: preview ? 6 : 30, startLevel: preview ? 0 : -1 });
    hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) setFailed(true); });
    hls.loadSource(src);
    hls.attachMedia(video);
    hlsRef.current = hls;
    return true;
  }

  function release() {
    const video = videoRef.current;
    hlsRef.current?.destroy();
    hlsRef.current = null;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load(); // stops any download and shows the poster again
    }
  }

  async function startPreview() {
    if (modeRef.current !== "idle") return;
    setMode("preview");
    const video = videoRef.current;
    // The pointer may have left while the stream was attaching.
    if (!video || !(await attach(true)) || currentMode() !== "preview") return;
    video.muted = true;
    video.play().catch(() => undefined);
  }

  function stopPreview() {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    if (modeRef.current !== "preview") return;
    release();
    setMode("idle");
  }

  async function play() {
    const video = videoRef.current;
    if (!video || modeRef.current === "playing") return;
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    const previewing = modeRef.current === "preview";
    setMode("playing");
    setFailed(false);
    if (previewing && (hlsRef.current || video.currentSrc)) {
      if (hlsRef.current) hlsRef.current.config.maxBufferLength = 30;
      video.currentTime = 0;
    } else if (!(await attach(false))) {
      return;
    }
    video.muted = false;
    video.play().catch(() => undefined);
  }

  function onPointerEnter(event: React.PointerEvent) {
    if (event.pointerType !== "mouse" || modeRef.current !== "idle" || !hoverPreviewAllowed()) return;
    hoverTimer.current = setTimeout(() => { hoverTimer.current = null; void startPreview(); }, HOVER_PREVIEW_DELAY_MS);
  }

  const ratio = width && height ? `${width} / ${height}` : "16 / 9";
  return (
    <div className={`relative w-full overflow-hidden bg-black ${fill ? "h-full" : "rounded-md"} ${className ?? ""}`}
      style={fill ? undefined : { aspectRatio: ratio }}
      data-testid="video-player" data-mode={mode}
      onPointerEnter={onPointerEnter} onPointerLeave={stopPreview}>
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        poster={source.poster ?? undefined}
        preload="none"
        playsInline
        loop={mode === "preview"}
        controls={mode === "playing"}
        aria-label={title}
        onError={() => { if (modeRef.current !== "idle") setFailed(true); }}
      />
      {mode !== "playing" && (
        <button
          type="button"
          onClick={() => void play()}
          className="absolute inset-0 flex items-center justify-center bg-black/20 text-white transition-colors hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          aria-label={labels.play}
          data-testid="video-play"
        >
          <span className={`flex h-14 w-14 items-center justify-center rounded-full bg-black/60 transition-opacity ${mode === "preview" ? "opacity-70" : ""}`}
            aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor" className="ms-1 h-7 w-7"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </button>
      )}
      {failed && (
        <p role="alert" className="absolute inset-x-0 bottom-0 bg-black/70 px-md py-2 text-label text-white">
          {labels.unavailable}
        </p>
      )}
    </div>
  );
}

function hoverPreviewAllowed(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches
    && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

async function refreshSource(source: VideoSource): Promise<string> {
  const query = source.workspace ? `?ws=${encodeURIComponent(source.workspace)}` : "";
  const response = await fetch(`/api/video/${source.id}/playback${query}`, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("playback unavailable");
  const body = (await response.json()) as { src?: string };
  if (!body.src) throw new Error("playback unavailable");
  return body.src;
}
