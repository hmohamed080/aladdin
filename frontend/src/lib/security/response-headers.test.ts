import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import { SECURITY_HEADERS } from "./response-headers";

describe("baseline security headers", () => {
  it("are sent on every route by next.config", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((rule) => rule.source === "/:path*");
    expect(all?.headers).toEqual(SECURITY_HEADERS);
    expect(Object.fromEntries(SECURITY_HEADERS.map(({ key, value }) => [key.toLowerCase(), value]))).toEqual({
      "x-frame-options": "SAMEORIGIN",
      "x-content-type-options": "nosniff",
    });
  });
});
