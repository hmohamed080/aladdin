"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/controls";
import { MessageIcon } from "@/components/ui/icons";
import { openConversationAction } from "@/server/actions/chat";
import { CHAT_ACCESS_DENIED } from "@/features/chat/view-model";
import { requestPanelChat } from "@/features/chat/open-chat-event";

/**
 * THE TRANSACTIONAL CHAT ENTRY POINT — one button on an RFQ, quotation or order
 * detail page.
 *
 * It supplies ONLY the subject type and id. The conversation's party
 * organizations are derived inside `open_conversation` from the authoritative
 * subject row; no organization id passes through this component in either
 * direction, and there is no prop for one.
 *
 * On success it asks the already-mounted header Chat panel to open this thread
 * (`requestPanelChat`) and refreshes the route so the header list and badge show
 * the conversation immediately — no browser reload.
 *
 * DRAFT SUBJECTS DO NOT RENDER THE BUTTON AT ALL: a draft RFQ or quotation is
 * private to its owning side (chat-core.md §10.1), so there is nothing to open,
 * and a control whose only outcome is an error would be dishonest chrome. Orders
 * are visible to both parties from creation, so theirs always renders.
 */
export function OpenConversationButton({
  subjectType,
  subjectId,
}: {
  subjectType: "rfq" | "quotation" | "order";
  subjectId: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        aria-busy={pending}
        data-testid={`chat-open-${subjectType}`}
        onClick={() =>
          startTransition(async () => {
            setErrorCode(null);
            const result = await openConversationAction(subjectType, subjectId);
            if (!result.ok || !result.conversationId) {
              // Neutral by design — access loss never discloses whether the
              // subject still has a conversation (chat-core.md §7.6).
              setErrorCode(result.code ?? "states.genericRetry");
              return;
            }
            requestPanelChat(result.conversationId);
            router.refresh();
          })
        }
      >
        <MessageIcon size={14} />
        {pending ? t("chat.openFromRecordSending") : t("chat.openFromRecord")}
      </Button>
      {errorCode ? (
        <p role="alert" className="max-w-48 text-end text-label text-danger">
          {t(errorCode === CHAT_ACCESS_DENIED ? "chat.error.access" : errorCode)}
        </p>
      ) : null}
    </div>
  );
}
