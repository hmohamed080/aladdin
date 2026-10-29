import "server-only";
import { createClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { parseServerEnv, readPublicEnv } from "@/lib/env";
import { readPhoneVerificationEnv } from "@/lib/env/phone-verification";
import { parseDeliveryMode, selectTransport } from "./delivery";
import { parseKeyring } from "./otp";
import { createPhoneVerificationService, type PhoneVerificationDb, type PhoneVerificationService } from "./service";
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
  const transport = selectTransport({ mode: parseDeliveryMode(env.delivery, process.env.NODE_ENV), outboxDir: env.outboxDir, nodeEnv: process.env.NODE_ENV });
  return { env, keyring, db, transport };
}

export function getPhoneVerificationService(): PhoneVerificationService | null {
  if (!readPhoneVerificationEnv().enabled) return null;
  const { env, keyring, db, transport } = build();
  return createPhoneVerificationService({ db, transport, keyring, enabled: env.enabled });
}

export function getPhoneSignupService(): PhoneSignupService | null {
  if (!readPhoneVerificationEnv().signupEnabled) return null;
  const { env, keyring, db, transport } = build();
  // Delivery runs after the response (Next `after` -> waitUntil on Workers), so the reply cannot reveal whether a number is already registered.
  const defer = (task: Promise<void>) => {
    try { after(task); } catch { void task; }
  };
  return createPhoneSignupService({ db, transport, keyring, enabled: env.signupEnabled, defer });
}
