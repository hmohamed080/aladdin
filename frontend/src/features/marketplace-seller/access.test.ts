import { describe, expect, it } from "vitest";
import { sellerPageAccess } from "./access";

describe("sellerPageAccess", () => {
  it("lets only an approved seller in", () => {
    expect(sellerPageAccess("approved")).toBe("allow");
  });

  it("explains, rather than hides, a pending, suspended, rejected or revoked seller's standing", () => {
    expect(sellerPageAccess("pending")).toBe("notice");
    expect(sellerPageAccess("suspended")).toBe("notice");
    expect(sellerPageAccess("rejected")).toBe("notice");
    // revoked is no longer terminal: an admin can approve the organization again
    expect(sellerPageAccess("revoked")).toBe("notice");
  });

  it("treats never-enabled and preview-closed organizations as no such page", () => {
    expect(sellerPageAccess(null)).toBe("not-found");
  });
});
