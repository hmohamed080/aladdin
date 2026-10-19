"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { CheckIcon, XIcon } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";

/**
 * Toast — the transient confirmation (COMPONENT_INVENTORY "Toast"; UI_UX_SYSTEM_GUIDE "Match urgency to
 * mechanism"). For a success that would otherwise be invisible because the surface that produced it goes
 * away: a ConfirmDialog closes on success, and the refreshed server data often unmounts the very control
 * that opened it (a "Start review" button once the request is under review). The message therefore lives in
 * a module store drawn by ONE `<Toaster />` in the root layout, so it survives that close and that refresh.
 *
 * Never for a critical item that needs a decision — those stay inline. Not colour-only (icon + text), polite
 * live region that exists before any message is inserted, auto-dismiss that pauses on hover and on focus,
 * a labelled dismiss button, and no entrance motion (nothing to honour or skip under reduced motion).
 */
export type ToastTone = "success";
type ToastItem = { id: number; message: string; tone: ToastTone };

const DURATION_MS = 6000;
let items: readonly ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const snapshot = () => items;
const EMPTY: readonly ToastItem[] = [];
const serverSnapshot = () => EMPTY;

/** Shows a transient confirmation. Repeating the message already on screen restarts it instead of stacking. */
export function showToast(message: string, tone: ToastTone = "success"): void {
  items = [...items.filter((i) => i.message !== message), { id: nextId++, message, tone }].slice(-3);
  emit();
}

export function dismissToast(id: number): void {
  items = items.filter((i) => i.id !== id);
  emit();
}

/** Test seam: clears every toast between tests. */
export function resetToasts(): void {
  items = [];
  emit();
}

function ToastCard({ item, dismissLabel }: { item: ToastItem; dismissLabel: string }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => dismissToast(item.id), DURATION_MS);
  };
  const pause = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    start();
    return pause;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one timer per toast id
  }, [item.id]);

  return (
    <div
      data-testid="toast"
      data-tone={item.tone}
      onMouseEnter={pause}
      onMouseLeave={start}
      onFocus={pause}
      onBlur={start}
      className="pointer-events-auto flex w-full items-start gap-sm rounded-md border bg-surface px-md py-3 text-fg shadow-lg tablet:w-auto tablet:min-w-72 tablet:max-w-md"
    >
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-pill bg-success/15 text-success" aria-hidden="true">
        <CheckIcon size={14} />
      </span>
      <p className="min-w-0 flex-1 text-body font-medium text-fg">{item.message}</p>
      <button
        type="button"
        aria-label={dismissLabel}
        onClick={() => dismissToast(item.id)}
        className="-m-1 grid h-7 w-7 shrink-0 place-items-center rounded-sm text-fg-secondary hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <XIcon size={14} />
      </button>
    </div>
  );
}

/** The one toast region. Mounted once, in the root layout; `dismissLabel` is already localized there. */
export function Toaster({ dismissLabel }: { dismissLabel: string }) {
  const list = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-toast flex flex-col items-center gap-sm p-md",
        "tablet:inset-x-auto tablet:end-0 tablet:items-end",
      )}
    >
      {list.map((item) => (
        <ToastCard key={item.id} item={item} dismissLabel={dismissLabel} />
      ))}
    </div>
  );
}
