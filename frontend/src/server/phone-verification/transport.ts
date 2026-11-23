/**
 * Delivery adapter boundary. The authority never delivers anything itself: the application server hands a freshly generated
 * code to an adapter. The Cloudflare Worker (WhatsApp) is a FUTURE implementation of this interface and stays a pure
 * transport - it receives (destination, code), holds no proof state and is never the source of truth.
 *
 * B1 ships only two implementations: a transport that refuses to send, and an in-memory fake for tests.
 */
export type OtpMessage = {
  to: string;
  code: string;
  ttlSeconds: number;
  /** Which proof this code belongs to (an adapter may choose a template or an audit tag from it). */
  purpose?: "primary_proof" | "signup_proof";
  locale?: "en" | "ar";
  /**
   * The identity of THIS delivery: the challenge id. The worker adapter signs it as the request id and the Worker's replay journal is keyed on it,
   * so one challenge can never produce a second provider message even if the same delivery is attempted twice. Required by the worker adapter.
   */
  deliveryId?: string;
};
/*
 * Contract for EVERY implementation (see delivery.ts for the selectable ones): send() throws on any failure, the thrown message
 * never contains the destination or the code, and nothing in a transport may log either of them.
 */

export interface PhoneOtpTransport {
  send(message: OtpMessage): Promise<void>;
}

/** Default in B1: delivery is not enabled anywhere, so any attempt to send fails closed. */
export const disabledTransport: PhoneOtpTransport = {
  async send() {
    throw new Error("phone OTP delivery is disabled");
  },
};

/** Test double: records messages in memory, never touches a network. */
export function createFakeTransport(options: { failWith?: Error } = {}) {
  const sent: OtpMessage[] = [];
  const transport: PhoneOtpTransport = {
    async send(message) {
      if (options.failWith) throw options.failWith;
      sent.push({ ...message });
    },
  };
  return { transport, sent };
}
