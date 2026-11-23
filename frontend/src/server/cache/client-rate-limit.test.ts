import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// No Redis in this test: the limiter counts in instance memory, exactly as it does when Redis is off.
vi.mock("./redis", async (original) => ({ ...(await original<typeof import("./redis")>()), withRedis: async () => undefined }));

import { RATE_LIMITS, consumeClientRateLimit, resetMemoryLimiterForTests } from "./rate-limit";

describe("per-client rate limit (public Marketplace routes)", () => {
  beforeEach(() => resetMemoryLimiterForTests());

  it("allows up to the ceiling, then refuses with a retry hint", async () => {
    const { limit } = RATE_LIMITS["market-quote"];
    for (let i = 0; i < limit; i += 1) expect((await consumeClientRateLimit("market-quote", "client-a")).outcome).toBe("allowed");
    const refused = await consumeClientRateLimit("market-quote", "client-a");
    expect(refused.outcome).toBe("limited");
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts every client and every rule separately", async () => {
    const { limit } = RATE_LIMITS["market-quote"];
    for (let i = 0; i <= limit; i += 1) await consumeClientRateLimit("market-quote", "client-a");
    expect((await consumeClientRateLimit("market-quote", "client-b")).outcome).toBe("allowed");
    expect((await consumeClientRateLimit("market-media", "client-a")).outcome).toBe("allowed");
  });
});
