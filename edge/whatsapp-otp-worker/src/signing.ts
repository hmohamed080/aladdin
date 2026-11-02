/**
 * Standard-Webhooks-style HMAC signing shared by the send route, the admin routes and the outbound notification call.
 * Each purpose uses its OWN secret (send, admin, notify); this module only knows how to sign and verify with a secret it is handed.
 */

export function decode64(value: string): Uint8Array | null {
  try { return Uint8Array.from(atob(value), (c) => c.charCodeAt(0)); } catch { return null; }
}

/** "whsec_" + base64 (>= 32 bytes), optionally prefixed "v1,". Anything else is not a usable key. */
function keyBytes(secret: string): Uint8Array | null {
  const encoded = secret.startsWith("v1,") ? secret.slice(3) : secret;
  if (!encoded.startsWith("whsec_")) return null;
  const bytes = decode64(encoded.slice(6));
  return bytes && bytes.length >= 32 ? bytes : null;
}

/** Check the raw body against a Standard Webhooks style signature with a 5-minute clock window. */
export async function verifySignature(body: string, headers: Headers, secret: string, now = Date.now()): Promise<boolean> {
  const id = headers.get("webhook-id");
  const stamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature");
  if (!id || id.length > 128 || id.includes(".") || !stamp || !signatures) return false;
  if (!/^\d{10}$/.test(stamp) || Math.abs(now - Number(stamp) * 1000) > 300_000) return false;
  const secretBytes = keyBytes(secret);
  if (!secretBytes) return false;
  const key = await crypto.subtle.importKey("raw", secretBytes as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signed = new TextEncoder().encode(id + "." + stamp + "." + body);
  for (const part of signatures.split(" ")) {
    if (!part.startsWith("v1,")) continue;
    const sig = decode64(part.slice(3));
    if (sig?.length === 32 && (await crypto.subtle.verify("HMAC", key, sig as BufferSource, signed))) return true;
  }
  return false;
}

/** The signature header value ("v1,<base64>") for an outbound request, or null when the secret is unusable. */
export async function signPayload(secret: string, id: string, stampSeconds: number, body: string): Promise<string | null> {
  const bytes = keyBytes(secret);
  if (!bytes || !id || id.includes(".") || id.length > 128) return null;
  const key = await crypto.subtle.importKey("raw", bytes as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${stampSeconds}.${body}`)));
  return "v1," + btoa(String.fromCharCode(...mac));
}

/** Lower-case hex SHA-256 (replay claims keep only a hash of an opaque request id). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
