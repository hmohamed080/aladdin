import { describe, expect, it } from "vitest";
import { variantObjectKey } from "./image-variants";

const ID = "30000000-0000-4000-8000-000000000003";
describe("variant object keys", () => {
  it("keeps the legacy layout for legacy keys, so existing variants stay valid", () => {
    expect(variantObjectKey(`portfolio/${ID}.png`, "card")).toBe(`v/portfolio/${ID}.png/card.webp`);
    expect(variantObjectKey(`product/o/p/${ID}.webp`, "thumb")).toBe(`v/product/o/p/${ID}.webp/thumb.webp`);
  });
  it("puts variants of an ids-only key in the original's folder", () => {
    expect(variantObjectKey(`u/${ID}/portfolio/${ID}/original.png`, "full")).toBe(`u/${ID}/portfolio/${ID}/v/full.webp`);
    expect(variantObjectKey(`o/${ID}/profile/${ID}/original.jpg`, "thumb")).toBe(`o/${ID}/profile/${ID}/v/thumb.webp`);
  });
});
