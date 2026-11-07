import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { Miniflare } from "miniflare";
import type { Db } from "../src/db.ts";
import type { Env, ReplayDb } from "../src/index.ts";
import { handleRequest } from "../src/index.ts";
import { baseEnv, sign } from "./support.ts";

export const ADMIN_BYTES = new Uint8Array(32).fill(77);
export const ADMIN_SECRET = "whsec_" + btoa(String.fromCharCode(...ADMIN_BYTES));
export const NOTIFY_BYTES = new Uint8Array(32).fill(55);
export const NOTIFY_SECRET = "whsec_" + btoa(String.fromCharCode(...NOTIFY_BYTES));
export const GRANT_BYTES = new Uint8Array(32).fill(33);
export const GRANT_SECRET = "whsec_" + btoa(String.fromCharCode(...GRANT_BYTES));
export const ACTOR = "11111111-2222-4333-8444-555555555555";
export const OTHER_ACTOR = "99999999-2222-4333-8444-555555555555";
export const NOTIFY_URL = "https://app.test/api/internal/whatsapp-otp/notify";

/** A fresh REAL SQL D1 (Miniflare) with every migration applied. */
export async function withD1<T>(fn: (d1: Awaited<ReturnType<Miniflare["getD1Database"]>>, db: Db) => Promise<T>): Promise<T> {
  const mf = new Miniflare({ modules: true, script: 'export default { async fetch() { return new Response("local"); } };', d1Databases: { IDEMPOTENCY_DB: "otp-test-d1" } });
  try {
    const d1 = await mf.getD1Database("IDEMPOTENCY_DB");
    const dir = new URL("../migrations/", import.meta.url);
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      const ddl = readFileSync(new URL(file, dir), "utf8").split(/\r?\n/).filter((l) => !l.trim().startsWith("--")).join("\n");
      for (const stmt of ddl.split(";").map((x) => x.trim()).filter(Boolean)) assert.equal((await d1.prepare(stmt).run()).success, true, file);
    }
    return await fn(d1, d1 as unknown as Db);
  } finally {
    await mf.dispose();
  }
}

export function envFor(d1: unknown, over: Partial<Env> = {}): Env {
  return baseEnv({
    IDEMPOTENCY_DB: d1 as ReplayDb,
    OTP_ADMIN_SIGNING_SECRET: { get: async () => ADMIN_SECRET },
    OTP_ADMIN_GRANT_SECRET: { get: async () => GRANT_SECRET },
    OTP_NOTIFY_SIGNING_SECRET: { get: async () => NOTIFY_SECRET },
    OTP_NOTIFY_URL: NOTIFY_URL,
    ...over,
  });
}

export type SettingsBody = Record<string, unknown>;
/** What the Aladdin database signs in admin_whatsapp_otp_settings_begin (same canonical string), computed synchronously for tests. */
export function grantFor(b: SettingsBody, opts: { bytes?: Uint8Array; expires?: number } = {}): { grant: string; grant_expires: number } {
  const expires = opts.expires ?? Math.floor(Date.now() / 1000) + 300;
  const canonical = ["v1", b.request_id, b.actor_id, b.expected_version, b.daily_limit, b.hard_ceiling, b.warn_percent, b.critical_percent, b.ceiling_authorized ? 1 : 0, expires, createHash("sha256").update(String(b.reason)).digest("hex")].join("|");
  return { grant: createHmac("sha256", Buffer.from(opts.bytes ?? GRANT_BYTES)).update(canonical).digest("base64"), grant_expires: expires };
}

/** A valid body INCLUDING the database grant over exactly these fields. Pass `grant`/`grant_expires` in `over` to forge or break it. */
export const settingsBody = (over: SettingsBody = {}): SettingsBody => {
  const base: SettingsBody = {
    request_id: crypto.randomUUID(), actor_id: ACTOR, expected_version: 0, daily_limit: 150, hard_ceiling: 5000, warn_percent: 70, critical_percent: 90,
    reason: "Initial limits approved by the owner for launch", ceiling_confirmation: "5000", ceiling_authorized: true, ...over,
  };
  return { ...grantFor(base), ...base };
};

/** A request signed the way the app server signs it (separate admin secret, id = adm_<request_id>). */
export async function adminCall(
  env: Env, path: string, body: SettingsBody | string,
  opts: { id?: string; offsetSeconds?: number; secretBytes?: Uint8Array; contentType?: string; skipSignature?: boolean } = {},
): Promise<Response> {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const requestId = typeof body === "string" ? "x" : String(body.request_id);
  const id = opts.id ?? `adm_${requestId}`;
  const stamp = String(Math.floor(Date.now() / 1000) + (opts.offsetSeconds ?? 0));
  const headers: Record<string, string> = { "content-type": opts.contentType ?? "application/json", "webhook-id": id, "webhook-timestamp": stamp };
  if (!opts.skipSignature) headers["webhook-signature"] = await sign(id, stamp, raw, opts.secretBytes ?? ADMIN_BYTES);
  return handleRequest(new Request("https://worker.test" + path, { method: "POST", headers, body: raw }), env);
}

export const SETTINGS_PATH = "/v1/admin/settings";
export const USAGE_PATH = "/v1/admin/usage";
export const usageBody = () => ({ request_id: crypto.randomUUID() });

/** Insert journal rows directly (a test fixture for the send journal). */
export async function seedJournal(d1: { prepare(sql: string): { bind(...v: (string | number)[]): { run(): Promise<unknown> } } }, count: number, state: string, createdAt: number, tag = "s") {
  for (let i = 0; i < count; i++) {
    await d1.prepare("INSERT INTO whatsapp_hook_events (event_hash, created_at, state) VALUES (?1, ?2, ?3)").bind(`${String(i).padStart(6, "0")}${tag}${state}${createdAt}`.padEnd(64, "x").slice(0, 64), createdAt, state).run();
  }
}

/** Configure the settings row directly (fixture): production never gets one from code. */
export async function configure(d1: { prepare(sql: string): { bind(...v: (string | number)[]): { run(): Promise<unknown> } } }, limit = 100, ceiling = 5000, warn = 70, critical = 90) {
  await d1.prepare("INSERT INTO otp_settings (id, daily_limit, hard_ceiling, warn_percent, critical_percent, version, updated_at, updated_by) VALUES (1, ?1, ?2, ?3, ?4, 1, 0, ?5)").bind(limit, ceiling, warn, critical, ACTOR).run();
}

export const DELIVERY_PATH = "/v1/admin/delivery";

/** What the Aladdin database signs in admin_whatsapp_otp_delivery_begin (same canonical string, distinct "v1d" prefix). */
export function deliveryGrantFor(b: SettingsBody, opts: { bytes?: Uint8Array; expires?: number } = {}): { grant: string; grant_expires: number } {
  const expires = opts.expires ?? Math.floor(Date.now() / 1000) + 300;
  const canonical = ["v1d", b.request_id, b.actor_id, b.expected_version, b.enabled ? 1 : 0, expires, createHash("sha256").update(String(b.reason)).digest("hex")].join("|");
  return { grant: createHmac("sha256", Buffer.from(opts.bytes ?? GRANT_BYTES)).update(canonical).digest("base64"), grant_expires: expires };
}

export const deliveryBody = (over: SettingsBody = {}): SettingsBody => {
  const base: SettingsBody = { request_id: crypto.randomUUID(), actor_id: ACTOR, expected_version: 0, enabled: true, reason: "Acceptance rehearsal window approved", ...over };
  return { ...deliveryGrantFor(base), ...base };
};

/**
 * Fixture: the persisted delivery switch row AND its audit row, exactly as the audited admin route writes them (production gets a row only
 * from that route). A switch row WITHOUT a matching audit row is, by design, treated as OFF: use `setDeliverySwitchUnaudited` for that.
 */
export async function setDeliverySwitch(d1: { prepare(sql: string): { bind(...v: (string | number)[]): { run(): Promise<unknown> } } }, enabled: boolean, version = 1) {
  await d1.prepare("INSERT OR REPLACE INTO otp_delivery_switch (id, enabled, version, updated_at, updated_by) VALUES (1, ?1, ?2, 0, ?3)").bind(enabled ? 1 : 0, version, ACTOR).run();
  await d1.prepare("INSERT INTO otp_delivery_audit (at, request_id, actor, old_enabled, new_enabled, new_version, reason) VALUES (0, ?1, ?2, NULL, ?3, ?4, 'fixture: audited switch change')")
    .bind(crypto.randomUUID(), ACTOR, enabled ? 1 : 0, version).run();
  await setAttestation(d1, enabled, version);
}

/** The app's signed answer, exactly as attest.ts verifies it (environment "acceptance" is what envFor/baseEnv use). */
export async function setAttestation(d1: { prepare(sql: string): { bind(...v: (string | number)[]): { run(): Promise<unknown> } } }, enabled: boolean, version: number, opts: { issuedAt?: number; env?: string; secret?: string } = {}) {
  const issuedAt = opts.issuedAt ?? Math.floor(Date.now() / 1000);
  const nonce = "ab".repeat(16);
  const { attestationCanonical } = await import("../src/attest.ts");
  const { signPayload } = await import("../src/signing.ts");
  const mac = (await signPayload(opts.secret ?? NOTIFY_SECRET, "attest", issuedAt, attestationCanonical({ env: opts.env ?? "acceptance", enabled, version, issuedAt, nonce })))!;
  await d1.prepare("INSERT OR REPLACE INTO otp_delivery_attestation (id, enabled, version, issued_at, nonce, mac) VALUES (1, ?1, ?2, ?3, ?4, ?5)").bind(enabled ? 1 : 0, version, issuedAt, nonce, mac).run();
}

/** Fixture: a direct write to the switch table that bypassed the audit (what a break-glass or hostile D1 write looks like). */
export async function setDeliverySwitchUnaudited(d1: { prepare(sql: string): { bind(...v: (string | number)[]): { run(): Promise<unknown> } } }, enabled: boolean, version = 1) {
  await d1.prepare("INSERT OR REPLACE INTO otp_delivery_switch (id, enabled, version, updated_at, updated_by) VALUES (1, ?1, ?2, 1700000000, ?3)").bind(enabled ? 1 : 0, version, ACTOR).run();
}
