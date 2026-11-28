import "server-only";

import { readEmailEnv, readPublicEnv } from "@/lib/env";

/**
 * Transactional email through Resend's HTTP API (no SDK dependency: one POST). Used for the contact-email verification
 * link only. Never logs a recipient, a body or a link.
 *
 *   * RESEND_API_KEY + EMAIL_FROM set     -> POST https://api.resend.com/emails
 *   * no key, NEXT_PUBLIC_APP_ENV=local   -> the message is written to `<cwd>/.dev-mail/<timestamp>.json` for a developer
 *                                            to open (local only; the directory is gitignored)
 *   * no key anywhere else                -> { ok: false } (fail closed: the caller cancels what it started)
 */
export type OutgoingEmail = { to: string; subject: string; text: string; html: string };
export type SendResult = { ok: true; transport: "resend" | "dev-mailbox" } | { ok: false };

export type EmailTransport = (message: OutgoingEmail) => Promise<SendResult>;

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export async function sendTransactionalEmail(message: OutgoingEmail): Promise<SendResult> {
  const { RESEND_API_KEY, EMAIL_FROM } = readEmailEnv();
  if (RESEND_API_KEY && EMAIL_FROM) {
    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return { ok: true, transport: "resend" };
      console.error(`transactional email: Resend refused the message (status ${response.status})`);
      return { ok: false };
    } catch {
      console.error("transactional email: Resend request failed");
      return { ok: false };
    }
  }
  if (readPublicEnv().NEXT_PUBLIC_APP_ENV === "local") return writeDevMailbox(message);
  console.error("transactional email: RESEND_API_KEY / EMAIL_FROM are not configured");
  return { ok: false };
}

async function writeDevMailbox(message: OutgoingEmail): Promise<SendResult> {
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), ".dev-mail");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${Date.now()}-${globalThis.crypto.randomUUID()}.json`), JSON.stringify(message, null, 2), "utf8");
    return { ok: true, transport: "dev-mailbox" };
  } catch {
    console.error("transactional email: local dev mailbox write failed");
    return { ok: false };
  }
}

/**
 * The origin an emailed link points at. Configured (APP_PUBLIC_ORIGIN) everywhere but local development, where the
 * request's own host is accepted. Returns null when nothing trustworthy is available (the caller fails closed).
 */
export function linkOrigin(requestHost: string | null, requestProto: string | null): string | null {
  const { APP_PUBLIC_ORIGIN } = readEmailEnv();
  if (APP_PUBLIC_ORIGIN) return new URL(APP_PUBLIC_ORIGIN).origin;
  if (readPublicEnv().NEXT_PUBLIC_APP_ENV !== "local" || !requestHost) return null;
  return `${requestProto === "https" ? "https" : "http"}://${requestHost}`;
}
