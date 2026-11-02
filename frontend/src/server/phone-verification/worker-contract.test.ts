import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createWorkerTransport } from "./delivery";
import { createPhoneSignupService } from "./signup-service";
import { parseKeyring } from "./otp";
// The Worker is a separate package; importing its handler lets this test run the app's REAL signing code against the Worker's REAL verifier.
import { handleRequest, type Env, type ReplayDb } from "../../../../edge/whatsapp-otp-worker/src/index";

const PHONE = "+201012345678";
const secretBytes = randomBytes(32);
const SECRET = `whsec_${secretBytes.toString("base64")}`;

function memoryDb(): ReplayDb {
  const rows = new Map<string, string>();
  return {
    prepare(sql: string) {
      return {
        bind(...v: (string | number)[]) {
          return {
            async run() {
              if (sql.startsWith("INSERT OR IGNORE")) { if (rows.has(String(v[0]))) return { success: true, meta: { changes: 0 } }; rows.set(String(v[0]), "reserved"); return { success: true, meta: { changes: 1 } }; }
              if (sql.startsWith("UPDATE")) { if (rows.get(String(v[1])) !== "reserved") return { success: true, meta: { changes: 0 } }; rows.set(String(v[1]), String(v[0])); return { success: true, meta: { changes: 1 } }; }
              throw new Error("unexpected sql");
            },
            async first<T>() { return (rows.has(String(v[0])) ? { state: rows.get(String(v[0])) } : null) as T | null; },
          };
        },
      };
    },
  };
}

function rig(over: Partial<Env> = {}) {
  const metaCalls: Array<{ to: string; code: string; language: string }> = [];
  const meta = (async (_url: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body));
    metaCalls.push({ to: b.to, code: b.template.components[0].parameters[0].text, language: b.template.language.code });
    return new Response(JSON.stringify({ messages: [{ id: "wamid.local" }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const env: Env = {
    OTP_SIGNING_SECRET: { get: async () => SECRET },
    WHATSAPP_ACCESS_TOKEN: { get: async () => "local-fake-token" },
    WHATSAPP_PHONE_NUMBER_ID: "1415528588305492",
    WHATSAPP_OTP_TEMPLATE: "aladdin_otp",
    WHATSAPP_OTP_LANGUAGES: "ar",
    WHATSAPP_GRAPH_API_VERSION: "v25.0",
    WHATSAPP_DELIVERY_ENABLED: "true",
    OTP_ENVIRONMENT: "acceptance",
    OTP_RECIPIENT_MODE: "allowlist",
    OTP_ALLOWED_RECIPIENTS: PHONE,
    IDEMPOTENCY_DB: memoryDb(),
    ...over,
  };
  // The app's transport posts through this fetch straight into the Worker's handler.
  const toWorker = (async (url: string, init: RequestInit) => handleRequest(new Request(url, init), env, meta)) as unknown as typeof fetch;
  const transport = createWorkerTransport({ url: "https://worker.example.invalid/v1/otp/send", secret: SECRET, fetchImpl: toWorker });
  return { env, metaCalls, transport };
}

describe("application transport <-> delivery Worker contract (real signer, real verifier)", () => {
  it("a delivery signed by the app is accepted by the Worker and reaches Meta exactly once, with the code in the Meta payload", async () => {
    const { transport, metaCalls } = rig();
    const deliveryId = randomUUID();
    await transport.send({ to: PHONE, code: "246810", ttlSeconds: 300, purpose: "signup_proof", locale: "ar", deliveryId });
    expect(metaCalls).toEqual([{ to: "201012345678", code: "246810", language: "ar" }]);
  });
  it("the same delivery attempted twice reaches Meta once (idempotency is the challenge identity); a new challenge is a new delivery", async () => {
    const { transport, metaCalls } = rig();
    const deliveryId = randomUUID();
    await transport.send({ to: PHONE, code: "246810", ttlSeconds: 300, deliveryId });
    await transport.send({ to: PHONE, code: "246810", ttlSeconds: 300, deliveryId });
    expect(metaCalls.length).toBe(1);
    await transport.send({ to: PHONE, code: "135790", ttlSeconds: 300, deliveryId: randomUUID() });
    expect(metaCalls.length).toBe(2);
  });
  it("every Worker refusal surfaces as the transport's generic failure (no number, code or status leaks) and sends nothing", async () => {
    for (const over of [{ WHATSAPP_DELIVERY_ENABLED: "false" }, { OTP_ALLOWED_RECIPIENTS: "+201099999999" }, { IDEMPOTENCY_DB: undefined }] as Array<Partial<Env>>) {
      const { transport, metaCalls } = rig(over);
      await expect(transport.send({ to: PHONE, code: "246810", ttlSeconds: 300, deliveryId: randomUUID() })).rejects.toThrow("phone OTP delivery failed");
      expect(metaCalls.length).toBe(0);
    }
  });
  it("a secret the Worker does not hold is refused", async () => {
    const { env, metaCalls } = rig();
    const other = createWorkerTransport({ url: "https://worker.example.invalid/v1/otp/send", secret: `whsec_${randomBytes(32).toString("base64")}`, fetchImpl: (async (u: string, i: RequestInit) => handleRequest(new Request(u, i), env, (async () => new Response("{}")) as unknown as typeof fetch)) as unknown as typeof fetch });
    await expect(other.send({ to: PHONE, code: "246810", ttlSeconds: 300, deliveryId: randomUUID() })).rejects.toThrow("phone OTP delivery failed");
    expect(metaCalls.length).toBe(0);
  });
  it("the signup service hands the transport the CHALLENGE id as the delivery identity", async () => {
    const { transport, metaCalls } = rig();
    const tasks: Promise<void>[] = [];
    let challenge = "";
    const db = { rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "phone_signup_start") { challenge = String(args.p_challenge_id); return { data: { status: "challenge_created", challenge_id: challenge, expires_at: "x", resend_available_at: "y", deliver: true, phone_e164: PHONE }, error: null }; }
      return { data: null, error: null };
    } };
    const service = createPhoneSignupService({ db: db as never, transport, keyring: parseKeyring(JSON.stringify({ current: "k1", keys: { k1: randomBytes(32).toString("base64") } })), enabled: true, defer: (t) => { tasks.push(t); } });
    const out = await service.start(randomUUID(), PHONE, "203.0.113.9", "ar");
    expect(out.status).toBe("sent");
    await Promise.all(tasks);
    expect(metaCalls.length).toBe(1);
    expect(challenge).toMatch(/^[0-9a-f-]{36}$/);
  });
});
