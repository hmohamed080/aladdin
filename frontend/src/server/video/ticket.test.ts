import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import vectors from "../../../../edge/media-worker/test/video-ticket-vectors.json";
import { mintVideoTicket, type VideoTicketClaims } from "./ticket";

describe("video tickets", () => {
  it("are byte-identical to the Worker's shared vectors", () => {
    for (const v of vectors.valid) {
      const secret = Buffer.from(vectors.keys[v.kid as "k1"], "base64url");
      expect(mintVideoTicket(v.kid, secret, v.claims as VideoTicketClaims)).toBe(v.ticket);
    }
  });
});
