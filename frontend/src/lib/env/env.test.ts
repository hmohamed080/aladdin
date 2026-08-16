import { describe, expect, it } from "vitest";
import {
  SECRET_NAME_PATTERN,
  parsePublicEnv,
  parseServerEnv,
  publicEnvSchema,
  serverEnvSchema,
} from "./index";

const publicKeys = Object.keys(publicEnvSchema.shape);
const serverKeys = Object.keys(serverEnvSchema.shape);

describe("parsePublicEnv", () => {
  it("accepts a valid public environment and defaults APP_ENV to local", () => {
    const env = parsePublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    });
    expect(env.NEXT_PUBLIC_APP_ENV).toBe("local");
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://example.supabase.co");
  });

  it("throws when a required variable is missing", () => {
    expect(() =>
      parsePublicEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("throws when the URL is not a valid URL", () => {
    expect(() =>
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});

/**
 * Deployment contract. These assertions are what make the Vercel environment
 * safe to fill in by hand: they enumerate the schemas rather than a maintained
 * list, so adding a variable to the wrong half fails here instead of leaking.
 * See docs/operations/staging-deployment-runbook.md.
 */
describe("environment exposure contract", () => {
  it("exposes only NEXT_PUBLIC_-prefixed variables to the browser", () => {
    for (const key of publicKeys) {
      expect(key, `${key} is browser-exposed and must be NEXT_PUBLIC_-prefixed`).toMatch(
        /^NEXT_PUBLIC_/,
      );
    }
  });

  it("never exposes a service-role, database, or secret-shaped name publicly", () => {
    for (const key of publicKeys) {
      expect(
        SECRET_NAME_PATTERN.test(key),
        `${key} is inlined into the client bundle and must not be a credential`,
      ).toBe(false);
    }
  });

  it("keeps every server-only variable out of the NEXT_PUBLIC_ namespace", () => {
    for (const key of serverKeys) {
      expect(key, `${key} is server-only and must not be NEXT_PUBLIC_-prefixed`).not.toMatch(
        /^NEXT_PUBLIC_/,
      );
    }
  });

  it("keeps the service-role key in the server schema", () => {
    expect(serverKeys).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(publicKeys).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("parses a staging-shaped public environment", () => {
    const env = parsePublicEnv({
      NEXT_PUBLIC_APP_ENV: "staging",
      NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "staging-anon-key",
    });
    expect(env.NEXT_PUBLIC_APP_ENV).toBe("staging");
    expect(env.NEXT_PUBLIC_SUPPORT_CONTACT).toBeUndefined();
  });

  it("parses a staging server environment that provisions no optional service", () => {
    // The first staging deployment sets neither the service-role key nor the AI
    // service URL; both stay optional so the runtime cannot demand them.
    expect(() => parseServerEnv({})).not.toThrow();
  });
});
