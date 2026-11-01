import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const env = vi.hoisted(() => ({ whatsapp: {} as Record<string, string | undefined>, appEnv: "staging" }));
vi.mock("@/lib/env", () => ({ readWhatsAppEnv: () => env.whatsapp, readPublicEnv: () => ({ NEXT_PUBLIC_APP_ENV: env.appEnv }) }));

import { sendWhatsAppCode } from "./whatsapp-otp";

const configured = { WHATSAPP_ACCESS_TOKEN: "token", WHATSAPP_PHONE_NUMBER_ID: "1234567890", WHATSAPP_OTP_TEMPLATE: "aladdin_login_code" };
const reply = (status: number, body: unknown = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  env.whatsapp = { ...configured };
  env.appEnv = "staging";
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("sendWhatsAppCode", () => {
  it("sends the approved authentication template with the code in the body and the copy-code button", async () => {
    const fetcher = reply(200, { messages: [{ id: "wamid" }] });
    expect(await sendWhatsAppCode("+201012345678", "123456", "ar", fetcher as never)).toBe("sent");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v21.0/1234567890/messages");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token");
    expect(JSON.parse(String(init.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "201012345678",
      type: "template",
      template: {
        name: "aladdin_login_code",
        language: { code: "ar" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "123456" }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "123456" }] },
        ],
      },
    });
  });

  it("fails closed when it is not configured outside local development", async () => {
    env.whatsapp = {};
    const fetcher = reply(200);
    expect(await sendWhatsAppCode("+201012345678", "123456", "en", fetcher as never)).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("prints the code locally instead of sending it when there is no token", async () => {
    env.whatsapp = {};
    env.appEnv = "local";
    expect(await sendWhatsAppCode("+201012345678", "123456", "en", reply(200) as never)).toBe("sent");
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("123456"));
  });

  it("tells an unreachable number apart from a configuration problem, and never logs the code", async () => {
    expect(await sendWhatsAppCode("+201012345678", "123456", "en", reply(400, { error: { code: 131026 } }) as never)).toBe("invalid_number");
    expect(await sendWhatsAppCode("+201012345678", "123456", "en", reply(401, { error: { code: 190 } }) as never)).toBe("unavailable");
    expect(await sendWhatsAppCode("+201012345678", "123456", "en", reply(500) as never)).toBe("failed");
    expect(await sendWhatsAppCode("+201012345678", "123456", "en", vi.fn(async () => { throw Error("down"); }) as never)).toBe("failed");
    for (const [message] of vi.mocked(console.error).mock.calls) {
      expect(String(message)).not.toContain("123456");
      expect(String(message)).not.toContain("201012345678");
    }
  });
});
