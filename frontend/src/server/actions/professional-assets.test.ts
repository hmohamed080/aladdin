import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const getUser = vi.fn();
const createSignedUploadUrl = vi.fn();
const createSignedUrl = vi.fn();
const remove = vi.fn();
const storageFrom = vi.fn(() => ({ createSignedUploadUrl, createSignedUrl, remove }));
const from = vi.fn();
const rpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => ({
    auth: { getUser },
    storage: { from: storageFrom },
    from,
    rpc,
  }),
}));

import {
  createAssetUploadTicket,
  createAssetReadUrl,
  deleteProfessionalAsset,
} from "./professional-assets";

const OWNER = "70000009-0000-4000-8000-000000000009";
const OTHER = "71000006-0000-4000-8000-000000000006";
const OBJECT = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

beforeEach(() => {
  for (const m of [getUser, createSignedUploadUrl, createSignedUrl, remove, storageFrom, from, rpc]) {
    m.mockReset();
  }
  storageFrom.mockImplementation(() => ({ createSignedUploadUrl, createSignedUrl, remove }));
  getUser.mockResolvedValue({ data: { user: { id: OWNER } } });
  createSignedUploadUrl.mockResolvedValue({ data: { token: "t0k3n" }, error: null });
  createSignedUrl.mockResolvedValue({ data: { signedUrl: "/object/sign/x?token=y" }, error: null });
  remove.mockResolvedValue({ data: [{ name: "x" }], error: null });
});

/**
 * The server seam.
 *
 * The tests that matter here are the ones about what the CALLER cannot influence.
 * These are `"use server"` exports, so every argument arrives from a browser, and
 * the single most important property of the file is that none of them names an
 * owner. A test that only checked the happy path would pass just as well against
 * a version that took `ownerId` as a parameter.
 */
describe("createAssetUploadTicket", () => {
  it("derives the path from the SESSION, never from anything the caller sent", async () => {
    const r = await createAssetUploadTicket("portfolio", { type: "image/png", size: 1000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.path.startsWith(`${OWNER}/`)).toBe(true);
    expect(r.path).toMatch(/\.png$/);
    expect(r.bucket).toBe("professional-portfolio");
    expect(createSignedUploadUrl).toHaveBeenCalledWith(r.path);
  });

  it("gives every ticket a fresh object identity, so no two can collide or overwrite", async () => {
    const a = await createAssetUploadTicket("portfolio", { type: "image/png", size: 10 });
    const b = await createAssetUploadTicket("portfolio", { type: "image/png", size: 10 });
    expect(a.ok && b.ok && a.path).not.toBe(b.ok && b.path);
  });

  it("takes the extension from the content type, not from any filename", async () => {
    const r = await createAssetUploadTicket("certificate", {
      type: "application/pdf",
      size: 1000,
    });
    expect(r.ok && r.path).toMatch(/\.pdf$/);
    expect(r.ok && r.bucket).toBe("professional-certificates");
  });

  it("refuses an unknown namespace without asking Storage anything", async () => {
    expect(await createAssetUploadTicket("chat-attachments", { type: "image/png", size: 10 }))
      .toEqual({ ok: false, code: "assets.errors.invalidPath" });
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it("refuses a type or size the namespace does not take, before any request", async () => {
    expect(await createAssetUploadTicket("portfolio", { type: "application/pdf", size: 10 }))
      .toEqual({ ok: false, code: "assets.errors.unsupportedType" });
    expect(await createAssetUploadTicket("portfolio", { type: "image/png", size: 9_000_000 }))
      .toEqual({ ok: false, code: "assets.errors.tooLarge" });
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated caller", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await createAssetUploadTicket("portfolio", { type: "image/png", size: 10 }))
      .toEqual({ ok: false, code: "assets.errors.notAllowed" });
    expect(storageFrom).not.toHaveBeenCalled();
  });

  /**
   * The persona gate is NOT in this file, and this is the test that says so. A
   * consumer is refused because minting the token is an authorized write and the
   * INSERT policy evaluates `app.can_create_professional_asset` — so the action
   * reaches Storage, is told no, and translates it. If the gate were ever
   * reimplemented here, this test would still pass while quietly becoming a lie,
   * which is why the assertion is that the call HAPPENED.
   */
  it("lets the database refuse a non-professional, and translates that refusal", async () => {
    createSignedUploadUrl.mockResolvedValue({
      data: null,
      error: { code: "AccessDenied", message: "new row violates row-level security policy" },
    });
    const r = await createAssetUploadTicket("portfolio", { type: "image/png", size: 10 });
    expect(createSignedUploadUrl).toHaveBeenCalled();
    expect(r).toEqual({ ok: false, code: "assets.errors.notAllowed" });
  });

  it("never touches a table: storage is not a product record here", async () => {
    await createAssetUploadTicket("portfolio", { type: "image/png", size: 10 });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("createAssetReadUrl", () => {
  it("mints a short-lived URL for the caller's own object", async () => {
    const r = await createAssetReadUrl("portfolio", `${OWNER}/${OBJECT}.png`);
    expect(r).toEqual({ ok: true, url: "/object/sign/x?token=y", expiresIn: 300 });
    expect(createSignedUrl).toHaveBeenCalledWith(`${OWNER}/${OBJECT}.png`, 300);
  });

  it("refuses another user's object without asking Storage — no existence probe", async () => {
    const r = await createAssetReadUrl("portfolio", `${OTHER}/${OBJECT}.png`);
    expect(r).toEqual({ ok: false, code: "assets.errors.invalidPath" });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("refuses a traversal path the same way", async () => {
    expect(await createAssetReadUrl("portfolio", `${OWNER}/../${OTHER}/x.png`)).toEqual({
      ok: false,
      code: "assets.errors.invalidPath",
    });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  /**
   * §11: the helper must not accept an arbitrary bucket/object pair. It takes a
   * namespace from a closed set of two and looks the bucket up itself, so there
   * is no argument through which a caller could name `professional-certificates`
   * while a portfolio surface believes it asked for a photo.
   */
  it("resolves the bucket from the namespace and takes no bucket argument", async () => {
    await createAssetReadUrl("certificate", `${OWNER}/${OBJECT}.pdf`);
    expect(storageFrom).toHaveBeenCalledWith("professional-certificates");
    expect(createAssetReadUrl.length).toBe(2);
  });

  it("translates a hidden object into a readable sentence rather than a storage string", async () => {
    createSignedUrl.mockResolvedValue({
      data: null,
      error: { code: "NoSuchKey", message: "Object not found" },
    });
    expect(await createAssetReadUrl("portfolio", `${OWNER}/${OBJECT}.png`)).toEqual({
      ok: false,
      code: "assets.errors.gone",
    });
  });
});

describe("deleteProfessionalAsset", () => {
  it("removes exactly one named object of the caller's", async () => {
    expect(await deleteProfessionalAsset("portfolio", `${OWNER}/${OBJECT}.png`)).toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith([`${OWNER}/${OBJECT}.png`]);
  });

  it("refuses another user's object before it reaches Storage", async () => {
    expect(await deleteProfessionalAsset("portfolio", `${OTHER}/${OBJECT}.png`)).toEqual({
      ok: false,
      code: "assets.errors.invalidPath",
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it("has no folder form: a bare owner segment is not an object", async () => {
    expect(await deleteProfessionalAsset("portfolio", OWNER)).toEqual({
      ok: false,
      code: "assets.errors.invalidPath",
    });
    expect(await deleteProfessionalAsset("portfolio", `${OWNER}/`)).toEqual({
      ok: false,
      code: "assets.errors.invalidPath",
    });
    expect(remove).not.toHaveBeenCalled();
  });

  /**
   * Idempotence, which Increment 11 depends on: cleaning up a metadata row and
   * its object is two steps, and a retry after a partial failure has to be able
   * to converge rather than jam on the half that already succeeded.
   */
  it("treats an already-deleted object as success — the caller wanted it gone and it is", async () => {
    remove.mockResolvedValue({ data: null, error: { code: "NoSuchKey", message: "Object not found" } });
    expect(await deleteProfessionalAsset("portfolio", `${OWNER}/${OBJECT}.png`)).toEqual({ ok: true });
  });

  it("does not swallow a real refusal", async () => {
    remove.mockResolvedValue({ data: null, error: { code: "AccessDenied", message: "Access denied" } });
    expect(await deleteProfessionalAsset("portfolio", `${OWNER}/${OBJECT}.png`)).toEqual({
      ok: false,
      code: "assets.errors.notAllowed",
    });
  });

  it("refuses an unauthenticated caller", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await deleteProfessionalAsset("portfolio", `${OWNER}/${OBJECT}.png`)).toEqual({
      ok: false,
      code: "assets.errors.notAllowed",
    });
    expect(remove).not.toHaveBeenCalled();
  });
});

/**
 * §17 draws the line at infrastructure, and this asserts where it fell. Three
 * helpers, and in particular NO action that records what an object means — no
 * title, no caption, no issuer, no visibility. Increment 11 adds those; if one
 * appears here first, this test is the thing that notices.
 */
describe("the surface of this module", () => {
  it("exports exactly three helpers: in, out, away", async () => {
    const mod = await import("./professional-assets");
    expect(Object.keys(mod).sort()).toEqual([
      "createAssetReadUrl",
      "createAssetUploadTicket",
      "deleteProfessionalAsset",
    ]);
  });
});
