import { describe, expect, it } from "vitest";
import { formatEgp } from "./egp-format";

describe("EGP money is exact", () => {
  it("drops an unnecessary .00 and keeps a real fraction", () => {
    expect(formatEgp(4500, "en")).toBe("4,500 EGP");
    expect(formatEgp(4500.0, "en")).toBe("4,500 EGP");
    expect(formatEgp(4500.5, "en")).toBe("4,500.50 EGP");
    expect(formatEgp(4500.25, "en")).toBe("4,500.25 EGP");
  });

  it("never rounds 4500.50 up to 4501", () => {
    expect(formatEgp(4500.5, "en")).not.toContain("4,501");
  });

  it("formats Arabic with Arabic-Indic digits and the same fraction rule", () => {
    expect(formatEgp(4500, "ar")).toBe("٤٬٥٠٠ جنيه");
    expect(formatEgp(4500.5, "ar")).toBe("٤٬٥٠٠٫٥٠ جنيه");
  });

});
