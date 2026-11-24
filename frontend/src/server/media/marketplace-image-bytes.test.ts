import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveMedia: vi.fn(),
  requireR2ForRead: vi.fn(),
  mediaProvider: vi.fn(),
  privilegedStorageClient: vi.fn(() => ({ privileged: true })),
  readBoundedBody: vi.fn(),
  getReadAccess: vi.fn(),
  readObject: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/media/limits", () => ({ storedObjectCeiling: () => 4096 }));
vi.mock("@/server/storage/validation", () => ({ readBoundedBody: mocks.readBoundedBody }));
vi.mock("@/server/storage/media", () => ({
  resolveMedia: mocks.resolveMedia,
  requireR2ForRead: mocks.requireR2ForRead,
  mediaProvider: mocks.mediaProvider,
  privilegedStorageClient: mocks.privilegedStorageClient,
}));

import { readMarketplaceImageBytes, readPublishedMarketplaceImageBytes } from "./marketplace-image-bytes";

const stored = new Uint8Array([1, 2, 3]);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.privilegedStorageClient.mockReturnValue({ privileged: true });
  mocks.resolveMedia.mockResolvedValue({ provider: "r2" });
  mocks.getReadAccess.mockResolvedValue("https://r2.test/signed");
  mocks.mediaProvider.mockResolvedValue({ getReadAccess: mocks.getReadAccess, readObject: mocks.readObject });
  mocks.readBoundedBody.mockResolvedValue(stored);
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockResolvedValue(new Response("ignored"));
});

describe("marketplace image bytes", () => {
  it("reads the STORED object through a short read URL, never the pending upload (moderator path)", async () => {
    const client = { member: true } as never;
    const bytes = await readMarketplaceImageBytes(client, "marketplace/org/img");

    expect(bytes).toBe(stored);
    expect(mocks.resolveMedia).toHaveBeenCalledWith(client, "marketplace", "marketplace/org/img", "read");
    expect(mocks.requireR2ForRead).toHaveBeenCalledWith("marketplace", "r2");
    expect(mocks.getReadAccess).toHaveBeenCalledWith("marketplace/org/img", 30);
    expect(mocks.fetch).toHaveBeenCalledWith("https://r2.test/signed", expect.objectContaining({ cache: "no-store" }));
    expect(mocks.readBoundedBody).toHaveBeenCalledWith(expect.any(Response), 4096);
    expect(mocks.readObject).not.toHaveBeenCalled();
  });

  it("reads the stored object with the backend credential for a published image", async () => {
    const bytes = await readPublishedMarketplaceImageBytes("marketplace/org/pub");

    expect(bytes).toBe(stored);
    expect(mocks.mediaProvider).toHaveBeenCalledWith({ privileged: true }, "marketplace", "r2", "marketplace/org/pub");
    expect(mocks.getReadAccess).toHaveBeenCalledWith("marketplace/org/pub", 30);
    expect(mocks.readObject).not.toHaveBeenCalled();
  });

  it("refuses when the resolver refuses, before any provider is opened", async () => {
    mocks.resolveMedia.mockRejectedValue(new Error("media unavailable"));
    await expect(readMarketplaceImageBytes({} as never, "k")).rejects.toThrow("media unavailable");
    expect(mocks.mediaProvider).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("surfaces an oversize body from the bounded reader", async () => {
    mocks.readBoundedBody.mockRejectedValue(new Error("body too large"));
    await expect(readPublishedMarketplaceImageBytes("k")).rejects.toThrow("body too large");
  });
});
