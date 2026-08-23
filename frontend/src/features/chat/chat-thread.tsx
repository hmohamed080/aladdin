"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { Button } from "@/components/ui/controls";
import {
  loadConversationThreadAction,
  markConversationReadAction,
  sendMessageAction,
} from "@/server/actions/chat";
import type { MessageRow } from "@/server/queries/chat";
import { CHAT_ACCESS_DENIED, toMessageView, type MessageView } from "@/features/chat/view-model";

/**
 * ONE CONVERSATION THREAD — rendered inside the Header Chat panel.
 *
 * Plain transactional correspondence, not a consumer messenger: chronological
 * plain-text bodies exactly as authored, a muted attribution line, and an
 * alignment cue that says which SIDE of the transaction spoke — the viewer's
 * organization's messages sit toward the inline end on a quiet surface,
 * counterparty messages start flush like every other document text. No bubbles
 * with invented geometry, no gradients, no avatars (none exist to show).
 *
 * ATTRIBUTION IS HONEST ABOUT WHAT THE DATABASE EXPOSES. Message rows carry ids,
 * and other people's profile names are not readable under RLS — so a message is
 * attributed to its ORGANIZATION context ("You", the active organization's name,
 * or the counterparty's name), never to an invented person.
 *
 * READ STATE IS MARKED WHEN THE THREAD IS GENUINELY OPENED — once, here, after a
 * successful authorized load. Opening the panel alone marks nothing; a
 * conversation whose load fails stays unread.
 */
export function ChatThread({
  conversationId,
  sides,
  header,
  viewer,
  onBack,
  onOpened,
}: {
  conversationId: string;
  /** This conversation's two parties, from the already-authorized row. */
  sides: { requesterOrgId: string; supplierOrgId: string };
  header: {
    subjectLabelKey: string | null;
    subjectTitle: string | null;
    counterpartyName: string | null;
  };
  viewer: { userId: string | null; activeOrgId: string | null; activeOrgName: string | null };
  onBack: () => void;
  /** Fires when this thread was opened AND marked read server-side. */
  onOpened: (conversationId: string) => void;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();

  const [messages, setMessages] = useState<MessageView[] | null>(null);
  const [loadCode, setLoadCode] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [sendCode, setSendCode] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  const buildViews = useCallback(
    (rows: readonly MessageRow[]) =>
      rows.map((row) => toMessageView(row, sides, viewer, locale)),
    [sides, viewer, locale],
  );

  // Load once per open. On success the read pointer advances — the reader IS
  // looking at it — and the header badge reconciles through `router.refresh()`,
  // which refetches this route plus its layouts without a browser reload.
  useEffect(() => {
    let cancelled = false;
    setMessages(null);
    setLoadCode(null);
    startTransition(async () => {
      const result = await loadConversationThreadAction(conversationId);
      if (cancelled) return;
      if (!result.ok) {
        setLoadCode(result.code);
        return;
      }
      setMessages(buildViews(result.messages));
      onOpened(conversationId);
      await markConversationReadAction(conversationId);
      router.refresh();
    });
    return () => {
      cancelled = true;
    };
    // A thread instance is mounted for ONE conversation; props it reads below do
    // not change while it is mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Keep the newest message in view — once when history arrives, and after each
  // sent message replaces the list.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  const trimmed = body.trim();
  const overLimit = body.length > 4000;

  const handleSend = async () => {
    if (sending || !trimmed || overLimit) return;
    setSending(true);
    setSendCode(null);
    const result = await sendMessageAction(conversationId, body);
    if (result.ok) {
      setBody("");
      // Re-read the persisted truth (the database trimmed edges) instead of
      // guessing at what came back, then let the badge/list catch up.
      const refreshed = await loadConversationThreadAction(conversationId);
      if (refreshed.ok) setMessages(buildViews(refreshed.messages));
      router.refresh();
    } else {
      setSendCode(result.code ?? "states.genericRetry");
    }
    setSending(false);
  };

  /* ---- Load outcomes -------------------------------------------------- */

  if (loadCode) {
    return (
      <div className="flex flex-col gap-3 px-md py-xl">
        {/* Neutral by design: access loss must not disclose whether the
            conversation still exists (§7.6). */}
        <p className="text-body text-fg-secondary">
          {t(loadCode === CHAT_ACCESS_DENIED ? "chat.error.access" : "states.genericRetry")}
        </p>
        <div>
          <Button variant="outline" onClick={onBack}>
            {t("chat.thread.back")}
          </Button>
        </div>
      </div>
    );
  }

  if (messages === null) {
    return (
      <div className="px-md py-xl" aria-busy="true" data-testid="chat-thread-loading">
        <p className="text-label text-fg-muted">{t("common.loading")}</p>
      </div>
    );
  }

  const subjectLine = [
    header.subjectLabelKey ? t(header.subjectLabelKey) : null,
    header.counterpartyName ?? header.subjectTitle,
  ]
    .filter(Boolean)
    .join(" · ");

  /* ---- Thread ---------------------------------------------------------- */

  return (
    <div className="flex max-h-[60vh] flex-col" data-testid="chat-thread">
      <div className="flex items-center gap-2 border-b px-md py-2">
        <button
          type="button"
          onClick={onBack}
          data-testid="chat-thread-back"
          /* `shrink-0` + `nowrap`: the subject beside it truncates instead, so a
             long counterparty name can never wrap the back control onto two lines. */
          className="shrink-0 whitespace-nowrap rounded-sm text-label font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
        >
          {t("chat.thread.back")}
        </button>
        {subjectLine ? (
          <p className="min-w-0 truncate text-label text-fg-muted">{subjectLine}</p>
        ) : null}
      </div>

      {messages.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 px-md py-lg text-center">
          <p className="text-body font-medium text-fg">{t("chat.thread.empty.title")}</p>
          <p className="max-w-56 text-label text-fg-muted">{t("chat.thread.empty.body")}</p>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-md py-2"
          data-testid="chat-message-list"
        >
          <ol className="flex flex-col gap-2.5">
            {messages.map((message) => (
              <li
                key={message.id}
                data-testid="chat-message"
                data-side={message.side ?? ""}
                className={cn(
                  "flex flex-col",
                  message.fromActiveOrg ? "items-end text-end" : "items-start text-start",
                )}
              >
                <p className="text-[13px] leading-snug text-fg-muted">
                  {message.fromCurrentUser
                    ? t("chat.thread.you")
                    : message.fromActiveOrg && viewer.activeOrgName
                      ? viewer.activeOrgName
                      : header.counterpartyName}
                  <span aria-hidden="true"> · </span>
                  <time dateTime={message.timestamp}>{message.timeLabel}</time>
                </p>
                {/* Exactly as authored — no translation, no rewriting (§17).
                    `whitespace-pre-wrap` preserves the author's line breaks. */}
                <p
                  className={cn(
                    "mt-0.5 max-w-full whitespace-pre-wrap break-words text-body text-fg",
                    message.fromActiveOrg &&
                      "rounded-sm bg-surface-2 px-2 py-1.5 text-start",
                  )}
                >
                  {message.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Composer — plain text only. The 4000-character maximum is the UI
          boundary of the database's own rule, which remains the final authority:
          `send_message` trims and enforces both constraints again at rest. */}
      <form
        className="border-t px-md py-2"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSend();
        }}
      >
        <label htmlFor="chat-composer" className="sr-only">
          {t("chat.composer.label")}
        </label>
        <textarea
          id="chat-composer"
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            setSendCode(null);
          }}
          maxLength={4000}
          rows={2}
          placeholder={t("chat.composer.placeholder")}
          data-testid="chat-composer"
          className="w-full resize-none rounded-sm border bg-surface-2 px-2.5 py-2 text-body text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
        />
        {overLimit ? (
          <p className="mt-1 text-label text-danger">{t("chat.composer.tooLong", { count: 4000 })}</p>
        ) : null}
        {sendCode && !overLimit ? (
          <p role="alert" className="mt-1 text-label text-danger">
            {t(sendCode)}
          </p>
        ) : null}
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span aria-live="polite" className="text-label text-fg-muted" data-testid="chat-send-status">
            {sending ? t("chat.composer.sending") : ""}
          </span>
          {/* A plain Button, not `SubmitButton`: that one reads pending state from
              `useFormStatus`, which only tracks a server-action form — this
              composer awaits its own action so it owns its pending gate. */}
          <Button
            type="submit"
            variant="accent"
            disabled={!trimmed || overLimit || sending}
            aria-busy={sending}
            data-testid="chat-send"
          >
            {sending ? t("chat.composer.sending") : t("chat.composer.send")}
          </Button>
        </div>
      </form>
    </div>
  );
}
