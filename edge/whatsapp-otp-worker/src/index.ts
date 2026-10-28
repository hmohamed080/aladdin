/** Preview-only signed Supabase Send SMS Hook transport. No OTP authority. */
export interface Env {
  SUPABASE_SEND_SMS_HOOK_SECRET: string;
  WHATSAPP_ACCESS_TOKEN: { get(): Promise<string> };
  WHATSAPP_PHONE_NUMBER_ID: string;
  WHATSAPP_OTP_TEMPLATE: string;
  WHATSAPP_OTP_LANGUAGE: string;
  WHATSAPP_GRAPH_API_VERSION: string;
  WHATSAPP_DELIVERY_ENABLED: string;
}
const PATH = "/hooks/supabase/send-sms";
const MOBILE = /^\+20(?:10|11|12|15)[0-9]{8}$/;
const CODE = /^[0-9]{6}$/;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
function answer(status: number, obj: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}
function decode64(value: string): Uint8Array | null {
  try { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); } catch { return null; }
}
/** Check raw body against Standard Webhooks signature with a 5-minute clock window. */
export async function verifySignature(body: string, headers: Headers, secret: string, now = Date.now()): Promise<boolean> {
  const id = headers.get("webhook-id");
  const stamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature");
  if (!id || id.length > 128 || id.includes(".") || !stamp || !signatures) return false;
  if (!/^\d{10}$/.test(stamp) || Math.abs(now - Number(stamp) * 1000) > 300_000) return false;
  const encoded = secret.startsWith("v1,") ? secret.slice(3) : secret;
  if (!encoded.startsWith("whsec_")) return false;
  const secretBytes = decode64(encoded.slice(6));
  if (!secretBytes || secretBytes.length < 32) return false;
  const key = await crypto.subtle.importKey("raw", secretBytes as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signed = new TextEncoder().encode(id + "." + stamp + "." + body);
  for (const part of signatures.split(" ")) {
    if (!part.startsWith("v1,")) continue;
    const sig = decode64(part.slice(3));
    if (sig?.length === 32 && await crypto.subtle.verify("HMAC", key, sig as BufferSource, signed)) return true;
  }
  return false;
}
export function parseEvent(body: string): { phone: string; otp: string } | null {
  let event: unknown;
  try { event = JSON.parse(body); } catch { return null; }
  if (!event || typeof event !== "object") return null;
  const v = event as { user?: { phone?: unknown }; sms?: { otp?: unknown } };
  if (typeof v.user?.phone !== "string" || !MOBILE.test(v.user.phone)) return null;
  if (typeof v.sms?.otp !== "string" || !CODE.test(v.sms.otp)) return null;
  return { phone: v.user.phone, otp: v.sms.otp };
}
/** No retries. The Meta ID means accepted, not delivered. */
export async function submitOtp(phone: string, otp: string, env: Env, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!MOBILE.test(phone) || !CODE.test(otp)) return false;
  if (!/^\d{5,30}$/.test(env.WHATSAPP_PHONE_NUMBER_ID)) return false;
  if (!/^[a-z][a-z0-9_]{0,511}$/.test(env.WHATSAPP_OTP_TEMPLATE)) return false;
  if (!/^v\d{1,2}\.\d$/.test(env.WHATSAPP_GRAPH_API_VERSION)) return false;
  if (env.WHATSAPP_OTP_LANGUAGE !== "ar") return false;
  const uri = "https://graph.facebook.com/" + env.WHATSAPP_GRAPH_API_VERSION + "/" + env.WHATSAPP_PHONE_NUMBER_ID + "/messages";
  const payload = {
    messaging_product: "whatsapp", to: phone.slice(1), type: "template",
    template: {
      name: env.WHATSAPP_OTP_TEMPLATE,
      language: { code: "ar" },
      components: [
        { type: "body", parameters: [{ type: "text", text: otp }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: otp }] },
      ],
    },
  };
  try {
    // Resolve the account-level Secret only after signature validation and the delivery gate.
    const token = await env.WHATSAPP_ACCESS_TOKEN.get();
    if (!token) return false;
    const r = await fetcher(uri, {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return false;
    const data = await r.json() as { messages?: Array<{ id?: unknown }> };
    return typeof data?.messages?.[0]?.id === "string";
  } catch { return false; }
}
export async function handleRequest(request: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  if (request.method !== "POST" || new URL(request.url).pathname !== PATH) return answer(404);
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return answer(415);
  if (Number(request.headers.get("content-length") ?? 0) > 16384) return answer(413);
  if (!env.SUPABASE_SEND_SMS_HOOK_SECRET) return answer(503);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 16384) return answer(413);
  if (!await verifySignature(raw, request.headers, env.SUPABASE_SEND_SMS_HOOK_SECRET)) return answer(401);
  const v = parseEvent(raw);
  if (!v) return answer(422);
  // Delivery stays OFF until canonical identity and durable replay protection are validated.
  if (env.WHATSAPP_DELIVERY_ENABLED !== "true") return answer(503, { error: "delivery_disabled" });
  return await submitOtp(v.phone, v.otp, env, fetcher) ? answer(200) : answer(502, { error: "delivery_unavailable" });
}
export default { fetch(request: Request, env: Env): Promise<Response> { return handleRequest(request, env); } };
