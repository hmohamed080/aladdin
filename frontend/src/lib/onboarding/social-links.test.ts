import { describe, expect, it } from "vitest";

import {
  normalizeSocialLink,
  normalizeSocialLinks,
  socialLinksError,
  type SocialPlatform,
} from "./social-links";

describe("normalizeSocialLink accepts", () => {
  const cases: Array<[SocialPlatform, string, string]> = [
    ["instagram", "@Aladdin.Shop", "https://www.instagram.com/Aladdin.Shop"],
    [
      "instagram",
      "instagram.com/aladdin.shop/?utm_source=x#top",
      "https://www.instagram.com/aladdin.shop",
    ],
    ["tiktok", "tiktok.com/@shop_1", "https://www.tiktok.com/@shop_1"],
    ["tiktok", "shop_1", "https://www.tiktok.com/@shop_1"],
    ["facebook", "fb.me/aladdin.shop", "https://www.facebook.com/aladdin.shop"],
    ["facebook", "aladdin.shop", "https://www.facebook.com/aladdin.shop"],
    [
      "facebook",
      "http://m.facebook.com/aladdin.shop/",
      "https://www.facebook.com/aladdin.shop",
    ],
    ["website", "Example.COM/path/?a=1", "https://example.com/path"],
    ["website", "https://www.example.com", "https://www.example.com"],
  ];
  it.each(cases)("%s %j -> %s", (platform, raw, url) => {
    expect(normalizeSocialLink(platform, raw)).toEqual({ ok: true, url });
  });

  it.each([[""], ["   "], [null], [undefined]])("blank %j -> null", (raw) => {
    expect(normalizeSocialLink("facebook", raw)).toEqual({ ok: true, url: null });
  });
});

describe("normalizeSocialLink rejects", () => {
  const cases: Array<[SocialPlatform, string, string]> = [
    ["website", "javascript:alert(1)", "unsafeScheme"],
    ["website", "data:text/html,x", "unsafeScheme"],
    ["website", "file:///etc/passwd", "unsafeScheme"],
    ["facebook", "https://facebook.com@evil.io/x", "wrongHost"],
    ["facebook", "https://evilfacebook.com/x", "wrongHost"],
    ["facebook", "https://facebook.com.evil.io/x", "wrongHost"],
    ["tiktok", "instagram.com/x", "wrongHost"],
    ["website", "http://127.0.0.1", "badHost"],
    ["website", "localhost", "badHost"],
    ["website", "[::1]", "badHost"],
    ["website", "shop.local", "badHost"],
    ["website", "shop.internal", "badHost"],
    ["website", "facebook.com:8080", "badHost"],
    ["facebook", "facebook.com:8080", "badHost"],
    ["website", "fаcebook.com", "badHost"],
    ["facebook", "fаcebook.com/page", "badHost"],
    ["website", "xn--fcebook-8va.com", "badHost"],
    ["website", `https://example.com/${"a".repeat(290)}`, "tooLong"],
    ["facebook", "a".repeat(301), "tooLong"],
    ["website", "a b", "invalid"],
    ["website", "example.com/a\nb", "invalid"],
    ["website", "example.com/a\tb", "invalid"],
    ["instagram", "a".repeat(31), "invalid"],
    ["tiktok", "a", "invalid"],
    ["facebook", "abcd", "invalid"],
  ];
  it.each(cases)("%s %j -> %s", (platform, raw, reason) => {
    expect(normalizeSocialLink(platform, raw)).toEqual({ ok: false, reason });
  });
});

describe("normalizeSocialLinks", () => {
  it("returns every platform, null when absent", () => {
    expect(normalizeSocialLinks({ tiktok: "shop_1" })).toEqual({
      ok: true,
      links: {
        facebook: null,
        instagram: null,
        tiktok: "https://www.tiktok.com/@shop_1",
        website: null,
      },
    });
  });

  it("reports the first invalid platform in platform order", () => {
    expect(
      normalizeSocialLinks({ website: "localhost", instagram: "a b" }),
    ).toEqual({ ok: false, platform: "instagram", reason: "invalid" });
  });
});

describe("socialLinksError", () => {
  it("requires at least one link", () => {
    expect(socialLinksError({})).toBe("onboarding.error.linksRequired");
    expect(socialLinksError({ facebook: "", website: null })).toBe(
      "onboarding.error.linksRequired",
    );
    expect(socialLinksError({ facebook: "   " })).toBe(
      "onboarding.error.linksRequired",
    );
  });
  it("passes with one valid link", () => {
    expect(socialLinksError({ instagram: "@aladdin.shop" })).toBeNull();
  });
  it("invalid wins over valid", () => {
    expect(
      socialLinksError({ instagram: "@aladdin.shop", website: "localhost" }),
    ).toBe("onboarding.error.linkInvalid");
  });
});
