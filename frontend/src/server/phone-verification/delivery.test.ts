import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WORKER_WIRED,
  createOutboxTransport,
  createWorkerTransport,
  maskPhone,
  parseDeliveryMode,
  selectTransport,
} from "./delivery";
import { latestOutboxCode, latestOutboxEntry } from "./outbox-reader";
import { disabledTransport } from "./transport";

const PHONE = "+201000000042";
const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "otp-outbox-")); dirs.push(d); return d; };
afterEach(() => { vi.restoreAllMocks(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("delivery mode", () => {
  it("is OFF by default, for blanks, typos and unknown values", () => {
    for (const raw of [undefined, "", " ", "off", "OUTBOX", "Worker", "true", "1", "whatsapp", "outbox "]) {
      const mode = parseDeliveryMode(raw, "development");
      // only the exact (trimmed) words 'outbox'/'worker' select anything
      expect(["off", "outbox"]).toContain(mode);
      if (raw !== "outbox ") expect(mode).toBe("off");
    }
    expect(parseDeliveryMode("outbox", "development")).toBe("outbox");
    expect(parseDeliveryMode("worker", "production")).toBe("worker");
  });
  it("refuses the local outbox in production", () => {
    expect(parseDeliveryMode("outbox", "production")).toBe("off");
  });
  it("does not depend on NEXT_PUBLIC_APP_ENV at all", () => {
    const before = process.env.NEXT_PUBLIC_APP_ENV;
    process.env.NEXT_PUBLIC_APP_ENV = "local";
    try { expect(parseDeliveryMode(undefined, undefined)).toBe("off"); } finally {
      if (before === undefined) delete process.env.NEXT_PUBLIC_APP_ENV; else process.env.NEXT_PUBLIC_APP_ENV = before;
    }
  });
  it("selectTransport: off is the refusing transport; worker needs BOTH a URL and a secret (half-configured fails loudly, never silently off)", async () => {
    expect(WORKER_WIRED).toBe(true);
    expect(selectTransport({ mode: "off" })).toBe(disabledTransport);
    await expect(selectTransport({ mode: "off" }).send({ to: PHONE, code: "123456", ttlSeconds: 300 })).rejects.toThrow("disabled");
    const secret = `whsec_${randomBytes(32).toString("base64")}`;
    expect(() => selectTransport({ mode: "worker" })).toThrow("PHONE_OTP_WORKER_URL");
    expect(() => selectTransport({ mode: "worker", workerUrl: "https://w.example.invalid/v1/otp/send" })).toThrow("PHONE_OTP_WORKER_SECRET");
    expect(() => selectTransport({ mode: "worker", workerSecret: secret })).toThrow("PHONE_OTP_WORKER_URL");
    expect(selectTransport({ mode: "worker", workerUrl: "https://w.example.invalid/v1/otp/send", workerSecret: secret })).not.toBe(disabledTransport);
  });
});

describe("worker adapter (the real delivery transport)", () => {
  const secretBytes = randomBytes(32);
  const secret = `whsec_${secretBytes.toString("base64")}`;
  const DELIVERY = "6b1f4b1c-0d3a-4c5e-9a77-2f6d3f0a9b11";
  const cfg = (fetchImpl: typeof fetch) => ({ url: "https://worker.example.invalid/v1/otp/send", secret, fetchImpl, now: () => 1_800_000_000_000 });

  it("signs exactly the way the Worker verifies (id.timestamp.body, HMAC-SHA256, v1,base64)", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    await createWorkerTransport(cfg(fetchImpl)).send({ to: PHONE, code: "123456", ttlSeconds: 300, purpose: "signup_proof", locale: "en", deliveryId: DELIVERY });
    const headers = seen!.init.headers as Record<string, string>;
    const body = String(seen!.init.body);
    expect(headers["webhook-timestamp"]).toBe("1800000000");
    expect(headers["webhook-id"]).toBe(`otp_${DELIVERY}`); // the request id IS the delivery identity, never a fresh random value
    expect(headers["webhook-id"]).not.toContain(".");
    const expected = createHmac("sha256", secretBytes).update(`${headers["webhook-id"]}.${headers["webhook-timestamp"]}.${body}`).digest("base64");
    expect(headers["webhook-signature"]).toBe(`v1,${expected}`);
    expect(JSON.parse(body)).toMatchObject({ to: PHONE, code: "123456", purpose: "signup_proof", locale: "en", ttl_seconds: 300, delivery_id: DELIVERY });
  });
  it("any failure throws a message with no number, code, URL or body", async () => {
    for (const impl of [
      (async () => new Response(`bad ${PHONE} 123456`, { status: 502 })) as unknown as typeof fetch,
      (async () => { throw new Error(`socket ${PHONE} 123456`); }) as unknown as typeof fetch,
    ]) {
      let message = "";
      try { await createWorkerTransport(cfg(impl)).send({ to: PHONE, code: "123456", ttlSeconds: 300, deliveryId: DELIVERY }); } catch (e) { message = (e as Error).message; }
      expect(message).toBe("phone OTP delivery failed");
    }
  });
  it("the same delivery signs the SAME id on every attempt (so the Worker can dedupe), a different delivery a different id", async () => {
    const ids: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => { ids.push((init.headers as Record<string, string>)["webhook-id"]!); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const t = createWorkerTransport(cfg(fetchImpl));
    await t.send({ to: PHONE, code: "123456", ttlSeconds: 300, deliveryId: DELIVERY });
    await t.send({ to: PHONE, code: "123456", ttlSeconds: 300, deliveryId: DELIVERY.toUpperCase() });
    await t.send({ to: PHONE, code: "654321", ttlSeconds: 300, deliveryId: "7c2e5d2d-1e4b-4d6f-8b88-3a7e4a1b0c22" });
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });
  it("refuses to send without a valid delivery identity (an un-keyed request could not be made idempotent) and never calls the network", async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls += 1; return new Response("{}"); }) as unknown as typeof fetch;
    for (const deliveryId of [undefined, "", "not-a-uuid", "otp_6b1f4b1c-0d3a-4c5e-9a77-2f6d3f0a9b11"]) {
      await expect(createWorkerTransport(cfg(fetchImpl)).send({ to: PHONE, code: "123456", ttlSeconds: 300, deliveryId })).rejects.toThrow("phone OTP delivery failed");
    }
    expect(calls).toBe(0);
  });
  it("refuses insecure URLs and weak or malformed secrets at construction", () => {
    const f = (async () => new Response()) as unknown as typeof fetch;
    expect(() => createWorkerTransport({ url: "http://worker.example.invalid", secret, fetchImpl: f })).toThrow("https");
    expect(() => createWorkerTransport({ url: "https://w.example.invalid", secret: "nope", fetchImpl: f })).toThrow("format");
    expect(() => createWorkerTransport({ url: "https://w.example.invalid", secret: `whsec_${randomBytes(8).toString("base64")}`, fetchImpl: f })).toThrow("short");
    expect(() => createWorkerTransport({ url: "http://127.0.0.1:8787/x", secret, fetchImpl: f })).not.toThrow();
  });
});
