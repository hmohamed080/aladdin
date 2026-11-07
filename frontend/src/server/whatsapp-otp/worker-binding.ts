import { getCloudflareContext } from "@opennextjs/cloudflare";
import { readPublicEnv } from "@/lib/env";

/**
 * How the app server reaches the WhatsApp delivery Worker.
 *
 * PRODUCTION (and any environment that is not explicitly local or staging) uses ONLY the Cloudflare Service Binding `OTP_WORKER`: the Worker has
 * no public URL (workers_dev off, no routes), so nothing on the internet can reach /v1/otp/send or /v1/admin/*. The HMAC signatures, replay
 * claims and the database grant are still verified inside the Worker (defence in depth). If the binding is missing in production the answer is
 * "not available" - the code NEVER falls back to a public URL there.
 *
 * Local development and the Acceptance preview may fall back to the configured URL (a loopback rig or a workers.dev address) when no binding
 * is present. The URL's host is not used when the binding is present: only its path matters.
 *
 * Mobile applications never talk to the Worker. They call the Aladdin API (this app / Supabase), which calls the Worker with the binding.
 */
export type OtpWorkerBinding = { fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> };

export type WorkerTransport = { ok: true; via: "binding" | "public"; fetchImpl: typeof fetch | undefined } | { ok: false };

/** Pure policy, tested without Cloudflare. */
export function chooseWorkerTransport(input: { appEnv: string | undefined; binding: OtpWorkerBinding | undefined }): WorkerTransport {
  const { binding } = input;
  if (binding) return { ok: true, via: "binding", fetchImpl: ((url: string | URL | Request, init?: RequestInit) => binding.fetch(url, init)) as typeof fetch };
  // Only an explicit local or staging environment may use a public URL. Unknown or missing = production rules.
  if (input.appEnv === "local" || input.appEnv === "staging") return { ok: true, via: "public", fetchImpl: undefined };
  return { ok: false };
}

function readBinding(): OtpWorkerBinding | undefined {
  try {
    return (getCloudflareContext().env as { OTP_WORKER?: OtpWorkerBinding }).OTP_WORKER;
  } catch {
    return undefined; // not running on Workers (Node, tests, `next dev` without the Cloudflare context)
  }
}

export function resolveWorkerTransport(): WorkerTransport {
  let appEnv: string | undefined;
  try {
    appEnv = readPublicEnv().NEXT_PUBLIC_APP_ENV;
  } catch {
    appEnv = undefined; // unreadable configuration is treated as production
  }
  return chooseWorkerTransport({ appEnv, binding: readBinding() });
}
