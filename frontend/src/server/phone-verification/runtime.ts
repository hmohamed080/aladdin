import "server-only";
import { createClient } from "@supabase/supabase-js";
import { parseServerEnv, readPublicEnv } from "@/lib/env";
import { readPhoneVerificationEnv } from "@/lib/env/phone-verification";
import { parseKeyring } from "./otp";
import { createPhoneVerificationService, type PhoneVerificationDb, type PhoneVerificationService } from "./service";
import { disabledTransport } from "./transport";

/**
 * Composition root for the phone verification authority. B1 wires the DISABLED transport: even with the flag on, no code can
 * be delivered until a reviewed adapter (the Cloudflare Worker) is deliberately plugged in here.
 *
 * Returns null when the feature flag is off, so callers cannot reach key material, the service-role client or the database
 * at all in that state.
 */
export function getPhoneVerificationService(): PhoneVerificationService | null {
  const { enabled, hmacKeys } = readPhoneVerificationEnv();
  if (!enabled) return null;
  const keyring = parseKeyring(hmacKeys); // throws (no key material in the message) if misconfigured: fail closed, never default
  const { SUPABASE_SERVICE_ROLE_KEY } = parseServerEnv({ SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY });
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for phone verification");
  const client = createClient(readPublicEnv().NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const db: PhoneVerificationDb = { rpc: (fn, args) => client.rpc(fn, args) as unknown as ReturnType<PhoneVerificationDb["rpc"]> };
  return createPhoneVerificationService({ db, transport: disabledTransport, keyring, enabled });
}
