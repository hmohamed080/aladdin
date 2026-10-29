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
  it("selectTransport: off and (R1) worker both resolve to the refusing transport; real delivery is not wired", async () => {
    expect(WORKER_WIRED).toBe(false);
    expect(selectTransport({ mode: "off" })).toBe(disabledTransport);
    expect(selectTransport({ mode: "worker" })).toBe(disabledTransport);
    await expect(selectTransport({ mode: "off" }).send({ to: PHONE, code: "123456", ttlSeconds: 300 })).rejects.toThrow("disabled");
  });
});

describe("masking", () => {
  it("keeps the country code and last two digits only", () => {
    expect(maskPhone(PHONE)).toBe("+20********42");
    expect(maskPhone("+1")).toBe("+****");
  });
});

describe("local outbox (fake)", () => {
  it("writes a file, never prints the code or the number, and the reader can find it by number", async () => {
    const dir = tmp();
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const transport = createOutboxTransport({ dir, nodeEnv: "development" });
    await transport.send({ to: PHONE, code: "654321", ttlSeconds: 300, purpose: "signup_proof" });
    for (const s of spies) expect(s).not.toHaveBeenCalled();

    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    const raw = readFileSync(join(dir, files[0]!), "utf8");
    expect(raw).not.toContain(PHONE);                // the number is stored masked + a digest, not in clear
    expect(JSON.parse(raw).maskedTo).toBe("+20********42");
    expect(latestOutboxCode(dir, PHONE, "signup_proof")).toBe("654321");
    expect(latestOutboxCode(dir, PHONE, "primary_proof")).toBeNull();
    expect(latestOutboxCode(dir, "+201000000099")).toBeNull();
    expect(latestOutboxEntry(dir, PHONE)?.ttlSeconds).toBe(300);
  });
  it("refuses to run in production even if constructed", async () => {
    await expect(createOutboxTransport({ dir: tmp(), nodeEnv: "production" }).send({ to: PHONE, code: "111111", ttlSeconds: 300 })).rejects.toThrow("production");
  });
});

describe("worker adapter (future real delivery; not wired)", () => {
  const secretBytes = randomBytes(32);
  const secret = `whsec_${secretBytes.toString("base64")}`;
  const cfg = (fetchImpl: typeof fetch) => ({ url: "https://worker.example.invalid/v1/otp", secret, fetchImpl, now: () => 1_800_000_000_000 });

  it("signs exactly the way the Worker verifies (id.timestamp.body, HMAC-SHA256, v1,base64)", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    await createWorkerTransport(cfg(fetchImpl)).send({ to: PHONE, code: "123456", ttlSeconds: 300, purpose: "signup_proof", locale: "en" });
    const headers = seen!.init.headers as Record<string, string>;
    const body = String(seen!.init.body);
    expect(headers["webhook-timestamp"]).toBe("1800000000");
    expect(headers["webhook-id"]).toMatch(/^msg_[0-9a-f-]{36}$/);
    expect(headers["webhook-id"]).not.toContain(".");
    const expected = createHmac("sha256", secretBytes).update(`${headers["webhook-id"]}.${headers["webhook-timestamp"]}.${body}`).digest("base64");
    expect(headers["webhook-signature"]).toBe(`v1,${expected}`);
    expect(JSON.parse(body)).toMatchObject({ to: PHONE, code: "123456", purpose: "signup_proof", locale: "en", ttl_seconds: 300 });
  });
  it("any failure throws a message with no number, code, URL or body", async () => {
    for (const impl of [
      (async () => new Response(`bad ${PHONE} 123456`, { status: 502 })) as unknown as typeof fetch,
      (async () => { throw new Error(`socket ${PHONE} 123456`); }) as unknown as typeof fetch,
    ]) {
      let message = "";
      try { await createWorkerTransport(cfg(impl)).send({ to: PHONE, code: "123456", ttlSeconds: 300 }); } catch (e) { message = (e as Error).message; }
      expect(message).toBe("phone OTP delivery failed");
    }
  });
  it("refuses insecure URLs and weak or malformed secrets at construction", () => {
    const f = (async () => new Response()) as unknown as typeof fetch;
    expect(() => createWorkerTransport({ url: "http://worker.example.invalid", secret, fetchImpl: f })).toThrow("https");
    expect(() => createWorkerTransport({ url: "https://w.example.invalid", secret: "nope", fetchImpl: f })).toThrow("format");
    expect(() => createWorkerTransport({ url: "https://w.example.invalid", secret: `whsec_${randomBytes(8).toString("base64")}`, fetchImpl: f })).toThrow("short");
    expect(() => createWorkerTransport({ url: "http://127.0.0.1:8787/x", secret, fetchImpl: f })).not.toThrow();
  });
});
