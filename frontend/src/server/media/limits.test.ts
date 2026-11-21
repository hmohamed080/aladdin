import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), key: { value: "service-key" as string | undefined } }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/env", () => ({ readPublicEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" }) }));
vi.mock("@/lib/env/storage", () => ({ readStorageEnv: () => ({ SUPABASE_SERVICE_ROLE_KEY: mocks.key.value }) }));

import { MIB } from "@/lib/media/upload-limits";
import { imageMaxBytes, invalidateMediaLimitCache, loadMediaLimits, storedObjectCeiling, videoMaxBytes } from "./limits";

const stored = (marketplaceMb: number) => ({
  data: [
    { kind: "image", place: "marketplace", max_bytes: marketplaceMb * MIB, default_bytes: 10 * MIB, ceiling_bytes: 20 * MIB, updated_at: null },
    { kind: "video", place: "product", max_bytes: 250 * MIB, default_bytes: 100 * MIB, ceiling_bytes: 1024 * MIB, updated_at: null },
  ],
  error: null,
});

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.key.value = "service-key";
  invalidateMediaLimitCache();
});

describe("server media limits", () => {
  it("reads the stored value for images and videos", async () => {
    mocks.rpc.mockResolvedValue(stored(15));
    expect(await imageMaxBytes("marketplace")).toBe(15 * MIB);
    expect(await videoMaxBytes("product")).toBe(250 * MIB);
    expect(mocks.rpc).toHaveBeenCalledWith("media_limits_get");
  });

  it("falls back to the compiled default for a place the table does not list", async () => {
    mocks.rpc.mockResolvedValue(stored(15));
    expect(await imageMaxBytes("avatar")).toBe(3 * MIB);
    expect(await videoMaxBytes("portfolio")).toBe(100 * MIB);
  });

  it("caches for a short time, then reads again, and an admin change can drop the cache", async () => {
    mocks.rpc.mockResolvedValue(stored(15));
    await loadMediaLimits(1_000);
    await loadMediaLimits(1_000 + 10_000);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    mocks.rpc.mockResolvedValue(stored(20));
    expect((await loadMediaLimits(1_000 + 31_000))?.[0]?.maxBytes).toBe(20 * MIB);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    mocks.rpc.mockResolvedValue(stored(5));
    invalidateMediaLimitCache();
    expect((await loadMediaLimits(1_000 + 31_500))?.[0]?.maxBytes).toBe(5 * MIB);
  });

  it("uses the defaults when the stored value cannot be read, and keeps the last good value over a short outage", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "57P01", message: "down" } });
    expect(await imageMaxBytes("marketplace")).toBe(10 * MIB);
    mocks.rpc.mockResolvedValue(stored(15));
    expect(await imageMaxBytes("marketplace")).toBe(15 * MIB);
    mocks.rpc.mockRejectedValue(new Error("network"));
    expect((await loadMediaLimits(Date.now() + 60_000))?.[0]?.maxBytes).toBe(15 * MIB);
  });

  it("does not call the database without the service credential", async () => {
    mocks.key.value = undefined;
    expect(await imageMaxBytes("marketplace")).toBe(10 * MIB);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("serves and reads stored files up to the platform ceiling, whatever the current upload limit", () => {
    expect(storedObjectCeiling("image")).toBe(20 * MIB);
    expect(storedObjectCeiling("video")).toBe(1024 * MIB);
  });
});
