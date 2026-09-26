import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isRecoverySession } from "./recovery-session";

/** Builds a fake (unsigned — fine, this module never verifies the signature) JWT with the given `amr` claim. */
function fakeAccessToken(amr: Array<{ method: string }>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64");
  const payload = Buffer.from(JSON.stringify({ amr })).toString("base64");
  return `${header}.${payload}.signature`;
}

function supabaseWithSession(amr: Array<{ method: string }> | null) {
  return {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: amr ? { access_token: fakeAccessToken(amr) } : null },
      })),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("isRecoverySession", () => {
  it("is true when the most recent amr entry is 'recovery'", async () => {
    const supabase = supabaseWithSession([{ method: "otp" }, { method: "recovery" }]);
    expect(await isRecoverySession(supabase)).toBe(true);
  });

  it("is false for a normal OTP session", async () => {
    const supabase = supabaseWithSession([{ method: "otp" }]);
    expect(await isRecoverySession(supabase)).toBe(false);
  });

  it("is false for a normal password session", async () => {
    const supabase = supabaseWithSession([{ method: "password" }]);
    expect(await isRecoverySession(supabase)).toBe(false);
  });

  it("is false when a recovery event is followed by a LATER, different event", async () => {
    // e.g. the user re-authenticated normally after the recovery session —
    // only the MOST RECENT event should count.
    const supabase = supabaseWithSession([{ method: "recovery" }, { method: "password" }]);
    expect(await isRecoverySession(supabase)).toBe(false);
  });

  it("is false when there is no session at all", async () => {
    const supabase = supabaseWithSession(null);
    expect(await isRecoverySession(supabase)).toBe(false);
  });

  it("is false (fails closed) on a malformed access token", async () => {
    const supabase = {
      auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "not-a-jwt" } } })) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    expect(await isRecoverySession(supabase)).toBe(false);
  });
});
