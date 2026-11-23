import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn(), invalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/server/media/limits", () => ({ invalidateMediaLimitCache: mocks.invalidate }));

import { saveMediaLimitAction } from "./media-limits";

const form = (values: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
};
const valid = { kind: "image", place: "marketplace", megabytes: "12.5", reason: "Showrooms upload large photos" };

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.revalidate.mockReset();
  mocks.invalidate.mockReset();
});

describe("saveMediaLimitAction", () => {
  it("sends bytes, place and reason to the database and refreshes the cache and the page", async () => {
    mocks.rpc.mockResolvedValue({ data: { changed: true }, error: null });
    expect(await saveMediaLimitAction({ ok: false }, form(valid))).toEqual({ ok: true, code: "mediaLimits.saved" });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_media_limit_set", { p_kind: "image", p_place: "marketplace", p_max_bytes: 13107200, p_reason: "Showrooms upload large photos" });
    expect(mocks.invalidate).toHaveBeenCalled();
    expect(mocks.revalidate).toHaveBeenCalledWith("/admin/media-limits");
  });

  it("reports an unchanged value as such", async () => {
    mocks.rpc.mockResolvedValue({ data: { changed: false }, error: null });
    expect(await saveMediaLimitAction({ ok: false }, form(valid))).toEqual({ ok: true, code: "mediaLimits.unchanged" });
  });

  it("refuses bad input before it reaches the database", async () => {
    expect(await saveMediaLimitAction({ ok: false }, form({ ...valid, megabytes: "ten" }))).toEqual({ ok: false, code: "mediaLimits.errors.number" });
    expect(await saveMediaLimitAction({ ok: false }, form({ ...valid, reason: "x" }))).toEqual({ ok: false, code: "mediaLimits.errors.reason" });
    expect(await saveMediaLimitAction({ ok: false }, form({ ...valid, megabytes: "26" }))).toEqual({ ok: false, code: "mediaLimits.errors.aboveCeiling" });
    expect(await saveMediaLimitAction({ ok: false }, form({ ...valid, megabytes: "0.05" }))).toEqual({ ok: false, code: "mediaLimits.errors.belowFloor" });
    expect(await saveMediaLimitAction({ ok: false }, form({ ...valid, place: "nope" }))).toEqual({ ok: false, code: "mediaLimits.errors.unknownPlace" });
    expect(await saveMediaLimitAction({ ok: false }, form({ ...valid, kind: "audio" }))).toEqual({ ok: false, code: "mediaLimits.errors.unknownPlace" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps the database refusals to messages and leaves the cache alone", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission media_limits.manage is required" } });
    expect(await saveMediaLimitAction({ ok: false }, form(valid))).toEqual({ ok: false, code: "mediaLimits.errors.forbidden" });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "the limit exceeds the platform ceiling" } });
    expect(await saveMediaLimitAction({ ok: false }, form(valid))).toEqual({ ok: false, code: "mediaLimits.errors.aboveCeiling" });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "57P01", message: "down" } });
    expect(await saveMediaLimitAction({ ok: false }, form(valid))).toEqual({ ok: false, code: "mediaLimits.errors.unavailable" });
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});
