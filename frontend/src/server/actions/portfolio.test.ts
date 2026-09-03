import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => ({ rpc }),
}));

const createAssetUploadTicket = vi.fn();
const deleteProfessionalAsset = vi.fn();
const createAssetReadUrl = vi.fn();
vi.mock("@/server/actions/professional-assets", () => ({
  createAssetUploadTicket: (...args: unknown[]) => createAssetUploadTicket(...args),
  deleteProfessionalAsset: (...args: unknown[]) => deleteProfessionalAsset(...args),
  createAssetReadUrl: (...args: unknown[]) => createAssetReadUrl(...args),
}));

import {
  deleteCertificateAction,
  deletePortfolioItemAction,
  finishPortfolioUpload,
  movePortfolioItemAction,
  setPortfolioVisibilityAction,
  startCertificateUpload,
  startPortfolioUpload,
  updatePortfolioItemAction,
} from "./portfolio";

const ITEM = "11111111-1111-4111-8111-111111111111";
const KEY = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.png";

const fd = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};

/** What each RPC name returned, in call order — the sequences are the subject. */
const calls = () => rpc.mock.calls.map((c) => c[0] as string);

beforeEach(() => {
  rpc.mockReset();
  createAssetUploadTicket.mockReset();
  deleteProfessionalAsset.mockReset();
  createAssetReadUrl.mockReset();
  rpc.mockResolvedValue({ data: [{ item_id: ITEM, object_key: KEY }], error: null });
  createAssetUploadTicket.mockResolvedValue({ ok: true, token: "t0k3n" });
  deleteProfessionalAsset.mockResolvedValue({ ok: true });
});

/**
 * The two sequences, and what each of them leaves behind when a step fails.
 *
 * These are the tests that matter in this file. Postgres and Storage share no
 * transaction, so correctness is not "every step succeeded" — it is "every
 * partial state is safe, invisible, and finished by running the same sequence
 * again". Each assertion below names one of those partial states.
 */
describe("startPortfolioUpload", () => {
  it("creates the metadata row FIRST, then asks for a ticket for the key it returned", async () => {
    const r = await startPortfolioUpload({
      title: "Marble staircase",
      description: null,
      contentType: "image/png",
      size: 1000,
    });
    expect(calls()).toEqual(["portfolio_item_create"]);
    expect(createAssetUploadTicket).toHaveBeenCalledWith("portfolio", KEY);
    expect(r).toEqual({
      ok: true,
      itemId: ITEM,
      bucket: "professional-portfolio",
      objectPath: KEY,
      token: "t0k3n",
    });
  });

  it("never sends a key of its own — the object identity comes from the database", async () => {
    await startPortfolioUpload({ title: "x", description: null, contentType: "image/png", size: 10 });
    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(Object.keys(args).sort()).toEqual(["p_content_type", "p_description", "p_title"]);
  });

  it("refuses an oversized or wrong-typed file before creating anything", async () => {
    expect(
      await startPortfolioUpload({ title: "x", description: null, contentType: "application/pdf", size: 10 }),
    ).toEqual({ ok: false, code: "assets.errors.unsupportedType" });
    expect(
      await startPortfolioUpload({ title: "x", description: null, contentType: "image/png", size: 9_000_000 }),
    ).toEqual({ ok: false, code: "assets.errors.tooLarge" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an empty title without creating a row", async () => {
    expect(
      await startPortfolioUpload({ title: "   ", description: null, contentType: "image/png", size: 10 }),
    ).toEqual({ ok: false, code: "portfolio.errors.titleRequired" });
    expect(rpc).not.toHaveBeenCalled();
  });

  /**
   * The one early exit that removes its own row. There are no bytes yet and no
   * way to upload any, so leaving it would show the owner an "unfinished upload"
   * card for an upload that never began.
   */
  it("cleans up its row when the ticket cannot be minted", async () => {
    createAssetUploadTicket.mockResolvedValue({ ok: false, code: "assets.errors.notAllowed" });
    const r = await startPortfolioUpload({
      title: "x", description: null, contentType: "image/png", size: 10,
    });
    expect(r).toEqual({ ok: false, code: "assets.errors.notAllowed" });
    expect(calls()).toEqual(["portfolio_item_create", "portfolio_item_delete", "portfolio_item_purge"]);
  });

  it("translates the persona refusal rather than surfacing a database string", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "a professional persona is required to add portfolio work" },
    });
    expect(
      await startPortfolioUpload({ title: "x", description: null, contentType: "image/png", size: 10 }),
    ).toEqual({ ok: false, code: "portfolio.errors.notProfessional" });
  });
});

describe("finishPortfolioUpload", () => {
  it("calls finalize and nothing else — publishing is a separate decision", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await finishPortfolioUpload(ITEM)).toEqual({ ok: true });
    expect(calls()).toEqual(["portfolio_item_finalize"]);
  });
});

describe("deletePortfolioItemAction", () => {
  /**
   * Order is the whole design: visibility stops in Postgres BEFORE Storage is
   * asked anything, so a failure after step one leaves an item nobody can see
   * rather than one that is half gone.
   */
  it("marks the row deleted, then removes the object, then purges the row", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await deletePortfolioItemAction({ ok: false }, fd({ itemId: ITEM, objectKey: KEY }));
    expect(r).toEqual({ ok: true });
    expect(calls()).toEqual(["portfolio_item_delete", "portfolio_item_purge"]);
    expect(deleteProfessionalAsset).toHaveBeenCalledWith("portfolio", KEY);
    // The object removal happens between the two RPCs, never before the first.
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(
      deleteProfessionalAsset.mock.invocationCallOrder[0]!,
    );
  });

  it("stops if the row could not be marked deleted — nothing is removed on a refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "portfolio item not found" } });
    expect(await deletePortfolioItemAction({ ok: false }, fd({ itemId: ITEM, objectKey: KEY }))).toEqual({
      ok: false,
      code: "portfolio.errors.notFound",
    });
    expect(deleteProfessionalAsset).not.toHaveBeenCalled();
  });

  /**
   * Cleanup failure is NOT a failed delete. The item is already gone as far as
   * every reader is concerned, and telling the person "could not delete" about
   * something they can no longer see would be the one genuinely confusing
   * outcome. The row stays `deleted` and the next attempt finishes the job.
   */
  it("still reports success when the object cannot be removed, and skips the purge", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    deleteProfessionalAsset.mockResolvedValue({ ok: false, code: "assets.errors.uploadFailed" });
    expect(await deletePortfolioItemAction({ ok: false }, fd({ itemId: ITEM, objectKey: KEY }))).toEqual({
      ok: true,
    });
    expect(calls()).toEqual(["portfolio_item_delete"]);
  });
});

describe("setPortfolioVisibilityAction", () => {
  it("posts the value it wants rather than a toggle instruction", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await setPortfolioVisibilityAction({ ok: false }, fd({ itemId: ITEM, public: "1" }));
    expect(rpc).toHaveBeenCalledWith("portfolio_item_set_visibility", {
      p_item_id: ITEM,
      p_public: true,
    });
    await setPortfolioVisibilityAction({ ok: false }, fd({ itemId: ITEM, public: "0" }));
    expect(rpc).toHaveBeenLastCalledWith("portfolio_item_set_visibility", {
      p_item_id: ITEM,
      p_public: false,
    });
  });

  it("explains a refusal to publish an unfinished item", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "an unfinished item cannot be published" },
    });
    expect(await setPortfolioVisibilityAction({ ok: false }, fd({ itemId: ITEM, public: "1" }))).toEqual({
      ok: false,
      code: "portfolio.errors.notReady",
    });
  });
});

describe("movePortfolioItemAction", () => {
  it("passes the direction straight through to the server-authoritative reorder", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await movePortfolioItemAction({ ok: false }, fd({ itemId: ITEM, direction: "up" }));
    expect(rpc).toHaveBeenCalledWith("portfolio_item_move", {
      p_item_id: ITEM,
      p_direction: "up",
    });
  });
});

describe("updatePortfolioItemAction", () => {
  it("refuses an empty title without calling anything", async () => {
    expect(await updatePortfolioItemAction({ ok: false }, fd({ itemId: ITEM, title: "  " }))).toEqual({
      ok: false,
      code: "portfolio.errors.titleRequired",
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("certificates", () => {
  it("creates the row first and asks for a ticket for the path it returned", async () => {
    rpc.mockResolvedValue({
      data: [{ item_id: ITEM, object_path: `${ITEM}/${KEY.replace(".png", ".pdf")}` }],
      error: null,
    });
    const r = await startCertificateUpload({
      title: "Safety level 2",
      issuer: null,
      issuedOn: null,
      expiresOn: null,
      contentType: "application/pdf",
      size: 1000,
      originalFilename: "safety.pdf",
    });
    expect(calls()).toEqual(["certificate_create"]);
    expect(r.ok).toBe(true);
    expect(r.ok && r.bucket).toBe("professional-certificates");
  });

  it("passes the display filename as METADATA, never as part of a key", async () => {
    rpc.mockResolvedValue({ data: [{ item_id: ITEM, object_path: `${ITEM}/x.pdf` }], error: null });
    await startCertificateUpload({
      title: "x", issuer: null, issuedOn: null, expiresOn: null,
      contentType: "application/pdf", size: 10, originalFilename: "../../etc/passwd",
    });
    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args.p_original_filename).toBe("../../etc/passwd");
    // The key it gets back is the server's, and the filename had no part in it.
    expect(createAssetUploadTicket).toHaveBeenCalledWith("certificate", `${ITEM}/x.pdf`);
  });

  it("removes the certificate through the same convergent sequence", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(
      await deleteCertificateAction({ ok: false }, fd({ itemId: ITEM, objectPath: `${ITEM}/x.pdf` })),
    ).toEqual({ ok: true });
    expect(calls()).toEqual(["certificate_delete", "certificate_purge"]);
  });

  it("names the one validation performed on the claim itself", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "23514", message: 'violates check constraint "ck_certificate_dates"' },
    });
    expect(
      await deleteCertificateAction({ ok: false }, fd({ itemId: ITEM, objectPath: `${ITEM}/x.pdf` })),
    ).toEqual({ ok: false, code: "certificates.errors.dateOrder" });
  });
});
