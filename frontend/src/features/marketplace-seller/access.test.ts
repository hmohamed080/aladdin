import { describe, expect, it } from "vitest";
import { sellerPageAccess } from "./access";

describe("sellerPageAccess", () => {
  it("lets only an approved seller in", () => {
    expect(sellerPageAccess("approved")).toBe("allow");
  });

  it("explains, rather than hides, a pending or suspended seller's standing", () => {
    expect(sellerPageAccess("pending")).toBe("notice");
    expect(sellerPageAccess("suspended")).toBe("notice");
  });

  it("treats never-enabled, revoked and preview-closed organizations as no such page", () => {
    expect(sellerPageAccess(null)).toBe("not-found");
    expect(sellerPageAccess("revoked")).toBe("not-found");
  });
});
