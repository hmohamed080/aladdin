import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ release: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({}) }));
vi.mock("@/server/storage/media", () => ({ releaseReservation: state.release, removeMedia: state.remove }));
vi.unmock("@/server/actions/media-release");

import { releaseUploadAction } from "./media-release";

beforeEach(() => { state.release.mockReset(); state.remove.mockReset(); });

describe("releasing a failed upload", () => {
  it("frees the reservation, then deletes any partial bytes", async () => {
    state.release.mockResolvedValue(true);
    expect(await releaseUploadAction("request", "k")).toEqual({ ok: true });
    expect(state.release).toHaveBeenCalledWith(expect.anything(), "request", "k");
    expect(state.remove).toHaveBeenCalledWith(expect.anything(), "request", "k");
  });

  it("deletes nothing when the database refuses (not the caller's unfinished upload)", async () => {
    state.release.mockResolvedValue(false);
    expect(await releaseUploadAction("request", "k")).toEqual({ ok: false });
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("stays released when the bytes cannot be deleted now", async () => {
    state.release.mockResolvedValue(true);
    state.remove.mockRejectedValue(new Error("r2 down"));
    expect(await releaseUploadAction("request", "k")).toEqual({ ok: true });
  });

  it("refuses an unknown place without asking the database", async () => {
    expect(await releaseUploadAction("nope" as never, "k")).toEqual({ ok: false });
    expect(state.release).not.toHaveBeenCalled();
  });
});
