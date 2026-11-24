import { describe, expect, it } from "vitest";
import { requestDeviceLocation } from "./device-location";

const ok = (lat: number, lng: number) => ({
  getCurrentPosition: (success: PositionCallback) => success({ coords: { latitude: lat, longitude: lng } } as GeolocationPosition),
});
const fail = (code: number) => ({
  getCurrentPosition: (_s: PositionCallback, error?: PositionErrorCallback | null) => error?.({ code } as GeolocationPositionError),
});

describe("requestDeviceLocation", () => {
  it("returns the position rounded to six decimals", async () => {
    expect(await requestDeviceLocation(ok(30.0444201234, 31.2357119))).toEqual({ ok: true, lat: "30.044420", lng: "31.235712" });
  });
  it("maps every failure to a reason the form can word", async () => {
    expect(await requestDeviceLocation(fail(1))).toEqual({ ok: false, reason: "denied" });
    expect(await requestDeviceLocation(fail(2))).toEqual({ ok: false, reason: "unavailable" });
    expect(await requestDeviceLocation(fail(3))).toEqual({ ok: false, reason: "timeout" });
    expect(await requestDeviceLocation(undefined)).toEqual({ ok: false, reason: "unsupported" });
  });
  it("refuses a position outside Egypt and a non-finite one", async () => {
    expect(await requestDeviceLocation(ok(48.85, 2.35))).toEqual({ ok: false, reason: "outside_egypt" });
    expect(await requestDeviceLocation(ok(Number.NaN, 31))).toEqual({ ok: false, reason: "unavailable" });
  });
});
