import { describe, expect, it } from "vitest";
import { isRefreshableMediaUrl, refreshMediaUrl } from "./refresh-url";

describe("media URL refresh", () => {
  it("recognises edge ticket URLs only", () => {
    expect(isRefreshableMediaUrl("https://media.example/m/avatar/thumb?t=k.p.m")).toBe(true);
    expect(isRefreshableMediaUrl("/api/media/avatar?key=x")).toBe(false);
    expect(isRefreshableMediaUrl("https://x.supabase.co/storage/v1/object/sign/a/b?token=1")).toBe(false);
  });
  it("never calls the server for a URL that cannot expire", async () => {
    expect(await refreshMediaUrl("/api/media/avatar?key=x")).toBeNull();
  });
});
