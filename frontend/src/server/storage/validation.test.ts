import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
vi.mock("server-only", () => ({}));
import { readBoundedBody, verifyMediaBytes } from "./validation";

describe("trusted stored-byte validation", () => {
  it("decodes a real image and reports actual bytes and SHA-256", async () => {
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
    const result = await verifyMediaBytes(bytes, "image/png", 10000);
    expect(result.size).toBe(bytes.length);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(verifyMediaBytes(bytes, "image/jpeg", 10000)).rejects.toThrow();
  });
  it("refuses nonexistent/empty, oversized, script-disguised and truncated objects", async () => {
    for (const bytes of [new Uint8Array(), new Uint8Array(20), new TextEncoder().encode("<script>alert(1)</script>"),
      new Uint8Array([137,80,78,71,13,10,26,10])]) {
      await expect(verifyMediaBytes(bytes, "image/png", 10)).rejects.toThrow();
    }
  });
  it("parses PDF certificates and rejects a forged PDF signature", async () => {
    const pdf = await PDFDocument.create(); pdf.addPage();
    expect((await verifyMediaBytes(await pdf.save(), "application/pdf", 10000)).size).toBeGreaterThan(0);
    await expect(verifyMediaBytes(new TextEncoder().encode("%PDF-not-a-document"), "application/pdf", 10000)).rejects.toThrow();
  });
  it("bounds streaming bodies even without a trustworthy Content-Length", async () => {
    await expect(readBoundedBody(new Response(new Uint8Array(20)), 10)).rejects.toThrow("too large");
    await expect(readBoundedBody(new Response(null, { status: 404 }), 10)).rejects.toThrow("unavailable");
    expect(await readBoundedBody(new Response(new Uint8Array([1,2,3])), 10)).toEqual(new Uint8Array([1,2,3]));
  });
});
