import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { clientIpFrom, turnstileHostnamesFrom } from "@/server/auth/turnstile";
import { withPlatformForwardedHeaders } from "./forwarded-headers";

describe("trusted forwarding headers (Cloudflare frontend)", () => {
  it("replaces client-sent IP and host headers with what Cloudflare guarantees", () => {
    const spoofed = new Request("https://aladdindecore.com/installer/sign-in", {
      headers: {
        "cf-connecting-ip": "198.51.100.7",
        "x-vercel-forwarded-for": "203.0.113.1",
        // Cloudflare appends the real address to a client's own list.
        "x-forwarded-for": "203.0.113.1, 198.51.100.7",
        "x-real-ip": "203.0.113.1",
        "x-forwarded-host": "attacker.example",
        "x-forwarded-proto": "http",
      },
    });
    const sent = withPlatformForwardedHeaders(spoofed);
    expect(sent.headers.get("x-vercel-forwarded-for")).toBe("198.51.100.7");
    expect(sent.headers.get("x-forwarded-for")).toBe("198.51.100.7");
    expect(sent.headers.get("x-real-ip")).toBe("198.51.100.7");
    expect(sent.headers.get("x-forwarded-host")).toBe("aladdindecore.com");
    expect(sent.headers.get("x-forwarded-proto")).toBe("https");
    // What the app's readers then see.
    expect(clientIpFrom((name) => sent.headers.get(name))).toBe("198.51.100.7");
    expect(clientIpFrom((name) => (name === "x-forwarded-for" ? sent.headers.get("x-vercel-forwarded-for") : null))).toBe("198.51.100.7");
    expect(turnstileHostnamesFrom((name) => sent.headers.get(name))).toEqual(["aladdindecore.com"]);
  });

  it("drops client-sent IP headers when Cloudflare supplied no address", () => {
    const sent = withPlatformForwardedHeaders(new Request("http://127.0.0.1:8787/", {
      headers: { "x-vercel-forwarded-for": "203.0.113.1", "x-forwarded-for": "203.0.113.1", "x-real-ip": "203.0.113.1" },
    }));
    expect(sent.headers.get("x-vercel-forwarded-for")).toBeNull();
    expect(sent.headers.get("x-forwarded-for")).toBeNull();
    expect(sent.headers.get("x-real-ip")).toBeNull();
    expect(sent.headers.get("x-forwarded-host")).toBe("127.0.0.1:8787");
    expect(sent.headers.get("x-forwarded-proto")).toBe("http");
  });

  it("keeps method, URL, other headers and the body", async () => {
    const sent = withPlatformForwardedHeaders(new Request("https://aladdindecore.com/auth/sign-up?x=1", {
      method: "POST",
      headers: { "cf-connecting-ip": "198.51.100.7", cookie: "sb=1", "content-type": "text/plain" },
      body: "payload",
    }));
    expect(sent.method).toBe("POST");
    expect(sent.url).toBe("https://aladdindecore.com/auth/sign-up?x=1");
    expect(sent.headers.get("cookie")).toBe("sb=1");
    expect(await sent.text()).toBe("payload");
  });
});
