import { expect, type Page, type APIRequestContext } from "@playwright/test";

/** Seeded synthetic identities (from supabase/demo-seed.sql). Never production. */
export const IDENTITIES = {
  manager: "a-owner@example.test",
  branchLimited: "a-cairo@example.test",
} as const;

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

/**
 * Read the latest Email-OTP code delivered to `email` from the local Mailpit
 * inbox. This exercises the REAL passwordless path (no test-only auth bypass):
 * the app sends the code, Mailpit captures it, and we extract the 6 digits.
 */
export async function readLatestOtp(request: APIRequestContext, email: string): Promise<string> {
  // Poll briefly — delivery to Mailpit is near-instant but not synchronous.
  for (let attempt = 0; attempt < 20; attempt++) {
    const list = await request.get(`${MAILPIT}/api/v1/messages?limit=20`);
    if (list.ok()) {
      const body = await list.json();
      const messages: Array<{ ID: string; To: Array<{ Address: string }> }> = body.messages ?? [];
      const match = messages.find((m) => m.To?.some((t) => t.Address.toLowerCase() === email.toLowerCase()));
      if (match) {
        const full = await request.get(`${MAILPIT}/api/v1/message/${match.ID}`);
        const msg = await full.json();
        const text: string = `${msg.Text ?? ""} ${msg.HTML ?? ""}`;
        const code = text.match(/\b(\d{6})\b/);
        if (code) return code[1]!;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No OTP code found in Mailpit for ${email}`);
}

/** Sign in through the real Email-OTP flow and land on the B2B workspace. */
export async function signIn(page: Page, request: APIRequestContext, email: string): Promise<void> {
  await page.goto("/auth/sign-in");
  await page.getByLabel(/email|البريد/i).fill(email);
  await page.getByRole("button", { name: /send code|إرسال الرمز/i }).click();
  await expect(page.getByText(/we sent a code|أرسلنا رمزًا/i)).toBeVisible();

  const code = await readLatestOtp(request, email);
  await page.getByLabel(/one-time code|الرمز/i).fill(code);
  await page.getByRole("button", { name: /verify|تأكيد/i }).click();

  await page.waitForURL(/\/b2b(\/|$)/);
}
