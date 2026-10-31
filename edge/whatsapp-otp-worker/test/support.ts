import type { Env, ReplayDb } from "../src/index.ts";

export const SECRET_BYTES = new Uint8Array(32).fill(90);
export const SECRET = "whsec_" + btoa(String.fromCharCode(...SECRET_BYTES));
export const PHONE = "+201012345678";
export const DELIVERY = "6b1f4b1c-0d3a-4c5e-9a77-2f6d3f0a9b11";
export const FAKE_TOKEN = "local-fake-meta-token-not-a-credential";

export type SendBody = { to: string; code: string; purpose: string; locale: string; ttl_seconds: number; delivery_id: string };
export const goodBody = (over: Partial<SendBody> = {}): SendBody => ({ to: PHONE, code: "123456", purpose: "signup_proof", locale: "ar", ttl_seconds: 300, delivery_id: DELIVERY, ...over });

export async function sign(id: string, stamp: string, body: string, secretBytes: Uint8Array = SECRET_BYTES): Promise<string> {
  const key = await crypto.subtle.importKey("raw", secretBytes as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${stamp}.${body}`));
  return "v1," + btoa(String.fromCharCode(...new Uint8Array(mac)));
}

/** A request signed exactly the way the application's createWorkerTransport signs it. */
export async function signedSend(
  body: SendBody | string = goodBody(),
  opts: { id?: string; offsetSeconds?: number; secretBytes?: Uint8Array; path?: string; contentType?: string; method?: string } = {},
): Promise<Request> {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const deliveryId = typeof body === "string" ? DELIVERY : body.delivery_id;
  const id = opts.id ?? `otp_${deliveryId}`;
  const stamp = String(Math.floor(Date.now() / 1000) + (opts.offsetSeconds ?? 0));
  return new Request("https://worker.test" + (opts.path ?? "/v1/otp/send"), {
    method: opts.method ?? "POST",
    headers: { "content-type": opts.contentType ?? "application/json", "webhook-id": id, "webhook-timestamp": stamp, "webhook-signature": await sign(id, stamp, raw, opts.secretBytes) },
    body: raw,
  });
}

export function memoryReplayDb(): ReplayDb & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return {
    rows,
    prepare(sql: string) {
      return {
        bind(...values: (string | number)[]) {
          return {
            async run() {
              if (sql.startsWith("INSERT OR IGNORE")) {
                const id = String(values[0]);
                if (rows.has(id)) return { success: true, meta: { changes: 0 } };
                rows.set(id, "reserved");
                return { success: true, meta: { changes: 1 } };
              }
              if (sql.startsWith("UPDATE")) {
                const [next, idValue] = values;
                if (rows.get(String(idValue)) !== "reserved") return { success: true, meta: { changes: 0 } };
                rows.set(String(idValue), String(next));
                return { success: true, meta: { changes: 1 } };
              }
              throw new Error("Unexpected SQL");
            },
            async first<T>() {
              if (sql.startsWith("SELECT 1")) return { ok: 1 } as T;
              const id = String(values[0]);
              return (rows.has(id) ? { state: rows.get(id) } : null) as T | null;
            },
          };
        },
      };
    },
  };
}

export type MetaCall = { url: string; headers: Record<string, string>; body: { messaging_product: string; to: string; type: string; template: { name: string; language: { code: string }; components: unknown[] } } };
export function mockMeta(success = true) {
  const calls: MetaCall[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return success ? new Response(JSON.stringify({ messages: [{ id: "wamid.local-only" }] }), { status: 200 }) : new Response("{}", { status: 502 });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

export function baseEnv(over: Partial<Env> & { tokenReads?: { n: number } } = {}): Env {
  const tokenReads = over.tokenReads ?? { n: 0 };
  const { tokenReads: _ignored, ...rest } = over;
  return {
    OTP_SIGNING_SECRET: { get: async () => SECRET },
    WHATSAPP_ACCESS_TOKEN: { get: async () => { tokenReads.n += 1; return FAKE_TOKEN; } },
    WHATSAPP_PHONE_NUMBER_ID: "1415528588305492",
    WHATSAPP_OTP_TEMPLATE: "aladdin_otp",
    WHATSAPP_OTP_LANGUAGES: "ar",
    WHATSAPP_GRAPH_API_VERSION: "v25.0",
    WHATSAPP_DELIVERY_ENABLED: "true",
    OTP_ENVIRONMENT: "acceptance",
    OTP_RECIPIENT_MODE: "allowlist",
    OTP_ALLOWED_RECIPIENTS: PHONE,
    IDEMPOTENCY_DB: memoryReplayDb(),
    ...rest,
  };
}
