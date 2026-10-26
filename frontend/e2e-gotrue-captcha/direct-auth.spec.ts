import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * Can someone skip the app and call Supabase Auth directly with the public key? ADR-0023.
 *
 * Every request here goes straight to the local stack's /auth/v1, with the anon key only - exactly what anyone holding
 * the public key can do. The stack runs with Supabase Auth's CAPTCHA protection ON (scripts/ci/enable-gotrue-captcha.sh)
 * and one of Cloudflare's public TEST secrets, named by E2E_GOTRUE_CAPTCHA:
 *   pass   1x secret: Cloudflare accepts ANY token (observed in CI's preflight: a made-up token answers success:true).
 *          Proves a missing token is refused and a token Cloudflare accepts gets past the check to normal processing.
 *   fail   2x secret: Cloudflare rejects every token. Proves a token Cloudflare rejects - a made-up or invalid one,
 *          as a real secret answers for it - is refused.
 *   spent  3x secret: Cloudflare answers "token already spent". Proves a replayed or expired token is refused - this is
 *          the closest a test key gets to a real replay; a real one is only observable with real keys.
 * Supabase Auth does not check the token's hostname or action; that is the Turnstile widget's hostname allowlist.
 */

const MODE = process.env.E2E_GOTRUE_CAPTCHA;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
/** What Cloudflare's test site keys mint; the only token the 1x test secret accepts. */
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

test.skip(!MODE || !URL || !ANON, "needs E2E_GOTRUE_CAPTCHA, NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (MODE && !["pass", "fail", "spent"].includes(MODE)) throw new Error("E2E_GOTRUE_CAPTCHA must be pass, fail or spent");

const email = (tag: string) => `captcha-direct-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
const PASSWORD = "Direct-call-Pw-9472!";

/** Every operation Supabase Auth protects with CAPTCHA, as the public API takes it. */
const OPERATIONS: ReadonlyArray<{ name: string; path: string; body: (tag: string) => Record<string, unknown> }> = [
  { name: "password sign in", path: "/auth/v1/token?grant_type=password", body: (t) => ({ email: email(t), password: PASSWORD }) },
  { name: "sign up", path: "/auth/v1/signup", body: (t) => ({ email: email(t), password: PASSWORD }) },
  { name: "email code", path: "/auth/v1/otp", body: (t) => ({ email: email(t), create_user: false }) },
  { name: "password recovery", path: "/auth/v1/recover", body: (t) => ({ email: email(t) }) },
  { name: "resend sign-up code", path: "/auth/v1/resend", body: (t) => ({ type: "signup", email: email(t) }) },
];

async function call(request: APIRequestContext, path: string, body: Record<string, unknown>, token?: string) {
  const data = token === undefined ? body : { ...body, gotrue_meta_security: { captcha_token: token } };
  const res = await request.post(`${URL}${path}`, { headers: { apikey: ANON!, "content-type": "application/json" }, data });
  const json = (await res.json().catch(() => ({}))) as { error_code?: string; code?: string | number; msg?: string };
  return { status: res.status(), errorCode: json.error_code ?? (typeof json.code === "string" ? json.code : undefined), msg: json.msg ?? "" };
}

function expectCaptchaRefused(result: { status: number; errorCode?: string; msg: string }) {
  expect(result.status, JSON.stringify(result)).toBe(400);
  expect(result.errorCode === "captcha_failed" || /captcha protection/i.test(result.msg), JSON.stringify(result)).toBe(true);
}

for (const op of OPERATIONS) {
  test.describe(`direct ${op.name}`, () => {
    test("is refused with no CAPTCHA token", async ({ request }) => {
      expectCaptchaRefused(await call(request, op.path, op.body("none")));
    });

    if (MODE === "pass") {
      test("gets past the CAPTCHA check with a genuine token", async ({ request }) => {
        const result = await call(request, op.path, op.body("genuine"), DUMMY_TOKEN);
        expect(result.errorCode, JSON.stringify(result)).not.toBe("captcha_failed");
        expect(result.msg, JSON.stringify(result)).not.toMatch(/captcha protection/i);
        expect(result.status, JSON.stringify(result)).toBeLessThan(500);
      });
    } else {
      test(`is refused when Cloudflare answers ${MODE === "fail" ? "invalid" : "already spent (replay / expiry)"}`, async ({ request }) => {
        expectCaptchaRefused(await call(request, op.path, op.body(MODE!), DUMMY_TOKEN));
      });
    }
  });
}
