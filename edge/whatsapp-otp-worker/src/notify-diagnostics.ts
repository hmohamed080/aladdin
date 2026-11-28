/**
 * Acceptance-only, structured diagnostic for the alert connection probe. It answers ONE question: what did the network path return, and
 * WHO produced it (Cloudflare routing, Cloudflare Access, or the app)?
 *
 * Emitted fields are a closed set of non-sensitive facts: the HTTP status, a coarse `origin` classification, Cloudflare's four-digit error
 * code (digits only, extracted from a bounded read of a plain-text error page), the CF-Ray id, and the redirect target HOST (never the URL,
 * which carries Access tokens in its query string). Never emitted: any header value other than those, request or response bodies, the
 * Access client id/secret, signatures, cookies, phone numbers.
 */
export type NotifyOrigin =
  | "cloudflare_routing" // Cloudflare's own error page (e.g. 1042: a Worker fetching a same-zone Worker through its public hostname)
  | "access_login_redirect" // redirected to the Cloudflare Access login: the service token was not accepted for this path
  | "edge_or_access_denial" // 401/403 with an HTML or non-empty body: produced by Cloudflare Access, not by the app
  | "app" // the app's own answer: empty body, `cache-control: no-store`
  | "other";

export type NotifyDiagnostic = {
  event: "notify_probe_diag";
  status: number;
  origin: NotifyOrigin;
  cf_error_code?: string;
  cf_ray?: string;
  location_host?: string;
};

const ERROR_CODE = /error code:\s*(\d{4})/i;
const MAX_BODY_BYTES = 512;
const RAY = /^[0-9a-f]{8,32}(-[A-Z]{3})?$/i;

async function boundedText(res: Response): Promise<string> {
  try {
    const reader = res.body?.getReader();
    if (!reader) return "";
    let out = "";
    let total = 0;
    const dec = new TextDecoder();
    while (total < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      total += value.byteLength;
      out += dec.decode(value, { stream: true });
    }
    await reader.cancel().catch(() => undefined);
    return out.slice(0, MAX_BODY_BYTES);
  } catch {
    return "";
  }
}

/** Consumes (a bounded part of) the response body. Call it once, after the status has been decided. */
export async function describeNotifyAnswer(res: Response, accessRedirect: boolean): Promise<NotifyDiagnostic> {
  const status = res.status;
  const text = accessRedirect ? "" : await boundedText(res);
  const code = ERROR_CODE.exec(text)?.[1];
  const ray = res.headers.get("cf-ray") ?? "";
  let locationHost: string | undefined;
  if (status >= 300 && status <= 399) {
    try { locationHost = new URL(res.headers.get("location") ?? "").hostname.toLowerCase(); } catch { locationHost = undefined; }
  }
  let origin: NotifyOrigin = "other";
  if (code) origin = "cloudflare_routing";
  else if (accessRedirect) origin = "access_login_redirect";
  else if ((status === 401 || status === 403) && text.length > 0) origin = "edge_or_access_denial";
  else if (text.length === 0 && res.headers.get("cache-control") === "no-store") origin = "app";
  return {
    event: "notify_probe_diag",
    status,
    origin,
    ...(code ? { cf_error_code: code } : {}),
    ...(RAY.test(ray) ? { cf_ray: ray } : {}),
    ...(locationHost ? { location_host: locationHost } : {}),
  };
}
