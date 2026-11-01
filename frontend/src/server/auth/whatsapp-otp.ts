import "server-only";

import { readPublicEnv, readWhatsAppEnv } from "@/lib/env";

/**
 * Sends a sign-up verification code through the Meta WhatsApp Cloud API, as
 * the approved Authentication template (WHATSAPP_OTP_TEMPLATE) with the code
 * in the body and in the copy-code button. The code and the number are never
 * logged; failures log a Graph error code only.
 *
 * Locally, with no access token, the code is printed to the server console so
 * the flow can be exercised without Meta. Anywhere else a missing setting is
 * "unavailable" (fail closed), never a silent success.
 */

const GRAPH_VERSION = "v21.0";
const TEMPLATE_LANGUAGE: Record<"en" | "ar", string> = { en: "en", ar: "ar" };

/**
 * Recipient allowlist. Delivery is explicitly controlled in EVERY environment (production included): an empty or unset
 * list means nobody may be messaged. A wider rollout is a separate, approved code change, never a missing setting.
 */
export function recipientAllowed(e164: string, allowList: string | undefined): boolean {
  const list = (allowList ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  return list.includes(e164);
}

export type WhatsAppSendResult = "sent" | "unavailable" | "invalid_number" | "failed";

export async function sendWhatsAppCode(
  e164: string,
  code: string,
  locale: "en" | "ar",
  fetcher: typeof fetch = fetch,
): Promise<WhatsAppSendResult> {
  let env;
  try {
    env = readWhatsAppEnv();
  } catch {
    return "unavailable";
  }
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_OTP_TEMPLATE) {
    if (readPublicEnv().NEXT_PUBLIC_APP_ENV === "local" && !env.WHATSAPP_ACCESS_TOKEN) {
      console.info(`[local only] WhatsApp sign-up code for ${e164}: ${code}`);
      return "sent";
    }
    return "unavailable";
  }
  // Not an allowed test recipient: answer exactly like an unconfigured sender, so the response says nothing about the list.
  if (!recipientAllowed(e164, env.WHATSAPP_ALLOWED_RECIPIENTS)) return "unavailable";

  let response: Response;
  try {
    response = await fetcher(`https://graph.facebook.com/${GRAPH_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: e164.slice(1),
        type: "template",
        template: {
          name: env.WHATSAPP_OTP_TEMPLATE,
          language: { code: env.WHATSAPP_OTP_LANGUAGE ?? TEMPLATE_LANGUAGE[locale] },
          components: [
            { type: "body", parameters: [{ type: "text", text: code }] },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
          ],
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    console.error("whatsapp code: request failed (network)");
    return "failed";
  }
  if (response.ok) return "sent";

  const body = (await response.json().catch(() => null)) as { error?: { code?: number } } | null;
  const graphCode = body?.error?.code;
  console.error(`whatsapp code: send rejected (status ${response.status}, code ${graphCode ?? "unknown"})`);
  // 131026: message undeliverable (not a WhatsApp number). 131030: recipient not in the test allow-list.
  if (graphCode === 131026 || graphCode === 131030) return "invalid_number";
  if (response.status === 401 || graphCode === 190 || graphCode === 132001) return "unavailable";
  return "failed";
}

/**
 * The message budget (codes per rolling 24 h, all numbers). Required in every environment: undefined means no sending.
 * The limit is enforced atomically by the database (phone_challenge_issue), not by this process. Locally with no token
 * (codes are only printed) a generous default applies.
 */
export function dailySendLimit(): number | null {
  try {
    const env = readWhatsAppEnv();
    if (env.WHATSAPP_DAILY_SEND_LIMIT !== undefined) return env.WHATSAPP_DAILY_SEND_LIMIT;
    return !env.WHATSAPP_ACCESS_TOKEN && readPublicEnv().NEXT_PUBLIC_APP_ENV === "local" ? 1000 : null;
  } catch {
    return null;
  }
}

/** Whether a code may be sent to `e164` at all, checked BEFORE a budget slot is reserved. */
export function sendingEnabledFor(e164: string): boolean {
  try {
    const env = readWhatsAppEnv();
    if (!env.WHATSAPP_ACCESS_TOKEN && readPublicEnv().NEXT_PUBLIC_APP_ENV === "local") return true;
    return recipientAllowed(e164, env.WHATSAPP_ALLOWED_RECIPIENTS) && dailySendLimit() !== null;
  } catch {
    return false;
  }
}
