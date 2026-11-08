import "server-only";
import { resolveWorkerTransport } from "@/server/whatsapp-otp/worker-binding";
import { createClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { parseServerEnv, readPublicEnv } from "@/lib/env";
import { readPhoneVerificationEnv } from "@/lib/env/phone-verification";
import { parseDeliveryMode, selectTransport } from "./delivery";
import { parseKeyring } from "./otp";
import { createPhoneVerificationService, type PhoneVerificationDb, type PhoneVerificationService } from "./service";
import { createDeliveryGate, type DeliveryAvailability } from "./delivery-gate";
import { fetchUsage } from "@/server/whatsapp-otp/worker-admin";
import { createPhoneSignupService, type PhoneSignupService } from "./signup-service";

/**
 * Composition root for the phone verification authority.
 *
 * Delivery is chosen ONLY by PHONE_OTP_DELIVERY (default off; see delivery.ts). In R1 "worker" is not wired, so even with the
 * feature flags on no real message can be sent until a reviewed adapter is deliberately plugged in.
 *
 * Each getter returns null when its feature flag is off, so callers cannot reach key material, the service-role client or the
 * database at all in that state.
 */
function build() {
  const env = readPhoneVerificationEnv();
  const keyring = parseKeyring(env.hmacKeys); // throws (no key material in the message) if misconfigured: fail closed, never default
  const { SUPABASE_SERVICE_ROLE_KEY } = parseServerEnv({ SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY });
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for phone verification");
  const client = createClient(readPublicEnv().NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const db: PhoneVerificationDb = { rpc: (fn, args) => client.rpc(fn, args) as unknown as ReturnType<PhoneVerificationDb["rpc"]> };
  const mode = parseDeliveryMode(env.delivery, process.env.NODE_ENV);
  // Only the Worker mode needs a route to the Worker; in production that is the private service binding, never a public URL.
  const route = mode === "worker" ? resolveWorkerTransport() : null;
  if (route && !route.ok) throw new Error("the WhatsApp delivery Worker is not reachable through its service binding");
  const transport = selectTransport({ mode, outboxDir: env.outboxDir, nodeEnv: process.env.NODE_ENV, workerUrl: env.workerUrl, workerSecret: env.workerSecret, fetchImpl: route?.ok ? route.fetchImpl : undefined });
  return { env, keyring, db, transport, mode, route };
}

// Per-isolate: the cache inside the gate is what keeps this to a few Worker calls per minute, whatever the sign-up traffic.
let gate: DeliveryAvailability | null = null;
function signupDeliveryGate(env: ReturnType<typeof readPhoneVerificationEnv>, mode: string, route: ReturnType<typeof resolveWorkerTransport> | null): DeliveryAvailability {
  // Only a real Worker needs asking. "off" can deliver nothing; "outbox" is the local rig (refused by delivery.ts in production).
  if (mode === "off") return async () => false;
  if (mode !== "worker") return async () => true;
  if (!route?.ok) return async () => false;
  gate ??= createDeliveryGate({ fetchUsage: () => fetchUsage({ workerUrl: env.workerUrl, adminSecret: env.adminSecret, fetchImpl: route.fetchImpl, timeoutMs: 3000 }) });
  return gate;
}

export function getPhoneVerificationService(): PhoneVerificationService | null {
  if (!readPhoneVerificationEnv().enabled) return null;
  const { env, keyring, db, transport } = build();
  return createPhoneVerificationService({ db, transport, keyring, enabled: env.enabled });
}

export function getPhoneSignupService(): PhoneSignupService | null {
  if (!readPhoneVerificationEnv().signupEnabled) return null;
  const { env, keyring, db, transport, mode, route } = build();
  // Delivery runs after the response (Next `after` -> waitUntil on Workers), so the reply cannot reveal whether a number is already registered.
  // If the hook is unavailable (called outside a request), the task still runs, but on Workers an un-registered task is cancelled when the
  // response ends and the person would never get a code. Say so, once per occurrence, with nothing that identifies a number or a code.
  const defer = (task: Promise<void>) => {
    try {
      after(task);
    } catch {
      console.error("phone verification: post-response hook unavailable; delivery runs unprotected");
      void task;
    }
  };
  return createPhoneSignupService({ db, transport, keyring, enabled: env.signupEnabled, defer, deliveryAvailable: signupDeliveryGate(env, mode, route) });
}
