import { describe, expect, it } from "vitest";
import { parsePublicEnv } from "./index";

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
