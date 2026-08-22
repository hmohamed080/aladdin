"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { headerIconClass, headerPanelClass } from "@/components/layout/header-parts";
import Link from "next/link";
import { BellIcon, MegaphoneIcon, MessageIcon } from "@/components/ui/icons";

/**
 * CHAT AND NOTIFICATIONS — THE SHELL, AND ONLY THE SHELL.
 *
 * These are the two entry points the header will need, built now so the surface
 * they open, the place they sit and the way they behave are settled before any
 * data exists. What is deliberately NOT here, and must not be added until the
 * persistence sprint lands:
 *
 *   - no unread COUNT, and no badge that could imply one. A number is a claim,
 *     and every number this component could render today would be invented;
 *   - no rows, no sample conversations, no "3 new" — the panels say plainly that
 *     there is nothing yet, which is the truth and reads as a finished empty
 *     state rather than a broken list;
 *   - no local storage, no polling, no realtime subscription, no query.
 *
 * WHAT THE NEXT SPRINT ATTACHES TO
 * `HeaderMenu` owns the trigger, the panel, and every interaction that has
 * nothing to do with content: outside-click and Escape to close, focus handling,
 * `aria-haspopup`/`aria-expanded`, RTL anchoring, mobile width clamping. Chat and
 * Notifications are then just a title, an icon and a BODY. Replacing
 * `<EmptyPanel …/>` with a real list — and passing a real `badge` — is the whole
 * of the UI change when the data arrives; nothing about the shell moves.
 *
 * They are shared components, mounted once in the shared `AppHeader`, so every
 * authenticated surface gets the same two controls. There is no persona-specific
 * variant of either, and there must not be one.
 */
function HeaderMenu({
  icon,
  label,
  testId,
  children,
}: {
  icon: ReactNode;
  /** Accessible name AND panel heading — one word for the same thing. */
  label: string;
  testId: string;
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
        aria-label={label}
        title={label}
        data-testid={testId}
        className={cn(headerIconClass, open && "bg-surface-hover text-fg")}
      >
        {icon}
      </button>

      {open ? (
        <div
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
      ) : null}
    </div>
  );
}

/**
 * The finished empty state both panels show.
 *
 * It is a real design, not a placeholder: a muted glyph, a plain statement, and
 * one line of what will appear here. An empty state that looks unfinished trains
 * people to read the whole feature as unfinished, and this one is the ONLY thing
 * either panel can honestly show until the data model exists.
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

export function NotificationsMenu() {
  const { t } = useI18n();
  return (
    <HeaderMenu icon={<BellIcon size={16} />} label={t("nav.notifications")} testId="header-notifications">
      <EmptyPanel
        icon={<BellIcon size={18} />}
        title={t("notifications.empty.title")}
        body={t("notifications.empty.body")}
      />
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
