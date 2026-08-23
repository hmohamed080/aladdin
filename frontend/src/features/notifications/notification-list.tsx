"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/server/actions/notifications";
import type { NotificationView } from "@/features/notifications/view-model";

/**
 * THE ONE NOTIFICATION LIST. Rendered in the header panel and in the supply
 * dashboard block, and there must not be a second design of it.
 *
 * The two surfaces differ in DENSITY and in nothing else: same row, same
 * unread cue, same deep link, same read-state behaviour. A dashboard block that
 * invented its own row would be a second thing to keep in step with the header
 * every time the shape of a notification changes.
 *
 * WHY THE ROW IS ONE INTERACTIVE ELEMENT
 * A row is a link, and the whole row is the link — not a link with a "mark read"
 * button inside it. Nesting a button in an anchor is invalid HTML that browsers
 * resolve inconsistently and screen readers announce as two overlapping targets.
 * Marking read is a SIDE EFFECT of opening the notice, which is also the honest
 * model: you have read it because you went and looked at it.
 */

export type NotificationReadState = {
  markOne: (id: string) => void;
  markAll: (ids: readonly string[]) => void;
  isRead: (item: NotificationView) => boolean;
  /** Server total, less anything read since — what the badge should show. */
  effectiveUnread: number;
};

/**
 * Read state converges on the server; this only makes the convergence visible.
 *
 * Clicking a row fires the RPC and then `router.refresh()`, which re-renders the
 * current route AND its layouts — so the header badge, which lives in the
 * layout, updates without a browser reload and without expiring anything else.
 * That round trip is not instant, so the row also records the id locally and
 * reads as read immediately.
 *
 * The local record needs no cleanup. A row is shown as read when the SERVER says
 * so or when it is in `readIds`; once the refresh lands the server says so on
 * its own, and a stale id in the set can only agree with it. Nothing has to
 * decide when to forget.
 */
export function useNotificationReadState(
  items: readonly NotificationView[],
  unreadCount: number,
  orgId: string | null | undefined,
): NotificationReadState {
  const snapshot = notificationSnapshot(items, unreadCount);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(() => new Set());
  // The server snapshot that "mark all" was pressed against. Comparing it to the
  // CURRENT snapshot is what expires the optimistic clear: the moment the server
  // sends different data, the stamp no longer matches and the real counts take
  // over. No effect, no timer, and a notification that arrives during the
  // refresh is never swallowed by a stale "everything is read" flag.
  const [clearedSnapshot, setClearedSnapshot] = useState<string | null>(null);

  const markOne = (id: string) => {
    setReadIds((prev) => new Set(prev).add(id));
    startTransition(async () => {
      await markNotificationReadAction(id);
      router.refresh();
    });
  };

  const markAll = (ids: readonly string[]) => {
    setReadIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    setClearedSnapshot(snapshot);
    startTransition(async () => {
      await markAllNotificationsReadAction(orgId ?? null);
      router.refresh();
    });
  };

  const clearedAll = clearedSnapshot === snapshot;
  const isRead = (item: NotificationView) => clearedAll || !item.unread || readIds.has(item.id);

  /*
   * What the BADGE should say right now.
   *
   * The server's total is the only number that counts rows beyond the twenty
   * this list holds, so it stays the base and the optimistic state is subtracted
   * from it — never replaced by a count of what happens to be on screen. A
   * reader with thirty unread who opens one notice sees 29, not 19.
   */
  const pendingRead = items.filter((i) => i.unread && readIds.has(i.id)).length;
  const effectiveUnread = clearedAll ? 0 : Math.max(0, unreadCount - pendingRead);

  return { markOne, markAll, isRead, effectiveUnread };
}

/**
 * A stable description of what the server last sent.
 *
 * Exported because the header trigger's badge has to expire its optimistic zero
 * against the same stamp the panel does — two different notions of "this is the
 * data I acted on" would let the badge and the list disagree.
 */
export function notificationSnapshot(items: readonly NotificationView[], unreadCount: number) {
  return `${unreadCount}|${items.map((i) => `${i.id}:${i.unread ? 1 : 0}`).join(",")}`;
}

function NotificationRow({
  item,
  read,
  dense,
  onActivate,
}: {
  item: NotificationView;
  read: boolean;
  dense: boolean;
  onActivate: () => void;
}) {
  const { t } = useI18n();

  const inner = (
    <>
      {/* The unread cue is a dot AND a visually-hidden word. Colour alone cannot
          carry the distinction — that is the whole of WCAG 1.4.1 — and a screen
          reader gets no signal at all from a coloured span. The dot keeps its
          gutter when the row is read, so nothing shifts sideways on marking. */}
      <span className="mt-1.5 flex w-2 shrink-0 justify-center" aria-hidden="true">
        {read ? null : <span className="h-2 w-2 rounded-pill bg-accent-solid" />}
      </span>

      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={cn("text-label text-fg", read ? "font-normal" : "font-semibold")}>
          {read ? null : <span className="sr-only">{t("notifications.unread")} — </span>}
          {item.title}
        </span>
        {item.body && !dense ? (
          <span className="text-label text-fg-muted">{item.body}</span>
        ) : null}
        <time dateTime={item.timestamp} className="text-label text-fg-muted">
          {item.timeAgo}
        </time>
      </span>
    </>
  );

  const shared = cn(
    "flex w-full items-start gap-2 text-start",
    // The header panel is edge-to-edge, so its rows own the gutter. The
    // dashboard block sits inside a `Panel` body that already has `px-md`, and a
    // row adding its own would indent the list past every neighbouring block in
    // the row. Density is the only thing that differs between the two surfaces.
    dense ? "py-2" : "px-md py-2.5",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus",
  );

  // A row with no usable destination still renders and can still be marked read.
  // It becomes a button rather than a dead anchor, because an <a> without an
  // href is not a link to anything and is not reachable by keyboard.
  if (!item.href) {
    return (
      <button
        type="button"
        onClick={onActivate}
        data-testid="notification-row"
        data-unread={read ? "false" : "true"}
        className={cn(shared, "hover:bg-surface-hover")}
      >
        {inner}
      </button>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onActivate}
      data-testid="notification-row"
      data-unread={read ? "false" : "true"}
      className={cn(shared, "hover:bg-surface-hover")}
    >
      {inner}
    </Link>
  );
}

export function NotificationList({
  items,
  unreadCount = 0,
  orgId,
  dense = false,
  showMarkAll = true,
  readState,
}: {
  items: readonly NotificationView[];
  /** The server's unread total. Only used when this list owns its read state. */
  unreadCount?: number;
  /** UX scope — the same org `listNotifications` filtered on, or null. */
  orgId?: string | null;
  /** The dashboard block's density: title and time only, no body line. */
  dense?: boolean;
  showMarkAll?: boolean;
  /**
   * Supplied by a parent that ALSO renders from this state — the header, whose
   * unread badge sits on the trigger, outside the panel. Sharing one hook is
   * what stops the badge and the rows beneath it from disagreeing mid-refresh.
   * Omitted by the dashboard block, which owns nothing else and manages its own.
   */
  readState?: NotificationReadState;
}) {
  const { t } = useI18n();
  // Called unconditionally — hooks must be — and simply unused when the parent
  // owns the state. The cost is one idle `useState` pair.
  const own = useNotificationReadState(items, unreadCount, orgId);
  const { markOne, markAll, isRead } = readState ?? own;

  const rows = items.map((item) => ({ item, read: isRead(item) }));
  const anyUnread = rows.some((r) => !r.read);

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col" data-testid="notification-list">
        {rows.map(({ item, read }) => (
          <li key={item.id} className="flex border-b last:border-b-0">
            <NotificationRow
              item={item}
              read={read}
              dense={dense}
              onActivate={() => {
                // Idempotent in the database, so firing it for an
                // already-read row is a no-op rather than a thing to guard.
                if (!read) markOne(item.id);
              }}
            />
          </li>
        ))}
      </ul>

      {showMarkAll && anyUnread ? (
        <div className={cn("border-t py-2", dense ? undefined : "px-md")}>
          <button
            type="button"
            onClick={() => markAll(items.map((i) => i.id))}
            data-testid="notifications-mark-all"
            className="rounded-sm text-label font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
          >
            {t("notifications.markAllRead")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
