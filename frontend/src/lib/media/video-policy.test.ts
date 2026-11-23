import { describe, expect, it } from "vitest";
import { videoLimitPlace } from "./video-policy";

describe("videoLimitPlace", () => {
  it("makes a Marketplace video follow the admin-configurable product limit", () => {
    expect(videoLimitPlace("marketplace")).toBe("product");
    expect(videoLimitPlace("product")).toBe("product");
    expect(videoLimitPlace("portfolio")).toBe("portfolio");
  });
});
