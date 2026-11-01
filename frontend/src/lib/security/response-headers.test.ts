import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import { SECURITY_HEADERS, VIEW_AS_HEADERS } from "./response-headers";

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

  it("keep Admin View-As responses private, unindexed and referrer-free", async () => {
    const rules = await nextConfig.headers!();
    const viewAs = rules.filter((rule) => rule.source.startsWith("/admin/users/:id/view"));
    expect(viewAs.length).toBeGreaterThan(0);
    for (const rule of viewAs) expect(rule.headers).toEqual(VIEW_AS_HEADERS);
    expect(Object.fromEntries(VIEW_AS_HEADERS.map(({ key, value }) => [key.toLowerCase(), value]))).toEqual({
      "cache-control": "private, no-store, max-age=0",
      pragma: "no-cache",
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "no-referrer",
    });
  });
});
