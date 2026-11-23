import { parseLimitRows, resolveLimit, type ImagePlace, type MediaLimitRow, type VideoPlace } from "./limits";

/**
 * The stored upload limits as the BROWSER knows them: a hint, loaded once per page from
 * `/api/media-limits`. It only lets the interface answer "this file is too large" without a round
 * trip; the server and the database check the stored value again and decide. When the hint cannot be
 * loaded the compiled defaults (the previous caps) are used.
 */
let rows: MediaLimitRow[] | null = null;
let attempt: Promise<void> | null = null;

export function loadMediaLimitHints(fetcher: typeof fetch = (...args) => fetch(...args)): Promise<void> {
  attempt ??= (async () => {
    try {
      const response = await fetcher("/api/media-limits", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) return;
      const parsed = parseLimitRows(await response.json());
      if (parsed.length > 0) rows = parsed;
    } catch {
      // keep the defaults
    }
  })();
  return attempt;
}

export function imageHintBytes(place: ImagePlace): number {
  return resolveLimit(rows, "image", place);
}

export function videoHintBytes(place: VideoPlace): number {
  return resolveLimit(rows, "video", place);
}

/** Tests only. */
export function resetMediaLimitHints(next: MediaLimitRow[] | null = null) {
  rows = next;
  attempt = next ? Promise.resolve() : null;
}
