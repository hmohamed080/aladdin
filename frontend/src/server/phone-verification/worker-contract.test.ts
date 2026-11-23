import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createWorkerTransport } from "./delivery";
import { createPhoneSignupService } from "./signup-service";
import { parseKeyring } from "./otp";
// The Worker is a separate package; importing its handler lets this test run the app's REAL signing code against the Worker's REAL verifier.
import { handleRequest, type Env, type ReplayDb } from "../../../../edge/whatsapp-otp-worker/src/index";
import { attestationCanonical as workerCanonical } from "../../../../edge/whatsapp-otp-worker/src/attest";
import { signBody } from "../whatsapp-otp/signing";

const PHONE = "+201012345678";
const secretBytes = randomBytes(32);
const SECRET = `whsec_${secretBytes.toString("base64")}`;
const NOTIFY_SECRET = `whsec_${randomBytes(32).toString("base64")}`;

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
            async first<T>() {
              // The Worker reads its settings row from D1 before every delivery: a fixture row, never production configuration.
              if (sql.includes("FROM otp_delivery_switch")) return { enabled: 1, version: 1, updated_at: 0, updated_by: "00000000-0000-4000-8000-000000000001" } as T; // the Super Admin switch is ON
              if (sql.includes("FROM otp_delivery_attestation")) {
                // The Aladdin database's attestation of version 1 ON, signed with the app-side signer (the same bytes the real route produces).
                const issuedAt = Math.floor(Date.now() / 1000), nonce = "ab".repeat(16);
                const mac = signBody(NOTIFY_SECRET, "attest", issuedAt, workerCanonical({ env: "acceptance", enabled: true, version: 1, issuedAt, nonce }));
                return { enabled: 1, version: 1, issued_at: issuedAt, nonce, mac } as T;
              }
              if (sql.includes("FROM otp_settings WHERE id = 1")) return { daily_limit: 100, hard_ceiling: 5000, warn_percent: 70, critical_percent: 90, version: 1, updated_at: 0, updated_by: "00000000-0000-4000-8000-000000000001" } as T;
              return (rows.has(String(v[0])) ? { state: rows.get(String(v[0])) } : null) as T | null;
            },
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
    OTP_NOTIFY_SIGNING_SECRET: { get: async () => NOTIFY_SECRET },
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

describe("periodic attestation: the Worker's real client against the app's real endpoint", () => {
  it("both directions verify: the app's signed answer is stored by the Worker, and a mismatch is reported to reconcile and attested as authorized", async () => {
    const { handleAttest } = await import("../whatsapp-otp/attest");
    const { runAttestation } = await import("../../../../edge/whatsapp-otp-worker/src/attest");
    const stored: unknown[][] = [];
    const sw = { enabled: 1, version: 9, updated_at: 1_799_999_000, updated_by: "00000000-0000-4000-8000-000000000001" };
    const db = {
      prepare(sql: string) {
        return {
          bind(...v: unknown[]) {
            return {
              async first() { return sql.includes("FROM otp_delivery_switch") ? (sql.includes("NOT EXISTS") || sql.includes("IS NOT") ? null : sw) : null; },
              async all() { return { results: [] }; },
              async run() { if (sql.includes("otp_delivery_attestation")) stored.push(v); return { success: true, meta: { changes: 1 } }; },
            };
          },
        };
      },
    };
    const reconcileCalls: unknown[][] = [];
    const binding = {
      fetch: (url: string, init?: RequestInit) =>
        handleAttest(new Request(url, init), {
          secret: NOTIFY_SECRET,
          expectedSourceEnv: "acceptance",
          reconcile: async (rows, drift) => { reconcileCalls.push([rows, drift]); return true; },
          authorized: async () => ({ enabled: false, version: 2 }), // the database authorized OFF at version 2; D1 claims ON at version 9
        }),
    };
    const env = { OTP_NOTIFY_URL: "https://app.example/api/internal/whatsapp-otp/notify", OTP_NOTIFY_SIGNING_SECRET: { get: async () => NOTIFY_SECRET }, OTP_ENVIRONMENT: "acceptance", APP_NOTIFY: binding };
    const out = await runAttestation(env as never, db as never, fetch, Math.floor(Date.now() / 1000));
    expect(out).toEqual({ attested: true });
    // the Worker stored what the DATABASE authorized (OFF, version 2), not what D1 claimed (ON, version 9)
    expect(stored).toHaveLength(1);
    expect(stored[0]![0]).toBe(0);
    expect(stored[0]![1]).toBe(2);
    // and the app raised the unmatched alert for the forged state
    expect(reconcileCalls.at(-1)).toEqual([[], { version: 9, at: 1_799_999_000 }]);
  });

  it("a wrong secret on either side stores nothing", async () => {
    const { handleAttest } = await import("../whatsapp-otp/attest");
    const { runAttestation } = await import("../../../../edge/whatsapp-otp-worker/src/attest");
    const stored: unknown[] = [];
    const db = { prepare: (sql: string) => ({ bind: (...v: unknown[]) => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => { if (sql.includes("otp_delivery_attestation")) stored.push(v); return { success: true, meta: { changes: 1 } }; } }) }) };
    const other = `whsec_${randomBytes(32).toString("base64")}`;
    const binding = { fetch: (url: string, init?: RequestInit) => handleAttest(new Request(url, init), { secret: other, expectedSourceEnv: "acceptance", reconcile: async () => true, authorized: async () => ({ enabled: true, version: 1 }) }) };
    const env = { OTP_NOTIFY_URL: "https://app.example/api/internal/whatsapp-otp/notify", OTP_NOTIFY_SIGNING_SECRET: { get: async () => NOTIFY_SECRET }, OTP_ENVIRONMENT: "acceptance", APP_NOTIFY: binding };
    expect((await runAttestation(env as never, db as never, fetch, Math.floor(Date.now() / 1000))).attested).toBe(false);
    expect(stored).toHaveLength(0);
  });
});
