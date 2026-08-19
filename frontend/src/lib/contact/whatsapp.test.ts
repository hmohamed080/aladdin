import { describe, expect, it } from "vitest";
import { whatsappShareUrl } from "./whatsapp";
import { toE164 } from "./phone";

describe("whatsappShareUrl", () => {
  it("addresses the normalized number with digits only", () => {
    const url = whatsappShareUrl({ phone: toE164("01002003040"), message: "hi" });
    // wa.me rejects a leading + or any punctuation in the number segment.
    expect(url.startsWith("https://wa.me/201002003040?text=")).toBe(true);
  });

  it("keeps the invitation URL intact through encoding", () => {
    const inviteUrl = "https://app.example.test/auth/invite/tok_en-123?x=1&y=2";
    const url = whatsappShareUrl({ phone: "+201002003040", message: `join\n${inviteUrl}` });
    const text = new URL(url).searchParams.get("text");
    // The message's own ?/&/= must not become wa.me query structure.
    expect(text).toBe(`join\n${inviteUrl}`);
  });

  it("encodes newlines rather than dropping the line breaks", () => {
    const url = whatsappShareUrl({ phone: null, message: "one\ntwo" });
    expect(url).toContain("%0A");
  });

  it("falls back to WhatsApp's contact picker when there is no usable number", () => {
    // Better than an error: the manager still gets the prepared message.
    expect(whatsappShareUrl({ phone: "", message: "hi" })).toBe("https://wa.me/?text=hi");
    expect(whatsappShareUrl({ message: "hi" })).toBe("https://wa.me/?text=hi");
  });
});
