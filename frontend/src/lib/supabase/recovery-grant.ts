import "server-only";

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readPublicEnv, parseServerEnv } from "@/lib/env";
import type { Database } from "@/types/database.types";

/**
 * A plain, non-cookie-backed, non-persisting Supabase client (anon key —
 * `verifyOtp` authenticates via the OTP itself, it needs no prior identity).
 * Used for the ENTIRE recovery flow up through Screen 2: `resetPasswordForEmail`
 * never establishes a session on any client either way, and `verifyOtp`'s
 * result here is captured only in memory and sealed into the encrypted grant
 * below — never written to any cookie, so the app's normal, cookie-backed
 * `getServerSupabase()` client (and therefore production `middleware.ts` and
 * every RLS-authorized query) never sees it.
 */
export function createIsolatedAuthClient(): SupabaseClient<Database> {
  const env = readPublicEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * The recovery-session isolation mechanism (docs/frontend/auth-password-preview.md
 * §Recovery-session isolation). `verifyOtp({type:"recovery"})` still returns a
 * fully-privileged Supabase session — Supabase does not scope what it can do.
 * The fix is architectural, not a middleware patch: the recovery flow NEVER
 * persists that session into the app's normal, cookie-backed Supabase client
 * (`getServerSupabase()`) at all. Instead, the verified session's access
 * token is sealed into this AEAD-encrypted, httpOnly, path-scoped cookie — a
 * "recovery grant" — that only server code holding
 * `AUTH_PASSWORD_PREVIEW_GRANT_SECRET` can read. The browser carries an
 * opaque blob it cannot decrypt or forge; the normal application middleware
 * and the normal Supabase client never see or interpret it, because nothing
 * ever writes it into the `sb-*-auth-token` cookies `@supabase/ssr` reads.
 * Screen 3 authenticates its one `updateUser` call using
 * `createServerSupabaseClient(grant.accessToken)` (the existing
 * explicit-Bearer-token client already used elsewhere for trusted
 * server-to-server calls) — never the cookie-backed client, never a normal
 * app session.
 *
 * AES-256-GCM (Node's built-in `crypto`, no new dependency): the auth tag
 * makes any tampering fail `decryptRecoveryGrant` outright (throws inside
 * `decipher.final()`, caught and turned into `null`) rather than silently
 * accepting a modified payload.
 */

export interface RecoveryGrant {
  email: string;
  accessToken: string;
  /**
   * `auth.updateUser()`/`auth.signOut()` read the CLIENT's own in-memory
   * session (`_useSession`/`__loadSession` in the GoTrue SDK), not
   * `global.headers` — a bare Authorization header on the client is not
   * enough to make GoTrue SDK auth methods work. Screen 3 calls
   * `client.auth.setSession({access_token, refresh_token})` on a fresh,
   * non-persisting isolated client BEFORE `updateUser`, which is why the
   * refresh token has to travel in the grant too, not just the access token.
   */
  refreshToken: string;
  /** Epoch ms. Checked on every decrypt — independent of (and tighter than) the cookie's own `maxAge`. */
  exp: number;
}

/** Grant lifetime: short, matching §7's "short-lived" requirement — tighter than the old UX-only cookie, because this one carries real authority. */
export const RECOVERY_GRANT_TTL_SECONDS = 5 * 60;

function getSecret(): Buffer {
  const { AUTH_PASSWORD_PREVIEW_GRANT_SECRET } = parseServerEnv({
    AUTH_PASSWORD_PREVIEW_GRANT_SECRET: process.env.AUTH_PASSWORD_PREVIEW_GRANT_SECRET,
  });
  if (!AUTH_PASSWORD_PREVIEW_GRANT_SECRET) {
    throw new Error(
      "AUTH_PASSWORD_PREVIEW_GRANT_SECRET is not set. Required for the password-auth preview's recovery flow — " +
        "see .env.example and docs/frontend/auth-password-preview.md §Recovery-session isolation.",
    );
  }
  // SHA-256 gives exactly the 32 bytes AES-256 needs regardless of the configured secret's own length.
  return createHash("sha256").update(AUTH_PASSWORD_PREVIEW_GRANT_SECRET).digest();
}

export function encryptRecoveryGrant(grant: RecoveryGrant): string {
  const key = getSecret();
  const iv = randomBytes(12); // 96-bit IV, the GCM standard.
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(grant), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

/** Returns `null` for anything tampered, malformed, wrong-key, or expired — never throws. */
export function decryptRecoveryGrant(token: string | undefined): RecoveryGrant | null {
  if (!token) return null;
  try {
    const key = getSecret();
    const raw = Buffer.from(token, "base64url");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const grant = JSON.parse(plaintext.toString("utf8")) as RecoveryGrant;
    if (typeof grant.exp !== "number" || grant.exp < Date.now()) return null;
    if (typeof grant.email !== "string" || typeof grant.accessToken !== "string") return null;
    return grant;
  } catch {
    return null;
  }
}
