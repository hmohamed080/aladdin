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
const PORTFOLIO_KEY = `${OBJECT}.png`;
const CERTIFICATE_PATH = `${OWNER}/${OBJECT}.pdf`;

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
 * The server seam, after Increment 11 moved key generation into the database.
 *
 * These helpers no longer DERIVE a path — the RPC that creates the metadata row
 * does, in the same transaction (S3). So the tests that matter here are about
 * what the helper refuses to pass through, and about the one asymmetry the
 * redesign introduced: a certificate path proves its own ownership and a
 * portfolio key deliberately cannot.
 */
describe("createAssetUploadTicket", () => {
  it("mints a ticket for the exact key the database handed back", async () => {
    const r = await createAssetUploadTicket("portfolio", PORTFOLIO_KEY);
    expect(r).toEqual({ ok: true, token: "t0k3n" });
    expect(storageFrom).toHaveBeenCalledWith("professional-portfolio");
    expect(createSignedUploadUrl).toHaveBeenCalledWith(PORTFOLIO_KEY);
  });

  it("resolves the bucket from the namespace and never takes one as an argument", async () => {
    await createAssetUploadTicket("certificate", CERTIFICATE_PATH);
    expect(storageFrom).toHaveBeenCalledWith("professional-certificates");
    expect(createAssetUploadTicket.length).toBe(2);
  });

  it("refuses an unknown namespace without asking Storage anything", async () => {
    expect(await createAssetUploadTicket("chat-attachments", PORTFOLIO_KEY)).toEqual({
      ok: false,
      code: "assets.errors.invalidPath",
    });
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it("refuses a certificate path belonging to someone else, before any request", async () => {
    expect(await createAssetUploadTicket("certificate", `${OTHER}/${OBJECT}.pdf`)).toEqual({
      ok: false,
      code: "assets.errors.invalidPath",
    });
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it("refuses a portfolio key that still carries an owner prefix — the superseded shape", async () => {
    expect(await createAssetUploadTicket("portfolio", `${OWNER}/${OBJECT}.png`)).toEqual({
      ok: false,
      code: "assets.errors.invalidPath",
    });
  });

  it("refuses an unauthenticated caller", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await createAssetUploadTicket("portfolio", PORTFOLIO_KEY)).toEqual({
      ok: false,
      code: "assets.errors.notAllowed",
    });
    expect(storageFrom).not.toHaveBeenCalled();
  });

  /**
   * The persona gate is NOT in this file, and this is the test that says so. The
   * refusal comes from the INSERT policy — `can_create_professional_asset` for a
   * certificate, `can_upload_portfolio_object` for a photo — so the action reaches
   * Storage, is told no, and translates it. The assertion is that the call
   * HAPPENED, because a version that reimplemented the gate here would still pass
   * an assertion about the return value alone.
   */
  it("lets the database refuse, and translates that refusal", async () => {
    createSignedUploadUrl.mockResolvedValue({
      data: null,
      error: { code: "AccessDenied", message: "new row violates row-level security policy" },
    });
    const r = await createAssetUploadTicket("portfolio", PORTFOLIO_KEY);
    expect(createSignedUploadUrl).toHaveBeenCalled();
    expect(r).toEqual({ ok: false, code: "assets.errors.notAllowed" });
  });

  it("never touches a table: this seam knows nothing about product records", async () => {
    await createAssetUploadTicket("portfolio", PORTFOLIO_KEY);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("createAssetReadUrl", () => {
  it("mints a short-lived URL for a portfolio object", async () => {
    const r = await createAssetReadUrl("portfolio", PORTFOLIO_KEY);
    expect(r).toEqual({ ok: true, url: "/object/sign/x?token=y", expiresIn: 300 });
    expect(createSignedUrl).toHaveBeenCalledWith(PORTFOLIO_KEY, 300);
  });

  it("refuses another owner's certificate without asking Storage — no existence probe", async () => {
    expect(await createAssetReadUrl("certificate", `${OTHER}/${OBJECT}.pdf`)).toEqual({
      ok: false,
      code: "assets.errors.invalidPath",
    });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("refuses a traversal path the same way", async () => {
    expect(await createAssetReadUrl("certificate", `${OWNER}/../${OTHER}/x.pdf`)).toEqual({
      ok: false,
      code: "assets.errors.invalidPath",
    });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  /**
   * For portfolio the shape check passes for ANY well-formed key, which is only
   * safe because it is not the boundary: `app.owns_portfolio_object` refuses a key
   * whose metadata row belongs to somebody else, and Storage answers NoSuchKey.
   */
  it("passes a well-formed portfolio key through and lets the policy decide", async () => {
    createSignedUrl.mockResolvedValue({
      data: null,
      error: { code: "NoSuchKey", message: "Object not found" },
    });
    expect(await createAssetReadUrl("portfolio", PORTFOLIO_KEY)).toEqual({
      ok: false,
      code: "assets.errors.gone",
    });
    expect(createSignedUrl).toHaveBeenCalled();
  });
});

describe("deleteProfessionalAsset", () => {
  it("removes exactly one named object", async () => {
    expect(await deleteProfessionalAsset("portfolio", PORTFOLIO_KEY)).toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith([PORTFOLIO_KEY]);
  });

  it("has no folder form: a bare owner segment is not an object", async () => {
    expect(await deleteProfessionalAsset("certificate", OWNER)).toEqual({
      ok: false,
      code: "assets.errors.invalidPath",
    });
    expect(await deleteProfessionalAsset("certificate", `${OWNER}/`)).toEqual({
      ok: false,
      code: "assets.errors.invalidPath",
    });
    expect(remove).not.toHaveBeenCalled();
  });

  /**
   * Idempotence, which the delete sequence depends on: marking the row deleted,
   * removing the object and purging the row are three steps in two systems, and a
   * retry after a partial failure has to converge rather than jam.
   */
  it("treats an already-deleted object as success", async () => {
    remove.mockResolvedValue({ data: null, error: { code: "NoSuchKey", message: "Object not found" } });
    expect(await deleteProfessionalAsset("portfolio", PORTFOLIO_KEY)).toEqual({ ok: true });
  });

  it("does not swallow a real refusal", async () => {
    remove.mockResolvedValue({ data: null, error: { code: "AccessDenied", message: "Access denied" } });
    expect(await deleteProfessionalAsset("portfolio", PORTFOLIO_KEY)).toEqual({
      ok: false,
      code: "assets.errors.notAllowed",
    });
  });

  it("refuses an unauthenticated caller", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await deleteProfessionalAsset("portfolio", PORTFOLIO_KEY)).toEqual({
      ok: false,
      code: "assets.errors.notAllowed",
    });
    expect(remove).not.toHaveBeenCalled();
  });
});

/**
 * The surface stayed at three even as the domain grew around it. In particular
 * there is still nothing here that records what an object MEANS — that belongs to
 * `server/actions/portfolio.ts`, which owns the metadata and calls these.
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
