/**
 * ONE outbound transport for every signed call this Worker makes to the app's alert endpoint: the connection probe (admin.ts) and the real
 * alert delivery (maintenance.ts) both go through `postSignedNotify`, so they can never diverge.
 *
 * Cloudflare Access (service authentication) is an ADDITIONAL layer in front of the app, not a replacement for anything the app checks: the
 * app still verifies the HMAC signature, the timestamp window, replay and the source environment. Access only decides whether the request
 * may reach the app at all.
 *
 * The Access service token (a Client ID and a Client Secret) lives in two Secrets Store bindings of THIS Worker only. Rules:
 *  - neither binding present            -> no Access headers (an app that is not behind Access, e.g. Production);
 *  - both present and well-formed       -> both CF-Access-Client-* headers are sent;
 *  - exactly one present, unreadable, empty or malformed -> `credentials_invalid`: NOTHING is sent (fail closed; the caller reports it as
 *    not configured / skips delivery). A half-configured token must never fall back to an unauthenticated call that would be misclassified.
 * The values are never logged, never returned and never read from request input. The destination URL is a pinned https variable.
 */
import { signPayload } from "./signing.ts";

type SecretBinding = { get(): Promise<string> };
export type NotifyTransportEnv = {
  OTP_NOTIFY_ACCESS_CLIENT_ID?: SecretBinding;
  OTP_NOTIFY_ACCESS_CLIENT_SECRET?: SecretBinding;
};

/** Printable ASCII without whitespace: no CR/LF or space can ever reach a header. Access Client IDs look like "<hex>.access". */
const TOKEN_PART = /^[\x21-\x7e]{16,256}$/;

export type AccessHeaders = { ok: true; headers: Record<string, string> } | { ok: false; reason: "credentials_invalid" };

export async function accessHeaders(env: NotifyTransportEnv): Promise<AccessHeaders> {
  const idBinding = env.OTP_NOTIFY_ACCESS_CLIENT_ID;
  const secretBinding = env.OTP_NOTIFY_ACCESS_CLIENT_SECRET;
  if (!idBinding && !secretBinding) return { ok: true, headers: {} };
  if (!idBinding?.get || !secretBinding?.get) return { ok: false, reason: "credentials_invalid" };
  try {
    const [id, secret] = await Promise.all([idBinding.get(), secretBinding.get()]);
    if (typeof id !== "string" || typeof secret !== "string" || !TOKEN_PART.test(id) || !TOKEN_PART.test(secret)) return { ok: false, reason: "credentials_invalid" };
    return { ok: true, headers: { "cf-access-client-id": id, "cf-access-client-secret": secret } };
  } catch {
    return { ok: false, reason: "credentials_invalid" };
  }
}

export type SignedNotifyResult = { sent: true; response: Response } | { sent: false; reason: "credentials_invalid" | "unusable_secret" };

/**
 * POSTs `body` signed with the notify secret. Redirects are NEVER followed: an Access login redirect would otherwise come back as a 200 HTML
 * page and be mistaken for a delivered alert. A network failure or timeout throws, exactly as `fetch` does; callers decide how to report it.
 */
export async function postSignedNotify(
  env: NotifyTransportEnv,
  url: string,
  signingSecret: string,
  webhookId: string,
  nowSeconds: number,
  body: string,
  fetcher: typeof fetch,
): Promise<SignedNotifyResult> {
  const access = await accessHeaders(env);
  if (!access.ok) return { sent: false, reason: "credentials_invalid" };
  const signature = await signPayload(signingSecret, webhookId, nowSeconds, body);
  if (!signature) return { sent: false, reason: "unusable_secret" };
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      ...access.headers,
      "content-type": "application/json",
      "webhook-id": webhookId,
      "webhook-timestamp": String(nowSeconds),
      "webhook-signature": signature,
    },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  return { sent: true, response };
}

/** True when a response is an Access login redirect (the request never reached the app). */
export function isAccessRedirect(res: Response): boolean {
  if (res.status < 300 || res.status > 399) return false;
  try {
    const host = new URL(res.headers.get("location") ?? "").hostname.toLowerCase();
    return host === "cloudflareaccess.com" || host.endsWith(".cloudflareaccess.com");
  } catch {
    return false;
  }
}
