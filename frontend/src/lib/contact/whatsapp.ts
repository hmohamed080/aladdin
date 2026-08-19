/**
 * WhatsApp hand-off links.
 *
 * WHAT THIS IS AND, MORE IMPORTANTLY, WHAT IT IS NOT
 * This builds a `wa.me` deep link: a URL that OPENS WhatsApp on the manager's own
 * device with a conversation addressed to the invitee and a message already
 * typed. It is not a sending API. Nothing here talks to the WhatsApp Business
 * API, to a gateway, or to any external service; no request leaves the browser;
 * the invitation is not delivered until a human presses Send inside WhatsApp.
 *
 * That distinction has to survive contact with the UI copy. A button that opens
 * a pre-filled chat and a button that dispatches a message look identical for the
 * half-second before WhatsApp appears, and a manager who believes the invitation
 * went out stops chasing an invitee who was never contacted. So the label says
 * "Send via WhatsApp" — an instruction to the app, not a claim about the past —
 * and the surrounding copy states that the message still has to be sent.
 *
 * The link is also not the only route. It can fail for reasons this code cannot
 * see (no WhatsApp installed, a blocked handler, a desktop without the client),
 * so the invitation URL is always copyable beside it — the WhatsApp button is a
 * shortcut over the copy path, never a replacement for it.
 *
 * FORMAT
 * `https://wa.me/<digits>?text=<urlencoded>` — digits only: no `+`, spaces or
 * punctuation, which is exactly E.164 with the plus removed. With no usable
 * number, the number segment is omitted and WhatsApp opens its contact picker
 * with the same message ready, which is the right fallback rather than an error.
 */

export function whatsappShareUrl({
  phone,
  message,
}: {
  /** E.164 preferred (`+201002003040`); anything non-numeric is stripped. */
  phone?: string | null;
  message: string;
}): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  // `encodeURIComponent` is what makes the template safe: the message carries a
  // URL with its own `?`/`&`/`=`, plus newlines, and none of them may be read as
  // structure by the wa.me query string.
  const text = encodeURIComponent(message);
  return digits ? `https://wa.me/${digits}?text=${text}` : `https://wa.me/?text=${text}`;
}
