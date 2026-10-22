import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CONTACT_EMAIL_CODES,
  byteaHex,
  confirmContactEmailLink,
  contactEmailMessage,
  fromBase64Url,
  normalizeContactEmail,
  peekContactEmailLink,
  removeContactEmail,
  sha256Bytes,
  startContactEmail,
  toBase64Url,
  type ContactEmailDeps,
} from "./contact-email";
import { EMAIL_BRAND } from "@/server/email/brand";

/** MOCKED collaborators: these prove the orchestration (order, trust, mapping). The database rules are pgTAP-proven (110). */
const USER = "3f2b8c1e-5a4d-4e6f-9a7b-0c1d2e3f4a5b";
const RECEIPT = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const TOKEN = new Uint8Array(32).map((_, i) => i + 1);

type Call = { name: string; args: Record<string, unknown> };
function build(over: { confirm?: unknown; start?: unknown; send?: boolean; confirmOutcome?: string; release?: string } = {}) {
  const userCalls: Call[] = [];
  const serviceCalls: Call[] = [];
  const sent: { to: string; text: string }[] = [];
  const deps: ContactEmailDeps = {
    user: { rpc: vi.fn(async (name: string, args: Record<string, unknown>) => { userCalls.push({ name, args }); return { data: over.confirm ?? { ok: true, receipt: RECEIPT }, error: null }; }) } as never,
    service: {
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        serviceCalls.push({ name, args });
        if (name === "contact_email_claim_start") return { data: [over.start ?? { outcome: "sent", claim_id: "c1", expires_at: "2030-01-01T00:00:00Z", deliver: true }], error: null };
        if (name === "contact_email_claim_confirm") return { data: [{ outcome: over.confirmOutcome ?? "verified" }], error: null };
        if (name === "contact_email_release") return { data: [{ outcome: over.release ?? "cancelled" }], error: null };
        if (name === "contact_email_token_peek") return { data: [{ state: "valid", masked_email: "m***@probe.test", expires_at: null }], error: null };
        return { data: null, error: { code: "XX000" } };
      }),
    } as never,
    send: vi.fn(async (m: { to: string; text: string }) => { sent.push(m); return over.send === false ? { ok: false as const } : { ok: true as const, transport: "resend" as const }; }),
    randomBytes: () => TOKEN,
    sha256: sha256Bytes,
  };
  return { deps, userCalls, serviceCalls, sent };
}
const input = (over: Record<string, unknown> = {}) => ({ userId: USER, email: "Mine@Probe.test ", password: "pw", origin: "https://aladdindecore.com", locale: "en" as const, ...over });

describe("token helpers", () => {
  it("round-trips 32 bytes through base64url and refuses anything else", () => {
    const t = toBase64Url(TOKEN);
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fromBase64Url(t)).toEqual(TOKEN);
    expect(fromBase64Url("short")).toBeNull();
    expect(fromBase64Url(t + "A")).toBeNull();
  });
  it("encodes bytea as \\x hex", () => {
    expect(byteaHex(new Uint8Array([0, 15, 255]))).toBe("\\x000fff");
  });
  it("normalizes and refuses the login-alias domain", () => {
    expect(normalizeContactEmail(" Mine@Probe.TEST ")).toBe("mine@probe.test");
    expect(normalizeContactEmail("p201012345678@craftsman-login.aladdin.invalid")).toBeNull();
    expect(normalizeContactEmail("nope")).toBeNull();
  });
});

describe("startContactEmail", () => {
  it("confirms the password through the CALLER's session for the exact address, stores only the hash, mails the link", async () => {
    const t = build();
    expect(await startContactEmail(t.deps, input())).toEqual({ ok: true, code: CONTACT_EMAIL_CODES.sent });
    expect(t.userCalls).toEqual([{ name: "account_password_confirm", args: { p_password: "pw", p_operation: "contact_email.set", p_target: "mine@probe.test" } }]);
    const start = t.serviceCalls.find((c) => c.name === "contact_email_claim_start")!.args;
    expect(start).toMatchObject({ p_user_id: USER, p_receipt_id: RECEIPT, p_email: "mine@probe.test", p_ttl_seconds: 1800 });
    expect(start.p_token_hash).toBe(byteaHex(await sha256Bytes(TOKEN)));
    expect(JSON.stringify(start)).not.toContain(toBase64Url(TOKEN));   // the plaintext token never reaches the database
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.to).toBe("mine@probe.test");
    expect(t.sent[0]!.text).toContain(`https://aladdindecore.com/settings/contact-email/confirm?token=${toBase64Url(TOKEN)}`);
  });

  it("an address held by another account answers exactly like 'sent' and mails nothing", async () => {
    const t = build({ start: { outcome: "suppressed", claim_id: null, expires_at: null, deliver: false } });
    expect(await startContactEmail(t.deps, input())).toEqual({ ok: true, code: CONTACT_EMAIL_CODES.sent });
    expect(t.sent).toEqual([]);
  });

  it("a send failure cancels the pending claim and reports nothing changed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = build({ send: false });
    expect(await startContactEmail(t.deps, input())).toEqual({ ok: false, code: CONTACT_EMAIL_CODES.unavailable });
    expect(t.serviceCalls.map((c) => c.name)).toEqual(["contact_email_claim_start", "contact_email_release"]);
    expect(t.serviceCalls[1]!.args).toEqual({ p_user_id: USER, p_receipt_id: null });
  });

  it.each([
    [{ ok: false, reason: "wrong_password" }, CONTACT_EMAIL_CODES.wrongPassword],
    [{ ok: false, reason: "no_password" }, CONTACT_EMAIL_CODES.noPassword],
    [{ ok: false, reason: "locked", retry_at: new Date(Date.now() + 60_000).toISOString() }, CONTACT_EMAIL_CODES.locked],
  ])("a refused confirmation (%o) starts nothing", async (confirm, code) => {
    const t = build({ confirm });
    expect(await startContactEmail(t.deps, input())).toMatchObject({ ok: false, code });
    expect(t.serviceCalls).toEqual([]);
  });

  it("refuses before any attempt is spent: bad address, no password, no trusted link origin", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [over, code] of [[{ email: "x" }, CONTACT_EMAIL_CODES.invalidEmail], [{ password: "" }, CONTACT_EMAIL_CODES.passwordRequired], [{ origin: null }, CONTACT_EMAIL_CODES.unavailable]] as const) {
      const t = build();
      expect(await startContactEmail(t.deps, input(over))).toEqual({ ok: false, code });
      expect(t.userCalls).toEqual([]);
    }
  });

  it("own confirmed sign-in email verifies at once without a message", async () => {
    const t = build({ start: { outcome: "verified", claim_id: "c1", expires_at: null, deliver: false } });
    expect(await startContactEmail(t.deps, input())).toEqual({ ok: true, code: CONTACT_EMAIL_CODES.verified });
    expect(t.sent).toEqual([]);
  });
});

describe("link confirmation", () => {
  it("peek and confirm send only the hash, and confirm always declares the explicit action", async () => {
    const t = build();
    const token = toBase64Url(TOKEN);
    expect(await peekContactEmailLink(t.deps, USER, token)).toEqual({ state: "valid", maskedEmail: "m***@probe.test" });
    expect(await confirmContactEmailLink(t.deps, USER, token)).toEqual({ ok: true, code: CONTACT_EMAIL_CODES.verified });
    const confirm = t.serviceCalls.find((c) => c.name === "contact_email_claim_confirm")!.args;
    expect(confirm).toEqual({ p_user_id: USER, p_token_hash: byteaHex(await sha256Bytes(TOKEN)), p_explicit_action: true });
  });
  it("a malformed token never reaches the database", async () => {
    const t = build();
    expect(await peekContactEmailLink(t.deps, USER, "../../etc")).toEqual({ state: "invalid", maskedEmail: null });
    expect(await confirmContactEmailLink(t.deps, USER, "x")).toEqual({ ok: false, code: CONTACT_EMAIL_CODES.linkInvalid });
    expect(t.serviceCalls).toEqual([]);
  });
  it.each([["expired", CONTACT_EMAIL_CODES.linkExpired], ["unavailable", CONTACT_EMAIL_CODES.addressUnavailable], ["invalid", CONTACT_EMAIL_CODES.linkInvalid]])(
    "maps %s", async (outcome, code) => {
      const t = build({ confirmOutcome: outcome });
      expect(await confirmContactEmailLink(t.deps, USER, toBase64Url(TOKEN))).toEqual({ ok: false, code });
    });
});

describe("removeContactEmail", () => {
  it("a verified address needs the current password (contact_email.remove, target self)", async () => {
    const t = build({ release: "removed" });
    expect(await removeContactEmail(t.deps, { userId: USER, password: "pw", verified: true })).toEqual({ ok: true, code: CONTACT_EMAIL_CODES.removed });
    expect(t.userCalls[0]!.args).toEqual({ p_password: "pw", p_operation: "contact_email.remove", p_target: "self" });
    expect(t.serviceCalls[0]!.args).toEqual({ p_user_id: USER, p_receipt_id: RECEIPT });
  });
  it("cancelling a pending link needs no password", async () => {
    const t = build();
    expect(await removeContactEmail(t.deps, { userId: USER, password: undefined, verified: false })).toEqual({ ok: true, code: CONTACT_EMAIL_CODES.cancelled });
    expect(t.userCalls).toEqual([]);
  });
});

describe("contactEmailMessage", () => {
  it("escapes the link and carries the brand palette only", () => {
    const m = contactEmailMessage("a@b.test", "https://x.test/?a=1&b=<2>", "ar");
    expect(m.html).toContain("&amp;b=&lt;2&gt;");
    expect(m.html).toContain('dir="rtl"');
    const palette: string[] = Object.values(EMAIL_BRAND);
    for (const color of m.html.match(/#[0-9A-Fa-f]{6}/g) ?? []) expect(palette).toContain(color.toUpperCase());
  });
});
