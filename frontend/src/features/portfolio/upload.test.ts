import { describe, expect, it, vi, beforeEach } from "vitest";

const uploadToSignedUrl = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: () => ({
    storage: { from: () => ({ uploadToSignedUrl }) },
  }),
}));

import { uploadAsset } from "./upload";

/** A real PNG signature followed by filler, so the byte check has something true to find. */
function pngFile(size = 100): File {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new File([bytes], "photo.png", { type: "image/png" });
}

const ticket = {
  ok: true as const,
  itemId: "i1",
  bucket: "professional-portfolio",
  objectPath: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.png",
  token: "t0k3n",
};

beforeEach(() => {
  uploadToSignedUrl.mockReset();
  uploadToSignedUrl.mockResolvedValue({ error: null });
});

/**
 * The three-step sequence and, more importantly, what each failure leaves behind.
 * These are the assertions that make §7's recovery story real rather than stated.
 */
describe("uploadAsset", () => {
  it("validates, starts, uploads to the server-chosen key, then finishes", async () => {
    const order: string[] = [];
    const start = vi.fn(async () => { order.push("start"); return ticket; });
    const finish = vi.fn(async () => { order.push("finish"); return { ok: true }; });
    uploadToSignedUrl.mockImplementation(async () => { order.push("upload"); return { error: null }; });

    expect(await uploadAsset("portfolio", pngFile(), start, finish)).toEqual({ ok: true });
    expect(order).toEqual(["start", "upload", "finish"]);
    expect(uploadToSignedUrl).toHaveBeenCalledWith(
      ticket.objectPath,
      ticket.token,
      expect.anything(),
      { contentType: "image/png", upsert: false },
    );
    expect(finish).toHaveBeenCalledWith("i1");
  });

  it("refuses an oversized file before anything is created", async () => {
    const start = vi.fn();
    const big = new File([new Uint8Array(9_000_000)], "big.png", { type: "image/png" });
    expect(await uploadAsset("portfolio", big, start, vi.fn())).toEqual({
      ok: false,
      code: "assets.errors.tooLarge",
    });
    expect(start).not.toHaveBeenCalled();
  });

  /**
   * The declared type is a claim, and this is where the claim is checked against
   * the actual bytes. It is a correctness net rather than a boundary — the bucket
   * enforces the type list regardless — but it is the only layer that can tell a
   * person their "PNG" is a script before they wait for an upload.
   */
  it("refuses a file whose bytes do not match the type it claims", async () => {
    const start = vi.fn();
    const fake = new File([new TextEncoder().encode("<?php echo 1; ?>")], "photo.png", {
      type: "image/png",
    });
    expect(await uploadAsset("portfolio", fake, start, vi.fn())).toEqual({
      ok: false,
      code: "assets.errors.contentMismatch",
    });
    expect(start).not.toHaveBeenCalled();
  });

  it("stops when the row could not be created, with the server's own reason", async () => {
    const start = vi.fn(async () => ({ ok: false as const, code: "portfolio.errors.notProfessional" }));
    expect(await uploadAsset("portfolio", pngFile(), start, vi.fn())).toEqual({
      ok: false,
      code: "portfolio.errors.notProfessional",
    });
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });

  /**
   * A failed upload leaves the PENDING row deliberately. It is invisible to
   * everyone else, cannot be published, and is what produces the "unfinished"
   * card the owner can finish or discard — deleting it here would throw away the
   * only record that the attempt happened.
   */
  it("does not finalize, and does not clean up, when the bytes fail to land", async () => {
    const finish = vi.fn();
    uploadToSignedUrl.mockResolvedValue({ error: { message: "network" } });
    expect(await uploadAsset("portfolio", pngFile(), async () => ticket, finish)).toEqual({
      ok: false,
      code: "assets.errors.uploadFailed",
    });
    expect(finish).not.toHaveBeenCalled();
  });

  it("reports a failed finalize without losing the upload", async () => {
    const finish = vi.fn(async () => ({ ok: false, code: "states.genericRetry" }));
    expect(await uploadAsset("portfolio", pngFile(), async () => ticket, finish)).toEqual({
      ok: false,
      code: "states.genericRetry",
    });
    expect(uploadToSignedUrl).toHaveBeenCalled();
  });

  it("never passes upsert, so a second attempt cannot overwrite an existing object", async () => {
    await uploadAsset("portfolio", pngFile(), async () => ticket, async () => ({ ok: true }));
    const options = uploadToSignedUrl.mock.calls[0]![3] as { upsert: boolean };
    expect(options.upsert).toBe(false);
  });
});
