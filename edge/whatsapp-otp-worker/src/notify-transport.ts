/**
 * ONE outbound transport for every signed call this Worker makes to the app's alert endpoint: the connection probe (admin.ts) and the real
 * alert delivery (maintenance.ts) both go through `postSignedNotify`, so they can never diverge.
 *
 * The call travels over a private Cloudflare SERVICE BINDING (`APP_NOTIFY` -> the app's own Worker), never over the public internet:
 *  - a Worker cannot reach a same-account `workers.dev` Worker with global fetch() (Cloudflare error 1042, proven on Acceptance 2026-11-04);
 *  - the app's public hostname is behind Cloudflare Access, which a binding does not traverse, so NO Access credential exists or is sent here;
 *  - the endpoint stays closed to the public: the app still verifies the HMAC signature, the timestamp window, replay and the source
 *    environment, and authorizes the write through Supabase. The binding adds a private route, not a bypass.
 *
 * FAIL CLOSED: with no usable binding NOTHING is sent and the URL is NEVER fetched publicly. The only exception is an explicit local rig
 * (`OTP_ENVIRONMENT=local`), which may pass a loopback fetcher. The URL variable is only the path/host the app sees; it is a pinned https
 * variable of this Worker and never request input.
 */
import { signPayload } from "./signing.ts";

/** The shape of a Cloudflare Service Binding as used here. Invoked as a method so the binding keeps its receiver. */
export type ServiceBinding = { fetch(input: string, init?: RequestInit): Promise<Response> };
export type NotifyTransportEnv = { APP_NOTIFY?: ServiceBinding; OTP_ENVIRONMENT?: string };

export type SignedNotifyResult = { sent: true; response: Response } | { sent: false; reason: "transport_unavailable" | "unusable_secret" };

/** True when a private transport exists (the binding), or this is an explicit local rig. */
export function notifyTransportAvailable(env: NotifyTransportEnv): boolean {
  return typeof env.APP_NOTIFY?.fetch === "function" || env.OTP_ENVIRONMENT === "local";
}

/**
 * POSTs `body` signed with the notify secret. Redirects are NEVER followed (a redirect is never a delivered alert). A network failure or
 * timeout throws, exactly as `fetch` does; callers decide how to report it. `localFetcher` is honoured ONLY for OTP_ENVIRONMENT=local.
 */
export async function postSignedNotify(
  env: NotifyTransportEnv,
  url: string,
  signingSecret: string,
  webhookId: string,
  nowSeconds: number,
  body: string,
  localFetcher?: typeof fetch,
): Promise<SignedNotifyResult> {
  const binding = env.APP_NOTIFY;
  const useBinding = typeof binding?.fetch === "function";
  if (!useBinding && !(env.OTP_ENVIRONMENT === "local" && localFetcher)) return { sent: false, reason: "transport_unavailable" };
  const signature = await signPayload(signingSecret, webhookId, nowSeconds, body);
  if (!signature) return { sent: false, reason: "unusable_secret" };
  const init: RequestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": webhookId,
      "webhook-timestamp": String(nowSeconds),
      "webhook-signature": signature,
    },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  };
  const response = useBinding ? await binding!.fetch(url, init) : await localFetcher!(url, init);
  return { sent: true, response };
}

/** True when a response is an Access login redirect (the request never reached the app). Kept for diagnostics only. */
export function isAccessRedirect(res: Response): boolean {
  if (res.status < 300 || res.status > 399) return false;
  try {
    const host = new URL(res.headers.get("location") ?? "").hostname.toLowerCase();
    return host === "cloudflareaccess.com" || host.endsWith(".cloudflareaccess.com");
  } catch {
    return false;
  }
}
