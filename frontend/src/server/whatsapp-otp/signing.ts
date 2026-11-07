import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Standard-Webhooks-style signing shared by the three WhatsApp OTP server-to-server doors. Each door has its OWN secret (send, admin, notify);
 * this module only signs or verifies with the secret it is handed. Byte-compatible with edge/whatsapp-otp-worker/src/signing.ts.
 */
const TOLERANCE_SECONDS = 300;

/** "whsec_" + base64 (>= 32 bytes), optionally prefixed "v1,". Anything else is not a usable key. */
export function keyBytes(secret: string): Buffer | null {
  const encoded = secret.startsWith("v1,") ? secret.slice(3) : secret;
  if (!encoded.startsWith("whsec_")) return null;
  const bytes = Buffer.from(encoded.slice(6), "base64");
  return bytes.length >= 32 ? bytes : null;
}

/** The `webhook-signature` header value ("v1,<base64>"), or null when the id or the secret is unusable. */
export function signBody(secret: string, id: string, stampSeconds: number, body: string): string | null {
  const key = keyBytes(secret);
  if (!key || !id || id.length > 128 || id.includes(".")) return null;
  return "v1," + createHmac("sha256", key).update(`${id}.${stampSeconds}.${body}`).digest("base64");
}

/** Constant-time check of the raw body against the headers, inside a 5-minute clock window. */
export function verifyBody(secret: string, body: string, headers: Pick<Headers, "get">, nowMs = Date.now()): boolean {
  const id = headers.get("webhook-id");
  const stamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature");
  if (!id || id.length > 128 || id.includes(".") || !stamp || !signatures) return false;
  if (!/^\d{10}$/.test(stamp) || Math.abs(nowMs - Number(stamp) * 1000) > TOLERANCE_SECONDS * 1000) return false;
  const key = keyBytes(secret);
  if (!key) return false;
  const expected = createHmac("sha256", key).update(`${id}.${stamp}.${body}`).digest();
  for (const part of signatures.split(" ")) {
    if (!part.startsWith("v1,")) continue;
    const given = Buffer.from(part.slice(3), "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}
