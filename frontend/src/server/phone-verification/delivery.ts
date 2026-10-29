import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { disabledTransport, type OtpMessage, type PhoneOtpTransport } from "./transport";

/**
 * Delivery adapters for the phone verification authority (R1). ONE interface (transport.ts), three modes:
 *
 *   off     the default. send() refuses. Used for anything unrecognised, so a typo can never enable delivery.
 *   outbox  a LOCAL fake: writes a small JSON file under a git-ignored directory instead of sending. Refused when
 *           NODE_ENV is "production". Tests read the code from the file; nothing is ever printed.
 *   worker  the future Cloudflare Worker adapter (signed request, the Worker keeps the Meta token). Implemented and unit-tested
 *           here against an injected fetch, but NOT selectable at runtime in R1 (WORKER_WIRED = false): real delivery
 *           needs separate owner approval.
 *
 * Hard rules: no function here writes the destination number or the code to a log or console, and the switch is a server-only
 * variable - it is never derived from NEXT_PUBLIC_APP_ENV (public, build-time, and already selects test keys elsewhere).
 */
export type DeliveryMode = "off" | "outbox" | "worker";

/** Real delivery is intentionally not reachable through configuration in R1. */
export const WORKER_WIRED = false;

export function parseDeliveryMode(raw: string | undefined, nodeEnv: string | undefined): DeliveryMode {
  const v = (raw ?? "").trim();
  if (v === "outbox") return nodeEnv === "production" ? "off" : "outbox";
  if (v === "worker") return "worker";
  return "off";
}

/** +201001234567 -> +20********67 (country code kept, last two digits kept). */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/[^0-9]/g, "");
  if (digits.length < 6) return "+****";
  return `+${digits.slice(0, 2)}${"*".repeat(Math.max(digits.length - 4, 2))}${digits.slice(-2)}`;
}

export function phoneDigest(e164: string): string {
  return createHash("sha256").update(`phone-otp-outbox|${e164}`).digest("hex").slice(0, 32);
}

export type OutboxEntry = { at: string; purpose: string; maskedTo: string; toDigest: string; ttlSeconds: number; code: string };

/** LOCAL FAKE. Writes one file per message (mode 0600). Never prints. */
export function createOutboxTransport(options: { dir: string; nodeEnv?: string; now?: () => number }): PhoneOtpTransport {
  return {
    async send(message: OtpMessage) {
      if ((options.nodeEnv ?? process.env.NODE_ENV) === "production") throw new Error("phone OTP outbox is disabled in production");
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      await mkdir(options.dir, { recursive: true });
      const entry: OutboxEntry = {
        at: new Date((options.now ?? Date.now)()).toISOString(),
        purpose: message.purpose ?? "primary_proof",
        maskedTo: maskPhone(message.to),
        toDigest: phoneDigest(message.to),
        ttlSeconds: message.ttlSeconds,
        code: message.code,
      };
      await writeFile(join(options.dir, `${Date.now()}-${randomBytes(4).toString("hex")}.json`), JSON.stringify(entry), { mode: 0o600 });
    },
  };
}

export type WorkerConfig = {
  url: string;
  /** Standard Webhooks style secret: "whsec_" + base64 (>= 32 bytes). The Worker holds the same value. */
  secret: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

/**
 * FUTURE real adapter. Signs `${id}.${timestamp}.${body}` with HMAC-SHA256 exactly as the Worker's verifySignature (PR #114)
 * expects, posts it, and treats anything but a 2xx as failure. The Worker keeps its own switch (WHATSAPP_DELIVERY_ENABLED) and
 * recipient allow-list, so two independent switches must be on before anything is sent.
 */
export function createWorkerTransport(config: WorkerConfig): PhoneOtpTransport {
  const url = new URL(config.url);
  const loopback = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !loopback) throw new Error("worker URL must be https");
  if (!config.secret.startsWith("whsec_")) throw new Error("worker secret has an invalid format");
  const keyBytes = Buffer.from(config.secret.slice(6), "base64");
  if (keyBytes.length < 32) throw new Error("worker secret is too short");
  const doFetch = config.fetchImpl ?? fetch;
  return {
    async send(message: OtpMessage) {
      const body = JSON.stringify({
        to: message.to,
        code: message.code,
        purpose: message.purpose ?? "primary_proof",
        locale: message.locale ?? "ar",
        ttl_seconds: message.ttlSeconds,
      });
      const id = `msg_${randomUUID()}`;
      const stamp = String(Math.floor((config.now ?? Date.now)() / 1000));
      const signature = createHmac("sha256", keyBytes).update(`${id}.${stamp}.${body}`).digest("base64");
      let ok = false;
      try {
        const res = await doFetch(url.toString(), {
          method: "POST",
          headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": stamp, "webhook-signature": `v1,${signature}` },
          body,
          signal: AbortSignal.timeout(config.timeoutMs ?? 9000),
        });
        ok = res.ok;
      } catch {
        ok = false;
      }
      // Never include the destination, the code, a response body or the URL in the error.
      if (!ok) throw new Error("phone OTP delivery failed");
    },
  };
}

/** The only place a mode becomes a transport. */
export function selectTransport(options: { mode: DeliveryMode; outboxDir?: string; nodeEnv?: string }): PhoneOtpTransport {
  if (options.mode === "outbox") return createOutboxTransport({ dir: options.outboxDir ?? ".local/phone-otp-outbox", nodeEnv: options.nodeEnv });
  // "off", and "worker" while WORKER_WIRED is false.
  return disabledTransport;
}
