import { describe, expect, it } from "vitest";
import { liveCopy } from "./live-copy";
import { deliveryCopy } from "./live-delivery-copy";

describe("product counts", () => {
  it("uses the singular for one product in English", () => {
    for (const count of [liveCopy.en.results, deliveryCopy.en.storeProducts]) {
      expect(count("1")).toBe("1 product");
      expect(count("0")).toBe("0 products");
      expect(count("11")).toBe("11 products");
    }
  });
});
