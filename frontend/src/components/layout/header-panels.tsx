"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { headerIconClass, headerPanelClass } from "@/components/layout/header-parts";
import Link from "next/link";
import { BellIcon, MegaphoneIcon, MessageIcon } from "@/components/ui/icons";
import {
  NotificationList,
  useNotificationReadState,
} from "@/features/notifications/notification-list";
import type { NotificationView } from "@/features/notifications/view-model";
import { formatCount } from "@/lib/ui/format";

/**
 * CHAT AND NOTIFICATIONS — ONE SHELL, NOW HALF FILLED.
 *
 * `HeaderMenu` owns the trigger, the panel, and every interaction that has
 * nothing to do with content: outside-click and Escape to close, focus handling,
 * `aria-haspopup`/`aria-expanded`, RTL anchoring, mobile width clamping. Chat and
 * Notifications are then just a title, an icon and a BODY.
 *
 * That prediction held. NOTIFICATIONS now has a table behind it
 * (`docs/database/notifications-core.md`), so its body is a real list and its
 * trigger carries a real count — and the change was exactly the two things this
 * note said it would be: `<EmptyPanel …/>` swapped for a list, and a `badge`
 * passed in. No geometry moved.
 *
 * CHAT IS STILL A SHELL, and the original rules still bind it:
 *
 *   - no unread COUNT, and no badge that could imply one. A number is a claim,
 *     and every number `ChatMenu` could render today would be invented;
 *   - no rows, no sample conversations, no "3 new" — the panel says plainly that
 *     there is nothing yet, which is the truth and reads as a finished empty
 *     state rather than a broken list;
 *   - no local storage, no polling, no realtime subscription, no query.
 *
 * There is no messaging model in the repository and Chat is explicitly out of
 * scope for Notifications Core, so it stays as built.
 *
 * They are shared components, mounted once in the shared `AppHeader`, so every
 * authenticated surface gets the same two controls. There is no persona-specific
 * variant of either, and there must not be one.
 */
/**
 * One shell gutter. The panel stops this far short of either screen edge — the
 * same 0.75rem `menuSurfaceClass` already reserves for its width cap, so a
 * clamped panel lines up with every other floating surface instead of sitting a
 * few pixels off its own rule.
 */
const PANEL_GUTTER = 12;

/**
 * THE PANEL SURFACE, HELD INSIDE THE VIEWPORT.
 *
 * The panel is anchored to its TRIGGER (`end-0` on the 28px control), and that
 * is the right relationship: a panel that detaches from the control that opened
 * it reads as a different surface. But the trigger is not at the edge of the
 * screen — Notifications sits fifth in a cluster of seven, ~130px in from the
 * header's inline-end edge. A desktop header has room to spare for the 320px
 * panel to hang inward from there. At 393px it does not, so the panel ran off
 * the far edge and clipped the START of every row — which in Arabic is the first
 * word of every sentence.
 *
 * `menuSurfaceClass` caps the panel's WIDTH against the viewport, and that cap
 * is precisely why this survived the pass that introduced it: a max-width can
 * only rescue a surface that is too WIDE. This one is the approved width and in
 * the wrong PLACE, and no max-width moves a box.
 *
 * So the position is corrected after layout and before paint. Three properties
 * make this a small fix rather than a positioning system:
 *
 *   - It is PHYSICAL, so there is no direction branch. `getBoundingClientRect`
 *     and `translateX` are both left-to-right whatever `dir` says, so RTL and
 *     LTR overflow — exact mirror images — are corrected by the same subtraction.
 *     A logical fix would have needed two cases and could only ever be half
 *     tested.
 *   - It is a NO-OP where it is not needed. On a desktop header nothing falls
 *     outside the gutter, `dx` is 0, no transform is written, and the approved
 *     desktop geometry is not merely preserved but untouched.
 *   - It has no breakpoint. The panel is held inside whatever width it is opened
 *     at, so this cannot drift the next time the control cluster gains or loses
 *     an icon — which is the change that would silently re-break a `tablet:`
 *     override.
 *
 * Rendered only while open, which is what lets it use `useLayoutEffect` without
 * an isomorphic shim: `open` is false through SSR, so this component and its
 * measurement never run on the server.
 */
function HeaderPanelSurface({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = panel.current;
    if (!node) return;

    const clamp = () => {
      /* Cleared before measuring so the rect is of the NATURAL box. Reading a
         rect that already includes the previous correction would compound it on
         every resize until the panel walked off the opposite edge. This writes
         to the node rather than to state on purpose: a state round trip paints
         the unclamped position first, and that flash is the thing being fixed. */
      node.style.transform = "";
      const rect = node.getBoundingClientRect();
      // `clientWidth`, not `innerWidth`: the visible viewport excludes the
      // scrollbar, and the panel must clear the content edge, not the glass.
      const viewport = document.documentElement.clientWidth;
      // A box that has not been laid out cannot be clamped, and pretending a
      // zero-width viewport is real would shove every panel to a fixed 12px.
      if (!viewport) return;

      let dx = 0;
      if (rect.right > viewport - PANEL_GUTTER) dx = viewport - PANEL_GUTTER - rect.right;
      /* Checked second and allowed to win. With the width cap in force both
         edges always fit at once, so this only decides anything if that cap is
         ever removed — and then the start of the content is the half worth
         keeping. */
      if (rect.left + dx < PANEL_GUTTER) dx = PANEL_GUTTER - rect.left;

      node.style.transform = dx ? `translateX(${Math.round(dx)}px)` : "";
    };

    clamp();
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, []);

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label={label}
      data-testid={`${testId}-panel`}
      // Above the header (200) and the sidebar's hover reveal (300), because
      // a panel that opens under either is a panel that looks broken.
      className={headerPanelClass}
      style={{ zIndex: 400 }}
    >
      <p className="border-b px-md py-2.5 text-label font-semibold text-fg">{label}</p>
      {children}
    </div>
  );
}

function HeaderMenu({
  icon,
  label,
  testId,
  badge,
  children,
}: {
  icon: ReactNode;
  /** Accessible name AND panel heading — one word for the same thing. */
  label: string;
  testId: string;
  /**
   * A real, server-computed count. There is no default and no zero case: a
   * caller with nothing to report passes nothing, so the ONLY way a number
   * reaches the chrome is for something to have counted it.
   *
   * `srLabel` exists because the badge renders a bare numeral, and a numeral
   * does not say what it counts. It is folded into the trigger's accessible
   * name so the control announces "Notifications, 3 unread" rather than
   * "Notifications" beside an unexplained 3.
   */
  badge?: { display: string; srLabel: string };
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={badge ? `${label} — ${badge.srLabel}` : label}
        title={label}
        data-testid={testId}
        className={cn(headerIconClass, "relative", open && "bg-surface-hover text-fg")}
      >
        {icon}
        {badge ? (
          /* The count rides the CORNER of the existing 28px control rather than
             sitting beside it: the header's icon boxes are a fixed geometry
             (`headerIconClass`) and a badge that took horizontal space would
             reflow the whole control cluster the moment a notice arrived.
             `min-w` with horizontal padding lets a two- or three-digit count
             grow the pill instead of clipping it — no invented "9+" convention,
             which the design system has not set. */
          <span
            aria-hidden="true"
            data-testid={`${testId}-badge`}
            className="absolute -top-0.5 end-[-2px] grid h-4 min-w-4 place-items-center rounded-pill bg-accent-solid px-1 text-[10px] font-semibold leading-none text-brand-lumen-ink"
          >
            {badge.display}
          </span>
        ) : null}
      </button>

      {open ? (
        <HeaderPanelSurface label={label} testId={testId}>
          {children}
        </HeaderPanelSurface>
      ) : null}
    </div>
  );
}

/**
 * The finished empty state both panels show.
 *
 * It is a real design, not a placeholder: a muted glyph, a plain statement, and
 * one line of what will appear here. An empty state that looks unfinished trains
 * people to read the whole feature as unfinished. For Chat it remains the only
 * thing the panel can honestly show; for Notifications it is now the ZERO CASE
 * of a real list, which is what it was always shaped to become.
 */
function EmptyPanel({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-md py-xl text-center">
      <span className="grid h-10 w-10 place-items-center rounded-pill bg-surface-2 text-fg-muted">
        {icon}
      </span>
      <p className="text-body font-medium text-fg">{title}</p>
      <p className="max-w-56 text-label text-fg-muted">{body}</p>
    </div>
  );
}

export function ChatMenu() {
  const { t } = useI18n();
  return (
    <HeaderMenu icon={<MessageIcon size={16} />} label={t("nav.chat")} testId="header-chat">
      <EmptyPanel
        icon={<MessageIcon size={18} />}
        title={t("chat.empty.title")}
        body={t("chat.empty.body")}
      />
    </HeaderMenu>
  );
}

/**
 * NOTIFICATIONS — the shell above, now with the real inbox inside it.
 *
 * Every piece of chrome this component had is untouched: `HeaderMenu` still owns
 * the trigger, the panel, outside-click, Escape, focus, `aria-haspopup`, RTL
 * anchoring and the mobile width clamp. What changed is the BODY, exactly as the
 * shell was built to allow — the empty state is now the zero case rather than
 * the only case, and the badge the original note refused to invent is finally
 * a number somebody counted.
 *
 * Read state is owned HERE rather than inside the list, because the badge lives
 * on the trigger — outside the panel — and both have to move together. One hook,
 * one truth, no window in which the count and the rows disagree.
 */
export function NotificationsMenu({
  items = [],
  unreadCount = 0,
  orgId,
}: {
  items?: readonly NotificationView[];
  unreadCount?: number;
  /** The active workspace the list was scoped to, or null on a personal surface. */
  orgId?: string | null;
} = {}) {
  const { t, locale } = useI18n();
  const readState = useNotificationReadState(items, unreadCount, orgId);
  const unread = readState.effectiveUnread;

  return (
    <HeaderMenu
      icon={<BellIcon size={16} />}
      label={t("nav.notifications")}
      testId="header-notifications"
      /* No badge at zero — not a badge showing "0". An empty count still draws
         the eye to the bell and still implies something is waiting there. */
      badge={
        unread > 0
          ? {
              display: formatCount(unread, locale),
              srLabel: t("notifications.unreadCount", { count: unread }),
            }
          : undefined
      }
    >
      {items.length === 0 ? (
        <EmptyPanel
          icon={<BellIcon size={18} />}
          title={t("notifications.empty.title")}
          body={t("notifications.empty.body")}
        />
      ) : (
        /* The cap belongs to the CONTENT, not to `headerPanelClass`: the shared
           panel surface is width and elevation, and a height limit written there
           would apply to Chat and Feedback, neither of which scrolls. */
        <div className="max-h-[60vh] overflow-y-auto overscroll-contain">
          <NotificationList items={items} orgId={orgId} readState={readState} />
        </div>
      )}
    </HeaderMenu>
  );
}

/**
 * FEEDBACK — THE SHELL OF A COMPOSER, NOT AN EMPTY INBOX.
 *
 * Chat and Notifications are inboxes, so their honest shell is an empty state.
 * Feedback is a COMPOSER: there is nothing for it to be empty of, and an "empty
 * state" here would say nothing true. What it shows instead is the real surface
 * the next sprint will wire — heading, field, submit — with both controls inert
 * and one plain line saying sending is not open. Attaching a backend is then a
 * server action on the form plus dropping `readOnly`/`disabled`; no geometry in
 * this header moves.
 *
 * WHY THE FIELD IS `readOnly` AND NOT `disabled`
 * A disabled textarea is removed from the tab order, so a keyboard or screen
 * reader user would never reach the control OR the explanation attached to it —
 * the panel would read as empty. `readOnly` keeps it focusable and announced,
 * `aria-describedby` ties it to the reason, and nothing typed can be submitted
 * because there is no submit path at all. The BUTTON is genuinely disabled,
 * because a button that cannot act is exactly what `disabled` means.
 *
 * The support link is here because it is the one thing that DOES work today: a
 * shell that only says "not yet" is a dead end, and this one still hands over to
 * a real destination.
 */
export function FeedbackMenu() {
  const { t } = useI18n();
  const noteId = useId();
  return (
    <HeaderMenu
      icon={<MegaphoneIcon size={16} />}
      label={t("nav.feedback")}
      testId="header-feedback"
    >
      <div className="flex flex-col gap-2 px-md py-3">
        <p className="text-body font-medium text-fg">{t("feedback.heading")}</p>

        <textarea
          readOnly
          rows={3}
          aria-describedby={noteId}
          placeholder={t("feedback.placeholder")}
          data-testid="feedback-input"
          className="w-full resize-none rounded-sm border bg-surface-2 px-2.5 py-2 text-body text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
        />

        <p id={noteId} className="text-label text-fg-muted">
          {t("feedback.notConnected")}
        </p>

        <button
          type="button"
          disabled
          data-testid="feedback-send"
          className="mt-0.5 w-full rounded-sm bg-accent-solid px-3 py-2 text-label font-semibold text-brand-lumen-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("feedback.send")}
        </button>

        <p className="mt-1 border-t pt-2.5 text-label text-fg-muted">
          {t("feedback.supportPrompt")}{" "}
          <Link
            href="/auth/support"
            className="font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
          >
            {t("feedback.supportLink")}
          </Link>
        </p>
      </div>
    </HeaderMenu>
  );
}
