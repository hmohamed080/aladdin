/**
 * Test-safe Realtime lifecycle instrumentation (Sprint 6.1).
 *
 * This is NOT production application state and holds NO secrets — only channel
 * *scope strings* (e.g. `org:<uuid>` / `branch:<uuid>`) and counters. It is fully
 * inert unless the build-time flag `NEXT_PUBLIC_REALTIME_DEBUG === "1"` is set
 * (the E2E harness sets it), in which case a small snapshot is mirrored to
 * `window.__salesRealtime` so Playwright can prove subscription scope, teardown,
 * duplicate-channel absence, and whether an event caused a refresh vs. was
 * deferred (open-form safety). In a normal production build every function below
 * is a no-op and nothing is attached to `window`.
 */
export const REALTIME_DEBUG = process.env.NEXT_PUBLIC_REALTIME_DEBUG === "1";

export type SalesRealtimeDebug = {
  /** Scope strings of the currently-subscribed channels (should be length 1). */
  channels: string[];
  channelCount: number;
  /** Total server refreshes triggered by an in-scope event. */
  refreshes: number;
  /** Scope string of the last channel that triggered a refresh. */
  lastRefreshScope: string | null;
  /** Events deferred because a form field was focused (open-form safety). */
  deferred: number;
  /** Last connection status reported by the channel. */
  status: string;
};

declare global {
  var __salesRealtime: SalesRealtimeDebug | undefined;
}

function store(): SalesRealtimeDebug | null {
  if (!REALTIME_DEBUG || typeof window === "undefined") return null;
  if (!window.__salesRealtime) {
    window.__salesRealtime = {
      channels: [],
      channelCount: 0,
      refreshes: 0,
      lastRefreshScope: null,
      deferred: 0,
      status: "connecting",
    };
  }
  return window.__salesRealtime;
}

export function rtAddChannel(scope: string): void {
  const s = store();
  if (!s) return;
  if (!s.channels.includes(scope)) s.channels.push(scope);
  s.channelCount = s.channels.length;
}

export function rtRemoveChannel(scope: string): void {
  const s = store();
  if (!s) return;
  s.channels = s.channels.filter((c) => c !== scope);
  s.channelCount = s.channels.length;
}

export function rtRefresh(scope: string): void {
  const s = store();
  if (!s) return;
  s.refreshes += 1;
  s.lastRefreshScope = scope;
}

export function rtDeferred(): void {
  const s = store();
  if (!s) return;
  s.deferred += 1;
}

export function rtStatus(status: string): void {
  const s = store();
  if (!s) return;
  s.status = status;
}
