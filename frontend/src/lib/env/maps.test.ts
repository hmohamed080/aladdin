import { describe, expect, it } from "vitest";
import { parseMapsConfig } from "./maps";

const KEY = "AIzaSyExampleExampleExampleExample123";

describe("parseMapsConfig", () => {
  it("is off by default", () => {
    expect(parseMapsConfig({ provider: undefined, googleKey: undefined })).toEqual({ provider: "none" });
  });
  it("needs both the switch and a well-formed key", () => {
    expect(parseMapsConfig({ provider: "google", googleKey: undefined })).toEqual({ provider: "none" });
    expect(parseMapsConfig({ provider: "google", googleKey: "" })).toEqual({ provider: "none" });
    expect(parseMapsConfig({ provider: "google", googleKey: "short" })).toEqual({ provider: "none" });
    expect(parseMapsConfig({ provider: "google", googleKey: "has spaces and symbols !!!!!!!!!!!!" })).toEqual({ provider: "none" });
    expect(parseMapsConfig({ provider: undefined, googleKey: KEY })).toEqual({ provider: "none" });
    expect(parseMapsConfig({ provider: "GOOGLE", googleKey: KEY })).toEqual({ provider: "none" });
  });
  it("turns Google on only for the exact switch value and a plausible key", () => {
    expect(parseMapsConfig({ provider: "google", googleKey: ` ${KEY} ` })).toEqual({ provider: "google", apiKey: KEY });
  });
});
