/**
 * The one seam between a record page and the header Chat panel.
 *
 * Transaction entry points (RFQ / quotation / order actions) open their canonical
 * conversation and then ask the ALREADY-MOUNTED header control to show its thread.
 * A window CustomEvent is deliberately chosen over URL params or cookies: the
 * panel lives in the shared LAYOUT (which never sees searchParams), and chat
 * state is ephemeral UI state, not a preference worth persisting. The event
 * carries only a conversation id the server action just returned for THIS caller
 * — it grants nothing and can open nothing RLS does not allow.
 */
export const CHAT_OPEN_EVENT = "aladdin:chat-open";

export function requestPanelChat(conversationId: string): void {
  window.dispatchEvent(
    new CustomEvent(CHAT_OPEN_EVENT, { detail: { conversationId } }),
  );
}

export function onPanelChatRequest(handler: (conversationId: string) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ conversationId?: string }>).detail;
    if (detail?.conversationId) handler(detail.conversationId);
  };
  window.addEventListener(CHAT_OPEN_EVENT, listener);
  return () => window.removeEventListener(CHAT_OPEN_EVENT, listener);
}
