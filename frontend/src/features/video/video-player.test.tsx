import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const hls = vi.hoisted(() => ({ instances: [] as { config: Record<string, unknown>; src?: string; destroyed: boolean }[] }));
vi.mock("hls.js/light", () => {
  class FakeHls {
    static isSupported() { return true; }
    static Events = { ERROR: "hlsError" };
    config: Record<string, unknown>;
    src?: string;
    destroyed = false;
    constructor(config: Record<string, unknown>) { this.config = { ...config }; hls.instances.push(this); }
    loadSource(src: string) { this.src = src; }
    attachMedia() {}
    on() {}
    destroy() { this.destroyed = true; }
  }
  return { default: FakeHls };
});

import { HOVER_PREVIEW_DELAY_MS, VideoPlayer, type VideoSource } from "./video-player";

const labels = { play: "Play Clip", unavailable: "Unavailable" };
const source = (over: Partial<VideoSource> = {}): VideoSource =>
  ({ id: "v1", src: "https://media.example/v/v1/master.m3u8?t=1", poster: "https://media.example/v/v1/poster.jpg", access: "public", ...over });

function setPointer(canHover: boolean, reducedMotion = false) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("reduced-motion") ? reducedMotion : canHover,
    media: query, addEventListener() {}, removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

let play: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  hls.instances.length = 0;
  play = vi.fn(async () => undefined);
  HTMLMediaElement.prototype.play = play as unknown as HTMLMediaElement["play"];
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
  HTMLMediaElement.prototype.canPlayType = () => "";
  // jsdom does not implement `muted`; keep a per-element value so the tests can read it back.
  Object.defineProperty(HTMLMediaElement.prototype, "muted", {
    configurable: true,
    get(this: HTMLMediaElement & { _muted?: boolean }) { return this._muted ?? false; },
    set(this: HTMLMediaElement & { _muted?: boolean }, value: boolean) { this._muted = value; },
  });
  setPointer(true);
});
afterEach(() => vi.useRealTimers());

const player = (s = source(), loadSource?: (s: VideoSource) => Promise<string>) =>
  render(<VideoPlayer source={s} title="Clip" width={1280} height={720} labels={labels} loadSource={loadSource} />);
const flush = () => act(async () => { await vi.runAllTimersAsync(); });

describe("VideoPlayer", () => {
  it("loads nothing but the poster until the viewer acts", async () => {
    const { container } = player();
    await flush();
    const video = container.querySelector("video")!;
    expect(video.getAttribute("preload")).toBe("none");
    expect(video.getAttribute("autoplay")).toBeNull();
    expect(video.getAttribute("src")).toBeNull();
    expect(video.getAttribute("poster")).toContain("poster.jpg");
    expect(hls.instances).toHaveLength(0);
    expect(play).not.toHaveBeenCalled();
  });

  it("previews muted at the lowest quality on mouse hover, and stops when the mouse leaves", async () => {
    player();
    const frame = screen.getByTestId("video-player");
    fireEvent.pointerEnter(frame, { pointerType: "mouse" });
    await act(async () => { await vi.advanceTimersByTimeAsync(HOVER_PREVIEW_DELAY_MS - 10); });
    expect(frame.getAttribute("data-mode")).toBe("idle");
    await flush();
    expect(frame.getAttribute("data-mode")).toBe("preview");
    expect(hls.instances[0]!.config).toMatchObject({ startLevel: 0, maxBufferLength: 6 });
    expect((frame.querySelector("video") as HTMLVideoElement).muted).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);

    fireEvent.pointerLeave(frame, { pointerType: "mouse" });
    expect(frame.getAttribute("data-mode")).toBe("idle");
    expect(hls.instances[0]!.destroyed).toBe(true);
  });

  it("does not preview when the pointer leaves before the delay", async () => {
    player();
    const frame = screen.getByTestId("video-player");
    fireEvent.pointerEnter(frame, { pointerType: "mouse" });
    fireEvent.pointerLeave(frame, { pointerType: "mouse" });
    await flush();
    expect(hls.instances).toHaveLength(0);
  });

  it("never previews on touch or with reduced motion", async () => {
    player();
    const frame = screen.getByTestId("video-player");
    fireEvent.pointerEnter(frame, { pointerType: "touch" });
    await flush();
    expect(frame.getAttribute("data-mode")).toBe("idle");

    setPointer(true, true);
    fireEvent.pointerEnter(frame, { pointerType: "mouse" });
    await flush();
    expect(frame.getAttribute("data-mode")).toBe("idle");
    expect(hls.instances).toHaveLength(0);
  });

  it("plays with sound and controls from the start after a click or tap", async () => {
    const { container } = player();
    fireEvent.click(screen.getByTestId("video-play"));
    await flush();
    const video = container.querySelector("video")!;
    expect(screen.getByTestId("video-player").getAttribute("data-mode")).toBe("playing");
    expect(video.muted).toBe(false);
    expect(video.hasAttribute("controls")).toBe(true);
    expect(hls.instances[0]!.config).toMatchObject({ startLevel: -1, maxBufferLength: 30 });
    expect(screen.queryByTestId("video-play")).toBeNull();
  });

  it("turns a running preview into full playback from 0 without reloading the stream", async () => {
    const { container } = player();
    const frame = screen.getByTestId("video-player");
    fireEvent.pointerEnter(frame, { pointerType: "mouse" });
    await flush();
    const video = container.querySelector("video")!;
    video.currentTime = 4;
    fireEvent.click(screen.getByTestId("video-play"));
    await flush();
    expect(hls.instances).toHaveLength(1);
    expect(hls.instances[0]!.config.maxBufferLength).toBe(30);
    expect(video.currentTime).toBe(0);
    expect(video.muted).toBe(false);
  });

  it("asks for a fresh ticketed source when the page's ticket may have expired", async () => {
    const loadSource = vi.fn(async () => "https://media.example/v/v1/master.m3u8?t=fresh");
    player(source({ access: "ticketed", workspace: "org-1" }), loadSource);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    fireEvent.click(screen.getByTestId("video-play"));
    await flush();
    expect(loadSource).toHaveBeenCalledTimes(1);
    expect(hls.instances[0]!.src).toContain("t=fresh");
  });

  it("uses the page's ticket while it is fresh, and never refreshes a public source", async () => {
    const loadSource = vi.fn(async () => "never");
    player(source({ access: "ticketed" }), loadSource);
    fireEvent.click(screen.getByTestId("video-play"));
    await flush();
    expect(loadSource).not.toHaveBeenCalled();
    expect(hls.instances[0]!.src).toContain("t=1");
  });

  it("says the video is unavailable when a fresh source is refused (access revoked)", async () => {
    player(source({ access: "ticketed" }), async () => { throw new Error("403"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    fireEvent.click(screen.getByTestId("video-play"));
    await flush();
    expect(screen.getByRole("alert").textContent).toBe("Unavailable");
  });
});
