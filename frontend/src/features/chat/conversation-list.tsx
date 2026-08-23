"use client";

import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import type { ConversationView } from "@/features/chat/view-model";

/**
 * THE ONE CONVERSATION LIST — the Header Chat panel's body.
 *
 * Row language follows `NotificationRow` deliberately: an unread gutter that
 * keeps its width, a stacked text column, a relative timestamp. The two lists
 * are different DOMAINS, not two designs — a second visual grammar for chat rows
 * would be one more thing to keep in step every time the shared row language
 * evolves.
 *
 * A row OPENS ITS THREAD IN THE PANEL, so it is a button and not a link: there is
 * no destination route to navigate to, and a link without a destination is not
 * keyboard-reachable. The whole row is the single interactive element — no nested
 * controls (the same rule that keeps a notification row free of buttons).
 */
export function ConversationList({
  items,
  onOpen,
}: {
  items: readonly ConversationView[];
  onOpen: (conversationId: string) => void;
}) {
  const { t } = useI18n();

  return (
    <ul className="flex flex-col" data-testid="chat-conversation-list">
      {items.map((item) => {
        /* Line 1 names the transaction; line 2 adds what line 1 left out. */
        const primary = [
          item.subjectLabelKey ? t(item.subjectLabelKey) : null,
          item.counterpartyName ?? item.subjectTitle,
        ]
          .filter(Boolean)
          .join(" · ");
        const secondary = item.counterpartyName ? item.subjectTitle : null;

        return (
          <li key={item.id} className="flex border-b last:border-b-0">
            <button
              type="button"
              onClick={() => onOpen(item.id)}
              data-testid="chat-conversation-row"
              data-unread={item.unread ? "true" : "false"}
              aria-label={
                item.unread ? `${primary} — ${t("chat.unread")}` : primary || undefined
              }
              className={cn(
                "flex w-full items-start gap-2 px-md py-2.5 text-start",
                "hover:bg-surface-hover",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus",
              )}
            >
              {/* Unread cue: dot AND a screen-reader word — colour alone carries
                  nothing (WCAG 1.4.1). The gutter keeps its width when read so
                  rows never shift sideways. */}
              <span className="mt-1.5 flex w-2 shrink-0 justify-center" aria-hidden="true">
                {item.unread ? <span className="h-2 w-2 rounded-pill bg-accent-solid" /> : null}
              </span>

              <span className="flex min-w-0 flex-col gap-0.5">
                <span
                  className={cn(
                    "truncate text-label text-fg",
                    item.unread ? "font-semibold" : "font-normal",
                  )}
                >
                  {item.unread ? <span className="sr-only">{t("chat.unread")} — </span> : null}
                  {primary}
                </span>
                {secondary ? (
                  <span className="truncate text-label text-fg-muted">{secondary}</span>
                ) : null}
                <time dateTime={item.timestamp} className="text-label text-fg-muted">
                  {item.timeAgo}
                </time>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
