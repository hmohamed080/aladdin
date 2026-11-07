import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ rpc: state.rpc }) }));
const media = vi.hoisted(() => ({ authorize: vi.fn(), verify: vi.fn(), remove: vi.fn() }));
vi.mock("@/server/storage/media", () => ({ authorizeMediaUpload: media.authorize, verifyPendingMedia: media.verify, removeMedia: media.remove }));
import { confirmBvUploadAction, removeBvDocumentAction, requestBvUploadAction } from "./business-verification";

const ORG = "9c000000-cccc-4ccc-8ccc-000000000001";
const DOC = "5bc41c1a-0000-4000-8000-0000000000aa";
const KEY = `${ORG}/${DOC}.pdf`;
const GRANT = { provider: "r2", url: "https://r2.test/pending", headers: {}, expiresIn: 120 };
const input = { orgId: ORG, docType: "tax_card", contentType: "application/pdf", sizeBytes: 5000, fileName: "tax.pdf" };

beforeEach(() => {
  vi.clearAllMocks();
  media.authorize.mockResolvedValue(GRANT); media.verify.mockResolvedValue(null); media.remove.mockResolvedValue(undefined);
});

describe("verification document storage", () => {
  it("reserves the draft row, then gets the central storage grant for exactly that key and size", async () => {
    state.rpc.mockResolvedValue({ data: KEY, error: null });
    expect(await requestBvUploadAction(input)).toEqual({ ok: true, key: KEY, grant: GRANT });
    expect(media.authorize).toHaveBeenCalledWith(expect.anything(), "verification", KEY, 5000);
  });
  it("refuses a bad type or size before the database or storage is touched", async () => {
    expect((await requestBvUploadAction({ ...input, contentType: "image/gif" })).ok).toBe(false);
    expect((await requestBvUploadAction({ ...input, sizeBytes: 11 * 1024 * 1024 })).ok).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled(); expect(media.authorize).not.toHaveBeenCalled();
  });
  it("fails the upload, with no fallback store, when the storage provider is unavailable", async () => {
    state.rpc.mockResolvedValue({ data: KEY, error: null });
    media.authorize.mockRejectedValue(new Error("R2 unavailable"));
    expect(await requestBvUploadAction(input)).toEqual({ ok: false, code: "businessVerification.errors.upload" });
  });
  it("confirms only after the stored bytes were verified by the central system", async () => {
    state.rpc.mockResolvedValue({ data: DOC, error: null });
    expect(await confirmBvUploadAction(KEY)).toEqual({ ok: true });
    expect(media.verify).toHaveBeenCalledWith(expect.anything(), "verification", KEY);
    state.rpc.mockClear(); media.verify.mockRejectedValue(new Error("bad bytes"));
    expect((await confirmBvUploadAction(KEY)).ok).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("removes a draft through the RPC and then deletes its bytes", async () => {
    state.rpc.mockResolvedValue({ data: KEY, error: null });
    expect(await removeBvDocumentAction(DOC)).toEqual({ ok: true });
    expect(media.remove).toHaveBeenCalledWith(expect.anything(), "verification", KEY);
  });
  it("never deletes bytes of submitted evidence: the RPC refuses first", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "submitted verification evidence is immutable" } });
    expect((await removeBvDocumentAction(DOC)).ok).toBe(false);
    expect(media.remove).not.toHaveBeenCalled();
  });
  it("reports a failed byte delete so it can be retried", async () => {
    state.rpc.mockResolvedValue({ data: KEY, error: null });
    media.remove.mockRejectedValue(new Error("R2 unavailable"));
    expect((await removeBvDocumentAction(DOC)).ok).toBe(false);
  });
});
