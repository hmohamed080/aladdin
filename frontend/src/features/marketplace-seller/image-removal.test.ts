import { describe, expect, it, vi } from "vitest";
import { removeImageLifecycle, type RemovalDeps } from "./image-removal";

const KEY = "org/product/image.png";

function deps(over: Partial<RemovalDeps> = {}): RemovalDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    mark: vi.fn(async () => {
      calls.push("mark");
      return { key: KEY };
    }),
    deleteObject: vi.fn(async () => {
      calls.push("delete");
      return {};
    }),
    finalize: vi.fn(async () => {
      calls.push("finalize");
      return { ok: true as const };
    }),
    ...over,
  };
}

describe("removeImageLifecycle", () => {
  it("marks, deletes the bytes, then finalizes — in that order", async () => {
    const d = deps();
    expect(await removeImageLifecycle(d, "img")).toEqual({ ok: true, alreadyRemoved: false });
    expect(d.calls).toEqual(["mark", "delete", "finalize"]);
    expect(d.deleteObject).toHaveBeenCalledWith(KEY);
  });

  it("never finalizes (never reports success) when the Storage delete fails", async () => {
    const d = deps({ deleteObject: vi.fn(async () => ({ error: "Access denied" })) });
    expect(await removeImageLifecycle(d, "img")).toEqual({ ok: false, code: "delete_incomplete", stage: "delete" });
    expect(d.finalize).not.toHaveBeenCalled();
  });

  it("does not trust a 'successful' delete the database cannot confirm", async () => {
    // Storage answers 200 with nothing deleted (e.g. a policy filtered the row): finalize sees the bytes.
    const d = deps({ finalize: vi.fn(async () => ({ error: "object_still_present" })) });
    expect(await removeImageLifecycle(d, "img")).toEqual({ ok: false, code: "delete_incomplete", stage: "finalize" });
  });

  it("stops at the first refusal and surfaces its code (cross-tenant, no authority, suspended seller)", async () => {
    for (const code of ["not_permitted", "seller_not_enabled", "auth_required"]) {
      const d = deps({ mark: vi.fn(async () => ({ error: code })) });
      expect(await removeImageLifecycle(d, "img")).toEqual({ ok: false, code, stage: "mark" });
      expect(d.deleteObject).not.toHaveBeenCalled();
      expect(d.finalize).not.toHaveBeenCalled();
    }
  });

  it("retry after a partial failure resumes and completes (mark is idempotent)", async () => {
    let failDelete = true;
    const d = deps({
      deleteObject: vi.fn(async () => (failDelete ? { error: "network" } : {})),
    });
    expect((await removeImageLifecycle(d, "img")).ok).toBe(false);
    failDelete = false;
    expect(await removeImageLifecycle(d, "img")).toEqual({ ok: true, alreadyRemoved: false });
    expect(d.mark).toHaveBeenCalledTimes(2);
    expect(d.finalize).toHaveBeenCalledTimes(1);
  });

  it("a repeated removal after completion is a clean success, not an error", async () => {
    const d = deps({ mark: vi.fn(async () => ({ error: "not_found" })) });
    expect(await removeImageLifecycle(d, "img")).toEqual({ ok: true, alreadyRemoved: true });
    expect(d.deleteObject).not.toHaveBeenCalled();
  });

  it("a lost finalize response (row already forgotten) is success too", async () => {
    const d = deps({ finalize: vi.fn(async () => ({ error: "not_found" })) });
    expect(await removeImageLifecycle(d, "img")).toEqual({ ok: true, alreadyRemoved: true });
  });
});
