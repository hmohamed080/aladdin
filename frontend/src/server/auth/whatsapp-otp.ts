import "server-only";

import { readPublicEnv, readWhatsAppEnv } from "@/lib/env";
import { countAllPhoneChallengesSince } from "@/lib/supabase/admin-server";

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

/** Recipient allowlist. Outside production it is mandatory: an empty list means nobody may be messaged. */
export function recipientAllowed(e164: string, allowList: string | undefined, appEnv: string): boolean {
  const list = (allowList ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  if (list.length === 0) return appEnv === "production";
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
  if (!recipientAllowed(e164, env.WHATSAPP_ALLOWED_RECIPIENTS, readPublicEnv().NEXT_PUBLIC_APP_ENV)) return "unavailable";

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
 * The message budget: true while fewer than WHATSAPP_DAILY_SEND_LIMIT codes were issued in the last 24 hours (all
 * numbers together). Outside production the limit is mandatory, so an unset value blocks sending.
 */
export async function withinDailyBudget(): Promise<boolean> {
  let env;
  try {
    env = readWhatsAppEnv();
  } catch {
    return false;
  }
  const limit = env.WHATSAPP_DAILY_SEND_LIMIT;
  if (limit === undefined) return readPublicEnv().NEXT_PUBLIC_APP_ENV === "production";
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return (await countAllPhoneChallengesSince(since)) < limit;
}
