import { expect, type Page, type APIRequestContext } from "@playwright/test";

/** Seeded synthetic identities (from supabase/demo-seed.sql). Never production. */
export const IDENTITIES = {
  manager: "a-owner@example.test",
  branchLimited: "a-cairo@example.test",
} as const;

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

type MailpitMessage = { ID: string; To: Array<{ Address: string }> };

async function messagesFor(request: APIRequestContext, email: string): Promise<MailpitMessage[]> {
  const res = await request.get(`${MAILPIT}/api/v1/messages?limit=50`);
  if (!res.ok()) return [];
  const body = await res.json();
  const messages: MailpitMessage[] = body.messages ?? [];
  return messages.filter((m) => m.To?.some((t) => t.Address.toLowerCase() === email.toLowerCase()));
}

/** The set of message IDs currently in Mailpit for `email` (snapshot BEFORE sending). */
export async function messageIdsFor(request: APIRequestContext, email: string): Promise<Set<string>> {
  return new Set((await messagesFor(request, email)).map((m) => m.ID));
}

/**
 * Deterministically read the OTP from the message that arrived AFTER `seen` was
 * captured — never a stale code from a previous test. Exercises the REAL
 * passwordless path (no auth bypass): the app sends the code, Mailpit captures
 * it, and we extract the 6 digits from the newest genuinely-new message.
 */
export async function readNewOtp(
  request: APIRequestContext,
  email: string,
  seen: Set<string>,
): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const fresh = (await messagesFor(request, email)).filter((m) => !seen.has(m.ID));
    for (const m of fresh) {
      const full = await request.get(`${MAILPIT}/api/v1/message/${m.ID}`);
      if (!full.ok()) continue;
      const msg = await full.json();
      const code = `${msg.Text ?? ""} ${msg.HTML ?? ""}`.match(/\b(\d{6})\b/);
      if (code) return code[1]!;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No new OTP code arrived in Mailpit for ${email}`);
}

/** Sign in through the real Email-OTP flow and land on the B2B workspace. */
export async function signIn(page: Page, request: APIRequestContext, email: string): Promise<void> {
  // Snapshot existing messages BEFORE requesting a new code so we never reuse a
  // stale OTP from an earlier test/run.
  const seen = await messageIdsFor(request, email);

  await page.goto("/auth/sign-in");
  await page.getByLabel(/email|البريد/i).fill(email);
  await page.getByRole("button", { name: /send code|إرسال الرمز/i }).click();
  await expect(page.getByText(/we sent a code|أرسلنا رمزًا/i)).toBeVisible();

  const code = await readNewOtp(request, email, seen);
  await page.getByLabel(/one-time code|الرمز/i).fill(code);
  await page.getByRole("button", { name: /verify|تأكيد/i }).click();

  // Wait on the URL committing, not the full "load" event — under sustained
  // full-suite load the load event can lag far behind an interactive page.
  await page.waitForURL(/\/b2b(\/|$)/, { waitUntil: "commit" });
}
