import { describe, expect, it } from "vitest";
import { describeUserAgent, deviceLabel, maskIp } from "./user-agent";

const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const EDGE_WIN = `${CHROME_WIN} Edg/126.0.0.0`;
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const CHROME_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0";

describe("describeUserAgent", () => {
  it("recognizes the common browser and system pairs", () => {
    expect(describeUserAgent(CHROME_WIN)).toEqual({ browser: "Chrome", os: "Windows", mobile: false });
    expect(describeUserAgent(SAFARI_IPHONE)).toEqual({ browser: "Safari", os: "iOS", mobile: true });
    expect(describeUserAgent(CHROME_ANDROID)).toEqual({ browser: "Chrome", os: "Android", mobile: true });
    expect(describeUserAgent(FIREFOX_LINUX)).toEqual({ browser: "Firefox", os: "Linux", mobile: false });
  });

  it("tells Edge apart from Chrome even though it says both", () => {
    expect(describeUserAgent(EDGE_WIN).browser).toBe("Edge");
  });

  it("returns nulls for scripts and empty values", () => {
    expect(describeUserAgent("node")).toEqual({ browser: null, os: null, mobile: false });
    expect(describeUserAgent(null)).toEqual({ browser: null, os: null, mobile: false });
  });
});

describe("deviceLabel", () => {
  it("joins browser and system, degrading to whatever is known", () => {
    expect(deviceLabel(CHROME_WIN, "on", "Unknown device")).toBe("Chrome on Windows");
    expect(deviceLabel("Safari/605", "on", "Unknown device")).toBe("Safari");
    expect(deviceLabel("curl/8", "on", "Unknown device")).toBe("Unknown device");
  });
});

describe("maskIp", () => {
  it("hides the last part of an address", () => {
    expect(maskIp("203.0.113.45")).toBe("203.0.113.•");
    expect(maskIp("2001:db8:85a3::8a2e")).toBe("2001:db8:•");
    expect(maskIp(null)).toBeNull();
    expect(maskIp("::1")).toBeNull();
    expect(maskIp("127.0.0.1")).toBeNull();
    expect(maskIp("junk")).toBeNull();
  });
});
